/**
 * PCP: storage-key validation shared by every provider. Keys this app generates are
 * `photos/<uuid>/<uuid>.<ext>` and `invoices/<uuid>.pdf`; anything else is refused so
 * a bad key can never traverse out of the storage root / bucket prefix.
 */
const SAFE_KEY = /^[A-Za-z0-9][A-Za-z0-9._\-]*(?:\/[A-Za-z0-9][A-Za-z0-9._\-]*)*$/;

export function assertSafeStorageKey(key: string): void {
  if (
    typeof key !== "string" ||
    key.length === 0 ||
    key.length > 512 ||
    !SAFE_KEY.test(key) ||
    key.split("/").some((seg) => seg === ".." || seg === ".")
  ) {
    throw new Error("Invalid storage key.");
  }
}
