import { useState } from "react";
import {
  ArrowLeftRight,
  ArrowUpRight,
  Bookmark,
  ClipboardCheck,
  HeartHandshake,
  ScanLine,
  Sparkles,
} from "lucide-react";
import {
  Area,
  AreaChart,
  CartesianGrid,
  Legend,
  PolarAngleAxis,
  PolarGrid,
  Radar,
  RadarChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { useGame, useResource } from "./game-context.tsx";
import {
  Badge,
  Button,
  Crest,
  DetailList,
  Empty,
  ErrorState,
  Loading,
  Meter,
  Modal,
  Rating,
  Silhouette,
  Tabs,
} from "./ui.tsx";
import { clamp, dateLabel, label, LOAN_TYPES, money } from "../shared/rules.ts";
import type { PlayerDetail, StaffDesk } from "../shared/api.ts";
import type { Negotiation } from "../shared/types.ts";

interface ReportDetails {
  strengths: string[];
  weaknesses: string[];
  riskFactors: string[];
  projection: string;
  resale: number;
  personalityNotes: string;
  agentDifficulty: number;
  agentPersonality: string;
  recommendation: string;
  bias: string;
}

export default function PlayerSheet() {
  const { playerId, setPlayer, bootstrap, act, navigate, notify } = useGame();
  const { data, error } = useResource<PlayerDetail>(
    playerId ? `players/${playerId}` : null,
  );
  const { data: staff } = useResource<StaffDesk>("staff");
  const [tab, setTab] = useState("overview");
  const [dealType, setDealType] = useState("Permanent transfer");
  const [scoutId, setScoutId] = useState("");
  const [pending, setPending] = useState(false);
  if (!playerId) return null;
  const own =
    data?.player.club_id === bootstrap?.club.id ||
    data?.player.parent_club_id === bootstrap?.club.id;
  async function startEnquiry() {
    if (!data) return;
    setPending(true);
    const result = (await act({
      type: "enquiry",
      playerId: data.player.id,
      dealType: own ? "Contract renewal" : dealType,
    })) as Negotiation | undefined;
    setPending(false);
    if (result?.id) {
      setPlayer(null);
      navigate("transfers");
      notify("Enquiry received. Open the negotiation to submit your terms.");
    }
  }
  async function requestReport() {
    if (!data) return;
    const scout = Number(
      scoutId || staff?.staff.find((member) => member.role === "Scout")?.id,
    );
    if (!scout) {
      notify("Recruit a scout before commissioning a report.", "error");
      return;
    }
    setPending(true);
    await act({
      type: "scout",
      staffId: scout,
      playerId: data.player.id,
      maxAge: 40,
      budget: 1_000_000_000,
    });
    setPending(false);
  }
  const tabs = [
    { id: "overview", label: "Overview" },
    { id: "attributes", label: "Attributes" },
    { id: "development", label: "Development" },
    { id: "scout", label: "Scout report" },
    { id: "contract", label: "Contract & value" },
  ];
  return (
    <Modal title="Player dossier" onClose={() => setPlayer(null)} wide>
      {error ? (
        <div className="sheet-body">
          <ErrorState message={error} />
        </div>
      ) : !data ? (
        <Loading label="Opening player dossier" />
      ) : (
        <>
          <div className="player-profile-header">
            <Silhouette size={100} color={data.player.club_color} hologram />
            <div className="player-profile-identity">
              <div className="inline-controls">
                <Badge tone="green">{data.player.position}</Badge>
                <Badge>{data.player.age_group}</Badge>
                {data.player.injury_until && <Badge tone="red">Injured</Badge>}
              </div>
              <h2>{data.player.name}</h2>
              <div className="profile-meta">
                <Crest
                  name={data.player.club_name ?? "Free agent"}
                  color={data.player.club_color}
                  size={19}
                />
                <span>{data.player.club_name ?? "Free agent"}</span>
              </div>
              <p className="profile-meta" style={{ marginTop: 9 }}>
                {data.player.age} years <span>/</span> {data.player.nationality}{" "}
                <span>/</span> {data.player.foot}-footed
              </p>
            </div>
            <div className="profile-ratings">
              <div>
                <Rating value={data.player.ability} />
                <small>Ability</small>
              </div>
              <div>
                <Rating value={data.player.potential} potential />
                <small>Potential</small>
              </div>
            </div>
          </div>
          <div className="profile-stats">
            <div>
              <small>Market value</small>
              <strong>{money(data.player.value)}</strong>
            </div>
            <div>
              <small>Wage / week</small>
              <strong>{money(data.player.wage)}</strong>
            </div>
            <div>
              <small>Contract until</small>
              <strong>{dateLabel(data.player.contract_end)}</strong>
            </div>
            <div>
              <small>Match rating</small>
              <strong className={data.player.form >= 7 ? "positive" : ""}>
                {data.player.form.toFixed(1)}
              </strong>
            </div>
          </div>
          <Tabs items={tabs} value={tab} onChange={setTab} />
          <div className="profile-body">
            {tab === "overview" && (
              <div className="profile-columns">
                <div>
                  <section className="profile-section">
                    <h3>Player identity</h3>
                    <DetailList
                      items={[
                        ["Date of birth", dateLabel(data.player.birth_date)],
                        [
                          "Height / weight",
                          `${data.profile.identity.height} cm / ${data.profile.identity.weight} kg`,
                        ],
                        ["Body type", data.profile.identity.bodyType],
                        ["Region", data.profile.identity.region],
                        [
                          "Heritage",
                          data.profile.identity.heritage
                            .map(
                              (entry) =>
                                `${entry.country} ${entry.percentage}%`,
                            )
                            .join(", "),
                        ],
                        [
                          "Languages",
                          data.profile.identity.languages
                            .map(
                              (entry) =>
                                `${entry.language.toUpperCase()} ${entry.fluency}/5`,
                            )
                            .join(" / "),
                        ],
                        ["Other position", data.player.secondary_position],
                        ["Squad role", data.player.role],
                        ["Lifestyle", label(data.profile.lifestyle)],
                      ]}
                    />
                  </section>
                  <section className="profile-section">
                    <h3>Career vision</h3>
                    <ul className="bullet-list">
                      {data.profile.careerVision.map((vision) => (
                        <li key={vision}>{vision}</li>
                      ))}
                    </ul>
                  </section>
                  <section className="profile-section">
                    <h3>Player traits</h3>
                    <div className="trait-list">
                      {data.profile.traits.map((trait) => (
                        <span key={trait}>{trait}</span>
                      ))}
                    </div>
                  </section>
                </div>
                <div>
                  <section className="profile-section">
                    <h3>Player profile</h3>
                    <div className="chart-box">
                      <ResponsiveContainer width="100%" height="100%">
                        <RadarChart
                          data={Object.entries(data.profile.attributes)
                            .filter(
                              ([key]) =>
                                key !== "goalkeeper" ||
                                data.player.position === "GK",
                            )
                            .map(([key, attributes]) => ({
                              group: label(key),
                              rating: Math.round(
                                Object.values(attributes).reduce(
                                  (sum, value) => sum + value,
                                  0,
                                ) / Object.values(attributes).length,
                              ),
                            }))}
                        >
                          <PolarGrid stroke="var(--line)" />
                          <PolarAngleAxis
                            dataKey="group"
                            tick={{ fill: "var(--muted)", fontSize: 11 }}
                          />
                          <Radar
                            dataKey="rating"
                            stroke="var(--accent)"
                            fill="var(--accent)"
                            fillOpacity={0.16}
                          />
                          <Tooltip
                            contentStyle={{
                              background: "var(--surface)",
                              borderColor: "var(--line)",
                              borderRadius: 6,
                              fontSize: 12,
                            }}
                          />
                        </RadarChart>
                      </ResponsiveContainer>
                    </div>
                  </section>
                  <section className="profile-section">
                    <h3>Wellbeing</h3>
                    {Object.entries(data.profile.mentalHealth).map(
                      ([key, value]) => (
                        <div className="attribute-row" key={key}>
                          <span className="attribute-label">{label(key)}</span>
                          <Meter
                            value={value}
                            tone={
                              ["anxiety", "burnout"].includes(key)
                                ? value > 60
                                  ? "red"
                                  : "amber"
                                : "green"
                            }
                          />
                          <strong>{Math.round(value)}</strong>
                        </div>
                      ),
                    )}
                    <div className="attribute-row">
                      <span className="attribute-label">Fitness</span>
                      <Meter value={data.player.fitness} />
                      <strong>{Math.round(data.player.fitness)}</strong>
                    </div>
                    <div className="attribute-row">
                      <span className="attribute-label">Morale</span>
                      <Meter value={data.player.morale} />
                      <strong>{Math.round(data.player.morale)}</strong>
                    </div>
                    {own && (
                      <Button
                        variant="secondary"
                        icon={HeartHandshake}
                        onClick={() =>
                          void act({
                            type: "wellbeing",
                            playerId: data.player.id,
                          })
                        }
                      >
                        Arrange wellbeing support
                      </Button>
                    )}
                  </section>
                </div>
              </div>
            )}
            {tab === "attributes" && (
              <>
                <div className="attribute-grid">
                  {Object.entries(data.profile.attributes).map(
                    ([group, attributes]) => (
                      <section className="profile-section" key={group}>
                        <h3>{label(group)}</h3>
                        {Object.entries(attributes).map(([key, value]) => {
                          const adjusted = Math.round(
                            clamp(
                              value +
                                data.player.ability -
                                data.profile.baseAbility,
                            ),
                          );
                          return (
                            <div className="attribute-row" key={key}>
                              <span className="attribute-label">
                                {label(key)}
                              </span>
                              <Meter
                                value={adjusted}
                                tone={
                                  group === "mental"
                                    ? "blue"
                                    : group === "tactical"
                                      ? "violet"
                                      : "green"
                                }
                              />
                              <strong>{adjusted}</strong>
                            </div>
                          );
                        })}
                      </section>
                    ),
                  )}
                  <section className="profile-section">
                    <h3>Personality</h3>
                    {Object.entries(data.profile.personality).map(
                      ([key, value]) => (
                        <div className="attribute-row" key={key}>
                          <span className="attribute-label">{label(key)}</span>
                          <Meter value={value} tone="amber" />
                          <strong>{Math.round(value)}</strong>
                        </div>
                      ),
                    )}
                  </section>
                </div>
              </>
            )}
            {tab === "development" && (
              <div className="profile-columns">
                <div>
                  <section className="profile-section">
                    <h3>Dynamic potential</h3>
                    <div className="potential-range">
                      <span>{data.development.low}</span>
                      <div>
                        <Meter value={data.player.potential} />
                        <small>
                          Current range / volatility {data.player.volatility}
                        </small>
                      </div>
                      <span>{data.development.high}</span>
                    </div>
                    <DetailList
                      items={[
                        [
                          "Base potential",
                          Math.round(data.player.base_potential),
                        ],
                        [
                          "Current potential",
                          Math.round(data.player.potential),
                        ],
                        [
                          "Weekly environment",
                          <span
                            key="weekly-environment"
                            className={
                              data.development.change >= 0
                                ? "positive"
                                : "negative"
                            }
                          >
                            {data.development.change >= 0 ? "+" : ""}
                            {data.development.change.toFixed(3)}
                          </span>,
                        ],
                        ["Training", data.player.training],
                        ["Training load", `${data.player.intensity}%`],
                        [
                          "Growth spurt",
                          data.profile.development.growthSpurt
                            ? "Under way"
                            : "Not recorded",
                        ],
                        [
                          "Mentorship",
                          data.profile.development.mentorId ? (
                            <button
                              key="mentor"
                              className="text-link"
                              onClick={() =>
                                setPlayer(data.profile.development.mentorId)
                              }
                            >
                              View mentor <ArrowUpRight size={13} />
                            </button>
                          ) : (
                            "Not assigned"
                          ),
                        ],
                      ]}
                    />
                  </section>
                  <div className="chart-box">
                    <ResponsiveContainer width="100%" height="100%">
                      <AreaChart
                        data={data.profile.development.history}
                        margin={{ top: 10, right: 5, left: -30, bottom: 0 }}
                      >
                        <CartesianGrid
                          strokeDasharray="3 3"
                          stroke="var(--line)"
                          vertical={false}
                        />
                        <XAxis
                          dataKey="date"
                          tick={{ fontSize: 10, fill: "var(--muted)" }}
                          tickFormatter={(value: string) => value.slice(5)}
                          axisLine={false}
                          tickLine={false}
                        />
                        <YAxis
                          domain={[0, 100]}
                          tick={{ fontSize: 10, fill: "var(--muted)" }}
                          axisLine={false}
                          tickLine={false}
                        />
                        <Tooltip
                          contentStyle={{
                            background: "var(--surface)",
                            borderColor: "var(--line)",
                            fontSize: 12,
                          }}
                        />
                        <Legend
                          iconType="circle"
                          wrapperStyle={{ fontSize: 11 }}
                        />
                        <Area
                          type="monotone"
                          dataKey="potential"
                          name="Potential"
                          stroke="var(--violet)"
                          fill="var(--violet)"
                          fillOpacity={0.08}
                        />
                        <Area
                          type="monotone"
                          dataKey="ability"
                          name="Ability"
                          stroke="var(--accent)"
                          fill="var(--accent)"
                          fillOpacity={0.12}
                        />
                      </AreaChart>
                    </ResponsiveContainer>
                  </div>
                </div>
                <section className="profile-section">
                  <h3>Development influences</h3>
                  {Object.entries(data.development.factors).map(
                    ([key, value]) => (
                      <div className="development-factor" key={key}>
                        <span>{label(key)}</span>
                        <Meter
                          value={Math.abs(value) * 100}
                          tone={value >= 0 ? "green" : "red"}
                        />
                        <strong
                          className={value >= 0 ? "positive" : "negative"}
                        >
                          {value >= 0 ? "+" : ""}
                          {value.toFixed(2)}
                        </strong>
                      </div>
                    ),
                  )}
                </section>
              </div>
            )}
            {tab === "scout" &&
              (data.report ? (
                (() => {
                  const report = JSON.parse(data.report.data) as ReportDetails;
                  return (
                    <>
                      <div className="scout-report-heading">
                        <div>
                          <Badge tone="green">{report.recommendation}</Badge>
                          <h3>{data.report.scout_name}</h3>
                          <p>
                            {dateLabel(data.report.date)} /{" "}
                            {data.report.accuracy}% accuracy / {report.bias}{" "}
                            preference
                          </p>
                        </div>
                        <div className="compact-stats">
                          <div>
                            <small>Ability estimate</small>
                            <strong>
                              {data.report.ability_low}-
                              {data.report.ability_high}
                            </strong>
                          </div>
                          <div>
                            <small>Potential estimate</small>
                            <strong>
                              {data.report.potential_low}-
                              {data.report.potential_high}
                            </strong>
                          </div>
                        </div>
                      </div>
                      <div className="profile-columns">
                        <div>
                          <section className="profile-section">
                            <h3>Strengths</h3>
                            <ul className="bullet-list">
                              {report.strengths.map((text) => (
                                <li key={text}>{text}</li>
                              ))}
                            </ul>
                          </section>
                          <section className="profile-section">
                            <h3>Weaknesses</h3>
                            <ul className="bullet-list">
                              {report.weaknesses.map((text) => (
                                <li key={text}>{text}</li>
                              ))}
                            </ul>
                          </section>
                          <section className="profile-section">
                            <h3>Risk factors</h3>
                            <ul className="bullet-list">
                              {report.riskFactors.map((text) => (
                                <li key={text}>{text}</li>
                              ))}
                            </ul>
                          </section>
                        </div>
                        <div>
                          <section className="profile-section">
                            <h3>Development projection</h3>
                            <p className="dossier-copy">{report.projection}</p>
                          </section>
                          <section className="profile-section">
                            <h3>Personality notes</h3>
                            <p className="dossier-copy">
                              {report.personalityNotes}
                            </p>
                          </section>
                          <DetailList
                            items={[
                              ["Tactical fit", `${data.report.fit}/100`],
                              ["Risk score", `${data.report.risk}/100`],
                              ["Projected resale", money(report.resale)],
                              [
                                "Agent difficulty",
                                `${report.agentDifficulty}/100`,
                              ],
                              ["Agent personality", report.agentPersonality],
                            ]}
                          />
                        </div>
                      </div>
                    </>
                  );
                })()
              ) : (
                <Empty
                  icon={ScanLine}
                  title="No scout report yet"
                  detail="The scouting team has not assessed this player."
                >
                  <Button
                    icon={ScanLine}
                    onClick={() => void requestReport()}
                    disabled={pending}
                  >
                    Commission report
                  </Button>
                </Empty>
              ))}
            {tab === "contract" && (
              <div className="profile-columns">
                <div>
                  <section className="profile-section">
                    <h3>Contract & representation</h3>
                    <DetailList
                      items={[
                        ["Weekly wage", money(data.player.wage, true)],
                        ["Annual salary", money(data.player.wage * 52)],
                        ["Expires", dateLabel(data.player.contract_end)],
                        ["Role", data.player.role],
                        ["Agent", data.profile.agent.name],
                        ["Agent approach", data.profile.agent.personality],
                        [
                          "Agent commission",
                          `${data.profile.agent.commission}%`,
                        ],
                        [
                          "Agent frustration",
                          `${data.profile.agent.frustration}/100`,
                        ],
                        ["Transfer listed", data.player.listed ? "Yes" : "No"],
                        [
                          "Available on loan",
                          data.player.available_loan ? "Yes" : "No",
                        ],
                      ]}
                    />
                  </section>
                  <section className="profile-section">
                    <h3>Contract promises</h3>
                    {data.promises.length ? (
                      data.promises.map((promise) => (
                        <div className="attribute-row" key={promise.id}>
                          <span className="attribute-label">
                            {promise.type}
                          </span>
                          <Badge
                            tone={
                              promise.status === "broken"
                                ? "red"
                                : promise.status === "fulfilled"
                                  ? "green"
                                  : "amber"
                            }
                          >
                            {promise.status}
                          </Badge>
                        </div>
                      ))
                    ) : (
                      <p className="dossier-copy">No active promises.</p>
                    )}
                  </section>
                </div>
                <section className="profile-section">
                  <h3>Transfer value breakdown</h3>
                  <DetailList
                    items={Object.entries(data.value.layers).map(
                      ([name, value]) => [
                        name,
                        name === "Player quality"
                          ? money(value)
                          : `${value.toFixed(2)}x`,
                      ],
                    )}
                  />
                  <div className="valuation-total">
                    <span>Current market value</span>
                    <strong>{money(data.value.value)}</strong>
                  </div>
                </section>
              </div>
            )}
          </div>
          <footer className="sheet-footer">
            <div className="footer-left">
              <Button
                variant="secondary"
                icon={Bookmark}
                onClick={() =>
                  void act({
                    type: "shortlist",
                    playerId: data.player.id,
                    active: !data.player.shortlisted,
                  })
                }
              >
                {data.player.shortlisted ? "Shortlisted" : "Shortlist"}
              </Button>
              <select
                aria-label="Choose scout"
                className="scout-select"
                value={scoutId}
                onChange={(event) => setScoutId(event.target.value)}
              >
                <option value="">Lead scout</option>
                {staff?.staff
                  .filter((member) => member.role === "Scout")
                  .map((member) => (
                    <option value={member.id} key={member.id}>
                      {member.name}
                    </option>
                  ))}
              </select>
              <Button
                icon={ScanLine}
                variant="secondary"
                onClick={() => void requestReport()}
                disabled={pending}
              >
                Scout
              </Button>
            </div>
            {own && data.player.age_group !== "Senior" ? (
              <Button
                icon={Sparkles}
                onClick={() =>
                  void act({ type: "promote", playerId: data.player.id })
                }
              >
                Promote to first team
              </Button>
            ) : (
              <>
                {!own && (
                  <select
                    aria-label="Enquiry type"
                    value={dealType}
                    onChange={(event) => setDealType(event.target.value)}
                  >
                    <option>Permanent transfer</option>
                    {LOAN_TYPES.map((type) => (
                      <option key={type}>{type}</option>
                    ))}
                  </select>
                )}
                <Button
                  icon={own ? ClipboardCheck : ArrowLeftRight}
                  onClick={() => void startEnquiry()}
                  disabled={pending || !!data.player.parent_club_id}
                >
                  {own ? "Renew contract" : "Make enquiry"}
                </Button>
              </>
            )}
          </footer>
        </>
      )}
    </Modal>
  );
}
