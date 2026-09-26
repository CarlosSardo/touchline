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
