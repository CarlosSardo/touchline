import { describe, expect, it } from "vitest";
import type { Player } from "../shared/types.ts";
import {
  ageValue,
  ariaSort,
  compareSortValues,
  nextSort,
  PLAYER_COLUMNS,
  positionRank,
  sortPlayers,
  sortRows,
} from "./sort.ts";
import { bodyOf, clubLabel, flagEmoji, isMissingPlayer, shortlistStatus } from "./players.ts";

const player = (id: number, fields: Partial<Player & Record<string, unknown>> = {}) =>
  ({
    id,
    name: `Player ${id}`,
    position: "CM",
    age: 24,
    birth_date: "2002-01-01",
    ability: 60,
    potential: 70,
    value: 1_000_000,
    wage: 5_000,
    club_id: 1,
    parent_club_id: null,
    country_id: 1,
    contract_end: "2028-06-30",
    nationality: "England",
    goals: 0,
    assists: 0,
    ...fields,
  }) as Player;

const names = (players: Player[]) => players.map((entry) => entry.name);

describe("table sorting", () => {
  it("orders positions like a team sheet", () => {
    const order = ["ST", "GK", "RW", "CB", "AM", "LB", "DM", "RB", "LW", "CM"];
    const sorted = sortPlayers(
      order.map((position, index) => player(index + 1, { position: position as Player["position"] })),
      "position",
      "asc",
    );
    expect(sorted.map((entry) => entry.position)).toEqual([
      "GK", "CB", "LB", "RB", "DM", "CM", "AM", "LW", "RW", "ST",
    ]);
    expect(positionRank("XX")).toBeNull();
  });

  it("keeps missing values last in both directions", () => {
    const rows = [
      player(1, { club_name: undefined, club_id: null }),
      player(2, { club_name: "Zeta FC" }),
      player(3, { club_name: "Alpha FC" }),
    ];
    expect(names(sortPlayers(rows, "club", "asc"))).toEqual(["Player 3", "Player 2", "Player 1"]);
    expect(names(sortPlayers(rows, "club", "desc"))).toEqual(["Player 2", "Player 3", "Player 1"]);
    expect(compareSortValues(Number.NaN, 1, "desc")).toBe(1);
    expect(compareSortValues("", "a", "asc")).toBe(1);
  });

  it("breaks age ties by exact birth date so ascending is youngest first", () => {
    const rows = [
      player(1, { age: 17, birth_date: "2009-01-10" }),
      player(2, { age: 17, birth_date: "2009-06-10" }),
      player(3, { age: 16, birth_date: "2009-12-01" }),
    ];
    expect(names(sortPlayers(rows, "age", "asc"))).toEqual(["Player 3", "Player 2", "Player 1"]);
    expect(names(sortPlayers(rows, "age", "desc"))).toEqual(["Player 1", "Player 2", "Player 3"]);
    expect(ageValue(17, null)).toEqual([17, null]);
  });

  it("breaks ties by name then id whatever the input order", () => {
    const rows = [
      player(4, { name: "Bruno", ability: 70 }),
      player(2, { name: "Ana", ability: 70 }),
      player(3, { name: "Ana", ability: 70 }),
      player(1, { name: "Carla", ability: 80 }),
    ];
    expect(sortPlayers(rows, "ability").map((entry) => entry.id)).toEqual([1, 2, 3, 4]);
    expect(sortPlayers([...rows].reverse(), "ability").map((entry) => entry.id)).toEqual([1, 2, 3, 4]);
    expect(sortPlayers(rows, "ability", "asc").map((entry) => entry.id)).toEqual([2, 3, 4, 1]);
  });

  it("compares tuples element by element and numbers numerically", () => {
    const rows = [
      player(1, { goals: 3, assists: 1 }),
      player(2, { goals: 3, assists: 4 }),
      player(3, { goals: 10, assists: 0 }),
    ];
    expect(sortPlayers(rows, "goals").map((entry) => entry.id)).toEqual([3, 2, 1]);
    const labels = sortRows(["Tier 10", "Tier 2", "tier 1"], { value: (text) => text }, "asc");
    expect(labels).toEqual(["tier 1", "Tier 2", "Tier 10"]);
  });

  it("sorts quality columns best first and reverses on the second click", () => {
    expect(PLAYER_COLUMNS.ability.defaultDirection).toBe("desc");
    expect(PLAYER_COLUMNS.name.defaultDirection).toBe("asc");
    const first = nextSort(null, "value", "desc");
    expect(first).toEqual({ key: "value", direction: "desc" });
    const second = nextSort(first, "value", "desc");
    expect(second).toEqual({ key: "value", direction: "asc" });
    expect(nextSort(second, "name", "asc")).toEqual({ key: "name", direction: "asc" });
    expect(ariaSort(second, "value")).toBe("ascending");
    expect(ariaSort(first, "value")).toBe("descending");
    expect(ariaSort(first, "name")).toBeUndefined();
  });

  it("sorts contracts soonest first with club-less players last", () => {
    const rows = [
      player(1, { club_id: null, contract_end: "2020-06-30" }),
      player(2, { contract_end: "2029-06-30" }),
      player(3, { contract_end: "2027-06-30" }),
    ];
    expect(sortPlayers(rows, "contract").map((entry) => entry.id)).toEqual([3, 2, 1]);
    expect(sortPlayers(rows, "contract", "desc").map((entry) => entry.id)).toEqual([2, 3, 1]);
  });

  it("sorts current height from search rows or profiles", () => {
    const rows = [
      player(1, { height: 181 }),
      player(2, { height: null }),
      player(3, {
        details: { identity: { height: 190.4, weight: 83 } } as Player["details"],
      }),
    ];
    expect(sortPlayers(rows, "height").map((entry) => entry.id)).toEqual([3, 1, 2]);
  });
});

describe("player labels", () => {
  it("labels home-based pool players instead of calling them free agents", () => {
    expect(clubLabel(player(1, { club_id: null, home_based: 1 }))).toBe("Home-based");
    expect(clubLabel(player(2, { club_id: null }))).toBe("Free agent");
    expect(clubLabel(player(3, { club_name: "Sporting CP" }))).toBe("Sporting CP");
  });

  it("rounds the current body and flags players who are still growing", () => {
    const youth = player(1, {
      details: {
        identity: { height: 171.6, weight: 60.2, growth: { adultHeight: 183, adultWeight: 77, maturation: 0.3 } },
      } as Player["details"],
    });
    expect(bodyOf(youth)).toEqual({ height: 172, weight: 60, growing: true });
    expect(bodyOf(player(2)).height).toBeNull();
  });

  it("treats a missing player record as archived", () => {
    expect(isMissingPlayer("Player not found.")).toBe(true);
    expect(isMissingPlayer("The game could not complete that action.")).toBe(false);
  });

  it("renders subdivision flags and falls back for nations without one", () => {
    expect(flagEmoji("PT")).toBe(String.fromCodePoint(0x1f1f5, 0x1f1f9));
    expect(flagEmoji("EN")).toBe(
      String.fromCodePoint(0x1f3f4, 0xe0067, 0xe0062, 0xe0065, 0xe006e, 0xe0067, 0xe007f),
    );
    expect(flagEmoji("NIR")).toBeNull();
  });

  it("classifies shortlist status by negotiation, age route and budget", () => {
    const context = {
      clubId: 9,
      clubCountryId: 1,
      clubCountryName: "England",
      transferBudget: 2_000_000,
      negotiations: [{ player_id: 5, buying_club_id: 9, stage: "Club talks" }],
    };
    expect(shortlistStatus(player(1, { club_id: 9 }), context)).toBe("own");
    expect(shortlistStatus(player(5), context)).toBe("talks");
    expect(shortlistStatus(player(6, { age: 16, country_id: 2, nationalities: ["France"] }), context)).toBe("u18");
    expect(shortlistStatus(player(7, { age: 16, country_id: 2, nationalities: ["France", "England"] }), context)).toBe("available");
    expect(shortlistStatus(player(8, { club_id: null }), context)).toBe("free");
    expect(shortlistStatus(player(9, { value: 3_000_000 }), context)).toBe("budget");
  });
});
