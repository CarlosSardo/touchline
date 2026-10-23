import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { Store } from "./db.ts";
import { createCalendar } from "./calendar.ts";
import { callUpDesk, callUpPlayer, endAllCallUps, endCallUp, processCallUps, seasonPhase, setDevelopmentRequest } from "./callups.ts";
import { stateOf } from "./systems.ts";
import { updateSettings } from "./app.ts";
import { generateWorld } from "./world.ts";
import type { Fixture, Player } from "../shared/types.ts";

// Runs with SQL only (npm run test:local, CI backend job); the pure rules live in callups.test.ts.
describe.skipIf(process.env.SQL_INTEGRATION_TESTS !== "true")("call-ups in the user's club family", () => {
  let store: Store;
  let clubId: number;

  beforeAll(async () => {
    store = await Store.createTest("callups");
  });
  afterAll(async () => await store?.close());

  const setDate = async (date: string) => store.setMeta("state", { ...(await stateOf(store)), date });
  const nextFixture = async (ageGroup: string) =>
    (await store.get<Fixture>(
      "SELECT fixtures.* FROM fixtures LEFT JOIN leagues ON leagues.id = fixtures.league_id WHERE fixtures.status = 'scheduled' AND (home_id = ? OR away_id = ?) AND coalesce(leagues.age_group,'Senior') = ? ORDER BY date,id LIMIT 1",
      clubId,
      clubId,
      ageGroup,
    ))!;
  const bestOf = async (ageGroup: string) =>
    (await store.get<Player>(
      "SELECT * FROM players WHERE club_id = ? AND squad_club_id IS NULL AND age_group = ? AND role != 'Retired' AND parent_club_id IS NULL ORDER BY ability DESC,id LIMIT 1",
      clubId,
      ageGroup,
    ))!;
  const squadRows = async (playerId: number) =>
    (await store.all<{ data: string }>("SELECT data FROM history WHERE entity_type = 'squad' AND entity_id = ? ORDER BY id", playerId)).map(
      (row) => JSON.parse(row.data) as Record<string, unknown>,
    );

  beforeEach(async () =>
    store.transaction(async () => {
      await store.clearWorld();
      await store.schema();
      await generateWorld(store, { nations: ["EN", "ES"] });
      await createCalendar(store);
      clubId = (await stateOf(store)).clubId;
    }),
  );

  it("calls a U17 player up for the next U19 match and returns him after it", async () => {
    const fixture = await nextFixture("U19");
    expect(fixture).toBeTruthy();
    const player = await bestOf("U17");
    await store.transaction(() => callUpPlayer(store, { playerId: player.id, clubId, ageGroup: "U19", duration: { kind: "match" } }));
    expect((await store.get<Player>("SELECT * FROM players WHERE id = ?", player.id))!.age_group).toBe("U19");
    const desk = await callUpDesk(store);
    expect(desk.active).toMatchObject([{ playerId: player.id, duration: "match", fixtureId: fixture.id, by: "user", from: { ageGroup: "U17" } }]);
    expect((await squadRows(player.id)).at(-1)).toMatchObject({ callUp: true, until: fixture.date, ageGroup: "U19" });

    // Before the match nothing changes; once it is played he goes back the next day.
    await setDate(fixture.date);
    await store.transaction(() => processCallUps(store));
    expect((await callUpDesk(store)).active).toHaveLength(1);
    await store.run("UPDATE fixtures SET status = 'played', home_goals = 1, away_goals = 0 WHERE id = ?", fixture.id);
    await store.transaction(() => processCallUps(store));
    expect((await store.get<Player>("SELECT * FROM players WHERE id = ?", player.id))!.age_group).toBe("U17");
    expect((await callUpDesk(store)).active).toEqual([]);
    expect((await squadRows(player.id)).at(-1)).toMatchObject({ callUpReturn: true, ageGroup: "U17" });
  });

  it("keeps a period call-up until its last day and lets the director end it early", async () => {
    const player = await bestOf("U19");
    const { date } = await stateOf(store);
    await store.transaction(() => callUpPlayer(store, { playerId: player.id, clubId, ageGroup: "Senior", duration: { kind: "days", days: 3 } }));
    const [entry] = (await callUpDesk(store)).active;
    expect(entry).toMatchObject({ duration: "until", to: { ageGroup: "Senior" } });
    await setDate(entry.until);
    await store.transaction(() => processCallUps(store));
    expect((await callUpDesk(store)).active).toHaveLength(1);
    await store.transaction(() => endCallUp(store, player.id));
    expect((await store.get<Player>("SELECT * FROM players WHERE id = ?", player.id))!.age_group).toBe("U19");
    expect(entry.since).toBe(date);
  });

  it("flags an academy debut only for an academy-age player without first-team senior games anywhere", async () => {
    const [prospect, veteran, travelled] = await store.all<Player>(
      "SELECT * FROM players WHERE club_id = ? AND squad_club_id IS NULL AND age_group = 'U19' AND role != 'Retired' AND parent_club_id IS NULL ORDER BY ability DESC,id LIMIT 3",
      clubId,
    );
    await store.run("UPDATE players SET birth_date = '2003-01-01' WHERE id = ?", veteran.id);
    const other = (await store.get<{ id: number; league_id: number }>(
      "SELECT clubs.id,clubs.league_id FROM clubs JOIN leagues ON leagues.id = clubs.league_id WHERE clubs.type = 'club' AND clubs.id != ? AND leagues.age_group = 'Senior' ORDER BY clubs.id LIMIT 1",
      clubId,
    ))!;
    await store.run(
      "INSERT INTO player_season_stats (player_id,season,club_id,league_id,minutes,appearances,goals,assists) VALUES (?,?,?,?,90,1,0,0)",
      travelled.id,
      (await stateOf(store)).season - 1,
      other.id,
      other.league_id,
    );
    // Generated first teams can sit near the 32-player cap: leave room for three call-ups.
    const { count } = (await store.get<{ count: number }>(
      "SELECT count(*) AS count FROM players WHERE playing_club_id = ? AND age_group = 'Senior' AND role != 'Retired'",
      clubId,
    ))!;
    if (count > 29)
      await store.run(
        "UPDATE players SET role = 'Retired' WHERE id IN (SELECT id FROM players WHERE playing_club_id = ? AND age_group = 'Senior' AND role != 'Retired' LIMIT ?)",
        clubId,
        count - 29,
      );
    for (const player of [prospect, veteran, travelled])
      await store.transaction(() => callUpPlayer(store, { playerId: player.id, clubId, ageGroup: "Senior", duration: { kind: "days", days: 3 } }));
    const debut = new Map((await callUpDesk(store)).active.map((entry) => [entry.playerId, !!entry.debut]));
    expect(debut.get(prospect.id)).toBe(true);
    expect(debut.get(veteran.id)).toBe(false);
    expect(debut.get(travelled.id)).toBe(false);
  });

  it("refuses over-age, injured and non-family moves", async () => {
    const u19 = await bestOf("U19");
    const oldest = (await store.get<Player>(
      "SELECT * FROM players WHERE club_id = ? AND age_group = 'U19' AND role != 'Retired' ORDER BY birth_date,id LIMIT 1",
      clubId,
    ))!;
    await expect(
      store.transaction(() => callUpPlayer(store, { playerId: oldest.id, clubId, ageGroup: "U17", duration: { kind: "days", days: 7 } })),
    ).rejects.toThrow(/U17/);
    await store.run("UPDATE players SET injury_until = '2027-06-01' WHERE id = ?", u19.id);
    await expect(
      store.transaction(() => callUpPlayer(store, { playerId: u19.id, clubId, ageGroup: "Senior", duration: { kind: "days", days: 7 } })),
    ).rejects.toThrow(/injured/);
    const other = (await store.get<{ id: number }>("SELECT id FROM clubs WHERE type = 'club' AND id != ? LIMIT 1", clubId))!;
    await expect(
      store.transaction(() => callUpPlayer(store, { playerId: u19.id, clubId: other.id, ageGroup: "Senior", duration: { kind: "match" } })),
    ).rejects.toThrow(/your club/);
  });

  it("refuses a senior call-up below the association's minimum age", async () => {
    const youngest = await bestOf("U17");
    const { date } = await stateOf(store);
    const fourteen = `${Number(date.slice(0, 4)) - 14}${date.slice(4)}`;
    await store.run("UPDATE players SET birth_date = ? WHERE id = ?", fourteen, youngest.id);
    await expect(
      store.transaction(() => callUpPlayer(store, { playerId: youngest.id, clubId, ageGroup: "Senior", duration: { kind: "days", days: 7 } })),
    ).rejects.toThrow(/too young for senior football \(minimum age 15\)/);
  });

  it("follows a development request with the coach's verdict and keeps it over the rollover", async () => {
    const u19 = await bestOf("U19");
    await store.transaction(() => setDevelopmentRequest(store, u19.id, true));
    expect((await callUpDesk(store)).requests).toMatchObject([{ playerId: u19.id, fromLabel: expect.stringContaining("U19") }]);
    const senior = await bestOf("Senior");
    await expect(store.transaction(() => setDevelopmentRequest(store, senior.id, true))).rejects.toThrow(/already in the first team/);
    const fixture = await nextFixture("Senior");
    await setDate(fixture.date);
    await store.transaction(() => processCallUps(store));
    const [request] = (await callUpDesk(store)).requests ?? [];
    expect(request).toMatchObject({ playerId: u19.id, checked: fixture.date });
    expect(request.status).toMatch(/First team: /);
    await endAllCallUps(store);
    expect((await callUpDesk(store)).requests?.map((entry) => entry.playerId)).toEqual([u19.id]);
    await store.transaction(() => setDevelopmentRequest(store, u19.id, false));
    expect((await callUpDesk(store)).requests).toEqual([]);
  });

  it("the coach proposes cover when automatic call-ups are off and calls up himself when on", async () => {
    const fixture = await nextFixture("Senior");
    await setDate(fixture.date);
    await store.run(
      "UPDATE players SET injury_until = '2027-06-01' WHERE club_id = ? AND squad_club_id IS NULL AND age_group = 'Senior' AND position IN ('CB','LB','RB')",
      clubId,
    );
    await store.transaction(() => updateSettings(store, { autoCallUps: false }));
    await store.transaction(() => processCallUps(store));
    const proposals = (await callUpDesk(store)).proposals;
    expect(proposals.length).toBeGreaterThan(0);
    expect(proposals.every((proposal) => proposal.reason === "need" && proposal.to.ageGroup === "Senior")).toBe(true);
    expect((await callUpDesk(store)).active).toEqual([]);

    await store.setMeta("callUps", { season: (await stateOf(store)).season, active: [], proposals: [], debuts: {}, vetoes: {} });
    await store.transaction(() => updateSettings(store, { autoCallUps: true }));
    await store.transaction(() => processCallUps(store));
    const active = (await callUpDesk(store)).active;
    expect(active.length).toBeGreaterThan(0);
    expect(active.every((entry) => entry.by === "coach" && entry.duration === "match" && entry.fixtureId === fixture.id)).toBe(true);
    expect(await endAllCallUps(store)).toBe(active.length);
    expect((await callUpDesk(store)).active).toEqual([]);
  });

  it("reads end-of-season standings net of points deductions", async () => {
    const state = await stateOf(store);
    const league = (await store.get<{ league_id: number; group_name: string }>(
      "SELECT standings.league_id, standings.group_name FROM standings JOIN leagues ON leagues.id = standings.league_id WHERE standings.club_id = ? AND leagues.age_group = 'Senior' AND leagues.kind = 'league'",
      clubId,
    ))!;
    // Two league games left for the club.
    const left = await store.all<{ id: number }>(
      "SELECT id FROM fixtures WHERE league_id = ? AND season = ? AND status = 'scheduled' AND (home_id = ? OR away_id = ?) ORDER BY date, id",
      league.league_id,
      state.season,
      clubId,
      clubId,
    );
    await store.run("UPDATE fixtures SET status = 'played' WHERE id = ANY(?::integer[])", left.slice(2).map((row) => row.id));
    const rival = (await store.get<{ club_id: number }>(
      "SELECT club_id FROM standings WHERE league_id = ? AND group_name = ? AND club_id <> ? ORDER BY club_id LIMIT 1",
      league.league_id,
      league.group_name,
      clubId,
    ))!.club_id;
    await store.run("UPDATE standings SET played = 30, points = 0, deducted = 0 WHERE league_id = ? AND group_name = ?", league.league_id, league.group_name);
    await store.run("UPDATE standings SET points = 46 WHERE league_id = ? AND club_id = ?", league.league_id, clubId);
    // The rival's 40 points are already net of a 6-point deduction: two wins would draw level, so nothing is settled.
    await store.run("UPDATE standings SET points = 40, deducted = 6 WHERE league_id = ? AND club_id = ?", league.league_id, rival);
    const phase = await seasonPhase(store, { clubId, ageGroup: "Senior" }, state.season);
    expect(phase).toMatchObject({ endOfSeason: true, remaining: 2, deadRubber: false });
    await store.run("UPDATE standings SET points = 39 WHERE league_id = ? AND club_id = ?", league.league_id, rival);
    expect((await seasonPhase(store, { clubId, ageGroup: "Senior" }, state.season)).deadRubber).toBe(true);
  });
});
