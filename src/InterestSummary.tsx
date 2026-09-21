import { useCurrency } from "./game-context.tsx";
import { Badge, DetailList } from "./ui.tsx";
import type { PlayerInterest } from "../shared/types.ts";

export default function InterestSummary({
  assessment,
}: {
  assessment: PlayerInterest;
}) {
  const { money } = useCurrency();
  return (
    <details className="interest-assessment">
      <summary>
        <Badge
          tone={
            assessment.score >= 60
              ? "green"
              : assessment.score >= 35
                ? "amber"
                : "red"
          }
        >
          {assessment.score}%
        </Badge>
        <span>{assessment.stance}</span>
        <small>Player interest</small>
      </summary>
      <div>
        <DetailList
          items={[
            ["Expected weekly wage", money(assessment.expectedWage)],
            ["Expected squad role", assessment.expectedRole],
          ]}
        />
        <div className="interest-factors">
          {assessment.factors.map((factor) => (
            <div className="interest-factor" key={factor.id}>
              <div>
                <strong>{factor.label}</strong>
                <p>{factor.reason}</p>
              </div>
              <span
                className={
                  factor.impact > 0
                    ? "positive"
                    : factor.impact < 0
                      ? "negative"
                      : "muted"
                }
              >
                {factor.impact > 0 ? "+" : ""}
                {factor.impact}
              </span>
            </div>
          ))}
        </div>
      </div>
    </details>
  );
}
