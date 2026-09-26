import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Store } from "./db.ts";
import { generateWorld } from "./world.ts";
import { countryPyramid, scheduleDomesticLeague } from "./calendar.ts";
import { seasonRollover } from "./simulation.ts";
import { stateOf } from "./systems.ts";
import { checkMovement, leagueSizes, seniorPlaces } from "./check-simulation.ts";
import { planMovement, type Move } from "../shared/league-rules.ts";
import type { League } from "../shared/types.ts";

// NL: Jong sides in the lowest modeled tier (parked when the parent drops onto it). ES: a B-team in a middle tier.
const NATIONS = ["NL", "ES"];

interface ClubRow {
  id: number;
  type: string;
  parent_id: number | null;
  league_id: number | null;
  data: string;
}

describe("B-team movement at the rollover (SQL)", () => {
  let store: Store;
  let initialSizes: Map<number, number>;
  let user: number;
  let jong: number;
  let jongParent: number;
  const leagueOf = async (code: string, tier: number) =>
    (await store.get<League>(
      "SELECT leagues.* FROM leagues JOIN countries ON countries.id = leagues.country_id WHERE countries.code = ? AND leagues.kind = 'league' AND leagues.age_group = 'Senior' AND leagues.tier = ?",
      code,
      tier,
    ))!;
  const clubOf = async (id: number) =>
    (await store.get<ClubRow>("SELECT id,type,parent_id,league_id,data FROM clubs WHERE id = ?", id))!;
  const members = async (leagueId: number) =>
    (await store.all<{ club_id: number }>("SELECT club_id FROM standings WHERE league_id = ? ORDER BY club_id", leagueId)).map(
      (row) => row.club_id,
    );
  const bTeams = async (code: string) =>
    store.all<ClubRow>(
      "SELECT clubs.id,clubs.type,clubs.parent_id,clubs.league_id,clubs.data FROM clubs JOIN countries ON countries.id = clubs.country_id WHERE countries.code = ? AND clubs.type = 'bteam' ORDER BY clubs.id",
      code,
    );
  /** Final table in this order: points fall by one per place, so no tiebreaker decides. */
  const finish = async (leagueId: number, order: readonly number[]) => {
    expect([...order].sort((left, right) => left - right)).toEqual(await members(leagueId));
    for (const [index, clubId] of order.entries())
      await store.run("UPDATE standings SET points = ? WHERE league_id = ? AND club_id = ?", 1000 - index, leagueId, clubId);
  };
  /**
   * Plans each country's movement from the same pyramid the rollover reads, runs the rollover and checks that the
   * SQL applied exactly the plan (moves, parked and re-admitted B-teams, everyone else in place) and invariant 6.
   */
  const rollover = async () => {
    const state = await stateOf(store);
    const planned = new Map<string, Move[]>();
    for (const code of NATIONS) {
      const country = (await store.get<{ id: number }>("SELECT id FROM countries WHERE code = ?", code))!;
      planned.set(code, planMovement(await countryPyramid(store, country.id, state.season)));
    }
    const before = await seniorPlaces(store);
    await store.setMeta("state", { ...state, date: `${state.season + 1}-07-01` });
    await seasonRollover(store);
    const moves = [...planned.values()].flat();
    for (const move of moves) {
      const club = await clubOf(move.clubId);
      expect([club.league_id, JSON.parse(club.data).parkedLeagueId ?? null], `club ${move.clubId} (${move.reason})`).toEqual(
        move.to === null ? [null, move.parkedIn] : [move.to, null],
      );
    }
    const moved = new Set(moves.map((move) => move.clubId));
    const after = new Map((await seniorPlaces(store)).map((place) => [place.club_id, place.league_id]));
    for (const place of before.filter((entry) => !moved.has(entry.club_id)))
      expect(after.get(place.club_id), `club ${place.club_id} stays`).toBe(place.league_id);
    await checkMovement(store, before, initialSizes);
    return planned;
  };

  beforeAll(async () => {
    store = await Store.createTest("movement");
    await generateWorld(store, { nations: NATIONS, squads: "minimum" });
    initialSizes = leagueSizes(await seniorPlaces(store));
    user = (await stateOf(store)).clubId;
  }, 600_000);
  afterAll(async () => {
    await store?.close();
  });

  it("parks a Jong side whose parent drops onto the lowest tier and pushes a middle-tier B-team down with an RFEF reprieve", async () => {
    const eredivisie = await leagueOf("NL", 1);
    const eerste = await leagueOf("NL", 2);
    const jongs = (await bTeams("NL")).filter((club) => club.league_id === eerste.id);
    const target = jongs.find((club) => club.parent_id !== user)!;
    expect(target).toBeDefined();
    jong = target.id;
    jongParent = target.parent_id!;
    const jongParents = new Set(jongs.map((club) => club.parent_id));
    // Other Jong parents finish on top, so the only B-team parent in the drop zone is this one.
    const top = await members(eredivisie.id);
    await finish(eredivisie.id, [
      ...top.filter((id) => jongParents.has(id) && id !== jongParent),
      ...top.filter((id) => !jongParents.has(id)),
      jongParent,
    ]);
    const second = (await members(eerste.id)).filter((id) => id !== jong);
    await finish(eerste.id, [...second.slice(0, 9), jong, ...second.slice(9)]);

    const laliga = await leagueOf("ES", 1);
    const segunda = await leagueOf("ES", 2);
    const primera = await leagueOf("ES", 3);
    const spanish = await bTeams("ES");
    const reserve = spanish.find((club) => club.league_id === segunda.id)!;
    expect(reserve).toBeDefined();
    const parent = reserve.parent_id!;
    expect((await clubOf(parent)).league_id).toBe(laliga.id);
    await finish(laliga.id, [...(await members(laliga.id)).filter((id) => id !== parent), parent]);
    // Relegated Segunda clubs without a B-team, so no other ceiling move is involved; the B-team finishes mid-table.
    const parents = new Set(spanish.map((club) => club.parent_id));
    const rest = (await members(segunda.id)).filter((id) => id !== reserve.id);
    const relegated = rest.filter((id) => !parents.has(id) && id !== user).slice(-4);
    const safe = rest.filter((id) => !relegated.includes(id));
    await finish(segunda.id, [...safe.slice(0, 9), reserve.id, ...safe.slice(9), ...relegated]);

    const planned = await rollover();
    const nl = planned.get("NL")!;
    expect(nl.find((move) => move.clubId === jongParent)).toMatchObject({ from: eredivisie.id, to: eerste.id, promoted: false });
    expect(nl.find((move) => move.clubId === jong)).toEqual({
      clubId: jong,
      from: eerste.id,
      to: null,
      parkedIn: eerste.id,
      promoted: false,
      reason: "parked",
    });
    expect(nl.filter((move) => move.reason === "parked")).toHaveLength(1);
    expect((await clubOf(jongParent)).league_id).toBe(eerste.id);
    const parked = await clubOf(jong);
    expect([parked.type, parked.parent_id, parked.league_id, JSON.parse(parked.data).parkedLeagueId]).toEqual([
      "bteam",
      jongParent,
      null,
      eerste.id,
    ]);
    expect((await seniorPlaces(store)).filter((place) => place.club_id === jong)).toEqual([]);
    expect(await members(eerste.id)).toHaveLength(initialSizes.get(eerste.id)! - 1);
    // Domestic schedules as the calendar makes them (newcomers get their conference): the tier plays one short.
    const season = (await stateOf(store)).season;
    for (const league of await store.all<League>(
      "SELECT leagues.* FROM leagues JOIN countries ON countries.id = leagues.country_id WHERE countries.code IN ('NL','ES') AND leagues.kind = 'league' AND leagues.age_group = 'Senior' ORDER BY leagues.id",
    ))
      await scheduleDomesticLeague(store, league, season);
    const fixtures = await store.all<{ club_id: number; total: number }>(
      "SELECT clubs.id AS club_id,count(fixtures.id) AS total FROM clubs LEFT JOIN fixtures ON fixtures.league_id = ? AND fixtures.season = ? AND clubs.id IN (fixtures.home_id,fixtures.away_id) WHERE clubs.id = ? OR clubs.id IN (SELECT club_id FROM standings WHERE league_id = ?) GROUP BY clubs.id",
      eerste.id,
      season,
      jong,
      eerste.id,
    );
    expect(fixtures.find((row) => row.club_id === jong)?.total).toBe(0);
    const played = fixtures.filter((row) => row.club_id !== jong).map((row) => row.total);
    expect(played).toHaveLength(initialSizes.get(eerste.id)! - 1);
    expect(played[0]).toBeGreaterThan(0);
    expect(new Set(played).size).toBe(1);

    const es = planned.get("ES")!;
    expect(es.find((move) => move.clubId === parent)).toMatchObject({ from: laliga.id, to: segunda.id, promoted: false });
    expect(es.find((move) => move.clubId === reserve.id)).toMatchObject({
      from: segunda.id,
      to: primera.id,
      promoted: false,
      reason: "reserve-ceiling",
    });
    // The best-placed relegated club is reprieved; the other three go down.
    expect(es.find((move) => move.clubId === relegated[0])).toBeUndefined();
    for (const id of relegated.slice(1)) expect(es.find((move) => move.clubId === id)).toMatchObject({ from: segunda.id, to: primera.id });
    expect([(await clubOf(parent)).league_id, (await clubOf(reserve.id)).league_id, (await clubOf(relegated[0])).league_id]).toEqual([
      segunda.id,
      primera.id,
      segunda.id,
    ]);
    expect(await members(segunda.id)).toHaveLength(initialSizes.get(segunda.id)!);
  });

  it("re-admits the parked Jong side to the league it left once its parent goes back up", async () => {
    const eredivisie = await leagueOf("NL", 1);
    const eerste = await leagueOf("NL", 2);
    const jongParents = new Set((await bTeams("NL")).map((club) => club.parent_id));
    const top = await members(eredivisie.id);
    await finish(eredivisie.id, [...top.filter((id) => jongParents.has(id)), ...top.filter((id) => !jongParents.has(id))]);
    await finish(eerste.id, [jongParent, ...(await members(eerste.id)).filter((id) => id !== jongParent)]);

    const nl = (await rollover()).get("NL")!;
    expect(nl.find((move) => move.clubId === jongParent)).toMatchObject({ from: eerste.id, to: eredivisie.id, promoted: true });
    expect(nl.find((move) => move.clubId === jong)).toEqual({
      clubId: jong,
      from: null,
      to: eerste.id,
      promoted: false,
      reason: "readmitted",
    });
    const readmitted = await clubOf(jong);
    expect([readmitted.league_id, JSON.parse(readmitted.data).parkedLeagueId]).toEqual([eerste.id, undefined]);
    expect(await members(eerste.id)).toContain(jong);
    expect(await members(eerste.id)).toHaveLength(initialSizes.get(eerste.id)!);
    expect(await members(eredivisie.id)).toContain(jongParent);
  });
});
