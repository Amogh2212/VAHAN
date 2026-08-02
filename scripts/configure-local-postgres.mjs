import crypto from "node:crypto";
import { constants } from "node:fs";
import fs from "node:fs/promises";
import process from "node:process";

const ROLE = "vahan_app";
const DATABASE = "vahan_ey_local";

function setEnvValue(text, key, value) {
  const line = `${key}=${value}`;
  const pattern = new RegExp(`^${key}=.*$`, "m");
  if (pattern.test(text)) return text.replace(pattern, line);
  return `${text.replace(/\s*$/, "")}\n${line}\n`;
}

function existingLocalPassword(text) {
  const match = /^DATABASE_URL=(.*)$/m.exec(text);
  if (!match) return null;
  try {
    const url = new URL(match[1].trim());
    if (!["localhost", "127.0.0.1", "::1"].includes(url.hostname.toLowerCase())) return null;
    return decodeURIComponent(url.password) || null;
  } catch {
    return null;
  }
}

async function main() {
  const activeEnv = await fs.readFile(".env", "utf8");
  const previousLocalEnv = await fs.readFile(".env.local-postgres", "utf8").catch(() => "");
  const appPassword = existingLocalPassword(previousLocalEnv) || crypto.randomBytes(32).toString("base64url");
  const port = Number(process.env.LOCAL_POSTGRES_PORT_OVERRIDE || 5433);
  if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error("Invalid local PostgreSQL port.");

  await fs.copyFile(".env", ".env.cockroach.local", constants.COPYFILE_EXCL).catch((error) => {
    if (error.code !== "EEXIST") throw error;
  });

  const url = new URL(`postgresql://localhost:${port}/vahan_ey_local`);
  url.username = ROLE;
  url.password = appPassword;
  url.searchParams.set("sslmode", "disable");

  let localEnv = activeEnv;
  localEnv = setEnvValue(localEnv, "NODE_ENV", "development");
  localEnv = setEnvValue(localEnv, "PORT", "3000");
  localEnv = setEnvValue(localEnv, "DATABASE_URL", url.toString());
  localEnv = setEnvValue(localEnv, "PGSSL", "false");
  localEnv = setEnvValue(localEnv, "REQUIRE_DATABASE_FOR_READINESS", "1");
  localEnv = setEnvValue(localEnv, "BACKUP_DIR", "backups/postgres");
  localEnv = setEnvValue(localEnv, "BACKUP_RETENTION_DAYS", "14");
  const dataDirectory = process.env.LOCAL_POSTGRES_DATA_DIR_OVERRIDE || ".local/postgres/data";
  localEnv = setEnvValue(localEnv, "LOCAL_POSTGRES_DATA_DIR", dataDirectory);
  await fs.writeFile(".env.local-postgres", localEnv, { encoding: "utf8", mode: 0o600 });

  console.log(JSON.stringify({
    status: "configured",
    host: "localhost",
    port,
    database: DATABASE,
    role: ROLE,
    sourceEnv: ".env.cockroach.local",
    targetEnv: ".env.local-postgres",
  }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
