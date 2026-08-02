import { query, transaction } from "./db.mjs";

export const RTO_INSIGHT_DEFAULT_RADIUS_KM = 10;
export const RTO_INSIGHT_RADIUS_OPTIONS = [5, 10, 25];
export const RTO_INSIGHT_PROVIDER_OSM = "openstreetmap";

export const OSM_SIGNAL_DEFINITIONS = [
  {
    key: "ev_charging_station_count",
    group: "ev_infrastructure",
    label: "EV charging stations",
    unit: "count",
    tags: [{ amenity: "charging_station" }],
    summary: "count",
    confidenceScore: 0.72,
  },
  {
    key: "public_charging_station_count",
    group: "ev_infrastructure",
    label: "Likely public chargers",
    unit: "count",
    tags: [{ amenity: "charging_station" }],
    summary: "public-count",
    confidenceScore: 0.62,
  },
  {
    key: "charger_capacity_sum",
    group: "ev_infrastructure",
    label: "Tagged charger capacity",
    unit: "slots",
    tags: [{ amenity: "charging_station" }],
    summary: "capacity",
    confidenceScore: 0.54,
  },
  {
    key: "restaurant_count",
    group: "consumption_proxy",
    label: "Restaurants",
    unit: "count",
    tags: [{ amenity: "restaurant" }],
    summary: "count",
    confidenceScore: 0.66,
  },
  {
    key: "cafe_count",
    group: "consumption_proxy",
    label: "Cafes",
    unit: "count",
    tags: [{ amenity: "cafe" }],
    summary: "count",
    confidenceScore: 0.62,
  },
  {
    key: "hotel_count",
    group: "consumption_proxy",
    label: "Hotels",
    unit: "count",
    tags: [{ tourism: "hotel" }],
    summary: "count",
    confidenceScore: 0.64,
  },
  {
    key: "retail_mall_count",
    group: "consumption_proxy",
    label: "Malls and department stores",
    unit: "count",
    tags: [{ shop: "mall" }, { shop: "department_store" }],
    summary: "count",
    confidenceScore: 0.6,
  },
  {
    key: "bank_atm_count",
    group: "consumption_proxy",
    label: "Banks and ATMs",
    unit: "count",
    tags: [{ amenity: "bank" }, { amenity: "atm" }],
    summary: "count",
    confidenceScore: 0.58,
  },
  {
    key: "vehicle_dealer_service_count",
    group: "auto_ecosystem",
    label: "Vehicle dealers and service",
    unit: "count",
    tags: [{ shop: "car" }, { shop: "car_repair" }, { shop: "motorcycle" }],
    summary: "count",
    confidenceScore: 0.58,
  },
];

const OSM_SIGNAL_BY_KEY = new Map(OSM_SIGNAL_DEFINITIONS.map((definition) => [definition.key, definition]));

export function parseRtoCode(value = "") {
  const text = String(value ?? "").toUpperCase();
  const compact = text.match(/\b([A-Z]{2})\s*[- ]?\s*(\d{1,3})\b/);
  return compact ? `${compact[1]}-${compact[2]}` : null;
}

export function placeLabelFromRto(value = "") {
  return String(value ?? "")
    .replace(/\([^)]*\)/g, " ")
    .replace(/\b[A-Z]{2}\s*[- ]?\s*\d{1,3}\b/gi, " ")
    .replace(/\b(RTO|ARTO|DTO|MVI|REGIONAL|TRANSPORT|OFFICE)\b/gi, " ")
    .replace(/\s*-\s*/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function geocodeQueriesForRto({ state, rto } = {}) {
  const code = parseRtoCode(rto);
  const place = placeLabelFromRto(rto);
  return uniqueStrings([
    code ? `${code} RTO ${state} India` : null,
    place ? `${place} RTO ${state} India` : null,
    place ? `${place} ${state} India` : null,
    String(rto ?? "").trim() ? `${rto} ${state} India` : null,
  ]);
}

export function buildOverpassQuery({ signalKey, latitude, longitude, radiusKm = RTO_INSIGHT_DEFAULT_RADIUS_KM, timeoutSeconds = 60 } = {}) {
  const definition = OSM_SIGNAL_BY_KEY.get(signalKey);
  if (!definition) throw new Error(`Unknown OSM signal: ${signalKey}`);
  const lat = Number(latitude);
  const lon = Number(longitude);
  const radiusMeters = Math.max(1, Math.round(Number(radiusKm) * 1000));
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) throw new Error("latitude and longitude are required for Overpass queries");
  const selectors = definition.tags.flatMap((tags) => {
    const filter = osmTagFilter(tags);
    return [
      `  node(around:${radiusMeters},${lat},${lon})${filter};`,
      `  way(around:${radiusMeters},${lat},${lon})${filter};`,
      `  relation(around:${radiusMeters},${lat},${lon})${filter};`,
    ];
  });
  return [
    `[out:json][timeout:${Math.max(5, Math.round(Number(timeoutSeconds) || 60))}];`,
    "(",
    ...selectors,
    ");",
    "out center tags;",
  ].join("\n");
}

export function summarizeOsmSignal(signalKey, elements = []) {
  const definition = OSM_SIGNAL_BY_KEY.get(signalKey);
  if (!definition) throw new Error(`Unknown OSM signal: ${signalKey}`);
  const unique = dedupeOsmElements(elements);
  const tagged = unique.filter((element) => element?.tags && matchesAnyTag(element.tags, definition.tags));
  let value = tagged.length;

  if (definition.summary === "public-count") {
    value = tagged.filter((element) => isLikelyPublicOsmPlace(element.tags ?? {})).length;
  } else if (definition.summary === "capacity") {
    value = tagged.reduce((sum, element) => sum + capacityFromTags(element.tags ?? {}), 0);
  }

  const brands = uniqueStrings(tagged.map((element) => element.tags?.brand || element.tags?.operator)).slice(0, 20);
  return {
    signalKey: definition.key,
    signalGroup: definition.group,
    numericValue: value,
    unit: definition.unit,
    confidenceScore: Number((definition.confidenceScore * Math.min(1, 0.55 + tagged.length / 30)).toFixed(4)),
    evidence: {
      label: definition.label,
      matchedElements: tagged.length,
      totalElements: unique.length,
      brands,
      sample: tagged.slice(0, 8).map((element) => osmEvidenceItem(element)),
    },
  };
}

export async function upsertRtoGeoProfile(input = {}) {
  const profile = normalizeGeoInput(input);
  const result = await query(
    `
      insert into rto_geo_profiles (
        state, rto, rto_code, place_label, latitude, longitude,
        confidence_score, source, source_url, reviewed, raw, geocoded_at
      )
      values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11::jsonb, $12)
      on conflict (state, rto) do update set
        rto_code = excluded.rto_code,
        place_label = excluded.place_label,
        latitude = excluded.latitude,
        longitude = excluded.longitude,
        confidence_score = excluded.confidence_score,
        source = excluded.source,
        source_url = excluded.source_url,
        reviewed = excluded.reviewed,
        raw = excluded.raw,
        geocoded_at = excluded.geocoded_at,
        updated_at = now()
      returning *
    `,
    [
      profile.state,
      profile.rto,
      profile.rtoCode,
      profile.placeLabel,
      profile.latitude,
      profile.longitude,
      profile.confidenceScore,
      profile.source,
      profile.sourceUrl,
      profile.reviewed,
      JSON.stringify(profile.raw),
      profile.geocodedAt,
    ],
  );
  return normalizeGeoProfile(result.rows[0]);
}

export async function getRtoGeoProfile({ state, rto } = {}) {
  if (!state || !rto) return null;
  const result = await query(
    "select * from rto_geo_profiles where state = $1 and rto = $2 limit 1",
    [state, rto],
  );
  return result.rows[0] ? normalizeGeoProfile(result.rows[0]) : null;
}

export async function upsertRtoExternalSignal(input = {}) {
  const signal = normalizeSignalInput(input);
  const result = await transaction(async (tx) => {
    await tx(
      `
        delete from rto_external_signals
        where state = $1
          and rto = $2
          and provider = $3
          and signal_key = $4
          and radius_km = $5
          and coalesce(period_start, date '1900-01-01') = coalesce($6::date, date '1900-01-01')
          and coalesce(period_end, date '1900-01-01') = coalesce($7::date, date '1900-01-01')
      `,
      [signal.state, signal.rto, signal.provider, signal.signalKey, signal.radiusKm, signal.periodStart, signal.periodEnd],
    );
    return tx(
      `
        insert into rto_external_signals (
          state, rto, signal_key, signal_group, provider, radius_km,
          period_start, period_end, numeric_value, unit, source_url,
          source_updated_at, confidence_score, evidence, fetched_at
        )
        values ($1, $2, $3, $4, $5, $6, $7::date, $8::date, $9, $10, $11, $12, $13, $14::jsonb, $15)
        returning *
      `,
      [
        signal.state,
        signal.rto,
        signal.signalKey,
        signal.signalGroup,
        signal.provider,
        signal.radiusKm,
        signal.periodStart,
        signal.periodEnd,
        signal.numericValue,
        signal.unit,
        signal.sourceUrl,
        signal.sourceUpdatedAt,
        signal.confidenceScore,
        JSON.stringify(signal.evidence),
        signal.fetchedAt,
      ],
    );
  });
  return normalizeExternalSignal(result.rows[0]);
}

export async function getRtoInsightsCoverage() {
  const result = await query(
    `
      with configs as (
        select count(*)::int as total_rtos
        from rto_daily_snapshot_configs
        where enabled = true
      ),
      geo as (
        select count(*)::int as geo_profiles,
               count(*) filter (where latitude is not null and longitude is not null)::int as located_profiles,
               max(updated_at) as latest_geo_update
        from rto_geo_profiles
      ),
      signals as (
        select count(distinct state || '|' || rto)::int as signal_rtos,
               count(*)::int as signal_rows,
               max(fetched_at) as latest_signal_fetch
        from rto_external_signals
      ),
      vahan as (
        select max(snapshot_date) as latest_vahan_snapshot
        from rto_daily_scrape_reports
        where status = 'success'
      ),
      findings as (
        select count(*)::int as finding_rows,
               max(generated_at) as latest_finding
        from rto_pattern_findings
      )
      select *
      from configs, geo, signals, vahan, findings
    `,
  );
  const row = result.rows[0] ?? {};
  return {
    totalRtos: Number(row.total_rtos ?? 0),
    geoProfiles: Number(row.geo_profiles ?? 0),
    locatedProfiles: Number(row.located_profiles ?? 0),
    signalRtos: Number(row.signal_rtos ?? 0),
    signalRows: Number(row.signal_rows ?? 0),
    findingRows: Number(row.finding_rows ?? 0),
    latestGeoUpdate: isoOrNull(row.latest_geo_update),
    latestSignalFetch: isoOrNull(row.latest_signal_fetch),
    latestVahanSnapshot: dateOnly(row.latest_vahan_snapshot),
    latestFinding: isoOrNull(row.latest_finding),
  };
}

export async function listRtoInsightSummary({ state = null, q = null, radiusKm = RTO_INSIGHT_DEFAULT_RADIUS_KM, limit = 30 } = {}) {
  const market = await loadMarketRows({ state, radiusKm });
  const generated = market.registrationRows
    .map((row) => buildInsightRow(row, market))
    .filter((row) => insightRowMatchesSearch(row, q));
  const cached = await listCachedFindings({ state, limit });
  const rows = generated
    .sort(compareInsightRows)
    .slice(0, boundedLimit(limit));
  return {
    coverage: await getRtoInsightsCoverage(),
    radiusKm: normalizeRadius(radiusKm),
    rows,
    cachedFindings: cached,
    sourceNotes: [
      "VAHAN figures use cached daily RTO scrape reports.",
      "OpenStreetMap signals are cached server-side and should be read as proxies.",
      "Premium consumption is a proxy from POI density, not a verified income metric.",
    ],
  };
}

function insightRowMatchesSearch(row, queryText) {
  const query = normalizeSearchText(queryText);
  if (!query) return true;
  const haystack = normalizeSearchText([
    row.state,
    row.rto,
    row.title,
    row.patternKey,
  ].join(" "));
  return haystack.includes(query);
}

function normalizeSearchText(value) {
  return String(value ?? "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export async function getRtoInsightDetail({ state, rto, radiusKm = RTO_INSIGHT_DEFAULT_RADIUS_KM } = {}) {
  if (!state || !rto) throw inputError("state and rto are required");
  const market = await loadMarketRows({ state, rto, radiusKm });
  const registration = market.registrationRows[0] ?? null;
  const row = registration ? buildInsightRow(registration, market) : null;
  const trends = await listRegistrationTrend({ state, rto });
  return {
    state,
    rto,
    radiusKm: normalizeRadius(radiusKm),
    row,
    geoProfile: market.geoByKey.get(rtoKey(state, rto)) ?? null,
    signals: market.signalsByRto.get(rtoKey(state, rto)) ?? [],
    trends,
    cachedFindings: await listCachedFindings({ state, rto, limit: 20 }),
  };
}

export async function listRtoInsightSignals({ state = null, rto = null, radiusKm = null, limit = 100 } = {}) {
  const values = [];
  const clauses = [];
  if (state) {
    values.push(state);
    clauses.push(`state = $${values.length}`);
  }
  if (rto) {
    values.push(rto);
    clauses.push(`rto = $${values.length}`);
  }
  if (radiusKm !== null && radiusKm !== undefined && radiusKm !== "") {
    values.push(normalizeRadius(radiusKm));
    clauses.push(`radius_km = $${values.length}`);
  }
  values.push(boundedLimit(limit, 500));
  const result = await query(
    `
      select *
      from rto_external_signals
      ${clauses.length ? `where ${clauses.join(" and ")}` : ""}
      order by fetched_at desc, state asc, rto asc, signal_key asc
      limit $${values.length}
    `,
    values,
  );
  return result.rows.map(normalizeExternalSignal);
}

export function buildInsightRow(registration, market) {
  const key = rtoKey(registration.state, registration.rto);
  const signals = signalMap(market.signalsByRto.get(key) ?? []);
  const geo = market.geoByKey.get(key) ?? null;
  const evTotal = Number(registration.ev_total ?? 0);
  const iceTotal = Number(registration.ice_total ?? 0);
  const total = Number(registration.total ?? evTotal + iceTotal);
  const evShare = total > 0 ? evTotal / total : 0;
  const chargerCount = signalValue(signals, "ev_charging_station_count");
  const publicChargerCount = signalValue(signals, "public_charging_station_count");
  const chargerCapacity = signalValue(signals, "charger_capacity_sum");
  const premiumProxy = premiumProxyScore(signals);
  const completeness = signalCompleteness(signals);
  const geoConfidence = Number(geo?.confidenceScore ?? 0);
  const pattern = choosePattern({ evTotal, total, evShare, chargerCount, publicChargerCount, chargerCapacity, premiumProxy, completeness, geo });
  const score = pattern.score;
  const dataStatus = !geo?.latitude || !geo?.longitude
    ? "geo_missing"
    : completeness === 0
      ? "signals_missing"
      : "ready";
  return {
    state: registration.state,
    rto: registration.rto,
    latestSnapshotDate: dateOnly(registration.latest_snapshot_date),
    evTotal,
    iceTotal,
    total,
    evShare: round(evShare, 4),
    chargerCount,
    publicChargerCount,
    chargerCapacity,
    premiumProxy: round(premiumProxy, 2),
    signalCompleteness: round(completeness, 4),
    geoConfidence: round(geoConfidence, 4),
    score: round(score, 2),
    confidenceScore: round(Math.min(1, 0.15 + completeness * 0.55 + geoConfidence * 0.3), 4),
    dataStatus,
    patternKey: pattern.key,
    title: pattern.title,
    summary: pattern.summary,
    severity: score >= 75 ? "strong" : score >= 45 ? "interesting" : "watch",
    evidence: pattern.evidence,
  };
}

function compareInsightRows(left, right) {
  const statusOrder = { ready: 3, signals_missing: 2, geo_missing: 1 };
  const leftStatus = statusOrder[left.dataStatus] ?? 0;
  const rightStatus = statusOrder[right.dataStatus] ?? 0;
  return rightStatus - leftStatus
    || right.score - left.score
    || right.confidenceScore - left.confidenceScore
    || right.evTotal - left.evTotal;
}

async function loadMarketRows({ state = null, rto = null, radiusKm = RTO_INSIGHT_DEFAULT_RADIUS_KM } = {}) {
  const radius = normalizeRadius(radiusKm);
  const registrationRows = await loadRegistrationSummary({ state, rto });
  const states = uniqueStrings(registrationRows.map((row) => row.state));
  const rtos = new Set(registrationRows.map((row) => rtoKey(row.state, row.rto)));
  const [signals, geoRows] = await Promise.all([
    loadLatestSignals({ state, rto, radiusKm: radius }),
    loadGeoProfiles({ state, rto }),
  ]);
  const signalsByRto = new Map();
  for (const signal of signals) {
    const key = rtoKey(signal.state, signal.rto);
    if (!rtos.has(key) && (state || states.length)) continue;
    if (!signalsByRto.has(key)) signalsByRto.set(key, []);
    signalsByRto.get(key).push(signal);
  }
  const geoByKey = new Map(geoRows.map((row) => [rtoKey(row.state, row.rto), row]));
  return { radiusKm: radius, registrationRows, signalsByRto, geoByKey };
}

async function loadRegistrationSummary({ state = null, rto = null } = {}) {
  const values = [];
  const clauses = ["status = 'success'", "report_total is not null"];
  if (state) {
    values.push(state);
    clauses.push(`state = $${values.length}`);
  }
  if (rto) {
    values.push(rto);
    clauses.push(`rto = $${values.length}`);
  }
  const result = await query(
    `
      with per_day as (
        select state,
               rto,
               snapshot_date,
               sum(report_total) filter (where fuel_group = 'EV')::int as ev_total,
               sum(report_total) filter (where fuel_group = 'ICE')::int as ice_total,
               sum(report_total)::int as total
        from rto_daily_scrape_reports
        where ${clauses.join(" and ")}
        group by state, rto, snapshot_date
      )
      select distinct on (state, rto)
             state,
             rto,
             snapshot_date as latest_snapshot_date,
             coalesce(ev_total, 0)::int as ev_total,
             coalesce(ice_total, 0)::int as ice_total,
             coalesce(total, 0)::int as total
      from per_day
      order by state asc, rto asc, snapshot_date desc
    `,
    values,
  );
  return result.rows;
}

async function loadLatestSignals({ state = null, rto = null, radiusKm = RTO_INSIGHT_DEFAULT_RADIUS_KM } = {}) {
  const values = [normalizeRadius(radiusKm)];
  const clauses = ["radius_km = $1"];
  if (state) {
    values.push(state);
    clauses.push(`state = $${values.length}`);
  }
  if (rto) {
    values.push(rto);
    clauses.push(`rto = $${values.length}`);
  }
  const result = await query(
    `
      select distinct on (state, rto, signal_key, radius_km)
             *
      from rto_external_signals
      where ${clauses.join(" and ")}
      order by state asc, rto asc, signal_key asc, radius_km asc, fetched_at desc
    `,
    values,
  );
  return result.rows.map(normalizeExternalSignal);
}

async function loadGeoProfiles({ state = null, rto = null } = {}) {
  const values = [];
  const clauses = [];
  if (state) {
    values.push(state);
    clauses.push(`state = $${values.length}`);
  }
  if (rto) {
    values.push(rto);
    clauses.push(`rto = $${values.length}`);
  }
  const result = await query(
    `
      select *
      from rto_geo_profiles
      ${clauses.length ? `where ${clauses.join(" and ")}` : ""}
      order by state asc, rto asc
    `,
    values,
  );
  return result.rows.map(normalizeGeoProfile);
}

async function listRegistrationTrend({ state, rto }) {
  const result = await query(
    `
      select snapshot_date,
             sum(report_total) filter (where fuel_group = 'EV')::int as ev_total,
             sum(report_total) filter (where fuel_group = 'ICE')::int as ice_total,
             sum(report_total)::int as total
      from rto_daily_scrape_reports
      where state = $1
        and rto = $2
        and status = 'success'
        and report_total is not null
      group by snapshot_date
      order by snapshot_date desc
      limit 30
    `,
    [state, rto],
  );
  return result.rows.reverse().map((row) => ({
    snapshotDate: dateOnly(row.snapshot_date),
    evTotal: Number(row.ev_total ?? 0),
    iceTotal: Number(row.ice_total ?? 0),
    total: Number(row.total ?? 0),
  }));
}

async function listCachedFindings({ state = null, rto = null, limit = 25 } = {}) {
  const values = [];
  const clauses = [];
  if (state) {
    values.push(state);
    clauses.push(`state = $${values.length}`);
  }
  if (rto) {
    values.push(rto);
    clauses.push(`rto = $${values.length}`);
  }
  values.push(boundedLimit(limit, 100));
  const result = await query(
    `
      select *
      from rto_pattern_findings
      ${clauses.length ? `where ${clauses.join(" and ")}` : ""}
      order by score desc, confidence_score desc, generated_at desc
      limit $${values.length}
    `,
    values,
  );
  return result.rows.map((row) => ({
    state: row.state,
    rto: row.rto,
    patternKey: row.pattern_key,
    title: row.title,
    score: Number(row.score ?? 0),
    confidenceScore: Number(row.confidence_score ?? 0),
    severity: row.severity,
    summary: row.summary,
    evidence: row.evidence ?? {},
    periodStart: dateOnly(row.period_start),
    periodEnd: dateOnly(row.period_end),
    generatedAt: isoOrNull(row.generated_at),
  }));
}

function choosePattern({ evTotal, total, evShare, chargerCount, publicChargerCount, chargerCapacity, premiumProxy, completeness, geo }) {
  if (!geo?.latitude || !geo?.longitude) {
    return {
      key: "geo_missing",
      title: "Needs RTO location",
      score: 0,
      summary: "Add or geocode this RTO centroid before comparing local OSM signals.",
      evidence: { missing: "rto_geo_profile" },
    };
  }
  if (completeness === 0) {
    return {
      key: "signals_missing",
      title: "Needs OSM signals",
      score: Math.min(20, Math.log1p(evTotal) * 3),
      summary: "VAHAN data is present, but OSM radius signals have not been imported yet.",
      evidence: { missing: "rto_external_signals" },
    };
  }

  const evPressure = Math.min(100, Math.log1p(evTotal) * 10 + evShare * 70);
  const chargerAdequacy = Math.min(100, chargerCount * 9 + publicChargerCount * 4 + chargerCapacity * 0.8);
  const infraGap = Math.max(0, evPressure - chargerAdequacy);
  const infraAhead = Math.max(0, chargerAdequacy - evPressure);
  const affluenceGap = Math.max(0, premiumProxy - evShare * 120);

  const candidates = [
    {
      key: "ev_demand_ahead_of_chargers",
      title: "EV demand ahead of chargers",
      score: infraGap,
      summary: "EV registrations look stronger than the mapped local charging footprint.",
      evidence: { evPressure: round(evPressure, 2), chargerAdequacy: round(chargerAdequacy, 2), evShare: round(evShare, 4), chargerCount },
    },
    {
      key: "chargers_ahead_of_adoption",
      title: "Chargers ahead of adoption",
      score: infraAhead,
      summary: "Mapped charging infrastructure looks richer than current EV registration share.",
      evidence: { evPressure: round(evPressure, 2), chargerAdequacy: round(chargerAdequacy, 2), evShare: round(evShare, 4), chargerCount },
    },
    {
      key: "premium_proxy_ahead_of_ev",
      title: "Premium proxy ahead of EV adoption",
      score: affluenceGap,
      summary: "Consumption-proxy density is high relative to local EV adoption.",
      evidence: { premiumProxy: round(premiumProxy, 2), evShare: round(evShare, 4), total },
    },
  ];
  const best = candidates.sort((left, right) => right.score - left.score)[0];
  if ((best?.score ?? 0) < 8) {
    return {
      key: "no_clear_gap",
      title: "No clear gap yet",
      score: Math.max(1, best?.score ?? 0),
      summary: "Imported signals exist, but the current proxy math does not show a strong mismatch yet.",
      evidence: { bestCandidate: best?.key, bestScore: round(best?.score ?? 0, 2), evShare: round(evShare, 4), chargerCount, premiumProxy: round(premiumProxy, 2) },
    };
  }
  return best;
}

function premiumProxyScore(signals) {
  return Math.min(100,
    signalValue(signals, "restaurant_count") * 0.25 +
    signalValue(signals, "cafe_count") * 0.3 +
    signalValue(signals, "hotel_count") * 1.4 +
    signalValue(signals, "retail_mall_count") * 5 +
    signalValue(signals, "bank_atm_count") * 0.18 +
    signalValue(signals, "vehicle_dealer_service_count") * 0.8);
}

function signalCompleteness(signals) {
  if (!signals.size) return 0;
  return Math.min(1, signals.size / OSM_SIGNAL_DEFINITIONS.length);
}

function signalMap(signals = []) {
  return new Map(signals.map((signal) => [signal.signalKey, signal]));
}

function signalValue(signals, key) {
  return Number(signals.get(key)?.numericValue ?? 0);
}

function normalizeGeoInput(input) {
  const state = requiredText(input.state, "state");
  const rto = requiredText(input.rto, "rto");
  return {
    state,
    rto,
    rtoCode: input.rtoCode ?? parseRtoCode(rto),
    placeLabel: input.placeLabel ?? placeLabelFromRto(rto),
    latitude: finiteOrNull(input.latitude),
    longitude: finiteOrNull(input.longitude),
    confidenceScore: clamp01(input.confidenceScore ?? 0),
    source: String(input.source ?? "manual").trim() || "manual",
    sourceUrl: input.sourceUrl ? String(input.sourceUrl).trim() : null,
    reviewed: Boolean(input.reviewed),
    raw: input.raw && typeof input.raw === "object" ? input.raw : {},
    geocodedAt: input.geocodedAt ?? (input.latitude && input.longitude ? new Date().toISOString() : null),
  };
}

function normalizeSignalInput(input) {
  const definition = OSM_SIGNAL_BY_KEY.get(input.signalKey);
  return {
    state: requiredText(input.state, "state"),
    rto: requiredText(input.rto, "rto"),
    signalKey: requiredText(input.signalKey, "signalKey"),
    signalGroup: input.signalGroup ?? definition?.group ?? "external",
    provider: String(input.provider ?? definition?.provider ?? RTO_INSIGHT_PROVIDER_OSM).trim(),
    radiusKm: normalizeRadius(input.radiusKm),
    periodStart: input.periodStart ?? null,
    periodEnd: input.periodEnd ?? null,
    numericValue: Math.max(0, Number(input.numericValue ?? 0) || 0),
    unit: String(input.unit ?? definition?.unit ?? "count").trim() || "count",
    sourceUrl: input.sourceUrl ? String(input.sourceUrl).trim() : null,
    sourceUpdatedAt: input.sourceUpdatedAt ?? null,
    confidenceScore: clamp01(input.confidenceScore ?? definition?.confidenceScore ?? 0),
    evidence: input.evidence && typeof input.evidence === "object" ? input.evidence : {},
    fetchedAt: input.fetchedAt ?? new Date().toISOString(),
  };
}

function normalizeGeoProfile(row) {
  return {
    state: row.state,
    rto: row.rto,
    rtoCode: row.rto_code ?? null,
    placeLabel: row.place_label ?? null,
    latitude: row.latitude === null || row.latitude === undefined ? null : Number(row.latitude),
    longitude: row.longitude === null || row.longitude === undefined ? null : Number(row.longitude),
    confidenceScore: Number(row.confidence_score ?? 0),
    source: row.source,
    sourceUrl: row.source_url ?? null,
    reviewed: Boolean(row.reviewed),
    raw: row.raw ?? {},
    geocodedAt: isoOrNull(row.geocoded_at),
    updatedAt: isoOrNull(row.updated_at),
  };
}

function normalizeExternalSignal(row) {
  return {
    state: row.state,
    rto: row.rto,
    signalKey: row.signal_key,
    signalGroup: row.signal_group,
    provider: row.provider,
    radiusKm: Number(row.radius_km ?? 0),
    periodStart: dateOnly(row.period_start),
    periodEnd: dateOnly(row.period_end),
    numericValue: Number(row.numeric_value ?? 0),
    unit: row.unit,
    sourceUrl: row.source_url ?? null,
    sourceUpdatedAt: isoOrNull(row.source_updated_at),
    confidenceScore: Number(row.confidence_score ?? 0),
    evidence: row.evidence ?? {},
    fetchedAt: isoOrNull(row.fetched_at),
  };
}

function dedupeOsmElements(elements = []) {
  const seen = new Set();
  return elements.filter((element) => {
    const key = `${element?.type ?? "node"}:${element?.id ?? ""}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return Boolean(element);
  });
}

function osmEvidenceItem(element) {
  const tags = element.tags ?? {};
  return {
    id: element.id,
    type: element.type,
    name: tags.name ?? null,
    brand: tags.brand ?? null,
    operator: tags.operator ?? null,
    capacity: tags.capacity ?? null,
    access: tags.access ?? null,
  };
}

function capacityFromTags(tags) {
  const value = Number(String(tags.capacity ?? "").replace(/[^0-9.]/g, ""));
  return Number.isFinite(value) && value > 0 ? value : 0;
}

function isLikelyPublicOsmPlace(tags) {
  const access = String(tags.access ?? "").toLowerCase();
  if (["private", "no", "permit"].includes(access)) return false;
  if (["yes", "public", "customers", "destination"].includes(access)) return true;
  return true;
}

function matchesAnyTag(tags, candidates = []) {
  return candidates.some((candidate) =>
    Object.entries(candidate).every(([key, value]) => String(tags[key] ?? "") === String(value)));
}

function osmTagFilter(tags) {
  return Object.entries(tags)
    .map(([key, value]) => `["${escapeOverpassString(key)}"="${escapeOverpassString(value)}"]`)
    .join("");
}

function escapeOverpassString(value) {
  return String(value).replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

function normalizeRadius(value) {
  const radius = Math.round(Number(value) || RTO_INSIGHT_DEFAULT_RADIUS_KM);
  if (RTO_INSIGHT_RADIUS_OPTIONS.includes(radius)) return radius;
  return Math.max(1, Math.min(100, radius));
}

function boundedLimit(value, max = 100) {
  return Math.max(1, Math.min(max, Math.floor(Number(value) || 30)));
}

function rtoKey(state, rto) {
  return `${state}\u0000${rto}`;
}

function requiredText(value, label) {
  const text = String(value ?? "").trim();
  if (!text) throw inputError(`${label} is required`);
  return text;
}

function inputError(message) {
  const error = new Error(message);
  error.statusCode = 400;
  return error;
}

function finiteOrNull(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function clamp01(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return 0;
  return Math.max(0, Math.min(1, number));
}

function round(value, digits = 2) {
  const factor = 10 ** digits;
  return Math.round((Number(value) || 0) * factor) / factor;
}

function uniqueStrings(values = []) {
  return [...new Set(values.map((value) => String(value ?? "").trim()).filter(Boolean))];
}

function dateOnly(value) {
  if (!value) return null;
  if (typeof value === "string") return value.slice(0, 10);
  return new Date(value).toISOString().slice(0, 10);
}

function isoOrNull(value) {
  return value ? new Date(value).toISOString() : null;
}
