import "server-only";
/**
 * Server-component helpers: validate the signed-in session from the httpOnly
 * cookie *on the server* (so protected pages never render for a signed-out
 * visitor) and fetch data for first paint. Talks to the real `/api/v1`
 * handlers directly on loopback; the browser never involved.
 */
import { cookies, headers } from "next/headers";
import { ADMIN_COOKIE, MEMBER_COOKIE, internalApiOrigin } from "@/lib/bff/config";
import type { AdminIdentity, PublicUser } from "./types";

type Realm = "member" | "admin";

function origin(): string {
  const host = headers().get("host") ?? "localhost:3000";
  return internalApiOrigin(`http://${host}/`);
}

export async function serverGet<T>(realm: Realm, path: string): Promise<T | null> {
  const token = cookies().get(realm === "admin" ? ADMIN_COOKIE : MEMBER_COOKIE)?.value;
  if (!token) return null;
  try {
    const res = await fetch(`${origin()}/api/v1${path}`, {
      headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
      cache: "no-store",
    });
    if (!res.ok) return null;
    const payload = (await res.json()) as { success?: boolean; data?: T };
    return payload.success === false ? null : (payload.data ?? null);
  } catch {
    return null;
  }
}

/** The signed-in member, or null. */
export async function getMemberSession(): Promise<PublicUser | null> {
  const data = await serverGet<{ user: PublicUser }>("member", "/users/me");
  return data?.user ?? null;
}

/** The signed-in admin and their permission keys, or null. */
export async function getAdminSession(): Promise<AdminIdentity | null> {
  return serverGet<AdminIdentity>("admin", "/admin/me");
}
