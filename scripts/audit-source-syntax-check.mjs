import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { execFileSync, spawnSync } from "node:child_process";
import { isSourceLike, normalizeRepoPath } from "../lib/audit/policy.mjs";

const repoRoot = process.cwd();
const gitSafeDirectory = repoRoot.replaceAll("\\", "/");
const files = execFileSync("git", ["-c", `safe.directory=${gitSafeDirectory}`, "ls-files", "-co", "--exclude-standard", "-z"], {
  cwd: repoRoot,
  encoding: "utf8",
  maxBuffer: 16 * 1024 * 1024,
})
  .split("\0")
  .filter(Boolean)
  .map(normalizeRepoPath)
  .filter(isSourceLike)
  .filter((file) => [".cjs", ".js", ".mjs"].includes(path.posix.extname(file).toLowerCase()))
  .filter((file) => {
    const stat = fs.lstatSync(path.join(repoRoot, file));
    return stat.isFile() && !stat.isSymbolicLink();
  })
  .sort((left, right) => left.localeCompare(right));

let failed = false;
for (const file of files) {
  const result = spawnSync(process.execPath, ["--check", file], { cwd: repoRoot, encoding: "utf8", windowsHide: true });
  if (result.status === 0) continue;
  failed = true;
  console.error(`Syntax check failed: ${file}`);
  if (result.stdout) console.error(result.stdout.trim());
  if (result.stderr) console.error(result.stderr.trim());
}

if (failed) {
  process.exitCode = 1;
} else {
  console.log(`Audit syntax check passed for ${files.length} JavaScript module(s).`);
}
