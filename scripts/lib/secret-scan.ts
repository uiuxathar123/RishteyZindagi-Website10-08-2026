/**
 * Pure secret-scanning logic shared by `scripts/scan-secrets.ts` (CLI / pre-commit hook) and its test.
 * Findings NEVER contain the matched text — only the file, a label and (for local-value matches) a length —
 * so the scanner's own output can be pasted into a ticket or log safely.
 */
import fs from "fs";
import path from "path";

export interface Finding {
  file: string;
  kind: "forbidden-file" | "pattern" | "local-secret-value";
  label: string;
}

/** Files that must never be committed or shipped in an archive. Examples/templates are allowed. */
const FORBIDDEN_FILE_RULES: Array<[string, RegExp]> = [
  ["environment file (.env / .env.*)", /(^|\/)\.env(\.[^/]+)?$/],
  ["private key / certificate store", /\.(pem|key|p12|pfx|keystore|jks)$/i],
  ["SSH key", /(^|\/)id_(rsa|ed25519|ecdsa)(\.pub)?$/],
  ["database dump / backup", /\.(dump|sql\.gz|gpg|bak)$/i],
  ["backup passphrase file", /\.pass(phrase)?$/i],
  ["cloud credentials file", /(^|\/)(credentials[^/]*|service-account[^/]*)\.json$/i],
  ["local runtime data", /(^|\/)(\.storage-local|backups|secrets|pgdata|postgres-data)\//],
  ["archive / export", /\.(zip|tar|tgz|tar\.gz)$/i],
  ["log file", /\.log$/i],
];
const ALLOWED_FILES = /(^|\/)\.env(\.test)?\.example$/;

export const CONTENT_PATTERNS: Array<[string, RegExp]> = [
  ["Razorpay LIVE key", /rzp_live_[A-Za-z0-9]{8,}/],
  ["private key block", /-----BEGIN (RSA |EC |OPENSSH |DSA |ENCRYPTED )?PRIVATE KEY-----/],
  ["AWS access key id", /AKIA[0-9A-Z]{16}/],
  ["Stripe-style live key", /sk_live_[A-Za-z0-9]{10,}/],
  ["Slack token", /xox[baprs]-[A-Za-z0-9-]{10,}/],
  ["Google API key", /AIza[0-9A-Za-z_-]{35}/],
  ["GitHub token", /gh[pousr]_[A-Za-z0-9]{30,}/],
  ["Razorpay TEST key id with a secret next to it", /rzp_test_[A-Za-z0-9]{10,}[\s\S]{0,80}(key_?secret|secret)["':= ]+[A-Za-z0-9]{20,}/i],
];

export function forbiddenFileLabel(relPath: string): string | null {
  const p = relPath.replace(/\\/g, "/");
  if (ALLOWED_FILES.test(p)) return null;
  for (const [label, re] of FORBIDDEN_FILE_RULES) if (re.test(p)) return label;
  return null;
}

/** Secret-looking values of a local env file (never returned to callers except for in-memory matching). */
export function localSecretValues(envText: string): string[] {
  const out = new Set<string>();
  for (const raw of envText.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const m = /^([A-Z0-9_]+)\s*=\s*(.*)$/.exec(line);
    if (!m) continue;
    const [, name] = m;
    let value = m[2].trim().replace(/^["']|["']$/g, "");
    if (!/(SECRET|PASS|PASSWORD|KEY|TOKEN|PRIVATE|DATABASE_URL|SALT)/.test(name)) continue;
    if (name.endsWith("DATABASE_URL")) {
      const pw = /:\/\/[^:@/]+:([^@]+)@/.exec(value);
      value = pw ? decodeURIComponent(pw[1]) : "";
    }
    if (value.length >= 8 && !/^(change-me|your-|<|xxx|placeholder|replace)/i.test(value)) out.add(value);
  }
  return [...out];
}

export function loadAllowlist(file: string): Set<string> {
  if (!fs.existsSync(file)) return new Set();
  return new Set(
    fs
      .readFileSync(file, "utf8")
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter((l) => l && !l.startsWith("#"))
  );
}

const MAX_BYTES = 2 * 1024 * 1024;

export function scanFile(root: string, relPath: string, localValues: string[], allow: Set<string>): Finding[] {
  const findings: Finding[] = [];
  const label = forbiddenFileLabel(relPath);
  if (label) {
    findings.push({ file: relPath, kind: "forbidden-file", label });
    return findings; // never read the contents of a file that should not be here at all
  }
  const abs = path.join(root, relPath);
  let stat: fs.Stats;
  try {
    stat = fs.statSync(abs);
  } catch {
    return findings; // deleted in the index
  }
  if (!stat.isFile() || stat.size > MAX_BYTES) return findings;
  const buf = fs.readFileSync(abs);
  if (buf.includes(0)) return findings; // binary
  const text = buf.toString("utf8");
  for (const [name, re] of CONTENT_PATTERNS) if (re.test(text)) findings.push({ file: relPath, kind: "pattern", label: name });
  for (const v of localValues) {
    if (allow.has(v)) continue;
    if (text.includes(v)) findings.push({ file: relPath, kind: "local-secret-value", label: `a value from your local .env (${v.length} characters)` });
  }
  return findings;
}

const SKIP_DIRS = new Set(["node_modules", ".next", ".git", "coverage"]);

/** Every file under `dir` (used to scan a staging folder before it is zipped). */
export function walk(dir: string, rel = ""): string[] {
  const out: string[] = [];
  for (const e of fs.readdirSync(path.join(dir, rel), { withFileTypes: true })) {
    if (SKIP_DIRS.has(e.name)) continue;
    const r = rel ? `${rel}/${e.name}` : e.name;
    if (e.isDirectory()) out.push(...walk(dir, r));
    else out.push(r);
  }
  return out;
}

export function scanFiles(root: string, files: string[], localValues: string[], allow: Set<string>): Finding[] {
  const self = new Set(["scripts/lib/secret-scan.ts", "scripts/scan-secrets.ts", "tests/pcp-security.test.ts", "tests/secret-scan.test.ts"]);
  return files.filter((f) => !self.has(f.replace(/\\/g, "/"))).flatMap((f) => scanFile(root, f, localValues, allow));
}
