import { execFile, spawnSync, type ExecFileOptionsWithStringEncoding, type SpawnSyncOptionsWithStringEncoding } from "node:child_process";
import { createRequire } from "node:module";
import path from "node:path";

const projectRequire = createRequire(path.resolve(__dirname, "../../package.json"));
const tsxCli = projectRequire.resolve("tsx/cli");

function childProcessFailure(error: Error): string | number {
  if ("code" in error && (typeof error.code === "string" || typeof error.code === "number")) return error.code;
  return error.name;
}

export function runTsxSync(args: string[], options: SpawnSyncOptionsWithStringEncoding) {
  const result = spawnSync(process.execPath, [tsxCli, ...args], options);
  if (result.error) {
    const code = childProcessFailure(result.error);
    throw new Error(`Could not start the local TSX command (${code}).`);
  }
  if (result.status === null) {
    throw new Error(`The local TSX command did not exit normally (signal: ${result.signal ?? "unknown"}).`);
  }
  return result;
}

export function runTsx(args: string[], options: ExecFileOptionsWithStringEncoding): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    execFile(process.execPath, [tsxCli, ...args], options, (error, stdout, stderr) => {
      if (error) {
        const code = childProcessFailure(error);
        const detail = typeof code === "number" ? `exit code ${code}` : typeof code === "string" ? code : error.name;
        reject(new Error(`The local TSX command failed (${detail}).`));
        return;
      }
      resolve({ stdout, stderr });
    });
  });
}
