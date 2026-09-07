import fs from "node:fs/promises";
import path from "node:path";

function option(name, fallback = null) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] ?? fallback : fallback;
}

const input = option("--input");
if (!input) throw new Error("Usage: node scripts/bulk-query-crosscheck-report.mjs --input <bulk-report.json> [--output <crosscheck.csv>]");
const retryInput = option("--retry");
const output = option("--output", input.replace(/\.json$/i, ".crosscheck.csv"));
const markdownOutput = output.replace(/\.csv$/i, ".md");

function clean(value) {
  return String(value ?? "").replace(/\r?\n/g, " ").replace(/\s+/g, " ").trim();
}

function csvCell(value) {
  return `"${clean(value).replaceAll('"', '""')}"`;
}

function issueText(result) {
  return result.issues?.map((issue) => clean(issue.message)).filter(Boolean).join("; ") || "";
}

function isNumericResult(result) {
  return result.ok
    && result.dataStatus === "live"
    && Number.isFinite(Number(result.total))
    && result.rowCount > 0;
}

function remark(result, numeric) {
  if (numeric) return "Verified numeric result from a completed official Public Dashboard refresh.";
  if (result.dataStatus === "missing") return "No verified numeric result: the exact dashboard slice is missing. Do not treat the displayed zero as a confirmed zero.";
  if (result.dataStatus === "fetch_failed" || result.category === "scrape_failed") return `Official source did not return the requested monthly values. ${issueText(result)}`;
  if (result.category === "api_server_error") return `Not a safely supported single-total query. ${issueText(result)}`;
  return issueText(result) || "No source-backed numeric result was returned.";
}

const report = JSON.parse(await fs.readFile(input, "utf8"));
if (retryInput) {
  const retryReport = JSON.parse(await fs.readFile(retryInput, "utf8"));
  const retryByOriginalIndex = new Map(
    (retryReport.results ?? [])
      .filter((result) => Number.isInteger(result.retryOf?.index))
      .map((result) => [result.retryOf.index, result]),
  );
  report.results = report.results.map((result) => {
    const retry = retryByOriginalIndex.get(result.index);
    return retry ? { ...retry, index: result.index, label: result.label, query: result.query } : result;
  });
}
const rows = report.results.map((result) => {
  const numeric = isNumericResult(result);
  return {
    index: result.index,
    label: result.label,
    query: result.query,
    output: numeric ? result.total : "",
    numeric,
    dataStatus: result.dataStatus,
    rowCount: result.rowCount,
    category: result.category,
    remark: remark(result, numeric),
  };
});

const csv = [
  ["index", "label", "query", "numeric_output", "data_status", "row_count", "category", "remark"],
  ...rows.map((row) => [row.index, row.label, row.query, row.output, row.dataStatus, row.rowCount, row.category, row.remark]),
].map((row) => row.map(csvCell).join(",")).join("\n");

const numericRows = rows.filter((row) => row.numeric);
const noNumberRows = rows.filter((row) => !row.numeric);
const table = (items) => items.length
  ? ["| # | Query | Output | Remark |", "| - | - | -: | - |", ...items.map((row) => `| ${row.index} | ${clean(row.query).replaceAll("|", "\\|")} | ${row.output} | ${clean(row.remark).replaceAll("|", "\\|")} |`)].join("\n")
  : "_None_";
const markdown = [
  "# Bulk Query Manual Cross-check",
  "",
  `Source run: ${input}`,
  ...(retryInput ? [`Retry overlay: ${retryInput}`] : []),
  `Queries completed: ${rows.length}`,
  `Source-backed numeric results: ${numericRows.length}`,
  `No numeric result: ${noNumberRows.length}`,
  "",
  "## Numeric results to cross-check",
  "",
  table(numericRows),
  "",
  "## Remaining queries and remarks",
  "",
  table(noNumberRows),
  "",
].join("\n");

await fs.mkdir(path.dirname(output), { recursive: true });
await fs.writeFile(output, `${csv}\n`);
await fs.writeFile(markdownOutput, markdown);
console.log(`Wrote ${output}`);
console.log(`Wrote ${markdownOutput}`);
console.log(JSON.stringify({ completed: rows.length, numericResults: numericRows.length, noNumericResult: noNumberRows.length }, null, 2));
