import { createHash } from "node:crypto";
import { hasDatabaseUrl, query, transaction } from "./db.mjs";
import { validateRtoDailyLoadTestCohort } from "./rto-daily-cohort.mjs";
import { snapshotDateKey } from "./rto-daily-snapshots.mjs";
import { validateOemBaselineEvidence, validateOemDailyEvidence } from "./rto-oem-tracking-source.mjs";

export const OEM_TRACKING_TIMEZONE = "Asia/Kolkata";
export const OEM_TRACKING_SELECTION_YEAR = 2025;
export const OEM_TRACKING_SOURCE = "https://analytics.parivahan.gov.in/analytics/publicdashboard/vahan?lang=en";
const fuels = ["EV", "ICE"];
const categories = ["2W", "3W", "4W"];
const sortObject = (value) => Array.isArray(value) ? value.map(sortObject) : value && typeof value === "object"
  ? Object.fromEntries(Object.keys(value).sort().map((key) => [key, sortObject(value[key])])) : value;
const digest = (value) => createHash("sha256").update(JSON.stringify(sortObject(value))).digest("hex");
const dateText = (value) => value instanceof Date ? value.toISOString().slice(0, 10) : String(value ?? "").slice(0, 10);
const isoText = (value) => value instanceof Date ? value.toISOString() : value;
const count = (value) => value === null || value === undefined ? null : Number(value);
const equalId = (a, b) => String(a) === String(b);
const sameScope = (a, b) => a.state === b.state && a.rto === b.rto
  && (a.fuel_group ?? a.fuelGroup) === (b.fuel_group ?? b.fuelGroup)
  && (a.vehicle_category ?? a.vehicleCategory) === (b.vehicle_category ?? b.vehicleCategory);

export function validateOemDailyRequest({ state, rto, date }) {
  if (!String(state ?? "").trim() || !String(rto ?? "").trim()) throw new Error("State and RTO are required.");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date ?? "") || !Number.isFinite(Date.parse(`${date}T00:00:00Z`))
    || new Date(`${date}T00:00:00Z`).toISOString().slice(0, 10) !== date) throw new Error("A valid observation date (YYYY-MM-DD) is required.");
  return Number(date.slice(0, 4));
}

function validateSegment({ fuelGroup, vehicleCategory }) {
  if (!fuels.includes(fuelGroup) || !categories.includes(vehicleCategory)) throw new Error("Invalid OEM tracking fuel/category scope.");
}

function previousDate(date) {
  const value = new Date(`${date}T00:00:00Z`);
  value.setUTCDate(value.getUTCDate() - 1);
  return value.toISOString().slice(0, 10);
}

function compactEvidence(evidence) {
  const { raw, ...compact } = evidence;
  const catalogResponses = compact.makerMappings?.map((mapping) => ({ id: mapping.id, responses: mapping.responses }));
  if (compact.makerMappings) compact.makerMappings = compact.makerMappings.map(({ responses, ...mapping }) => mapping);
  return { compact: { ...compact, rawRetained: false }, raw: raw ? { ...raw, ...(catalogResponses ? { catalogResponses } : {}) } : null };
}

function proofValid(row, expected, baseline = false) {
  if (!row || row.status !== "verified" || !row.evidence || row.evidence_hash !== digest(row.evidence)) return false;
  try {
    const validate = baseline ? validateOemBaselineEvidence : validateOemDailyEvidence;
    validate(row.evidence, expected, { allowCompacted: true });
    if (isoText(row.observed_at) && new Date(row.observed_at).toISOString() !== new Date(row.evidence.observedAt).toISOString()) return false;
    if (!baseline && (row.calendar_year !== expected.year || count(row.cumulative_count) !== row.evidence.count || row.filter_identity !== row.evidence.filterIdentity
      || dateText(row.observation_date) !== snapshotDateKey(new Date(row.evidence.observedAt), OEM_TRACKING_TIMEZONE))) return false;
    return true;
  } catch { return false; }
}

export async function createOemBaseline({ sourceCohortRunId, cohort, selectionYear = OEM_TRACKING_SELECTION_YEAR }, transact = transaction) {
  const members = validateRtoDailyLoadTestCohort(cohort);
  if (!Number.isInteger(selectionYear) || selectionYear < 1900 || selectionYear > 9999) throw new Error("Invalid OEM selection year.");
  if (!/^\d+$/.test(String(sourceCohortRunId)) || Number(sourceCohortRunId) <= 0) throw new Error("A source cohort run ID is required.");
  return transact(async (execute) => {
    const result = await execute(`insert into rto_oem_tracking_baselines
      (source_cohort_run_id,selection_year,cohort_hash,cohort) values ($1,$2,$3,$4::jsonb) returning *`,
    [sourceCohortRunId, selectionYear, digest(members), JSON.stringify(members)]);
    const baseline = result.rows[0];
    await execute(`insert into rto_oem_tracking_scopes (baseline_id,state,rto,fuel_group,vehicle_category)
      select $1,m.state,m.rto,f.fuel,c.category from jsonb_to_recordset($2::jsonb) as m(state text,rto text)
      cross join (values ('EV'),('ICE')) as f(fuel) cross join (values ('2W'),('3W'),('4W')) as c(category)`,
    [baseline.id, JSON.stringify(members)]);
    return baseline;
  });
}

export async function getOemBaseline({ baselineId }, queryImpl = query) {
  const result = await queryImpl("select * from rto_oem_tracking_baselines where id=$1", [baselineId]);
  return result.rows[0] ?? null;
}

export async function getActiveOemBaseline(queryImpl = query) {
  const result = await queryImpl("select * from rto_oem_tracking_baselines where is_active order by id desc limit 1");
  return result.rows[0] ?? null;
}

export async function finishOemBaseline({ baselineId, status, activate = false }, queryImpl = query, transact = transaction) {
  const execute = async (run) => {
    // Serialize before row locks so simultaneous version switches cannot deadlock.
    if (activate) await run("select pg_advisory_xact_lock(727669,1)");
    const baseline = (await run("select * from rto_oem_tracking_baselines where id=$1 for update", [baselineId])).rows[0];
    if (!baseline) throw new Error("OEM baseline does not exist.");
    const summary = (await run(`select count(*)::int as scopes,
      count(*) filter (where status='verified')::int as verified,
      count(*) filter (where status='verified' and ranking_complete)::int as complete from rto_oem_tracking_scopes where baseline_id=$1`, [baselineId])).rows[0];
    const finalStatus = status ?? (summary.complete === 600 ? "success" : summary.verified > 0 ? "partial" : "failed");
    if (!["running", "partial", "success", "failed"].includes(finalStatus)) throw new Error("Invalid OEM baseline status.");
    if (finalStatus === "success" && (summary.scopes !== 600 || summary.complete !== 600)) throw new Error("A successful OEM baseline requires 600 complete ranking scopes.");
    if (activate) {
      if (summary.verified === 0) throw new Error("An empty baseline cannot become active.");
      if (baseline.activated_at && !baseline.is_active) throw new Error("A superseded OEM baseline cannot be reactivated; create a new baseline version.");
      await run("update rto_oem_tracking_baselines set is_active=false where is_active and id<>$1", [baselineId]);
    }
    return (await run(`update rto_oem_tracking_baselines set status=$2,finished_at=now(),
      is_active=case when $3 then true else is_active end,activated_at=case when $3 then coalesce(activated_at,now()) else activated_at end where id=$1 returning *`,
    [baselineId, finalStatus, activate])).rows[0];
  };
  return transact(execute);
}

export async function saveOemBaselineScope({ baselineId, state, rto, fuelGroup, vehicleCategory, evidence = null, failureEvidence = null, errorReason = null }, transact = transaction) {
  validateSegment({ fuelGroup, vehicleCategory });
  if (!evidence && !String(errorReason ?? "").trim()) throw new Error("Unavailable OEM baseline evidence requires a reason.");
  return transact(async (execute) => {
    const baseline = (await execute("select * from rto_oem_tracking_baselines where id=$1 for share", [baselineId])).rows[0];
    if (!baseline || !baseline.cohort.some((member) => member.state === state && member.rto === rto)) throw new Error("OEM scope does not match its frozen baseline cohort.");
    const existing = (await execute(`select status from rto_oem_tracking_scopes
      where baseline_id=$1 and state=$2 and rto=$3 and fuel_group=$4 and vehicle_category=$5 for update`,
    [baselineId, state, rto, fuelGroup, vehicleCategory])).rows[0];
    if (!existing) throw new Error("OEM baseline scope was not initialized.");
    if (existing.status === "verified") return { saved: false, reason: "Verified ranking is already frozen." };
    if (evidence) validateOemBaselineEvidence(evidence, { state, rto, fuelGroup, vehicleCategory, selectionYear: baseline.selection_year });
    const { compact, raw } = compactEvidence(evidence ?? failureEvidence ?? {});
    await execute(`update rto_oem_tracking_scopes set status=$6,ranking_complete=$7,explicit_zero=$8,
      observed_at=$9,evidence=$10::jsonb,evidence_hash=$11,raw_responses=$12::jsonb,error_reason=$13
      where baseline_id=$1 and state=$2 and rto=$3 and fuel_group=$4 and vehicle_category=$5`,
    [baselineId, state, rto, fuelGroup, vehicleCategory, evidence ? "verified" : "unavailable", evidence?.rankingComplete === true,
      evidence?.explicitZero === true, evidence?.observedAt ?? new Date().toISOString(), JSON.stringify(compact), evidence ? digest(compact) : null,
      raw ? JSON.stringify(raw) : null, evidence ? null : errorReason]);
    if (evidence) {
      for (const maker of evidence.makers) {
        await execute(`insert into rto_oem_tracking_makers
          (baseline_id,state,rto,fuel_group,vehicle_category,maker_id,maker_name,baseline_rank,baseline_count)
          values ($1,$2,$3,$4,$5,$6,$7,$8,$9)`, [baselineId, state, rto, fuelGroup, vehicleCategory, String(maker.id), maker.name, maker.rank, maker.count]);
      }
    }
    return { saved: true, status: evidence ? "verified" : "unavailable" };
  });
}

const scopesSql = `select s.*,coalesce((select jsonb_agg(jsonb_build_object('id',m.maker_id,'name',m.maker_name,
  'rank',m.baseline_rank,'count',m.baseline_count,'baselineCount',m.baseline_count) order by m.baseline_rank)
  from rto_oem_tracking_makers m where m.baseline_id=s.baseline_id and m.state=s.state and m.rto=s.rto
  and m.fuel_group=s.fuel_group and m.vehicle_category=s.vehicle_category),'[]'::jsonb) as makers
  from rto_oem_tracking_scopes s`;
const scopeAliases = (row) => ({ ...row, scopeStatus: row.status, fuelGroup: row.fuel_group,
  vehicleCategory: row.vehicle_category, rankingComplete: row.ranking_complete, explicitZero: row.explicit_zero,
  makers: (row.makers ?? []).map((maker) => ({ ...maker, count: count(maker.count), baselineCount: count(maker.baselineCount) })) });

export async function getOemBaselineScopes({ baselineId, state = null, rto = null }, queryImpl = query) {
  const result = await queryImpl(`${scopesSql} where s.baseline_id=$1 and ($2::text is null or s.state=$2)
    and ($3::text is null or s.rto=$3) order by s.state,s.rto,s.fuel_group,s.vehicle_category`, [baselineId, state, rto]);
  return result.rows.map(scopeAliases);
}

export async function createOemDailyRun({ baselineId, date }, transact = transaction) {
  const year = validateOemDailyRequest({ state: "run", rto: "run", date });
  return transact(async (execute) => {
    const baseline = (await execute("select id from rto_oem_tracking_baselines where id=$1 for share", [baselineId])).rows[0];
    if (!baseline) throw new Error("Daily collection requires an established OEM baseline.");
    return (await execute(`insert into rto_oem_tracking_daily_runs (baseline_id,observation_date,calendar_year)
      values ($1,$2,$3) on conflict (baseline_id,observation_date) do update set status='running',finished_at=null,error_reason=null
      returning *,observation_date::text as date`, [baselineId, date, year])).rows[0];
  });
}

export async function getOemDailyPending({ baselineId, date }, queryImpl = query) {
  validateOemDailyRequest({ state: "run", rto: "run", date });
  const result = await queryImpl(`select m.* from rto_oem_tracking_makers m
    join rto_oem_tracking_scopes s using (baseline_id,state,rto,fuel_group,vehicle_category)
    left join rto_oem_tracking_observations o on o.baseline_id=m.baseline_id and o.state=m.state and o.rto=m.rto
      and o.fuel_group=m.fuel_group and o.vehicle_category=m.vehicle_category and o.maker_id=m.maker_id and o.observation_date=$2::date
    where m.baseline_id=$1 and s.status='verified' and (o.status is null or o.status<>'verified')
    order by m.state,m.rto,m.fuel_group,m.vehicle_category,m.baseline_rank`, [baselineId, date]);
  return result.rows.map((row) => ({ ...row, id: row.maker_id, makerId: row.maker_id, name: row.maker_name,
    rank: row.baseline_rank, fuelGroup: row.fuel_group, vehicleCategory: row.vehicle_category, baselineCount: count(row.baseline_count) }));
}

export async function saveOemDailyObservation({ runId, baselineId, state, rto, fuelGroup, vehicleCategory, makerId, date,
  evidence = null, failureEvidence = null, errorReason = null }, transact = transaction) {
  const year = validateOemDailyRequest({ state, rto, date });
  validateSegment({ fuelGroup, vehicleCategory });
  if (!evidence && !String(errorReason ?? "").trim()) throw new Error("Unavailable OEM evidence requires a reason.");
  const observedAt = evidence?.observedAt ?? new Date().toISOString();
  if (!Number.isFinite(Date.parse(observedAt)) || snapshotDateKey(new Date(observedAt), OEM_TRACKING_TIMEZONE) !== date) throw new Error("OEM observation time does not match its actual IST date.");
  return transact(async (execute) => {
    const run = (await execute("select *,observation_date::text as date from rto_oem_tracking_daily_runs where id=$1 for share", [runId])).rows[0];
    if (!run || !equalId(run.baseline_id, baselineId) || run.date !== date || run.calendar_year !== year) throw new Error("OEM observation does not match its daily collection run.");
    const maker = (await execute(`select m.* from rto_oem_tracking_makers m join rto_oem_tracking_scopes s
      using (baseline_id,state,rto,fuel_group,vehicle_category) where m.baseline_id=$1 and m.state=$2 and m.rto=$3
      and m.fuel_group=$4 and m.vehicle_category=$5 and m.maker_id=$6 and s.status='verified' for share of m,s`,
    [baselineId, state, rto, fuelGroup, vehicleCategory, String(makerId)])).rows[0];
    if (!maker) throw new Error("Daily OEM identity is not in the frozen verified ranking.");
    if (evidence) validateOemDailyEvidence(evidence, { state, rto, fuelGroup, vehicleCategory, year, makerId: String(makerId), makerName: maker.maker_name, date });
    const { compact, raw } = compactEvidence(evidence ?? failureEvidence ?? {});
    const result = await execute(`insert into rto_oem_tracking_observations
      (baseline_id,state,rto,fuel_group,vehicle_category,maker_id,observation_date,calendar_year,run_id,observed_at,
      status,cumulative_count,source_reported_at,filter_identity,evidence,evidence_hash,raw_responses,error_reason)
      values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15::jsonb,$16,$17::jsonb,$18)
      on conflict (baseline_id,state,rto,fuel_group,vehicle_category,maker_id,observation_date) do update set
      run_id=excluded.run_id,observed_at=excluded.observed_at,status=excluded.status,cumulative_count=excluded.cumulative_count,
      source_reported_at=excluded.source_reported_at,filter_identity=excluded.filter_identity,evidence=excluded.evidence,
      evidence_hash=excluded.evidence_hash,raw_responses=excluded.raw_responses,error_reason=excluded.error_reason
      where rto_oem_tracking_observations.status<>'verified' returning status`,
    [baselineId, state, rto, fuelGroup, vehicleCategory, String(makerId), date, year, runId, observedAt, evidence ? "verified" : "unavailable",
      evidence?.count ?? null, evidence?.sourceReportedAt ?? null, evidence?.filterIdentity ?? null, JSON.stringify(compact), evidence ? digest(compact) : null,
      raw ? JSON.stringify(raw) : null, evidence ? null : errorReason]);
    return { saved: result.rows.length > 0, status: result.rows[0]?.status ?? "verified" };
  });
}

export async function finishOemDailyRun({ runId, status, errorReason = null }, queryImpl = query) {
  if (!["partial", "success", "failed"].includes(status)) throw new Error("Invalid OEM daily run status.");
  return (await queryImpl("update rto_oem_tracking_daily_runs set status=$2,error_reason=$3,finished_at=now() where id=$1 returning *",
    [runId, status, errorReason])).rows[0];
}

export async function listOemDailyObservations({ baselineId, date }, queryImpl = query) {
  return (await queryImpl("select *,observation_date::text as observation_date from rto_oem_tracking_observations where baseline_id=$1 and observation_date=$2::date", [baselineId, date])).rows;
}

export async function getOemTrackingAudit({ baselineId, date = null }, queryImpl = query) {
  const scopes = await getOemBaselineScopes({ baselineId }, queryImpl);
  const observations = date ? await listOemDailyObservations({ baselineId, date }, queryImpl) : [];
  return { baselineId, date, scopeCount: scopes.length, verifiedScopes: scopes.filter((s) => s.status === "verified").length,
    completeScopes: scopes.filter((s) => s.status === "verified" && s.ranking_complete).length,
    selectedMakers: scopes.reduce((sum, s) => sum + s.makers.length, 0),
    verifiedObservations: observations.filter((o) => o.status === "verified").length,
    unavailableObservations: observations.filter((o) => o.status !== "verified").length, scopes, observations };
}

export async function pruneOemTrackingEvidence({ date = snapshotDateKey() } = {}, queryImpl = query) {
  validateOemDailyRequest({ state: "prune", rto: "prune", date });
  const rawDaily = await queryImpl("update rto_oem_tracking_observations set raw_responses=null where observation_date<$1::date-30 and raw_responses is not null", [date]);
  const rawBaseline = await queryImpl("update rto_oem_tracking_scopes set raw_responses=null where observed_at<(($1::date-30)::timestamp at time zone 'Asia/Kolkata') and raw_responses is not null", [date]);
  const observations = await queryImpl("delete from rto_oem_tracking_observations where observation_date<$1::date-365", [date]);
  return { rawDaily: rawDaily.rowCount, rawBaseline: rawBaseline.rowCount, observations: observations.rowCount };
}

export function dailyOemPayload(params, { baseline = null, scopes = [], observations = [] } = {}, reason = "No saved OEM baseline is available.") {
  const year = validateOemDailyRequest(params);
  const priorDate = previousDate(params.date);
  const baselineId = baseline?.id ?? null;
  const selectionYear = baseline?.selection_year ?? baseline?.selectionYear ?? OEM_TRACKING_SELECTION_YEAR;
  const segments = fuels.flatMap((fuelGroup) => categories.map((vehicleCategory) => {
    const scope = scopes.find((item) => sameScope(item, { ...params, fuelGroup, vehicleCategory }) && equalId(item.baseline_id ?? baselineId, baselineId));
    const expected = { state: params.state, rto: params.rto, fuelGroup, vehicleCategory, selectionYear };
    const scopeRowsMatch = scope && Array.isArray(scope.makers) && Array.isArray(scope.evidence?.makers)
      && scope.makers.length === scope.evidence.makers.length && scope.makers.every((maker) => scope.evidence.makers.some((saved) =>
        equalId(saved.id, maker.id) && saved.name === maker.name && saved.rank === maker.rank && saved.count === count(maker.baselineCount ?? maker.count)))
      && scope.ranking_complete === scope.evidence.rankingComplete && scope.explicit_zero === scope.evidence.explicitZero;
    const validScope = baseline && scopeRowsMatch && proofValid(scope, expected, true);
    const savedMakers = validScope ? (scope.makers ?? []).slice().sort((a, b) => a.rank - b.rank) : [];
    const makers = savedMakers.map((selected) => {
      const id = String(selected.id);
      const maker = { id, name: selected.name, rank: selected.rank, baselineCount: count(selected.baselineCount ?? selected.count),
        currentCount: null, previousCount: null, dailyChange: null, status: "unavailable", reason: null, observedAt: null, previousObservedAt: null };
      const current = observations.find((row) => sameScope(row, scope) && equalId(row.baseline_id, baselineId)
        && equalId(row.maker_id, id) && dateText(row.observation_date) === params.date);
      const previous = observations.find((row) => sameScope(row, scope) && equalId(row.baseline_id, baselineId)
        && equalId(row.maker_id, id) && dateText(row.observation_date) === priorDate);
      const dailyExpected = { state: params.state, rto: params.rto, fuelGroup, vehicleCategory, year, makerId: id, makerName: selected.name, date: params.date };
      if (!proofValid(current, dailyExpected)) {
        maker.reason = current?.error_reason ?? (current ? "Saved current OEM evidence failed validation." : "Current-day OEM evidence is unavailable.");
        return maker;
      }
      maker.currentCount = count(current.cumulative_count);
      maker.observedAt = isoText(current.observed_at);
      if (Number(priorDate.slice(0, 4)) !== year) { maker.reason = "Daily comparison unavailable: calendar year reset."; return maker; }
      if (!proofValid(previous, { ...dailyExpected, date: priorDate }) || previous.calendar_year !== current.calendar_year
        || previous.evidence.filterIdentity !== current.evidence.filterIdentity || previous.evidence.contract !== current.evidence.contract) {
        maker.reason = "Daily comparison unavailable: a compatible preceding-day observation is missing.";
        return maker;
      }
      maker.previousCount = count(previous.cumulative_count);
      maker.previousObservedAt = isoText(previous.observed_at);
      const change = maker.currentCount - maker.previousCount;
      const reportedAt = current.evidence.sourceReportedAt;
      const fresh = reportedAt && Date.parse(reportedAt) > Date.parse(previous.evidence.observedAt)
        && Date.parse(reportedAt) <= Date.parse(current.evidence.observedAt);
      if (change === 0 && !fresh) {
        maker.status = "unconfirmed_no_change";
        maker.reason = "No observed change; source freshness is unconfirmed.";
        return maker;
      }
      maker.dailyChange = change;
      maker.status = change < 0 ? "correction" : "available";
      maker.reason = change < 0 ? "Source correction: cumulative registrations decreased." : null;
      return maker;
    });
    const available = makers.filter((maker) => Number.isSafeInteger(maker.dailyChange)).length;
    const explicitZero = Boolean(validScope && scope.explicit_zero);
    const rankingComplete = Boolean(validScope && scope.ranking_complete);
    const status = available && available === makers.length ? "verified" : available ? "partial" : "unavailable";
    const scopeReason = !validScope ? scope?.error_reason ?? (scope?.status === "verified" ? "Saved OEM ranking evidence failed validation." : reason)
      : !makers.length ? explicitZero ? "No named OEMs selected: 2025 registrations were explicitly zero." : "No named OEMs were verified for this ranking."
      : available < makers.length ? "Daily comparison unavailable for one or more selected OEMs."
      : !rankingComplete ? "Fewer than five named OEMs were verified in the selection year." : null;
    return { fuelGroup, vehicleCategory, status, rankingComplete, explicitZero, reason: scopeReason, makers };
  }));
  return { ...params, year, selectionYear, baselineId, metricKind: "registration_observed_daily_change", timezone: OEM_TRACKING_TIMEZONE,
    source: OEM_TRACKING_SOURCE, segments };
}

export async function getDailyOemTrackingBatch({ members, date }, queryImpl = query) {
  for (const member of members) validateOemDailyRequest({ ...member, date });
  const unavailable = (reason) => members.map((member) => dailyOemPayload({ ...member, date }, {}, reason));
  if (!members.length) return [];
  if (queryImpl === query && !hasDatabaseUrl()) return unavailable("Saved daily OEM database is not configured.");
  try {
    // Choose the version that was activated by this report date, so future refreshes cannot rewrite historical reports.
    const baseline = (await queryImpl(`select * from rto_oem_tracking_baselines
      where activated_at is not null and (activated_at at time zone 'Asia/Kolkata')::date<=$1::date
      order by activated_at desc,id desc limit 1`, [date])).rows[0];
    if (!baseline) return unavailable("No OEM baseline was established by this observation date.");
    const memberJson = JSON.stringify(members.map(({ state, rto }) => ({ state, rto })));
    const [scopeResult, observationResult] = await Promise.all([
      queryImpl(`${scopesSql} where s.baseline_id=$1 and exists (select 1 from jsonb_to_recordset($2::jsonb) as m(state text,rto text) where m.state=s.state and m.rto=s.rto)`, [baseline.id, memberJson]),
      queryImpl(`select o.*,o.observation_date::text as observation_date from rto_oem_tracking_observations o
        where o.baseline_id=$1 and o.observation_date between $3::date-1 and $3::date
        and exists (select 1 from jsonb_to_recordset($2::jsonb) as m(state text,rto text) where m.state=o.state and m.rto=o.rto)`, [baseline.id, memberJson, date]),
    ]);
    return members.map((member) => dailyOemPayload({ ...member, date }, { baseline, scopes: scopeResult.rows.map(scopeAliases), observations: observationResult.rows }, "No saved OEM ranking for this RTO scope."));
  } catch (error) {
    if (error.code !== "42P01") throw error;
    return unavailable("OEM tracking storage migration has not been applied.");
  }
}

export async function getDailyOemTracking(params, queryImpl = query) {
  validateOemDailyRequest(params);
  return (await getDailyOemTrackingBatch({ members: [{ state: params.state, rto: params.rto }], date: params.date }, queryImpl))[0];
}

export function dailyOemCsvRows(payload) {
  if (!payload) return [];
  return [[], ["Daily OEM registrations: observed net change"],
    ["state", "rto", "observation_date", "selection_year", "baseline_id", "fuel", "category", "2025_rank", "maker_id", "maker", "2025_registrations", "current_ytd", "previous_ytd", "daily_change", "status", "observed_at", "previous_observed_at", "ranking_complete", "reason"],
    ...payload.segments.flatMap((segment) => (segment.makers.length ? segment.makers : [{}]).map((maker) => [payload.state, payload.rto, payload.date,
      payload.selectionYear, payload.baselineId ?? "", segment.fuelGroup, segment.vehicleCategory, maker.rank ?? "", maker.id ?? "", maker.name ?? "",
      maker.baselineCount ?? "", maker.currentCount ?? "", maker.previousCount ?? "", maker.dailyChange ?? "", maker.status ?? segment.status,
      maker.observedAt ?? "", maker.previousObservedAt ?? "", segment.rankingComplete, maker.reason ?? segment.reason ?? ""]))];
}

export function dailyOemHtml(payload) {
  if (!payload) return "";
  const escape = (value) => String(value ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  const observed = (value) => value && Number.isFinite(Date.parse(value)) ? new Intl.DateTimeFormat("en-IN", {
    timeZone: OEM_TRACKING_TIMEZONE, day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", hour12: false,
  }).format(new Date(value)) : "";
  return `<section><h2>Daily OEM registrations</h2><p>Selected from ${escape(payload.selectionYear)} rankings · Observed net changes on ${escape(payload.date)} (IST). Source: VAHAN Public Dashboard.</p><table><thead><tr><th>Fuel / category</th><th>Rank / OEM</th><th>Daily change</th><th>Current YTD</th><th>Previous YTD</th><th>Current observation (IST)</th><th>Previous observation (IST)</th><th>Availability</th></tr></thead><tbody>${payload.segments.flatMap((s) => (s.makers.length ? s.makers : [{}]).map((m) => `<tr><td>${escape(s.fuelGroup)} / ${escape(s.vehicleCategory)}</td><td>${escape(m.rank)} ${escape(m.name ?? "Unavailable")}</td><td>${escape(m.dailyChange ?? "Unavailable")}</td><td>${escape(m.currentCount)}</td><td>${escape(m.previousCount)}</td><td>${escape(observed(m.observedAt))}</td><td>${escape(observed(m.previousObservedAt))}</td><td>${escape(m.reason ?? s.reason ?? m.status)}</td></tr>`)).join("")}</tbody></table><h3>${escape(payload.selectionYear)} selection counts</h3><table><thead><tr><th>Fuel / category</th><th>Rank / OEM</th><th>Registrations</th></tr></thead><tbody>${payload.segments.flatMap((s) => s.makers.map((m) => `<tr><td>${escape(s.fuelGroup)} / ${escape(s.vehicleCategory)}</td><td>${escape(m.rank)} ${escape(m.name)}</td><td>${escape(m.baselineCount)}</td></tr>`)).join("")}</tbody></table></section>`;
}
