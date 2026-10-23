import { useDeferredValue, useState } from "react";
import { ChevronLeft, ChevronRight, Construction, Globe, Landmark, Search, X } from "lucide-react";
import { useCurrency, useResource } from "./game-context.tsx";
import { Badge, Button, ClubLink, DetailList, Empty, ErrorState, IconButton, Loading, Panel, PlayerLink, SectionHeading } from "./ui.tsx";
import { compactNumber, dateLabel } from "../shared/rules.ts";
import type { ClubLifeData, ClubProjectView, DofPolicy, WorldNewsData } from "../shared/api.ts";
import "./ClubLife.css";

const WORLD_KIND_LABELS: Record<string, string> = {
  administration: "Administration",
  affiliate: "Affiliates",
  contract: "Contracts",
  director: "Directors of football",
  loan: "Loans",
  manager: "Managers",
  ownership: "Ownership",
  project: "Infrastructure",
  sanction: "Sanctions",
  transfer: "Transfers",
};
const kindLabel = (kind: string) => WORLD_KIND_LABELS[kind] ?? `${kind[0]?.toUpperCase() ?? ""}${kind.slice(1)}`;

const POLICY_LABELS: Record<DofPolicy, string> = {
  balanced: "Balanced",
  youth: "Youth first",
  value: "Value for money",
  stars: "Star signings",
};

const PROJECT_LABELS: Record<ClubProjectView["kind"], string> = {
  facilities: "Training facilities",
  academy: "Academy",
  stadium_expansion: "Stadium expansion",
  new_stadium: "New stadium",
};

function projectEffect(project: ClubProjectView) {
  const { effect } = project;
  if (effect.facilities) return `Facilities +${effect.facilities}`;
  if (effect.academy) return `Academy +${effect.academy}`;
  if (project.kind === "new_stadium") return `${effect.stadium ?? "New ground"}, ${compactNumber(effect.capacity ?? 0)} seats`;
  return `+${compactNumber(effect.capacity ?? 0)} seats`;
}

/** World football feed: AI clubs' activity across the world, filtered by kind, association or club. */
export function WorldFeed() {
  const [kind, setKind] = useState("");
  const [country, setCountry] = useState("");
  const [club, setClub] = useState<number | null>(null);
  const [search, setSearch] = useState("");
  const [pagination, setPagination] = useState({ key: "", page: 1 });
  const deferred = useDeferredValue(search);
  const filterKey = JSON.stringify([kind, country, club, deferred]);
  const page = pagination.key === filterKey ? pagination.page : 1;
  const params = new URLSearchParams({ page: String(page), q: deferred });
  if (kind) params.set("kind", kind);
  if (country) params.set("country", country);
  if (club) params.set("club", String(club));
  const { data, loading, error } = useResource<WorldNewsData>(`world-news?${params}`, { keepPreviousData: true });
  if (error) return <ErrorState message={error} />;
  if (!data) return <Loading label="Gathering world football news" />;
  return (
    <>
      <div className="filter-bar media-filters">
        <div className="search-field">
          <Search size={16} />
          <input
            aria-label="Search world news"
            placeholder="Club, player or headline..."
            maxLength={100}
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
        </div>
        <select aria-label="World news kind" value={kind} onChange={(event) => setKind(event.target.value)}>
          <option value="">All activity</option>
          {data.kinds.map((entry) => (
            <option key={entry.kind} value={entry.kind}>
              {kindLabel(entry.kind)} ({compactNumber(entry.count)})
            </option>
          ))}
        </select>
        <select aria-label="World news country" value={country} onChange={(event) => setCountry(event.target.value)}>
          <option value="">All countries</option>
          {data.countries.map((entry) => (
            <option key={entry.id} value={entry.id}>
              {entry.name}
            </option>
          ))}
        </select>
        {data.club && (
          <Button variant="secondary" icon={X} onClick={() => setClub(null)}>
            {data.club.name}
          </Button>
        )}
      </div>
      {data.items.length ? (
        <ol className="world-feed" aria-busy={loading}>
          {data.items.map((item) => (
            <li className="world-item" key={item.id}>
              <header>
                <Badge tone="blue">{kindLabel(item.kind)}</Badge>
                <time dateTime={item.date}>{dateLabel(item.date)}</time>
              </header>
              <strong>{item.title}</strong>
              <p>{item.body}</p>
              <div className="world-item-subjects">
                {item.playerId && <PlayerLink id={item.playerId} name={item.playerName ?? "Player"} />}
                {item.clubs.map((entry) => (
                  <span key={entry.id}>
                    <ClubLink id={entry.id} name={entry.name} color={entry.color} crest />
                    {club !== entry.id && (
                      <button type="button" className="profile-link world-filter-club" onClick={() => setClub(entry.id)}>
                        Only this club
                      </button>
                    )}
                  </span>
                ))}
              </div>
            </li>
          ))}
        </ol>
      ) : (
        <Empty icon={Globe} title="No world news matches these filters" />
      )}
      <div className="pagination">
        <span>{compactNumber(data.total)} items</span>
        <span>
          <IconButton
            icon={ChevronLeft}
            label="Previous world news page"
            disabled={loading || data.page <= 1}
            onClick={() => setPagination({ key: filterKey, page: data.page - 1 })}
          />
          {data.page} / {data.pages}
          <IconButton
            icon={ChevronRight}
            label="Next world news page"
            disabled={loading || data.page >= data.pages}
            onClick={() => setPagination({ key: filterKey, page: data.page + 1 })}
          />
        </span>
      </div>
    </>
  );
}

function ProjectsTable({ projects }: { projects: ClubProjectView[] }) {
  const { money } = useCurrency();
  return (
    <div className="table-scroll" role="region" aria-label="Infrastructure projects" tabIndex={0}>
      <table className="data-table">
        <thead>
          <tr>
            <th>Project</th>
            <th>Outcome</th>
            <th>Cost</th>
            <th>Funding</th>
            <th>Timeline</th>
            <th>Status</th>
          </tr>
        </thead>
        <tbody>
          {projects.map((project) => (
            <tr key={project.id}>
              <td>{PROJECT_LABELS[project.kind]}</td>
              <td>{projectEffect(project)}</td>
              <td>{money(project.cost)}</td>
              <td>
                {project.debt ? `${money(project.cash)} cash, ${money(project.debt)} debt` : "Cash"}
                {project.repayUntil && (
                  <small className="cell-subtitle">
                    {money(project.weeklyRepayment)}/week until {dateLabel(project.repayUntil)}
                  </small>
                )}
              </td>
              <td>
                {dateLabel(project.start_date)} - {dateLabel(project.end_date)}
              </td>
              <td>
                <Badge tone={project.status === "complete" ? "green" : project.status === "cancelled" ? "amber" : "blue"}>
                  {project.status === "planned" ? "Planning" : project.status === "building" ? "Under construction" : project.status === "complete" ? "Complete" : "Halted"}
                </Badge>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/**
 * A club's running: director of football and transfer policy, administration, infrastructure and managers. Without a
 * club id it shows the user's club (no director of football: the user is the director).
 */
export function ClubLifeSection({ clubId }: { clubId?: number }) {
  const own = clubId === undefined;
  const { data, error } = useResource<ClubLifeData>(own ? "club-life" : `clubs/${clubId}/life`);
  if (error) return <ErrorState message={error} />;
  if (!data) return <Loading label="Reading the club's affairs" />;
  const administration = data.administration;
  return (
    <div className="club-life">
      {administration && (
        <div className="club-life-alert" role="status">
          <Landmark size={18} />
          <div>
            <strong>In administration since {dateLabel(administration.since)}</strong>
            <p>
              {administration.reason}{" "}
              {administration.points ? `${administration.points}-point deduction. ` : ""}
              {administration.pendingPoints ? `${administration.pendingPoints}-point deduction to come next season. ` : ""}
              Registration embargo until {dateLabel(administration.embargoUntil)} at the latest.
            </p>
            {administration.forcedSales.length > 0 && (
              <p>
                Listed for sale by the administrators:{" "}
                {administration.forcedSales.map((sale, index) => (
                  <span key={sale.playerId}>
                    {index > 0 && ", "}
                    <PlayerLink id={sale.playerId} name={sale.name} />
                  </span>
                ))}
              </p>
            )}
          </div>
        </div>
      )}
      {!own && (
        <DetailList
          items={[
            ["Director of football", data.director ? `${data.director.name} (${Math.round(data.director.ability)}/99)` : "None"],
            ["Transfer policy", POLICY_LABELS[data.dofPolicy]],
            ...(data.managers[0]
              ? ([["Latest manager change", `${data.managers[0].appointed} replaced ${data.managers[0].departed} (${dateLabel(data.managers[0].date)}${data.managers[0].formation ? `, ${data.managers[0].formation}` : ""})`]] as [string, string][])
              : []),
            ...data.administrations.map(
              (entry) => ["Administration", `${dateLabel(entry.since)} - ${dateLabel(entry.until)}: ${entry.outcome}, ${entry.points} points`] as [string, string],
            ),
          ]}
        />
      )}
      {data.projects.length ? (
        <ProjectsTable projects={data.projects} />
      ) : (
        <Empty icon={Construction} title="No infrastructure projects" detail="The board invests in facilities, the academy and the stadium when finances and demand allow." />
      )}
    </div>
  );
}

/** Boardroom panel of the user's club: projects the board runs and, in administration, the administrators' decisions. */
export function ClubAffairsPanel() {
  return (
    <Panel>
      <SectionHeading
        title="Club infrastructure & finances"
        subtitle="Facilities, academy and stadium projects decided by the board, paid outside the transfer budget"
      />
      <div className="padded">
        <ClubLifeSection />
      </div>
    </Panel>
  );
}

/** Office notice while the user's club is in administration: the administrators' decisions are not optional. */
export function AdministrationNotice() {
  const { data } = useResource<ClubLifeData>("club-life");
  const administration = data?.administration;
  if (!administration) return null;
  return (
    <div className="club-life-alert office-alert" role="alert">
      <Landmark size={18} />
      <div>
        <strong>The club is in administration</strong>
        <p>
          Administrators control the finances: {administration.points ? `${administration.points}-point deduction, ` : ""}
          registration embargo, no transfer budget.
          {administration.forcedSales.length > 0 && " Board-imposed sales: "}
          {administration.forcedSales.map((sale, index) => (
            <span key={sale.playerId}>
              {index > 0 && ", "}
              <PlayerLink id={sale.playerId} name={sale.name} />
            </span>
          ))}
          {administration.forcedSales.length > 0 && " stay on the transfer list until the club exits administration."}
        </p>
      </div>
    </div>
  );
}
