export const DAILY_REGISTRATION_METRIC_KIND = "registration_month_to_date";
export const DAILY_REGISTRATION_SOURCE_CONTRACT = "public-registration-mtd-v1";
export const DAILY_REGISTRATION_REASON = "Daily registrations require compatible, consecutive Public Dashboard monthly-registration observations. Missing, mixed-month, stale, or invalid evidence is never converted to zero.";
export const DAILY_REGISTRATION_TIMEZONE = "Asia/Kolkata";

const categories = ["2W", "3W", "4W"];
const fuelGroups = ["EV", "ICE"];

export function buildDailyRegistrationEvidence({ date, rows = [] } = {}) {
  const previousDate = addDays(date, -1);
  const twoDaysAgo = addDays(date, -2);
  const currentRows = rows.filter((row) => row.snapshotDate === date);
  const previousRows = rows.filter((row) => row.snapshotDate === previousDate);
  const priorRows = rows.filter((row) => row.snapshotDate === twoDaysAgo);
  const currentValidation = validateObservationSet(currentRows, date);
  const sourceMonthToDate = totalsForRows(currentValidation.valid ? currentRows : []);
  const today = compareObservationSets(currentRows, previousRows, date, previousDate);
  const priorDay = compareObservationSets(previousRows, priorRows, previousDate, twoDaysAgo);
  const categoryRows = categories.map((vehicleCategory) => {
    const ev = today.values.get(`EV|${vehicleCategory}`) ?? null;
    const ice = today.values.get(`ICE|${vehicleCategory}`) ?? null;
    return { vehicleCategory, period: metricSet(ev, ice), status: ev === null || ice === null ? "unavailable" : correctionStatus(ev, ice), reason: today.reason };
  });
  const todayTotals = totalsFromValues(today.values);
  const previousTotals = totalsFromValues(priorDay.values);
  const todayReason = today.eligible ? null : today.reason;
  const previousReason = priorDay.eligible ? null : priorDay.reason;
  const oemEvidence = currentRows.map((row) => row.qualityFlags?.sourceEvidence?.oem).filter(Boolean);
  const oemVerified = currentValidation.valid && oemEvidence.length === 6 && oemEvidence.every((item) => item.status === "verified");
  const oemReason = oemVerified ? null : oemEvidence.find((item) => item.status === "unavailable")?.reason
    || "The monthly maker source contract is not verified for all six RTO segments.";
  return {
    status: today.eligible ? correctionStatus(todayTotals.ev, todayTotals.ice) : "unavailable",
    reason: todayReason,
    date,
    timezone: DAILY_REGISTRATION_TIMEZONE,
    baselineEligible: today.eligible,
    previousDayEligible: priorDay.eligible,
    sourceMonthToDate,
    todayBreakdown: todayTotals,
    previousDayBreakdown: previousTotals,
    previousDayRegistrations: field(previousTotals.total, previousDate, previousReason),
    evRegistrations: field(todayTotals.ev, date, todayReason),
    iceRegistrations: field(todayTotals.ice, date, todayReason),
    evShare: field(share(todayTotals.ev, todayTotals.total), date, todayReason),
    rank: field(null, date, "Rank is published only when daily EV registration changes are valid for all 100 frozen RTOs."),
    rankDefinition: "Rank by today's EV registration change across the complete frozen 100-RTO cohort",
    categories: categoryRows,
    oem: { status: oemVerified ? "verified" : "unavailable", reason: oemReason },
    freshness: {
      status: today.eligible ? "comparison_verified" : "unverified",
      reason: today.reason,
      requestHashes: currentRows.map((row) => sourceEvidence(row)?.validation?.requestHash).filter(Boolean),
      responseHashes: currentRows.map((row) => sourceEvidence(row)?.validation?.responseHash).filter(Boolean),
      collectedAt: currentRows.map((row) => row.scrapedAt).filter(Boolean).sort(),
    },
  };
}

function compareObservationSets(currentRows, previousRows, currentDate, previousDate) {
  const current = validateObservationSet(currentRows, currentDate);
  if (!current.valid) return { eligible: false, reason: current.reason, values: new Map() };
  const previous = validateObservationSet(previousRows, previousDate);
  if (!previous.valid) return { eligible: false, reason: previous.reason, values: new Map() };
  if (String(currentDate).slice(0, 7) !== String(previousDate).slice(0, 7)) {
    return { eligible: false, reason: "Month-boundary baseline: Daily values remain unavailable until the next valid same-month observation.", values: new Map() };
  }
  const previousIndex = new Map(previousRows.map((row) => [scopeKey(row), row]));
  const values = new Map();
  for (const row of currentRows) {
    const prior = previousIndex.get(scopeKey(row));
    const currentEvidence = sourceEvidence(row);
    const priorEvidence = sourceEvidence(prior);
    if (!prior || row.targetMonth !== prior.targetMonth || filterIdentity(row) !== filterIdentity(prior)
      || currentEvidence.validation.requestHash !== priorEvidence.validation.requestHash) {
      return { eligible: false, reason: "Consecutive observations use incompatible RTO, fuel, category, month, archive, or status filters.", values: new Map() };
    }
    if (currentEvidence.validation.responseHash === priorEvidence.validation.responseHash) {
      return { eligible: false, reason: "The consecutive source responses are identical and the Public Dashboard supplies no refresh timestamp, so a zero change cannot be verified.", values: new Map() };
    }
    if (Number(row.reportTotal) === Number(prior.reportTotal)) {
      return {
        eligible: false,
        reason: "The target-month registration total is unchanged and the Public Dashboard supplies no distinct upstream refresh timestamps; a zero Daily change cannot be verified from unrelated response changes.",
        values: new Map(),
      };
    }
    values.set(scopeKey(row), Number(row.reportTotal) - Number(prior.reportTotal));
  }
  return { eligible: true, reason: null, values };
}


function validateObservationSet(rows, date) {
  if (!date || rows.length !== 6) return { valid: false, reason: `Six accepted registration scopes are required for ${date ?? "the selected date"}.` };
  const expectedMonth = String(date).slice(0, 7);
  const keys = new Set();
  for (const row of rows) {
    const evidence = sourceEvidence(row);
    const key = scopeKey(row);
    if (keys.has(key)) return { valid: false, reason: `Duplicate registration scope ${key} was rejected for ${date}.` };
    keys.add(key);
    if (!fuelGroups.includes(row.fuelGroup) || !categories.includes(row.vehicleCategory)
      || row.metricKind !== DAILY_REGISTRATION_METRIC_KIND || row.source !== "vahan-public-dashboard"
      || row.targetMonth !== expectedMonth || !Number.isSafeInteger(Number(row.reportTotal)) || Number(row.reportTotal) < 0
      || evidence?.validation?.contract !== DAILY_REGISTRATION_SOURCE_CONTRACT
      || evidence.validation.targetMonth !== expectedMonth
      || !/^[a-f0-9]{64}$/.test(evidence.validation.requestHash ?? "")
      || !/^[a-f0-9]{64}$/.test(evidence.validation.responseHash ?? "")) {
      return { valid: false, reason: `Invalid or mixed monthly-registration evidence was rejected for ${date}.` };
    }
  }
  return { valid: keys.size === 6, reason: keys.size === 6 ? null : `Six distinct registration scopes are required for ${date}.` };
}

function sourceEvidence(row) {
  return row?.qualityFlags?.sourceEvidence ?? row?.evidence ?? {};
}

function filterIdentity(row) {
  const filters = sourceEvidence(row)?.filters ?? {};
  return JSON.stringify({
    stateCode: filters.stateCode,
    rtoCode: filters.rtoCode,
    vehicleCategories: [...(filters.vehicleCategories ?? [])].sort(),
    vehicleClasses: [...(filters.vehicleClasses ?? [])].sort(),
    fuels: [...(filters.fuels ?? [])].sort(),
    archiveScope: filters.archiveScope,
    calendarType: filters.calendarType,
    timePeriod: filters.timePeriod,
    targetMonth: filters.targetMonth,
  });
}

function scopeKey(row) { return `${row?.fuelGroup}|${row?.vehicleCategory}`; }
function addDays(date, amount) { return date ? new Date(Date.parse(`${date}T00:00:00Z`) + amount * 86400000).toISOString().slice(0, 10) : null; }
function metricSet(ev, ice) { return { ev, ice, total: Number.isFinite(ev) && Number.isFinite(ice) ? ev + ice : null }; }
function totalsFromValues(values) {
  const sum = (fuel) => {
    const parts = categories.map((category) => values.get(`${fuel}|${category}`));
    return parts.every(Number.isFinite) ? parts.reduce((total, value) => total + value, 0) : null;
  };
  return metricSet(sum("EV"), sum("ICE"));
}
function totalsForRows(rows) {
  const values = new Map(rows.map((row) => [scopeKey(row), Number(row.reportTotal)]));
  return totalsFromValues(values);
}
function share(part, total) { return Number.isFinite(part) && Number.isFinite(total) && total > 0 ? part / total * 100 : null; }
function correctionStatus(...values) { return values.some((value) => Number.isFinite(value) && value < 0) ? "correction" : "available"; }
function field(value, date, reason = null) {
  return { value: Number.isFinite(value) ? value : null, date, timezone: DAILY_REGISTRATION_TIMEZONE,
    status: Number.isFinite(value) ? (value < 0 ? "correction" : "available") : "unavailable", reason };
}

export function unavailableDailyRegistrationReport(report) {
  const payload = report.payload ?? {};
  if ((report.cadence ?? payload.cadence) !== "daily") return report;
  if ((payload.source?.validationContract ?? report.validationContract) === DAILY_REGISTRATION_SOURCE_CONTRACT
    && payload.dailyRegistration) return report;
  const date = report.periodEnd ?? payload.period?.end ?? null;
  const previousDate = date ? new Date(Date.parse(`${date}T00:00:00Z`) - 86400000).toISOString().slice(0, 10) : null;
  const source = payload.source ?? report.source ?? {};
  const reason = source.validationContract === "public-stock-v2" || report.validationContract === "public-stock-v2"
    ? DAILY_REGISTRATION_REASON
    : "No verified daily registration evidence exists for this RTO and date. Historical or unverified observations are excluded; collection must use a verified daily registration source.";
  const empty = () => ({ ev: null, ice: null, total: null, evShare: null });
  const field = (fieldDate, why = reason) => ({ value: null, date: fieldDate, timezone: DAILY_REGISTRATION_TIMEZONE, status: "unavailable", reason: why });
  const dailyRegistration = {
    status: "unavailable", reason, date, timezone: DAILY_REGISTRATION_TIMEZONE,
    baselineEligible: false,
    previousDayRegistrations: field(previousDate), evRegistrations: field(date), iceRegistrations: field(date),
    evShare: field(date), rank: field(date, "Daily rank requires verified daily EV registrations for all 100 cohort RTOs. " + reason),
    rankDefinition: "Rank by daily EV registrations across the complete frozen 100-RTO cohort",
  };
  const summary = `Daily registrations unavailable for ${date ?? "the selected date"}. ${reason}`;
  return { ...report, status: "needs_review", summary, currentCoverage: false,
    explanations: [],
    cohortRank: null, previousRank: null, periodEv: null, periodIce: null, mtdEv: null, mtdIce: null, evShare: null,
    dailyRegistration,
    payload: { ...payload, cadence: "daily", kind: "rto-daily-registration-report", status: "needs_review", summary,
      period: { ...payload.period, start: date, end: date, label: date ?? "Selected date", comparisonStart: previousDate, comparisonEnd: previousDate },
      rto: { ...payload.rto, cohortRank: null, previousRank: null },
      dailyRegistration,
      metrics: { period: empty(), previousPeriod: empty(), stock: empty(), change: { ev: {absolute:null,percent:null}, ice: {absolute:null,percent:null}, total: {absolute:null,percent:null} } },
      categories: ["2W", "3W", "4W"].map(vehicleCategory => ({ vehicleCategory, period: empty(), previousPeriod: empty(), stock: empty() })),
      oems: [], trend: [], explanations: [],
      quality: { ...payload.quality, currentCoverage: false, registrationCoverage: 0,
        sourceCollectionCoverage: payload.quality?.sourceCollectionCoverage ?? payload.quality?.currentCoverage ?? null,
        warnings: [reason], sourceFlags: ["daily_registration_source_unavailable"] },
      source: { ...source, registrationFlowAvailable: false, dailyBaselineEligible: false,
        limitation: reason, sourceAsOf: null, freshnessStatus: "unverified",
        freshnessReason: "Collection time records when the response was fetched; the source does not confirm its data refresh time.",
      },
    },
  };
}
