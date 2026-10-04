import { getPool } from "./db.mjs";

const LOCK_NAME = "vahan-ey-external-scrape";

export async function acquireVahanScrapeLock(owner = "scraper", options = {}) {
  const waitMs = Math.max(0, Number(options.waitMs) || 0);
  const retryMs = Math.max(250, Number(options.retryMs) || 5000);
  const heartbeatMs = Math.max(250, Number(options.heartbeatMs) || 30_000);
  const queryTimeoutMs = Math.max(250, Number(options.queryTimeoutMs) || 10_000);
  const deadline = Date.now() + waitMs;
  const client = await (options.pool ?? getPool()).connect();
  let clientReleased = false;
  let released = false;
  let lockLost = null;
  let heartbeatTimer;
  let heartbeatInFlight = null;
  const markLost = () => {
    if (clientReleased || lockLost) return;
    lockLost = new Error("Shared VAHAN scrape lock connection was lost; acquire a new lock before continuing.");
    lockLost.code = "VAHAN_SCRAPE_LOCK_LOST";
  };
  // pg-pool removes its idle error listener while this client is checked out.
  // A query rejection alone cannot handle the separate client error event.
  // Only collectors that check assertHeld can safely turn lock loss into a stop.
  // Other callers retain pg's prior fail-closed error behavior.
  if (options.guardLoss === true) {
    client.on("error", markLost);
    client.on("end", markLost);
  }
  const releaseClient = async (destroy = false) => {
    if (clientReleased) return;
    // Close guarded broken clients before pg-pool reattaches its idle listener.
    // Keep our listener through socket shutdown to handle delayed error events.
    if (destroy && options.guardLoss === true) await client.end();
    clientReleased = true;
    try { client.release(destroy); }
    finally {
      client.removeListener("error", markLost);
      client.removeListener("end", markLost);
    }
  };
  const assertHeld = () => {
    if (released) throw new Error("Shared VAHAN scrape lock has already been released.");
    if (lockLost) throw lockLost;
  };
  const query = (text, values = []) => client.query({ text, values, query_timeout: queryTimeoutMs });
  try {
    while (true) {
      assertHeld();
      const result = await query("select pg_try_advisory_lock(hashtext($1)) as acquired", [LOCK_NAME]);
      assertHeld();
      if (result.rows[0]?.acquired) break;
      if (Date.now() >= deadline) {
        await releaseClient();
        throw new Error("Another VAHAN scraper is already running; " + owner + " did not start.");
      }
      await sleep(Math.min(retryMs, Math.max(1, deadline - Date.now())));
    }
  } catch (error) {
    // A timed-out query can still be running on the wire and could own the lock.
    const failure = lockLost ?? error;
    if (!clientReleased) await releaseClient(true);
    throw failure;
  }
  if (options.guardLoss === true) {
    heartbeatTimer = setInterval(() => {
      if (released || lockLost || heartbeatInFlight) return;
      // Do not reacquire the advisory lock: session acquisitions stack.
      heartbeatInFlight = query("select 1").catch(markLost).finally(() => { heartbeatInFlight = null; });
    }, heartbeatMs);
    heartbeatTimer.unref?.();
  }
  const release = async () => {
    if (released) return;
    released = true;
    clearInterval(heartbeatTimer);
    await heartbeatInFlight;
    if (!lockLost) {
      try { await query("select pg_advisory_unlock(hashtext($1))", [LOCK_NAME]); }
      catch { markLost(); }
    }
    await releaseClient(Boolean(lockLost));
  };
  release.assertHeld = assertHeld;
  return release;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
