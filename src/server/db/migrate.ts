/**
 * Applies every migration file under ./drizzle in order, tracking which
 * ones have already run in a `__drizzle_migrations` table it manages
 * itself — safe to run repeatedly (a no-op once everything is applied).
 * This is the one supported way to bring a database up to date; nothing
 * should hand-run the generated .sql files directly.
 *
 * Usage: npm run db:migrate
 */
import "dotenv/config";
import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";

async function main() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error("DATABASE_URL is not set.");

  const pool = new Pool({ connectionString });
  const db = drizzle(pool);

  console.log("Running migrations...");
  await migrate(db, { migrationsFolder: "./drizzle" });
  console.log("Migrations complete.");

  await pool.end();
}

main().catch((err) => {
  console.error("Migration failed:", err);
  process.exit(1);
});
