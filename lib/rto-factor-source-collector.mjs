import crypto from "node:crypto";

import { prepareRtoFactorSource } from "./rto-factor-events.mjs";

export const RTO_FACTOR_SOURCE_REGISTRY_VERSION = 1;
export const RTO_FACTOR_SOURCE_COLLECTION_VERSION = 1;

const SOURCE_PARSERS = new Set(["html_links", "html_cards", "html_table_rows", "rss"]);
const MAX_SOURCES = 50;
const MAX_CANDIDATES_PER_SOURCE = 50;
const MAX_FETCH_BYTES = 8_000_000;
const MAX_REDIRECTS = 3;
const DEFAULT_TIMEOUT_MS = 15_000;
const DEFAULT_USER_AGENT = "VahanEY-RtoFactorSourceCollector/1.0 (+local-review-only)";
const REGISTRY_KEYS = new Set(["schemaVersion", "sources"]);
const SOURCE_CONFIG_KEYS = new Set([
  "id",
  "sourceKey",
  "publisher",
  "sourceTier",
  "sourceType",
  "canonicalHost",
  "allowedHosts",
  "evidencePolicy",
  "notes",
  "discoveryUrl",
  "parser",
  "itemPathPrefixes",
  "titleKeywords",
  "requirePublishedAt",
  "maxCandidates",
  "enabled",
]);

/**
 * Validates the explicitly allowlisted discovery sources. The collector deliberately
 * does not accept arbitrary URLs at runtime: every request originates from this
 * reviewed registry and every discovered item must stay on the same HTTPS host.
 */
export function compileRtoFactorSourceRegistry(input = {}) {
  const root = plainObject(input, "registry");
  assertAllowedKeys(root, REGISTRY_KEYS, "registry");
  if (root.schemaVersion !== RTO_FACTOR_SOURCE_REGISTRY_VERSION) {
    throw inputError(`registry.schemaVersion must equal ${RTO_FACTOR_SOURCE_REGISTRY_VERSION}`);
  }
  if (!Array.isArray(root.sources) || root.sources.length === 0 || root.sources.length > MAX_SOURCES) {
    throw inputError(`registry.sources must contain between 1 and ${MAX_SOURCES} sources`);
  }

  const sources = root.sources.map((value, index) => compileSource(value, index));
  assertUnique(sources.map((source) => source.id), "source id");
  assertUnique(sources.map((source) => source.sourceKey), "sourceKey");
  return {
    schemaVersion: RTO_FACTOR_SOURCE_REGISTRY_VERSION,
    sources,
  };
}

function compileSource(value, index) {
  const sourceConfig = plainObject(value, `registry.sources[${index}]`);
  assertAllowedKeys(sourceConfig, SOURCE_CONFIG_KEYS, `registry.sources[${index}]`);
  const id = slug(sourceConfig.id, `registry.sources[${index}].id`);
  const parser = enumValue(sourceConfig.parser, SOURCE_PARSERS, `registry.sources[${index}].parser`);
  const source = prepareRtoFactorSource({
    sourceKey: sourceConfig.sourceKey,
    publisher: sourceConfig.publisher,
    sourceTier: sourceConfig.sourceTier,
    sourceType: sourceConfig.sourceType,
    canonicalHost: sourceConfig.canonicalHost,
    evidencePolicy: sourceConfig.evidencePolicy,
    intakeMethod: "curated_import",
    notes: sourceConfig.notes,
    createdByLabel: "rto-factor-source-collector",
  });
  const allowedHosts = normalizedHosts(
    [source.canonicalHost, ...(sourceConfig.allowedHosts ?? [])],
    `registry.sources[${index}].allowedHosts`,
  );
  const discoveryUrl = approvedUrl(
    sourceConfig.discoveryUrl,
    allowedHosts,
    `registry.sources[${index}].discoveryUrl`,
  );
  const itemPathPrefixes = normalizedPathPrefixes(
    sourceConfig.itemPathPrefixes,
    `registry.sources[${index}].itemPathPrefixes`,
  );
  const titleKeywords = normalizedKeywords(
    sourceConfig.titleKeywords,
    `registry.sources[${index}].titleKeywords`,
  );
  const maxCandidates = boundedInteger(
    sourceConfig.maxCandidates ?? 20,
    `registry.sources[${index}].maxCandidates`,
    1,
    MAX_CANDIDATES_PER_SOURCE,
  );
  if (sourceConfig.enabled !== undefined && typeof sourceConfig.enabled !== "boolean") {
    throw inputError(`registry.sources[${index}].enabled must be true or false`);
  }
  if (sourceConfig.requirePublishedAt !== undefined && typeof sourceConfig.requirePublishedAt !== "boolean") {
    throw inputError(`registry.sources[${index}].requirePublishedAt must be true or false`);
  }
  return {
    id,
    sourceKey: source.sourceKey,
    publisher: source.publisher,
    sourceTier: source.sourceTier,
    sourceType: source.sourceType,
    canonicalHost: source.canonicalHost,
    allowedHosts,
    evidencePolicy: source.evidencePolicy,
    notes: source.notes,
    discoveryUrl,
    parser,
    itemPathPrefixes,
    titleKeywords,
    requirePublishedAt: sourceConfig.requirePublishedAt === true,
    maxCandidates,
    enabled: sourceConfig.enabled !== false,
  };
}

/**
 * Fetches only approved discovery pages and returns a review queue. It never writes
 * to Postgres, creates factor events, changes the VAHAN queue, or marks evidence
 * approved. A human must still validate dates, excerpts, geography, and the event
 * hypothesis before using the existing event importer.
 */
export async function collectRtoFactorSourceCandidates(registry, {
  sourceIds = [],
  limit = null,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  fetchImpl = globalThis.fetch,
  now = () => new Date(),
  userAgent = DEFAULT_USER_AGENT,
} = {}) {
  const compiled = registry?.sources ? registry : compileRtoFactorSourceRegistry(registry);
  if (typeof fetchImpl !== "function") throw inputError("fetch implementation is required");
  const selectedIds = normalizedSourceIds(sourceIds);
  const selected = compiled.sources.filter((source) => selectedIds.length === 0 || selectedIds.includes(source.id));
  const unknown = selectedIds.filter((id) => !compiled.sources.some((source) => source.id === id));
  if (unknown.length) throw inputError(`Unknown source id(s): ${unknown.join(", ")}`);
  const perSourceLimit = limit === null || limit === undefined
    ? null
    : boundedInteger(limit, "limit", 1, MAX_CANDIDATES_PER_SOURCE);
  const boundedTimeoutMs = boundedInteger(timeoutMs, "timeoutMs", 1_000, 60_000);
  const collectedAt = isoDate(now(), "now");
  const sources = [];

  for (const source of selected) {
    if (!source.enabled) {
      sources.push({
        sourceId: source.id,
        sourceKey: source.sourceKey,
        status: "skipped_disabled",
        discoveryUrl: source.discoveryUrl,
        candidates: [],
      });
      continue;
    }

    try {
      const fetched = await fetchApprovedSourceText(source, {
        fetchImpl,
        timeoutMs: boundedTimeoutMs,
        userAgent,
      });
      const candidateLimit = Math.min(source.maxCandidates, perSourceLimit ?? source.maxCandidates);
      const candidates = extractCandidates(fetched.body, {
        source,
        baseUrl: fetched.url,
        retrievedAt: collectedAt,
        limit: candidateLimit,
      });
      sources.push({
        sourceId: source.id,
        sourceKey: source.sourceKey,
        status: "collected",
        discoveryUrl: source.discoveryUrl,
        retrievedUrl: fetched.url,
        retrievedAt: collectedAt,
        contentSha256: sha256(fetched.body),
        candidates,
      });
    } catch (error) {
      sources.push({
        sourceId: source.id,
        sourceKey: source.sourceKey,
        status: "failed",
        discoveryUrl: source.discoveryUrl,
        error: safeErrorMessage(error),
        candidates: [],
      });
    }
  }

  const candidates = sources.flatMap((source) => source.candidates);
  return {
    kind: "rto-factor-source-review-queue",
    schemaVersion: RTO_FACTOR_SOURCE_COLLECTION_VERSION,
    collectedAt,
    reviewRequired: true,
    databaseWrites: false,
    sourceCount: sources.length,
    candidateCount: candidates.length,
    failedSourceCount: sources.filter((source) => source.status === "failed").length,
    sources,
    candidates,
    nextSteps: [
      "Open each candidate at its cited URL and verify the underlying document, date, geography, and quoted evidence.",
      "Create a manual factor-event intake only for a real, relevant event; do not infer a causal claim from the title or discovery snippet.",
      "Use rto-factor:event:import in dry-run mode before enabling its draft-only write gate.",
    ],
  };
}

export function extractHtmlLinkCandidates(html, {
  source,
  baseUrl = source?.discoveryUrl,
  retrievedAt = new Date().toISOString(),
  limit = source?.maxCandidates ?? 20,
} = {}) {
  const text = String(html ?? "");
  const candidates = [];
  const seen = new Set();
  const anchorPattern = /<a\b([^>]*)>([\s\S]*?)<\/a\s*>/gi;
  let match;
  while ((match = anchorPattern.exec(text)) && candidates.length < limit) {
    const href = attributeValue(match[1], "href");
    const title = cleanText(match[2]);
    const canonicalUrl = candidateUrl(href, baseUrl, source);
    const publishedAt = dateFromText(`${title} ${cleanText(text.slice(anchorPattern.lastIndex, anchorPattern.lastIndex + 300))}`);
    if (!canonicalUrl || !title || !titleMatches(title, source.titleKeywords) || !hasRequiredDate(source, publishedAt)) continue;
    if (seen.has(canonicalUrl)) continue;
    seen.add(canonicalUrl);
    candidates.push(buildCandidate({
      source,
      canonicalUrl,
      title,
      publishedAt,
      discoverySnippet: null,
      retrievedAt,
    }));
  }
  return candidates;
}

/**
 * Extracts a title from a nearby heading and the first approved document link
 * after it. This fits sites whose cards use a heading plus a separate "View"
 * anchor, such as press-release listing pages.
 */
export function extractHtmlCardCandidates(html, {
  source,
  baseUrl = source?.discoveryUrl,
  retrievedAt = new Date().toISOString(),
  limit = source?.maxCandidates ?? 20,
} = {}) {
  const text = String(html ?? "");
  const candidates = [];
  const seen = new Set();
  const headingPattern = /<h([1-6])\b[^>]*>([\s\S]*?)<\/h\1\s*>([\s\S]{0,6000}?)(?=<h[1-6]\b|$)/gi;
  let match;
  while ((match = headingPattern.exec(text)) && candidates.length < limit) {
    const title = cleanText(match[2]);
    const link = firstApprovedAnchor(match[3], baseUrl, source);
    const publishedAt = dateFromText(`${cleanText(text.slice(Math.max(0, match.index - 350), match.index))} ${title} ${cleanText(match[3])}`);
    if (!title || !link || !titleMatches(title, source.titleKeywords) || !hasRequiredDate(source, publishedAt)) continue;
    if (seen.has(link)) continue;
    seen.add(link);
    candidates.push(buildCandidate({
      source,
      canonicalUrl: link,
      title,
      publishedAt,
      discoverySnippet: truncate(cleanText(match[3]), 1_000),
      retrievedAt,
    }));
  }
  return candidates;
}

/**
 * Extracts rows from official tabular notice pages. The title is the longest
 * relevant cell, the source date is a hint only, and the linked document stays
 * subject to human review.
 */
export function extractHtmlTableRowCandidates(html, {
  source,
  baseUrl = source?.discoveryUrl,
  retrievedAt = new Date().toISOString(),
  limit = source?.maxCandidates ?? 20,
} = {}) {
  const text = String(html ?? "");
  const candidates = [];
  const seen = new Set();
  const rowPattern = /<tr\b[^>]*>([\s\S]*?)<\/tr\s*>/gi;
  let match;
  while ((match = rowPattern.exec(text)) && candidates.length < limit) {
    const row = match[1];
    const cells = [...row.matchAll(/<t[dh]\b[^>]*>([\s\S]*?)<\/t[dh]\s*>/gi)]
      .map((cell) => cleanText(cell[1]))
      .filter(Boolean);
    const title = [...cells]
      .filter((cell) => titleMatches(cell, source.titleKeywords))
      .sort((left, right) => right.length - left.length)[0] ?? "";
    const canonicalUrl = firstApprovedAnchor(row, baseUrl, source);
    const publishedAt = dateFromText(cells.join(" "));
    if (!title || !canonicalUrl || !hasRequiredDate(source, publishedAt)) continue;
    if (seen.has(canonicalUrl)) continue;
    seen.add(canonicalUrl);
    candidates.push(buildCandidate({
      source,
      canonicalUrl,
      title,
      publishedAt,
      discoverySnippet: truncate(cells.join(" — "), 1_000),
      retrievedAt,
    }));
  }
  return candidates;
}

export function extractRssCandidates(xml, {
  source,
  retrievedAt = new Date().toISOString(),
  limit = source?.maxCandidates ?? 20,
} = {}) {
  const text = String(xml ?? "");
  const candidates = [];
  const seen = new Set();
  const itemPattern = /<item\b[^>]*>([\s\S]*?)<\/item\s*>/gi;
  let match;
  while ((match = itemPattern.exec(text)) && candidates.length < limit) {
    const item = match[1];
    const title = cleanText(xmlTag(item, "title"));
    const canonicalUrl = candidateUrl(xmlTag(item, "link") || xmlTag(item, "guid"), source.discoveryUrl, source);
    const publishedAt = isoDateOrNull(xmlTag(item, "pubDate") || xmlTag(item, "published"));
    if (!canonicalUrl || !title || !titleMatches(title, source.titleKeywords) || !hasRequiredDate(source, publishedAt)) continue;
    if (seen.has(canonicalUrl)) continue;
    seen.add(canonicalUrl);
    candidates.push(buildCandidate({
      source,
      canonicalUrl,
      title,
      publishedAt,
      discoverySnippet: truncate(cleanText(xmlTag(item, "description") || xmlTag(item, "summary")), 1_000),
      retrievedAt,
    }));
  }
  return candidates;
}

function extractCandidates(body, options) {
  const parser = options.source.parser;
  if (parser === "rss") return extractRssCandidates(body, options);
  if (parser === "html_cards") return extractHtmlCardCandidates(body, options);
  if (parser === "html_table_rows") return extractHtmlTableRowCandidates(body, options);
  return extractHtmlLinkCandidates(body, options);
}

function buildCandidate({ source, canonicalUrl, title, publishedAt, discoverySnippet, retrievedAt }) {
  const candidateId = sha256(JSON.stringify({ sourceKey: source.sourceKey, canonicalUrl, title })).slice(0, 24);
  return {
    candidateId,
    reviewStatus: "pending_review",
    source: {
      sourceKey: source.sourceKey,
      publisher: source.publisher,
      sourceTier: source.sourceTier,
      sourceType: source.sourceType,
      canonicalHost: source.canonicalHost,
      evidencePolicy: source.evidencePolicy,
    },
    document: {
      canonicalUrl,
      title,
      publishedAt,
      discoverySnippet: discoverySnippet || null,
    },
    discoveredAt: retrievedAt,
    reviewNote: "Discovery only. Verify the original source, date, geography, and exact evidence before making a factor-event intake.",
  };
}

async function fetchApprovedSourceText(source, { fetchImpl, timeoutMs, userAgent }) {
  let currentUrl = source.discoveryUrl;
  for (let redirectCount = 0; redirectCount <= MAX_REDIRECTS; redirectCount += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetchImpl(currentUrl, {
        method: "GET",
        redirect: "manual",
        signal: controller.signal,
        headers: {
          Accept: source.parser === "rss"
            ? "application/rss+xml, application/xml, text/xml;q=0.9, text/plain;q=0.5"
            : "text/html, application/xhtml+xml;q=0.9",
          "User-Agent": userAgent,
        },
      });
      const status = Number(response?.status ?? 0);
      if (status >= 300 && status < 400) {
        const location = response?.headers?.get?.("location");
        if (!location) throw new Error(`Source redirected without a location (${status})`);
        currentUrl = approvedUrl(new URL(location, currentUrl).toString(), source.allowedHosts ?? [source.canonicalHost], "redirect");
        continue;
      }
      if (!response?.ok) throw new Error(`Source returned HTTP ${status || "unknown"}`);
      const length = Number(response?.headers?.get?.("content-length"));
      if (Number.isFinite(length) && length > MAX_FETCH_BYTES) {
        throw new Error(`Source response exceeds ${MAX_FETCH_BYTES} bytes`);
      }
      const body = await response.text();
      if (Buffer.byteLength(body, "utf8") > MAX_FETCH_BYTES) {
        throw new Error(`Source response exceeds ${MAX_FETCH_BYTES} bytes`);
      }
      return { url: currentUrl, body };
    } finally {
      clearTimeout(timeout);
    }
  }
  throw new Error(`Source exceeded ${MAX_REDIRECTS} same-host redirects`);
}

function candidateUrl(value, baseUrl, source) {
  if (!value || !baseUrl || !source) return null;
  let url;
  try {
    url = new URL(String(value).trim(), baseUrl);
  } catch {
    return null;
  }
  if (url.protocol !== "https:" || url.username || url.password) return null;
  const host = url.hostname.toLowerCase().replace(/\.$/, "");
  if (!(source.allowedHosts ?? [source.canonicalHost]).includes(host)) return null;
  if (host !== source.canonicalHost) url.hostname = source.canonicalHost;
  if (!source.itemPathPrefixes.some((prefix) => url.pathname.startsWith(prefix))) return null;
  url.hash = "";
  for (const key of [...url.searchParams.keys()]) {
    if (/^utm_/i.test(key) || /^(fbclid|gclid)$/i.test(key)) url.searchParams.delete(key);
  }
  return url.toString();
}

function firstApprovedAnchor(html, baseUrl, source) {
  const anchorPattern = /<a\b([^>]*)>([\s\S]*?)<\/a\s*>/gi;
  let match;
  while ((match = anchorPattern.exec(String(html ?? "")))) {
    const canonicalUrl = candidateUrl(attributeValue(match[1], "href"), baseUrl, source);
    if (canonicalUrl) return canonicalUrl;
  }
  return null;
}

function approvedUrl(value, expectedHosts, label) {
  let url;
  try {
    url = new URL(String(value ?? "").trim());
  } catch {
    throw inputError(`${label} must be a valid HTTPS URL`);
  }
  const host = url.hostname.toLowerCase().replace(/\.$/, "");
  const hosts = Array.isArray(expectedHosts) ? expectedHosts : [expectedHosts];
  if (url.protocol !== "https:" || url.username || url.password || !hosts.includes(host)) {
    throw inputError(`${label} must be HTTPS on ${hosts.join(" or ")}`);
  }
  url.hash = "";
  return url.toString();
}

function normalizedHosts(value, label) {
  if (!Array.isArray(value) || value.length === 0 || value.length > 10) {
    throw inputError(`${label} must contain between 1 and 10 hosts`);
  }
  const hosts = value.map((item, index) => {
    const host = String(item ?? "").trim().toLowerCase().replace(/\.$/, "");
    if (!/^[a-z0-9][a-z0-9.-]*[a-z0-9]$/.test(host)) {
      throw inputError(`${label}[${index}] must be a valid hostname`);
    }
    return host;
  });
  return [...new Set(hosts)];
}

function normalizedPathPrefixes(value, label) {
  if (!Array.isArray(value) || value.length === 0 || value.length > 20) {
    throw inputError(`${label} must be a non-empty array of URL path prefixes`);
  }
  const prefixes = value.map((item, index) => {
    const text = String(item ?? "").trim();
    if (!text.startsWith("/") || text.includes("://") || text.includes("?") || text.includes("#")) {
      throw inputError(`${label}[${index}] must be a URL path prefix beginning with /`);
    }
    return text;
  });
  return [...new Set(prefixes)];
}

function normalizedKeywords(value, label) {
  if (!Array.isArray(value) || value.length === 0 || value.length > 30) {
    throw inputError(`${label} must be a non-empty array of title keywords`);
  }
  const keywords = value.map((item, index) => {
    const text = String(item ?? "").trim().toLowerCase();
    if (text.length < 2 || text.length > 80) throw inputError(`${label}[${index}] must be 2 to 80 characters`);
    return text;
  });
  return [...new Set(keywords)];
}

function normalizedSourceIds(value) {
  const items = Array.isArray(value) ? value : value === null || value === undefined ? [] : [value];
  return [...new Set(items.map((item) => slug(item, "source id")))];
}

function titleMatches(title, keywords) {
  const normalized = title.toLowerCase();
  return keywords.some((keyword) => {
    if (!/^[a-z0-9]+$/i.test(keyword)) return normalized.includes(keyword);
    return new RegExp(`(^|[^a-z0-9])${escapeRegExp(keyword)}($|[^a-z0-9])`, "i").test(normalized);
  });
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function hasRequiredDate(source, publishedAt) {
  return !source?.requirePublishedAt || Boolean(publishedAt);
}

function dateFromText(value) {
  const text = cleanText(value);
  const isoMatch = text.match(/\b(20\d{2})-(\d{2})-(\d{2})\b/);
  if (isoMatch) return safeUtcDate(isoMatch[1], isoMatch[2], isoMatch[3]);
  const match = text.match(/\b(\d{1,2})(?:st|nd|rd|th)?\s*(?:-|\s|,)\s*(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)(?:\s|-|,)*(20\d{2})\b/i);
  if (!match) return null;
  const months = {
    jan: 1, january: 1, feb: 2, february: 2, mar: 3, march: 3, apr: 4, april: 4,
    may: 5, jun: 6, june: 6, jul: 7, july: 7, aug: 8, august: 8, sep: 9,
    sept: 9, september: 9, oct: 10, october: 10, nov: 11, november: 11, dec: 12, december: 12,
  };
  return safeUtcDate(match[3], months[match[2].toLowerCase()], match[1]);
}

function safeUtcDate(year, month, day) {
  const date = new Date(Date.UTC(Number(year), Number(month) - 1, Number(day)));
  if (date.getUTCFullYear() !== Number(year) || date.getUTCMonth() !== Number(month) - 1 || date.getUTCDate() !== Number(day)) {
    return null;
  }
  return date.toISOString();
}

function xmlTag(input, tag) {
  const escaped = tag.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = String(input ?? "").match(new RegExp(`<${escaped}\\b[^>]*>([\\s\\S]*?)<\\/${escaped}\\s*>`, "i"));
  return match ? match[1].replace(/^\s*<!\[CDATA\[([\s\S]*?)\]\]>\s*$/i, "$1") : "";
}

function attributeValue(attributes, name) {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = String(attributes ?? "").match(new RegExp(`\\b${escaped}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, "i"));
  return match ? match[1] ?? match[2] ?? match[3] ?? "" : "";
}

function cleanText(value) {
  return decodeHtml(String(value ?? "")
    .replace(/<[^>]*>/g, " ")
    .replace(/\s+/g, " ")
    .trim());
}

function decodeHtml(value) {
  return value
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">");
}

function isoDateOrNull(value) {
  const date = new Date(String(value ?? "").trim());
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function isoDate(value, label) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) throw inputError(`${label} must be a valid date`);
  return date.toISOString();
}

function sha256(value) {
  return crypto.createHash("sha256").update(String(value)).digest("hex");
}

function truncate(value, limit) {
  const text = String(value ?? "");
  if (text.length <= limit) return text || null;
  return `${text.slice(0, Math.max(0, limit - 1)).trimEnd()}…`;
}

function safeErrorMessage(error) {
  const message = String(error?.message ?? error ?? "Collection failed")
    .replace(/[\r\n\t]+/g, " ")
    .trim();
  return truncate(message, 500) || "Collection failed";
}

function assertAllowedKeys(value, allowed, label) {
  const unknown = Object.keys(value).filter((key) => !allowed.has(key));
  if (unknown.length) throw inputError(`${label} contains unknown field(s): ${unknown.join(", ")}`);
}

function plainObject(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw inputError(`${label} must be an object`);
  return value;
}

function assertUnique(values, label) {
  const duplicates = values.filter((value, index) => values.indexOf(value) !== index);
  if (duplicates.length) throw inputError(`${label} values must be unique: ${[...new Set(duplicates)].join(", ")}`);
}

function boundedInteger(value, label, minimum, maximum) {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < minimum || number > maximum) {
    throw inputError(`${label} must be an integer between ${minimum} and ${maximum}`);
  }
  return number;
}

function slug(value, label) {
  const text = String(value ?? "").trim().toLowerCase();
  if (!/^[a-z0-9][a-z0-9._-]{2,80}$/.test(text)) {
    throw inputError(`${label} must use lowercase letters, numbers, dot, underscore, and hyphen only`);
  }
  return text;
}

function enumValue(value, allowed, label) {
  const text = String(value ?? "").trim();
  if (!allowed.has(text)) throw inputError(`${label} is invalid`);
  return text;
}

function inputError(message) {
  const error = new Error(message);
  error.statusCode = 400;
  return error;
}
