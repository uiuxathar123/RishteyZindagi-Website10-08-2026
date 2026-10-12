import { describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import os from "node:os";
import path from "node:path";
import { runTsx, runTsxSync } from "./helpers/run-tsx";

const missingWorkingDirectory = () => path.join(os.tmpdir(), `rishtey-missing-cwd-${randomUUID()}`);

describe("cross-platform TSX subprocess helper", () => {
  it("reports synchronous process-start errors without assuming an Error.code type", () => {
    expect(() =>
      runTsxSync(["scripts/create-super-admin.ts"], {
        cwd: missingWorkingDirectory(),
        encoding: "utf8",
        env: process.env,
      })
    ).toThrow(/ENOENT/);
  });

  it("reports asynchronous process-start errors without exposing command arguments", async () => {
    await expect(
      runTsx(["scripts/create-super-admin.ts"], {
        cwd: missingWorkingDirectory(),
        encoding: "utf8",
        env: process.env,
      })
    ).rejects.toThrow(/ENOENT/);
  });
});
