import { afterAll, beforeAll, describe, expect, it } from "vitest";
import seedrandom from "seedrandom";
import { Store } from "./db.ts";
import { generateWorld } from "./world.ts";
import { continentalEntries } from "./qualification.ts";
import { fairValueForFfp } from "./finance.ts";
import { memberShare, planOwnership, privateOwnerType, type PlanClub } from "./ownership-plan.ts";
import {
  ensureOwnership,
  injectEquity,
  multiClubExclusions,
  ownerGroupOf,
  ownershipDaily,
  ownershipRollover,
  ownershipSnapshot,
  relatedPartyTerms,
  sameOwnerGroup,
  saleRate,
  seasonFunding,
  sisterPreference,
  startSale,
  type Deal,
  type OwnershipData,
} from "./ownership.ts";
import { clubOwnership, ownershipNotice, ownershipOverview } from "./ownership-views.ts";
import { addDays } from "../shared/rules.ts";
import type { GameState } from "../shared/types.ts";

const sqlIntegration = process.env.SQL_INTEGRATION_TESTS === "true";

const club = (id: number, code: string, tier: number, reputation: number): PlanClub => ({
  id,
  name: `Club ${id}`,
  city: `City ${id}`,
  code,
  countryName: code,
  language: code === "ES" ? "es" : code === "DE" ? "de" : code === "PT" ? "pt" : "en",
  tier,
  reputation,
  founded: 1900 + id,
  key: `K:${code}:${id}`,
});

describe("ownership plan (no database)", () => {
  const countries = ["EN", "ES", "DE", "PT", "AR", "FR", "AT", "US"].map((code, index) => ({ id: index + 1, code, name: code, capital: `${code} capital` }));
  const clubs: PlanClub[] = [];
  let id = 1;
  for (const { code } of countries)
    for (let tier = 1; tier <= 3; tier++) for (let rank = 0; rank < 18; rank++) clubs.push(club(id++, code, tier, 90 - tier * 15 - rank));

  it("is deterministic per world seed and gives every club exactly one controlling owner", () => {
    const first = planOwnership("seed-a", clubs, countries, "2026-07-01");
    expect(planOwnership("seed-a", clubs, countries, "2026-07-01")).toEqual(first);
    expect(planOwnership("seed-b", clubs, countries, "2026-07-01")).not.toEqual(first);
    expect(first.ownership.map((row) => row.club_id).sort((a, b) => a - b)).toEqual(clubs.map((entry) => entry.id));
    const owners = new Set(first.owners.map((owner) => owner.id));
    for (const row of first.ownership) expect(owners.has(row.owner_id)).toBe(true);
  });

  it("follows national traditions: 50+1, historic member clubs in Spain and Portugal, private clubs in England", () => {
    const plan = planOwnership("traditions", clubs, countries, "2026-07-01");
    // Synthetic clubs are numbered strongest first within each country and tier.
    const of = (code: string, tier: number) =>
      plan.ownership
        .filter((row) => clubs.find((entry) => entry.id === row.club_id)!.code === code && clubs.find((entry) => entry.id === row.club_id)!.tier === tier)
        .sort((left, right) => left.club_id - right.club_id);
    const german = of("DE", 1);
    // 50+1: members hold voting control except at most two works-team exemptions.
    expect(german.filter((row) => row.member_owned).length).toBeGreaterThanOrEqual(16);
    for (const row of german.filter((entry) => entry.member_owned)) {
      expect(row.stake).toBeGreaterThanOrEqual(0.51);
      expect(row.data.rule).toBe("50+1");
    }
    for (const row of german.filter((entry) => !entry.member_owned)) expect(String(row.data.exemption)).toContain("50+1");
    const spanish = of("ES", 1);
    expect(spanish.filter((row) => row.member_owned).map((row) => row.club_id)).toEqual(expect.arrayContaining(spanish.slice(0, 2).map((row) => row.club_id)));
    expect(spanish.filter((row) => !row.member_owned).length).toBeGreaterThan(12);
    expect(of("PT", 1).slice(0, 3).every((row) => row.member_owned)).toBe(true);
    expect(of("AR", 2).every((row) => row.member_owned)).toBe(true);
    expect(of("EN", 1).every((row) => !row.member_owned)).toBe(true);
    for (const row of plan.ownership.filter((entry) => entry.member_owned)) {
      expect(row.president).toBeTruthy();
      expect(row.next_election! > "2026-07-01").toBe(true);
    }
    expect(memberShare("ES", 1, 0)).toBe(1);
    expect(memberShare("IT", 1, 0)).toBe(0);
  });

  it("builds multi-club groups across countries and tiers and mixes private owner types by tier", () => {
    const plan = planOwnership("groups", clubs, countries, "2026-07-01");
    const groups = plan.owners.filter((owner) => owner.data.group);
    expect(groups.length).toBeGreaterThanOrEqual(4);
    for (const group of groups) {
      const owned = plan.ownership.filter((row) => row.owner_id === group.id);
      expect(owned.length).toBeGreaterThanOrEqual(1);
      expect(owned.every((row) => !row.member_owned && row.stake >= 0.4)).toBe(true);
    }
    const crescent = plan.owners.find((owner) => owner.name === "Crescent Global Football")!;
    const codes = new Set(plan.ownership.filter((row) => row.owner_id === crescent.id).map((row) => clubs.find((entry) => entry.id === row.club_id)!.code));
    expect(codes.size).toBeGreaterThanOrEqual(3);
    const types = (tier: number) =>
      plan.ownership
        .filter((row) => !row.member_owned && clubs.find((entry) => entry.id === row.club_id)!.tier === tier)
        .map((row) => plan.owners.find((owner) => owner.id === row.owner_id)!.type);
    expect(types(1).filter((type) => type === "local").length / types(1).length).toBeLessThan(types(3).filter((type) => type === "local").length / types(3).length);
    const random = seedrandom("types");
    const samples = Array.from({ length: 400 }, () => privateOwnerType("EN", 4, 30, random));
    expect(new Set(samples)).toEqual(new Set(["local"]));
  });

  it("models owner money: state and billionaire equity, private equity interest and fees, asset stripping", () => {
    const base = { wealth: 5e9, ambition: 85, revenue: 200_000_000, balance: 50_000_000, debt: 0, stripper: false };
    const state = seasonFunding({ ...base, type: "state", wealth: 5e11 });
    const billionaire = seasonFunding({ ...base, type: "billionaire" });
    const local = seasonFunding({ ...base, type: "local", wealth: 50_000_000 });
    const members = seasonFunding({ ...base, type: "members", wealth: 0 });
    expect(state.injection).toBeGreaterThan(billionaire.injection);
    expect(billionaire.injection).toBeGreaterThan(local.injection);
    expect(members).toEqual({ injection: 0, interest: 0, dividend: 0, factor: 1 });
    const equity = seasonFunding({ ...base, type: "private_equity", ambition: 50, debt: 100_000_000 });
    expect(equity.interest).toBe(6_000_000);
    expect(equity.dividend).toBe(3_000_000);
    expect(equity.factor).toBeLessThan(1);
    const stripper = seasonFunding({ ...base, type: "local", stripper: true });
    expect(stripper.dividend).toBe(4_000_000);
    expect(stripper.factor).toBe(0.6);
  });

  it("only opens member-club sales as minority investments under 50+1", () => {
    const row = { member_owned: true, code: "DE", tier: 1, balance: 1, type: "members" as const, since: "1900-01-01" };
    expect(saleRate(row, {}, "2027-01-01")).toBeGreaterThan(0);
    expect(saleRate(row, { investors: [{ ownerId: 1, name: "x", stake: 0.2 }] }, "2027-01-01")).toBe(0);
    expect(saleRate({ ...row, code: "ES" }, {}, "2027-01-01")).toBe(0);
    expect(saleRate({ ...row, member_owned: false, type: "local", since: "2026-01-01" }, {}, "2027-01-01")).toBe(0);
    expect(saleRate({ ...row, member_owned: false, type: "local", since: "2026-01-01", balance: -5 }, {}, "2027-01-01")).toBeGreaterThan(0);
  });
});

describe.skipIf(!sqlIntegration)("club ownership in a generated world", () => {
  let store: Store;
  const state = async () => store.meta<GameState>("state");
  const setDate = async (date: string) => store.setMeta("state", { ...(await state()), date });
  const ownership = async (clubId: number) =>
    (await store.get<{ owner_id: number; stake: number; member_owned: boolean; president: string | null; next_election: string | null; blind_trust: boolean; data: string }>(
      "SELECT owner_id, stake, member_owned, president, next_election, blind_trust, data FROM club_ownership WHERE club_id = ?",
      clubId,
    ))!;
  const setData = (clubId: number, data: OwnershipData) => store.run("UPDATE club_ownership SET data = ? WHERE club_id = ?", JSON.stringify(data), clubId);
  // The weekly pass runs when the last one is a week old.
  const runWeekly = async () => {
    const meta = await store.meta<Record<string, unknown>>("ownership");
    await store.setMeta("ownership", { ...meta, lastWeekly: "2000-01-01" });
    await store.transaction(async () => ownershipDaily(store, await state(), seedrandom(`weekly:${(await state()).date}`)));
  };
  const topClub = async (code: string, offset = 0) =>
    (await store.get<{ id: number }>(
      `SELECT clubs.id FROM clubs JOIN leagues ON leagues.id = clubs.league_id JOIN countries ON countries.id = clubs.country_id
       WHERE countries.code = ? AND leagues.tier = 1 AND clubs.type = 'club' ORDER BY clubs.reputation DESC, clubs.id LIMIT 1 OFFSET ?`,
      code,
      offset,
    ))!.id;
  const privateClub = async (code: string) =>
    (await store.get<{ id: number }>(
      `SELECT clubs.id FROM clubs JOIN club_ownership AS ownership ON ownership.club_id = clubs.id
       JOIN countries ON countries.id = clubs.country_id JOIN leagues ON leagues.id = clubs.league_id
       WHERE countries.code = ? AND leagues.tier = 1 AND NOT ownership.member_owned AND clubs.id <> ?
         AND ownership.owner_id IN (SELECT owner_id FROM club_ownership GROUP BY owner_id HAVING count(*) = 1)
       ORDER BY clubs.reputation DESC LIMIT 1`,
      code,
      (await state()).clubId,
    ))!.id;

  beforeAll(async () => {
    store = await Store.createTest("ownership");
    await generateWorld(store, { nations: ["EN", "ES", "DE", "PT"], squads: "minimum", seed: "ownership-world" });
  }, 300_000);
  afterAll(async () => await store?.close());

  it("gives every first team an owner at generation, funds the first season and backfills older worlds identically", async () => {
    const counts = (await store.get<{ clubs: number; owned: number; reserves: number }>(
      `SELECT count(*) FILTER (WHERE clubs.type = 'club') AS clubs, count(ownership.club_id) FILTER (WHERE clubs.type = 'club') AS owned,
         count(ownership.club_id) FILTER (WHERE clubs.type <> 'club') AS reserves
       FROM clubs LEFT JOIN club_ownership AS ownership ON ownership.club_id = clubs.id`,
    ))!;
    expect(counts.owned).toBe(counts.clubs);
    expect(counts.reserves).toBe(0);
    const equity = (await store.get<{ clubs: number; total: number }>(
      "SELECT count(*) AS clubs, coalesce(sum(equity), 0) AS total FROM financial_periods WHERE equity > 0",
    ))!;
    expect(equity.clubs).toBeGreaterThan(10);
    expect((await store.get<{ total: number }>("SELECT coalesce(sum(amount), 0) AS total FROM ledger WHERE category = 'Owner equity'"))!.total).toBeCloseTo(equity.total, 0);
    const german = (await store.get<{ members: number; total: number }>(
      `SELECT count(*) FILTER (WHERE ownership.member_owned) AS members, count(*) AS total FROM club_ownership AS ownership
       JOIN clubs ON clubs.id = ownership.club_id JOIN countries ON countries.id = clubs.country_id JOIN leagues ON leagues.id = clubs.league_id
       WHERE countries.code = 'DE' AND leagues.tier = 1`,
    ))!;
    expect(german.members).toBeGreaterThanOrEqual(german.total - 2);
    const before = {
      owners: await store.all("SELECT * FROM owners ORDER BY id"),
      ownership: await store.all("SELECT * FROM club_ownership ORDER BY club_id"),
    };
    await store.transaction(async () => {
      await store.exec("TRUNCATE ownership_events, club_ownership, owners RESTART IDENTITY");
      await store.run("DELETE FROM meta WHERE key = 'ownership'");
    });
    expect((await clubOwnership(store, 1)).ready).toBe(false);
    expect(await ensureOwnership(store)).toBe(true);
    expect(await ensureOwnership(store)).toBe(false);
    expect(await store.all("SELECT * FROM owners ORDER BY id")).toEqual(before.owners);
    expect(await store.all("SELECT * FROM club_ownership ORDER BY club_id")).toEqual(before.ownership);
  }, 120_000);

  it("exposes groups, related parties at fair value and sister-club pathways", async () => {
    const group = (await store.get<{ owner_id: number; first: number; second: number }>(
      `SELECT owner_id, min(club_id) AS first, max(club_id) AS second FROM club_ownership
       WHERE NOT member_owned AND stake >= 0.4 GROUP BY owner_id HAVING count(*) >= 2 ORDER BY owner_id LIMIT 1`,
    ))!;
    expect(group).toBeTruthy();
    const info = await ownerGroupOf(store, group.first);
    expect(info?.ownerId).toBe(group.owner_id);
    expect(info?.groupClubIds).toEqual(expect.arrayContaining([group.first, group.second]));
    expect(await sameOwnerGroup(store, group.first, group.second)).toBe(true);
    const outsider = await privateClub("EN");
    expect(await sameOwnerGroup(store, group.first, outsider)).toBe(false);
    expect(await sameOwnerGroup(store, group.first, group.first)).toBe(false);
    const reserve = await store.get<{ id: number; parent_id: number }>("SELECT id, parent_id FROM clubs WHERE type = 'bteam' AND parent_id = ?", group.first);
    if (reserve) {
      expect(await sameOwnerGroup(store, reserve.id, group.second)).toBe(true);
      expect(await sameOwnerGroup(store, reserve.id, group.first)).toBe(false);
    }
    // A sister-club deal far below market value counts at fair value in the FFP accounts.
    const terms = await relatedPartyTerms(store, group.first, group.second, 1_000_000, 20_000_000);
    expect(terms).toEqual({ related: true, ffpFee: fairValueForFfp(1_000_000, 20_000_000), adjustment: fairValueForFfp(1_000_000, 20_000_000) - 1_000_000 });
    expect(terms.ffpFee).toBe(20_000_000);
    expect((await relatedPartyTerms(store, group.first, outsider, 1_000_000, 20_000_000)).related).toBe(false);
    const snapshot = await ownershipSnapshot(store);
    expect(snapshot.get(group.first)?.groupId).toBe(group.owner_id);
    expect(snapshot.get(outsider)?.groupId).toBeNull();
    expect(sisterPreference(snapshot, group.first, group.second)).toBeGreaterThan(1);
    expect(sisterPreference(snapshot, group.first, outsider)).toBe(1);
    await store.run("UPDATE club_ownership SET blind_trust = true WHERE club_id = ?", group.second);
    // The snapshot is cached per day.
    const today = (await state()).date;
    await setDate(addDays(today, 1));
    expect(sisterPreference(await ownershipSnapshot(store), group.first, group.second)).toBe(0);
    await setDate(today);
    await store.run("UPDATE club_ownership SET blind_trust = false WHERE club_id = ?", group.second);
    const overview = await ownershipOverview(store);
    expect(overview.groups.some((entry) => entry.owner.id === group.owner_id && entry.clubs.length >= 2)).toBe(true);
    expect((await clubOwnership(store, group.first)).group?.clubs.length).toBeGreaterThanOrEqual(2);
  }, 120_000);

  it("records owner equity for FFP and the season's owner funding at rollover", async () => {
    const clubId = await privateClub("ES");
    const before = (await store.get<{ balance: number }>("SELECT balance FROM clubs WHERE id = ?", clubId))!.balance;
    const season = (await state()).season;
    const equity = async () => (await store.get<{ equity: number }>("SELECT equity FROM financial_periods WHERE club_id = ? AND season = ?", clubId, season))?.equity ?? 0;
    const start = await equity();
    await injectEquity(store, clubId, 5_000_000, "Test injection");
    expect((await store.get<{ balance: number }>("SELECT balance FROM clubs WHERE id = ?", clubId))!.balance).toBe(before + 5_000_000);
    expect(await equity()).toBe(start + 5_000_000);
    await expect(injectEquity(store, clubId, -1, "negative")).rejects.toThrow();
    const pe = (await store.get<{ club_id: number }>(
      "SELECT ownership.club_id FROM club_ownership AS ownership JOIN owners ON owners.id = ownership.owner_id WHERE owners.type = 'private_equity' ORDER BY ownership.club_id LIMIT 1",
    ))!.club_id;
    await setData(pe, { ...JSON.parse((await ownership(pe)).data), debt: 50_000_000 });
    const interest = async () => (await store.get<{ total: number }>("SELECT coalesce(sum(amount), 0) AS total FROM ledger WHERE club_id = ? AND category = 'Owner debt interest'", pe))!.total;
    const paid = await interest();
    await store.transaction(async () => ownershipRollover(store));
    expect(await interest()).toBe(paid - 3_000_000);
  }, 120_000);

  it("completes a takeover with equity, budgets, events and news, and keeps 50+1 control with the members", async () => {
    const date = (await state()).date;
    const clubId = await privateClub("EN");
    const club = async () => (await store.get<{ transfer_budget: number; balance: number; expectations: number }>("SELECT transfer_budget, balance, expectations FROM clubs WHERE id = ?", clubId))!;
    const prior = await club();
    const deal: Deal = {
      kind: "takeover",
      stage: "talks",
      buyer: { name: "Test Sovereign Holdings", type: "state", country_id: null, wealth: 5e11, ambition: 95, patience: 70, data: {} },
      buyerName: "Test Sovereign Holdings",
      buyerType: "state",
      price: 300_000_000,
      stake: 1,
      rumoured: addDays(date, -40),
      talks: addDays(date, -20),
      completes: date,
    };
    const previousOwner = (await ownership(clubId)).owner_id;
    await setData(clubId, { deal });
    // 10% of completions collapse: retry with fresh randomness until one completes.
    for (let attempt = 0; attempt < 5 && JSON.parse((await ownership(clubId)).data).deal; attempt++) {
      await setDate(addDays(date, attempt));
      await runWeekly();
      if (!JSON.parse((await ownership(clubId)).data).deal && (await ownership(clubId)).owner_id === previousOwner) await setData(clubId, { deal });
    }
    const after = await ownership(clubId);
    expect(after.owner_id).not.toBe(previousOwner);
    const event = (await store.get<{ kind: string; from_owner_id: number; to_owner_id: number; data: string }>(
      "SELECT kind, from_owner_id, to_owner_id, data FROM ownership_events WHERE club_id = ? AND kind IN ('takeover', 'group_acquisition') ORDER BY id DESC LIMIT 1",
      clubId,
    ))!;
    expect(event).toMatchObject({ kind: "takeover", from_owner_id: previousOwner, to_owner_id: after.owner_id });
    const injection = JSON.parse(event.data).injection as number;
    expect(injection).toBeGreaterThan(0);
    expect((await club()).transfer_budget).toBeGreaterThan(prior.transfer_budget);
    expect((await club()).expectations).toBeLessThanOrEqual(prior.expectations);
    expect((await store.get<{ total: number }>("SELECT coalesce(sum(equity), 0) AS total FROM financial_periods WHERE club_id = ?", clubId))!.total).toBeGreaterThanOrEqual(injection);
    const world = await store.get<{ title: string }>("SELECT title FROM news WHERE category = 'Worldwide' AND title LIKE ? ORDER BY id DESC LIMIT 1", "Test Sovereign Holdings%");
    expect(world?.title).toContain("take over");

    // 50+1: an outside investor in a German members' club only ever gets a minority stake.
    const german = await topClub("DE", 3);
    const members = await ownership(german);
    expect(members.member_owned).toBe(true);
    await setData(german, { ...JSON.parse(members.data), investors: undefined });
    await store.run("UPDATE club_ownership SET stake = 1 WHERE club_id = ?", german);
    const sale = (await startSale(store, german, seedrandom("fifty-plus-one")))!;
    expect(sale.kind).toBe("minority");
    expect(sale.stake).toBeLessThanOrEqual(0.49);
    await setData(german, { ...JSON.parse((await ownership(german)).data), deal: { ...sale, stage: "talks", completes: (await state()).date } });
    for (let attempt = 0; attempt < 5 && JSON.parse((await ownership(german)).data).deal; attempt++) {
      await runWeekly();
      const current = JSON.parse((await ownership(german)).data) as OwnershipData;
      if (!current.deal && !current.investors?.length) await setData(german, { ...current, deal: { ...sale, stage: "talks", completes: (await state()).date } });
    }
    const invested = await ownership(german);
    expect(invested.member_owned).toBe(true);
    expect(invested.owner_id).toBe(members.owner_id);
    expect(invested.stake).toBeGreaterThanOrEqual(0.51);
    expect((JSON.parse(invested.data) as OwnershipData).investors?.[0].stake).toBe(sale.stake);
  }, 180_000);

  it("holds presidential elections with candidates and promises", async () => {
    const clubId = await topClub("ES");
    const before = await ownership(clubId);
    expect(before.member_owned).toBe(true);
    const date = (await state()).date;
    await store.run("UPDATE club_ownership SET next_election = ? WHERE club_id = ?", addDays(date, 20), clubId);
    await runWeekly();
    const campaign = JSON.parse((await ownership(clubId)).data) as OwnershipData;
    expect(campaign.election?.candidates.length).toBeGreaterThanOrEqual(2);
    expect(campaign.election?.candidates.every((candidate) => candidate.promise)).toBe(true);
    await setDate(addDays(date, 21));
    await runWeekly();
    const after = await ownership(clubId);
    expect(after.next_election! > addDays(date, 365 * 3)).toBe(true);
    const election = (await store.get<{ data: string }>("SELECT data FROM ownership_events WHERE club_id = ? AND kind = 'election' ORDER BY id DESC LIMIT 1", clubId))!;
    const result = JSON.parse(election.data) as { winner: string; results: { name: string; share: number }[] };
    expect(result.winner).toBe(after.president);
    expect(result.results.reduce((total, entry) => total + entry.share, 0)).toBeCloseTo(100, 0);
    expect(campaign.election!.candidates.map((candidate) => candidate.name)).toContain(after.president);
    expect((await clubOwnership(store, clubId)).events.some((event) => event.kind === "election")).toBe(true);
    await setDate(date);
  }, 120_000);

  it("applies UEFA's multi-club rule: blind trust or exclusion with the next eligible club taking the place", async () => {
    const season = (await state()).season + 1;
    const english = await topClub("EN");
    const spanish = await topClub("ES", 2);
    const owner = (await ownership(english)).owner_id;
    const saved = await ownership(spanish);
    await store.run("UPDATE club_ownership SET owner_id = ?, stake = 1, member_owned = false, blind_trust = false WHERE club_id = ?", owner, spanish);
    const entrants = [
      { competition: "uefa-champions-league", clubId: english, domesticPosition: 1, associationRank: 1 },
      { competition: "uefa-champions-league", clubId: spanish, domesticPosition: 3, associationRank: 2 },
    ];
    expect([...(await multiClubExclusions(store, season, entrants))]).toEqual([spanish]);
    expect([...(await multiClubExclusions(store, season, entrants))]).toEqual([spanish]);
    expect((await store.get<{ total: number }>("SELECT count(*) AS total FROM ownership_events WHERE kind = 'uefa_exclusion' AND club_id = ?", spanish))!.total).toBe(1);
    // Different competitions do not clash.
    expect((await multiClubExclusions(store, season, [entrants[0], { ...entrants[1], competition: "uefa-europa-league" }])).size).toBe(0);
    const ucl = async () => (await continentalEntries(store, "uefa-champions-league", season, new Set())).map((entry) => entry.club.id);
    const excluded = await ucl();
    expect(excluded).toContain(english);
    expect(excluded).not.toContain(spanish);
    await store.run("UPDATE club_ownership SET blind_trust = true WHERE club_id = ?", spanish);
    const trusted = await ucl();
    expect(trusted).toContain(spanish);
    expect(trusted.length).toBe(excluded.length);
    // The replacement: the club that took the excluded club's place is no longer in.
    expect(excluded.filter((id) => !trusted.includes(id))).toHaveLength(1);
    expect((await store.get<{ total: number }>("SELECT count(*) AS total FROM ownership_events WHERE kind = 'uefa_blind_trust' AND club_id = ?", spanish))!.total).toBe(1);
    await store.run(
      "UPDATE club_ownership SET owner_id = ?, stake = ?, member_owned = ?, blind_trust = ? WHERE club_id = ?",
      saved.owner_id,
      saved.stake,
      saved.member_owned,
      saved.blind_trust,
      spanish,
    );
  }, 120_000);

  it("announces a takeover of the director's club at every step and reviews the director after a grace period", async () => {
    const original = await state();
    const clubId = original.clubId;
    await store.run("UPDATE club_ownership SET member_owned = false, president = NULL, next_election = NULL, since = '2010-01-01' WHERE club_id = ?", clubId);
    const sale = (await startSale(store, clubId, seedrandom("user-sale")))!;
    expect(sale.stage).toBe("rumour");
    const rumour = await store.get<{ title: string; data: string }>("SELECT title, data FROM news WHERE category = 'Board' ORDER BY id DESC LIMIT 1");
    expect(rumour?.title).toMatch(/Takeover talk|Investor talks/);
    expect((await ownershipNotice(store))?.stage).toBe("rumour");
    // Force the bid and the completion (no collapse) and check each is announced.
    const deal: Deal = { ...sale, kind: "takeover", buyer: { ...(sale.buyer ?? { name: "Review Capital", type: "billionaire", country_id: null, wealth: 1e10, patience: 40, data: {} }), name: "Review Capital", type: "billionaire", ambition: 90, data: {} }, buyerId: undefined, buyerName: "Review Capital", buyerType: "billionaire", stage: "talks", completes: original.date };
    for (let attempt = 0; attempt < 5 && JSON.parse((await ownership(clubId)).data).deal; attempt++) {
      await setData(clubId, { deal });
      await runWeekly();
    }
    const completed = await store.get<{ title: string; body: string }>("SELECT title, body FROM news WHERE category = 'Board' AND title LIKE 'Takeover completed%' ORDER BY id DESC LIMIT 1");
    expect(completed?.title).toContain("Review Capital");
    expect(completed?.body).toMatch(/New objective: a top-\d+ finish/);
    expect(completed?.body).toContain("review your work on");
    const notice = (await ownershipNotice(store))!;
    expect(notice.stage).toBe("review");
    expect(notice.target).toBeGreaterThanOrEqual(35);
    // Confirmed when board confidence meets the target at the due date.
    await store.run("UPDATE clubs SET board_confidence = 90 WHERE id = ?", clubId);
    await setDate(notice.due!);
    await store.transaction(async () => ownershipDaily(store, await state(), seedrandom("review-1")));
    expect((await state()).gameOver).toBe(false);
    const board = async () => (await store.get<{ title: string; body: string }>("SELECT title, body FROM news WHERE category = 'Board' ORDER BY id DESC LIMIT 1"))!;
    expect((await board()).title).toContain("back you");
    // Dismissed when it falls short: the tenure ends with an explanation, never silently.
    await store.setMeta("ownership", { ...(await store.meta<Record<string, unknown>>("ownership")), review: { clubId, ownerName: "Review Capital", reason: "takeover", started: original.date, due: notice.due, target: 60 } });
    await store.run("UPDATE clubs SET board_confidence = 20 WHERE id = ?", clubId);
    await store.transaction(async () => ownershipDaily(store, await state(), seedrandom("review-2")));
    expect((await state()).gameOver).toBe(true);
    expect((await board()).body).toContain("against the target of 60");
    await store.setMeta("state", original);
  }, 180_000);
});

describe.skipIf(!sqlIntegration)("ownership in older saves", () => {
  let store: Store;
  beforeAll(async () => {
    store = await Store.createTest("ownership-save");
    await generateWorld(store, { nations: ["SCO", "PT"], squads: "minimum", seed: "ownership-save" });
  }, 300_000);
  afterAll(async () => await store?.close());

  it("restores a save from before ownership with the same owners the world was generated with", async () => {
    const { Saves } = await import("./saves.ts");
    const owners = await store.all("SELECT * FROM owners ORDER BY id");
    const clubs = await store.all("SELECT club_id, owner_id, stake, member_owned, president, next_election FROM club_ownership ORDER BY club_id");
    expect(owners.length).toBeGreaterThan(0);
    // An older checkpoint has no ownership rows (its tables restore empty) and no ownership metadata.
    await store.transaction(async () => {
      await store.exec("TRUNCATE ownership_events, club_ownership, owners RESTART IDENTITY");
      await store.run("DELETE FROM meta WHERE key = 'ownership'");
    });
    const saves = new Saves(store);
    const older = await saves.create("Before ownership");
    await store.run("UPDATE clubs SET name = name || ' (changed)' WHERE id = 1");
    await saves.restore(older.file);
    expect((await store.get<{ name: string }>("SELECT name FROM clubs WHERE id = 1"))!.name).not.toContain("(changed)");
    expect(await store.all("SELECT * FROM owners ORDER BY id")).toEqual(owners);
    expect(await store.all("SELECT club_id, owner_id, stake, member_owned, president, next_election FROM club_ownership ORDER BY club_id")).toEqual(clubs);
    expect((await clubOwnership(store, 1)).ready).toBe(true);
  }, 300_000);
});
