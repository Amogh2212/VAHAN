import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { pathToFileURL } from "node:url";
import { closePool } from "../lib/db.mjs";
import {
  createRtoFactorDocument,
  createRtoFactorEvent,
  createRtoFactorSource,
  prepareRtoFactorDocument,
  prepareRtoFactorEvent,
  prepareRtoFactorSource,
} from "../lib/rto-factor-events.mjs";

const INPUT_SCHEMA_VERSION = 1;
const DEFAULT_ACTOR_LABEL = "manual-admin-cli";
const REF_PATTERN = /^[a-z0-9][a-z0-9._-]{0,63}$/;

const TOP_LEVEL_KEYS = new Set(["schemaVersion", "source", "documents", "event"]);
const SOURCE_KEYS = new Set([
  "sourceKey",
  "publisher",
  "sourceTier",
  "sourceType",
  "canonicalHost",
  "evidencePolicy",
  "intakeMethod",
  "notes",
  "idempotencyKey",
  "supersedesSourceId",
  "createdByUserId",
  "createdByLabel",
]);
const DOCUMENT_KEYS = new Set([
  "ref",
  "canonicalUrl",
  "title",
  "publishedAt",
  "retrievedAt",
  "evidenceExcerpt",
  "contentHash",
  "contentHashMethod",
  "reviewStatus",
  "reviewReason",
  "reviewedAt",
  "reviewedByUserId",
  "reviewedByLabel",
  "metadata",
  "idempotencyKey",
  "supersedesDocumentId",
  "createdByUserId",
  "createdByLabel",
]);
const EVENT_KEYS = new Set([
  "eventType",
  "title",
  "claimSummary",
  "hypothesis",
  "expectedDirection",
  "effectiveStart",
  "effectiveEnd",
  "eventTimezone",
  "reviewStatus",
  "sourceReliabilityScore",
  "reviewReason",
  "reviewedAt",
  "reviewedByUserId",
  "reviewedByLabel",
  "intakeMethod",
  "metadata",
  "idempotencyKey",
  "supersedesEventId",
  "createdByUserId",
  "createdByLabel",
  "documents",
  "targets",
]);
const EVENT_DOCUMENT_KEYS = new Set(["documentRef", "evidenceRole"]);
const EVENT_TARGET_KEYS = new Set([
  "targetRole",
  "geographyScope",
  "state",
  "rto",
  "oem",
  "fuelGroup",
  "vehicleCategory",
]);

const DEFAULT_SERVICES = Object.freeze({
  createSource: createRtoFactorSource,
  createDocument: createRtoFactorDocument,
  createEvent: createRtoFactorEvent,
});

export async function main(argv = process.argv.slice(2), {
  env = process.env,
  readFile = fs.readFile,
  services = DEFAULT_SERVICES,
} = {}) {
  const args = parseArgs(argv);
  if (args.help) {
    printHelp();
    return null;
  }

  const inputPath = path.resolve(args.input);
  let input;
  try {
    input = JSON.parse(await readFile(inputPath, "utf8"));
  } catch (error) {
    if (error instanceof SyntaxError) {
      throw inputError(`Input is not valid JSON: ${error.message}`);
    }
    throw error;
  }

  const result = await importManualRtoFactorEvent(input, {
    write: args.write,
    actorLabel: args.actorLabel,
    env,
    services,
  });
  const summary = summarizeImportResult(result, inputPath);
  console.log(JSON.stringify(summary, null, 2));
  return result;
}

export async function importManualRtoFactorEvent(input, {
  write = false,
  actorLabel = DEFAULT_ACTOR_LABEL,
  env = process.env,
  services = DEFAULT_SERVICES,
} = {}) {
  const plan = compileManualRtoFactorEventInput(input, { actorLabel });
  if (!write) {
    return {
      mode: "dry-run",
      source: plan.preview.source,
      documents: plan.preview.documents,
      event: plan.preview.event,
      documentRefs: plan.documentRefs,
    };
  }

  assertWriteGate(env);
  assertServices(services);

  const source = await services.createSource(plan.sourceInput);
  const documents = [];
  const documentByRef = new Map();
  for (const item of plan.documentInputs) {
    const document = await services.createDocument({
      ...item.input,
      sourceId: source.id,
    });
    documents.push({ ref: item.ref, document });
    documentByRef.set(item.ref, document);
  }

  const event = await services.createEvent({
    ...plan.eventInput,
    documents: plan.eventDocumentLinks.map((link) => ({
      documentId: documentByRef.get(link.documentRef).id,
      evidenceRole: link.evidenceRole,
    })),
  });

  return {
    mode: "write",
    source,
    documents,
    event,
    documentRefs: plan.documentRefs,
  };
}

export function compileManualRtoFactorEventInput(input, {
  actorLabel = DEFAULT_ACTOR_LABEL,
} = {}) {
  const root = plainObject(input, "input");
  assertAllowedKeys(root, TOP_LEVEL_KEYS, "input");
  if (root.schemaVersion !== INPUT_SCHEMA_VERSION) {
    throw inputError(`schemaVersion must equal ${INPUT_SCHEMA_VERSION}`);
  }

  const normalizedActorLabel = boundedText(actorLabel, "actorLabel", 1, 200);
  const sourceObject = plainObject(root.source, "source");
  assertAllowedKeys(sourceObject, SOURCE_KEYS, "source");
  assertManualIntakeMethod(sourceObject.intakeMethod, "source.intakeMethod");
  const sourceInput = withCreationDefaults({
    ...sourceObject,
    intakeMethod: sourceObject.intakeMethod ?? "manual",
  }, normalizedActorLabel);
  const preparedSource = prepareRtoFactorSource(sourceInput);

  if (!Array.isArray(root.documents) || !root.documents.length) {
    throw inputError("documents must be a non-empty array");
  }
  const documentInputs = root.documents.map((value, index) => {
    const documentObject = plainObject(value, `documents[${index}]`);
    assertAllowedKeys(documentObject, DOCUMENT_KEYS, `documents[${index}]`);
    const ref = documentRef(documentObject.ref, `documents[${index}].ref`);
    const { ref: _ref, ...document } = documentObject;
    const documentInput = withReviewDefaults(
      withCreationDefaults(document, normalizedActorLabel),
      normalizedActorLabel,
      "reviewStatus",
    );
    return { ref, input: documentInput };
  });
  assertUnique(documentInputs.map((item) => item.ref), "document ref");

  const previewDocuments = documentInputs.map((item, index) => {
    const prepared = prepareRtoFactorDocument({
      ...item.input,
      sourceId: 1,
    });
    if (prepared.canonicalHost !== preparedSource.canonicalHost) {
      throw inputError(
        `Document "${item.ref}" host must exactly match source.canonicalHost ${preparedSource.canonicalHost}`,
      );
    }
    return { ref: item.ref, ...prepared };
  });
  const previewDocumentByRef = new Map(previewDocuments.map((item, index) => [
    item.ref,
    { ...item, previewId: index + 1 },
  ]));

  const eventObject = plainObject(root.event, "event");
  assertAllowedKeys(eventObject, EVENT_KEYS, "event");
  if (!Array.isArray(eventObject.documents) || !eventObject.documents.length) {
    throw inputError("event.documents must be a non-empty array");
  }
  if (!Array.isArray(eventObject.targets) || !eventObject.targets.length) {
    throw inputError("event.targets must be a non-empty array");
  }

  const eventDocumentLinks = eventObject.documents.map((value, index) => {
    const link = plainObject(value, `event.documents[${index}]`);
    assertAllowedKeys(link, EVENT_DOCUMENT_KEYS, `event.documents[${index}]`);
    const documentRefValue = documentRef(
      link.documentRef,
      `event.documents[${index}].documentRef`,
    );
    if (!previewDocumentByRef.has(documentRefValue)) {
      throw inputError(`event.documents[${index}] references unknown document "${documentRefValue}"`);
    }
    return {
      documentRef: documentRefValue,
      evidenceRole: link.evidenceRole ?? "primary",
    };
  });
  assertUnique(eventDocumentLinks.map((item) => item.documentRef), "event documentRef");
  const linkedRefs = new Set(eventDocumentLinks.map((item) => item.documentRef));
  const unlinkedRefs = documentInputs.map((item) => item.ref).filter((ref) => !linkedRefs.has(ref));
  if (unlinkedRefs.length) {
    throw inputError(`Every imported document must be linked by event.documents; missing: ${unlinkedRefs.join(", ")}`);
  }

  const targets = eventObject.targets.map((value, index) => {
    const target = plainObject(value, `event.targets[${index}]`);
    assertAllowedKeys(target, EVENT_TARGET_KEYS, `event.targets[${index}]`);
    return { ...target };
  });
  const {
    documents: _documents,
    targets: _targets,
    ...eventFields
  } = eventObject;
  assertManualIntakeMethod(eventFields.intakeMethod, "event.intakeMethod");
  const eventInput = withReviewDefaults(
    withCreationDefaults({
      ...eventFields,
      intakeMethod: eventFields.intakeMethod ?? "manual",
      targets,
    }, normalizedActorLabel),
    normalizedActorLabel,
    "reviewStatus",
  );

  const preparedEvent = prepareRtoFactorEvent({
    ...eventInput,
    documents: eventDocumentLinks.map((link) => ({
      documentId: previewDocumentByRef.get(link.documentRef).previewId,
      evidenceRole: link.evidenceRole,
    })),
  });
  assertEvidenceEligibility({
    source: preparedSource,
    documents: previewDocuments,
    event: preparedEvent,
    links: eventDocumentLinks,
  });

  return {
    schemaVersion: INPUT_SCHEMA_VERSION,
    actorLabel: normalizedActorLabel,
    sourceInput,
    documentInputs,
    eventInput,
    eventDocumentLinks,
    documentRefs: documentInputs.map((item) => item.ref),
    preview: {
      source: preparedSource,
      documents: previewDocuments,
      event: preparedEvent,
    },
  };
}

export function parseArgs(argv) {
  const args = {
    input: null,
    write: false,
    actorLabel: process.env.FACTOR_AGENT_MANUAL_ACTOR_LABEL || DEFAULT_ACTOR_LABEL,
    help: false,
  };
  let explicitMode = null;
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--input") {
      args.input = requiredNext(argv, ++index, "--input");
    } else if (arg === "--actor-label") {
      args.actorLabel = requiredNext(argv, ++index, "--actor-label");
    } else if (arg === "--write") {
      if (explicitMode === "dry-run") throw inputError("--write and --dry-run cannot be combined");
      explicitMode = "write";
      args.write = true;
    } else if (arg === "--dry-run") {
      if (explicitMode === "write") throw inputError("--write and --dry-run cannot be combined");
      explicitMode = "dry-run";
      args.write = false;
    } else if (arg === "--help" || arg === "-h") {
      args.help = true;
    } else {
      throw inputError(`Unknown argument: ${arg}`);
    }
  }
  if (!args.help && !args.input) throw inputError("--input is required");
  return args;
}

export function assertWriteGate(env = process.env) {
  if (String(env.FACTOR_AGENT_ENABLED ?? "").trim() !== "1") {
    throw inputError("Writes require FACTOR_AGENT_ENABLED=1");
  }
  if (String(env.FACTOR_AGENT_MODE ?? "").trim() !== "draft_only") {
    throw inputError("Writes require FACTOR_AGENT_MODE=draft_only");
  }
}

function assertEvidenceEligibility({ source, documents, event, links }) {
  if (!["eligible", "context_only"].includes(event.reviewStatus)) return;
  if (source.evidencePolicy !== "report_evidence" || !["A", "B"].includes(source.sourceTier)) {
    throw inputError("Eligible/context events require a Tier A/B report-evidence source");
  }
  const documentByRef = new Map(documents.map((document) => [document.ref, document]));
  const ineligible = links
    .filter((link) => link.evidenceRole !== "confounder")
    .filter((link) => documentByRef.get(link.documentRef)?.reviewStatus !== "approved")
    .map((link) => link.documentRef);
  if (ineligible.length) {
    throw inputError(
      `Eligible/context events require approved primary/corroborating documents; not approved: ${ineligible.join(", ")}`,
    );
  }
}

function withCreationDefaults(value, actorLabel) {
  return {
    ...value,
    createdByLabel: value.createdByLabel ?? actorLabel,
  };
}

function withReviewDefaults(value, actorLabel, statusKey) {
  const status = value[statusKey] ?? "pending";
  if (status === "pending") return value;
  return {
    ...value,
    reviewedByLabel: value.reviewedByLabel ?? actorLabel,
  };
}

function assertManualIntakeMethod(value, label) {
  if (value !== null && value !== undefined && value !== "manual") {
    throw inputError(`${label} must be manual for this CLI`);
  }
}

function summarizeImportResult(result, inputPath) {
  const source = result.source;
  const documents = result.mode === "write"
    ? result.documents.map((item) => ({ ref: item.ref, ...item.document }))
    : result.documents;
  return {
    mode: result.mode,
    input: inputPath,
    wroteToDatabase: result.mode === "write",
    source: {
      id: source.id ?? null,
      sourceKey: source.sourceKey,
      sourceTier: source.sourceTier,
      evidencePolicy: source.evidencePolicy,
      canonicalHost: source.canonicalHost,
      recordChecksum: source.recordChecksum,
    },
    documents: documents.map((document) => ({
      ref: document.ref,
      id: document.id ?? null,
      title: document.title,
      canonicalUrl: document.canonicalUrl,
      reviewStatus: document.reviewStatus,
      contentHash: document.contentHash,
      ...(result.mode === "write"
        ? { recordChecksum: document.recordChecksum }
        : { previewRecordChecksum: document.recordChecksum }),
    })),
    event: {
      id: result.event.id ?? null,
      title: result.event.title,
      eventType: result.event.eventType,
      effectiveStart: result.event.effectiveStart,
      effectiveEnd: result.event.effectiveEnd,
      reviewStatus: result.event.reviewStatus,
      ...(result.mode === "write"
        ? { eventChecksum: result.event.eventChecksum }
        : { previewEventChecksum: result.event.eventChecksum }),
      documentRefs: result.documentRefs,
      targetCount: result.event.targets?.length ?? 0,
    },
    nextStep: result.mode === "write"
      ? "Review the immutable intake records before running factor validation."
      : "No database writes occurred. Re-run with --write only after reviewing this plan.",
  };
}

function assertServices(services) {
  for (const key of ["createSource", "createDocument", "createEvent"]) {
    if (typeof services?.[key] !== "function") {
      throw new TypeError(`services.${key} must be a function`);
    }
  }
}

function assertAllowedKeys(value, allowed, label) {
  const unknown = Object.keys(value).filter((key) => !allowed.has(key));
  if (unknown.length) throw inputError(`${label} contains unknown field(s): ${unknown.join(", ")}`);
}

function plainObject(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw inputError(`${label} must be an object`);
  }
  return { ...value };
}

function documentRef(value, label) {
  const text = String(value ?? "").trim();
  if (!REF_PATTERN.test(text)) {
    throw inputError(`${label} must use lowercase letters, numbers, dot, underscore, or hyphen`);
  }
  return text;
}

function boundedText(value, label, min, max) {
  const text = String(value ?? "").trim();
  if (text.length < min || text.length > max) {
    throw inputError(`${label} must be between ${min} and ${max} characters`);
  }
  return text;
}

function assertUnique(values, label) {
  if (new Set(values).size !== values.length) throw inputError(`${label} values must be unique`);
}

function requiredNext(argv, index, flag) {
  const value = argv[index];
  if (!value || value.startsWith("--")) throw inputError(`${flag} requires a value`);
  return value;
}

function inputError(message) {
  const error = new Error(message);
  error.statusCode = 400;
  return error;
}

function printHelp() {
  console.log(`Usage:
  npm.cmd run rto-factor:event:import -- --input path.json [options]

Options:
  --input path.json       Required manual event intake file.
  --dry-run               Validate and preview only (default).
  --write                 Persist immutable source, document, and event records.
  --actor-label label     Audit label (default: manual-admin-cli).
  --help                  Show this help.

Write gate:
  FACTOR_AGENT_ENABLED=1 and FACTOR_AGENT_MODE=draft_only are both required.
`);
}

function isMainModule() {
  return Boolean(process.argv[1])
    && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;
}

if (isMainModule()) {
  main().catch(async (error) => {
    console.error(`[rto-factor:event:import] ${error.stack || error.message}`);
    process.exitCode = 1;
  }).finally(async () => {
    await closePool().catch(() => {});
  });
}
