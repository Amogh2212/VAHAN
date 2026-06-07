import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { spawnSync } from "node:child_process";

const roots = ["server.mjs", "lib", "scripts"];
const files = [];

async function collect(target) {
  const stat = await fs.stat(target).catch(() => null);
  if (!stat) return;
  if (stat.isDirectory()) {
    const entries = await fs.readdir(target, { withFileTypes: true });
    for (const entry of entries) {
      await collect(path.join(target, entry.name));
    }
    return;
  }
  if (target.endsWith(".mjs")) files.push(target);
}

for (const root of roots) {
  await collect(root);
}

files.sort((a, b) => a.localeCompare(b));

let failed = false;
for (const file of files) {
  const result = spawnSync(process.execPath, ["--check", file], {
    encoding: "utf8",
  });
  if (result.status !== 0) {
    failed = true;
    console.error(`Syntax check failed: ${file}`);
    if (result.stdout) console.error(result.stdout.trim());
    if (result.stderr) console.error(result.stderr.trim());
  }
}

if (failed) {
  process.exitCode = 1;
} else {
  console.log(`Syntax check passed for ${files.length} module file(s).`);
}
