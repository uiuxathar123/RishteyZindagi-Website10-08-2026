/**
 * B7: response shaping for the member-facing notification list/read
 * endpoints. Deliberately omits `failureReason` — an internal delivery
 * detail, never a member-facing field (mirrors interactions.dto.ts's own
 * "lightweight index, not an internal-state dump" posture).
 */
import type { NotificationRow } from "./notifications.repository";

export interface NotificationView {
  id: string;
  channel: NotificationRow["channel"];
  title: string;
  body: string;
  isRead: boolean;
  readAt: string | null;
  deliveryStatus: NotificationRow["deliveryStatus"];
  createdAt: string;
}

export function toNotificationView(row: NotificationRow): NotificationView {
  return {
    id: row.id,
    channel: row.channel,
    title: row.title,
    body: row.body,
    isRead: row.isRead,
    readAt: row.readAt ? row.readAt.toISOString() : null,
    deliveryStatus: row.deliveryStatus,
    createdAt: row.createdAt.toISOString(),
  };
}

export function toNotificationViews(rows: NotificationRow[]): NotificationView[] {
  return rows.map(toNotificationView);
}
