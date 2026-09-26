import { useCurrency } from "./game-context.tsx";
import { Badge, DetailList } from "./ui.tsx";
import { interestState } from "./interest-state.ts";
import type { PlayerInterest } from "../shared/types.ts";

export default function InterestSummary({
  assessment,
}: {
  assessment: PlayerInterest;
}) {
  const { money, text } = useCurrency();
  const state = interestState(assessment);
  const moveScore = assessment.moveScore ?? assessment.score;
  return (
    <details className="interest-assessment">
      <summary>
        <Badge tone={state.tone}>{assessment.score}%</Badge>
        <span>
          {state.label}
          {state.kind === "talking" && assessment.wageToAgree
            ? ` · about ${money(assessment.wageToAgree)}/wk`
            : ""}
        </span>
        <small>Player interest</small>
      </summary>
      <div>
        {state.kind === "refuses" && (
          <p className="negotiation-latest is-rejected" role="status">
            Will refuse to negotiate: move interest {moveScore}% is below{" "}
            {state.negotiate}, whatever the wage offered.
          </p>
        )}
        {state.kind === "talking" && (
          <p className="negotiation-latest" role="status">
            Open to talks, but will only sign at {state.agree}% interest (now{" "}
            {assessment.score}%).
            {assessment.wageToAgree
              ? ` A weekly wage of about ${money(assessment.wageToAgree)} should get him there.`
              : assessment.wageToAgree === null
                ? " No wage within the cap is enough on its own."
                : ""}
          </p>
        )}
        {state.kind === "agrees" && (
          <p className="negotiation-latest" role="status">
            Will sign terms that meet his wage expectations.
          </p>
        )}
        <DetailList
          items={[
            ["Stance", assessment.stance],
            ["Expected weekly wage", money(assessment.expectedWage)],
            ["Expected squad role", assessment.expectedRole],
          ]}
        />
        <div className="interest-factors">
          {assessment.factors.map((factor) => (
            <div className="interest-factor" key={factor.id}>
              <div>
                <strong>{factor.label}</strong>
                <p>{text(factor.reason)}</p>
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
