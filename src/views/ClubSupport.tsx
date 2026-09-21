import { useDeferredValue, useState } from "react";
import {
  ArrowUpRight,
  Check,
  ClipboardList,
  Clock3,
  Handshake,
  Plus,
  Save,
  Search,
  UserRound,
} from "lucide-react";
import { useCurrency, useGame, useResource } from "../game-context.tsx";
import {
  Badge,
  Button,
  ClubLink,
  DetailList,
  Empty,
  ErrorState,
  Field,
  Loading,
  Modal,
  MoneyInput,
  PlayerLink,
  SectionHeading,
  Toggle,
} from "../ui.tsx";
import {
  ASSISTANT_DUTIES,
  AFFILIATION_BENEFITS,
  dateLabel,
  PARTNERSHIP_TYPES,
} from "../../shared/rules.ts";
import type {
  AffiliateData,
  AssistantData,
  EventEffects,
  UnexpectedEventsData,
  WorldClubPage,
} from "../../shared/api.ts";
import type { AffiliateWillingness } from "../../shared/types.ts";

export function AffiliateInterest({
  partnerId,
  purpose,
}: {
  partnerId: number;
  purpose: string;
}) {
  const { money } = useCurrency();
  const { data, loading, error } = useResource<AffiliateWillingness>(
    `affiliates/${partnerId}/interest?type=${encodeURIComponent(purpose)}`,
  );
  if (error) return <ErrorState message={error} />;
  if (loading || !data) return <Loading label="Assessing affiliate interest" />;
  return (
    <section className="affiliate-interest" aria-label="Other club's interest">
      <Badge tone={data.willing ? "green" : "amber"}>{data.stance}</Badge>
      <DetailList
        items={[
          ["Other club's interest", `${data.score}/100`],
          ["Proposed annual fee", money(data.annualFee)],
        ]}
      />
      <ul>
        {data.reasons.map((reason) => (
          <li key={reason}>{reason}</li>
        ))}
      </ul>
    </section>
  );
}

export function AssistantPanel() {
  const { data, error } = useResource<AssistantData>("assistant");
  if (error) return <ErrorState message={error} />;
  if (!data) return <Loading label="Opening assistant responsibilities" />;
  return (
    <AssistantControls
      key={JSON.stringify([data.assistant?.id, data.duties, data.weeklyBudget])}
      data={data}
    />
  );
}

export function EventsPanel({ compact = false }: { compact?: boolean }) {
  const { bootstrap, act } = useGame();
  const { money } = useCurrency();
  const { data, error } = useResource<UnexpectedEventsData>("events");
  const [pending, setPending] = useState(false);
  if (error) return <ErrorState message={error} />;
  if (!data || !bootstrap)
    return compact ? null : <Loading label="Opening club events" />;
  if (compact && !data.pending.length) return null;
  const effectNames: Record<keyof EventEffects, string> = {
    cash: "Cash",
    morale: "Squad morale",
    fitness: "Fitness",
    fanMood: "Fan mood",
    boardPressure: "Board pressure",
    managerTrust: "Manager trust",
    playerMorale: "Player morale",
  };
  async function respond(id: number, choiceId: string) {
    setPending(true);
    await act({ type: "event-response", id, choiceId });
    setPending(false);
  }
  return (
    <section
      className="club-support-section event-workspace"
      aria-label="Unexpected club events"
    >
      <SectionHeading
        title={compact ? "Decision required" : "Unexpected events"}
      >
        <Badge tone="blue">
          {data.frequency === "low"
            ? "Low"
            : data.frequency === "high"
              ? "High"
              : "Medium"}{" "}
          frequency
        </Badge>
      </SectionHeading>
      {data.pending.map((event) => (
        <article className="event-case" key={event.id}>
          <header>
            <h3>{event.title}</h3>
            <Badge tone="amber">Response due {dateLabel(event.deadline)}</Badge>
          </header>
          <p>{event.body}</p>
          {event.details.playerId && (
            <PlayerLink
              id={event.details.playerId}
              name={event.details.playerName ?? "Player"}
            />
          )}
          <div className="event-options">
            {event.details.options.map((option) => (
              <div className="event-option" key={option.id}>
                <div>
                  <strong>{option.label}</strong>
                  <div className="event-effects">
                    {Object.entries(option.effects).map(([key, value]) => (
                      <span key={key}>
                        {effectNames[key as keyof EventEffects]}{" "}
                        {value > 0 ? "+" : value < 0 ? "-" : ""}
                        {key === "cash"
                          ? money(Math.abs(value))
                          : Math.abs(value)}
                      </span>
                    ))}
                    {option.id === event.details.defaultChoice && (
                      <span>No-response default</span>
                    )}
                  </div>
                </div>
                <Button
                  variant="secondary"
                  icon={Check}
                  disabled={
                    pending ||
                    ((option.effects.cash ?? 0) < 0 &&
                      bootstrap.club.balance < -(option.effects.cash ?? 0))
                  }
                  onClick={() => void respond(event.id, option.id)}
                >
                  {option.label}
                </Button>
              </div>
            ))}
          </div>
        </article>
      ))}
      {!compact && (
        <>
          {!data.pending.length && (
            <div className="support-status">
              <Clock3 size={17} />
              <span>No event requires a response.</span>
            </div>
          )}
          {data.history.length > 0 && (
            <div className="event-history">
              <h3>Recent outcomes</h3>
              {data.history.map((event) => (
                <details className="event-outcome" key={event.id}>
                  <summary>
                    <span>{event.title}</span>
                    <time>{dateLabel(event.resolved_date ?? event.date)}</time>
                  </summary>
                  <Badge tone={event.status === "expired" ? "amber" : "green"}>
                    {event.status === "expired"
                      ? "Default response"
                      : "Resolved"}
                  </Badge>
                  <p>{event.outcome}</p>
                </details>
              ))}
            </div>
          )}
        </>
      )}
    </section>
  );
}

export function AffiliatesPanel() {
  const { bootstrap } = useGame();
  const { money } = useCurrency();
  const { data, error } = useResource<AffiliateData>("affiliates");
  const [requestOpen, setRequestOpen] = useState(false);
  if (error) return <ErrorState message={error} />;
  if (!bootstrap || !data) return <Loading label="Opening affiliate network" />;
  const pending = data.requests.find((request) => request.status === "pending");
  const waiting =
    !!pending ||
    (!!data.nextRequestDate && bootstrap.state.date < data.nextRequestDate);
  return (
    <section className="club-support-section">
      <SectionHeading title="Affiliate clubs">
        <Button
          icon={Plus}
          variant="secondary"
          disabled={waiting}
          onClick={() => setRequestOpen(true)}
        >
          Request affiliate
        </Button>
      </SectionHeading>
      {pending ? (
        <div className="support-status">
          <Badge tone="blue">Board review</Badge>
          <span>
            {pending.purpose} / Decision due {dateLabel(pending.due_date)}
          </span>
        </div>
      ) : waiting && data.nextRequestDate ? (
        <div className="support-status">
          <span>Next board request: {dateLabel(data.nextRequestDate)}</span>
        </div>
      ) : null}
      {data.affiliates.length ? (
        <div className="table-scroll">
          <table className="data-table affiliate-table">
            <thead>
              <tr>
                <th>Club</th>
                <th>Division</th>
                <th>Agreement</th>
                <th>Relationship</th>
                <th>Annual fee</th>
              </tr>
            </thead>
            <tbody>
              {data.affiliates.map((affiliate) => (
                <tr key={affiliate.id}>
                  <td>
                    <ClubLink
                      id={affiliate.partner_id}
                      name={affiliate.name}
                      color={affiliate.color}
                      crest
                    />
                    <small className="cell-subtitle">
                      {affiliate.country_name}
                    </small>
                  </td>
                  <td>{affiliate.league_name ?? "-"}</td>
                  <td>{affiliate.type}</td>
                  <td>{Math.round(affiliate.strength)}/100</td>
                  <td>
                    {money(Number(JSON.parse(affiliate.data).annualFee ?? 0))}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <Empty icon={Handshake} title="No affiliate agreements" />
      )}
      {data.requests.length > 0 && (
        <div className="affiliate-requests">
          <h3>Board decisions</h3>
          {data.requests.map((request) => (
            <article className="affiliate-request" key={request.id}>
              <header>
                <strong>{request.purpose}</strong>
                <Badge
                  tone={
                    request.status === "approved"
                      ? "green"
                      : request.status === "rejected"
                        ? "amber"
                        : "blue"
                  }
                >
                  {request.status === "pending"
                    ? "Under review"
                    : request.status === "approved"
                      ? "Approved"
                      : "Declined"}
                </Badge>
                <time>{dateLabel(request.requested_date)}</time>
              </header>
              <p>
                {request.reason ||
                  `Board funding and the other club's agreement are being assessed. Decision due ${dateLabel(request.due_date)}.`}
              </p>
              {request.partner_id && (
                <ClubLink
                  id={request.partner_id}
                  name={request.partner_name ?? "Affiliate club"}
                />
              )}
            </article>
          ))}
        </div>
      )}
      {requestOpen && (
        <AffiliateRequestSheet
          existingIds={data.affiliates.map((club) => club.partner_id)}
          close={() => setRequestOpen(false)}
        />
      )}
    </section>
  );
}

function AffiliateRequestSheet({
  existingIds,
  close,
}: {
  existingIds: number[];
  close: () => void;
}) {
  const { bootstrap, act } = useGame();
  const [purpose, setPurpose] = useState("Development club");
  const [specific, setSpecific] = useState(false);
  const [search, setSearch] = useState("");
  const [partnerId, setPartnerId] = useState("");
  const [pending, setPending] = useState(false);
  const deferred = useDeferredValue(search);
  const { data, loading, error } = useResource<WorldClubPage>(
    specific
      ? `world/clubs?type=club&pageSize=50&q=${encodeURIComponent(deferred)}`
      : null,
  );
  const candidates =
    data?.clubs.filter(
      (club) =>
        club.id !== bootstrap?.club.id && !existingIds.includes(club.id),
    ) ?? [];
  async function submit() {
    setPending(true);
    const result = await act({
      type: "affiliate-request",
      purpose,
      ...(specific ? { partnerId: Number(partnerId) } : {}),
    });
    setPending(false);
    if (result) close();
  }
  return (
    <Modal title="Request an affiliate club" onClose={close}>
      <div className="sheet-body">
        <Field label="Affiliation type">
          <select
            value={purpose}
            onChange={(event) => setPurpose(event.target.value)}
          >
            {PARTNERSHIP_TYPES.map((type) => (
              <option key={type}>{type}</option>
            ))}
          </select>
        </Field>
        <p className="sheet-description">{AFFILIATION_BENEFITS[purpose]}</p>
        <label className="checkbox-field section-space">
          <input
            type="checkbox"
            checked={specific}
            onChange={(event) => setSpecific(event.target.checked)}
          />
          Propose a specific club
        </label>
        {specific && (
          <div className="form-grid section-space">
            <Field label="Find affiliate club" className="span-2">
              <div className="search-field">
                <Search size={16} />
                <input
                  aria-label="Find affiliate club"
                  value={search}
                  maxLength={100}
                  onChange={(event) => {
                    setSearch(event.target.value);
                    setPartnerId("");
                  }}
                  placeholder="Club, city or country..."
                />
              </div>
            </Field>
            <Field label="Preferred affiliate" className="span-2">
              <select
                value={partnerId}
                onChange={(event) => setPartnerId(event.target.value)}
                disabled={loading}
              >
                <option value="">
                  {loading ? "Searching..." : "Select a club"}
                </option>
                {candidates.map((club) => (
                  <option key={club.id} value={club.id}>
                    {club.name} / {club.country_name}
                  </option>
                ))}
              </select>
            </Field>
            {error && <ErrorState message={error} />}
          </div>
        )}
        {specific && partnerId && (
          <AffiliateInterest partnerId={Number(partnerId)} purpose={purpose} />
        )}
        <DetailList
          items={[
            ["Decision", "Within three days"],
            [
              "Preferred club",
              specific
                ? (candidates.find((club) => club.id === Number(partnerId))
                    ?.name ?? "Not selected")
                : "Board recommendation",
            ],
            ["Approval", "Board funding and mutual club agreement"],
            ["Funding", "Paid only after both clubs agree"],
          ]}
        />
      </div>
      <footer className="sheet-footer">
        <Button variant="secondary" disabled={pending} onClick={close}>
          Cancel
        </Button>
        <Button
          icon={Handshake}
          disabled={pending || (specific && !partnerId)}
          onClick={() => void submit()}
        >
          Submit board request
        </Button>
      </footer>
    </Modal>
  );
}

function AssistantControls({ data }: { data: AssistantData }) {
  const { bootstrap, act, openOffer } = useGame();
  const { money } = useCurrency();
  const [duties, setDuties] = useState(data.duties);
  const [budget, setBudget] = useState(data.weeklyBudget);
  const [pending, setPending] = useState(false);
  const changed =
    JSON.stringify(duties) !== JSON.stringify(data.duties) ||
    budget !== data.weeklyBudget;
  const reviewedToday = data.reports[0]?.date === bootstrap?.state.date;
  async function save() {
    setPending(true);
    await act({ type: "assistant-duties", duties, weeklyBudget: budget });
    setPending(false);
  }
  async function run() {
    setPending(true);
    await act({ type: "assistant-run" });
    setPending(false);
  }
  if (!data.assistant)
    return (
      <Empty
        icon={UserRound}
        title="No sporting director assistant employed"
        detail="Delegated work is paused until an assistant joins the club."
      />
    );
  return (
    <div className="assistant-workspace">
      <header className="assistant-heading">
        <span className="staff-monogram">
          <UserRound size={24} />
        </span>
        <div>
          <h2>{data.assistant.name}</h2>
          <p>Sporting director assistant</p>
        </div>
        <Badge tone="blue">Ability {data.assistant.ability}/99</Badge>
      </header>
      <div className="assistant-layout">
        <section>
          <SectionHeading title="Responsibilities" />
          <div className="assistant-duty-list">
            {ASSISTANT_DUTIES.map((duty) => (
              <div className="assistant-duty" key={duty.id}>
                <div>
                  <strong>{duty.label}</strong>
                  <p>{duty.description}</p>
                </div>
                <Toggle
                  label={`Delegate ${duty.label.toLowerCase()}`}
                  checked={duties[duty.id]}
                  disabled={pending}
                  onChange={(enabled) =>
                    setDuties({ ...duties, [duty.id]: enabled })
                  }
                />
              </div>
            ))}
          </div>
          <div className="assistant-allowance">
            <Field label="Weekly scouting allowance">
              <MoneyInput
                aria-label="Assistant weekly scouting allowance"
                min={0}
                max={100000}
                value={budget}
                onChange={setBudget}
                disabled={pending}
              />
            </Field>
            <DetailList
              items={[
                ["Spent in last seven days", money(data.spentLastWeek)],
                ["Review cadence", "Weekly"],
                [
                  "Last review",
                  data.lastRun ? dateLabel(data.lastRun) : "Not yet reviewed",
                ],
                [
                  "Director approval",
                  "Contract signatures, transfers and recalls",
                ],
              ]}
            />
          </div>
          <div className="support-actions">
            <Button
              icon={Save}
              disabled={pending || !changed || budget < 0 || budget > 100000}
              onClick={() => void save()}
            >
              Save responsibilities
            </Button>
            <Button
              icon={ClipboardList}
              variant="secondary"
              disabled={
                pending ||
                changed ||
                reviewedToday ||
                !Object.values(duties).some(Boolean)
              }
              onClick={() => void run()}
            >
              Request assistant review
            </Button>
          </div>
        </section>
        <section>
          <SectionHeading title="Assistant reports" />
          {data.reports.length ? (
            <div className="assistant-reports">
              {data.reports.map((report, index) => (
                <details
                  className="assistant-report"
                  key={report.id}
                  open={index === 0}
                >
                  <summary>
                    <span>{dateLabel(report.date)}</span>
                    <Badge>{report.actions.length} actions</Badge>
                  </summary>
                  <p className="muted">
                    {report.name} / {money(report.spending)} spent
                  </p>
                  <ul>
                    {report.actions.map((action, actionIndex) => (
                      <li key={actionIndex}>
                        <p>{action.message}</p>
                        <div className="inline-controls">
                          {action.playerId && (
                            <PlayerLink
                              id={action.playerId}
                              name={action.playerName ?? "Player"}
                            />
                          )}
                          {action.negotiationId && action.playerId && (
                            <Button
                              variant="ghost"
                              icon={ArrowUpRight}
                              onClick={() => openOffer(action.playerId!)}
                            >
                              Open draft
                            </Button>
                          )}
                        </div>
                      </li>
                    ))}
                  </ul>
                </details>
              ))}
            </div>
          ) : (
            <Empty icon={ClipboardList} title="No delegated work yet" />
          )}
        </section>
      </div>
    </div>
  );
}
