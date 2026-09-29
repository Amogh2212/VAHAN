import { fetchPublicRtoStockSegment } from "./public-dashboard-client.mjs";
import { RTO_DAILY_CATEGORIES, RTO_DAILY_CATEGORY_FILTERS, RTO_DAILY_FUEL_FILTERS } from "./rto-daily-snapshots.mjs";

const CACHE_MS = 10 * 60 * 1000;
const cache = new Map();

export async function getRtoTopMakers({ state, rto, fetchSegment = fetchPublicRtoStockSegment } = {}) {
  const key = `${state}\u0000${rto}`;
  const cached = cache.get(key);
  if (cached && Date.now() < cached.expiresAt) return cached.promise;
  const promise = (async () => {
    const segment = await fetchSegment({
      state,
      rto,
      vehicleCategories: [...new Set(RTO_DAILY_CATEGORIES.flatMap((category) => RTO_DAILY_CATEGORY_FILTERS[category].vehicleCategories))],
      vehicleClasses: [],
      fuels: [...new Set([...RTO_DAILY_FUEL_FILTERS.EV, ...RTO_DAILY_FUEL_FILTERS.ICE])],
    });
    if (segment.metricKind !== "active_stock" || segment.validation?.contract !== "public-stock-v2") {
      throw new Error("Top-maker source scope is unverified.");
    }
    return {
      state,
      rto,
      observedAt: segment.scrapedAt,
      metricKind: segment.metricKind,
      source: segment.source,
      scope: "Current active registrations across the report's 2W, 3W and 4W EV/ICE categories",
      makers: segment.makers.map(({ maker, count, rank }) => ({ maker, count, rank })),
    };
  })();
  cache.set(key, { promise, expiresAt: Date.now() + CACHE_MS });
  try { return await promise; }
  catch (error) { cache.delete(key); throw error; }
}
