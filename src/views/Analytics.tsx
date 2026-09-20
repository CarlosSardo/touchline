import { useState } from "react";
import {
  Activity,
  ArrowUpRight,
  Clock,
  Flag,
  Goal,
  Trophy,
} from "lucide-react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { useGame, useResource } from "../game-context.tsx";
import {
  Badge,
  Button,
  Crest,
  Empty,
  ErrorState,
  FixtureRow,
  Loading,
  PageHeading,
  Panel,
  SectionHeading,
  Tabs,
} from "../ui.tsx";
import PitchMap from "../PitchMap.tsx";
import { dateLabel, label, MAP_MODES } from "../../shared/rules.ts";
import type { MatchDetail } from "../../shared/api.ts";
import type { Fixture } from "../../shared/types.ts";

const stats: [string, string][] = [
  ["possession", "Possession %"],
  ["shots", "Shots"],
  ["shotsOnTarget", "On target"],
  ["xG", "Expected goals"],
  ["xA", "Expected assists"],
  ["passes", "Passes"],
  ["completedPasses", "Completed passes"],
  ["progressivePasses", "Progressive passes"],
  ["keyPasses", "Key passes"],
  ["carries", "Carries"],
  ["dribbles", "Dribbles"],
  ["successfulDribbles", "Successful dribbles"],
  ["duels", "Duels"],
  ["duelsWon", "Duels won"],
  ["tackles", "Tackles"],
  ["interceptions", "Interceptions"],
  ["recoveries", "Recoveries"],
  ["presses", "Presses"],
  ["saves", "GK saves"],
  ["xGPrevented", "xG prevented"],
  ["corners", "Corners"],
  ["fouls", "Fouls"],
];

export default function Analytics() {
  const { bootstrap, fixtureId, openMatch, setPlayer, navigate } = useGame();
  const [age, setAge] = useState("Senior");
  const { data: fixtures } = useResource<Fixture[]>(`matches?age=${age}`);
  const selectedId =
    fixtureId ??
    fixtures?.find((fixture) => fixture.status === "played")?.id ??
    [...(fixtures ?? [])]
      .reverse()
      .find((fixture) => fixture.status === "scheduled")?.id;
  const { data, error } = useResource<MatchDetail>(
    selectedId ? `matches/${selectedId}` : null,
  );
  const [tab, setTab] = useState("analysis");
  const [mode, setMode] = useState("Pass map");
  const [selection, setSelection] = useState<{
    fixtureId: number | undefined;
    teamId: number;
    playerId: number;
  } | null>(null);
  const teamId =
    selection && selection.fixtureId === selectedId
      ? selection.teamId
      : (data?.snapshot?.home.id ?? 0);
  const playerId =
    selection && selection.fixtureId === selectedId ? selection.playerId : 0;
  const setTeamId = (id: number) =>
    setSelection({ fixtureId: selectedId, teamId: id, playerId: 0 });
  const setPlayerId = (id: number) =>
    setSelection((current) => ({
      fixtureId: selectedId,
      teamId:
        current && current.fixtureId === selectedId ? current.teamId : teamId,
      playerId: id,
    }));
  const [minute, setMinute] = useState(90);
  const [progressive, setProgressive] = useState(false);
  if (!bootstrap) return <Loading />;
  const lineup = data?.snapshot
    ? [data.snapshot.home, data.snapshot.away]
        .filter((team) => !teamId || team.id === teamId)
        .flatMap((team) => team.lineup)
    : [];
  const result = data?.result;
  const snapshot = data?.snapshot;
  const visibleActions =
    result?.actions.filter(
      (action) =>
        (!teamId || action.teamId === teamId) &&
        (!playerId || action.playerId === playerId) &&
        action.minute <= minute &&
        (bootstrap.settings.matchDetail === "full" ||
          (bootstrap.settings.matchDetail === "standard" &&
            (action.type !== "pass" || action.progressive || action.key)) ||
          (bootstrap.settings.matchDetail === "key events" &&
            ["shot", "save", "set piece", "foul"].includes(action.type))),
    ) ?? [];
  return (
    <div className="page">
      <PageHeading
        eyebrow="PERFORMANCE INTELLIGENCE"
        title="Match centre"
        subtitle={`${bootstrap.club.name} / Analyst's desk`}
      >
        <Button
          icon={Flag}
          variant="secondary"
          onClick={() => navigate("training")}
        >
          Set-piece design
        </Button>
      </PageHeading>
      <div className="match-selector">
        <select
          aria-label="Match age group"
          value={age}
          onChange={(event) => setAge(event.target.value)}
        >
          <option>Senior</option>
          <option>U19</option>
          <option>U17</option>
        </select>
        <select
          aria-label="Select match"
          value={selectedId ?? ""}
          onChange={(event) => openMatch(Number(event.target.value))}
        >
          {[...(fixtures ?? [])]
            .sort((left, right) =>
              left.status === right.status
                ? left.status === "played"
                  ? right.date.localeCompare(left.date)
                  : left.date.localeCompare(right.date)
                : left.status === "played"
                  ? -1
                  : 1,
            )
            .map((fixture) => (
              <option key={fixture.id} value={fixture.id}>
                {dateLabel(fixture.date)} / {fixture.home_name}{" "}
                {fixture.status === "played"
                  ? `${fixture.home_goals}-${fixture.away_goals}`
                  : "v"}{" "}
                {fixture.away_name}
              </option>
            ))}
        </select>
      </div>
      {error ? (
        <ErrorState message={error} />
      ) : !data ? (
        <Loading label="Opening match centre" />
      ) : (
        <>
          <Panel>
            <div className="scoreboard-meta">
              {data.fixture.competition_name ?? "Pre-season friendly"} /{" "}
              {data.fixture.stage} / {dateLabel(data.fixture.date)}
            </div>
            <div className="scoreboard">
              <div className="scoreboard-team">
                <Crest
                  name={data.fixture.home_name ?? ""}
                  color={data.fixture.home_color}
                  size={58}
                />
                <h3>{data.fixture.home_name}</h3>
              </div>
              <div className="scoreboard-score">
                <strong>
                  {data.fixture.status === "played"
                    ? `${data.fixture.home_goals} : ${data.fixture.away_goals}`
                    : "VS"}
                </strong>
                <small>
                  {data.fixture.status === "played"
                    ? "FULL TIME"
                    : "15:00 / SCHEDULED"}
                </small>
                {data.penalties && (
                  <small>
                    Penalties {data.penalties.home} - {data.penalties.away}
                  </small>
                )}
              </div>
              <div className="scoreboard-team">
                <Crest
                  name={data.fixture.away_name ?? ""}
                  color={data.fixture.away_color}
                  size={58}
                />
                <h3>{data.fixture.away_name}</h3>
              </div>
            </div>
            <div className="scoreboard-footer">
              {result && (
                <>
                  <span>
                    xG{" "}
                    <strong>
                      {result.homeXg.toFixed(2)} - {result.awayXg.toFixed(2)}
                    </strong>
                  </span>
                  <span>
                    xPts{" "}
                    <strong>
                      {result.homeXpts.toFixed(2)} -{" "}
                      {result.awayXpts.toFixed(2)}
                    </strong>
                  </span>
                </>
              )}
              <span>{snapshot?.weather ?? "Pre-match"}</span>
            </div>
          </Panel>
          {result && snapshot ? (
            <div className="section-space">
              <Panel>
                <Tabs
                  items={[
                    { id: "analysis", label: "Pitch analysis" },
                    { id: "stats", label: "Match statistics" },
                    { id: "players", label: "Player performance" },
                    {
                      id: "events",
                      label: "Action log",
                      count: result.actions.length,
                    },
                    { id: "timeline", label: "Match story" },
                  ]}
                  value={tab}
                  onChange={setTab}
                />
                {tab === "analysis" && (
                  <>
                    <div className="analytics-controls">
                      <select
                        aria-label="Pitch map type"
                        value={mode}
                        onChange={(event) => setMode(event.target.value)}
                      >
                        {MAP_MODES.map((value) => (
                          <option key={value}>{value}</option>
                        ))}
                      </select>
                      <select
                        aria-label="Analysis team"
                        value={teamId}
                        onChange={(event) => {
                          setTeamId(Number(event.target.value));
                          setPlayerId(0);
                        }}
                      >
                        <option value="0">Both teams</option>
                        <option value={snapshot.home.id}>
                          {snapshot.home.name}
                        </option>
                        <option value={snapshot.away.id}>
                          {snapshot.away.name}
                        </option>
                      </select>
                      <select
                        aria-label="Analysis player"
                        value={playerId}
                        onChange={(event) =>
                          setPlayerId(Number(event.target.value))
                        }
                      >
                        <option value="0">All players</option>
                        {lineup.map((player) => (
                          <option key={player.id} value={player.id}>
                            {player.name}
                          </option>
                        ))}
                      </select>
                      {mode === "Pass map" && (
                        <label className="checkbox-field">
                          <input
                            type="checkbox"
                            checked={progressive}
                            onChange={(event) =>
                              setProgressive(event.target.checked)
                            }
                          />
                          Progressive only
                        </label>
                      )}
                    </div>
                    <div className="analysis-layout">
                      <PitchMap
                        actions={result.actions}
                        mode={mode}
                        teamId={teamId}
                        playerId={playerId}
                        minute={minute}
                        progressive={progressive}
                      />
                      <div className="analysis-sidebar">
                        <SectionHeading title="Match snapshot" />
                        {stats.slice(0, 9).map(([key, title]) => (
                          <div className="match-stat" key={key}>
                            <strong>
                              {Number(
                                result.stats[snapshot.home.id][key],
                              ).toFixed(key === "xG" || key === "xA" ? 2 : 0)}
                            </strong>
                            <span>{title}</span>
                            <strong>
                              {Number(
                                result.stats[snapshot.away.id][key],
                              ).toFixed(key === "xG" || key === "xA" ? 2 : 0)}
                            </strong>
                          </div>
                        ))}
                      </div>
                    </div>
                    <div className="minute-control">
                      <Clock size={15} />
                      <span>0'</span>
                      <input
                        aria-label="Analysis up to minute"
                        type="range"
                        min="1"
                        max="90"
                        value={minute}
                        onChange={(event) =>
                          setMinute(Number(event.target.value))
                        }
                      />
                      <strong>{minute}'</strong>
                    </div>
                  </>
                )}
                {tab === "stats" && (
                  <div className="match-stats-grid">
                    {stats.map(([key, title]) => (
                      <div className="match-stat" key={key}>
                        <strong>
                          {Number(result.stats[snapshot.home.id][key]).toFixed(
                            ["xG", "xA", "xGPrevented"].includes(key) ? 2 : 0,
                          )}
                        </strong>
                        <span>{title}</span>
                        <strong>
                          {Number(result.stats[snapshot.away.id][key]).toFixed(
                            ["xG", "xA", "xGPrevented"].includes(key) ? 2 : 0,
                          )}
                        </strong>
                      </div>
                    ))}
                  </div>
                )}
                {tab === "players" && (
                  <>
                    {[snapshot.home, snapshot.away].map((team) => (
                      <section key={team.id}>
                        <SectionHeading
                          title={team.name}
                          subtitle={`${team.formation} / ${team.style}`}
                        />
                        <div className="table-scroll">
                          <table className="data-table">
                            <thead>
                              <tr>
                                <th>Player</th>
                                <th>Pos</th>
                                <th>Rating</th>
                                <th>Goals</th>
                                <th>Assists</th>
                                <th>Passes</th>
                                <th>Key passes</th>
                                <th>xG</th>
                                <th>xA</th>
                                <th>Duels won</th>
                                <th>Tackles</th>
                                <th>Saves</th>
                              </tr>
                            </thead>
                            <tbody>
                              {team.lineup.map((player) => {
                                const performance = result.players[player.id];
                                return (
                                  <tr key={player.id}>
                                    <td>
                                      <button
                                        className="text-link"
                                        onClick={() => setPlayer(player.id)}
                                      >
                                        {player.name}
                                        <ArrowUpRight size={12} />
                                      </button>
                                    </td>
                                    <td>
                                      <span className="position-tag">
                                        {player.position}
                                      </span>
                                    </td>
                                    <td>
                                      <Badge
                                        tone={
                                          performance.rating >= 7
                                            ? "green"
                                            : performance.rating < 6
                                              ? "red"
                                              : "amber"
                                        }
                                      >
                                        {performance.rating.toFixed(1)}
                                      </Badge>
                                    </td>
                                    {[
                                      "goals",
                                      "assists",
                                      "passes",
                                      "keyPasses",
                                      "xG",
                                      "xA",
                                      "duelsWon",
                                      "tackles",
                                      "saves",
                                    ].map((key) => (
                                      <td key={key}>
                                        {performance[key].toFixed(
                                          ["xG", "xA"].includes(key) ? 2 : 0,
                                        )}
                                      </td>
                                    ))}
                                  </tr>
                                );
                              })}
                            </tbody>
                          </table>
                        </div>
                      </section>
                    ))}
                  </>
                )}
                {tab === "events" && (
                  <>
                    <div className="filter-bar">
                      <select
                        aria-label="Action log team"
                        value={teamId}
                        onChange={(event) => {
                          setTeamId(Number(event.target.value));
                          setPlayerId(0);
                        }}
                      >
                        <option value="0">Both teams</option>
                        <option value={snapshot.home.id}>
                          {snapshot.home.name}
                        </option>
                        <option value={snapshot.away.id}>
                          {snapshot.away.name}
                        </option>
                      </select>
                      <span className="muted" style={{ fontSize: ".73rem" }}>
                        {visibleActions.length} actions / up to minute {minute}
                      </span>
                    </div>
                    <div className="table-scroll action-log">
                      <table className="data-table">
                        <thead>
                          <tr>
                            <th>Time</th>
                            <th>Player</th>
                            <th>Action</th>
                            <th>Outcome</th>
                            <th>Location (x,y)</th>
                            <th>Destination</th>
                            <th>Difficulty</th>
                            <th>xG / xA</th>
                          </tr>
                        </thead>
                        <tbody>
                          {visibleActions.map((action, index) => (
                            <tr key={index}>
                              <td>
                                {action.minute}:
                                {String(action.second).padStart(2, "0")}
                              </td>
                              <td>
                                {
                                  [
                                    ...snapshot.home.lineup,
                                    ...snapshot.away.lineup,
                                  ].find(
                                    (player) => player.id === action.playerId,
                                  )?.name
                                }
                              </td>
                              <td>{label(action.type)}</td>
                              <td>
                                <Badge
                                  tone={
                                    action.outcome === "goal"
                                      ? "green"
                                      : ["lost", "incomplete"].includes(
                                            action.outcome,
                                          )
                                        ? "red"
                                        : "neutral"
                                  }
                                >
                                  {action.outcome}
                                </Badge>
                              </td>
                              <td>
                                {action.x.toFixed(1)}, {action.y.toFixed(1)}
                              </td>
                              <td>
                                {action.endX.toFixed(1)},{" "}
                                {action.endY.toFixed(1)}
                              </td>
                              <td>{action.difficulty}</td>
                              <td>
                                {action.xg?.toFixed(2) ?? "-"} /{" "}
                                {action.xa?.toFixed(2) ?? "-"}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </>
                )}
                {tab === "timeline" && (
                  <div className="timeline">
                    {result.events.map((event, index) => (
                      <div key={index}>
                        <time>{event.minute}'</time>
                        {event.type === "goal" ? (
                          <Goal size={18} className="positive" />
                        ) : (
                          <span className="yellow-card" />
                        )}
                        <span>
                          <p>{event.text}</p>
                          <small>
                            {event.teamId === snapshot.home.id
                              ? snapshot.home.name
                              : snapshot.away.name}
                          </small>
                        </span>
                      </div>
                    ))}
                    {!result.events.length && (
                      <Empty
                        icon={Activity}
                        title="A quiet afternoon"
                        detail="No goals or bookings were recorded."
                      />
                    )}
                  </div>
                )}
              </Panel>
              <Panel className="section-space">
                <SectionHeading
                  title="Match momentum"
                  subtitle="Five-minute pressure and attacking threat"
                />
                <div className="chart-box momentum-chart">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart
                      data={result.momentum.map((point) => ({
                        ...point,
                        away: -point.away,
                      }))}
                      margin={{ top: 0, bottom: 5, left: -20, right: 25 }}
                    >
                      <CartesianGrid
                        stroke="var(--line)"
                        vertical={false}
                        strokeDasharray="3 3"
                      />
                      <XAxis
                        dataKey="minute"
                        tick={{ fontSize: 10, fill: "var(--muted)" }}
                        axisLine={false}
                        tickLine={false}
                      />
                      <YAxis
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
                      <ReferenceLine y={0} stroke="var(--line)" />
                      <Bar
                        dataKey="home"
                        name={snapshot.home.name}
                        fill="var(--accent)"
                        radius={[2, 2, 0, 0]}
                      />
                      <Bar
                        dataKey="away"
                        name={snapshot.away.name}
                        fill="var(--amber)"
                        radius={[0, 0, 2, 2]}
                      />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </Panel>
            </div>
          ) : (
            <div className="section-space">
              <Panel>
                <Empty
                  icon={Trophy}
                  title="The match is still ahead"
                  detail={`${dateLabel(data.fixture.date)} / ${data.fixture.home_name} v ${data.fixture.away_name}`}
                />
                <div className="equal-columns">
                  <section>
                    <SectionHeading title="Coming up" />
                    <div>
                      {[...(fixtures ?? [])]
                        .reverse()
                        .filter((fixture) => fixture.status === "scheduled")
                        .slice(0, 3)
                        .map((fixture) => (
                          <FixtureRow key={fixture.id} fixture={fixture} />
                        ))}
                    </div>
                  </section>
                  <section className="padded">
                    <h3 className="subsection-title">Manager's approach</h3>
                    <dl className="detail-list">
                      <div>
                        <dt>Manager</dt>
                        <dd>{bootstrap.club.manager}</dd>
                      </div>
                      <div>
                        <dt>Formation</dt>
                        <dd>{bootstrap.club.formation}</dd>
                      </div>
                      <div>
                        <dt>Playing style</dt>
                        <dd>{bootstrap.club.tactical_style}</dd>
                      </div>
                      <div>
                        <dt>Squad chemistry</dt>
                        <dd>{Math.round(bootstrap.club.chemistry)}%</dd>
                      </div>
                    </dl>
                  </section>
                </div>
              </Panel>
            </div>
          )}
        </>
      )}
    </div>
  );
}
