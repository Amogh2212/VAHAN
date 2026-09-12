import crypto from "node:crypto";
import { reportThemeCss } from './report-theme.mjs';
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { query, transaction } from "./db.mjs";
import { RTO_DAILY_METRIC_KIND } from "./rto-daily-snapshots.mjs";

import { verifiedRtoSourceSql } from "./public-dashboard-scope.mjs";
import { DAILY_REGISTRATION_REASON, unavailableDailyRegistrationReport } from "./rto-daily-registration-contract.mjs";

export const RTO_REPORT_EXPECTED_COHORT_SIZE = 100;
export const RTO_REPORT_ANOMALY_TOTAL_MAX = 1_000_000;
export const RTO_REPORT_PAYLOAD_VERSION = 6;
export const RTO_REPORT_PDF_RENDERER_VERSION = 7;
export const RTO_REPORT_CADENCES = Object.freeze(["daily", "weekly", "monthly"]);
export const RTO_REPORT_COMBOS = Object.freeze([
  Object.freeze(["EV", "2W"]),
  Object.freeze(["EV", "3W"]),
  Object.freeze(["EV", "4W"]),
  Object.freeze(["ICE", "2W"]),
  Object.freeze(["ICE", "3W"]),
  Object.freeze(["ICE", "4W"]),
]);
export const RTO_REPORT_EXPECTED_OEMS = 5;
export const RTO_REPORT_EXPECTED_OEM_ROWS_PER_RTO = RTO_REPORT_COMBOS.length * RTO_REPORT_EXPECTED_OEMS;

export function rtoReportCategoryOemRows() {
  return [];
}

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = path.resolve(__dirname, "..");
const EXPORT_ROOT = path.join(ROOT_DIR, "reports", "rto-exports");
const DAY_MS = 24 * 60 * 60 * 1000;

export function reportPeriodsForSnapshotDate(snapshotDate) {
  const date = dateOnly(snapshotDate);
  if (!date) throw new Error("A snapshot date is required.");
  const periods = [reportPeriod("daily", date)];
  if (dayOfWeek(date) === 0) periods.push(reportPeriod("weekly", date));
  if (isMonthEnd(date)) periods.push(reportPeriod("monthly", date));
  return periods;
}

export function reportHistoryStartDate(snapshotDate) {
  return addDays(dateOnly(snapshotDate), -14);
}

export function reportPeriod(cadence, periodEnd) {
  const end = dateOnly(periodEnd);
  if (!RTO_REPORT_CADENCES.includes(cadence)) throw new Error(`Unknown report cadence: ${cadence}`);
  if (!end) throw new Error("A period end date is required.");
  if (cadence === "daily") return { cadence, periodStart: end, periodEnd: end };
  if (cadence === "weekly") {
    return { cadence, periodStart: addDays(end, -6), periodEnd: end };
  }
  return { cadence, periodStart: `${end.slice(0, 7)}-01`, periodEnd: end };
}

export function previousReportPeriod({ cadence, periodStart, periodEnd }) {
  if (cadence === "daily") {
    const previous = addDays(periodStart, -1);
    return { cadence, periodStart: previous, periodEnd: previous };
  }
  if (cadence === "weekly") {
    return {
      cadence,
      periodStart: addDays(periodStart, -7),
      periodEnd: addDays(periodEnd, -7),
    };
  }
  const previousEnd = addDays(periodStart, -1);
  return {
    cadence,
    periodStart: `${previousEnd.slice(0, 7)}-01`,
    periodEnd: previousEnd,
  };
}

export function periodValueForSeries(series, period) {
  if (!(series instanceof Map)) return null;
  if (period.cadence === "monthly") {
    return finiteOrNull(series.get(period.periodEnd)?.value);
  }
  if (period.cadence === "daily") {
    const current = finiteOrNull(series.get(period.periodEnd)?.value);
    if (current === null) return null;
    if (Number(period.periodEnd.slice(8, 10)) === 1) return current;
    const previousDate = addDays(period.periodEnd, -1);
    const previous = finiteOrNull(series.get(previousDate)?.value);
    if (previous === null) return null;
    return current - previous;
  }

  let total = 0;
  let segmentStart = period.periodStart;
  while (segmentStart <= period.periodEnd) {
    const segmentMonth = segmentStart.slice(0, 7);
    const monthEnd = monthEndFor(segmentStart);
    const segmentEnd = monthEnd < period.periodEnd ? monthEnd : period.periodEnd;
    const endValue = finiteOrNull(series.get(segmentEnd)?.value);
    if (endValue === null) return null;
    const baseline = Number(segmentStart.slice(8, 10)) === 1
      ? 0
      : finiteOrNull(series.get(addDays(segmentStart, -1))?.value);
    if (baseline === null) return null;
    total += endValue - baseline;
    segmentStart = addDays(segmentEnd, 1);
    if (segmentStart.slice(0, 7) === segmentMonth && segmentStart <= period.periodEnd) {
      throw new Error(`Unable to advance weekly segment from ${segmentEnd}.`);
    }
  }
  return total;
}

export async function getRtoReportReadiness({ runId = null } = {}) {
  const run = runId
    ? await loadRun(runId)
    : await loadLatestCohortRun();
  if (!run) {
    return {
      eligible: false,
      reason: "no_frozen_cohort",
      expectedRtos: RTO_REPORT_EXPECTED_COHORT_SIZE,
      expectedOems: RTO_REPORT_EXPECTED_OEMS,
      expectedOemRowsPerRto: RTO_REPORT_EXPECTED_OEM_ROWS_PER_RTO,
      cohortSize: 0,
      completeRtos: 0,
      missingRtos: [],
      run: null,
    };
  }

  const result = await query(
    `
      with cohort as (
        select state, rto
        from rto_daily_run_cohort_members
        where run_id = $1
      ),
      valid_reports as (
        select r.*
        from rto_daily_scrape_reports r
        join cohort c on c.state = r.state and c.rto = r.rto
        where r.run_id = $1
          and r.status = 'success'
          and r.report_total is not null
          and r.filters_confirmed = true
          and ${verifiedRtoSourceSql("r")}
          and r.metric_kind = '${RTO_DAILY_METRIC_KIND}'
      ),
      report_coverage as (
        select
          c.state,
          c.rto,
          count(r.id)::int as valid_reports,
          count(distinct concat(r.fuel_group, chr(124), r.vehicle_category))::int as valid_combos,
          coalesce(sum(r.source_row_count), 0)::int as expected_oem_rows
        from cohort c
        left join valid_reports r
          on r.state = c.state
         and r.rto = c.rto
        group by c.state, c.rto
      ),
      oem_coverage as (
        select
          c.state,
          c.rto,
          count(s.id) filter (
            where r.id is not null
              and s.scrape_status in ('success', 'late_fill')
          )::int as valid_oem_rows,
          count(distinct s.oem) filter (
            where r.id is not null
              and s.scrape_status in ('success', 'late_fill')
          )::int as valid_oems,
          count(distinct concat(s.fuel_group, chr(124), s.vehicle_category, chr(124), s.oem)) filter (
            where r.id is not null
              and s.scrape_status in ('success', 'late_fill')
          )::int as valid_oem_combos,
          count(s.id) filter (
            where r.id is not null
              and s.scrape_status in ('success', 'late_fill')
              and s.source_rank between 1 and 5
          )::int as ranked_oem_rows
        from cohort c
        left join rto_daily_snapshots s
          on s.scrape_run_id = $1
         and s.state = c.state
         and s.rto = c.rto
         and s.metric_kind = '${RTO_DAILY_METRIC_KIND}'
        left join valid_reports r on r.id = s.report_id
        group by c.state, c.rto
      ),
      report_fingerprints as (
        select state, rto,
          string_agg(evidence->'validation'->>'responseHash', '|' order by fuel_group, vehicle_category) as fingerprint
        from valid_reports
        group by state, rto
        having count(*) = 6 and sum(report_total) > 0
      ),
      duplicate_scopes as (
        select fingerprint from report_fingerprints group by fingerprint having count(*) > 1
      ),
      per_rto as (
        select
          reports.state,
          reports.rto,
          case when exists (
            select 1 from report_fingerprints f join duplicate_scopes d using (fingerprint)
            where f.state = reports.state and f.rto = reports.rto
          ) then 0 else reports.valid_reports end as valid_reports,
          reports.valid_combos,
          reports.expected_oem_rows,
          oems.valid_oem_rows,
          oems.valid_oem_combos,
          oems.ranked_oem_rows
        from report_coverage reports
        join oem_coverage oems using (state, rto)
      )
      select
        count(*)::int as cohort_size,
        count(*) filter (
          where valid_reports = 6
            and valid_combos = 6
            and expected_oem_rows between 0 and $2
            and valid_oem_rows = expected_oem_rows
            and valid_oem_combos = expected_oem_rows
            and ranked_oem_rows = expected_oem_rows
        )::int as complete_rtos,
        coalesce(
          jsonb_agg(
            jsonb_build_object(
              'state', state,
              'rto', rto,
              'validReports', valid_reports,
              'missingReports', greatest(0, 6 - valid_reports),
              'validOemRows', valid_oem_rows,
              'expectedOemRows', expected_oem_rows,
              'missingOemRows', greatest(0, expected_oem_rows - valid_oem_rows)
            )
            order by state, rto
          ) filter (
            where valid_reports <> 6
              or valid_combos <> 6
              or expected_oem_rows not between 0 and $2
              or valid_oem_rows <> expected_oem_rows
              or valid_oem_combos <> expected_oem_rows
              or ranked_oem_rows <> expected_oem_rows
          ),
          '[]'::jsonb
        ) as missing_rtos
      from per_rto
    `,
    [run.id, RTO_REPORT_EXPECTED_OEM_ROWS_PER_RTO],
  );
  const row = result.rows[0] ?? {};
  const cohortSize = Number(row.cohort_size ?? 0);
  const completeRtos = Number(row.complete_rtos ?? 0);
  let reason = null;
  if (cohortSize !== RTO_REPORT_EXPECTED_COHORT_SIZE) reason = "cohort_size_not_100";
  else if (completeRtos !== RTO_REPORT_EXPECTED_COHORT_SIZE) reason = "cohort_incomplete";
  return {
    eligible: reason === null,
    collectionEligible: reason === null,
    dailyRegistrationEligible: false,
    dailyRegistrationReason: DAILY_REGISTRATION_REASON,
    dailyRegistrationCoverage: 0,
    reason,
    expectedRtos: RTO_REPORT_EXPECTED_COHORT_SIZE,
    expectedOems: RTO_REPORT_EXPECTED_OEMS,
    expectedOemRowsPerRto: RTO_REPORT_EXPECTED_OEM_ROWS_PER_RTO,
    cohortSize,
    completeRtos,
    missingRtos: Array.isArray(row.missing_rtos) ? row.missing_rtos : [],
    run: normalizeRun(rowToCamel(run)),
  };
}

export async function materializeRtoReportFactsForRun({
  runId,
  includeAvailableHistory = false,
  from = null,
  to = null,
} = {}) {
  if (!runId) throw new Error("A source run id is required to materialize RTO report facts.");
  const run = await loadRun(runId);
  if (!run) throw new Error(`RTO daily run ${runId} was not found.`);
  const cohortCount = await query(
    "select count(*)::int as count from rto_daily_run_cohort_members where run_id = $1",
    [runId],
  );
  if (!Number(cohortCount.rows[0]?.count)) {
    return { runId: Number(runId), totals: 0, oems: 0, skipped: "no_frozen_cohort" };
  }

  const lowerDate = includeAvailableHistory ? dateOnly(from) : null;
  const upperDate = includeAvailableHistory ? dateOnly(to ?? run.snapshot_date) : null;
  const sourcePredicate = includeAvailableHistory
    ? `r.snapshot_date between coalesce($2::date, date '1900-01-01') and coalesce($3::date, $4::date)`
    : "r.run_id = $1";
  const sourceParams = includeAvailableHistory
    ? [runId, lowerDate, upperDate, dateOnly(run.snapshot_date)]
    : [runId];
  const anomalyParam = `$${sourceParams.length + 1}`;

  return transaction(async (tx) => {
    const totals = await tx(
      `
        with cohort as (
          select state, rto
          from rto_daily_run_cohort_members
          where run_id = $1
        ),
        selected_reports as (
          select r.*
          from rto_daily_scrape_reports r
          join cohort c on c.state = r.state and c.rto = r.rto
          where ${sourcePredicate}
            and r.status = 'success'
            and r.report_total is not null
            and r.metric_kind = '${RTO_DAILY_METRIC_KIND}'
            and ${verifiedRtoSourceSql("r")}
        ),
        oem_totals as (
          select
            s.report_id,
            coalesce(sum(s.vehicle_count), 0)::int as tracked_oem_total,
            bool_or(s.scrape_status = 'late_fill') as late_fill
          from rto_daily_snapshots s
          join selected_reports r on r.id = s.report_id
          where s.metric_kind = '${RTO_DAILY_METRIC_KIND}'
          group by s.report_id
        )
        insert into rto_daily_report_totals (
          snapshot_date, target_month, state, rto, fuel_group, vehicle_category,
          report_total, tracked_oem_total, untracked_total, source_run_id, source_report_id,
          filters_confirmed, explicit_zero, scrape_status, quality_status, quality_flags,
          metric_kind, source, scraped_at
        )
        select
          r.snapshot_date,
          r.target_month,
          r.state,
          r.rto,
          r.fuel_group,
          r.vehicle_category,
          r.report_total,
          coalesce(o.tracked_oem_total, 0),
          case
            when r.report_total >= coalesce(o.tracked_oem_total, 0)
            then r.report_total - coalesce(o.tracked_oem_total, 0)
            else null
          end,
          r.run_id,
          r.id,
          r.filters_confirmed,
          r.explicit_zero,
          case when coalesce(o.late_fill, false) then 'late_fill' else 'success' end,
          case
            when (r.metric_kind <> 'active_stock' and r.report_total > ${anomalyParam})
              or r.filters_confirmed is not true
              or coalesce(o.tracked_oem_total, 0) > r.report_total
            then 'needs_review'
            else 'ready'
          end,
          jsonb_build_object(
            'reportTotalAboveSanityLimit', r.metric_kind <> 'active_stock' and r.report_total > ${anomalyParam},
            'filtersUnconfirmed', r.filters_confirmed is not true,
            'trackedOemExceedsReportTotal', coalesce(o.tracked_oem_total, 0) > r.report_total
          ),
          r.metric_kind,
          r.source,
          r.scraped_at
        from selected_reports r
        left join oem_totals o on o.report_id = r.id
        on conflict (snapshot_date, target_month, state, rto, fuel_group, vehicle_category)
        do update set
          report_total = excluded.report_total,
          tracked_oem_total = excluded.tracked_oem_total,
          untracked_total = excluded.untracked_total,
          source_run_id = excluded.source_run_id,
          source_report_id = excluded.source_report_id,
          filters_confirmed = excluded.filters_confirmed,
          explicit_zero = excluded.explicit_zero,
          scrape_status = excluded.scrape_status,
          quality_status = excluded.quality_status,
          quality_flags = excluded.quality_flags,
          metric_kind = excluded.metric_kind,
          source = excluded.source,
          scraped_at = excluded.scraped_at,
          updated_at = now()
      `,
      [...sourceParams, RTO_REPORT_ANOMALY_TOTAL_MAX],
    );

    const snapshotPredicate = includeAvailableHistory
      ? `s.snapshot_date between coalesce($2::date, date '1900-01-01') and coalesce($3::date, $4::date)`
      : "s.scrape_run_id = $1";
    const oems = await tx(
      `
        with cohort as (
          select state, rto
          from rto_daily_run_cohort_members
          where run_id = $1
        )
        insert into rto_daily_oem_totals (
          snapshot_date, target_month, state, rto, fuel_group, vehicle_category,
          oem, vehicle_count, source_rank, metric_kind, source, source_run_id, scrape_status, scraped_at
        )
        select
          s.snapshot_date,
          s.target_month,
          s.state,
          s.rto,
          s.fuel_group,
          s.vehicle_category,
          s.oem,
          s.vehicle_count,
          s.source_rank,
          s.metric_kind,
          s.source,
          s.scrape_run_id,
          case when s.scrape_status = 'late_fill' then 'late_fill' else 'success' end,
          s.scraped_at
        from rto_daily_snapshots s
        join cohort c on c.state = s.state and c.rto = s.rto
        join rto_daily_scrape_reports r
          on r.id = s.report_id
         and r.status = 'success'
         and r.report_total is not null
         and r.filters_confirmed = true
         and ${verifiedRtoSourceSql("r")}
        where ${snapshotPredicate}
          and s.metric_kind = '${RTO_DAILY_METRIC_KIND}'
        on conflict (snapshot_date, target_month, state, rto, fuel_group, vehicle_category, oem)
        do update set
          vehicle_count = excluded.vehicle_count,
          source_rank = excluded.source_rank,
          metric_kind = excluded.metric_kind,
          source = excluded.source,
          source_run_id = excluded.source_run_id,
          scrape_status = excluded.scrape_status,
          scraped_at = excluded.scraped_at,
          updated_at = now()
      `,
      sourceParams,
    );
    return {
      runId: Number(runId),
      totals: totals.rowCount,
      oems: oems.rowCount,
      history: includeAvailableHistory,
      from: lowerDate,
      to: upperDate,
    };
  });
}

export function buildRtoReportPayloads({
  period,
  cohort = [],
  totalRows = [],
  oemRows = [],
  generatedAt = new Date(),
} = {}) {
  if (!period?.cadence || !period?.periodStart || !period?.periodEnd) {
    throw new Error("A complete report period is required.");
  }
  const normalizedCohort = cohort
    .map(normalizeCohortMember)
    .sort((a, b) => a.selectionRank - b.selectionRank || compareRto(a, b));
  const totals = totalRows.map(normalizeTotalRow);
  const oems = oemRows.map(normalizeOemRow);
  const totalIndex = buildSeriesIndex(totals, (row) => comboKey(row.fuelGroup, row.vehicleCategory), "reportTotal");
  const untrackedIndex = buildSeriesIndex(totals, (row) => comboKey(row.fuelGroup, row.vehicleCategory), "untrackedTotal");
  const oemIndex = buildSeriesIndex(oems, (row) => oemComboKey(row.fuelGroup, row.vehicleCategory, row.oem), "vehicleCount");
  const previousPeriod = previousReportPeriod(period);

  const reports = normalizedCohort.map((member) => {
    const warnings = [];
    const currentFacts = totals.filter((row) =>
      row.state === member.state &&
      row.rto === member.rto &&
      row.snapshotDate === period.periodEnd);
    const lateFill = currentFacts.some((row) => row.scrapeStatus === "late_fill");
    const qualityFlags = currentFacts
      .filter((row) => row.qualityStatus === "needs_review")
      .map((row) => ({
        fuelGroup: row.fuelGroup,
        vehicleCategory: row.vehicleCategory,
        ...row.qualityFlags,
      }));
    const currentCoverage = currentFacts.length > 0;
    if (lateFill) warnings.push("The source cycle completed after midnight and is recorded as a late fill.");
    if (qualityFlags.length) warnings.push("One or more headline source totals require review.");
    if (!currentCoverage) {
      warnings.push("No completed VAHAN data is available for this RTO in the selected source cycle; this RTO is shown as unavailable until collection succeeds.");
    }

    const currentPeriodMetrics = metricTotalsForPeriod(totalIndex, member, period);
    const currentStockMetrics = metricTotalsAtDate(totalIndex, member, period.periodEnd);
    const baselineDate = addDays(period.periodStart, -1);
    const baselineStockMetrics = metricTotalsAtDate(totalIndex, member, baselineDate);

    if (currentPeriodMetrics.ev === null || currentPeriodMetrics.ice === null) {
      const hasCurrentStock = [currentStockMetrics.ev, currentStockMetrics.ice].some(Number.isFinite);
      warnings.push(
        hasCurrentStock
          ? period.cadence === "daily"
            ? "The previous-day source baseline is missing, so daily registrations are shown as N/A while the current snapshot remains available."
            : `The ${period.cadence} baseline stock snapshot is missing, so net movement is shown as N/A while current stock remains available.`
          : period.cadence === "daily"
            ? "The daily source boundary is incomplete, so daily registrations cannot be calculated precisely."
            : `The ${period.cadence} stock boundary is incomplete, so net movement cannot be stated precisely.`,
      );
    }

    const categories = ["2W", "3W", "4W"].map((vehicleCategory) => {
      const currentEv = metricValue(totalIndex, member, "EV", vehicleCategory, period);
      const currentIce = metricValue(totalIndex, member, "ICE", vehicleCategory, period);
      const previousEv = metricValueAtDate(totalIndex, member, "EV", vehicleCategory, baselineDate);
      const previousIce = metricValueAtDate(totalIndex, member, "ICE", vehicleCategory, baselineDate);
      const stockEv = metricValueAtDate(totalIndex, member, "EV", vehicleCategory, period.periodEnd);
      const stockIce = metricValueAtDate(totalIndex, member, "ICE", vehicleCategory, period.periodEnd);
      return {
        vehicleCategory,
        period: { ev: currentEv, ice: currentIce, total: sumNullable([currentEv, currentIce]) },
        previousPeriod: { ev: previousEv, ice: previousIce, total: sumNullable([previousEv, previousIce]) },
        stock: { ev: stockEv, ice: stockIce, total: sumNullable([stockEv, stockIce]) },
      };
    });

    const memberOemNames = unique(
      oems
        .filter((row) => row.state === member.state && row.rto === member.rto)
        .map((row) => row.oem),
    );
    const oemMetrics = memberOemNames.map((oem) =>
      buildOemMetric({ index: oemIndex, member, oem, period }));
    const untrackedMetric = buildOemMetric({
      index: untrackedIndex,
      member,
      oem: "Other / untracked",
      period,
      untracked: true,
    });
    if (untrackedMetric.hasData) oemMetrics.push(untrackedMetric);
    oemMetrics.sort((a, b) =>
      numberForSort(b.period.total) - numberForSort(a.period.total) ||
      a.oem.localeCompare(b.oem));

    const trendStart = period.cadence === "daily"
      ? addDays(period.periodEnd, -13)
      : period.periodStart;
    const trend = dateRange(trendStart, period.periodEnd).map((date) => {
      const values = metricTotalsAtDate(totalIndex, member, date);
      return {
        date,
        ev: values.ev,
        ice: values.ice,
        total: values.total,
        complete: values.ev !== null && values.ice !== null,
      };
    });
    if (trend.some((row) => !row.complete)) {
      warnings.push("Some dates are unavailable in the supporting daily trend.");
    }

    const periodTotal = currentPeriodMetrics.total;
    const stockTotal = currentStockMetrics.total;
    const evShare = share(currentStockMetrics.ev, stockTotal);
    const previousTotal = baselineStockMetrics.total;
    const status = reportStatus({
      needsReview:
        qualityFlags.length > 0 ||
        currentStockMetrics.ev === null ||
        currentStockMetrics.ice === null,
      hasWarnings: warnings.length > 0,
    });

    return {
      state: member.state,
      rto: member.rto,
      selectionRank: member.selectionRank,
      cohortRank: null,
      previousRank: null,
      rankValue: currentStockMetrics.ev,
      previousRankValue: baselineStockMetrics.ev,
      status,
      currentCoverage,
      summary: "",
      periodEv: currentPeriodMetrics.ev,
      periodIce: currentPeriodMetrics.ice,
      mtdEv: currentStockMetrics.ev,
      mtdIce: currentStockMetrics.ice,
      evShare,
      payload: {
        kind: "rto-active-stock-report",
        metricKind: RTO_DAILY_METRIC_KIND,
        generatedAt: new Date(generatedAt).toISOString(),
        cadence: period.cadence,
        period: {
          start: period.periodStart,
          end: period.periodEnd,
          label: periodLabel(period),
          comparisonStart: previousPeriod.periodStart,
          comparisonEnd: previousPeriod.periodEnd,
        },
        rto: {
          state: member.state,
          name: member.rto,
          selectionRank: member.selectionRank,
          cohortRank: null,
          previousRank: null,
        },
        status,
        summary: "",
        metrics: {
          period: {
            ev: currentPeriodMetrics.ev,
            ice: currentPeriodMetrics.ice,
            total: periodTotal,
            evShare: share(currentPeriodMetrics.ev, periodTotal),
          },
          previousPeriod: {
            ev: baselineStockMetrics.ev,
            ice: baselineStockMetrics.ice,
            total: previousTotal,
            evShare: share(baselineStockMetrics.ev, previousTotal),
          },
          stock: {
            ev: currentStockMetrics.ev,
            ice: currentStockMetrics.ice,
            total: stockTotal,
            evShare,
          },
          change: {
            ev: comparison(currentStockMetrics.ev, baselineStockMetrics.ev),
            ice: comparison(currentStockMetrics.ice, baselineStockMetrics.ice),
            total: comparison(stockTotal, previousTotal),
          },
        },
        categories,
        oems: oemMetrics.map(({ hasData, ...row }) => row),
        trend,
        quality: {
          currentCoverage,
          lateFill,
          warnings: unique(warnings),
          sourceFlags: qualityFlags,
        },
        source: {
          collectedFrom: currentFacts.map(row => row.scrapedAt).filter(Boolean).sort()[0] ?? null,
          collectedTo: currentFacts.map(row => row.scrapedAt).filter(Boolean).sort().at(-1) ?? null,
          validationContract: "public-stock-v2",
          registrationFlowAvailable: false,
          limitation: period.cadence === "daily"
            ? DAILY_REGISTRATION_REASON
            : "These are active vehicle-stock observations. Net stock change includes corrections and status changes; it is not new registrations. Unchanged observations do not establish source freshness.",
          totalsTable: "rto_daily_scrape_reports.report_total",
          oemTable: "rto_daily_snapshots.vehicle_count",
          metricKind: RTO_DAILY_METRIC_KIND,
          sourceSystem: "vahan-public-dashboard",
          metricTreatment: "Active vehicle-stock snapshots with net movement derived from exact calendar boundaries",
        },
      },
    };
  });

  assignRanks(reports, "rankValue", "cohortRank");
  assignRanks(reports, "previousRankValue", "previousRank");
  for (const report of reports) {
    report.summary = deterministicSummary(report, period);
    report.payload.summary = report.summary;
    report.payload.rto.cohortRank = report.cohortRank;
    report.payload.rto.previousRank = report.previousRank;
    delete report.rankValue;
    delete report.previousRankValue;
  }
  return reports.map(unavailableDailyRegistrationReport);
}

export async function reconcileRtoReportsForRun({
  runId,
  includeAvailableHistory = false,
  historyFrom = null,
} = {}) {
  const readiness = await getRtoReportReadiness({ runId });
  if (!readiness.eligible) return { readiness, materialized: null, batches: [] };
  if (!readiness.run || !["partial", "success"].includes(readiness.run.status)) {
    return { readiness, materialized: null, batches: [] };
  }
  if (readiness.cohortSize !== RTO_REPORT_EXPECTED_COHORT_SIZE) {
    return { readiness, materialized: null, batches: [] };
  }
  const materialized = await materializeRtoReportFactsForRun({
    runId,
    includeAvailableHistory,
    from: historyFrom,
    to: readiness.run.snapshotDate,
  });
  const periods = reportPeriodsForSnapshotDate(readiness.run.snapshotDate);
  const batches = [];
  for (const period of periods) {
    batches.push(await generateRtoReportBatch({ runId, period }));
  }
  return { readiness, materialized, batches };
}

export async function reconcileRecentRtoReports({ limit = 30 } = {}) {
  const result = await query(
    `
      select r.id, r.snapshot_date
      from rto_daily_collection_runs r
      join rto_daily_run_cohort_members c on c.run_id = r.id
      where r.snapshot_date is not null
      group by r.id, r.snapshot_date
      having count(*) = $1
      order by r.snapshot_date desc, r.id desc
      limit $2
    `,
    [RTO_REPORT_EXPECTED_COHORT_SIZE, boundedInt(limit, 1, 365, 30)],
  );
  const runs = [];
  for (const row of result.rows.reverse()) {
    runs.push(await reconcileRtoReportsForRun({ runId: Number(row.id) }));
  }
  return { runs };
}

export async function generateRtoReportBatch({ runId, period } = {}) {
  const run = await loadRun(runId);
  if (!run) throw new Error(`RTO daily run ${runId} was not found.`);
  const inputs = await loadReportInputs({ runId, period });
  if (inputs.cohort.length !== RTO_REPORT_EXPECTED_COHORT_SIZE) {
    throw new Error(`Report generation requires 100 frozen RTOs; found ${inputs.cohort.length}.`);
  }
  const sourceChecksum = checksum({
    payloadVersion: RTO_REPORT_PAYLOAD_VERSION,
    period,
    cohort: inputs.cohort,
    totals: inputs.totalRows,
    oems: inputs.oemRows,
  });
  const existing = await findReportBatch({
    cadence: period.cadence,
    periodStart: period.periodStart,
    periodEnd: period.periodEnd,
    cohortHash: run.report_cohort_hash,
  });
  if (
    existing?.source_checksum === sourceChecksum &&
    Number(existing.report_count) === RTO_REPORT_EXPECTED_COHORT_SIZE &&
    !["failed", "queued", "generating"].includes(existing.status)
  ) {
    return { batch: normalizeBatch(existing), generated: false, reason: "unchanged" };
  }

  const batch = await transaction(async (tx) => {
    const result = await tx(
      `
        insert into rto_report_batches (
          cadence, period_start, period_end, source_snapshot_date, source_run_id,
          cohort_hash, cohort_size, status, revision, coverage_count, source_checksum,
          late_fill, quality_summary, updated_at
        ) values ($1,$2::date,$3::date,$4::date,$5,$6,$7,'generating',1,$7,$8,$9,'{}'::jsonb,now())
        on conflict (cadence, period_start, period_end, cohort_hash)
        do update set
          source_snapshot_date = excluded.source_snapshot_date,
          source_run_id = excluded.source_run_id,
          cohort_size = excluded.cohort_size,
          status = 'generating',
          revision = case
            when rto_report_batches.source_checksum is distinct from excluded.source_checksum
            then rto_report_batches.revision + 1
            else rto_report_batches.revision
          end,
          coverage_count = excluded.coverage_count,
          source_checksum = excluded.source_checksum,
          late_fill = excluded.late_fill,
          last_error = null,
          updated_at = now()
        returning *
      `,
      [
        period.cadence,
        period.periodStart,
        period.periodEnd,
        dateOnly(run.snapshot_date),
        run.id,
        run.report_cohort_hash,
        inputs.cohort.length,
        sourceChecksum,
        inputs.totalRows.some((row) =>
          dateOnly(row.snapshot_date ?? row.snapshotDate) === dateOnly(run.snapshot_date) &&
          (row.scrape_status ?? row.scrapeStatus) === "late_fill"),
      ],
    );
    return result.rows[0];
  });

  try {
    const reports = buildRtoReportPayloads({
      period,
      cohort: inputs.cohort,
      totalRows: inputs.totalRows,
      oemRows: inputs.oemRows,
    });
    const reviewCount = reports.filter((report) => report.status === "needs_review").length;
    const warningCount = reports.filter((report) => report.status === "ready_with_warnings").length;
    const batchStatus = reviewCount
      ? "needs_review"
      : warningCount
        ? "ready_with_warnings"
        : "ready";
    const saved = await saveGeneratedReports({
      batchId: Number(batch.id),
      reports,
      batchStatus,
      reviewCount,
      warningCount,
      lateFill: reports.some((report) => report.payload.quality.lateFill),
    });
    return { batch: saved, generated: true, reports: reports.length };
  } catch (error) {
    await query(
      `
        update rto_report_batches
        set status = 'failed', last_error = $2, updated_at = now()
        where id = $1
      `,
      [batch.id, String(error.message ?? error).slice(0, 4000)],
    );
    throw error;
  }
}

export async function listRtoReportBatches({
  cadence = null,
  from = null,
  to = null,
  status = null,
  limit = 100,
} = {}) {
  const values = [];
  const clauses = [];
  if (cadence) {
    if (!RTO_REPORT_CADENCES.includes(cadence)) throw inputError("Unknown report cadence.");
    values.push(cadence);
    clauses.push(`cadence = $${values.length}`);
  }
  if (from) {
    values.push(dateOnly(from));
    clauses.push(`period_end >= $${values.length}::date`);
  }
  if (to) {
    values.push(dateOnly(to));
    clauses.push(`period_end <= $${values.length}::date`);
  }
  if (status) {
    values.push(status);
    clauses.push(`(case when verified_report_count < report_count then 'needs_review' else status end) = $${values.length}`);
  }
  values.push(boundedInt(limit, 1, 500, 100));
  const result = await query(
    `
      select *
      from (${batchReadSql}) batches
      ${clauses.length ? `where ${clauses.join(" and ")}` : ""}
      order by period_end desc, cadence asc, revision desc
      limit $${values.length}
    `,
    values,
  );
  return result.rows.map(normalizeBatch);
}

const batchReadSql = `select b.*, stats.verified_report_count, stats.runtime_review_count, stats.runtime_warning_count
  from rto_report_batches b
  cross join lateral (
    select count(*) filter (where b.cadence <> 'daily' and payload->'source'->>'validationContract' = 'public-stock-v2')::int as verified_report_count,
      count(*) filter (where b.cadence = 'daily' or payload->'source'->>'validationContract' is distinct from 'public-stock-v2' or status = 'needs_review')::int as runtime_review_count,
      count(*) filter (where b.cadence <> 'daily' and payload->'source'->>'validationContract' = 'public-stock-v2' and status = 'ready_with_warnings')::int as runtime_warning_count
    from rto_reports where batch_id = b.id
  ) stats`;

export async function getRtoReportBatch(batchId) {
  const result = await query(`select * from (${batchReadSql}) batches where id = $1`, [batchId]);
  return result.rows[0] ? normalizeBatch(result.rows[0]) : null;
}

export async function listRtoReportsForBatch(batchId, {
  q = null,
  state = null,
  status = null,
  limit = 100,
  offset = 0,
} = {}) {
  const values = [batchId];
  const clauses = ["rr.batch_id = $1"];
  if (q) {
    values.push(`%${String(q).trim()}%`);
    clauses.push(`(rr.state ilike $${values.length} or rr.rto ilike $${values.length})`);
  }
  if (state) {
    values.push(state);
    clauses.push(`rr.state = $${values.length}`);
  }
  if (status) {
    values.push(status);
    clauses.push(`(case when b.cadence <> 'daily' and rr.payload->'source'->>'validationContract' = 'public-stock-v2' then rr.status else 'needs_review' end) = $${values.length}`);
  }
  values.push(boundedInt(limit, 1, 500, 100));
  const limitIndex = values.length;
  values.push(boundedInt(offset, 0, 100_000, 0));
  const offsetIndex = values.length;
  const result = await query(
    `
      select
        rr.id, rr.batch_id, rr.state, rr.rto, rr.selection_rank, rr.cohort_rank, rr.previous_rank,
        rr.status, rr.period_ev, rr.period_ice, rr.mtd_ev, rr.mtd_ice, rr.ev_share, rr.summary, rr.generated_at,
        rr.payload->'source'->>'validationContract' as validation_contract,
        b.cadence, b.period_end, rr.payload->'source' as source
      from rto_reports rr join rto_report_batches b on b.id = rr.batch_id
      where ${clauses.join(" and ")}
      order by cohort_rank nulls last, selection_rank, state, rto
      limit $${limitIndex}
      offset $${offsetIndex}
    `,
    values,
  );
  return result.rows.map(normalizeReportSummary);
}

export async function getRtoReport(reportId) {
  const result = await query(
    `
      select
        rr.*,
        b.cadence,
        b.period_start,
        b.period_end,
        b.source_snapshot_date,
        b.source_run_id,
        b.cohort_hash,
        b.cohort_size,
        b.revision,
        b.status as batch_status,
        b.source_checksum,
        b.generated_at as batch_generated_at
      from rto_reports rr
      join rto_report_batches b on b.id = rr.batch_id
      where rr.id = $1
    `,
    [reportId],
  );
  return result.rows[0] ? normalizeFullReport(result.rows[0]) : null;
}

export async function latestRtoReportReadiness() {
  return getRtoReportReadiness();
}

export function renderRtoReportCsv(report) {
  const rows = reportCsvRows(report);
  return rows.map((row) => row.map(csvCell).join(",")).join("\n") + "\n";
}

export async function renderRtoReportBatchCsv(batchId) {
  const batch = await getRtoReportBatch(batchId);
  if (!batch) return null;
  const summaries = await listRtoReportsForBatch(batchId, { limit: 500 });
  const header = reportCsvRows({
    ...summaries[0],
    cadence: batch.cadence,
    periodStart: batch.periodStart,
    periodEnd: batch.periodEnd,
    payload: { oems: [] },
  })[0];
  const rows = [header];
  for (const summary of summaries) {
    const report = await getRtoReport(summary.id);
    rows.push(...reportCsvRows(report).slice(1));
  }
  return {
    batch,
    content: rows.map((row) => row.map(csvCell).join(",")).join("\n") + "\n",
  };
}

export function renderRtoReportHtml(report) {
  const payload = unavailableDailyRegistrationReport(report?.payload ? report : { payload: report }).payload;
  if (!payload?.rto || !payload?.period) throw new Error("A complete RTO report is required.");
  if (payload.cadence === "daily") {
    const daily = payload.dailyRegistration;
    const fields = [["Previous-day registrations", daily.previousDayRegistrations], ["EV registrations", daily.evRegistrations],
      ["ICE registrations", daily.iceRegistrations], ["EV share", daily.evShare], ["Daily EV rank", daily.rank]];
    return `<!doctype html><html lang="en"><meta charset="utf-8"><title>${escapeHtml(payload.rto.name)} Daily Report</title>
      <style>${reportThemeCss} body{font-family:Arial,sans-serif;padding:32px}table{border-collapse:collapse;width:100%}td,th{text-align:left;padding:12px;border-bottom:1px solid #ddd}</style>
      <h1>${escapeHtml(payload.rto.name)}</h1><p>${escapeHtml(payload.period.label)} · Asia/Kolkata</p>
      <h2>Daily registrations unavailable</h2><p>${escapeHtml(daily.reason)}</p>
      <table><thead><tr><th>Metric</th><th>Date (IST)</th><th>Value</th><th>Reason</th></tr></thead><tbody>
      ${fields.map(([label,field])=>`<tr><td>${label}</td><td>${escapeHtml(field.date)}</td><td>Unavailable</td><td>${escapeHtml(field.reason)}</td></tr>`).join("")}</tbody></table>
      <p>Source: VAHAN Public Dashboard. ${escapeHtml(payload.source.freshnessReason)}</p></html>`;
  }
  const metrics = payload.metrics ?? {};
  const warnings = payload.quality?.warnings ?? [];
  const trend = payload.trend ?? [];
  const categories = payload.categories ?? [];
  const oems = payload.oems ?? [];
  const explanations = Array.isArray(report?.explanations)
    ? report.explanations
    : Array.isArray(payload.explanations)
      ? payload.explanations
      : [];
  const title = `${payload.rto.name} ${capitalize(payload.cadence)} Report`;
  const statusText = statusLabel(payload.status);
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>${escapeHtml(title)}</title>
  <style>
    :root { color-scheme: light; font-family: Arial, sans-serif; color: #17201f; background: #f5f7f7; }
    * { box-sizing: border-box; }
    body { margin: 0; background: #f5f7f7; line-height: 1.45; }
    main { width: min(980px, calc(100% - 32px)); margin: 0 auto; padding: 30px 0 46px; }
    header { border-bottom: 3px solid #147d64; padding-bottom: 18px; }
    h1 { margin: 4px 0; font-size: 30px; letter-spacing: 0; }
    h2 { margin: 28px 0 12px; font-size: 18px; letter-spacing: 0; }
    p { margin: 8px 0; }
    .eyebrow { color: #4c6260; font-size: 12px; font-weight: 700; text-transform: uppercase; }
    .status { display: inline-block; margin-top: 8px; padding: 4px 8px; border: 1px solid #9fb7b3; border-radius: 4px; font-size: 12px; font-weight: 700; }
    .status.needs-review { border-color: #c7574c; color: #8b2921; background: #fff0ee; }
    .status.ready-with-warnings { border-color: #c58a22; color: #77500b; background: #fff7e7; }
    .summary { font-size: 16px; max-width: 780px; }
    .metrics { display: grid; grid-template-columns: repeat(4, minmax(0,1fr)); gap: 10px; margin-top: 18px; }
    .metric { border: 1px solid #cad7d5; border-radius: 6px; padding: 12px; background: #fff; }
    .metric span { display: block; color: #61716f; font-size: 11px; text-transform: uppercase; font-weight: 700; }
    .metric strong { display: block; margin-top: 5px; font-size: 22px; }
    .chart { border: 1px solid #cad7d5; border-radius: 6px; background: #fff; padding: 12px; }
    svg { display: block; width: 100%; height: 260px; }
    .trend-chart-bg { fill: #f8fbfa; stroke: #d7e2e0; }
    .trend-grid { stroke: #dce5e3; stroke-width: 1; }
    .trend-axis { stroke: #91a6a2; stroke-width: 1.2; }
    .trend-y-label, .trend-x-label { fill: #657572; font-size: 11px; }
    .trend-ev, .trend-ice { fill: none; stroke-width: 3; stroke-linecap: round; stroke-linejoin: round; }
    .trend-ev { stroke: #147d64; }
    .trend-ice { stroke: #3f6fa8; }
    .trend-point { fill: #fff; stroke-width: 2.4; }
    .trend-point.ev { stroke: #147d64; }
    .trend-point.ice { stroke: #3f6fa8; }
    .legend { display: flex; gap: 18px; font-size: 12px; color: #526562; }
    .legend i { display: inline-block; width: 10px; height: 10px; margin-right: 5px; border-radius: 2px; background: #147d64; }
    .legend i.ice { background: #3f6fa8; }
    table { width: 100%; border-collapse: collapse; background: #fff; font-size: 12px; }
    th, td { padding: 8px 9px; border: 1px solid #d7e0df; text-align: right; }
    th:first-child, td:first-child { text-align: left; }
    th { background: #eef3f2; }
    .warnings { border-left: 4px solid #c58a22; padding: 10px 14px; background: #fff7e7; }
    .warnings li { margin: 5px 0; }
    .context-card { border: 1px solid #9fc9bf; border-left: 4px solid #147d64; border-radius: 6px; padding: 14px; background: #f2faf7; break-inside: avoid; }
    .context-card + .context-card { margin-top: 10px; }
    .context-label { color: #11604f; font-size: 11px; font-weight: 700; letter-spacing: .04em; text-transform: uppercase; }
    .context-card h3 { margin: 5px 0 8px; font-size: 16px; }
    .context-card p { max-width: 820px; }
    .context-sources { margin: 8px 0 0; padding-left: 18px; font-size: 11px; }
    .context-sources a { color: #11604f; overflow-wrap: anywhere; }
    .context-caveat { color: #526562; font-size: 11px; }
    .source { color: #657572; font-size: 11px; }
    @media (max-width: 720px) { .metrics { grid-template-columns: repeat(2,minmax(0,1fr)); } }
    @media print { body { background: #fff; } main { width: 100%; padding: 0; } .metric, .chart, table { break-inside: avoid; } }
  ${reportThemeCss}
  </style>
</head>
<body>
<main>
  <header>
    <div class="eyebrow">${escapeHtml(payload.rto.state)} | ${escapeHtml(payload.period.label)}</div>
    <h1>${escapeHtml(payload.rto.name)}</h1>
    <p class="summary">${escapeHtml(payload.summary)}</p>
    <span class="status ${escapeHtml(payload.status.replaceAll("_", "-"))}">${escapeHtml(statusText)}</span>
  </header>
  <section class="metrics" aria-label="Headline metrics">
    ${metricHtml("Active EV stock", metrics.stock?.ev, `Net ${formatSigned(metrics.period?.ev)}`)}
    ${metricHtml("Active ICE stock", metrics.stock?.ice, `Net ${formatSigned(metrics.period?.ice)}`)}
    ${metricHtml("EV stock share", formatPercent(metrics.stock?.evShare))}
    ${metricHtml("EV stock rank", payload.rto.cohortRank ? `#${payload.rto.cohortRank}` : "N/A")}
  </section>
  ${warnings.length ? `<section><h2>Data quality</h2><div class="warnings"><ul>${warnings.map((warning) => `<li>${escapeHtml(warning)}</li>`).join("")}</ul></div></section>` : ""}
  ${explanations.length ? `<section><h2>Possible drivers behind the numbers</h2>${explanations.map(renderRtoExplanationHtml).join("")}</section>` : ""}
  <section>
    <h2>Active vehicle stock</h2>
    <div class="chart">${renderTrendSvg(trend)}<div class="legend"><span><i></i>EV</span><span><i class="ice"></i>ICE</span></div></div>
  </section>
  <section>
    <h2>Vehicle categories</h2>
    <table>
      <thead><tr><th>Category</th><th>EV stock</th><th>ICE stock</th><th>Total stock</th><th>EV net movement</th><th>ICE net movement</th></tr></thead>
      <tbody>${categories.map((row) => `<tr><td>${escapeHtml(row.vehicleCategory)}</td><td>${formatNumber(row.stock?.ev)}</td><td>${formatNumber(row.stock?.ice)}</td><td>${formatNumber(row.stock?.total)}</td><td>${formatSigned(row.period?.ev)}</td><td>${formatSigned(row.period?.ice)}</td></tr>`).join("")}</tbody>
    </table>
  </section>
  <section>
    <h2>Dynamic top-maker stock by vehicle category</h2>
    <table>
      <thead><tr><th>OEM</th><th>Category</th><th>EV stock</th><th>ICE stock</th><th>Total stock</th><th>Baseline</th><th>Net movement</th></tr></thead>
      <tbody>${oemCategoryRows(oems).map((row) => `<tr><td>${escapeHtml(row.oem)}</td><td>${escapeHtml(row.vehicleCategory)}</td><td>${formatNumber(row.stock?.ev)}</td><td>${formatNumber(row.stock?.ice)}</td><td>${formatNumber(row.stock?.total)}</td><td>${formatNumber(row.previousPeriod?.total)}</td><td>${formatSigned(row.period?.total)}</td></tr>`).join("")}</tbody>
    </table>
  </section>
  <p class="source">Metric: active vehicle stock. Source: VAHAN Public Dashboard. Generated ${escapeHtml(humanDateTime(payload.generatedAt))}.</p>
</main>
</body>
</html>`;
}

export async function loadCachedRtoReportExport({ scopeType, scopeId, format, revision }) {
  const result = await query(
    `
      select *
      from rto_report_exports
      where scope_type = $1 and scope_id = $2 and format = $3 and revision = $4
        and expires_at > now()
      limit 1
    `,
    [scopeType, scopeId, format, revision],
  );
  const row = result.rows[0];
  if (!row) return null;
  const resolved = safeExportPath(row.storage_path);
  const content = resolved ? await fs.readFile(resolved).catch(() => null) : null;
  if (!content) {
    await query("delete from rto_report_exports where id = $1", [row.id]);
    return null;
  }
  return { metadata: rowToCamel(row), content };
}

export async function saveRtoReportExport({
  scopeType,
  scopeId,
  format,
  revision,
  content,
  maxAgeDays = 30,
} = {}) {
  if (!["report", "batch"].includes(scopeType)) throw new Error("Invalid export scope.");
  if (!["pdf", "csv"].includes(format)) throw new Error("Invalid export format.");
  const buffer = Buffer.isBuffer(content) ? content : Buffer.from(String(content), "utf8");
  const relativePath = path.join(
    scopeType,
    String(scopeId),
    `${format}-r${revision}.${format}`,
  ).replaceAll("\\", "/");
  const resolved = safeExportPath(relativePath);
  if (!resolved) throw new Error("Invalid RTO report export path.");
  await fs.mkdir(path.dirname(resolved), { recursive: true });
  await fs.writeFile(resolved, buffer);
  const digest = crypto.createHash("sha256").update(buffer).digest("hex");
  const result = await query(
    `
      insert into rto_report_exports (
        scope_type, scope_id, format, revision, storage_path, checksum, byte_size, expires_at
      ) values ($1,$2,$3,$4,$5,$6,$7,now() + make_interval(days => $8))
      on conflict (scope_type, scope_id, format, revision)
      do update set
        storage_path = excluded.storage_path,
        checksum = excluded.checksum,
        byte_size = excluded.byte_size,
        expires_at = excluded.expires_at,
        updated_at = now()
      returning *
    `,
    [scopeType, scopeId, format, revision, relativePath, digest, buffer.length, boundedInt(maxAgeDays, 1, 365, 30)],
  );
  return { metadata: rowToCamel(result.rows[0]), content: buffer };
}

export async function invalidateRtoReportExports(reportId) {
  const result = await query(
    `
      delete from rto_report_exports
      where scope_type = 'report' and scope_id = $1
      returning storage_path
    `,
    [reportId],
  );
  await Promise.all(result.rows.map(async (row) => {
    const resolved = safeExportPath(row.storage_path);
    if (resolved) await fs.rm(resolved, { force: true }).catch(() => {});
  }));
  return { deleted: result.rowCount ?? result.rows.length };
}

export function rtoReportExportRevision(report, format) {
  const revision = Number(report?.revision ?? 1);
  return revision * 100 + (format === "pdf" ? RTO_REPORT_PDF_RENDERER_VERSION : RTO_REPORT_PAYLOAD_VERSION);
}

export async function pruneRtoReportingData({
  now = new Date(),
  dailyReportDays = 45,
  compactFactDays = 730,
} = {}) {
  const expired = await query("select id, storage_path from rto_report_exports where expires_at <= now()");
  for (const row of expired.rows) {
    const resolved = safeExportPath(row.storage_path);
    if (resolved) await fs.rm(resolved, { force: true }).catch(() => {});
  }
  const exportDelete = await query("delete from rto_report_exports where expires_at <= now()");
  const dailyCutoff = addDays(dateOnly(now), -boundedInt(dailyReportDays, 1, 3650, 45));
  const compactCutoff = addDays(dateOnly(now), -boundedInt(compactFactDays, 30, 7300, 730));
  const factorValidationTable = await query(
    "select to_regclass('public.rto_factor_validations') is not null as available",
  );
  const preserveEvidenceBackedReports = Boolean(factorValidationTable.rows[0]?.available);
  const dailyDelete = await query(
    preserveEvidenceBackedReports
      ? `
          delete from rto_report_batches b
          where b.cadence = 'daily'
            and b.period_end < $1::date
            and not exists (
              select 1
              from rto_reports r
              join rto_factor_validations v on v.report_id = r.id
              where r.batch_id = b.id
            )
        `
      : "delete from rto_report_batches where cadence = 'daily' and period_end < $1::date",
    [dailyCutoff],
  );
  const totalDelete = await query(
    "delete from rto_daily_report_totals where snapshot_date < $1::date",
    [compactCutoff],
  );
  const oemDelete = await query(
    "delete from rto_daily_oem_totals where snapshot_date < $1::date",
    [compactCutoff],
  );
  return {
    dailyCutoff,
    compactCutoff,
    deletedExports: exportDelete.rowCount,
    deletedDailyBatches: dailyDelete.rowCount,
    deletedTotalFacts: totalDelete.rowCount,
    deletedOemFacts: oemDelete.rowCount,
  };
}

async function loadReportInputs({ runId, period }) {
  const previous = previousReportPeriod(period);
  const trendStart = period.cadence === "daily" ? addDays(period.periodEnd, -14) : period.periodStart;
  const baselineStart = period.cadence === "monthly"
    ? previous.periodStart
    : addDays(previous.periodStart, -1);
  const loadStart = [trendStart, baselineStart].sort()[0];
  const [cohortResult, totalResult, oemResult] = await Promise.all([
    query(
      `
        select state, rto, cohort_rank
        from rto_daily_run_cohort_members
        where run_id = $1
        order by cohort_rank, state, rto
      `,
      [runId],
    ),
    query(
      `
        select
          snapshot_date,
          target_month,
          state,
          rto,
          fuel_group,
          vehicle_category,
          report_total,
          tracked_oem_total,
          untracked_total,
          source_run_id,
          source_report_id,
          filters_confirmed,
          explicit_zero,
          scrape_status,
          quality_status,
          quality_flags,
          metric_kind,
          source,
          scraped_at
        from rto_daily_report_totals
        where snapshot_date between $1::date and $2::date
          and exists (select 1 from rto_daily_scrape_reports r
            where r.id = rto_daily_report_totals.source_report_id and ${verifiedRtoSourceSql("r")})
          and metric_kind = '${RTO_DAILY_METRIC_KIND}'
          and exists (
            select 1
            from rto_daily_run_cohort_members c
            where c.run_id = $3
              and c.state = rto_daily_report_totals.state
              and c.rto = rto_daily_report_totals.rto
          )
        order by state, rto, snapshot_date, fuel_group, vehicle_category
      `,
      [loadStart, period.periodEnd, runId],
    ),
    query(
      `
        select
          snapshot_date,
          target_month,
          state,
          rto,
          fuel_group,
          vehicle_category,
          oem,
          vehicle_count,
          source_rank,
          metric_kind,
          source,
          source_run_id,
          scrape_status,
          scraped_at
        from rto_daily_oem_totals
        where snapshot_date between $1::date and $2::date
          and exists (select 1 from rto_daily_scrape_reports r
            where r.run_id = rto_daily_oem_totals.source_run_id
              and r.state = rto_daily_oem_totals.state and r.rto = rto_daily_oem_totals.rto
              and r.snapshot_date = rto_daily_oem_totals.snapshot_date
              and r.fuel_group = rto_daily_oem_totals.fuel_group
              and r.vehicle_category = rto_daily_oem_totals.vehicle_category
              and ${verifiedRtoSourceSql("r")})
          and metric_kind = '${RTO_DAILY_METRIC_KIND}'
          and exists (
            select 1
            from rto_daily_run_cohort_members c
            where c.run_id = $3
              and c.state = rto_daily_oem_totals.state
              and c.rto = rto_daily_oem_totals.rto
          )
        order by state, rto, snapshot_date, fuel_group, vehicle_category, oem
      `,
      [loadStart, period.periodEnd, runId],
    ),
  ]);
  return {
    cohort: cohortResult.rows,
    totalRows: totalResult.rows,
    oemRows: oemResult.rows,
    loadStart,
  };
}

async function findReportBatch({ cadence, periodStart, periodEnd, cohortHash }) {
  const result = await query(
    `
      select *
      from rto_report_batches
      where cadence = $1 and period_start = $2::date and period_end = $3::date and cohort_hash = $4
      limit 1
    `,
    [cadence, periodStart, periodEnd, cohortHash],
  );
  return result.rows[0] ?? null;
}

async function saveGeneratedReports({
  batchId,
  reports,
  batchStatus,
  reviewCount,
  warningCount,
  lateFill,
}) {
  const coverageCount = reports.filter((report) => report.currentCoverage).length;
  const payload = reports.map((report) => ({
    state: report.state,
    rto: report.rto,
    selection_rank: report.selectionRank,
    cohort_rank: report.cohortRank,
    previous_rank: report.previousRank,
    status: report.status,
    period_ev: report.periodEv,
    period_ice: report.periodIce,
    mtd_ev: report.mtdEv,
    mtd_ice: report.mtdIce,
    ev_share: report.evShare,
    summary: report.summary,
    payload: report.payload,
  }));
  return transaction(async (tx) => {
    await tx("delete from rto_reports where batch_id = $1", [batchId]);
    await tx(
      `
        insert into rto_reports (
          batch_id, state, rto, selection_rank, cohort_rank, previous_rank,
          status, period_ev, period_ice, mtd_ev, mtd_ice, ev_share, summary, payload
        )
        select
          $1,
          item.state,
          item.rto,
          item.selection_rank,
          item.cohort_rank,
          item.previous_rank,
          item.status,
          item.period_ev,
          item.period_ice,
          item.mtd_ev,
          item.mtd_ice,
          item.ev_share,
          item.summary,
          item.payload
        from jsonb_to_recordset($2::jsonb) as item(
          state text,
          rto text,
          selection_rank integer,
          cohort_rank integer,
          previous_rank integer,
          status text,
          period_ev integer,
          period_ice integer,
          mtd_ev integer,
          mtd_ice integer,
          ev_share numeric,
          summary text,
          payload jsonb
        )
      `,
      [batchId, JSON.stringify(payload)],
    );
    const result = await tx(
      `
        update rto_report_batches
        set status = $2,
            coverage_count = $3,
            report_count = $4,
            warning_count = $5,
            review_count = $6,
            late_fill = $7,
            quality_summary = jsonb_build_object(
              'ready', $4::integer - $5::integer - $6::integer,
              'readyWithWarnings', $5::integer,
              'needsReview', $6::integer
            ),
            generated_at = now(),
            last_error = null,
            updated_at = now()
        where id = $1
        returning *
      `,
      [batchId, batchStatus, coverageCount, reports.length, warningCount, reviewCount, lateFill],
    );
    return normalizeBatch(result.rows[0]);
  });
}

async function loadRun(runId) {
  const result = await query(
    `
      select *
      from rto_daily_collection_runs
      where id = $1
      limit 1
    `,
    [runId],
  );
  return result.rows[0] ?? null;
}

async function loadLatestCohortRun() {
  const result = await query(
    `
      select r.*
      from rto_daily_collection_runs r
      where exists (
        select 1 from rto_daily_run_cohort_members c where c.run_id = r.id
      )
      order by r.snapshot_date desc nulls last, r.id desc
      limit 1
    `,
  );
  return result.rows[0] ?? null;
}

function buildSeriesIndex(rows, keyForRow, valueField) {
  const index = new Map();
  for (const row of rows) {
    const memberKey = rtoKey(row);
    if (!index.has(memberKey)) index.set(memberKey, new Map());
    const metricKey = keyForRow(row);
    const member = index.get(memberKey);
    if (!member.has(metricKey)) member.set(metricKey, new Map());
    member.get(metricKey).set(row.snapshotDate, {
      value: finiteOrNull(row[valueField]),
      row,
    });
  }
  return index;
}

function metricTotalsForPeriod(index, member, period) {
  const ev = sumNullable(["2W", "3W", "4W"].map((category) =>
    metricValue(index, member, "EV", category, period)));
  const ice = sumNullable(["2W", "3W", "4W"].map((category) =>
    metricValue(index, member, "ICE", category, period)));
  return { ev, ice, total: sumNullable([ev, ice]) };
}

function metricTotalsAtDate(index, member, date) {
  const ev = sumNullable(["2W", "3W", "4W"].map((category) =>
    metricValueAtDate(index, member, "EV", category, date)));
  const ice = sumNullable(["2W", "3W", "4W"].map((category) =>
    metricValueAtDate(index, member, "ICE", category, date)));
  return { ev, ice, total: sumNullable([ev, ice]) };
}

function metricValue(index, member, fuelGroup, vehicleCategory, period) {
  const series = index.get(rtoKey(member))?.get(comboKey(fuelGroup, vehicleCategory));
  return stockMovementForSeries(series, period);
}

function metricValueAtDate(index, member, fuelGroup, vehicleCategory, date) {
  const series = index.get(rtoKey(member))?.get(comboKey(fuelGroup, vehicleCategory));
  return finiteOrNull(series?.get(date)?.value);
}

function buildOemMetric({ index, member, oem, period, untracked = false }) {
  const baselineDate = addDays(period.periodStart, -1);
  const categories = ["2W", "3W", "4W"].map((vehicleCategory) => {
    const ev = oemMetricValue(index, member, "EV", vehicleCategory, oem, period, untracked);
    const ice = oemMetricValue(index, member, "ICE", vehicleCategory, oem, period, untracked);
    const previousEv = oemMetricValueAtDate(index, member, "EV", vehicleCategory, oem, baselineDate, untracked);
    const previousIce = oemMetricValueAtDate(index, member, "ICE", vehicleCategory, oem, baselineDate, untracked);
    const stockEv = oemMetricValueAtDate(index, member, "EV", vehicleCategory, oem, period.periodEnd, untracked);
    const stockIce = oemMetricValueAtDate(index, member, "ICE", vehicleCategory, oem, period.periodEnd, untracked);
    const periodTotal = sumNullable([ev, ice]);
    const stockTotal = sumNullable([stockEv, stockIce]);
    const previousTotal = sumNullable([previousEv, previousIce]);
    return {
      vehicleCategory,
      period: { ev, ice, total: periodTotal },
      previousPeriod: { ev: previousEv, ice: previousIce, total: previousTotal },
      stock: { ev: stockEv, ice: stockIce, total: stockTotal },
      change: {
        ev: comparison(stockEv, previousEv),
        ice: comparison(stockIce, previousIce),
        total: comparison(stockTotal, previousTotal),
      },
      rank: untracked ? { ev: null, ice: null } : {
        ev: oemRankAtDate(index, member, "EV", vehicleCategory, oem, period.periodEnd),
        ice: oemRankAtDate(index, member, "ICE", vehicleCategory, oem, period.periodEnd),
      },
      previousRank: untracked ? { ev: null, ice: null } : {
        ev: oemRankAtDate(index, member, "EV", vehicleCategory, oem, baselineDate),
        ice: oemRankAtDate(index, member, "ICE", vehicleCategory, oem, baselineDate),
      },
    };
  });
  const periodEv = sumNullable(categories.map((row) => row.period.ev));
  const periodIce = sumNullable(categories.map((row) => row.period.ice));
  const previousEv = sumNullable(categories.map((row) => row.previousPeriod.ev));
  const previousIce = sumNullable(categories.map((row) => row.previousPeriod.ice));
  const stockEv = sumNullable(categories.map((row) => row.stock.ev));
  const stockIce = sumNullable(categories.map((row) => row.stock.ice));
  const periodTotal = sumNullable([periodEv, periodIce]);
  const previousTotal = sumNullable([previousEv, previousIce]);
  const hasData = categories.some((row) =>
    [row.period.ev, row.period.ice, row.stock.ev, row.stock.ice].some((value) => value !== null));
  return {
    oem,
    hasData,
    period: { ev: periodEv, ice: periodIce, total: periodTotal },
    previousPeriod: { ev: previousEv, ice: previousIce, total: previousTotal },
    stock: { ev: stockEv, ice: stockIce, total: sumNullable([stockEv, stockIce]) },
    change: {
      ev: comparison(stockEv, previousEv),
      ice: comparison(stockIce, previousIce),
      total: comparison(sumNullable([stockEv, stockIce]), previousTotal),
    },
    categories,
  };
}

function oemMetricValue(index, member, fuelGroup, vehicleCategory, oem, period, untracked) {
  const key = untracked
    ? comboKey(fuelGroup, vehicleCategory)
    : oemComboKey(fuelGroup, vehicleCategory, oem);
  const series = index.get(rtoKey(member))?.get(key);
  return series ? stockMovementForSeries(series, period) : null;
}

function oemMetricValueAtDate(index, member, fuelGroup, vehicleCategory, oem, date, untracked) {
  const key = untracked
    ? comboKey(fuelGroup, vehicleCategory)
    : oemComboKey(fuelGroup, vehicleCategory, oem);
  const series = index.get(rtoKey(member))?.get(key);
  return finiteOrNull(series?.get(date)?.value);
}

function oemRankAtDate(index, member, fuelGroup, vehicleCategory, oem, date) {
  const series = index.get(rtoKey(member))?.get(oemComboKey(fuelGroup, vehicleCategory, oem));
  const rank = series?.get(date)?.row?.sourceRank;
  return Number.isInteger(Number(rank)) ? Number(rank) : null;
}

function stockMovementForSeries(series, period) {
  if (!(series instanceof Map)) return null;
  const current = finiteOrNull(series.get(period.periodEnd)?.value);
  const baseline = finiteOrNull(series.get(addDays(period.periodStart, -1))?.value);
  if (current === null || baseline === null) return null;
  return current - baseline;
}

function assignRanks(reports, valueField, rankField) {
  const ranked = reports
    .filter((report) => Number.isFinite(report[valueField]))
    .sort((a, b) =>
      b[valueField] - a[valueField] ||
      compareRto(a, b));
  ranked.forEach((report, index) => {
    report[rankField] = index + 1;
  });
}

function deterministicSummary(report, period) {
  const metric = "active EV stock";
  const rank = report.cohortRank ? `ranked #${report.cohortRank} for ${metric}` : "has no comparable cohort rank";
  const ev = formatNumber(report.periodEv);
  const ice = formatNumber(report.periodIce);
  const shareText = report.evShare === null ? "EV stock share is unavailable" : `EV stock share was ${formatPercent(report.evShare)}`;
  if (
    period.cadence === "daily" &&
    (report.periodEv === null || report.periodIce === null) &&
    (Number.isFinite(report.mtdEv) || Number.isFinite(report.mtdIce))
  ) {
    const stockEv = formatNumber(report.mtdEv);
    const stockIce = formatNumber(report.mtdIce);
    return `${report.rto} has unavailable ${period.cadence} net stock movement because the comparison boundary is incomplete. Current active stock is ${stockEv} EV and ${stockIce} ICE vehicles, and the RTO ${rank}.`;
  }
  return `${report.rto} recorded net ${period.cadence} stock movement of ${ev} EV and ${ice} ICE vehicles for ${periodLabel(period)}. ${shareText} and the RTO ${rank}.`;
}

function reportStatus({ needsReview, hasWarnings }) {
  if (needsReview) return "needs_review";
  if (hasWarnings) return "ready_with_warnings";
  return "ready";
}

function reportCsvRows(report) {
  report = unavailableDailyRegistrationReport(report ?? {});
  const payload = report?.payload ?? {};
  if ((report.cadence ?? payload.cadence) === "daily") {
    const daily = payload.dailyRegistration;
    return [["cadence","date","timezone","state","rto","metric","value","status","reason"],
      ...["previousDayRegistrations","evRegistrations","iceRegistrations","evShare","rank"].map(name => [
        "daily",daily[name].date,daily.timezone,report.state ?? payload.rto?.state,report.rto ?? payload.rto?.name,
        name,null,"unavailable",daily[name].reason,
      ])];
  }
  const header = [
    "cadence",
    "period_start",
    "period_end",
    "state",
    "rto",
    "status",
    "cohort_rank",
    "oem",
    "vehicle_category",
    "ev_net_movement",
    "ice_net_movement",
    "total_net_movement",
    "ev_stock",
    "ice_stock",
    "baseline_stock",
    "net_change",
    "net_change_percent",
  ];
  const base = [
    report.cadence ?? payload.cadence,
    report.periodStart ?? payload.period?.start,
    report.periodEnd ?? payload.period?.end,
    report.state ?? payload.rto?.state,
    report.rto ?? payload.rto?.name,
    report.status ?? payload.status,
    report.cohortRank ?? payload.rto?.cohortRank,
  ];
  const rows = [header];
  for (const oem of payload.oems ?? []) {
    const categories = oem.categories?.length ? oem.categories : [{
      vehicleCategory: "ALL",
      period: oem.period,
      previousPeriod: oem.previousPeriod,
      stock: oem.stock,
    }];
    for (const category of categories) {
      rows.push([
        ...base,
        oem.oem,
        category.vehicleCategory,
        category.period?.ev,
        category.period?.ice,
        category.period?.total,
        category.stock?.ev,
        category.stock?.ice,
        category.previousPeriod?.total,
        category.period?.total,
        category.change?.total?.percent,
      ]);
    }
  }
  return rows;
}

function renderTrendSvg(rows) {
  const visible = rows.filter((row) => Number.isFinite(row.ev) || Number.isFinite(row.ice));
  if (visible.length < 2) return `<p>Not enough comparable daily observations are available.</p>`;
  const width = 860;
  const height = 260;
  const pad = { top: 22, right: 28, bottom: 42, left: 64 };
  const chartWidth = width - pad.left - pad.right;
  const chartHeight = height - pad.top - pad.bottom;
  const values = visible.flatMap((row) => [row.ev, row.ice]).filter(Number.isFinite);
  const min = Math.min(0, ...values);
  const max = Math.max(1, ...values);
  const tickStep = Math.max(1, Math.ceil((max - min) / 4));
  const yMax = Math.max(tickStep, Math.ceil(max / tickStep) * tickStep);
  const yMin = Math.min(0, Math.floor(min / tickStep) * tickStep);
  const yRange = yMax - yMin || 1;
  const y = (value) => pad.top + (1 - ((value - yMin) / yRange)) * chartHeight;
  const x = (index) => pad.left + (index / Math.max(1, visible.length - 1)) * chartWidth;
  const points = (field) => visible
    .map((row, index) => Number.isFinite(row[field]) ? `${x(index).toFixed(1)},${y(row[field]).toFixed(1)}` : null)
    .filter(Boolean)
    .join(" ");
  const pointNodes = (field) => visible
    .map((row, index) => Number.isFinite(row[field])
      ? `<circle class="trend-point ${field}" cx="${x(index).toFixed(1)}" cy="${y(row[field]).toFixed(1)}" r="4"><title>${escapeHtml(shortDate(row.date))}: ${field.toUpperCase()} ${formatNumber(row[field])}</title></circle>`
      : "")
    .join("");
  const yTicks = [];
  for (let value = yMin; value <= yMax; value += tickStep) {
    yTicks.push(`<line class="trend-grid" x1="${pad.left}" x2="${width - pad.right}" y1="${y(value).toFixed(1)}" y2="${y(value).toFixed(1)}"></line><text class="trend-y-label" x="${pad.left - 10}" y="${(y(value) + 4).toFixed(1)}" text-anchor="end">${escapeHtml(formatNumber(value))}</text>`);
  }
  const xLabelIndexes = visible.length <= 10
    ? visible.map((_, index) => index)
    : [...new Set([0, Math.floor((visible.length - 1) / 2), visible.length - 1])];
  const xLabels = xLabelIndexes
    .map((index) => `<text class="trend-x-label" x="${x(index).toFixed(1)}" y="${height - 10}" text-anchor="middle">${escapeHtml(shortDate(visible[index].date))}</text>`)
    .join("");
  return `<svg viewBox="0 0 ${width} ${height}" role="img" aria-label="Daily EV and ICE active-stock trend">
    <rect class="trend-chart-bg" x="${pad.left}" y="${pad.top}" width="${chartWidth}" height="${chartHeight}" rx="8"></rect>
    ${yTicks.join("")}
    <line class="trend-axis" x1="${pad.left}" x2="${pad.left}" y1="${pad.top}" y2="${pad.top + chartHeight}"></line>
    <line class="trend-axis" x1="${pad.left}" x2="${width - pad.right}" y1="${pad.top + chartHeight}" y2="${pad.top + chartHeight}"></line>
    <polyline class="trend-ev" points="${points("ev")}"></polyline>
    <polyline class="trend-ice" points="${points("ice")}"></polyline>
    ${pointNodes("ev")}
    ${pointNodes("ice")}
    ${xLabels}
  </svg>`;
}

function metricHtml(label, value, note = "") {
  const display = typeof value === "string" ? value : formatNumber(value);
  return `<article class="metric"><span>${escapeHtml(label)}</span><strong>${escapeHtml(display)}</strong>${note ? `<small>${escapeHtml(note)}</small>` : ""}</article>`;
}

function oemCategoryRows(oems = []) {
  return ["2W", "3W", "4W"].flatMap((vehicleCategory) =>
    oems.flatMap((source) => {
      const category = source?.categories?.find((row) => row.vehicleCategory === vehicleCategory);
      if (!category || ![category.stock?.ev, category.stock?.ice, category.previousPeriod?.ev, category.previousPeriod?.ice].some(Number.isFinite)) return [];
      return [{ oem: source.oem, vehicleCategory, ...category }];
    }));
}

function normalizeCohortMember(row = {}) {
  return {
    state: String(row.state ?? ""),
    rto: String(row.rto ?? ""),
    selectionRank: Number(row.selectionRank ?? row.cohort_rank ?? 0),
  };
}

function normalizeTotalRow(row = {}) {
  const camel = rowToCamel(row);
  return {
    ...camel,
    snapshotDate: dateOnly(camel.snapshotDate),
    reportTotal: finiteOrNull(camel.reportTotal),
    trackedOemTotal: finiteOrNull(camel.trackedOemTotal),
    untrackedTotal: finiteOrNull(camel.untrackedTotal),
    qualityFlags: camel.qualityFlags ?? {},
  };
}

function normalizeOemRow(row = {}) {
  const camel = rowToCamel(row);
  return {
    ...camel,
    snapshotDate: dateOnly(camel.snapshotDate),
    vehicleCount: finiteOrNull(camel.vehicleCount),
  };
}

function normalizeRun(row = {}) {
  const run = rowToCamel(row);
  return {
    ...run,
    id: Number(run.id),
    snapshotDate: dateOnly(run.snapshotDate),
    totalRtos: Number(run.totalRtos ?? 0),
    succeededRtos: Number(run.succeededRtos ?? 0),
    failedRtos: Number(run.failedRtos ?? 0),
    reportCohortSize: Number(run.reportCohortSize ?? 0),
  };
}

function normalizeBatch(row = {}) {
  const batch = rowToCamel(row);
  const verified = batch.verifiedReportCount === undefined ? null : Number(batch.verifiedReportCount);
  return {
    ...batch,
    id: Number(batch.id),
    sourceRunId: batch.sourceRunId === null ? null : Number(batch.sourceRunId),
    periodStart: dateOnly(batch.periodStart),
    periodEnd: dateOnly(batch.periodEnd),
    sourceSnapshotDate: dateOnly(batch.sourceSnapshotDate),
    cohortSize: Number(batch.cohortSize ?? 0),
    revision: Number(batch.revision ?? 1),
    status: verified !== null && verified < Number(batch.reportCount) ? "needs_review" : batch.status,
    coverageCount: verified === null ? Number(batch.coverageCount ?? 0) : Math.min(verified, Number(batch.coverageCount ?? 0)),
    reportCount: Number(batch.reportCount ?? 0),
    warningCount: Number(batch.runtimeWarningCount ?? batch.warningCount ?? 0),
    reviewCount: Number(batch.runtimeReviewCount ?? batch.reviewCount ?? 0),
  };
}

function normalizeReportSummary(row = {}) {
  const report = rowToCamel(row);
  return quarantineUnverifiedRtoReport({
    ...report,
    periodEnd: dateOnly(report.periodEnd),
    id: Number(report.id),
    batchId: Number(report.batchId),
    selectionRank: Number(report.selectionRank),
    cohortRank: report.cohortRank === null ? null : Number(report.cohortRank),
    previousRank: report.previousRank === null ? null : Number(report.previousRank),
    periodEv: finiteOrNull(report.periodEv),
    periodIce: finiteOrNull(report.periodIce),
    mtdEv: finiteOrNull(report.mtdEv),
    mtdIce: finiteOrNull(report.mtdIce),
    evShare: finiteOrNull(report.evShare),
  });
}

// Read-time quarantine: retain the stored historical evidence untouched, but do
// not publish old unverified numbers or reuse them as comparison baselines.
export function quarantineUnverifiedRtoReport(report) {
  if ((report.cadence ?? report.payload?.cadence) === "daily") return unavailableDailyRegistrationReport(report);
  if ((report.payload?.source?.validationContract ?? report.validationContract) === "public-stock-v2") return report;
  const summary = "Historical collection is unverified and excluded from reporting. A new source-verified baseline is required; these figures are not daily registrations.";
  const payload = report.payload ?? {};
  return { ...report, status: "needs_review", summary, cohortRank: null, previousRank: null,
    periodEv: null, periodIce: null, mtdEv: null, mtdIce: null, evShare: null,
    payload: { ...payload, status: "needs_review", summary,
      rto: { ...payload.rto, cohortRank: null, previousRank: null },
      metrics: {}, categories: [], oems: [], trend: [], explanations: [],
      quality: { currentCoverage: false, warnings: [summary], sourceFlags: ["unverified_source_contract"] },
      source: { validationContract: null, registrationFlowAvailable: false, limitation: summary },
    },
  };
}

function normalizeFullReport(row = {}) {
  const report = normalizeReportSummary(row);
  report.cadence = row.cadence;
  report.periodStart = dateOnly(row.period_start);
  report.periodEnd = dateOnly(row.period_end);
  report.sourceSnapshotDate = dateOnly(row.source_snapshot_date);
  report.sourceRunId = row.source_run_id === null ? null : Number(row.source_run_id);
  report.cohortHash = row.cohort_hash;
  report.cohortSize = Number(row.cohort_size ?? 0);
  report.revision = Number(row.revision ?? 1);
  report.batchStatus = row.batch_status ?? null;
  report.sourceChecksum = row.source_checksum ?? null;
  report.payload = row.payload ?? {};
  return quarantineUnverifiedRtoReport(report);
}

function renderRtoExplanationHtml(explanation = {}) {
  const title =
    explanation.finalHeading ?? explanation.heading ?? explanation.headline ?? explanation.title ?? "Possible driver";
  const body =
    explanation.finalBody ?? explanation.body ?? explanation.narrative ?? explanation.summary ?? "";
  const status =
    explanation.validationStatus ??
    explanation.validationDecisionStatus ??
    explanation.decisionStatus ??
    explanation.evidenceStatus ??
    explanation.reviewStatus ??
    explanation.status ??
    "reviewed";
  const limitations = Array.isArray(explanation.limitations) ? explanation.limitations : [];
  const sources = Array.isArray(explanation.citations)
    ? explanation.citations
    : Array.isArray(explanation.sources)
    ? explanation.sources
    : Array.isArray(explanation.documents)
      ? explanation.documents
      : [];
  return `
    <article class="context-card">
      <span class="context-label">${escapeHtml(String(status).replaceAll("_", " "))}</span>
      <h3>${escapeHtml(title)}</h3>
      <p>${escapeHtml(body)}</p>
      ${limitations.length ? `<p class="context-caveat">${limitations.map((item) => escapeHtml(item)).join(" ")}</p>` : ""}
      ${sources.length ? `<ul class="context-sources">${sources.map((source) => {
        const document = source.document ?? source;
        const href = safeHttpUrl(document.url ?? document.sourceUrl ?? document.canonicalUrl);
        const label =
          source.citationLabel ??
          document.title ??
          document.source?.publisher ??
          document.publisher ??
          `Source ${document.id ?? source.documentId ?? ""}`.trim();
        return href
          ? `<li><a href="${escapeHtml(href)}" rel="noopener noreferrer">${escapeHtml(label)}</a></li>`
          : `<li>${escapeHtml(label)}</li>`;
      }).join("")}</ul>` : ""}
    </article>
  `;
}

function safeHttpUrl(value) {
  try {
    const url = new URL(String(value ?? ""));
    return ["http:", "https:"].includes(url.protocol) ? url.href : null;
  } catch {
    return null;
  }
}

function rowToCamel(row = {}) {
  return Object.fromEntries(Object.entries(row).map(([key, value]) => [
    key.replace(/_([a-z])/g, (_, letter) => letter.toUpperCase()),
    value,
  ]));
}

function comboKey(fuelGroup, vehicleCategory) {
  return `${fuelGroup}|${vehicleCategory}`;
}

function oemComboKey(fuelGroup, vehicleCategory, oem) {
  return `${fuelGroup}|${vehicleCategory}|${oem}`;
}

function rtoKey(row) {
  return `${row.state}|${row.rto}`;
}

function compareRto(a, b) {
  return a.state.localeCompare(b.state) || a.rto.localeCompare(b.rto);
}

function comparison(current, previous) {
  const currentValue = finiteOrNull(current);
  const previousValue = finiteOrNull(previous);
  if (currentValue === null || previousValue === null) return { absolute: null, percent: null };
  const absolute = currentValue - previousValue;
  const percent = previousValue === 0 ? null : (absolute / Math.abs(previousValue)) * 100;
  return { absolute, percent };
}

function sumNullable(values) {
  if (!values.length || values.some((value) => !Number.isFinite(value))) return null;
  return values.reduce((total, value) => total + value, 0);
}

function nonNegative(value) {
  const normalized = finiteOrNull(value);
  return normalized === null || normalized < 0 ? null : normalized;
}

function nonNegativeMetrics(metrics) {
  const ev = nonNegative(metrics?.ev);
  const ice = nonNegative(metrics?.ice);
  return { ev, ice, total: sumNullable([ev, ice]) };
}

function share(part, total) {
  return Number.isFinite(part) && Number.isFinite(total) && total > 0 ? (part / total) * 100 : null;
}

function finiteOrNull(value) {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function numberForSort(value) {
  return Number.isFinite(value) ? value : Number.NEGATIVE_INFINITY;
}

function unique(values) {
  return [...new Set(values)];
}

function checksum(value) {
  return crypto.createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function csvCell(value) {
  if (value === null || value === undefined) return "";
  const text = String(value);
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

function safeExportPath(relativePath) {
  const normalized = String(relativePath ?? "").replaceAll("\\", "/").replace(/^\/+/, "");
  const resolved = path.resolve(EXPORT_ROOT, normalized);
  return resolved === EXPORT_ROOT || resolved.startsWith(`${EXPORT_ROOT}${path.sep}`) ? resolved : null;
}

function periodLabel(period) {
  if (period.cadence === "daily") return humanDate(period.periodEnd);
  if (period.cadence === "weekly") return `${humanDate(period.periodStart)} to ${humanDate(period.periodEnd)}`;
  return new Intl.DateTimeFormat("en-IN", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }).format(parseDate(period.periodEnd));
}

function statusLabel(status) {
  if (status === "ready_with_warnings") return "Ready with warnings";
  if (status === "needs_review") return "Needs review";
  return capitalize(status ?? "unknown");
}

function capitalize(value) {
  const text = String(value ?? "");
  return text ? `${text[0].toUpperCase()}${text.slice(1)}` : text;
}

function formatNumber(value) {
  if (value === null || value === undefined || value === "") return "N/A";
  return Number.isFinite(Number(value)) ? new Intl.NumberFormat("en-IN").format(Number(value)) : "N/A";
}

function formatSigned(value) {
  const number = finiteOrNull(value);
  if (number === null) return "N/A";
  return `${number > 0 ? "+" : ""}${new Intl.NumberFormat("en-IN").format(number)}`;
}

function formatPercent(value) {
  const number = finiteOrNull(value);
  return number === null ? "N/A" : `${number.toFixed(1)}%`;
}

function humanDate(value) {
  return new Intl.DateTimeFormat("en-IN", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  }).format(parseDate(value));
}

function shortDate(value) {
  return new Intl.DateTimeFormat("en-IN", {
    day: "numeric",
    month: "short",
    timeZone: "UTC",
  }).format(parseDate(value));
}

function humanDateTime(value) {
  if (!value) return "unknown";
  return new Intl.DateTimeFormat("en-IN", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Asia/Calcutta",
  }).format(new Date(value));
}

function dateRange(start, end) {
  const rows = [];
  for (let date = start; date <= end; date = addDays(date, 1)) rows.push(date);
  return rows;
}

function isMonthEnd(value) {
  return addDays(value, 1).slice(0, 7) !== value.slice(0, 7);
}

function monthEndFor(value) {
  const date = parseDate(`${value.slice(0, 7)}-01`);
  date.setUTCMonth(date.getUTCMonth() + 1);
  date.setUTCDate(0);
  return date.toISOString().slice(0, 10);
}

function dayOfWeek(value) {
  return parseDate(value).getUTCDay();
}

function addDays(value, days) {
  const date = parseDate(value);
  date.setUTCDate(date.getUTCDate() + Number(days));
  return date.toISOString().slice(0, 10);
}

function parseDate(value) {
  const date = new Date(`${dateOnly(value)}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime())) throw new Error(`Invalid date: ${value}`);
  return date;
}

function dateOnly(value) {
  if (!value) return null;
  if (typeof value === "string") return value.slice(0, 10);
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Calcutta",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date(value));
  const part = (type) => parts.find((item) => item.type === type)?.value;
  return `${part("year")}-${part("month")}-${part("day")}`;
}

function boundedInt(value, min, max, fallback) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.max(min, Math.min(max, Math.floor(number)));
}

function inputError(message) {
  const error = new Error(message);
  error.statusCode = 400;
  return error;
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}
