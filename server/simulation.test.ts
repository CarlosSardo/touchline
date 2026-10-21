import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Store } from "./db.ts";
import { tableName } from "./sql-schema.ts";
import { generateWorld } from "./world.ts";
import {
  createCalendar,
  scheduleKnockout,
  progressCompetitions,
  COMPETITIONS,
} from "./calendar.ts";
import seedrandom from "seedrandom";
import {
  advance,
  developPlayers,
  playFixture,
  seasonRollover,
  worldTransfers,
} from "./simulation.ts";
import { clubOf, enquire, negotiate, negotiationStep, stateOf } from "./systems.ts";
import { playerCareer } from "./queries.ts";
import { MATCH_RULES_VERSION, simulateMatch } from "./match.ts";
import { estimateClubRevenue } from "./finance.ts";
import { addDays, ageOn } from "../shared/rules.ts";
import { checkMinors, checkSquads } from "./check-simulation.ts";
import {
  JOURNALISTS,
  mediaFeed,
  publishClubRoundup,
  publishPlayerCoverage,
  publishTransferStory,
} from "./media.ts";
import type {
  Fixture,
  MatchSnapshot,
  Negotiation,
  NegotiationData,
  Player,
  PlayerProfile,
  Standing,
} from "../shared/types.ts";

async function expectSchemaIntegrity(store: Store) {
  expect(
    (await store.get<{ count: number }>(
      "SELECT count(*) AS count FROM pg_catalog.pg_tables WHERE schemaname = ?",
      store.schemaName,
    ))!.count,
  ).toBeGreaterThan(0);
  // PostgreSQL enforces every validated constraint on write; only NOT VALID constraints or disabled FK triggers could admit bad rows.
  expect(
    await store.all(
      `SELECT constraint_row.conname FROM pg_catalog.pg_constraint AS constraint_row
       JOIN pg_catalog.pg_namespace AS namespace ON namespace.oid = constraint_row.connamespace
       WHERE namespace.nspname = ? AND (NOT constraint_row.convalidated OR EXISTS (
         SELECT 1 FROM pg_catalog.pg_trigger AS trigger_row
         WHERE trigger_row.tgconstraint = constraint_row.oid AND trigger_row.tgenabled = 'D'))`,
      store.schemaName,
    ),
  ).toEqual([]);
}

describe("connected simulation", () => {
  let store: Store;
  beforeAll(async () => {
    store = await Store.createTest("simulation");
    await generateWorld(store, { nations: ["EN", "ES"] });
    await createCalendar(store);
  });
  afterAll(async () => {
    await store?.close();
  });

  it("advances the calendar, develops players, updates market values and persists weekly accounts", async () => {
    // Player 1 is now an elite player at the 99 ceiling, where upward drift is clamped away: sample squads instead.
    const before = await store.all<{ id: number; potential: number }>(
      "SELECT id,potential FROM players WHERE club_id IS NOT NULL AND age <= 21 AND potential < 95 AND role != 'Retired' ORDER BY id LIMIT 40",
    );
    const result = await advance(store, 7);
    expect(result.date).toBe("2026-07-08");
    expect((await stateOf(store)).week).toBe(1);
    const after = new Map(
      (await store.all<{ id: number; potential: number }>(
        `SELECT id,potential FROM players WHERE id IN (${before.map(() => "?").join(",")})`,
        ...before.map((player) => player.id),
      )).map((player) => [player.id, player.potential]),
    );
    expect(before.some((player) => after.get(player.id) !== player.potential)).toBe(true);
    expect(
      await store.all(
        "SELECT * FROM ledger WHERE club_id = 1 AND category = 'Player & staff wages'",
      ),
    ).toHaveLength(1);
    expect(
      await store.all(
        "SELECT * FROM players WHERE ability < 1 OR ability > 99 OR potential < ability OR potential > 99",
      ),
    ).toHaveLength(0);
    const club = (await store.get<import("../shared/types.ts").Club>(
      "SELECT * FROM clubs WHERE id = 1",
    ))!;
    const league = (await store.get<import("../shared/types.ts").League>(
      "SELECT * FROM leagues WHERE id = ?", club.league_id,
    ))!;
    const homeMatches = (await store.get<{ total: number }>(
      "SELECT count(*) AS total FROM fixtures LEFT JOIN leagues ON leagues.id = fixtures.league_id WHERE fixtures.home_id = 1 AND fixtures.status = 'played' AND fixtures.date > '2026-07-01' AND fixtures.date <= '2026-07-08' AND (leagues.age_group = 'Senior' OR fixtures.league_id IS NULL)",
    ))!.total;
    const revenue = estimateClubRevenue({
      reputation: club.reputation,
      leagueReputation: league.reputation,
      tier: league.tier,
      capacity: club.capacity,
      fanMood: club.fan_mood,
      homeMatches,
    });
    expect((await store.get<{ amount: number }>(
      "SELECT amount FROM ledger WHERE club_id = 1 AND category = 'Sponsorship & broadcasting'",
    ))!.amount).toBe(Math.round(revenue.annualCommercial / 52));
    expect((await store.get<{ amount: number }>(
      "SELECT amount FROM ledger WHERE club_id = 1 AND category = 'Matchday income'",
    ))!.amount).toBe(revenue.annualMatchday);
  });

  it("updates a complete league table from the same result used by match analytics", async () => {
    // Only the user's fixtures keep the snapshot and full stats; the rest are stored compact.
    const fixture = (await store.get<Fixture>(
      "SELECT * FROM fixtures WHERE ?::integer IN (home_id, away_id) AND stage = 'League' AND status = 'scheduled' ORDER BY date, id LIMIT 1",
      (await stateOf(store)).clubId,
    ))!;
    await playFixture(store, fixture);
    const result = (await store.get<Fixture>(
      "SELECT * FROM fixtures WHERE id = ?",
      fixture.id,
    ))!;
    const home = (await store.get<Standing>(
      "SELECT * FROM standings WHERE league_id = ? AND club_id = ?",
      fixture.league_id,
      fixture.home_id,
    ))!;
    const away = (await store.get<Standing>(
      "SELECT * FROM standings WHERE league_id = ? AND club_id = ?",
      fixture.league_id,
      fixture.away_id,
    ))!;
    expect(home.played).toBe(1);
    expect(away.played).toBe(1);
    expect(home.gf).toBe(result.home_goals);
    expect(home.ga).toBe(away.gf);
    expect(home.wins + home.draws + home.losses).toBe(home.played);
    expect(home.points + away.points).toBe(
      result.home_goals === result.away_goals ? 2 : 3,
    );
    expect(home.form).toHaveLength(1);
    expect(
      home.home_record
        .split("-")
        .map(Number)
        .reduce((sum, value) => sum + value, 0),
    ).toBe(1);
    expect(home.xg).toBe(result.home_xg);
    expect(home.xpts).toBeGreaterThanOrEqual(0);
    expect(home.xpts).toBeLessThanOrEqual(3);
    expect(JSON.parse(result.data).snapshot.rulesVersion).toBe(MATCH_RULES_VERSION);
    expect(JSON.parse(result.data).substitutions.length).toBeGreaterThan(0);
    const snapshot = JSON.parse(result.data).snapshot;
    const awayPlayer = snapshot.away.lineup[0];
    const career = await playerCareer(store, awayPlayer.id, { season: 2026 });
    expect(
      career.appearances.some(
        (appearance) => appearance.fixture_id === fixture.id,
      ),
    ).toBe(true);
    const appearance = career.appearances.find(
      (entry) => entry.fixture_id === fixture.id,
    )!;
    expect(appearance.minutes).toBe(
      JSON.parse(result.data).players[awayPlayer.id].minutes,
    );
    expect(appearance.stats.passes).toBe(
      JSON.parse(result.data).players[awayPlayer.id].passes,
    );
    expect(
      (await store.get<{ count: number }>(
        "SELECT count(*) AS count FROM player_match_appearances WHERE fixture_id = ?",
        fixture.id,
      ))!.count,
    ).toBeGreaterThan(22);
    await playFixture(store, result);
    expect(
      (await store.get<Standing>(
        "SELECT * FROM standings WHERE league_id = ? AND club_id = ?",
        fixture.league_id,
        fixture.home_id,
      ))!.played,
    ).toBe(1);
  });

  it("backfills legacy saves without rewriting snapshots or duplicating appearances", async () => {
    const fixture = (await store.get<Fixture>(
      "SELECT * FROM fixtures WHERE status = 'played' AND jsonb_typeof(data::jsonb -> 'snapshot') = 'object' ORDER BY id LIMIT 1",
    ))!;
    const snapshot: MatchSnapshot = {
      ...JSON.parse(fixture.data).snapshot,
      rulesVersion: 2,
    };
    const legacy = simulateMatch(snapshot, "legacy-appearance-index");
    const legacyId = Number(
      (
        await store.run(
          "INSERT INTO fixtures(league_id,home_id,away_id,date,season,round,stage,seed,status,home_goals,away_goals,data) VALUES (?,?,?,?,?,?,'Legacy match',?,'played',?,?,?)",
          fixture.league_id,
          fixture.home_id,
          fixture.away_id,
          fixture.date,
          fixture.season,
          fixture.round,
          "legacy-appearance-index",
          legacy.homeGoals,
          legacy.awayGoals,
          JSON.stringify({ ...legacy, snapshot }),
        )
      ).lastInsertRowid,
    );
    // The backfill re-serializes stats through jsonb (different key order and spacing), so compare them as JSON.
    const appearanceRows = async (sql: string, ...params: number[]) =>
      (await store.all<{ stats: string }>(sql, ...params)).map((row) => ({ ...row, stats: JSON.parse(row.stats) as unknown }));
    const originals = await appearanceRows(
      "SELECT * FROM player_match_appearances ORDER BY fixture_id,player_id",
    );
    const snapshots = await store.all(
      "SELECT id,data FROM fixtures WHERE status = 'played' ORDER BY id",
    );
    // A legacy save has full data for every fixture; compact (non-user) fixtures keep their rows because they cannot be rebuilt.
    await store.run(
      "DELETE FROM player_match_appearances WHERE fixture_id IN (SELECT id FROM fixtures WHERE jsonb_typeof(data::jsonb -> 'players') IN ('object', 'array'))",
    );
    await store.run("DELETE FROM meta WHERE key = 'appearanceIndexVersion'");
    await store.schema();
    expect(
      await appearanceRows(
        "SELECT * FROM player_match_appearances WHERE fixture_id != ? ORDER BY fixture_id,player_id",
        legacyId,
      ),
    ).toEqual(originals);
    const player = snapshot.away.lineup[0];
    const appearance = (
      await playerCareer(store, player.id, {
        season: fixture.season,
      })
    ).appearances.find((entry) => entry.fixture_id === legacyId)!;
    expect(appearance.minutes).toBe(90);
    expect(appearance.started).toBe(1);
    expect(appearance.stats).toEqual(legacy.players[player.id]);
    expect(
      await store.all(
        "SELECT id,data FROM fixtures WHERE status = 'played' ORDER BY id",
      ),
    ).toEqual(snapshots);
    const total = (await store.get<{ total: number }>(
      "SELECT count(*) AS total FROM player_match_appearances",
    ))!.total;
    await store.schema();
    expect(
      (await store.get<{ total: number }>(
        "SELECT count(*) AS total FROM player_match_appearances",
      ))!.total,
    ).toBe(total);
    await expectSchemaIntegrity(store);
  });

  it("runs the 5-12 academy intake at rollover, keeps squads legal and records previous standings", async () => {
    const firstTeams = await store.all<{ id: number }>(
      "SELECT id FROM clubs WHERE type = 'club'",
    );
    await store.setMeta("state", {
      ...(await stateOf(store)),
      date: "2027-07-01",
    });
    await store.transaction(async () => await seasonRollover(store));
    expect((await stateOf(store)).season).toBe(2027);
    const intake = await store.meta<{ season: number; clubs: Record<string, number> }>("youthIntake");
    expect(intake.season).toBe(2027);
    for (const club of firstTeams) {
      expect(intake.clubs[club.id]).toBeGreaterThanOrEqual(5);
      expect(intake.clubs[club.id]).toBeLessThanOrEqual(12);
    }
    expect(new Set(Object.values(intake.clubs)).size).toBeGreaterThan(2);
    const summary = await store.meta<{ count: number; academy: number }>("lastIntake");
    expect(summary.academy).toBe(Object.values(intake.clubs).reduce((total, count) => total + count, 0));
    expect(summary.count).toBeGreaterThanOrEqual(summary.academy);
    const academy = await store.all<{ birth_date: string; age_group: string; profile: string }>(
      "SELECT birth_date,age_group,profile FROM players WHERE profile::jsonb #>> '{intake,source}' = 'academy' AND profile::jsonb #>> '{intake,season}' = '2027'",
    );
    expect(academy).toHaveLength(summary.academy);
    for (const player of academy) {
      expect([14, 15]).toContain(ageOn(player.birth_date, "2027-07-01"));
      expect(player.age_group).toBe("U17");
      const profile = JSON.parse(player.profile) as PlayerProfile;
      expect(profile.contract?.status).toBe("amateur");
      expect(profile.identity.growth).toBeDefined();
    }
    await checkSquads(store, "test rollover");
    await checkMinors(store, "2027-07-01");
    expect(
      (await store.get<{ count: number }>(
        "SELECT count(*) AS count FROM players WHERE role = 'Retired' AND profile::jsonb #>> '{retirement,reason}' IS NULL",
      ))!.count,
    ).toBe(0);
    expect(
      (await store.get<{ count: number }>(
        "SELECT count(*) AS count FROM history WHERE entity_type = 'league'",
      ))!.count,
    ).toBeGreaterThan(0);
    expect(
      await store.all("SELECT * FROM standings WHERE played != 0"),
    ).toHaveLength(0);
    const oldAppearance = (await store.get<{ player_id: number }>(
      "SELECT player_id FROM player_match_appearances ORDER BY fixture_id, player_id LIMIT 1",
    ))!;
    expect(
      (await playerCareer(store, oldAppearance.player_id, { season: 2026 }))
        .total,
    ).toBeGreaterThan(0);
  });

  it("completes position training and accelerates a supported rehabilitation plan", async () => {
    const player = (await store.get<Player>(
      "SELECT * FROM players WHERE club_id = 1 ORDER BY id LIMIT 1",
    ))!;
    const profile = JSON.parse(player.profile) as PlayerProfile;
    profile.development.positionTarget = "DM";
    profile.development.positionWeeks = 20;
    await store.run(
      "UPDATE players SET training = ?, profile = ? WHERE id = ?",
      "Position",
      JSON.stringify(profile),
      player.id,
    );
    const injured = (await store.get<Player>(
      "SELECT * FROM players WHERE club_id = 1 AND id != ? ORDER BY id LIMIT 1",
      player.id,
    ))!;
    await store.run(
      "UPDATE players SET training = 'Injury rehab', injury_until = '2027-08-01' WHERE id = ?",
      injured.id,
    );
    await developPlayers(store, seedrandom("development-plans"));
    expect(
      (await store.get<Player>(
        "SELECT * FROM players WHERE id = ?",
        player.id,
      ))!.secondary_position,
    ).toBe("DM");
    expect(
      (await store.get<Player>(
        "SELECT * FROM players WHERE id = ?",
        injured.id,
      ))!.injury_until! < "2027-08-01",
    ).toBe(true);
  });
});

describe("persisted football media", () => {
  it("publishes distinct sourced reports and factual discussions without duplicate stories", async () => {
    const store = await Store.createTest("simulation");
    try {
      await generateWorld(store, { nations: ["EN"] });
      const player = (await store.get<Player>(
        "SELECT * FROM players WHERE club_id = 2 AND age_group = 'Senior' ORDER BY id LIMIT 1",
      ))!;
      const input = {
        key: "test-bid",
        phase: "bid" as const,
        playerId: player.id,
        buyerId: 1,
        sellerId: 2,
        fee: 2400000,
      };
      const id = await publishTransferStory(store, input);
      expect(await publishTransferStory(store, input)).toBe(id);
      let feed = await mediaFeed(store, { scope: "club" });
      expect(feed.total).toBe(1);
      expect(feed.stories[0].report!.status).toBe("Reported");
      expect(feed.stories[0].body).toContain("proposal");
      expect(feed.stories[0].report!.comments).toHaveLength(4);
      expect(
        feed.stories[0].report!.comments.some(
          (comment) => comment.sentiment === "critical",
        ),
      ).toBe(true);
      expect(
        feed.stories[0].report!.comments.every(
          (comment) => comment.text.length > 40,
        ),
      ).toBe(true);
      await publishTransferStory(store, {
        ...input,
        key: "test-signing",
        phase: "signing",
      });
      await publishPlayerCoverage(store);
      feed = await mediaFeed(store, {
        topic: "transfer",
        journalist: feed.stories[0].report!.journalistId,
      });
      expect(feed.stories.some((story) => story.id === id)).toBe(true);
      const confirmed = (await mediaFeed(store, { scope: "all" })).stories.find(
        (story) => story.report?.mediaKey === "test-signing",
      )!;
      expect(confirmed.report!.status).toBe("Confirmed");
      expect(confirmed.report!.paragraphs.join(" ")).toContain(player.name);
      expect(
        JOURNALISTS.every((journalist) =>
          journalist.biography.includes("fictional"),
        ),
      ).toBe(true);
      expect((await mediaFeed(store, { q: "%" })).total).toBe(0);
      expect((await mediaFeed(store, { scope: "world" })).total).toBe(0);
      await publishClubRoundup(store);
      const roundups = await mediaFeed(store, { topic: "club" });
      expect(roundups.total).toBe(1);
      expect(roundups.stories[0].report!.paragraphs.join(" ")).toContain(
        "0 arrivals and 0 departures",
      );
      expect(roundups.stories[0].report!.comments.length).toBeGreaterThan(1);
    } finally {
      await store.close();
    }
  });
});

describe("daily transfer market", () => {
  async function marketWorld() {
    const store = await Store.createTest("simulation");
    try {
      await generateWorld(store, { nations: ["EN", "ES", "DE"] });
      await store.run(
        "UPDATE clubs SET transfer_budget = 100000000, balance = 200000000, wage_budget = 10000000, reputation = 65 WHERE type = 'club'",
      );
      await store.run(
        "UPDATE players SET ability = 65, potential = CASE WHEN potential < 65 THEN 65 ELSE potential END, value = 500000, wage = 1000, country_id = 1, age = 24, contract_end = '2030-06-30', injury_until = NULL WHERE age_group = 'Senior'",
      );
      return store;
    } catch (error) {
      await store.close();
      throw error;
    }
  }

  it("indexes eligible senior candidates without scanning youth rosters", async () => {
    const store = await marketWorld();
    try {
      const date = (await stateOf(store)).date;
      const indexes = await store.all<{
        name: string;
        is_disabled: boolean;
        has_filter: boolean;
        filter_definition: string | null;
      }>(
        `SELECT index_class.relname AS name, NOT (info.indisvalid AND info.indisready) AS is_disabled,
           info.indpred IS NOT NULL AS has_filter, pg_get_expr(info.indpred, info.indrelid) AS filter_definition
         FROM pg_catalog.pg_index AS info JOIN pg_catalog.pg_class AS index_class ON index_class.oid = info.indexrelid
         WHERE info.indrelid = to_regclass(?) AND index_class.relname IN ('player_market_candidate','player_market_squad')`,
        tableName(store.schemaName, "players"),
      );
      expect(indexes).toHaveLength(2);
      expect(indexes.every((index) => !index.is_disabled)).toBe(true);
      const candidateIndex = indexes.find(
        (index) => index.name === "player_market_candidate",
      )!;
      expect(candidateIndex.has_filter).toBe(true);
      expect(candidateIndex.filter_definition).toMatch(/age_group.*Senior/i);
      expect(candidateIndex.filter_definition).toMatch(
        /parent_club_id.*IS NULL/i,
      );
      for (const [name, expectedColumns] of [
        ["player_market_candidate", ["id", "contract_end", "injury_until"]],
        [
          "player_market_squad",
          ["club_id", "age_group", "position", "role", "wage"],
        ],
      ] as const) {
        const columns = await store.all<{ name: string }>(
          `SELECT attribute.attname AS name
           FROM pg_catalog.pg_index AS info
           JOIN pg_catalog.pg_class AS index_class ON index_class.oid = info.indexrelid
           CROSS JOIN LATERAL unnest(info.indkey::int2[]) WITH ORDINALITY AS indexed(attnum, ordinal)
           JOIN pg_catalog.pg_attribute AS attribute ON attribute.attrelid = info.indrelid AND attribute.attnum = indexed.attnum
           WHERE info.indrelid = to_regclass(?) AND index_class.relname = ? AND indexed.ordinal <= info.indnkeyatts
           ORDER BY indexed.ordinal`,
          tableName(store.schemaName, "players"),
          name,
        );
        expect(columns.map((column) => column.name)).toEqual(expectedColumns);
      }
      const players = await store.all<Player>(
        "SELECT id,club_id,parent_club_id,age,age_group,role,contract_end,injury_until FROM players ORDER BY id",
      );
      const eligible = players.filter(
        (player) =>
          player.club_id !== null &&
          player.parent_club_id === null &&
          player.age >= 18 &&
          player.age <= 31 &&
          player.age_group === "Senior" &&
          player.role !== "Retired" &&
          player.contract_end > date &&
          (player.injury_until === null || player.injury_until <= date),
      );
      expect(eligible.length).toBeGreaterThan(0);
      const lastId = players.at(-1)!.id;
      const started = performance.now();
      for (let repeat = 0; repeat < 3; repeat++) {
        for (const lowerBound of [
          1,
          Math.floor(lastId / 4),
          Math.floor(lastId / 2),
          lastId + 1,
        ]) {
          const candidate = await store.get<Player>(
            "SELECT * FROM players WHERE id >= ? AND club_id IS NOT NULL AND parent_club_id IS NULL AND age BETWEEN 18 AND 31 AND age_group = 'Senior' AND role != 'Retired' AND contract_end > ? AND (injury_until IS NULL OR injury_until <= ?) AND NOT EXISTS (SELECT 1 FROM negotiations WHERE negotiations.player_id = players.id AND stage NOT IN ('Completed','Rejected','Withdrawn','Expired','Hijacked')) AND NOT EXISTS (SELECT 1 FROM history WHERE entity_type = 'transfer' AND entity_id = players.id AND date >= ?) ORDER BY id LIMIT 1",
            lowerBound,
            date,
            date,
            addDays(date, -90),
          );
          expect(candidate?.id).toBe(
            eligible.find((player) => player.id >= lowerBound)?.id,
          );
        }
      }
      expect(performance.now() - started).toBeLessThan(15000);
    } finally {
      await store.close();
    }
  });

  it("runs on multiple window days without repeat moves or automatic sales from the managed club", async () => {
    const store = await marketWorld();
    try {
      const originalSquad = await store.all(
        "SELECT id,club_id FROM players WHERE club_id = 1 ORDER BY id",
      );
      const days: string[] = [];
      for (let index = 0; index < 7; index++) {
        const date = addDays("2026-07-01", index);
        await store.setMeta("state", { ...(await stateOf(store)), date });
        const result = await store.transaction(
          async () =>
            await worldTransfers(store, seedrandom(`market-day-${index}`)),
        );
        if (result.completed) days.push(date);
        expect(await worldTransfers(store, seedrandom("duplicate"))).toEqual({
          completed: 0,
          offers: 0,
        });
      }
      expect(days.length).toBeGreaterThan(1);
      expect(
        await store.all(
          "SELECT entity_id FROM history WHERE entity_type = 'transfer' GROUP BY entity_id HAVING count(*) > 1",
        ),
      ).toHaveLength(0);
      expect(
        await store.all(
          "SELECT id,club_id FROM players WHERE club_id = 1 ORDER BY id",
        ),
      ).toEqual(originalSquad);
      expect(
        await store.all(
          "SELECT id FROM clubs WHERE balance < 0 OR transfer_budget < 0",
        ),
      ).toHaveLength(0);
      await store.setMeta("state", {
        ...(await stateOf(store)),
        date: "2026-10-01",
      });
      expect(await worldTransfers(store, seedrandom("closed-window"))).toEqual({
        completed: 0,
        offers: 0,
      });
    } finally {
      await store.close();
    }
  });

  it("considers multiple listed players while capping incoming approaches", async () => {
    const store = await marketWorld();
    try {
      await store.run(
        "UPDATE players SET listed = 1, available_loan = 0 WHERE club_id = 1 AND age_group = 'Senior'",
      );
      for (let index = 0; index < 7; index++) {
        await store.setMeta("state", {
          ...(await stateOf(store)),
          date: addDays("2026-07-01", index),
        });
        await worldTransfers(store, seedrandom(`listed-market-${index}`));
      }
      const offers = await store.all<{ player_id: number; stage: string }>(
        "SELECT player_id,stage FROM negotiations WHERE selling_club_id = 1",
      );
      expect(offers).toHaveLength(3);
      expect(new Set(offers.map((offer) => offer.player_id)).size).toBe(3);
      expect(offers.every((offer) => offer.stage === "Offer received")).toBe(
        true,
      );
      for (const offer of offers)
        expect(
          (await store.get<Player>(
            "SELECT * FROM players WHERE id = ?",
            offer.player_id,
          ))!.club_id,
        ).toBe(1);
    } finally {
      await store.close();
    }
  });

  it("releases pre-contracted players at expiry without the market grabbing them", async () => {
    const store = await marketWorld();
    try {
      const buyer = await clubOf(store, 1);
      await store.run("UPDATE clubs SET reputation = 99 WHERE id = ?", buyer.id);
      const seller = (await store.get<{ id: number }>(
        "SELECT id FROM clubs WHERE type = 'club' AND country_id != ? ORDER BY id LIMIT 1",
        buyer.country_id,
      ))!;
      const player = (await store.get<Player>(
        "SELECT * FROM players WHERE club_id = ? AND age >= 18 AND parent_club_id IS NULL ORDER BY id LIMIT 1",
        seller.id,
      ))!;
      const contractEnd = (await stateOf(store)).date;
      await store.run(
        "UPDATE players SET contract_end = ?, listed = 1 WHERE id = ?",
        contractEnd,
        player.id,
      );
      const enquiry = await enquire(store, player.id, "Pre-contract agreement");
      await negotiationStep(store, enquiry.id, "formalize");
      await negotiate(store, enquiry.id, {
        fee: 0,
        wage: enquiry.wage * 2,
        years: 3,
        role: "Squad player",
        promises: [],
      });
      await negotiationStep(store, enquiry.id, "sign");
      const scheduled = (await store.get<Negotiation>("SELECT * FROM negotiations WHERE id = ?", enquiry.id))!;
      const details = JSON.parse(scheduled.data) as NegotiationData;
      details.futureArrivalDate = "2027-01-01";
      details.medicalDate = "2026-12-30";
      await store.run(
        "UPDATE negotiations SET data = ? WHERE id = ?",
        JSON.stringify(details),
        enquiry.id,
      );

      await advance(store, 1);
      const released = (await store.get<Player>("SELECT * FROM players WHERE id = ?", player.id))!;
      expect(released.club_id).toBeNull();
      expect(released.role).toBe("Free agent");
      expect(
        (await store.get<{ stage: string }>("SELECT stage FROM negotiations WHERE id = ?", enquiry.id))!.stage,
      ).toBe("Scheduled");
      await worldTransfers(store, seedrandom("pre-contract-protected"));
      expect((await store.get<Player>("SELECT * FROM players WHERE id = ?", player.id))!.club_id).toBeNull();
      expect(
        (await store.get<{ stage: string }>("SELECT stage FROM negotiations WHERE id = ?", enquiry.id))!.stage,
      ).toBe("Scheduled");
    } finally {
      await store.close();
    }
  });
});

describe("knockout match integration", () => {
  let store: Store;
  beforeAll(async () => {
    store = await Store.createTest("knockout-match");
  });
  afterAll(async () => {
    await store?.close();
  });

  it("retains tie metadata and advances once per aggregate tie", async () => {
    await generateWorld(store, { nations: ["EN"] });
    const spec = COMPETITIONS.find(
      (entry) => entry.name === "UEFA Champions League",
    )!;
    const leagueId = Number(
      (
        await store.run(
          "INSERT INTO leagues(name,confederation,tier,age_group,kind,reputation,format,data) VALUES (?,'UEFA',0,'Senior','continental',95,'Swiss',?)",
          spec.name,
          JSON.stringify({ spec }),
        )
      ).lastInsertRowid,
    );
    await scheduleKnockout(store, leagueId, [1, 2, 3, 4], 2026, "2026-07-10");
    for (const fixture of await store.all<Fixture>(
      "SELECT * FROM fixtures WHERE league_id = ? ORDER BY date,id",
      leagueId,
    )) {
      await store.setMeta("state", {
        ...(await stateOf(store)),
        date: fixture.date,
      });
      await playFixture(store, fixture);
      const played = (await store.get<Fixture>(
        "SELECT * FROM fixtures WHERE id = ?",
        fixture.id,
      ))!;
      expect(JSON.parse(played.data).tie.id).toBe(
        JSON.parse(fixture.data).tie.id,
      );
      if (JSON.parse(fixture.data).tie.leg === 1)
        expect(JSON.parse(played.data).shootout).toBeUndefined();
    }
    await progressCompetitions(store, "2026-07-20");
    expect(
      await store.all(
        "SELECT * FROM fixtures WHERE league_id = ? AND stage = 'Final'",
        leagueId,
      ),
    ).toHaveLength(1);
  });
});
