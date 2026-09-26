import { useState } from "react";
import {
  ArrowUpDown,
  ArrowUpRight,
  Bookmark,
  CalendarClock,
  ClipboardCheck,
  Compass,
  Network,
  Plus,
  ScanLine,
  Search,
  Shield,
  Target,
  Users,
  X,
} from "lucide-react";
import { useCurrency, useGame, useResource } from "../game-context.tsx";
import {
  Badge,
  Button,
  ClubLink,
  PlayerLink,
  Empty,
  ErrorState,
  Field,
  MoneyInput,
  IconButton,
  Loading,
  Meter,
  Modal,
  PageHeading,
  Panel,
  PlayerName,
  Rating,
  SectionHeading,
  SortDirectionButton,
  SortHeader,
  Stat,
  Tabs,
} from "../ui.tsx";
import { dateLabel, label, POSITIONS } from "../../shared/rules.ts";
import type { ScoutingData, SquadData } from "../../shared/api.ts";
import type { Player, Staff } from "../../shared/types.ts";
import {
  dateValue,
  PLAYER_COLUMNS,
  PLAYER_TIE_BREAKERS,
  positionRank,
  rankOf,
  type SortColumn,
} from "../sort.ts";
import { useSortableRows } from "../useSortableRows.ts";
import { POSITION_LINES } from "../players.ts";
import Shortlist from "./Shortlist.tsx";
import { CallUpDialog, CallUpsPanel } from "../CallUps.tsx";
import { CALL_UPS_PATH, callUpBadge } from "../callups.ts";
import type { CallUpDesk } from "../../shared/features/callups.ts";
import type { InternationalsDesk } from "../../shared/features/youth-internationals.ts";
import { INTERNATIONALS_PATH, dutyByPlayer, dutyText } from "../internationals.ts";

const roles = [
  "Captain",
  "Key player",
  "Regular starter",
  "Squad player",
  "Fringe player",
  "Prospect",
];

type SquadSortKey =
  | "name"
  | "position"
  | "age"
  | "status"
  | "ability"
  | "potential"
  | "role"
  | "fitness"
  | "morale"
  | "appearances"
  | "goals"
  | "wage"
  | "availability";
const SQUAD_SORT_OPTIONS: [SquadSortKey, string][] = [
  ["ability", "Ability"],
  ["potential", "Potential"],
  ["fitness", "Fitness"],
  ["age", "Age"],
  ["name", "Name"],
  ["position", "Position"],
  ["status", "Readiness"],
  ["role", "Squad role"],
  ["morale", "Morale"],
  ["appearances", "Appearances"],
  ["goals", "Goals / assists"],
  ["wage", "Wage"],
  ["availability", "Availability"],
];
const SUCCESSION_RISKS = ["Vacant", "Plan succession", "No young cover", "Covered"];
const SUCCESSION_COLUMNS: SortColumn<
  SquadData["succession"][number],
  "position" | "current" | "age" | "prospect" | "potential" | "risk"
>[] = [
  { key: "position", value: (item) => positionRank(item.position), defaultDirection: "asc" },
  { key: "current", value: (item) => item.current, defaultDirection: "asc" },
  { key: "age", value: (item) => item.age, defaultDirection: "asc" },
  { key: "prospect", value: (item) => item.prospect?.name, defaultDirection: "asc" },
  { key: "potential", value: (item) => item.prospect?.potential, defaultDirection: "desc" },
  { key: "risk", value: (item) => rankOf(SUCCESSION_RISKS, item.risk), defaultDirection: "asc" },
];
type Report = ScoutingData["reports"][number];
const REPORT_COLUMNS: SortColumn<
  Report,
  "name" | "position" | "age" | "ability" | "potential" | "fit" | "risk" | "accuracy" | "date"
>[] = [
  { key: "name", value: (report) => report.player_name, defaultDirection: "asc" },
  { key: "position", value: (report) => positionRank(report.position), defaultDirection: "asc" },
  { key: "age", value: (report) => report.age, defaultDirection: "asc" },
  { key: "ability", value: (report) => [(report.ability_low + report.ability_high) / 2, report.ability_high], defaultDirection: "desc" },
  { key: "potential", value: (report) => [(report.potential_low + report.potential_high) / 2, report.potential_high], defaultDirection: "desc" },
  { key: "fit", value: (report) => report.fit, defaultDirection: "desc" },
  { key: "risk", value: (report) => report.risk, defaultDirection: "asc" },
  { key: "accuracy", value: (report) => report.accuracy, defaultDirection: "desc" },
  { key: "date", value: (report) => dateValue(report.date), defaultDirection: "desc" },
];
const REPORT_TIE_BREAKERS: SortColumn<Report>[] = [
  { key: "name", value: (report) => report.player_name },
  { key: "id", value: (report) => report.id, defaultDirection: "desc" },
];
type AssignmentRow = ScoutingData["assignments"][number];
const ASSIGNMENT_COLUMNS: SortColumn<
  AssignmentRow,
  "scout" | "brief" | "position" | "age" | "budget" | "due" | "status"
>[] = [
  { key: "scout", value: (assignment) => assignment.scout_name, defaultDirection: "asc" },
  { key: "brief", value: (assignment) => assignment.player_name ?? assignment.country_name ?? "Worldwide search", defaultDirection: "asc" },
  { key: "position", value: (assignment) => positionRank(assignment.position), defaultDirection: "asc" },
  { key: "age", value: (assignment) => assignment.max_age, defaultDirection: "asc" },
  { key: "budget", value: (assignment) => assignment.budget, defaultDirection: "desc" },
  { key: "due", value: (assignment) => dateValue(assignment.due_date), defaultDirection: "desc" },
  { key: "status", value: (assignment) => rankOf(["active", "complete"], assignment.status) ?? 2, defaultDirection: "asc" },
];

export function Squad() {
  const { bootstrap, act, setPlayer, navigate } = useGame();
  const { money } = useCurrency();
  const [squadClub, setSquadClub] = useState("");
  const [ageGroup, setAgeGroup] = useState("Senior");
  const { data, error, loading } = useResource<SquadData>(
    `squad?ageGroup=${ageGroup}${squadClub ? `&club=${squadClub}` : ""}`,
    { keepPreviousData: true },
  );
  const [tab, setTab] = useState("players");
  const { data: callUps } = useResource<CallUpDesk>(CALL_UPS_PATH, { keepPreviousData: true });
  const { data: internationals } = useResource<InternationalsDesk>(INTERNATIONALS_PATH, { keepPreviousData: true });
  const duty = dutyByPlayer(internationals?.clubPlayers);
  const [moving, setMoving] = useState<{ id: number; name: string } | null>(null);
  const [filter, setFilter] = useState("");
  const [query, setQuery] = useState("");
  const [readiness, setReadiness] = useState("");
  const [grouped, setGrouped] = useState(true);
  const today = bootstrap?.state.date ?? "";
  const isInjured = (player: Player) =>
    !!player.injury_until && player.injury_until > today;
  const filtered = (data?.players ?? []).filter((player) =>
    (!filter || player.position === filter) &&
    (!query || `${player.name} ${player.nationality} ${player.role}`.toLowerCase().includes(query.trim().toLowerCase())) &&
    (!readiness || (readiness === "injured" ? isInjured(player)
      : readiness === "low" ? !isInjured(player) && player.fitness < 60
        : !isInjured(player) && player.fitness >= 60)),
  );
  const squadColumns: SortColumn<Player, SquadSortKey>[] = [
    PLAYER_COLUMNS.name,
    PLAYER_COLUMNS.position,
    PLAYER_COLUMNS.age,
    { key: "status", value: (player) => (isInjured(player) ? 2 : player.fitness < 60 ? 1 : 0), defaultDirection: "asc" },
    PLAYER_COLUMNS.ability,
    PLAYER_COLUMNS.potential,
    { key: "role", value: (player) => rankOf(roles, roles.includes(player.role) ? player.role : "Squad player"), defaultDirection: "asc" },
    PLAYER_COLUMNS.fitness,
    PLAYER_COLUMNS.morale,
    PLAYER_COLUMNS.appearances,
    PLAYER_COLUMNS.goals,
    PLAYER_COLUMNS.wage,
    { key: "availability", value: (player) => (player.listed ? 1 : player.available_loan ? 2 : 0), defaultDirection: "asc" },
  ];
  const sorting = useSortableRows(filtered, squadColumns, {
    initial: { key: "ability", direction: "desc" },
    tieBreakers: PLAYER_TIE_BREAKERS,
  });
  const succession = useSortableRows(data?.succession ?? [], SUCCESSION_COLUMNS, {
    initial: { key: "position", direction: "asc" },
    tieBreakers: [SUCCESSION_COLUMNS[0]],
  });
  if (error) return <ErrorState message={error} />;
  if (!data || !bootstrap) return <Loading />;
  const selectedClub = data.clubs.find((club) => club.id === data.selectedClubId) ?? bootstrap.club;
  const reserveScope = data.clubs.find((club) => String(club.id) === String(squadClub || data.selectedClubId))?.type === "bteam";
  const scopeLabel = data.ageGroup === "Senior"
    ? selectedClub.type === "bteam" ? "Reserve team" : "First team"
    : data.ageGroup;
  const availableCount = data.players.filter((player) => !isInjured(player) && player.fitness >= 60).length;
  const injuredCount = data.players.filter(isInjured).length;
  const lowFitnessCount = data.players.filter((player) => !isInjured(player) && player.fitness < 60).length;
  const groups = [...new Set(data.matrix.map((player) => player.group))];
  const sections = grouped
    ? POSITION_LINES.map((section) => ({
        label: section.label,
        players: sorting.rows.filter((player) =>
          (section.positions as readonly string[]).includes(player.position),
        ),
      })).filter((section) => section.players.length)
    : [{ label: "", players: sorting.rows }];
  const matrix = data.matrix.slice(0, 18);
  return (
    <div className="page">
      <PageHeading
        eyebrow="SQUAD MANAGEMENT"
        title="The squad"
        subtitle={`${selectedClub.name} / ${selectedClub.manager} / ${selectedClub.formation}`}
      >
        <Button
          variant="secondary"
          icon={Search}
          onClick={() => navigate("database")}
        >
          Find a player
        </Button>
      </PageHeading>
      <div className="squad-scope" role="group" aria-label="Squad scope">
        <Field label="Club squad">
          <select
            aria-label="Club squad"
            value={squadClub || data.selectedClubId}
            onChange={(event) => {
              setSquadClub(event.target.value);
              if (data.clubs.find((club) => String(club.id) === event.target.value)?.type === "bteam") setAgeGroup("Senior");
            }}
          >
            {data.clubs.map((club) => (
              <option key={club.id} value={club.id}>
                {club.type === "bteam" ? "Reserve team" : "First team"} / {club.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Age group">
          <select aria-label="Squad age group" value={reserveScope ? "Senior" : ageGroup} onChange={(event) => setAgeGroup(event.target.value)}>
            <option value="Senior">Senior</option>
            {!reserveScope && <option value="U19">U19</option>}
            {!reserveScope && <option value="U17">U17</option>}
          </select>
        </Field>
        <div className="scope-context" role="status">
          <strong>{loading ? "Updating squad" : `${scopeLabel} / ${data.players.length} players`}</strong>
          <span>{selectedClub.tactical_style}</span>
        </div>
      </div>
      <div className="stat-strip compact-stat-strip">
        <Stat
          label={`${scopeLabel} players`}
          value={data.players.length}
          icon={Users}
          detail={`${availableCount} fit / ${injuredCount} injured`}
        />
        <Stat
          label="Average age"
          value={(
            data.players.reduce((sum, player) => sum + player.age, 0) /
            Math.max(1, data.players.length)
          ).toFixed(1)}
          icon={CalendarClock}
          detail="Years"
        />
        <Stat
          label="Squad value"
          value={money(
            data.players.reduce((sum, player) => sum + player.value, 0),
          )}
          icon={Target}
          detail="Selected squad"
        />
        <Stat
          label="Chemistry"
          value={
            <>
              {Math.round(selectedClub.chemistry)}
              <small>/100</small>
            </>
          }
          icon={Network}
          detail={<Meter value={selectedClub.chemistry} />}
        />
      </div>
      <Panel>
        <Tabs
          label="Squad views"
          items={[
            { id: "players", label: "Players", count: data.players.length },
            {
              id: "callups",
              label: "Call-ups",
              count: callUps ? callUps.active.length + callUps.proposals.length : undefined,
            },
            { id: "chemistry", label: "Dressing room" },
            { id: "succession", label: "Succession plan" },
            {
              id: "promises",
              label: "Promises",
              count: data.promises.filter(
                (promise) => promise.status === "active",
              ).length,
            },
          ]}
          value={tab}
          onChange={setTab}
        />
        {tab === "players" && (
          <>
            <div className="filter-bar roster-toolbar">
              <div className="search-field">
                <Search size={17} aria-hidden="true" />
                <input aria-label="Search squad players" placeholder="Search squad" value={query} onChange={(event) => setQuery(event.target.value)} />
              </div>
              <Field label="Position">
                <select
                  aria-label="Squad position"
                  value={filter}
                  onChange={(event) => setFilter(event.target.value)}
                >
                  <option value="">All positions</option>
                  {POSITIONS.map((position) => (
                    <option key={position}>{position}</option>
                  ))}
                </select>
              </Field>
              <Field label="Readiness">
                <select aria-label="Squad readiness" value={readiness} onChange={(event) => setReadiness(event.target.value)}>
                  <option value="">All readiness</option>
                  <option value="fit">Fit / fitness 60+ ({availableCount})</option>
                  <option value="low">Fitness below 60 ({lowFitnessCount})</option>
                  <option value="injured">Injured ({injuredCount})</option>
                </select>
              </Field>
              <Field label="Sort by">
                <select
                  aria-label="Sort squad players"
                  value={sorting.sort?.key ?? ""}
                  onChange={(event) => {
                    const key = event.target.value as SquadSortKey;
                    sorting.setSort({ key, direction: sorting.defaultDirection(key) });
                  }}
                >
                  {SQUAD_SORT_OPTIONS.map(([key, text]) => (
                    <option key={key} value={key}>{text}</option>
                  ))}
                </select>
              </Field>
              <SortDirectionButton
                subject="squad players"
                direction={sorting.sort?.direction}
                onToggle={() => sorting.sort && sorting.toggle(sorting.sort.key)}
              />
              <label className="filter-check group-toggle">
                <input type="checkbox" checked={grouped} onChange={(event) => setGrouped(event.target.checked)} />
                Group by position line
              </label>
              {(query || filter || readiness) && (
                <IconButton icon={X} label="Clear squad filters" onClick={() => { setQuery(""); setFilter(""); setReadiness(""); }} />
              )}
            </div>
            <div className="position-coverage" role="group" aria-label="Squad position coverage">
              {POSITIONS.map((position) => {
                const count = data.players.filter((player) => player.position === position).length;
                return (
                  <button type="button" key={position} aria-pressed={filter === position} aria-label={`${position}: ${count} players`} onClick={() => setFilter(filter === position ? "" : position)}>
                    <span>{position}</span><strong>{count}</strong>
                  </button>
                );
              })}
            </div>
            <div className="roster-result-count" role="status">{filtered.length} of {data.players.length} players</div>
            <div className="table-scroll roster-table-scroll" role="region" aria-label="Squad players" tabIndex={0} aria-busy={loading}>
              <table className="data-table roster-table">
                <caption className="sr-only">{scopeLabel}: roles, readiness and availability</caption>
                <thead>
                  <tr>
                    <SortHeader {...sorting.header("name")} label="Player" />
                    <SortHeader {...sorting.header("position")} label="Pos" title="Position" />
                    <SortHeader {...sorting.header("status")} label="Status" title="Readiness" />
                    <SortHeader {...sorting.header("ability")} label="Ability" title="Current ability" />
                    <SortHeader {...sorting.header("potential")} label="Potential" title="Current dynamic potential" />
                    <SortHeader {...sorting.header("role")} label="Squad role" />
                    <SortHeader {...sorting.header("fitness")} label="Fitness" />
                    <SortHeader {...sorting.header("morale")} label="Morale" />
                    <SortHeader {...sorting.header("appearances")} label="Apps" title="Appearances" />
                    <SortHeader {...sorting.header("goals")} label="G / A" title="Goals, then assists" />
                    <SortHeader {...sorting.header("wage")} label="Wage / wk" />
                    <SortHeader {...sorting.header("availability")} label="Availability" />
                  </tr>
                </thead>
                {sections.map((section) => (
                <tbody key={section.label || "all"}>
                  {grouped && <tr className="roster-group-row"><th scope="rowgroup" colSpan={12}>{section.label} <span>{section.players.length}</span></th></tr>}
                  {section.players.map((player) => (
                    <tr key={player.id}>
                      <td>
                        <div className="player-identity-actions">
                          <PlayerName player={player} compact />
                          {!player.parent_club_id && (
                            <IconButton icon={ArrowUpDown} label={`Move ${player.name} up or down`} onClick={() => setMoving({ id: player.id, name: player.name })} disabled={loading} />
                          )}
                        </div>
                      </td>
                      <td>
                        <span className="position-tag">{player.position}</span>
                      </td>
                      <td>
                        <div className="roster-status">
                          <Badge tone={isInjured(player) ? "red" : player.fitness < 60 ? "amber" : "green"}>
                            {isInjured(player) ? "Injured" : player.fitness < 60 ? "Low fitness" : "Fit"}
                          </Badge>
                          {isInjured(player) && <small>Until {dateLabel(player.injury_until!)}</small>}
                          {!!player.parent_club_id && <Badge tone="blue">On loan</Badge>}
                          {(() => {
                            const callUp = callUps?.active.find((entry) => entry.playerId === player.id);
                            return callUp ? (
                              <>
                                <Badge tone="violet">Call-up</Badge>
                                <small className="callup-flag">{callUpBadge(callUp, today)}</small>
                              </>
                            ) : null;
                          })()}
                          {(() => {
                            const away = duty.get(player.id);
                            return away ? (
                              <>
                                <Badge tone={away.status === "withheld" ? "amber" : "blue"}>
                                  {away.status === "withheld" ? "Kept back" : "International duty"}
                                </Badge>
                                <small className="callup-flag">{dutyText(away)}</small>
                              </>
                            ) : null;
                          })()}
                        </div>
                      </td>
                      <td>
                        <Rating value={player.ability} />
                      </td>
                      <td>
                        <Rating value={player.potential} potential />
                      </td>
                      <td>
                        <select
                          aria-label={`Role for ${player.name}`}
                          className="table-select"
                          disabled={loading}
                          value={
                            roles.includes(player.role)
                              ? player.role
                              : "Squad player"
                          }
                          onChange={(event) =>
                            void act({
                              type: "role",
                              playerId: player.id,
                              role: event.target.value,
                            })
                          }
                        >
                          {roles.map((role) => (
                            <option key={role}>{role}</option>
                          ))}
                        </select>
                      </td>
                      <td>
                        <div className="cell-meter">
                          <Meter
                            value={player.fitness}
                            tone={player.fitness < 60 ? "red" : "green"}
                          />
                          <small>{Math.round(player.fitness)}%</small>
                        </div>
                      </td>
                      <td>
                        <div className="cell-meter">
                          <Meter
                            value={player.morale}
                            tone={player.morale < 45 ? "amber" : "green"}
                          />
                          <small>{Math.round(player.morale)}</small>
                        </div>
                      </td>
                      <td>{player.appearances}</td>
                      <td>
                        {player.goals} / {player.assists}
                      </td>
                      <td className="money">{money(player.wage)}</td>
                      <td>
                        <select
                          aria-label={`Availability for ${player.name}`}
                          className="table-select"
                          disabled={loading}
                          value={
                            player.listed
                              ? "transfer"
                              : player.available_loan
                                ? "loan"
                                : "keep"
                          }
                          onChange={(event) =>
                            void act({
                              type: "availability",
                              playerId: player.id,
                              listed: event.target.value === "transfer",
                              loan: event.target.value === "loan",
                            })
                          }
                        >
                          <option value="keep">Keep at club</option>
                          <option value="transfer">Transfer listed</option>
                          <option value="loan">Available for loan</option>
                        </select>
                      </td>
                    </tr>
                  ))}
                </tbody>
                ))}
              </table>
              {!filtered.length && <Empty title="No players in this selection" />}
            </div>
          </>
        )}
        {tab === "callups" && <CallUpsPanel />}
        {tab === "chemistry" && (
          <>
            <SectionHeading
              title="Dressing-room groups"
              subtitle="Shared language, personality and mentorship"
            />
            <div className="group-list">
              {groups.map((group) => (
                <div key={group}>
                  <Badge
                    tone={
                      group === "Local core"
                        ? "green"
                        : group === "Young internationals"
                          ? "blue"
                          : "violet"
                    }
                  >
                    {group}
                  </Badge>
                  <small>
                    {
                      data.matrix.filter((player) => player.group === group)
                        .length
                    }{" "}
                    players
                  </small>
                </div>
              ))}
            </div>
            <div className="table-scroll" role="region" aria-label="Dressing room relationships" tabIndex={0}>
              <div
                className="matrix-grid"
                style={{
                  gridTemplateColumns: `145px repeat(${matrix.length},27px)`,
                  minWidth: 160 + matrix.length * 30,
                }}
              >
                <span />
                {matrix.map((player, index) => (
                  <button
                    className="matrix-cell"
                    key={player.id}
                    title={player.name}
                    onClick={() => setPlayer(player.id)}
                  >
                    {index + 1}
                  </button>
                ))}
                {matrix.map((source, index) => (
                  <div className="matrix-row" key={source.id}>
                    <button
                      className="matrix-label text-link"
                      onClick={() => setPlayer(source.id)}
                    >
                      {index + 1}. {source.name}
                    </button>
                    {matrix.map((target) => {
                      const connection = source.connections.find(
                        (item) => item.id === target.id,
                      );
                      const strength = connection?.strength ?? 100;
                      return (
                        <span
                          key={target.id}
                          className="matrix-cell"
                          title={`${source.name} / ${target.name}: ${connection?.kind ?? "Self"} (${strength})`}
                          style={{
                            background:
                              source.id === target.id
                                ? "var(--line)"
                                : `color-mix(in srgb,${strength >= 60 ? "var(--green)" : strength < 35 ? "var(--red)" : "var(--amber)"} ${Math.max(12, strength / 2)}%,var(--surface))`,
                          }}
                        >
                          {source.id === target.id ? "-" : strength}
                        </span>
                      );
                    })}
                  </div>
                ))}
              </div>
            </div>
            <div className="pressure-zones">
              <span>
                <i className="zone-line" />
                Strong relationship
              </span>
              <span>
                <i className="zone-line middle" />
                Professional
              </span>
              <span>
                <i className="zone-line bottom" />
                Friction
              </span>
            </div>
          </>
        )}
        {tab === "succession" && (
          <>
            <SectionHeading
              title="Build beyond this season"
              subtitle="Current starters, emerging cover and recruitment gaps"
            />
            <div className="table-scroll" role="region" aria-label="Succession plan" tabIndex={0}>
              <table className="data-table">
                <thead>
                  <tr>
                    <SortHeader {...succession.header("position")} label="Position" />
                    <SortHeader {...succession.header("current")} label="Current option" />
                    <SortHeader {...succession.header("age")} label="Age" />
                    <SortHeader {...succession.header("prospect")} label="Next generation" />
                    <SortHeader {...succession.header("potential")} label="Potential" title="Prospect potential" />
                    <SortHeader {...succession.header("risk")} label="Status" />
                  </tr>
                </thead>
                <tbody>
                  {succession.rows.map((item) => (
                    <tr key={item.position}>
                      <td>
                        <span className="position-tag">{item.position}</span>
                      </td>
                      <td>
                        {item.currentId ? (
                          <PlayerLink
                            id={item.currentId}
                            name={item.current ?? "Player"}
                          />
                        ) : (
                          "No player"
                        )}
                      </td>
                      <td>{item.age ?? "-"}</td>
                      <td>
                        {item.prospect ? (
                          <PlayerName player={item.prospect} compact />
                        ) : (
                          <span className="muted">Recruitment needed</span>
                        )}
                      </td>
                      <td>
                        {item.prospect ? (
                          <Rating value={item.prospect.potential} potential />
                        ) : (
                          "-"
                        )}
                      </td>
                      <td>
                        <Badge
                          tone={
                            item.risk === "Covered"
                              ? "green"
                              : item.risk === "Vacant"
                                ? "red"
                                : "amber"
                          }
                        >
                          {item.risk}
                        </Badge>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
        {tab === "promises" &&
          (data.promises.length ? (
            data.promises.map((promise) => (
              <div className="promise-item" key={promise.id}>
                <div>
                  <strong>
                    {promise.player_id ? (
                      <PlayerLink
                        id={promise.player_id}
                        name={promise.player_name}
                      />
                    ) : (
                      promise.player_name
                    )}
                  </strong>
                  <p>
                    {promise.type} / Review {dateLabel(promise.due_date)}
                  </p>
                </div>
                <Badge
                  tone={
                    promise.status === "fulfilled"
                      ? "green"
                      : promise.status === "broken"
                        ? "red"
                        : "amber"
                  }
                >
                  {label(promise.status)}
                </Badge>
              </div>
            ))
          ) : (
            <Empty
              icon={Shield}
              title="No outstanding promises"
              detail="Agreements made during contract negotiations will appear here."
            />
          ))}
      </Panel>
      {moving && <CallUpDialog playerId={moving.id} playerName={moving.name} onClose={() => setMoving(null)} />}
    </div>
  );
}

function AssignmentSheet({
  scouts,
  close,
}: {
  scouts: Staff[];
  close: () => void;
}) {
  const { bootstrap, act } = useGame();
  const { money } = useCurrency();
  const [staffId, setStaffId] = useState(String(scouts[0]?.id ?? ""));
  const [countryId, setCountryId] = useState("");
  const [position, setPosition] = useState("");
  const [maxAge, setMaxAge] = useState(23);
  const [budget, setBudget] = useState(20_000_000);
  const [pending, setPending] = useState(false);
  async function submit() {
    setPending(true);
    const result = await act({
      type: "scout",
      staffId: Number(staffId),
      ...(countryId ? { countryId: Number(countryId) } : {}),
      ...(position ? { position } : {}),
      maxAge,
      budget,
    });
    setPending(false);
    if (result) close();
  }
  return (
    <Modal title="New scouting assignment" onClose={close}>
      <div className="sheet-body">
        <div className="form-grid">
          <Field label="Scout">
            <select
              value={staffId}
              onChange={(event) => setStaffId(event.target.value)}
            >
              {scouts.map((scout) => (
                <option key={scout.id} value={scout.id}>
                  {scout.name} / {scout.ability}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Region">
            <select
              value={countryId}
              onChange={(event) => setCountryId(event.target.value)}
            >
              <option value="">Worldwide</option>
              {bootstrap?.countries.map((country) => (
                <option key={country.id} value={country.id}>
                  {country.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Position">
            <select
              value={position}
              onChange={(event) => setPosition(event.target.value)}
            >
              <option value="">Any position</option>
              {POSITIONS.map((value) => (
                <option key={value}>{value}</option>
              ))}
            </select>
          </Field>
          <Field label="Maximum age">
            <input
              type="number"
              min="14"
              max="45"
              value={maxAge}
              onChange={(event) => setMaxAge(Number(event.target.value))}
            />
          </Field>
          <Field label="Maximum player value">
            <MoneyInput min={0} value={budget} onChange={setBudget} />
          </Field>
          <div className="assignment-cost">
            <span>Assignment fee</span>
            <strong>{money(2500)}</strong>
            <small>7-day assignment</small>
          </div>
        </div>
      </div>
      <footer className="sheet-footer">
        <Button variant="secondary" onClick={close}>
          Cancel
        </Button>
        <Button
          icon={Compass}
          disabled={pending || !staffId}
          onClick={() => void submit()}
        >
          Send scout
        </Button>
      </footer>
    </Modal>
  );
}

export function Scouting() {
  const { bootstrap, setPlayer, navigate } = useGame();
  const { money } = useCurrency();
  const { data, error } = useResource<ScoutingData>("scouting");
  const [tab, setTab] = useState("reports");
  const [assign, setAssign] = useState(false);
  const reports = useSortableRows(data?.reports ?? [], REPORT_COLUMNS, {
    initial: { key: "date", direction: "desc" },
    tieBreakers: REPORT_TIE_BREAKERS,
  });
  const assignments = useSortableRows(data?.assignments ?? [], ASSIGNMENT_COLUMNS, {
    initial: { key: "due", direction: "desc" },
    tieBreakers: [{ value: (assignment) => assignment.id, defaultDirection: "desc" }],
  });
  if (error) return <ErrorState message={error} />;
  if (!data || !bootstrap) return <Loading />;
  const active = data.assignments.filter(
    (assignment) => assignment.status === "active",
  );
  return (
    <div className="page">
      <PageHeading
        eyebrow="RECRUITMENT INTELLIGENCE"
        title="Scouting centre"
        subtitle="Find the right player. Understand the person."
      >
        <Button
          icon={Plus}
          onClick={() => setAssign(true)}
          disabled={!data.scouts.length}
        >
          New assignment
        </Button>
      </PageHeading>
      <div className="stat-strip">
        <Stat
          label="Scouting team"
          value={data.scouts.length}
          icon={ScanLine}
          detail="Scouts employed"
        />
        <Stat
          label="Active assignments"
          value={active.length}
          icon={Compass}
          detail="Across your scouting network"
        />
        <Stat
          label="Player reports"
          value={data.reports.length}
          icon={ClipboardCheck}
          detail="Completed assessments"
        />
        <Stat
          label="Shortlisted players"
          value={data.shortlist.length}
          icon={Bookmark}
          detail="Your recruitment priorities"
        />
      </div>
      <Panel>
        <Tabs
          items={[
            {
              id: "reports",
              label: "Scout reports",
              count: data.reports.length,
            },
            {
              id: "shortlist",
              label: "Shortlist",
              count: data.shortlist.length,
            },
            { id: "assignments", label: "Assignments", count: active.length },
            { id: "team", label: "Scouting team" },
          ]}
          value={tab}
          onChange={setTab}
        />
        {tab === "reports" &&
          (data.reports.length ? (
            <div className="table-scroll" role="region" aria-label="Scout reports" tabIndex={0}>
              <table className="data-table">
                <thead>
                  <tr>
                    <SortHeader {...reports.header("name")} label="Player" />
                    <SortHeader {...reports.header("position")} label="Position" />
                    <SortHeader {...reports.header("age")} label="Age" />
                    <SortHeader {...reports.header("ability")} label="Ability range" title="Estimated ability, by midpoint" />
                    <SortHeader {...reports.header("potential")} label="Potential range" title="Estimated potential, by midpoint" />
                    <SortHeader {...reports.header("fit")} label="Tactical fit" />
                    <SortHeader {...reports.header("risk")} label="Risk" />
                    <SortHeader {...reports.header("accuracy")} label="Confidence" />
                    <SortHeader {...reports.header("date")} label="Reported" />
                    <th>Report</th>
                  </tr>
                </thead>
                <tbody>
                  {reports.rows.map((report) => (
                    <tr key={report.id}>
                      <td>
                        <div className="report-player">
                          <strong>
                            <PlayerLink
                              id={report.player_id}
                              name={report.player_name ?? "Player"}
                            />
                          </strong>
                          <small>
                            <ClubLink
                              id={report.club_id}
                              name={report.club_name ?? "No club"}
                            />
                          </small>
                        </div>
                      </td>
                      <td>
                        <span className="position-tag">{report.position}</span>
                      </td>
                      <td>{report.age}</td>
                      <td>
                        <Badge tone="green">
                          {report.ability_low}-{report.ability_high}
                        </Badge>
                      </td>
                      <td>
                        <Badge tone="violet">
                          {report.potential_low}-{report.potential_high}
                        </Badge>
                      </td>
                      <td>
                        <div className="cell-meter">
                          <Meter value={report.fit} />
                          <small>{report.fit}%</small>
                        </div>
                      </td>
                      <td>
                        <Badge
                          tone={
                            report.risk > 65
                              ? "red"
                              : report.risk > 40
                                ? "amber"
                                : "green"
                          }
                        >
                          {report.risk > 65
                            ? "High"
                            : report.risk > 40
                              ? "Moderate"
                              : "Low"}
                        </Badge>
                      </td>
                      <td>{report.accuracy}%</td>
                      <td>{dateLabel(report.date)}</td>
                      <td>
                        <IconButton
                          icon={ArrowUpRight}
                          label={`View report for ${report.player_name}`}
                          onClick={() => setPlayer(report.player_id)}
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <Empty
              icon={ScanLine}
              title="A blank scouting notebook"
              detail="Set the brief and send your first assignment."
            />
          ))}
        {tab === "shortlist" && <Shortlist players={data.shortlist} />}
        {tab === "assignments" &&
          (data.assignments.length ? (
            <div className="table-scroll" role="region" aria-label="Scouting assignments" tabIndex={0}>
              <table className="data-table">
                <thead>
                  <tr>
                    <SortHeader {...assignments.header("scout")} label="Scout" />
                    <SortHeader {...assignments.header("brief")} label="Brief" />
                    <SortHeader {...assignments.header("position")} label="Position" />
                    <SortHeader {...assignments.header("age")} label="Age limit" />
                    <SortHeader {...assignments.header("budget")} label="Budget" />
                    <SortHeader {...assignments.header("due")} label="Due" />
                    <SortHeader {...assignments.header("status")} label="Status" />
                  </tr>
                </thead>
                <tbody>
                  {assignments.rows.map((assignment) => (
                    <tr key={assignment.id}>
                      <td>
                        <strong>{assignment.scout_name}</strong>
                      </td>
                      <td>
                        {assignment.player_id && assignment.player_name ? (
                          <PlayerLink
                            id={assignment.player_id}
                            name={assignment.player_name}
                          />
                        ) : (
                          (assignment.country_name ?? "Worldwide search")
                        )}
                      </td>
                      <td>{assignment.position ?? "All"}</td>
                      <td>{assignment.max_age}</td>
                      <td>{money(assignment.budget)}</td>
                      <td>{dateLabel(assignment.due_date)}</td>
                      <td>
                        <Badge
                          tone={
                            assignment.status === "complete"
                              ? "green"
                              : assignment.status === "active"
                                ? "blue"
                                : "neutral"
                          }
                        >
                          {label(assignment.status)}
                        </Badge>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <Empty
              icon={Compass}
              title="Scouts ready for a brief"
              detail="Set a region, position, age profile and budget."
            >
              <Button icon={Plus} onClick={() => setAssign(true)}>
                Create assignment
              </Button>
            </Empty>
          ))}
        {tab === "team" && (
          <div className="padded">
            <div className="cards-list">
              {data.scouts.map((scout) => {
                const details = JSON.parse(scout.data);
                return (
                  <article className="entity-card" key={scout.id}>
                    <div className="entity-card-top">
                      <Badge tone="green">{scout.personality}</Badge>
                      <Rating value={scout.ability} />
                    </div>
                    <h3>{scout.name}</h3>
                    <p>{scout.role}</p>
                    <dl className="detail-list">
                      <div>
                        <dt>Accuracy</dt>
                        <dd>{details.accuracy}%</dd>
                      </div>
                      <div>
                        <dt>Report detail</dt>
                        <dd>{details.detail}/100</dd>
                      </div>
                      <div>
                        <dt>Risk tolerance</dt>
                        <dd>{details.riskTolerance}/100</dd>
                      </div>
                      <div>
                        <dt>Preference / bias</dt>
                        <dd>{details.bias}</dd>
                      </div>
                      <div>
                        <dt>Communication</dt>
                        <dd>{scout.communication}</dd>
                      </div>
                    </dl>
                    <Badge
                      tone={
                        active.some(
                          (assignment) => assignment.staff_id === scout.id,
                        )
                          ? "blue"
                          : "green"
                      }
                    >
                      {active.some(
                        (assignment) => assignment.staff_id === scout.id,
                      )
                        ? "On assignment"
                        : "Available"}
                    </Badge>
                  </article>
                );
              })}
            </div>
            {!data.scouts.length && (
              <Empty icon={Users} title="No scouts employed">
                <Button onClick={() => navigate("staff")}>
                  Recruit a scout
                </Button>
              </Empty>
            )}
          </div>
        )}
      </Panel>
      {assign && (
        <AssignmentSheet scouts={data.scouts} close={() => setAssign(false)} />
      )}
    </div>
  );
}
