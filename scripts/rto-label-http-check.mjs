import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import fs from "node:fs/promises";

const port = Number(process.env.TEST_PORT || 3127);
const base = `http://127.0.0.1:${port}`;
const child = spawn(process.execPath, ["server.mjs"], {
  env: {
    ...process.env, PORT: String(port), DATABASE_URL: "", NODE_ENV: "production",
    REQUIRE_DATABASE_FOR_READINESS: "0", APP_BASE_URL: "https://vahan.invalid",
    CSRF_SECRET: "rto-label-http-check-secret-at-least-32-characters",
    RATE_LIMIT_STORE: "memory", ALLOW_IN_MEMORY_RATE_LIMIT: "1",
    AI_QUERY_PROVIDER: "none", FACTOR_AGENT_PROVIDER: "none", GROQ_API_KEY: "",
    GEMINI_API_KEY: "", TELEGRAM_BOT_TOKEN: "", TELEGRAM_ENABLE_POLLING: "0",
    VAHAN_DISABLE_LIVE_REFRESH: "1", DASHBOARD_QUERY_RATE_LIMIT_MAX: "30",
  },
  stdio: ["ignore", "pipe", "pipe"],
});
let logs = "";
child.stdout.on("data", (data) => { logs += data; });
child.stderr.on("data", (data) => { logs += data; });
async function json(path, options) {
  const response = await fetch(`${base}${path}`, options);
  assert.ok(response.ok, `${path}: HTTP ${response.status}`);
  return response.json();
}
const results = [];
try {
  let healthy = false;
  for (let i = 0; i < 60; i += 1) {
    try { await json("/health"); healthy = true; break; } catch {}
    if (child.exitCode !== null) throw new Error("server exited during startup");
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  assert.ok(healthy, "server did not become healthy");
  for (const [state, canonical, legacy] of [
    ["Uttar Pradesh", "Noida - UP16", "Noida - UP16( 13-NOV-2017 )"],
    ["Maharashtra", "PUNE - MH12", "PUNE - MH12( 25-JAN-2017 )"],
    ["Punjab", "RTO LUDHIANA - PB10", "RTO LUDHIANA - PB10( 25-JAN-2018 )"],
    ["Uttarakhand", "HARIDWAR ARTO - UK8", "haridwar"],
    ["Uttarakhand", "DEHRADUN RTO - UK7", "dehradun"],
  ]) {
    const metadata = await json(`/api/metadata/rtos?${new URLSearchParams({ state })}`);
    assert.ok(metadata.rtos.includes(canonical), `${canonical} must remain selectable`);
    assert.ok(!metadata.rtos.includes(legacy), `${legacy} must not appear as another office`);
    const result = await json(`/api/metadata/rto-resolve?${new URLSearchParams({ state, rto: legacy })}`);
    assert.equal(result.status, "resolved");
    assert.equal(result.rto, canonical);
    results.push({ state, canonical, duplicateRemoved: true, legacyLinkResolved: true });
  }
  for (const [query, expected] of [
    ["MH-04", "THANE - MH4"], ["MH-203", "RTO MH04-Mira Bhayander FitnessTrack - MH203"],
  ]) {
    const result = await json(`/api/metadata/rto-resolve?${new URLSearchParams({ q: query })}`);
    assert.equal(result.status, "resolved");
    assert.equal(result.rto, expected);
    results.push({ query, rto: result.rto });
  }
  for (const [state, label] of [["Delhi", "delhi"], ["Haryana", "gurugram"], ["Karnataka", "bengaluru"], ["Manipur", "DTO"]]) {
    const metadata = await json(`/api/metadata/rtos?${new URLSearchParams({ state })}`);
    assert.ok(!metadata.rtos.includes(label), `${label} has no identified office code`);
  }
  const erode = await json(`/api/metadata/rto-resolve?${new URLSearchParams({ state: "Tamil Nadu", q: "Erode" })}`);
  assert.equal(erode.status, "ambiguous", "genuinely different offices must remain selectable");
  const noida = await json("/api/query", {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ query: "registrations in noida in 2026" }),
  });
  assert.equal(noida.filters.rto, "Noida - UP16", "the screenshot query must select Noida");
  assert.ok(!noida.filters.ambiguousRtos);
  assert.ok(!(noida.warnings ?? []).some((warning) => /multiple RTOs/i.test(String(warning))));
  const report = { observedAt: new Date().toISOString(), mode: "local production server, CSV storage, live refresh disabled", results, realMultiOfficePreserved: true, screenshotQuery: { query: "registrations in noida in 2026", rto: noida.filters.rto, state: noida.filters.state } };
  await fs.mkdir("outputs", { recursive: true });
  await fs.writeFile("outputs/rto-label-http-check-2026-10-04.json", `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify(report, null, 2));
} catch (error) {
  console.error(error.message);
  console.error(logs.slice(-2000));
  process.exitCode = 1;
} finally {
  child.kill();
}
