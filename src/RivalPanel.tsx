import { Clock3, ShieldAlert, Users } from "lucide-react";
import { useCurrency } from "./game-context.tsx";
import { Badge, ClubLink } from "./ui.tsx";
import { dateLabel } from "../shared/rules.ts";
import type {
  RivalInterest,
  RivalStatus,
  TransferBattleView,
} from "../shared/types.ts";
import "./RivalPanel.css";

const ACTIVE: RivalStatus[] = ["monitoring", "bid", "fee-agreed"];
const STATUS: Record<RivalStatus, { label: string; tone: string }> = {
  monitoring: { label: "Monitoring", tone: "neutral" },
  bid: { label: "Bid made", tone: "amber" },
  "fee-agreed": { label: "Fee agreed", tone: "red" },
  withdrawn: { label: "Withdrawn", tone: "neutral" },
  won: { label: "Signed the player", tone: "red" },
  lost: { label: "Missed out", tone: "green" },
};
const CERTAINTY: Record<
  RivalInterest["certainty"],
  { label: string; tone: string; detail: string }
> = {
  confirmed: {
    label: "Confirmed",
    tone: "blue",
    detail: "Told to you by the selling club or the agent.",
  },
  reported: {
    label: "Reported",
    tone: "violet",
    detail: "From press reports and your scouts.",
  },
  rumoured: {
    label: "Rumour",
    tone: "neutral",
    detail: "Unconfirmed; the club is not yet known.",
  },
};
const PREFERENCE: Record<RivalInterest["preference"], string> = {
  rival: "Leaning towards them",
  you: "Leaning towards you",
  undecided: "Undecided",
  unknown: "Not known",
};
const BATTLE: Record<
  TransferBattleView["status"],
  { label: string; tone: string }
> = {
  open: { label: "Rivals in the race", tone: "amber" },
  "final-offers": { label: "Best and final offers", tone: "red" },
  decision: { label: "Player decision", tone: "red" },
};

const activeRivals = (rivals: RivalInterest[]) =>
  rivals.filter((rival) => ACTIVE.includes(rival.status));

/** Rival clubs and the bidding war for a purchase, as far as the director knows (never exact rival fees). */
export default function RivalPanel({
  rivals = [],
  battle = null,
  stage,
}: {
  rivals?: RivalInterest[];
  battle?: TransferBattleView | null;
  /** The director's negotiation stage; omitted on the offer page before talks open. */
  stage?: string;
}) {
  const { money, text } = useCurrency();
  const hijacked = stage === "Hijacked";
  if (!rivals.length && !battle && !hijacked) return null;
  const range = (value: { low: number; high: number }) =>
    Math.round(value.low) === Math.round(value.high)
      ? money(value.low)
      : `${money(value.low)} – ${money(value.high)}`;
  const winner = rivals.find((rival) => rival.status === "won");
  const active = activeRivals(rivals).length;
  const clubTalks = stage === "Club talks";
  const personalTerms = stage === "Agent talks" || stage === "Contract review";
  const status = battle?.status ?? "open";
  return (
    <section
      className={`rival-panel${hijacked ? " is-hijacked" : ""}`}
      aria-label="Rival interest"
    >
      <header className="rival-panel-heading">
        <Users size={16} />
        <h3>Rival interest</h3>
        {!hijacked && battle && (
          <Badge tone={BATTLE[status].tone}>{BATTLE[status].label}</Badge>
        )}
        {hijacked && <Badge tone="red">Hijacked</Badge>}
      </header>
      {hijacked && (
        <div className="rival-outcome" role="status">
          <ShieldAlert size={16} />
          <div>
            <strong>
              {winner
                ? `${winner.clubName} signed the player.`
                : "A rival club signed the player."}
            </strong>
            <p>
              {winner?.outcome ? `${text(winner.outcome)} ` : ""}
              Your talks closed because a rival completed the move first. Only a
              signed conditional agreement protects a deal from rivals; until
              then the selling club and the player can choose another package.
            </p>
          </div>
        </div>
      )}
      {!hijacked && battle && (
        <div className="rival-battle" role="status">
          {status === "final-offers" && (
            <>
              <p className="rival-deadline">
                <Clock3 size={14} />
                Best and final offers due{" "}
                <strong>
                  {battle.finalOffersDeadline
                    ? dateLabel(battle.finalOffersDeadline)
                    : "soon"}
                </strong>
              </p>
              {battle.leadingBid && (
                <p>
                  Leading rival bid (selling club's indication):{" "}
                  <strong>{range(battle.leadingBid)}</strong>
                </p>
              )}
              <div className="rival-guidance">
                <strong>Your final offer</strong>
                {battle.yourFinalOffer !== null ? (
                  <p>
                    Lodged at {money(battle.yourFinalOffer)}.
                    {clubTalks
                      ? " You can raise it with Submit club offer until the deadline."
                      : ""}
                  </p>
                ) : (
                  <p>
                    {clubTalks
                      ? "Not lodged yet. Enter your best fee in the club offer below and press Submit club offer before the deadline."
                      : "Not lodged. Final offers are made from the club offer."}
                  </p>
                )}
                <p>
                  Bids within 5% of the best stand when the selling club
                  decides; the player then chooses between those clubs.
                </p>
              </div>
            </>
          )}
          {status === "decision" && (
            <>
              <p className="rival-deadline">
                <Clock3 size={14} />
                The player chooses on{" "}
                <strong>
                  {battle.decisionDeadline
                    ? dateLabel(battle.decisionDeadline)
                    : "soon"}
                </strong>
              </p>
              <div className="rival-guidance">
                <strong>How to keep him</strong>
                <p>
                  {personalTerms
                    ? "Agree personal terms he accepts (85% interest) and stay within 3 points of the best rival package, or sign the conditional agreement first."
                    : "Only clubs with an agreed fee are in the decision."}
                </p>
              </div>
            </>
          )}
          {status === "open" && (
            <p>
              {active
                ? text(battle.message)
                : "No active rival interest right now."}
            </p>
          )}
        </div>
      )}
      {rivals.length > 0 && (
        <ul className="rival-list">
          {rivals.map((rival) => {
            const certainty = CERTAINTY[rival.certainty];
            const state = STATUS[rival.status];
            return (
              <li className="rival-row" key={rival.key}>
                <div className="rival-club">
                  <ClubLink id={rival.clubId} name={rival.clubName} />
                  <small>
                    {[
                      rival.clubId ? rival.countryName : null,
                      rival.reputation !== null
                        ? `Reputation ${rival.reputation}`
                        : null,
                      `Since ${dateLabel(rival.since)}`,
                    ]
                      .filter(Boolean)
                      .join(" · ")}
                  </small>
                </div>
                <div className="rival-badges">
                  <span title={certainty.detail}>
                    <Badge tone={certainty.tone}>{certainty.label}</Badge>
                  </span>
                  <Badge tone={state.tone}>{state.label}</Badge>
                </div>
                <dl className="rival-facts">
                  <div>
                    <dt>Estimated bid</dt>
                    <dd>
                      {rival.feeRange
                        ? range(rival.feeRange)
                        : rival.status === "monitoring"
                          ? "No bid yet"
                          : "Not known"}
                    </dd>
                  </div>
                  <div>
                    <dt>Player preference</dt>
                    <dd>{PREFERENCE[rival.preference]}</dd>
                  </div>
                </dl>
                {rival.outcome && (
                  <p className="rival-row-outcome">{text(rival.outcome)}</p>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
