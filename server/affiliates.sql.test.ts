import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { Store } from "./db.ts";
import { generateWorld } from "./world.ts";
import {
  affiliateLoanEndDate,
  placeFutureTransferAtAffiliate,
  setOnwardLoanPlan,
  startOnwardLoan,
} from "./affiliates.ts";
import {
  clubOf,
  completeNegotiation,
  defaultLoanTerms,
  playerOf,
  stateOf,
} from "./systems.ts";
import type { Negotiation, NegotiationData, PlayerProfile } from "../shared/types.ts";

describe("affiliate transfer persistence", () => {
  let store: Store;
  beforeAll(async () => {
    store = await Store.createTest("affiliates");
  });
  beforeEach(async () => {
    await store.transaction(async () => {
      await store.clearWorld();
      await store.schema();
      await generateWorld(store, { nations: ["EN", "ES"] });
      await store.setMeta("state", { ...(await stateOf(store)), date: "2026-07-01" });
      await store.run("UPDATE clubs SET transfer_budget = 100000000, wage_budget = 10000000, balance = 200000000");
    });
  });
  afterAll(async () => await store?.close());

  async function partnerAffiliate() {
    const buyer = await clubOf(store, 1);
    await store.run(
      "UPDATE clubs SET country_id = ?, type = 'club', parent_id = NULL WHERE id IN (2, 3)",
      buyer.country_id,
    );
    await store.run(
      "UPDATE players SET country_id = ? WHERE club_id IN (2, 3)",
      buyer.country_id,
    );
    await store.run(
      "UPDATE players SET club_id = NULL, squad_club_id = NULL WHERE club_id = 3 AND id NOT IN (SELECT id FROM players WHERE club_id = 3 ORDER BY id LIMIT 20)",
    );
    await store.run(
      "INSERT INTO partnerships(club_id, partner_id, type, strength, data) VALUES (1, 3, 'Affiliate', 80, '{}')",
    );
    return { buyer, seller: await clubOf(store, 2), affiliate: await clubOf(store, 3) };
  }

  it("settles a scheduled future fee and registers the minor at the affiliate", async () => {
    const { seller, affiliate } = await partnerAffiliate();
    const player = (await store.get<{ id: number; profile: string }>(
      "SELECT id,profile FROM players WHERE club_id = ? ORDER BY id LIMIT 1",
      seller.id,
    ))!;
    const profile = JSON.parse(player.profile) as PlayerProfile;
    profile.identity.birthCountryId = seller.country_id;
    const fee = 250000;
    const data: NegotiationData = {
      futureArrivalDate: "2027-08-01",
      medicalDate: "2027-07-30",
      reservedBudget: fee + 50000,
      guardianConsent: true,
      log: [],
      agent: profile.agent,
      terms: defaultLoanTerms(await playerOf(store, player.id), await clubOf(store, 1)),
      years: 3,
      role: "Prospect",
      promises: [],
    };
    await store.run(
      "UPDATE players SET birth_date = '2009-08-01', age = 16, country_id = ?, wage = 1000, contract_end = '2028-06-30', profile = ? WHERE id = ?",
      seller.country_id,
      JSON.stringify(profile),
      player.id,
    );
    const id = Number((await store.run(
      "INSERT INTO negotiations(player_id,buying_club_id,selling_club_id,type,stage,asking_price,offer,wage,interest,created,deadline,data) VALUES (?,1,?,'Future transfer','Scheduled',?,?,5000,80,'2026-07-01','2026-07-08',?)",
      player.id,
      seller.id,
      fee,
      fee,
      JSON.stringify(data),
    )).lastInsertRowid);

    await placeFutureTransferAtAffiliate(store, id, affiliate.id);

    const moved = await playerOf(store, player.id);
    const deal = (await store.get<Negotiation>("SELECT * FROM negotiations WHERE id = ?", id))!;
    const updated = JSON.parse(deal.data) as NegotiationData;
    expect(moved.club_id).toBe(affiliate.id);
    expect(deal.selling_club_id).toBe(affiliate.id);
    expect(deal.offer).toBe(0);
    expect(updated.reservedBudget).toBe(50000);
    expect(updated.affiliatePlacement?.originalSellerId).toBe(seller.id);
    expect(await store.get("SELECT id FROM history WHERE entity_type = 'transfer' AND data::jsonb ->> 'type' = 'Transfer to affiliate'"))
      .toBeTruthy();
  });

  it("rejects affiliate placement for scheduled pre-contract agreements", async () => {
    const { seller, affiliate } = await partnerAffiliate();
    const player = (await store.get<{ id: number; profile: string }>(
      "SELECT id,profile FROM players WHERE club_id = ? ORDER BY id LIMIT 1",
      seller.id,
    ))!;
    const profile = JSON.parse(player.profile) as PlayerProfile;
    const data: NegotiationData = {
      futureArrivalDate: "2027-07-01",
      medicalDate: "2027-06-29",
      reservedBudget: 50000,
      guardianConsent: true,
      log: [],
      agent: profile.agent,
      terms: defaultLoanTerms(await playerOf(store, player.id), await clubOf(store, 1)),
      years: 3,
      role: "Prospect",
      promises: [],
    };
    await store.run(
      "UPDATE players SET birth_date = '2009-07-01', age = 17, profile = ? WHERE id = ?",
      JSON.stringify(profile),
      player.id,
    );
    const id = Number((await store.run(
      "INSERT INTO negotiations(player_id,buying_club_id,selling_club_id,type,stage,asking_price,offer,wage,interest,created,deadline,data) VALUES (?,1,?,'Pre-contract agreement','Scheduled',0,0,5000,80,'2026-07-01','2026-07-08',?)",
      player.id,
      seller.id,
      JSON.stringify(data),
    )).lastInsertRowid);

    await expect(placeFutureTransferAtAffiliate(store, id, affiliate.id))
      .rejects.toThrow("future transfer agreements");
  });

  it("keeps original-seller clauses and buyer asset cost after affiliate placement completes", async () => {
    const { buyer, seller, affiliate } = await partnerAffiliate();
    const player = (await store.get<{ id: number; profile: string }>(
      "SELECT id,profile FROM players WHERE club_id = ? ORDER BY id LIMIT 1",
      seller.id,
    ))!;
    const profile = JSON.parse(player.profile) as PlayerProfile;
    profile.identity.birthCountryId = seller.country_id;
    const fee = 300000;
    const data: NegotiationData = {
      futureArrivalDate: "2027-07-01",
      medicalDate: "2027-06-29",
      reservedBudget: fee + 100000,
      guardianConsent: true,
      log: [],
      agent: profile.agent,
      terms: defaultLoanTerms(await playerOf(store, player.id), buyer),
      years: 4,
      role: "Prospect",
      promises: [],
      transferTerms: {
        upfrontPercent: 50,
        installments: 2,
        intervalMonths: 6,
        buyBackFee: 900000,
        buyBackYears: 2,
        sellOnPercent: 15,
        loanBack: "none",
      },
    };
    await store.run(
      "UPDATE players SET birth_date = '2009-07-01', age = 16, country_id = ?, wage = 1000, contract_end = '2028-06-30', profile = ? WHERE id = ?",
      seller.country_id,
      JSON.stringify(profile),
      player.id,
    );
    const id = Number((await store.run(
      "INSERT INTO negotiations(player_id,buying_club_id,selling_club_id,type,stage,asking_price,offer,wage,interest,created,deadline,data) VALUES (?,1,?,'Future transfer','Scheduled',?,?,5000,80,'2026-07-01','2026-07-08',?)",
      player.id,
      seller.id,
      fee,
      fee,
      JSON.stringify(data),
    )).lastInsertRowid);
    await placeFutureTransferAtAffiliate(store, id, affiliate.id);
    expect(
      (await store.get<{ cost: number }>(
        "SELECT cost FROM player_assets WHERE player_id = ? AND club_id = ? AND status = 'active'",
        player.id,
        affiliate.id,
      ))?.cost,
    ).toBe(0);
    await store.setMeta("state", { ...(await stateOf(store)), date: "2027-07-01" });
    const placed = (await store.get<Negotiation>("SELECT * FROM negotiations WHERE id = ?", id))!;
    await store.run("UPDATE negotiations SET stage = 'Medical' WHERE id = ?", id);
    await completeNegotiation(store, { ...placed, stage: "Medical" });

    expect((await playerOf(store, player.id)).club_id).toBe(buyer.id);
    expect(
      await store.get(
        "SELECT id FROM sell_on_clauses WHERE player_id = ? AND beneficiary_id = ? AND owner_id = ? AND percentage = 15",
        player.id,
        seller.id,
        buyer.id,
      ),
    ).toBeTruthy();
    expect(
      await store.get(
        "SELECT id FROM buy_back_clauses WHERE player_id = ? AND beneficiary_id = ? AND owner_id = ? AND fee = 900000",
        player.id,
        seller.id,
        buyer.id,
      ),
    ).toBeTruthy();
    expect(
      (await store.get<{ total: number }>(
        "SELECT count(*) AS total FROM transfer_payments WHERE negotiation_id = ? OR payee_id = ?",
        id,
        affiliate.id,
      ))!.total,
    ).toBe(0);
    expect(
      (await store.get<{ cost: number }>(
        "SELECT cost FROM player_assets WHERE player_id = ? AND club_id = ? AND status = 'active'",
        player.id,
        buyer.id,
      ))!.cost,
    ).toBe(fee);
  });

  it("saves and starts a domestic onward affiliate loan without blocking the signing", async () => {
    const { buyer, seller, affiliate } = await partnerAffiliate();
    await store.run("UPDATE clubs SET country_id = ? WHERE id = 3", buyer.country_id);
    const player = (await store.get<{ id: number; profile: string }>(
      "SELECT id,profile FROM players WHERE club_id = ? AND age >= 18 ORDER BY id LIMIT 1",
      seller.id,
    ))!;
    const profile = JSON.parse(player.profile) as PlayerProfile;
    const data: NegotiationData = {
      log: [],
      agent: profile.agent,
      terms: defaultLoanTerms(await playerOf(store, player.id), buyer),
      years: 4,
      role: "Squad player",
      promises: [],
    };
    const id = Number((await store.run(
      "INSERT INTO negotiations(player_id,buying_club_id,selling_club_id,type,stage,asking_price,offer,wage,interest,created,deadline,data) VALUES (?,1,?,'Permanent transfer','Contract review',100000,100000,5000,80,'2026-07-01','2026-07-08',?)",
      player.id,
      seller.id,
      JSON.stringify(data),
    )).lastInsertRowid);

    await setOnwardLoanPlan(store, id, affiliate.id, "season");
    const deal = (await store.get<Negotiation>("SELECT * FROM negotiations WHERE id = ?", id))!;
    const planned = JSON.parse(deal.data) as NegotiationData;
    expect(planned.onwardLoan?.clubId).toBe(affiliate.id);

    await store.run(
      "UPDATE players SET club_id = ?, parent_club_id = NULL, contract_end = '2029-06-30' WHERE id = ?",
      buyer.id,
      player.id,
    );
    await startOnwardLoan(store, deal, planned);
    const loaned = await playerOf(store, player.id);
    expect(loaned.club_id).toBe(affiliate.id);
    expect(loaned.parent_club_id).toBe(buyer.id);
    expect(await store.get("SELECT id FROM loans WHERE player_id = ? AND type = 'Development loan'", player.id)).toBeTruthy();
    expect(affiliateLoanEndDate("2026-07-01", "season")).toBe("2027-06-30");
  });

  it("keeps the completed signing when the onward affiliate loan fails mid-way in SQL", async () => {
    const { buyer, seller, affiliate } = await partnerAffiliate();
    await store.run("UPDATE clubs SET country_id = ? WHERE id = 3", buyer.country_id);
    const player = (await store.get<{ id: number; profile: string }>(
      "SELECT id,profile FROM players WHERE club_id = ? AND age >= 18 ORDER BY id LIMIT 1",
      seller.id,
    ))!;
    const profile = JSON.parse(player.profile) as PlayerProfile;
    const data: NegotiationData = {
      log: [],
      agent: profile.agent,
      terms: defaultLoanTerms(await playerOf(store, player.id), buyer),
      years: 4,
      role: "Squad player",
      promises: [],
    };
    const id = Number((await store.run(
      "INSERT INTO negotiations(player_id,buying_club_id,selling_club_id,type,stage,asking_price,offer,wage,interest,created,deadline,data) VALUES (?,1,?,'Permanent transfer','Contract review',100000,100000,5000,80,'2026-07-01','2026-07-08',?)",
      player.id,
      seller.id,
      JSON.stringify(data),
    )).lastInsertRowid);
    await setOnwardLoanPlan(store, id, affiliate.id, "season");
    const deal = (await store.get<Negotiation>("SELECT * FROM negotiations WHERE id = ?", id))!;
    const planned = JSON.parse(deal.data) as NegotiationData;
    const run = store.run.bind(store);
    // The loan spell is written, then the history row fails in PostgreSQL, which aborts the statement.
    const failure = vi.spyOn(store, "run").mockImplementation((sql, ...params) =>
      sql.startsWith("INSERT INTO history(season,entity_type,entity_id,date,data)")
        ? run("INSERT INTO history(season,entity_type,entity_id,date,data) VALUES (?,?,?,?,NULL)", ...params.slice(0, 4))
        : run(sql, ...params),
    );
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    let logged = "";
    try {
      await store.transaction(async () => {
        await store.run(
          "UPDATE players SET club_id = ?, parent_club_id = NULL, contract_end = '2029-06-30' WHERE id = ?",
          buyer.id,
          player.id,
        );
        await startOnwardLoan(store, deal, planned);
      });
      logged = errors.mock.calls.map((call) => call.map(String).join(" ")).join("\n");
    } finally {
      failure.mockRestore();
      errors.mockRestore();
    }
    expect(logged).toContain(`the affiliate loan of negotiation ${id} failed`);
    const signed = await playerOf(store, player.id);
    expect(signed.club_id).toBe(buyer.id);
    expect(signed.parent_club_id).toBeNull();
    expect(await store.get("SELECT id FROM loans WHERE player_id = ?", player.id)).toBeUndefined();
    expect(planned.log.at(-1)?.message).toBe("The planned affiliate loan could not start, but the signing was completed.");
    expect(planned.log.filter((entry) => entry.type === "Affiliate loan" && entry.message.includes("joined"))).toHaveLength(0);
    expect(await store.get("SELECT id FROM news WHERE title = ?", `${signed.name}: affiliate loan skipped`)).toBeTruthy();
  });
});
