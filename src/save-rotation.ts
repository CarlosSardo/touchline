import type { SaveSlot } from "../shared/api.ts";

/** `GET /api/saves` also flags uploads, which never rotate away. */
export type ListedSave = SaveSlot & { imported?: boolean };

/** Mirrors `SAVE_SLOT_LIMITS.manual` in server/saves.ts. */
export const MANUAL_SAVE_LIMIT = 10;

/**
 * Manual saves of the career that one more manual save deletes, oldest first, in the server's rotation order.
 * `keep` is the file being loaded: the server keeps it out of the rotation, so the next oldest goes instead.
 */
export function savesReplacedByManualSave(
  slots: readonly ListedSave[],
  careerId: string | null | undefined,
  keep?: string,
): ListedSave[] {
  if (!careerId) return [];
  const rotating = slots
    .filter(
      (slot) =>
        !slot.automatic && !slot.imported && slot.career?.id === careerId,
    )
    .toSorted(
      (left, right) =>
        right.modified.localeCompare(left.modified) ||
        right.file.localeCompare(left.file),
    );
  const others = rotating.filter((slot) => slot.file !== keep);
  // The new save always stays; so does the kept one when it is a manual save of this career.
  const staying = 1 + rotating.length - others.length;
  return others.slice(Math.max(0, MANUAL_SAVE_LIMIT - staying)).reverse();
}

/** "the oldest one" / "the 3 oldest", for sentences that end in the list of replaced saves. */
export function oldestPhrase(count: number) {
  return count === 1 ? "the oldest one" : `the ${count} oldest`;
}
