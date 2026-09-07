import net from "node:net";
import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { spawn } from "node:child_process";
import { writeTextExclusive } from "./artifacts.mjs";
import { FORBIDDEN_SCRIPT_PATTERNS, safeAuditEnvironment } from "./policy.mjs";

const MAX_CAPTURE_BYTES = 8 * 1024 * 1024;
const ALLOWED_EXTERNAL_EXECUTABLES = new Set(["graphify", "semgrep"]);

export async function runCatalogCommand(command, context) {
  const executable = command.executable === "node" ? process.execPath : command.executable;
  assertAllowedInvocation(executable, command.args, command.executable);
  return runProcess({
    ...command,
    executable,
    displayCommand: `${command.executable} ${command.args.join(" ")}`,
    environment: {
      ...safeAuditEnvironment(),
      GIT_CONFIG_COUNT: "1",
      GIT_CONFIG_KEY_0: "safe.directory",
      GIT_CONFIG_VALUE_0: context.repoRoot.replaceAll("\\", "/"),
      ...(context.environment ?? {}),
    },
  }, context);
}

export async function runNpmAudit(context) {
  const npmExecPath = await trustedNpmCli();
  if (!npmExecPath) {
    return skippedResult("npm-audit", "dependencies", "A trusted npm CLI next to the active Node runtime could not be resolved.");
  }
  const invocation = { executable: process.execPath, args: [npmExecPath, "audit", "--omit=dev", "--json"] };
  const result = await runProcess({
    id: "npm-audit",
    ...invocation,
    displayCommand: "npm audit --omit=dev --json",
    domain: "dependencies",
    timeoutMs: 180_000,
    deterministic: false,
    gate: false,
    successExitCodes: [0, 1],
    environment: safeAuditEnvironment(),
  }, context);
  return classifyNpmAuditResult(result);
}

export function classifyNpmAuditResult(result) {
  if (result.status !== "passed") return result;
  try {
    const payload = JSON.parse(result._capturedStdout);
    const valid = payload
      && typeof payload === "object"
      && payload.vulnerabilities
      && typeof payload.vulnerabilities === "object"
      && payload.metadata
      && typeof payload.metadata === "object";
    if (valid) return result;
  } catch {}
  result.status = "skipped";
  result.reason = "npm registry audit output was unavailable or invalid; dependency vulnerabilities were not verified.";
  return result;
}

export async function runSemgrep(context, { includeAuto = true } = {}) {
  const args = ["scan"];
  if (includeAuto) args.push("--config", "auto");
  args.push("--config", "audit/semgrep.yml", "--strict", "--json", ".");
  const result = await runProcess({
    id: "semgrep",
    executable: "semgrep",
    args,
    displayCommand: `semgrep ${args.join(" ")}`,
    domain: "security",
    timeoutMs: 300_000,
    deterministic: false,
    gate: false,
    environment: safeAuditEnvironment(),
    sanitizeForDisk: sanitizeSemgrepOutput,
  }, context);
  return classifySemgrepResult(result);
}

export function classifySemgrepResult(result) {
  if (result.status !== "passed") return result;
  if (result.stdoutTruncated || result.stderrTruncated) {
    result.status = "failed";
    result.reason = "Semgrep output exceeded the bounded capture limit; security coverage is incomplete.";
    return result;
  }
  try {
    const payload = JSON.parse(result._capturedStdout);
    const valid = payload
      && typeof payload === "object"
      && Array.isArray(payload.results)
      && Array.isArray(payload.errors);
    if (!valid) throw new Error("invalid Semgrep JSON shape");
    if (payload.errors.length > 0) {
      result.status = "failed";
      result.reason = `Semgrep reported ${payload.errors.length} scan error(s); results are incomplete.`;
    }
  } catch {
    result.status = "failed";
    result.reason = "Semgrep returned invalid JSON; security coverage was not verified.";
  }
  return result;
}

export async function runGraphifyQueries(context, queries) {
  const results = [];
  for (let index = 0; index < queries.length; index += 1) {
    results.push(await runProcess({
      id: `graphify-query-${String(index + 1).padStart(2, "0")}`,
      executable: "graphify",
      args: ["query", queries[index], "--budget", "1600"],
      displayCommand: `graphify query <architecture-question-${index + 1}> --budget 1600`,
      domain: "architecture",
      timeoutMs: 60_000,
      deterministic: false,
      gate: false,
      environment: safeAuditEnvironment(),
    }, context));
  }
  return results;
}

export async function runProcess(specification, { repoRoot, runDirectory, redactor }) {
  const startedAt = new Date();
  const startedNs = process.hrtime.bigint();
  const output = await spawnCaptured(specification, repoRoot);
  const durationMs = Number(process.hrtime.bigint() - startedNs) / 1_000_000;
  const safeId = specification.id.replace(/[^a-z0-9._-]+/gi, "-");
  const stdoutPath = `logs/${safeId}.stdout.log`;
  const stderrPath = `logs/${safeId}.stderr.log`;
  const diskOutput = specification.sanitizeForDisk ? specification.sanitizeForDisk(output) : output;
  await Promise.all([
    writeTextExclusive(runDirectory, stdoutPath, diskOutput.stdout, redactor),
    writeTextExclusive(runDirectory, stderrPath, diskOutput.stderr, redactor),
  ]);

  let status = "failed";
  let reason = null;
  if (output.spawnError?.code === "ENOENT") {
    status = "skipped";
    reason = "Required executable is unavailable.";
  } else if (output.timedOut) {
    status = "timed_out";
    reason = `Exceeded ${specification.timeoutMs} ms timeout.`;
  } else if ((specification.successExitCodes ?? [0]).includes(output.exitCode)) {
    status = "passed";
  } else if (output.spawnError) {
    reason = `Could not start command (${output.spawnError.code ?? "unknown error"}).`;
  }

  const result = {
    id: specification.id,
    domain: specification.domain,
    command: specification.displayCommand,
    deterministic: Boolean(specification.deterministic),
    gate: Boolean(specification.gate),
    status,
    exitCode: output.exitCode,
    signal: output.signal,
    startedAt: startedAt.toISOString(),
    durationMs: Math.round(durationMs),
    environmentMode: "isolated_no_credentials_no_database_no_live_vahan",
    stdoutLog: stdoutPath,
    stderrLog: stderrPath,
    stdoutTruncated: output.stdoutTruncated,
    stderrTruncated: output.stderrTruncated,
    reason,
  };
  Object.defineProperty(result, "_capturedStdout", { value: output.stdout, enumerable: false });
  Object.defineProperty(result, "_capturedStderr", { value: output.stderr, enumerable: false });
  return result;
}

export function skippedResult(id, domain, reason, deterministic = false) {
  return {
    id,
    domain,
    command: null,
    deterministic,
    gate: false,
    status: "skipped",
    exitCode: null,
    signal: null,
    startedAt: new Date().toISOString(),
    durationMs: 0,
    environmentMode: "not_started",
    stdoutLog: null,
    stderrLog: null,
    stdoutTruncated: false,
    stderrTruncated: false,
    reason,
  };
}

export async function findFreePortRange(size = 2) {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    const base = 34_000 + Math.floor(Math.random() * 20_000);
    const reservations = [];
    try {
      for (let offset = 0; offset < size; offset += 1) reservations.push(await reservePort(base + offset));
      await Promise.all(reservations.map(closeServer));
      return base;
    } catch {
      await Promise.all(reservations.map(closeServer));
    }
  }
  throw new Error("Unable to reserve a loopback port range for isolated checks.");
}

function spawnCaptured(specification, cwd) {
  return new Promise((resolve) => {
    const child = spawn(specification.executable, specification.args, {
      cwd,
      env: specification.environment,
      shell: false,
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
    const stdout = collector();
    const stderr = collector();
    let spawnError = null;
    let timedOut = false;
    let settled = false;
    child.stdout?.on("data", stdout.append);
    child.stderr?.on("data", stderr.append);
    child.on("error", (error) => { spawnError = error; });
    let timeout;
    let settlementWatchdog;
    const finish = (exitCode, signal) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      clearTimeout(settlementWatchdog);
      resolve({
        exitCode,
        signal,
        spawnError,
        timedOut,
        stdout: stdout.text(),
        stderr: stderr.text(),
        stdoutTruncated: stdout.truncated(),
        stderrTruncated: stderr.truncated(),
      });
    };
    timeout = setTimeout(() => {
      timedOut = true;
      terminateProcessTree(child);
      settlementWatchdog = setTimeout(() => finish(null, "AUDIT_TIMEOUT"), 5_000);
      settlementWatchdog.unref?.();
    }, specification.timeoutMs ?? 120_000);
    child.on("close", finish);
    child.on("error", () => setImmediate(() => finish(null, null)));
  });
}

function collector() {
  const chunks = [];
  let length = 0;
  let wasTruncated = false;
  return {
    append(chunk) {
      if (length >= MAX_CAPTURE_BYTES) {
        wasTruncated = true;
        return;
      }
      const buffer = Buffer.from(chunk);
      const remaining = MAX_CAPTURE_BYTES - length;
      chunks.push(buffer.subarray(0, remaining));
      length += Math.min(buffer.length, remaining);
      if (buffer.length > remaining) wasTruncated = true;
    },
    text() {
      const marker = wasTruncated ? "\n[AUDIT OUTPUT TRUNCATED]\n" : "";
      return `${Buffer.concat(chunks).toString("utf8")}${marker}`;
    },
    truncated: () => wasTruncated,
  };
}

function assertAllowedInvocation(executable, args, displayExecutable) {
  if (displayExecutable === "node") {
    if (executable !== process.execPath || args.length !== 1 || !/^scripts\/[A-Za-z0-9._-]+\.mjs$/.test(args[0])) {
      throw new Error("Rejected non-allowlisted Node audit command.");
    }
    if (FORBIDDEN_SCRIPT_PATTERNS.some((pattern) => pattern.test(args[0]))) {
      throw new Error(`Rejected prohibited audit command: ${args[0]}`);
    }
    return;
  }
  if (!ALLOWED_EXTERNAL_EXECUTABLES.has(displayExecutable)) throw new Error(`Rejected audit executable: ${displayExecutable}`);
}

function terminateProcessTree(child) {
  if (!child.pid || child.exitCode !== null) return;
  if (process.platform === "win32") {
    const systemRoot = process.env.SystemRoot || process.env.WINDIR || "C:\\Windows";
    const taskkill = path.join(systemRoot, "System32", "taskkill.exe");
    const killer = spawn(taskkill, ["/PID", String(child.pid), "/T", "/F"], {
      shell: false,
      windowsHide: true,
      stdio: "ignore",
      env: safeAuditEnvironment(),
    });
    killer.on("error", () => child.kill());
    killer.on("close", (code) => {
      if (code !== 0 && child.exitCode === null) child.kill();
    });
  } else {
    child.kill("SIGTERM");
    setTimeout(() => child.exitCode === null && child.kill("SIGKILL"), 2_000).unref();
  }
}

async function trustedNpmCli() {
  const candidates = [
    process.env.npm_execpath,
    path.join(path.dirname(process.execPath), "node_modules", "npm", "bin", "npm-cli.js"),
  ].filter(Boolean);
  const trustedRoot = `${path.resolve(path.dirname(process.execPath))}${path.sep}`.toLowerCase();
  for (const candidate of candidates) {
    try {
      const resolved = await fs.realpath(candidate);
      const stat = await fs.lstat(resolved);
      if (stat.isFile()
        && path.basename(resolved).toLowerCase() === "npm-cli.js"
        && resolved.toLowerCase().startsWith(trustedRoot)) return resolved;
    } catch {}
  }
  return null;
}

function sanitizeSemgrepOutput(output) {
  let stdout = "Semgrep JSON was invalid; raw scanner output was withheld.\n";
  try {
    const payload = JSON.parse(output.stdout);
    const sanitized = {
      version: typeof payload.version === "string" ? payload.version : null,
      results: Array.isArray(payload.results) ? payload.results.map((item) => ({
        check_id: String(item?.check_id ?? "unknown"),
        path: String(item?.path ?? "unknown"),
        start: { line: Number(item?.start?.line) || null },
        end: { line: Number(item?.end?.line) || null },
        severity: String(item?.extra?.severity ?? "unknown"),
      })) : [],
      errors: Array.isArray(payload.errors) ? payload.errors.map((item) => ({
        type: String(item?.type ?? item?.code ?? "scanner_error"),
      })) : [],
      outputTruncated: Boolean(output.stdoutTruncated || output.stderrTruncated),
    };
    stdout = `${JSON.stringify(sanitized, null, 2)}\n`;
  } catch {}
  const stderr = output.stderr
    ? "Semgrep emitted diagnostics; raw diagnostic text was withheld to prevent matched-source disclosure.\n"
    : "";
  return { stdout, stderr };
}

function reservePort(port) {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.unref();
    server.once("error", reject);
    server.listen({ host: "127.0.0.1", port, exclusive: true }, () => resolve(server));
  });
}

function closeServer(server) {
  return new Promise((resolve) => server?.close(resolve));
}
