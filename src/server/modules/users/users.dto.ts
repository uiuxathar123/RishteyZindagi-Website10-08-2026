/** Shapes a user DB row into what's safe to send over the API — never the
 * password hash, never internal-only columns. Every response that
 * includes a user goes through this, so `passwordHash` can never
 * accidentally leak by someone spreading the raw row into a response. */
import type { UserRow } from "./users.repository";

export interface PublicUser {
  id: string;
  name: string;
  email: string;
  mobileNumber: string;
  countryCode: string;
  status: string;
  emailVerified: boolean;
  mobileVerified: boolean;
  country: string | null;
  city: string | null;
  createdAt: string;
}

export function toPublicUser(row: UserRow): PublicUser {
  return {
    id: row.id,
    name: row.name,
    email: row.email,
    mobileNumber: row.mobileNumber,
    countryCode: row.countryCode,
    status: row.status,
    emailVerified: row.emailVerifiedAt !== null,
    mobileVerified: row.mobileVerifiedAt !== null,
    country: row.country,
    city: row.city,
    createdAt: row.createdAt.toISOString(),
  };
}
