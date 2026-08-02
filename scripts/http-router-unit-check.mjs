import assert from "node:assert/strict";
import { createHttpRouter } from "../lib/http-router.mjs";

const calls = [];
const responses = [];
const services = {
  requireUser: async () => {
    calls.push("requireUser");
    return { id: 7 };
  },
  requireAdmin: async () => ({ id: 1, role: "admin" }),
  requireCsrf: () => calls.push("requireCsrf"),
  enforceRateLimit: async (_request, group, userId) => calls.push(`rate:${group}:${userId}`),
  readBody: async () => {
    calls.push("readBody");
    return { rto: "Noida" };
  },
  sendJson: (_response, status, body) => responses.push({ status, body }),
};

const router = createHttpRouter(services);
router.post("/api/pins/:pinId", { auth: "user", csrf: true, rateLimit: "expensive", body: "json" }, async ({ params, user, body }) => {
  assert.equal(params.pinId, "42");
  assert.equal(user.id, 7);
  assert.deepEqual(body, { rto: "Noida" });
  return { status: 201, body: { saved: true } };
});

const handled = await router.handle({
  request: { method: "POST" },
  response: {},
  url: new URL("http://localhost/api/pins/42"),
});
assert.equal(handled, true);
assert.deepEqual(calls, ["requireUser", "requireCsrf", "rate:expensive:7", "readBody"]);
assert.deepEqual(responses, [{ status: 201, body: { saved: true } }]);
assert.equal(await router.handle({ request: { method: "GET" }, response: {}, url: new URL("http://localhost/api/pins/42") }), false);

console.log("HTTP router unit checks passed.");
