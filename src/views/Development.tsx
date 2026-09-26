import { useState } from "react";
import {
  ArrowLeftRight,
  ArrowUp,
  Check,
  Dumbbell,
  GraduationCap,
  HeartPulse,
  Network,
  Save,
  Search,
  ShieldCheck,
  Target,
  TrendingUp,
  Users,
  X,
} from "lucide-react";
import { useCurrency, useGame, useResource } from "../game-context.tsx";
import {
  Badge,
  BodyCell,
  Button,
  DetailList,
  Empty,
  ErrorState,
  Field,
  FixtureRow,
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
  TextLink,
} from "../ui.tsx";
import { dateLabel, POSITIONS, TRAINING_TYPES } from "../../shared/rules.ts";
import type { AcademyData, StaffDesk, TrainingData } from "../../shared/api.ts";
import type { Player, Staff } from "../../shared/types.ts";
import { AssistantPanel } from "./ClubSupport.tsx";
import {
  dateValue,
  PLAYER_COLUMNS,
  PLAYER_TIE_BREAKERS,
  positionRank,
  rankOf,
  type SortColumn,
} from "../sort.ts";
import { useSortableRows } from "../useSortableRows.ts";

type AcademySortKey =
  | "name"
  | "position"
  | "age"
  | "ability"
  | "potential"
  | "height"
  | "development"
  | "burnout";
const ACADEMY_COLUMNS: SortColumn<Player, AcademySortKey>[] = [
  PLAYER_COLUMNS.name,
  PLAYER_COLUMNS.position,
  PLAYER_COLUMNS.age,
  PLAYER_COLUMNS.ability,
  PLAYER_COLUMNS.potential,
  PLAYER_COLUMNS.height,
  { key: "development", value: (player) => player.training, defaultDirection: "asc" },
  { key: "burnout", value: (player) => player.details?.mentalHealth.burnout, defaultDirection: "desc" },
];
const ACADEMY_SORT_OPTIONS: [AcademySortKey, string][] = [
  ["potential", "Potential"],
  ["ability", "Ability"],
  ["age", "Age"],
  ["name", "Name"],
  ["position", "Position"],
  ["height", "Height"],
  ["burnout", "Burnout"],
];
const MENTORSHIP_COLUMNS: SortColumn<Player, "name" | "position" | "mentor" | "focus">[] = [
  PLAYER_COLUMNS.name,
  PLAYER_COLUMNS.position,
  {
    key: "mentor",
    value: (player) =>
      player.details ? (player.details.development.mentorId ? 1 : 0) : null,
    defaultDirection: "asc",
  },
  { key: "focus", value: (player) => player.training, defaultDirection: "asc" },
];
const AGE_GROUPS = ["Senior", "U19", "U17"];
const TRAINING_COLUMNS: SortColumn<
  Player,
  "name" | "group" | "focus" | "intensity" | "position" | "fitness"
>[] = [
  PLAYER_COLUMNS.name,
  { key: "group", value: (player) => rankOf(AGE_GROUPS, player.age_group), defaultDirection: "asc" },
  { key: "focus", value: (player) => player.training, defaultDirection: "asc" },
  { key: "intensity", value: (player) => player.intensity, defaultDirection: "desc" },
  { key: "position", value: (player) => positionRank(player.position), defaultDirection: "asc" },
  PLAYER_COLUMNS.fitness,
];
const MEDICAL_COLUMNS: SortColumn<Player, "name" | "return" | "condition" | "plan">[] = [
  PLAYER_COLUMNS.name,
  { key: "return", value: (player) => dateValue(player.injury_until), defaultDirection: "asc" },
  { key: "condition", value: (player) => player.fitness, defaultDirection: "desc" },
  { key: "plan", value: (player) => player.training, defaultDirection: "asc" },
];

function MentorSheet({ player, close }: { player: Player; close: () => void }) {
  const { act } = useGame();
  const { data, error, loading } = useResource<TrainingData>("training");
  const [mentor, setMentor] = useState("");
  const [pending, setPending] = useState(false);
  const candidates = data?.mentors.filter((candidate) => candidate.id !== player.id) ?? [];
  return (
    <Modal title={`Mentorship / ${player.name}`} onClose={close}>
      <div className="sheet-body">
        {loading && <Loading label="Loading mentors" />}
        {error && <ErrorState message={error} />}
        {data && !candidates.length && <Empty title="No senior mentors available" />}
        <Field label="Senior mentor">
          <select
            value={mentor}
            disabled={loading || pending || !candidates.length}
            onChange={(event) => setMentor(event.target.value)}
          >
            <option value="">Select a mentor</option>
            {candidates.map((candidate) => (
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
          disabled={!mentor || pending || loading || !!error}
          onClick={() => {
            setPending(true);
            void act({
              type: "mentor",
              playerId: player.id,
              mentorId: Number(mentor),
            }).then((result) => {
              if (result) close();
            }).finally(() => setPending(false));
          }}
        >
          Confirm mentorship
        </Button>
      </footer>
    </Modal>
  );
}

export function Academy() {
  const { bootstrap, act, setPlayer, openLeague, confirm } = useGame();
  const { data, error, loading } = useResource<AcademyData>("academy", { keepPreviousData: true });
  const [tab, setTab] = useState("prospects");
  const [group, setGroup] = useState("U19");
  const [query, setQuery] = useState("");
  const [position, setPosition] = useState("");
  const [focus, setFocus] = useState("");
  const [mentee, setMentee] = useState<Player | null>(null);
  const season = bootstrap?.state.season ?? 0;
  const today = bootstrap?.state.date ?? "";
  const cohort = (data?.players ?? []).filter(
    (player) => group === "all" || player.age_group === group,
  );
  const agesOut = (player: Player) =>
    (player.age_group === "U17" || player.age_group === "U19") &&
    player.birth_date < `${season + 1 - (player.age_group === "U17" ? 16 : 18)}-01-01`;
  const isInjured = (player: Player) =>
    !!player.injury_until && player.injury_until > today;
  const needsCare = (player: Player) =>
    isInjured(player) || player.fitness < 60 || (player.details?.mentalHealth.burnout ?? 0) >= 60;
  const isUnpaired = (player: Player) => player.details?.development.mentorId === null;
  const priorities = (player: Player) => [
    ...(agesOut(player) ? ["Age-out review"] : []),
    ...(isInjured(player) ? ["Injured"] : []),
    ...(player.fitness < 60 ? ["Fitness below 60"] : []),
    ...((player.details?.mentalHealth.burnout ?? 0) >= 60 ? ["Burnout 60+"] : []),
    ...(isUnpaired(player) ? ["No mentor"] : []),
  ];
  const filtered = cohort.filter((player) =>
    (!position || player.position === position) &&
    (!query || `${player.name} ${player.nationality}`.toLowerCase().includes(query.trim().toLowerCase())) &&
    (!focus || (focus === "age-out" ? agesOut(player) : focus === "care" ? needsCare(player) : isUnpaired(player))),
  );
  const sorting = useSortableRows(filtered, ACADEMY_COLUMNS, {
    initial: { key: "potential", direction: "desc" },
    tieBreakers: PLAYER_TIE_BREAKERS,
  });
  const mentorship = useSortableRows(filtered, MENTORSHIP_COLUMNS, {
    initial: { key: "mentor", direction: "asc" },
    tieBreakers: PLAYER_TIE_BREAKERS,
  });
  if (error) return <ErrorState message={error} />;
  if (!data || !bootstrap) return <Loading />;
  const selected = sorting.rows;
  const priorityPlayers = selected.filter((player) => priorities(player).length);
  const cohortLeagues = data.leagues.filter((league) => group === "all" || league.age_group === group);
  const leagueIds = new Set(cohortLeagues.map((league) => league.id));
  const cohortFixtures = data.fixtures.filter(
    (fixture) => group === "all" || (fixture.league_id !== null && leagueIds.has(fixture.league_id)),
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
      <fieldset className="cohort-switcher" data-no-swipe>
        <legend className="sr-only">Academy age group</legend>
        {["U19", "U17", "all"].map((ageGroup) => (
          <label className="cohort-choice" key={ageGroup}>
            <input
              type="radio"
              name="academy-cohort"
              value={ageGroup}
              checked={group === ageGroup}
              aria-label={ageGroup === "all" ? "All academy age groups" : `${ageGroup} academy`}
              onChange={() => setGroup(ageGroup)}
            />
            <span>
              <strong>{ageGroup === "all" ? "All youth" : ageGroup}</strong>
              <small>{data.players.filter((player) => ageGroup === "all" || player.age_group === ageGroup).length} players</small>
            </span>
          </label>
        ))}
      </fieldset>
      <div className="stat-strip compact-stat-strip">
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
          label={group === "all" ? "Young players" : `${group} players`}
          value={cohort.length}
          icon={Users}
          detail={`${cohort.filter((player) => player.potential >= 80).length} with potential 80+`}
        />
        <Stat
          label="Age-out review"
          value={cohort.filter(agesOut).length}
          icon={ArrowUp}
          detail={`Next season / ${bootstrap.state.season + 1}`}
        />
        <Stat
          label="With a mentor"
          value={cohort.filter((player) => !!player.details?.development.mentorId).length}
          icon={Network}
          detail={`${cohort.filter(isUnpaired).length} unpaired`}
        />
      </div>
      {data.intake && <div className="academy-intake">Last intake: {data.intake.count} players / {dateLabel(data.intake.date)}</div>}
      <Panel>
        <Tabs
          label="Academy views"
          items={[
            { id: "prospects", label: "Prospects" },
            { id: "priorities", label: "Development priorities", count: cohort.filter((player) => priorities(player).length).length },
            { id: "mentorship", label: "Mentorship", count: cohort.filter(isUnpaired).length },
            { id: "calendar", label: "Youth competitions" },
          ]}
          value={tab}
          onChange={setTab}
        />
        {tab !== "calendar" && (
          <>
            <div className="filter-bar roster-toolbar">
              <div className="search-field">
                <Search size={17} aria-hidden="true" />
                <input aria-label="Search academy players" placeholder="Search academy" value={query} onChange={(event) => setQuery(event.target.value)} />
              </div>
              <Field label="Position">
                <select aria-label="Academy position" value={position} onChange={(event) => setPosition(event.target.value)}>
                  <option value="">All positions</option>
                  {POSITIONS.map((item) => <option key={item}>{item}</option>)}
                </select>
              </Field>
              <Field label="Review">
                <select aria-label="Academy review" value={focus} onChange={(event) => setFocus(event.target.value)}>
                  <option value="">All players</option>
                  <option value="age-out">Age-out next season</option>
                  <option value="care">Injury / fitness / burnout</option>
                  <option value="mentor">Without a mentor</option>
                </select>
              </Field>
              <Field label="Sort by">
                <select
                  aria-label="Sort academy players"
                  value={sorting.sort?.key ?? ""}
                  onChange={(event) => {
                    const key = event.target.value as AcademySortKey;
                    sorting.setSort({ key, direction: sorting.defaultDirection(key) });
                  }}
                >
                  {ACADEMY_SORT_OPTIONS.map(([key, text]) => (
                    <option key={key} value={key}>{text}</option>
                  ))}
                </select>
              </Field>
              <SortDirectionButton
                subject="academy players"
                direction={sorting.sort?.direction}
                onToggle={() => sorting.sort && sorting.toggle(sorting.sort.key)}
              />
              {(query || position || focus) && <IconButton icon={X} label="Clear academy filters" onClick={() => { setQuery(""); setPosition(""); setFocus(""); }} />}
            </div>
            <div className="position-coverage" role="group" aria-label="Academy position coverage">
              {POSITIONS.map((item) => {
                const count = cohort.filter((player) => player.position === item).length;
                return (
                  <button type="button" key={item} aria-pressed={position === item} aria-label={`${item}: ${count} academy players`} onClick={() => setPosition(position === item ? "" : item)}>
                    <span>{item}</span><strong>{count}</strong>
                  </button>
                );
              })}
            </div>
            <div className="roster-result-count" role="status">{tab === "priorities" ? priorityPlayers.length : selected.length} of {cohort.length} players{loading ? " / Updating" : ""}</div>
          </>
        )}
        {tab === "prospects" && (
            <div className="table-scroll roster-table-scroll" role="region" aria-label="Academy prospects" tabIndex={0} aria-busy={loading}>
              <table className="data-table academy-table">
                <caption className="sr-only">{group === "all" ? "Academy" : group} prospects and pathways</caption>
                <thead>
                  <tr>
                    <SortHeader {...sorting.header("name")} label="Player" />
                    <SortHeader {...sorting.header("position")} label="Pos" title="Position" />
                    <SortHeader {...sorting.header("age")} label="Group / age" title="Age" />
                    <SortHeader {...sorting.header("ability")} label="Ability" title="Current ability" />
                    <SortHeader {...sorting.header("potential")} label="Potential" title="Current dynamic potential" />
                    <SortHeader {...sorting.header("height")} label="Height" title="Current height and weight" />
                    <SortHeader {...sorting.header("development")} label="Development" title="Training focus" />
                    <SortHeader {...sorting.header("burnout")} label="Burnout" />
                    <th>Pathway</th>
                  </tr>
                </thead>
                <tbody>
                  {selected.map((player) => (
                    <tr key={player.id}>
                      <td>
                        <PlayerName player={player} compact />
                      </td>
                      <td>
                        <span className="position-tag">{player.position}</span>
                      </td>
                      <td>{player.age_group} / {player.age}</td>
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
                        <BodyCell player={player} />
                      </td>
                      <td>
                        <div className="roster-status">
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
                          {agesOut(player) && <Badge tone="amber">Age-out review</Badge>}
                          {isInjured(player) && <Badge tone="red">Injured</Badge>}
                          {!!player.parent_club_id && <Badge tone="blue">On loan</Badge>}
                        </div>
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
                            <Button
                              icon={ArrowUp}
                              variant="ghost"
                              disabled={player.age < 16 || loading}
                              onClick={() =>
                                void act({
                                  type: "promote",
                                  playerId: player.id,
                                })
                              }
                            >
                              Promote
                            </Button>
                          <IconButton icon={ArrowLeftRight} label={`Squad assignment for ${player.name}`} onClick={() => setPlayer(player.id)} />
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {!selected.length && (
                <Empty
                  title="No players in this cohort"
                />
              )}
            </div>
        )}
        {tab === "priorities" && (
          <div className="academy-priorities" aria-busy={loading}>
            {priorityPlayers.length ? priorityPlayers.map((player) => (
              <article className="academy-priority-row" key={player.id}>
                <div className="academy-priority-identity">
                  <PlayerName player={player} compact />
                  <div className="academy-priority-tags">
                    {priorities(player).map((priority) => <Badge key={priority} tone={priority === "Injured" ? "red" : "amber"}>{priority}</Badge>)}
                  </div>
                  <small>Fitness {Math.round(player.fitness)}% / Burnout {player.details ? Math.round(player.details.mentalHealth.burnout) : "Not recorded"}</small>
                </div>
                <Field label="Training focus">
                  <select aria-label={`Training for ${player.name}`} value={player.training} disabled={loading} onChange={(event) => void act({ type: "training", playerId: player.id, focus: event.target.value, intensity: player.intensity })}>
                    {TRAINING_TYPES.map((training) => <option key={training}>{training}</option>)}
                  </select>
                </Field>
                <Field label="Intensity">
                  <select aria-label={`Intensity for ${player.name}`} value={player.intensity} disabled={loading} onChange={(event) => void act({ type: "training", playerId: player.id, focus: player.training, intensity: Number(event.target.value) })}>
                    {[...new Set([20, 35, 50, 65, 80, 95, player.intensity])].sort((first, second) => first - second).map((intensity) => <option key={intensity} value={intensity}>{intensity}%</option>)}
                  </select>
                </Field>
                <div className="academy-priority-actions" role="group" aria-label={`Development actions for ${player.name}`}>
                  <Button icon={Network} variant="secondary" onClick={() => setMentee(player)}>Mentor</Button>
                  <IconButton icon={ArrowLeftRight} label={`Squad assignment for ${player.name}`} onClick={() => setPlayer(player.id)} />
                </div>
              </article>
            )) : <Empty title="No development priorities in this selection" />}
          </div>
        )}
        {tab === "mentorship" && (
          <div className="table-scroll roster-table-scroll" role="region" aria-label="Academy mentorship" tabIndex={0} aria-busy={loading}>
            <table className="data-table mentorship-table">
              <caption className="sr-only">{group === "all" ? "Academy" : group} mentorship</caption>
              <thead>
                <tr>
                  <SortHeader {...mentorship.header("name")} label="Player" />
                  <SortHeader {...mentorship.header("position")} label="Pos" title="Position" />
                  <SortHeader {...mentorship.header("mentor")} label="Mentor" title="Unpaired players first" />
                  <SortHeader {...mentorship.header("focus")} label="Development focus" />
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {mentorship.rows.map((player) => (
                  <tr key={player.id}>
                    <td><PlayerName player={player} compact /></td>
                    <td><span className="position-tag">{player.position}</span></td>
                    <td>{player.details?.development.mentorId
                      ? <TextLink onClick={() => setPlayer(player.details!.development.mentorId)}>View mentor</TextLink>
                      : <Badge tone="amber">{player.details ? "Not paired" : "Not recorded"}</Badge>}</td>
                    <td>{player.training}</td>
                    <td><Button icon={Network} variant="secondary" onClick={() => setMentee(player)}>{player.details?.development.mentorId ? "Change mentor" : "Assign mentor"}</Button></td>
                  </tr>
                ))}
              </tbody>
            </table>
            {!selected.length && <Empty title="No players in this selection" />}
          </div>
        )}
        {tab === "calendar" && (
          <div className="padded">
            <div className="equal-columns">
              <div>
                <h3 className="subsection-title">Competitions</h3>
                {cohortLeagues.map((league) => (
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
                {!cohortLeagues.length && <Empty title="No competitions for this cohort" />}
              </div>
              <div>
                <h3 className="subsection-title">Next fixtures</h3>
                {cohortFixtures.map((fixture) => (
                  <FixtureRow fixture={fixture} key={fixture.id} />
                ))}
                {!cohortFixtures.length && <Empty title="No upcoming fixtures in this cohort" />}
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
  const { data, error, loading } = useResource<TrainingData>("training", { keepPreviousData: true });
  const [tab, setTab] = useState("programme");
  const [group, setGroup] = useState("");
  const [position, setPosition] = useState("");
  const [query, setQuery] = useState("");
  const filtered = (data?.players ?? []).filter((player) =>
    (!group || player.age_group === group) &&
    (!position || player.position === position) &&
    (!query || player.name.toLowerCase().includes(query.trim().toLowerCase())),
  );
  const plans = useSortableRows(filtered, TRAINING_COLUMNS, {
    tieBreakers: PLAYER_TIE_BREAKERS,
  });
  const medical = useSortableRows(data?.injuries ?? [], MEDICAL_COLUMNS, {
    initial: { key: "return", direction: "asc" },
    tieBreakers: PLAYER_TIE_BREAKERS,
  });
  if (error) return <ErrorState message={error} />;
  if (!data || !bootstrap) return <Loading />;
  const players = plans.rows;
  return (
    <div className="page">
      <PageHeading
        eyebrow="PERFORMANCE & CARE"
        title="Development centre"
        subtitle={`${bootstrap.club.name} / ${data.plan.focus}`}
      />
      <div className="stat-strip compact-stat-strip">
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
          label="Training views"
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
          <>
          <div className="filter-bar roster-toolbar">
            <div className="search-field">
              <Search size={17} aria-hidden="true" />
              <input aria-label="Search training players" placeholder="Search players" value={query} onChange={(event) => setQuery(event.target.value)} />
            </div>
            <Field label="Age group">
              <select aria-label="Training age group" value={group} onChange={(event) => setGroup(event.target.value)}>
                <option value="">All age groups</option>
                <option value="Senior">Senior</option>
                <option>U19</option>
                <option>U17</option>
              </select>
            </Field>
            <Field label="Position">
              <select aria-label="Training position" value={position} onChange={(event) => setPosition(event.target.value)}>
                <option value="">All positions</option>
                {POSITIONS.map((item) => <option key={item}>{item}</option>)}
              </select>
            </Field>
            {(query || group || position) && <IconButton icon={X} label="Clear training filters" onClick={() => { setQuery(""); setGroup(""); setPosition(""); }} />}
          </div>
          <div className="roster-result-count" role="status">{players.length} of {data.players.length} players</div>
          <div className="table-scroll roster-table-scroll" role="region" aria-label="Individual training plans" tabIndex={0} aria-busy={loading}>
            <table className="data-table">
              <thead>
                <tr>
                  <SortHeader {...plans.header("name")} label="Player" />
                  <SortHeader {...plans.header("group")} label="Group" title="Age group" />
                  <SortHeader {...plans.header("focus")} label="Development focus" />
                  <SortHeader {...plans.header("intensity")} label="Intensity" />
                  <SortHeader {...plans.header("position")} label="Position training" title="Position" />
                  <SortHeader {...plans.header("fitness")} label="Fitness" />
                </tr>
              </thead>
              <tbody>
                {players.map((player) => (
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
            {!players.length && <Empty title="No training plans in this selection" />}
          </div>
          </>
        )}
        {tab === "medical" &&
          (data.injuries.length ? (
            <div className="table-scroll" role="region" aria-label="Medical room" tabIndex={0}>
              <table className="data-table">
                <thead>
                  <tr>
                    <SortHeader {...medical.header("name")} label="Player" />
                    <SortHeader {...medical.header("return")} label="Expected return" />
                    <SortHeader {...medical.header("condition")} label="Condition" title="Fitness" />
                    <SortHeader {...medical.header("plan")} label="Current plan" />
                    <th>Action</th>
                  </tr>
                </thead>
                <tbody>
                  {medical.rows.map((player) => (
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
