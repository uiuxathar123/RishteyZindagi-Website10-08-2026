#!/usr/bin/env -S npx tsx
/**
 * Secret scan for Git and archives. Prints file names and labels only — never the matched text.
 *
 *   npm run scan:secrets                       # every tracked + not-ignored file of the Git repo in the current directory
 *   npm run scan:secrets -- --staged           # only what is staged for commit (what the pre-commit hook runs)
 *   npm run scan:secrets -- --dir <folder>     # every file in a folder (use on an export folder BEFORE zipping it)
 *
 * It flags: files that must not be committed (.env, keys, dumps, logs, archives…), live-credential patterns,
 * and — when a local .env / .env.test exists — any file that contains one of YOUR real secret values.
 * Known harmless fixtures can be listed (one literal per line) in `.secretscan-allow`.
 * Exit code 1 when anything is found.
 */
import fs from "fs";
import path from "path";
import { execFileSync } from "child_process";
import { loadAllowlist, localSecretValues, scanFiles, walk } from "./lib/secret-scan";

const argv = process.argv.slice(2);
const flag = (n: string) => argv.includes(n);
const arg = (n: string) => {
  const i = argv.indexOf(n);
  return i >= 0 ? argv[i + 1] : undefined;
};

function git(args: string[]): string[] {
  try {
    return execFileSync("git", args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).split("\n").filter(Boolean);
  } catch {
    console.error("scan-secrets: this directory is not a Git repository (or git is missing). Use --dir <folder> to scan a folder.");
    process.exit(2);
  }
}

const dirArg = arg("--dir");
const root = path.resolve(dirArg ?? process.cwd());
let files: string[];
if (dirArg) files = walk(root);
else if (flag("--staged")) files = git(["diff", "--cached", "--name-only", "--diff-filter=ACMR"]);
else files = [...git(["ls-files"]), ...git(["ls-files", "--others", "--exclude-standard"])];

// Local secret values come from the developer's own (ignored) env files in the project directory — never from the scanned folder.
const projectRoot = process.cwd();
let localValues: string[] = [];
for (const f of [".env", ".env.test", ".env.local"]) {
  const p = path.join(projectRoot, f);
  if (fs.existsSync(p)) localValues.push(...localSecretValues(fs.readFileSync(p, "utf8")));
}
localValues = [...new Set(localValues)];
const allow = loadAllowlist(path.join(projectRoot, ".secretscan-allow"));

const findings = scanFiles(root, files, localValues, allow);
if (findings.length === 0) {
  console.log(`secret scan: OK — ${files.length} file(s) checked, nothing found.`);
  process.exit(0);
}
console.error(`secret scan: ${findings.length} problem(s) in ${files.length} file(s) checked (matched text is never printed):\n`);
for (const f of findings) console.error(`  [${f.kind}] ${f.file} — ${f.label}`);
console.error("\nRemove the secret / file (and rotate the credential if it was ever shared), then try again.");
process.exit(1);
