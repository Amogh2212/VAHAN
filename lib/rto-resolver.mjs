import fs from "node:fs/promises";

const ALL_RTO = "All Vahan4 Running Office";

const CITY_ALIASES = new Map([
  ["bangalore", "bengaluru"],
  ["bengluru", "bengaluru"],
  ["mysore", "mysuru"],
  ["gurgaon", "gurugram"],
  ["prayagraj", "allahabad"],
  ["mumabi", "mumbai"],
  ["bombay", "mumbai"],
  ["vizag", "visakhapatnam"],
]);

const STOP_WORDS = new Set([
  "all",
  "vahan4",
  "running",
  "office",
  "rto",
  "regional",
  "transport",
  "authority",
  "dto",
  "arto",
]);

export function normalizeRtoLookup(value) {
  const normalized = String(value ?? "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  const canonicalCode = normalized.replace(/\b([a-z]{2})\s*0*(\d{1,2})\b/g, (_match, stateCode, number) =>
    `${stateCode} ${Number(number)}`);
  return CITY_ALIASES.get(canonicalCode) ?? canonicalCode;
}

export async function loadRtoCatalog(filePath) {
  const content = await fs.readFile(filePath, "utf8").catch(() => "");
  if (!content.trim()) return { updated_at: null, states: [] };
  const catalog = JSON.parse(content);
  return {
    updated_at: catalog.updated_at ?? null,
    states: Array.isArray(catalog.states) ? catalog.states : [],
  };
}

export function buildRtoCatalogFromRows(rows) {
  const byState = new Map();
  for (const row of rows ?? []) {
    if (!row.state || !row.rto || row.rto === ALL_RTO) continue;
    if (!byState.has(row.state)) byState.set(row.state, new Map());
    byState.get(row.state).set(row.rto, toCatalogRto(row.rto));
  }

  return {
    updated_at: null,
    source: "loaded_rows",
    states: [...byState.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([state, rtos]) => ({
        state,
        rtos: [...rtos.values()].sort((a, b) => a.label.localeCompare(b.label)),
      })),
  };
}

export function toCatalogRto(label) {
  const normalized = normalizeRtoLookup(label);
  return {
    label,
    normalized,
    aliases: deriveAliases(label),
  };
}

export function deriveAliases(label) {
  const normalized = normalizeRtoLookup(label);
  const aliases = new Set([normalized]);
  const parts = normalized.split(" ").filter(Boolean);
  const words = parts.filter((part) => !STOP_WORDS.has(part) && !/^\d+$/.test(part));

  for (const word of words) {
    if (word.length >= 4) aliases.add(word);
  }

  for (let index = 0; index < words.length - 1; index += 1) {
    aliases.add(`${words[index]} ${words[index + 1]}`);
  }

  return [...aliases].filter(Boolean).sort();
}

export function resolveRtoWithCatalog(filters, catalog, rows = []) {
  const rtoNeedle = filters.rto ?? filters.rtoSearch ?? filters.rtoText;
  const locationNeedle = filters.locationText;
  const queryValues = uniqueNormalized([rtoNeedle, locationNeedle]);

  if (!queryValues.length) {
    return { ...filters, rto: null, rtoResolution: { status: "none" } };
  }

  if (queryValues.includes(normalizeRtoLookup(ALL_RTO))) {
    return {
      ...filters,
      rto: ALL_RTO,
      rtoSearch: null,
      unresolvedLocation: null,
      rtoResolution: { status: "resolved", rto: ALL_RTO, method: "all-rtos" },
    };
  }

  const entries = flattenCatalog(catalog).length
    ? flattenCatalog(catalog)
    : flattenCatalog(buildRtoCatalogFromRows(rows));
  const scopedEntries = filters.state
    ? entries.filter((entry) => normalizeRtoLookup(entry.state) === normalizeRtoLookup(filters.state))
    : entries;

  const matches = rankEntries(scopedEntries, queryValues);
  if (!matches.length) {
    const unresolvedLocation = filters.locationText ?? filters.rtoText ?? filters.rto ?? filters.rtoSearch;
    return {
      ...filters,
      rto: null,
      rtoSearch: rtoNeedle ?? locationNeedle,
      unresolvedLocation,
      rtoResolution: {
        status: "unresolved",
        query: unresolvedLocation,
        state: filters.state ?? null,
      },
    };
  }

  const [best] = matches;
  const tied = matches.filter((match) => best.score - match.score <= 5);
  const uniqueCandidates = uniqueBy(tied, (match) => `${match.state}||${match.label}`);
  if (uniqueCandidates.length > 1) {
    return {
      ...filters,
      rto: null,
      rtoSearch: rtoNeedle ?? locationNeedle,
      ambiguousRtos: uniqueCandidates.map((match) => match.label),
      rtoResolution: {
        status: "ambiguous",
        query: filters.locationText ?? filters.rtoText ?? filters.rto,
        state: filters.state ?? null,
        candidates: uniqueCandidates.map(({ state, label, score }) => ({ state, label, score })),
      },
    };
  }

  return {
    ...filters,
    state: filters.state ?? best.state,
    rto: best.label,
    rtoSearch: null,
    unresolvedLocation: null,
    ambiguousRtos: null,
    rtoResolution: {
      status: "resolved",
      query: filters.locationText ?? filters.rtoText ?? filters.rto,
      state: best.state,
      rto: best.label,
      method: best.method,
      score: best.score,
    },
  };
}

export function searchRtoCatalog(catalog, query, { state = null, limit = 20 } = {}) {
  const normalizedState = normalizeRtoLookup(state);
  const entries = flattenCatalog(catalog)
    .filter((entry) => !normalizedState || normalizeRtoLookup(entry.state) === normalizedState);
  const queryValues = uniqueNormalized([query]);
  const matches = queryValues.length
    ? rankEntries(entries, queryValues)
    : entries
      .map((entry) => ({ ...entry, score: 0, method: "catalog" }))
      .sort((left, right) => left.state.localeCompare(right.state) || left.label.localeCompare(right.label));
  return matches.slice(0, Math.max(1, Math.min(Number(limit) || 20, 50))).map((entry) => ({
    state: entry.state,
    rto: entry.label,
    score: entry.score,
    method: entry.method,
  }));
}

function flattenCatalog(catalog) {
  return (catalog?.states ?? []).flatMap((stateGroup) =>
    (stateGroup.rtos ?? [])
      .filter((rto) => rto?.label && rto.label !== ALL_RTO)
      .map((rto) => ({
        state: stateGroup.state,
        label: rto.label,
        normalized: rto.normalized ?? normalizeRtoLookup(rto.label),
        aliases: uniqueNormalized([...(rto.aliases ?? []), rto.label]),
      })),
  );
}

function rankEntries(entries, queryValues) {
  return entries
    .map((entry) => {
      let best = { score: 0, method: "none" };
      for (const query of queryValues) {
        best = maxScore(best, scoreEntry(entry, query));
      }
      return { ...entry, ...best };
    })
    .filter((entry) => entry.score >= 60)
    .sort((a, b) => b.score - a.score || a.label.localeCompare(b.label));
}

function scoreEntry(entry, query) {
  const normalized = normalizeRtoLookup(entry.normalized);
  const aliases = uniqueNormalized(entry.aliases ?? []).filter((alias) => alias !== normalized);
  if (normalized === query) return { score: 100, method: "exact" };
  if (normalized.startsWith(query)) return { score: 96, method: "label-prefix" };
  if (aliases.some((alias) => alias === query)) return { score: 92, method: "alias-exact" };
  if (aliases.some((alias) => alias.startsWith(query))) return { score: 88, method: "prefix" };
  if (normalized.includes(query)) return { score: 86, method: "label-substring" };
  if (aliases.some((alias) => alias.includes(query))) return { score: 82, method: "substring" };
  if ([normalized, ...aliases].some((alias) => query.includes(alias) && alias.length >= 4)) return { score: 78, method: "query-substring" };

  const queryWords = query.split(" ").filter((word) => word.length >= 4);
  for (const queryWord of queryWords) {
    for (const alias of [normalized, ...aliases]) {
      const aliasWords = alias.split(" ").filter((word) => word.length >= 4);
      if (aliasWords.some((word) => editDistanceWithin(queryWord, word, 2) <= 2)) {
        return { score: 68, method: "fuzzy" };
      }
    }
  }

  return { score: 0, method: "none" };
}

function maxScore(left, right) {
  return right.score > left.score ? right : left;
}

function uniqueNormalized(values) {
  return [...new Set((values ?? []).map(normalizeRtoLookup).filter(Boolean))];
}

function uniqueBy(items, keyFn) {
  const seen = new Set();
  const result = [];
  for (const item of items) {
    const key = keyFn(item);
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(item);
  }
  return result;
}

function editDistanceWithin(a, b, maxDistance) {
  if (Math.abs(a.length - b.length) > maxDistance) return maxDistance + 1;
  const previous = Array.from({ length: b.length + 1 }, (_, index) => index);
  for (let i = 1; i <= a.length; i += 1) {
    let diagonal = previous[0];
    previous[0] = i;
    let rowBest = previous[0];
    for (let j = 1; j <= b.length; j += 1) {
      const above = previous[j];
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      previous[j] = Math.min(previous[j] + 1, previous[j - 1] + 1, diagonal + cost);
      diagonal = above;
      rowBest = Math.min(rowBest, previous[j]);
    }
    if (rowBest > maxDistance) return maxDistance + 1;
  }
  return previous[b.length];
}
