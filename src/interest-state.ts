import { INTEREST_BANDS } from "../shared/rules.ts";
import type { PlayerInterest } from "../shared/types.ts";

export type InterestStateKind = "refuses" | "talking" | "agrees";

export interface InterestState {
  kind: InterestStateKind;
  tone: "red" | "amber" | "green";
  label: string;
  negotiate: number;
  agree: number;
}

/** Negotiation bands of an assessment; older saves carry no thresholds, so the rule defaults apply. */
export function interestState(interest: PlayerInterest): InterestState {
  const negotiate = interest.thresholds?.negotiate ?? INTEREST_BANDS.refuse;
  const agree = interest.thresholds?.agree ?? INTEREST_BANDS.agree;
  const moveScore = interest.moveScore ?? interest.score;
  if (interest.refuses === true || moveScore < negotiate)
    return {
      kind: "refuses",
      tone: "red",
      label: `Won't negotiate (below ${negotiate})`,
      negotiate,
      agree,
    };
  if (interest.score >= agree)
    return {
      kind: "agrees",
      tone: "green",
      label: `Will sign (${agree}+)`,
      negotiate,
      agree,
    };
  return {
    kind: "talking",
    tone: "amber",
    label: `Talking — needs ${agree} to sign`,
    negotiate,
    agree,
  };
}
