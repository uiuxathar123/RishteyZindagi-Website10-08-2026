/**
 * Production Completion Phase section J — encrypted backup, off-box transport, restore verification.
 *
 * These tests RUN the real shell scripts against the real PostgreSQL test database:
 * dump -> gpg AES-256 -> checksum -> (dir | S3-compatible) copy -> restore into a throwaway DB.
 * The S3 leg talks to a local moto server (skipped, never "passed", if moto is not installed).
 * No real off-box infrastructure is contacted: OFF-BOX BACKUP IS NOT VERIFIED against a real bucket.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { spawn, spawnSync, type ChildProcess } from "child_process";
import fs from "fs";
import os from "os";
import net from "net";
import path from "path";
import { runTsxSync } from "./helpers/run-tsx";

const ROOT = path.resolve(__dirname, "..");
const DB_URL = process.env.DATABASE_URL as string;
const ADMIN_URL = DB_URL.replace(/\/[^/?]+(\?|$)/, "/postgres$1");
const DB_PASSWORD = decodeURIComponent(/\/\/[^:]+:([^@]*)@/.exec(DB_URL)?.[1] ?? "");
const hasTools = ["pg_dump", "pg_restore", "psql", "gpg"].every((t) => spawnSync("which", [t]).status === 0);
const hasMoto = spawnSync("which", ["moto_server"]).status === 0;

let work: string;
let passFile: string;

function sh(script: string, args: string[], env: Record<string, string> = {}) {
  const r = spawnSync("bash", [path.join(ROOT, "scripts", script), ...args], {
    encoding: "utf8",
    env: { PATH: process.env.PATH as string, HOME: process.env.HOME as string, DATABASE_URL: DB_URL, ...env } as unknown as NodeJS.ProcessEnv,
    timeout: 120_000,
  });
  return { code: r.status, out: (r.stdout ?? "") + (r.stderr ?? "") };
}
const backupEnv = (over: Record<string, string> = {}) => ({ BACKUP_DIR: path.join(work, "bk"), BACKUP_PASSPHRASE_FILE: passFile, ...over });
const listBk = () => (fs.existsSync(path.join(work, "bk")) ? fs.readdirSync(path.join(work, "bk")).sort() : []);
const encrypted = () => listBk().find((f) => f.endsWith(".dump.gpg"))!;
function scratchDbs() {
  const r = spawnSync("psql", [ADMIN_URL, "-Atc", "SELECT datname FROM pg_database WHERE datname LIKE 'rz_verify_%'"], { encoding: "utf8" });
  return r.stdout.trim().split("\n").filter(Boolean);
}

beforeAll(() => {
  work = fs.mkdtempSync(path.join(os.tmpdir(), "rz-backup-test-"));
  passFile = path.join(work, "pass");
  fs.writeFileSync(passFile, "correct-horse-battery-staple-0123", { mode: 0o600 });
});
afterAll(() => {
  fs.rmSync(work, { recursive: true, force: true });
});
beforeEach(() => {
  fs.rmSync(path.join(work, "bk"), { recursive: true, force: true });
});

describe.skipIf(!hasTools)("encrypted backup (scripts/backup-secure.sh)", () => {
  it("[bk-refuses-unsafe-config] no passphrase file / loose permissions / unencrypted without explicit override -> exit 3 and nothing written", () => {
    expect(sh("backup-secure.sh", [], { BACKUP_DIR: path.join(work, "bk") }).code).toBe(3);
    const loose = path.join(work, "loose");
    fs.writeFileSync(loose, "correct-horse-battery-staple-0123", { mode: 0o644 });
    expect(sh("backup-secure.sh", [], backupEnv({ BACKUP_PASSPHRASE_FILE: loose })).code).toBe(3);
    const short = path.join(work, "short");
    fs.writeFileSync(short, "tooshort", { mode: 0o600 });
    expect(sh("backup-secure.sh", [], backupEnv({ BACKUP_PASSPHRASE_FILE: short })).code).toBe(3);
    expect(sh("backup-secure.sh", [], { BACKUP_DIR: path.join(work, "bk"), BACKUP_ENCRYPTION: "none" }).code).toBe(3);
    expect(sh("backup-secure.sh", [], backupEnv({ BACKUP_OFFSITE: "dir", BACKUP_OFFSITE_DIR: "/nonexistent-dir-xyz" })).code).toBe(3);
    expect(listBk().filter((f) => f.startsWith("rishteyzindagi_"))).toEqual([]);
  });

  it("[bk-encrypted-artifact] produces .dump.gpg + .sha256, leaves no plaintext, contains no secret, and says off-box is NOT configured", () => {
    const r = sh("backup-secure.sh", [], backupEnv());
    expect(r.code, r.out).toBe(0);
    expect(r.out).toContain("OFFSITE: NOT CONFIGURED");
    const files = listBk();
    const enc = encrypted();
    expect(enc).toBeTruthy();
    expect(files).toContain(enc + ".sha256");
    expect(files.filter((f) => f.endsWith(".dump") || f.startsWith(".plain"))).toEqual([]);
    const bytes = fs.readFileSync(path.join(work, "bk", enc));
    expect(bytes.subarray(0, 5).toString("latin1")).not.toBe("PGDMP"); // not a bare pg_dump archive
    expect(bytes.includes(Buffer.from("rishteyzindagi"))).toBe(false); // table/db names are not readable
    expect(r.out).not.toContain(DB_PASSWORD);
    expect(r.out).not.toContain("correct-horse");
    for (const f of files) {
      if (f.endsWith(".sha256")) expect(fs.readFileSync(path.join(work, "bk", f), "utf8")).not.toContain(DB_PASSWORD);
    }
    expect((fs.statSync(path.join(work, "bk", enc)).mode & 0o077)).toBe(0); // owner-only
  });

  it("[bk-bookkeeping] a row is recorded in the existing backups table", () => {
    const r = sh("backup-secure.sh", [], backupEnv());
    expect(r.code, r.out).toBe(0);
    const q = spawnSync("psql", [DB_URL, "-Atc", `SELECT status FROM backups WHERE filename = '${encrypted()}'`], { encoding: "utf8" });
    expect(q.stdout.trim()).toBe("COMPLETED");
  });

  it("[bk-local-retention] keeps the newest 7 plus up to 4 Sunday copies, removes the rest (and their checksums), ignores unrelated files", () => {
    const dir = path.join(work, "bk");
    fs.mkdirSync(dir, { recursive: true });
    const stamps: string[] = [];
    // 20 days of fake backups ending yesterday
    for (let i = 1; i <= 20; i++) {
      const d = new Date(Date.now() - i * 86400_000);
      stamps.push(d.toISOString().slice(0, 10).replace(/-/g, "") + "T020000Z");
    }
    for (const s of stamps) {
      fs.writeFileSync(path.join(dir, `rishteyzindagi_x_${s}.dump.gpg`), "x");
      fs.writeFileSync(path.join(dir, `rishteyzindagi_x_${s}.dump.gpg.sha256`), "x");
    }
    fs.writeFileSync(path.join(dir, "notes.txt"), "keep me");
    const r = sh("backup-secure.sh", [], backupEnv());
    expect(r.code, r.out).toBe(0);
    const left = listBk().filter((f) => f.endsWith(".dump.gpg"));
    const sundays = stamps.filter((s) => new Date(s.slice(0, 4) + "-" + s.slice(4, 6) + "-" + s.slice(6, 8) + "T00:00:00Z").getUTCDay() === 0);
    // the fresh backup + 6 newest fakes make the 7; remaining Sundays (max 4) survive
    expect(left.length).toBeGreaterThanOrEqual(7);
    expect(left.length).toBeLessThanOrEqual(7 + 4);
    expect(left.length).toBeLessThan(21);
    expect(listBk()).toContain("notes.txt");
    for (const f of left) expect(listBk()).toContain(f + ".sha256");
    expect(sundays.length).toBeGreaterThan(0);
  });
});

describe.skipIf(!hasTools)("restore verification (scripts/verify-restore.sh)", () => {
  it("[bk-restore-verified] an encrypted backup is decrypted, restored into a throwaway database, sanity-checked, and the scratch DB is dropped", () => {
    expect(sh("backup-secure.sh", [], backupEnv()).code).toBe(0);
    const before = scratchDbs();
    const v = sh("verify-restore.sh", [path.join(work, "bk", encrypted())], { VERIFY_ADMIN_DATABASE_URL: ADMIN_URL, BACKUP_PASSPHRASE_FILE: passFile });
    expect(v.code, v.out).toBe(0);
    expect(v.out).toContain("checksum OK");
    expect(v.out).toContain("VERIFIED");
    expect(v.out).toContain("scratch database dropped");
    expect(scratchDbs()).toEqual(before);
  });

  it("[bk-restore-rejects-tamper] a modified backup fails the checksum; a wrong passphrase fails decryption; a non-archive fails; none leaves a scratch DB", () => {
    expect(sh("backup-secure.sh", [], backupEnv()).code).toBe(0);
    const file = path.join(work, "bk", encrypted());
    const env = { VERIFY_ADMIN_DATABASE_URL: ADMIN_URL, BACKUP_PASSPHRASE_FILE: passFile };

    const wrong = path.join(work, "wrong");
    fs.writeFileSync(wrong, "a-completely-different-passphrase", { mode: 0o600 });
    const w = sh("verify-restore.sh", [file], { ...env, BACKUP_PASSPHRASE_FILE: wrong });
    expect(w.code).toBe(1);
    expect(w.out).toContain("decryption failed");

    const copy = path.join(work, "tampered.dump.gpg");
    const buf = fs.readFileSync(file);
    buf[buf.length - 10] ^= 0xff;
    fs.writeFileSync(copy, buf);
    fs.copyFileSync(file + ".sha256", copy + ".sha256"); // sha256 line names the original file -> mismatch/unreadable either way
    fs.writeFileSync(copy + ".sha256", fs.readFileSync(file + ".sha256", "utf8").replace(/ .*$/m, `  tampered.dump.gpg`));
    const t = sh("verify-restore.sh", [copy], env);
    expect(t.code).toBe(1);
    expect(t.out).toContain("checksum mismatch");

    const junk = path.join(work, "junk.dump");
    fs.writeFileSync(junk, "this is not a postgres archive");
    const j = sh("verify-restore.sh", [junk], env);
    expect(j.code).toBe(1);
    expect(scratchDbs()).toEqual([]);
  });

  it("[bk-restore-config-errors] missing admin URL or missing file -> exit 3", () => {
    expect(sh("verify-restore.sh", [path.join(work, "nope")], { VERIFY_ADMIN_DATABASE_URL: ADMIN_URL }).code).toBe(3);
    expect(sh("verify-restore.sh", [passFile], {}).code).toBe(3);
  });
});

describe.skipIf(!hasTools)("off-box destinations", () => {
  it("[bk-offsite-dir] BACKUP_OFFSITE=dir copies the encrypted backup + checksum and verifies it at the destination", () => {
    const dest = path.join(work, "remote");
    fs.mkdirSync(dest, { recursive: true });
    const r = sh("backup-secure.sh", [], backupEnv({ BACKUP_OFFSITE: "dir", BACKUP_OFFSITE_DIR: dest }));
    expect(r.code, r.out).toBe(0);
    expect(r.out).toContain("COPIED to directory");
    expect(fs.readdirSync(dest).sort()).toEqual([encrypted(), encrypted() + ".sha256"].sort());
    // the off-box copy is independently restorable
    const v = sh("verify-restore.sh", [path.join(dest, encrypted())], { VERIFY_ADMIN_DATABASE_URL: ADMIN_URL, BACKUP_PASSPHRASE_FILE: passFile });
    expect(v.code, v.out).toBe(0);
    fs.rmSync(dest, { recursive: true, force: true });
  });

  it("[bk-offsite-failure-is-loud] a failing off-box copy -> exit 2, local backup kept, run explicitly NOT off-box protected", () => {
    const dest = path.join(work, "remote-fail");
    fs.mkdirSync(dest, { recursive: true });
    // `cp` that always fails stands in for an unreachable / full / read-only destination (works for root too)
    const shim = path.join(work, "shim");
    fs.mkdirSync(shim, { recursive: true });
    fs.writeFileSync(path.join(shim, "cp"), "#!/bin/sh\nexit 1\n", { mode: 0o755 });
    const r = sh("backup-secure.sh", [], backupEnv({ BACKUP_OFFSITE: "dir", BACKUP_OFFSITE_DIR: dest, PATH: `${shim}:${process.env.PATH}` }));
    expect(r.code, r.out).toBe(2);
    expect(r.out).toContain("OFFSITE: FAILED");
    expect(r.out).toContain("NOT off-box protected");
    expect(encrypted()).toBeTruthy();
    expect(fs.readdirSync(dest)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
const PORT = 45878;
function waitForPort(port: number, timeoutMs = 20000): Promise<void> {
  const start = Date.now();
  return new Promise((resolve, reject) => {
    const tryOnce = () => {
      const s = net.connect(port, "127.0.0.1");
      s.once("connect", () => {
        s.destroy();
        resolve();
      });
      s.once("error", () => {
        s.destroy();
        if (Date.now() - start > timeoutMs) reject(new Error("moto did not start"));
        else setTimeout(tryOnce, 200);
      });
    };
    tryOnce();
  });
}

describe.skipIf(!hasMoto || !hasTools)("off-box S3-compatible destination (moto)", () => {
  let moto: ChildProcess;
  let s3env: Record<string, string>;

  beforeAll(async () => {
    moto = spawn("moto_server", ["-p", String(PORT)], { env: { ...process.env, INITIAL_NO_AUTH_ACTION_COUNT: "3" }, stdio: "ignore" });
    await waitForPort(PORT);
    const out = spawnSync("python3", [path.resolve(__dirname, "helpers/moto-bootstrap.py"), String(PORT), "rz-backups"], { encoding: "utf8" });
    if (out.status !== 0) throw new Error("moto bootstrap failed: " + out.stderr);
    const [id, secret] = out.stdout.trim().split(" ");
    s3env = {
      BACKUP_OFFSITE: "s3",
      BACKUP_S3_BUCKET: "rz-backups",
      BACKUP_S3_REGION: "us-east-1",
      BACKUP_S3_ENDPOINT: `http://127.0.0.1:${PORT}`,
      BACKUP_S3_FORCE_PATH_STYLE: "true",
      BACKUP_S3_ACCESS_KEY_ID: id,
      BACKUP_S3_SECRET_ACCESS_KEY: secret,
      BACKUP_S3_PREFIX: "db-backups/",
    };
  }, 60000);
  afterAll(() => {
    moto?.kill();
  });

  const tsx = (args: string[], env: Record<string, string>) => {
    const r = runTsxSync(["scripts/backup-offsite.ts", ...args], {
      cwd: ROOT,
      encoding: "utf8",
      env: { PATH: process.env.PATH as string, HOME: process.env.HOME as string, ...env } as unknown as NodeJS.ProcessEnv,
      timeout: 120_000,
    });
    return { code: r.status, out: (r.stdout ?? "") + (r.stderr ?? "") };
  };

  it("[bk-offsite-s3-roundtrip] backup uploads (size verified by HEAD, SigV4 checked by botocore), downloads byte-identical and restores", () => {
    expect(tsx(["check"], s3env).code).toBe(0);
    const r = sh("backup-secure.sh", [], backupEnv(s3env));
    expect(r.code, r.out).toBe(0);
    expect(r.out).toContain("UPLOADED to S3-compatible bucket");
    expect(r.out).not.toContain(s3env.BACKUP_S3_SECRET_ACCESS_KEY);
    const name = encrypted();
    const dest = path.join(work, "downloaded.dump.gpg");
    expect(tsx(["get", name, dest], s3env).code).toBe(0);
    expect(Buffer.compare(fs.readFileSync(dest), fs.readFileSync(path.join(work, "bk", name)))).toBe(0);
    const v = sh("verify-restore.sh", [dest], { VERIFY_ADMIN_DATABASE_URL: ADMIN_URL, BACKUP_PASSPHRASE_FILE: passFile });
    expect(v.code, v.out).toBe(0);
  });

  it("[bk-offsite-s3-wrong-credentials] a bad secret -> upload fails, exit 2, local copy kept, secret never printed", () => {
    const bad = { ...s3env, BACKUP_S3_SECRET_ACCESS_KEY: "definitely-wrong-secret-0123456789abcdef" };
    const r = sh("backup-secure.sh", [], backupEnv(bad));
    expect(r.code, r.out).toBe(2);
    expect(r.out).toContain("OFFSITE: FAILED");
    expect(r.out).not.toContain("definitely-wrong-secret");
    expect(encrypted()).toBeTruthy();
  });

  it("[bk-offsite-s3-config-and-names] missing settings -> exit 3; unsafe object names are refused", () => {
    expect(tsx(["check"], {}).code).toBe(3);
    expect(tsx(["get", "../../etc/passwd", path.join(work, "x")], s3env).code).toBe(1);
  });
});
