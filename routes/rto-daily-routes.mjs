import { searchRtoCatalog } from "../lib/rto-resolver.mjs";
import {
  RTO_DAILY_MAX_PINS_PER_USER,
  createRtoDailyPin,
  deleteRtoDailyPin,
  enqueueRtoDailyJob,
  getRtoDailyCoverage,
  getRtoDailyStatus,
  listRtoDailyFreshness,
  listRtoDailyPins,
  listRtoDailyRtos,
  listRtoDailyRuns,
  listRtoDailyTrend,
} from "../lib/rto-daily-snapshots.mjs";
import { createHttpRouter } from "../lib/http-router.mjs";

// This module owns only the HTTP-to-domain translation for /api/rto-daily/*.
// Cross-cutting concerns stay in server.mjs and are injected so every route
// continues to use the existing security, auth, rate-limit, and response rules.
export function createRtoDailyRouter(services) {
  const router = createHttpRouter(services);

  router.get("/api/rto-daily/search", {}, async ({ url }) => {
    const { loadCatalog, loadRows } = services;
    const rows = await loadRows();
    const catalog = await loadCatalog(rows);
    return { body: {
      query: url.searchParams.get("q") ?? "",
      matches: searchRtoCatalog(catalog, url.searchParams.get("q"), {
        state: url.searchParams.get("state"),
        limit: url.searchParams.get("limit"),
      }),
      catalogUpdatedAt: catalog.updated_at ?? null,
    } };
  });

  router.get("/api/rto-daily/status", {}, async ({ request, url }) => {
    const { canonicalRtoInput, currentUser } = services;
    const canonical = await canonicalRtoInput({
      state: url.searchParams.get("state"),
      rto: url.searchParams.get("rto") || url.searchParams.get("q"),
    });
    const user = await currentUser(request);
    return { body: { ...canonical, status: await getRtoDailyStatus({ ...canonical, userId: user?.id ?? null }) } };
  });

  router.get("/api/rto-daily/pins", { auth: "user" }, async ({ user }) => {
    const pins = await listRtoDailyPins({ userId: user.id });
    return { body: { pins, limit: RTO_DAILY_MAX_PINS_PER_USER, count: pins.length } };
  });

  router.post("/api/rto-daily/pins", { auth: "user", csrf: true, rateLimit: "expensive", body: "json" }, async ({ user, body }) => {
    const canonical = await services.canonicalRtoInput(body);
    const result = await createRtoDailyPin({ userId: user.id, ...canonical });
    const job = await enqueueRtoDailyJob({ ...canonical, reason: "pin" });
    return { status: result.created ? 201 : 200, body: { ...result, job, canonical } };
  });

  router.delete("/api/rto-daily/pins/:pinId", { auth: "user", csrf: true, rateLimit: "public" }, async ({ params, user }) => {
    const pin = await deleteRtoDailyPin(Number(params.pinId), { userId: user.id });
    if (!pin) {
      return { status: 404, body: { error: "Pinned RTO not found." } };
    }
    return { body: { pin, deleted: true } };
  });

  router.post("/api/rto-daily/requests", { auth: "admin", csrf: true, rateLimit: "expensive", body: "json" }, async ({ body }) => {
    const canonical = await services.canonicalRtoInput(body);
    const job = await enqueueRtoDailyJob({ ...canonical, reason: "lookup" });
    return { status: job.status === "success" ? 200 : 202, body: { job, canonical } };
  });

  router.get("/api/rto-daily/rtos", {}, async ({ url }) => ({
    body: { rtos: await listRtoDailyRtos({ state: url.searchParams.get("state") }) },
  }));

  router.get("/api/rto-daily/freshness", {}, async ({ url }) => ({
    body: { freshness: await listRtoDailyFreshness({ limit: url.searchParams.get("limit") }) },
  }));

  router.get("/api/rto-daily/coverage", {}, async ({ url }) => ({
    body: await getRtoDailyCoverage({ date: url.searchParams.get("date") }),
  }));

  router.get("/api/rto-daily/runs", {}, async ({ url }) => ({
    body: { runs: await listRtoDailyRuns({ limit: url.searchParams.get("limit") }) },
  }));

  router.get("/api/rto-daily/trend", {}, async ({ url }) => {
    const filters = {
      state: url.searchParams.get("state"),
      rto: url.searchParams.get("rto"),
      fuelGroup: url.searchParams.get("fuelGroup"),
      category: url.searchParams.get("category"),
      oem: url.searchParams.get("oem"),
    };
    return { body: { filters, rows: await listRtoDailyTrend({ ...filters, limit: url.searchParams.get("limit") }) } };
  });

  return router;
}
