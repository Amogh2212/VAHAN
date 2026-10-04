import fs from "node:fs/promises";

const ALL_RTO = "All Vahan4 Running Office";

// These audited labels identify the same office, not additional RTOs.
const RTO_LABEL_GROUPS = [
  { state: "Uttar Pradesh", labels: ["Noida - UP16", "Noida - UP16( 13-NOV-2017 )"] },
  { state: "Maharashtra", labels: ["PUNE - MH12", "PUNE - MH12( 25-JAN-2017 )"] },
  { state: "Punjab", labels: ["RTO LUDHIANA - PB10", "RTO LUDHIANA - PB10( 25-JAN-2018 )"] },
  { state: "Uttarakhand", labels: ["HARIDWAR ARTO - UK8", "haridwar"] },
  { state: "Uttarakhand", labels: ["DEHRADUN RTO - UK7", "dehradun"] },
];

export function rtoStorageLabels(state, label) {
  const group = RTO_LABEL_GROUPS.find((item) =>
    (!state || normalizeRtoLookup(state) === normalizeRtoLookup(item.state)) &&
    item.labels.some((value) => normalizeRtoLookup(value) === normalizeRtoLookup(label)));
  return group ? [...group.labels] : [label];
}

export function canonicalRtoLabel(state, label) {
  return rtoStorageLabels(state, label)[0];
}

export function canonicalizeRtoCatalog(catalog, { requireOfficeCode = false } = {}) {
  return {
    ...catalog,
    states: (catalog?.states ?? []).map((group) => {
      const rtos = new Map();
      for (const rto of group.rtos ?? []) {
        if (!rto?.label) continue;
        const label = canonicalRtoLabel(group.state, rto.label);
        if (requireOfficeCode && label !== ALL_RTO &&
          !/\b[a-z]{2}\s*\d{1,3}\s*$/.test(normalizeRtoLookup(label.replace(/\(\s*\d{1,2}-[A-Z]{3}-\d{4}\s*\)/gi, "")))) continue;
        const previous = rtos.get(label);
        rtos.set(label, {
          ...rto,
          ...toCatalogRto(label),
          aliases: uniqueNormalized([
            ...deriveAliases(label), ...(previous?.aliases ?? []),
            ...(rto.aliases ?? []), ...rtoStorageLabels(group.state, rto.label),
          ]),
        });
      }
      return { ...group, rtos: [...rtos.values()].sort((a, b) => a.label.localeCompare(b.label)) };
    }),
  };
}

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
  const canonicalCode = normalized.replace(/\b([a-z]{2})\s*0*(\d{1,3})\b/g, (_match, stateCode, number) =>
    `${stateCode} ${Number(number)}`);
  return CITY_ALIASES.get(canonicalCode) ?? canonicalCode;
}

export async function loadRtoCatalog(filePath) {
  const content = await fs.readFile(filePath, "utf8").catch(() => "");
  if (!content.trim()) return { updated_at: null, states: [] };
  const catalog = JSON.parse(content);
  return canonicalizeRtoCatalog({
    updated_at: catalog.updated_at ?? null,
    states: Array.isArray(catalog.states) ? catalog.states : [],
  }, { requireOfficeCode: true });
}

export function buildRtoCatalogFromRows(rows) {
  const byState = new Map();
  for (const row of rows ?? []) {
    if (!row.state || !row.rto || row.rto === ALL_RTO) continue;
    if (!byState.has(row.state)) byState.set(row.state, new Map());
    const label = canonicalRtoLabel(row.state, row.rto);
    byState.get(row.state).set(label, toCatalogRto(label));
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
  const queryCodes = new Set(queryValues.flatMap((value) => rtoCodes(value)));
  const tied = best.method === "rto-code-exact"
    ? matches.filter((match) =>
      match.score === best.score &&
      rtoCodes(match.normalized).some((code) => queryCodes.has(code)),
    )
    : best.method === "exact"
      ? matches.filter((match) => match.score === best.score)
    : matches.filter((match) => best.score - match.score <= 5);
  const uniqueCandidates = uniqueBy(tied, (match) => {
    if (best.method === "rto-code-exact") {
      const code = rtoCodes(match.normalized).find((value) => queryCodes.has(value));
      if (code) return `${match.state}||${code}`;
    }
    return `${match.state}||${match.label}`;
  });
  const currentCandidates = uniqueBy(uniqueCandidates, (match) => (
    `${match.state}||${normalizeRtoLookup(match.label.replace(/\(\s*\d{1,2}-[A-Z]{3}-\d{4}\s*\)/gi, ""))}`
  ));
  if (currentCandidates.length > 1) {
    return {
      ...filters,
      rto: null,
      rtoSearch: rtoNeedle ?? locationNeedle,
      ambiguousRtos: currentCandidates.map((match) => match.label),
      rtoResolution: {
        status: "ambiguous",
        query: filters.locationText ?? filters.rtoText ?? filters.rto,
        state: filters.state ?? null,
        candidates: currentCandidates.map(({ state, label, score }) => ({ state, label, score })),
      },
    };
  }

  const resolved = currentCandidates[0] ?? best;

  return {
    ...filters,
    state: filters.state ?? resolved.state,
    rto: resolved.label,
    rtoSearch: null,
    unresolvedLocation: null,
    ambiguousRtos: null,
    rtoResolution: {
      status: "resolved",
      query: filters.locationText ?? filters.rtoText ?? filters.rto,
      state: resolved.state,
      rto: resolved.label,
      method: resolved.method,
      score: resolved.score,
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
  const entries = (catalog?.states ?? []).flatMap((stateGroup) =>
    (stateGroup.rtos ?? [])
      .filter((rto) => rto?.label && rto.label !== ALL_RTO)
      .map((rto) => ({
        state: stateGroup.state,
        label: canonicalRtoLabel(stateGroup.state, rto.label),
        normalized: normalizeRtoLookup(canonicalRtoLabel(stateGroup.state, rto.label)),
        aliases: uniqueNormalized([
          ...deriveAliases(canonicalRtoLabel(stateGroup.state, rto.label)),
          ...rtoStorageLabels(stateGroup.state, rto.label),
          ...(rto.aliases ?? []), rto.label,
        ]),
      })),
  );
  return uniqueBy(entries, (entry) => `${entry.state}||${entry.label}`);
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
  const queryCodes = rtoCodes(query);
  if (queryCodes.length && queryCodes.some((code) => rtoCodes(normalized).includes(code))) {
    return { score: 100, method: "rto-code-exact" };
  }
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

function rtoCodes(value) {
  const text = String(value ?? "").toUpperCase();
  // Catalog labels end with the office's code. A code inside a fitness
  // centre's name can refer to another office (MH04 ... - MH203).
  const suffix = text.match(/\b([A-Z]{2})\s*0*(\d{1,3})\s*$/);
  if (suffix) return [`${suffix[1]} ${Number(suffix[2])}`];
  return [...text.matchAll(/\b([A-Z]{2})\s*0*(\d{1,3})\b/g)]
    .map((match) => `${match[1]} ${Number(match[2])}`);
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
