import crypto from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

export async function createRunDirectory({ outputBase, repoRoot, head = "unknown" }) {
  const base = path.resolve(repoRoot, outputBase);
  await assertSafeOutputBase(base, repoRoot);
  await fs.mkdir(base, { recursive: true });
  await assertNoLinkComponents(base);
  await assertResolvedOutputBoundary(base, repoRoot);
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const suffix = crypto.randomBytes(3).toString("hex");
  const runId = `${timestamp}-${String(head).slice(0, 8)}-${suffix}`;
  const runDirectory = path.join(base, runId);
  await fs.mkdir(runDirectory);
  await Promise.all([
    fs.mkdir(path.join(runDirectory, "logs")),
    fs.mkdir(path.join(runDirectory, "screenshots")),
  ]);
  await assertNoLinkComponents(runDirectory);
  return { base, runDirectory, runId };
}

export async function writeJsonExclusive(runDirectory, relativePath, value, redactor) {
  const sanitized = redactor.redactObject(value);
  await writeTextExclusive(runDirectory, relativePath, `${JSON.stringify(sanitized, null, 2)}\n`, redactor, false);
}

export async function writeTextExclusive(runDirectory, relativePath, value, redactor, sanitize = true) {
  const destination = containedPath(runDirectory, relativePath);
  await fs.mkdir(path.dirname(destination), { recursive: true });
  await assertContainedRealParent(runDirectory, path.dirname(destination));
  const text = sanitize ? redactor.redactText(value) : String(value);
  const handle = await fs.open(destination, "wx");
  try {
    await handle.writeFile(text, "utf8");
  } finally {
    await handle.close();
  }
  return destination;
}

export async function copyBinaryExclusive(runDirectory, relativePath, source, maximumBytes = 20 * 1024 * 1024) {
  const sourceStat = await fs.lstat(source);
  if (!sourceStat.isFile() || sourceStat.isSymbolicLink() || sourceStat.size > maximumBytes) {
    throw new Error(`Unsafe or oversized binary artifact: ${source}`);
  }
  const destination = containedPath(runDirectory, relativePath);
  await fs.mkdir(path.dirname(destination), { recursive: true });
  await assertContainedRealParent(runDirectory, path.dirname(destination));
  const content = await fs.readFile(source);
  const handle = await fs.open(destination, "wx");
  try {
    await handle.writeFile(content);
  } finally {
    await handle.close();
  }
  return destination;
}

export async function readJson(file) {
  const stat = await fs.lstat(file);
  if (!stat.isFile() || stat.isSymbolicLink()) throw new Error(`Expected a regular JSON artifact: ${file}`);
  return JSON.parse(await fs.readFile(file, "utf8"));
}

export function relativeArtifact(runDirectory, file) {
  return path.relative(runDirectory, file).replaceAll("\\", "/");
}

export function containedPath(root, relativePath) {
  if (path.isAbsolute(relativePath)) throw new Error("Artifact paths must be relative to the run directory.");
  const resolvedRoot = path.resolve(root);
  const resolved = path.resolve(resolvedRoot, relativePath);
  const prefix = `${resolvedRoot}${path.sep}`.toLowerCase();
  if (resolved.toLowerCase() !== resolvedRoot.toLowerCase() && !resolved.toLowerCase().startsWith(prefix)) {
    throw new Error(`Artifact path escapes the run directory: ${relativePath}`);
  }
  return resolved;
}

async function assertSafeOutputBase(base, repoRoot) {
  const resolved = path.resolve(base);
  const root = path.parse(resolved).root;
  const forbidden = [root, path.resolve(repoRoot), path.resolve(os.homedir())];
  if (forbidden.some((target) => target.toLowerCase() === resolved.toLowerCase())) {
    throw new Error(`Refusing unsafe audit output directory: ${resolved}`);
  }
  const relative = path.relative(path.resolve(repoRoot), resolved);
  const insideRepository = relative && !relative.startsWith("..") && !path.isAbsolute(relative);
  if (insideRepository && relative.split(path.sep)[0].toLowerCase() !== "audit-output") {
    throw new Error("Repository-local audit output must stay under audit-output/; use an absolute external directory otherwise.");
  }
  await assertNoLinkComponents(base);
}

async function assertResolvedOutputBoundary(base, repoRoot) {
  const resolvedBase = await fs.realpath(base);
  const lexicalRelative = path.relative(path.resolve(repoRoot), path.resolve(base));
  const insideRepository = lexicalRelative && !lexicalRelative.startsWith("..") && !path.isAbsolute(lexicalRelative);
  if (!insideRepository) return;
  const realRepo = await fs.realpath(repoRoot);
  const realAuditRoot = path.join(realRepo, "audit-output");
  if (!isContained(realAuditRoot, resolvedBase)) throw new Error("Audit output resolved outside the repository audit-output boundary.");
}

async function assertContainedRealParent(root, parent) {
  await assertNoLinkComponents(parent, root);
  const [realRoot, realParent] = await Promise.all([fs.realpath(root), fs.realpath(parent)]);
  if (!isContained(realRoot, realParent)) throw new Error("Artifact parent resolves outside the run directory.");
}

async function assertNoLinkComponents(target, trustedRoot = path.parse(path.resolve(target)).root) {
  const resolvedTarget = path.resolve(target);
  const resolvedRoot = path.resolve(trustedRoot);
  if (!isContained(resolvedRoot, resolvedTarget)) throw new Error("Path lies outside its trusted root.");
  const relative = path.relative(resolvedRoot, resolvedTarget);
  let cursor = resolvedRoot;
  for (const segment of relative.split(path.sep).filter(Boolean)) {
    cursor = path.join(cursor, segment);
    const stat = await fs.lstat(cursor).catch((error) => error.code === "ENOENT" ? null : Promise.reject(error));
    if (!stat) break;
    if (stat.isSymbolicLink()) throw new Error(`Refusing symbolic-link or junction path component: ${cursor}`);
  }
}

function isContained(root, target) {
  const resolvedRoot = path.resolve(root);
  const resolvedTarget = path.resolve(target);
  const prefix = resolvedRoot.endsWith(path.sep) ? resolvedRoot : `${resolvedRoot}${path.sep}`;
  return resolvedTarget.toLowerCase() === resolvedRoot.toLowerCase()
    || resolvedTarget.toLowerCase().startsWith(prefix.toLowerCase());
}
