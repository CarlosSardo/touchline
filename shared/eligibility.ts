// Four separate layers decide whether a player can play:
//   1. contract (signing): only real transfer rules (window, funds, FIFA Art. 19, loan rules, contract validity);
//   2. association registration per player and club spell (work authorisation such as the FA GBE is an input);
//   3. competition registration per player, competition and season (foreign quotas, squad lists);
//   4. match eligibility per fixture (registration + suspension + injury; friendlies need only a contract).
import type { GbeAssessment } from "./gbe/types.ts";

export type { GbeAssessment };

export type RegistrationStatus = "registered" | "pending" | "not_registered" | "refused" | "not_required";

export type EligibilityLabel =
  | "eligible"
  | "not_registered"
  | "pending"
  | "ineligible_gbe"
  | "eligible_after_requirements"
  | "loaned_out"
  | "unavailable";

export interface CompetitionEligibility {
  leagueId: number;
  name: string;
  status: RegistrationStatus;
  reasons: string[];
  nextReview?: string;
}

export interface PlayerEligibility {
  playerId: number;
  clubId: number | null;
  contracted: boolean;
  association: { status: RegistrationStatus; reasons: string[]; nextReview?: string; gbe?: GbeAssessment; basis?: string };
  competitions: CompetitionEligibility[];
  label: EligibilityLabel;
  /** Badge text, e.g. "Signed · eligible" or "Ineligible · insufficient GBE (9/15)". */
  text: string;
  /** Contracted but registered for no competition: friendlies and training only. */
  friendliesOnly: boolean;
  /** Next competitive fixture of the player's side and whether he could be picked for it today. */
  nextFixture?: { fixtureId: number; date: string; competition: string; eligible: boolean; reasons: string[] };
}

/** Compact per-player summary for squad and database lists. */
export interface EligibilitySummary {
  label: EligibilityLabel;
  text: string;
  reason?: string;
}

/** Stored association status codes that keep a player out of competitive matches. */
export const BLOCKING_STATUSES: readonly RegistrationStatus[] = ["pending", "not_registered", "refused"];

export const blocking = (status: RegistrationStatus) => BLOCKING_STATUSES.includes(status);

export interface LabelInput {
  contracted: boolean;
  onLoanFromParent: boolean;
  association: { status: RegistrationStatus; gbeFailed?: boolean; points?: number; passMark?: number };
  /** `primary` marks the club's domestic league, which decides the headline. */
  competitions: { status: RegistrationStatus; nextReview?: string; primary?: boolean }[];
}

const shortDate = (date: string) =>
  new Date(`${date}T12:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });

/** One label and badge text from the layered statuses (pure; shared by the API and the UI). */
export function eligibilityLabel(input: LabelInput): { label: EligibilityLabel; text: string } {
  if (!input.contracted) return { label: "unavailable", text: "Not under contract" };
  const { association } = input;
  if (association.status === "refused" && association.gbeFailed)
    return {
      label: "ineligible_gbe",
      text: `Ineligible · insufficient GBE (${association.points ?? 0}/${association.passMark ?? 15})`,
    };
  if (association.status === "refused" || association.status === "not_registered")
    return { label: "not_registered", text: "Signed · not registered" };
  if (association.status === "pending") return { label: "pending", text: "Registration pending" };
  const blocked = input.competitions.filter((entry) => blocking(entry.status));
  const primary = blocked.find((entry) => entry.primary);
  if (primary || (blocked.length && blocked.length === input.competitions.length)) {
    const waiting = primary ?? blocked[0];
    if (waiting.status === "pending" && waiting.nextReview)
      return { label: "eligible_after_requirements", text: `Eligible after requirements (${shortDate(waiting.nextReview)})` };
    return { label: "not_registered", text: "Signed · not registered" };
  }
  if (input.onLoanFromParent) return { label: "loaned_out", text: "On loan · eligible" };
  if (blocked.length) return { label: "eligible", text: "Signed · eligible (some competitions)" };
  return { label: "eligible", text: "Signed · eligible" };
}

export const eligibilityTone = (label: EligibilityLabel): "green" | "amber" | "red" | "blue" | "neutral" =>
  label === "eligible" || label === "loaned_out"
    ? "green"
    : label === "ineligible_gbe"
      ? "red"
      : label === "pending" || label === "eligible_after_requirements"
        ? "blue"
        : label === "not_registered"
          ? "amber"
          : "neutral";
