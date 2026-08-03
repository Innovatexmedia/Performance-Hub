/**
 * Tracks which (templateId, approvalStatus) combinations a user has
 * already viewed in the Template Approval tab, so the "needs your
 * attention" badge (e.g. a REJECTED template) can actually clear once
 * seen -- REJECTED is a terminal state that never changes on its own, so
 * without this the badge would show that same rejection forever, even
 * long after the user has read it and understood why.
 *
 * Deliberately NOT used for the approver's "pending review" badge count
 * -- that one should stay visible until the item is actually acted on
 * (approved/rejected/changes requested), not just glanced at, since it
 * represents outstanding work, not a one-time notice.
 *
 * Scoped per user (not per tenant) via the key suffix, and stored in
 * localStorage rather than the backend -- this is a personal "have I
 * looked at this" marker, not something that needs to sync across
 * devices or be visible to anyone else.
 */

const STORAGE_KEY_PREFIX = 'whatsapp_seen_templates_v1:';

function readSeenMap(userId: string): Record<string, string> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY_PREFIX + userId);
    return raw ? (JSON.parse(raw) as Record<string, string>) : {};
  } catch {
    return {};
  }
}

function writeSeenMap(userId: string, map: Record<string, string>): void {
  try {
    localStorage.setItem(STORAGE_KEY_PREFIX + userId, JSON.stringify(map));
  } catch {
    // Storage full/unavailable -- badge just won't persist across reloads, not worth surfacing an error for.
  }
}

/** True if this exact template, at this exact approvalStatus, has already been marked seen. */
export function isTemplateStatusSeen(userId: string | undefined, templateId: string, approvalStatus: string): boolean {
  if (!userId) return false;
  return readSeenMap(userId)[templateId] === approvalStatus;
}

/** Marks a template's current approvalStatus as seen -- call this once the user has actually viewed it (e.g. the Template Approval tab rendering it). */
export function markTemplateStatusSeen(userId: string | undefined, templateId: string, approvalStatus: string): void {
  if (!userId) return;
  const map = readSeenMap(userId);
  if (map[templateId] === approvalStatus) return; // already recorded, skip the write
  map[templateId] = approvalStatus;
  writeSeenMap(userId, map);
}