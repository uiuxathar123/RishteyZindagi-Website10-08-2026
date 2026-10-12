/**
 * Git-readiness: the secret scanner used by the pre-commit hook and before zipping an export.
 * Real `git` is used in a throw-away temp repository (never the project folder).
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";
import { execFileSync } from "child_process";
import { forbiddenFileLabel, localSecretValues, scanFiles, walk } from "../scripts/lib/secret-scan";
import { runTsxSync } from "./helpers/run-tsx";

const ROOT = path.resolve(__dirname, "..");
const LIVE = "rzp_" + "live_" + "AbCdEf123456";
const PRIV = "-----BEGIN " + "RSA PRIVATE KEY-----";
const MY_SECRET = "my-very-private-local-value-9f3a";

let dir: string;
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "rz-scan-"));
});
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));
const write = (rel: string, text: string) => {
  fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
  fs.writeFileSync(path.join(dir, rel), text);
};

describe("secret scanner", () => {
  it("[scan-forbidden-files] .env, keys, dumps, logs, archives and local data are flagged; the *.example templates are not", () => {
    for (const f of [".env", ".env.local", ".env.test", "certs/site.pem", "a/b/tls.key", "db.dump", "backup.dump.gpg", "x.sql.gz", "run.log", "export.zip", ".storage-local/invoices/a.pdf", "backups/x", "service-account-prod.json", "id_rsa"]) {
      expect(forbiddenFileLabel(f), f).not.toBeNull();
    }
    for (const f of [".env.example", ".env.test.example", "src/app/page.tsx", "package.json", "LOCAL_SETUP.md", "tests/helpers/presign-ref.py"]) {
      expect(forbiddenFileLabel(f), f).toBeNull();
    }
  });

  it("[scan-patterns-and-local-values] live-credential patterns and values from the local .env are found, and the report never contains the secret", () => {
    write("src/a.ts", `const k = "${LIVE}";\n`);
    write("src/b.ts", `${PRIV}\nabc\n`);
    write("src/c.ts", `const pw = "${MY_SECRET}";\n`);
    write("src/ok.ts", "export const x = 1;\n");
    const values = localSecretValues(`AUTH_SECRET="${MY_SECRET}"\nNODE_ENV=development\nAPI_KEY=short\nDATABASE_URL="postgresql://u:dbpass-123456@localhost/x"\n`);
    expect(values).toContain(MY_SECRET);
    expect(values).toContain("dbpass-123456");
    expect(values).not.toContain("short");
    const findings = scanFiles(dir, walk(dir), values, new Set());
    const byFile = (f: string) => findings.filter((x) => x.file === f).map((x) => x.kind);
    expect(byFile("src/a.ts")).toEqual(["pattern"]);
    expect(byFile("src/b.ts")).toEqual(["pattern"]);
    expect(byFile("src/c.ts")).toEqual(["local-secret-value"]);
    expect(byFile("src/ok.ts")).toEqual([]);
    const report = JSON.stringify(findings);
    for (const s of [LIVE, MY_SECRET, "dbpass-123456", "AbCdEf123456"]) expect(report).not.toContain(s);
  });

  it("[scan-allowlist] a listed harmless fixture is skipped; a forbidden file is reported without reading it", () => {
    write("tests/x.test.ts", 'const s = "test-only-secret";\n');
    expect(scanFiles(dir, ["tests/x.test.ts"], ["test-only-secret"], new Set(["test-only-secret"]))).toEqual([]);
    write(".env", `K=${MY_SECRET}\n`);
    const f = scanFiles(dir, [".env"], [MY_SECRET], new Set());
    expect(f).toEqual([{ file: ".env", kind: "forbidden-file", label: expect.any(String) }]);
  });

  it("[scan-staged-cli] with real git: a staged .env or live key blocks the commit hook (exit 1); clean staged files pass (exit 0)", () => {
    const git = (...a: string[]) => execFileSync("git", a, { cwd: dir, stdio: "pipe" });
    git("init", "-q");
    git("config", "user.email", "t@example.com");
    git("config", "user.name", "t");
    const run = () => runTsxSync([path.join(ROOT, "scripts/scan-secrets.ts"), "--staged"], { cwd: dir, encoding: "utf8", env: process.env });
    write("src/ok.ts", "export const x = 1;\n");
    git("add", "src/ok.ts");
    expect(run().status).toBe(0);
    write(".env", "A=1\n");
    git("add", "-f", ".env");
    write("src/leak.ts", `const k = "${LIVE}";\n`);
    git("add", "src/leak.ts");
    const bad = run();
    expect(bad.status).toBe(1);
    expect(bad.stderr).toMatch(/\.env/);
    expect(bad.stderr).toMatch(/leak\.ts/);
    expect(bad.stderr + bad.stdout).not.toContain(LIVE);
  }, 60_000);

  it("[scan-project-gitignore] the project's .gitignore ignores everything the scanner forbids", () => {
    const text = fs.readFileSync(path.join(ROOT, ".gitignore"), "utf8");
    for (const must of [".env", ".env.*", "!.env.example", "!.env.test.example", "*.pem", "*.key", "*.dump", "*.gpg", "*.log", "*.zip", ".storage-local/", "node_modules/", ".next/", "*.tsbuildinfo"]) {
      expect(text.split(/\r?\n/), must).toContain(must);
    }
  });
});
