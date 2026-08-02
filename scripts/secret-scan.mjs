import fs from "node:fs";
import { execFileSync } from "node:child_process";

const patterns = [
  { name: "AWS access key", regex: /\bAKIA[0-9A-Z]{16}\b/g },
  { name: "Google API key", regex: /\bAIza[0-9A-Za-z_-]{20,}\b/g },
  { name: "GitHub token", regex: /\bgh[pousr]_[A-Za-z0-9]{20,}\b/g },
  { name: "OpenAI key", regex: /\bsk-(?:proj-)?[A-Za-z0-9_-]{16,}\b/g },
  {
    name: "Database password URL",
    regex: /postgres(?:ql)?:\/\/[^:\s/]+:[^@\s]+@/gi,
    allow: (match) => /YOUR_PASSWORD|REPLACE_ME|CHANGE_ME|PASSWORD_HERE/i.test(match),
  },
];
const allowedFiles = new Set([".env.example", ".env.cockroach.test.example"]);
const files = execFileSync("git", ["ls-files", "-co", "--exclude-standard"], {
  encoding: "utf8",
})
  .split(/\r?\n/)
  .filter(Boolean)
  .filter((file) => !file.startsWith("graphify-out/"))
  .filter((file) => !file.startsWith("reports/"))
  .filter((file) => !file.startsWith("data/"))
  .filter((file) => fs.existsSync(file) && fs.statSync(file).isFile());

const findings = [];
for (const file of files) {
  if (allowedFiles.has(file)) continue;
  let text;
  try {
    text = fs.readFileSync(file, "utf8");
  } catch {
    continue;
  }
  for (const pattern of patterns) {
    pattern.regex.lastIndex = 0;
    const unsafeMatch = [...text.matchAll(pattern.regex)].find((match) => !pattern.allow?.(match[0]));
    if (unsafeMatch) findings.push(`${file}: ${pattern.name}`);
  }
}

const trackedEnvFiles = execFileSync("git", ["ls-files"], { encoding: "utf8" })
  .split(/\r?\n/)
  .filter((file) => /(^|\/)\.env(?:\.|$)/.test(file))
  .filter((file) => !allowedFiles.has(file));
for (const file of trackedEnvFiles) findings.push(`${file}: tracked environment file`);

if (findings.length) {
  console.error(`Secret scan failed:\n${findings.map((item) => `- ${item}`).join("\n")}`);
  process.exitCode = 1;
} else {
  console.log(`Secret scan passed for ${files.length} source file(s).`);
}
