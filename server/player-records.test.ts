import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Store } from "./db.ts";
import { createCalendar } from "./calendar.ts";
import { callUpPlayer, endCallUp } from "./callups.ts";
import { clubTransfers } from "./club-transfers.ts";
import { playerHistory } from "./player-history.ts";
import {
  MILESTONE_THRESHOLDS,
  detectMilestones,
  ensurePlayerRecords,
  injuryKind,
  injurySeverity,
  playerMedical,
  recordPlayerRecords,
  type MilestoneUnit,
} from "./player-records.ts";
import { advance } from "./simulation.ts";
import { stateOf } from "./systems.ts";
import { generateWorld } from "./world.ts";
import { addDays } from "../shared/rules.ts";
import type { Player } from "../shared/types.ts";

const unit = (overrides: Partial<MilestoneUnit>): MilestoneUnit => ({
  player_id: 1,
  club_id: 10,
  line: "club",
  fixture_id: 100,
  date: "2026-08-10",
  estimated: false,
  season: 2026,
  league_id: 5,
  competition: "Premier Division",
  apps: 1,
  goals: 0,
  line_before: 0,
  goals_before: 0,
  club_before: 0,
  fresh: true,
  fresh_intl: true,
  joined: false,
  ...overrides,
});
const kinds = (units: MilestoneUnit[]) =>
  detectMilestones(units).map((row) => [row.player_id, row.kind, row.club_id, row.value, row.date]);

describe("player records (no database)", () => {
  it("grades injuries by length and diagnoses them deterministically for their context", () => {
    expect([1, 7, 8, 28, 29, 90, 91, 150].map(injurySeverity)).toEqual([
      "minor", "minor", "moderate", "moderate", "serious", "serious", "long-term", "long-term",
    ]);
    const injury = { playerId: 42, start: "2026-09-12", days: 120, context: "match" as const };
    expect(injuryKind(injury)).toBe(injuryKind({ ...injury }));
    expect(["Cruciate ligament rupture", "Broken leg", "Achilles tendon rupture", "Cartilage damage"]).toContain(injuryKind(injury));
    const kinds = new Set(Array.from({ length: 40 }, (_, playerId) => injuryKind({ ...injury, playerId, days: 5, context: "training" })));
    expect(kinds.size).toBeGreaterThan(1);
    expect([...kinds].every((kind) => ["Muscle tightness", "Ankle knock", "Back spasm", "Minor muscle strain"].includes(kind))).toBe(true);
  });

  it("records a debut, first goal and counting milestones only for careers that began in the game", () => {
    expect(
      kinds([
        unit({ goals: 1 }),
        unit({ date: "2026-08-17", fixture_id: 101, club_id: 11, goals: 0 }),
        unit({ player_id: 2, fresh: false, joined: true, line_before: 120, club_before: 0 }),
        unit({ player_id: 3, fresh: false, joined: false, line_before: 0, club_before: 0 }),
      ]),
    ).toEqual([
      [1, "seniorDebut", 10, null, "2026-08-10"],
      [1, "firstGoal", 10, null, "2026-08-10"],
      [1, "clubDebut", 11, null, "2026-08-17"],
      // A veteran's first match for a club he joined is a club debut, never a career milestone.
      [2, "clubDebut", 10, null, "2026-08-10"],
    ]);
  });

  it("finds the appearance or season row where a threshold falls, per career and per club", () => {
    const rows = kinds([
      unit({ line_before: 49, club_before: 99, goals_before: 49, goals: 2, joined: true }),
      unit({ player_id: 4, line_before: 95, club_before: 95, apps: 30, goals: 3, goals_before: 0, estimated: true, date: "2028-06-30", fixture_id: null }),
    ]);
    expect(rows).toEqual([
      [1, "appearances", 10, 50, "2026-08-10"],
      [1, "goals", 10, 50, "2026-08-10"],
      [1, "clubAppearances", 10, 100, "2026-08-10"],
      [4, "appearances", 10, 100, "2028-06-30"],
      [4, "firstGoal", 10, null, "2028-06-30"],
      [4, "clubAppearances", 10, 100, "2028-06-30"],
    ]);
    expect(JSON.parse(detectMilestones([unit({ player_id: 4, apps: 30, line_before: 95, estimated: true, fixture_id: null })])[0].data)).toMatchObject({
      dateEstimated: true,
      competition: "Premier Division",
      season: 2026,
    });
    expect(MILESTONE_THRESHOLDS.appearances).toContain(100);
  });

  it("records international debuts, caps and first goals only for international careers that began in the game", () => {
    expect(
      kinds([
        unit({ line: "cap", club_id: 900, goals: 1 }),
        unit({ player_id: 3, line: "cap", club_id: 900, line_before: 24, club_before: 24, date: "2026-09-01", fixture_id: 102, goals_before: 1, goals: 1 }),
        unit({ player_id: 5, line: "youthCap", club_id: 901, club_before: 0 }),
        unit({ player_id: 5, line: "youthCap", club_id: 901, club_before: 3, date: "2026-09-01" }),
        unit({ player_id: 6, line: "cap", club_id: 900, fresh_intl: false }),
      ]),
    ).toEqual([
      [1, "internationalDebut", 900, null, "2026-08-10"],
      [1, "firstInternationalGoal", 900, null, "2026-08-10"],
      [3, "caps", 900, 25, "2026-09-01"],
      [5, "internationalDebut", 901, null, "2026-08-10"],
    ]);
  });
});

// Runs with SQL only (npm run test:local, CI backend job).
describe.skipIf(process.env.SQL_INTEGRATION_TESTS !== "true")("player records in a running world", () => {
  let store: Store;
  beforeAll(async () => {
    store = await Store.createTest("player-records");
    await generateWorld(store, { nations: ["EN", "ES"] });
    await createCalendar(store);
  }, 600_000);
  afterAll(async () => await store?.close());

  const snapshot = async () => ({
    honours: await store.all("SELECT player_id, season, club_id, league_id, kind, title, data FROM player_honours ORDER BY player_id, season, kind, league_id"),
    milestones: await store.all("SELECT player_id, date, kind, club_id, value, data FROM player_milestones ORDER BY player_id, kind, club_id, value"),
  });

  it("records injuries, milestones and honours as the season runs, and a backfill rebuilds the same records", async () => {
    await advance(store, 28);
    await advance(store, 28);
    const state = await stateOf(store);

    const injuries = await store.all<{ player_id: number; start_date: string; end_date: string; kind: string; severity: string; data: string }>(
      "SELECT player_id, start_date, end_date, kind, severity, data FROM player_injuries ORDER BY id",
    );
    expect(injuries.length).toBeGreaterThan(0);
    const contexts = new Set(injuries.map((row) => (JSON.parse(row.data) as { context: string }).context));
    expect(contexts.has("match") || contexts.has("training")).toBe(true);
    for (const row of injuries) {
      const data = JSON.parse(row.data) as { days: number; context: "match" | "training" };
      expect(row.end_date > row.start_date).toBe(true);
      // Rehabilitation may bring the return forward; the diagnosis keeps the original length.
      expect(row.end_date <= addDays(row.start_date, data.days)).toBe(true);
      expect([row.severity, row.kind]).toEqual([
        injurySeverity(data.days),
        injuryKind({ playerId: row.player_id, start: row.start_date, days: data.days, context: data.context }),
      ]);
    }
    // Every running injury is on the books with the player's own return date.
    expect(
      (await store.get<{ total: number }>(
        `SELECT count(*) AS total FROM players WHERE injury_until > ? AND role <> 'Retired'
           AND NOT EXISTS (SELECT 1 FROM player_injuries WHERE player_injuries.player_id = players.id AND player_injuries.end_date = players.injury_until)`,
        state.date,
      ))!.total,
    ).toBe(0);
    const injured = (await store.get<{ player_id: number }>(
      "SELECT player_injuries.player_id FROM player_injuries JOIN players ON players.id = player_injuries.player_id WHERE players.injury_until > ? ORDER BY player_injuries.id LIMIT 1",
      state.date,
    ))!;
    const medical = await playerMedical(store, injured.player_id);
    expect(medical.current).toMatchObject({ ongoing: true, end: medical.injuredUntil });
    expect(medical.daysLeft).toBeGreaterThan(0);
    expect(medical.summary.injuries).toBe(medical.injuries.length);

    const milestones = await store.all<{ player_id: number; kind: string; birth_date: string; date: string }>(
      "SELECT player_milestones.player_id, player_milestones.kind, players.birth_date, player_milestones.date FROM player_milestones JOIN players ON players.id = player_milestones.player_id",
    );
    expect(milestones.some((row) => row.kind === "seniorDebut" || row.kind === "clubDebut")).toBe(true);
    // Senior debuts are only for players whose careers began in the game (under 20 when it started).
    for (const row of milestones.filter((entry) => entry.kind === "seniorDebut")) expect(row.birth_date > "2006-07-01").toBe(true);
    for (const row of milestones) expect(row.date <= state.date).toBe(true);

    // A league title: every player who appeared for the champions in the league gets the honour, graded by role.
    const title = (await store.get<{ league_id: number; club_id: number; season: number }>(
      `SELECT fixtures.league_id, fixtures.home_id AS club_id, fixtures.season FROM fixtures JOIN leagues ON leagues.id = fixtures.league_id
       WHERE fixtures.status = 'played' AND leagues.kind = 'league' AND leagues.age_group = 'Senior' ORDER BY fixtures.id LIMIT 1`,
    ))!;
    await store.transaction(async () => {
      await store.run(
        "INSERT INTO history (season, entity_type, entity_id, date, data) VALUES (?, 'league', ?, ?, ?)",
        title.season,
        title.league_id,
        state.date,
        JSON.stringify({ name: "Test league", table: [{ club_id: title.club_id, position: 1 }] }),
      );
      await recordPlayerRecords(store, state.date);
    });
    const winners = await store.all<{ player_id: number; appearances: number }>(
      `SELECT appearance.player_id, count(*) AS appearances FROM player_match_appearances AS appearance
       JOIN fixtures ON fixtures.id = appearance.fixture_id
       WHERE appearance.club_id = ? AND fixtures.league_id = ? AND appearance.minutes > 0 GROUP BY appearance.player_id`,
      title.club_id,
      title.league_id,
    );
    const honours = await store.all<{ player_id: number; kind: string; data: string }>(
      "SELECT player_id, kind, data FROM player_honours WHERE league_id = ? AND club_id = ?",
      title.league_id,
      title.club_id,
    );
    expect(honours.map((row) => row.player_id).sort()).toEqual(winners.map((row) => row.player_id).sort());
    expect(new Set(honours.map((row) => row.kind))).toEqual(new Set(["league"]));
    for (const honour of honours) {
      const data = JSON.parse(honour.data) as { appearances: number; matches: number; role: string };
      expect(data.appearances).toBe(winners.find((row) => row.player_id === honour.player_id)!.appearances);
      expect(data.role).toBe(data.appearances * 2 >= data.matches ? "regular" : data.appearances * 5 >= data.matches ? "squad" : "fringe");
    }
    const history = await playerHistory(store, honours[0].player_id);
    expect(history.honours).toEqual(
      expect.arrayContaining([expect.objectContaining({ kind: "league", club: expect.objectContaining({ id: title.club_id }) })]),
    );

    // Older worlds: the one-off backfill rebuilds the same honours and milestones from the stored statistics.
    const recorded = await snapshot();
    expect(recorded.milestones.length).toBeGreaterThan(0);
    await store.exec("DELETE FROM player_honours; DELETE FROM player_milestones; DELETE FROM meta WHERE key = 'playerRecords'");
    await ensurePlayerRecords(store);
    expect(await snapshot()).toEqual(recorded);
    await ensurePlayerRecords(store);
    expect(await snapshot()).toEqual(recorded);
  }, 900_000);

  it("keeps a youth player's call-ups out of his transfers and the club's transfer list", async () => {
    const { clubId, date } = await stateOf(store);
    const player = (await store.get<Player>(
      "SELECT * FROM players WHERE club_id = ? AND squad_club_id IS NULL AND age_group = 'U19' AND role != 'Retired' AND parent_club_id IS NULL AND (injury_until IS NULL OR injury_until <= ?) ORDER BY ability DESC, id LIMIT 1",
      clubId,
      date,
    ))!;
    await store.transaction(() => callUpPlayer(store, { playerId: player.id, clubId, ageGroup: "Senior", duration: { kind: "days", days: 3 } }));
    await store.transaction(() => endCallUp(store, player.id));
    const history = await playerHistory(store, player.id);
    expect(history.transfers.every((move) => move.from?.id !== move.to?.id)).toBe(true);
    expect(history.transfers.some((move) => move.date === date && move.to?.id === clubId)).toBe(false);
    expect(history.squadMoves.at(-1)).toMatchObject({
      kind: "callUp",
      date,
      fromGroup: "U19",
      toGroup: "Senior",
      direction: "up",
      returnedOn: date,
      days: 0,
    });
    const transfers = await clubTransfers(store, clubId, {});
    const listed = transfers.groups.flatMap((group) => group.transfers);
    expect(listed.some((move) => move.player.id === player.id && move.date === date)).toBe(false);
    expect(transfers.squadMoves.moves[0]).toMatchObject({ kind: "callUp", player: { id: player.id }, returnedOn: date });
    expect(transfers.squadMoves.total).toBeGreaterThanOrEqual(1);
  }, 300_000);
});
