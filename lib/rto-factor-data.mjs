import { query } from "./db.mjs";

const SUPPORTED_FUEL_GROUPS = Object.freeze(["EV", "ICE"]);
const SUPPORTED_VEHICLE_CATEGORIES = Object.freeze(["2W", "3W", "4W"]);

export async function loadRtoFactorDecisionInput({
  report,
  event,
  asOfDate = report?.sourceSnapshotDate ?? report?.periodEnd,
  preDays = 28,
  postDays = 14,
  queryImpl = query,
} = {}) {
  assertReport(report);
  const target = eventTargetForReport(event, report);
  if (!target) {
    const error = new Error("The event does not target this report RTO.");
    error.code = "event_target_mismatch";
    throw error;
  }
  if (!["rto", "state"].includes(target.geographyScope)) {
    const error = new Error("Version 1 supports only RTO- and state-scoped events.");
    error.code = "unsupported_geography_scope";
    throw error;
  }
  if (target.oem) {
    const error = new Error("Version 1 validates headline fuel/category totals, not OEM-scoped events.");
    error.code = "unsupported_oem_scope";
    throw error;
  }
  if (
    (!target.fuelGroup || target.fuelGroup === "ALL") &&
    (!target.vehicleCategory || target.vehicleCategory === "ALL")
  ) {
    const error = new Error("Version 1 requires a concrete fuel group or vehicle category.");
    error.code = "unsupported_broad_metric";
    throw error;
  }

  const effectiveDate = dateOnly(event?.effectiveStart ?? event?.effectiveDate);
  const boundedAsOfDate = dateOnly(asOfDate);
  const windowStart = addDays(effectiveDate, -boundedInteger(preDays, 7, 180, 28));
  const historyStart = addDays(windowStart, -1);
  const requestedPostEnd = addDays(effectiveDate, boundedInteger(postDays, 1, 90, 14) - 1);
  const windowEnd = requestedPostEnd < boundedAsOfDate ? requestedPostEnd : boundedAsOfDate;
  const fuelGroups = target.fuelGroup && target.fuelGroup !== "ALL"
    ? [target.fuelGroup]
    : [...SUPPORTED_FUEL_GROUPS];
  const vehicleCategories = target.vehicleCategory && target.vehicleCategory !== "ALL"
    ? [target.vehicleCategory]
    : [...SUPPORTED_VEHICLE_CATEGORIES];

  const [cohortResult, historyResult] = await Promise.all([
    queryImpl(
      `
        select state, rto, cohort_rank
        from rto_daily_run_cohort_members
        where run_id = $1
        order by cohort_rank, state, rto
      `,
      [report.sourceRunId],
    ),
    queryImpl(
      `
        select
          sr.snapshot_date,
          sr.target_month,
          sr.state,
          sr.rto,
          sr.fuel_group,
          sr.vehicle_category,
          sr.status,
          sr.report_total,
          sr.filters_confirmed,
          sr.explicit_zero,
          sr.evidence
        from rto_daily_scrape_reports sr
        where sr.snapshot_date between $2::date and $3::date
          and sr.fuel_group = any($4::text[])
          and sr.vehicle_category = any($5::text[])
          and exists (
            select 1
            from rto_daily_run_cohort_members cm
            where cm.run_id = $1
              and cm.state = sr.state
              and cm.rto = sr.rto
          )
        order by sr.state, sr.rto, sr.snapshot_date, sr.fuel_group, sr.vehicle_category
      `,
      [report.sourceRunId, historyStart, windowEnd, fuelGroups, vehicleCategories],
    ),
  ]);

  const cohort = cohortResult.rows.map((row) => ({
    state: String(row.state),
    rto: String(row.rto),
    cohortRank: Number(row.cohort_rank),
  }));
  const cohortKey = new Set(cohort.map((row) => rtoKey(row)));
  if (!cohortKey.has(rtoKey(report))) {
    const error = new Error("The report RTO is not present in its frozen source cohort.");
    error.code = "report_not_in_frozen_cohort";
    throw error;
  }

  const rows = completeDecisionRows({
    rows: historyResult.rows.map(normalizeDecisionRow),
    cohort,
    from: historyStart,
    to: windowEnd,
    fuelGroups,
    vehicleCategories,
  });
  const focalRows = rows.filter((row) => row.state === report.state && row.rto === report.rto);
  const candidateRows = rows.filter((row) => row.state !== report.state || row.rto !== report.rto);
  return {
    target,
    validationEvent: validationEventFromStoredEvent({ event, target }),
    focalRows,
    candidateRows,
    cohort,
    asOfDate: boundedAsOfDate,
    dataContext: {
      batchStatus: report.batchStatus,
      reportStatus: report.status,
      reportId: report.id,
      reportRevision: report.revision,
      reportSourceChecksum: report.sourceChecksum,
      sourceRunId: report.sourceRunId,
      cohortHash: report.cohortHash,
      cohortSize: report.cohortSize,
      fuelGroups,
      vehicleCategories,
      expectedCellsPerRtoDate: fuelGroups.length * vehicleCategories.length,
      canonicalMetric: "rto_daily_scrape_reports.report_total",
      historyStart,
      windowStart,
      windowEnd,
    },
  };
}

export function eventTargetForReport(event, report) {
  const targets = Array.isArray(event?.targets) ? event.targets : [];
  return targets
    .filter((target) => target?.targetRole !== "excluded_control")
    .filter((target) => targetMatchesReport(target, report))
    .sort((left, right) => targetSpecificity(right) - targetSpecificity(left))[0] ?? null;
}

export function validationEventFromStoredEvent({ event, target } = {}) {
  if (!event || !target) throw new TypeError("event and target are required");
  const documents = Array.isArray(event.documents) ? event.documents : [];
  const sources = documents
    .filter((entry) => entry?.evidenceRole !== "confounder")
    .map((entry) => entry.document ?? entry)
    .map((document) => ({
      id: Number(document.id ?? document.documentId),
      tier: document.source?.sourceTier ?? document.sourceTier ?? document.tier,
      verified:
        document.reviewStatus === "approved" &&
        (
          document.source?.evidencePolicy ??
          document.evidencePolicy ??
          "report_evidence"
        ) === "report_evidence",
    }));
  const confounders = documents
    .filter((entry) => entry?.evidenceRole === "confounder")
    .map((entry) => entry.document?.title ?? entry.title ?? `Document ${entry.documentId ?? entry.id}`);
  const affectedRtos = (event.targets ?? [])
    .filter((entry) => entry.targetRole !== "excluded_control" && entry.geographyScope === "rto")
    .map((entry) => ({ state: entry.state, rto: entry.rto }));

  return {
    id: Number(event.id),
    title: event.title,
    effectiveDate: dateOnly(event.effectiveStart ?? event.effectiveDate),
    scopeLevel: target.geographyScope,
    state: target.state,
    rto: target.rto,
    rtos: affectedRtos,
    fuelGroup: target.fuelGroup === "ALL" ? null : target.fuelGroup,
    vehicleCategory: target.vehicleCategory === "ALL" ? null : target.vehicleCategory,
    sources,
    confounders,
    hasConfounder: confounders.length > 0,
    expectedDirection: event.expectedDirection ?? "unknown",
  };
}

export function documentsForRtoFactorNarrative(event) {
  return (Array.isArray(event?.documents) ? event.documents : [])
    .filter((entry) => entry?.evidenceRole !== "confounder")
    .map((entry) => {
      const document = entry.document ?? entry;
      return {
        id: Number(document.id ?? entry.documentId),
        title: document.title,
        publisher: document.source?.publisher ?? document.publisher,
        url: document.canonicalUrl ?? document.url,
        tier: document.source?.sourceTier ?? document.sourceTier ?? document.tier,
        publishedAt: document.publishedAt,
        excerpt: document.evidenceExcerpt ?? document.excerpt,
        contentHash: document.contentHash,
      };
    });
}

function normalizeDecisionRow(row) {
  return {
    snapshotDate: dateOnly(row.snapshot_date),
    targetMonth: String(row.target_month),
    state: String(row.state),
    rto: String(row.rto),
    fuelGroup: String(row.fuel_group),
    vehicleCategory: String(row.vehicle_category),
    scrapeStatus: row.status,
    reportTotal: row.report_total === null ? null : Number(row.report_total),
    filtersConfirmed: Boolean(row.filters_confirmed),
    explicitZero: Boolean(row.explicit_zero),
    qualityStatus: row.status === "success" && row.filters_confirmed ? "ready" : "needs_review",
    qualityFlags: {},
  };
}

function completeDecisionRows({
  rows,
  cohort,
  from,
  to,
  fuelGroups,
  vehicleCategories,
}) {
  const byCell = new Map(rows.map((row) => [decisionCellKey(row), row]));
  const completed = [];
  for (const member of cohort) {
    for (const snapshotDate of dateRange(from, to)) {
      for (const fuelGroup of fuelGroups) {
        for (const vehicleCategory of vehicleCategories) {
          const identity = {
            state: member.state,
            rto: member.rto,
            snapshotDate,
            fuelGroup,
            vehicleCategory,
          };
          completed.push(byCell.get(decisionCellKey(identity)) ?? {
            ...identity,
            targetMonth: snapshotDate.slice(0, 7),
            scrapeStatus: "missing",
            reportTotal: null,
            filtersConfirmed: false,
            explicitZero: false,
            qualityStatus: "needs_review",
            qualityFlags: {},
          });
        }
      }
    }
  }
  return completed;
}

function decisionCellKey(row) {
  return [
    row.state,
    row.rto,
    row.snapshotDate,
    row.fuelGroup,
    row.vehicleCategory,
  ].join("\u0001");
}

function targetMatchesReport(target, report) {
  if (target?.geographyScope === "rto") {
    return target.state === report.state && target.rto === report.rto;
  }
  if (target?.geographyScope === "state") return target.state === report.state;
  return target?.geographyScope === "national";
}

function targetSpecificity(target) {
  return target?.geographyScope === "rto" ? 3 : target?.geographyScope === "state" ? 2 : 1;
}

function assertReport(report) {
  if (!report || !Number.isSafeInteger(Number(report.id))) throw new TypeError("A persisted RTO report is required.");
  if (!Number.isSafeInteger(Number(report.sourceRunId))) {
    throw new TypeError("The report must reference a frozen source run.");
  }
  dateOnly(report.sourceSnapshotDate ?? report.periodEnd);
}

function rtoKey(value) {
  return `${value.state}\u0000${value.rto}`;
}

function dateOnly(value) {
  const text = value instanceof Date ? value.toISOString().slice(0, 10) : String(value ?? "").slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text) || Number.isNaN(Date.parse(`${text}T00:00:00Z`))) {
    throw new TypeError(`Invalid calendar date: ${value}`);
  }
  return text;
}

function addDays(value, amount) {
  const date = new Date(`${dateOnly(value)}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + Number(amount));
  return date.toISOString().slice(0, 10);
}

function dateRange(from, to) {
  const values = [];
  for (let value = dateOnly(from); value <= dateOnly(to); value = addDays(value, 1)) {
    values.push(value);
  }
  return values;
}

function boundedInteger(value, min, max, fallback) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, Math.trunc(parsed)));
}
