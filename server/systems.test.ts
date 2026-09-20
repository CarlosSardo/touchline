import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Store } from "./db.ts";
import { generateWorld } from "./world.ts";
import {
  assignScout,
  clubOf,
  completeNegotiation,
  defaultLoanTerms,
  enquire,
  expireLoans,
  finishScouting,
  negotiate,
  playerOf,
  recallLoan,
  reviewLoans,
  squadRole,
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
} from "../shared/types.ts";

describe("director decisions and ownership boundaries", () => {
  let store: Store;
  beforeEach(() => {
    store = new Store(":memory:");
    generateWorld(store, { countryLimit: 2, seniors: 1200, youth: 400 });
    store.run(
      "UPDATE clubs SET transfer_budget = 100000000, wage_budget = 10000000, balance = 200000000",
    );
  });
  afterEach(() => store.close());

  it("requires an employed, available scout and produces a complete report", () => {
    const own = store.get<Staff>(
      "SELECT * FROM staff WHERE club_id = 1 AND role = 'Scout'",
    )!;
    const foreign = store.get<Staff>(
      "SELECT * FROM staff WHERE club_id = 2 AND role = 'Scout'",
    )!;
    const target = store.get<Player>(
      "SELECT * FROM players WHERE club_id = 2 LIMIT 1",
    )!;
    expect(() =>
      assignScout(store, {
        staffId: foreign.id,
        playerId: target.id,
        maxAge: 30,
        budget: 100000000,
      }),
    ).toThrow("employed");
    assignScout(store, {
      staffId: own.id,
      playerId: target.id,
      maxAge: 30,
      budget: 100000000,
    });
    expect(() =>
      assignScout(store, {
        staffId: own.id,
        playerId: target.id,
        maxAge: 30,
        budget: 100000000,
      }),
    ).toThrow("active assignment");
    store.setMeta("state", { ...stateOf(store), date: "2026-07-10" });
    finishScouting(store);
    const report = store.get<{ data: string; accuracy: number }>(
      "SELECT * FROM reports WHERE player_id = ?",
      target.id,
    )!;
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
    expect(playerOf(store, target.id).knowledge).toBe(report.accuracy);
  });

  it("does not spend funds on a rejected offer and rejects another club's squad edits", () => {
    const target = store.get<Player>(
      "SELECT * FROM players WHERE club_id = 2 LIMIT 1",
    )!;
    expect(() => squadRole(store, target.id, "Captain")).toThrow(
      "not contracted",
    );
    const before = clubOf(store).balance;
    const negotiation = enquire(store, target.id, "Permanent transfer");
    negotiate(store, negotiation.id, {
      fee: 0,
      wage: target.wage,
      years: 3,
      role: "Squad player",
      promises: [],
    });
    expect(clubOf(store).balance).toBe(before);
    expect(playerOf(store, target.id).club_id).toBe(2);
    expect(
      store.get<Negotiation>(
        "SELECT * FROM negotiations WHERE id = ?",
        negotiation.id,
      )!.stage,
    ).toBe("Club talks");
  });

  function agreedLoan(recall: boolean, type = "Development loan") {
    const player = store.get<Player>(
      "SELECT * FROM players WHERE club_id = 1 AND age_group = ? LIMIT 1",
      "Senior",
    )!;
    store.run(
      "UPDATE players SET age = 20, ability = 70, potential = 85, contract_end = ? WHERE id = ?",
      "2030-06-30",
      player.id,
    );
    const negotiation = enquire(store, player.id, type, 2);
    const terms = {
      ...defaultLoanTerms(playerOf(store, player.id), clubOf(store, 2)),
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
    negotiate(store, negotiation.id, input);
    negotiate(store, negotiation.id, input);
    store.setMeta("state", { ...stateOf(store), date: "2026-07-03" });
    store.transaction(() =>
      completeNegotiation(
        store,
        store.get<Negotiation>(
          "SELECT * FROM negotiations WHERE id = ?",
          negotiation.id,
        )!,
      ),
    );
    const loan = store.get<Loan>(
      "SELECT * FROM loans WHERE player_id = ?",
      player.id,
    )!;
    return { player, loan, negotiation };
  }

  it("completes a loan through club talks, agent talks and medical checks", () => {
    const { player, loan, negotiation } = agreedLoan(false);
    expect(playerOf(store, player.id).club_id).toBe(2);
    expect(playerOf(store, player.id).parent_club_id).toBe(1);
    expect(JSON.parse(loan.terms).salarySplit).toBe(65);
    expect(
      store.get<Negotiation>(
        "SELECT * FROM negotiations WHERE id = ?",
        negotiation.id,
      )!.stage,
    ).toBe("Completed");
    expect(() => recallLoan(store, loan.id)).toThrow(
      "No standard recall clause",
    );
    expect(() => recallLoan(store, loan.id, true)).toThrow(
      "requires an injury",
    );
    expect(
      store.get<{ count: number }>(
        "SELECT count(*) AS count FROM promises WHERE player_id = ?",
        player.id,
      )!.count,
    ).toBe(1);
  });

  it("honors recall clauses and returns registration to the parent club", () => {
    const { player, loan } = agreedLoan(true);
    recallLoan(store, loan.id);
    expect(playerOf(store, player.id).club_id).toBe(1);
    expect(playerOf(store, player.id).parent_club_id).toBeNull();
    expect(
      store.get<Loan>("SELECT * FROM loans WHERE id = ?", loan.id)!.status,
    ).toBe("recalled");
  });

  it("enforces a purchase obligation at the end of a loan", () => {
    const { player, loan } = agreedLoan(true, "Loan with obligation");
    store.setMeta("state", { ...stateOf(store), date: "2027-07-04" });
    store.run("UPDATE clubs SET transfer_budget = 0 WHERE id = 2");
    reviewLoans(store);
    expect(
      store.get<Loan>("SELECT * FROM loans WHERE id = ?", loan.id)!.status,
    ).toBe("purchased");
    expect(playerOf(store, player.id).parent_club_id).toBeNull();
    expect(playerOf(store, player.id).club_id).toBe(2);
    expect(clubOf(store, 2).transfer_budget).toBeLessThan(0);
  });

  it("does not allow public or duplicate completion to spend transfer funds twice", () => {
    const { negotiation } = agreedLoan(true);
    const completed = store.get<Negotiation>(
      "SELECT * FROM negotiations WHERE id = ?",
      negotiation.id,
    )!;
    expect(() =>
      negotiate(store, completed.id, {
        fee: 0,
        wage: 100,
        years: 3,
        role: "Squad player",
        promises: [],
      }),
    ).toThrow("not awaiting");
    const details = JSON.parse(completed.data) as NegotiationData;
    expect(details.log.map((entry) => entry.type)).toEqual(
      expect.arrayContaining(["Enquiry", "Agent talks", "Medical"]),
    );
    expect(() => completeNegotiation(store, completed)).toThrow(
      "registration has changed",
    );
  });

  it("pays and retires a loan sell-on clause when the parent later sells the player", () => {
    const { player, loan } = agreedLoan(true, "Loan with sell-on");
    const before = clubOf(store, 2).balance;
    store.setMeta("state", { ...stateOf(store), date: "2027-07-05" });
    expireLoans(store);
    expect(playerOf(store, player.id).club_id).toBe(1);
    expect(
      store.get<Loan>("SELECT * FROM loans WHERE id = ?", loan.id)!.status,
    ).toBe("completed");
    const net = transferProceeds(
      store,
      player.id,
      1,
      10_000_000,
      "Test future sale",
    );
    expect(net).toBe(8_500_000);
    expect(clubOf(store, 2).balance - before).toBe(1_500_000);
    expect(
      transferProceeds(store, player.id, 1, 10_000_000, "Second sale"),
    ).toBe(10_000_000);
  });

  it("calculates wage commitments using the negotiated salary split", () => {
    const beforeParent = weeklyWages(store, 1);
    const beforeBorrower = weeklyWages(store, 2);
    const { player } = agreedLoan(true);
    expect(weeklyWages(store, 1)).toBeCloseTo(
      beforeParent - player.wage * 0.65,
    );
    expect(weeklyWages(store, 2)).toBeCloseTo(
      beforeBorrower + player.wage * 0.65,
    );
  });

  it("keeps cumulative loan minutes when season statistics reset", () => {
    const { player, loan } = agreedLoan(true, "Two-year loan");
    store.run(
      "INSERT INTO history(season, entity_type, entity_id, date, data) VALUES (2026,'appearance',?,?,?)",
      player.id,
      "2027-05-10",
      JSON.stringify({ minutes: 90, position: player.position, clubId: 2 }),
    );
    store.run("UPDATE players SET minutes = 0 WHERE id = ?", player.id);
    store.setMeta("state", { ...stateOf(store), date: "2027-07-08" });
    reviewLoans(store);
    expect(
      JSON.parse(
        store.get<Loan>("SELECT * FROM loans WHERE id = ?", loan.id)!.data,
      ).minutes,
    ).toBe(90);
  });
});
