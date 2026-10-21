import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { Store } from "./db.ts";
import { generateWorld } from "./world.ts";
import { updateSettings } from "./app.ts";
import { assessPlayerInterest, personalTermsWage } from "./recruitment.ts";
import {
  counterIncomingLoan,
  expireLoans,
  negotiationStep,
  playerOf,
  progressDealMilestones,
  stateOf,
} from "./systems.ts";
import {
  dailyOfferQuota,
  generateUserClubOffers,
  marketPhase,
  OFFER_FREQUENCIES,
  offerFrequency,
  type OfferFrequency,
} from "./market-offers.ts";
import { addDays, LOAN_TYPES } from "../shared/rules.ts";
import type { Club, Loan, Negotiation, NegotiationData, Player } from "../shared/types.ts";

describe("offer frequency rules", () => {
  it("defaults to medium and reads the persisted setting", () => {
    expect(offerFrequency({})).toBe("medium");
    expect(offerFrequency({ marketOfferFrequency: "low" })).toBe("low");
    expect(offerFrequency({ marketOfferFrequency: "high" })).toBe("high");
    expect(offerFrequency({ marketOfferFrequency: "always" })).toBe("medium");
  });

  it("spreads each setting's weekly target over the days of a window", () => {
    for (const [frequency, target] of [
      ["low", 2],
      ["medium", 5],
      ["high", 9],
    ] as const) {
      const profile = OFFER_FREQUENCIES[frequency];
      expect(profile.weekly).toBe(target);
      // Steady state: the last six days hit their share of the target.
      let total = 0;
      for (let day = 0; day < 700; day++)
        total += dailyOfferQuota({
          weekly: profile.weekly,
          dailyMax: profile.dailyMax,
          recent: (profile.weekly * 6) / 7,
          elapsed: 7,
          random: (day % 100) / 100,
        });
      expect(total / 100).toBeCloseTo(target, 0);
    }
    // A slow start is made up; a busy week is followed by quiet days.
    expect(dailyOfferQuota({ weekly: 5, dailyMax: 2, recent: 0, elapsed: 6, random: 0 })).toBe(2);
    expect(dailyOfferQuota({ weekly: 5, dailyMax: 2, recent: 6, elapsed: 6, random: 0.9 })).toBe(0);
    expect(dailyOfferQuota({ weekly: 0, dailyMax: 2, recent: 0, elapsed: 6, random: 0.9 })).toBe(0);
  });

  it("follows the registration calendar", () => {
    expect(marketPhase("2026-07-10")).toMatchObject({ kind: "window", multiplier: 1, closes: "2026-09-01" });
    expect(marketPhase("2026-08-20").multiplier).toBeGreaterThan(1);
    // An offer must still register before deadline day.
    expect(marketPhase("2026-08-28").kind).toBe("closed");
    expect(marketPhase("2026-12-26")).toMatchObject({ kind: "pre-window", opens: "2027-01-01" });
    expect(marketPhase("2027-06-08")).toMatchObject({ kind: "pre-window", opens: "2027-06-15" });
    expect(marketPhase("2026-10-10").kind).toBe("closed");
  });
});

describe("club approaches for the director's players", () => {
  let store: Store;
  beforeAll(async () => {
    store = await Store.createTest("market-offers");
  });
  beforeEach(async () =>
    store.transaction(async () => {
      await store.clearWorld();
      await store.schema();
      await generateWorld(store, { nations: ["EN", "ES"] });
    }),
  );
  afterAll(async () => await store?.close());

  const setFrequency = async (frequency: OfferFrequency) =>
    store.setMeta("settings", { ...(await store.meta<Record<string, unknown>>("settings")), marketOfferFrequency: frequency });
  const day = async (date: string) => {
    await store.setMeta("state", { ...(await stateOf(store)), date });
    return store.transaction(async () => generateUserClubOffers(store, await stateOf(store)));
  };
  const approaches = () =>
    store.all<Negotiation>(
      "SELECT * FROM negotiations WHERE selling_club_id = 1 AND data::jsonb ->> 'origin' = 'approach' ORDER BY id",
    );
  const progress = async (date: string) => {
    await store.setMeta("state", { ...(await stateOf(store)), date });
    for (const negotiation of await store.all<Negotiation>(
      "SELECT * FROM negotiations WHERE stage IN ('Agent talks','Contract review','Medical','Registration') ORDER BY id",
    ))
      await store.transaction(() => progressDealMilestones(store, negotiation));
  };

  it("makes relevant, viable offers with a reason, only for available players", async () => {
    await setFrequency("high");
    const start = (await stateOf(store)).date;
    for (let index = 1; index <= 4; index++) await day(addDays(start, index));
    const offers = await approaches();
    expect(offers.length).toBeGreaterThan(3);
    const perPair = new Set<string>();
    for (const offer of offers) {
      const data = JSON.parse(offer.data) as NegotiationData;
      const player = await playerOf(store, offer.player_id);
      const buyer = (await store.get<Club>("SELECT * FROM clubs WHERE id = ?", offer.buying_club_id))!;
      expect(offer.stage).toBe("Offer received");
      expect(data.reason?.text.length).toBeGreaterThan(10);
      expect(data.plannedStart).toBeDefined();
      expect(offer.deadline <= addDays(offer.created, 7)).toBe(true);
      expect(player.club_id).toBe(1);
      expect(player.parent_club_id).toBeNull();
      expect(buyer.type).toBe("club");
      expect(perPair.has(`${offer.player_id}:${offer.buying_club_id}`)).toBe(false);
      perPair.add(`${offer.player_id}:${offer.buying_club_id}`);
      // The personal-terms test the buyer applies after acceptance passes.
      const loan = LOAN_TYPES.includes(offer.type);
      const preview = await assessPlayerInterest(store, player, buyer, {
        loan,
        role: loan ? data.terms.role : data.role,
        years: data.years,
        promises: data.promises,
        playingTime: loan ? data.terms.playingTime : undefined,
        tension: offer.tension,
      });
      expect(personalTermsWage(preview)).not.toBeNull();
    }
    const perPlayer = new Map<number, number>();
    for (const offer of offers) perPlayer.set(offer.player_id, (perPlayer.get(offer.player_id) ?? 0) + 1);
    expect(Math.max(...perPlayer.values())).toBeLessThanOrEqual(OFFER_FREQUENCIES.high.perPlayer);
    // Once a day: a second run on the same date adds nothing.
    expect(await store.transaction(async () => generateUserClubOffers(store, await stateOf(store)))).toEqual({
      transfers: 0,
      loans: 0,
    });
  });

  it("never approaches injured, loaned-out or already-dealt players", async () => {
    await setFrequency("high");
    const start = (await stateOf(store)).date;
    await store.run("UPDATE players SET injury_until = ? WHERE club_id = 1", addDays(start, 60));
    await day(addDays(start, 1));
    expect(await approaches()).toHaveLength(0);
    const fit = (await store.get<Player>(
      "SELECT * FROM players WHERE club_id = 1 AND age_group = 'Senior' AND age >= 20 ORDER BY ability LIMIT 1",
    ))!;
    await store.run("UPDATE players SET injury_until = NULL, listed = 1 WHERE id = ?", fit.id);
    await store.run(
      "INSERT INTO negotiations(player_id,buying_club_id,selling_club_id,type,stage,asking_price,offer,wage,interest,created,deadline,data) VALUES (?,2,1,'Permanent transfer','Medical',1,1,1,80,?,?,?)",
      fit.id,
      start,
      addDays(start, 20),
      JSON.stringify({ workflowVersion: 2, log: [], agent: JSON.parse(fit.profile).agent, years: 3, role: "Squad player", promises: [], terms: {} }),
    );
    await day(addDays(start, 2));
    expect(await approaches()).toHaveLength(0);
  });

  it("makes none when no club can afford the player or between windows", async () => {
    await setFrequency("high");
    await store.run("UPDATE players SET listed = 1 WHERE club_id = 1 AND age_group = 'Senior'");
    await store.run("UPDATE clubs SET transfer_budget = 0, wage_budget = 0 WHERE id <> 1");
    const start = (await stateOf(store)).date;
    for (let index = 1; index <= 3; index++) await day(addDays(start, index));
    expect(await approaches()).toHaveLength(0);
    await store.run("UPDATE clubs SET transfer_budget = 50000000, wage_budget = 5000000, balance = 100000000 WHERE id <> 1");
    for (const date of ["2026-10-10", "2026-10-11", "2026-10-12"]) await day(date);
    expect(await approaches()).toHaveLength(0);
  });

  it("dates pre-window approaches to the opening of the window", async () => {
    await setFrequency("high");
    await store.run("UPDATE players SET contract_end = '2030-06-30', listed = 1 WHERE club_id = 1 AND age_group = 'Senior'");
    for (const date of ["2026-12-23", "2026-12-24", "2026-12-25", "2026-12-26"]) await day(date);
    const offers = await approaches();
    expect(offers.length).toBeGreaterThan(0);
    for (const offer of offers) expect((JSON.parse(offer.data) as NegotiationData).plannedStart).toBe("2027-01-01");
  });

  it("scales volume with the setting", async () => {
    const start = (await stateOf(store)).date;
    const counts: Record<string, number> = {};
    for (const frequency of ["low", "medium", "high"] as const) {
      await store.run("DELETE FROM negotiations");
      await store.run("DELETE FROM meta WHERE key = 'lastOfferDate'");
      await setFrequency(frequency);
      for (let index = 1; index <= 21; index++) await day(addDays(start, index));
      counts[frequency] = (await approaches()).length / 3;
    }
    expect(counts.low).toBeLessThanOrEqual(3);
    expect(counts.medium).toBeGreaterThanOrEqual(3.5);
    expect(counts.medium).toBeLessThanOrEqual(7);
    expect(counts.high).toBeGreaterThanOrEqual(7);
  });

  it("completes accepted offers, withdraws the rivals and tracks the loan to its return", async () => {
    await setFrequency("high");
    const start = (await stateOf(store)).date;
    await store.run(
      "UPDATE players SET available_loan = 1, listed = 0, contract_end = '2030-06-30' WHERE id IN (SELECT id FROM players WHERE club_id = 1 AND age BETWEEN 18 AND 21 AND injury_until IS NULL ORDER BY potential DESC LIMIT 3)",
    );
    let date = start;
    const accepted: number[] = [];
    for (let index = 1; index <= 6; index++) {
      date = addDays(start, index);
      await day(date);
      for (const offer of await store.all<Negotiation>(
        "SELECT * FROM negotiations WHERE selling_club_id = 1 AND stage = 'Offer received' AND created = ? ORDER BY id",
        date,
      )) {
        const rivals = (await store.all<{ id: number }>(
          "SELECT id FROM negotiations WHERE player_id = ? AND id <> ? AND stage = 'Offer received'",
          offer.player_id,
          offer.id,
        )).map((row) => row.id);
        const budget = (await store.get<{ transfer_budget: number }>("SELECT transfer_budget FROM clubs WHERE id = ?", offer.buying_club_id))!
          .transfer_budget;
        const result = await store.transaction(() => negotiationStep(store, offer.id, "accept"));
        expect(result.stage).toBe("Agent talks");
        accepted.push(offer.id);
        // The buyer's fee is reserved and every rival offer for the player is withdrawn.
        const data = JSON.parse((await store.get<Negotiation>("SELECT * FROM negotiations WHERE id = ?", offer.id))!.data) as NegotiationData;
        expect(data.reservedBudget).toBeGreaterThanOrEqual(offer.offer);
        expect(
          (await store.get<{ transfer_budget: number }>("SELECT transfer_budget FROM clubs WHERE id = ?", offer.buying_club_id))!
            .transfer_budget,
        ).toBeCloseTo(budget - data.reservedBudget!);
        for (const rival of rivals) {
          const closed = (await store.get<Negotiation>("SELECT * FROM negotiations WHERE id = ?", rival))!;
          expect(closed.stage).toBe("Withdrawn");
          expect((JSON.parse(closed.data) as NegotiationData).closedReason).toBe("accepted-elsewhere");
        }
      }
      await progress(date);
    }
    for (let index = 7; index <= 14; index++) await progress(addDays(start, index));
    expect(accepted.length).toBeGreaterThan(1);
    const deals = await store.all<Negotiation>("SELECT * FROM negotiations WHERE id = ANY(?::integer[])", accepted);
    expect(deals.map((deal) => deal.stage)).toEqual(deals.map(() => "Completed"));
    const loanDeal = deals.find((deal) => LOAN_TYPES.includes(deal.type));
    expect(loanDeal).toBeDefined();
    const loan = (await store.get<Loan>("SELECT * FROM loans WHERE player_id = ? AND status = 'active'", loanDeal!.player_id))!;
    expect(loan.parent_id).toBe(1);
    expect(loan.destination_id).toBe(loanDeal!.buying_club_id);
    expect(JSON.parse(loan.data).reason.text).toBe((JSON.parse(loanDeal!.data) as NegotiationData).reason!.text);
    const borrowed = await playerOf(store, loanDeal!.player_id);
    expect(borrowed).toMatchObject({ club_id: loanDeal!.buying_club_id, parent_club_id: 1 });
    await store.setMeta("state", { ...(await stateOf(store)), date: loan.end_date });
    await store.transaction(() => expireLoans(store));
    const returned = await playerOf(store, loanDeal!.player_id);
    expect(returned.club_id === 1 || (loan.type === "Loan with obligation" && returned.club_id === loan.destination_id)).toBe(true);
  });

  it("withdraws an approach when the player is injured and keeps loan counters consistent", async () => {
    await setFrequency("high");
    await store.run(
      "UPDATE players SET available_loan = 1, contract_end = '2030-06-30' WHERE id IN (SELECT id FROM players WHERE club_id = 1 AND age BETWEEN 18 AND 21 AND injury_until IS NULL ORDER BY potential DESC LIMIT 4)",
    );
    const start = (await stateOf(store)).date;
    let loanOffer: Negotiation | undefined;
    for (let index = 1; index <= 6 && !loanOffer; index++) {
      await day(addDays(start, index));
      loanOffer = (await approaches()).find((offer) => offer.stage === "Offer received" && LOAN_TYPES.includes(offer.type));
    }
    expect(loanOffer).toBeDefined();
    // A counter at the club's own terms is always acceptable to it.
    const terms = (JSON.parse(loanOffer!.data) as NegotiationData).terms;
    expect((await store.transaction(() => counterIncomingLoan(store, loanOffer!.id, loanOffer!.offer, terms))).stage).toBe(
      "Agent talks",
    );
    const other = (await approaches()).find((offer) => offer.stage === "Offer received" && offer.player_id !== loanOffer!.player_id);
    expect(other).toBeDefined();
    await store.run("UPDATE players SET injury_until = ? WHERE id = ?", addDays(start, 120), other!.player_id);
    await day(addDays(start, 7));
    const withdrawn = (await store.get<Negotiation>("SELECT * FROM negotiations WHERE id = ?", other!.id))!;
    expect(withdrawn.stage).toBe("Withdrawn");
    expect((JSON.parse(withdrawn.data) as NegotiationData).closedReason).toBe("injury");
  });

  it("persists the frequency through the settings API", async () => {
    expect((await updateSettings(store, { marketOfferFrequency: "high" })).marketOfferFrequency).toBe("high");
    expect((await store.meta<Record<string, unknown>>("settings")).marketOfferFrequency).toBe("high");
    await expect(updateSettings(store, { marketOfferFrequency: "always" })).rejects.toThrow("Transfer/Loan Offer Frequency");
  });
});
