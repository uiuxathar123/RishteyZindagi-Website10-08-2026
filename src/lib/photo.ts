/**
 * Photo URLs from the API look like `/api/v1/profiles/photos/<id>/file` and
 * require a signed-in session. In the browser they must go through the
 * session proxy (which adds the cookie-held token) — and `next/image`'s
 * optimiser must NOT fetch them (it has no cookie), so they are always
 * rendered `unoptimized`.
 */
export type PhotoRealm = "member" | "admin";

export function photoSrc(apiUrl: string | null | undefined, realm: PhotoRealm = "member"): string | undefined {
  if (!apiUrl) return undefined;
  const rest = apiUrl.replace(/^\/api\/v1/, "");
  return realm === "admin" ? `/bff/as-admin${rest}` : `/bff${rest}`;
}

export function primaryPhotoUrl(photos: Array<{ url: string; isPrimary: boolean }> | undefined): string | undefined {
  if (!photos || photos.length === 0) return undefined;
  return (photos.find((p) => p.isPrimary) ?? photos[0]).url;
}
