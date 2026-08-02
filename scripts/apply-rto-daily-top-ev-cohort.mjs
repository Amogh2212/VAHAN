import process from "node:process";
import { closePool, query, transaction } from "../lib/db.mjs";

const DEFAULT_LIMIT = 100;
const REQUIRED_EV_CATEGORIES = 3;

function parseArgs(argv) {
  const args = {
    date: null,
    limit: DEFAULT_LIMIT,
    dryRun: false,
    apply: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--date") args.date = argv[++index] ?? null;
    else if (arg.startsWith("--date=")) args.date = arg.slice("--date=".length);
    else if (arg === "--limit") args.limit = argv[++index];
    else if (arg.startsWith("--limit=")) args.limit = arg.slice("--limit=".length);
    else if (arg === "--dry-run") args.dryRun = true;
    else if (arg === "--apply") args.apply = true;
    else if (arg === "--help" || arg === "-h") args.help = true;
    else throw new Error(`Unknown argument: ${arg}`);
  }
  args.limit = Math.max(1, Math.min(Math.floor(Number(args.limit) || DEFAULT_LIMIT), 500));
  if (args.date && !/^\d{4}-\d{2}-\d{2}$/.test(args.date)) {
    throw new Error("--date must use YYYY-MM-DD format.");
  }
  if (!args.apply) args.dryRun = true;
  return args;
}

function usage() {
  return [
    "Usage: node --env-file=.env scripts/apply-rto-daily-top-ev-cohort.mjs [options]",
    "",
    "Options:",
    "  --dry-run          Preview the national top EV RTO cohort without changing configs.",
    "  --apply            Enable only the selected cohort and disable other rotation configs.",
    "  --date YYYY-MM-DD  Rank from a specific completed snapshot date.",
    "  --limit N          Cohort size (default 100, max 500).",
  ].join("\n");
}

async function latestCompleteSnapshotDate() {
  const result = await query(
    `
      select snapshot_date::text as snapshot_date
      from rto_daily_collection_runs
      where status = 'success'
        and failed_rtos = 0
        and succeeded_rtos = total_rtos
        and snapshot_date is not null
      order by snapshot_date desc, completed_at desc, id desc
      limit 1
    `,
  );
  return result.rows[0]?.snapshot_date ? dateOnly(result.rows[0].snapshot_date) : null;
}

async function loadRun(snapshotDate) {
  const result = await query(
    `
      select id, snapshot_date::text as snapshot_date, target_month, status, total_rtos, succeeded_rtos, failed_rtos, completed_at
      from rto_daily_collection_runs
      where snapshot_date = $1::date
      order by completed_at desc nulls last, id desc
      limit 1
    `,
    [snapshotDate],
  );
  return result.rows[0] ?? null;
}

async function rankTopEvRtos({ snapshotDate, limit }) {
  const result = await query(
    `
      select
        row_number() over (order by sum(report_total) desc, state asc, rto asc)::int as rank,
        state,
        rto,
        sum(report_total)::bigint as ev_total,
        count(distinct vehicle_category)::int as ev_categories
      from rto_daily_scrape_reports
      where snapshot_date = $1::date
        and fuel_group = 'EV'
        and status = 'success'
        and report_total is not null
      group by state, rto
      having count(distinct vehicle_category) = $3
      order by sum(report_total) desc, state asc, rto asc
      limit $2
    `,
    [snapshotDate, limit, REQUIRED_EV_CATEGORIES],
  );
  return result.rows.map((row) => ({
    rank: Number(row.rank),
    state: row.state,
    rto: row.rto,
    evTotal: Number(row.ev_total),
    evCategories: Number(row.ev_categories),
  }));
}

async function coverage(snapshotDate) {
  const result = await query(
    `
      with per_rto as (
        select
          state,
          rto,
          count(*) filter (
            where fuel_group = 'EV'
              and status = 'success'
              and report_total is not null
          ) as ev_reports,
          count(distinct vehicle_category) filter (
            where fuel_group = 'EV'
              and status = 'success'
              and report_total is not null
          ) as ev_categories,
          sum(report_total) filter (
            where fuel_group = 'EV'
              and status = 'success'
              and report_total is not null
          ) as ev_total
        from rto_daily_scrape_reports
        where snapshot_date = $1::date
        group by state, rto
      )
      select
        count(*)::int as rtos_with_any_report,
        count(*) filter (where ev_categories = $2)::int as complete_ev_rtos,
        coalesce(sum(ev_total) filter (where ev_categories = $2), 0)::bigint as complete_ev_total
      from per_rto
    `,
    [snapshotDate, REQUIRED_EV_CATEGORIES],
  );
  return {
    rtosWithAnyReport: Number(result.rows[0]?.rtos_with_any_report ?? 0),
    completeEvRtos: Number(result.rows[0]?.complete_ev_rtos ?? 0),
    completeEvTotal: Number(result.rows[0]?.complete_ev_total ?? 0),
  };
}

async function applyCohort({ snapshotDate, limit, cohort }) {
  const payload = JSON.stringify(cohort.map((row) => ({
    state: row.state,
    rto: row.rto,
    rank: row.rank,
    evTotal: row.evTotal,
  })));
  return transaction(async (tx) => {
    const result = await tx(
      `
        with selected as (
          select *
          from jsonb_to_recordset($1::jsonb)
            as item(state text, rto text, rank integer, "evTotal" integer)
        ),
        updated as (
          update rto_daily_snapshot_configs c
          set enabled = selected.rank is not null,
              priority = coalesce(selected.rank, 1000),
              updated_at = now()
          from (
            select c.id, s.rank
            from rto_daily_snapshot_configs c
            left join selected s on s.state = c.state and s.rto = c.rto
            where not c.rto ~* '^All Vahan4 Running Office'
          ) selected
          where c.id = selected.id
          returning c.enabled
        )
        select
          count(*)::int as touched,
          count(*) filter (where enabled)::int as enabled,
          count(*) filter (where not enabled)::int as disabled
        from updated
      `,
      [payload],
    );
    const verify = await tx(
      `
        select count(*)::int as enabled
        from rto_daily_snapshot_configs
        where enabled = true
          and not rto ~* '^All Vahan4 Running Office'
      `,
    );
    return {
      snapshotDate,
      limit,
      touched: Number(result.rows[0]?.touched ?? 0),
      enabled: Number(result.rows[0]?.enabled ?? 0),
      disabled: Number(result.rows[0]?.disabled ?? 0),
      verifiedEnabled: Number(verify.rows[0]?.enabled ?? 0),
    };
  });
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log(usage());
    return;
  }

  const snapshotDate = args.date ?? await latestCompleteSnapshotDate();
  if (!snapshotDate) throw new Error("No completed RTO daily run found.");
  const run = await loadRun(snapshotDate);
  if (!run) throw new Error(`No RTO daily run found for ${snapshotDate}.`);
  if (run.status !== "success" || Number(run.failed_rtos) !== 0) {
    throw new Error(`Refusing to rank ${snapshotDate}: run status is ${run.status} with ${run.failed_rtos} failed RTOs.`);
  }

  const cohort = await rankTopEvRtos({ snapshotDate, limit: args.limit });
  if (cohort.length < args.limit) {
    throw new Error(`Only ${cohort.length} complete EV RTOs found for ${snapshotDate}; expected ${args.limit}.`);
  }

  const summary = {
    mode: args.apply ? "apply" : "dry-run",
    metric: "India-wide EV sales MTD from rto_daily_scrape_reports.report_total, summed across 2W/3W/4W",
    snapshotDate,
    targetMonth: run.target_month,
    runId: Number(run.id),
    runStatus: run.status,
    runRtos: Number(run.total_rtos),
    coverage: await coverage(snapshotDate),
    topCount: cohort.length,
    top10: cohort.slice(0, 10),
    rank100: cohort[99] ?? null,
  };

  if (args.apply) {
    summary.applied = await applyCohort({ snapshotDate, limit: args.limit, cohort });
  }
  console.log(JSON.stringify(summary, null, 2));
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

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(closePool);
