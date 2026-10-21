import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  assessYouthTransfer,
  minorTransferRoute,
  processMinorApplications,
  submitMinorApplication,
} from "./recruitment.ts";
import { Store } from "./db.ts";
import { generateWorld } from "./world.ts";
import {
  closeNegotiation,
  clubOf,
  completeNegotiation,
  enquire,
  negotiate,
  negotiationStep,
  playerOf,
  progressDealMilestones,
  stateOf,
} from "./systems.ts";
import type {
  Club,
  Negotiation,
  Player,
  PlayerProfile,
} from "../shared/types.ts";
import {
  adultTransferArrival,
  ageOn,
  transferWindow,
} from "../shared/rules.ts";
import { advance, seasonRollover } from "./simulation.ts";
import { owedInstalments, seasonBudgets } from "./finance.ts";
import {
  clubRegistration,
  countsTowardQuota,
  familyResidence,
  foreignQuota,
  minorPresenceLegal,
  minorRoute,
  residenceYears,
} from "./registration.ts";

describe("minor international-transfer exceptions", () => {
  it("schedules future arrivals only after adulthood and inside a registration window", () => {
    expect(adultTransferArrival("2012-07-20")).toBe("2030-07-20");
    expect(adultTransferArrival("2011-09-20")).toBe("2030-01-01");
    expect(adultTransferArrival("2010-02-10")).toBe("2028-06-15");
    for (const birth of [
      "2012-07-20",
      "2011-09-20",
      "2010-02-10",
      "2008-02-29",
    ]) {
      expect(ageOn(birth, adultTransferArrival(birth))).toBeGreaterThanOrEqual(
        18,
      );
      expect(transferWindow(adultTransferArrival(birth))).toBe(true);
    }
  });
  it("requires age 16-17 and a move within the EU/EEA, not simply a European destination", () => {
    expect(minorTransferRoute(17, "FR", "LU").route).toBe("eu-eea");
    expect(minorTransferRoute(16, "NO", "DE").eligibleToApply).toBe(true);
    expect(minorTransferRoute(15, "FR", "LU").eligibleToApply).toBe(false);
    expect(minorTransferRoute(17, "BR", "FR").eligibleToApply).toBe(false);
    expect(minorTransferRoute(17, "FR", "EN").eligibleToApply).toBe(false);
    expect(minorTransferRoute(17, "CH", "FR").eligibleToApply).toBe(false);
    expect(minorTransferRoute(17, "SCO", "EN").route).toBe("same-country");
  });
  it("distinguishes independent parental relocation, domestic moves and adult transfers", () => {
    expect(minorTransferRoute(15, "BR", "LU", true).route).toBe(
      "parent-relocation",
    );
    expect(minorTransferRoute(15, "BR", "LU", false).route).toBe("blocked");
    expect(minorTransferRoute(15, "LU", "LU").route).toBe("domestic");
    expect(minorTransferRoute(18, "BR", "LU").route).toBe("adult");
  });
});

describe("Article 19 routes by nationality and ancestry", () => {
  const club = (code: string) => ({ home: code, association: code });
  const derry = clubRegistration("NIR", { hosted: { host: "IE", registration: "host" } });
  const toronto = clubRegistration("CA", { hosted: { host: "US", registration: "host" } });
  it("treats a minor holding the club's nationality as local for a first registration", () => {
    expect(minorRoute({ age: 14, nationalities: ["BR", "PT"], destination: club("PT") }).route).toBe("first-registration");
    expect(minorRoute({ age: 14, nationalities: ["BR"], destination: club("PT") }).route).toBe("blocked");
    expect(minorRoute({ age: 14, nationalities: ["BR"], destination: club("PT"), residenceYears: 5 }).route).toBe("first-registration");
    expect(minorRoute({ age: 14, nationalities: ["BR"], destination: club("PT"), parentsMoved: true }).route).toBe("parent-relocation");
  });
  it("needs a real exception for international transfers, whatever the passport", () => {
    const fromFrance = { source: club("FR"), destination: club("PT") };
    expect(minorRoute({ age: 15, nationalities: ["FR", "PT"], ...fromFrance }).route).toBe("blocked");
    expect(minorRoute({ age: 16, nationalities: ["FR", "PT"], ...fromFrance }).route).toBe("eu-eea");
    expect(minorRoute({ age: 16, nationalities: ["BR"], ...fromFrance }).route).toBe("blocked");
    expect(minorRoute({ age: 16, nationalities: ["BR", "IT"], ...fromFrance }).route).toBe("eu-eea");
    expect(minorRoute({ age: 17, nationalities: ["FR"], source: club("FR"), destination: club("EN") }).route).toBe("blocked");
    expect(minorRoute({ age: 16, nationalities: ["SCO"], source: club("SCO"), destination: club("EN") }).route).toBe("same-country");
    expect(minorRoute({ age: 15, nationalities: ["SCO"], source: club("SCO"), destination: club("EN") }).route).toBe("blocked");
    expect(minorRoute({ age: 15, nationalities: ["BR"], source: club("BR"), destination: club("PT"), border: { home: 30, club: 20 } }).route).toBe("border");
    expect(minorRoute({ age: 15, nationalities: ["BR"], source: club("BR"), destination: club("PT"), border: { home: 60, club: 20 } }).route).toBe("blocked");
    expect(minorRoute({ age: 15, nationalities: ["AF"], source: club("AF"), destination: club("DE"), humanitarian: true }).route).toBe("humanitarian");
  });
  it("counts cross-border clubs as local to both nations", () => {
    expect(derry).toEqual({ home: "NIR", association: "IE" });
    expect(minorRoute({ age: 14, nationalities: ["NIR"], destination: derry }).route).toBe("first-registration");
    expect(minorRoute({ age: 14, nationalities: ["IE"], destination: derry }).route).toBe("first-registration");
    expect(minorRoute({ age: 15, nationalities: ["NIR"], source: club("NIR"), destination: derry }).route).toBe("domestic");
    expect(minorRoute({ age: 15, nationalities: ["IE"], source: club("IE"), destination: derry }).route).toBe("domestic");
    expect(minorRoute({ age: 15, nationalities: ["US"], destination: toronto }).route).toBe("first-registration");
    expect(minorPresenceLegal({ age: 15, nationalities: ["CA"], destination: toronto })).toBe(true);
  });
  it("judges an existing minor registration on every nationality held", () => {
    expect(minorPresenceLegal({ age: 16, nationalities: ["FR"], destination: club("PT") })).toBe(true);
    expect(minorPresenceLegal({ age: 15, nationalities: ["FR"], destination: club("PT") })).toBe(false);
    expect(minorPresenceLegal({ age: 15, nationalities: ["FR", "PT"], destination: club("PT") })).toBe(true);
    expect(minorPresenceLegal({ age: 16, nationalities: ["FR"], destination: club("EN") })).toBe(false);
    expect(minorPresenceLegal({ age: 16, nationalities: ["WAL"], destination: club("EN") })).toBe(true);
    expect(minorPresenceLegal({ age: 18, nationalities: ["BR"], destination: club("EN") })).toBe(true);
  });
  it("lets a 16-17-year-old move between UK home nations without a British passport", () => {
    expect(minorRoute({ age: 16, nationalities: ["BR"], source: club("SCO"), destination: club("EN") }).route).toBe("same-country");
    const scotland = { code: "SCO", years: 16, parentsMoved: false };
    expect(minorPresenceLegal({ age: 16, nationalities: ["BR"], destination: club("EN"), residence: scotland })).toBe(true);
    expect(minorPresenceLegal({ age: 17, nationalities: ["US"], destination: clubRegistration("WAL", { hosted: { host: "EN", registration: "host" } }), residence: { code: "NIR", years: 2, parentsMoved: true } })).toBe(true);
    expect(minorPresenceLegal({ age: 15, nationalities: ["BR"], destination: club("EN"), residence: scotland })).toBe(false);
    expect(minorPresenceLegal({ age: 17, nationalities: ["BR"], destination: club("EN"), residence: { code: "SCO", years: 3, parentsMoved: false } })).toBe(false);
    expect(minorPresenceLegal({ age: 17, nationalities: ["BR"], destination: club("EN") })).toBe(false);
    expect(minorPresenceLegal({ age: 17, nationalities: ["IE"], destination: club("NIR"), residence: { code: "IE", years: 17, parentsMoved: false } })).toBe(false);
    expect(minorPresenceLegal({ age: 17, nationalities: ["FR"], destination: club("EN"), residence: { code: "FR", years: 17, parentsMoved: false } })).toBe(false);
  });
  it("accepts a verified non-football family move to the club's country at any age", () => {
    expect(minorPresenceLegal({ age: 14, nationalities: ["BR"], destination: club("PT"), residence: { code: "PT", years: 2, parentsMoved: true } })).toBe(true);
    expect(minorPresenceLegal({ age: 14, nationalities: ["BR"], destination: club("PT"), residence: { code: "PT", years: 2, parentsMoved: false } })).toBe(false);
    expect(minorPresenceLegal({ age: 14, nationalities: ["BR"], destination: club("PT"), residence: { code: "ES", years: 9, parentsMoved: true } })).toBe(false);
    expect(minorPresenceLegal({ age: 14, nationalities: ["BR"], destination: club("PT"), residence: { code: "PT", years: 5, parentsMoved: false } })).toBe(true);
    const swansea = clubRegistration("WAL", { hosted: { host: "EN", registration: "host" } });
    expect(minorPresenceLegal({ age: 14, nationalities: ["BR"], destination: swansea, residence: { code: "EN", years: 2, parentsMoved: true } })).toBe(true);
  });
  it("places the family at the recorded move once made, else at the birthplace", () => {
    const codes = new Map([[1, "BR"], [2, "SCO"]]);
    const codeOf = (id: number) => codes.get(id);
    const move = { countryId: 2, reason: "employment" as const, verified: true, date: "2024-07-01" };
    expect(familyResidence({ identity: { birthCountryId: 1 }, familyMove: move }, "2010-07-01", "2026-07-01", codeOf)).toEqual({ code: "SCO", years: expect.closeTo(2, 1), parentsMoved: true });
    expect(familyResidence({ identity: { birthCountryId: 1 }, familyMove: { ...move, reason: "football" } }, "2010-07-01", "2026-07-01", codeOf)?.parentsMoved).toBe(false);
    expect(familyResidence({ identity: { birthCountryId: 1 }, familyMove: { ...move, date: "2027-01-01" } }, "2010-07-01", "2026-07-01", codeOf)).toEqual({ code: "BR", years: expect.closeTo(16, 1), parentsMoved: false });
    expect(familyResidence({ identity: {} }, "2010-07-01", "2026-07-01", codeOf)).toBeUndefined();
    expect(residenceYears({ identity: { birthCountryId: 1 }, familyMove: move }, 1, "2010-07-01", "2026-07-01")).toBe(0);
  });
  it("fills foreign-player quotas on all nationalities", () => {
    const spain = foreignQuota("ES", 1)!;
    expect(countsTowardQuota(spain, ["BR"], "ES")).toBe(true);
    expect(countsTowardQuota(spain, ["BR", "IT"], "ES")).toBe(false);
    expect(countsTowardQuota(spain, ["SN"], "ES")).toBe(false);
    const mls = foreignQuota("US", 1, "CA")!;
    expect(countsTowardQuota(mls, ["CA"], "CA")).toBe(false);
    expect(countsTowardQuota(mls, ["US"], "CA")).toBe(false);
    expect(countsTowardQuota(mls, ["MX"], "CA")).toBe(true);
    expect(countsTowardQuota(foreignQuota("US", 1)!, ["CA"], "US")).toBe(true);
  });
});

describe("youth recruitment registration", () => {
  let store: Store;
  let player: Player;
  let buyer: Club;
  const safeguards = {
    football: true,
    education: true,
    care: true,
    mentor: true,
    parentalConsent: true,
  };
  beforeAll(async () => {
    store = await Store.createTest("registration");
  });
  beforeEach(async () =>
    store.transaction(async () => {
      await store.clearWorld();
      await store.schema();
      await generateWorld(store, { nations: ["EN", "ES", "DE", "IT", "FR", "PT"] });
      const clubs = await store.all<Club>(
        "SELECT clubs.* FROM clubs JOIN countries ON countries.id = clubs.country_id WHERE clubs.type = 'club' AND countries.code IN ('FR','ES','DE','IT','PT','NL') AND clubs.id = (SELECT MIN(candidate.id) FROM clubs AS candidate WHERE candidate.country_id = clubs.country_id AND candidate.type = 'club') ORDER BY clubs.id",
      );
      buyer = clubs[1];
      expect(buyer).toBeTruthy();
      await store.run(
        "UPDATE clubs SET balance = 100000000, transfer_budget = 10000000, wage_budget = 10000000",
      );
      await store.setMeta("state", {
        ...(await stateOf(store)),
        clubId: buyer.id,
      });
      player = (await store.get<Player>(
        "SELECT * FROM players WHERE club_id = ? AND country_id = ? AND age_group != 'Senior' ORDER BY id LIMIT 1",
        clubs[0].id,
        clubs[0].country_id,
      ))!;
      const profile = JSON.parse(player.profile) as PlayerProfile;
      profile.contract = {
        status: "amateur",
        trainingClubId: player.club_id!,
        trainingStartAge: 12,
      };
      delete profile.familyMove;
      // A second passport of the buyer's nation would change every Article 19 route below.
      profile.identity.nationalities = profile.identity.nationalities?.filter(
        (entry) => entry.countryId !== buyer.country_id,
      );
      await store.run(
        "UPDATE players SET age = 17,birth_date='2009-01-01',profile = ? WHERE id = ?",
        JSON.stringify(profile),
        player.id,
      );
      player = await playerOf(store, player.id);
      buyer = await clubOf(store, buyer.id);
    }),
  );
  afterAll(async () => await store?.close());

  async function futureDeal(
    birthDate = "2011-08-01",
    contractEnd = "2030-06-30",
  ) {
    await store.run(
      "UPDATE players SET age = ?,birth_date = ?,contract_end = ? WHERE id = ?",
      ageOn(birthDate, (await stateOf(store)).date),
      birthDate,
      contractEnd,
      player.id,
    );
    player = await playerOf(store, player.id);
    const enquiry = await enquire(
      store,
      player.id,
      "Future transfer",
      true,
    );
    await negotiationStep(store, enquiry.id, "formalize");
    const offer = {
      fee: enquiry.asking_price,
      wage: enquiry.wage * 2,
      years: 3,
      role: "Prospect",
      promises: [],
    };
    await negotiate(store, enquiry.id, offer);
    await negotiate(store, enquiry.id, offer);
    await negotiationStep(store, enquiry.id, "sign");
    return async () =>
      (await store.get<Negotiation>(
        "SELECT * FROM negotiations WHERE id = ?",
        enquiry.id,
      ))!;
  }

  it("retains scheduled deals past enquiry expiry and registers at 18 without spending the budget twice", async () => {
    const deal = await futureDeal();
    const reserved = JSON.parse((await deal()).data).reservedBudget;
    const currentWage = player.wage;
    const sellerBalance = (await clubOf(store, player.club_id!)).balance;
    await store.setMeta("state", {
      ...(await stateOf(store)),
      date: "2026-07-16",
    });
    await advance(store, 1);
    expect((await deal()).stage).toBe("Scheduled");
    expect((await playerOf(store, player.id)).club_id).toBe(player.club_id);
    await store.setMeta("state", {
      ...(await stateOf(store)),
      date: "2029-07-30",
      season: 2029,
    });
    await progressDealMilestones(store, await deal());
    expect((await deal()).stage).toBe("Registration");
    await store.setMeta("state", {
      ...(await stateOf(store)),
      date: "2029-07-31",
    });
    await progressDealMilestones(store, await deal());
    expect((await playerOf(store, player.id)).club_id).toBe(player.club_id);
    expect((await playerOf(store, player.id)).wage).toBe(currentWage);
    const balance = (await clubOf(store)).balance;
    const budget = (await clubOf(store)).transfer_budget;
    await store.setMeta("state", {
      ...(await stateOf(store)),
      date: "2029-08-01",
    });
    await progressDealMilestones(store, await deal());
    expect((await deal()).stage).toBe("Completed");
    expect((await playerOf(store, player.id)).age).toBe(18);
    expect((await playerOf(store, player.id)).club_id).toBe(buyer.id);
    expect((await playerOf(store, player.id)).wage).toBe((await deal()).wage);
    expect((await clubOf(store)).balance).toBeCloseTo(balance - reserved, 2);
    expect((await clubOf(store)).transfer_budget).toBeCloseTo(budget, 2);
    expect((await clubOf(store, player.club_id!)).balance).toBeCloseTo(
      sellerBalance + (await deal()).offer,
      2,
    );
    expect(JSON.parse((await deal()).data).reservedBudget).toBe(0);
    const after = (await clubOf(store)).balance;
    await expect(completeNegotiation(store, await deal())).rejects.toThrow();
    expect((await clubOf(store)).balance).toBe(after);
  });

  it("waits for the next window and releases the fee if the player became a free agent", async () => {
    const deal = await futureDeal("2011-10-15", "2028-06-30");
    const quotedFee = (await deal()).offer;
    expect(JSON.parse((await deal()).data).futureArrivalDate).toBe(
      "2030-01-01",
    );
    await store.setMeta("state", {
      ...(await stateOf(store)),
      date: "2029-10-15",
    });
    await store.run(
      "UPDATE players SET club_id = NULL,wage = 0,role = 'Free agent' WHERE id = ?",
      player.id,
    );
    await progressDealMilestones(store, await deal());
    expect((await deal()).stage).toBe("Scheduled");
    const budget = (await clubOf(store)).transfer_budget;
    const sellerBalance = (await clubOf(store, player.club_id!)).balance;
    await store.setMeta("state", {
      ...(await stateOf(store)),
      date: "2029-12-30",
    });
    await progressDealMilestones(store, await deal());
    await store.setMeta("state", {
      ...(await stateOf(store)),
      date: "2030-01-01",
      season: 2029,
    });
    await progressDealMilestones(store, await deal());
    expect((await deal()).stage).toBe("Completed");
    expect((await deal()).offer).toBe(0);
    expect((await deal()).selling_club_id).toBeNull();
    expect((await clubOf(store)).transfer_budget).toBeCloseTo(
      budget + quotedFee,
      2,
    );
    expect((await clubOf(store, player.club_id!)).balance).toBe(sellerBalance);
    expect((await playerOf(store, player.id)).club_id).toBe(buyer.id);
  });

  it("returns the reservation after a failed medical and holds it across budget renewal", async () => {
    const deal = await futureDeal();
    const reserved = JSON.parse((await deal()).data).reservedBudget;
    await store.setMeta("state", {
      ...(await stateOf(store)),
      date: "2027-07-01",
    });
    const tierOf = async () =>
      (await store.get<{ tier: number }>("SELECT leagues.tier FROM clubs JOIN leagues ON leagues.id = clubs.league_id WHERE clubs.id = ?", (await stateOf(store)).clubId))?.tier ?? 0;
    const tierBefore = await tierOf();
    await seasonRollover(store);
    const tierAfter = await tierOf();
    const own = await clubOf(store);
    expect(own.transfer_budget).toBe(
      seasonBudgets({
        balance: own.balance,
        reserved,
        owedInstalments: await owedInstalments(store, own.id),
        wageReference: 0,
        movement: tierAfter < tierBefore ? "promoted" : tierAfter > tierBefore ? "relegated" : "none",
      }).transferBudget,
    );
    const budget = (await clubOf(store)).transfer_budget;
    const balance = (await clubOf(store)).balance;
    await store.run(
      "UPDATE players SET injury_until = '2029-10-01' WHERE id = ?",
      player.id,
    );
    await store.setMeta("state", {
      ...(await stateOf(store)),
      date: "2029-07-30",
    });
    await progressDealMilestones(store, await deal());
    expect((await deal()).stage).toBe("Rejected");
    expect((await clubOf(store)).transfer_budget).toBeCloseTo(
      budget + reserved,
      2,
    );
    expect((await clubOf(store)).balance).toBe(balance);
    expect((await playerOf(store, player.id)).club_id).toBe(player.club_id);
    await closeNegotiation(store, await deal(), "Rejected", "Repeated failure");
    expect((await clubOf(store)).transfer_budget).toBeCloseTo(
      budget + reserved,
      2,
    );
  });

  it("reserves a future agreement for a 15-year-old without moving or paying the player early", async () => {
    await store.run(
      "UPDATE players SET age = 15,birth_date = '2011-08-01',contract_end = '2030-06-30' WHERE id = ?",
      player.id,
    );
    player = await playerOf(store, player.id);
    await expect(
      enquire(store, player.id, "Permanent transfer"),
    ).rejects.toThrow("under-18");
    await expect(enquire(store, player.id, "Future transfer")).rejects.toThrow(
      "Guardian consent",
    );
    const deal = await enquire(
      store,
      player.id,
      "Future transfer",
      true,
    );
    await negotiationStep(store, deal.id, "formalize");
    const offer = {
      fee: deal.asking_price,
      wage: deal.wage * 2,
      years: 3,
      role: "Prospect",
      promises: [],
    };
    await negotiate(store, deal.id, offer);
    await negotiate(store, deal.id, offer);
    expect((await negotiationStep(store, deal.id, "sign")).stage).toBe(
      "Scheduled",
    );
    const saved = (await store.get<Negotiation>(
      "SELECT * FROM negotiations WHERE id = ?",
      deal.id,
    ))!;
    const details = JSON.parse(saved.data);
    expect(details.futureArrivalDate).toBe("2029-08-01");
    expect(details.reservedBudget).toBeGreaterThan(deal.asking_price);
    expect((await clubOf(store)).transfer_budget).toBeCloseTo(
      buyer.transfer_budget - details.reservedBudget,
      2,
    );
    expect((await clubOf(store)).balance).toBe(buyer.balance);
    expect((await playerOf(store, player.id)).club_id).toBe(player.club_id);
    expect((await playerOf(store, player.id)).wage).toBe(player.wage);
    await expect(negotiationStep(store, deal.id, "sign")).rejects.toThrow();
    await closeNegotiation(
      store,
      saved,
      "Withdrawn",
      "Cancelled future test agreement.",
    );
    expect((await clubOf(store)).transfer_budget).toBeCloseTo(
      buyer.transfer_budget,
      2,
    );
    await closeNegotiation(store, saved, "Withdrawn", "Repeated cancellation.");
    expect((await clubOf(store)).transfer_budget).toBeCloseTo(
      buyer.transfer_budget,
      2,
    );
  });

  it("waits for prior approval and pays youth compensation once without a club transfer fee", async () => {
    const assessment = await assessYouthTransfer(store, player, buyer);
    expect(assessment.route).toBe("eu-eea");
    expect(assessment.approved).toBe(false);
    expect(assessment.canApproachWithoutFee).toBe(true);
    expect(
      (
        await submitMinorApplication(store, player.id, {
          ...safeguards,
          education: false,
        })
      ).error,
    ).toContain("required");
    expect(await store.all("SELECT * FROM minor_applications")).toHaveLength(0);
    expect(
      (await submitMinorApplication(store, player.id, safeguards)).error,
    ).toBeUndefined();
    expect(
      (await submitMinorApplication(store, player.id, safeguards)).error,
    ).toContain("already");
    const enquiry = await enquire(store, player.id, "Youth approach");
    expect(enquiry.asking_price).toBe(0);
    await negotiationStep(store, enquiry.id, "formalize");
    const deal = async () =>
      (await store.get<Negotiation>(
        "SELECT * FROM negotiations WHERE id = ?",
        enquiry.id,
      ))!;
    expect((await deal()).stage).toBe("Agent talks");
    const offer = {
      fee: 0,
      wage: enquiry.wage * 2,
      years: 3,
      role: "Prospect",
      promises: [],
    };
    await expect(
      negotiate(store, enquiry.id, { ...offer, fee: 1 }),
    ).rejects.toThrow("no transfer fee");
    await expect(
      negotiate(store, enquiry.id, { ...offer, years: 4 }),
    ).rejects.toThrow("three years");
    await negotiate(store, enquiry.id, offer);
    await negotiationStep(store, enquiry.id, "sign");
    const sellerBalance = (await clubOf(store, player.club_id!)).balance;
    await store.setMeta("state", {
      ...(await stateOf(store)),
      date: "2026-07-03",
    });
    await progressDealMilestones(store, await deal());
    await store.setMeta("state", {
      ...(await stateOf(store)),
      date: "2026-07-04",
    });
    await progressDealMilestones(store, await deal());
    expect((await deal()).stage).toBe("Registration");
    expect((await playerOf(store, player.id)).club_id).toBe(player.club_id);
    expect((await clubOf(store)).balance).toBe(buyer.balance);
    await store.setMeta("state", {
      ...(await stateOf(store)),
      date: "2026-07-08",
    });
    await store.run("UPDATE clubs SET academy = 99 WHERE id = ?", buyer.id);
    await processMinorApplications(store);
    expect((await assessYouthTransfer(store, player, buyer)).approved).toBe(
      true,
    );
    await completeNegotiation(store, await deal());
    expect((await deal()).stage).toBe("Completed");
    expect((await playerOf(store, player.id)).club_id).toBe(buyer.id);
    expect(
      JSON.parse((await playerOf(store, player.id)).profile).contract.status,
    ).toBe("professional");
    expect((await clubOf(store, player.club_id!)).balance).toBe(
      sellerBalance + assessment.trainingCompensation,
    );
    expect(
      (await store.get<{ cost: number }>(
        "SELECT cost FROM player_assets WHERE player_id = ? AND club_id = ?",
        player.id,
        buyer.id,
      ))!.cost,
    ).toBe(assessment.trainingCompensation);
    expect(
      await store.all(
        "SELECT * FROM ledger WHERE club_id = ? AND category = 'Training compensation'",
        buyer.id,
      ),
    ).toHaveLength(1);
    await expect(completeNegotiation(store, await deal())).rejects.toThrow();
  });

  it("does not waive legacy/professional contracts or invent parental evidence", async () => {
    const profile = JSON.parse(player.profile) as PlayerProfile;
    delete profile.contract;
    await store.run(
      "UPDATE players SET profile = ? WHERE id = ?",
      JSON.stringify(profile),
      player.id,
    );
    await expect(enquire(store, player.id, "Youth approach")).rejects.toThrow(
      "recorded amateur",
    );
    const english = (await store.get<Club>(
      "SELECT clubs.* FROM clubs JOIN countries ON countries.id = clubs.country_id WHERE countries.code = 'EN' AND clubs.type = 'club' ORDER BY clubs.id LIMIT 1",
    ))!;
    await store.run(
      "UPDATE players SET club_id = ? WHERE id = ?",
      english.id,
      player.id,
    );
    profile.familyMove = {
      countryId: buyer.country_id,
      reason: "football",
      verified: true,
      date: "2026-06-01",
    };
    await store.run(
      "UPDATE players SET profile = ? WHERE id = ?",
      JSON.stringify(profile),
      player.id,
    );
    expect(
      (
        await assessYouthTransfer(
          store,
          await playerOf(store, player.id),
          buyer,
        )
      ).eligibleToApply,
    ).toBe(false);
    profile.familyMove.reason = "employment";
    profile.familyMove.verified = false;
    await store.run(
      "UPDATE players SET profile = ? WHERE id = ?",
      JSON.stringify(profile),
      player.id,
    );
    expect(
      (
        await assessYouthTransfer(
          store,
          await playerOf(store, player.id),
          buyer,
        )
      ).eligibleToApply,
    ).toBe(false);
    profile.familyMove.verified = true;
    await store.run(
      "UPDATE players SET profile = ? WHERE id = ?",
      JSON.stringify(profile),
      player.id,
    );
    expect(
      (
        await assessYouthTransfer(
          store,
          await playerOf(store, player.id),
          buyer,
        )
      ).route,
    ).toBe("parent-relocation");
    expect(
      (
        await assessYouthTransfer(
          store,
          await playerOf(store, player.id),
          buyer,
        )
      ).approved,
    ).toBe(false);
  });
});
