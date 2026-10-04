import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { acquireVahanScrapeLock } from "../lib/vahan-scrape-lock.mjs";

function fakeClient(handler = () => ({ rows: [{ acquired: true }] })) {
  const client = new EventEmitter();
  client.queries = [];
  client.releases = [];
  client.query = async (query) => {
    assert.equal(query.query_timeout, 1000);
    client.queries.push(query);
    return handler(query);
  };
  client.ends = 0;
  client.end = async () => { client.ends += 1; client.emit("end"); };
  client.release = (destroy) => client.releases.push(destroy);
  return client;
}
const options = (client) => ({ pool: { connect: async () => client }, guardLoss: true, heartbeatMs: 250, queryTimeoutMs: 1000 });
const waitForHeartbeat = async (started) => {
  let timer;
  try {
    await Promise.race([started, new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error("Heartbeat did not start")), 2000);
    })]);
  } finally { clearTimeout(timer); }
};

// Legacy callers without a request guard retain their prior fail-closed error behavior.
const legacy = fakeClient();
const releaseLegacy = await acquireVahanScrapeLock("legacy", { ...options(legacy), guardLoss: false });
assert.equal(legacy.listenerCount("error"), 0);
assert.throws(() => legacy.emit("error", new Error("legacy idle disconnect")), /legacy idle disconnect/);
await releaseLegacy();
assert.deepEqual(legacy.releases, [false]);

// Existing release-function callers remain compatible and healthy cleanup is idempotent.
const healthy = fakeClient();
const releaseHealthy = await acquireVahanScrapeLock("healthy", options(healthy));
releaseHealthy.assertHeld();
await releaseHealthy();
await releaseHealthy();
assert.deepEqual(healthy.releases, [false]);
assert.equal(healthy.queries.filter((q) => q.text.includes("pg_advisory_unlock")).length, 1);
assert.equal(healthy.listenerCount("error"), 0);
assert.equal(healthy.listenerCount("end"), 0);
assert.throws(() => releaseHealthy.assertHeld(), /released/);

// A checked-out pg client emits a separate idle error; it must never crash the process.
const disconnected = fakeClient();
const releaseDisconnected = await acquireVahanScrapeLock("disconnected", options(disconnected));
disconnected.emit("error", new Error("Connection terminated unexpectedly postgres://private"));
disconnected.emit("end");
assert.throws(() => releaseDisconnected.assertHeld(), (error) =>
  error.code === "VAHAN_SCRAPE_LOCK_LOST" && !error.message.includes("postgres"));
// A delayed socket error during destruction stays on our listener until end.
disconnected.end = async () => {
  disconnected.ends += 1;
  assert.equal(disconnected.listenerCount("error"), 1);
  assert.deepEqual(disconnected.releases, []);
  await new Promise((resolve) => setImmediate(resolve));
  disconnected.emit("error", new Error("delayed socket error"));
  disconnected.emit("end");
};
await releaseDisconnected();
await releaseDisconnected();
assert.equal(disconnected.ends, 1);
assert.equal(disconnected.listenerCount("error"), 0);
assert.deepEqual(disconnected.releases, [true]);
assert.equal(disconnected.queries.length, 1, "lost connections must not try to unlock");

// A heartbeat rejection is handled even without an accompanying pg error event.
let heartbeatStarted;
const heartbeatStart = new Promise((resolve) => { heartbeatStarted = resolve; });
const failedHeartbeat = fakeClient((query) => {
  if (query.text === "select 1") { heartbeatStarted(); throw new Error("query timeout"); }
  return { rows: [{ acquired: true }] };
});
const releaseFailedHeartbeat = await acquireVahanScrapeLock("heartbeat", options(failedHeartbeat));
await waitForHeartbeat(heartbeatStart);
await new Promise((resolve) => setImmediate(resolve));
assert.throws(() => releaseFailedHeartbeat.assertHeld(), { code: "VAHAN_SCRAPE_LOCK_LOST" });
failedHeartbeat.emit("error", new Error("socket closed"));
failedHeartbeat.emit("end");
await releaseFailedHeartbeat();
assert.deepEqual(failedHeartbeat.releases, [true]);
assert.equal(failedHeartbeat.queries.filter((q) => q.text.includes("pg_try_advisory_lock")).length, 1);

// Release waits for a pending probe before unlocking and stops future heartbeats.
let pendingStarted;
let completeProbe;
const pendingStart = new Promise((resolve) => { pendingStarted = resolve; });
const pending = fakeClient((query) => {
  if (query.text === "select 1") {
    pendingStarted();
    return new Promise((resolve) => { completeProbe = resolve; });
  }
  return { rows: [{ acquired: true }] };
});
const releasePending = await acquireVahanScrapeLock("pending", options(pending));
await waitForHeartbeat(pendingStart);
const releasing = releasePending();
assert.deepEqual(pending.releases, []);
assert.equal(pending.queries.some((q) => q.text.includes("pg_advisory_unlock")), false);
completeProbe({ rows: [{ "?column?": 1 }] });
await releasing;
const releasedQueryCount = pending.queries.length;
await new Promise((resolve) => setTimeout(resolve, 300));
assert.equal(pending.queries.length, releasedQueryCount);
assert.deepEqual(pending.releases, [false]);

// Contention returns a healthy client; failed or timed-out lock queries discard it.
const busy = fakeClient(() => ({ rows: [{ acquired: false }] }));
await assert.rejects(acquireVahanScrapeLock("busy", options(busy)), /already running/);
assert.deepEqual(busy.releases, [false]);
assert.equal(busy.listenerCount("error"), 0);
const acquisitionFailure = fakeClient(() => { throw new Error("query timeout"); });
await assert.rejects(acquireVahanScrapeLock("timeout", options(acquisitionFailure)), /query timeout/);
assert.deepEqual(acquisitionFailure.releases, [true]);
assert.equal(acquisitionFailure.listenerCount("error"), 0);

const unlockFailure = fakeClient((query) => {
  if (query.text.includes("pg_advisory_unlock")) throw new Error("query timeout");
  return { rows: [{ acquired: true }] };
});
const releaseUnlockFailure = await acquireVahanScrapeLock("unlock-timeout", options(unlockFailure));
await releaseUnlockFailure();
assert.deepEqual(unlockFailure.releases, [true]);

console.log("VAHAN scrape lock checks passed: checked-out errors, heartbeat loss, bounded queries, safe release and contention.");
