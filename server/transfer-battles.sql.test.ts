import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { Store } from "./db.ts";
import { assessRegistration } from "./registration.ts";
import { stateOf } from "./systems.ts";
import { processTransferBattles, sellerCanRelease } from "./transfer-battles.ts";
import { generateWorld } from "./world.ts";
import type { Club, Negotiation, NegotiationData, Player, PlayerProfile, RivalBid } from "../shared/types.ts";

// Runs with SQL only (npm run test:local, CI backend job); the pure rules live in transfer-battles.test.ts.
describe.skipIf(process.env.SQL_INTEGRATION_TESTS !== "true")("transfer battles on the daily simulation", () => {
  let store: Store;
  let userClubId: number;
  let player: Player;
  let rivalClub: Club;

  beforeAll(async () => {
    store = await Store.createTest("battles");
  });
  afterAll(async () => await store?.close());

  const setDate = async (date: string) => store.setMeta("state", { ...(await stateOf(store)), date });

  beforeEach(async () =>
    store.transaction(async () => {
      await store.clearWorld();
      await store.schema();
      await generateWorld(store, { nations: ["EN", "ES"] });
      await store.run("UPDATE clubs SET transfer_budget = 100000000, wage_budget = 10000000, balance = 200000000");
      await setDate("2026-08-10");
      userClubId = (await stateOf(store)).clubId;
      const candidates = await store.all<Player>(
        "SELECT players.* FROM players JOIN clubs ON clubs.id = players.club_id WHERE clubs.type = 'club' AND players.club_id != ? AND players.parent_club_id IS NULL AND players.age_group = 'Senior' AND players.role != 'Retired' AND players.position != 'GK' AND players.contract_end > '2027-06-30' ORDER BY players.ability DESC,players.id LIMIT 40",
        userClubId,
      );
      for (const candidate of candidates) {
        if (!(await sellerCanRelease(store, candidate, "2026-08-10"))) continue;
        const buyers = await store.all<Club>(
          "SELECT clubs.* FROM clubs JOIN clubs AS seller ON seller.id = ? WHERE clubs.type = 'club' AND clubs.country_id = seller.country_id AND clubs.id NOT IN (?,?) AND (SELECT count(*) FROM players WHERE players.club_id = clubs.id AND age_group = 'Senior' AND role != 'Retired') < 28 ORDER BY clubs.id LIMIT 10",
          candidate.club_id,
          candidate.club_id,
          userClubId,
        );
        for (const buyer of buyers)
          if ((await assessRegistration(store, candidate, buyer)).allowed) {
            player = candidate;
            rivalClub = buyer;
            return;
          }
      }
      throw new Error("No registrable target and rival found in the test world.");
    }),
  );

  const openTalks = async (stage: string, rivals: RivalBid[], battle: NegotiationData["battle"], score?: number) => {
    const profile = JSON.parse(player.profile) as PlayerProfile;
    const data = {
      workflowVersion: 2,
      log: [],
      agent: profile.agent,
      years: 4,
      role: "Regular starter",
      promises: [],
      rivals,
      battle,
      ...(score === undefined ? {} : { interestDetails: { score, stance: "", expectedRole: "", expectedWage: 0, factors: [], concerns: [] } }),
    };
    const inserted = await store.run(
      "INSERT INTO negotiations(player_id,buying_club_id,selling_club_id,type,stage,asking_price,offer,wage,interest,created,deadline,data) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)",
      player.id,
      userClubId,
      player.club_id,
      "Permanent transfer",
      stage,
      10_000_000,
      stage === "Club talks" ? 0 : 10_000_000,
      player.wage,
      70,
      "2026-08-01",
      "2026-08-30",
      JSON.stringify(data),
    );
    return Number(inserted.lastInsertRowid);
  };
  const talks = async (id: number) => (await store.get<Negotiation>("SELECT * FROM negotiations WHERE id = ?", id))!;
  const agreedRival = (interest: number): RivalBid => ({
    clubId: rivalClub.id,
    since: "2026-08-02",
    status: "fee-agreed",
    fee: 10_000_000,
    wage: Math.round(player.wage * 1.5),
    interest,
    raises: 0,
    nextAction: "2026-08-12",
    source: "market",
    termsOffered: true,
  });

  it("completes the rival's move and closes the director's talks as hijacked when the player chooses the rival", async () => {
    const id = await openTalks("Club talks", [agreedRival(90)], { status: "decision", decisionDeadline: "2026-08-10" });
    await store.transaction(() => processTransferBattles(store));
    const negotiation = await talks(id);
    expect(negotiation.stage).toBe("Hijacked");
    const data = JSON.parse(negotiation.data) as NegotiationData;
    expect(data.rivals![0]).toMatchObject({ status: "won" });
    expect((await store.get<Player>("SELECT * FROM players WHERE id = ?", player.id))!.club_id).toBe(rivalClub.id);
    expect(
      await store.get("SELECT id FROM history WHERE entity_type = 'transfer' AND entity_id = ?", player.id),
    ).toBeTruthy();
  });

  it("keeps the player with the director whose accepted terms are within the preference margin", async () => {
    const id = await openTalks(
      "Contract review",
      [agreedRival(90)],
      { status: "decision", decisionDeadline: "2026-08-10" },
      88,
    );
    await store.transaction(() => processTransferBattles(store));
    const negotiation = await talks(id);
    expect(negotiation.stage).toBe("Contract review");
    expect((JSON.parse(negotiation.data) as NegotiationData).rivals![0]).toMatchObject({ status: "lost" });
    expect((await store.get<Player>("SELECT * FROM players WHERE id = ?", player.id))!.club_id).toBe(player.club_id);
  });

  it("hands a live rival bid to the market once the director's talks have closed", async () => {
    // Regression: the handover query matches the literal '"rivals":[{' JSON fragment with LIKE.
    const id = await openTalks("Withdrawn", [{ ...agreedRival(90), status: "bid", termsOffered: false }], { status: "open" });
    await store.transaction(() => processTransferBattles(store));
    const data = JSON.parse((await talks(id)).data) as NegotiationData;
    expect(data.battle).toMatchObject({ status: "open", handedOver: true });
    expect(data.rivals![0]).toMatchObject({ status: "lost" });
    const bids = (await store.meta<{ playerId: number; clubId: number; source: string }[]>("rivalMarketBids")) ?? [];
    expect(bids).toEqual(
      expect.arrayContaining([expect.objectContaining({ playerId: player.id, clubId: rivalClub.id, source: "handover" })]),
    );
    // Handed over once only.
    await store.transaction(() => processTransferBattles(store));
    expect((await store.meta<{ playerId: number }[]>("rivalMarketBids"))!.filter((bid) => bid.playerId === player.id)).toHaveLength(1);
  });

  it("ends rival pursuits when the window has closed without moving the player", async () => {
    await setDate("2026-09-02");
    const id = await openTalks(
      "Club talks",
      [{ ...agreedRival(90), status: "bid", termsOffered: false, nextAction: "2026-09-02" }],
      { status: "open" },
    );
    await store.run("UPDATE negotiations SET deadline = '2026-09-20' WHERE id = ?", id);
    await store.transaction(() => processTransferBattles(store));
    const data = JSON.parse((await talks(id)).data) as NegotiationData;
    expect(data.rivals![0]).toMatchObject({ status: "withdrawn" });
    expect(data.battle).toMatchObject({ status: "open" });
    expect((await store.get<Player>("SELECT * FROM players WHERE id = ?", player.id))!.club_id).toBe(player.club_id);
  });
});
