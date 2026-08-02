import crypto from "node:crypto";
import process from "node:process";
import { query, transaction } from "./db.mjs";
import { assertSameOrigin } from "./http-security.mjs";

const SESSION_COOKIE = "vahan_session";
const OAUTH_STATE_COOKIE = "vahan_oauth_state";
const SESSION_DAYS = Number(process.env.SESSION_DAYS ?? 30);
const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
const GOOGLE_USERINFO_URL = "https://openidconnect.googleapis.com/v1/userinfo";
const AUTH_PRUNE_INTERVAL_MS = 60 * 60 * 1000;
const AUTH_PROVIDER_TIMEOUT_MS = Math.max(1_000, Number(process.env.AUTH_PROVIDER_TIMEOUT_MS ?? 10_000));
let lastAuthPruneAt = 0;

export function hasGoogleAuthConfig() {
  return Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET && googleRedirectUri());
}

export function googleRedirectUri() {
  return process.env.GOOGLE_REDIRECT_URI || `${appBaseUrl()}/auth/google/callback`;
}

export function appBaseUrl() {
  return String(process.env.APP_BASE_URL || `http://localhost:${process.env.PORT || 3000}`).replace(/\/+$/, "");
}

export function authCookieName() {
  return SESSION_COOKIE;
}

export function parseCookies(request) {
  const output = {};
  for (const part of String(request.headers.cookie ?? "").split(";")) {
    const [rawName, ...rawValue] = part.trim().split("=");
    if (!rawName) continue;
    try {
      output[decodeURIComponent(rawName)] = decodeURIComponent(rawValue.join("=") || "");
    } catch {
      // Ignore malformed attacker-controlled cookie fragments.
    }
  }
  return output;
}

export function cookieHeader(name, value, { maxAge = null, httpOnly = true } = {}) {
  const parts = [
    `${encodeURIComponent(name)}=${encodeURIComponent(value)}`,
    "Path=/",
    "SameSite=Lax",
  ];
  if (httpOnly) parts.push("HttpOnly");
  if (process.env.NODE_ENV === "production") parts.push("Secure");
  if (maxAge !== null) parts.push(`Max-Age=${maxAge}`);
  return parts.join("; ");
}

export function clearCookieHeader(name) {
  return cookieHeader(name, "", { maxAge: 0 });
}

export function oauthStateCookie(value) {
  return cookieHeader(OAUTH_STATE_COOKIE, value, { maxAge: 600 });
}

export function googleLoginUrl({ returnTo = "/" } = {}) {
  if (!hasGoogleAuthConfig()) {
    const error = new Error("Google login is not configured.");
    error.statusCode = 503;
    throw error;
  }
  const state = randomToken(24);
  const params = new URLSearchParams({
    client_id: process.env.GOOGLE_CLIENT_ID,
    redirect_uri: googleRedirectUri(),
    response_type: "code",
    scope: "openid email profile",
    state,
    prompt: "select_account",
    access_type: "online",
  });
  return {
    url: `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`,
    state,
    returnTo: safeReturnTo(returnTo),
  };
}

export function oauthStateCookieValue(state, returnTo) {
  return Buffer.from(JSON.stringify({ state, returnTo: safeReturnTo(returnTo) }), "utf8").toString("base64url");
}

export function readOauthStateCookie(request) {
  const value = parseCookies(request)[OAUTH_STATE_COOKIE];
  if (!value) return null;
  try {
    return JSON.parse(Buffer.from(value, "base64url").toString("utf8"));
  } catch {
    return null;
  }
}

export function oauthStateCookieName() {
  return OAUTH_STATE_COOKIE;
}

export async function googleUserFromCode(code) {
  const tokenResponse = await fetch(GOOGLE_TOKEN_URL, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    signal: AbortSignal.timeout(AUTH_PROVIDER_TIMEOUT_MS),
    body: new URLSearchParams({
      client_id: process.env.GOOGLE_CLIENT_ID,
      client_secret: process.env.GOOGLE_CLIENT_SECRET,
      code,
      grant_type: "authorization_code",
      redirect_uri: googleRedirectUri(),
    }),
  });
  const tokenBody = await tokenResponse.json().catch(() => ({}));
  if (!tokenResponse.ok) {
    const error = new Error(
      process.env.NODE_ENV === "production"
        ? "Google sign-in failed."
        : tokenBody.error_description || tokenBody.error || "Google token exchange failed.",
    );
    error.statusCode = 401;
    throw error;
  }

  const userResponse = await fetch(GOOGLE_USERINFO_URL, {
    headers: { authorization: `Bearer ${tokenBody.access_token}` },
    signal: AbortSignal.timeout(AUTH_PROVIDER_TIMEOUT_MS),
  });
  const profile = await userResponse.json().catch(() => ({}));
  if (!userResponse.ok || !profile.sub || !profile.email || profile.email_verified !== true) {
    const error = new Error("Google profile lookup failed.");
    error.statusCode = 401;
    throw error;
  }
  return profile;
}

export async function upsertGoogleUser(profile) {
  return upsertGoogleUserWithQuery(query, profile);
}

export async function createGoogleSession(profile) {
  return transaction(async (runQuery) => {
    const user = await upsertGoogleUserWithQuery(runQuery, profile);
    const session = await createSessionWithQuery(runQuery, user.id);
    return { user, session };
  });
}

async function upsertGoogleUserWithQuery(runQuery, profile) {
  const role = adminEmails().has(String(profile.email).trim().toLowerCase()) ? "admin" : "user";
  const result = await runQuery(
    `
      insert into users (google_sub, email, name, picture_url, role)
      values ($1, $2, $3, $4, $5)
      on conflict (google_sub)
      do update set
        email = excluded.email,
        name = excluded.name,
        picture_url = excluded.picture_url,
        role = excluded.role,
        updated_at = now()
      returning id, email, name, picture_url, telegram_chat_id, role, created_at, updated_at
    `,
    [profile.sub, profile.email, profile.name ?? null, profile.picture ?? null, role],
  );
  return normalizeUser(result.rows[0]);
}

export async function createSession(userId) {
  return createSessionWithQuery(query, userId);
}

async function createSessionWithQuery(runQuery, userId) {
  await pruneExpiredAuthRecordsWithQuery(runQuery);
  const id = randomToken(32);
  const expiresAt = new Date(Date.now() + SESSION_DAYS * 24 * 60 * 60 * 1000);
  await runQuery(
    `
      insert into sessions (id, user_id, expires_at)
      values ($1, $2, $3)
    `,
    [id, userId, expiresAt.toISOString()],
  );
  return { id, expiresAt };
}

export async function destroySession(sessionId) {
  if (!sessionId) return;
  await query(`delete from sessions where id = $1`, [sessionId]);
}

export async function currentUser(request) {
  const sessionId = parseCookies(request)[SESSION_COOKIE];
  if (!sessionId) return null;
  await maybePruneExpiredAuthRecords();
  const result = await query(
    `
      select u.id, u.email, u.name, u.picture_url, u.telegram_chat_id, u.role, u.created_at, u.updated_at
      from sessions s
      join users u on u.id = s.user_id
      where s.id = $1 and s.expires_at > now()
      limit 1
    `,
    [sessionId],
  );
  return result.rows[0] ? normalizeUser(result.rows[0]) : null;
}

export async function requireUser(request) {
  const user = await currentUser(request);
  if (user) return user;
  const error = new Error("Login required.");
  error.statusCode = 401;
  throw error;
}

export async function requireAdmin(request) {
  const user = await requireUser(request);
  if (user.role === "admin") return user;
  const error = new Error("Administrator access is required.");
  error.statusCode = 403;
  throw error;
}

export function csrfTokenForRequest(request) {
  const sessionId = parseCookies(request)[SESSION_COOKIE];
  if (!sessionId) return null;
  return csrfTokenForSession(sessionId);
}

export function csrfTokenForSession(sessionId) {
  return crypto
    .createHmac("sha256", csrfSecret())
    .update(String(sessionId))
    .digest("base64url");
}

export function requireCsrf(request) {
  assertSameOrigin(request, appBaseUrl());
  const expected = csrfTokenForRequest(request);
  const supplied = String(request.headers["x-csrf-token"] ?? "");
  if (!expected || !safeTokenEqual(supplied, expected)) {
    const error = new Error("CSRF validation failed.");
    error.statusCode = 403;
    throw error;
  }
}

export async function createTelegramLinkCode(userId) {
  await maybePruneExpiredAuthRecords();
  const code = randomToken(10).slice(0, 12);
  const expiresAt = new Date(Date.now() + 15 * 60 * 1000);
  await query(
    `
      insert into telegram_link_codes (code, user_id, expires_at)
      values ($1, $2, $3)
    `,
    [code, userId, expiresAt.toISOString()],
  );
  return { code, expiresAt: expiresAt.toISOString() };
}

export async function linkTelegramChat(code, chatId) {
  const result = await query(
    `
      update telegram_link_codes
      set used_at = now()
      where code = $1 and used_at is null and expires_at > now()
      returning user_id
    `,
    [code],
  );
  const userId = result.rows[0]?.user_id;
  if (!userId) return null;
  const userResult = await query(
    `
      update users
      set telegram_chat_id = $2, updated_at = now()
      where id = $1
      returning id, email, name, picture_url, telegram_chat_id, role, created_at, updated_at
    `,
    [userId, String(chatId)],
  );
  return normalizeUser(userResult.rows[0]);
}

export async function userForTelegramChat(chatId) {
  const result = await query(
    `
      select id, email, name, picture_url, telegram_chat_id, role, created_at, updated_at
      from users
      where telegram_chat_id = $1
      limit 1
    `,
    [String(chatId)],
  );
  return result.rows[0] ? normalizeUser(result.rows[0]) : null;
}

export function sessionCookie(session) {
  return cookieHeader(SESSION_COOKIE, session.id, {
    maxAge: Math.max(0, Math.floor((new Date(session.expiresAt).getTime() - Date.now()) / 1000)),
  });
}

export async function exportUserData(userId) {
  const [userResult, trackedResult, observationsResult, runsResult, pinsResult] = await Promise.all([
    query(
      `select id, email, name, picture_url, telegram_chat_id, role, created_at, updated_at
       from users where id = $1`,
      [userId],
    ),
    query(
      `select id, label, query, active, run_time_local, timezone, created_at, updated_at
       from tracked_queries where user_id = $1 order by id`,
      [userId],
    ),
    query(
      `select o.*
       from tracked_query_observations o
       join tracked_queries q on q.id = o.tracked_query_id
       where q.user_id = $1
       order by o.tracked_query_id, o.observation_date`,
      [userId],
    ),
    query(
      `select r.*
       from tracked_query_runs r
       join tracked_queries q on q.id = r.tracked_query_id
       where q.user_id = $1
       order by r.tracked_query_id, r.started_at`,
      [userId],
    ),
    query(
      `select p.id, c.state, c.rto, p.created_at, p.updated_at
       from rto_daily_pins p
       join rto_daily_snapshot_configs c on c.id = p.config_id
       where p.user_id = $1
       order by p.id`,
      [userId],
    ),
  ]);
  const user = userResult.rows[0];
  if (!user) return null;
  return {
    exportedAt: new Date().toISOString(),
    user: normalizeUser(user),
    telegramChatId: user.telegram_chat_id ? String(user.telegram_chat_id) : null,
    trackedQueries: trackedResult.rows,
    trackedQueryObservations: observationsResult.rows,
    trackedQueryRuns: runsResult.rows,
    rtoDailyPins: pinsResult.rows,
  };
}

export async function deleteUserAccount(userId) {
  const result = await query(
    `delete from users where id = $1 returning id, email`,
    [userId],
  );
  return result.rows[0] ?? null;
}

export function telegramDeepLink(code) {
  const username = String(process.env.TELEGRAM_BOT_USERNAME || "").replace(/^@/, "");
  return username ? `https://t.me/${username}?start=${encodeURIComponent(code)}` : null;
}

function randomToken(bytes) {
  return crypto.randomBytes(bytes).toString("base64url");
}

function csrfSecret() {
  const configured = String(process.env.CSRF_SECRET ?? "");
  if (configured.length >= 32) return configured;
  if (process.env.NODE_ENV !== "production") return "development-only-csrf-secret-change-before-production";
  const error = new Error("CSRF_SECRET must contain at least 32 characters in production.");
  error.statusCode = 503;
  throw error;
}

function safeTokenEqual(left, right) {
  const leftBuffer = Buffer.from(String(left));
  const rightBuffer = Buffer.from(String(right));
  return leftBuffer.length === rightBuffer.length && crypto.timingSafeEqual(leftBuffer, rightBuffer);
}

function adminEmails() {
  return new Set(
    String(process.env.ADMIN_EMAILS ?? "")
      .split(",")
      .map((value) => value.trim().toLowerCase())
      .filter(Boolean),
  );
}

async function maybePruneExpiredAuthRecords() {
  const now = Date.now();
  if (now - lastAuthPruneAt < AUTH_PRUNE_INTERVAL_MS) return;
  lastAuthPruneAt = now;
  await pruneExpiredAuthRecordsWithQuery(query);
}

async function pruneExpiredAuthRecordsWithQuery(runQuery) {
  await runQuery(`delete from sessions where expires_at <= now()`);
  await runQuery(`delete from telegram_link_codes where expires_at <= now() or used_at is not null`);
}

function safeReturnTo(value) {
  const text = String(value || "/");
  return text.startsWith("/") && !text.startsWith("//") ? text : "/";
}

function normalizeUser(row) {
  return {
    id: String(row.id),
    email: row.email,
    name: row.name,
    pictureUrl: row.picture_url,
    telegramLinked: Boolean(row.telegram_chat_id),
    role: row.role === "admin" ? "admin" : "user",
    createdAt: row.created_at ? new Date(row.created_at).toISOString() : null,
    updatedAt: row.updated_at ? new Date(row.updated_at).toISOString() : null,
  };
}
