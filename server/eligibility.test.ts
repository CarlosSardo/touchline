import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Store } from "./db.ts";
import { generateWorld } from "./world.ts";
import { createCalendar } from "./calendar.ts";
import {
  clubOf,
  enquire,
  expireLoans,
  negotiate,
  negotiationStep,
  playerOf,
  progressDealMilestones,
  startLoanSpell,
  defaultLoanTerms,
  stateOf,
} from "./systems.ts";
import { matchTeam } from "./simulation.ts";
import {
  canSign,
  eligibilitySummaries,
  eligibleForFixture,
  playerEligibility,
  processRegistrations,
  refreshQuotaLists,
} from "./eligibility.ts";
import { eligibilityLabel } from "../shared/eligibility.ts";
import { addDays } from "../shared/rules.ts";
import { assessRegistration } from "./registration.ts";
import { gbeAssessments } from "./gbe.ts";
import { competitionRegistrationRule } from "../shared/competition-rules.ts";
import { validateManifest, SAVE_FORMAT_VERSION } from "./save-format.ts";
import { checkpointSchema } from "./saves.ts";
import type { Club, Fixture, League, Negotiation, Player, PlayerProfile } from "../shared/types.ts";

describe("eligibility labels and rules (pure)", () => {
  it("labels each layer combination", () => {
    const base = { contracted: true, onLoanFromParent: false, competitions: [{ status: "registered" as const, primary: true }] };
    expect(eligibilityLabel({ ...base, association: { status: "registered" } }).text).toBe("Signed · eligible");
    expect(eligibilityLabel({ ...base, association: { status: "refused", gbeFailed: true, points: 9, passMark: 15 } })).toEqual({
      label: "ineligible_gbe",
      text: "Ineligible · insufficient GBE (9/15)",
    });
    expect(eligibilityLabel({ ...base, association: { status: "pending" } }).text).toBe("Registration pending");
    expect(
      eligibilityLabel({ ...base, association: { status: "registered" }, competitions: [{ status: "not_registered", primary: true }] }).text,
    ).toBe("Signed · not registered");
    expect(
      eligibilityLabel({
        ...base,
        association: { status: "registered" },
        competitions: [{ status: "pending", primary: true, nextReview: "2027-01-01" }],
      }),
    ).toEqual({ label: "eligible_after_requirements", text: "Eligible after requirements (1 Jan 2027)" });
    expect(
      eligibilityLabel({
        ...base,
        association: { status: "registered" },
        competitions: [{ status: "registered", primary: true }, { status: "not_registered" }],
      }).text,
    ).toBe("Signed · eligible (some competitions)");
    expect(eligibilityLabel({ ...base, contracted: false, association: { status: "not_registered" } }).label).toBe("unavailable");
  });

  it("applies foreign quotas to domestic senior competitions only", () => {
    expect(competitionRegistrationRule({ kind: "league", country_id: 1, age_group: "Senior" })?.foreignQuota).toBe(true);
    expect(competitionRegistrationRule({ kind: "cup", country_id: 1, age_group: "Senior" })?.foreignQuota).toBe(true);
    expect(competitionRegistrationRule({ kind: "continental", country_id: null, age_group: "Senior" })?.foreignQuota).toBe(false);
    expect(competitionRegistrationRule({ kind: "international", country_id: null, age_group: "Senior" })).toBeNull();
  });
});

describe("signing is separate from registration", () => {
  let store: Store;
  let club: Club;
  let league: League;

  const deal = async (id: number) => (await store.get<Negotiation>("SELECT * FROM negotiations WHERE id = ?", id))!;
  const nextDay = async () => {
    const state = await stateOf(store);
    const date = new Date(`${state.date}T12:00:00Z`);
    date.setUTCDate(date.getUTCDate() + 1);
    await store.setMeta("state", { ...state, date: date.toISOString().slice(0, 10) });
  };
  /** Drives a deal through the real path: enquiry, talks, signing, medical, registration stage, completion. */
  async function sign(playerId: number, type: string) {
    const enquiry = await enquire(store, playerId, type);
    await negotiationStep(store, enquiry.id, "formalize");
    for (let round = 0; round < 4 && ["Club talks", "Agent talks"].includes((await deal(enquiry.id)).stage); round++) {
      const current = await deal(enquiry.id);
      await negotiate(store, enquiry.id, {
        fee: Math.max(current.asking_price, current.offer) * 1.1,
        wage: Math.max(current.wage, 1000) * 2,
        years: 3,
        role: "Squad player",
        promises: [],
        ...(type.includes("loan") ? { terms: JSON.parse(current.data).terms } : {}),
      });
    }
    expect((await deal(enquiry.id)).stage).toBe("Contract review");
    await negotiationStep(store, enquiry.id, "sign");
    for (let day = 0; day < 12 && !["Completed", "Rejected"].includes((await deal(enquiry.id)).stage); day++) {
      await nextDay();
      await progressDealMilestones(store, await deal(enquiry.id));
    }
    return deal(enquiry.id);
  }

  /** A Portuguese-only senior at a Portuguese third-tier club: no GBE evidence at all. */
  async function portuguesePlayer(skip: number[] = []) {
    const player = (await store.get<Player>(
      `SELECT players.* FROM players JOIN clubs ON clubs.id = players.club_id JOIN leagues ON leagues.id = clubs.league_id
       JOIN countries ON countries.id = players.country_id
       WHERE countries.code = 'PT' AND leagues.tier = 3 AND players.age BETWEEN 22 AND 29 AND players.age_group = 'Senior'
         AND players.parent_club_id IS NULL AND players.injury_until IS NULL AND players.id <> ALL(?::integer[])
       ORDER BY players.ability, players.id LIMIT 1`,
      skip,
    ))!;
    const profile = JSON.parse(player.profile) as PlayerProfile;
    profile.identity.nationalities = [];
    await store.run(
      "UPDATE players SET profile = ?, contract_end = '2029-06-30' WHERE id = ?",
      JSON.stringify(profile),
      player.id,
    );
    return playerOf(store, player.id);
  }

  beforeAll(async () => {
    store = await Store.createTest("eligibility");
    await generateWorld(store, { nations: ["EN", "PT"], squads: "minimum", seed: "eligibility" });
    await createCalendar(store);
    club = (await store.get<Club>(
      `SELECT clubs.* FROM clubs JOIN leagues ON leagues.id = clubs.league_id JOIN countries ON countries.id = clubs.country_id
       WHERE countries.code = 'EN' AND leagues.tier = 2 AND clubs.type = 'club' ORDER BY clubs.id LIMIT 1`,
    ))!;
    league = (await store.get<League>("SELECT * FROM leagues WHERE id = ?", club.league_id))!;
    await store.run(
      "UPDATE clubs SET balance = 900000000, transfer_budget = 500000000, wage_budget = 50000000 WHERE id = ?",
      club.id,
    );
    await store.setMeta("state", { ...(await stateOf(store)), clubId: club.id, date: "2026-07-01", season: 2026 });
    club = await clubOf(store, club.id);
  }, 240_000);
  afterAll(async () => await store?.close());

  it("predicts AI registrations from the GBE module, quotas aside", async () => {
    const target = await portuguesePlayer();
    const english = await assessRegistration(store, target, club);
    const gbe = (await gbeAssessments(store, [target.id])).get(target.id)!;
    expect(english.gbe?.outcome).toBe(gbe.outcome);
    expect(english.points).toBe(gbe.points);
    expect(english.allowed).toBe(["exempt", "auto_pass", "pass"].includes(gbe.outcome));
    const home = (await clubOf(store, target.club_id!)) as Club;
    expect(await assessRegistration(store, target, home)).toMatchObject({ allowed: true, status: "No FA endorsement required" });
    const local = (await store.get<Player>(
      "SELECT players.* FROM players JOIN countries ON countries.id = players.country_id WHERE countries.code = 'EN' AND players.club_id <> ? LIMIT 1",
      club.id,
    ))!;
    expect((await assessRegistration(store, local, club)).status).toBe("Domestic work rights");
  });

  it("completes the INV-REGISTRATION transfer as signed, not registered", async () => {
    const target = await portuguesePlayer();
    expect((await canSign(store, target.id, club.id, "transfer")).ok).toBe(true);
    const budget = club.transfer_budget;
    const completed = await sign(target.id, "Permanent transfer");
    expect(completed.stage).toBe("Completed");
    const log = JSON.parse(completed.data).log as { type: string; message: string }[];
    expect(log.at(-1)?.message).toMatch(/^Signed\..*Ineligible · insufficient GBE/);
    const signed = await playerOf(store, target.id);
    expect(signed.club_id).toBe(club.id);
    expect((await clubOf(store, club.id)).transfer_budget).toBeLessThan(budget);
    const row = await store.get<{ status: string; basis: string; reasons: string }>(
      "SELECT status, basis, reasons FROM player_registrations WHERE player_id = ? AND club_id = ?",
      target.id,
      club.id,
    );
    expect(row).toMatchObject({ status: "refused", basis: "gbe" });
    const eligibility = await playerEligibility(store, target.id);
    expect(eligibility.contracted).toBe(true);
    expect(eligibility.label).toBe("ineligible_gbe");
    expect(eligibility.text).toMatch(/^Ineligible · insufficient GBE \(\d+\/15\)$/);
    expect(eligibility.association.gbe?.points).toBeLessThan(15);
    expect(eligibility.friendliesOnly).toBe(true);
    expect(eligibility.competitions.find((entry) => entry.leagueId === league.id)?.status).toBe("refused");
    expect((await eligibilitySummaries(store, [signed])).get(target.id)?.label).toBe("ineligible_gbe");
    const news = await store.all<{ title: string }>("SELECT title FROM news WHERE data::jsonb ->> 'playerId' = ?", String(target.id));
    expect(news.map((item) => item.title)).toContain(`${signed.name}: registration refused`);

    // The best player in the squad would start every match if he were eligible.
    await store.run("UPDATE players SET ability = 99, fitness = 99 WHERE id = ?", target.id);
    const date = (await stateOf(store)).date;
    const ids = (team: Awaited<ReturnType<typeof matchTeam>>) => [...team.lineup, ...(team.bench ?? [])].map((player) => player.id);
    const competitive = await matchTeam(store, club, "Senior", date, league);
    expect(ids(competitive)).not.toContain(target.id);
    expect(competitive.lineup.length).toBe(11);
    const friendly = await matchTeam(store, club, "Senior", date);
    expect(friendly.lineup.map((player) => player.id)).toContain(target.id);

    const fixtures = await store.all<Fixture>(
      "SELECT * FROM fixtures WHERE (home_id = ? OR away_id = ?) AND status = 'scheduled' ORDER BY date, id",
      club.id,
      club.id,
    );
    const leagueFixture = fixtures.find((fixture) => fixture.league_id === league.id)!;
    const friendlyFixture = fixtures.find((fixture) => fixture.league_id === null)!;
    expect(friendlyFixture).toBeTruthy();
    expect((await eligibleForFixture(store, leagueFixture.id, [target.id])).has(target.id)).toBe(false);
    expect((await eligibleForFixture(store, friendlyFixture.id, [target.id])).has(target.id)).toBe(true);
    // The fast batch selector reads the same registration predicate.
    const { playFixtureBatch } = await import("./simulation.ts");
    await store.run("UPDATE fixtures SET date = ? WHERE id = ?", date, leagueFixture.id);
    const leftover = await playFixtureBatch(store, [{ ...leagueFixture, date }]);
    expect(leftover).toEqual([]);
    const played = await store.get<{ data: string }>("SELECT data FROM fixtures WHERE id = ?", leagueFixture.id);
    expect(JSON.parse(played!.data).players?.[target.id]).toBeUndefined();
    expect(
      await store.get("SELECT 1 FROM player_match_appearances WHERE fixture_id = ? AND player_id = ?", leagueFixture.id, target.id),
    ).toBeUndefined();
    // The pre-season friendly is played with him (friendlies need only a contract).
    const { playFixture } = await import("./simulation.ts");
    await store.run("UPDATE fixtures SET date = ? WHERE id = ?", date, friendlyFixture.id);
    await store.run("DELETE FROM player_match_appearances WHERE player_id = ? AND date = ?", target.id, date);
    await playFixture(store, { ...friendlyFixture, date });
    expect(
      await store.get<{ minutes: number }>(
        "SELECT minutes FROM player_match_appearances WHERE fixture_id = ? AND player_id = ?",
        friendlyFixture.id,
        target.id,
      ),
    ).toMatchObject({ minutes: expect.any(Number) });
    expect((await playerEligibility(store, target.id)).label).toBe("ineligible_gbe");
  }, 120_000);

  it("re-evaluates on loan out and return, and when the requirement is met", async () => {
    const target = (await store.get<{ player_id: number }>(
      "SELECT player_id FROM player_registrations WHERE club_id = ? AND status = 'refused'",
      club.id,
    ))!.player_id;
    const player = await playerOf(store, target);
    const borrower = (await store.get<Club>(
      `SELECT clubs.* FROM clubs JOIN countries ON countries.id = clubs.country_id
       WHERE countries.code = 'PT' AND clubs.type = 'club' AND clubs.parent_id IS NULL ORDER BY clubs.id LIMIT 1`,
    ))!;
    const date = (await stateOf(store)).date;
    await startLoanSpell(store, {
      player,
      parentId: club.id,
      borrower,
      type: "Cross-border loan",
      startDate: date,
      endDate: date,
      terms: defaultLoanTerms(player, borrower),
    });
    // Portugal needs no work-permit endorsement: registered at the borrower, the English spell has lapsed.
    expect((await playerEligibility(store, target)).label).toBe("loaned_out");
    expect(await store.get("SELECT 1 FROM player_registrations WHERE player_id = ? AND club_id = ?", target, club.id)).toBeUndefined();
    await expireLoans(store);
    expect((await playerOf(store, target)).club_id).toBe(club.id);
    expect((await playerEligibility(store, target)).label).toBe("ineligible_gbe");

    // An Irish passport is recorded: the next review registers him.
    const profile = JSON.parse((await playerOf(store, target)).profile) as PlayerProfile;
    const ireland = await store.get<{ id: number }>("SELECT id FROM countries WHERE code = 'IE'");
    profile.identity.nationalities = [{ code: "IE", countryId: ireland?.id ?? 0, basis: "descent" } as never];
    await store.run("UPDATE players SET profile = ? WHERE id = ?", JSON.stringify(profile), target);
    await store.setMeta("registrationSeason", 2026);
    await store.run("UPDATE player_registrations SET next_review = ? WHERE player_id = ?", date, target);
    await processRegistrations(store);
    const after = await playerEligibility(store, target);
    expect(after.label).toBe("eligible");
    expect(after.association.basis).toBe("domestic");
    // The next day: he played the friendly today.
    const team = await matchTeam(store, club, "Senior", addDays((await stateOf(store)).date, 1), league);
    expect(team.lineup.map((entry) => entry.id)).toContain(target);
  }, 120_000);

  it("signs loan-ins and free agents without a GBE, and keeps real transfer rules as blockers", async () => {
    await store.setMeta("state", { ...(await stateOf(store)), date: "2026-07-20" });
    const loanTarget = await portuguesePlayer();
    const loan = await sign(loanTarget.id, "Standard loan");
    expect(loan.stage).toBe("Completed");
    expect((await playerOf(store, loanTarget.id)).club_id).toBe(club.id);
    expect((await playerEligibility(store, loanTarget.id)).label).toBe("ineligible_gbe");

    const free = await portuguesePlayer([loanTarget.id]);
    await store.run("UPDATE players SET club_id = NULL, wage = 0, role = 'Free agent' WHERE id = ?", free.id);
    const signed = await sign(free.id, "Permanent transfer");
    expect(signed.stage).toBe("Completed");
    expect((await playerOf(store, free.id)).club_id).toBe(club.id);
    expect((await playerEligibility(store, free.id)).label).toBe("ineligible_gbe");

    // Transfer rules still stop signings: closed window, free agents on loan, contracted players as free agents.
    await store.setMeta("state", { ...(await stateOf(store)), date: "2026-10-10" });
    const other = await portuguesePlayer([loanTarget.id, free.id]);
    const closed = await canSign(store, other.id, club.id, "transfer");
    expect(closed.ok).toBe(false);
    expect(closed.codes).toContain("window");
    expect((await canSign(store, other.id, club.id, "free")).codes).toContain("contracted");
    await store.run("UPDATE players SET club_id = NULL WHERE id = ?", other.id);
    expect((await canSign(store, other.id, club.id, "loan_in")).codes).toContain("free-agent-loan");
    expect((await canSign(store, other.id, club.id, "free")).ok).toBe(true);
    await store.setMeta("state", { ...(await stateOf(store)), date: "2026-07-20" });
  }, 180_000);

  it("moves foreign quotas from signing to competition registration", async () => {
    // A Portuguese top-flight club registered by the Spanish association gets LaLiga's three non-EU places.
    const portugal = (await store.get<Club>(
      `SELECT clubs.* FROM clubs JOIN leagues ON leagues.id = clubs.league_id JOIN countries ON countries.id = clubs.country_id
       WHERE countries.code = 'PT' AND leagues.tier = 1 AND clubs.type = 'club' ORDER BY clubs.id LIMIT 1`,
    ))!;
    const data = { ...JSON.parse(portugal.data), hosted: { host: "ES", registration: "host" } };
    await store.run("UPDATE clubs SET data = ? WHERE id = ?", JSON.stringify(data), portugal.id);
    const squad = await store.all<Player>(
      "SELECT * FROM players WHERE club_id = ? AND age_group = 'Senior' AND role <> 'Retired' ORDER BY ability DESC, id LIMIT 5",
      portugal.id,
    );
    // English nationals are non-EU players in Spain.
    const england = (await store.get<{ id: number }>("SELECT id FROM countries WHERE code = 'EN'"))!;
    for (const player of squad) {
      const profile = JSON.parse(player.profile) as PlayerProfile;
      profile.identity.nationalities = [];
      await store.run("UPDATE players SET profile = ?, country_id = ? WHERE id = ?", JSON.stringify(profile), england.id, player.id);
    }
    await refreshQuotaLists(store, [portugal.id], true);
    const rows = await store.all<{ player_id: number; status: string }>(
      "SELECT player_id, status FROM competition_registrations WHERE club_id = ? AND league_id = ? ORDER BY player_id",
      portugal.id,
      portugal.league_id,
    );
    expect(rows.length).toBeGreaterThanOrEqual(5);
    expect(rows.filter((row) => row.status === "registered")).toHaveLength(3);
    const outside = rows.filter((row) => row.status === "not_registered").map((row) => row.player_id);
    expect(outside).toHaveLength(rows.length - 3);
    const summary = await playerEligibility(store, outside[0]);
    expect(summary.text).toBe("Signed · not registered");
    expect(summary.contracted).toBe(true);
    const fixture = await store.get<Fixture>(
      "SELECT * FROM fixtures WHERE league_id = ? AND (home_id = ? OR away_id = ?) ORDER BY date LIMIT 1",
      portugal.league_id,
      portugal.id,
      portugal.id,
    );
    const allowed = await eligibleForFixture(store, fixture!.id, squad.map((player) => player.id));
    expect(squad.filter((player) => allowed.has(player.id))).toHaveLength(3);
    // A freed place is filled inside a window.
    await store.run("UPDATE players SET club_id = NULL WHERE id = ?", rows.find((row) => row.status === "registered")!.player_id);
    await store.setMeta("registrationSeason", 2026);
    await processRegistrations(store);
    const refreshed = await store.all<{ status: string }>(
      "SELECT status FROM competition_registrations WHERE club_id = ? AND league_id = ?",
      portugal.id,
      portugal.league_id,
    );
    expect(refreshed.filter((row) => row.status === "registered")).toHaveLength(3);
    expect(refreshed).toHaveLength(rows.length - 1);

    // Outside a window a freed place waits for the next opening: "eligible after requirements", then registered.
    await store.setMeta("state", { ...(await stateOf(store)), date: "2026-10-10" });
    const leaving = (await store.get<{ player_id: number }>(
      "SELECT player_id FROM competition_registrations WHERE club_id = ? AND league_id = ? AND status = 'registered' ORDER BY player_id LIMIT 1",
      portugal.id,
      portugal.league_id,
    ))!.player_id;
    await store.run("UPDATE players SET club_id = NULL WHERE id = ?", leaving);
    await processRegistrations(store);
    await refreshQuotaLists(store, [portugal.id]);
    const waiting = (await store.get<{ player_id: number; next_review: string }>(
      "SELECT player_id, next_review FROM competition_registrations WHERE club_id = ? AND league_id = ? AND status = 'pending'",
      portugal.id,
      portugal.league_id,
    ))!;
    expect(waiting.next_review).toBe("2027-01-01");
    expect((await playerEligibility(store, waiting.player_id)).label).toBe("eligible_after_requirements");
    await store.setMeta("state", { ...(await stateOf(store)), date: "2027-01-01" });
    await processRegistrations(store);
    expect((await playerEligibility(store, waiting.player_id)).label).toBe("eligible");
    await store.setMeta("state", { ...(await stateOf(store)), date: "2026-07-20" });
  }, 120_000);

  it("rebuilds a quota list for a player who moved without his old club's rows being cleared", async () => {
    const [from, to] = await store.all<Club>(
      `SELECT clubs.* FROM clubs JOIN leagues ON leagues.id = clubs.league_id JOIN countries ON countries.id = clubs.country_id
       WHERE countries.code = 'PT' AND leagues.tier = 1 AND clubs.type = 'club' ORDER BY clubs.id LIMIT 2`,
    );
    for (const club of [from, to])
      await store.run("UPDATE clubs SET data = ? WHERE id = ?", JSON.stringify({ ...JSON.parse(club.data), hosted: { host: "ES", registration: "host" } }), club.id);
    const england = (await store.get<{ id: number }>("SELECT id FROM countries WHERE code = 'EN'"))!;
    const mover = (await store.get<Player>(
      "SELECT * FROM players WHERE club_id = ? AND age_group = 'Senior' AND role <> 'Retired' AND parent_club_id IS NULL ORDER BY ability DESC, id LIMIT 1",
      from.id,
    ))!;
    const profile = JSON.parse(mover.profile) as PlayerProfile;
    profile.identity.nationalities = [];
    await store.run("UPDATE players SET profile = ?, country_id = ? WHERE id = ?", JSON.stringify(profile), england.id, mover.id);
    await refreshQuotaLists(store, [from.id], true);
    expect(await store.get("SELECT club_id FROM competition_registrations WHERE player_id = ? AND league_id = ?", mover.id, from.league_id)).toEqual({ club_id: from.id });
    // A bulk move (rollover release and re-signing, world market) changes the club without registerSpell's cleanup.
    await store.run("UPDATE players SET club_id = ? WHERE id = ?", to.id, mover.id);
    await refreshQuotaLists(store, [to.id], true);
    expect(await store.all("SELECT club_id FROM competition_registrations WHERE player_id = ? AND league_id = ?", mover.id, to.league_id)).toEqual([{ club_id: to.id }]);
    for (const club of [from, to]) await store.run("UPDATE clubs SET data = ? WHERE id = ?", club.data, club.id);
  }, 120_000);

  it("reviews refused GBE cases when the GBE cache is refreshed", async () => {
    const target = (await store.get<{ player_id: number }>(
      "SELECT player_id FROM player_registrations WHERE club_id = ? AND status = 'refused' AND basis = 'gbe' ORDER BY player_id LIMIT 1",
      club.id,
    ))!.player_id;
    expect((await playerEligibility(store, target)).label).toBe("ineligible_gbe");
    // New evidence (here a recorded British passport) only counts once the GBE refresh has run.
    const profile = JSON.parse((await playerOf(store, target)).profile) as PlayerProfile;
    const england = (await store.get<{ id: number }>("SELECT id FROM countries WHERE code = 'EN'"))!;
    profile.identity.nationalities = [{ code: "EN", countryId: england.id, basis: "descent" } as never];
    await store.run("UPDATE players SET profile = ? WHERE id = ?", JSON.stringify(profile), target);
    await store.run("UPDATE player_registrations SET next_review = '2099-01-01' WHERE player_id = ?", target);
    await processRegistrations(store);
    expect((await playerEligibility(store, target)).label).toBe("ineligible_gbe");
    await store.setMeta("gbeRefresh", { date: (await stateOf(store)).date, ruleset: "test", players: 1 });
    await processRegistrations(store);
    expect((await playerEligibility(store, target)).label).toBe("eligible");
    const news = await store.all<{ title: string }>("SELECT title FROM news WHERE data::jsonb ->> 'playerId' = ?", String(target));
    expect(news.map((item) => item.title)).toContain(`${(await playerOf(store, target)).name}: now registered`);
  }, 120_000);

  it("lets older checkpoints omit the registration tables", async () => {
    const expected = await checkpointSchema(store);
    expect(expected.tables.filter((table) => table.optional).map((table) => table.name)).toEqual(
      expect.arrayContaining(["player_registrations", "competition_registrations"]),
    );
    const manifest = (tables: typeof expected.tables) => ({
      kind: "manifest",
      format: "touchline",
      formatVersion: SAVE_FORMAT_VERSION,
      schemaVersion: expected.version,
      createdAt: new Date().toISOString(),
      tables: tables.map((table) => ({ name: table.name, columns: table.columns, rowCount: 0 })),
    });
    expect(() => validateManifest(manifest(expected.tables.filter((table) => !table.optional)), expected)).not.toThrow();
    expect(() => validateManifest(manifest(expected.tables.filter((table) => table.name !== "players")), expected)).toThrow(
      /inventory is incomplete/,
    );
  });
  it("migrates a live world to v4 and backfills its lists lazily", async () => {
    await store.exec(
      "DROP TABLE competition_registrations; DROP TABLE player_registrations; DELETE FROM schema_migrations WHERE version = 4; DELETE FROM meta WHERE key = 'registrationSeason'",
    );
    await store.schema();
    expect(await store.get("SELECT version FROM schema_migrations WHERE version = 4")).toBeTruthy();
    // Existing squads keep the registration on file: no rows, everyone eligible.
    expect((await playerEligibility(store, (await store.get<{ id: number }>(
      "SELECT id FROM players WHERE club_id = ? ORDER BY id LIMIT 1",
      club.id,
    ))!.id)).label).toBe("eligible");
    await store.transaction(() => processRegistrations(store));
    expect(await store.get<{ value: string }>("SELECT value FROM meta WHERE key = 'registrationSeason'")).toEqual({ value: "2026" });
    const team = await matchTeam(store, club, "Senior", (await stateOf(store)).date, league);
    expect(team.lineup).toHaveLength(11);
  });
});
