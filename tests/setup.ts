import { config } from "dotenv";
import path from "path";

// Loaded before every test file (see vitest.config.ts's setupFiles).
// Points every server module at the test database via DATABASE_URL —
// nothing in src/server ever reads NODE_ENV to decide which DB to use,
// it only ever reads DATABASE_URL, so this one line is what keeps tests
// off the dev database.
config({ path: path.resolve(__dirname, "../.env.test") });
