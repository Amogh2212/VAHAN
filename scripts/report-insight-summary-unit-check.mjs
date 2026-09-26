import assert from "node:assert/strict";
import { buildMonthlySalesReport } from "../lib/monthly-sales-report.mjs";
import {
  dailyRtoInsightFacts,
  monthlyInsightFacts,
  summarizeInsight,
  validateInsightText,
} from "../lib/report-insight-summary.mjs";

const month = (facts) => ({
  period: { month: "2026-08", previousMonth: "2026-07" },
  locationScope: { label: "All India" },
  fuelSelection: { scope: "all" },
  insightFacts: facts,
});
const complete = {
  comparableMonths: true, currentComplete: true, previousComplete: true,
  total: 1080, previousTotal: 1000, evShare: 0.12, previousEvShare: 0.1,
  categoryChange: { title: "Two wheelers", current: 600, previous: 550, delta: 50 },
};
const facts = monthlyInsightFacts(month(complete));
assert.equal(facts.eligibleForGroq, true);
assert.match(facts.statements.join(" "), /rose by 80 \(8%\)/);
assert.match(facts.statements.join(" "), /10% to 12%/);
const roundedShare = monthlyInsightFacts(month({ ...complete, evShare: 0.1024, previousEvShare: 0.1021 }));
assert.match(roundedShare.statements.join(" "), /EV share.*stayed at 10\.2%/);

for (const missing of ["currentComplete", "previousComplete", "comparableMonths"]) {
  const unavailable = monthlyInsightFacts(month({ ...complete, [missing]: false }));
  assert.equal(unavailable.eligibleForGroq, false);
  assert.doesNotMatch(unavailable.statements.join(" "), /rose|fell|0 registrations/);
}

const daily = (overrides = {}) => ({
  rto: "AP31",
  payload: { cadence: "daily", period: { end: "2026-09-25" }, dailyRegistration: {
    date: "2026-09-25", baselineEligible: true, previousDayEligible: true,
    status: "verified", todayBreakdown: { total: 49, ev: 12, ice: 37 },
    previousDayBreakdown: { total: 45 }, ...overrides,
  } },
});
assert.match(dailyRtoInsightFacts(daily()).statements.join(" "), /rose by 4/);
const noPrevious = dailyRtoInsightFacts(daily({ previousDayEligible: false }));
assert.equal(noPrevious.eligibleForGroq, false);
assert.match(noPrevious.statements.join(" "), /previous-day comparison.*unavailable/i);
const correction = dailyRtoInsightFacts(daily({ status: "correction", todayBreakdown: { total: -2, ev: -1, ice: -1 } }));
assert.equal(correction.eligibleForGroq, false);
assert.match(correction.statements.join(" "), /source correction/);
const missingDaily = dailyRtoInsightFacts(daily({ baselineEligible: false, todayBreakdown: { total: null } }));
assert.doesNotMatch(missingDaily.statements.join(" "), /recorded|rose|fell/);
assert.equal(missingDaily.eligibleForGroq, false);

assert.equal(validateInsightText("All-fuel registrations in All India rose by 80 (8%), from 1,000 to 1,080. Overall EV share in All India rose from 10% to 12%.", facts), true);
assert.equal(validateInsightText("All-fuel registrations in All India rose by 900 (90%) because of subsidies.", facts), false);
assert.equal(validateInsightText("All-fuel registrations in All India rose by 80 (8%), from 1,080 to 1,000. Overall EV share rose from 10% to 12%.", facts), false);
let calls = 0;
const env = { GROQ_API_KEY: "test-key", GROQ_REPORT_MODEL: "test-model" };
const mock = async (_url, options) => {
  calls += 1;
  const request = JSON.parse(options.body);
  assert.equal(request.response_format.type, "json_schema");
  assert.equal(request.response_format.json_schema.strict, true);
  return { ok: true, json: async () => ({ choices: [{ message: { content: JSON.stringify({ text: "All-fuel registrations in All India rose by 80 (8%), from 1,000 to 1,080. Overall EV share in All India rose from 10% to 12%." }) } }] }) };
};
const [first, second] = await Promise.all([
  summarizeInsight(facts, { env, fetchImpl: mock, cacheDir: null }),
  summarizeInsight(facts, { env, fetchImpl: mock, cacheDir: null }),
]);
assert.equal(calls, 1);
assert.equal(first.source, "groq");
assert.deepEqual(first, second);
const failed = await summarizeInsight(monthlyInsightFacts(month({ ...complete, total: 1081 })), {
  env, fetchImpl: async () => { throw new Error("timeout"); }, cacheDir: null,
});
assert.equal(failed.source, "rules");
const rateLimited = await summarizeInsight(monthlyInsightFacts(month({ ...complete, total: 1082 })), {
  env, fetchImpl: async () => ({ ok: false, status: 429 }), cacheDir: null,
});
assert.equal(rateLimited.source, "rules");
const unsupported = await summarizeInsight(monthlyInsightFacts(month({ ...complete, total: 1083 })), {
  env, fetchImpl: async () => ({ ok: true, json: async () => ({
    choices: [{ message: { content: JSON.stringify({ text: "All-fuel registrations in All India surged by 500% because of a new subsidy. Sales will double next month." }) } }],
  }) }), cacheDir: null,
});
assert.equal(unsupported.source, "rules");
const row = (year, monthNumber, state, vehicleCount) => ({
  year, month: monthNumber, state, rto: "All Vahan4 Running Office",
  fuel_type: "PETROL", vehicle_count: vehicleCount, fuel_filter: "ALL",
  vehicle_category_filter: "ALL", norms_filter: "ALL", vehicle_class_filter: "ALL",
});
const january = buildMonthlySalesReport({
  rows: [row(2025, 12, "Maharashtra", 100), row(2026, 1, "Maharashtra", 120)],
  month: "2026-01", expectedStates: ["Maharashtra"],
});
assert.equal(january.period.previousMonth, "2025-12");
assert.equal(january.insightFacts.comparableMonths, true);
assert.equal(january.sections[0].metrics.delta, 20);
const partial = buildMonthlySalesReport({
  rows: [row(2025, 12, "Maharashtra", 100), row(2026, 1, "Maharashtra", 120), row(2026, 1, "Karnataka", 80)],
  month: "2026-01", expectedStates: ["Maharashtra", "Karnataka"],
});
assert.equal(partial.insightFacts.comparableMonths, false);
assert.equal(partial.sections[0].metrics.delta, null);
assert.match(partial.sections[0].narrative, /comparison is unavailable/);
console.log("Report insight summary checks passed.");
