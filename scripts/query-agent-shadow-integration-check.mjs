import assert from "node:assert/strict";

process.env.DATABASE_URL = "";
process.env.AI_QUERY_PROVIDER = "none";
const { queryData } = await import("../server.mjs");
const input = { query: "Show EV registrations in Delhi in January 2025." };

process.env.QUERY_AGENT_MODE = "off";
const baseline = await queryData(input);
process.env.QUERY_AGENT_MODE = "shadow";
const shadow = await queryData(input);

assert.deepEqual(shadow, baseline, "shadow configuration must not change the dashboard payload");
assert.equal(shadow.filters.state, "Delhi");
console.log("Query-agent shadow integration check passed.");
