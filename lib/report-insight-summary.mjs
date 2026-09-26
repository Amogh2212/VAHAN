import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

const PROMPT_VERSION = 2;
const CACHE_LIMIT = 300;
const cache = new Map();
const inFlight = new Map();
const numberFormat = new Intl.NumberFormat("en-IN");
const percentFormat = new Intl.NumberFormat("en-IN", { maximumFractionDigits: 1 });

function count(value) { return numberFormat.format(value); }
function pct(value) { return `${percentFormat.format(value * 100)}%`; }
function monthLabel(month) {
  const [year, number] = String(month).split("-").map(Number);
  return new Intl.DateTimeFormat("en-IN", { month: "long", year: "numeric" }).format(new Date(year, number - 1, 1));
}
function movement(current, previous, label) {
  const delta = current - previous;
  if (delta === 0) return `${label} stayed at ${count(current)}.`;
  const verb = delta > 0 ? "rose" : "fell";
  const rate = previous > 0 ? ` (${pct(Math.abs(delta) / previous)})` : "";
  return `${label} ${verb} by ${count(Math.abs(delta))}${rate}, from ${count(previous)} to ${count(current)}.`;
}

export function monthlyInsightFacts(report) {
  const period = report.period ?? {};
  const facts = report.insightFacts ?? {};
  const scope = report.locationScope?.label ?? "All India";
  const fuel = report.fuelSelection?.scope === "all" ? "All-fuel" : report.fuelSelection?.fuel ?? "Selected fuel";
  if (!facts.currentComplete || !facts.previousComplete || !facts.comparableMonths) {
    return {
      kind: "monthly", scope, fuel, period: period.month,
      statements: [`A month-on-month comparison for ${monthLabel(period.month)} is unavailable because ${!facts.currentComplete ? "the selected month" : "the previous month"} lacks complete source coverage.`],
      eligibleForGroq: false,
    };
  }
  const statements = [movement(facts.total, facts.previousTotal, `${fuel} registrations in ${scope}`)];
  if (facts.evShare !== null && facts.previousEvShare !== null) {
    const difference = Math.round(facts.evShare * 1000) - Math.round(facts.previousEvShare * 1000);
    statements.push(difference === 0
      ? `Overall EV share in ${scope} stayed at ${pct(facts.evShare)}.`
      : `Overall EV share in ${scope} ${difference > 0 ? "rose" : "fell"} from ${pct(facts.previousEvShare)} to ${pct(facts.evShare)}.`);
  }
  if (facts.categoryChange) {
    statements.push(movement(facts.categoryChange.current, facts.categoryChange.previous,
      `${facts.categoryChange.title} selected-fuel registrations`));
  }
  return { kind: "monthly", scope, fuel, period: period.month, statements, eligibleForGroq: true };
}

export function dailyRtoInsightFacts(report) {
  const payload = report.payload ?? {};
  if (payload.cadence !== "daily") return null;
  const daily = payload.dailyRegistration ?? {};
  const rto = report.rto ?? payload.rto?.name ?? "Selected RTO";
  const period = daily.date ?? payload.period?.end;
  if (!daily.baselineEligible || !Number.isFinite(daily.todayBreakdown?.total)) {
    return {
      kind: "rto-daily", rto, period, eligibleForGroq: false,
      statements: [`Daily registrations for ${rto} on ${period} are unavailable because compatible source evidence is incomplete.`],
    };
  }
  const current = daily.todayBreakdown;
  const statements = [`${rto} recorded ${count(current.total)} registrations on ${period}: ${count(current.ev)} EV and ${count(current.ice)} ICE.`];
  if (daily.previousDayEligible && Number.isFinite(daily.previousDayBreakdown?.total)) {
    statements.push(movement(current.total, daily.previousDayBreakdown.total, `Daily registrations at ${rto}`));
  } else {
    statements.push(`A previous-day comparison for ${rto} is unavailable because the previous day's registration evidence is incomplete.`);
  }
  if (daily.status === "correction" || current.total < 0) {
    statements.push("The negative change is retained as a source correction, not counted as zero.");
  }
  return { kind: "rto-daily", rto, period, statements, eligibleForGroq: daily.previousDayEligible && daily.status !== "correction" };
}

export function validateInsightText(candidate, facts) {
  if (typeof candidate !== "string") return false;
  const text = candidate.trim();
  if (text.length < 35 || text.length > 700 || /[<>\[\]{}]/.test(text)) return false;
  const sentenceCount = (text.match(/[.!?](?:\s|$)/g) ?? []).length;
  if (sentenceCount < 2 || sentenceCount > 4) return false;
  if (/\b(because|due to|driven by|thanks to|caused by|fuelled by|fueled by|subsidy|policy|launch|forecast|stock)\b/i.test(text)) return false;
  const allowedNumbers = new Set(facts.statements.join(" ").match(/\d+(?:[.,]\d+)*%?/g) ?? []);
  const candidateNumbers = text.match(/\d+(?:[.,]\d+)*%?/g) ?? [];
  if (!candidateNumbers.length || candidateNumbers.some((value) => !allowedNumbers.has(value))) return false;
  const pairs = [...text.matchAll(/\bfrom (\d+(?:[.,]\d+)*%?) to (\d+(?:[.,]\d+)*%?)/gi)];
  if (pairs.some(([, from, to]) => !facts.statements.some((statement) => statement.includes(`from ${from} to ${to}`)))) return false;
  if (!text.includes(facts.kind === "monthly" ? facts.scope : facts.rto)) return false;
  return true;
}

export async function summarizeInsight(facts, { env = process.env, fetchImpl = fetch, cacheDir = path.join(process.cwd(), "output", "report-insight-cache") } = {}) {
  if (!facts) return null;
  const model = env.GROQ_REPORT_MODEL || "openai/gpt-oss-20b";
  const hash = crypto.createHash("sha256").update(JSON.stringify({ facts, model, version: PROMPT_VERSION })).digest("hex");
  const fallback = { text: facts.statements.join(" "), source: "rules", factHash: hash };
  if (!facts.eligibleForGroq || !env.GROQ_API_KEY) return fallback;
  const cached = cache.get(hash);
  if (cached && cached.expiresAt > Date.now()) return cached.value;
  if (cached) cache.delete(hash);
  if (inFlight.has(hash)) return inFlight.get(hash);
  const pending = (async () => {
    let result = fallback;
    if (cacheDir) {
      try {
        const saved = JSON.parse(await fs.readFile(path.join(cacheDir, `${hash}.json`), "utf8"));
        if (saved.factHash === hash && saved.source === "groq" && validateInsightText(saved.text, facts)) {
          cache.set(hash, { value: saved, expiresAt: Infinity });
          return saved;
        }
      } catch { /* A missing or invalid local cache is harmless. */ }
    }
    try {
      const response = await fetchImpl("https://api.groq.com/openai/v1/chat/completions", {
        method: "POST",
        headers: { authorization: `Bearer ${env.GROQ_API_KEY}`, "content-type": "application/json" },
        signal: AbortSignal.timeout(8000),
        body: JSON.stringify({
          model,
          temperature: 0,
          max_tokens: 300,
          reasoning_effort: "low",
          response_format: {
            type: "json_schema",
            json_schema: {
              name: "report_insight",
              strict: true,
              schema: {
                type: "object",
                properties: { text: { type: "string" } },
                required: ["text"],
                additionalProperties: false,
              },
            },
          },
          messages: [
            { role: "system", content: "Write a concise 2-4 sentence India vehicle registration summary. Use only supplied facts. Copy every number exactly. Do not infer causes, trends beyond the compared periods, rankings, or forecasts. Return JSON with only a text field." },
            { role: "user", content: JSON.stringify(facts) },
          ],
        }),
      });
      if (response.ok) {
        const body = await response.json();
        const candidate = JSON.parse(body.choices?.[0]?.message?.content ?? "{}").text;
        if (validateInsightText(candidate, facts)) result = { ...fallback, text: candidate.trim(), source: "groq" };
      }
    } catch { /* Report availability must not depend on the wording provider. */ }
    if (cache.size >= CACHE_LIMIT) cache.delete(cache.keys().next().value);
    cache.set(hash, { value: result, expiresAt: result.source === "groq" ? Infinity : Date.now() + 5 * 60_000 });
    if (cacheDir && result.source === "groq") {
      try {
        await fs.mkdir(cacheDir, { recursive: true });
        await fs.writeFile(path.join(cacheDir, `${hash}.json`), JSON.stringify(result), { flag: "wx" });
      } catch { /* In-memory reuse remains available if local persistence fails. */ }
    }
    return result;
  })();
  inFlight.set(hash, pending);
  try { return await pending; } finally { inFlight.delete(hash); }
}
