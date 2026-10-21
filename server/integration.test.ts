// End-to-end career scenario through the HTTP API and the real daily pipeline (owner's integration requirement):
// sign a foreign player without a GBE -> in the squad but not registered -> clubs see a loan target -> loan offers
// at the chosen frequency -> accept -> the loan is tracked -> he returns and his registration is re-evaluated.
import { afterAll, beforeAll, describe, expect, it, vi, type MockInstance } from "vitest";
import request from "supertest";
import { Store } from "./db.ts";
import { generateWorld } from "./world.ts";
import { createCalendar } from "./calendar.ts";
import { createApp } from "./app.ts";
import { initialInbox, stateOf, weeklyWages } from "./systems.ts";
import { canSign, competitiveRegistrationSql, eligibleForFixture, predictRegistration } from "./eligibility.ts";
import { OFFER_FREQUENCIES, type OfferFrequency } from "./market-offers.ts";
import { addDays, daysBetween, FORMATION_POSITIONS, LOAN_TYPES } from "../shared/rules.ts";
import { blocking } from "../shared/eligibility.ts";
import type { Club, Fixture, Loan, LoanTerms, Negotiation, NegotiationData, Player } from "../shared/types.ts";

const sqlIntegration = process.env.SQL_INTEGRATION_TESTS === "true";

const CRITERIA = [
  "international",
  "domestic_minutes",
  "continental_minutes",
  "league_position",
  "continental_progression",
  "league_standard",
];
const OPEN_STAGES = ["Enquiry", "Club talks", "Agent talks", "Contract review", "Scheduled", "Medical", "Registration", "Offer received"];

interface Breakdown {
  criterion: string;
  points: number;
  status: "scored" | "zero" | "no_data" | "estimate";
  detail: string;
}
interface Gbe {
  playerId: number;
  asOf: string;
  ruleset: string;
  points: number;
  passMark: number;
  autoPass: boolean;
  outcome: string;
  dataQuality: string;
  breakdown: Breakdown[];
}

describe.skipIf(!sqlIntegration)("career integration: unregistered signing, club loan offers, loan and return", () => {
  let store: Store;
  let app: Awaited<ReturnType<typeof createApp>>;
  let errors: MockInstance<typeof console.error>;
  let user: Club;
  let target: Player;
  let signingFee = 0;
  /** Minutes the unregistered signing played in the club's friendlies. */
  let friendlyMinutes = 0;
  let acceptedOffer: Negotiation;
  let loan: Loan;
  /** Players with a long-term injury at the end of the previous simulated day (offers must be withdrawn today). */
  let injuredYesterday = new Map<number, string>();
  /** Approaches to the director created on each simulated day. */
  const approachesByDay = new Map<string, Negotiation[]>();
  const startedAt = performance.now();
  const summary: Record<string, unknown> = {};

  const date = async () => (await stateOf(store)).date;
  const playerRow = async (id: number) => (await store.get<Player>("SELECT * FROM players WHERE id = ?", id))!;
  const negotiationRow = async (id: number) => (await store.get<Negotiation>("SELECT * FROM negotiations WHERE id = ?", id))!;
  const clubRow = async (id: number) => (await store.get<Club>("SELECT * FROM clubs WHERE id = ?", id))!;

  async function action(body: Record<string, unknown>) {
    const response = await request(app).post("/api/action").send(body);
    expect(response.status, `${String(body.type)}: ${JSON.stringify(response.body)}`).toBe(200);
    return response.body;
  }
  async function get<T = Record<string, unknown>>(path: string): Promise<T> {
    const response = await request(app).get(path);
    expect(response.status, `${path}: ${JSON.stringify(response.body)}`).toBe(200);
    return response.body as T;
  }
  async function gbe(id: number) {
    return get<Gbe>(`/api/players/${id}/gbe`);
  }

  /** Invariants that hold after every simulated day. */
  async function checkDay(today: string) {
    expect(errors.mock.calls, "unexpected errors logged").toEqual([]);
    // No player is in two clubs: one active loan at most, matching his registration with both clubs.
    expect(
      await store.all("SELECT player_id FROM loans WHERE status = 'active' GROUP BY player_id HAVING count(*) > 1"),
      "players with two active loans",
    ).toEqual([]);
    expect(
      await store.all(
        `SELECT loans.id, loans.player_id FROM loans JOIN players ON players.id = loans.player_id
         WHERE loans.status = 'active' AND (players.club_id IS DISTINCT FROM loans.destination_id OR players.parent_club_id IS DISTINCT FROM loans.parent_id)`,
      ),
      "active loans that do not match the player's clubs",
    ).toEqual([]);
    expect(
      await store.all(
        `SELECT id FROM players WHERE parent_club_id IS NOT NULL AND (parent_club_id = club_id OR club_id IS NULL
           OR NOT EXISTS (SELECT 1 FROM loans WHERE loans.player_id = players.id AND loans.status = 'active'))`,
      ),
      "loaned players without an active loan",
    ).toEqual([]);
    // Competitive line-ups contain only registered players (friendlies need only a contract).
    expect(
      await store.all(
        `SELECT appearance.fixture_id, appearance.player_id FROM player_match_appearances AS appearance
         JOIN fixtures ON fixtures.id = appearance.fixture_id JOIN leagues ON leagues.id = fixtures.league_id
         JOIN players ON players.id = appearance.player_id
         WHERE appearance.date = ? AND leagues.kind <> 'international' AND appearance.club_id = players.club_id
           AND NOT ${competitiveRegistrationSql("players", "fixtures.league_id", "fixtures.season")}`,
        today,
      ),
      "unregistered players in competitive line-ups",
    ).toEqual([]);
    // Open offers to the director are only for his available players, from clubs that can sign and register them.
    const open = await store.all<Negotiation & { club_id: number | null; parent_club_id: number | null; injury_until: string | null }>(
      `SELECT negotiations.*, players.club_id, players.parent_club_id, players.injury_until FROM negotiations
       JOIN players ON players.id = negotiations.player_id
       WHERE negotiations.selling_club_id = ? AND negotiations.stage = 'Offer received' ORDER BY negotiations.id`,
      user.id,
    );
    const pairs = new Set<string>();
    const perPlayer = new Map<number, number>();
    for (const offer of open) {
      const loanOffer = LOAN_TYPES.includes(offer.type);
      expect(offer.club_id, `offer ${offer.id} for a player no longer at the club`).toBe(user.id);
      expect(offer.parent_club_id, `offer ${offer.id} for a loaned player`).toBeNull();
      if (offer.injury_until && injuredYesterday.get(offer.player_id) === offer.injury_until)
        expect(
          daysBetween(today, offer.injury_until),
          `offer ${offer.id} kept for a player injured until ${offer.injury_until}`,
        ).toBeLessThanOrEqual(loanOffer ? 7 : 21);
      expect(pairs.has(`${offer.player_id}:${offer.buying_club_id}`), `duplicate offer ${offer.id}`).toBe(false);
      pairs.add(`${offer.player_id}:${offer.buying_club_id}`);
      perPlayer.set(offer.player_id, (perPlayer.get(offer.player_id) ?? 0) + 1);
      if (offer.created === today) {
        const signing = await canSign(store, offer.player_id, offer.buying_club_id, loanOffer ? "loan_in" : "transfer", {
          emergency: offer.type === "Emergency loan",
        });
        expect(signing.codes.filter((code) => code !== "window"), `offer ${offer.id}: ${signing.reasons.join(" ")}`).toEqual([]);
        // The buyer fields his position: selection fills formation slots, so the offered role can be honoured.
        const player = await playerRow(offer.player_id);
        const buyer = await clubRow(offer.buying_club_id);
        expect(FORMATION_POSITIONS[buyer.formation] ?? FORMATION_POSITIONS["4-3-3"], `offer ${offer.id}: ${buyer.formation} has no ${player.position}`).toContain(player.position);
        const registration = await predictRegistration(store, offer.player_id, offer.buying_club_id);
        expect(
          blocking(registration.status),
          `offer ${offer.id} (${offer.type}) from club ${offer.buying_club_id} for player ${offer.player_id}, who could not be registered there: ${registration.reasons.join(" ")}`,
        ).toBe(false);
      }
    }
    for (const count of perPlayer.values()) expect(count).toBeLessThanOrEqual(OFFER_FREQUENCIES.high.perPlayer);
    injuredYesterday = new Map(
      (
        await store.all<{ id: number; injury_until: string }>(
          "SELECT id, injury_until FROM players WHERE club_id = ? AND injury_until > ?",
          user.id,
          addDays(today, 7),
        )
      ).map((row) => [row.id, row.injury_until]),
    );
    approachesByDay.set(
      today,
      await store.all<Negotiation>(
        "SELECT * FROM negotiations WHERE selling_club_id = ? AND created = ? AND data::jsonb ->> 'origin' = 'approach' ORDER BY id",
        user.id,
        today,
      ),
    );
    // While the target is at the club unregistered, he is never in a competitive line-up of the club.
    if (target) {
      const current = await playerRow(target.id);
      const appearances = await store.all<{ fixture_id: number; league_id: number | null; minutes: number }>(
        "SELECT appearance.fixture_id, appearance.minutes, fixtures.league_id FROM player_match_appearances AS appearance JOIN fixtures ON fixtures.id = appearance.fixture_id WHERE appearance.player_id = ? AND appearance.date = ? AND appearance.club_id = ?",
        target.id,
        today,
        user.id,
      );
      if (current.club_id === user.id && !current.parent_club_id) {
        expect(appearances.filter((row) => row.league_id !== null), "the unregistered player was picked").toEqual([]);
        // Friendlies need only a contract: every friendly the club plays while he is fit is open to him.
        for (const fixture of await store.all<{ id: number }>(
          "SELECT id FROM fixtures WHERE (home_id = ? OR away_id = ?) AND league_id IS NULL AND status = 'played' AND date = ?",
          user.id,
          user.id,
          today,
        )) {
          if (!current.injury_until || current.injury_until <= today)
            expect((await eligibleForFixture(store, fixture.id, [target.id])).has(target.id)).toBe(true);
          friendlyMinutes += appearances.find((row) => row.fixture_id === fixture.id)?.minutes ?? 0;
        }
      }
    }
  }

  async function advanceDay() {
    const from = await date();
    const response = await request(app).post("/api/advance").send({ days: 1 });
    expect(response.status, JSON.stringify(response.body)).toBe(200);
    expect(response.body.error).toBeUndefined();
    expect(response.body).toMatchObject({ from, date: addDays(from, 1), days: 1 });
    expect(await date()).toBe(addDays(from, 1));
    await checkDay(response.body.date);
    return response.body.date as string;
  }

  /** The director accepts an offer: every other open offer for the player is withdrawn and can no longer be accepted. */
  async function acceptWithdrawingRivals(offer: Negotiation, rivals: readonly Negotiation[]) {
    const accepted = await action({ type: "negotiation", id: offer.id, action: "accept" });
    expect(accepted.stage).toBe("Agent talks");
    for (const rival of rivals) {
      const closed = await negotiationRow(rival.id);
      expect(closed.stage).toBe("Withdrawn");
      expect((JSON.parse(closed.data) as NegotiationData).closedReason).toBe("accepted-elsewhere");
      const again = await request(app).post("/api/action").send({ type: "negotiation", id: rival.id, action: "accept" });
      expect(again.status).toBe(400);
      expect(again.body.error).toMatch(/already closed/);
    }
  }

  async function setFrequency(value: OfferFrequency) {
    const response = await request(app).patch("/api/settings").send({ marketOfferFrequency: value });
    expect(response.status, JSON.stringify(response.body)).toBe(200);
    expect(response.body.marketOfferFrequency).toBe(value);
    expect((await get<{ settings: { marketOfferFrequency: string } }>("/api/bootstrap")).settings.marketOfferFrequency).toBe(value);
  }

  function checkGbeShape(assessment: Gbe, id: number) {
    expect(assessment).toMatchObject({ playerId: id, ruleset: "fa-2026-27", passMark: 15 });
    expect(assessment.breakdown.map((row) => row.criterion).sort()).toEqual([...CRITERIA].sort());
    expect(assessment.breakdown.reduce((sum, row) => sum + row.points, 0)).toBe(assessment.points);
    for (const row of assessment.breakdown) {
      expect(["scored", "zero", "no_data", "estimate"]).toContain(row.status);
      expect(row.detail.length).toBeGreaterThan(10);
      if (row.status === "zero" || row.status === "no_data") expect(row.points, row.criterion).toBe(0);
      if (row.status === "scored") expect(row.points, row.criterion).toBeGreaterThan(0);
      // Missing evidence is reported as such, never as an earned zero.
      const missingText = /not on (record|file)|records cover|no recorded/i;
      if (row.status === "no_data") expect(row.detail, row.criterion).toMatch(missingText);
      if (row.status === "zero") expect(row.detail, row.criterion).not.toMatch(missingText);
    }
    const missing = assessment.breakdown.filter((row) => row.status === "no_data").length;
    expect(assessment.dataQuality).toBe(
      missing === CRITERIA.length
        ? "none"
        : missing
          ? "partial"
          : assessment.breakdown.some((row) => row.status === "estimate")
            ? "estimate"
            : "complete",
    );
  }

  beforeAll(async () => {
    errors = vi.spyOn(console, "error");
    store = await Store.createTest("integration");
    await generateWorld(store, { nations: ["EN", "PT"], squads: "minimum", seed: "integration-scenario" });
    await createCalendar(store);
    await initialInbox(store);
    app = await createApp(store);
  }, 300_000);
  afterAll(async () => {
    errors?.mockRestore();
    await store?.close();
    console.log(`integration scenario (${Math.round((performance.now() - startedAt) / 100) / 10}s): ${JSON.stringify(summary)}`);
  });

  it("starts a career at an English club", async () => {
    user = (await store.get<Club>(
      `SELECT clubs.* FROM clubs JOIN leagues ON leagues.id = clubs.league_id JOIN countries ON countries.id = clubs.country_id
       WHERE countries.code = 'EN' AND leagues.tier = 1 AND clubs.type = 'club' ORDER BY clubs.reputation, clubs.id LIMIT 1`,
    ))!;
    await action({ type: "career", name: "Integration Director", background: "Negotiator", clubId: user.id });
    const state = await stateOf(store);
    expect(state).toMatchObject({ clubId: user.id, started: true, date: "2026-07-01" });
    const bootstrap = await get<{ settings: { marketOfferFrequency: string } }>("/api/bootstrap");
    expect(bootstrap.settings.marketOfferFrequency).toBe("medium");
    // The generator's loan flags at the director's club are cleared: he decides who is available.
    expect(await store.get("SELECT id FROM players WHERE club_id = ? AND available_loan = 1", user.id)).toBeUndefined();
    await setFrequency("medium");
  });

  it("signs a foreign player without a GBE: the signing completes, registration is refused", async () => {
    user = await clubRow(user.id);
    const today = await date();
    const candidates = await store.all<Player>(
      `SELECT players.* FROM players JOIN clubs ON clubs.id = players.club_id JOIN countries ON countries.id = players.country_id
       WHERE countries.code = 'PT' AND clubs.country_id = players.country_id AND clubs.type = 'club'
         AND players.age BETWEEN 20 AND 24 AND players.age_group = 'Senior' AND players.parent_club_id IS NULL
         AND players.injury_until IS NULL AND players.contract_end > ? AND players.value < ?
       ORDER BY players.ability DESC, players.id LIMIT 80`,
      addDays(today, 365),
      user.transfer_budget / 4,
    );
    let assessment: Gbe | undefined;
    for (const candidate of candidates) {
      const result = await gbe(candidate.id);
      if (["fail", "panel"].includes(result.outcome) && (await canSign(store, candidate.id, user.id, "transfer")).ok) {
        target = candidate;
        assessment = result;
        break;
      }
    }
    expect(assessment, "no Portuguese player below the GBE pass mark").toBeDefined();
    checkGbeShape(assessment!, target.id);
    expect(assessment!.points).toBeLessThan(15);
    expect(assessment!.autoPass).toBe(false);
    expect(["fail", "panel"]).toContain(assessment!.outcome);
    expect(assessment!.dataQuality).not.toBe("none");
    summary.gbeAtSigning = { points: assessment!.points, outcome: assessment!.outcome };
    expect(assessment!.breakdown.some((row) => row.status === "zero" || row.status === "no_data")).toBe(true);
    // The FA would refuse him at the director's club, yet nothing stops the signing itself.
    expect((await predictRegistration(store, target.id, user.id)).status).toBe("refused");

    const seller = await clubRow(target.club_id!);
    const before = {
      budget: user.transfer_budget,
      wages: await weeklyWages(store, user.id),
      sellerBalance: seller.balance,
    };
    const enquiry = await action({ type: "enquiry", playerId: target.id, dealType: "Permanent transfer" });
    expect(enquiry.id).toBeGreaterThan(0);
    expect((await action({ type: "negotiation", id: enquiry.id, action: "formalize" })).stage).toBe("Club talks");
    for (let round = 0; round < 6 && ["Club talks", "Agent talks"].includes((await negotiationRow(enquiry.id)).stage); round++) {
      const current = await negotiationRow(enquiry.id);
      // The wage the agent will accept, as the negotiation screen previews it.
      const preview = await get<{ expectedWage: number; wageToAgree?: number | null }>(
        `/api/players/${target.id}/interest?negotiationId=${enquiry.id}&role=Squad%20player&years=3`,
      );
      await action({
        type: "offer",
        id: enquiry.id,
        fee: Math.ceil(Math.max(current.asking_price, current.offer) * 1.05),
        wage: Math.ceil(Math.max(preview.wageToAgree ?? preview.expectedWage, preview.expectedWage) * (1 + round * 0.05)),
        years: 3,
        role: "Squad player",
        promises: [],
      });
    }
    expect((await negotiationRow(enquiry.id)).stage).toBe("Contract review");
    expect((await action({ type: "negotiation", id: enquiry.id, action: "sign" })).stage).toBe("Medical");
    for (let day = 0; day < 10 && (await negotiationRow(enquiry.id)).stage !== "Completed"; day++) await advanceDay();
    const deal = await negotiationRow(enquiry.id);
    expect(deal.stage, JSON.stringify(JSON.parse(deal.data).log.at(-1))).toBe("Completed");
    signingFee = deal.offer;

    // Contract, club, fee and wages: the move is complete.
    const signed = await playerRow(target.id);
    expect(signed).toMatchObject({ club_id: user.id, parent_club_id: null, wage: deal.wage });
    expect(signed.contract_end > addDays(await date(), 2 * 365)).toBe(true);
    const fees = await store.all<{ amount: number }>(
      "SELECT amount FROM ledger WHERE club_id = ? AND category = 'Transfer fees' AND description LIKE ?",
      user.id,
      `${target.name}:%`,
    );
    expect(fees.reduce((sum, row) => sum + row.amount, 0)).toBeLessThanOrEqual(-signingFee);
    expect((await clubRow(user.id)).transfer_budget).toBeLessThanOrEqual(before.budget - signingFee);
    expect((await clubRow(seller.id)).balance).toBeGreaterThan(before.sellerBalance);
    expect(await weeklyWages(store, user.id)).toBeCloseTo(before.wages + deal.wage, 0);
    expect(await store.get("SELECT id FROM history WHERE entity_type = 'transfer' AND entity_id = ?", target.id)).toBeDefined();
    target = signed;

    // Signed, in the squad, but not registered: the FA refused the endorsement on the GBE evidence.
    const detail = await get<{ eligibility: { contracted: boolean; label: string; text: string; friendliesOnly: boolean; association: { status: string; basis: string; gbe?: { points: number; passMark: number } } } }>(
      `/api/players/${target.id}`,
    );
    expect(detail.eligibility).toMatchObject({ contracted: true, label: "ineligible_gbe", friendliesOnly: true });
    expect(detail.eligibility.association).toMatchObject({ status: "refused", basis: "gbe" });
    expect(detail.eligibility.association.gbe!.points).toBeLessThan(15);
    expect(detail.eligibility.text).toBe(`Ineligible · insufficient GBE (${detail.eligibility.association.gbe!.points}/15)`);
    const squad = await get<{ players: { id: number; eligibility?: { label: string } }[] }>("/api/squad");
    expect(squad.players.find((player) => player.id === target.id)?.eligibility?.label).toBe("ineligible_gbe");
    const news = await store.all<{ title: string }>(
      "SELECT title FROM news WHERE data::jsonb ->> 'playerId' = ? ORDER BY id",
      String(target.id),
    );
    expect(news.map((item) => item.title)).toContain(`${target.name}: registration refused`);
  });

  it("keeps him out of competitive line-ups and allows him in friendlies", async () => {
    const today = await date();
    const upcoming = await store.all<Fixture>(
      `SELECT fixtures.* FROM fixtures LEFT JOIN leagues ON leagues.id = fixtures.league_id
       WHERE (fixtures.home_id = ? OR fixtures.away_id = ?) AND fixtures.status = 'scheduled' AND fixtures.date >= ?
         AND (leagues.id IS NULL OR leagues.age_group = 'Senior') ORDER BY fixtures.date, fixtures.id`,
      user.id,
      user.id,
      today,
    );
    const competitive = upcoming.find((fixture) => fixture.league_id !== null);
    const friendly = upcoming.find((fixture) => fixture.league_id === null);
    expect(competitive, "the club has a competitive fixture this season").toBeDefined();
    expect((await eligibleForFixture(store, competitive!.id, [target.id])).has(target.id)).toBe(false);
    if (friendly) expect((await eligibleForFixture(store, friendly.id, [target.id])).has(target.id)).toBe(true);
    const detail = await get<{ eligibility: { nextFixture?: { fixtureId: number; eligible: boolean; competition: string; reasons: string[] } } }>(
      `/api/players/${target.id}`,
    );
    const next = detail.eligibility.nextFixture!;
    expect(next).toBeDefined();
    if (next.competition === "Friendly") expect(next.eligible).toBe(true);
    else {
      expect(next.eligible).toBe(false);
      expect(next.reasons.join(" ")).toMatch(/Not registered/);
    }
  });

  it("brings loan offers at the chosen frequency, including for the unregistered signing", async () => {
    // A week at Medium, then a week at High; the director's other players are on the market too.
    const volume: Record<string, number> = {};
    for (const level of ["medium", "high"] as const) {
      await setFrequency(level);
      let total = 0;
      for (let day = 0; day < 7; day++) {
        const today = await advanceDay();
        const created = approachesByDay.get(today) ?? [];
        expect(created.length).toBeLessThanOrEqual(OFFER_FREQUENCIES[level].dailyMax);
        total += created.length;
      }
      volume[level] = total;
    }
    summary.approachesPerWeek = volume;
    expect(volume.medium).toBeGreaterThan(0);
    expect(volume.high).toBeGreaterThan(volume.medium);

    // Wait (at High) until clubs approach him unprompted. The director then puts him on the loan list, and takes the
    // best offer once a second club bids or the first offer is about to lapse.
    const openLoanOffers = () =>
      store.all<Negotiation>(
        `SELECT * FROM negotiations WHERE player_id = ? AND selling_club_id = ? AND stage = 'Offer received' AND type = ANY(?::text[]) ORDER BY id`,
        target.id,
        user.id,
        LOAN_TYPES,
      );
    let listed = false;
    for (let day = 0; day < 30; day++) {
      const offers = await openLoanOffers();
      if (offers.length && !listed) {
        const unsolicited = await store.get<{ data: string }>(
          "SELECT data FROM news WHERE title = ? ORDER BY id LIMIT 1",
          `Loan offer for ${target.name}`,
        );
        expect(JSON.parse(unsolicited!.data)).toMatchObject({ playerId: target.id, unsolicited: true });
        await action({ type: "availability", playerId: target.id, listed: false, loan: true });
        const list = await get<{ loanList: { id: number; open_offers: number; available_loan: number }[] }>("/api/loans");
        expect(list.loanList.find((entry) => entry.id === target.id)).toMatchObject({ available_loan: 1, open_offers: offers.length });
        listed = true;
      }
      if (offers.length >= 2 || (offers.length && daysBetween(await date(), offers[0].deadline) <= 1)) break;
      await advanceDay();
    }
    const offers = await openLoanOffers();
    expect(offers.length, "no club offered to take the unregistered signing on loan").toBeGreaterThan(0);

    // The offers inbox shows every deal detail.
    const desk = await get<{ loanOffers: (Negotiation & { buyer_name: string; player_name: string })[] }>("/api/loans");
    for (const offer of offers) {
      const shown = desk.loanOffers.find((entry) => entry.id === offer.id)!;
      expect(shown).toMatchObject({ player_name: target.name, stage: "Offer received", type: offer.type });
      expect(shown.buyer_name).toBe((await clubRow(offer.buying_club_id)).name);
      const data = JSON.parse(offer.data) as NegotiationData;
      expect(data.origin).toBe("approach");
      expect(data.plannedStart! >= offer.created).toBe(true);
      expect(data.terms.duration).toBeGreaterThanOrEqual(30);
      expect(data.terms.salarySplit).toBeGreaterThan(0);
      expect(data.terms.salarySplit).toBeLessThanOrEqual(100);
      expect(data.terms.fee).toBe(offer.offer);
      expect(data.terms.role.length).toBeGreaterThan(0);
      expect(data.terms.playingTime).toBeGreaterThan(0);
      expect(data.reason?.text).toMatch(/not registered to play competitive matches/);
      expect(data.log[0].message).toContain(`${data.terms.salarySplit}% of the wage`);
      expect(offer.deadline > offer.created).toBe(true);
      // The borrower can register him: a loan only makes sense if he plays there.
      expect(blocking((await predictRegistration(store, target.id, offer.buying_club_id)).status)).toBe(false);
    }
    const titles = (await store.all<{ title: string }>("SELECT title FROM news WHERE data::jsonb ->> 'playerId' = ?", String(target.id))).map(
      (row) => row.title,
    );
    expect(titles).toContain(`Loan offer for ${target.name}`);
    const recallable = offers.filter((offer) => (JSON.parse(offer.data) as NegotiationData).terms.recall);
    acceptedOffer = recallable[0] ?? offers.find((offer) => offer.type !== "Loan with obligation") ?? offers[0];
  });

  it("accepts the loan: rivals withdrawn, wages split, registered at the borrower, no duplicate loan", async () => {
    const rivals = await store.all<Negotiation>(
      "SELECT * FROM negotiations WHERE player_id = ? AND id <> ? AND stage = 'Offer received'",
      target.id,
      acceptedOffer.id,
    );
    summary.rivalOffersWithdrawn = rivals.length;
    await acceptWithdrawingRivals(acceptedOffer, rivals);
    const borrower = await clubRow(acceptedOffer.buying_club_id);
    const before = {
      userWages: await weeklyWages(store, user.id),
      borrowerWages: await weeklyWages(store, borrower.id),
    };
    for (let day = 0; day < 14 && (await negotiationRow(acceptedOffer.id)).stage !== "Completed"; day++) {
      await advanceDay();
      expect(
        await store.get(
          "SELECT id FROM negotiations WHERE player_id = ? AND id <> ? AND stage = ANY(?::text[])",
          target.id,
          acceptedOffer.id,
          OPEN_STAGES,
        ),
        "a second deal for a player already committed",
      ).toBeUndefined();
    }
    const deal = await negotiationRow(acceptedOffer.id);
    expect(deal.stage, JSON.stringify(JSON.parse(deal.data).log.at(-1))).toBe("Completed");
    const data = JSON.parse(deal.data) as NegotiationData;
    const loans = await store.all<Loan>("SELECT * FROM loans WHERE player_id = ?", target.id);
    expect(loans).toHaveLength(1);
    loan = loans[0];
    expect(loan).toMatchObject({ status: "active", parent_id: user.id, destination_id: borrower.id, type: deal.type });
    expect(loan.start_date >= data.plannedStart!).toBe(true);
    const terms = JSON.parse(loan.terms) as LoanTerms;
    expect(terms.salarySplit).toBe(data.terms.salarySplit);
    expect(JSON.parse(loan.data).reason.text).toBe(data.reason!.text);

    const onLoan = await playerRow(target.id);
    expect(onLoan).toMatchObject({ club_id: borrower.id, parent_club_id: user.id });
    const share = (onLoan.wage * terms.salarySplit) / 100;
    expect(await weeklyWages(store, user.id)).toBeCloseTo(before.userWages - share, 0);
    expect(await weeklyWages(store, borrower.id)).toBeCloseTo(before.borrowerWages + share, 0);
    if (deal.offer > 0)
      expect(
        await store.get("SELECT id FROM ledger WHERE club_id = ? AND category = 'Loan income' AND description LIKE ?", user.id, `${target.name}:%`),
      ).toBeDefined();

    // Registration re-evaluated at the borrower; the refused English spell has lapsed.
    const registrations = await store.all<{ club_id: number; status: string; data: string }>(
      "SELECT club_id, status, data FROM player_registrations WHERE player_id = ?",
      target.id,
    );
    expect(registrations.map((row) => row.club_id)).toEqual([borrower.id]);
    expect(blocking(registrations[0].status as never)).toBe(false);
    expect(JSON.parse(registrations[0].data).trigger).toBe("loan-start");
    const detail = await get<{ eligibility: { label: string; clubId: number } }>(`/api/players/${target.id}`);
    expect(detail.eligibility).toMatchObject({ label: "loaned_out", clubId: borrower.id });
    const desk = await get<{ loans: Loan[]; loanOffers: Negotiation[] }>("/api/loans");
    expect(desk.loans.filter((entry) => entry.player_id === target.id && entry.status === "active")).toHaveLength(1);
    expect(desk.loanOffers.filter((entry) => entry.player_id === target.id)).toEqual([]);

    if (!rivals.length) {
      // He drew one offer at a time: the same rule on another of the director's players that clubs compete for.
      const contested = () =>
        store.all<Negotiation>(
          `SELECT * FROM negotiations WHERE selling_club_id = ? AND stage = 'Offer received' AND player_id IN (
             SELECT player_id FROM negotiations WHERE selling_club_id = ? AND stage = 'Offer received' GROUP BY player_id HAVING count(*) >= 2
           ) ORDER BY player_id, id`,
          user.id,
          user.id,
        );
      for (let day = 0; day < 10 && !(await contested()).length; day++) await advanceDay();
      const offers = await contested();
      expect(offers.length, "no player drew competing offers").toBeGreaterThanOrEqual(2);
      const competing = offers.filter((offer) => offer.player_id === offers[0].player_id);
      await acceptWithdrawingRivals(competing[0], competing.slice(1));
      summary.rivalOffersWithdrawn = `${competing.length - 1} (player ${competing[0].player_id})`;
    }
  });

  it("tracks his minutes and appearances during the loan (GBE inputs)", async () => {
    const borrower = loan.destination_id;
    const competitiveSince = () =>
      store.all<Fixture>(
        `SELECT fixtures.* FROM fixtures JOIN leagues ON leagues.id = fixtures.league_id
         WHERE (fixtures.home_id = ? OR fixtures.away_id = ?) AND fixtures.status = 'played' AND leagues.age_group = 'Senior'
           AND leagues.kind <> 'international' AND fixtures.date >= ? ORDER BY fixtures.date`,
        borrower,
        borrower,
        loan.start_date,
      );
    // A standard recall must happen inside the window: track the spell until the borrower has played two competitive
    // matches or the last day of the window.
    while ((await competitiveSince()).length < 2 && (await date()) < "2026-08-31") await advanceDay();
    const played = await competitiveSince();
    expect(played.length, "the borrower played no competitive match during the loan").toBeGreaterThan(0);
    const ledger = await store.all<{ league_id: number; data: string }>(
      "SELECT league_id, data FROM player_minutes_monthly WHERE player_id = ? AND club_id = ?",
      target.id,
      borrower,
    );
    expect(ledger.length).toBeGreaterThan(0);
    const values = ledger.flatMap((row) => row.data.split(",").map((value) => Number(value || 0)));
    const sum = (offset: number) => ledger.reduce((total, row) => {
      const parsed = row.data.split(",").map((value) => Number(value || 0));
      return total + parsed.slice(offset * 12, offset * 12 + 12).reduce((left, right) => left + right, 0);
    }, 0);
    expect(values.some((value) => value > 0)).toBe(true);
    const available = sum(0);
    const minutes = sum(1);
    const appearances = await store.all<{ fixture_id: number; minutes: number }>(
      "SELECT fixture_id, minutes FROM player_match_appearances WHERE player_id = ? AND club_id = ? AND date >= ?",
      target.id,
      borrower,
      loan.start_date,
    );
    const competitiveIds = new Set(played.map((fixture) => fixture.id));
    const competitiveMinutes = appearances.filter((row) => competitiveIds.has(row.fixture_id)).reduce((total, row) => total + row.minutes, 0);
    expect(available + sum(4)).toBeGreaterThanOrEqual(played.length * 90);
    expect(minutes).toBe(competitiveMinutes);
    expect(sum(2)).toBe(appearances.filter((row) => competitiveIds.has(row.fixture_id) && row.minutes > 0).length);
    summary.loan = { type: loan.type, borrower: loan.destination_id, matches: played.length, minutes, appearances: appearances.length };
    summary.friendlyMinutesBeforeLoan = friendlyMinutes;
    // The live GBE assessment reads the spell at the borrower.
    const assessment = await gbe(target.id);
    checkGbeShape(assessment, target.id);
    const name = (await clubRow(borrower)).name;
    expect(assessment.breakdown.find((row) => row.criterion === "domestic_minutes")!.detail).toContain(name);
    // The weekly loan review follows the spell.
    if ((await date()) >= addDays(loan.start_date, 7))
      expect(JSON.parse((await store.get<Loan>("SELECT * FROM loans WHERE id = ?", loan.id))!.data).weeks).toBeGreaterThan(0);
  });

  it("returns him at the end of the loan and refreshes eligibility and GBE", async () => {
    const terms = JSON.parse(loan.terms) as LoanTerms;
    const borrower = await clubRow(loan.destination_id);
    const before = { userWages: await weeklyWages(store, user.id), borrowerWages: await weeklyWages(store, borrower.id) };
    const share = ((await playerRow(target.id)).wage * terms.salarySplit) / 100;
    if (terms.recall) {
      await action({ type: "loan-recall", id: loan.id });
      expect((await store.get<Loan>("SELECT * FROM loans WHERE id = ?", loan.id))!.status).toBe("recalled");
    } else {
      // No recall clause: the term is brought forward and the daily pipeline ends it.
      await store.run("UPDATE loans SET end_date = ? WHERE id = ?", addDays(await date(), 1), loan.id);
      await advanceDay();
      expect((await store.get<Loan>("SELECT * FROM loans WHERE id = ?", loan.id))!.status).toBe("completed");
    }
    const today = await date();
    const returned = await playerRow(target.id);
    expect(returned).toMatchObject({ club_id: user.id, parent_club_id: null });
    expect(await store.get("SELECT id FROM loans WHERE player_id = ? AND status = 'active'", target.id)).toBeUndefined();
    // The parent pays the full wage again (exact on a recall: no other day was simulated in between).
    if (terms.recall) {
      expect(await weeklyWages(store, user.id)).toBeCloseTo(before.userWages + share, 0);
      expect(await weeklyWages(store, borrower.id)).toBeCloseTo(before.borrowerWages - share, 0);
    }

    // GBE recalculated with the loan's evidence; registration re-evaluated at the parent club on the same evidence.
    const assessment = await gbe(target.id);
    checkGbeShape(assessment, target.id);
    expect(assessment.asOf).toBe(today);
    expect(assessment.breakdown.find((row) => row.criterion === "domestic_minutes")!.detail).toContain(borrower.name);
    const registration = (await store.get<{ club_id: number; status: string; evaluated_on: string; data: string }>(
      "SELECT club_id, status, evaluated_on, data FROM player_registrations WHERE player_id = ?",
      target.id,
    ))!;
    expect(registration).toMatchObject({ club_id: user.id, evaluated_on: today });
    expect(JSON.parse(registration.data).trigger).toBe(terms.recall ? "loan-recall" : "loan-return");
    const granted = ["exempt", "auto_pass", "pass"].includes(assessment.outcome);
    summary.gbeAfterLoan = { points: assessment.points, outcome: assessment.outcome, registration: registration.status };
    expect(registration.status).toBe(granted ? "registered" : assessment.outcome === "no_data" ? "pending" : "refused");
    const detail = await get<{ eligibility: { label: string; association: { gbe?: { points: number } } } }>(`/api/players/${target.id}`);
    expect(detail.eligibility.label).toBe(granted ? "eligible" : "ineligible_gbe");
    if (!granted) expect(detail.eligibility.association.gbe!.points).toBe(assessment.points);
    const squad = await get<{ players: { id: number; eligibility?: { label: string } }[] }>("/api/squad");
    expect(squad.players.find((player) => player.id === target.id)?.eligibility?.label).toBe(detail.eligibility.label);

    // Back at the club: the next competitive match is played without him (unless now registered), with a full XI.
    const next = (await store.get<Fixture>(
      `SELECT fixtures.* FROM fixtures JOIN leagues ON leagues.id = fixtures.league_id
       WHERE (fixtures.home_id = ? OR fixtures.away_id = ?) AND fixtures.status = 'scheduled' AND leagues.age_group = 'Senior'
         AND leagues.kind <> 'international' AND fixtures.date > ? ORDER BY fixtures.date, fixtures.id LIMIT 1`,
      user.id,
      user.id,
      today,
    ))!;
    expect(next).toBeDefined();
    while ((await date()) < next.date) await advanceDay();
    const lineup = await store.all<{ player_id: number; started: number }>(
      "SELECT player_id, started FROM player_match_appearances WHERE fixture_id = ? AND club_id = ?",
      next.id,
      user.id,
    );
    expect(lineup.filter((row) => row.started === 1)).toHaveLength(11);
    if (!granted) expect(lineup.map((row) => row.player_id)).not.toContain(target.id);
    // Just back from a loan: clubs do not approach him for another one straight away.
    expect(
      await store.get(
        "SELECT id FROM negotiations WHERE player_id = ? AND created > ? AND type = ANY(?::text[])",
        target.id,
        today,
        LOAN_TYPES,
      ),
    ).toBeUndefined();
    expect(errors.mock.calls).toEqual([]);
  });
});
