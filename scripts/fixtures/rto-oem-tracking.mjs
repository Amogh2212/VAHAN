import { annualSourceFixture } from "./rto-oem-annual.mjs";

export function trackingSourceFixture({ counts = { "Maker A": 15, "Maker B": 10 }, baseline = {}, omitChart = [], invalidHeadline = false } = {}) {
  const annual = annualSourceFixture(baseline);
  const requests = [];
  const fetchImpl = async (url, options) => {
    const u = new URL(url);
    requests.push(u);
    if (u.pathname.endsWith("/lazy/vehicle-makers")) return Response.json([u.searchParams.get("search")]);
    if (u.searchParams.get("fromYear") === "2025" || u.pathname.endsWith("/vahan") || u.pathname.endsWith("json_rtos")) return annual.fetchImpl(url, options);
    const selected = (u.searchParams.get("vehicleMakers") ?? "").split(",").filter(Boolean);
    if (u.pathname.endsWith("top5Makerchart")) {
      const names = selected.filter((name) => !omitChart.includes(name)).sort((a, b) => (counts[b] ?? 0) - (counts[a] ?? 0));
      return Response.json({ labels: names, datasets: [{ data: names.map((name) => counts[name] ?? 0) }] });
    }
    if (u.pathname.endsWith("dashboardcount")) return Response.json({ totalTransactions: invalidHeadline ? "" : String(selected.reduce((sum, name) => sum + (counts[name] ?? 0), 0)) });
    throw new Error(`Unexpected tracking fixture request: ${u.pathname}`);
  };
  return { fetchImpl, requests };
}
