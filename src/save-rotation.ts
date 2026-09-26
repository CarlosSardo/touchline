import type { SaveSlot } from "../shared/api.ts";

/** `GET /api/saves` also flags uploads, which never rotate away. */
export type ListedSave = SaveSlot & { imported?: boolean };

/** Mirrors `SAVE_SLOT_LIMITS.manual` in server/saves.ts. */
export const MANUAL_SAVE_LIMIT = 10;

/** Manual saves of the career that one more manual save deletes, oldest first, in the server's rotation order. */
export function savesReplacedByManualSave(
  slots: readonly ListedSave[],
  careerId: string | null | undefined,
  limit = MANUAL_SAVE_LIMIT,
): ListedSave[] {
  if (!careerId) return [];
  return slots
    .filter(
      (slot) =>
        !slot.automatic && !slot.imported && slot.career?.id === careerId,
    )
    .toSorted(
      (left, right) =>
        right.modified.localeCompare(left.modified) ||
        right.file.localeCompare(left.file),
    )
    .slice(Math.max(0, limit - 1))
    .reverse();
}

/** "the oldest one" / "the 3 oldest", for sentences that end in the list of replaced saves. */
export function oldestPhrase(count: number) {
  return count === 1 ? "the oldest one" : `the ${count} oldest`;
}
