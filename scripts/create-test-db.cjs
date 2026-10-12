/**
 * One-off helper (no psql needed): creates the empty TEST database named in .env.test.
 *  - reads DATABASE_URL from .env.test only (never .env);
 *  - refuses to run unless that URL's database is exactly "rishteyzindagi_test";
 *  - never prints the password; does nothing if the database already exists.
 * Then run (PowerShell):  see LOCAL_SETUP.md -> test database -> db:migrate + db:seed against .env.test.
 */
const path = require("path");
require("dotenv").config({ path: path.resolve(__dirname, "../.env.test"), quiet: true });
const { Client } = require("pg");

(async () => {
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL missing in .env.test");
  const url = new URL(process.env.DATABASE_URL);
  const name = url.pathname.replace(/^\//, "");
  if (name !== "rishteyzindagi_test") throw new Error(`.env.test points at "${name}", expected "rishteyzindagi_test" - refusing.`);
  if (!["localhost", "127.0.0.1", "::1", "[::1]"].includes(url.hostname)) throw new Error(`host "${url.hostname}" is not this machine - refusing.`);
  url.pathname = "/postgres"; // maintenance database
  const client = new Client({ connectionString: url.toString() });
  await client.connect();
  const exists = await client.query("select 1 from pg_database where datname = $1", [name]);
  if (exists.rowCount) console.log(`Database "${name}" already exists - nothing to do.`);
  else {
    await client.query(`CREATE DATABASE "${name}"`);
    console.log(`Created empty database "${name}".`);
  }
  await client.end();
})().catch((e) => {
  console.error("FAILED:", e.message);
  process.exit(1);
});
