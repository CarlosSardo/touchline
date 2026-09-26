import { useState } from "react";
import {
  Activity,
  ArrowLeftRight,
  ArrowUpRight,
  Clock,
  Flag,
  Goal,
  HeartPulse,
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
  ClubLink,
  PlayerLink,
  DetailList,
  Silhouette,
  Empty,
  ErrorState,
  FixtureRow,
  Loading,
  PageHeading,
  Panel,
  SectionHeading,
  SortHeader,
  Tabs,
} from "../ui.tsx";
import PitchMap from "../PitchMap.tsx";
import { dateLabel, label, MAP_MODES } from "../../shared/rules.ts";
import type { MatchDetail } from "../../shared/api.ts";
import type {
  Fixture,
  MatchPlayer,
  MatchResult,
  MatchTeam,
} from "../../shared/types.ts";
import { positionRank, type SortColumn } from "../sort.ts";
import { useSortableRows } from "../useSortableRows.ts";

const MATCH_STATS: [string, string][] = [
  ["goals", "Goals"],
  ["assists", "Assists"],
  ["passes", "Passes"],
  ["keyPasses", "Key passes"],
  ["xG", "xG"],
  ["xA", "xA"],
  ["duelsWon", "Duels won"],
  ["tackles", "Tackles"],
  ["saves", "Saves"],
];
type MatchStatRow = MatchPlayer & { performance: Record<string, number> };
const MATCH_STAT_COLUMNS: SortColumn<MatchStatRow>[] = [
  { key: "name", value: (row) => row.name, defaultDirection: "asc" },
  { key: "position", value: (row) => positionRank(row.position), defaultDirection: "asc" },
  { key: "rating", value: (row) => row.performance.rating, defaultDirection: "desc" },
  { key: "minutes", value: (row) => row.performance.minutes, defaultDirection: "desc" },
  ...MATCH_STATS.map(([key]): SortColumn<MatchStatRow> => ({
    key,
    value: (row) => row.performance[key],
    defaultDirection: "desc",
  })),
];

/** Players who took part, in lineup order until a column is sorted. */
function MatchPlayerStats({
  team,
  result,
  onReport,
}: {
  team: MatchTeam;
  result: MatchResult;
  onReport: (playerId: number) => void;
}) {
  const { setPlayer } = useGame();
  const sorting = useSortableRows(
    [...team.lineup, ...(team.bench ?? [])]
      .filter((player) => (result.players[player.id]?.minutes ?? 0) > 0)
      .map((player) => ({ ...player, performance: result.players[player.id] })),
    MATCH_STAT_COLUMNS,
    { tieBreakers: [{ value: (row) => row.name }] },
  );
  return (
    <div className="table-scroll" role="region" aria-label={`${team.name} player statistics`} tabIndex={0}>
      <table className="data-table">
        <thead>
          <tr>
            <SortHeader {...sorting.header("name")} label="Player" />
            <SortHeader {...sorting.header("position")} label="Pos" title="Position" />
            <SortHeader {...sorting.header("rating")} label="Rating" />
            <SortHeader {...sorting.header("minutes")} label="Minutes" />
            {MATCH_STATS.map(([key, text]) => (
              <SortHeader key={key} {...sorting.header(key)} label={text} />
            ))}
            <th>Report</th>
          </tr>
        </thead>
        <tbody>
          {sorting.rows.map((player) => (
            <tr key={player.id}>
              <td>
                <button className="text-link" onClick={() => setPlayer(player.id)}>
                  {player.name}
                  <ArrowUpRight size={12} />
                </button>
              </td>
              <td>
                <span className="position-tag">{player.position}</span>
              </td>
              <td>
                <Badge
                  tone={
                    player.performance.rating >= 7
                      ? "green"
                      : player.performance.rating < 6
                        ? "red"
                        : "amber"
                  }
                >
                  {player.performance.rating.toFixed(1)}
                </Badge>
              </td>
              <td>{player.performance.minutes}'</td>
              {MATCH_STATS.map(([key]) => (
                <td key={key}>
                  {player.performance[key].toFixed(["xG", "xA"].includes(key) ? 2 : 0)}
                </td>
              ))}
              <td>
                <Button
                  variant="secondary"
                  icon={ArrowUpRight}
                  onClick={() => onReport(player.id)}
                >
                  Player report
                </Button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

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
  const {
    bootstrap,
    fixtureId,
    matchPlayerId,
    openMatch,
    navigate,
  } = useGame();
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
  const [tabSelection, setTabSelection] = useState<{
    match: number | undefined;
    player: number | null;
    tab: string;
  } | null>(null);
  const tab =
    tabSelection?.match === selectedId && tabSelection?.player === matchPlayerId
      ? tabSelection.tab
      : matchPlayerId
        ? "individual"
        : "analysis";
  const setTab = (value: string) =>
    setTabSelection({ match: selectedId, player: matchPlayerId, tab: value });
  const [mode, setMode] = useState("Pass map");
  const [selection, setSelection] = useState<{
    fixtureId: number | undefined;
    teamId: number;
    playerId: number;
    focusId: number | null;
  } | null>(null);
  const focusTeam = data?.snapshot
    ? [data.snapshot.home, data.snapshot.away].find((team) =>
        [...team.lineup, ...(team.bench ?? [])].some(
          (player) => player.id === matchPlayerId,
        ),
      )
    : undefined;
  const teamId =
    selection &&
    selection.fixtureId === selectedId &&
    selection.focusId === matchPlayerId
      ? selection.teamId
      : (focusTeam?.id ?? data?.snapshot?.home.id ?? 0);
  const playerId =
    selection &&
    selection.fixtureId === selectedId &&
    selection.focusId === matchPlayerId
      ? selection.playerId
      : (matchPlayerId ?? 0);
  const setTeamId = (id: number) =>
    setSelection({
      fixtureId: selectedId,
      teamId: id,
      playerId: 0,
      focusId: matchPlayerId,
    });
  const setPlayerId = (id: number) =>
    setSelection((current) => ({
      fixtureId: selectedId,
      teamId:
        current && current.fixtureId === selectedId ? current.teamId : teamId,
      playerId: id,
      focusId: matchPlayerId,
    }));
  const [timeFilter, setTimeFilter] = useState<{
    match: number | undefined;
    minute: number;
  } | null>(null);
  const duration = data?.result?.duration ?? 90;
  const minute =
    timeFilter && timeFilter.match === selectedId
      ? timeFilter.minute
      : duration;
  const setMinute = (value: number) =>
    setTimeFilter({ match: selectedId, minute: value });
  const [progressive, setProgressive] = useState(false);
  if (!bootstrap) return <Loading />;
  const lineup = data?.snapshot
    ? [data.snapshot.home, data.snapshot.away]
        .filter((team) => !teamId || team.id === teamId)
        .flatMap((team) =>
          [...team.lineup, ...(team.bench ?? [])].filter(
            (player) => (data.result?.players[player.id]?.minutes ?? 0) > 0,
          ),
        )
    : [];
  const result = data?.result;
  const snapshot = data?.snapshot;
  // Compacted fixtures (outside the user's club family) keep only the result and scorers.
  const scorers =
    data && !snapshot && data.fixture.status === "played"
      ? data.fixture.data
        ? ((JSON.parse(data.fixture.data) as {
            scorers?: { minute: number; addedTime?: number; teamId: number; playerId: number; name?: string }[];
          }).scorers ?? [])
        : []
      : null;
  const allPlayers = snapshot
    ? [
        ...snapshot.home.lineup,
        ...(snapshot.home.bench ?? []),
        ...snapshot.away.lineup,
        ...(snapshot.away.bench ?? []),
      ]
    : [];
  const featured =
    allPlayers.find((player) => player.id === playerId) ??
    allPlayers.find((player) => (result?.players[player.id]?.minutes ?? 0) > 0);
  const featuredStats =
    featured && result ? result.players[featured.id] : undefined;
  const featuredOn =
    result?.substitutions?.find((change) => change.onId === featured?.id)
      ?.minute ?? 0;
  const featuredOff =
    result?.substitutions?.find((change) => change.offId === featured?.id)
      ?.minute ??
    (featuredStats && featuredOn + featuredStats.minutes < duration
      ? featuredOn + featuredStats.minutes
      : null);
  const visibleActions =
    result?.actions.filter(
      (action) =>
        (!teamId || action.teamId === teamId) &&
        (!playerId || action.playerId === playerId) &&
        (action.elapsed ?? action.minute) <= minute &&
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
          {data &&
            !(fixtures ?? []).some(
              (fixture) => fixture.id === data.fixture.id,
            ) && (
              <option value={data.fixture.id}>
                {dateLabel(data.fixture.date)} / {data.fixture.home_name}{" "}
                {data.fixture.home_goals} - {data.fixture.away_goals}{" "}
                {data.fixture.away_name}
              </option>
            )}
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
                <h3>
                  <ClubLink
                    id={data.fixture.home_id}
                    name={data.fixture.home_name ?? "Home"}
                  />
                </h3>
              </div>
              <div className="scoreboard-score">
                <strong>
                  {data.fixture.status === "played"
                    ? `${data.fixture.home_goals} : ${data.fixture.away_goals}`
                    : "VS"}
                </strong>
                <small>
                  {data.fixture.status === "played"
                    ? result?.wentToExtraTime
                      ? "AFTER EXTRA TIME"
                      : "FULL TIME"
                    : "15:00 / SCHEDULED"}
                </small>
                {data.penalties && (
                  <small>
                    Penalties {data.penalties.home} - {data.penalties.away}
                  </small>
                )}
                {data.tie && data.aggregate && (
                  <small>
                    Leg {data.tie.leg}/{data.tie.legs} / Aggregate{" "}
                    {data.aggregate.home} - {data.aggregate.away}
                  </small>
                )}
                {data.awarded && (
                  <small>Awarded result / {data.awarded.reason}</small>
                )}
              </div>
              <div className="scoreboard-team">
                <Crest
                  name={data.fixture.away_name ?? ""}
                  color={data.fixture.away_color}
                  size={58}
                />
                <h3>
                  <ClubLink
                    id={data.fixture.away_id}
                    name={data.fixture.away_name ?? "Away"}
                  />
                </h3>
              </div>
            </div>
            <div className="scoreboard-footer">
              {!result && data.fixture.home_xg !== null && data.fixture.away_xg !== null && data.fixture.status === "played" && (
                <span>
                  xG{" "}
                  <strong>
                    {data.fixture.home_xg.toFixed(2)} - {data.fixture.away_xg.toFixed(2)}
                  </strong>
                </span>
              )}
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
              <span>{snapshot?.weather ?? (data.fixture.status === "played" ? "Result only" : "Pre-match")}</span>
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
                    { id: "individual", label: "Player report" },
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
                        max={duration}
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
                        <MatchPlayerStats
                          team={team}
                          result={result}
                          onReport={(playerId) => {
                            setTeamId(team.id);
                            setPlayerId(playerId);
                            setTab("individual");
                          }}
                        />
                      </section>
                    ))}
                  </>
                )}
                {tab === "individual" && (
                  <>
                    <div className="analytics-controls">
                      <select
                        aria-label="Player match report"
                        value={featured?.id ?? ""}
                        onChange={(event) => {
                          const id = Number(event.target.value);
                          const team = [snapshot.home, snapshot.away].find(
                            (entry) =>
                              [...entry.lineup, ...(entry.bench ?? [])].some(
                                (player) => player.id === id,
                              ),
                          )!;
                          setTeamId(team.id);
                          setPlayerId(id);
                        }}
                      >
                        {[snapshot.home, snapshot.away].map((team) => (
                          <optgroup key={team.id} label={team.name}>
                            {[...team.lineup, ...(team.bench ?? [])]
                              .filter(
                                (player) =>
                                  result.players[player.id]?.minutes > 0,
                              )
                              .map((player) => (
                                <option key={player.id} value={player.id}>
                                  {player.name}
                                </option>
                              ))}
                          </optgroup>
                        ))}
                      </select>
                      <Badge tone="blue">
                        {data.fixture.season}/
                        {String(data.fixture.season + 1).slice(-2)}
                      </Badge>
                    </div>
                    {featured && featuredStats && (
                      <div className="padded">
                        <div className="individual-report-heading">
                          <Silhouette size={60} hologram />
                          <div>
                            <h3>
                              <PlayerLink
                                id={featured.id}
                                name={featured.name}
                              />
                            </h3>
                            <p>
                              {featured.position} / {featuredStats.minutes}'
                              played
                            </p>
                          </div>
                          <span className="individual-match-rating">
                            {featuredStats.rating.toFixed(1)}
                            <small>Match rating</small>
                          </span>
                        </div>
                        <div className="individual-stat-grid">
                          {[
                            {
                              title: "Contribution",
                              fields: [
                                "minutes",
                                "goals",
                                "assists",
                                "shots",
                                "shotsOnTarget",
                                "xG",
                                "xA",
                              ],
                            },
                            {
                              title: "Passing & creation",
                              fields: [
                                "passes",
                                "completedPasses",
                                "progressivePasses",
                                "keyPasses",
                                "carries",
                                "dribbles",
                                "successfulDribbles",
                              ],
                            },
                            {
                              title: "Defending & discipline",
                              fields: [
                                "duels",
                                "duelsWon",
                                "tackles",
                                "interceptions",
                                "recoveries",
                                "presses",
                                "fouls",
                                "yellowCards",
                                "redCards",
                              ],
                            },
                            {
                              title: "Goalkeeping & context",
                              fields: ["saves", "xGPrevented", "corners"],
                            },
                          ].map((section) => (
                            <section key={section.title}>
                              <h3>{section.title}</h3>
                              <DetailList
                                items={section.fields.map((key) => [
                                  stats.find(([field]) => field === key)?.[1] ??
                                    label(key),
                                  (featuredStats[key] ?? 0).toFixed(
                                    ["xG", "xA", "xGPrevented"].includes(key)
                                      ? 2
                                      : 0,
                                  ),
                                ])}
                              />
                              {section.title === "Goalkeeping & context" && (
                                <DetailList
                                  items={[
                                    [
                                      "Started",
                                      snapshot.home.lineup.some(
                                        (player) => player.id === featured.id,
                                      ) ||
                                      snapshot.away.lineup.some(
                                        (player) => player.id === featured.id,
                                      )
                                        ? "Yes"
                                        : "Substitute",
                                    ],
                                    [
                                      "On",
                                      featuredOn
                                        ? `${featuredOn}'`
                                        : "Kick-off",
                                    ],
                                    [
                                      "Off",
                                      featuredOff === null
                                        ? "Final whistle"
                                        : `${featuredOff}'`,
                                    ],
                                  ]}
                                />
                              )}
                            </section>
                          ))}
                        </div>
                        <SectionHeading title="Player activity" />
                        <div className="analytics-controls">
                          <select
                            aria-label="Individual pitch map type"
                            value={mode}
                            onChange={(event) => setMode(event.target.value)}
                          >
                            {MAP_MODES.map((value) => (
                              <option key={value}>{value}</option>
                            ))}
                          </select>
                        </div>
                        <PitchMap
                          actions={result.actions}
                          mode={mode}
                          teamId={0}
                          playerId={featured.id}
                          minute={duration}
                        />
                      </div>
                    )}
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
                                {action.minute}
                                {action.addedTime ? `+${action.addedTime}` : ""}
                                :{String(action.second).padStart(2, "0")}
                              </td>
                              <td>
                                <PlayerLink
                                  id={action.playerId}
                                  name={
                                    allPlayers.find(
                                      (player) => player.id === action.playerId,
                                    )?.name ?? `Player ${action.playerId}`
                                  }
                                />
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
                        <time>
                          {event.minute}
                          {event.addedTime ? `+${event.addedTime}` : ""}'
                        </time>
                        {event.type === "goal" ? (
                          <Goal size={18} className="positive" />
                        ) : event.type === "substitution" ? (
                          <ArrowLeftRight size={16} className="positive" />
                        ) : event.type === "injury" ? (
                          <HeartPulse size={16} className="negative" />
                        ) : event.type === "red card" ? (
                          <span className="red-card" />
                        ) : (
                          <span className="yellow-card" />
                        )}
                        <span>
                          <p>{event.text}</p>
                          <small>
                            <ClubLink
                              id={event.teamId}
                              name={
                                event.teamId === snapshot.home.id
                                  ? snapshot.home.name
                                  : snapshot.away.name
                              }
                            />
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
          ) : scorers ? (
            <div className="section-space">
              <Panel>
                <Empty
                  icon={Trophy}
                  title="Result only"
                  detail="Full match detail is kept only for your club's teams."
                />
                {scorers.length > 0 && (
                  <ul className="compact-list" aria-label="Goalscorers">
                    {scorers.map((goal, index) => (
                      <li key={index}>
                        <span>
                          {goal.minute}
                          {goal.addedTime ? `+${goal.addedTime}` : ""}'
                        </span>
                        <strong>
                          <PlayerLink id={goal.playerId} name={goal.name ?? `Player ${goal.playerId}`} />
                        </strong>
                        <small>
                          {goal.teamId === data.fixture.home_id ? data.fixture.home_name : data.fixture.away_name}
                        </small>
                      </li>
                    ))}
                  </ul>
                )}
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
