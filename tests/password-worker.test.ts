/**
 * src/server/lib/password.ts runs bcrypt on worker threads. These checks pin down that this changes
 * nothing about the hashes or the comparison: same bcryptjs library, same cost factor (12), hashes
 * interchangeable with bcryptjs on the calling thread in both directions, identical results for
 * wrong passwords and malformed hashes, and correct results under concurrency. They also confirm the
 * work really ran on worker threads rather than silently falling back to the calling thread.
 */
import { describe, it, expect } from "vitest";
import bcrypt from "bcryptjs";
import { hashPassword, verifyPassword, __passwordPoolStatsForTests } from "@/server/lib/password";

describe("password hashing on worker threads", () => {
  it("[pw-format] produces a standard bcrypt hash at cost 12 that verifies, and rejects a wrong password", async () => {
    const hash = await hashPassword("correct horse battery");
    expect(hash).toMatch(/^\$2[aby]\$12\$[./A-Za-z0-9]{53}$/);
    expect(await verifyPassword("correct horse battery", hash)).toBe(true);
    expect(await verifyPassword("correct horse batterY", hash)).toBe(false);
    expect(await verifyPassword("", hash)).toBe(false);
  });

  it("[pw-compatible] hashes are interchangeable with bcryptjs on the calling thread, in both directions", async () => {
    const madeOnMainThread = bcrypt.hashSync("existing-user-password", 12);
    expect(await verifyPassword("existing-user-password", madeOnMainThread)).toBe(true);
    expect(await verifyPassword("other-password", madeOnMainThread)).toBe(false);

    const madeOnWorker = await hashPassword("new-user-password");
    expect(bcrypt.compareSync("new-user-password", madeOnWorker)).toBe(true);
    expect(bcrypt.compareSync("other-password", madeOnWorker)).toBe(false);
  });

  it("[pw-same-edge-cases] malformed hashes and long passwords give exactly what bcryptjs gives", async () => {
    const cases: Array<[string, string]> = [
      ["anything", "not-a-bcrypt-hash"],
      ["anything", ""],
      ["anything", "$2a$12$tooShort"],
      ["x".repeat(100), bcrypt.hashSync("x".repeat(100), 12)], // bcrypt only uses the first 72 bytes
      ["x".repeat(72) + "different-tail", bcrypt.hashSync("x".repeat(100), 12)],
    ];
    for (const [plain, hash] of cases) {
      const expected = await bcrypt.compare(plain, hash).then(
        (v) => ({ value: v }),
        (e: Error) => ({ error: e.message })
      );
      const actual = await verifyPassword(plain, hash).then(
        (v) => ({ value: v }),
        (e: Error) => ({ error: e.message })
      );
      expect(actual).toEqual(expected);
    }
  });

  it("[pw-concurrent] many concurrent checks each get their own correct answer", async () => {
    const hashes = await Promise.all(["alpha", "bravo", "charlie"].map((p) => hashPassword(p)));
    const checks = Array.from({ length: 12 }, (_, i) => {
      const which = i % 3;
      const plain = i % 2 === 0 ? ["alpha", "bravo", "charlie"][which] : "wrong";
      return { plain, hash: hashes[which], expected: i % 2 === 0 };
    });
    const results = await Promise.all(checks.map((c) => verifyPassword(c.plain, c.hash)));
    expect(results).toEqual(checks.map((c) => c.expected));
  });

  it("[pw-on-workers] the work above ran on worker threads, not on the calling thread", () => {
    const stats = __passwordPoolStatsForTests();
    expect(stats.poolDisabled).toBe(false);
    expect(stats.workers).toBeGreaterThan(0);
    expect(stats.workers).toBeLessThanOrEqual(stats.poolSize);
    expect(stats.completedOnWorkers).toBeGreaterThan(0);
    expect(stats.completedOnMainThread).toBe(0);
  });
});
