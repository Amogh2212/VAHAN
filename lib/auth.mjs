import crypto from "node:crypto";
import process from "node:process";
import { query } from "./db.mjs";

const SESSION_COOKIE = "vahan_session";
const OAUTH_STATE_COOKIE = "vahan_oauth_state";
const SESSION_DAYS = Number(process.env.SESSION_DAYS ?? 30);
const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
const GOOGLE_USERINFO_URL = "https://openidconnect.googleapis.com/v1/userinfo";

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
    output[decodeURIComponent(rawName)] = decodeURIComponent(rawValue.join("=") || "");
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
    const error = new Error(tokenBody.error_description || tokenBody.error || "Google token exchange failed.");
    error.statusCode = 401;
    throw error;
  }

  const userResponse = await fetch(GOOGLE_USERINFO_URL, {
    headers: { authorization: `Bearer ${tokenBody.access_token}` },
  });
  const profile = await userResponse.json().catch(() => ({}));
  if (!userResponse.ok || !profile.sub || !profile.email) {
    const error = new Error("Google profile lookup failed.");
    error.statusCode = 401;
    throw error;
  }
  return profile;
}

export async function upsertGoogleUser(profile) {
  const result = await query(
    `
      insert into users (google_sub, email, name, picture_url)
      values ($1, $2, $3, $4)
      on conflict (google_sub)
      do update set
        email = excluded.email,
        name = excluded.name,
        picture_url = excluded.picture_url,
        updated_at = now()
      returning id, email, name, picture_url, telegram_chat_id, created_at, updated_at
    `,
    [profile.sub, profile.email, profile.name ?? null, profile.picture ?? null],
  );
  return normalizeUser(result.rows[0]);
}

export async function createSession(userId) {
  const id = randomToken(32);
  const expiresAt = new Date(Date.now() + SESSION_DAYS * 24 * 60 * 60 * 1000);
  await query(
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
  const result = await query(
    `
      select u.id, u.email, u.name, u.picture_url, u.telegram_chat_id, u.created_at, u.updated_at
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

export async function createTelegramLinkCode(userId) {
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
      returning id, email, name, picture_url, telegram_chat_id, created_at, updated_at
    `,
    [userId, String(chatId)],
  );
  return normalizeUser(userResult.rows[0]);
}

export async function userForTelegramChat(chatId) {
  const result = await query(
    `
      select id, email, name, picture_url, telegram_chat_id, created_at, updated_at
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

export function telegramDeepLink(code) {
  const username = String(process.env.TELEGRAM_BOT_USERNAME || "").replace(/^@/, "");
  return username ? `https://t.me/${username}?start=${encodeURIComponent(code)}` : null;
}

function randomToken(bytes) {
  return crypto.randomBytes(bytes).toString("base64url");
}

function safeReturnTo(value) {
  const text = String(value || "/");
  return text.startsWith("/") && !text.startsWith("//") ? text : "/";
}

function normalizeUser(row) {
  return {
    id: Number(row.id),
    email: row.email,
    name: row.name,
    pictureUrl: row.picture_url,
    telegramLinked: Boolean(row.telegram_chat_id),
    createdAt: row.created_at ? new Date(row.created_at).toISOString() : null,
    updatedAt: row.updated_at ? new Date(row.updated_at).toISOString() : null,
  };
}
