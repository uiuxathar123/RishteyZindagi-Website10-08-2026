/**
 * B11: response shaping for push-token endpoints. Never echoes the raw
 * token value back in a LIST response body (list is a "which devices do I
 * have" view, not a token-retrieval endpoint) — only the register response
 * confirms the exact token it just accepted, matching how e.g. a session
 * token is returned once, at creation, elsewhere in this codebase.
 */
import type { PushTokenRow } from "./push-tokens.repository";

export interface PushTokenView {
  id: string;
  platform: PushTokenRow["platform"];
  registeredAt: string;
  lastSeenAt: string;
}

export interface RegisteredPushTokenView extends PushTokenView {
  token: string;
}

export function toPushTokenView(row: PushTokenRow): PushTokenView {
  return {
    id: row.id,
    platform: row.platform,
    registeredAt: row.registeredAt.toISOString(),
    lastSeenAt: row.lastSeenAt.toISOString(),
  };
}

export function toRegisteredPushTokenView(row: PushTokenRow): RegisteredPushTokenView {
  return { ...toPushTokenView(row), token: row.token };
}

export function toPushTokenViews(rows: PushTokenRow[]): PushTokenView[] {
  return rows.map(toPushTokenView);
}
