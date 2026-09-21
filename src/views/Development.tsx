import { useState } from "react";
import {
  ArrowUp,
  Check,
  Dumbbell,
  GraduationCap,
  HeartPulse,
  Network,
  Save,
  ShieldCheck,
  Sparkles,
  Target,
  TrendingUp,
  Users,
} from "lucide-react";
import { useCurrency, useGame, useResource } from "../game-context.tsx";
import {
  Badge,
  Button,
  DetailList,
  Empty,
  ErrorState,
  Field,
  FixtureRow,
  Loading,
  Meter,
  Modal,
  PageHeading,
  Panel,
  PlayerName,
  Rating,
  SectionHeading,
  Stat,
  Tabs,
  TextLink,
} from "../ui.tsx";
import { dateLabel, POSITIONS, TRAINING_TYPES } from "../../shared/rules.ts";
import type { AcademyData, StaffDesk, TrainingData } from "../../shared/api.ts";
import type { Player, Staff } from "../../shared/types.ts";
import { AssistantPanel } from "./ClubSupport.tsx";

function MentorSheet({ player, close }: { player: Player; close: () => void }) {
  const { act } = useGame();
  const { data } = useResource<TrainingData>("training");
  const [mentor, setMentor] = useState("");
  return (
    <Modal title={`Mentorship / ${player.name}`} onClose={close}>
      <div className="sheet-body">
        <Field label="Senior mentor">
          <select
            value={mentor}
            onChange={(event) => setMentor(event.target.value)}
          >
            <option value="">Select a mentor</option>
            {data?.mentors.map((candidate) => (
              <option key={candidate.id} value={candidate.id}>
                {candidate.name} / {candidate.position} / {candidate.age} years
              </option>
            ))}
          </select>
        </Field>
        <div className="section-space">
          <DetailList
            items={[
              ["Prospect", player.name],
              ["Age", player.age],
              [
                "Development range",
                `${Math.max(1, Math.round(player.potential - player.volatility))}-${Math.min(99, Math.round(player.potential + player.volatility))}`,
              ],
              [
                "Dressing-room group",
                player.details?.relationships.group ?? "Academy",
              ],
            ]}
          />
        </div>
      </div>
      <footer className="sheet-footer">
        <Button variant="secondary" onClick={close}>
          Cancel
        </Button>
        <Button
          icon={Network}
          disabled={!mentor}
          onClick={() =>
            void act({
              type: "mentor",
              playerId: player.id,
              mentorId: Number(mentor),
            }).then((result) => {
              if (result) close();
            })
          }
        >
          Confirm mentorship
        </Button>
      </footer>
    </Modal>
  );
}

export function Academy() {
  const { bootstrap, act, setPlayer, openLeague, confirm } = useGame();
  const { data, error } = useResource<AcademyData>("academy");
  const [tab, setTab] = useState("prospects");
  const [group, setGroup] = useState("all");
  const [mentee, setMentee] = useState<Player | null>(null);
  if (error) return <ErrorState message={error} />;
  if (!data || !bootstrap) return <Loading />;
  const cohort = data.players.filter(
    (player) => group === "all" || player.age_group === group,
  );
  return (
    <div className="page">
      <PageHeading
        eyebrow="THE NEXT GENERATION"
        title="Academy & pathways"
        subtitle={`${data.dna} / ${bootstrap.club.name}`}
      >
        <Button
          icon={TrendingUp}
          variant="secondary"
          onClick={() =>
            confirm(
              "Invest in the academy?",
              "The academy rating will increase by three points. The investment is charged to cash and your transfer allocation.",
              () => {
                void act({ type: "investment", kind: "academy" });
              },
            )
          }
        >
          Invest in academy
        </Button>
      </PageHeading>
      <div className="stat-strip">
        <Stat
          label="Academy rating"
          value={
            <>
              {bootstrap.club.academy}
              <small>/99</small>
            </>
          }
          icon={GraduationCap}
          detail={<Meter value={bootstrap.club.academy} max={99} />}
        />
        <Stat
          label="Young players"
          value={data.players.length}
          icon={Users}
          detail={`${data.players.filter((player) => player.age_group === "U17").length} U17 / ${data.players.filter((player) => player.age_group === "U19").length} U19`}
        />
        <Stat
          label="High-potential prospects"
          value={data.players.filter((player) => player.potential >= 80).length}
          icon={Sparkles}
          detail="Current potential of 80+"
        />
        <Stat
          label="Global annual intake"
          value="15,000"
          icon={TrendingUp}
          detail={
            data.intake
              ? `Last intake ${dateLabel(data.intake.date)}`
              : "Next intake: 1 July 2027"
          }
        />
      </div>
      <Panel>
        <Tabs
          items={[
            { id: "prospects", label: "Prospects" },
            { id: "mentorship", label: "Mentorship chains" },
            { id: "calendar", label: "Youth competitions" },
          ]}
          value={tab}
          onChange={setTab}
        />
        {(tab === "prospects" || tab === "mentorship") && (
          <>
            <div className="filter-bar">
              <select
                aria-label="Academy age group"
                value={group}
                onChange={(event) => setGroup(event.target.value)}
              >
                <option value="all">All age groups</option>
                <option>U17</option>
                <option>U19</option>
              </select>
              <Badge tone="blue">Youth DNA: {data.dna}</Badge>
            </div>
            <div className="table-scroll">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Player</th>
                    <th>Pos</th>
                    <th>Group</th>
                    <th>Ability</th>
                    <th>Potential</th>
                    <th>{tab === "mentorship" ? "Mentor" : "Development"}</th>
                    <th>Burnout</th>
                    <th>Pathway</th>
                  </tr>
                </thead>
                <tbody>
                  {cohort.map((player) => (
                    <tr key={player.id}>
                      <td>
                        <PlayerName player={player} compact />
                      </td>
                      <td>
                        <span className="position-tag">{player.position}</span>
                      </td>
                      <td>{player.age_group}</td>
                      <td>
                        <Rating value={player.ability} />
                      </td>
                      <td>
                        <span className="potential-band">
                          <Rating value={player.potential} potential />
                          <small>
                            {Math.max(
                              1,
                              Math.round(player.potential - player.volatility),
                            )}
                            -
                            {Math.min(
                              99,
                              Math.round(player.potential + player.volatility),
                            )}
                          </small>
                        </span>
                      </td>
                      <td>
                        {tab === "mentorship" ? (
                          player.details?.development.mentorId ? (
                            <TextLink
                              onClick={() =>
                                setPlayer(player.details!.development.mentorId)
                              }
                            >
                              View mentor
                            </TextLink>
                          ) : (
                            <span className="muted">Not paired</span>
                          )
                        ) : (
                          <Badge
                            tone={
                              player.details?.development.growthSpurt
                                ? "blue"
                                : "green"
                            }
                          >
                            {player.details?.development.growthSpurt
                              ? "Growth spurt"
                              : player.training}
                          </Badge>
                        )}
                      </td>
                      <td>
                        <div className="cell-meter">
                          <Meter
                            value={player.details?.mentalHealth.burnout ?? 0}
                            tone="amber"
                          />
                          <small>
                            {Math.round(
                              player.details?.mentalHealth.burnout ?? 0,
                            )}
                          </small>
                        </div>
                      </td>
                      <td>
                        <div className="inline-controls">
                          <Button
                            icon={Network}
                            variant="secondary"
                            onClick={() => setMentee(player)}
                          >
                            Mentor
                          </Button>
                          {tab === "prospects" && (
                            <Button
                              icon={ArrowUp}
                              variant="ghost"
                              disabled={player.age < 16}
                              onClick={() =>
                                void act({
                                  type: "promote",
                                  playerId: player.id,
                                })
                              }
                            >
                              Promote
                            </Button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {!cohort.length && (
                <Empty
                  title="No players in this cohort"
                  detail="The next annual intake will refresh the academy."
                />
              )}
            </div>
          </>
        )}
        {tab === "calendar" && (
          <div className="padded">
            <div className="equal-columns">
              <div>
                <h3 className="subsection-title">Competitions</h3>
                {data.leagues.map((league) => (
                  <button
                    key={league.id}
                    className="competition-button"
                    onClick={() => openLeague(league.id)}
                  >
                    <strong>{league.name}</strong>
                    <small>
                      {league.age_group} / {league.format}
                    </small>
                  </button>
                ))}
              </div>
              <div>
                <h3 className="subsection-title">Next fixtures</h3>
                {data.fixtures.map((fixture) => (
                  <FixtureRow fixture={fixture} key={fixture.id} />
                ))}
              </div>
            </div>
          </div>
        )}
      </Panel>
      {mentee && <MentorSheet player={mentee} close={() => setMentee(null)} />}
    </div>
  );
}

function PlanForm({ plan }: { plan: TrainingData["plan"] }) {
  const { act } = useGame();
  const [focus, setFocus] = useState(plan.focus);
  const [youthFocus, setYouthFocus] = useState(plan.youth_focus);
  const [intensity, setIntensity] = useState(plan.intensity);
  return (
    <div className="padded">
      <div className="form-grid">
        <Field label="Senior team focus">
          <select
            value={focus}
            onChange={(event) => setFocus(event.target.value)}
          >
            {TRAINING_TYPES.map((item) => (
              <option key={item}>{item}</option>
            ))}
          </select>
        </Field>
        <Field label="Academy focus">
          <select
            value={youthFocus}
            onChange={(event) => setYouthFocus(event.target.value)}
          >
            {TRAINING_TYPES.map((item) => (
              <option key={item}>{item}</option>
            ))}
          </select>
        </Field>
        <Field label={`Training intensity / ${intensity}%`} className="span-2">
          <input
            type="range"
            min="0"
            max="100"
            value={intensity}
            onChange={(event) => setIntensity(Number(event.target.value))}
          />
        </Field>
      </div>
      <div className="plan-footer">
        <Badge tone={intensity > 75 ? "amber" : "green"}>
          {intensity > 75
            ? "High load / elevated injury risk"
            : intensity < 30
              ? "Recovery emphasis"
              : "Balanced workload"}
        </Badge>
        <Button
          icon={Save}
          onClick={() =>
            void act({ type: "training-plan", focus, youthFocus, intensity })
          }
        >
          Save programme
        </Button>
      </div>
    </div>
  );
}

function SetPieceDesigner({
  settings,
}: {
  settings: TrainingData["setPieces"];
}) {
  const { act } = useGame();
  const [routine, setRoutine] = useState(settings.routine);
  const [target, setTarget] = useState(settings.target);
  const [risk, setRisk] = useState(settings.risk);
  const end =
    routine === "Far post"
      ? [66, 17]
      : routine === "Short corner"
        ? [17, 18]
        : routine === "Edge of box"
          ? [50, 51]
          : [35, 17];
  return (
    <div className="padded">
      <div className="set-piece-layout">
        <svg
          viewBox="0 0 110 75"
          className="set-piece-pitch"
          role="img"
          aria-label={`${routine} set-piece routine targeting ${target}`}
        >
          <rect
            x="2"
            y="2"
            width="106"
            height="71"
            rx="1"
            fill="#1d3c31"
            stroke="#b2d1b4"
            strokeWidth=".3"
          />
          <path
            d="M2 70H108M30 2V30H80V2M43 2V11H67V2M50 2V0H60V2"
            fill="none"
            stroke="#b2d1b4"
            strokeWidth=".4"
          />
          <path
            d="M40 30Q55 45 70 30"
            fill="none"
            stroke="#b2d1b4"
            strokeWidth=".4"
          />
          {[
            [35, 19],
            [45, 24],
            [65, 17],
            [72, 28],
            [51, 49],
            [22, 45],
            [87, 45],
          ].map(([x, y], index) => (
            <g key={index}>
              <circle
                cx={x}
                cy={y}
                r="2.4"
                fill="#80e9ba"
                stroke="#fff"
                strokeWidth=".5"
              />
              <text
                x={x}
                y={y + 1}
                textAnchor="middle"
                fontSize="2.5"
                fontFamily="DM Sans Variable"
                fill="#164531"
              >
                {index + 4}
              </text>
            </g>
          ))}
          <path
            d={`M5 5Q35 0 ${end[0]} ${end[1]}`}
            stroke="#edcf77"
            strokeWidth=".8"
            strokeDasharray="2 1.2"
            fill="none"
          />
          <circle cx="5" cy="5" r="1.8" fill="#edcf77" />
          <circle
            cx={end[0]}
            cy={end[1]}
            r="4"
            fill="none"
            stroke="#edcf77"
            strokeWidth=".5"
          />
        </svg>
        <div className="stack">
          <Field label="Routine">
            <select
              value={routine}
              onChange={(event) => setRoutine(event.target.value)}
            >
              {["Near post", "Far post", "Short corner", "Edge of box"].map(
                (value) => (
                  <option key={value}>{value}</option>
                ),
              )}
            </select>
          </Field>
          <Field label="Primary target">
            <select
              value={target}
              onChange={(event) => setTarget(event.target.value)}
            >
              <option>Centre-back</option>
              <option>Striker</option>
              <option>Midfielder</option>
            </select>
          </Field>
          <Field label={`Attacking commitment / ${risk}%`}>
            <input
              type="range"
              min="0"
              max="100"
              value={risk}
              onChange={(event) => setRisk(Number(event.target.value))}
            />
          </Field>
          <Button
            icon={Check}
            onClick={() =>
              void act({ type: "set-pieces", routine, target, risk })
            }
          >
            Share with coaches
          </Button>
        </div>
      </div>
    </div>
  );
}

export function Training() {
  const { bootstrap, act } = useGame();
  const { data, error } = useResource<TrainingData>("training");
  const [tab, setTab] = useState("programme");
  if (error) return <ErrorState message={error} />;
  if (!data || !bootstrap) return <Loading />;
  return (
    <div className="page">
      <PageHeading
        eyebrow="PERFORMANCE & CARE"
        title="Development centre"
        subtitle="Give your people the environment to improve."
      />
      <div className="stat-strip">
        <Stat
          label="Training facilities"
          value={bootstrap.club.facilities}
          icon={Dumbbell}
          detail="Facilities rating / 99"
        />
        <Stat
          label="Training intensity"
          value={`${data.plan.intensity}%`}
          icon={Target}
          detail={data.plan.focus}
        />
        <Stat
          label="Medical room"
          value={data.injuries.length}
          icon={HeartPulse}
          detail="Players in rehabilitation"
        />
        <Stat
          label="Academy emphasis"
          value={
            <span style={{ fontSize: "1.1rem" }}>{data.plan.youth_focus}</span>
          }
          icon={GraduationCap}
          detail="Youth development programme"
        />
      </div>
      <Panel>
        <Tabs
          items={[
            { id: "programme", label: "Programme" },
            { id: "individual", label: "Individual plans" },
            {
              id: "medical",
              label: "Medical room",
              count: data.injuries.length,
            },
            { id: "setpieces", label: "Set-piece designer" },
          ]}
          value={tab}
          onChange={setTab}
        />
        {tab === "programme" && (
          <>
            <SectionHeading
              title="Weekly training emphasis"
              subtitle="A long-term plan, delivered by the coaching staff"
            />
            <PlanForm plan={data.plan} />
          </>
        )}
        {tab === "individual" && (
          <div className="table-scroll">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Player</th>
                  <th>Group</th>
                  <th>Development focus</th>
                  <th>Intensity</th>
                  <th>Position training</th>
                  <th>Fitness</th>
                </tr>
              </thead>
              <tbody>
                {data.players.map((player) => (
                  <tr key={player.id}>
                    <td>
                      <PlayerName player={player} compact />
                    </td>
                    <td>
                      <Badge>{player.age_group}</Badge>
                    </td>
                    <td>
                      <select
                        className="table-select"
                        aria-label={`Training for ${player.name}`}
                        value={player.training}
                        onChange={(event) =>
                          void act({
                            type: "training",
                            playerId: player.id,
                            focus: event.target.value,
                            intensity: player.intensity,
                          })
                        }
                      >
                        {TRAINING_TYPES.map((focus) => (
                          <option key={focus}>{focus}</option>
                        ))}
                      </select>
                    </td>
                    <td>
                      <select
                        className="table-select"
                        aria-label={`Intensity for ${player.name}`}
                        value={player.intensity}
                        onChange={(event) =>
                          void act({
                            type: "training",
                            playerId: player.id,
                            focus: player.training,
                            intensity: Number(event.target.value),
                          })
                        }
                      >
                        {[20, 35, 50, 65, 80, 95].map((value) => (
                          <option key={value} value={value}>
                            {value}%
                          </option>
                        ))}
                      </select>
                    </td>
                    <td>
                      <select
                        className="table-select"
                        aria-label={`Position training for ${player.name}`}
                        value=""
                        onChange={(event) =>
                          void act({
                            type: "training",
                            playerId: player.id,
                            focus: "Position",
                            intensity: player.intensity,
                            position: event.target.value,
                          })
                        }
                      >
                        <option value="">
                          {player.position} / {player.secondary_position}
                        </option>
                        {POSITIONS.map((position) => (
                          <option key={position}>{position}</option>
                        ))}
                      </select>
                    </td>
                    <td>
                      <div className="cell-meter">
                        <Meter value={player.fitness} />
                        <small>{Math.round(player.fitness)}%</small>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {tab === "medical" &&
          (data.injuries.length ? (
            <div className="table-scroll">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Player</th>
                    <th>Expected return</th>
                    <th>Condition</th>
                    <th>Current plan</th>
                    <th>Action</th>
                  </tr>
                </thead>
                <tbody>
                  {data.injuries.map((player) => (
                    <tr key={player.id}>
                      <td>
                        <PlayerName player={player} compact />
                      </td>
                      <td>{dateLabel(player.injury_until!)}</td>
                      <td>{Math.round(player.fitness)}%</td>
                      <td>
                        <Badge tone="amber">{player.training}</Badge>
                      </td>
                      <td>
                        <Button
                          variant="secondary"
                          icon={HeartPulse}
                          onClick={() =>
                            void act({
                              type: "training",
                              playerId: player.id,
                              focus: "Injury rehab",
                              intensity: 20,
                            })
                          }
                        >
                          Rehab plan
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <Empty
              icon={HeartPulse}
              title="A healthy squad"
              detail="No players are currently in the medical room."
            />
          ))}
        {tab === "setpieces" && (
          <>
            <SectionHeading
              title="Set-piece development"
              subtitle="A recruitment and coaching brief for the manager"
            />
            <SetPieceDesigner settings={data.setPieces} />
          </>
        )}
      </Panel>
    </div>
  );
}

function StaffCard({
  staff,
  candidate = false,
}: {
  staff: Staff;
  candidate?: boolean;
}) {
  const { act, confirm } = useGame();
  const { money } = useCurrency();
  return (
    <article className="entity-card">
      <div className="entity-card-top">
        <span className="staff-monogram">
          {staff.name
            .split(" ")
            .map((word) => word[0])
            .slice(0, 2)
            .join("")}
        </span>
        <Rating value={staff.ability} />
      </div>
      <h3>{staff.name}</h3>
      <p>{staff.role}</p>
      <div className="staff-personality">
        <Badge
          tone={
            staff.personality === "Ambitious" ||
            staff.personality === "Outspoken"
              ? "amber"
              : "blue"
          }
        >
          {staff.personality}
        </Badge>
      </div>
      <DetailList
        items={[
          ["Influence", staff.influence],
          ["Communication", staff.communication],
          ["Tactical knowledge", staff.tactical_knowledge],
          ["Ambition", staff.ambition],
          ["Weekly wage", money(staff.wage)],
        ]}
      />
      <div className="attribute-row">
        <span className="attribute-label">Morale</span>
        <Meter value={staff.morale} />
        <strong>{Math.round(staff.morale)}</strong>
      </div>
      <div className="inline-controls">
        {candidate ? (
          <Button
            icon={Users}
            onClick={() =>
              confirm(
                `Hire ${staff.name}?`,
                `${money(staff.wage * 12)} signing fee and ${money(staff.wage)} per week.`,
                () => {
                  void act({ type: "staff", id: staff.id, action: "hire" });
                },
              )
            }
          >
            Hire staff member
          </Button>
        ) : (
          <>
            <Button
              icon={TrendingUp}
              variant="secondary"
              onClick={() =>
                confirm(
                  "Fund professional development?",
                  "A development course costs 50,000 and improves coaching, communication and tactical knowledge.",
                  () => {
                    void act({
                      type: "staff",
                      id: staff.id,
                      action: "develop",
                    });
                  },
                )
              }
            >
              Develop
            </Button>
            <Button
              variant="ghost"
              onClick={() =>
                confirm(
                  `Release ${staff.name}?`,
                  `Severance will cost ${money(staff.wage * 26)}. Active scouting assignments will be cancelled.`,
                  () => {
                    void act({
                      type: "staff",
                      id: staff.id,
                      action: "release",
                    });
                  },
                )
              }
            >
              Release
            </Button>
          </>
        )}
      </div>
    </article>
  );
}

export function StaffView() {
  const { bootstrap, act } = useGame();
  const { money } = useCurrency();
  const { data, error } = useResource<StaffDesk>("staff");
  const [tab, setTab] = useState("team");
  const [role, setRole] = useState("");
  if (error) return <ErrorState message={error} />;
  if (!data || !bootstrap) return <Loading />;
  const source = tab === "recruitment" ? data.candidates : data.staff;
  return (
    <div className="page">
      <PageHeading
        eyebrow="THE PEOPLE BEHIND THE PROJECT"
        title="Your backroom team"
        subtitle={`${bootstrap.club.manager} / First-team manager`}
      >
        <Button
          icon={Users}
          variant="secondary"
          onClick={() => setTab("assistant")}
        >
          Assistant responsibilities
        </Button>
      </PageHeading>
      <div className="stat-strip">
        <Stat
          label="Staff members"
          value={data.staff.length}
          icon={Users}
          detail="Coaching and club support"
        />
        <Stat
          label="Average ability"
          value={Math.round(
            data.staff.reduce((sum, staff) => sum + staff.ability, 0) /
              Math.max(1, data.staff.length),
          )}
          icon={TrendingUp}
          detail="Coaching and support quality"
        />
        <Stat
          label="Manager trust"
          value={`${Math.round(bootstrap.club.manager_trust)}%`}
          icon={ShieldCheck}
          detail="Confidence in the sporting direction"
        />
        <Stat
          label="Staff payroll"
          value={money(data.staff.reduce((sum, staff) => sum + staff.wage, 0))}
          icon={Network}
          detail="Per week"
        />
      </div>
      <Panel>
        <Tabs
          items={[
            { id: "team", label: "Staff team" },
            { id: "assistant", label: "Director assistant" },
            { id: "politics", label: "Relationships & politics" },
            { id: "recruitment", label: "Recruit staff" },
          ]}
          value={tab}
          onChange={setTab}
        />
        {tab === "assistant" ? (
          <AssistantPanel />
        ) : tab !== "politics" ? (
          <>
            <div className="filter-bar">
              <select
                aria-label="Staff role filter"
                value={role}
                onChange={(event) => setRole(event.target.value)}
              >
                <option value="">All specialist roles</option>
                {[
                  ...new Set(
                    [...data.staff, ...data.candidates].map(
                      (staff) => staff.role,
                    ),
                  ),
                ].map((value) => (
                  <option key={value}>{value}</option>
                ))}
              </select>
              <span className="muted" style={{ fontSize: ".74rem" }}>
                {source.filter((staff) => !role || staff.role === role).length}{" "}
                people
              </span>
            </div>
            <div className="padded">
              <div className="cards-list">
                {source
                  .filter((staff) => !role || staff.role === role)
                  .map((staff) => (
                    <StaffCard
                      key={staff.id}
                      staff={staff}
                      candidate={tab === "recruitment"}
                    />
                  ))}
              </div>
            </div>
          </>
        ) : (
          <>
            <SectionHeading
              title="Backroom relationships"
              subtitle="Influence, ambition and communication"
            />
            {data.relationships.length ? (
              data.relationships.map((relationship) => (
                <div className="relationship-item" key={relationship.id}>
                  <span className="relationship-symbol">
                    <Network size={20} />
                  </span>
                  <div>
                    <strong>
                      {relationship.source_name}{" "}
                      <span className="muted">&</span>{" "}
                      {relationship.target_name}
                    </strong>
                    <p>
                      {relationship.kind} / Relationship strength{" "}
                      {Math.round(relationship.strength)}
                    </p>
                  </div>
                  <Badge
                    tone={
                      relationship.strength < 0
                        ? "red"
                        : relationship.strength > 50
                          ? "green"
                          : "blue"
                    }
                  >
                    {relationship.strength < 0
                      ? "Friction"
                      : relationship.strength > 50
                        ? "Alliance"
                        : "Professional"}
                  </Badge>
                  <Button
                    variant="secondary"
                    icon={Users}
                    onClick={() =>
                      void act({
                        type: "staff",
                        id: relationship.source_id,
                        action: "mediate",
                      })
                    }
                  >
                    Mediate
                  </Button>
                </div>
              ))
            ) : (
              <Empty
                icon={Network}
                title="A settled backroom"
                detail="New appointments and weekly events will shape staff relationships."
              />
            )}
          </>
        )}
      </Panel>
    </div>
  );
}
