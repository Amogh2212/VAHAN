import { hasDatabaseUrl, query, transaction } from "./db.mjs";

export const RTO_DAILY_FUEL_GROUPS = ["EV", "ICE"];
export const RTO_DAILY_CATEGORIES = ["2W", "3W", "4W"];

export const RTO_DAILY_OEMS = [
  { name: "Hero MotoCorp", aliases: ["HERO MOTOCORP", "HERO MOTOCORP LTD", "HERO MOTOCORP LIMITED"] },
  { name: "Honda Motorcycle", aliases: ["HONDA MOTORCYCLE", "HONDA MOTORCYCLE AND SCOOTER", "HONDA MOTORCYCLE AND SCOOTER INDIA", "HONDA MOTORCYCLE & SCOOTER INDIA"] },
  { name: "TVS Motor (2W)", aliases: ["TVS MOTOR", "TVS MOTOR COMPANY"] },
  { name: "Bajaj Auto (2W)", aliases: ["BAJAJ AUTO", "BAJAJ AUTO LTD", "BAJAJ AUTO LIMITED"] },
  { name: "Suzuki Motorcycle", aliases: ["SUZUKI MOTORCYCLE", "SUZUKI MOTORCYCLE INDIA"] },
  { name: "Bajaj Auto (3W)", aliases: ["BAJAJ AUTO", "BAJAJ AUTO LTD", "BAJAJ AUTO LIMITED"] },
  { name: "Mahindra Last Mile Mobility", aliases: ["MAHINDRA LAST MILE", "MAHINDRA LAST MILE MOBILITY", "MAHINDRA ELECTRIC", "MAHINDRA AND MAHINDRA"] },
  { name: "TVS Motor (3W)", aliases: ["TVS MOTOR", "TVS MOTOR COMPANY"] },
  { name: "Piaggio Vehicles", aliases: ["PIAGGIO VEHICLES", "PIAGGIO VEHICLES PVT", "PIAGGIO VEHICLES PRIVATE"] },
  { name: "Atul Auto", aliases: ["ATUL AUTO", "ATUL AUTO LTD", "ATUL AUTO LIMITED"] },
  { name: "Maruti Suzuki", aliases: ["MARUTI SUZUKI", "MARUTI SUZUKI INDIA"] },
  { name: "Tata Motors", aliases: ["TATA MOTORS", "TATA MOTORS LTD", "TATA MOTORS LIMITED"] },
  { name: "Mahindra & Mahindra", aliases: ["MAHINDRA AND MAHINDRA", "MAHINDRA & MAHINDRA", "MAHINDRA MAHINDRA"] },
  { name: "Hyundai Motor India", aliases: ["HYUNDAI MOTOR INDIA", "HYUNDAI MOTOR"] },
  { name: "JSW MG Motor India", aliases: ["JSW MG MOTOR", "JSW MG MOTOR INDIA", "MG MOTOR INDIA", "M G MOTOR INDIA"] },
];

export const RTO_DAILY_CATEGORY_OEMS = Object.freeze({
  "2W": Object.freeze(RTO_DAILY_OEMS.slice(0, 5).map((oem) => oem.name)),
  "3W": Object.freeze(RTO_DAILY_OEMS.slice(5, 10).map((oem) => oem.name)),
  "4W": Object.freeze(RTO_DAILY_OEMS.slice(10, 15).map((oem) => oem.name)),
});

export const RTO_DAILY_CATEGORY_FILTERS = {
  "2W": {
    vehicleCategories: ["TWO WHEELER(NT)", "TWO WHEELER(T)"],
    vehicleClasses: [],
  },
  "3W": {
    vehicleCategories: ["THREE WHEELER(NT)", "THREE WHEELER(T)"],
    vehicleClasses: [],
  },
  "4W": {
    vehicleCategories: ["LIGHT MOTOR VEHICLE", "LIGHT PASSENGER VEHICLE"],
    vehicleClasses: [],
  },
};

export const RTO_DAILY_FUEL_FILTERS = {
  EV: ["PURE EV", "ELECTRIC(BOV)", "ELECTRIC"],
  ICE: [
    "CNG ONLY",
    "DIESEL",
    "DUAL DIESEL/BIO CNG",
    "DUAL DIESEL/CNG",
    "DUAL DIESEL/LNG",
    "ETHANOL",
    "FLEX-FUEL(BIO-DIESEL)",
    "FLEX-FUEL(ETHANOL)",
    "HCNG",
    "HYDROGEN(ICE)",
    "LNG",
    "LPG ONLY",
    "METHANOL",
    "PETROL",
    "PETROL/CNG",
    "PETROL(E20)",
    "PETROL(E20)/CNG",
    "PETROL(E20)/LPG",
    "PETROL/ETHANOL",
    "PETROL/LPG",
    "PETROL/METHANOL",
  ],
};

const DEFAULT_TIMEZONE = process.env.RTO_DAILY_TIMEZONE || "Asia/Calcutta";
export const RTO_DAILY_MAX_PINS_PER_USER = Math.max(1, Number(process.env.RTO_DAILY_MAX_PINS_PER_USER ?? 10));

export const RTO_DAILY_QUEUE_PRIORITIES = Object.freeze({
  pin: 0,
  lookup: 10,
  rotation: 100,
});

export function rtoDailyCombinationMatrix() {
  const rows = [];
  for (const fuelGroup of RTO_DAILY_FUEL_GROUPS) {
    for (const vehicleCategory of RTO_DAILY_CATEGORIES) {
      for (const oem of RTO_DAILY_OEMS) {
        rows.push({
          fuelGroup,
          vehicleCategory,
          oem: oem.name,
          aliases: oem.aliases,
        });
      }
    }
  }
  return rows;
}

export function rtoDailyExpectedRowCount() {
  return RTO_DAILY_FUEL_GROUPS.length * RTO_DAILY_CATEGORIES.length * RTO_DAILY_OEMS.length;
}

export function targetMonthForDate(date = new Date(), timezone = DEFAULT_TIMEZONE) {
  return snapshotDateKey(date, timezone).slice(0, 7);
}

export function snapshotDateKey(date = new Date(), timezone = DEFAULT_TIMEZONE) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const part = (type) => parts.find((item) => item.type === type)?.value;
  return `${part("year")}-${part("month")}-${part("day")}`;
}

export function scrapeStatusForSnapshotDate(snapshotDate, scrapedAt = new Date(), timezone = DEFAULT_TIMEZONE) {
  return snapshotDateKey(new Date(scrapedAt), timezone) > snapshotDate ? "late_fill" : "success";
}

export function normalizeOemLabel(value) {
  return String(value ?? "")
    .toUpperCase()
    .replace(/&/g, " AND ")
    .replace(/[^A-Z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function countForOem(rows, oem) {
  const aliases = [oem.name, ...(oem.aliases ?? [])].map(normalizeOemLabel);
  return (rows ?? []).reduce((total, row) => {
    const maker = normalizeOemLabel(row.maker);
    if (!aliases.some((alias) => maker.includes(alias) || alias.includes(maker))) return total;
    return total + Number(row.vehicle_count ?? row.vehicleCount ?? 0);
  }, 0);
}

export function buildSnapshotRows({ sourceRows, state, rto, snapshotDate, targetMonth, fuelGroup, vehicleCategory, metadata = {} }) {
  return RTO_DAILY_OEMS.map((oem) => ({
    snapshotDate,
    targetMonth,
    state,
    rto,
    fuelGroup,
    vehicleCategory,
    oem: oem.name,
    vehicleCount: countForOem(sourceRows, oem),
    source: metadata.source ?? "vahan-scraper",
    scrapeStatus: metadata.scrapeStatus ?? "success",
    scrapeRunId: metadata.scrapeRunId ?? null,
    scrapedAt: metadata.scrapedAt ?? new Date().toISOString(),
    raw: metadata.raw ?? {},
  }));
}

export async function listRtoDailyConfigs({ limit = 50, includeDisabled = false, state = null } = {}) {
  ensureDatabase();
  const values = [];
  const clauses = [];
  if (!includeDisabled) clauses.push("enabled = true");
  if (state) {
    values.push(state);
    clauses.push(`state = $${values.length}`);
  }
  values.push(Math.max(1, Math.min(Number(limit) || 50, 500)));
  const result = await query(
    `
      select id, state, rto, enabled, priority, last_snapshot_date, last_status, last_error,
             catalog_last_seen_at, catalog_miss_count, created_at, updated_at
      from rto_daily_snapshot_configs
      ${clauses.length ? `where ${clauses.join(" and ")}` : ""}
      order by enabled desc, priority asc, coalesce(last_snapshot_date, date '1900-01-01') asc, state asc, rto asc
      limit $${values.length}
    `,
    values,
  );
  return result.rows.map(normalizeConfig);
}

export async function upsertRtoDailyConfigs(configs = [], options = {}) {
  ensureDatabase();
  const normalized = configs.map(normalizeConfigInput).filter((item) => item.state && item.rto);
  if (!normalized.length) return { count: 0 };
  const refreshedAt = options.refreshedAt ?? new Date().toISOString();
  return transaction(async (tx) => {
    const values = [];
    const placeholders = normalized.map((item, index) => {
      const offset = index * 5;
      values.push(item.state, item.rto, item.enabled, item.priority, refreshedAt);
      return `($${offset + 1}, $${offset + 2}, $${offset + 3}, $${offset + 4}, $${offset + 5})`;
    });
    const result = await tx(
      `
        insert into rto_daily_snapshot_configs
          (state, rto, enabled, priority, catalog_last_seen_at)
        values ${placeholders.join(", ")}
        on conflict (state, rto)
        do update set
          enabled = excluded.enabled,
          priority = excluded.priority,
          catalog_last_seen_at = excluded.catalog_last_seen_at,
          catalog_miss_count = 0,
          updated_at = now()
      `,
      values,
    );
    let missing = 0;
    let disabled = 0;
    const aggregateDisabled = await tx(
      `
        update rto_daily_snapshot_configs
        set enabled = false, updated_at = now()
        where enabled = true and rto ~* '^All Vahan4 Running Office'
      `,
    );
    disabled += aggregateDisabled.rowCount;
    if (options.reconcileMissing) {
      const reconciled = await tx(
        `
          update rto_daily_snapshot_configs
          set catalog_miss_count = catalog_miss_count + 1,
              enabled = case when catalog_miss_count + 1 >= 2 then false else enabled end,
              updated_at = now()
          where catalog_last_seen_at is null or catalog_last_seen_at < $1::timestamptz
          returning enabled
        `,
        [refreshedAt],
      );
      missing = reconciled.rowCount;
      disabled += reconciled.rows.filter((row) => !row.enabled).length;
    }
    return { count: result.rowCount, missing, disabled, refreshedAt };
  });
}

export async function previewRtoDailyCycle({ state = null, limit = 20 } = {}) {
  ensureDatabase();
  const configs = await listRtoDailyConfigs({ state, limit: Math.max(1, Math.min(Number(limit) || 20, 500)) });
  const totalResult = await query(
    `
      select
        count(*)::int as count,
        count(*) filter (where exists (select 1 from rto_daily_pins p where p.config_id = c.id))::int as pinned
      from rto_daily_snapshot_configs c
      where enabled = true ${state ? "and state = $1" : ""}
    `,
    state ? [state] : [],
  );
  return {
    totalRtos: Number(totalResult.rows[0]?.count ?? 0),
    pinnedRtos: Number(totalResult.rows[0]?.pinned ?? 0),
    sample: configs,
  };
}

export async function ensureRtoDailyCycle({ snapshotDate, targetMonth, workerCount = 2, state = null, rto = null, maxJobs = null } = {}) {
  ensureDatabase();
  return transaction(async (tx) => {
    const runRow = await ensureCycleWithQuery(tx, { snapshotDate, targetMonth, workerCount, state });

    await tx(
      `
        insert into rto_daily_jobs
          (run_id, config_id, snapshot_date, target_month, state, rto, queue_priority, queue_reason)
        select $1, c.id, $2::date, $3, c.state, c.rto,
               case when exists (select 1 from rto_daily_pins p where p.config_id = c.id)
                 then $7::integer else $8::integer end,
               case when exists (select 1 from rto_daily_pins p where p.config_id = c.id)
                 then 'pin' else 'rotation' end
        from rto_daily_snapshot_configs c
        where c.enabled = true
          and ($4::text is null or c.state = $4)
          and ($5::text is null or c.rto = $5)
        order by
          case when exists (select 1 from rto_daily_pins p where p.config_id = c.id) then 0 else 1 end,
          coalesce(c.last_snapshot_date, date '1900-01-01') asc,
          c.priority asc,
          c.state asc,
          c.rto asc
        limit $6
        on conflict (run_id, config_id) do update set
          queue_priority = least(rto_daily_jobs.queue_priority, excluded.queue_priority),
          queue_reason = case
            when least(rto_daily_jobs.queue_priority, excluded.queue_priority) = $7::integer then 'pin'
            else rto_daily_jobs.queue_reason
          end,
          updated_at = now()
      `,
      [
        runRow.id,
        dateOnly(runRow.snapshot_date),
        runRow.target_month,
        state,
        rto,
        maxJobs ? Math.max(1, Math.floor(Number(maxJobs))) : 2147483647,
        RTO_DAILY_QUEUE_PRIORITIES.pin,
        RTO_DAILY_QUEUE_PRIORITIES.rotation,
      ],
    );
    await tx(
      `
        with selected as (
          select
            c.id as config_id,
            c.state,
            c.rto,
            c.priority
          from rto_daily_snapshot_configs c
          where c.enabled = true
            and not c.rto ~* '^All Vahan4 Running Office'
            and ($4::text is null or c.state = $4)
            and ($5::text is null or c.rto = $5)
          order by
            case when exists (select 1 from rto_daily_pins p where p.config_id = c.id) then 0 else 1 end,
            coalesce(c.last_snapshot_date, date '1900-01-01') asc,
            c.priority asc,
            c.state asc,
            c.rto asc
          limit $6
        ),
        ranked as (
          select
            selected.*,
            row_number() over (order by priority asc, state asc, rto asc)::int as cohort_rank
          from selected
        )
        insert into rto_daily_run_cohort_members (
          run_id, config_id, snapshot_date, target_month, state, rto, cohort_rank
        )
        select $1, config_id, $2::date, $3, state, rto, cohort_rank
        from ranked
        where not exists (
          select 1 from rto_daily_run_cohort_members existing where existing.run_id = $1
        )
        on conflict (run_id, state, rto) do nothing
      `,
      [
        runRow.id,
        dateOnly(runRow.snapshot_date),
        runRow.target_month,
        state,
        rto,
        maxJobs ? Math.max(1, Math.floor(Number(maxJobs))) : 2147483647,
      ],
    );
    const count = await tx("select count(*)::int as count from rto_daily_jobs where run_id = $1", [runRow.id]);
    const totalRtos = Number(count.rows[0]?.count ?? 0);
    if (!totalRtos) throw new Error("No enabled RTO configs exist. Refresh the official RTO catalog first.");
    const updated = await tx(
      `
        with cohort as (
          select
            count(*)::int as cohort_size,
            md5(string_agg(concat(state, chr(124), rto, chr(124), cohort_rank), chr(10) order by cohort_rank)) as cohort_hash
          from rto_daily_run_cohort_members
          where run_id = $1
        )
        update rto_daily_collection_runs r
        set total_rtos = $2,
            report_cohort_size = cohort.cohort_size,
            report_cohort_hash = cohort.cohort_hash
        from cohort
        where r.id = $1
        returning r.*
      `,
      [runRow.id, totalRtos],
    );
    return normalizeRun(updated.rows[0] ?? { ...runRow, total_rtos: totalRtos });
  });
}

export async function findCarryoverRtoDailyCycle({
  beforeDate = snapshotDateKey(),
  state = null,
  rto = null,
  maxAgeDays = 1,
  maxAgeHours = null,
} = {}) {
  ensureDatabase();
  const minDate = addDays(beforeDate, -Math.max(1, Math.floor(Number(maxAgeDays) || 1)));
  const result = await query(
    `
      select r.*
      from rto_daily_collection_runs r
      where r.snapshot_date < $1::date
        and r.snapshot_date >= $3::date
        and r.status in ('running', 'partial')
        and (
          $5::numeric is null
          or r.started_at + ($5::numeric * interval '1 hour') > now()
        )
        and exists (
          select 1
          from rto_daily_jobs j
          where j.run_id = r.id
          and ($2::text is null or j.state = $2)
          and ($4::text is null or j.rto = $4)
          and coalesce(j.metadata->>'rolledOverToRunId', '') = ''
          and j.status in ('queued', 'retrying', 'running', 'failed', 'deferred')
        )
      order by r.snapshot_date desc, r.started_at desc, r.id desc
      limit 1
    `,
    [
      beforeDate,
      state,
      minDate,
      rto,
      maxAgeHours === null ? null : Math.max(1, Number(maxAgeHours) || 24),
    ],
  );
  return result.rows[0] ? normalizeRun(result.rows[0]) : null;
}

export async function rolloverRtoDailyCycle({
  sourceRunId,
  snapshotDate,
  targetMonth,
  workerCount = 2,
  state = null,
  rto = null,
} = {}) {
  ensureDatabase();
  return transaction(async (tx) => {
    const pending = await tx(
      `
        select j.config_id, j.state, j.rto, j.queue_priority, j.queue_reason
        from rto_daily_jobs j
        where j.run_id = $1
          and ($2::text is null or j.state = $2)
          and ($3::text is null or j.rto = $3)
          and j.status in ('queued', 'retrying', 'running', 'failed', 'deferred')
        order by j.id asc
      `,
      [sourceRunId, state, rto],
    );
    if (!pending.rows.length) return null;

    const runRow = await ensureCycleWithQuery(tx, { snapshotDate, targetMonth, workerCount, state });
    const pendingJson = JSON.stringify(pending.rows);
    await tx(
      `
        insert into rto_daily_jobs
          (run_id, config_id, snapshot_date, target_month, state, rto, queue_priority, queue_reason)
        select $1, pending.config_id, $2::date, $3, pending.state, pending.rto,
               pending.queue_priority, pending.queue_reason
        from jsonb_to_recordset($4::jsonb) as pending(
          config_id bigint, state text, rto text, queue_priority integer, queue_reason text
        )
        on conflict (run_id, config_id) do update set
          queue_priority = excluded.queue_priority,
          queue_reason = excluded.queue_reason,
          status = 'queued', attempts = 0, worker_id = null, lease_expires_at = null,
          next_attempt_at = now(), completed_at = null, last_error = null, updated_at = now()
      `,
      [runRow.id, snapshotDate, targetMonth, pendingJson],
    );
    await tx(
      `
        insert into rto_daily_run_cohort_members (
          run_id, config_id, snapshot_date, target_month, state, rto, cohort_rank
        )
        select $1, pending.config_id, $2::date, $3, pending.state, pending.rto,
               row_number() over (order by pending.config_id)::int
        from jsonb_to_recordset($4::jsonb) as pending(
          config_id bigint, state text, rto text, queue_priority integer, queue_reason text
        )
        on conflict (run_id, state, rto) do nothing
      `,
      [runRow.id, snapshotDate, targetMonth, pendingJson],
    );
    await tx(
      `
        update rto_daily_jobs
        set status = 'deferred', worker_id = null, lease_expires_at = null,
            completed_at = now(),
            metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object(
              'rolledOverToRunId', $2::bigint,
              'rolledOverAt', now()::text
            ),
            updated_at = now()
        where run_id = $1
          and ($3::text is null or state = $3)
          and ($4::text is null or rto = $4)
          and status in ('queued', 'retrying', 'running', 'failed', 'deferred')
          and coalesce(metadata->>'rolledOverToRunId', '') = ''
      `,
      [sourceRunId, runRow.id, state, rto],
    );
    const updated = await tx(
      `
        with cohort as (
          select
            count(*)::int as cohort_size,
            md5(string_agg(concat(state, chr(124), rto, chr(124), cohort_rank), chr(10) order by cohort_rank)) as cohort_hash
          from rto_daily_run_cohort_members
          where run_id = $1
        )
        update rto_daily_collection_runs r
        set total_rtos = (select count(*)::int from rto_daily_jobs where run_id = $1),
            report_cohort_size = cohort.cohort_size,
            report_cohort_hash = cohort.cohort_hash
        from cohort
        where r.id = $1
        returning r.*
      `,
      [runRow.id],
    );
    return normalizeRun(updated.rows[0] ?? runRow);
  });
}

export async function requeueDeferredRtoDailyJobs({ runId, state = null, rto = null } = {}) {
  ensureDatabase();
  const result = await query(
    `
      update rto_daily_jobs
      set status = 'queued', attempts = 0, next_attempt_at = now(), completed_at = null,
          worker_id = null, lease_expires_at = null, updated_at = now()
      where run_id = $1 and status = 'deferred'
        and ($2::text is null or state = $2)
        and ($3::text is null or rto = $3)
    `,
    [runId, state, rto],
  );
  return { count: result.rowCount };
}

export async function enqueueRtoDailyJob({
  state,
  rto,
  snapshotDate = snapshotDateKey(),
  targetMonth = targetMonthForDate(),
  reason = "lookup",
  workerCount = 2,
} = {}) {
  ensureDatabase();
  const normalized = normalizeConfigInput({ state, rto, enabled: true });
  if (!normalized.state || !normalized.rto) throw inputError("A canonical state and RTO are required.");
  if (!Object.hasOwn(RTO_DAILY_QUEUE_PRIORITIES, reason)) throw inputError("Unknown RTO queue reason.");
  return transaction(async (tx) => {
    const config = await ensureConfigWithQuery(tx, normalized);
    const run = await ensureCycleWithQuery(tx, { snapshotDate, targetMonth, workerCount });
    const priority = RTO_DAILY_QUEUE_PRIORITIES[reason];
    const result = await tx(
      `
        insert into rto_daily_jobs
          (run_id, config_id, snapshot_date, target_month, state, rto, queue_priority, queue_reason)
        values ($1, $2, $3::date, $4, $5, $6, $7, $8)
        on conflict (run_id, config_id) do update set
          queue_priority = least(rto_daily_jobs.queue_priority, excluded.queue_priority),
          queue_reason = case
            when least(rto_daily_jobs.queue_priority, excluded.queue_priority) = excluded.queue_priority
              then excluded.queue_reason
            else rto_daily_jobs.queue_reason
          end,
          status = case
            when rto_daily_jobs.status in ('success', 'running', 'retrying') then rto_daily_jobs.status
            else 'queued'
          end,
          next_attempt_at = case
            when rto_daily_jobs.status in ('success', 'running', 'retrying') then rto_daily_jobs.next_attempt_at
            else now()
          end,
          completed_at = case when rto_daily_jobs.status = 'success' then rto_daily_jobs.completed_at else null end,
          last_error = case when rto_daily_jobs.status = 'success' then rto_daily_jobs.last_error else null end,
          updated_at = now()
        returning *
      `,
      [run.id, config.id, snapshotDate, targetMonth, config.state, config.rto, priority, reason],
    );
    await updateCycleTotalWithQuery(tx, run.id);
    return normalizeJob(result.rows[0]);
  });
}

export async function claimRtoDailyJob({ runId, workerId, leaseMinutes = 20 } = {}) {
  ensureDatabase();
  return transaction(async (tx) => {
    const result = await tx(
      `
        with candidate as (
          select j.id
          from rto_daily_jobs j
          join rto_daily_snapshot_configs c on c.id = j.config_id
          where j.run_id = $1
            and (
              (j.status in ('queued', 'retrying') and j.next_attempt_at <= now())
              or (j.status = 'running' and j.lease_expires_at < now())
            )
          order by j.queue_priority asc,
                   coalesce(c.last_snapshot_date, date '1900-01-01') asc,
                   c.priority asc,
                   j.attempts asc,
                   j.id asc
          for update skip locked
          limit 1
        )
        update rto_daily_jobs j
        set status = 'running',
            attempts = attempts + 1,
            worker_id = $2,
            lease_expires_at = now() + make_interval(mins => $3),
            started_at = coalesce(started_at, now()),
            last_error = null,
            updated_at = now()
        from candidate
        where j.id = candidate.id
        returning j.*
      `,
      [runId, workerId, Math.max(5, Math.floor(Number(leaseMinutes) || 20))],
    );
    return result.rows[0] ? normalizeJob(result.rows[0]) : null;
  });
}

export async function heartbeatRtoDailyJob({ jobId, workerId, leaseMinutes = 20 } = {}) {
  ensureDatabase();
  const result = await query(
    `
      update rto_daily_jobs
      set lease_expires_at = now() + make_interval(mins => $3), updated_at = now()
      where id = $1 and worker_id = $2 and status = 'running'
    `,
    [jobId, workerId, Math.max(5, Math.floor(Number(leaseMinutes) || 20))],
  );
  return result.rowCount === 1;
}

export async function failRtoDailyJob({ jobId, workerId, error, maxAttempts = 3 } = {}) {
  ensureDatabase();
  return transaction(async (tx) => {
    const message = String(error ?? "Unknown scrape failure").slice(0, 4000);
    const result = await tx(
      `
        update rto_daily_jobs
        set status = case when attempts >= $4 then 'failed' else 'retrying' end,
            next_attempt_at = now() + case attempts when 1 then interval '30 seconds' when 2 then interval '2 minutes' else interval '10 minutes' end,
            lease_expires_at = null,
            worker_id = null,
            completed_at = case when attempts >= $4 then now() else null end,
            last_error = $3,
            updated_at = now()
        where id = $1 and worker_id = $2 and status = 'running'
        returning *
      `,
      [jobId, workerId, message, Math.max(1, Number(maxAttempts) || 3)],
    );
    if (result.rows[0]?.status === "failed") {
      await tx(
        `update rto_daily_snapshot_configs set last_status = 'failed', last_error = $2, updated_at = now() where id = $1`,
        [result.rows[0].config_id, message],
      );
    }
    return result.rows[0] ? normalizeJob(result.rows[0]) : null;
  });
}

export async function rtoDailyCycleSummary(runId) {
  ensureDatabase();
  const result = await query(
    `
      select
        count(*)::int as total,
        count(*) filter (where status = 'queued')::int as queued,
        count(*) filter (where status = 'running')::int as running,
        count(*) filter (where status = 'running' and lease_expires_at >= now())::int as active_running,
        count(*) filter (where status = 'running' and lease_expires_at < now())::int as stale_running,
        count(*) filter (where status = 'retrying')::int as retrying,
        count(*) filter (where status = 'success')::int as succeeded,
        count(*) filter (where status = 'failed')::int as failed,
        count(*) filter (where status = 'deferred')::int as deferred,
        count(*) filter (where queue_reason = 'pin')::int as pinned,
        count(*) filter (where queue_reason = 'lookup')::int as lookup,
        count(*) filter (where queue_reason = 'rotation')::int as rotation,
        min(next_attempt_at) filter (where status = 'retrying') as next_attempt_at,
        min(started_at) as first_started_at,
        max(completed_at) as last_completed_at
      from rto_daily_jobs
      where run_id = $1
    `,
    [runId],
  );
  return normalizeCycleSummary(result.rows[0] ?? {});
}

export async function rtoDailySnapshotStatusSummary({ runId, snapshotDate = null } = {}) {
  ensureDatabase();
  const values = [];
  const clauses = [];
  if (runId) {
    values.push(runId);
    clauses.push(`scrape_run_id = $${values.length}`);
  }
  if (snapshotDate) {
    values.push(snapshotDate);
    clauses.push(`snapshot_date = $${values.length}::date`);
  }
  if (!clauses.length) throw new Error("runId or snapshotDate is required for snapshot status summary.");
  const result = await query(
    `
      select
        (count(distinct concat(state, chr(124), rto)) filter (where scrape_status = 'success'))::int as success_rtos,
        (count(distinct concat(state, chr(124), rto)) filter (where scrape_status = 'late_fill'))::int as late_fill_rtos
      from rto_daily_snapshots
      where ${clauses.join(" and ")}
    `,
    values,
  );
  return {
    successRtos: Number(result.rows[0]?.success_rtos ?? 0),
    lateFillRtos: Number(result.rows[0]?.late_fill_rtos ?? 0),
  };
}

export async function requeueFailedRtoDailyJobs({ runId, state = null, rto = null } = {}) {
  ensureDatabase();
  const result = await query(
    `
      update rto_daily_jobs
      set status = 'retrying', attempts = 0, next_attempt_at = now(), completed_at = null,
          worker_id = null, lease_expires_at = null, updated_at = now()
      where run_id = $1 and status = 'failed'
        and ($2::text is null or state = $2)
        and ($3::text is null or rto = $3)
    `,
    [runId, state, rto],
  );
  return { count: result.rowCount };
}

export async function finalizeRtoDailyCycle(runId) {
  ensureDatabase();
  const summary = await rtoDailyCycleSummary(runId);
  if (summary.queued || summary.running || summary.retrying) return { complete: false, summary };
  const status = summary.deferred || summary.failed
    ? (summary.succeeded || summary.deferred ? "partial" : "failed")
    : "success";
  const result = await query(
    `
      update rto_daily_collection_runs
      set status = $2,
          completed_at = now(),
          attempted_rtos = $3,
          succeeded_rtos = $4,
          failed_rtos = $5,
          total_rtos = $6
      where id = $1
      returning *
    `,
    [runId, status, summary.succeeded + summary.failed, summary.succeeded, summary.failed, summary.total],
  );
  return { complete: true, summary, run: normalizeRun(result.rows[0]) };
}

export async function deferStaleRtoDailyCycles({ beforeDate = snapshotDateKey(), state = null, rto = null } = {}) {
  ensureDatabase();
  return transaction(async (tx) => {
    const staleRuns = await tx(
      `
        select r.id
        from rto_daily_collection_runs r
        where r.snapshot_date < $1::date
          and r.status = 'running'
          and exists (
            select 1
            from rto_daily_jobs j
            where j.run_id = r.id
              and ($2::text is null or j.state = $2)
              and ($3::text is null or j.rto = $3)
          )
        order by r.snapshot_date asc, r.id asc
        for update
      `,
      [beforeDate, state, rto],
    );
    let deferredJobs = 0;
    for (const row of staleRuns.rows) {
      const deferred = await tx(
        `
          update rto_daily_jobs
          set status = 'deferred', worker_id = null, lease_expires_at = null,
              completed_at = now(), updated_at = now()
          where run_id = $1 and status in ('queued', 'retrying', 'running')
            and ($2::text is null or state = $2)
            and ($3::text is null or rto = $3)
        `,
        [row.id, state, rto],
      );
      deferredJobs += deferred.rowCount;
      const counts = await tx(
        `
          select count(*)::int as total,
                 count(*) filter (where status = 'success')::int as succeeded,
                 count(*) filter (where status = 'failed')::int as failed
          from rto_daily_jobs where run_id = $1
        `,
        [row.id],
      );
      const summary = counts.rows[0] ?? {};
      await tx(
        `
          update rto_daily_collection_runs
          set status = 'partial', completed_at = now(), total_rtos = $2,
              attempted_rtos = $3, succeeded_rtos = $4, failed_rtos = $5
          where id = $1
        `,
        [
          row.id,
          Number(summary.total ?? 0),
          Number(summary.succeeded ?? 0) + Number(summary.failed ?? 0),
          Number(summary.succeeded ?? 0),
          Number(summary.failed ?? 0),
        ],
      );
    }
    return { runs: staleRuns.rowCount, jobs: deferredJobs, beforeDate };
  });
}

export async function createRtoDailyCollectionRun(metadata = {}) {
  ensureDatabase();
  const result = await query(
    `
      insert into rto_daily_collection_runs (status, metadata)
      values ('running', $1::jsonb)
      returning id, status, started_at, completed_at, attempted_rtos, succeeded_rtos, failed_rtos, errors, metadata
    `,
    [JSON.stringify(metadata ?? {})],
  );
  return normalizeRun(result.rows[0]);
}

export async function completeRtoDailyCollectionRun(id, payload = {}) {
  ensureDatabase();
  const result = await query(
    `
      update rto_daily_collection_runs
      set status = $2,
          completed_at = now(),
          attempted_rtos = $3,
          succeeded_rtos = $4,
          failed_rtos = $5,
          errors = $6::jsonb,
          metadata = $7::jsonb
      where id = $1
      returning id, status, started_at, completed_at, attempted_rtos, succeeded_rtos, failed_rtos, errors, metadata
    `,
    [
      id,
      payload.status ?? (payload.failedRtos ? "partial" : "success"),
      Number(payload.attemptedRtos ?? 0),
      Number(payload.succeededRtos ?? 0),
      Number(payload.failedRtos ?? 0),
      JSON.stringify(payload.errors ?? []),
      JSON.stringify(payload.metadata ?? {}),
    ],
  );
  return result.rows[0] ? normalizeRun(result.rows[0]) : null;
}

export async function upsertRtoDailySnapshots(rows = []) {
  ensureDatabase();
  return upsertRtoDailySnapshotsWithQuery(query, rows);
}

async function upsertRtoDailySnapshotsWithQuery(runQuery, rows = [], reportIds = new Map()) {
  const normalized = rows.map(normalizeSnapshotInput).filter(isValidSnapshot);
  if (!normalized.length) return { count: 0 };
  const columns = [
    "snapshot_date",
    "target_month",
    "state",
    "rto",
    "fuel_group",
    "vehicle_category",
    "oem",
    "vehicle_count",
    "source",
    "scrape_status",
    "scrape_run_id",
    "report_id",
    "scraped_at",
    "raw",
  ];
  const values = [];
  const placeholders = normalized.map((row, rowIndex) => {
    const offset = rowIndex * columns.length;
    values.push(
      row.snapshotDate,
      row.targetMonth,
      row.state,
      row.rto,
      row.fuelGroup,
      row.vehicleCategory,
      row.oem,
      row.vehicleCount,
      row.source,
      row.scrapeStatus,
      row.scrapeRunId,
      reportIds.get(`${row.fuelGroup}||${row.vehicleCategory}`) ?? row.reportId,
      row.scrapedAt,
      JSON.stringify(row.raw ?? {}),
    );
    return `(${columns.map((_, columnIndex) => `$${offset + columnIndex + 1}`).join(", ")})`;
  });
  await runQuery(
    `
      insert into rto_daily_snapshots (${columns.join(", ")})
      values ${placeholders.join(", ")}
      on conflict (snapshot_date, target_month, state, rto, fuel_group, vehicle_category, oem)
      do update set
        vehicle_count = excluded.vehicle_count,
        source = excluded.source,
        scrape_status = excluded.scrape_status,
        scrape_run_id = excluded.scrape_run_id,
        report_id = excluded.report_id,
        scraped_at = excluded.scraped_at,
        raw = excluded.raw,
        updated_at = now()
    `,
    values,
  );
  return { count: normalized.length };
}

export function validateRtoDailyReport(report, expected = {}) {
  const errors = [];
  if (report?.status !== "success") errors.push("report status is not success");
  if (!report?.filtersConfirmed) errors.push("report filters were not confirmed");
  if (String(report?.state ?? "") !== String(expected.state ?? report?.state ?? "")) errors.push("state mismatch");
  if (String(report?.rto ?? "") !== String(expected.rto ?? report?.rto ?? "")) errors.push("RTO mismatch");
  if (!RTO_DAILY_FUEL_GROUPS.includes(String(report?.fuelGroup ?? ""))) errors.push("invalid fuel group");
  if (!RTO_DAILY_CATEGORIES.includes(String(report?.vehicleCategory ?? ""))) errors.push("invalid vehicle category");
  if (!Array.isArray(report?.rows)) errors.push("maker rows are missing");
  const rows = Array.isArray(report?.rows) ? report.rows : [];
  for (const row of rows) {
    if (!String(row?.maker ?? "").trim()) errors.push("maker label is missing");
    if (!Number.isFinite(Number(row?.vehicle_count ?? row?.vehicleCount)) || Number(row?.vehicle_count ?? row?.vehicleCount) < 0) {
      errors.push("maker count is invalid");
    }
  }
  if (!rows.length && !(report?.explicitZero && Number(report?.reportTotal) === 0)) {
    errors.push("empty report was not explicitly confirmed as zero");
  }
  if (errors.length) throw new Error(`Invalid VAHAN report: ${[...new Set(errors)].join(", ")}`);
  return true;
}

export async function completeRtoDailyJob({ job, workerId, reports = [], rows = [] } = {}) {
  ensureDatabase();
  if (!job?.id || !job?.runId) throw new Error("A claimed RTO daily job is required.");
  if (reports.length !== RTO_DAILY_FUEL_GROUPS.length * RTO_DAILY_CATEGORIES.length) {
    throw new Error(`Expected 6 validated reports, received ${reports.length}.`);
  }
  if (rows.length !== rtoDailyExpectedRowCount()) {
    throw new Error(`Expected ${rtoDailyExpectedRowCount()} snapshot rows, received ${rows.length}.`);
  }
  for (const report of reports) validateRtoDailyReport(report, { state: job.state, rto: job.rto });

  return transaction(async (tx) => {
    const ownership = await tx(
      "select id from rto_daily_jobs where id = $1 and worker_id = $2 and status = 'running' for update",
      [job.id, workerId],
    );
    if (!ownership.rowCount) throw new Error(`Worker ${workerId} no longer owns job ${job.id}.`);

    const reportIds = new Map();
    for (const report of reports) {
      const inserted = await tx(
        `
          insert into rto_daily_scrape_reports (
            run_id, job_id, snapshot_date, target_month, state, rto,
            fuel_group, vehicle_category, status, report_total, source_row_count,
            attempts, filters_confirmed, explicit_zero, scraped_at, evidence
          ) values ($1,$2,$3::date,$4,$5,$6,$7,$8,'success',$9,$10,$11,true,$12,$13,$14::jsonb)
          on conflict (snapshot_date, target_month, state, rto, fuel_group, vehicle_category)
          do update set
            run_id = excluded.run_id,
            job_id = excluded.job_id,
            status = excluded.status,
            report_total = excluded.report_total,
            source_row_count = excluded.source_row_count,
            attempts = excluded.attempts,
            filters_confirmed = excluded.filters_confirmed,
            explicit_zero = excluded.explicit_zero,
            scraped_at = excluded.scraped_at,
            evidence = excluded.evidence,
            updated_at = now()
          returning id
        `,
        [
          job.runId,
          job.id,
          job.snapshotDate,
          job.targetMonth,
          job.state,
          job.rto,
          report.fuelGroup,
          report.vehicleCategory,
          report.reportTotal,
          report.rows.length,
          Math.max(1, Number(report.attempts) || 1),
          Boolean(report.explicitZero),
          report.scrapedAt,
          JSON.stringify(report.evidence ?? {}),
        ],
      );
      reportIds.set(`${report.fuelGroup}||${report.vehicleCategory}`, Number(inserted.rows[0].id));
    }
    await upsertRtoDailySnapshotsWithQuery(tx, rows, reportIds);
    await tx(
      `
        update rto_daily_jobs
        set status = 'success', completed_at = now(), lease_expires_at = null,
            last_error = null, metadata = $3::jsonb, updated_at = now()
        where id = $1 and worker_id = $2
      `,
      [job.id, workerId, JSON.stringify({ reportCount: reports.length, rowCount: rows.length })],
    );
    await tx(
      `
        update rto_daily_snapshot_configs
        set last_snapshot_date = $3::date, last_status = 'success', last_error = null, updated_at = now()
        where state = $1 and rto = $2
      `,
      [job.state, job.rto, job.snapshotDate],
    );
    return { reports: reports.length, rows: rows.length };
  });
}

export async function markRtoDailyConfigStatus({ state, rto, snapshotDate = null, status, error = null }) {
  ensureDatabase();
  await query(
    `
      update rto_daily_snapshot_configs
      set last_snapshot_date = coalesce($3::date, last_snapshot_date),
          last_status = $4,
          last_error = $5,
          updated_at = now()
      where state = $1 and rto = $2
    `,
    [state, rto, snapshotDate, status, error],
  );
}

export async function rollupAndPruneRtoDailySnapshots({ retentionDays = 30, now = new Date() } = {}) {
  ensureDatabase();
  const cutoff = addDays(snapshotDateKey(now), -Math.max(1, Math.floor(Number(retentionDays) || 30)));
  return transaction(async (tx) => {
    await tx(
      `
      insert into rto_monthly_snapshot_aggregates (
        target_month,
        state,
        rto,
        fuel_group,
        vehicle_category,
        oem,
        latest_snapshot_date,
        latest_vehicle_count,
        min_vehicle_count,
        max_vehicle_count,
        sample_count
      )
      select
        target_month,
        state,
        rto,
        fuel_group,
        vehicle_category,
        oem,
        max(snapshot_date) as latest_snapshot_date,
        (array_agg(vehicle_count order by snapshot_date desc))[1] as latest_vehicle_count,
        min(vehicle_count) as min_vehicle_count,
        max(vehicle_count) as max_vehicle_count,
        count(*)::int as sample_count
      from rto_daily_snapshots
      where snapshot_date < $1::date
      group by target_month, state, rto, fuel_group, vehicle_category, oem
      on conflict (target_month, state, rto, fuel_group, vehicle_category, oem)
      do update set
        latest_snapshot_date = greatest(rto_monthly_snapshot_aggregates.latest_snapshot_date, excluded.latest_snapshot_date),
        latest_vehicle_count = case
          when excluded.latest_snapshot_date >= rto_monthly_snapshot_aggregates.latest_snapshot_date
          then excluded.latest_vehicle_count
          else rto_monthly_snapshot_aggregates.latest_vehicle_count
        end,
        min_vehicle_count = least(rto_monthly_snapshot_aggregates.min_vehicle_count, excluded.min_vehicle_count),
        max_vehicle_count = greatest(rto_monthly_snapshot_aggregates.max_vehicle_count, excluded.max_vehicle_count),
        sample_count = rto_monthly_snapshot_aggregates.sample_count + excluded.sample_count,
        updated_at = now()
      `,
      [cutoff],
    );
    const deletedReports = await tx(
      `delete from rto_daily_scrape_reports where snapshot_date < $1::date`,
      [cutoff],
    );
    const deleted = await tx("delete from rto_daily_snapshots where snapshot_date < $1::date", [cutoff]);
    return { cutoff, deleted: deleted.rowCount, deletedReports: deletedReports.rowCount };
  });
}

export async function listRtoDailyPins({ userId } = {}) {
  ensureDatabase();
  if (!userId) throw inputError("A user is required to list RTO pins.");
  const result = await query(
    `
      select p.id, p.user_id, p.config_id, p.created_at, p.updated_at,
             c.state, c.rto, c.last_snapshot_date, c.last_status, c.last_error,
             latest_job.id as job_id, latest_job.status as job_status,
             latest_job.queue_reason, latest_job.queue_priority,
             latest_job.attempts as job_attempts, latest_job.last_error as job_error,
             latest_job.updated_at as job_updated_at
      from rto_daily_pins p
      join rto_daily_snapshot_configs c on c.id = p.config_id
      left join lateral (
        select id, status, queue_reason, queue_priority, attempts, last_error, updated_at
        from rto_daily_jobs j
        where j.config_id = c.id
        order by snapshot_date desc, id desc
        limit 1
      ) latest_job on true
      where p.user_id = $1
      order by p.created_at desc, p.id desc
    `,
    [userId],
  );
  return result.rows.map(normalizePin);
}

export async function createRtoDailyPin({ userId, state, rto, maxPins = RTO_DAILY_MAX_PINS_PER_USER } = {}) {
  ensureDatabase();
  if (!userId) throw inputError("A user is required to pin an RTO.");
  const normalized = normalizeConfigInput({ state, rto, enabled: true });
  if (!normalized.state || !normalized.rto) throw inputError("A canonical state and RTO are required.");
  return transaction(async (tx) => {
    const lockedUser = await tx("select id from users where id = $1 for update", [userId]);
    if (!lockedUser.rows[0]) {
      const error = new Error("User not found.");
      error.statusCode = 404;
      throw error;
    }
    const config = await ensureConfigWithQuery(tx, normalized);
    const existing = await tx(
      `
        select p.id, p.user_id, p.config_id, p.created_at, p.updated_at,
               c.state, c.rto, c.last_snapshot_date, c.last_status, c.last_error
        from rto_daily_pins p
        join rto_daily_snapshot_configs c on c.id = p.config_id
        where p.user_id = $1 and p.config_id = $2
      `,
      [userId, config.id],
    );
    if (existing.rows[0]) return { pin: normalizePin(existing.rows[0]), created: false };
    const count = await tx("select count(*)::int as count from rto_daily_pins where user_id = $1", [userId]);
    const limit = Math.max(1, Number(maxPins) || RTO_DAILY_MAX_PINS_PER_USER);
    if (Number(count.rows[0]?.count ?? 0) >= limit) {
      const error = new Error(`You can pin up to ${limit} RTOs.`);
      error.statusCode = 409;
      error.code = "rto_pin_limit";
      throw error;
    }
    const inserted = await tx(
      `
        insert into rto_daily_pins (user_id, config_id)
        values ($1, $2)
        returning id, user_id, config_id, created_at, updated_at
      `,
      [userId, config.id],
    );
    return {
      pin: normalizePin({ ...inserted.rows[0], state: config.state, rto: config.rto }),
      created: true,
    };
  });
}

export async function deleteRtoDailyPin(id, { userId } = {}) {
  ensureDatabase();
  if (!userId) throw inputError("A user is required to unpin an RTO.");
  const existing = await query(
    `
      select p.id, p.user_id, p.config_id, p.created_at, p.updated_at,
             c.state, c.rto, c.last_snapshot_date, c.last_status, c.last_error
      from rto_daily_pins p
      join rto_daily_snapshot_configs c on c.id = p.config_id
      where p.id = $1 and p.user_id = $2
    `,
    [id, userId],
  );
  if (!existing.rows[0]) return null;
  await query("delete from rto_daily_pins where id = $1 and user_id = $2", [id, userId]);
  return normalizePin(existing.rows[0]);
}

export async function getRtoDailyStatus({ state, rto, userId = null } = {}) {
  ensureDatabase();
  const result = await query(
    `
      select c.id as config_id, c.state, c.rto, c.enabled,
             c.last_snapshot_date, c.last_status, c.last_error,
             pin.id as pin_id,
             latest_job.id as job_id, latest_job.status as job_status,
             latest_job.queue_reason, latest_job.queue_priority,
             latest_job.attempts as job_attempts, latest_job.last_error as job_error,
             latest_job.snapshot_date as job_snapshot_date,
             latest_job.updated_at as job_updated_at
      from rto_daily_snapshot_configs c
      left join lateral (
        select id
        from rto_daily_pins p
        where p.config_id = c.id and p.user_id = $3
        limit 1
      ) pin on $3::bigint is not null
      left join lateral (
        select id, status, queue_reason, queue_priority, attempts, last_error, snapshot_date, updated_at
        from rto_daily_jobs j
        where j.config_id = c.id
        order by snapshot_date desc, id desc
        limit 1
      ) latest_job on true
      where c.state = $1 and c.rto = $2
      limit 1
    `,
    [state, rto, userId],
  );
  const row = result.rows[0];
  if (!row) {
    return {
      state,
      rto,
      configured: false,
      pinned: false,
      pinId: null,
      lastSnapshotDate: null,
      lastStatus: null,
      lastError: null,
      job: null,
    };
  }
  return normalizeStatus(row);
}

export async function listRtoDailyRtos({ state = null } = {}) {
  ensureDatabase();
  const values = [];
  const clauses = ["enabled = true"];
  if (state) {
    values.push(state);
    clauses.push(`state = $${values.length}`);
  }
  const result = await query(
    `
      select state, rto, priority, last_snapshot_date, last_status, last_error
      from rto_daily_snapshot_configs
      where ${clauses.join(" and ")}
      order by state asc, rto asc
    `,
    values,
  );
  return result.rows.map((row) => ({
    state: row.state,
    rto: row.rto,
    priority: Number(row.priority ?? 100),
    lastSnapshotDate: dateOnly(row.last_snapshot_date),
    lastStatus: row.last_status,
    lastError: row.last_error,
  }));
}

export async function listRtoDailyFreshness({ limit = 200 } = {}) {
  ensureDatabase();
  const result = await query(
    `
      select
        c.state,
        c.rto,
        c.enabled,
        c.priority,
        c.last_snapshot_date,
        c.last_status,
        c.last_error,
        count(s.id)::int as snapshot_rows,
        max(s.scraped_at) as latest_scraped_at,
        latest_job.status as job_status,
        latest_job.attempts as job_attempts,
        latest_job.worker_id,
        latest_job.updated_at as job_updated_at
      from rto_daily_snapshot_configs c
      left join rto_daily_snapshots s on s.state = c.state and s.rto = c.rto and s.snapshot_date = c.last_snapshot_date
      left join lateral (
        select status, attempts, worker_id, updated_at
        from rto_daily_jobs j
        where j.config_id = c.id
        order by snapshot_date desc, id desc
        limit 1
      ) latest_job on true
      group by c.id, latest_job.status, latest_job.attempts, latest_job.worker_id, latest_job.updated_at
      order by c.enabled desc, c.priority asc, coalesce(c.last_snapshot_date, date '1900-01-01') asc, c.state asc, c.rto asc
      limit $1
    `,
    [Math.max(1, Math.min(Number(limit) || 200, 1000))],
  );
  return result.rows.map((row) => ({
    state: row.state,
    rto: row.rto,
    enabled: Boolean(row.enabled),
    priority: Number(row.priority ?? 100),
    lastSnapshotDate: dateOnly(row.last_snapshot_date),
    lastStatus: row.last_status,
    lastError: row.last_error,
    snapshotRows: Number(row.snapshot_rows ?? 0),
    latestScrapedAt: row.latest_scraped_at ? new Date(row.latest_scraped_at).toISOString() : null,
    jobStatus: row.job_status ?? null,
    jobAttempts: Number(row.job_attempts ?? 0),
    workerId: row.worker_id ?? null,
    jobUpdatedAt: row.job_updated_at ? new Date(row.job_updated_at).toISOString() : null,
  }));
}

export async function getRtoDailyCoverage({ date = null } = {}) {
  ensureDatabase();
  const values = [];
  const clause = date ? (values.push(date), "where snapshot_date = $1::date") : "where snapshot_date is not null";
  const run = await query(
    `
      select * from rto_daily_collection_runs
      ${clause}
      order by snapshot_date desc, started_at desc
      limit 1
    `,
    values,
  );
  if (!run.rows[0]) return { run: null, summary: normalizeCycleSummary({}) };
  const summary = await rtoDailyCycleSummary(run.rows[0].id);
  const snapshotStatuses = await rtoDailySnapshotStatusSummary({ runId: run.rows[0].id });
  const elapsedMs = Math.max(0, Date.now() - new Date(run.rows[0].started_at).getTime());
  const completed = summary.succeeded + summary.failed;
  const pending = Math.max(0, summary.total - summary.succeeded - summary.failed - summary.deferred);
  const projectedFinishAt = completed > 0 && completed < summary.total
    ? new Date(new Date(run.rows[0].started_at).getTime() + (elapsedMs / completed) * summary.total).toISOString()
    : run.rows[0].completed_at ? new Date(run.rows[0].completed_at).toISOString() : null;
  return {
    run: normalizeRun(run.rows[0]),
    summary: {
      ...summary,
      ...snapshotStatuses,
      failedRtos: summary.failed,
      pendingRtos: pending,
      completionPercent: summary.total ? Number(((completed / summary.total) * 100).toFixed(1)) : 0,
      coveragePercent: summary.total ? Number(((summary.succeeded / summary.total) * 100).toFixed(1)) : 0,
      projectedFinishAt,
    },
  };
}

export async function listRtoDailyRuns({ limit = 20 } = {}) {
  ensureDatabase();
  const result = await query(
    `select * from rto_daily_collection_runs where snapshot_date is not null order by snapshot_date desc, started_at desc limit $1`,
    [Math.max(1, Math.min(Number(limit) || 20, 100))],
  );
  return result.rows.map(normalizeRun);
}

export async function listRtoDailyTrend(filters = {}) {
  ensureDatabase();
  const values = [];
  const clauses = [];
  const add = (column, value) => {
    if (!value) return;
    values.push(value);
    clauses.push(`${column} = $${values.length}`);
  };
  add("state", filters.state);
  add("rto", filters.rto);
  add("fuel_group", filters.fuelGroup);
  add("vehicle_category", filters.category);
  add("oem", filters.oem);
  values.push(Math.max(1, Math.min(Number(filters.limit) || 30, 365)));
  const result = await query(
    `
      with trend as (
        select snapshot_date, target_month, state, rto, fuel_group, vehicle_category, oem,
               vehicle_count, scrape_status, scraped_at,
               vehicle_count - lag(vehicle_count) over (
                 partition by target_month, state, rto, fuel_group, vehicle_category, oem
                 order by snapshot_date
               ) as daily_delta
        from rto_daily_snapshots
        ${clauses.length ? `where ${clauses.join(" and ")}` : ""}
      )
      select * from trend
      order by snapshot_date desc, state asc, rto asc, fuel_group asc, vehicle_category asc, oem asc
      limit $${values.length}
    `,
    values,
  );
  return result.rows.map(normalizeSnapshotRow).reverse();
}

function normalizeConfigInput(input) {
  return {
    state: String(input.state ?? "").trim(),
    rto: String(input.rto ?? "").trim(),
    enabled: input.enabled === undefined ? true : Boolean(input.enabled),
    priority: Math.max(0, Math.floor(Number(input.priority) || 100)),
  };
}

async function ensureConfigWithQuery(runQuery, input) {
  const result = await runQuery(
    `
      insert into rto_daily_snapshot_configs
        (state, rto, enabled, priority, catalog_last_seen_at)
      values ($1, $2, true, $3, now())
      on conflict (state, rto) do update set
        enabled = true,
        catalog_last_seen_at = greatest(rto_daily_snapshot_configs.catalog_last_seen_at, excluded.catalog_last_seen_at),
        catalog_miss_count = 0,
        updated_at = now()
      returning id, state, rto, enabled, priority, last_snapshot_date, last_status, last_error,
                catalog_last_seen_at, catalog_miss_count, created_at, updated_at
    `,
    [input.state, input.rto, input.priority ?? 100],
  );
  return normalizeConfig(result.rows[0]);
}

async function ensureCycleWithQuery(runQuery, { snapshotDate, targetMonth, workerCount = 2, state = null } = {}) {
  const result = await runQuery(
    `
      insert into rto_daily_collection_runs
        (status, snapshot_date, target_month, worker_count, metadata)
      values ('running', $1::date, $2, $3, $4::jsonb)
      on conflict (snapshot_date, target_month) where snapshot_date is not null and target_month is not null
      do update set
        worker_count = excluded.worker_count,
        status = 'running',
        started_at = case
          when rto_daily_collection_runs.status = 'running' then rto_daily_collection_runs.started_at
          else now()
        end,
        completed_at = null
      returning id, status, snapshot_date, target_month, started_at, completed_at,
                attempted_rtos, succeeded_rtos, failed_rtos, errors, metadata,
                worker_count, total_rtos
    `,
    [
      snapshotDate,
      targetMonth,
      Math.max(1, Math.min(Number(workerCount) || 2, 4)),
      JSON.stringify({ state }),
    ],
  );
  return result.rows[0];
}

async function updateCycleTotalWithQuery(runQuery, runId) {
  const result = await runQuery(
    `
      update rto_daily_collection_runs
      set total_rtos = (select count(*)::int from rto_daily_jobs where run_id = $1)
      where id = $1
      returning total_rtos
    `,
    [runId],
  );
  return Number(result.rows[0]?.total_rtos ?? 0);
}

function normalizeConfig(row) {
  return {
    id: Number(row.id),
    state: row.state,
    rto: row.rto,
    enabled: Boolean(row.enabled),
    priority: Number(row.priority ?? 100),
    lastSnapshotDate: dateOnly(row.last_snapshot_date),
    lastStatus: row.last_status,
    lastError: row.last_error,
    catalogLastSeenAt: row.catalog_last_seen_at ? new Date(row.catalog_last_seen_at).toISOString() : null,
    catalogMissCount: Number(row.catalog_miss_count ?? 0),
    createdAt: row.created_at ? new Date(row.created_at).toISOString() : null,
    updatedAt: row.updated_at ? new Date(row.updated_at).toISOString() : null,
  };
}

function normalizeRun(row) {
  return {
    id: Number(row.id),
    status: row.status,
    snapshotDate: dateOnly(row.snapshot_date),
    targetMonth: row.target_month ?? row.metadata?.targetMonth ?? null,
    workerCount: Number(row.worker_count ?? 1),
    totalRtos: Number(row.total_rtos ?? 0),
    reportCohortHash: row.report_cohort_hash ?? null,
    reportCohortSize: Number(row.report_cohort_size ?? 0),
    startedAt: row.started_at ? new Date(row.started_at).toISOString() : null,
    completedAt: row.completed_at ? new Date(row.completed_at).toISOString() : null,
    attemptedRtos: Number(row.attempted_rtos ?? 0),
    succeededRtos: Number(row.succeeded_rtos ?? 0),
    failedRtos: Number(row.failed_rtos ?? 0),
    errors: row.errors ?? [],
    metadata: row.metadata ?? {},
  };
}

function normalizeJob(row) {
  return {
    id: Number(row.id),
    runId: Number(row.run_id),
    configId: Number(row.config_id),
    snapshotDate: dateOnly(row.snapshot_date),
    targetMonth: row.target_month,
    state: row.state,
    rto: row.rto,
    status: row.status,
    queuePriority: Number(row.queue_priority ?? RTO_DAILY_QUEUE_PRIORITIES.rotation),
    queueReason: row.queue_reason ?? "rotation",
    attempts: Number(row.attempts ?? 0),
    workerId: row.worker_id ?? null,
    leaseExpiresAt: row.lease_expires_at ? new Date(row.lease_expires_at).toISOString() : null,
    nextAttemptAt: row.next_attempt_at ? new Date(row.next_attempt_at).toISOString() : null,
    startedAt: row.started_at ? new Date(row.started_at).toISOString() : null,
    completedAt: row.completed_at ? new Date(row.completed_at).toISOString() : null,
    lastError: row.last_error ?? null,
    metadata: row.metadata ?? {},
  };
}

function normalizeCycleSummary(row) {
  return {
    total: Number(row.total ?? 0),
    queued: Number(row.queued ?? 0),
    running: Number(row.running ?? 0),
    activeRunning: Number(row.active_running ?? row.running ?? 0),
    staleRunning: Number(row.stale_running ?? 0),
    retrying: Number(row.retrying ?? 0),
    succeeded: Number(row.succeeded ?? 0),
    failed: Number(row.failed ?? 0),
    deferred: Number(row.deferred ?? 0),
    pinned: Number(row.pinned ?? 0),
    lookup: Number(row.lookup ?? 0),
    rotation: Number(row.rotation ?? 0),
    nextAttemptAt: row.next_attempt_at ? new Date(row.next_attempt_at).toISOString() : null,
    firstStartedAt: row.first_started_at ? new Date(row.first_started_at).toISOString() : null,
    lastCompletedAt: row.last_completed_at ? new Date(row.last_completed_at).toISOString() : null,
  };
}

function normalizePin(row) {
  return {
    id: Number(row.id),
    userId: row.user_id === null || row.user_id === undefined ? null : String(row.user_id),
    configId: Number(row.config_id),
    state: row.state,
    rto: row.rto,
    lastSnapshotDate: dateOnly(row.last_snapshot_date),
    lastStatus: row.last_status ?? null,
    lastError: row.last_error ?? null,
    createdAt: row.created_at ? new Date(row.created_at).toISOString() : null,
    updatedAt: row.updated_at ? new Date(row.updated_at).toISOString() : null,
    job: row.job_id ? {
      id: Number(row.job_id),
      status: row.job_status,
      queueReason: row.queue_reason ?? "rotation",
      queuePriority: Number(row.queue_priority ?? RTO_DAILY_QUEUE_PRIORITIES.rotation),
      attempts: Number(row.job_attempts ?? 0),
      lastError: row.job_error ?? null,
      updatedAt: row.job_updated_at ? new Date(row.job_updated_at).toISOString() : null,
    } : null,
  };
}

function normalizeStatus(row) {
  return {
    state: row.state,
    rto: row.rto,
    configured: true,
    enabled: Boolean(row.enabled),
    pinned: Boolean(row.pin_id),
    pinId: row.pin_id ? Number(row.pin_id) : null,
    lastSnapshotDate: dateOnly(row.last_snapshot_date),
    lastStatus: row.last_status ?? null,
    lastError: row.last_error ?? null,
    job: row.job_id ? {
      id: Number(row.job_id),
      status: row.job_status,
      queueReason: row.queue_reason ?? "rotation",
      queuePriority: Number(row.queue_priority ?? RTO_DAILY_QUEUE_PRIORITIES.rotation),
      attempts: Number(row.job_attempts ?? 0),
      lastError: row.job_error ?? null,
      snapshotDate: dateOnly(row.job_snapshot_date),
      updatedAt: row.job_updated_at ? new Date(row.job_updated_at).toISOString() : null,
    } : null,
  };
}

function normalizeSnapshotInput(input) {
  return {
    snapshotDate: input.snapshotDate,
    targetMonth: input.targetMonth,
    state: String(input.state ?? "").trim(),
    rto: String(input.rto ?? "").trim(),
    fuelGroup: String(input.fuelGroup ?? "").trim().toUpperCase(),
    vehicleCategory: String(input.vehicleCategory ?? "").trim().toUpperCase(),
    oem: String(input.oem ?? "").trim(),
    vehicleCount: Math.max(0, Math.round(Number(input.vehicleCount ?? 0))),
    source: String(input.source ?? "vahan-scraper").trim(),
    scrapeStatus: String(input.scrapeStatus ?? "success").trim(),
    scrapeRunId: input.scrapeRunId === null || input.scrapeRunId === undefined ? null : Number(input.scrapeRunId),
    reportId: input.reportId === null || input.reportId === undefined ? null : Number(input.reportId),
    scrapedAt: input.scrapedAt ?? new Date().toISOString(),
    raw: input.raw ?? {},
  };
}

function normalizeSnapshotRow(row) {
  return {
    snapshotDate: dateOnly(row.snapshot_date),
    targetMonth: row.target_month,
    state: row.state,
    rto: row.rto,
    fuelGroup: row.fuel_group,
    vehicleCategory: row.vehicle_category,
    oem: row.oem,
    vehicleCount: Number(row.vehicle_count),
    dailyDelta: row.daily_delta === null || row.daily_delta === undefined ? null : Number(row.daily_delta),
    correction: Number(row.daily_delta) < 0,
    qualityStatus: row.scrape_status === "success" ? "verified" : row.scrape_status,
    scrapeStatus: row.scrape_status,
    scrapedAt: row.scraped_at ? new Date(row.scraped_at).toISOString() : null,
  };
}

function isValidSnapshot(row) {
  return Boolean(
    row.snapshotDate &&
    row.targetMonth &&
    row.state &&
    row.rto &&
    RTO_DAILY_FUEL_GROUPS.includes(row.fuelGroup) &&
    RTO_DAILY_CATEGORIES.includes(row.vehicleCategory) &&
    row.oem,
  );
}

function ensureDatabase() {
  if (!hasDatabaseUrl()) throw new Error("DATABASE_URL is required for RTO daily snapshots.");
}

function inputError(message) {
  const error = new Error(message);
  error.statusCode = 400;
  return error;
}

function addDays(dateKey, days) {
  const [year, month, day] = String(dateKey).split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day + days));
  return date.toISOString().slice(0, 10);
}

function dateOnly(value) {
  if (!value) return null;
  if (typeof value === "string") return value.slice(0, 10);
  return snapshotDateKey(new Date(value), DEFAULT_TIMEZONE);
}
