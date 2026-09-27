import { describe, expect, it } from "vitest";
import {
  AFFILIATE_BRIDGE_DAYS,
  AFFILIATE_MIN_STRENGTH,
  AFFILIATE_SQUAD_CAP,
  affiliateLoanEndDate,
  assessAffiliatePlacements,
  assessOnwardLoanAffiliates,
  bridgeProtectedArrival,
  nextOpenTransferDate,
  type AffiliateCandidate,
} from "./affiliates.ts";

const candidate = (overrides: Partial<AffiliateCandidate> = {}): AffiliateCandidate => ({
  clubId: 10,
  clubName: "Partner FC",
  type: "club",
  associationId: 1,
  partnershipStrength: 70,
  squadCount: 20,
  minorPresenceLegal: true,
  ...overrides,
});

describe("affiliate transfer rules", () => {
  it("pushes onward registration past the 16-week bridge-transfer presumption and into a window", () => {
    expect(AFFILIATE_BRIDGE_DAYS).toBe(112);
    expect(bridgeProtectedArrival("2026-09-05", "2026-08-01")).toBe("2027-01-01");
    expect(bridgeProtectedArrival("2027-01-20", "2026-08-01")).toBe("2027-01-20");
    expect(nextOpenTransferDate("2026-10-10")).toBe("2027-01-01");
  });

  it("requires genuine domestic partner-club placement for minors", () => {
    const [eligible, weak, foreign, full] = assessAffiliatePlacements(
      [
        candidate(),
        candidate({ clubId: 11, clubName: "Weak Link", partnershipStrength: AFFILIATE_MIN_STRENGTH - 1 }),
        candidate({ clubId: 12, clubName: "Foreign Partner", associationId: 2 }),
        candidate({ clubId: 13, clubName: "Full Squad", squadCount: AFFILIATE_SQUAD_CAP }),
      ],
      {
        date: "2026-07-01",
        playerAge: 17,
        sellingClubId: 2,
        sellingAssociationId: 1,
        futureArrivalDate: "2026-09-01",
        alreadyPlaced: false,
      },
    );
    expect(eligible.eligible).toBe(true);
    expect(eligible.adjustedArrival).toBe("2027-01-01");
    expect(weak.eligible).toBe(false);
    expect(weak.reasons.join(" ")).toContain("strength");
    expect(foreign.reasons.join(" ")).toContain("same association");
    expect(full.reasons.join(" ")).toContain("full");
  });

  it("blocks placement outside a window or where minor presence is unlawful", () => {
    const [option] = assessAffiliatePlacements([candidate({ minorPresenceLegal: false })], {
      date: "2026-10-01",
      playerAge: 16,
      sellingClubId: 2,
      sellingAssociationId: 1,
      futureArrivalDate: "2027-01-01",
      alreadyPlaced: false,
    });
    expect(option.eligible).toBe(false);
    expect(option.reasons.join(" ")).toContain("open transfer window");
    expect(option.reasons.join(" ")).toContain("legally present");
  });

  it("allows only domestic affiliate loans that finish before the new contract and are not loan-backs", () => {
    expect(affiliateLoanEndDate("2026-04-01", "season")).toBe("2027-06-30");
    expect(affiliateLoanEndDate("2026-07-10", "season")).toBe("2027-06-30");
    expect(affiliateLoanEndDate("2026-07-10", "year")).toBe("2027-07-10");
    const [eligible, foreign, loanBack, long] = assessOnwardLoanAffiliates(
      [candidate(), candidate({ clubId: 11, associationId: 2 }), candidate({ clubId: 12 }), candidate({ clubId: 13 })],
      {
        buyerAssociationId: 1,
        contractEnd: "2028-06-30",
        loanEnd: "2027-06-30",
        hasLoanBack: false,
      },
    );
    expect(eligible.eligible).toBe(true);
    expect(foreign.eligible).toBe(false);
    expect(foreign.reasons.join(" ")).toContain("domestic");
    expect(
      assessOnwardLoanAffiliates([candidate()], {
        buyerAssociationId: 1,
        contractEnd: "2028-06-30",
        loanEnd: "2027-06-30",
        hasLoanBack: true,
      })[0].reasons.join(" "),
    ).toContain("loan-back");
    expect(
      assessOnwardLoanAffiliates([candidate()], {
        buyerAssociationId: 1,
        contractEnd: "2027-06-30",
        loanEnd: "2027-06-30",
        hasLoanBack: false,
      })[0].reasons.join(" "),
    ).toContain("before the player's new contract");
    expect(loanBack.clubId).toBe(12);
    expect(long.clubId).toBe(13);
  });
});
