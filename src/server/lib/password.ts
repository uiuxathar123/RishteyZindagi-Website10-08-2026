/**
 * Password hashing — bcrypt via bcryptjs (pure JS, no native build step,
 * so it installs and runs the same in every environment including this
 * sandbox). Cost factor 12 is bcrypt's commonly-recommended production
 * default as of 2026 (balances hash time vs. brute-force resistance).
 * Nothing outside this file ever calls bcrypt directly, so the algorithm
 * and cost factor can only change in one place.
 */
import bcrypt from "bcryptjs";

const SALT_ROUNDS = 12;

export async function hashPassword(plain: string): Promise<string> {
  return bcrypt.hash(plain, SALT_ROUNDS);
}

export async function verifyPassword(plain: string, hash: string): Promise<boolean> {
  return bcrypt.compare(plain, hash);
}
