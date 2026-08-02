import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import {
  assertJsonRequest,
  assertSameOrigin,
  buildSecurityHeaders,
  clientIp,
  enforceRateLimit,
  redactLogValue,
  safeRequestPath,
} from "../lib/http-security.mjs";
import {
  csrfTokenForSession,
  requireCsrf,
} from "../lib/auth.mjs";

process.env.NODE_ENV = "test";
process.env.APP_BASE_URL = "http://localhost:3000";
process.env.CSRF_SECRET = "security-unit-check-secret-with-32-characters";

function request({
  url = "/api/test",
  method = "POST",
  headers = {},
  remoteAddress = "::ffff:127.0.0.1",
} = {}) {
  return {
    url,
    method,
    headers,
    socket: { remoteAddress },
  };
}

function expectStatus(fn, statusCode) {
  try {
    fn();
    assert.fail(`Expected status ${statusCode}`);
  } catch (error) {
    assert.equal(error.statusCode, statusCode);
  }
}

async function expectStatusAsync(fn, statusCode) {
  try {
    await fn();
    assert.fail(`Expected status ${statusCode}`);
  } catch (error) {
    assert.equal(error.statusCode, statusCode);
  }
}

const headers = buildSecurityHeaders({ isProduction: true });
assert.match(headers["content-security-policy"], /script-src 'self'/);
assert.doesNotMatch(headers["content-security-policy"], /script-src[^;]*unsafe-inline/);
assert.equal(headers["x-frame-options"], "DENY");
assert.match(headers["strict-transport-security"], /max-age=31536000/);

assert.doesNotThrow(() => assertJsonRequest(request({
  headers: { "content-type": "application/json; charset=utf-8" },
})));
expectStatus(() => assertJsonRequest(request({
  headers: { "content-type": "text/plain" },
})), 415);

assert.doesNotThrow(() => assertSameOrigin(request({
  headers: { origin: "https://vahan.example" },
}), "https://vahan.example/path"));
expectStatus(() => assertSameOrigin(request({
  headers: { origin: "https://attacker.example" },
}), "https://vahan.example"), 403);
expectStatus(() => assertSameOrigin(request(), "https://vahan.example"), 403);

assert.equal(clientIp(request({
  headers: { "x-forwarded-for": "198.51.100.20" },
  remoteAddress: "::ffff:127.0.0.1",
}), 0), "127.0.0.1");
assert.equal(clientIp(request({
  headers: { "x-forwarded-for": "203.0.113.8, 198.51.100.20" },
  remoteAddress: "10.0.0.5",
}), 1), "198.51.100.20");

const sessionId = "unit-test-session";
const csrfToken = csrfTokenForSession(sessionId);
assert.doesNotThrow(() => requireCsrf(request({
  headers: {
    cookie: `vahan_session=${sessionId}`,
    origin: "http://localhost:3000",
    "x-csrf-token": csrfToken,
  },
})));
expectStatus(() => requireCsrf(request({
  headers: {
    cookie: `vahan_session=${sessionId}`,
    origin: "http://localhost:3000",
    "x-csrf-token": "wrong",
  },
})), 403);

const limitedRequest = request({
  headers: { "x-forwarded-for": "198.51.100.20" },
  remoteAddress: "127.0.0.1",
});
for (let count = 0; count < 2; count += 1) {
  await enforceRateLimit({
    request: limitedRequest,
    group: "security-unit",
    max: 2,
    globalMax: 20,
    windowMs: 60_000,
    trustedProxyHops: 0,
    store: "memory",
  });
}
await expectStatusAsync(() => enforceRateLimit({
  request: limitedRequest,
  group: "security-unit",
  max: 2,
  globalMax: 20,
  windowMs: 60_000,
  trustedProxyHops: 0,
  store: "memory",
}), 429);

assert.equal(safeRequestPath(request({ url: "/auth/google/callback?code=secret-code" })), "/auth/google/callback");
const databaseUrlWithPassword = ["postgresql://u", "pass@db.example/app"].join(":");
assert.doesNotMatch(
  redactLogValue(`authorization=secret Bearer abc.def token=mytoken ${databaseUrlWithPassword}`),
  /secret|abc\.def|mytoken|:pass@/,
);

const sourceFiles = walkSourceFiles("public")
  .concat(["server.mjs"])
  .concat(walkSourceFiles("lib"));
for (const file of sourceFiles) {
  const text = fs.readFileSync(file, "utf8");
  assert.doesNotMatch(text, /\beval\s*\(|new\s+Function\s*\(/, `${file} must not execute dynamic code`);
  if (file.endsWith(".html")) {
    assert.doesNotMatch(text, /<script(?![^>]*\bsrc=)[^>]*>/i, `${file} must not contain inline scripts`);
    assert.doesNotMatch(text, /\son[a-z]+\s*=/i, `${file} must not contain inline event handlers`);
  }
}

const serverSource = fs.readFileSync("server.mjs", "utf8");
for (const match of serverSource.matchAll(/response\.writeHead\(/g)) {
  assert.match(
    serverSource.slice(match.index, match.index + 300),
    /securityHeaders\(/,
    "Every direct HTTP response must use centralized security headers",
  );
}

console.log("security unit checks passed");

function walkSourceFiles(root) {
  const output = [];
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    const target = path.join(root, entry.name);
    if (entry.isDirectory()) output.push(...walkSourceFiles(target));
    else if (/\.(?:html|js|mjs)$/.test(entry.name)) output.push(target);
  }
  return output;
}
