import process from "node:process";
import { pathToFileURL } from "node:url";

const REQUIRED_MODEL = "qwen3:4b";
const DEFAULT_BASE_URL = "http://127.0.0.1:11434";
const DEFAULT_TIMEOUT_MS = 10_000;
const LOCAL_HOSTS = new Set(["127.0.0.1", "localhost", "::1"]);

function configError(message) {
  const error = new Error(message);
  error.code = "OLLAMA_CONFIG";
  return error;
}

export function configuredOllama({ env = process.env } = {}) {
  const rawBaseUrl = String(env.OLLAMA_BASE_URL ?? DEFAULT_BASE_URL).trim() || DEFAULT_BASE_URL;
  let url;
  try {
    url = new URL(rawBaseUrl);
  } catch {
    throw configError(`OLLAMA_BASE_URL must be a valid local HTTP URL; received ${JSON.stringify(rawBaseUrl)}.`);
  }

  const hostname = url.hostname.replace(/^\[|\]$/g, "").toLowerCase();
  if (url.protocol !== "http:" || !LOCAL_HOSTS.has(hostname) || url.username || url.password || url.pathname !== "/" || url.search || url.hash) {
    throw configError("OLLAMA_BASE_URL must use an http loopback endpoint such as http://127.0.0.1:11434.");
  }

  const rawTimeout = String(env.OLLAMA_TIMEOUT_MS ?? DEFAULT_TIMEOUT_MS).trim();
  const parsedTimeout = Number(rawTimeout);
  if (!Number.isInteger(parsedTimeout) || parsedTimeout < 1) {
    throw configError("OLLAMA_TIMEOUT_MS must be a positive whole number of milliseconds.");
  }

  return {
    baseUrl: url.origin,
    timeoutMs: Math.min(parsedTimeout, DEFAULT_TIMEOUT_MS),
  };
}

export function hasRequiredModel(payload) {
  if (!Array.isArray(payload?.models)) return false;
  return payload.models.some((model) => {
    return [model?.name, model?.model].some((value) => String(value ?? "").trim().toLowerCase() === REQUIRED_MODEL);
  });
}

async function fetchModelCatalog({ baseUrl, timeoutMs, fetchImpl = fetch }) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(new URL("/api/tags", baseUrl), {
      method: "GET",
      headers: { accept: "application/json" },
      signal: controller.signal,
    });
    if (!response.ok) throw new Error(`Ollama returned HTTP ${response.status} from /api/tags.`);
    const payload = await response.json().catch(() => null);
    if (!Array.isArray(payload?.models)) throw new Error("Ollama returned an invalid model catalog from /api/tags.");
    return payload;
  } catch (error) {
    if (controller.signal.aborted) throw new Error(`Timed out after ${timeoutMs}ms while connecting to Ollama.`);
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

function nextSteps(log) {
  log("Next steps:");
  log("  1. Install or start Ollama manually: https://docs.ollama.com/windows");
  log(`  2. In a new PowerShell window, run: ollama pull ${REQUIRED_MODEL}`);
  log("  3. Rerun: node scripts/check-ollama.mjs");
}

export async function main({ env = process.env, fetchImpl = fetch, log = console.log, errorLog = console.error } = {}) {
  let config;
  try {
    config = configuredOllama({ env });
  } catch (error) {
    errorLog(`Ollama check cannot run: ${error.message}`);
    errorLog("Set OLLAMA_BASE_URL to the local default: http://127.0.0.1:11434.");
    return 1;
  }

  let catalog;
  try {
    catalog = await fetchModelCatalog({ ...config, fetchImpl });
  } catch (error) {
    errorLog(`Ollama is not ready at ${config.baseUrl}: ${error.message}`);
    nextSteps(errorLog);
    return 1;
  }

  if (!hasRequiredModel(catalog)) {
    errorLog(`Ollama is running at ${config.baseUrl}, but ${REQUIRED_MODEL} is not installed.`);
    nextSteps(errorLog);
    return 1;
  }

  log(`Ollama is ready at ${config.baseUrl}; ${REQUIRED_MODEL} is installed.`);
  log("This check used only GET /api/tags; it did not run a model, download anything, or change configuration.");
  log("To enable Vahan locally, set AI_QUERY_PROVIDER=ollama and/or FACTOR_AGENT_PROVIDER=ollama in your ignored .env.");
  return 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const exitCode = await main();
  if (exitCode !== 0) process.exitCode = exitCode;
}
