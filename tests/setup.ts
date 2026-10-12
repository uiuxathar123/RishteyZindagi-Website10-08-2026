import { config, parse } from "dotenv";
import { readFileSync } from "node:fs";
import { isIP } from "node:net";
import path from "node:path";
import { Pool } from "pg";

const testEnvPath = path.resolve(__dirname, "../.env.test");
const expectedDatabase = "rishteyzindagi_test";

interface DatabaseTarget {
  host: string;
  port: string;
  database: string;
}

function targetFromUrl(value: string): DatabaseTarget {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error("Test database configuration is not a valid PostgreSQL URL; refusing to run tests.");
  }

  const host = url.hostname.replace(/^\[|\]$/g, "").toLowerCase();
  let database: string;
  try {
    database = decodeURIComponent(url.pathname.replace(/^\//, ""));
  } catch {
    throw new Error("Test database configuration has an invalid database name; refusing to run tests.");
  }
  if (!["postgres:", "postgresql:"].includes(url.protocol) || !host || !database) {
    throw new Error("Test database configuration must specify a PostgreSQL host and database; refusing to run tests.");
  }
  return { host, port: url.port || "5432", database };
}

function isLoopbackHost(host: string): boolean {
  if (host === "localhost" || host === "::1") return true;
  if (isIP(host) === 4) return Number(host.split(".")[0]) === 127;
  return false;
}

function isLoopbackAddress(address: string): boolean {
  const host = address.replace(/\/\d+$/, "").toLowerCase();
  return isLoopbackHost(host) || host.startsWith("::ffff:127.");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

async function verifyTestDatabase(): Promise<void> {
  let envFile: Record<string, string>;
  try {
    envFile = parse(readFileSync(testEnvPath));
  } catch {
    throw new Error("Cannot read tests/.env.test; refusing to run tests without an explicit test database.");
  }

  const configuredUrl = envFile.DATABASE_URL;
  if (!configuredUrl || envFile.NODE_ENV !== "test") {
    throw new Error("tests/.env.test must define DATABASE_URL and NODE_ENV=test; refusing to run tests.");
  }

  const configuredTarget = targetFromUrl(configuredUrl);
  if (!isLoopbackHost(configuredTarget.host) || configuredTarget.database !== expectedDatabase) {
    throw new Error(`tests/.env.test must target loopback PostgreSQL database ${expectedDatabase}; refusing to run tests.`);
  }

  const inheritedUrl = process.env.DATABASE_URL;
  if (inheritedUrl) {
    const inheritedTarget = targetFromUrl(inheritedUrl);
    if (
      inheritedTarget.host !== configuredTarget.host ||
      inheritedTarget.port !== configuredTarget.port ||
      inheritedTarget.database !== configuredTarget.database
    ) {
      throw new Error("Inherited DATABASE_URL does not match the local test database in tests/.env.test; refusing to run tests.");
    }
  }

  config({ path: testEnvPath, override: true });
  let pool: Pool | undefined;
  try {
    pool = new Pool({ connectionString: configuredUrl, max: 1, connectionTimeoutMillis: 5000 });
    const result = await pool.query("SELECT current_database() AS database, inet_server_addr()::text AS server_address");
    const row = result.rows[0] as { database?: unknown; server_address?: unknown } | undefined;
    if (
      row?.database !== expectedDatabase ||
      (typeof row.server_address === "string" && !isLoopbackAddress(row.server_address))
    ) {
      throw new Error(`PostgreSQL identity check did not confirm local ${expectedDatabase}; refusing to run tests.`);
    }
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("PostgreSQL identity check did not confirm")) throw error;
    const code = isRecord(error) ? error.code : undefined;
    const safeCode = typeof code === "string" && /^[A-Z0-9_]+$/.test(code) ? ` (${code})` : "";
    throw new Error(`Could not verify local test database ${expectedDatabase}${safeCode}; refusing to run tests.`);
  } finally {
    await pool?.end();
  }
}

await verifyTestDatabase();
