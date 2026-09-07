import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { promisify } from "node:util";
import { execFile } from "node:child_process";
import {
  AUDIT_SCHEMA_VERSION,
  isExcludedPath,
  isGeneratedPath,
  isRealEnvironmentFile,
  isSourceLike,
  normalizeRepoPath,
  safeAuditEnvironment,
} from "./policy.mjs";

const execFileAsync = promisify(execFile);

export async function buildManifest({ repoRoot, baselineRef = "HEAD" }) {
  const [head, branch, baselineCommit, trackedOutput, untrackedOutput, statusOutput, packageJson, workflowNames, environmentPaths] = await Promise.all([
    git(repoRoot, ["rev-parse", "HEAD"]),
    git(repoRoot, ["branch", "--show-current"]),
    git(repoRoot, ["rev-parse", "--verify", "--end-of-options", `${baselineRef}^{commit}`]),
    git(repoRoot, ["ls-files", "-z"]),
    git(repoRoot, ["ls-files", "--others", "--exclude-standard", "-z"]),
    git(repoRoot, ["status", "--porcelain=v1", "-z", "--untracked-files=all"]),
    readJsonIfPresent(path.join(repoRoot, "package.json")),
    listFilesIfPresent(path.join(repoRoot, ".github", "workflows")),
    listRootEnvironmentFiles(repoRoot),
  ]);

  const tracked = splitNul(trackedOutput).map(normalizeRepoPath);
  const untracked = splitNul(untrackedOutput).map(normalizeRepoPath);
  const status = parsePorcelainZ(statusOutput);
  const statusByPath = new Map(status.map((entry) => [entry.path, entry]));
  const included = [...new Set([...tracked, ...untracked].filter(isSourceLike))].sort(comparePaths);
  const files = [];
  for (const file of included) {
    const hashed = await hashStableFile(repoRoot, file, "sha256");
    files.push({
      path: file,
      sourceState: tracked.includes(file) ? (statusByPath.has(file) ? "pre_existing_modified" : "committed") : "source_like_untracked",
      gitStatus: statusByPath.get(file)?.code ?? null,
      ...hashed,
    });
  }
  const dirtyPathMetadata = [];
  for (const file of [...new Set(status.flatMap((entry) => [entry.path, entry.originalPath]).filter(Boolean))].sort(comparePaths)) {
    dirtyPathMetadata.push(await statPathMetadata(repoRoot, file));
  }

  const generatedArtifacts = status.filter((entry) => isGeneratedPath(entry.path));
  const suspiciousFiles = [...new Set([
    ...tracked.filter(isRealEnvironmentFile),
    ...untracked.filter(isRealEnvironmentFile),
    ...status.filter((entry) => isRealEnvironmentFile(entry.path)).map((entry) => entry.path),
    ...environmentPaths,
  ])].sort(comparePaths);
  const unclassifiedFiles = status
    .filter((entry) => !isSourceLike(entry.path) && !isGeneratedPath(entry.path) && !isRealEnvironmentFile(entry.path))
    .map((entry) => ({ path: entry.path, code: entry.code }))
    .sort((left, right) => comparePaths(left.path, right.path));

  const graphify = await inspectGraphify({ repoRoot, head: head.trim(), files });
  const tools = await inspectTools(repoRoot);
  const checks = Object.entries(packageJson?.scripts ?? {})
    .filter(([name]) => name === "test" || name.startsWith("check:"))
    .map(([name, command]) => ({ name, command }))
    .sort((left, right) => left.name.localeCompare(right.name));

  return {
    schemaVersion: AUDIT_SCHEMA_VERSION,
    kind: "vahan-ey-audit-manifest",
    generatedAt: new Date().toISOString(),
    repository: {
      head: head.trim(),
      branch: branch.trim() || null,
      baselineRef,
      baselineCommit: baselineCommit.trim(),
      dirty: status.length > 0,
    },
    boundaries: {
      includedSourceCount: files.length,
      committedSourceCount: files.filter((file) => file.sourceState === "committed").length,
      preExistingModifiedSourceCount: files.filter((file) => file.sourceState === "pre_existing_modified").length,
      sourceLikeUntrackedCount: files.filter((file) => file.sourceState === "source_like_untracked").length,
      generatedArtifactCount: generatedArtifacts.length,
      suspiciousFileCount: suspiciousFiles.length,
      unclassifiedFileCount: unclassifiedFiles.length,
      excludedPolicy: "Generated/runtime directories and real environment files are classified without reading or hashing their contents.",
    },
    gitStatus: status,
    dirtyPathMetadata,
    files,
    generatedArtifacts,
    suspiciousFiles,
    unclassifiedFiles,
    tools,
    graphify,
    inventory: {
      checks,
      workflows: workflowNames.sort(comparePaths),
      nodeEngine: packageJson?.engines?.node ?? null,
    },
  };
}

export async function captureWorktreeState(repoRoot, sourceFiles = [], monitoredPaths = []) {
  const [head, status] = await Promise.all([
    git(repoRoot, ["rev-parse", "HEAD"]),
    git(repoRoot, ["status", "--porcelain=v1", "-z", "--untracked-files=all"]),
  ]);
  const paths = [...new Set(sourceFiles.map((item) => normalizeRepoPath(typeof item === "string" ? item : item.path)).filter(Boolean))]
    .sort(comparePaths);
  const parsedStatus = parsePorcelainZ(status);
  const files = [];
  for (const file of paths) files.push({ path: file, ...await hashStableFile(repoRoot, file, "sha256") });
  const metadataPaths = [...new Set([
    ...monitoredPaths.map((item) => normalizeRepoPath(typeof item === "string" ? item : item.path)),
    ...parsedStatus.flatMap((entry) => [entry.path, entry.originalPath]).filter(Boolean),
  ])].sort(comparePaths);
  const pathMetadata = [];
  for (const file of metadataPaths) pathMetadata.push(await statPathMetadata(repoRoot, file));
  return { capturedAt: new Date().toISOString(), head: head.trim(), status: parsedStatus, files, pathMetadata };
}

export function worktreeDrift(startManifest, endState) {
  const before = JSON.stringify(startManifest.gitStatus);
  const after = JSON.stringify(endState.status);
  const startingFiles = new Map((startManifest.files ?? []).map((item) => [item.path, `${item.hashStatus}:${item.hash}`]));
  const endingFiles = new Map((endState.files ?? []).map((item) => [item.path, `${item.hashStatus}:${item.hash}`]));
  const contentChangedPaths = [...startingFiles]
    .filter(([file, fingerprint]) => endingFiles.get(file) !== fingerprint)
    .map(([file]) => file)
    .sort(comparePaths);
  const startingMetadata = new Map((startManifest.dirtyPathMetadata ?? []).map((item) => [item.path, metadataFingerprint(item)]));
  const endingMetadata = new Map((endState.pathMetadata ?? []).map((item) => [item.path, metadataFingerprint(item)]));
  const metadataChangedPaths = [...startingMetadata]
    .filter(([file, fingerprint]) => endingMetadata.get(file) !== fingerprint)
    .map(([file]) => file)
    .sort(comparePaths);
  return {
    headChanged: startManifest.repository.head !== endState.head,
    statusChanged: before !== after,
    contentChangedPaths,
    contentChanged: contentChangedPaths.length > 0,
    metadataChangedPaths,
    metadataChanged: metadataChangedPaths.length > 0,
    changedDuringAudit: startManifest.repository.head !== endState.head
      || before !== after
      || contentChangedPaths.length > 0
      || metadataChangedPaths.length > 0,
  };
}

export async function changedPathsFromBaseline(repoRoot, baselineCommit) {
  validateCommitSha(baselineCommit);
  const [trackedChanges, untracked] = await Promise.all([
    git(repoRoot, ["diff", "--name-only", "-z", "--end-of-options", baselineCommit, "--"]),
    git(repoRoot, ["ls-files", "--others", "--exclude-standard", "-z"]),
  ]);
  return new Set([...splitNul(trackedChanges), ...splitNul(untracked)].map(normalizeRepoPath));
}

export function validateCommitSha(value) {
  if (!/^[0-9a-f]{40}$/i.test(String(value ?? ""))) throw new Error("Expected a full 40-character Git commit SHA.");
  return value;
}

async function inspectGraphify({ repoRoot, head, files }) {
  const reportPath = path.join(repoRoot, "graphify-out", "GRAPH_REPORT.md");
  const manifestPath = path.join(repoRoot, "graphify-out", "manifest.json");
  const [report, rawManifest] = await Promise.all([
    fs.readFile(reportPath, "utf8").catch(() => null),
    readJsonIfPresent(manifestPath),
  ]);
  if (!report || !rawManifest) {
    return { status: "unavailable", fresh: false, reason: "Graphify report or manifest is missing." };
  }
  const builtCommit = report.match(/Built from commit:\s*`([^`]+)`/i)?.[1] ?? null;
  const entries = [];
  for (const [absoluteFile, metadata] of Object.entries(rawManifest)) {
    const relative = normalizeRepoPath(path.relative(repoRoot, absoluteFile));
    if (relative.startsWith("../") || isExcludedPath(relative)) continue;
    const hashed = await hashStableFile(repoRoot, relative, "md5");
    entries.push({ path: relative, expectedHash: metadata?.hash ?? null, actualHash: hashed.hash ?? null, matches: metadata?.hash === hashed.hash });
  }
  entries.sort((left, right) => comparePaths(left.path, right.path));
  const covered = new Set(entries.map((entry) => entry.path.toLowerCase()));
  // Graphify intentionally omits some committed/unsupported files. Freshness
  // must still catch every source-like file newly introduced after HEAD,
  // including files already staged and therefore absent from `git ls-files
  // --others`. Existing committed omissions are tool coverage, not drift.
  const graphCandidates = graphifyIntroducedCandidates(files);
  const missingCandidates = graphCandidates.filter((file) => !covered.has(file.toLowerCase())).sort(comparePaths);
  const mismatchedEntries = entries.filter((entry) => !entry.matches);
  const commitMatches = Boolean(builtCommit) && head.toLowerCase().startsWith(builtCommit.toLowerCase());
  return {
    status: "verified",
    fresh: commitMatches && mismatchedEntries.length === 0 && missingCandidates.length === 0,
    builtCommit,
    headCommit: head,
    commitMatches,
    manifestEntryCount: entries.length,
    mismatchedEntries,
    missingCandidates,
    note: "Freshness compares the build commit, current file hashes, and newly included graph candidates; commit equality alone is insufficient for a dirty checkout.",
  };
}

export function graphifyIntroducedCandidates(files) {
  return files
    .filter((file) => isGraphCandidate(file.path)
      && (file.sourceState === "source_like_untracked" || /A/.test(file.gitStatus ?? "")))
    .map((file) => file.path)
    .sort(comparePaths);
}

async function inspectTools(repoRoot) {
  const npmExecPath = process.env.npm_execpath;
  const results = await Promise.all([
    toolVersion("node", process.execPath, ["--version"], repoRoot),
    npmExecPath ? toolVersion("npm", process.execPath, [npmExecPath, "--version"], repoRoot) : Promise.resolve({ name: "npm", status: "unavailable", reason: "Run through npm to record its version." }),
    toolVersion("git", "git", ["--version"], repoRoot),
    toolVersion("graphify", "graphify", ["--help"], repoRoot, firstLineMatching(/Usage:/i)),
    toolVersion("semgrep", "semgrep", ["--version"], repoRoot),
  ]);
  return Object.fromEntries(results.map((result) => [result.name, result]));
}

async function toolVersion(name, executable, args, cwd, select = firstNonemptyLine) {
  try {
    const { stdout, stderr } = await execFileAsync(executable, args, {
      cwd,
      encoding: "utf8",
      timeout: 15_000,
      windowsHide: true,
      maxBuffer: 1024 * 1024,
      env: safeAuditEnvironment(),
    });
    return { name, status: "available", version: select(`${stdout}\n${stderr}`) };
  } catch (error) {
    return { name, status: "unavailable", reason: error.code === "ENOENT" ? "Executable not found." : `Version check failed with ${error.code ?? "unknown error"}.` };
  }
}

async function hashStableFile(repoRoot, relative, algorithm) {
  const absolute = path.resolve(repoRoot, relative);
  if (!isContained(repoRoot, absolute)) return { hash: null, size: null, hashStatus: "outside_repository" };
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const before = await fs.lstat(absolute).catch(() => null);
    if (!before) return { hash: null, size: null, hashStatus: "missing" };
    if (before.isSymbolicLink() || !before.isFile()) return { hash: null, size: before.size, hashStatus: "not_regular_file" };
    const content = await fs.readFile(absolute);
    const after = await fs.lstat(absolute).catch(() => null);
    if (after && before.size === after.size && before.mtimeMs === after.mtimeMs) {
      return { hash: crypto.createHash(algorithm).update(content).digest("hex"), size: after.size, hashStatus: "stable" };
    }
  }
  return { hash: null, size: null, hashStatus: "changed_during_hash" };
}

async function statPathMetadata(repoRoot, relative) {
  const normalized = normalizeRepoPath(relative);
  const absolute = path.resolve(repoRoot, normalized);
  if (!isContained(repoRoot, absolute)) return { path: normalized, status: "outside_repository" };
  const stat = await fs.lstat(absolute).catch((error) => error.code === "ENOENT" ? null : Promise.reject(error));
  if (!stat) return { path: normalized, status: "missing" };
  return {
    path: normalized,
    status: "present",
    kind: stat.isSymbolicLink() ? "symbolic_link" : stat.isFile() ? "file" : stat.isDirectory() ? "directory" : "other",
    size: stat.size,
    mtimeMs: Math.trunc(stat.mtimeMs),
    ctimeMs: Math.trunc(stat.ctimeMs),
  };
}

function metadataFingerprint(item) {
  return JSON.stringify({ status: item.status, kind: item.kind, size: item.size, mtimeMs: item.mtimeMs, ctimeMs: item.ctimeMs });
}

async function git(repoRoot, args) {
  const { stdout } = await execFileAsync("git", ["-c", `safe.directory=${repoRoot.replaceAll("\\", "/")}`, ...args], {
    cwd: repoRoot,
    encoding: "utf8",
    timeout: 30_000,
    windowsHide: true,
    maxBuffer: 32 * 1024 * 1024,
    env: safeAuditEnvironment(),
  });
  return stdout;
}

function parsePorcelainZ(output) {
  const records = splitNul(output);
  const entries = [];
  for (let index = 0; index < records.length; index += 1) {
    const record = records[index];
    const code = record.slice(0, 2);
    const file = normalizeRepoPath(record.slice(3));
    const entry = { code, path: file };
    if (/[RC]/.test(code) && records[index + 1]) entry.originalPath = normalizeRepoPath(records[++index]);
    entries.push(entry);
  }
  return entries.sort((left, right) => comparePaths(left.path, right.path));
}

function splitNul(output) {
  return String(output ?? "").split("\0").filter(Boolean);
}

function isGraphCandidate(file) {
  return file === "server.mjs"
    || /^(lib|routes|scripts)\/.*\.(?:c?js|mjs|md|ps1|py)$/i.test(file)
    || /^db\/.*\.sql$/i.test(file)
    || /^public\/.*\.(?:html|js)$/i.test(file);
}

function isContained(root, target) {
  const resolvedRoot = path.resolve(root);
  const resolvedTarget = path.resolve(target);
  return resolvedTarget.toLowerCase() === resolvedRoot.toLowerCase()
    || resolvedTarget.toLowerCase().startsWith(`${resolvedRoot}${path.sep}`.toLowerCase());
}

async function readJsonIfPresent(file) {
  try {
    return JSON.parse(await fs.readFile(file, "utf8"));
  } catch {
    return null;
  }
}

async function listFilesIfPresent(directory) {
  try {
    return (await fs.readdir(directory, { withFileTypes: true })).filter((entry) => entry.isFile()).map((entry) => normalizeRepoPath(path.join(".github/workflows", entry.name)));
  } catch {
    return [];
  }
}

async function listRootEnvironmentFiles(repoRoot) {
  try {
    const entries = await fs.readdir(repoRoot, { withFileTypes: true });
    return entries
      .filter((entry) => entry.isFile() && isRealEnvironmentFile(entry.name))
      .map((entry) => normalizeRepoPath(entry.name))
      .sort(comparePaths);
  } catch {
    return [];
  }
}

function firstNonemptyLine(text) {
  return text.split(/\r?\n/).map((line) => line.trim()).find(Boolean) ?? "unknown";
}

function firstLineMatching(pattern) {
  return (text) => text.split(/\r?\n/).map((line) => line.trim()).find((line) => pattern.test(line)) ?? firstNonemptyLine(text);
}

function comparePaths(left, right) {
  return left.localeCompare(right, "en", { sensitivity: "base" });
}
