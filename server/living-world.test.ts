// Cross-workstream integration of the "living world": a generated EN + ES + DE world simulated through a season and
// its rollover. The world market, club life (affiliates, directors of football, administration), ownership (groups,
// takeovers, elections) and player records must work together: sister-club pathways, DoF-shaped recruitment,
// sanctions that block registrations and cost points, consistent loans and registrations, tidy player pages.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Store, type SqlParameter } from "./db.ts";
import { generateWorld } from "./world.ts";
import { Saves } from "./saves.ts";
import { advance } from "./simulation.ts";
import { stateOf } from "./systems.ts";
import { assessFinancesBatch, estimateClubRevenue, leagueGroupSizes, seasonHomeMatches, STAFF_REVENUE_SHARE } from "./finance.ts";
import { playerHistory } from "./player-history.ts";
import { clubTransfers } from "./club-transfers.ts";
import { clubOwnership } from "./ownership-views.ts";
import { clubLifeView } from "./club-life.ts";
import { competition, transfers } from "./queries.ts";
import { addDays, transferWindow } from "../shared/rules.ts";

const sqlIntegration = process.env.SQL_INTEGRATION_TESTS === "true";

const END = "2027-08-01";
const ADMINISTRATION_FROM = "2026-10-01";
/** Market moves (the rollover's squad top-ups are registrations, not market deals). */
const MARKET_MOVES = "history.entity_type IN ('transfer','loan') AND coalesce(history.data::jsonb ->> 'type', '') <> 'Squad registration'";

interface FfpCheck {
  date: string;
  clubId: number;
  headroom: number;
  revenue: number;
}

describe.skipIf(!sqlIntegration)("living world: EN + ES + DE through a season and its rollover", () => {
  let store: Store;
  let userFamily: Set<number>;
  const ffpChecks: FfpCheck[] = [];
  let administered: { clubId: number; leagueId: number; since: string } | null = null;
  let tableAtAdministration: { deducted: number; points: number; wins: number; draws: number } | null = null;
  let missingDebuts = -1;
  let checkedDebuts = 0;
  let loaneeInjuries = { checked: 0, wrong: 0 };

  const one = async <Row>(sql: string, ...params: SqlParameter[]) => (await store.get<Row>(sql, ...params))!;

  /** An AI third-tier English club runs out of money: ten weeks of insolvency are already behind it, no owner rescue. */
  async function forceAdministration(date: string) {
    const club = await one<{ id: number; league_id: number }>(
      `SELECT clubs.id, clubs.league_id FROM clubs JOIN leagues ON leagues.id = clubs.league_id
       JOIN countries ON countries.id = leagues.country_id
       WHERE clubs.type = 'club' AND countries.code = 'EN' AND leagues.tier = 3 AND NOT (clubs.id = ANY(?::integer[]))
       ORDER BY clubs.reputation DESC, clubs.id LIMIT 1`,
      [...userFamily],
    );
    await store.run(
      `UPDATE clubs SET balance = -50000000,
         data = (data::jsonb || jsonb_build_object('insolvency', jsonb_build_object('weeks', 9, 'since', ?::text), 'ownerRescue', ?::text))::text
       WHERE id = ?`,
      addDays(date, -63),
      date,
      club.id,
    );
    return { clubId: club.id, leagueId: club.league_id };
  }

  /** Every club that signed someone today (market, negotiations, affiliates) must still be within its FFP limits. */
  async function checkSignings(date: string) {
    const buyers = (
      await store.all<{ club_id: number }>(
        `SELECT DISTINCT coalesce(clubs.parent_id, clubs.id) AS club_id FROM history JOIN clubs ON clubs.id = (history.data::jsonb ->> 'to')::integer
         WHERE history.date = ? AND ${MARKET_MOVES}`,
        date,
      )
    )
      .map((row) => row.club_id)
      .filter((id) => !userFamily.has(id));
    if (!buyers.length) return;
    for (const [clubId, assessment] of await assessFinancesBatch(store, { clubIds: buyers })) {
      ffpChecks.push({ date, clubId, headroom: assessment.ffpHeadroom, revenue: assessment.footballRevenue });
      if (assessment.ffpHeadroom < -0.02 * assessment.footballRevenue) {
        // Context for a failing "keeps every AI signing within FFP": the deals, cash and rules behind the breach.
        const moves = await store.all("SELECT entity_type, data FROM history WHERE date >= ? AND (data::jsonb ->> 'to')::integer IN (SELECT id FROM clubs WHERE id = ? OR parent_id = ?)", addDays(date, -3), clubId, clubId);
        const ledger = await store.all("SELECT date, category, amount, description FROM ledger WHERE date >= ? AND club_id = ?", addDays(date, -3), clubId);
        const club = await store.get("SELECT balance, wage_budget, transfer_budget, league_id, reputation FROM clubs WHERE id = ?", clubId);
        console.log("FFP breach", date, clubId, assessment.ffpHeadroom, assessment.policy, assessment.squadCostRatio, assessment.footballRevenue, assessment.squadCost, JSON.stringify({ moves, ledger, club, prev: ffpChecks.filter((c) => c.clubId === clubId).slice(-4) }));
      }
    }
  }

  /** Before the rollover prunes appearances: players who joined a club (any move or loan) and played for it have their debut recorded. */
  async function checkRecordsOfMovers() {
    const debuts = await one<{ total: number; missing: number }>(
      `WITH moves AS (
         SELECT player_id, club_id, min(date) AS date FROM (
           SELECT history.entity_id AS player_id, (history.data::jsonb ->> 'to')::integer AS club_id, history.date
           FROM history WHERE ${MARKET_MOVES} AND history.season = 2026
           UNION ALL SELECT player_id, destination_id, start_date FROM loans WHERE start_date >= '2026-07-01') AS joined
         GROUP BY 1, 2),
       played AS (
         SELECT DISTINCT moves.player_id, moves.club_id, moves.date FROM moves
         JOIN player_match_appearances AS appearance ON appearance.player_id = moves.player_id AND appearance.club_id = moves.club_id
           AND appearance.date >= moves.date AND appearance.minutes > 0
         JOIN fixtures ON fixtures.id = appearance.fixture_id JOIN leagues ON leagues.id = fixtures.league_id AND leagues.age_group = 'Senior')
       SELECT count(*) AS total, count(*) FILTER (WHERE NOT EXISTS (
           SELECT 1 FROM player_milestones AS milestone WHERE milestone.player_id = played.player_id AND milestone.club_id = played.club_id
             AND milestone.kind IN ('clubDebut', 'seniorDebut'))
         -- A player back at a club he had already played for (e.g. sold and bought back) has no new debut.
         AND NOT EXISTS (SELECT 1 FROM player_season_stats AS stats WHERE stats.player_id = played.player_id AND stats.club_id = played.club_id
           AND stats.season < 2026 AND stats.appearances > 0)
         AND NOT EXISTS (SELECT 1 FROM player_match_appearances AS earlier WHERE earlier.player_id = played.player_id
           AND earlier.club_id = played.club_id AND earlier.date < played.date AND earlier.minutes > 0)) AS missing
       FROM played`,
    );
    checkedDebuts = debuts.total;
    missingDebuts = debuts.missing;
    loaneeInjuries = await one<{ checked: number; wrong: number }>(
      `SELECT count(*) AS checked, count(*) FILTER (WHERE injury.club_id IS DISTINCT FROM loans.destination_id) AS wrong
       FROM loans JOIN player_injuries AS injury ON injury.player_id = loans.player_id AND injury.start_date > loans.start_date
       WHERE loans.status = 'active'`,
    );
  }

  beforeAll(async () => {
    store = await Store.createTest("living-world");
    await generateWorld(store, { nations: ["EN", "ES", "DE"], squads: "minimum", seed: "living-world" });
    const prepared = await stateOf(store);
    await store.setMeta("careerPreparationSeed", prepared.seed);
    await new Saves(store).startCareer({ name: "Integration Director", careerName: "Living world", background: "Former scout", clubId: prepared.clubId });
    await store.setMeta("settings", { ...(await store.meta<Record<string, unknown>>("settings")), autosave: "off" });
    userFamily = new Set(
      (await store.all<{ id: number }>("SELECT id FROM clubs WHERE id = ? OR parent_id = ?", prepared.clubId, prepared.clubId)).map((row) => row.id),
    );
    let recordsChecked = false;
    for (let date = (await stateOf(store)).date; date < END; date = (await stateOf(store)).date) {
      if (!administered && date >= ADMINISTRATION_FROM) administered = { ...(await forceAdministration(date)), since: "" };
      if (!recordsChecked && date >= "2027-06-01") {
        await checkRecordsOfMovers();
        recordsChecked = true;
      }
      // Window days (and the days around the administration) one at a time, the rest in steps of up to two weeks.
      let days = 1;
      if (!transferWindow(addDays(date, 1)) && !(administered && !administered.since))
        while (days < 14 && !transferWindow(addDays(date, days + 1)) && addDays(date, days + 1) <= END) days++;
      try {
        await advance(store, days);
      } catch (error) {
        // The board may sack the director; the world keeps turning for this check.
        if (!String(error).includes("tenure has ended")) throw error;
        await store.setMeta("state", { ...(await stateOf(store)), gameOver: false });
        continue;
      }
      const { date: today } = await stateOf(store);
      // Deals from 15 June are also judged against next season: the rollover day's hold under the new season's accounts.
      if (days === 1 && transferWindow(today)) await checkSignings(today);
      if (administered && !administered.since) {
        const club = await one<{ data: string }>("SELECT data FROM clubs WHERE id = ?", administered.clubId);
        const administration = (JSON.parse(club.data) as { administration?: { since: string } }).administration;
        if (administration) {
          administered.since = administration.since;
          tableAtAdministration = await one(
            "SELECT deducted, points, wins, draws FROM standings WHERE club_id = ? AND league_id = ?",
            administered.clubId,
            administered.leagueId,
          );
        }
      }
    }
  }, 3_600_000);

  afterAll(async () => {
    await store?.close();
  });

  it("keeps the market volume within realistic bands, mostly in the windows", async () => {
    const tiers = await store.all<{ tier: number; clubs: number; moves: number; loans: number }>(
      `WITH moves AS (SELECT (history.data::jsonb ->> 'to')::integer AS club_id, history.entity_type FROM history WHERE ${MARKET_MOVES} AND history.season = 2026)
       SELECT least(leagues.tier, 4) AS tier, count(DISTINCT clubs.id) AS clubs, count(moves.club_id) AS moves,
         count(moves.club_id) FILTER (WHERE moves.entity_type = 'loan') AS loans
       FROM clubs JOIN leagues ON leagues.id = clubs.league_id LEFT JOIN moves ON moves.club_id = clubs.id
       WHERE clubs.type = 'club' GROUP BY 1 ORDER BY 1`,
    );
    const perClub = new Map(tiers.map((row) => [row.tier, row.moves / row.clubs]));
    expect(perClub.get(1)).toBeGreaterThanOrEqual(5);
    expect(perClub.get(1)).toBeLessThanOrEqual(16);
    expect(perClub.get(2)).toBeGreaterThanOrEqual(4);
    expect(perClub.get(2)).toBeLessThanOrEqual(14);
    expect(perClub.get(3)).toBeGreaterThanOrEqual(3);
    expect(perClub.get(4)).toBeGreaterThanOrEqual(2);
    expect(perClub.get(4)).toBeLessThanOrEqual(12);
    const total = tiers.reduce((sum, row) => sum + row.moves, 0);
    const loans = tiers.reduce((sum, row) => sum + row.loans, 0) / total;
    expect(loans).toBeGreaterThanOrEqual(0.25);
    expect(loans).toBeLessThanOrEqual(0.5);
    const dates = await store.all<{ date: string; total: number }>(
      `SELECT history.date, count(*) AS total FROM history WHERE ${MARKET_MOVES} AND history.season = 2026 GROUP BY 1`,
    );
    const outside = dates.filter((row) => !transferWindow(row.date)).reduce((sum, row) => sum + row.total, 0);
    expect(outside / total).toBeLessThan(0.1);
  });

  it("keeps every AI signing within FFP", () => {
    expect(ffpChecks.length).toBeGreaterThan(200);
    const breaches = ffpChecks.filter((check) => check.headroom < -0.02 * check.revenue);
    expect(breaches).toEqual([]);
  });

  it("lets multi-club groups move players along their pathway, related-party deals at fair value", async () => {
    const sister = await store.all<{ entity_type: string; type: string; related: boolean | null; fair: number | null; fee: number }>(
      `WITH control AS (SELECT club_id, owner_id FROM club_ownership WHERE NOT member_owned AND stake >= 0.4),
         root AS (SELECT id, coalesce(parent_id, id) AS root_id FROM clubs)
       SELECT history.entity_type, history.data::jsonb ->> 'type' AS type, (history.data::jsonb ->> 'relatedParty')::boolean AS related,
         (history.data::jsonb ->> 'fairValue')::double precision AS fair, (history.data::jsonb ->> 'fee')::double precision AS fee
       FROM history JOIN root AS seller ON seller.id = (history.data::jsonb ->> 'from')::integer
       JOIN root AS buyer ON buyer.id = (history.data::jsonb ->> 'to')::integer AND buyer.root_id <> seller.root_id
       JOIN control AS selling ON selling.club_id = seller.root_id
       JOIN control AS buying ON buying.club_id = buyer.root_id AND buying.owner_id = selling.owner_id
       WHERE ${MARKET_MOVES}`,
    );
    // Development loans along the group's pathway (loan records; the market's own deals are in the history).
    const pathway = await one<{ total: number; sisters: number }>(
      `WITH control AS (SELECT club_id, owner_id FROM club_ownership WHERE NOT member_owned AND stake >= 0.4)
       SELECT count(*) AS total, count(*) FILTER (WHERE EXISTS (SELECT 1 FROM control AS parent JOIN control AS borrower
         ON borrower.owner_id = parent.owner_id WHERE parent.club_id = loans.parent_id AND borrower.club_id = loans.destination_id)) AS sisters
       FROM loans WHERE data::jsonb #>> '{reason,text}' LIKE 'Development loan to sister club %'`,
    );
    expect(pathway.total).toBeGreaterThan(0);
    expect(pathway.sisters).toBe(pathway.total);
    expect(sister.length + pathway.total).toBeGreaterThan(1);
    // Permanent deals priced by the market between sister clubs carry the fair value the regulator counts.
    for (const deal of sister.filter((entry) => entry.entity_type === "transfer" && entry.type === "Permanent transfer")) {
      expect(deal.related).toBe(true);
      expect(deal.fair).toBeGreaterThan(0);
    }
  });

  it("shapes recruitment by the director of football's policy", async () => {
    const rows = await store.all<{ policy: string; moves: number; young: number; loans: number; headroom: number }>(
      `SELECT coalesce(clubs.data::jsonb ->> 'dofPolicy', 'balanced') AS policy, count(*) AS moves,
         avg(CASE WHEN extract(year FROM age(history.date::date, players.birth_date::date)) <= 23 THEN 1 ELSE 0 END) AS young,
         avg(CASE WHEN history.entity_type = 'loan' THEN 1 ELSE 0 END) AS loans, avg(players.potential - players.ability) AS headroom
       FROM history JOIN players ON players.id = history.entity_id JOIN clubs ON clubs.id = (history.data::jsonb ->> 'to')::integer
       WHERE ${MARKET_MOVES} AND clubs.type = 'club' AND jsonb_exists(clubs.data::jsonb, 'dofPolicy')
       GROUP BY 1`,
    );
    const by = new Map(rows.map((row) => [row.policy, row]));
    for (const policy of ["balanced", "youth", "value", "stars"]) expect(by.get(policy)?.moves ?? 0).toBeGreaterThan(50);
    expect(by.get("youth")!.young).toBeGreaterThan(by.get("balanced")!.young + 0.1);
    expect(by.get("stars")!.loans).toBeLessThan(by.get("balanced")!.loans);
    expect(by.get("value")!.headroom).toBeGreaterThan(by.get("balanced")!.headroom);
  });

  it("puts an insolvent club into administration: points deducted in the table, registrations blocked", async () => {
    expect(administered?.since).toBeTruthy();
    const { clubId, leagueId, since } = administered!;
    const sanctions = await store.all<{ kind: string; points: number; start_date: string; end_date: string | null }>(
      "SELECT kind, points, start_date, end_date FROM sanctions WHERE club_id = ? AND data::jsonb ->> 'rule' = 'administration' ORDER BY id",
      clubId,
    );
    expect(sanctions.map((row) => row.kind)).toEqual(["points", "embargo"]);
    expect(sanctions[0].points).toBe(12);
    expect(tableAtAdministration!.deducted).toBe(12);
    expect(tableAtAdministration!.points).toBe(tableAtAdministration!.wins * 3 + tableAtAdministration!.draws - 12);
    // The season's final table (archived at the rollover) ranks the club on its net points.
    const archived = await one<{ data: string }>(
      "SELECT data FROM history WHERE entity_type = 'league' AND entity_id = ? AND season = 2026 ORDER BY id DESC LIMIT 1",
      leagueId,
    );
    const table = (JSON.parse(archived.data) as { table?: { club_id?: number; clubId?: number; points: number; wins: number; draws: number }[] }).table;
    if (table) {
      const row = table.find((entry) => (entry.club_id ?? entry.clubId) === clubId)!;
      expect(row.points).toBe(row.wins * 3 + row.draws - 12);
      const ordered = [...table].sort((left, right) => right.points - left.points);
      expect(ordered.map((entry) => entry.points)).toEqual(table.map((entry) => entry.points));
    }
    const embargo = sanctions[1];
    const blocked = await one<{ total: number }>(
      `SELECT count(*) AS total FROM history WHERE ${MARKET_MOVES} AND (history.data::jsonb ->> 'to')::integer = ?
         AND history.date >= ? AND (?::text IS NULL OR history.date <= ?::text)`,
      clubId,
      embargo.start_date,
      embargo.end_date,
      embargo.end_date,
    );
    expect(blocked.total).toBe(0);
    const loansIn = await one<{ total: number }>(
      "SELECT count(*) AS total FROM loans WHERE destination_id = ? AND start_date >= ? AND (?::text IS NULL OR start_date <= ?::text)",
      clubId,
      embargo.start_date,
      embargo.end_date,
      embargo.end_date,
    );
    expect(loansIn.total).toBe(0);
    // Players were sold under administration; the club page and the world feed show it.
    const sales = await one<{ total: number }>(
      `SELECT count(*) AS total FROM history WHERE entity_type = 'transfer' AND (data::jsonb ->> 'from')::integer = ? AND date >= ?`,
      clubId,
      since,
    );
    expect(sales.total).toBeGreaterThan(0);
    const life = await clubLifeView(store, clubId);
    expect(life.administration ?? life.administrations[0]).toBeTruthy();
    const feed = await one<{ total: number }>(
      "SELECT count(*) AS total FROM news WHERE category = 'Worldwide' AND date = ? AND data::jsonb -> 'clubIds' @> to_jsonb(?::integer)",
      since,
      clubId,
    );
    expect(feed.total).toBeGreaterThan(0);
    // No other club played a market move while under any embargo either.
    const elsewhere = await one<{ total: number }>(
      `SELECT count(*) AS total FROM sanctions JOIN history ON ${MARKET_MOVES} AND (history.data::jsonb ->> 'to')::integer = sanctions.club_id
         AND history.date > sanctions.start_date AND (sanctions.end_date IS NULL OR history.date <= sanctions.end_date)
       WHERE sanctions.kind = 'embargo'`,
    );
    expect(elsewhere.total).toBe(0);
    const current = await competition(store, leagueId);
    const ranked = current.table.map((row) => row.points);
    expect(ranked).toEqual([...ranked].sort((left, right) => right - left));
  });

  it("reports takeovers and elections in the world news and on the club pages", async () => {
    const events = await store.all<{ id: number; club_id: number; kind: string; date: string; to_owner_id: number | null; data: string }>(
      "SELECT id, club_id, kind, date, to_owner_id, data FROM ownership_events ORDER BY date, id",
    );
    const takeovers = events.filter((event) => ["takeover", "group_acquisition", "supporters_trust"].includes(event.kind));
    const elections = events.filter((event) => event.kind === "election");
    expect(takeovers.length).toBeGreaterThan(0);
    expect(elections.length).toBeGreaterThan(0);
    const news = await store.all<{ date: string; club_ids: number[]; kind: string | null }>(
      "SELECT date, data::jsonb -> 'clubIds' AS club_ids, data::jsonb ->> 'kind' AS kind FROM news WHERE category = 'Worldwide' AND data::jsonb ->> 'ownership' = 'true'",
    );
    const reported = (event: { club_id: number; date: string }) => news.some((item) => item.date === event.date && item.club_ids.includes(event.club_id));
    expect(takeovers.some(reported)).toBe(true);
    expect(elections.some(reported)).toBe(true);
    for (const event of takeovers.filter((entry) => entry.kind === "group_acquisition")) expect(reported(event)).toBe(true);
    // The latest change of control is what the club page shows, with the event in its ownership history.
    const latest = new Map<number, (typeof takeovers)[number]>();
    for (const event of takeovers) latest.set(event.club_id, event);
    for (const event of [...latest.values()].slice(0, 10)) {
      const view = await clubOwnership(store, event.club_id);
      expect(view.ready).toBe(true);
      if (event.to_owner_id !== null) expect(view.owner?.id).toBe(event.to_owner_id);
      expect(view.events.map((entry) => entry.id)).toContain(event.id);
    }
    const lastElection = new Map<number, (typeof elections)[number]>();
    for (const event of elections) lastElection.set(event.club_id, event);
    for (const event of [...lastElection.values()].slice(0, 10)) {
      const view = await clubOwnership(store, event.club_id);
      const later = takeovers.some((entry) => entry.club_id === event.club_id && entry.date > event.date);
      if (!later) expect(view.president).toBe((JSON.parse(event.data) as { winner: string }).winner);
    }
  });

  it("runs affiliate development loans beside world-market loans without duplicates or inconsistent players", async () => {
    const reasons = await store.all<{ reason: string; total: number }>(
      "SELECT coalesce(data::jsonb #>> '{reason,code}', 'market') AS reason, count(*) AS total FROM loans GROUP BY 1",
    );
    const count = new Map(reasons.map((row) => [row.reason, row.total]));
    expect(count.get("development-pathway") ?? 0).toBeGreaterThan(0);
    expect(count.get("market") ?? 0).toBeGreaterThan(100);
    const checks = await one<{ duplicates: number; mismatched: number; orphaned: number; squads: number }>(
      `SELECT
         (SELECT count(*) FROM (SELECT player_id FROM loans WHERE status = 'active' GROUP BY player_id HAVING count(*) > 1) AS twice) AS duplicates,
         (SELECT count(*) FROM loans JOIN players ON players.id = loans.player_id WHERE loans.status = 'active'
            AND (players.club_id IS DISTINCT FROM loans.destination_id OR players.parent_club_id IS DISTINCT FROM loans.parent_id)) AS mismatched,
         (SELECT count(*) FROM players WHERE parent_club_id IS NOT NULL
            AND NOT EXISTS (SELECT 1 FROM loans WHERE loans.player_id = players.id AND loans.status = 'active')) AS orphaned,
         (SELECT count(*) FROM players JOIN clubs AS squad ON squad.id = players.squad_club_id LEFT JOIN clubs AS contract ON contract.id = players.club_id
            WHERE squad.type <> 'national'
              AND coalesce(squad.parent_id, squad.id) IS DISTINCT FROM coalesce(contract.parent_id, contract.id)) AS squads`,
    );
    expect(checks).toEqual({ duplicates: 0, mismatched: 0, orphaned: 0, squads: 0 });
  });

  it("keeps registrations consistent with the players' clubs", async () => {
    const today = (await stateOf(store)).date;
    const stale = await one<{ total: number }>(
      `SELECT count(*) AS total FROM player_registrations AS reg JOIN players ON players.id = reg.player_id
       WHERE players.club_id IS DISTINCT FROM reg.club_id
         AND NOT EXISTS (SELECT 1 FROM history WHERE history.entity_id = reg.player_id AND history.date = ?)
         AND NOT EXISTS (SELECT 1 FROM loans WHERE loans.player_id = reg.player_id AND loans.end_date <= ? AND loans.end_date >= ?)`,
      today,
      today,
      addDays(today, -1),
    );
    expect(stale.total).toBe(0);
    const competitions = await one<{ total: number }>(
      `SELECT count(*) AS total FROM competition_registrations AS comp JOIN players ON players.id = comp.player_id
       WHERE comp.season = ? AND comp.status = 'registered' AND players.club_id IS DISTINCT FROM comp.club_id
         AND NOT EXISTS (SELECT 1 FROM history WHERE history.entity_id = comp.player_id AND history.date = ?)`,
      (await stateOf(store)).season,
      today,
    );
    expect(competitions.total).toBe(0);
  });

  it("records honours, debuts and injuries for the players who moved", async () => {
    expect(checkedDebuts).toBeGreaterThan(100);
    expect(missingDebuts).toBe(0);
    expect(loaneeInjuries.checked).toBeGreaterThan(0);
    expect(loaneeInjuries.wrong).toBe(0);
    // Every senior league champion's squad member (incl. mid-season signings and loanees) holds the title.
    const titles = await one<{ players: number; missing: number; movers: number }>(
      `WITH champions AS (SELECT DISTINCT league_id, club_id FROM player_honours WHERE kind = 'league' AND season = 2026),
         squad AS (SELECT stats.player_id, stats.club_id, stats.league_id FROM player_season_stats AS stats
           JOIN champions USING (league_id, club_id) WHERE stats.season = 2026 AND stats.appearances > 0)
       SELECT count(*) AS players,
         count(*) FILTER (WHERE NOT EXISTS (SELECT 1 FROM player_honours AS honour WHERE honour.player_id = squad.player_id
           AND honour.season = 2026 AND honour.kind = 'league' AND honour.club_id = squad.club_id AND honour.league_id = squad.league_id)) AS missing,
         count(*) FILTER (WHERE EXISTS (SELECT 1 FROM history WHERE ${MARKET_MOVES} AND history.season = 2026 AND history.entity_id = squad.player_id
           AND (history.data::jsonb ->> 'to')::integer = squad.club_id)) AS movers
       FROM squad`,
    );
    expect(titles.players).toBeGreaterThan(100);
    expect(titles.missing).toBe(0);
    expect(titles.movers).toBeGreaterThan(0);
  });

  it("never lists call-ups or squad movements as transfers", async () => {
    const state = await stateOf(store);
    const roots = new Map((await store.all<{ id: number; root: number }>("SELECT id, coalesce(parent_id, id) AS root FROM clubs")).map((row) => [row.id, row.root]));
    const calledUp = await store.all<{ id: number }>("SELECT DISTINCT entity_id AS id FROM history WHERE entity_type = 'squad' ORDER BY 1 LIMIT 40");
    expect(calledUp.length).toBeGreaterThan(0);
    for (const { id } of calledUp) {
      const history = await playerHistory(store, id);
      expect(history.squadMoves.length).toBeGreaterThan(0);
      for (const move of history.transfers) expect(move.from && move.to && roots.get(move.from.id) === roots.get(move.to.id)).toBeFalsy();
    }
    const club = await clubTransfers(store, state.clubId, { pageSize: 500 });
    for (const group of club.groups)
      for (const move of group.transfers) expect(move.club && roots.get(move.club.id) === state.clubId).toBeFalsy();
    const world = (await transfers(store)).market;
    for (const row of world) {
      const move = JSON.parse(row.data) as { from?: number | null; to?: number };
      expect(move.from && move.to && roots.get(move.from) === roots.get(move.to)).toBeFalsy();
    }
    const familyRows = await one<{ total: number }>(
      `SELECT count(*) AS total FROM history JOIN clubs AS source ON source.id = (history.data::jsonb ->> 'from')::integer
       JOIN clubs AS target ON target.id = (history.data::jsonb ->> 'to')::integer
       WHERE history.entity_type IN ('transfer','loan') AND coalesce(source.parent_id, source.id) = coalesce(target.parent_id, target.id)`,
    );
    expect(familyRows.total).toBe(0);
  });

  it("keeps semi-professional clubs solvent with part-time staff and a professional core", async () => {
    const groups = await leagueGroupSizes(store);
    const clubs = await store.all<{
      id: number; reputation: number; capacity: number; fan_mood: number; tier: number; league_reputation: number; code: string;
      wage_budget: number; staff: number; professionals: number;
    }>(
      `SELECT clubs.id, clubs.reputation, clubs.capacity, clubs.fan_mood, leagues.tier, leagues.reputation AS league_reputation, countries.code,
         clubs.wage_budget, coalesce((SELECT sum(wage) FROM staff WHERE staff.club_id = clubs.id), 0) AS staff,
         (SELECT count(*) FROM players WHERE coalesce(players.parent_club_id, players.club_id) = clubs.id AND players.age_group = 'Senior'
            AND coalesce(players.profile::jsonb #>> '{contract,status}', 'professional') = 'professional') AS professionals
       FROM clubs JOIN leagues ON leagues.id = clubs.league_id JOIN countries ON countries.id = leagues.country_id
       WHERE clubs.type = 'club' AND NOT (clubs.id = ANY(?::integer[]))`,
      [...userFamily],
    );
    for (const club of clubs) {
      const revenue = estimateClubRevenue({
        reputation: club.reputation,
        leagueReputation: club.league_reputation,
        tier: club.tier,
        capacity: club.capacity,
        fanMood: club.fan_mood,
        homeMatches: seasonHomeMatches(groups.get(club.id) ?? 0),
        countryCode: club.code,
      }).annualOperatingRevenue;
      expect(club.wage_budget).toBeGreaterThan(0);
      expect(club.professionals).toBeGreaterThanOrEqual(11);
      expect(club.staff).toBeLessThanOrEqual((STAFF_REVENUE_SHARE * revenue * 1.25) / 52 + 100);
    }
    const spanish = clubs.filter((club) => club.code === "ES" && club.tier >= 4);
    expect(spanish.length).toBeGreaterThan(0);
    expect(Math.min(...spanish.map((club) => club.wage_budget))).toBeGreaterThan(0);
  });
});
