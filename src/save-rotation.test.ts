import { describe, expect, it } from "vitest";
import {
  MANUAL_SAVE_LIMIT,
  savesReplacedByManualSave,
  type ListedSave,
} from "./save-rotation.ts";

function save(
  index: number,
  options: { careerId?: string; automatic?: boolean; imported?: boolean } = {},
): ListedSave {
  return {
    name: `Save ${index}`,
    file: `${String(index).padStart(8, "0")}-0000-4000-8000-000000000000.touchline.gz`,
    size: 1000,
    modified: new Date(Date.UTC(2026, 8, 1, 12, index)).toISOString(),
    compressed: true,
    automatic: options.automatic ?? false,
    imported: options.imported ?? false,
    career:
      options.careerId === undefined
        ? undefined
        : {
            id: options.careerId,
            name: "Project",
            director: "Alex",
            club: "Northbridge",
            date: "2026-08-01",
            season: 2026,
          },
  };
}

const manual = (count: number, careerId = "career-a", from = 1) =>
  Array.from({ length: count }, (_, offset) => save(from + offset, { careerId }));

describe("savesReplacedByManualSave", () => {
  it("replaces nothing while the career has room for another manual save", () => {
    expect(MANUAL_SAVE_LIMIT).toBe(10);
    expect(savesReplacedByManualSave(manual(9), "career-a")).toEqual([]);
    expect(savesReplacedByManualSave([], "career-a")).toEqual([]);
  });

  it("names the oldest manual save once the career is at the limit, in any input order", () => {
    const slots = manual(10).toReversed();
    const replaced = savesReplacedByManualSave(slots, "career-a");
    expect(replaced.map((slot) => slot.name)).toEqual(["Save 1"]);
    expect(savesReplacedByManualSave(manual(10), "career-a")).toEqual(replaced);
  });

  it("ignores autosaves, imported saves and other careers, like the server rotation", () => {
    const slots = [
      save(0, { careerId: "career-a", imported: true }),
      save(1, { careerId: "career-a", automatic: true }),
      save(2, { careerId: "career-b" }),
      save(3),
      ...manual(9, "career-a", 4),
    ];
    expect(savesReplacedByManualSave(slots, "career-a")).toEqual([]);
    const full = [...slots, save(20, { careerId: "career-a" })];
    expect(
      savesReplacedByManualSave(full, "career-a").map((slot) => slot.name),
    ).toEqual(["Save 4"]);
  });

  it("lists every save beyond the limit oldest first and needs a career", () => {
    expect(
      savesReplacedByManualSave(manual(12), "career-a").map((slot) => slot.name),
    ).toEqual(["Save 1", "Save 2", "Save 3"]);
    expect(savesReplacedByManualSave(manual(12), null)).toEqual([]);
    expect(savesReplacedByManualSave(manual(12), undefined)).toEqual([]);
  });

  it("breaks equal save times by file, newest file first like the saves list", () => {
    const tied = manual(10).map((slot) => ({
      ...slot,
      modified: "2026-09-01T12:00:00.000Z",
    }));
    expect(
      savesReplacedByManualSave(tied, "career-a").map((slot) => slot.name),
    ).toEqual(["Save 1"]);
  });
});

// server/saves.ts create(): the new and kept saves sort first, then newest first; rows past the limit are deleted.
function serverDeletes(slots: ListedSave[], careerId: string, keep?: string) {
  const created = save(99, { careerId });
  const first = (slot: ListedSave) =>
    slot.file === created.file || slot.file === keep ? 0 : 1;
  return [
    ...slots.filter(
      (slot) =>
        !slot.automatic && !slot.imported && slot.career?.id === careerId,
    ),
    created,
  ]
    .toSorted(
      (left, right) =>
        first(left) - first(right) ||
        right.modified.localeCompare(left.modified) ||
        right.file.localeCompare(left.file),
    )
    .slice(MANUAL_SAVE_LIMIT)
    .reverse();
}

describe("savesReplacedByManualSave while loading a save", () => {
  const names = (slots: ListedSave[]) => slots.map((slot) => slot.name);

  it("keeps the loaded save when it is the oldest and names the next oldest", () => {
    const slots = manual(10);
    expect(
      names(savesReplacedByManualSave(slots, "career-a", slots[0].file)),
    ).toEqual(["Save 2"]);
    expect(
      savesReplacedByManualSave(manual(9), "career-a", slots[0].file),
    ).toEqual([]);
  });

  it("still names the oldest when a newer save of the career is loaded", () => {
    const slots = manual(10);
    expect(
      names(savesReplacedByManualSave(slots, "career-a", slots[4].file)),
    ).toEqual(["Save 1"]);
  });

  it("ignores a loaded save outside the career's manual rotation", () => {
    const slots = [
      ...manual(10),
      save(20, { careerId: "career-a", automatic: true }),
      save(21, { careerId: "career-a", imported: true }),
      save(22, { careerId: "career-b" }),
    ];
    for (const loaded of [...slots.slice(10), save(23)])
      expect(
        names(savesReplacedByManualSave(slots, "career-a", loaded.file)),
      ).toEqual(["Save 1"]);
  });

  it("matches the server query for every loaded save, and differs only when it spares that save", () => {
    for (const count of [8, 9, 10, 11, 13]) {
      const slots = [
        ...manual(count).toReversed(),
        save(40, { careerId: "career-a", automatic: true }),
        save(41, { careerId: "career-a", imported: true }),
      ];
      const plain = savesReplacedByManualSave(slots, "career-a");
      expect(plain).toEqual(serverDeletes(slots, "career-a"));
      for (const loaded of slots) {
        const replaced = savesReplacedByManualSave(
          slots,
          "career-a",
          loaded.file,
        );
        expect(replaced).toEqual(serverDeletes(slots, "career-a", loaded.file));
        expect(replaced).not.toContain(loaded);
        expect(replaced).toHaveLength(plain.length);
        if (!plain.includes(loaded)) expect(replaced).toEqual(plain);
      }
    }
  });
});
