import { useDeferredValue, useState } from "react";
import {
  ArrowUpRight,
  CalendarDays,
  Globe2,
  Search,
  Trophy,
  Star,
  Bell,
  RotateCcw,
  ChevronLeft,
  ChevronRight,
} from "lucide-react";
import { api, useGame, useResource } from "../game-context.tsx";
import {
  Badge,
  Button,
  Empty,
  ErrorState,
  FixtureRow,
  IconButton,
  Loading,
  PageHeading,
  Panel,
  SectionHeading,
  StandingsTable,
  Tabs,
  TextLink,
  ZoneLegend,
} from "../ui.tsx";
import { leagueZones } from "../table-zones.ts";
import { seasonText } from "../format.ts";
import {
  compactNumber,
  label,
  COMPETITION_ALERTS,
} from "../../shared/rules.ts";
import type {
  CompetitionDetail,
  CompetitionFavorite,
} from "../../shared/api.ts";
import type { League } from "../../shared/types.ts";

/** Title and movement play-offs are stored as cups: `data.playoff`, or the play-off shape (`key` + `leagueId`). */
function isPlayoff(league: Pick<League, "kind" | "format" | "data">) {
  if (league.kind !== "cup") return false;
  try {
    const data = JSON.parse(league.data || "{}") as Record<string, unknown>;
    if (typeof data.playoff === "boolean") return data.playoff;
    if (typeof data.key === "string" && typeof data.leagueId === "number")
      return true;
  } catch {
    // Unreadable data: fall back to the stored format.
  }
  return /play-?(off|out)/i.test(league.format);
}

const kindLabel = (league: League) =>
  isPlayoff(league) ? "Play-offs" : label(league.kind);

const phaseLabel = (phase: string) =>
  phase === "playoff" ? "Play-offs" : label(phase);

export default function Competitions() {
  const { bootstrap, leagueId, openLeague, openMatch, refresh, notify } =
    useGame();
  const [favoritesOnly, setFavoritesOnly] = useState(false);
  const [savingFavorite, setSavingFavorite] = useState(false);
  const [pendingEvents, setPendingEvents] = useState<{
    leagueId: number;
    events: Partial<CompetitionFavorite["events"]>;
  } | null>(null);
  const [pagination, setPagination] = useState({ key: "", page: 1 });
  const { data: favorites } = useResource<CompetitionFavorite[]>(
    "competitions/favorites",
  );
  const [country, setCountry] = useState("");
  const [kind, setKind] = useState("");
  const [age, setAge] = useState("");
  const [search, setSearch] = useState("");
  const [tab, setTab] = useState("table");
  const [group, setGroup] = useState("");
  const [schedule, setSchedule] = useState("upcoming");
  const deferredSearch = useDeferredValue(search);
  const filterKey = JSON.stringify([
    deferredSearch,
    country,
    kind,
    age,
    favoritesOnly,
  ]);
  const page = pagination.key === filterKey ? pagination.page : 1;
  const params = new URLSearchParams({
    q: deferredSearch,
    limit: "50",
    page: String(page),
  });
  if (favoritesOnly) params.set("favorites", "1");
  if (country) params.set("country", country);
  if (kind) params.set("kind", kind);
  if (age) params.set("age", age);
  const { data: leagues } = useResource<League[]>(`leagues?${params}`);
  const selected = leagueId ?? bootstrap?.club.league_id;
  const { data, error } = useResource<CompetitionDetail>(
    selected ? `leagues/${selected}` : null,
    { cache: true },
  );
  const favorite = favorites?.find((entry) => entry.leagueId === selected);
  const favoriteEvents = favorite
    ? {
        ...favorite.events,
        ...(pendingEvents && pendingEvents.leagueId === selected
          ? pendingEvents.events
          : {}),
      }
    : null;
  async function updateFavorite(
    id: number,
    active: boolean,
    events?: Partial<CompetitionFavorite["events"]>,
  ) {
    setSavingFavorite(true);
    if (events) setPendingEvents({ leagueId: id, events });
    try {
      await api(`competitions/${id}/favorite`, {
        method: "PUT",
        body: JSON.stringify({ active, ...(events ? { events } : {}) }),
      });
      await refresh();
    } catch (failure) {
      notify(
        failure instanceof Error
          ? failure.message
          : "Could not update favorites.",
        "error",
      );
    } finally {
      setSavingFavorite(false);
      setPendingEvents(null);
    }
  }
  if (!bootstrap) return <Loading />;
  const groups = [
    ...new Set(data?.table.map((entry) => entry.group_name) ?? []),
  ];
  const ownGroup = data?.table.find(
    (entry) => entry.club_id === bootstrap.club.id,
  )?.group_name;
  const currentGroup = groups.includes(group)
    ? group
    : ownGroup !== undefined
      ? ownGroup
      : groups[0];
  const competitionData = data ? JSON.parse(data.league.data) : {};
  const zones =
    data?.league.kind === "league" ? leagueZones(competitionData) : null;
  const shownTable =
    data?.table.filter(
      (entry) => groups.length <= 1 || entry.group_name === currentGroup,
    ) ?? [];
  // Split leagues rank each group from its first overall position (e.g. a relegation round from 7th).
  const splitGroup = (
    competitionData.split?.groups as
      | { name: string; positions: [number, number] }[]
      | undefined
  )?.find((entry) => entry.name === currentGroup);
  const positionOffset = splitGroup ? splitGroup.positions[0] - 1 : 0;
  const tableSize = splitGroup ? (data?.table.length ?? 0) : shownTable.length;
  const fixtures =
    data?.fixtures.filter((fixture) =>
      schedule === "results"
        ? fixture.status === "played"
        : fixture.status === "scheduled",
    ) ?? [];
  return (
    <div className="page">
      <PageHeading
        eyebrow="THE FOOTBALL WORLD"
        title="Competitions"
        subtitle={`${bootstrap.world.countries} associations / ${compactNumber(bootstrap.world.leagues)} domestic leagues`}
      >
        <Badge tone="blue">
          <Globe2 size={12} />
          {seasonText(bootstrap.state.season)}
        </Badge>
      </PageHeading>
      <div className="organized-filters" aria-label="Competition filters">
        <div className="search-field">
          <Search size={16} />
          <input
            aria-label="Search competitions"
            placeholder="Search leagues and tournaments..."
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
        </div>
        <fieldset className="filter-group">
          <legend>Association</legend>
          <select
            aria-label="Competition country"
            value={country}
            onChange={(event) => setCountry(event.target.value)}
          >
            <option value="">All associations</option>
            {bootstrap.countries.map((item) => (
              <option key={item.id} value={item.id}>
                {item.name}
              </option>
            ))}
          </select>
        </fieldset>
        <fieldset className="filter-group">
          <legend>Competition</legend>
          <select
            aria-label="Competition type"
            value={kind}
            onChange={(event) => setKind(event.target.value)}
          >
            <option value="">All competitions</option>
            <option value="league">Domestic leagues</option>
            <option value="continental">Continental</option>
            <option value="international">International</option>
            <option value="youth">Youth tournaments</option>
            <option value="cup">Domestic cups & play-offs</option>
          </select>
          <select
            aria-label="Competition age group"
            value={age}
            onChange={(event) => setAge(event.target.value)}
          >
            <option value="">All age groups</option>
            <option>Senior</option>
            <option>U21</option>
            <option>U20</option>
            <option>U19</option>
            <option>U17</option>
          </select>
        </fieldset>
        <fieldset className="filter-group">
          <legend>Following</legend>
          <label className="filter-check">
            <input
              type="checkbox"
              checked={favoritesOnly}
              onChange={(event) => setFavoritesOnly(event.target.checked)}
            />
            <Star size={14} />
            Favorites only
          </label>
          <IconButton
            icon={RotateCcw}
            label="Reset competition filters"
            onClick={() => {
              setSearch("");
              setCountry("");
              setKind("");
              setAge("");
              setFavoritesOnly(false);
            }}
          />
        </fieldset>
      </div>
      <div className="competition-browser">
        <Panel className="competition-selector-panel">
          <SectionHeading title="Competition index">
            <span className="muted" style={{ fontSize: ".7rem" }}>
              {leagues?.length ?? 0}
            </span>
          </SectionHeading>
          <div className="competition-list">
            {leagues?.map((league) => (
              <div className="competition-index-entry" key={league.id}>
                <button
                  onClick={() => {
                    openLeague(league.id);
                    setTab("table");
                  }}
                  className={`competition-button ${selected === league.id ? "active" : ""}`}
                >
                  <strong>{league.name}</strong>
                  <small>
                    {league.confederation} / {league.age_group} /{" "}
                    {kindLabel(league)}
                  </small>
                </button>
                <IconButton
                  icon={Star}
                  label={`${favorites?.some((entry) => entry.leagueId === league.id) ? "Remove" : "Add"} ${league.name} ${favorites?.some((entry) => entry.leagueId === league.id) ? "from" : "to"} favorites`}
                  aria-pressed={
                    favorites?.some((entry) => entry.leagueId === league.id) ??
                    false
                  }
                  disabled={savingFavorite}
                  onClick={() =>
                    void updateFavorite(
                      league.id,
                      !favorites?.some((entry) => entry.leagueId === league.id),
                    )
                  }
                />
              </div>
            ))}
            {leagues?.length === 0 && (
              <Empty icon={Search} title="No competitions found" />
            )}
          </div>
          <div className="pagination">
            <span>Page {page}</span>
            <div className="inline-controls">
              <IconButton
                icon={ChevronLeft}
                label="Previous competition page"
                disabled={page === 1}
                onClick={() =>
                  setPagination({ key: filterKey, page: page - 1 })
                }
              />
              <IconButton
                icon={ChevronRight}
                label="Next competition page"
                disabled={!leagues || leagues.length < 50}
                onClick={() =>
                  setPagination({ key: filterKey, page: page + 1 })
                }
              />
            </div>
          </div>
        </Panel>
        <div className="stack">
          {error ? (
            <ErrorState message={error} />
          ) : !data ? (
            <Loading label="Opening competition" />
          ) : (
            <>
              <Panel>
                <SectionHeading
                  title={data.league.name}
                  subtitle={`${data.league.format} / ${data.league.confederation} / ${data.league.age_group}`}
                >
                  <IconButton
                    icon={Star}
                    label={
                      favorite
                        ? "Remove competition from favorites"
                        : "Add competition to favorites"
                    }
                    aria-pressed={!!favorite}
                    disabled={savingFavorite}
                    onClick={() =>
                      void updateFavorite(data.league.id, !favorite)
                    }
                  />
                  <Badge tone="green">
                    {competitionData.phase
                      ? phaseLabel(competitionData.phase)
                      : "Season league"}
                  </Badge>
                </SectionHeading>
                {favorite && (
                  <details className="competition-alert-settings">
                    <summary>
                      <Bell size={15} />
                      Competition alerts
                    </summary>
                    <div className="alert-options">
                      {COMPETITION_ALERTS.map((type) => (
                        <label className="filter-check" key={type}>
                          <input
                            type="checkbox"
                            aria-label={`${label(type)} alerts`}
                            checked={favoriteEvents![type]}
                            disabled={savingFavorite}
                            onChange={(event) =>
                              void updateFavorite(data.league.id, true, {
                                [type]: event.target.checked,
                              })
                            }
                          />
                          {label(type)}
                        </label>
                      ))}
                    </div>
                  </details>
                )}
                {competitionData.championName && (
                  <div className="champion-banner">
                    <Trophy size={24} />
                    <div>
                      <small>CHAMPIONS</small>
                      <strong>{competitionData.championName}</strong>
                    </div>
                  </div>
                )}
                <Tabs
                  items={[
                    { id: "table", label: "Standings" },
                    { id: "fixtures", label: "Fixtures & results" },
                    { id: "qualification", label: "Qualification" },
                    { id: "history", label: "History" },
                  ]}
                  value={tab}
                  onChange={setTab}
                />
                {tab === "table" && (
                  <>
                    {groups.length > 1 && (
                      <div className="filter-bar">
                        <select
                          aria-label="Competition group"
                          value={currentGroup}
                          onChange={(event) => setGroup(event.target.value)}
                        >
                          {groups.map((value) => (
                            <option key={value} value={value}>
                              {value || "League table"}
                            </option>
                          ))}
                        </select>
                      </div>
                    )}
                    {data.table.length ? (
                      <StandingsTable
                        entries={shownTable}
                        ownId={bootstrap.club.id}
                        zones={zones}
                        positionOffset={positionOffset}
                        tableSize={tableSize}
                        label={`${data.league.name} table`}
                      />
                    ) : data.fixtures.length ? (
                      <Empty
                        icon={Trophy}
                        title="Knockout competition"
                        detail="There is no table: the ties are under Fixtures & results."
                      />
                    ) : (
                      <Empty
                        icon={Trophy}
                        title="The draw is being finalised"
                        detail="Qualifying rounds will determine the competition field."
                      />
                    )}
                    {data.table.length > 0 && (
                      <ZoneLegend zones={zones} size={tableSize} />
                    )}
                  </>
                )}
                {tab === "fixtures" && (
                  <>
                    <div className="filter-bar">
                      <select
                        aria-label="Fixture status"
                        value={schedule}
                        onChange={(event) => setSchedule(event.target.value)}
                      >
                        <option value="upcoming">Upcoming fixtures</option>
                        <option value="results">Results</option>
                      </select>
                      <span className="muted" style={{ fontSize: ".73rem" }}>
                        {fixtures.length} fixtures
                      </span>
                    </div>
                    {fixtures.length ? (
                      <div className="competition-fixtures">
                        {fixtures.slice(0, 100).map((fixture) => (
                          <div key={fixture.id} className="competition-fixture">
                            <span className="fixture-round">
                              {fixture.stage} /{" "}
                              {data.league.kind === "league" ? "Matchday" : "Round"}{" "}
                              {fixture.round}
                              {fixture.group_name
                                ? ` / ${fixture.group_name}`
                                : ""}
                            </span>
                            <FixtureRow fixture={fixture} />
                          </div>
                        ))}
                      </div>
                    ) : (
                      <Empty
                        icon={CalendarDays}
                        title={
                          schedule === "results"
                            ? "No results yet"
                            : "No scheduled fixtures"
                        }
                        detail={
                          schedule === "results"
                            ? "The season is still ahead of us."
                            : "The next draw will follow the current round."
                        }
                      />
                    )}
                  </>
                )}
                {tab === "qualification" && (
                  <div className="padded">
                    <div className="qualification-summary">
                      <Trophy size={25} />
                      <div>
                        <h3>
                          {data.league.kind === "league"
                            ? "League pathways"
                            : "Competition progression"}
                        </h3>
                        <p>{data.league.format}</p>
                      </div>
                    </div>
                    <dl className="detail-list">
                      <div>
                        <dt>Stage</dt>
                        <dd>
                          {competitionData.phase
                            ? phaseLabel(competitionData.phase)
                            : "Domestic league"}
                        </dd>
                      </div>
                      {data.table.length > 0 && (
                        <div>
                          <dt>Participants</dt>
                          <dd>{data.table.length}</dd>
                        </div>
                      )}
                      {competitionData.spec && (
                        <>
                          <div>
                            <dt>Main-draw places</dt>
                            <dd>{competitionData.spec.teams}</dd>
                          </div>
                          <div>
                            <dt>Progression places</dt>
                            <dd>{competitionData.spec.qualifies}</dd>
                          </div>
                          <div>
                            <dt>Scheduled rounds</dt>
                            <dd>{competitionData.spec.rounds}</dd>
                          </div>
                        </>
                      )}
                      {competitionData.promotion !== undefined && (
                        <>
                          <div>
                            <dt>Promotion places</dt>
                            <dd>{competitionData.promotion}</dd>
                          </div>
                          <div>
                            <dt>Relegation places</dt>
                            <dd>{competitionData.relegation}</dd>
                          </div>
                          <div>
                            <dt>Continental pathway</dt>
                            <dd>{competitionData.continental ?? 0} places</dd>
                          </div>
                        </>
                      )}
                      {competitionData.conferences?.length > 0 && (
                        <div>
                          <dt>Conferences</dt>
                          <dd>{competitionData.conferences.join(", ")}</dd>
                        </div>
                      )}
                      {competitionData.split?.groups?.length > 0 && (
                        <div>
                          <dt>Split</dt>
                          <dd>
                            {(
                              competitionData.split.groups as {
                                name: string;
                                positions: [number, number];
                                points: string;
                              }[]
                            )
                              .map(
                                (split) =>
                                  `${split.name} (${split.positions[0]}–${split.positions[1]}, points ${split.points === "halved" ? "halved" : "kept"})`,
                              )
                              .join("; ")}
                          </dd>
                        </div>
                      )}
                      {competitionData.championship?.positions && (
                        <div>
                          <dt>Title play-offs</dt>
                          <dd>
                            Places {competitionData.championship.positions[0]}–
                            {competitionData.championship.positions[1]}
                            {competitionData.championship.perConference
                              ? " per conference"
                              : ""}{" "}
                            /{" "}
                            {competitionData.championship.format ===
                            "round-robin"
                              ? "mini-league"
                              : "knockout"}
                          </dd>
                        </div>
                      )}
                    </dl>
                    {data.qualifiers.length > 0 && (
                      <>
                        <h3 className="subsection-title section-space">
                          Qualifying competitions
                        </h3>
                        {data.qualifiers.map((qualifier) => (
                          <button
                            key={qualifier.id}
                            className="competition-button"
                            onClick={() => openLeague(qualifier.id)}
                          >
                            <strong>{qualifier.name}</strong>
                            <small>
                              {label(
                                JSON.parse(qualifier.data).phase ?? "Scheduled",
                              )}
                            </small>
                          </button>
                        ))}
                      </>
                    )}
                    {competitionData.qualificationFor && (
                      <div className="section-space">
                        <Button
                          variant="secondary"
                          icon={ArrowUpRight}
                          onClick={() =>
                            openLeague(Number(competitionData.qualificationFor))
                          }
                        >
                          Open main competition
                        </Button>
                      </div>
                    )}
                    {competitionData.tiebreakers && (
                      <p className="dossier-copy section-space">
                        Tiebreakers: {competitionData.tiebreakers.join(", ")}.
                      </p>
                    )}
                  </div>
                )}
                {tab === "history" &&
                  (data.history.length ? (
                    data.history.map((item, index) => {
                      const record = JSON.parse(item.data);
                      return (
                        <div
                          className="data-list-row"
                          key={`${item.season}-${index}`}
                        >
                          <span>
                            <strong>{seasonText(item.season)}</strong>
                            <p>{record.competition ?? record.name}</p>
                          </span>
                          <Badge tone="green">
                            {record.clubId
                              ? `${record.name}${record.walkover ? " (walkover)" : ""}`
                              : "Season archived"}
                          </Badge>
                        </div>
                      );
                    })
                  ) : (
                    <Empty
                      icon={Trophy}
                      title="History starts with this season"
                      detail="Champions and completed tables will be preserved in your career."
                    />
                  ))}
              </Panel>
              <div className="information-note">
                <CalendarDays size={16} />
                <span>
                  International windows: late September to early October,
                  November, March and June. Current world trend:{" "}
                  <strong>{bootstrap.state.worldTrend}</strong>.
                </span>
              </div>
              {data.fixtures.some((fixture) => fixture.status === "played") && (
                <TextLink
                  onClick={() => {
                    const latest = [...data.fixtures]
                      .reverse()
                      .find((fixture) => fixture.status === "played");
                    if (latest) openMatch(latest.id);
                  }}
                >
                  Latest match report
                </TextLink>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
