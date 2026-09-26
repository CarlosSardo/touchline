import { useDeferredValue, useState } from "react";
import {
  ChevronLeft,
  ChevronRight,
  Globe2,
  RotateCcw,
  Search,
} from "lucide-react";
import { useGame, useResource } from "../game-context.tsx";
import {
  Badge,
  ClubLink,
  Empty,
  ErrorState,
  IconButton,
  Loading,
  PageHeading,
  Panel,
  Rating,
  TextLink,
} from "../ui.tsx";
import type { WorldAudit, WorldClubPage } from "../../shared/api.ts";
import { compactNumber, label } from "../../shared/rules.ts";

// Keyed by string so catalog-backed policy modes and evidence levels degrade to a neutral label.
const RESERVE_MODES: Record<string, string> = {
  pyramid: "Senior pyramid",
  separate: "Separate development league",
  "reserve-league": "Separate reserve league",
  none: "No reserve teams",
};

function reserveModeLabel(mode: string) {
  return RESERVE_MODES[mode] ?? "Permission unverified";
}

export default function World() {
  const { bootstrap, openLeague } = useGame();
  const { data: audit } = useResource<WorldAudit>("world/audit");
  const [search, setSearch] = useState("");
  const [country, setCountry] = useState("");
  const [confederation, setConfederation] = useState("");
  const [type, setType] = useState("");
  const [tier, setTier] = useState("");
  const [sort, setSort] = useState("reputation");
  const [pagination, setPagination] = useState({ key: "", page: 1 });
  const deferred = useDeferredValue(search);
  const key = JSON.stringify([
    deferred,
    country,
    confederation,
    type,
    tier,
    sort,
  ]);
  const page = pagination.key === key ? pagination.page : 1;
  const params = new URLSearchParams({
    q: deferred,
    page: String(page),
    sort,
    direction: sort === "name" ? "asc" : "desc",
  });
  for (const [name, value] of Object.entries({
    country,
    confederation,
    type,
    tier,
  }))
    if (value) params.set(name, value);
  const { data, loading, error } = useResource<WorldClubPage>(
    `world/clubs?${params}`,
  );
  const auditedCountries = audit?.countries.filter(
    (entry) =>
      (!country || entry.id === Number(country)) &&
      (!confederation || entry.confederation === confederation),
  );
  return (
    <div className="page">
      <PageHeading
        eyebrow="THE GLOBAL GAME"
        title="World browser"
        subtitle="Clubs, reserve teams and national sides."
      />
      <Panel>
        <div className="filter-bar">
          <div className="search-field">
            <Search size={17} />
            <input
              aria-label="Search world teams"
              placeholder="Team, city or country..."
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />
          </div>
          <select
            aria-label="World confederation"
            value={confederation}
            onChange={(event) => setConfederation(event.target.value)}
          >
            <option value="">All confederations</option>
            {["UEFA", "CONMEBOL", "AFC", "CAF", "CONCACAF", "OFC"].map(
              (value) => (
                <option key={value}>{value}</option>
              ),
            )}
          </select>
          <select
            aria-label="World country"
            value={country}
            onChange={(event) => setCountry(event.target.value)}
          >
            <option value="">All countries</option>
            {bootstrap?.countries
              .filter(
                (entry) =>
                  !confederation || entry.confederation === confederation,
              )
              .map((entry) => (
                <option key={entry.id} value={entry.id}>
                  {entry.name}
                </option>
              ))}
          </select>
          <select
            aria-label="World team type"
            value={type}
            onChange={(event) => setType(event.target.value)}
          >
            <option value="">All teams</option>
            <option value="club">Clubs</option>
            <option value="bteam">B teams</option>
            <option value="national">National teams</option>
          </select>
          <select
            aria-label="World tier"
            value={tier}
            onChange={(event) => setTier(event.target.value)}
          >
            <option value="">All tiers</option>
            {Array.from(
              {
                length: Math.max(
                  3,
                  ...(audit?.countries
                    .filter((entry) => !country || entry.id === Number(country))
                    .map((entry) => entry.seniorDivisions) ?? []),
                ),
              },
              (_, index) => (
                <option key={index + 1} value={index + 1}>
                  Tier {index + 1}
                </option>
              ),
            )}
          </select>
          <IconButton
            icon={RotateCcw}
            label="Reset world filters"
            onClick={() => {
              setSearch("");
              setCountry("");
              setConfederation("");
              setType("");
              setTier("");
            }}
          />
        </div>
        <div className="filter-summary">
          <Globe2 size={14} />
          <span className="filter-total">
            {data ? compactNumber(data.total) : "..."} teams
          </span>
          <div className="sort-controls">
            <select
              aria-label="Sort world teams"
              value={sort}
              onChange={(event) => setSort(event.target.value)}
            >
              <option value="reputation">Reputation</option>
              <option value="name">Name</option>
              <option value="academy">Academy</option>
              <option value="capacity">Stadium capacity</option>
            </select>
          </div>
        </div>
        {error ? (
          <ErrorState message={error} />
        ) : !data ? (
          <Loading label="Opening the football world" />
        ) : (
          <>
            <div className="table-scroll" role="region" aria-label="Teams" tabIndex={0}>
              <table className="data-table world-table">
                <thead>
                  <tr>
                    <th>Team</th>
                    <th>Country</th>
                    <th>Competition</th>
                    <th>Type</th>
                    <th>Reputation</th>
                    <th>Academy</th>
                    <th>Stadium</th>
                    <th>Capacity</th>
                  </tr>
                </thead>
                <tbody>
                  {data.clubs.map((club) => (
                    <tr key={club.id}>
                      <td>
                        <ClubLink
                          id={club.id}
                          name={club.name}
                          color={club.color}
                          crest
                        />
                      </td>
                      <td>{club.country_name}</td>
                      <td>
                        {club.league_id ? (
                          <TextLink onClick={() => openLeague(club.league_id!)}>
                            {club.league_name ?? `Tier ${club.tier}`}
                          </TextLink>
                        ) : (
                          <span className="muted">{club.confederation}</span>
                        )}
                      </td>
                      <td>
                        <Badge
                          tone={
                            club.type === "national"
                              ? "blue"
                              : club.type === "bteam"
                                ? "violet"
                                : "neutral"
                          }
                        >
                          {club.type === "national"
                            ? club.age_group === "Senior"
                              ? "National"
                              : `National ${club.age_group}`
                            : club.type === "bteam"
                              ? "B team"
                              : `Tier ${club.tier}`}
                        </Badge>
                      </td>
                      <td>
                        <Rating value={club.reputation} />
                      </td>
                      <td>{club.type === "national" ? "-" : club.academy}</td>
                      <td className="muted">{club.stadium}</td>
                      <td className="number">{compactNumber(club.capacity)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {!data.clubs.length && (
                <Empty icon={Search} title="No teams match these filters" />
              )}
            </div>
            <footer className="pagination">
              <span>
                {data.total
                  ? `${(data.page - 1) * data.pageSize + 1}-${Math.min(data.page * data.pageSize, data.total)} of ${compactNumber(data.total)}`
                  : "No results"}
              </span>
              <div className="pagination-actions">
                <IconButton
                  icon={ChevronLeft}
                  label="Previous world page"
                  disabled={data.page <= 1 || loading}
                  onClick={() => setPagination({ key, page: data.page - 1 })}
                />
                <span>
                  {data.page} / {data.pages}
                </span>
                <IconButton
                  icon={ChevronRight}
                  label="Next world page"
                  disabled={data.page >= data.pages || loading}
                  onClick={() => setPagination({ key, page: data.page + 1 })}
                />
              </div>
            </footer>
          </>
        )}
      </Panel>
      <details className="association-audit section-space">
        <summary>
          Association rules{" "}
          <span className="muted">
            {auditedCountries?.length ?? 0} associations
          </span>
        </summary>
        <div className="table-scroll" data-no-swipe role="region" aria-label="Association rules" tabIndex={0}>
          <table className="data-table association-audit-table">
            <thead>
              <tr>
                <th>Association</th>
                <th>Senior tiers</th>
                <th>Reserve clubs</th>
                <th>Reserve policy</th>
                <th>Evidence</th>
              </tr>
            </thead>
            <tbody>
              {auditedCountries?.map((entry) => (
                <tr key={entry.id}>
                  <td>
                    <strong>{entry.name}</strong>
                    <small>{entry.confederation}</small>
                  </td>
                  <td>{entry.seniorDivisions}</td>
                  <td>{entry.reserves}</td>
                  <td>
                    <strong>
                      {reserveModeLabel(entry.reservePolicy.mode)}
                    </strong>
                    <p>{entry.reservePolicy.summary}</p>
                    <details>
                      <summary>Regulatory limits</summary>
                      <ul>
                        {entry.notes.map((note) => (
                          <li key={note}>{note}</li>
                        ))}
                      </ul>
                    </details>
                  </td>
                  <td>
                    <Badge
                      tone={
                        String(entry.reservePolicy.evidence) === "documented"
                          ? "green"
                          : "amber"
                      }
                    >
                      {label(String(entry.reservePolicy.evidence))}
                    </Badge>
                    {entry.reservePolicy.source && (
                      <a
                        className="text-link"
                        href={entry.reservePolicy.source}
                        target="_blank"
                        rel="noreferrer"
                      >
                        Reference source
                      </a>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </div>
  );
}
