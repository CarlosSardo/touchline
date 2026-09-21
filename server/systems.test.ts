import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { Store } from "./db.ts";
import { generateWorld } from "./world.ts";
import { mediaFeed } from "./media.ts";
import { assessPlayerInterest } from "./recruitment.ts";
import { addDays, DEFAULT_TRANSFER_TERMS } from "../shared/rules.ts";
import {
  assignScout,
  clubOf,
  completeNegotiation,
  counterIncomingOffer,
  defaultLoanTerms,
  enquire,
  exerciseBuyBack,
  expireLoans,
  finishScouting,
  negotiate,
  negotiationStep,
  progressDealMilestones,
  processTransferPayments,
  playerOf,
  recallLoan,
  reviewLoans,
  squadRole,
  movePlayerSquad,
  squadDestinations,
  stateOf,
  transferProceeds,
  weeklyWages,
} from "./systems.ts";
import type {
  Loan,
  Negotiation,
  NegotiationData,
  Player,
  Staff,
  TransferTerms,
  BuyBackClause,
} from "../shared/types.ts";

describe("director decisions and ownership boundaries", () => {
  let store: Store;
  beforeAll(async () => {
    store = await Store.createTest("systems");
  });
  beforeEach(async () =>
    store.transaction(async () => {
      await store.clearWorld();
      await store.schema();
      await generateWorld(store, {
        countryLimit: 2,
        seniors: 1200,
        youth: 400,
      });
      await store.run(
        "UPDATE clubs SET transfer_budget = 100000000, wage_budget = 10000000, balance = 200000000",
      );
    }),
  );
  afterAll(async () => await store?.close());

  it("moves eligible players reversibly between club squads without changing contracts, wages or ownership", async () => {
    const player = (await store.get<Player>(
      "SELECT TOP (1) * FROM players WHERE club_id = 1 AND age_group = 'U17'",
    ))!;
    const initialWages = await weeklyWages(store, 1);
    const originalContract = player.contract_end;
    const reserveId = Number(
      (
        await store.run(
          "INSERT INTO clubs(name,short_name,city,country_id,league_id,type,parent_id,age_group,color,reputation,academy,facilities,balance,transfer_budget,wage_budget,philosophy,culture,formation,tactical_style,chemistry,manager,manager_trust,board_confidence,board_pressure,fan_mood,fan_loyalty,fan_patience,expectations,stadium,capacity) SELECT name || ' Reserves',short_name,city,country_id,league_id,'bteam',id,age_group,color,reputation,academy,facilities,balance,transfer_budget,wage_budget,philosophy,culture,formation,tactical_style,chemistry,manager,manager_trust,board_confidence,board_pressure,fan_mood,fan_loyalty,fan_patience,expectations,stadium,capacity FROM clubs WHERE id = 1",
        )
      ).lastInsertRowid,
    );
    for (const age of ["U19", "Senior", "U17"] as const) {
      await movePlayerSquad(store, player.id, reserveId, age);
      expect((await playerOf(store, player.id)).squad_club_id).toBe(reserveId);
      await movePlayerSquad(store, player.id, 1, age);
      expect((await playerOf(store, player.id)).squad_club_id).toBeNull();
    }
    expect(await playerOf(store, player.id)).toMatchObject({
      club_id: 1,
      wage: player.wage,
      contract_end: originalContract,
    });
    expect(await weeklyWages(store, 1)).toBe(initialWages);
    await expect(
      movePlayerSquad(store, player.id, 2, "Senior"),
    ).rejects.toThrow(/your club/);
    await store.run(
      "UPDATE players SET birth_date = '2000-01-01',age = 15 WHERE id = ?",
      player.id,
    );
    await expect(movePlayerSquad(store, player.id, 1, "U17")).rejects.toThrow(
      /birth date/,
    );
    expect(
      (await squadDestinations(store, await playerOf(store, player.id)))
        .filter((entry) => entry.ageGroup === "Senior")
        .every((entry) => entry.eligible),
    ).toBe(true);
    await movePlayerSquad(store, player.id, reserveId, "Senior");
    await store.run("UPDATE players SET club_id = 2 WHERE id = ?", player.id);
    expect((await playerOf(store, player.id)).squad_club_id).toBeNull();
  });

  it("keeps personal salary terms unchanged while negotiating the club fee", async () => {
    const player = (await store.get<Player>(
      "SELECT TOP (1) * FROM players WHERE club_id = 2 AND age >= 18",
    ))!;
    const enquiry = await enquire(store, player.id, "Permanent transfer");
    await negotiationStep(store, enquiry.id, "formalize");
    const result = await negotiate(store, enquiry.id, {
      fee: enquiry.asking_price,
      wage: enquiry.wage * 2,
      years: 3,
      role: "Regular starter",
      promises: [],
    });
    expect(result.stage).toBe("Agent talks");
    expect(
      (await store.get<Negotiation>(
        "SELECT * FROM negotiations WHERE id = ?",
        enquiry.id,
      ))!.wage,
    ).toBe(enquiry.wage);
  });

  it("explains role credibility, wages and promises rather than treating money as automatic consent", async () => {
    const player = (await store.get<Player>(
      "SELECT TOP (1) * FROM players WHERE club_id = 2 AND age_group = 'Senior'",
    ))!;
    const buyer = await clubOf(store);
    await store.run(
      "UPDATE players SET position = ?,ability = 99 WHERE club_id = 1 AND age_group = 'Senior'",
      player.position,
    );
    const fringe = await assessPlayerInterest(store, player, buyer, {
      role: "Fringe player",
      wage: 1000,
    });
    const unrealistic = await assessPlayerInterest(store, player, buyer, {
      role: "Key player",
      wage: 1000,
      promises: ["European football"],
    });
    expect(
      unrealistic.factors.find((factor) => factor.id === "minutes")!.impact,
    ).toBeLessThan(
      fringe.factors.find((factor) => factor.id === "minutes")!.impact,
    );
    expect(
      unrealistic.factors.find((factor) => factor.id === "promises")!.impact,
    ).toBeLessThan(0);
    const rich = await assessPlayerInterest(store, player, buyer, {
      role: "Fringe player",
      wage: 1000000,
    });
    expect(rich.factors.find((factor) => factor.id === "wages")!.impact).toBe(
      15,
    );
    expect(rich.score).toBeGreaterThan(fringe.score);
    expect(rich.factors.length).toBeGreaterThanOrEqual(8);
    expect(
      await assessPlayerInterest(store, player, buyer, {
        role: "Fringe player",
        wage: 1000000,
      }),
    ).toEqual(rich);
  });

  it("can decline personal terms despite a high wage when the sporting move is unacceptable", async () => {
    const target = (await store.get<Player>(
      "SELECT TOP (1) * FROM players WHERE club_id = 2 AND age >= 18 AND age_group = 'Senior'",
    ))!;
    const deal = await enquire(store, target.id, "Permanent transfer");
    await negotiationStep(store, deal.id, "formalize");
    const terms = {
      fee: deal.asking_price,
      wage: 500000,
      years: 3,
      role: "Key player",
      promises: [],
    };
    await negotiate(store, deal.id, terms);
    const profile = JSON.parse(target.profile);
    profile.personality.ambition = 99;
    profile.personality.loyalty = 99;
    profile.personality.adaptability = 1;
    profile.identity.languages = [];
    profile.careerVision = ["Wants Champions League football"];
    await store.run(
      "UPDATE players SET profile = ?,age = 25,role = '[key] player',morale = 99,contract_end = '2030-06-30' WHERE id = ?",
      JSON.stringify(profile),
      target.id,
    );
    await store.run(
      "UPDATE clubs SET reputation = 1,academy = 1,facilities = 1 WHERE id = 1",
    );
    await store.run("UPDATE clubs SET reputation = 99 WHERE id = 2");
    const result = await negotiate(store, deal.id, terms);
    expect(result.stage).toBe("Agent talks");
    expect(result.message).toContain("not ready");
    const updated = JSON.parse(
      (await store.get<Negotiation>(
        "SELECT * FROM negotiations WHERE id = ?",
        deal.id,
      ))!.data,
    );
    expect(updated.interestDetails.score).toBeLessThan(35);
    expect(updated.interestDetails.concerns.length).toBeGreaterThan(0);
  });

  it("requires an employed, available scout and produces a complete report", async () => {
    const own = (await store.get<Staff>(
      "SELECT * FROM staff WHERE club_id = 1 AND role = 'Scout'",
    ))!;
    const foreign = (await store.get<Staff>(
      "SELECT * FROM staff WHERE club_id = 2 AND role = 'Scout'",
    ))!;
    const target = (await store.get<Player>(
      "SELECT TOP (1) * FROM players WHERE club_id = 2",
    ))!;
    await expect(
      assignScout(store, {
        staffId: foreign.id,
        playerId: target.id,
        maxAge: 30,
        budget: 100000000,
      }),
    ).rejects.toThrow("employed");
    await assignScout(store, {
      staffId: own.id,
      playerId: target.id,
      maxAge: 30,
      budget: 100000000,
    });
    await expect(
      assignScout(store, {
        staffId: own.id,
        playerId: target.id,
        maxAge: 30,
        budget: 100000000,
      }),
    ).rejects.toThrow("active assignment");
    await store.setMeta("state", {
      ...(await stateOf(store)),
      date: "2026-07-10",
    });
    await finishScouting(store);
    const report = (await store.get<{ data: string; accuracy: number }>(
      "SELECT * FROM reports WHERE player_id = ?",
      target.id,
    ))!;
    expect(Object.keys(JSON.parse(report.data))).toEqual(
      expect.arrayContaining([
        "strengths",
        "weaknesses",
        "riskFactors",
        "projection",
        "tacticalFit",
        "resale",
        "personalityNotes",
        "agentDifficulty",
      ]),
    );
    expect((await playerOf(store, target.id)).knowledge).toBe(report.accuracy);
  });

  it("does not spend funds on a rejected offer and rejects another club's squad edits", async () => {
    const target = (await store.get<Player>(
      "SELECT TOP (1) * FROM players WHERE club_id = 2",
    ))!;
    await expect(squadRole(store, target.id, "Captain")).rejects.toThrow(
      "not contracted",
    );
    const before = (await clubOf(store)).balance;
    const negotiation = await enquire(store, target.id, "Permanent transfer");
    expect(negotiation.stage).toBe("Enquiry");
    await negotiationStep(store, negotiation.id, "formalize");
    await negotiate(store, negotiation.id, {
      fee: 0,
      wage: target.wage,
      years: 3,
      role: "Squad player",
      promises: [],
    });
    expect((await clubOf(store)).balance).toBe(before);
    expect((await playerOf(store, target.id)).club_id).toBe(2);
    expect(
      (await store.get<Negotiation>(
        "SELECT * FROM negotiations WHERE id = ?",
        negotiation.id,
      ))!.stage,
    ).toBe("Club talks");
  });

  it("progresses accepted incoming offers without seller-controlled personal terms or early payment", async () => {
    const player = (await store.get<Player>(
      "SELECT TOP (1) * FROM players WHERE club_id = 1 AND age_group = 'Senior'",
    ))!;
    const data: NegotiationData = {
      workflowVersion: 2,
      log: [],
      agent: JSON.parse(player.profile).agent,
      terms: defaultLoanTerms(player, await clubOf(store, 2)),
      years: 3,
      role: "Regular starter",
      promises: [],
    };
    const id = Number(
      (
        await store.run(
          "INSERT INTO negotiations(player_id,buying_club_id,selling_club_id,type,stage,asking_price,offer,wage,interest,created,deadline,data) VALUES (?,2,1,'Permanent transfer','Offer received',100000,100000,?,75,'2026-07-01','2026-07-08',?)",
          player.id,
          player.wage * 2,
          JSON.stringify(data),
        )
      ).lastInsertRowid,
    );
    const deal = async () =>
      (await store.get<Negotiation>(
        "SELECT * FROM negotiations WHERE id = ?",
        id,
      ))!;
    const balance = (await clubOf(store)).balance;
    expect((await negotiationStep(store, id, "accept")).stage).toBe(
      "Agent talks",
    );
    await expect(
      negotiate(store, id, {
        fee: 100000,
        wage: 10000,
        years: 3,
        role: "Regular starter",
        promises: [],
      }),
    ).rejects.toThrow("buying club controls");
    for (const [date, stage] of [
      ["2026-07-02", "Contract review"],
      ["2026-07-03", "Medical"],
      ["2026-07-05", "Registration"],
    ]) {
      await store.setMeta("state", { ...(await stateOf(store)), date });
      await progressDealMilestones(store, await deal());
      expect((await deal()).stage).toBe(stage);
      expect((await playerOf(store, player.id)).club_id).toBe(1);
      expect((await clubOf(store)).balance).toBe(balance);
      if (stage === "Contract review")
        await expect(negotiationStep(store, id, "sign")).rejects.toThrow(
          "buying club controls",
        );
    }
    await store.setMeta("state", {
      ...(await stateOf(store)),
      date: "2026-07-06",
    });
    await progressDealMilestones(store, await deal());
    expect((await deal()).stage).toBe("Completed");
    expect((await playerOf(store, player.id)).club_id).toBe(2);
    expect((await clubOf(store)).balance).toBeGreaterThan(balance);
    expect(
      (JSON.parse((await deal()).data) as NegotiationData).log.map(
        (entry) => entry.type,
      ),
    ).toEqual([
      "Club talks",
      "Agent talks",
      "Contract review",
      "Medical",
      "Registration",
      "Completed",
    ]);
    await expect(completeNegotiation(store, await deal())).rejects.toThrow();
  });

  async function agreedTransfer(transferTerms: TransferTerms) {
    const player = (await store.get<Player>(
      "SELECT TOP (1) * FROM players WHERE club_id = 2 AND country_id = 1 AND age >= 18 ORDER BY value",
    ))!;
    const before = {
      buyer: await clubOf(store, 1),
      seller: await clubOf(store, 2),
    };
    const enquiry = await enquire(store, player.id, "Permanent transfer");
    const input = {
      fee: enquiry.asking_price + 0.03,
      wage: enquiry.wage * 2,
      years: 3,
      role: "Regular starter",
      promises: [],
      transferTerms,
    };
    await negotiationStep(store, enquiry.id, "formalize");
    await negotiate(store, enquiry.id, input);
    await expect(
      negotiate(store, enquiry.id, {
        ...input,
        transferTerms: { ...transferTerms, sellOnPercent: 11 },
      }),
    ).rejects.toThrow("already agreed");
    await negotiate(store, enquiry.id, input);
    await negotiationStep(store, enquiry.id, "sign");
    const deal = async () =>
      (await store.get<Negotiation>(
        "SELECT * FROM negotiations WHERE id = ?",
        enquiry.id,
      ))!;
    await store.setMeta("state", {
      ...(await stateOf(store)),
      date: addDays((await stateOf(store)).date, 2),
    });
    await progressDealMilestones(store, await deal());
    await store.setMeta("state", {
      ...(await stateOf(store)),
      date: addDays((await stateOf(store)).date, 1),
    });
    await progressDealMilestones(store, await deal());
    expect((await deal()).stage).toBe("Completed");
    return { player, negotiation: await deal(), before };
  }

  it("reserves the full fee but pays instalments once on their due dates without duplicate sale profit", async () => {
    const terms = {
      ...DEFAULT_TRANSFER_TERMS,
      upfrontPercent: 25,
      installments: 3,
      intervalMonths: 6,
    };
    const { negotiation, before } = await agreedTransfer(terms);
    const reports = (
      await mediaFeed(store, {
        scope: "club",
        topic: "transfer",
      })
    ).stories.filter((story) => story.report?.negotiationId === negotiation.id);
    expect(reports.map((story) => story.report!.status)).toEqual([
      "Confirmed",
      "Reported",
    ]);
    expect(reports[0].report!.comments).toHaveLength(4);
    const details = JSON.parse(negotiation.data) as NegotiationData;
    const agentFee = Math.round(
      (negotiation.wage * 52 * details.agent.commission) / 100,
    );
    const upfront = Math.round(negotiation.offer * 25) / 100;
    expect((await clubOf(store, 1)).balance).toBeCloseTo(
      before.buyer.balance - upfront - agentFee,
      2,
    );
    expect((await clubOf(store, 1)).transfer_budget).toBeCloseTo(
      before.buyer.transfer_budget - negotiation.offer - agentFee,
      2,
    );
    expect((await clubOf(store, 2)).balance).toBeCloseTo(
      before.seller.balance + upfront,
      2,
    );
    expect(
      (await store.get<{ sale_profit: number }>(
        "SELECT sale_profit FROM financial_periods WHERE club_id = 2 AND season = 2026",
      ))!.sale_profit,
    ).toBeCloseTo(negotiation.offer, 2);
    const last = (await store.get<{ due_date: string }>(
      "SELECT max(due_date) AS due_date FROM transfer_payments WHERE negotiation_id = ?",
      negotiation.id,
    ))!;
    const reservedBudget = (await clubOf(store, 1)).transfer_budget;
    await store.setMeta("state", {
      ...(await stateOf(store)),
      date: last.due_date,
    });
    expect(await processTransferPayments(store)).toBe(3);
    expect(await processTransferPayments(store)).toBe(0);
    expect((await clubOf(store, 1)).balance).toBeCloseTo(
      before.buyer.balance - negotiation.offer - agentFee,
      2,
    );
    expect((await clubOf(store, 2)).balance).toBeCloseTo(
      before.seller.balance + negotiation.offer,
      2,
    );
    expect((await clubOf(store, 1)).transfer_budget).toBe(reservedBudget);
    expect(
      (await store.get<{ sale_profit: number }>(
        "SELECT sale_profit FROM financial_periods WHERE club_id = 2 AND season = 2026",
      ))!.sale_profit,
    ).toBeCloseTo(negotiation.offer, 2);
  });

  it("splits deferred sale proceeds without paying sell-on beneficiaries early or twice", async () => {
    const player = (await store.get<Player>(
      "SELECT TOP (1) * FROM players WHERE club_id = 2 AND country_id = 1 AND age >= 18 ORDER BY value",
    ))!;
    await store.run(
      "INSERT INTO sell_on_clauses(player_id,beneficiary_id,owner_id,percentage) VALUES (?,3,2,15)",
      player.id,
    );
    const beneficiaryBefore = (await clubOf(store, 3)).balance;
    const { negotiation, before } = await agreedTransfer({
      ...DEFAULT_TRANSFER_TERMS,
      upfrontPercent: 40,
      installments: 4,
      intervalMonths: 3,
    });
    const claim = Math.round(negotiation.offer * 15) / 100;
    expect(
      (await clubOf(store, 3)).balance - beneficiaryBefore,
    ).toBeGreaterThan(0);
    expect((await clubOf(store, 3)).balance - beneficiaryBefore).toBeLessThan(
      claim,
    );
    const due = (await store.get<{ date: string }>(
      "SELECT max(due_date) AS date FROM transfer_payments WHERE negotiation_id = ?",
      negotiation.id,
    ))!;
    await store.setMeta("state", { ...(await stateOf(store)), date: due.date });
    await processTransferPayments(store);
    expect((await clubOf(store, 3)).balance).toBeCloseTo(
      beneficiaryBefore + claim,
      2,
    );
    expect((await clubOf(store, 2)).balance).toBeCloseTo(
      before.seller.balance + negotiation.offer - claim,
      2,
    );
    expect(
      (await store.get<{ sale_profit: number }>(
        "SELECT sale_profit FROM financial_periods WHERE club_id = 3 AND season = 2026",
      ))!.sale_profit,
    ).toBe(claim);
    expect(
      await store.get<{ status: string; paid: number }>(
        "SELECT status,paid FROM sell_on_clauses WHERE player_id = ?",
        player.id,
      ),
    ).toEqual({ status: "paid", paid: claim });
    expect(await processTransferPayments(store)).toBe(0);
  });

  it("rejects invalid instalment structures before committing club terms", async () => {
    const player = (await store.get<Player>(
      "SELECT TOP (1) * FROM players WHERE club_id = 2 AND age >= 18",
    ))!;
    const deal = await enquire(store, player.id, "Permanent transfer");
    await negotiationStep(store, deal.id, "formalize");
    const input = {
      fee: deal.asking_price,
      wage: deal.wage * 2,
      years: 3,
      role: "Regular starter",
      promises: [],
    };
    await expect(
      negotiate(store, deal.id, {
        ...input,
        transferTerms: { ...DEFAULT_TRANSFER_TERMS, upfrontPercent: 50 },
      }),
    ).rejects.toThrow("Choose instalments");
    await expect(
      negotiate(store, deal.id, {
        ...input,
        transferTerms: {
          ...DEFAULT_TRANSFER_TERMS,
          upfrontPercent: 50,
          installments: 8,
          intervalMonths: 12,
        },
      }),
    ).rejects.toThrow("five years");
    expect(await store.all("SELECT * FROM transfer_payments")).toHaveLength(0);
  });

  it("enforces owned buy-back rights and retains agreed sell-on clauses", async () => {
    const { player, negotiation } = await agreedTransfer({
      ...DEFAULT_TRANSFER_TERMS,
      buyBackFee: 10000000,
      buyBackYears: 2,
      sellOnPercent: 15,
    });
    const clause = (await store.get<BuyBackClause>(
      "SELECT * FROM buy_back_clauses WHERE negotiation_id = ?",
      negotiation.id,
    ))!;
    expect(clause.beneficiary_id).toBe(2);
    expect(clause.owner_id).toBe(1);
    expect(clause.expires).toBe("2028-07-04");
    await expect(exerciseBuyBack(store, clause.id)).rejects.toThrow(
      "does not belong",
    );
    await store.setMeta("state", { ...(await stateOf(store)), clubId: 2 });
    const result = await exerciseBuyBack(store, clause.id);
    expect(result.stage).toBe("Agent talks");
    expect((await playerOf(store, player.id)).club_id).toBe(1);
    const deal = async () =>
      (await store.get<Negotiation>(
        "SELECT * FROM negotiations WHERE id = ?",
        result.id,
      ))!;
    expect((await deal()).offer).toBe(clause.fee);
    expect((await exerciseBuyBack(store, clause.id)).id).toBe(result.id);
    await negotiate(store, result.id, {
      fee: clause.fee,
      wage: (await deal()).wage * 2,
      years: 3,
      role: "Regular starter",
      promises: [],
    });
    await negotiationStep(store, result.id, "sign");
    await store.setMeta("state", {
      ...(await stateOf(store)),
      date: "2026-07-06",
    });
    await progressDealMilestones(store, await deal());
    await store.setMeta("state", {
      ...(await stateOf(store)),
      date: "2026-07-07",
    });
    await progressDealMilestones(store, await deal());
    expect((await deal()).stage).toBe("Completed");
    expect((await playerOf(store, player.id)).club_id).toBe(2);
    expect(
      (await store.get<BuyBackClause>(
        "SELECT * FROM buy_back_clauses WHERE id = ?",
        clause.id,
      ))!.status,
    ).toBe("exercised");
    expect(
      (await store.get<{ paid: number }>(
        "SELECT paid FROM sell_on_clauses WHERE player_id = ?",
        player.id,
      ))!.paid,
    ).toBe(1500000);
    await expect(exerciseBuyBack(store, clause.id)).rejects.toThrow(
      "no longer active",
    );
  });

  it("expires buy-back rights after their agreed validity period", async () => {
    const { negotiation } = await agreedTransfer({
      ...DEFAULT_TRANSFER_TERMS,
      buyBackFee: 10000000,
      buyBackYears: 1,
    });
    const clause = (await store.get<BuyBackClause>(
      "SELECT * FROM buy_back_clauses WHERE negotiation_id = ?",
      negotiation.id,
    ))!;
    await store.setMeta("state", {
      ...(await stateOf(store)),
      clubId: 2,
      date: addDays(clause.expires, 1),
    });
    await expect(exerciseBuyBack(store, clause.id)).rejects.toThrow("expired");
    await processTransferPayments(store);
    expect(
      (await store.get<BuyBackClause>(
        "SELECT * FROM buy_back_clauses WHERE id = ?",
        clause.id,
      ))!.status,
    ).toBe("expired");
  });

  it("can counter incoming offers with binding club clauses before autonomous personal talks", async () => {
    const player = (await store.get<Player>(
      "SELECT TOP (1) * FROM players WHERE club_id = 1 AND age_group = 'Senior'",
    ))!;
    const data: NegotiationData = {
      workflowVersion: 2,
      log: [],
      agent: JSON.parse(player.profile).agent,
      terms: defaultLoanTerms(player, await clubOf(store, 2)),
      years: 3,
      role: "Regular starter",
      promises: [],
    };
    const id = Number(
      (
        await store.run(
          "INSERT INTO negotiations(player_id,buying_club_id,selling_club_id,type,stage,asking_price,offer,wage,interest,created,deadline,data) VALUES (?,2,1,'Permanent transfer','Offer received',1000000,900000,?,75,'2026-07-01','2026-07-08',?)",
          player.id,
          player.wage * 2,
          JSON.stringify(data),
        )
      ).lastInsertRowid,
    );
    const terms = {
      ...DEFAULT_TRANSFER_TERMS,
      upfrontPercent: 50,
      installments: 2,
      sellOnPercent: 10,
      buyBackFee: 2000000,
    };
    expect((await counterIncomingOffer(store, id, 2000000, terms)).stage).toBe(
      "Offer received",
    );
    expect((await counterIncomingOffer(store, id, 1000000, terms)).stage).toBe(
      "Agent talks",
    );
    const updated = JSON.parse(
      (await store.get<Negotiation>(
        "SELECT * FROM negotiations WHERE id = ?",
        id,
      ))!.data,
    ) as NegotiationData;
    expect(updated.transferTerms).toEqual(terms);
    expect(updated.buyerManaged).toBe(true);
    await expect(
      counterIncomingOffer(store, id, 1000000, terms),
    ).rejects.toThrow("Only a permanent incoming");
  });

  async function agreedLoan(recall: boolean, type = "Development loan") {
    const player = (await store.get<Player>(
      "SELECT TOP (1) * FROM players WHERE club_id = 1 AND age_group = ?",
      "Senior",
    ))!;
    await store.run(
      "UPDATE players SET age = 20, ability = 70, potential = 85, contract_end = ? WHERE id = ?",
      "2030-06-30",
      player.id,
    );
    const negotiation = await enquire(store, player.id, type, 2);
    await negotiationStep(store, negotiation.id, "formalize");
    const terms = {
      ...defaultLoanTerms(
        await playerOf(store, player.id),
        await clubOf(store, 2),
      ),
      recall,
      duration: 365,
      salarySplit: 65,
    };
    const input = {
      fee: negotiation.asking_price,
      wage: player.wage * 2,
      years: 3,
      role: "Regular starter",
      promises: ["First-team minutes"],
      terms,
    };
    await negotiate(store, negotiation.id, input);
    await negotiate(store, negotiation.id, input);
    expect(
      (await store.get<Negotiation>(
        "SELECT * FROM negotiations WHERE id = ?",
        negotiation.id,
      ))!.stage,
    ).toBe("Contract review");
    await negotiationStep(store, negotiation.id, "sign");
    await store.setMeta("state", {
      ...(await stateOf(store)),
      date: "2026-07-03",
    });
    await progressDealMilestones(
      store,
      (await store.get<Negotiation>(
        "SELECT * FROM negotiations WHERE id = ?",
        negotiation.id,
      ))!,
    );
    expect(
      (await store.get<Negotiation>(
        "SELECT * FROM negotiations WHERE id = ?",
        negotiation.id,
      ))!.stage,
    ).toBe("Registration");
    await store.setMeta("state", {
      ...(await stateOf(store)),
      date: "2026-07-04",
    });
    await store.transaction(
      async () =>
        await completeNegotiation(
          store,
          (await store.get<Negotiation>(
            "SELECT * FROM negotiations WHERE id = ?",
            negotiation.id,
          ))!,
        ),
    );
    const loan = (await store.get<Loan>(
      "SELECT * FROM loans WHERE player_id = ?",
      player.id,
    ))!;
    return { player, loan, negotiation };
  }

  it("completes a loan through club talks, agent talks and medical checks", async () => {
    const { player, loan, negotiation } = await agreedLoan(false);
    expect((await playerOf(store, player.id)).club_id).toBe(2);
    expect((await playerOf(store, player.id)).parent_club_id).toBe(1);
    expect(JSON.parse(loan.terms).salarySplit).toBe(65);
    expect(
      (await store.get<Negotiation>(
        "SELECT * FROM negotiations WHERE id = ?",
        negotiation.id,
      ))!.stage,
    ).toBe("Completed");
    await expect(recallLoan(store, loan.id)).rejects.toThrow(
      "No standard recall clause",
    );
    await expect(recallLoan(store, loan.id, true)).rejects.toThrow(
      "requires an injury",
    );
    expect(
      (await store.get<{ count: number }>(
        "SELECT count(*) AS count FROM promises WHERE player_id = ?",
        player.id,
      ))!.count,
    ).toBe(1);
  });

  it("honors recall clauses and returns registration to the parent club", async () => {
    const { player, loan } = await agreedLoan(true);
    await recallLoan(store, loan.id);
    expect((await playerOf(store, player.id)).club_id).toBe(1);
    expect((await playerOf(store, player.id)).parent_club_id).toBeNull();
    expect(
      (await store.get<Loan>("SELECT * FROM loans WHERE id = ?", loan.id))!
        .status,
    ).toBe("recalled");
  });

  it("enforces a purchase obligation at the end of a loan", async () => {
    const { player, loan } = await agreedLoan(true, "Loan with obligation");
    await store.setMeta("state", {
      ...(await stateOf(store)),
      date: "2027-07-04",
    });
    await store.run("UPDATE clubs SET transfer_budget = 0 WHERE id = 2");
    await reviewLoans(store);
    expect(
      (await store.get<Loan>("SELECT * FROM loans WHERE id = ?", loan.id))!
        .status,
    ).toBe("purchased");
    expect((await playerOf(store, player.id)).parent_club_id).toBeNull();
    expect((await playerOf(store, player.id)).club_id).toBe(2);
    expect((await clubOf(store, 2)).transfer_budget).toBeLessThan(0);
  });

  it("does not allow public or duplicate completion to spend transfer funds twice", async () => {
    const { negotiation } = await agreedLoan(true);
    const completed = (await store.get<Negotiation>(
      "SELECT * FROM negotiations WHERE id = ?",
      negotiation.id,
    ))!;
    await expect(
      negotiate(store, completed.id, {
        fee: 0,
        wage: 100,
        years: 3,
        role: "Squad player",
        promises: [],
      }),
    ).rejects.toThrow("not awaiting");
    const details = JSON.parse(completed.data) as NegotiationData;
    expect(details.log.map((entry) => entry.type)).toEqual(
      expect.arrayContaining(["Enquiry", "Agent talks", "Medical"]),
    );
    await expect(completeNegotiation(store, completed)).rejects.toThrow(
      "registration has changed",
    );
  });

  it("pays and retires a loan sell-on clause when the parent later sells the player", async () => {
    const { player, loan } = await agreedLoan(true, "Loan with sell-on");
    const before = (await clubOf(store, 2)).balance;
    await store.setMeta("state", {
      ...(await stateOf(store)),
      date: "2027-07-05",
    });
    await expireLoans(store);
    expect((await playerOf(store, player.id)).club_id).toBe(1);
    expect(
      (await store.get<Loan>("SELECT * FROM loans WHERE id = ?", loan.id))!
        .status,
    ).toBe("completed");
    const net = await transferProceeds(
      store,
      player.id,
      1,
      10_000_000,
      "Test future sale",
    );
    expect(net).toBe(8_500_000);
    expect((await clubOf(store, 2)).balance - before).toBe(1_500_000);
    expect(
      await transferProceeds(store, player.id, 1, 10_000_000, "Second sale"),
    ).toBe(10_000_000);
  });

  it("calculates wage commitments using the negotiated salary split", async () => {
    const beforeParent = await weeklyWages(store, 1);
    const beforeBorrower = await weeklyWages(store, 2);
    const { player } = await agreedLoan(true);
    expect(await weeklyWages(store, 1)).toBeCloseTo(
      beforeParent - player.wage * 0.65,
    );
    expect(await weeklyWages(store, 2)).toBeCloseTo(
      beforeBorrower + player.wage * 0.65,
    );
  });

  it("keeps cumulative loan minutes when season statistics reset", async () => {
    const { player, loan } = await agreedLoan(true, "Two-year loan");
    await store.run(
      "INSERT INTO history(season, entity_type, entity_id, date, data) VALUES (2026,'appearance',?,?,?)",
      player.id,
      "2027-05-10",
      JSON.stringify({ minutes: 90, position: player.position, clubId: 2 }),
    );
    await store.run("UPDATE players SET minutes = 0 WHERE id = ?", player.id);
    await store.setMeta("state", {
      ...(await stateOf(store)),
      date: "2027-07-08",
    });
    await reviewLoans(store);
    expect(
      JSON.parse(
        (await store.get<Loan>("SELECT * FROM loans WHERE id = ?", loan.id))!
          .data,
      ).minutes,
    ).toBe(90);
  });

  it("does not grant English registration based on ability alone", async () => {
    const foreign = (await store.get<Player>(
      "SELECT TOP (1) * FROM players WHERE country_id = 2 AND club_id IN (SELECT id FROM clubs WHERE country_id = 2)",
    ))!;
    await store.run(
      "UPDATE players SET ability = 99, potential = 99, wage = 5000, value = 1000000, age = 25 WHERE id = ?",
      foreign.id,
    );
    const enquiry = await enquire(store, foreign.id, "Permanent transfer");
    const data = JSON.parse(enquiry.data) as NegotiationData;
    data.medicalDate = "2026-07-01";
    data.signedDate = "2026-07-01";
    data.medicalPassed = true;
    data.registrationDate = "2026-07-01";
    await store.run(
      "UPDATE negotiations SET stage = 'Registration', offer = 1000000, wage = 10000, data = ? WHERE id = ?",
      JSON.stringify(data),
      enquiry.id,
    );
    const balance = (await clubOf(store)).balance;
    await completeNegotiation(
      store,
      (await store.get<Negotiation>(
        "SELECT * FROM negotiations WHERE id = ?",
        enquiry.id,
      ))!,
    );
    expect(
      (await store.get<Negotiation>(
        "SELECT * FROM negotiations WHERE id = ?",
        enquiry.id,
      ))!.stage,
    ).toBe("Rejected");
    expect((await clubOf(store)).balance).toBe(balance);
    expect((await playerOf(store, foreign.id)).club_id).toBe(foreign.club_id);
  });

  it("cannot skip enquiry, agreement or registration stages", async () => {
    const target = (await store.get<Player>(
      "SELECT TOP (1) * FROM players WHERE club_id = 2",
    ))!;
    const deal = await enquire(store, target.id, "Permanent transfer");
    const terms = {
      fee: deal.asking_price,
      wage: target.wage * 2,
      years: 3,
      role: "Regular starter",
      promises: [],
    };
    await expect(negotiate(store, deal.id, terms)).rejects.toThrow(
      "not awaiting an offer",
    );
    await expect(negotiationStep(store, deal.id, "sign")).rejects.toThrow(
      "must be agreed",
    );
    await negotiationStep(store, deal.id, "formalize");
    await negotiate(store, deal.id, terms);
    await negotiate(store, deal.id, terms);
    const unsigned = (await store.get<Negotiation>(
      "SELECT * FROM negotiations WHERE id = ?",
      deal.id,
    ))!;
    expect(unsigned.stage).toBe("Contract review");
    await expect(completeNegotiation(store, unsigned)).rejects.toThrow(
      "not awaiting registration",
    );
    await negotiationStep(store, deal.id, "revise");
    expect(
      (await store.get<Negotiation>(
        "SELECT * FROM negotiations WHERE id = ?",
        deal.id,
      ))!.stage,
    ).toBe("Agent talks");
  });
});
