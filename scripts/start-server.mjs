// Render services created outside a Blueprint can ignore render.yaml changes.
// Keep the hermetic Playwright install discoverable in the running process.
if (process.env.RENDER === "true" && !process.env.PLAYWRIGHT_BROWSERS_PATH) {
  process.env.PLAYWRIGHT_BROWSERS_PATH = "0";
}

await import("../server.mjs");
