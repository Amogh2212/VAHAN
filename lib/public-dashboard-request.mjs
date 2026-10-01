import { setTimeout as delay } from "node:timers/promises";

// The public service intermittently returns 404 for known working routes.
// Retry transport failures only; a successful response with missing evidence
// still reaches the caller unchanged and must fail its source validation.
const retryStatuses = new Set([404, 408, 429, 500, 502, 503, 504]);

export async function fetchPublicDashboardWithRetry(url, {
  fetchImpl = fetch, headers, timeoutMs = 25000, maxAttempts = 1,
  beforeRequest = async () => {}, sleep = delay,
} = {}) {
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    await beforeRequest();
    let response;
    try {
      response = await fetchImpl(url, { headers, signal: AbortSignal.timeout(timeoutMs) });
    } catch (error) {
      if (attempt === maxAttempts || !["TypeError", "TimeoutError"].includes(error?.name)) throw error;
      await sleep(500 * 2 ** (attempt - 1));
      continue;
    }
    if (!retryStatuses.has(response.status) || attempt === maxAttempts) return response;
    const retryAfter = response.headers.get("retry-after");
    const retryAfterMs = retryAfter === null ? 0 : /^\d+$/.test(retryAfter)
      ? Number(retryAfter) * 1000 : Math.max(0, Date.parse(retryAfter) - Date.now());
    // Do not retry sooner than the server asks, or hold a job indefinitely.
    if (retryAfterMs > 10000) return response;
    await response.body?.cancel();
    await sleep(Math.max(500 * 2 ** (attempt - 1), Number.isFinite(retryAfterMs) ? retryAfterMs : 0));
  }
}
