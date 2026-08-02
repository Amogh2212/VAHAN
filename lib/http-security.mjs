import process from "node:process";
import { hasDatabaseUrl, query } from "./db.mjs";

const CONTENT_SECURITY_POLICY = [
  "default-src 'self'",
  "base-uri 'self'",
  "object-src 'none'",
  "frame-ancestors 'none'",
  "form-action 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: https:",
  "font-src 'self' data:",
  "connect-src 'self'",
].join("; ");

const memoryRateLimitBuckets = new Map();

export function buildSecurityHeaders({ isProduction = false, headers = {} } = {}) {
  return {
    "content-security-policy": CONTENT_SECURITY_POLICY,
    "cross-origin-opener-policy": "same-origin",
    "cross-origin-resource-policy": "same-origin",
    "permissions-policy": "camera=(), microphone=(), geolocation=()",
    "referrer-policy": "strict-origin-when-cross-origin",
    "x-content-type-options": "nosniff",
    "x-frame-options": "DENY",
    "x-permitted-cross-domain-policies": "none",
    ...(isProduction
      ? { "strict-transport-security": "max-age=31536000; includeSubDomains" }
      : {}),
    ...headers,
  };
}

export function assertJsonRequest(request) {
  const contentType = String(request.headers?.["content-type"] ?? "")
    .split(";", 1)[0]
    .trim()
    .toLowerCase();
  if (contentType === "application/json") return;
  throw httpError(415, "Request content type must be application/json.");
}

export function assertSameOrigin(request, expectedBaseUrl) {
  let expectedOrigin;
  try {
    expectedOrigin = new URL(expectedBaseUrl).origin;
  } catch {
    throw httpError(503, "APP_BASE_URL is not configured with a valid origin.");
  }

  const origin = String(request.headers?.origin ?? "").trim();
  if (!origin) throw httpError(403, "A same-origin request is required.");

  let requestOrigin;
  try {
    requestOrigin = new URL(origin).origin;
  } catch {
    throw httpError(403, "Request origin is invalid.");
  }
  if (requestOrigin !== expectedOrigin) {
    throw httpError(403, "Cross-origin state changes are not allowed.");
  }
}

export function clientIp(request, trustedProxyHops = 0) {
  const remoteAddress = normalizeIp(request.socket?.remoteAddress ?? "unknown");
  const hops = Math.max(0, Math.floor(Number(trustedProxyHops) || 0));
  if (!hops) return remoteAddress;

  const forwarded = String(request.headers?.["x-forwarded-for"] ?? "")
    .split(",")
    .map((value) => normalizeIp(value.trim()))
    .filter(Boolean);
  const chain = [...forwarded, remoteAddress];
  const index = chain.length - 1 - hops;
  return index >= 0 ? chain[index] : remoteAddress;
}

export async function enforceRateLimit({
  request,
  group,
  max,
  windowMs,
  globalMax = null,
  userId = null,
  trustedProxyHops = 0,
  store = process.env.RATE_LIMIT_STORE || "memory",
} = {}) {
  const safeMax = Math.max(0, Math.floor(Number(max) || 0));
  const safeWindowMs = Math.max(0, Math.floor(Number(windowMs) || 0));
  if (!safeMax || !safeWindowMs) return;

  const identities = [
    { key: `${group}:ip:${clientIp(request, trustedProxyHops)}`, max: safeMax },
  ];
  if (userId) identities.push({ key: `${group}:user:${userId}`, max: safeMax });
  const safeGlobalMax = Math.max(safeMax, Math.floor(Number(globalMax) || safeMax * 50));
  identities.push({ key: `${group}:global`, max: safeGlobalMax });

  for (const identity of identities) {
    const bucket = store === "database"
      ? await consumeDatabaseBucket(identity.key, safeWindowMs)
      : consumeMemoryBucket(identity.key, safeWindowMs);
    if (bucket.count > identity.max) {
      const retryAfter = Math.max(1, Math.ceil((bucket.resetAt.getTime() - Date.now()) / 1000));
      const error = httpError(429, "Too many requests. Please wait before trying again.");
      error.headers = { "retry-after": String(retryAfter) };
      throw error;
    }
  }
}

export function redactLogValue(value) {
  return String(value ?? "")
    .replace(/(authorization|cookie|token|secret|code)=([^&\s]+)/gi, "$1=[REDACTED]")
    .replace(/\bBearer\s+[A-Za-z0-9._~-]+/gi, "Bearer [REDACTED]")
    .replace(/\b(?:sk|ghp|AIza)[-_A-Za-z0-9]{12,}\b/g, "[REDACTED_KEY]")
    .replace(/(postgres(?:ql)?:\/\/[^:\s/]+:)[^@\s]+@/gi, "$1[REDACTED]@");
}

export function safeRequestPath(request) {
  try {
    return new URL(request.url, "http://local.invalid").pathname;
  } catch {
    return "/";
  }
}

function consumeMemoryBucket(key, windowMs) {
  const now = Date.now();
  let bucket = memoryRateLimitBuckets.get(key);
  if (!bucket || bucket.resetAt.getTime() <= now) {
    bucket = { count: 0, resetAt: new Date(now + windowMs) };
  }
  bucket.count += 1;
  memoryRateLimitBuckets.set(key, bucket);
  cleanupMemoryBuckets(now);
  return bucket;
}

async function consumeDatabaseBucket(key, windowMs) {
  if (!hasDatabaseUrl()) {
    throw httpError(503, "The production rate-limit store is unavailable.");
  }
  const resetAt = new Date(Date.now() + windowMs);
  const result = await query(
    `
      insert into request_rate_limits (bucket_key, request_count, reset_at)
      values ($1, 1, $2)
      on conflict (bucket_key)
      do update set
        request_count = case
          when request_rate_limits.reset_at <= now() then 1
          else request_rate_limits.request_count + 1
        end,
        reset_at = case
          when request_rate_limits.reset_at <= now() then excluded.reset_at
          else request_rate_limits.reset_at
        end
      returning request_count, reset_at
    `,
    [key, resetAt.toISOString()],
  );
  const row = result.rows[0];
  if (Math.random() < 0.01) {
    query(`delete from request_rate_limits where reset_at < now() - interval '1 day'`).catch(() => {});
  }
  return {
    count: Number(row.request_count),
    resetAt: new Date(row.reset_at),
  };
}

function cleanupMemoryBuckets(now) {
  if (memoryRateLimitBuckets.size < 1_000) return;
  for (const [key, bucket] of memoryRateLimitBuckets.entries()) {
    if (bucket.resetAt.getTime() <= now) memoryRateLimitBuckets.delete(key);
  }
}

function normalizeIp(value) {
  return String(value || "unknown").replace(/^::ffff:/, "");
}

function httpError(statusCode, message) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}
