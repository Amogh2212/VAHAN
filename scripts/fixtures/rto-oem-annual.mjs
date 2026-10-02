import { RTO_DAILY_CATEGORY_FILTERS, RTO_DAILY_FUEL_FILTERS } from "../../lib/rto-daily-snapshots.mjs";

export function annualSourceFixture({ total = 30, labels = ["Maker A", "Maker B", "Others"], counts = [15, 10, 5], categoryTotal = total, invalidCategory = false, status = 200 } = {}) {
  const requests = [];
  const categories = [...new Set(Object.values(RTO_DAILY_CATEGORY_FILTERS).flatMap((s) => s.vehicleCategories))];
  const fuels = [...new Set(Object.values(RTO_DAILY_FUEL_FILTERS).flat())];
  const select = (id, values) => `<select id="${id}">${values.map((value) => `<option value="${value}">${value}</option>`).join("")}</select>`;
  const html = '<select id="stateCode"><option value="UK">Uttarakhand</option></select>' + select("vehicleSubCategory", categories) + select("vehicleFuel", fuels) + '<select id="vehicleClass"></select>';
  const fetchImpl = async (url) => {
    const u = new URL(url); requests.push(u);
    if (u.pathname.endsWith("/vahan")) return new Response(html);
    if (u.pathname.endsWith("/json_rtos")) return Response.json([{ stateCode: "UK", rtoCode: 7, rtoName: "DEHRADUN RTO - UK7" }]);
    if (status !== 200) return new Response("Unavailable", { status });
    if (u.pathname.endsWith("top5Makerchart")) return Response.json({ labels, datasets: [{ data: counts }] });
    if (u.pathname.endsWith("categoriesdonutchart")) return Response.json({ labels: total ? [invalidCategory ? "UNREQUESTED" : u.searchParams.get("vehicleSubCategories").split(",")[0]] : [], data: total ? [categoryTotal] : [] });
    if (u.pathname.endsWith("dashboardcount")) return Response.json({ totalTransactions: String(total) });
    throw new Error(`Unexpected source URL: ${u.pathname}`);
  };
  return { fetchImpl, requests };
}
