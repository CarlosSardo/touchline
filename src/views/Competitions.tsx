import { useDeferredValue, useState } from "react";
import {
  ArrowUpRight,
  CalendarDays,
  Globe2,
  Search,
  Trophy,
} from "lucide-react";
import { useGame, useResource } from "../game-context.tsx";
import {
  Badge,
  Button,
  Empty,
  ErrorState,
  FixtureRow,
  Loading,
  PageHeading,
  Panel,
  SectionHeading,
  StandingsTable,
  Tabs,
  TextLink,
} from "../ui.tsx";
import { label } from "../../shared/rules.ts";
import type { CompetitionDetail } from "../../shared/api.ts";
import type { League } from "../../shared/types.ts";

export default function Competitions() {
  const { bootstrap, leagueId, openLeague, openMatch } = useGame();
  const [country, setCountry] = useState("");
  const [kind, setKind] = useState("");
  const [age, setAge] = useState("");
  const [search, setSearch] = useState("");
  const [tab, setTab] = useState("table");
  const [group, setGroup] = useState("");
  const [schedule, setSchedule] = useState("upcoming");
  const deferredSearch = useDeferredValue(search);
  const params = new URLSearchParams({ q: deferredSearch, limit: "300" });
  if (country) params.set("country", country);
  if (kind) params.set("kind", kind);
  if (age) params.set("age", age);
  const { data: leagues } = useResource<League[]>(`leagues?${params}`);
  const selected = leagueId ?? bootstrap?.club.league_id;
  const { data, error } = useResource<CompetitionDetail>(
    selected ? `leagues/${selected}` : null,
  );
  if (!bootstrap) return <Loading />;
  const groups = [
    ...new Set(data?.table.map((entry) => entry.group_name) ?? []),
  ];
  const currentGroup = groups.includes(group) ? group : groups[0];
  const competitionData = data ? JSON.parse(data.league.data) : {};
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
        subtitle={`${bootstrap.world.countries} associations / ${bootstrap.world.leagues.toLocaleString()} domestic leagues`}
      >
        <Badge tone="blue">
          <Globe2 size={12} />
          {bootstrap.state.season}/
          {String(bootstrap.state.season + 1).slice(-2)}
        </Badge>
      </PageHeading>
      <div className="competition-toolbar">
        <div className="search-field">
          <Search size={16} />
          <input
            aria-label="Search competitions"
            placeholder="Search leagues and tournaments..."
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
        </div>
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
          <option value="cup">Domestic cups</option>
        </select>
        <select
          aria-label="Competition age group"
          value={age}
          onChange={(event) => setAge(event.target.value)}
        >
          <option value="">All age groups</option>
          <option>Senior</option>
          <option>U20</option>
          <option>U19</option>
          <option>U17</option>
        </select>
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
              <button
                key={league.id}
                onClick={() => {
                  openLeague(league.id);
                  setTab("table");
                }}
                className={`competition-button ${selected === league.id ? "active" : ""}`}
              >
                <strong>{league.name}</strong>
                <small>
                  {league.confederation} / {league.age_group} /{" "}
                  {label(league.kind)}
                </small>
              </button>
            ))}
            {leagues?.length === 0 && (
              <Empty icon={Search} title="No competitions found" />
            )}
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
                  <Badge tone="green">
                    {competitionData.phase
                      ? label(competitionData.phase)
                      : "Season league"}
                  </Badge>
                </SectionHeading>
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
                        entries={data.table.filter(
                          (entry) =>
                            groups.length <= 1 ||
                            entry.group_name === currentGroup,
                        )}
                        ownId={bootstrap.club.id}
                      />
                    ) : (
                      <Empty
                        icon={Trophy}
                        title="The draw is being finalised"
                        detail="Qualifying rounds will determine the competition field."
                      />
                    )}
                    {data.league.kind === "league" && (
                      <div className="pressure-zones">
                        <span>
                          <i className="zone-line" />
                          Top: title & qualification
                        </span>
                        <span>
                          <i className="zone-line middle" />
                          Middle: stability
                        </span>
                        <span>
                          <i className="zone-line bottom" />
                          Bottom: relegation pressure
                        </span>
                      </div>
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
                              {fixture.stage} / Round {fixture.round}
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
                            ? label(competitionData.phase)
                            : "Domestic league"}
                        </dd>
                      </div>
                      <div>
                        <dt>Participants</dt>
                        <dd>{data.table.length}</dd>
                      </div>
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
                            <strong>
                              {item.season}/{String(item.season + 1).slice(-2)}
                            </strong>
                            <p>{record.competition ?? record.name}</p>
                          </span>
                          <Badge tone="green">
                            {record.clubId ? record.name : "Season archived"}
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
                  International windows: September, October, November, March and
                  June. Current world trend:{" "}
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
