import { createReadStream } from "node:fs";
import { rm } from "node:fs/promises";
import { Writable } from "node:stream";
import seedrandom from "seedrandom";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Store } from "./db.ts";
import { generateWorld } from "./world.ts";
import { createCalendar } from "./calendar.ts";
import { advance } from "./simulation.ts";
import { Saves } from "./saves.ts";
import { readCheckpoint, writeCheckpoint, type RestoredValue } from "./save-format.ts";
import { notificationFeed } from "./notifications.ts";
import { stateOf } from "./systems.ts";
import { clubLifeDaily, clubLifeView, relegationClausesAtRollover, worldNews } from "./club-life.ts";
import { loadLifeClubs, patchClubData } from "./club-life-context.ts";
import { WORLD_NEWS_CATEGORY, worldNewsFeed } from "./world-news.ts";
import { AFFILIATE_LIFE, affiliateLifecycle } from "./affiliate-lifecycle.ts";
import { chooseProject, clubProjectsWeekly, stadiumUtilisation } from "./club-projects.ts";
import {
  DOF_ROLE,
  directorsWeekly,
  dofEligible,
  dofPolicyFor,
  managerPreference,
  MANAGER_RULES,
  sackingChance,
} from "./club-directors.ts";
import { administrationPoints, administrationWeekly, guardForcedSale } from "./administration.ts";
import { sweepRelegationClauses } from "./contract-clauses.ts";
import {
  RELEGATION_CLAUSE,
  relegationClauseShare,
  relegationClauseText,
  relegationWageCutFor,
} from "../shared/contract-clauses.ts";
import { addDays, FORMATION_POSITIONS } from "../shared/rules.ts";
import type { GameState, PlayerProfile } from "../shared/types.ts";
import type { LifeClub } from "./club-life-context.ts";

/** A generator whose every roll passes a chance test. */
const lowRolls = Object.assign(() => 0.001, { double: () => 0.001, int32: () => 0, quick: () => 0.001, state: () => ({}) }) as seedrandom.PRNG;

const lifeClub = (overrides: Partial<LifeClub>): LifeClub => ({
  id: 1,
  name: "Test FC",
  city: "Testville",
  country_id: 1,
  code: "EN",
  league_id: 1,
  tier: 2,
  league_reputation: 60,
  league_size: 24,
  reputation: 60,
  balance: 20_000_000,
  capacity: 20_000,
  facilities: 50,
  academy: 50,
  philosophy: "Sustainable growth",
  culture: "Professional",
  fan_mood: 70,
  crisis: 0,
  manager: "A Manager",
  formation: "4-3-3",
  tactical_style: "Balanced",
  stadium: "Test Park",
  data: {},
  revenue: 30_000_000,
  user: false,
  ...overrides,
});

describe("club life rules (no database)", () => {
  it("gives relegation wage cuts of 25-50% to most lower-division contracts and none at established top clubs", () => {
    expect(relegationClauseShare(1, 85)).toBe(0);
    expect(relegationClauseShare(1, 55)).toBeGreaterThan(0.5);
    expect(relegationClauseShare(3, 40)).toBe(RELEGATION_CLAUSE.lowerTierShare);
    expect(relegationClauseShare(6, 30)).toBe(RELEGATION_CLAUSE.amateurShare);
    const cuts = Array.from({ length: 2000 }, (_, index) => relegationWageCutFor(index + 1, 77, 2, 50));
    const present = cuts.filter((cut): cut is number => cut !== null);
    expect(present.length / cuts.length).toBeGreaterThan(0.75);
    expect(present.length / cuts.length).toBeLessThan(0.85);
    expect(new Set(present)).toEqual(new Set([0.25, 0.3, 0.35, 0.4, 0.45, 0.5]));
    expect(Array.from({ length: 500 }, (_, index) => relegationWageCutFor(index + 1, 9, 1, 90)).every((cut) => cut === null)).toBe(true);
    expect(relegationClauseText({ relegationWageCut: 0.3 })).toBe("30% wage reduction on relegation");
    expect(relegationClauseText({ relegationWageCut: 0.3, relegationCutApplied: { season: 2027, cut: 0.3 } })).toContain("applied from 2027/28");
    expect(relegationClauseText({ relegationWageCut: null })).toBeNull();
  });

  it("derives a director's transfer policy from his style, the owner's ambition and the finances", () => {
    const base = { style: "balanced" as const, ambition: 50, philosophy: "Sustainable growth", balance: 10e6, revenue: 20e6, administration: false };
    expect(dofPolicyFor(base)).toBe("balanced");
    expect(dofPolicyFor({ ...base, style: "youth" })).toBe("youth");
    expect(dofPolicyFor({ ...base, ambition: 90 })).toBe("stars");
    expect(dofPolicyFor({ ...base, ambition: 20 })).toBe("value");
    expect(dofPolicyFor({ ...base, style: "stars", balance: -5e6 })).toBe("value");
    expect(dofPolicyFor({ ...base, style: "stars", administration: true })).toBe("value");
    expect(dofEligible(lifeClub({ tier: 3, reputation: 30 }))).toBe(true);
    expect(dofEligible(lifeClub({ tier: 5, reputation: 40 }))).toBe(false);
    expect(dofEligible(lifeClub({ tier: 5, reputation: 55 }))).toBe(true);
    expect(dofEligible(lifeClub({ tier: 1, user: true }))).toBe(false);
  });

  it("sacks managers more often the deeper the crisis, always when trust is gone, and picks a playable formation", () => {
    expect(sackingChance(0, 70)).toBe(MANAGER_RULES.base);
    expect(sackingChance(60, 40)).toBeGreaterThan(sackingChance(30, 40));
    expect(sackingChance(30, 20)).toBeGreaterThan(sackingChance(30, 45));
    expect(sackingChance(55, 15)).toBe(1);
    expect(sackingChance(100, 23)).toBeLessThanOrEqual(MANAGER_RULES.maximum);
    const random = seedrandom("formations");
    const picks = Array.from({ length: 400 }, () => managerPreference(random, "EN", 4, "Direct"));
    expect(picks.every((pick) => pick.formation in FORMATION_POSITIONS)).toBe(true);
    expect(picks.filter((pick) => pick.formation === "4-4-2").length).toBeGreaterThan(120);
    expect(picks.filter((pick) => pick.style === "Direct").length).toBeGreaterThan(100);
  });

  it("chooses infrastructure against domestic peers and stadium demand, within the club's cash", () => {
    const random = seedrandom("projects");
    const peers = { facilities: 60, academy: 50, capacity: 20_000 };
    expect(chooseProject(lifeClub({ facilities: 48 }), peers, 50, random, new Set())).toMatchObject({ kind: "facilities", effect: { facilities: 10 } });
    expect(chooseProject(lifeClub({ facilities: 48 }), peers, 50, random, new Set(["facilities"]))).toBeNull();
    expect(chooseProject(lifeClub({ facilities: 48, balance: 2e6 }), peers, 50, random, new Set())).toBeNull();
    expect(chooseProject(lifeClub({ academy: 40, philosophy: "Develop and sell", facilities: 60 }), peers, 50, random, new Set())?.kind).toBe("academy");
    const soldOut = lifeClub({ reputation: 80, fan_mood: 95, facilities: 60, capacity: 18_000 });
    expect(stadiumUtilisation(soldOut)).toBeGreaterThan(0.9);
    const expansion = chooseProject(soldOut, peers, 50, random, new Set());
    expect(expansion?.kind).toBe("stadium_expansion");
    expect(expansion?.effect.capacity).toBeGreaterThanOrEqual(1000);
    const cramped = lifeClub({ reputation: 80, fan_mood: 95, facilities: 60, capacity: 9000, revenue: 60e6, balance: 400e6 });
    expect(chooseProject(cramped, peers, 50, random, new Set())).toMatchObject({ kind: "new_stadium", cashShare: 0.3, planningWeeks: 26 });
    expect(chooseProject(lifeClub({ reputation: 40, fan_mood: 40, facilities: 60 }), peers, 50, random, new Set())).toBeNull();
  });

  it("deducts points by association rules on entering administration", () => {
    expect(administrationPoints("EN", 2)).toBe(12);
    expect(administrationPoints("EN", 6)).toBe(10);
    expect(administrationPoints("SCO", 1)).toBe(15);
    expect(administrationPoints("ES", 1)).toBe(0);
    expect(administrationPoints("FR", 1)).toBe(10);
  });
});

describe("club life in a generated world", () => {
  let store: Store;
  let state: GameState;
  const random = lowRolls;
  const world = async () => loadLifeClubs(store, await stateOf(store));
  beforeAll(async () => {
    store = await Store.createTest("club_life");
    await generateWorld(store, { nations: ["EN"], squads: "minimum", seed: "club-life-tests" });
    await createCalendar(store);
    state = await stateOf(store);
  }, 300_000);
  afterAll(async () => {
    await store?.close();
  });

  it("creates the v7 tables and the world feed index", async () => {
    expect(await store.get<{ total: number }>("SELECT count(*) AS total FROM club_projects")).toEqual({ total: 0 });
    expect(
      await store.get("SELECT indexname FROM pg_catalog.pg_indexes WHERE schemaname = ? AND indexname = 'news_world'", store.schemaName),
    ).toBeTruthy();
  });

  it("publishes world news with countries for the feed's filters and keeps it out of the inbox", async () => {
    const [first, second] = await store.all<{ id: number; name: string; country_id: number }>(
      "SELECT id,name,country_id FROM clubs WHERE type = 'club' ORDER BY id LIMIT 2",
    );
    await worldNews(store, { kind: "test", title: `${first.name} news`, body: "A world event.", clubIds: [first.id], date: state.date });
    await worldNews(store, { kind: "other", title: `${second.name} news`, body: "Another.", clubIds: [second.id, first.id], date: state.date, data: { playerId: 7 } });
    const all = await worldNewsFeed(store, {});
    expect(all.total).toBeGreaterThanOrEqual(2);
    expect(all.kinds.map((entry) => entry.kind)).toEqual(expect.arrayContaining(["test", "other"]));
    expect(all.countries.map((entry) => entry.id)).toContain(first.country_id);
    expect((await worldNewsFeed(store, { kind: "test" })).items.every((item) => item.kind === "test")).toBe(true);
    const byClub = await worldNewsFeed(store, { club: second.id });
    expect(byClub.items).toHaveLength(1);
    expect(byClub.items[0]).toMatchObject({ kind: "other", playerId: 7, clubs: [{ id: second.id }, { id: first.id }] });
    expect(byClub.club).toEqual({ id: second.id, name: second.name });
    expect((await worldNewsFeed(store, { country: first.country_id })).total).toBe(all.total);
    expect((await notificationFeed(store, { archive: "1", limit: 200 })).some((item) => item.category === WORLD_NEWS_CATEGORY)).toBe(false);
  });

  it("terms contracts at generation, backfills older worlds once, re-terms signings and cuts wages on relegation", async () => {
    // A new world's contracts carry their terms from generation; the backfill gives an older world the same ones.
    expect(await store.meta("clauseSweep")).toEqual({ backfilled: true });
    const generated = await store.all<{ id: number; profile: string }>(
      "SELECT id,profile FROM players WHERE jsonb_exists(profile::jsonb -> 'contract', 'relegationClauseClubId') ORDER BY id",
    );
    expect(generated.length).toBeGreaterThan(100);
    await store.run(
      "UPDATE players SET profile = jsonb_set(profile::jsonb, '{contract}', (profile::jsonb -> 'contract') - 'relegationWageCut' - 'relegationClauseClubId')::text WHERE id = ANY(?::integer[])",
      generated.map((row) => row.id),
    );
    await store.run("DELETE FROM meta WHERE key = 'clauseSweep'");
    expect(await sweepRelegationClauses(store, state.date)).toBe(generated.length);
    expect(await store.meta("clauseSweep")).toEqual({ backfilled: true, date: state.date });
    const backfilled = await store.all<{ id: number; profile: string }>("SELECT id,profile FROM players WHERE id = ANY(?::integer[]) ORDER BY id", generated.map((row) => row.id));
    expect(backfilled.map((row) => JSON.parse(row.profile).contract)).toEqual(generated.map((row) => JSON.parse(row.profile).contract));
    const stamped = await store.all<{ id: number; club_id: number; tier: number; reputation: number; profile: string }>(
      `SELECT players.id,clubs.id AS club_id,coalesce(leagues.tier,9) AS tier,clubs.reputation,players.profile FROM players
       JOIN clubs ON clubs.id = coalesce(players.parent_club_id,players.club_id) LEFT JOIN leagues ON leagues.id = clubs.league_id
       WHERE clubs.type = 'club' AND players.age_group = 'Senior' AND players.role <> 'Retired' ORDER BY players.id`,
    );
    expect(stamped.length).toBeGreaterThan(100);
    for (const row of stamped) {
      const contract = (JSON.parse(row.profile) as PlayerProfile).contract;
      const cut = relegationWageCutFor(row.id, row.club_id, row.tier, row.reputation);
      // Only contracts with a clause are written; without one the terms are the same deterministic null.
      if (contract?.status === "amateur" || cut === null) expect(contract?.relegationClauseClubId).toBeUndefined();
      else expect(contract).toMatchObject({ relegationWageCut: cut, relegationClauseClubId: row.club_id });
    }
    expect(await sweepRelegationClauses(store, state.date)).toBe(0);
    // A signing re-terms the contract for the new club.
    const mover = stamped.find((row) => row.tier === 1)!;
    const destination = (await store.get<{ id: number }>(
      "SELECT id FROM clubs WHERE type = 'club' AND id <> ? ORDER BY reputation LIMIT 1", mover.club_id))!.id;
    await store.run("UPDATE players SET club_id = ?, parent_club_id = NULL WHERE id = ?", destination, mover.id);
    await store.run("INSERT INTO history(season,entity_type,entity_id,date,data) VALUES (?,'transfer',?,?,'{}')", state.season, mover.id, state.date);
    expect(await sweepRelegationClauses(store, addDays(state.date, 1))).toBe(1);
    expect((JSON.parse((await store.get<{ profile: string }>("SELECT profile FROM players WHERE id = ?", mover.id))!.profile) as PlayerProfile)
      .contract?.relegationClauseClubId).toBe(destination);
    await store.run("UPDATE players SET club_id = ? WHERE id = ?", mover.club_id, mover.id);
    const club = await store.get<{ id: number; name: string }>(
      `SELECT clubs.id,clubs.name FROM clubs JOIN leagues ON leagues.id = clubs.league_id WHERE clubs.type = 'club'
       AND EXISTS (SELECT 1 FROM players WHERE players.club_id = clubs.id AND jsonb_typeof(players.profile::jsonb #> '{contract,relegationWageCut}') = 'number')
       ORDER BY clubs.id LIMIT 1`,
    );
    const squad = await store.all<{ id: number; wage: number; morale: number; profile: string }>(
      "SELECT id,wage,morale,profile FROM players WHERE club_id = ? AND parent_club_id IS NULL AND age_group = 'Senior' AND wage > 0 ORDER BY id",
      club!.id,
    );
    await patchClubData(store, new Map([[club!.id, { budgetMovement: "relegated" }]]));
    const cuts = await relegationClausesAtRollover(store, state, state.season + 1);
    await patchClubData(store, new Map([[club!.id, { budgetMovement: null }]]));
    const withClause = squad.filter((player) => (JSON.parse(player.profile) as PlayerProfile).contract?.relegationWageCut);
    expect(cuts.filter((cut) => cut.clubId === club!.id)).toHaveLength(withClause.length);
    for (const player of withClause) {
      const cut = (JSON.parse(player.profile) as PlayerProfile).contract!.relegationWageCut!;
      const after = (await store.get<{ wage: number; morale: number; profile: string }>("SELECT wage,morale,profile FROM players WHERE id = ?", player.id))!;
      expect(after.wage).toBe(Math.round(player.wage * (1 - cut)));
      expect(after.morale).toBe(Math.max(1, player.morale - RELEGATION_CLAUSE.morale));
      expect((JSON.parse(after.profile) as PlayerProfile).contract?.relegationCutApplied).toEqual({
        season: state.season + 1, cut, from: player.wage, to: Math.round(player.wage * (1 - cut)),
      });
    }
    const untouched = squad.find((player) => !(JSON.parse(player.profile) as PlayerProfile).contract?.relegationWageCut);
    if (untouched)
      expect((await store.get<{ wage: number }>("SELECT wage FROM players WHERE id = ?", untouched.id))!.wage).toBe(untouched.wage);
    expect((await worldNewsFeed(store, { kind: "contract", club: club!.id })).total).toBe(1);
  });

  it("forms, reviews and ends AI affiliate partnerships and places development loans with affiliates", async () => {
    // Clubs without an affiliate look for one (the starter agreements are removed here).
    await store.run("DELETE FROM partnerships");
    const clubs = await world();
    const balances = new Map(clubs.map((club) => [club.id, club.balance]));
    const result = await affiliateLifecycle(store, state, random, clubs);
    expect(result.formed).toBeGreaterThan(0);
    const formed = await store.all<{ id: number; club_id: number; partner_id: number; type: string; data: string }>(
      "SELECT id,club_id,partner_id,type,data FROM partnerships WHERE data::jsonb ->> 'origin' = 'ai' ORDER BY id",
    );
    expect(formed).toHaveLength(result.formed);
    const byId = new Map(clubs.map((club) => [club.id, club]));
    for (const link of formed) {
      const [club, partner] = [byId.get(link.club_id)!, byId.get(link.partner_id)!];
      expect(club.user || partner.user).toBe(false);
      expect(club.league_id).not.toBe(partner.league_id);
      expect(partner.reputation).toBeLessThan(club.reputation);
      const fee = JSON.parse(link.data).annualFee as number;
      expect(fee).toBeGreaterThan(0);
      expect((await store.get<{ balance: number }>("SELECT balance FROM clubs WHERE id = ?", club.id))!.balance).toBeLessThan(balances.get(club.id)!);
    }
    expect((await worldNewsFeed(store, { kind: "affiliate" })).total).toBeGreaterThanOrEqual(result.formed);
    // Development loans: affiliates of strength take young surplus players through the loan machinery.
    expect(result.loans).toBeGreaterThan(0);
    const loans = await store.all<{ player_id: number; parent_id: number; destination_id: number; type: string; terms: string }>(
      "SELECT player_id,parent_id,destination_id,type,terms FROM loans WHERE data::jsonb #>> '{reason,code}' = 'development-pathway' ORDER BY id",
    );
    expect(loans).toHaveLength(result.loans);
    for (const loan of loans) {
      expect(loan.type).toBe("Development loan");
      expect(JSON.parse(loan.terms)).toMatchObject({ fee: 0, salarySplit: 40 });
      expect(await store.get("SELECT id FROM partnerships WHERE (club_id = ? AND partner_id = ?) OR (club_id = ? AND partner_id = ?)",
        loan.parent_id, loan.destination_id, loan.destination_id, loan.parent_id)).toBeTruthy();
      const player = (await store.get<{ club_id: number; parent_club_id: number; age: number }>(
        "SELECT club_id,parent_club_id,age FROM players WHERE id = ?", loan.player_id))!;
      expect(player).toMatchObject({ club_id: loan.destination_id, parent_club_id: loan.parent_id });
      expect(player.age).toBeLessThanOrEqual(AFFILIATE_LIFE.loanAges[1]);
    }
    // A year on: the starter and new agreements are reviewed; the idle, weakened ones end.
    const later = { ...state, date: addDays(state.date, AFFILIATE_LIFE.reviewDays + 60) };
    await store.run("UPDATE partnerships SET strength = 15 WHERE id = ?", formed[0].id);
    const reviewed = await affiliateLifecycle(store, later, () => 0.9, await world());
    expect(reviewed.ended + reviewed.renewed).toBeGreaterThan(0);
    expect(await store.get("SELECT id FROM partnerships WHERE id = ?", formed[0].id)).toBeUndefined();
    expect(await store.get("SELECT id FROM history WHERE entity_type = 'partnership' AND entity_id = ?", formed[0].club_id)).toBeTruthy();
    const renewed = await store.all<{ data: string }>("SELECT data FROM partnerships WHERE data::jsonb ->> 'lastReview' = ?", later.date);
    expect(renewed).toHaveLength(reviewed.renewed);
    expect(renewed.every((row) => JSON.parse(row.data).nextReview === addDays(later.date, AFFILIATE_LIFE.reviewDays))).toBe(true);
  });

  it("starts, pays for and completes infrastructure projects", async () => {
    const clubs = await world();
    const club = clubs.filter((entry) => !entry.user && entry.tier === 1).sort((a, b) => b.revenue - a.revenue)[0];
    await store.run("UPDATE clubs SET facilities = 20, balance = ? WHERE id = ?", club.revenue * 3, club.id);
    const result = await clubProjectsWeekly(store, state, random, await world(), new Map());
    expect(result.started).toBeGreaterThan(0);
    const project = (await store.get<{ id: number; kind: string; status: string; effect: string; data: string; cost: number }>(
      "SELECT id,kind,status,effect,data,cost FROM club_projects WHERE club_id = ?", club.id))!;
    expect(project).toMatchObject({ kind: "facilities", status: "building" });
    const effect = JSON.parse(project.effect) as { facilities: number };
    const weekly = JSON.parse(project.data).weeklyCash as number;
    const balance = (await store.get<{ balance: number }>("SELECT balance FROM clubs WHERE id = ?", club.id))!.balance;
    const next = { ...state, date: addDays(state.date, 7) };
    await clubProjectsWeekly(store, next, () => 0.99, await world(), new Map());
    expect((await store.get<{ balance: number }>("SELECT balance FROM clubs WHERE id = ?", club.id))!.balance).toBeCloseTo(balance - weekly, 0);
    expect((await store.get<{ excluded_investment: number }>(
      "SELECT excluded_investment FROM financial_periods WHERE club_id = ? AND season = ?", club.id, state.season))!.excluded_investment).toBeLessThan(0);
    await store.run("UPDATE club_projects SET end_date = ? WHERE id = ?", next.date, project.id);
    const done = await clubProjectsWeekly(store, { ...next, date: addDays(next.date, 7) }, () => 0.99, await world(), new Map());
    expect(done.completed).toBe(1);
    expect((await store.get<{ facilities: number }>("SELECT facilities FROM clubs WHERE id = ?", club.id))!.facilities).toBe(20 + effect.facilities);
    expect((await clubLifeView(store, club.id)).projects[0]).toMatchObject({ id: project.id, status: "complete", cost: project.cost });
    expect((await worldNewsFeed(store, { kind: "project", club: club.id })).total).toBe(2);
  });

  it("appoints directors of football, sets their policies and replaces one after a long crisis", async () => {
    const result = await directorsWeekly(store, state, seedrandom("directors"), await world(), new Map());
    const clubs = await world();
    const eligible = clubs.filter(dofEligible);
    expect(result.appointed).toBe(eligible.length);
    const directors = await store.all<{ club_id: number; id: number; data: string }>(
      "SELECT club_id,id,data FROM staff WHERE role = ? AND club_id IS NOT NULL", DOF_ROLE);
    expect(new Set(directors.map((director) => director.club_id))).toEqual(new Set(eligible.map((club) => club.id)));
    for (const club of eligible) {
      expect(club.data.dofId).toBe(directors.find((director) => director.club_id === club.id)!.id);
      expect(club.data.dofPolicy).toMatch(/balanced|youth|value|stars/);
    }
    expect((await worldNewsFeed(store, { kind: "director" })).total).toBe(0);
    const target = eligible[0];
    await store.run("UPDATE clubs SET crisis = 90 WHERE id = ?", target.id);
    await patchClubData(store, new Map([[target.id, { dofSince: addDays(state.date, -400) }]]));
    const replaced = await directorsWeekly(store, { ...state, date: addDays(state.date, 7) }, lowRolls, await world(), new Map());
    expect(replaced.dismissed).toBeGreaterThanOrEqual(1);
    const view = await clubLifeView(store, target.id);
    expect(view.director?.id).not.toBe(target.data.dofId);
    expect(view.director?.since).toBe(addDays(state.date, 7));
    expect((await worldNewsFeed(store, { kind: "director", club: target.id })).items[0].title).toContain("dismiss");
    await store.run("UPDATE clubs SET crisis = 0 WHERE id = ?", target.id);
  });

  it("lets a patient, wealthy owner rescue an insolvent club instead of administration", async () => {
    const club = (await world()).find((entry) => !entry.user && entry.tier === 2)!;
    await store.run("UPDATE clubs SET balance = ? WHERE id = ?", -club.revenue, club.id);
    await store.run(
      "UPDATE owners SET wealth = 1e12, patience = 100, type = 'billionaire' WHERE id = (SELECT owner_id FROM club_ownership WHERE club_id = ?)",
      club.id,
    );
    await store.run("UPDATE club_ownership SET member_owned = false WHERE club_id = ?", club.id);
    await patchClubData(store, new Map([[club.id, { insolvency: { weeks: 9, since: addDays(state.date, -63) } }]]));
    const result = await administrationWeekly(store, state, lowRolls, await world());
    expect(result).toMatchObject({ entered: 0, rescued: 1 });
    const after = (await world()).find((entry) => entry.id === club.id)!;
    expect(after.balance).toBeCloseTo(club.revenue * 0.1, -4);
    expect(after.data.insolvency).toBeUndefined();
    expect(after.data.ownerRescue).toBe(state.date);
    expect((await worldNewsFeed(store, { kind: "ownership", club: club.id })).items[0].title).toContain("rescue");
    await store.run("UPDATE clubs SET balance = ? WHERE id = ?", club.balance, club.id);
  });

  it("puts a club that stays insolvent into administration and takes it out again", async () => {
    const own = (await stateOf(store)).clubId;
    const club = (await world()).find((entry) => entry.id === own)!;
    // An owner without patience leaves the club to the administrators.
    await store.run("UPDATE owners SET patience = 0 WHERE id = (SELECT owner_id FROM club_ownership WHERE club_id = ?)", own);
    await store.run("UPDATE clubs SET balance = ? WHERE id = ?", -club.revenue, own);
    await patchClubData(store, new Map([[own, { insolvency: { weeks: 9, since: addDays(state.date, -63) } }]]));
    const points = (await store.get<{ deducted: number }>("SELECT deducted FROM standings WHERE club_id = ? AND league_id = ?", own, club.league_id))!;
    const entered = await administrationWeekly(store, state, lowRolls, await world());
    expect(entered.entered).toBe(1);
    const view = await clubLifeView(store, own);
    expect(view.administration).toMatchObject({ since: state.date, points: administrationPoints(club.code, club.tier), pendingPoints: 0 });
    expect(view.administration!.forcedSales.length).toBeGreaterThan(0);
    expect((await store.get<{ deducted: number }>("SELECT deducted FROM standings WHERE club_id = ? AND league_id = ?", own, club.league_id))!.deducted)
      .toBe(points.deducted + administrationPoints(club.code, club.tier));
    expect(await store.all("SELECT kind FROM sanctions WHERE club_id = ? ORDER BY id", own)).toEqual([{ kind: "points" }, { kind: "embargo" }]);
    const forced = view.administration!.forcedSales[0].playerId;
    expect((await store.get<{ listed: number }>("SELECT listed FROM players WHERE id = ?", forced))!.listed).toBe(1);
    await expect(guardForcedSale(store, forced, false)).rejects.toThrow(/administrators/);
    await guardForcedSale(store, forced, true);
    expect((await notificationFeed(store, {})).some((item) => item.title === "The club has entered administration")).toBe(true);
    // Not yet twelve weeks: still in administration even with cash back.
    await store.run("UPDATE clubs SET balance = 1000000 WHERE id = ?", own);
    expect((await administrationWeekly(store, { ...state, date: addDays(state.date, 28) }, lowRolls, await world())).exited).toBe(0);
    const exitDate = addDays(state.date, 7 * 12);
    expect((await administrationWeekly(store, { ...state, date: exitDate }, lowRolls, await world())).exited).toBe(1);
    const after = await clubLifeView(store, own);
    expect(after.administration).toBeNull();
    expect(after.administrations).toEqual([{ since: state.date, until: exitDate, points: administrationPoints(club.code, club.tier), outcome: "recovered" }]);
    expect((await store.get<{ end_date: string }>("SELECT end_date FROM sanctions WHERE club_id = ? AND kind = 'embargo'", own))!.end_date).toBe(exitDate);
    expect((await store.get<{ listed: number }>("SELECT listed FROM players WHERE id = ?", forced))!.listed).toBe(0);
    await guardForcedSale(store, forced, false);
  });

  it("runs the daily pipeline with new managers changing shape, and restores saves made before club projects", async () => {
    const own = (await stateOf(store)).clubId;
    const troubled = (await store.get<{ id: number; formation: string }>(
      "SELECT id,formation FROM clubs WHERE type = 'club' AND id <> ? ORDER BY id LIMIT 1", own))!;
    await store.run("UPDATE clubs SET manager_trust = 10, crisis = 80 WHERE id = ?", troubled.id);
    await clubLifeDaily(store, await stateOf(store), seedrandom("daily"));
    await advance(store, 8);
    const change = await store.get<{ data: string }>("SELECT data FROM history WHERE entity_type = 'manager' AND entity_id = ?", troubled.id);
    expect(change).toBeTruthy();
    const record = JSON.parse(change!.data) as { formation: string; previousFormation: string; style: string };
    expect(record.previousFormation).toBe(troubled.formation);
    expect((await store.get<{ formation: string; tactical_style: string }>("SELECT formation,tactical_style FROM clubs WHERE id = ?", troubled.id)))
      .toEqual({ formation: record.formation, tactical_style: record.style });
    expect((await clubLifeView(store, troubled.id)).managers[0]).toMatchObject({ formation: record.formation });
    expect((await worldNewsFeed(store, { kind: "manager", club: troubled.id })).total).toBe(1);

    await store.setMeta("state", { ...(await stateOf(store)), started: true });
    const saves = new Saves(store);
    const exported = await saves.export();
    try {
      const rows = new Map<string, RestoredValue[][]>();
      const contents = await readCheckpoint(createReadStream(exported.file), {
        onRow(table, values) {
          rows.set(table.name, [...(rows.get(table.name) ?? []), values]);
        },
      });
      expect(rows.get("club_projects")?.length).toBeGreaterThan(0);
      const legacy = structuredClone(contents.manifest);
      legacy.tables = legacy.tables.filter((table) => table.name !== "club_projects");
      const chunks: Buffer[] = [];
      await writeCheckpoint(
        new Writable({
          write(chunk, _encoding, callback) {
            chunks.push(Buffer.from(chunk));
            callback();
          },
        }),
        legacy,
        (table) => rows.get(table.name) ?? [],
      );
      await saves.import(Buffer.concat(chunks));
      expect(await store.get<{ total: number }>("SELECT count(*) AS total FROM club_projects")).toEqual({ total: 0 });
      const imported = (await stateOf(store)).date;
      await advance(store, 7);
      expect((await stateOf(store)).date).toBe(addDays(imported, 7));
    } finally {
      await rm(exported.file, { force: true });
    }
  }, 600_000);
});
