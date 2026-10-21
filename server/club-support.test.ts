import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { Store } from "./db.ts";
import { generateWorld } from "./world.ts";
import {
  affiliateDesk,
  affiliateInterest,
  assistantDesk,
  clubAffiliates,
  configureAssistant,
  processAffiliateRequests,
  processAssistant,
  processStaffCareers,
  requestAffiliate,
  STARTER_AFFILIATE_MAX_TIER,
} from "./club-support.ts";
import { processSquadNotices } from "./notifications.ts";
import { addDays, DEFAULT_ASSISTANT_DUTIES } from "../shared/rules.ts";
import {
  createUnexpectedEvent,
  processUnexpectedEvents,
  resolveUnexpectedEvent,
  unexpectedEvents,
} from "./events.ts";
import { createPartnership, staffAction, stateOf } from "./systems.ts";
import type { Negotiation, Player } from "../shared/types.ts";

describe("sporting director assistant", () => {
  let store: Store;
  beforeAll(async () => {
    store = await Store.createTest("club-support");
  });
  beforeEach(async () =>
    store.transaction(async () => {
      await store.clearWorld();
      await store.schema();
      await generateWorld(store, { nations: ["EN", "ES"] });
      await store.run(
        "UPDATE clubs SET balance = 100000000, transfer_budget = 100000000, wage_budget = 10000000 WHERE id = 1",
      );
    }),
  );
  afterAll(async () => await store?.close());

  it("gives every first team an assistant, starter affiliates only to professional-level clubs, and B-teams neither", async () => {
    const count = async (sql: string) => (await store.get<{ total: number }>(sql))!.total;
    const tier = "coalesce((SELECT tier FROM leagues WHERE leagues.id = clubs.league_id),9)";
    expect(
      await count(
        `SELECT count(*) AS total FROM clubs WHERE type = 'club' AND ${tier} <= ${STARTER_AFFILIATE_MAX_TIER} AND NOT EXISTS (SELECT 1 FROM partnerships WHERE partnerships.club_id = clubs.id OR partnerships.partner_id = clubs.id)`,
      ),
    ).toBe(0);
    expect(
      await count(
        `SELECT count(*) AS total FROM partnerships JOIN clubs ON clubs.id = partnerships.club_id WHERE partnerships.data::jsonb ->> 'origin' = 'initial' AND ${tier} > ${STARTER_AFFILIATE_MAX_TIER} AND clubs.reputation < 55`,
      ),
    ).toBe(0);
    expect(
      await count(
        `SELECT count(*) AS total FROM clubs WHERE type = 'club' AND ${tier} > ${STARTER_AFFILIATE_MAX_TIER} AND NOT EXISTS (SELECT 1 FROM partnerships WHERE partnerships.club_id = clubs.id OR partnerships.partner_id = clubs.id)`,
      ),
    ).toBeGreaterThan(0);
    expect(
      await count(
        "SELECT count(*) AS total FROM partnerships JOIN clubs ON clubs.id = partnerships.club_id OR clubs.id = partnerships.partner_id WHERE clubs.type != 'club'",
      ),
    ).toBe(0);
    expect(
      await count(
        "SELECT count(*) AS total FROM clubs WHERE type = 'club' AND NOT EXISTS (SELECT 1 FROM staff WHERE staff.club_id = clubs.id AND staff.role = 'Sporting director assistant')",
      ),
    ).toBe(0);
    expect(
      await count(
        "SELECT count(*) AS total FROM staff JOIN clubs ON clubs.id = staff.club_id WHERE clubs.type = 'bteam' AND staff.role = 'Sporting director assistant'",
      ),
    ).toBe(0);
    expect(
      await count(
        "SELECT count(*) AS total FROM partnerships WHERE data::jsonb ->> 'origin' = 'initial' AND (data::jsonb ->> 'annualFee' != '0' OR data::jsonb ->> 'since' IS NULL)",
      ),
    ).toBe(0);
  });

  it("ages, bounds and renews staff, and replaces AI staff who leave", async () => {
    const state = await stateOf(store);
    await store.transaction(() => processStaffCareers(store));
    const rows = await store.all<{ id: number; club_id: number | null; role: string; ability: number; morale: number; data: string }>(
      "SELECT id,club_id,role,ability,morale,data FROM staff ORDER BY id",
    );
    const data = rows.map((row) => ({ ...row, ...(JSON.parse(row.data) as { birthYear?: number; ceiling?: number; contractEnd?: string }) }));
    expect(data.every((row) => typeof row.birthYear === "number" && row.ceiling! >= Math.min(row.ability, 95) - 1)).toBe(true);
    expect(new Set(data.filter((row) => row.club_id !== null).map((row) => row.contractEnd)).size).toBeGreaterThanOrEqual(3);
    const aiClub = data.find((row) => row.club_id !== null && row.club_id !== state.clubId)!;
    await store.run("UPDATE staff SET data = jsonb_set(data::jsonb,'{contractEnd}',to_jsonb('2026-06-30'::text))::text WHERE club_id = ?", aiClub.club_id);
    const own = data.find((row) => row.club_id === state.clubId)!;
    await store.run("UPDATE staff SET data = (data::jsonb || jsonb_build_object('contractEnd','2026-06-30','birthYear',1980))::text WHERE id = ?", own.id);
    await store.setMeta("state", { ...state, date: "2026-07-02" });
    await store.transaction(() => processStaffCareers(store));
    const after = await store.all<{ role: string; data: string }>("SELECT role,data FROM staff WHERE club_id = ?", aiClub.club_id);
    const roles = data.filter((row) => row.club_id === aiClub.club_id).map((row) => row.role).sort();
    expect(after.map((row) => row.role).sort()).toEqual(roles);
    expect(after.every((row) => (JSON.parse(row.data) as { contractEnd: string }).contractEnd > "2026-07-02")).toBe(true);
    const renewed = (await store.get<{ club_id: number; data: string }>("SELECT club_id,data FROM staff WHERE id = ?", own.id))!;
    expect(renewed.club_id).toBe(state.clubId);
    expect((JSON.parse(renewed.data) as { contractEnd: string }).contractEnd).toBe(`${state.season + 2}-06-30`);
  });

  it("announces spring retirements and expiring contracts across the club family", async () => {
    const state = await stateOf(store);
    const veteran = (await store.get<Player>(
      "SELECT * FROM players WHERE club_id = ? AND parent_club_id IS NULL AND age_group = 'Senior' ORDER BY id LIMIT 1",
      state.clubId,
    ))!;
    await store.run("UPDATE players SET birth_date = '1984-01-01', contract_end = ? WHERE id = ?", `${state.season + 1}-06-30`, veteran.id);
    const youth = (await store.get<Player>(
      "SELECT * FROM players WHERE club_id = ? AND age_group = 'U19' ORDER BY id LIMIT 1",
      state.clubId,
    ))!;
    await store.run(
      "UPDATE players SET contract_end = ?, profile = jsonb_set(profile::jsonb,'{contract,status}',to_jsonb('professional'::text))::text WHERE id = ?",
      `${state.season + 1}-06-30`,
      youth.id,
    );
    await store.setMeta("state", { ...state, date: `${state.season + 1}-05-01` });
    await store.transaction(() => processSquadNotices(store));
    const notice = await store.meta<{ season: number; playerIds: number[] }>("retirementNotice");
    expect(notice.season).toBe(state.season);
    expect(notice.playerIds).toContain(veteran.id);
    const items = await store.all<{ title: string; body: string }>("SELECT title,body FROM news WHERE category = 'Squad' ORDER BY id");
    expect(items.some((item) => /retire at the end of the season/.test(item.title) && item.body.includes(veteran.name))).toBe(true);
    expect(items.some((item) => /end on 30 June/.test(item.title) && item.body.includes(youth.name))).toBe(true);
    const before = items.length;
    await store.transaction(() => processSquadNotices(store));
    expect((await store.all("SELECT id FROM news WHERE category = 'Squad'")).length).toBe(before);
  });

  it("keeps undelegated decisions with the director", async () => {
    const players = await store.all(
      "SELECT id,training,shortlisted,wage,contract_end FROM players ORDER BY id",
    );
    const before = (await store.get<{ balance: number }>(
      "SELECT balance FROM clubs WHERE id = 1",
    ))!.balance;
    expect((await processAssistant(store)).performed).toBe(true);
    expect(
      await store.all(
        "SELECT id,training,shortlisted,wage,contract_end FROM players ORDER BY id",
      ),
    ).toEqual(players);
    expect(
      (await store.get<{ balance: number }>(
        "SELECT balance FROM clubs WHERE id = 1",
      ))!.balance,
    ).toBe(before);
    expect(
      (await assistantDesk(store)).reports[0].actions.map(
        (action) => action.duty,
      ),
    ).toEqual(["briefings"]);
    expect((await processAssistant(store, true)).performed).toBe(false);
  });

  it("allows an assistant replacement but never two employed assistants", async () => {
    const original = (await assistantDesk(store)).assistant!;
    const candidate = (await store.get<{ id: number }>(
      "SELECT id FROM staff WHERE club_id IS NULL ORDER BY id LIMIT 1",
    ))!;
    await store.run(
      "UPDATE staff SET role = 'Sporting director assistant' WHERE id = ?",
      candidate.id,
    );
    await expect(staffAction(store, candidate.id, "hire")).rejects.toThrow(
      "already employs",
    );
    await staffAction(store, original.id, "release");
    expect((await processAssistant(store, true)).performed).toBe(false);
    await staffAction(store, candidate.id, "hire");
    expect((await assistantDesk(store)).assistant!.id).toBe(candidate.id);
    expect(
      await store.all(
        "SELECT id FROM staff WHERE club_id = 1 AND role = 'Sporting director assistant'",
      ),
    ).toHaveLength(1);
  });

  it("delegates scouting and training without exceeding the rolling weekly allowance", async () => {
    const foreign = await store.all(
      "SELECT id,training FROM players WHERE club_id = 2 ORDER BY id",
    );
    await configureAssistant(store, {
      duties: {
        ...DEFAULT_ASSISTANT_DUTIES,
        shortlist: true,
        scouting: true,
        training: true,
      },
      weeklyBudget: 2500,
    });
    const result = await processAssistant(store, true);
    expect(result.spending).toBe(2500);
    expect(
      await store.all("SELECT id FROM assignments WHERE status = 'active'"),
    ).toHaveLength(1);
    expect(
      await store.all(
        "SELECT id,training FROM players WHERE club_id = 2 ORDER BY id",
      ),
    ).toEqual(foreign);
    expect(
      (await store.get<{ count: number }>(
        "SELECT count(*) AS count FROM players WHERE shortlisted = 1",
      ))!.count,
    ).toBeGreaterThan(0);
    await store.setMeta("state", {
      ...(await stateOf(store)),
      date: "2026-07-02",
    });
    await configureAssistant(store, {
      duties: { ...DEFAULT_ASSISTANT_DUTIES, scouting: true },
      weeklyBudget: 2500,
    });
    expect((await processAssistant(store, true)).spending).toBe(0);
    expect((await assistantDesk(store)).spentLastWeek).toBe(2500);
    await expect(
      configureAssistant(store, {
        duties: DEFAULT_ASSISTANT_DUTIES,
        weeklyBudget: -1,
      }),
    ).rejects.toThrow();
  });

  it("prepares a renewal draft but does not sign it or change the player's contract", async () => {
    const player = (await store.get<Player>(
      "SELECT * FROM players WHERE club_id = 1 AND age >= 18 AND age_group = 'Senior' ORDER BY id LIMIT 1",
    ))!;
    await store.run(
      "UPDATE players SET contract_end = '2027-06-01' WHERE id = ?",
      player.id,
    );
    await configureAssistant(store, {
      duties: { ...DEFAULT_ASSISTANT_DUTIES, contracts: true },
      weeklyBudget: 0,
    });
    await processAssistant(store, true);
    const draft = (await store.get<Negotiation>(
      "SELECT * FROM negotiations WHERE player_id = ?",
      player.id,
    ))!;
    expect(draft.stage).toBe("Contract review");
    expect(JSON.parse(draft.data).preparedBy.name).toBe(
      (await assistantDesk(store)).assistant!.name,
    );
    expect(
      (await store.get<Player>(
        "SELECT * FROM players WHERE id = ?",
        player.id,
      ))!.contract_end,
    ).toBe("2027-06-01");
    expect(
      (await store.get<Player>(
        "SELECT * FROM players WHERE id = ?",
        player.id,
      ))!.wage,
    ).toBe(player.wage);
  });

  it("returns scalar affiliate IDs and detects existing agreements from both clubs", async () => {
    const agreement = (await store.get<{
      id: number;
      club_id: number;
      partner_id: number;
      data: string;
    }>(
      "SELECT id,club_id,partner_id,data FROM partnerships ORDER BY id LIMIT 1",
    ))!;
    for (const clubId of [agreement.club_id, agreement.partner_id]) {
      const partnerId =
        clubId === agreement.club_id ? agreement.partner_id : agreement.club_id;
      const link = (await clubAffiliates(store, clubId)).find(
        (entry) => entry.id === agreement.id,
      );
      expect(link).toMatchObject({
        id: agreement.id,
        club_id: agreement.club_id,
        partner_id: partnerId,
        data: agreement.data,
      });
      expect(
        await affiliateInterest(store, partnerId, "Development club", clubId),
      ).toMatchObject({ willing: false, stance: "Already affiliated" });
    }
  });

  it("reviews affiliate requests before spending and exposes the agreement to both clubs", async () => {
    const initial = (await affiliateDesk(store)).affiliates;
    const balance = (await store.get<{ balance: number }>(
      "SELECT balance FROM clubs WHERE id = 1",
    ))!.balance;
    await requestAffiliate(store, { purpose: "Development club" });
    const pending = await affiliateDesk(store);
    expect(pending.requests[0]).toMatchObject({
      requested_date: "2026-07-01",
      due_date: "2026-07-04",
      status: "pending",
    });
    expect(pending.nextRequestDate).toBe("2026-07-29");
    await expect(
      requestAffiliate(store, { purpose: "Scouting club" }),
    ).rejects.toThrow("already reviewing");
    await store.setMeta("state", {
      ...(await stateOf(store)),
      date: "2026-07-03",
    });
    await processAffiliateRequests(store);
    expect((await affiliateDesk(store)).requests[0].status).toBe("pending");
    expect(
      (await store.get<{ balance: number }>(
        "SELECT balance FROM clubs WHERE id = 1",
      ))!.balance,
    ).toBe(balance);
    await store.setMeta("state", {
      ...(await stateOf(store)),
      date: "2026-07-04",
    });
    await processAffiliateRequests(store);
    const result = await affiliateDesk(store);
    expect(result.requests[0].status, result.requests[0].reason).toBe(
      "approved",
    );
    expect(result.requests[0].decision_date).toBe("2026-07-04");
    expect(result.affiliates).toHaveLength(initial.length + 1);
    expect(initial.map((link) => link.partner_id)).not.toContain(
      result.requests[0].partner_id,
    );
    expect(
      (await clubAffiliates(store, result.requests[0].partner_id!)).some(
        (link) => link.partner_id === 1,
      ),
    ).toBe(true);
    const paidBalance = (await store.get<{ balance: number }>(
      "SELECT balance FROM clubs WHERE id = 1",
    ))!.balance;
    expect(paidBalance).toBeLessThan(balance);
    await processAffiliateRequests(store);
    expect(
      (await store.get<{ balance: number }>(
        "SELECT balance FROM clubs WHERE id = 1",
      ))!.balance,
    ).toBe(paidBalance);
    await store.setMeta("state", {
      ...(await stateOf(store)),
      date: "2026-07-28",
    });
    await expect(
      requestAffiliate(store, { purpose: "Scouting club" }),
    ).rejects.toThrow("consider another");
    await store.setMeta("state", {
      ...(await stateOf(store)),
      date: "2026-07-29",
    });
    await requestAffiliate(store, { purpose: "Scouting club" });
    expect((await affiliateDesk(store)).requests[0]).toMatchObject({
      requested_date: "2026-07-29",
      due_date: "2026-08-01",
      status: "pending",
    });
  });

  it("declines unsupported board requests without charging the club", async () => {
    await store.run("UPDATE clubs SET board_confidence = 20 WHERE id = 1");
    const before = (await store.get<{ balance: number }>(
      "SELECT balance FROM clubs WHERE id = 1",
    ))!.balance;
    await expect(
      requestAffiliate(store, {
        purpose: "Feeder club",
        partnerId: 1,
      }),
    ).rejects.toThrow("another senior club");
    await requestAffiliate(store, { purpose: "Feeder club" });
    await store.setMeta("state", {
      ...(await stateOf(store)),
      date: "2026-07-04",
    });
    await processAffiliateRequests(store);
    expect((await affiliateDesk(store)).requests[0].status).toBe("rejected");
    expect(
      (await store.get<{ balance: number }>(
        "SELECT balance FROM clubs WHERE id = 1",
      ))!.balance,
    ).toBe(before);
  });

  it("requires the other club's consent for the chosen type even with full board backing", async () => {
    const partner = (await store.get<{ id: number }>(
      "SELECT id FROM clubs WHERE type = 'club' AND id != 1 AND NOT EXISTS (SELECT 1 FROM partnerships WHERE (club_id = 1 AND partner_id = clubs.id) OR (partner_id = 1 AND club_id = clubs.id)) ORDER BY id LIMIT 1",
    ))!;
    await store.run(
      "UPDATE clubs SET reputation = 95 WHERE id = ?",
      partner.id,
    );
    await store.run(
      "UPDATE clubs SET board_confidence = 90,reputation = 50 WHERE id = 1",
    );
    const before = (await store.get<{ balance: number }>(
      "SELECT balance FROM clubs WHERE id = 1",
    ))!.balance;
    expect(
      (await affiliateInterest(store, partner.id, "Feeder club")).willing,
    ).toBe(false);
    await expect(
      createPartnership(store, partner.id, "Feeder club"),
    ).rejects.toThrow("declined");
    await requestAffiliate(store, {
      purpose: "Feeder club",
      partnerId: partner.id,
    });
    await store.setMeta("state", {
      ...(await stateOf(store)),
      date: "2026-07-04",
    });
    await processAffiliateRequests(store);
    const request = (await affiliateDesk(store)).requests[0];
    expect(request.status).toBe("rejected");
    expect(request.reason).toContain("declined");
    expect(
      (await store.get<{ balance: number }>(
        "SELECT balance FROM clubs WHERE id = 1",
      ))!.balance,
    ).toBe(before);
    expect(
      (await clubAffiliates(store, 1)).some(
        (link) => link.partner_id === partner.id,
      ),
    ).toBe(false);
  });

  it("evaluates type-specific benefits and records mutual consent on an accepted agreement", async () => {
    const partner = (await store.get<{ id: number }>(
      "SELECT id FROM clubs WHERE type = 'club' AND country_id != 1 AND NOT EXISTS (SELECT 1 FROM partnerships WHERE (club_id = 1 AND partner_id = clubs.id) OR (partner_id = 1 AND club_id = clubs.id)) ORDER BY id LIMIT 1",
    ))!;
    await store.run(
      "UPDATE clubs SET reputation = 65 WHERE id = ?",
      partner.id,
    );
    const assessment = await affiliateInterest(
      store,
      partner.id,
      "Foreign adaptation club",
    );
    expect(assessment.willing).toBe(true);
    expect(assessment.benefits).toContain("overseas");
    const ownBalance = (await store.get<{ balance: number }>(
      "SELECT balance FROM clubs WHERE id = 1",
    ))!.balance;
    const partnerBalance = (await store.get<{ balance: number }>(
      "SELECT balance FROM clubs WHERE id = ?",
      partner.id,
    ))!.balance;
    await createPartnership(store, partner.id, "Foreign adaptation club");
    const link = (await clubAffiliates(store, 1)).find(
      (entry) => entry.partner_id === partner.id,
    )!;
    expect(JSON.parse(link.data).mutualConsent.type).toBe(
      "Foreign adaptation club",
    );
    expect(
      (await store.get<{ balance: number }>(
        "SELECT balance FROM clubs WHERE id = 1",
      ))!.balance,
    ).toBe(ownBalance - assessment.annualFee);
    expect(
      (await store.get<{ balance: number }>(
        "SELECT balance FROM clubs WHERE id = ?",
        partner.id,
      ))!.balance,
    ).toBe(partnerBalance + assessment.annualFee);
    expect(
      (await affiliateInterest(store, partner.id, "Scouting club")).stance,
    ).toBe("Already affiliated");
  });
});

describe("unexpected club events", () => {
  let store: Store;
  beforeAll(async () => {
    store = await Store.createTest("club-support");
  });
  beforeEach(async () =>
    store.transaction(async () => {
      await store.clearWorld();
      await store.schema();
      await generateWorld(store, { nations: ["EN"] });
    }),
  );
  afterAll(async () => await store?.close());

  it("applies an event response once and only to the affected club", async () => {
    const foreign = await store.all(
      "SELECT id,morale,fitness FROM players WHERE club_id = 2 ORDER BY id",
    );
    const balance = (await store.get<{ balance: number }>(
      "SELECT balance FROM clubs WHERE id = 1",
    ))!.balance;
    const id = await createUnexpectedEvent(store, "training-ground");
    expect(await createUnexpectedEvent(store, "sponsor")).toBe(id);
    const choice = (await unexpectedEvents(store)).pending[0].details
      .options[1];
    await resolveUnexpectedEvent(store, id, choice.id);
    expect(
      (await store.get<{ balance: number }>(
        "SELECT balance FROM clubs WHERE id = 1",
      ))!.balance,
    ).toBe(balance + choice.effects.cash!);
    expect((await unexpectedEvents(store)).pending).toHaveLength(0);
    expect((await unexpectedEvents(store)).history[0].status).toBe("resolved");
    await expect(resolveUnexpectedEvent(store, id, choice.id)).rejects.toThrow(
      "already been resolved",
    );
    expect(
      await store.all(
        "SELECT id,morale,fitness FROM players WHERE club_id = 2 ORDER BY id",
      ),
    ).toEqual(foreign);
  });

  it("uses a free default after the deadline and rejects unaffordable or foreign choices", async () => {
    const id = await createUnexpectedEvent(store, "travel");
    await store.setMeta("state", { ...(await stateOf(store)), clubId: 2 });
    await expect(resolveUnexpectedEvent(store, id, "standard")).rejects.toThrow(
      "does not belong",
    );
    await store.setMeta("state", { ...(await stateOf(store)), clubId: 1 });
    await store.run("UPDATE clubs SET balance = 0 WHERE id = 1");
    await expect(
      resolveUnexpectedEvent(store, id, "replacement"),
    ).rejects.toThrow("cannot afford");
    await store.setMeta("state", {
      ...(await stateOf(store)),
      date: "2026-07-05",
    });
    await processUnexpectedEvents(store);
    const event = (await unexpectedEvents(store)).history.find(
      (entry) => entry.id === id,
    )!;
    expect(event.status).toBe("expired");
    expect(event.choice_id).toBe("standard");
    expect(
      (await store.get<{ balance: number }>(
        "SELECT balance FROM clubs WHERE id = 1",
      ))!.balance,
    ).toBe(0);
  });

  it("produces more events at higher frequencies with cooldowns and stable daily checks", async () => {
    const counts: number[] = [];
    for (const frequency of ["low", "medium", "high"]) {
      await store.run("DELETE FROM unexpected_events");
      await store.run("DELETE FROM meta WHERE key LIKE 'unexpectedCheck:%'");
      await store.setMeta("settings", {
        ...(await store.meta<Record<string, unknown>>("settings")),
        unexpectedEvents: frequency,
      });
      for (let day = 0; day < 180; day++) {
        await store.setMeta("state", {
          ...(await stateOf(store)),
          date: addDays("2026-07-01", day),
        });
        const id = await processUnexpectedEvents(store);
        expect(await processUnexpectedEvents(store)).toBeNull();
        if (id) {
          const event = (await unexpectedEvents(store)).pending[0];
          await resolveUnexpectedEvent(store, id, event.details.defaultChoice);
        }
      }
      counts.push(
        (await store.get<{ total: number }>(
          "SELECT count(*) AS total FROM unexpected_events",
        ))!.total,
      );
    }
    expect(counts[0]).toBeGreaterThan(0);
    expect(counts[1]).toBeGreaterThan(counts[0]);
    expect(counts[2]).toBeGreaterThan(counts[1]);
    expect(counts[2]).toBeLessThanOrEqual(60);
  });
});
