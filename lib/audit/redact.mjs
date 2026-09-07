import os from "node:os";
import path from "node:path";

const ANSI_PATTERN = /\u001b\[[0-?]*[ -/]*[@-~]/g;
const CONTROL_PATTERN = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g;
const CREDENTIAL_URL_PATTERN = /\b(?:postgres(?:ql)?|mysql|mongodb(?:\+srv)?|redis):\/\/[^\s"'<>]+/gi;
const JWT_PATTERN = /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g;
const API_KEY_PATTERNS = [
  /\bAKIA[0-9A-Z]{16}\b/g,
  /\bAIza[0-9A-Za-z_-]{20,}\b/g,
  /\bgh[pousr]_[A-Za-z0-9]{20,}\b/g,
  /\bsk-(?:proj-)?[A-Za-z0-9_-]{16,}\b/g,
  /\bgsk_[A-Za-z0-9_-]{16,}\b/g,
  /\b[0-9]{6,}:[A-Za-z0-9_-]{20,}\b/g,
];
const HEADER_PATTERN = /\b(authorization|proxy-authorization|cookie|set-cookie)\s*[:=]\s*[^\r\n]+/gi;
const ENV_ASSIGNMENT_PATTERN = /\b([A-Z][A-Z0-9_]*(?:TOKEN|KEY|SECRET|PASSWORD|PASSWD|COOKIE|AUTH|DATABASE_URL)[A-Z0-9_]*)\s*=\s*([^\s;]+)/gi;
const SENSITIVE_KEY_PATTERN = /(token|key|secret|password|passwd|cookie|authorization|database[_-]?url|connection[_-]?string)/i;
const SENSITIVE_ENV_NAME_PATTERN = /(token|key|secret|password|passwd|cookie|authorization|database[_-]?url|connection[_-]?string|proxy)/i;

export function createRedactor({ environment = process.env, repoRoot = process.cwd(), homeDirectory = os.homedir() } = {}) {
  const literalSecrets = Object.entries(environment)
    .filter(([name, value]) => SENSITIVE_ENV_NAME_PATTERN.test(name) && typeof value === "string" && value.length >= 6)
    .map(([, value]) => value)
    .sort((left, right) => right.length - left.length);
  const pathMappings = [
    [path.resolve(repoRoot), "<REPO>"],
    [path.resolve(homeDirectory), "<HOME>"],
  ].sort(([left], [right]) => right.length - left.length);

  function redactText(value) {
    let text = String(value ?? "").replace(ANSI_PATTERN, "").replace(CONTROL_PATTERN, "");
    for (const literal of literalSecrets) text = replaceAllInsensitive(text, literal, "[REDACTED]");
    text = text.replace(CREDENTIAL_URL_PATTERN, redactCredentialUrl);
    text = text.replace(JWT_PATTERN, "[REDACTED_JWT]");
    for (const pattern of API_KEY_PATTERNS) text = text.replace(pattern, "[REDACTED_KEY]");
    text = text.replace(HEADER_PATTERN, (_match, header) => `${header}: [REDACTED]`);
    text = text.replace(ENV_ASSIGNMENT_PATTERN, (_match, name) => `${name}=[REDACTED]`);
    text = redactUrlQueries(text);
    for (const [target, replacement] of pathMappings) {
      text = replaceAllInsensitive(text, target, replacement);
      text = replaceAllInsensitive(text, target.replaceAll("\\", "/"), replacement);
    }
    return text;
  }

  function redactObject(value, seen = new WeakSet()) {
    if (typeof value === "string") return redactText(value);
    if (value === null || typeof value !== "object") return value;
    if (seen.has(value)) return "[CIRCULAR]";
    seen.add(value);
    try {
      if (Array.isArray(value)) return value.map((item) => redactObject(item, seen));
      const output = {};
      for (const [key, item] of Object.entries(value)) {
        if (SENSITIVE_KEY_PATTERN.test(key)) {
          const safeBooleanIndicator = /(configured|present)$/i.test(key) && typeof item === "boolean";
          const safeFingerprint = /fingerprint$/i.test(key) && typeof item === "string" && /^[a-f0-9]{8,64}$/i.test(item);
          output[key] = safeBooleanIndicator || safeFingerprint ? item : "[REDACTED]";
        } else {
          output[key] = redactObject(item, seen);
        }
      }
      return output;
    } finally {
      seen.delete(value);
    }
  }

  return Object.freeze({ redactText, redactObject });
}

function redactCredentialUrl(match) {
  try {
    const url = new URL(match);
    url.username = url.username ? "REDACTED" : "";
    url.password = url.password ? "REDACTED" : "";
    url.search = url.search ? "?REDACTED" : "";
    url.hash = "";
    return url.toString();
  } catch {
    return "[REDACTED_CONNECTION_URL]";
  }
}

function redactUrlQueries(text) {
  const absolute = text.replace(/https?:\/\/[^\s"'<>]+/gi, (match) => {
    try {
      const url = new URL(match);
      url.username = url.username ? "REDACTED" : "";
      url.password = url.password ? "REDACTED" : "";
      url.search = url.search ? "?[REDACTED_QUERY]" : "";
      url.hash = "";
      return url.toString();
    } catch {
      return "[REDACTED_URL]";
    }
  });
  return absolute.replace(/(\/[A-Za-z0-9._~!$&'()*+,;=:@%/-]*\?)[^\s"'<>)]*/g, "$1[REDACTED_QUERY]");
}

function replaceAllInsensitive(text, search, replacement) {
  if (!search) return text;
  const escaped = search.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return text.replace(new RegExp(escaped, "gi"), replacement);
}
