import seedrandom from "seedrandom";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Store } from "./db.ts";
import { generateWorld } from "./world.ts";
import { createCalendar, plannedLeagueMoves } from "./calendar.ts";
import { advance } from "./simulation.ts";
import { clubPolicySnapshot, forgetClubPolicies, marketSnapshot, saleCreditOf, squadNeeds } from "./club-policy.ts";
import {
  assessFinances,
  assessFinancesBatch,
  estimateClubRevenue,
  fairValueForFfp,
  leagueGroupSizes,
  OTHER_INCOME_SHARE,
  seasonHomeMatches,
  sustainableWageBudget,
  partTimeStaffFactor,
  PLAYER_WAGE_FLOOR_SHARE,
  STAFF_REVENUE_SHARE,
  weeklyOperatingCosts,
} from "./finance.ts";
import { canSign } from "./eligibility.ts";
import { activeEmbargo, applySanction, applySeasonSanctions, reviewSeasonFinances, reviewSolvency } from "./sanctions.ts";
import {
  boardWageBudget,
  ensureReleaseClauses,
  expireWorldLoans,
  loanPropensity,
  marketPhase,
  reviewWorldLoans,
  seasonAppetite,
  seasonShare,
  worldMarket,
} from "./world-market.ts";
import { completeExchange, contractReleaseClause, exchangeIssue, exchangePart, payReleaseClause } from "./deal-clauses.ts";
import { enquire, negotiate, negotiationStep, stateOf } from "./systems.ts";
import { optionalReleaseClause, releaseClauseFor } from "../shared/release-clauses.ts";
import { addDays } from "../shared/rules.ts";
import type { Club, GameState, Negotiation, NegotiationData, Player, PlayerProfile } from "../shared/types.ts";

const contract = (player: Pick<Player, "profile">) => (JSON.parse(player.profile) as PlayerProfile).contract;

async function marketDays(store: Store, from: string, days: number) {
  const totals = { transfers: 0, loans: 0, free: 0, swaps: 0, clauses: 0, returns: 0, releases: 0 };
  for (let day = 0; day < days; day++) {
    const state = { ...(await stateOf(store)), date: addDays(from, day) };
    await store.setMeta("state", state);
    const result = await store.transaction(() => worldMarket(store, state, seedrandom(`test-market:${state.date}`)));
    for (const key of Object.keys(totals) as (keyof typeof totals)[]) totals[key] += result[key];
  }
  return totals;
}

describe("market calendar and appetite (pure)", () => {
  it("weights the season towards the summer window and the deadline days", () => {
    expect(marketPhase("2026-07-10")).toBe("window");
    expect(marketPhase("2026-09-01")).toBe("deadline");
    expect(marketPhase("2026-10-10")).toBe("closed");
    expect(seasonShare("2026-06-15")).toBeGreaterThan(0);
    expect(seasonShare("2026-09-01")).toBeGreaterThan(0.6);
    expect(seasonShare("2026-09-01")).toBeLessThan(0.8);
    expect(seasonShare("2027-02-02")).toBeGreaterThan(0.85);
    expect(seasonShare("2027-06-14")).toBe(1);
    const deadline = seasonShare("2026-09-01") - seasonShare("2026-08-31");
    const ordinary = seasonShare("2026-07-20") - seasonShare("2026-07-19");
    expect(deadline).toBeGreaterThan(ordinary * 4);
  });

  it("scales the season appetite by tier, ambition and the director of football, and the loan share by means", () => {
    const top = seasonAppetite({ tier: 1, ambition: 50, dofPolicy: "balanced" });
    expect(top).toBeCloseTo(14, 5);
    expect(seasonAppetite({ tier: 2, ambition: 50, dofPolicy: "balanced" })).toBeLessThan(top);
    expect(seasonAppetite({ tier: 9, ambition: 50, dofPolicy: "balanced" })).toBeCloseTo(4.5, 5);
    expect(seasonAppetite({ tier: 1, ambition: 100, dofPolicy: "stars" })).toBeGreaterThan(top * 1.2);
    expect(loanPropensity({ tier: 1, reputation: 85, transferBudget: 1e8, dofPolicy: "balanced" })).toBe(0.15);
    expect(loanPropensity({ tier: 4, reputation: 40, transferBudget: 1e5, dofPolicy: "balanced" })).toBe(0.26);
  });

  it("lets the board raise a wage budget with FFP headroom and cash, and cut it over the limit", () => {
    const board = { budget: 100_000, base: 100_000, payroll: 95_000, ambition: 50 };
    const rich = { weeklySurplus: 60_000, ffpHeadroom: 1_300_000, balance: 5_000_000 };
    // Half of the weekly operating surplus is affordable: 3% of the base a week, up to 12.5% above it at middling ambition.
    expect(boardWageBudget({ ...board, ...rich })).toBe(103_000);
    let budget = board.budget;
    for (let week = 0; week < 20; week++) budget = boardWageBudget({ ...board, ...rich, budget });
    expect(budget).toBe(112_500);
    expect(boardWageBudget({ ...board, ...rich, ambition: 100, budget: 112_500 })).toBe(115_500);
    // Only what the surplus pays for: the unused budget already counts against it.
    expect(boardWageBudget({ ...board, ...rich, weeklySurplus: 12_000 })).toBe(101_000);
    // Headroom without two months of wages in cash: no rise.
    expect(boardWageBudget({ ...board, ...rich, balance: 500_000 })).toBe(100_000);
    // Over the FFP limit (or overdrawn): 3% a week, down to 85% of the base; losing money: 1% a week, down to 90%.
    expect(boardWageBudget({ ...board, ...rich, ffpHeadroom: -1 })).toBe(97_000);
    budget = board.budget;
    for (let week = 0; week < 20; week++) budget = boardWageBudget({ ...board, ...rich, budget, balance: -1 });
    expect(budget).toBe(85_000);
    expect(boardWageBudget({ ...board, ...rich, weeklySurplus: -1 })).toBe(99_000);
    // A raised budget the surplus no longer covers drifts back to the base; one at the base stays.
    expect(boardWageBudget({ ...board, ...rich, budget: 110_000, weeklySurplus: 2_000 })).toBe(108_900);
    expect(boardWageBudget({ ...board, ...rich, weeklySurplus: 2_000 })).toBe(100_000);
  });

  it("derives needs from available depth, weak starters and ageing groups in the fielded positions", () => {
    const needs = squadNeeds(
      "4-3-3",
      {
        GK: { depth: 2, available: 2, best: 70, second: 60, old: 0 },
        CB: { depth: 4, available: 2, best: 72, second: 70, old: 0 },
        ST: { depth: 3, available: 3, best: 60, second: 58, old: 0 },
        LW: { depth: 2, available: 2, best: 71, second: 69, old: 2 },
      },
      70,
    );
    expect(needs.GK).toBe(0);
    expect(needs.CB).toBe(2);
    expect(needs.ST).toBe(0.8);
    expect(needs.LW).toBe(0.5);
    // A 4-3-3 does not field an attacking midfielder.
    expect(needs.AM).toBe(0);
    // No right-back at all: two missing and no starter at the squad's level.
    expect(needs.RB).toBe(2.8);
  });

  it("prices Spanish release clauses well above value and optional clauses for a minority elsewhere", () => {
    const prospect = releaseClauseFor({ id: 11, age: 19, ability: 60, potential: 80, value: 1_000_000 }, true);
    const veteran = releaseClauseFor({ id: 11, age: 33, ability: 70, potential: 70, value: 1_000_000 }, true);
    expect(prospect).toBeGreaterThanOrEqual(5_000_000);
    expect(veteran).toBeLessThanOrEqual(2_500_000);
    expect(releaseClauseFor({ id: 12, age: 26, ability: 70, potential: 72, value: 1_000_000 }, false)).toBeLessThanOrEqual(3_000_000);
    const share = Array.from({ length: 2000 }, (_, id) => optionalReleaseClause(id + 1)).filter(Boolean).length / 2000;
    expect(share).toBeGreaterThan(0.08);
    expect(share).toBeLessThan(0.16);
    expect(fairValueForFfp(1_100_000, 1_000_000)).toBe(1_100_000);
    expect(fairValueForFfp(5_000_000, 1_000_000)).toBe(1_000_000);
  });
});

describe("lower-division economics (pure)", () => {
  it("adds central distributions and other income below the second tier and sizes wage budgets to revenue", () => {
    const base = { reputation: 30, leagueReputation: 30, capacity: 4000, fanMood: 60, homeMatches: 25, countryCode: "EN" };
    const second = estimateClubRevenue({ ...base, tier: 2 });
    const sixth = estimateClubRevenue({ ...base, tier: 6 });
    expect(sixth.annualCommercial).toBeGreaterThanOrEqual(Math.round(sixth.matchdayPerHomeMatch * 20 * OTHER_INCOME_SHARE[5]));
    expect(second.annualCommercial - sixth.annualCommercial).toBeLessThan(second.annualCommercial);
    expect(seasonHomeMatches(24)).toBe(25);
    const revenue = 1_000_000;
    const budget = sustainableWageBudget({ annualRevenue: revenue, spendRatio: 0.9, staffWages: 2000, facilities: 30, academy: 30 });
    const upkeep = weeklyOperatingCosts({ annualRevenue: revenue, wageShare: 0, spendRatio: 0.9, facilities: 30, academy: 30, balance: revenue, staffWages: 2000 });
    // A full payroll (the market fills the budget) plus staff and upkeep spends exactly the spend ratio.
    expect((budget + 2000 + upkeep.facilities + upkeep.academy) * 52).toBeCloseTo(revenue * 0.9, -3);
    // A semi-professional club whose full-time staff would eat its revenue employs them part-time and keeps a professional core.
    expect(sustainableWageBudget({ annualRevenue: 10_000, spendRatio: 0.9, staffWages: 5000, facilities: 30, academy: 30 })).toBeGreaterThanOrEqual(
      Math.round((PLAYER_WAGE_FLOOR_SHARE * 10_000) / 52),
    );
    const semiPro = 200_000;
    const factor = partTimeStaffFactor(4000, semiPro);
    expect(factor).toBeCloseTo((STAFF_REVENUE_SHARE * semiPro) / 52 / 4000, 6);
    expect(partTimeStaffFactor(2000, revenue)).toBe(1);
    const semiProBudget = sustainableWageBudget({ annualRevenue: semiPro, spendRatio: 0.86, staffWages: 4000 * factor, facilities: 25, academy: 25 });
    const semiProUpkeep = weeklyOperatingCosts({ annualRevenue: semiPro, wageShare: 0, spendRatio: 0.86, facilities: 25, academy: 25, balance: semiPro });
    expect(semiProBudget).toBeGreaterThan(0);
    expect((semiProBudget + 4000 * factor + semiProUpkeep.facilities + semiProUpkeep.academy) * 52).toBeLessThanOrEqual(semiPro * 0.86 + 52);
  });
});

describe("world market (EN + ES world)", () => {
  let store: Store;
  let state: GameState;
  beforeAll(async () => {
    store = await Store.createTest("world-market");
    await generateWorld(store, { nations: ["EN", "ES"], seed: "world-market-tests" });
    await createCalendar(store);
    state = await stateOf(store);
  }, 300_000);
  afterAll(async () => {
    await store?.close();
  });

  it("assesses every club in one batch exactly as the single-club assessment, with an FFP headroom", async () => {
    const batch = await assessFinancesBatch(store);
    const clubs = await store.all<{ id: number }>("SELECT id FROM clubs WHERE type = 'club' ORDER BY id LIMIT 5");
    for (const club of clubs) {
      const single = await assessFinances(store, club.id);
      expect(batch.get(club.id)).toEqual(single);
      expect(Number.isFinite(single.ffpHeadroom)).toBe(true);
    }
    const proposed = await assessFinances(store, clubs[0].id, { annualWages: 5_000_000, fee: 20_000_000, years: 4 });
    expect(proposed.ffpHeadroom).toBeCloseTo(batch.get(clubs[0].id)!.ffpHeadroom - 5_000_000 - 5_000_000, -1);
  });

  it("counts home matches against the club's own group of a divided league", async () => {
    const groups = await leagueGroupSizes(store);
    const divided = await store.get<{ league_id: number; groups: number; clubs: number }>(
      "SELECT league_id, count(DISTINCT group_name) AS groups, count(*) AS clubs FROM standings GROUP BY league_id HAVING count(DISTINCT group_name) > 1 LIMIT 1",
    );
    expect(divided).toBeDefined();
    const member = (await store.get<{ club_id: number }>("SELECT club_id FROM standings WHERE league_id = ? LIMIT 1", divided!.league_id))!;
    expect(groups.get(member.club_id)).toBe(divided!.clubs / divided!.groups);
  });

  it("builds one policy per first team with needs, surplus and money, leaving the director's club out of the supply", async () => {
    const snapshot = await marketSnapshot(store, state.date, 1);
    const firstTeams = (await store.get<{ total: number }>("SELECT count(*) AS total FROM clubs WHERE type = 'club'"))!.total;
    expect(snapshot.policies.size).toBe(firstTeams);
    expect(await clubPolicySnapshot(store, state.date)).toBe(snapshot.policies);
    const own = snapshot.policies.get(state.clubId)!;
    expect(own.managed).toBe(true);
    expect(own.surplus).toEqual([]);
    const policy = [...snapshot.policies.values()].find((entry) => !entry.managed && entry.surplus.length)!;
    expect(policy.level).toBeGreaterThan(20);
    expect(Object.keys(policy.needs)).toHaveLength(10);
    expect(["balanced", "youth", "value", "stars"]).toContain(policy.dofPolicy);
    expect(policy.ambition).toBeGreaterThan(0);
    expect(policy.transferBudget).toBeGreaterThanOrEqual(0);
    for (const player of snapshot.supply.values()) {
      expect(snapshot.policies.get(player.clubId)?.managed).toBe(false);
      expect(player.age).toBeGreaterThanOrEqual(18);
    }
    expect([...snapshot.supply.values()].some((player) => player.mode !== "transfer")).toBe(true);
  });

  it("backfills missing Spanish release clauses, at most every four weeks", async () => {
    await store.run("UPDATE players SET profile = (profile::jsonb #- '{contract,releaseClause}')::text");
    await store.run("DELETE FROM meta WHERE key = 'releaseClauseScan'");
    expect(await ensureReleaseClauses(store, state.date)).toBeGreaterThan(100);
    const missing = await store.get<{ total: number }>(
      `SELECT count(*) AS total FROM players JOIN clubs ON clubs.id = coalesce(players.parent_club_id, players.club_id)
       JOIN countries ON countries.id = clubs.country_id WHERE countries.code = 'ES' AND players.role <> 'Retired'
         AND coalesce(players.profile::jsonb #>> '{contract,status}', 'professional') = 'professional'
         AND players.profile::jsonb #>> '{contract,releaseClause}' IS NULL`,
    );
    expect(missing!.total).toBe(0);
    const english = await store.get<{ total: number }>(
      "SELECT count(*) AS total FROM players JOIN clubs ON clubs.id = players.club_id JOIN countries ON countries.id = clubs.country_id WHERE countries.code = 'EN' AND players.profile::jsonb #>> '{contract,releaseClause}' IS NOT NULL",
    );
    expect(english!.total).toBe(0);
    expect(await ensureReleaseClauses(store, state.date)).toBe(0);
    const spanishClub = (await store.get<Club>("SELECT clubs.* FROM clubs JOIN countries ON countries.id = clubs.country_id WHERE countries.code = 'ES' AND clubs.type = 'club' LIMIT 1"))!;
    const englishClub = (await store.get<Club>("SELECT * FROM clubs WHERE id = ?", state.clubId))!;
    const player = (await store.get<Player>("SELECT * FROM players WHERE club_id = ? LIMIT 1", spanishClub.id))!;
    expect(await contractReleaseClause(store, spanishClub, player, undefined, false)).toBeGreaterThan(player.value);
    expect(await contractReleaseClause(store, englishClub, player, 7_000_000, false)).toBe(7_000_000);
    expect(await contractReleaseClause(store, englishClub, player, null, false)).toBeNull();
  });

  it("makes transfers and loans between AI clubs within budgets, wage room and FFP headroom", async () => {
    const before = new Map(
      (await store.all<{ id: number; balance: number }>("SELECT id, balance FROM clubs WHERE type = 'club'")).map((club) => [club.id, club.balance]),
    );
    const squad = await store.all("SELECT id FROM players WHERE club_id = ? ORDER BY id", state.clubId);
    const totals = await marketDays(store, "2026-07-01", 4);
    expect(totals.transfers).toBeGreaterThan(5);
    expect(totals.loans).toBeGreaterThan(5);
    expect(await store.all("SELECT id FROM players WHERE club_id = ? ORDER BY id", state.clubId)).toEqual(squad);
    const loans = await store.all<{ player_id: number; parent_id: number; destination_id: number; data: string; terms: string }>(
      "SELECT player_id, parent_id, destination_id, data, terms FROM loans WHERE data::jsonb ->> 'world' = 'true'",
    );
    expect(loans.length).toBe(totals.loans);
    for (const loan of loans.slice(0, 20)) {
      const player = (await store.get<Player>("SELECT * FROM players WHERE id = ?", loan.player_id))!;
      expect(player.parent_club_id).toBe(loan.parent_id);
      expect(player.club_id).toBe(loan.destination_id);
      expect(JSON.parse(loan.terms).salarySplit).toBeGreaterThanOrEqual(25);
    }
    const moves = await store.all<{ data: string }>("SELECT data FROM history WHERE entity_type IN ('transfer','loan') AND date >= '2026-07-01'");
    expect(moves.length).toBeGreaterThanOrEqual(totals.transfers + totals.loans);
    for (const club of await store.all<{ id: number; balance: number; transfer_budget: number }>("SELECT id, balance, transfer_budget FROM clubs WHERE type = 'club'")) {
      expect(club.transfer_budget).toBeGreaterThanOrEqual(0);
      if ((before.get(club.id) ?? 0) >= 0) expect(club.balance).toBeGreaterThanOrEqual(0);
    }
    // Spanish buyers write a release clause into every new contract.
    const spanishSignings = await store.all<Player>(
      `SELECT players.* FROM history JOIN players ON players.id = history.entity_id JOIN clubs ON clubs.id = players.club_id
       JOIN countries ON countries.id = clubs.country_id
       WHERE history.entity_type = 'transfer' AND history.date >= '2026-07-01' AND countries.code = 'ES' AND players.parent_club_id IS NULL`,
    );
    for (const player of spanishSignings) expect(contract(player)?.releaseClause).toBeGreaterThan(0);
  }, 300_000);

  it("never lets a club past its FFP limit or under an embargo sign anyone", async () => {
    const clubs = await store.all<Club>(
      "SELECT * FROM clubs WHERE type = 'club' AND id <> ? AND league_id IS NOT NULL ORDER BY reputation DESC LIMIT 6",
      state.clubId,
    );
    const [capped, embargoed] = [clubs.slice(0, 3), clubs.slice(3)];
    // No cash and a wage bill far above revenue: the domestic solvency gate is negative; wage room stays open.
    for (const club of capped) {
      await store.run("UPDATE clubs SET balance = 0, transfer_budget = 500000000, wage_budget = 100000000 WHERE id = ?", club.id);
      await store.run("UPDATE players SET wage = wage * 40 WHERE club_id = ?", club.id);
    }
    for (const club of embargoed) {
      const id = await applySanction(store, { clubId: club.id, kind: "embargo", reason: "Test embargo." });
      expect(id).toBeGreaterThan(0);
      expect(await activeEmbargo(store, club.id, "2026-07-10")).toBe(true);
    }
    const snapshot = await marketSnapshot(store, "2026-07-10", 1);
    for (const club of capped) expect(snapshot.policies.get(club.id)!.ffpHeadroom).toBeLessThan(0);
    for (const club of embargoed) expect(snapshot.policies.get(club.id)!.embargo).toBe(true);
    await marketDays(store, "2026-07-10", 4);
    const ids = [...capped, ...embargoed].map((club) => club.id);
    expect(
      await store.all(
        "SELECT entity_id, data FROM history WHERE entity_type IN ('transfer','loan') AND date >= '2026-07-10' AND (data::jsonb ->> 'to')::integer = ANY(?::integer[])",
        ids,
      ),
    ).toEqual([]);
  }, 300_000);

  it("blocks the director's registrations under an embargo", async () => {
    const target = (await store.get<Player>(
      "SELECT * FROM players WHERE club_id <> ? AND club_id IS NOT NULL AND parent_club_id IS NULL AND age >= 20 AND role <> 'Retired' LIMIT 1",
      state.clubId,
    ))!;
    await store.setMeta("state", { ...(await stateOf(store)), date: "2026-07-20" });
    expect((await canSign(store, target.id, state.clubId, "transfer")).codes).not.toContain("embargo");
    await applySanction(store, { clubId: state.clubId, kind: "embargo", reason: "Unpaid liabilities.", until: "2026-07-25" });
    expect((await canSign(store, target.id, state.clubId, "transfer")).codes).toContain("embargo");
    expect(await store.get("SELECT 1 FROM news WHERE category = 'Finance' AND title LIKE 'Registration embargo%'")).toBeDefined();
    expect(await activeEmbargo(store, state.clubId, "2026-07-26")).toBe(false);
  });

  it("deducts points in the club's league table and charges fines", async () => {
    const club = (await store.get<Club>("SELECT * FROM clubs WHERE type = 'club' AND league_id IS NOT NULL AND id <> ? ORDER BY id LIMIT 1", state.clubId))!;
    await store.run("UPDATE standings SET points = 10, wins = 3, draws = 1, played = 4 WHERE club_id = ? AND league_id = ?", club.id, club.league_id);
    await applySanction(store, { clubId: club.id, kind: "points", points: 6, reason: "Test deduction." });
    expect(await store.get("SELECT points, deducted FROM standings WHERE club_id = ? AND league_id = ?", club.id, club.league_id)).toEqual({
      points: 4,
      deducted: 6,
    });
    const balance = (await store.get<{ balance: number }>("SELECT balance FROM clubs WHERE id = ?", club.id))!.balance;
    await applySanction(store, { clubId: club.id, kind: "fine", amount: 1_000_000, reason: "Test fine." });
    expect((await store.get<{ balance: number }>("SELECT balance FROM clubs WHERE id = ?", club.id))!.balance).toBe(balance - 1_000_000);
    expect(await store.get("SELECT 1 FROM ledger WHERE club_id = ? AND category = 'Regulatory fines'", club.id)).toBeDefined();
    expect(
      (await store.get<{ total: number }>("SELECT count(*) AS total FROM news WHERE category = 'Worldwide' AND data::jsonb ->> 'kind' = 'sanction'"))!.total,
    ).toBeGreaterThan(1);
  });

  it("sanctions Premier League squad-cost breaches at the year-end review and lifts cash embargoes", async () => {
    const club = (await store.get<Club>(
      `SELECT clubs.* FROM clubs JOIN leagues ON leagues.id = clubs.league_id JOIN countries ON countries.id = clubs.country_id
       WHERE countries.code = 'EN' AND leagues.tier = 1 AND clubs.id <> ?
         AND NOT EXISTS (SELECT 1 FROM standings JOIN leagues AS cup ON cup.id = standings.league_id WHERE standings.club_id = clubs.id AND cup.kind = 'continental')
       ORDER BY clubs.id LIMIT 1`,
      state.clubId,
    ))!;
    const season = (await stateOf(store)).season;
    await store.run(
      `INSERT INTO financial_periods (club_id, season, revenue, wages, closed) VALUES (?, ?, 100000000, 170000000, 1)
       ON CONFLICT (club_id, season) DO UPDATE SET revenue = 100000000, wages = 170000000, amortization = 0, agent_fees = 0, sale_profit = 0, closed = 1`,
      club.id,
      season,
    );
    const decisions = await reviewSeasonFinances(store, season);
    const decision = decisions.find((entry) => entry.clubId === club.id)!;
    expect(decision.sanctions.map((sanction) => sanction.kind).sort()).toEqual(["fine", "points"]);
    expect(decision.sanctions.find((sanction) => sanction.kind === "points")!.points).toBe(10);
    await store.run("UPDATE financial_periods SET closed = 0 WHERE club_id = ? AND season = ?", club.id, season);
    expect(await applySeasonSanctions(store, [decision])).toBe(2);
    expect((await store.get<{ deducted: number }>("SELECT deducted FROM standings WHERE club_id = ? AND league_id = ?", club.id, club.league_id))!.deducted).toBe(10);
    // Solvency: deep in the red means an embargo until the balance recovers.
    await store.run("UPDATE clubs SET balance = -wage_budget * 10 WHERE id = ?", club.id);
    expect((await reviewSolvency(store)).imposed).toBeGreaterThanOrEqual(1);
    expect(await activeEmbargo(store, club.id, (await stateOf(store)).date)).toBe(true);
    await store.run("UPDATE clubs SET balance = 1000000 WHERE id = ?", club.id);
    expect((await reviewSolvency(store)).lifted).toBeGreaterThanOrEqual(1);
    expect(await activeEmbargo(store, club.id, (await stateOf(store)).date)).toBe(false);
  });

  it("plans a window's wage room net of contracts and loans ending and of planned sales", async () => {
    const date = "2026-08-10";
    const club = (await store.get<Club>(
      "SELECT * FROM clubs WHERE type = 'club' AND id <> ? AND league_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM sanctions WHERE club_id = clubs.id) ORDER BY reputation, id OFFSET 20 LIMIT 1",
      state.clubId,
    ))!;
    const leaving = (await store.get<Player>(
      "SELECT * FROM players WHERE club_id = ? AND parent_club_id IS NULL AND age_group = 'Senior' AND wage > 0 ORDER BY wage DESC, id LIMIT 1",
      club.id,
    ))!;
    forgetClubPolicies(store);
    const before = (await marketSnapshot(store, date, 1)).policies.get(club.id)!;
    await store.run("UPDATE players SET contract_end = '2026-08-20' WHERE id = ?", leaving.id);
    forgetClubPolicies(store);
    const snapshot = await marketSnapshot(store, date, 1);
    const policy = snapshot.policies.get(club.id)!;
    expect(policy.departing - before.departing).toBeCloseTo(leaving.wage, 0);
    expect(policy.wageRoom).toBeCloseTo(policy.wageBudget - policy.weeklyWages - policy.committedWages + policy.departing, 0);
    const surplus = policy.surplus.map((id) => snapshot.supply.get(id)!);
    // Signing ahead of sales needs an operating surplus and two months of wages in cash.
    const credit = Math.min(surplus.reduce((sum, player) => sum + saleCreditOf(player), 0), policy.wageBudget * 0.15);
    expect(policy.saleCredit).toBeCloseTo(policy.weeklySurplus > 0 && policy.balance > policy.wageBudget * 8 ? credit : 0, 0);
    expect([...snapshot.policies.values()].some((entry) => entry.saleCredit > 0)).toBe(true);
    expect(saleCreditOf({ wage: 1000, mode: "loan" })).toBeLessThan(saleCreditOf({ wage: 1000, mode: "transfer" }));
    // Between windows nothing is planned: contracts run on and no club signs ahead of sales.
    forgetClubPolicies(store);
    const closed = (await marketSnapshot(store, "2026-10-10", 1)).policies;
    expect([...closed.values()].every((entry) => entry.saleCredit === 0 && entry.departing === 0)).toBe(true);
    await store.run("UPDATE players SET contract_end = ? WHERE id = ?", leaving.contract_end, leaving.id);
    forgetClubPolicies(store);
  }, 300_000);

  it("ends contracts by mutual consent on deadline day at clubs left over their wage budget", async () => {
    const club = (await store.get<Club>(
      "SELECT * FROM clubs WHERE type = 'club' AND id <> ? AND league_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM sanctions WHERE club_id = clubs.id) ORDER BY reputation, id OFFSET 25 LIMIT 1",
      state.clubId,
    ))!;
    // Far over budget with surplus players to move on, and no other club able to buy today.
    await store.run("UPDATE clubs SET wage_budget = wage_budget * 0.5 WHERE id = ?", club.id);
    forgetClubPolicies(store);
    const date = "2026-09-01";
    const policy = (await marketSnapshot(store, date, 1)).policies.get(club.id)!;
    expect(policy.wageRoom).toBeLessThan(0);
    expect(policy.surplus.length).toBeGreaterThan(0);
    const totals = await marketDays(store, date, 1);
    expect(totals.releases).toBeGreaterThan(0);
    const released = await store.all<{ amount: number; description: string }>(
      "SELECT amount, description FROM ledger WHERE club_id = ? AND date = ? AND description LIKE '%mutual consent'",
      club.id,
      date,
    );
    expect(released.length).toBe(1);
    for (const entry of released) {
      expect(entry.amount).toBeLessThan(0);
      const name = entry.description.replace(": contract ended by mutual consent", "");
      const player = (await store.get<Player>("SELECT * FROM players WHERE name = ? AND contract_end = ? AND club_id IS NULL", name, date))!;
      expect(player).toMatchObject({ role: "Free agent", wage: 0, parent_club_id: null });
      expect(await store.get("SELECT 1 FROM player_registrations WHERE player_id = ? AND club_id = ?", player.id, club.id)).toBeUndefined();
    }
  }, 300_000);

  it("ends world loans: players return, or an option is exercised after a successful spell within FFP", async () => {
    const date = "2027-06-30";
    const current = { ...(await stateOf(store)), date };
    await store.setMeta("state", current);
    // Past the clubs the FFP and embargo tests above changed.
    const [parent, borrower, capped] = await store.all<Club>(
      "SELECT * FROM clubs WHERE type = 'club' AND id <> ? AND NOT EXISTS (SELECT 1 FROM sanctions WHERE club_id = clubs.id) ORDER BY reputation DESC OFFSET 6 LIMIT 3",
      state.clubId,
    );
    const [back, kept, refused] = await store.all<Player>(
      "SELECT * FROM players WHERE club_id = ? AND parent_club_id IS NULL AND age_group = 'Senior' AND contract_end > ? ORDER BY id LIMIT 3",
      parent.id,
      date,
    );
    await store.run("UPDATE clubs SET transfer_budget = 500000000, balance = 500000000 WHERE id = ?", borrower.id);
    // A top club may be in Europe next season, so June options are also judged on UEFA rules: player sales keep it
    // inside them as well as the cash keeps it solvent.
    for (const season of [current.season - 1, current.season])
      await store.run(
        `INSERT INTO financial_periods (club_id, season, sale_profit) VALUES (?, ?, 3000000000)
         ON CONFLICT (club_id, season) DO UPDATE SET sale_profit = excluded.sale_profit`,
        borrower.id,
        season,
      );
    // Cash for the fee, but a wage bill next season's revenue cannot carry: the option would breach its FFP limit.
    await store.run("UPDATE clubs SET transfer_budget = 50000000, balance = 50000000 WHERE id = ?", capped.id);
    await store.run("UPDATE players SET wage = wage * 40 WHERE club_id = ?", capped.id);
    for (const [player, type, score, destination] of [[back, "Standard loan", 40, borrower], [kept, "Loan with option", 90, borrower], [refused, "Loan with option", 90, capped]] as const) {
      await store.run(
        "INSERT INTO loans (player_id, parent_id, destination_id, type, start_date, end_date, score, fit, relationship, terms, data) VALUES (?, ?, ?, ?, '2026-08-01', ?, ?, 60, 50, ?, ?)",
        player.id,
        parent.id,
        destination.id,
        type,
        date,
        score,
        JSON.stringify({ salarySplit: 80, optionFee: 1000, playingTime: 70 }),
        JSON.stringify({ world: true, parentRole: "Squad player", parentTraining: "Balanced", startingMinutes: 0 }),
      );
      await store.run(
        "UPDATE players SET club_id = ?, parent_club_id = ?, ability = ?, minutes = ? WHERE id = ?",
        destination.id,
        parent.id,
        Math.max(player.ability, destination.reputation),
        score > 50 ? 3000 : 0,
        player.id,
      );
    }
    await reviewWorldLoans(store, current);
    expect(await expireWorldLoans(store, current)).toBeGreaterThanOrEqual(3);
    expect(await store.get("SELECT club_id, parent_club_id FROM players WHERE id = ?", back.id)).toEqual({ club_id: parent.id, parent_club_id: null });
    expect(await store.get("SELECT club_id, parent_club_id FROM players WHERE id = ?", kept.id)).toEqual({ club_id: borrower.id, parent_club_id: null });
    expect(await store.get("SELECT club_id, parent_club_id FROM players WHERE id = ?", refused.id)).toEqual({ club_id: parent.id, parent_club_id: null });
    const ids = [back.id, kept.id, refused.id];
    expect(await store.all("SELECT status FROM loans WHERE player_id = ANY(?::integer[]) ORDER BY player_id", ids)).toEqual(
      ids.sort((left, right) => left - right).map((id) => ({ status: id === kept.id ? "purchased" : "completed" })),
    );
    expect(await store.get("SELECT 1 FROM history WHERE entity_id = ? AND data::jsonb ->> 'type' = 'Option exercised'", kept.id)).toBeDefined();
    expect(await expireWorldLoans(store, current)).toBe(0);
  });
});

describe("release clauses and part-exchange in the director's negotiations", () => {
  let store: Store;
  let state: GameState;
  beforeAll(async () => {
    store = await Store.createTest("deal-clauses");
    await generateWorld(store, { nations: ["EN", "ES"], seed: "deal-clause-tests" });
    await createCalendar(store);
    await store.setMeta("state", { ...(await stateOf(store)), date: "2026-07-05" });
    await store.run("UPDATE clubs SET transfer_budget = 900000000, balance = 900000000, wage_budget = 50000000, reputation = 90 WHERE id = (SELECT (value::jsonb ->> 'clubId')::integer FROM meta WHERE key = 'state')");
    state = await stateOf(store);
    await ensureReleaseClauses(store, state.date);
  }, 300_000);
  afterAll(async () => {
    await store?.close();
  });

  async function talks(player: Player) {
    const enquiry = await enquire(store, player.id, "Permanent transfer");
    await negotiationStep(store, enquiry.id, "formalize");
    return (await store.get<Negotiation>("SELECT * FROM negotiations WHERE id = ?", enquiry.id))!;
  }

  it("pays a release clause: the club cannot refuse and talks move to personal terms at the clause", async () => {
    const player = (await store.get<Player>(
      `SELECT players.* FROM players JOIN clubs ON clubs.id = players.club_id JOIN countries ON countries.id = clubs.country_id
       WHERE countries.code = 'ES' AND players.parent_club_id IS NULL AND players.age BETWEEN 20 AND 28 AND clubs.type = 'club'
       ORDER BY clubs.reputation, players.ability DESC LIMIT 1`,
    ))!;
    const clause = contract(player)!.releaseClause!;
    expect(clause).toBeGreaterThan(player.value);
    const negotiation = await talks(player);
    expect(negotiation.stage).toBe("Club talks");
    const result = await payReleaseClause(store, negotiation.id);
    expect(result.stage).toBe("Agent talks");
    const paid = (await store.get<Negotiation>("SELECT * FROM negotiations WHERE id = ?", negotiation.id))!;
    expect(paid.offer).toBe(clause);
    expect((JSON.parse(paid.data) as NegotiationData).releaseClause).toBe(true);
    await expect(payReleaseClause(store, negotiation.id)).rejects.toThrow(/formal talks/);
    const plain = (await store.get<Player>(
      `SELECT players.* FROM players JOIN clubs ON clubs.id = players.club_id JOIN countries ON countries.id = clubs.country_id
       WHERE countries.code = 'EN' AND players.club_id <> ? AND players.parent_club_id IS NULL AND players.age BETWEEN 20 AND 28 AND clubs.type = 'club'
         AND players.profile::jsonb #>> '{contract,releaseClause}' IS NULL ORDER BY players.id LIMIT 1`,
      state.clubId,
    ))!;
    await expect(payReleaseClause(store, (await talks(plain)).id)).rejects.toThrow(/no release clause/);
  });

  it("counts a part-exchange player towards the fee and moves him at completion", async () => {
    const seller = (await store.get<Club>(
      "SELECT * FROM clubs WHERE type = 'club' AND id <> ? AND country_id = (SELECT country_id FROM clubs WHERE id = ?) ORDER BY reputation DESC LIMIT 1",
      state.clubId,
      state.clubId,
    ))!;
    await store.run("UPDATE clubs SET reputation = 99, wage_budget = 90000000 WHERE id = ?", seller.id);
    const target = (await store.get<Player>(
      "SELECT * FROM players WHERE club_id = ? AND parent_club_id IS NULL AND age BETWEEN 21 AND 28 AND NOT EXISTS (SELECT 1 FROM negotiations WHERE negotiations.player_id = players.id) ORDER BY ability DESC LIMIT 1",
      seller.id,
    ))!;
    const own = (await store.get<Player>(
      "SELECT * FROM players WHERE club_id = ? AND parent_club_id IS NULL AND age BETWEEN 20 AND 28 AND age_group = 'Senior' ORDER BY ability DESC LIMIT 1",
      state.clubId,
    ))!;
    await store.run("UPDATE players SET value = ? WHERE id = ?", target.value, own.id);
    const negotiation = await talks(target);
    const sellerClub = (await store.get<Club>("SELECT * FROM clubs WHERE id = ?", seller.id))!;
    const part = await exchangePart(store, own.id, sellerClub, target);
    expect(part.valuation).toBeGreaterThan(0);
    expect(part.valuation).toBeLessThanOrEqual(target.value);
    const offer = { fee: Math.round(negotiation.asking_price * 0.5), wage: target.wage * 2, years: 4, role: "Regular starter", promises: [] };
    const exchanged = await negotiate(store, negotiation.id, { ...offer, exchangePlayerId: own.id });
    const data = JSON.parse((await store.get<Negotiation>("SELECT * FROM negotiations WHERE id = ?", negotiation.id))!.data) as NegotiationData;
    expect(data.exchange).toMatchObject({ playerId: own.id, name: own.name });
    if (exchanged.stage === "Agent talks") expect(exchanged.message).toContain(own.name);
    await expect(exchangePart(store, target.id, sellerClub, target)).rejects.toThrow();
    expect(await exchangeIssue(store, data.exchange!, state.clubId)).toBeNull();
    const buyer = (await store.get<Club>("SELECT * FROM clubs WHERE id = ?", state.clubId))!;
    await completeExchange(store, data.exchange!, buyer, sellerClub, target.id);
    const moved = (await store.get<Player>("SELECT * FROM players WHERE id = ?", own.id))!;
    expect(moved.club_id).toBe(seller.id);
    expect(moved.wage).toBe(data.exchange!.wage);
    expect(await store.get("SELECT 1 FROM history WHERE entity_id = ? AND data::jsonb ->> 'type' = 'Part-exchange'", own.id)).toBeDefined();
    expect(await exchangeIssue(store, data.exchange!, state.clubId)).toMatch(/no longer available/);
  });
});

describe("FFP planning gate before the rollover", () => {
  let store: Store;
  beforeAll(async () => {
    store = await Store.createTest("preseason-ffp");
    await generateWorld(store, { nations: ["EN"], squads: "minimum", seed: "rollover-ffp" });
    await createCalendar(store);
  }, 300_000);
  afterAll(async () => {
    await store?.close();
  });

  it("judges June deals against next season too, so the rollover finds no club over its limit", async () => {
    const state = await stateOf(store);
    const club = (await store.get<{ id: number; league_id: number }>(
      "SELECT clubs.id, clubs.league_id FROM clubs JOIN leagues ON leagues.id = clubs.league_id WHERE leagues.tier = 2 AND clubs.type = 'club' AND clubs.id <> ? ORDER BY clubs.id LIMIT 1",
      state.clubId,
    ))!;
    // A finished season: the club is bottom of its division and pays more than a relegated club can earn.
    await store.run("UPDATE fixtures SET status = 'played', home_goals = 1, away_goals = 0 WHERE season = ? AND status = 'scheduled'", state.season);
    await store.run("UPDATE standings SET played = 46, wins = 15, draws = 10, losses = 21, points = 55 WHERE league_id = ?", club.league_id);
    await store.run("UPDATE standings SET wins = 0, draws = 0, losses = 46, points = 0 WHERE league_id = ? AND club_id = ?", club.league_id, club.id);
    await store.run("UPDATE players SET wage = wage * 1.6 WHERE coalesce(parent_club_id, club_id) = ?", club.id);
    const headroom = async (date: string) => {
      await store.setMeta("state", { ...(await stateOf(store)), date });
      return (await assessFinancesBatch(store, { clubIds: [club.id] })).get(club.id)!;
    };
    // Before the window the closing season's accounts alone leave room to sign.
    const closing = await headroom("2027-06-14");
    expect(closing.ffpHeadroom).toBeGreaterThan(0);
    expect((await plannedLeagueMoves(store, state.season)).get(club.id)?.movement).toBe("relegated");
    const preseason = await headroom("2027-06-30");
    await advance(store, 1);
    expect(await stateOf(store)).toMatchObject({ season: state.season + 1, date: "2027-07-01" });
    const after = (await assessFinancesBatch(store, { clubIds: [club.id] })).get(club.id)!;
    // Relegated, the new season's accounts put him over the limit: a June deal judged on the closing season alone
    // (closing.ffpHeadroom) would breach on rollover day. The pre-season projection finds what the rollover finds,
    // up to what it leaves out (squad top-ups, staff and league reputations move a few percent of revenue).
    expect(after.ffpHeadroom).toBeLessThan(0);
    expect(preseason.ffpHeadroom).toBeLessThan(0);
    expect(Math.abs(preseason.ffpHeadroom - after.ffpHeadroom)).toBeLessThan(0.05 * after.footballRevenue);
  }, 300_000);

  it("plans June deals for either continental outcome, since the rollover resolves next season's places", async () => {
    const state = await stateOf(store);
    const assess = async (date: string) => {
      await store.setMeta("state", { ...(await stateOf(store)), date });
      return (await assessFinancesBatch(store, { clubIds: [club.id] })).get(club.id)!;
    };
    await store.setMeta("state", { ...state, date: `${state.season + 1}-06-30` });
    const moves = await plannedLeagueMoves(store, state.season);
    // A second-tier club (domestic solvency rules) staying in its division.
    const club = (
      await store.all<{ id: number }>(
        "SELECT clubs.id FROM clubs JOIN leagues ON leagues.id = clubs.league_id WHERE leagues.tier = 2 AND clubs.type = 'club' AND clubs.id <> ? AND clubs.parent_id IS NULL ORDER BY clubs.id",
        state.clubId,
      )
    ).find((candidate) => !moves.has(candidate.id))!;
    // In Europe this season, with player sales that keep it well inside the UEFA limits, but no cash and a payroll over
    // budget: without a continental place next season the domestic solvency gate would stop any further spending.
    const cup = (await store.get<{ id: number }>(
      "INSERT INTO leagues(name, country_id, confederation, tier, age_group, kind, reputation, format, data) VALUES ('Test Continental Cup', NULL, 'UEFA', 0, 'Senior', 'continental', 90, 'League', '{}') RETURNING id",
    ))!;
    await store.run("INSERT INTO standings(league_id, club_id) VALUES (?, ?)", cup.id, club.id);
    for (const season of [state.season - 1, state.season])
      await store.run(
        `INSERT INTO financial_periods (club_id, season, sale_profit) VALUES (?, ?, 3000000000)
         ON CONFLICT (club_id, season) DO UPDATE SET sale_profit = excluded.sale_profit`,
        club.id,
        season,
      );
    await store.run("UPDATE clubs SET balance = 0 WHERE id = ?", club.id);
    await store.run("UPDATE players SET wage = wage * 2 WHERE coalesce(parent_club_id, club_id) = ?", club.id);
    const closing = await assess(`${state.season + 1}-06-14`);
    expect(closing.policy).toBe("UEFA financial sustainability");
    expect(closing.ffpHeadroom).toBeGreaterThan(0);
    // From the window's opening the club may lose its place at the rollover: the stricter domestic projection binds.
    const preseason = await assess(`${state.season + 1}-06-30`);
    expect(preseason.policy).toBe("UEFA financial sustainability");
    expect(preseason.ffpHeadroom).toBeLessThan(0);
    expect(preseason.feeCashShare).toBeGreaterThan(0);
    await store.run("DELETE FROM standings WHERE league_id = ?", cup.id);
    await store.run("DELETE FROM leagues WHERE id = ?", cup.id);
    await store.setMeta("state", state);
  }, 300_000);

  it("plans a domestic cup winner's June deals under UEFA rules too, whatever its division", async () => {
    const state = await stateOf(store);
    await store.setMeta("state", { ...state, date: `${state.season + 1}-06-30` });
    const moves = await plannedLeagueMoves(store, state.season);
    const [, club] = (
      await store.all<{ id: number }>(
        "SELECT clubs.id FROM clubs JOIN leagues ON leagues.id = clubs.league_id WHERE leagues.tier = 2 AND clubs.type = 'club' AND clubs.id <> ? AND clubs.parent_id IS NULL ORDER BY clubs.id",
        state.clubId,
      )
    ).filter((candidate) => !moves.has(candidate.id));
    const cup = (await store.get<{ id: number }>(
      "SELECT id FROM leagues WHERE kind = 'cup' AND age_group = 'Senior' AND country_id IS NOT NULL ORDER BY id LIMIT 1",
    ))!;
    // Rich enough for the domestic solvency gate, but a payroll far beyond what UEFA's squad-cost rule allows.
    await store.run("UPDATE clubs SET balance = 1000000000 WHERE id = ?", club.id);
    await store.run("UPDATE players SET wage = wage * 5 WHERE coalesce(parent_club_id, club_id) = ?", club.id);
    const assess = async () => (await assessFinancesBatch(store, { clubIds: [club.id] })).get(club.id)!;
    const without = await assess();
    expect(without.policy).toBe("Domestic club solvency");
    expect(without.ffpHeadroom).toBeGreaterThan(0);
    const won = await store.get<{ id: number }>(
      "INSERT INTO history(season, entity_type, entity_id, date, data) VALUES (?, 'champion', ?, ?, ?) RETURNING id",
      state.season,
      cup.id,
      `${state.season + 1}-05-20`,
      JSON.stringify({ clubId: club.id, name: "Cup winner", competition: "Cup" }),
    );
    // The cup may bring a continental place at the rollover: UEFA's limit binds before it.
    expect((await assess()).ffpHeadroom).toBeLessThan(0);
    await store.run("DELETE FROM history WHERE id = ?", won!.id);
    await store.setMeta("state", state);
  }, 300_000);
});
