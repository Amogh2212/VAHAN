import http from "node:http";
import fs from "node:fs/promises";
import path from "node:path";
import { buildRtoReportPayloads, reportPeriod } from "../lib/rto-reports.mjs";

// Local UI preview backed only by the saved three-RTO live pilot. No database.
const pilot = JSON.parse(await fs.readFile("artifacts/rto-source-pilot.json", "utf8"));
if (pilot.failures || pilot.results.length !== 18) throw new Error("An 18/18 successful live pilot is required.");
const date = pilot.generatedAt.slice(0, 10);
const cohort = [...new Map(pilot.results.map(r => [r.rto, { state: r.state, rto: r.rto, selectionRank: r.rank }])).values()];
const totalRows = pilot.results.map(r => ({ ...r, snapshotDate: date, reportTotal: r.total, trackedOemTotal: r.topFiveTotal, untrackedTotal: r.total - r.topFiveTotal, qualityStatus: "ready" }));
const oemRows = pilot.results.flatMap(r => r.makers.map(m => ({ state: r.state, rto: r.rto, snapshotDate: date, fuelGroup: r.fuelGroup, vehicleCategory: r.vehicleCategory, oem: m.maker, vehicleCount: m.count, sourceRank: m.rank })));
const reports = buildRtoReportPayloads({ period: reportPeriod("daily", date), cohort, totalRows, oemRows }).map((r, i) => ({ ...r, id: i + 1, batchId: 1 }));
const batch = { id: 1, cadence: "daily", periodStart: date, periodEnd: date, sourceSnapshotDate: date, cohortSize: 3, coverageCount: 3, reportCount: 3, warningCount: 3, reviewCount: 0, revision: 1, status: "ready_with_warnings" };
const root = path.resolve("public");
const server = http.createServer(async (req, res) => {
  try {
    const u = new URL(req.url, "http://127.0.0.1:33119");
    const json = value => { res.setHeader("Content-Type", "application/json"); res.end(JSON.stringify(value)); };
    if (u.pathname === "/api/me") return json({ user: null });
    if (u.pathname === "/api/rto-reports/readiness") return json({ eligible: true, expectedRtos: 3, cohortSize: 3, completeRtos: 3, run: { id: 1, snapshotDate: date } });
    if (u.pathname === "/api/rto-reports/batches") return json({ batches: [batch] });
    if (u.pathname === "/api/rto-reports/batches/1/reports") return json({ batch, reports });
    const match = u.pathname.match(/^\/api\/rto-reports\/(\d+)$/);
    if (match) return json({ report: reports.find(r => r.id === Number(match[1])) });
    if (u.pathname.startsWith("/api/")) return json({});
    const file = path.resolve(root, `.${decodeURIComponent(u.pathname)}`);
    if (!file.startsWith(root + path.sep)) { res.statusCode = 403; return res.end(); }
    const type = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml" }[path.extname(file)] ?? "application/octet-stream";
    res.setHeader("Content-Type", type);
    const body = await fs.readFile(file);
    res.end(type === "text/html" ? body.toString().replace("<title>", "<title>LOCAL THREE-RTO PILOT — ") : body);
  } catch { res.statusCode = 404; res.end(); }
});
server.listen(33119, "127.0.0.1", () => console.log("Local three-RTO live-evidence preview: http://127.0.0.1:33119/rto-reports.html"));
