import { execFile, execFileSync, spawn } from "node:child_process";
import fs from "node:fs/promises";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export function executeFromRequestBody(request) {
  // audit-expect: vahan-request-input-to-process-execution
  execFile(process.execPath, [request.body.script]);
  // audit-expect: vahan-request-input-to-process-execution
  execFileSync(process.execPath, [request.body.syncScript]);
}

export async function executeFromParsedBody(request) {
  const body = await readBody(request);
  // audit-expect: vahan-request-input-to-process-execution
  await execFileAsync(process.execPath, [body.script]);
  // audit-expect: vahan-request-input-to-file-path
  await fs.rm(body.outputPath, { recursive: true });
}

export function useContextBody(context) {
  // audit-expect: vahan-request-input-to-process-execution
  spawn(process.execPath, [context.body.script]);
  // audit-expect: vahan-request-input-to-file-path
  void fs.writeFile(context.body.outputPath, "fixture");
}

export function readRequestPath(request) {
  const url = new URL(request.url, "https://app.invalid");
  // audit-expect: vahan-request-input-to-file-path
  void fs.readFile(url.pathname);
}
