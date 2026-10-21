import { useResource } from "./game-context.tsx";
import { Badge, ErrorState, Loading } from "./ui.tsx";
import { dateLabel } from "../shared/rules.ts";
import type {
  GbeAssessment,
  GbeCriterionResult,
  GbeOutcome,
} from "../shared/gbe/types.ts";
import "./GbeBreakdown.css";

const OUTCOME: Record<GbeOutcome, { label: string; tone: string }> = {
  auto_pass: { label: "Automatic pass", tone: "green" },
  pass: { label: "Endorsement criteria met", tone: "green" },
  panel: { label: "Exceptions Panel band", tone: "amber" },
  fail: { label: "Below the pass mark", tone: "red" },
  exempt: { label: "No endorsement needed", tone: "blue" },
  no_data: { label: "No data yet", tone: "neutral" },
};

const STATUS: Record<GbeCriterionResult["status"], { label: string; tone: string } | null> = {
  scored: null,
  zero: null,
  no_data: { label: "No data", tone: "neutral" },
  estimate: { label: "Pre-game estimate", tone: "violet" },
};

const QUALITY: Record<GbeAssessment["dataQuality"], string | null> = {
  complete: null,
  estimate: "Includes the pre-game career estimate",
  partial: "Some inputs have no data",
  none: "No data recorded yet",
};

function Criterion({ row }: { row: GbeCriterionResult }) {
  const status = STATUS[row.status];
  return (
    <li className={`gbe-criterion gbe-${row.status}`}>
      <div>
        <strong>{row.label ?? row.criterion}</strong>
        {status && <Badge tone={status.tone}>{status.label}</Badge>}
        <p>{row.detail}</p>
      </div>
      <span className="gbe-points" aria-label={row.autoPass ? "Automatic pass" : `${row.points} points`}>
        {row.autoPass ? "Auto" : row.points}
        {!row.autoPass && row.max !== undefined && <small>/{row.max}</small>}
      </span>
    </li>
  );
}

/**
 * FA Governing Body Endorsement breakdown of a player: outcome, points against the pass mark and every criterion
 * with its explanation and data status. Pass `assessment` when it is already loaded, else `playerId` to fetch it.
 */
export default function GbeBreakdown({
  playerId,
  assessment,
}: { playerId: number; assessment?: GbeAssessment } | { playerId?: number; assessment: GbeAssessment }) {
  const { data, error, loading } = useResource<GbeAssessment>(
    assessment ? null : `players/${playerId}/gbe`,
  );
  const gbe = assessment ?? data;
  if (!gbe) return error ? <ErrorState message={error} /> : loading ? <Loading label="Calculating GBE points" /> : null;
  const outcome = OUTCOME[gbe.outcome];
  const quality = QUALITY[gbe.dataQuality];
  return (
    <section className="gbe-breakdown" aria-label="Governing Body Endorsement">
      <header>
        <Badge tone={outcome.tone}>{gbe.exemptReason ?? outcome.label}</Badge>
        <span className="gbe-total">
          {gbe.points}
          <small>/{gbe.passMark} points</small>
        </span>
        {quality && <small className="muted">{quality}</small>}
      </header>
      <ol className="gbe-criteria">
        {gbe.breakdown.map((row) => (
          <Criterion key={row.criterion} row={row} />
        ))}
      </ol>
      {gbe.notes && gbe.notes.length > 0 && (
        <ul className="gbe-notes">
          {gbe.notes.map((note) => (
            <li key={note}>{note}</li>
          ))}
        </ul>
      )}
      <footer className="muted">
        {gbe.source ? (
          <a href={gbe.source.url} target="_blank" rel="noreferrer">
            {gbe.rulesetTitle ?? gbe.source.title}
          </a>
        ) : (
          gbe.rulesetTitle ?? gbe.ruleset
        )}
        {gbe.rulesetAssumed ? " (latest published, assumed)" : ""} · as of {dateLabel(gbe.asOf)}
      </footer>
    </section>
  );
}
