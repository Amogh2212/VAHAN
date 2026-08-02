import { getPool } from "./db.mjs";

const LOCK_NAME = "vahan-ey-external-scrape";

export async function acquireVahanScrapeLock(owner = "scraper", options = {}) {
  const waitMs = Math.max(0, Number(options.waitMs) || 0);
  const retryMs = Math.max(250, Number(options.retryMs) || 5000);
  const deadline = Date.now() + waitMs;
  const client = await getPool().connect();
  let clientReleased = false;
  try {
    while (true) {
      const result = await client.query(
        "select pg_try_advisory_lock(hashtext($1)) as acquired",
        [LOCK_NAME],
      );
      if (result.rows[0]?.acquired) break;
      if (Date.now() >= deadline) {
        client.release();
        clientReleased = true;
        throw new Error(`Another VAHAN scraper is already running; ${owner} did not start.`);
      }
      await sleep(Math.min(retryMs, Math.max(1, deadline - Date.now())));
    }
  } catch (error) {
    if (!clientReleased) client.release();
    throw error;
  }
  let released = false;
  return async () => {
    if (released) return;
    released = true;
    await client.query("select pg_advisory_unlock(hashtext($1))", [LOCK_NAME]).catch(() => {});
    client.release();
  };
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
