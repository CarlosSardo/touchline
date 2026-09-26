import { useState } from "react";
import { ArrowUpDown, Check, GraduationCap, Undo2, UserPlus, X } from "lucide-react";
import {
  CALL_UP_RULES,
  type CallUpDesk,
  type CallUpPlayerView,
  type CallUpProposalView,
  type CallUpView,
} from "../shared/features/callups.ts";
import type { PlayerDetail } from "../shared/api.ts";
import { useGame, useResource } from "./game-context.tsx";
import { Badge, Button, Empty, ErrorState, Field, Loading, Modal, PlayerLink, Toggle } from "./ui.tsx";
import {
  CALL_UPS_PATH,
  DIRECTION_MARKS,
  DURATION_OPTIONS,
  MAX_CALL_UP_DAYS,
  REASON_LABELS,
  buildDuration,
  callUpsByTeam,
  debutText,
  defaultDurationForm,
  developmentStatusText,
  moveTargets,
  shortDate,
  shortTeamLabel,
  teamKey,
  untilText,
  type DurationKind,
} from "./callups.ts";
import { addDays } from "../shared/rules.ts";
import "./CallUps.css";

function PlayerCell({ entry }: { entry: { player: CallUpPlayerView } }) {
  return (
    <div className="callup-player">
      <strong>
        <PlayerLink id={entry.player.id} name={entry.player.name} />
      </strong>
      <small>
        {entry.player.position} · {entry.player.age} yrs · {entry.player.ability}/{entry.player.potential}
      </small>
    </div>
  );
}

function Route({ entry }: { entry: CallUpView | CallUpProposalView }) {
  return (
    <span className="callup-route">
      {shortTeamLabel(entry.fromLabel)} <span aria-label="to">→</span> {shortTeamLabel(entry.toLabel)}
    </span>
  );
}

/** Squad view tab: active call-ups by team, coach proposals, debut budget and the automatic toggle. */
export function CallUpsPanel() {
  const { bootstrap, act, changeSettings } = useGame();
  const { data, error, loading } = useResource<CallUpDesk>(CALL_UPS_PATH, { keepPreviousData: true });
  const [pending, setPending] = useState<string | null>(null);
  if (error) return <ErrorState message={error} />;
  if (!data || !bootstrap) return <Loading label="Opening call-ups" />;
  const today = bootstrap.state.date;
  const setting = bootstrap.settings.autoCallUps;
  const automatic = typeof setting === "boolean" ? setting : data.autoCallUps;
  const run = (key: string, body: Record<string, unknown>) => {
    setPending(key);
    void act(body).finally(() => setPending(null));
  };
  const busy = loading || pending !== null;
  const requests = data.requests ?? [];
  const byTeam = callUpsByTeam(data);
  const emptyTeams = byTeam.filter(({ callUps }) => !callUps.length);
  return (
    <div className="callups" aria-busy={loading || undefined}>
      <div className="callup-toolbar">
        <div className="callup-budgets" aria-label="Debut budget">
          {data.debutBudgets.map((budget) => (
            <Badge key={budget.clubId} tone={budget.used >= budget.limit ? "amber" : "green"}>
              {debutText(budget, data.debutBudgets.length > 1)}
            </Badge>
          ))}
        </div>
        <label className="callup-auto">
          <Toggle
            checked={automatic}
            label="Automatic coach call-ups"
            onChange={(value) => void changeSettings({ autoCallUps: value })}
          />
          <span>
            <strong>Coach call-ups</strong>
            <small>{automatic ? "The coach calls players up on match day." : "The coach proposes; you decide."}</small>
          </span>
        </label>
      </div>
      {(data.proposals.length > 0 || !automatic) && (
        <section className="callup-section" aria-label="Coach proposals">
          <h4>
            Coach proposals <span className="muted">{data.proposals.length}</span>
          </h4>
          {data.proposals.length ? (
            <ul className="callup-list">
              {data.proposals.map((proposal) => (
                <li key={proposal.id} className="callup-item">
                  <PlayerCell entry={proposal} />
                  <div className="callup-meta">
                    <Route entry={proposal} />
                    <small>
                      {untilText(proposal, today)} · expires {shortDate(proposal.expires)}
                    </small>
                    <p className="callup-note">“{proposal.note}”</p>
                  </div>
                  <div className="callup-badges">
                    <Badge tone="blue">{REASON_LABELS[proposal.reason]}</Badge>
                    {proposal.debut && <Badge tone="violet">Possible debut</Badge>}
                    {proposal.development && <Badge tone="green">Development</Badge>}
                  </div>
                  <div className="callup-actions">
                    <Button
                      icon={Check}
                      disabled={busy}
                      onClick={() => run(proposal.id, { type: "call-up-proposal", id: proposal.id, accept: true })}
                    >
                      Accept
                    </Button>
                    <Button
                      icon={X}
                      variant="secondary"
                      disabled={busy}
                      onClick={() => run(proposal.id, { type: "call-up-proposal", id: proposal.id, accept: false })}
                    >
                      Decline
                    </Button>
                  </div>
                </li>
              ))}
            </ul>
          ) : (
            <p className="muted callup-empty">No proposals. The coach suggests call-ups up to two days before a match.</p>
          )}
        </section>
      )}
      <section className="callup-section" aria-label="Development requests">
        <h4>
          Development requests{" "}
          <span className="muted">
            {requests.length} / {CALL_UP_RULES.development.maxRequests}
          </span>
        </h4>
        {requests.length ? (
          <ul className="callup-list">
            {requests.map((request) => (
              <li key={request.playerId} className="callup-item">
                <PlayerCell entry={request} />
                <div className="callup-meta">
                  <span className="callup-route">{shortTeamLabel(request.fromLabel)}</span>
                  <small>{developmentStatusText(request)}</small>
                </div>
                <div className="callup-badges">
                  <Badge tone={request.status ? "amber" : "neutral"}>
                    {request.status ? "Coach replied" : "Waiting"}
                  </Badge>
                </div>
                <div className="callup-actions">
                  <Button
                    icon={X}
                    variant="secondary"
                    disabled={busy}
                    onClick={() =>
                      run(`dev:${request.playerId}`, {
                        type: "call-up-development",
                        playerId: request.playerId,
                        active: false,
                      })
                    }
                  >
                    Withdraw
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        ) : (
          <p className="muted callup-empty">
            <GraduationCap size={13} aria-hidden="true" /> Ask the coaches to give a youth or reserve player chances
            higher up from his dossier (up to {CALL_UP_RULES.development.maxRequests} at once).
          </p>
        )}
      </section>
      {byTeam
        .filter(({ callUps }) => callUps.length)
        .map(({ team, callUps }) => (
        <section className="callup-section" key={teamKey(team)} aria-label={team.label}>
          <h4>
            {team.label} <span className="muted">{callUps.length}</span>
          </h4>
          <ul className="callup-list">
              {callUps.map((entry) => (
                <li key={entry.playerId} className="callup-item">
                  <PlayerCell entry={entry} />
                  <div className="callup-meta">
                    <Route entry={entry} />
                    <small>
                      {untilText(entry, today)} · since {shortDate(entry.since)}
                    </small>
                  </div>
                  <div className="callup-badges">
                    <Badge tone="blue">{REASON_LABELS[entry.reason]}</Badge>
                    <Badge>{entry.by === "coach" ? "Coach" : "You"}</Badge>
                    {entry.debut && <Badge tone="violet">Possible debut</Badge>}
                    {entry.development && <Badge tone="green">Development</Badge>}
                  </div>
                  <div className="callup-actions">
                    <Button
                      icon={Undo2}
                      variant="secondary"
                      disabled={busy}
                      onClick={() => run(`end:${entry.playerId}`, { type: "call-up-end", playerId: entry.playerId })}
                    >
                      Send back now
                    </Button>
                  </div>
                </li>
              ))}
          </ul>
        </section>
      ))}
      {emptyTeams.length > 0 && (
        <p className="muted callup-empty">
          No call-ups: {emptyTeams.map(({ team }) => shortTeamLabel(team.label)).join(", ")}.
        </p>
      )}
      {!data.teams.length && <Empty icon={UserPlus} title="No other teams in the club" />}
    </div>
  );
}

/** Move a player of the user's club family to another of its teams, for a match, a spell or permanently. */
export function CallUpDialog({ playerId, playerName, onClose }: { playerId: number; playerName: string; onClose: () => void }) {
  const { bootstrap, act } = useGame();
  const today = bootstrap?.state.date ?? "";
  const { data: detail, error: detailError } = useResource<PlayerDetail>(`players/${playerId}`);
  const { data: desk, error: deskError } = useResource<CallUpDesk>(CALL_UPS_PATH, { keepPreviousData: true });
  const [target, setTarget] = useState("");
  const [kind, setKind] = useState<DurationKind>("match");
  const [form, setForm] = useState(() => defaultDurationForm(today));
  const [problem, setProblem] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const error = detailError ?? deskError;
  const active = desk?.active.find((entry) => entry.playerId === playerId) ?? null;
  const targets = detail && desk ? moveTargets(detail.squadDestinations, desk.teams, active) : [];
  const eligible = targets.filter((entry) => entry.eligible);
  const chosen = eligible.find((entry) => teamKey(entry) === target) ?? eligible[0];
  const goingBack = chosen?.direction === "back";
  const current = detail?.squadDestinations.find((entry) => entry.current);
  async function submit(body: Record<string, unknown>) {
    setPending(true);
    const result = await act(body);
    setPending(false);
    if (result) onClose();
  }
  function confirm() {
    if (!chosen) return;
    if (goingBack) {
      void submit({ type: "call-up-end", playerId });
      return;
    }
    const built = buildDuration(kind, form, today);
    if ("error" in built) {
      setProblem(built.error);
      return;
    }
    setProblem(null);
    void submit({ type: "call-up", playerId, clubId: chosen.clubId, ageGroup: chosen.ageGroup, duration: built.duration });
  }
  return (
    <Modal title={`Move ${playerName}`} onClose={onClose}>
      <div className="sheet-body callup-dialog">
        {error ? (
          <ErrorState message={error} />
        ) : !detail || !desk ? (
          <Loading label="Checking squads" />
        ) : !detail.canManage ? (
          <p className="muted">Only players of your club's teams can be moved.</p>
        ) : (
          <>
            <p className="callup-current">
              Plays for <strong>{current ? shortTeamLabel(current.label) : "no squad"}</strong>
              {active && (
                <>
                  {" "}
                  on a call-up from <strong>{shortTeamLabel(active.fromLabel)}</strong> · {untilText(active, today)}
                </>
              )}
            </p>
            {eligible.length ? (
              <div className="form-grid">
                <Field label="Move to" className="span-2">
                  <select
                    aria-label="Target team"
                    value={chosen ? teamKey(chosen) : ""}
                    onChange={(event) => setTarget(event.target.value)}
                  >
                    {eligible.map((entry) => (
                      <option key={teamKey(entry)} value={teamKey(entry)}>
                        {DIRECTION_MARKS[entry.direction]} {entry.label}
                        {entry.direction === "back" ? " (end call-up)" : ""}
                      </option>
                    ))}
                  </select>
                </Field>
              </div>
            ) : (
              <p className="muted">No other team can take him right now.</p>
            )}
            {chosen && !goingBack && (
              <fieldset className="segmented-control callup-duration">
                <legend>Duration</legend>
                <div>
                  {DURATION_OPTIONS.map(([id, text]) => (
                    <label key={id}>
                      <input
                        type="radio"
                        name={`callup-duration-${playerId}`}
                        value={id}
                        checked={kind === id}
                        onChange={() => {
                          setKind(id);
                          setProblem(null);
                        }}
                      />
                      <span>{text}</span>
                    </label>
                  ))}
                </div>
              </fieldset>
            )}
            {chosen && !goingBack && kind === "days" && (
              <Field label="Days">
                <input
                  type="number"
                  aria-label="Call-up days"
                  min={1}
                  max={MAX_CALL_UP_DAYS}
                  value={Number.isNaN(form.days) ? "" : form.days}
                  onChange={(event) => setForm({ ...form, days: event.target.valueAsNumber })}
                />
              </Field>
            )}
            {chosen && !goingBack && kind === "until" && (
              <Field label="Last day">
                <input
                  type="date"
                  aria-label="Call-up end date"
                  min={today ? addDays(today, 1) : undefined}
                  max={today ? addDays(today, MAX_CALL_UP_DAYS) : undefined}
                  value={form.date}
                  onChange={(event) => setForm({ ...form, date: event.target.value })}
                />
              </Field>
            )}
            {chosen && !goingBack && (
              <p className="muted callup-hint">
                {kind === "permanent"
                  ? "A permanent squad move; he stays until you move him again."
                  : "He keeps his contract and wage and returns automatically. Every call-up ends at the end of the season."}
              </p>
            )}
            {problem && (
              <p className="callup-problem" role="alert">
                {problem}
              </p>
            )}
            {targets.some((entry) => !entry.eligible) && (
              <ul className="squad-move-notes" aria-label="Unavailable teams">
                {targets
                  .filter((entry) => !entry.eligible)
                  .map((entry) => (
                    <li key={teamKey(entry)}>
                      <strong>{entry.label}</strong> {entry.reason ?? "Unavailable."}
                    </li>
                  ))}
              </ul>
            )}
          </>
        )}
      </div>
      <footer className="sheet-footer">
        <Button variant="secondary" onClick={onClose}>
          Cancel
        </Button>
        {active && !goingBack && (
          <Button icon={Undo2} variant="secondary" disabled={pending} onClick={() => void submit({ type: "call-up-end", playerId })}>
            Send back now
          </Button>
        )}
        <Button icon={ArrowUpDown} disabled={pending || !chosen || !detail?.canManage} onClick={confirm}>
          {goingBack
            ? "Send back"
            : chosen?.direction === "down"
              ? "Move down"
              : chosen?.direction === "up"
                ? "Move up"
                : "Move"}
        </Button>
      </footer>
    </Modal>
  );
}
