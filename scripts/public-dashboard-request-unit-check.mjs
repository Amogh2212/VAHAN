import assert from "node:assert/strict";
import { fetchPublicDashboardWithRetry } from "../lib/public-dashboard-request.mjs";

for (const status of [404, 408, 429, 500, 502, 503, 504]) {
  let calls = 0;
  let gates = 0;
  const signals = [];
  const result = await fetchPublicDashboardWithRetry("https://analytics.parivahan.gov.in/test", {
    maxAttempts: 3, sleep: async () => {}, beforeRequest: async () => { gates += 1; },
    fetchImpl: async (_url, { signal }) => {
      signals.push(signal);
      return ++calls === 1 ? new Response("unavailable", { status }) : Response.json([{ count: 7 }]);
    },
  });
  assert.equal(result.status, 200);
  assert.equal(calls, 2);
  assert.equal(gates, 2, "retries must respect the rate limiter");
  assert.notEqual(signals[0], signals[1], "each retry gets a fresh timeout");
}
let calls = 0;
const failed = await fetchPublicDashboardWithRetry("https://analytics.parivahan.gov.in/test", {
  maxAttempts: 3, sleep: async () => {}, fetchImpl: async () => { calls += 1; return new Response("missing", { status: 404 }); },
});
assert.equal(calls, 3);
assert.equal(failed.status, 404, "exhausted retries must remain a source failure");
for (const response of [Response.json([]), new Response("not JSON"), new Response("unauthorized", { status: 401 })]) {
  calls = 0;
  const result = await fetchPublicDashboardWithRetry("https://analytics.parivahan.gov.in/test", {
    maxAttempts: 3, sleep: async () => {}, fetchImpl: async () => { calls += 1; return response; },
  });
  assert.equal(calls, 1, "successful or non-transient responses are not retried or manufactured");
  assert.equal(result, response);
}
calls = 0;
const rateLimited = await fetchPublicDashboardWithRetry("https://analytics.parivahan.gov.in/test", {
  maxAttempts: 3, sleep: async () => {}, fetchImpl: async () => {
    calls += 1; return new Response("busy", { status: 429, headers: { "retry-after": "60" } });
  },
});
assert.equal(calls, 1, "do not retry before a long server-requested cooldown");
assert.equal(rateLimited.status, 429);
calls = 0;
const recovered = await fetchPublicDashboardWithRetry("https://analytics.parivahan.gov.in/test", {
  maxAttempts: 3, sleep: async () => {}, fetchImpl: async () => {
    if (++calls === 1) throw new TypeError("fetch failed");
    return Response.json({ count: 9 });
  },
});
assert.deepEqual(await recovered.json(), { count: 9 });
console.log("Public Dashboard transport retry checks passed.");
