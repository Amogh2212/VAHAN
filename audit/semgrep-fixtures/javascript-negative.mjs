import { execFile } from "node:child_process";
import fs from "node:fs/promises";

export function runServerOwnedCommand() {
  execFile(process.execPath, ["scripts/safe-task.mjs", "--mode", "fixture"]);
}

export function readServerOwnedFile() {
  void fs.readFile("static/index.html");
}
