import fs from "node:fs/promises";
import { parseCsvLine } from "../lib/registrations.mjs";
import {
  canonicalizeRtoCatalog, canonicalRtoLabel, normalizeRtoLookup,
  resolveRtoWithCatalog, toCatalogRto,
} from "../lib/rto-resolver.mjs";

const catalog = JSON.parse(await fs.readFile("data/vahan/rto_catalog.json", "utf8"));
const entries = new Map();
function add(state, label, source) {
  if (!state || !label || label === "All Vahan4 Running Office") return;
  const key = `${state}||${label}`;
  const entry = entries.get(key) ?? { state, label, sources: [] };
  if (!entry.sources.includes(source)) entry.sources.push(source);
  entries.set(key, entry);
}
for (const group of catalog.states) for (const rto of group.rtos) add(group.state, rto.label, "catalog");
const [header, ...lines] = (await fs.readFile("data/vahan/vahan_fuel_monthly.csv", "utf8")).trim().split(/\r?\n/);
const headers = parseCsvLine(header);
for (const line of lines) {
  const fields = parseCsvLine(line);
  add(fields[headers.indexOf("state")], fields[headers.indexOf("rto")], "csv");
}
if (process.argv.includes("--database")) {
  const { query, closePool } = await import("../lib/db.mjs");
  try {
    const result = await query("select distinct state, rto from registrations order by state, rto");
    for (const row of result.rows) add(row.state, row.rto, "database");
  } finally {
    await closePool();
  }
}
if (process.argv.includes("--database-snapshot")) {
  const snapshot = JSON.parse(await fs.readFile("outputs/rto-label-database-snapshot-2026-10-04.json", "utf8"));
  for (const row of snapshot.rows) add(row.state, row.rto, "database");
}
const byState = new Map();
for (const entry of entries.values()) {
  if (!byState.has(entry.state)) byState.set(entry.state, []);
  byState.get(entry.state).push(toCatalogRto(entry.label));
}
const mergedCatalog = canonicalizeRtoCatalog({ states: [...byState].map(([state, rtos]) => ({ state, rtos })) }, { requireOfficeCode: true });
const selectableLabels = new Set(mergedCatalog.states.flatMap((group) => group.rtos.map((rto) => `${group.state}||${rto.label}`)));
const unidentifiedLabels = [...entries.values()].filter((entry) => !selectableLabels.has(`${entry.state}||${canonicalRtoLabel(entry.state, entry.label)}`));
const duplicateGroups = new Map();
for (const entry of entries.values()) {
  const key = `${entry.state}||${normalizeRtoLookup(canonicalRtoLabel(entry.state, entry.label))}`;
  if (!duplicateGroups.has(key)) duplicateGroups.set(key, []);
  duplicateGroups.get(key).push(entry);
}
const duplicates = [...duplicateGroups.values()].filter((group) => group.length > 1);
const codeFailures = [];
const nameAmbiguities = [];
let codeChecks = 0;
let nameChecks = 0;
for (const group of mergedCatalog.states) {
  const scoped = { states: [group] };
  for (const rto of group.rtos) {
    const match = rto.label.match(/-\s*([A-Z]{2})\s*0*(\d{1,3})\s*$/i);
    if (!match) continue;
    const code = `${match[1]}-${Number(match[2])}`;
    codeChecks += 1;
    const result = resolveRtoWithCatalog({ state: group.state, locationText: code }, scoped);
    if (result.rto !== rto.label) codeFailures.push({ state: group.state, label: rto.label, query: code, resolution: result.rtoResolution });
    const name = rto.label.slice(0, match.index).replace(/\b(?:RTO|ARTO|DTO|RLA|SDM|SDO|office)\b/gi, "").replace(/\s+/g, " ").trim();
    if (name.length < 4) continue;
    nameChecks += 1;
    const namedResult = resolveRtoWithCatalog({ state: group.state, locationText: name }, scoped);
    if (namedResult.ambiguousRtos) nameAmbiguities.push({ state: group.state, label: rto.label, query: name, candidates: namedResult.rtoResolution.candidates });
  }
}
const report = {
  observedAt: new Date().toISOString(),
  sources: process.argv.some((arg) => ["--database", "--database-snapshot"].includes(arg)) ? ["catalog", "csv", "database"] : ["catalog", "csv"],
  states: catalog.states.length,
  catalogRtos: catalog.states.reduce((n, group) => n + group.rtos.length, 0),
  uniqueRawLabels: entries.size,
  selectableOffices: mergedCatalog.states.reduce((n, group) => n + group.rtos.length, 0),
  duplicates, unidentifiedLabels, codeChecks, codeFailures, nameChecks, nameAmbiguities,
};
await fs.mkdir("outputs", { recursive: true });
const output = "outputs/rto-label-audit-2026-10-04.json";
await fs.writeFile(output, `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify({ output, states: report.states, catalogRtos: report.catalogRtos, uniqueRawLabels: report.uniqueRawLabels, duplicates, codeChecks, codeFailures, nameChecks, nameAmbiguityCount: nameAmbiguities.length }, null, 2));
if (codeFailures.length) process.exitCode = 1;
