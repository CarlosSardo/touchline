import { Badge } from "./ui.tsx";
import { eligibilityTone, type EligibilitySummary } from "../shared/eligibility.ts";

/** Contract vs registration badge ("Signed · eligible", "Ineligible · insufficient GBE (9/15)"…). */
export function EligibilityBadge({
  eligibility,
  hideEligible = false,
}: {
  eligibility?: Pick<EligibilitySummary, "label" | "text" | "reason"> | null;
  /** Lists of many players show only the exceptions. */
  hideEligible?: boolean;
}) {
  if (!eligibility || (hideEligible && eligibility.label === "eligible")) return null;
  return (
    <span className="eligibility-badge" title={eligibility.reason ?? eligibility.text}>
      <Badge tone={eligibilityTone(eligibility.label)}>{eligibility.text}</Badge>
    </span>
  );
}
