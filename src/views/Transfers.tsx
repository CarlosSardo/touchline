import { useState } from "react";
import {
  ArrowLeftRight,
  ArrowUpRight,
  Check,
  Clock3,
  FileSignature,
  Handshake,
  Megaphone,
  MessageSquare,
  Search,
  X,
} from "lucide-react";
import { useGame, useResource } from "../game-context.tsx";
import {
  Badge,
  Button,
  DetailList,
  Empty,
  ErrorState,
  Field,
  Loading,
  Meter,
  Modal,
  PageHeading,
  Panel,
  PlayerTable,
  Rating,
  SectionHeading,
  Stat,
  Tabs,
  TextLink,
} from "../ui.tsx";
import {
  dateLabel,
  LOAN_TYPES,
  money,
  POSITIONS,
  TRAINING_TYPES,
  transferWindow,
} from "../../shared/rules.ts";
import type { TransferDesk } from "../../shared/api.ts";
import type {
  LoanTerms,
  Negotiation,
  NegotiationData,
  Position,
} from "../../shared/types.ts";

export function LoanTermsForm({
  terms,
  setTerms,
  type,
}: {
  terms: LoanTerms;
  setTerms: (terms: LoanTerms) => void;
  type: string;
}) {
  const update = <Key extends keyof LoanTerms>(
    key: Key,
    value: LoanTerms[Key],
  ) => setTerms({ ...terms, [key]: value });
  return (
    <>
      <div className="form-heading">Loan agreement</div>
      <div className="term-grid">
        <Field label={`Playing time guarantee / ${terms.playingTime}%`}>
          <input
            type="range"
            min="0"
            max="100"
            value={terms.playingTime}
            onChange={(event) =>
              update("playingTime", Number(event.target.value))
            }
          />
        </Field>
        <Field label={`Borrowing club salary share / ${terms.salarySplit}%`}>
          <input
            type="range"
            min="0"
            max="100"
            value={terms.salarySplit}
            onChange={(event) =>
              update("salarySplit", Number(event.target.value))
            }
          />
        </Field>
        <Field label="Guaranteed position">
          <select
            value={terms.position}
            onChange={(event) =>
              update("position", event.target.value as Position)
            }
          >
            {POSITIONS.map((position) => (
              <option key={position}>{position}</option>
            ))}
          </select>
        </Field>
        <Field label="Guaranteed role">
          <select
            value={terms.role}
            onChange={(event) => update("role", event.target.value)}
          >
            {["Key player", "Regular starter", "Squad player", "Prospect"].map(
              (role) => (
                <option key={role}>{role}</option>
              ),
            )}
          </select>
        </Field>
        <Field label="Development plan">
          <select
            value={terms.developmentPlan}
            onChange={(event) => update("developmentPlan", event.target.value)}
          >
            {TRAINING_TYPES.map((focus) => (
              <option key={focus}>{focus}</option>
            ))}
          </select>
        </Field>
        <Field label="Mandatory season minutes">
          <input
            type="number"
            min="0"
            max="6000"
            step="90"
            value={terms.mandatoryMinutes}
            onChange={(event) =>
              update("mandatoryMinutes", Number(event.target.value))
            }
          />
        </Field>
        <Field label="Development bonus (GBP)">
          <input
            type="number"
            min="0"
            step="10000"
            value={terms.bonus}
            onChange={(event) => update("bonus", Number(event.target.value))}
          />
        </Field>
        <Field label="Duration (days)">
          <input
            type="number"
            min="30"
            max="730"
            value={
              type === "Short loan"
                ? 182
                : type === "Two-year loan"
                  ? 730
                  : type === "Emergency loan"
                    ? 90
                    : terms.duration
            }
            disabled={[
              "Short loan",
              "Two-year loan",
              "Emergency loan",
            ].includes(type)}
            onChange={(event) => update("duration", Number(event.target.value))}
          />
        </Field>
        <Field label={`Minimum tactical fit / ${terms.tacticalFit}`}>
          <input
            type="range"
            min="0"
            max="100"
            value={terms.tacticalFit}
            onChange={(event) =>
              update("tacticalFit", Number(event.target.value))
            }
          />
        </Field>
        <Field label={`Minimum manager trust / ${terms.managerTrust}`}>
          <input
            type="range"
            min="0"
            max="100"
            value={terms.managerTrust}
            onChange={(event) =>
              update("managerTrust", Number(event.target.value))
            }
          />
        </Field>
        <label className="checkbox-field">
          <input
            type="checkbox"
            checked={terms.recall}
            onChange={(event) => update("recall", event.target.checked)}
          />
          Standard recall clause
        </label>
        <label className="checkbox-field">
          <input
            type="checkbox"
            checked={terms.injuryRecall}
            onChange={(event) => update("injuryRecall", event.target.checked)}
          />
          Injury recall clause
        </label>
        {["Loan with option", "Loan with obligation"].includes(type) && (
          <Field label="Agreed purchase fee (GBP)">
            <input
              type="number"
              min="0"
              step="100000"
              value={terms.optionFee}
              onChange={(event) =>
                update("optionFee", Number(event.target.value))
              }
            />
          </Field>
        )}
        {type === "Loan with obligation" && (
          <Field label="Purchase obligation">
            <select
              value={terms.obligationCondition}
              onChange={(event) =>
                update(
                  "obligationCondition",
                  event.target.value as LoanTerms["obligationCondition"],
                )
              }
            >
              <option>Unconditional</option>
              <option>Minutes played</option>
              <option>Avoid relegation</option>
            </select>
          </Field>
        )}
        {type === "Loan with sell-on" && (
          <Field label={`Sell-on clause / ${terms.sellOn}%`}>
            <input
              type="range"
              min="0"
              max="50"
              value={terms.sellOn}
              onChange={(event) => update("sellOn", Number(event.target.value))}
            />
          </Field>
        )}
      </div>
      <p className="term-relationship">
        Club relationship <strong>{Math.round(terms.relationship)}/100</strong>
      </p>
    </>
  );
}

function NegotiationSheet({
  negotiation,
  close,
}: {
  negotiation: Negotiation;
  close: () => void;
}) {
  const { act, bootstrap, confirm } = useGame();
  const details = JSON.parse(negotiation.data) as NegotiationData;
  const [fee, setFee] = useState(
    Math.round(negotiation.offer || negotiation.asking_price),
  );
  const [wage, setWage] = useState(
    Math.round(
      details.requiredWage ??
        negotiation.wage * (LOAN_TYPES.includes(negotiation.type) ? 1 : 1.25),
    ),
  );
  const [years, setYears] = useState(details.years || 4);
  const [role, setRole] = useState(details.role || "Regular starter");
  const [promises, setPromises] = useState(details.promises);
  const [terms, setTerms] = useState<LoanTerms>(details.terms);
  const [bonus, setBonus] = useState(details.signingBonus ?? 0);
  const [pending, setPending] = useState(false);
  const loan = LOAN_TYPES.includes(negotiation.type);
  const active = ["Club talks", "Agent talks"].includes(negotiation.stage);
  const incoming = negotiation.stage === "Offer received";
  async function submit() {
    setPending(true);
    const result = await act({
      type: "offer",
      id: negotiation.id,
      fee,
      wage,
      years,
      role,
      promises,
      signingBonus: bonus,
      ...(loan ? { terms: { ...terms, fee } } : {}),
    });
    setPending(false);
    if (result?.stage === "Medical" || result?.stage === "Rejected") close();
  }
  return (
    <Modal
      title={`${negotiation.player_name} / ${negotiation.type}`}
      onClose={close}
      wide={loan}
    >
      <div className="sheet-body">
        <div className="negotiation-sheet-top">
          <div>
            <Badge tone={negotiation.stage === "Rejected" ? "red" : "green"}>
              {negotiation.stage}
            </Badge>
            <h3>
              {negotiation.seller_name ?? "Free agent"}{" "}
              <ArrowUpRight size={15} /> {negotiation.buyer_name}
            </h3>
            <p>
              Deadline {dateLabel(negotiation.deadline)} / Interest{" "}
              {Math.round(negotiation.interest)}%
            </p>
          </div>
          <div className="negotiation-agent">
            <strong>{details.agent.name}</strong>
            <small>
              {details.agent.personality} / Difficulty{" "}
              {details.agent.difficulty}
            </small>
          </div>
        </div>
        <div className="tension-bar">
          <span>Negotiation tension</span>
          <Meter
            value={negotiation.tension}
            tone={negotiation.tension > 65 ? "red" : "amber"}
          />
          <strong>{Math.round(negotiation.tension)}%</strong>
        </div>
        <div className="negotiation-log">
          {details.log.map((entry, index) => (
            <div className="log-item" key={index}>
              <small>
                {dateLabel(entry.date)} / {entry.type}
              </small>
              <p>{entry.message}</p>
            </div>
          ))}
        </div>
        {active && (
          <>
            <div className="form-grid">
              <Field label={loan ? "Loan fee (GBP)" : "Transfer fee (GBP)"}>
                <input
                  aria-label="Proposed transfer fee"
                  type="number"
                  min="0"
                  step="100000"
                  value={fee}
                  disabled={negotiation.stage === "Agent talks"}
                  onChange={(event) => setFee(Number(event.target.value))}
                />
              </Field>
              <Field label="Weekly wage (GBP)">
                <input
                  aria-label="Proposed weekly wage"
                  type="number"
                  min="0"
                  step="500"
                  value={wage}
                  onChange={(event) => setWage(Number(event.target.value))}
                />
              </Field>
              {!loan && (
                <>
                  <Field label="Contract length">
                    <select
                      value={years}
                      onChange={(event) => setYears(Number(event.target.value))}
                    >
                      {[1, 2, 3, 4, 5]
                        .filter(
                          (year) => (negotiation.age ?? 20) >= 18 || year <= 3,
                        )
                        .map((year) => (
                          <option key={year} value={year}>
                            {year} years
                          </option>
                        ))}
                    </select>
                  </Field>
                  <Field label="Squad role">
                    <select
                      value={role}
                      onChange={(event) => setRole(event.target.value)}
                    >
                      {[
                        "Captain",
                        "Key player",
                        "Regular starter",
                        "Squad player",
                        "Fringe player",
                        "Prospect",
                      ].map((value) => (
                        <option key={value}>{value}</option>
                      ))}
                    </select>
                  </Field>
                  <Field label="Signing bonus (GBP)">
                    <input
                      type="number"
                      min="0"
                      step="10000"
                      value={bonus}
                      onChange={(event) => setBonus(Number(event.target.value))}
                    />
                  </Field>
                </>
              )}
            </div>
            {loan && (
              <LoanTermsForm
                terms={terms}
                setTerms={setTerms}
                type={negotiation.type}
              />
            )}
            <div className="form-heading">Contract promises</div>
            <div className="promise-options">
              {[
                "First-team minutes",
                "Captaincy",
                "Youth pathway",
                "European football",
                "Facilities investment",
              ].map((promise) => (
                <label key={promise} className="checkbox-field">
                  <input
                    type="checkbox"
                    checked={promises.includes(promise)}
                    onChange={(event) =>
                      setPromises(
                        event.target.checked
                          ? [...promises, promise]
                          : promises.filter((value) => value !== promise),
                      )
                    }
                  />
                  {promise}
                </label>
              ))}
            </div>
            <div className="negotiation-budget">
              <span>
                Asking price <strong>{money(negotiation.asking_price)}</strong>
              </span>
              <span>
                Your available budget{" "}
                <strong>{money(bootstrap?.club.transfer_budget ?? 0)}</strong>
              </span>
            </div>
          </>
        )}
        {!active && (
          <DetailList
            items={[
              ["Fee", money(negotiation.offer)],
              ["Wage", `${money(negotiation.wage)} / week`],
              ["Status", negotiation.stage],
              ...(details.medicalDate
                ? [
                    ["Medical date", dateLabel(details.medicalDate)] as [
                      string,
                      string,
                    ],
                  ]
                : []),
            ]}
          />
        )}
      </div>
      <footer className="sheet-footer">
        <div className="footer-left">
          {active && (
            <>
              <Button
                variant="secondary"
                icon={Megaphone}
                disabled={!!negotiation.public || pending}
                onClick={() =>
                  void act({
                    type: "negotiation",
                    id: negotiation.id,
                    action: "declare",
                  })
                }
              >
                {negotiation.public ? "Interest public" : "Declare interest"}
              </Button>
              <Button
                variant="ghost"
                icon={X}
                onClick={() =>
                  confirm(
                    "Withdraw from talks?",
                    "The agent and selling club will be informed. No transfer fee has been committed.",
                    () => {
                      void act({
                        type: "negotiation",
                        id: negotiation.id,
                        action: "withdraw",
                      }).then(close);
                    },
                  )
                }
              >
                Withdraw
              </Button>
            </>
          )}
        </div>
        {active && (
          <Button
            icon={FileSignature}
            disabled={pending}
            onClick={() => void submit()}
          >
            {negotiation.stage === "Club talks"
              ? "Submit club offer"
              : "Submit personal terms"}
          </Button>
        )}
        {incoming && (
          <>
            <Button
              variant="secondary"
              icon={X}
              onClick={() =>
                void act({
                  type: "negotiation",
                  id: negotiation.id,
                  action: "reject",
                }).then(close)
              }
            >
              Reject
            </Button>
            <Button
              icon={Check}
              onClick={() =>
                void act({
                  type: "negotiation",
                  id: negotiation.id,
                  action: "accept",
                }).then(close)
              }
            >
              Accept offer
            </Button>
          </>
        )}
        {!active && !incoming && (
          <Button variant="secondary" onClick={close}>
            Close
          </Button>
        )}
      </footer>
    </Modal>
  );
}

export default function Transfers() {
  const { bootstrap, navigate, act } = useGame();
  const { data, error } = useResource<TransferDesk>("transfers");
  const [tab, setTab] = useState("active");
  const [selected, setSelected] = useState<number | null>(null);
  if (error) return <ErrorState message={error} />;
  if (!data || !bootstrap) return <Loading />;
  const activeStages = [
    "Club talks",
    "Agent talks",
    "Medical",
    "Offer received",
  ];
  const active = data.negotiations.filter((item) =>
    activeStages.includes(item.stage),
  );
  const completed = data.negotiations.filter(
    (item) => item.stage === "Completed",
  );
  const current = data.negotiations.find((item) => item.id === selected);
  const displayed =
    tab === "history"
      ? data.negotiations.filter((item) => !activeStages.includes(item.stage))
      : active;
  return (
    <div className="page">
      <PageHeading
        eyebrow="THE TRANSFER DESK"
        title="Make your move"
        subtitle={`${dateLabel(bootstrap.state.date)} / ${transferWindow(bootstrap.state.date) ? "Registration window open" : "Deals await the next registration window"}`}
      >
        <Button
          icon={Search}
          variant="secondary"
          onClick={() => navigate("database")}
        >
          Find a target
        </Button>
      </PageHeading>
      <div className="stat-strip">
        <Stat
          label="Available budget"
          value={money(bootstrap.club.transfer_budget)}
          icon={ArrowLeftRight}
          detail="Before contingent commitments"
        />
        <Stat
          label="Active negotiations"
          value={active.length}
          icon={MessageSquare}
          detail="Club, agent or medical stage"
        />
        <Stat
          label="Deals completed"
          value={completed.length}
          icon={Handshake}
          detail="Registered agreements"
        />
        <Stat
          label="Season investment"
          value={money(bootstrap.club.season_spend)}
          icon={FileSignature}
          detail="Transfers and signing costs"
        />
      </div>
      <Panel>
        <Tabs
          items={[
            { id: "active", label: "Negotiations", count: active.length },
            {
              id: "targets",
              label: "Priority targets",
              count: data.targets.length,
            },
            { id: "history", label: "Deal history" },
            { id: "market", label: "World market" },
          ]}
          value={tab}
          onChange={setTab}
        />
        {(tab === "active" || tab === "history") &&
          (displayed.length ? (
            <div className="padded">
              <div className="cards-list">
                {displayed.map((negotiation) => {
                  const stageIndex = [
                    "Club talks",
                    "Agent talks",
                    "Medical",
                    "Completed",
                  ].indexOf(negotiation.stage);
                  return (
                    <article className="entity-card" key={negotiation.id}>
                      <div className="entity-card-top">
                        <Badge
                          tone={
                            negotiation.stage === "Completed"
                              ? "green"
                              : negotiation.stage === "Rejected" ||
                                  negotiation.stage === "Hijacked"
                                ? "red"
                                : "blue"
                          }
                        >
                          {negotiation.stage}
                        </Badge>
                        <Rating value={negotiation.ability ?? 0} />
                      </div>
                      <h3>{negotiation.player_name}</h3>
                      <p>
                        {negotiation.position} / {negotiation.age} yrs /{" "}
                        {negotiation.type}
                      </p>
                      <div className="negotiation-progress">
                        {[0, 1, 2, 3].map((step) => (
                          <span
                            className={step <= stageIndex ? "done" : ""}
                            key={step}
                          />
                        ))}
                      </div>
                      <DetailList
                        items={[
                          [
                            "Club",
                            negotiation.buying_club_id === bootstrap.club.id
                              ? (negotiation.seller_name ?? "Free agent")
                              : negotiation.buyer_name,
                          ],
                          ["Asking price", money(negotiation.asking_price)],
                          ["Your offer", money(negotiation.offer)],
                          ["Interest", `${Math.round(negotiation.interest)}%`],
                        ]}
                      />
                      <div className="tension-bar">
                        <span>Tension</span>
                        <Meter
                          value={negotiation.tension}
                          tone={negotiation.tension > 65 ? "red" : "amber"}
                        />
                        <strong>{Math.round(negotiation.tension)}</strong>
                      </div>
                      <div className="inline-controls">
                        <Button
                          icon={MessageSquare}
                          variant="secondary"
                          onClick={() => setSelected(negotiation.id)}
                        >
                          {activeStages.includes(negotiation.stage)
                            ? "Open negotiations"
                            : "View agreement"}
                        </Button>
                      </div>
                    </article>
                  );
                })}
              </div>
            </div>
          ) : (
            <Empty
              icon={Handshake}
              title={
                tab === "active"
                  ? "No negotiations in progress"
                  : "The story is still to be written"
              }
              detail={
                tab === "active"
                  ? "Your shortlisted players are ready for a closer look."
                  : "Completed and closed negotiations will be recorded here."
              }
            >
              <Button
                variant="secondary"
                icon={ArrowUpRight}
                onClick={() => setTab("targets")}
              >
                View priority targets
              </Button>
            </Empty>
          ))}
        {tab === "targets" && (
          <>
            <SectionHeading title="Your recruitment shortlist">
              <TextLink onClick={() => navigate("scouting")}>
                Scouting centre
              </TextLink>
            </SectionHeading>
            <PlayerTable players={data.targets}>
              {(player) => (
                <Button
                  icon={MessageSquare}
                  variant="secondary"
                  onClick={() =>
                    void act({
                      type: "enquiry",
                      playerId: player.id,
                      dealType: "Permanent transfer",
                    }).then((result) => {
                      if (result?.id) {
                        setSelected(Number(result.id));
                        setTab("active");
                      }
                    })
                  }
                >
                  Enquire
                </Button>
              )}
            </PlayerTable>
          </>
        )}
        {tab === "market" &&
          (data.market.length ? (
            <div className="table-scroll">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Player</th>
                    <th>Destination</th>
                    <th>Fee</th>
                    <th>Completed</th>
                  </tr>
                </thead>
                <tbody>
                  {data.market.map((event) => {
                    const move = JSON.parse(event.data);
                    return (
                      <tr key={event.id}>
                        <td>
                          <strong>{move.name}</strong>
                        </td>
                        <td>{move.club}</td>
                        <td className="money">{money(move.fee)}</td>
                        <td>{dateLabel(event.date)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ) : (
            <Empty
              icon={Clock3}
              title="The window is just opening"
              detail="Completed transfers around the world will appear as the calendar advances."
            />
          ))}
      </Panel>
      {current && (
        <NegotiationSheet
          key={current.id}
          negotiation={current}
          close={() => setSelected(null)}
        />
      )}
    </div>
  );
}
