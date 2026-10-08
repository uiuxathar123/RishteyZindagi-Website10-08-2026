/**
 * B6: the one function every other B6 module calls to log a real
 * behaviour event, at the exact point the real action happens (same
 * request/service call as the action itself — never a separate batch
 * job). Deliberately best-effort, mirroring `audit.service.ts`'s
 * `record()` — a failure to log a behaviour event must never fail the
 * primary action it's describing (e.g. sending an Interest must still
 * succeed even if the event insert fails).
 */
import { logError } from "@/server/lib/logger";
import * as behaviourEventsRepo from "./behaviour-events.repository";
import type { NewBehaviourEvent } from "./behaviour-events.repository";

export async function recordEvent(event: NewBehaviourEvent): Promise<void> {
  try {
    await behaviourEventsRepo.insert(event);
  } catch (err) {
    logError("behaviour-event-write-failed", err, { eventType: event.eventType, actorUserId: event.actorUserId });
  }
}
