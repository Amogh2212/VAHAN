import assert from "node:assert/strict";

import {
  collectRtoFactorSourceCandidates,
  compileRtoFactorSourceRegistry,
  extractHtmlCardCandidates,
  extractHtmlLinkCandidates,
  extractHtmlTableRowCandidates,
  extractRssCandidates,
} from "../lib/rto-factor-source-collector.mjs";
import { parseArgs } from "./collect-rto-factor-sources.mjs";

const REGISTRY_INPUT = Object.freeze({
  schemaVersion: 1,
  sources: [
    {
      id: "official-notices",
      sourceKey: "example.transport.notices",
      publisher: "Example Transport Authority",
      sourceTier: "A",
      sourceType: "transport_authority",
      canonicalHost: "transport.example.gov.in",
      evidencePolicy: "report_evidence",
      discoveryUrl: "https://transport.example.gov.in/notices",
      parser: "html_links",
      itemPathPrefixes: ["/notices/"],
      titleKeywords: ["electric", "vehicle"],
      maxCandidates: 10,
      enabled: true,
    },
  ],
});

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function response(body, { status = 200, headers = {} } = {}) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (key) => headers[String(key).toLowerCase()] ?? null },
    text: async () => body,
  };
}

function testRegistryValidation() {
  const registry = compileRtoFactorSourceRegistry(clone(REGISTRY_INPUT));
  assert.equal(registry.sources.length, 1);
  assert.equal(registry.sources[0].sourceKey, "example.transport.notices");
  assert.equal(registry.sources[0].discoveryUrl, "https://transport.example.gov.in/notices");

  const alias = clone(REGISTRY_INPUT);
  alias.sources[0].allowedHosts = ["www.transport.example.gov.in"];
  alias.sources[0].discoveryUrl = "https://www.transport.example.gov.in/notices";
  const aliasedRegistry = compileRtoFactorSourceRegistry(alias);
  assert.deepEqual(aliasedRegistry.sources[0].allowedHosts, ["transport.example.gov.in", "www.transport.example.gov.in"]);

  const wrongHost = clone(REGISTRY_INPUT);
  wrongHost.sources[0].discoveryUrl = "https://evil.example/notices";
  assert.throws(() => compileRtoFactorSourceRegistry(wrongHost), /must be HTTPS on transport\.example\.gov\.in/);

  const noKeywords = clone(REGISTRY_INPUT);
  noKeywords.sources[0].titleKeywords = [];
  assert.throws(() => compileRtoFactorSourceRegistry(noKeywords), /non-empty array of title keywords/);
}

function testHtmlExtraction() {
  const source = compileRtoFactorSourceRegistry(clone(REGISTRY_INPUT)).sources[0];
  const candidates = extractHtmlLinkCandidates(`
    <a href="/notices/ev-policy?utm_source=test">Electric vehicle policy update</a>
    <a href="/notices/ev-policy?utm_campaign=again">Electric vehicle policy update duplicate</a>
    <a href="/news/vehicle">Vehicle news outside approved path</a>
    <a href="https://evil.example/notices/ev-policy">Electric vehicle on another host</a>
    <a href="/notices/electrical-grid">Electrical infrastructure update</a>
    <a href="/notices/general">General circular</a>
  `, { source, retrievedAt: "2026-07-27T00:00:00.000Z" });
  assert.equal(candidates.length, 1);
  assert.equal(candidates[0].reviewStatus, "pending_review");
  assert.equal(candidates[0].document.canonicalUrl, "https://transport.example.gov.in/notices/ev-policy");
  assert.equal(candidates[0].document.publishedAt, null);
}

function testRssExtraction() {
  const source = {
    ...compileRtoFactorSourceRegistry(clone(REGISTRY_INPUT)).sources[0],
    parser: "rss",
  };
  const candidates = extractRssCandidates(`
    <rss><channel><item>
      <title><![CDATA[Electric vehicle registration notice]]></title>
      <link>https://transport.example.gov.in/notices/ev-registration</link>
      <pubDate>Sun, 27 Jul 2026 09:00:00 GMT</pubDate>
      <description><![CDATA[<p>Official electric vehicle notice.</p>]]></description>
    </item></channel></rss>
  `, { source, retrievedAt: "2026-07-27T10:00:00.000Z" });
  assert.equal(candidates.length, 1);
  assert.equal(candidates[0].document.publishedAt, "2026-07-27T09:00:00.000Z");
  assert.match(candidates[0].document.discoverySnippet, /Official electric vehicle notice/);
}

function testCardAndTableExtraction() {
  const source = {
    ...compileRtoFactorSourceRegistry(clone(REGISTRY_INPUT)).sources[0],
    parser: "html_cards",
    requirePublishedAt: true,
  };
  const cards = extractHtmlCardCandidates(`
    <div>15-Jul-2026</div>
    <h6>Auto industry electric vehicle sales update</h6>
    <p>Monthly official industry context.</p><a href="/notices/ev-sales">View</a>
  `, { source, retrievedAt: "2026-07-27T10:00:00.000Z" });
  assert.equal(cards.length, 1);
  assert.equal(cards[0].document.publishedAt, "2026-07-15T00:00:00.000Z");

  const tableSource = { ...source, parser: "html_table_rows" };
  const rows = extractHtmlTableRowCandidates(`
    <table><tr><td>1</td><td>26 Jul 2026</td><td>Heavy rainfall and electric vehicle transport disruption warning</td><td><a href="/notices/weather.pdf">View</a></td></tr></table>
  `, { source: tableSource, retrievedAt: "2026-07-27T10:00:00.000Z" });
  assert.equal(rows.length, 1);
  assert.equal(rows[0].document.publishedAt, "2026-07-26T00:00:00.000Z");
  assert.match(rows[0].document.discoverySnippet, /Heavy rainfall/);
}

async function testCollectionKeepsReviewGate() {
  const registry = compileRtoFactorSourceRegistry(clone(REGISTRY_INPUT));
  const result = await collectRtoFactorSourceCandidates(registry, {
    now: () => new Date("2026-07-27T10:00:00.000Z"),
    fetchImpl: async (url, options) => {
      assert.equal(url, "https://transport.example.gov.in/notices");
      assert.equal(options.redirect, "manual");
      assert.match(options.headers["User-Agent"], /VahanEY-RtoFactorSourceCollector/);
      return response('<a href="/notices/ev-policy">Electric vehicle policy update</a>');
    },
  });
  assert.equal(result.databaseWrites, false);
  assert.equal(result.reviewRequired, true);
  assert.equal(result.candidateCount, 1);
  assert.equal(result.sources[0].status, "collected");
  assert.match(result.candidates[0].reviewNote, /Discovery only/);
}

function testArgs() {
  assert.deepEqual(parseArgs([]), {
    registry: "data/rto-factor-source-registry.json",
    sources: [],
    limit: null,
    timeoutMs: 15_000,
    write: false,
    output: null,
    help: false,
  });
  assert.deepEqual(parseArgs(["--source", "official-notices", "--limit", "5", "--write"]), {
    registry: "data/rto-factor-source-registry.json",
    sources: ["official-notices"],
    limit: 5,
    timeoutMs: 15_000,
    write: true,
    output: null,
    help: false,
  });
  assert.throws(() => parseArgs(["--output", "out.json"]), /requires --write/);
}

async function main() {
  testRegistryValidation();
  testHtmlExtraction();
  testRssExtraction();
  testCardAndTableExtraction();
  await testCollectionKeepsReviewGate();
  testArgs();
  console.log("RTO factor source collector checks passed.");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
