import { useState } from "react";
import {
  ArrowLeftRight,
  ArrowUpRight,
  Bookmark,
  ClipboardCheck,
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  HeartHandshake,
  ScanLine,
  UserX,
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
import { useCurrency, useGame, useResource } from "./game-context.tsx";
import InterestSummary from "./InterestSummary.tsx";
import {
  Badge,
  Button,
  ClubLink,
  DetailList,
  Empty,
  ErrorState,
  Field,
  Loading,
  IconButton,
  Meter,
  Modal,
  Rating,
  Silhouette,
  Tabs,
} from "./ui.tsx";
import {
  clamp,
  compactNumber,
  dateLabel,
  label,
  transferWindow,
} from "../shared/rules.ts";
import type { PlayerCareer, PlayerDetail, StaffDesk } from "../shared/api.ts";
import {
  bodyLabel,
  bodyOf,
  clubLabel,
  isHomeBased,
  isMissingPlayer,
} from "./players.ts";

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

function CareerMatches({ playerId }: { playerId: number }) {
  const { openMatch, openLeague } = useGame();
  const [season, setSeason] = useState("");
  const [competition, setCompetition] = useState("");
  const [page, setPage] = useState(1);
  const params = new URLSearchParams({ page: String(page) });
  if (season) params.set("season", season);
  if (competition) params.set("competition", competition);
  const { data, error, loading } = useResource<PlayerCareer>(
    `players/${playerId}/career?${params}`,
  );
  if (error) return <ErrorState message={error} />;
  if (!data) return <Loading label="Opening career match history" />;
  if (!data.seasons.length)
    return (
      <Empty
        icon={CalendarDays}
        title="No simulated appearances yet"
        detail="Every competitive match and friendly played in this career will be recorded here."
      />
    );
  const summary = data.seasons.find(
    (entry) => entry.season === data.selectedSeason,
  )!;
  return (
    <div className="career-match-history">
      <div className="career-history-controls">
        <label className="field">
          <span>Season</span>
          <select
            aria-label="Player career season"
            value={data.selectedSeason ?? ""}
            onChange={(event) => {
              setSeason(event.target.value);
              setCompetition("");
              setPage(1);
            }}
          >
            {data.seasons.map((entry) => (
              <option key={entry.season} value={entry.season}>
                {entry.season}/{String(entry.season + 1).slice(-2)}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>Competition</span>
          <select
            aria-label="Player career competition"
            value={competition}
            onChange={(event) => {
              setCompetition(event.target.value);
              setPage(1);
            }}
          >
            <option value="">All competitions</option>
            {data.competitions.map((entry) => (
              <option key={entry.id ?? 0} value={entry.id ?? 0}>
                {entry.name}
              </option>
            ))}
          </select>
        </label>
      </div>
      <div className="career-season-summary">
        <span>
          <small>Appearances</small>
          <strong>{summary?.appearances ?? 0}</strong>
        </span>
        <span>
          <small>Starts</small>
          <strong>{summary?.starts ?? 0}</strong>
        </span>
        <span>
          <small>Minutes</small>
          <strong>{compactNumber(summary?.minutes ?? 0)}</strong>
        </span>
        <span>
          <small>Goals / assists</small>
          <strong>
            {summary?.goals ?? 0} / {summary?.assists ?? 0}
          </strong>
        </span>
        <span>
          <small>Average rating</small>
          <strong>{summary?.rating.toFixed(2) ?? "-"}</strong>
        </span>
      </div>
      <div className="career-team-links">
        {data.teams.map((team) => (
          <span key={team.id}>
            <ClubLink id={team.id} name={team.name} color={team.color} crest />
            <small>
              {team.appearances} apps / {team.minutes}'
            </small>
          </span>
        ))}
      </div>
      <div className="table-scroll">
        <table className="data-table career-matches-table">
          <thead>
            <tr>
              <th>Date</th>
              <th>Match</th>
              <th>Competition</th>
              <th>Minutes</th>
              <th>Rating</th>
              <th>G / A</th>
              <th>xG / xA</th>
              <th>Report</th>
            </tr>
          </thead>
          <tbody>
            {data.appearances.map((appearance) => (
              <tr key={appearance.fixture_id}>
                <td>{dateLabel(appearance.date)}</td>
                <td>
                  <div className="career-match-teams">
                    <ClubLink
                      id={appearance.home_id}
                      name={appearance.home_name}
                      color={appearance.home_color}
                    />
                    <button
                      className="match-result-link"
                      title="Open player match report"
                      onClick={() => openMatch(appearance.fixture_id, playerId)}
                    >
                      {appearance.home_goals} - {appearance.away_goals}
                    </button>
                    <ClubLink
                      id={appearance.away_id}
                      name={appearance.away_name}
                      color={appearance.away_color}
                    />
                  </div>
                </td>
                <td>
                  {appearance.league_id ? (
                    <button
                      className="profile-link muted"
                      onClick={() => openLeague(appearance.league_id!)}
                    >
                      {appearance.competition_name}
                    </button>
                  ) : (
                    <span className="muted">Friendly</span>
                  )}
                </td>
                <td>
                  <strong>{appearance.minutes}'</strong>
                  <small className="appearance-status">
                    {appearance.started
                      ? "Starter"
                      : `On ${appearance.minute_on}'`}
                    {appearance.minute_off
                      ? ` / Off ${appearance.minute_off}'`
                      : ""}
                  </small>
                </td>
                <td>
                  <Badge
                    tone={
                      appearance.rating >= 7
                        ? "green"
                        : appearance.rating < 6
                          ? "red"
                          : "amber"
                    }
                  >
                    {appearance.rating.toFixed(1)}
                  </Badge>
                </td>
                <td>
                  {appearance.goals} / {appearance.assists}
                </td>
                <td
                  title={
                    appearance.stats.xG === undefined
                      ? "Detailed match stats are kept only for your club's teams and loanees"
                      : undefined
                  }
                >
                  {appearance.stats.xG === undefined
                    ? "—"
                    : `${appearance.stats.xG.toFixed(2)} / ${(appearance.stats.xA ?? 0).toFixed(2)}`}
                </td>
                <td>
                  <Button
                    icon={ArrowUpRight}
                    variant="secondary"
                    onClick={() => openMatch(appearance.fixture_id, playerId)}
                  >
                    Match report
                  </Button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="pagination">
        <span>{data.total} appearances this selection</span>
        <span className="pagination-actions">
          <IconButton
            icon={ChevronLeft}
            label="Previous appearances"
            disabled={data.page <= 1 || loading}
            onClick={() => setPage(data.page - 1)}
          />
          {data.page} / {data.pages}
          <IconButton
            icon={ChevronRight}
            label="Next appearances"
            disabled={data.page >= data.pages || loading}
            onClick={() => setPage(data.page + 1)}
          />
        </span>
      </div>
    </div>
  );
}

export default function PlayerSheet() {
  const { playerId, setPlayer, bootstrap, act, navigate, notify, openOffer } =
    useGame();
  const { money } = useCurrency();
  const { data, error } = useResource<PlayerDetail>(
    playerId ? `players/${playerId}` : null,
  );
  const { data: staff } = useResource<StaffDesk>("staff");
  const [tab, setTab] = useState("overview");
  const [scoutId, setScoutId] = useState("");
  const [pending, setPending] = useState(false);
  const [squadChoice, setSquadChoice] = useState<{
    playerId: number;
    value: string;
  } | null>(null);
  if (!playerId) return null;
  const own = data?.canManage ?? false;
  const currentSquad = data?.squadDestinations.find((entry) => entry.current);
  const squadValue =
    squadChoice?.playerId === playerId
      ? squadChoice.value
      : currentSquad
        ? `${currentSquad.clubId}:${currentSquad.ageGroup}`
        : "";
  const targetSquad = data?.squadDestinations.find(
    (entry) => `${entry.clubId}:${entry.ageGroup}` === squadValue,
  );
  const body = data ? bodyOf(data.player, data.profile) : null;
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
    { id: "career", label: "Career & matches" },
    { id: "attributes", label: "Attributes" },
    { id: "development", label: "Development" },
    { id: "scout", label: "Scout report" },
    { id: "contract", label: "Contract & value" },
  ];
  return (
    <Modal title="Player dossier" onClose={() => setPlayer(null)} wide>
      {isMissingPlayer(error) ? (
        <div className="sheet-body">
          <Empty
            icon={UserX}
            title="Player record archived"
            detail="This player has left football and is no longer in the database. Results, transfers and news that mention them are kept."
          />
        </div>
      ) : error ? (
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
                {isHomeBased(data.player, data.profile) && (
                  <Badge tone="blue">Home-based pool</Badge>
                )}
              </div>
              <h2>{data.player.name}</h2>
              <div className="profile-meta">
                <ClubLink
                  id={data.player.club_id}
                  name={clubLabel(data.player, data.profile)}
                  color={data.player.club_color}
                  crest
                />
              </div>
              <p className="profile-meta" style={{ marginTop: 9 }}>
                {data.player.age} years <span>/</span>{" "}
                {(data.player.nationalities ?? [data.player.nationality]).join(
                  " / ",
                )}{" "}
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
            {tab === "career" && <CareerMatches playerId={playerId} />}
            {tab === "overview" && (
              <div className="profile-columns">
                <div>
                  <section className="profile-section">
                    <h3>Player identity</h3>
                    <DetailList
                      items={[
                        ["Date of birth", dateLabel(data.player.birth_date)],
                        [
                          "Birthplace",
                          data.profile.identity.birthplace ??
                            data.profile.identity.region,
                        ],
                        [
                          "Nationalities",
                          (
                            data.player.nationalities ?? [
                              data.player.nationality,
                            ]
                          ).join(" / "),
                        ],
                        [
                          "International representation",
                          data.player.nationality,
                        ],
                        [
                          "Height / weight",
                          `${bodyLabel(body!)}${body!.growing ? " / still growing" : ""}`,
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
                  {own && (
                    <section className="profile-section">
                      <h3>Squad assignment</h3>
                      <div className="form-grid">
                        <Field label="Playing squad" className="span-2">
                          <select
                            aria-label="Playing squad"
                            value={squadValue}
                            onChange={(event) =>
                              setSquadChoice({
                                playerId,
                                value: event.target.value,
                              })
                            }
                          >
                            {!currentSquad && (
                              <option value="">Choose squad</option>
                            )}
                            {data.squadDestinations.map((entry) => (
                              <option
                                key={`${entry.clubId}:${entry.ageGroup}`}
                                value={`${entry.clubId}:${entry.ageGroup}`}
                                disabled={!entry.eligible}
                              >
                                {entry.label}
                                {entry.eligible ? "" : " (unavailable)"}
                              </option>
                            ))}
                          </select>
                        </Field>
                      </div>
                      {data.squadDestinations.some((entry) => entry.reason) && (
                        <ul className="squad-move-notes" aria-label="Unavailable squads">
                          {data.squadDestinations
                            .filter((entry) => entry.reason)
                            .map((entry) => (
                              <li key={`${entry.clubId}:${entry.ageGroup}`}>
                                <strong>{entry.label}</strong> {entry.reason}
                              </li>
                            ))}
                        </ul>
                      )}
                      <Button
                        icon={ArrowLeftRight}
                        variant="secondary"
                        disabled={
                          pending ||
                          !targetSquad?.eligible ||
                          targetSquad.current
                        }
                        onClick={() => {
                          if (!targetSquad) return;
                          setPending(true);
                          void act({
                            type: "squad-move",
                            playerId,
                            clubId: targetSquad.clubId,
                            ageGroup: targetSquad.ageGroup,
                          }).finally(() => setPending(false));
                        }}
                      >
                        Move player
                      </Button>
                    </section>
                  )}
                  {!!data.profile.identity.biography?.length && (
                    <section className="profile-section">
                      <h3>Personal history</h3>
                      {data.profile.identity.biography.map((entry) => (
                        <p key={entry}>{entry}</p>
                      ))}
                    </section>
                  )}
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
                          "Physical development",
                          data.profile.development.growthSpurt
                            ? "Growth spurt under way"
                            : body!.growing
                              ? "Still growing"
                              : "Fully grown",
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
                  <InterestSummary assessment={data.interest} />
                  <section className="profile-section">
                    <h3>Contract & representation</h3>
                    <DetailList
                      items={[
                        [
                          "Contract status",
                          data.youthTransfer.contractStatus === "amateur"
                            ? "Non-professional registration"
                            : "Protected contract",
                        ],
                        ["Weekly wage", money(data.player.wage)],
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
                  {data.youthTransfer.minor && (
                    <section className="profile-section">
                      <h3>Youth transfer eligibility</h3>
                      <Badge
                        tone={
                          data.youthTransfer.approved
                            ? "green"
                            : data.youthTransfer.eligibleToApply
                              ? "amber"
                              : "red"
                        }
                      >
                        {data.youthTransfer.status}
                      </Badge>
                      {data.youthTransfer.reasons.map((reason) => (
                        <p className="dossier-copy" key={reason}>
                          {reason}
                        </p>
                      ))}
                      {data.youthTransfer.canApproachWithoutFee && (
                        <DetailList
                          items={[
                            ["Transfer fee", money(0)],
                            [
                              "Training compensation estimate",
                              money(data.youthTransfer.trainingCompensation),
                            ],
                          ]}
                        />
                      )}
                    </section>
                  )}
                  <section className="profile-section">
                    <h3>Transfer clauses</h3>
                    {!data.buyBackClauses.length &&
                      !data.sellOnClauses.length && (
                        <p className="dossier-copy">
                          No active transfer clauses.
                        </p>
                      )}
                    {data.buyBackClauses.map((clause) => (
                      <div key={clause.id}>
                        <DetailList
                          items={[
                            [
                              "Buy-back right",
                              <ClubLink
                                key="beneficiary"
                                id={clause.beneficiary_id}
                                name={clause.beneficiary_name ?? "Club"}
                              />,
                            ],
                            ["Fixed price", money(clause.fee)],
                            ["Expires", dateLabel(clause.expires)],
                          ]}
                        />
                        {bootstrap &&
                          clause.beneficiary_id === bootstrap.club.id && (
                            <Button
                              variant="secondary"
                              icon={ArrowLeftRight}
                              disabled={!transferWindow(bootstrap.state.date)}
                              onClick={() =>
                                void act({
                                  type: "buy-back",
                                  id: clause.id,
                                }).then((result) => {
                                  if (result) {
                                    setPlayer(null);
                                    navigate("transfers");
                                  }
                                })
                              }
                            >
                              Open buy-back talks
                            </Button>
                          )}
                      </div>
                    ))}
                    {data.sellOnClauses.map((clause) => (
                      <DetailList
                        key={clause.id}
                        items={[
                          [
                            "Sell-on beneficiary",
                            <ClubLink
                              key="beneficiary"
                              id={clause.beneficiary_id}
                              name={clause.beneficiary_name}
                            />,
                          ],
                          ["Percentage of next sale", `${clause.percentage}%`],
                          ["Received", money(clause.paid)],
                        ]}
                      />
                    ))}
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
                  {data.registration && (
                    <section className="profile-section">
                      <h3>Registration assessment</h3>
                      <Badge
                        tone={data.registration.allowed ? "green" : "amber"}
                      >
                        {data.registration.status}
                      </Badge>
                      <DetailList
                        items={[
                          [
                            "GBE points",
                            `${data.registration.points}/${data.registration.threshold}`,
                          ],
                          ...Object.entries(data.registration.breakdown).map(
                            ([key, value]) => [key, value] as [string, number],
                          ),
                        ]}
                      />
                    </section>
                  )}
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
            {
              <>
                <Button
                  icon={own ? ClipboardCheck : ArrowLeftRight}
                  onClick={() => openOffer(data.player.id)}
                  disabled={pending || !!data.player.parent_club_id}
                >
                  {own ? "Renew contract" : "Make an offer"}
                </Button>
              </>
            }
          </footer>
        </>
      )}
    </Modal>
  );
}
