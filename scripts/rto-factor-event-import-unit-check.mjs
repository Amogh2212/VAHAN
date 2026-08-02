import assert from "node:assert/strict";
import {
  assertWriteGate,
  compileManualRtoFactorEventInput,
  importManualRtoFactorEvent,
  parseArgs,
} from "./import-rto-factor-event.mjs";

const VALID_INPUT = Object.freeze({
  schemaVersion: 1,
  source: {
    sourceKey: "maharashtra.transport.notice",
    publisher: "Maharashtra Transport Department",
    sourceTier: "A",
    sourceType: "transport_authority",
    canonicalHost: "transport.maharashtra.gov.in",
    evidencePolicy: "report_evidence",
  },
  documents: [
    {
      ref: "official-notice",
      canonicalUrl: "https://transport.maharashtra.gov.in/notices/ev-fee-waiver",
      title: "Electric vehicle fee waiver notice",
      publishedAt: "2026-06-01T04:30:00.000Z",
      evidenceExcerpt: "The fee waiver applies to qualifying electric vehicles from 1 June 2026.",
      reviewStatus: "approved",
      reviewedAt: "2026-06-01T10:00:00.000Z",
    },
  ],
  event: {
    eventType: "tax_or_fee",
    title: "Maharashtra EV fee waiver",
    claimSummary: "The state announced a registration-fee waiver for qualifying electric vehicles.",
    hypothesis: "Daily EV registrations may increase after the waiver becomes effective.",
    expectedDirection: "increase",
    effectiveStart: "2026-06-01",
    effectiveEnd: "2026-12-31",
    reviewStatus: "eligible",
    sourceReliabilityScore: 0.98,
    reviewedAt: "2026-06-01T10:05:00.000Z",
    documents: [
      {
        documentRef: "official-notice",
        evidenceRole: "primary",
      },
    ],
    targets: [
      {
        targetRole: "affected",
        geographyScope: "state",
        state: "Maharashtra",
        fuelGroup: "EV",
        vehicleCategory: "ALL",
      },
    ],
  },
});

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function testCompileAndAuditDefaults() {
  const plan = compileManualRtoFactorEventInput(clone(VALID_INPUT));
  assert.equal(plan.schemaVersion, 1);
  assert.equal(plan.sourceInput.createdByLabel, "manual-admin-cli");
  assert.equal(plan.documentInputs[0].input.createdByLabel, "manual-admin-cli");
  assert.equal(plan.documentInputs[0].input.reviewedByLabel, "manual-admin-cli");
  assert.equal(plan.eventInput.createdByLabel, "manual-admin-cli");
  assert.equal(plan.eventInput.reviewedByLabel, "manual-admin-cli");
  assert.equal(plan.preview.source.sourceTier, "A");
  assert.equal(plan.preview.documents[0].canonicalHost, "transport.maharashtra.gov.in");
  assert.equal(plan.preview.event.documents[0].documentId, 1);
  assert.equal(plan.preview.event.targets[0].state, "Maharashtra");
}

function testStrictInputContract() {
  const typo = clone(VALID_INPUT);
  typo.source.sourceTire = "A";
  assert.throws(
    () => compileManualRtoFactorEventInput(typo),
    /source contains unknown field\(s\): sourceTire/,
  );

  const unlinked = clone(VALID_INPUT);
  unlinked.documents.push({
    ...unlinked.documents[0],
    ref: "second-notice",
    canonicalUrl: "https://transport.maharashtra.gov.in/notices/second",
  });
  assert.throws(
    () => compileManualRtoFactorEventInput(unlinked),
    /Every imported document must be linked/,
  );

  const wrongHost = clone(VALID_INPUT);
  wrongHost.documents[0].canonicalUrl = "https://example.com/notices/ev-fee-waiver";
  assert.throws(
    () => compileManualRtoFactorEventInput(wrongHost),
    /host must exactly match source\.canonicalHost/,
  );

  const pendingEvidence = clone(VALID_INPUT);
  pendingEvidence.documents[0].reviewStatus = "pending";
  delete pendingEvidence.documents[0].reviewedAt;
  assert.throws(
    () => compileManualRtoFactorEventInput(pendingEvidence),
    /require approved primary\/corroborating documents/,
  );

  const wrongIntakeMethod = clone(VALID_INPUT);
  wrongIntakeMethod.event.intakeMethod = "curated_import";
  assert.throws(
    () => compileManualRtoFactorEventInput(wrongIntakeMethod),
    /event\.intakeMethod must be manual/,
  );
}

function testArgsAndWriteGate() {
  assert.deepEqual(
    parseArgs(["--input", "event.json"]),
    {
      input: "event.json",
      write: false,
      actorLabel: process.env.FACTOR_AGENT_MANUAL_ACTOR_LABEL || "manual-admin-cli",
      help: false,
    },
  );
  assert.equal(parseArgs(["--input", "event.json", "--write"]).write, true);
  assert.throws(
    () => parseArgs(["--input", "event.json", "--write", "--dry-run"]),
    /cannot be combined/,
  );
  assert.throws(() => parseArgs([]), /--input is required/);
  assert.throws(() => parseArgs(["--input"]), /--input requires a value/);
  assert.throws(() => parseArgs(["--bogus"]), /Unknown argument/);
  assert.throws(() => assertWriteGate({}), /FACTOR_AGENT_ENABLED=1/);
  assert.throws(
    () => assertWriteGate({ FACTOR_AGENT_ENABLED: "1", FACTOR_AGENT_MODE: "reviewed" }),
    /FACTOR_AGENT_MODE=draft_only/,
  );
  assert.doesNotThrow(() => assertWriteGate({
    FACTOR_AGENT_ENABLED: "1",
    FACTOR_AGENT_MODE: "draft_only",
  }));
}

async function testDryRunMakesNoCalls() {
  let calls = 0;
  const fail = async () => {
    calls += 1;
    throw new Error("must not be called");
  };
  const result = await importManualRtoFactorEvent(clone(VALID_INPUT), {
    services: {
      createSource: fail,
      createDocument: fail,
      createEvent: fail,
    },
  });
  assert.equal(result.mode, "dry-run");
  assert.equal(calls, 0);
  assert.equal(result.event.reviewStatus, "eligible");
}

async function testWriteUsesPersistedIds() {
  const calls = [];
  const services = {
    async createSource(input) {
      calls.push(["source", input]);
      return { id: 41, ...input };
    },
    async createDocument(input) {
      calls.push(["document", input]);
      return { id: 51, ...input };
    },
    async createEvent(input) {
      calls.push(["event", input]);
      return { id: 61, ...input };
    },
  };
  const result = await importManualRtoFactorEvent(clone(VALID_INPUT), {
    write: true,
    env: {
      FACTOR_AGENT_ENABLED: "1",
      FACTOR_AGENT_MODE: "draft_only",
    },
    services,
  });
  assert.equal(result.mode, "write");
  assert.deepEqual(calls.map(([kind]) => kind), ["source", "document", "event"]);
  assert.equal(calls[1][1].sourceId, 41);
  assert.deepEqual(calls[2][1].documents, [{ documentId: 51, evidenceRole: "primary" }]);
  assert.equal(result.event.id, 61);
}

function testWriteGateRunsBeforePersistence() {
  let calls = 0;
  const services = {
    createSource: async () => { calls += 1; },
    createDocument: async () => { calls += 1; },
    createEvent: async () => { calls += 1; },
  };
  return assert.rejects(
    () => importManualRtoFactorEvent(clone(VALID_INPUT), {
      write: true,
      env: {
        FACTOR_AGENT_ENABLED: "0",
        FACTOR_AGENT_MODE: "draft_only",
      },
      services,
    }),
    /FACTOR_AGENT_ENABLED=1/,
  ).then(() => assert.equal(calls, 0));
}

async function main() {
  testCompileAndAuditDefaults();
  testStrictInputContract();
  testArgsAndWriteGate();
  await testDryRunMakesNoCalls();
  await testWriteUsesPersistedIds();
  await testWriteGateRunsBeforePersistence();
  console.log("RTO factor event import unit checks passed.");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
