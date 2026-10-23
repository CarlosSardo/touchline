import { Fragment, useState, type ReactNode } from "react";
import { History, Trophy } from "lucide-react";
import { useCurrency, useResource } from "./game-context.tsx";
import { Badge, ClubLink, Empty, ErrorState, Loading, SortHeader } from "./ui.tsx";
import { compactNumber, dateLabel } from "../shared/rules.ts";
import type {
  PlayerHistory as PlayerHistoryData,
  PlayerHonour,
  PlayerMilestone,
  PlayerMove,
  PlayerStatLine,
} from "../shared/api.ts";
import { dateValue, type SortColumn } from "./sort.ts";
import { useSortableRows } from "./useSortableRows.ts";
import {
  ALL_CLUBS,
  ALL_COMPETITIONS,
  HONOUR_KIND_LABELS,
  HONOUR_ROLE_LABELS,
  MOVE_KIND_LABELS,
  NO_STAT_FILTER,
  blockTotals,
  competitionLabel,
  historyClubs,
  historyCompetitions,
  honourSummary,
  milestoneText,
  moveFee,
  ratingNote,
  seasonBlocks,
  seasonLabel,
  type StatFilter,
} from "./player-history.ts";
import SquadMoveTable from "./SquadMoves.tsx";
import "./PlayerHistory.css";

type MoveRow = PlayerMove & { index: number };

const MOVE_COLUMNS: SortColumn<MoveRow, "date" | "from" | "to" | "fee" | "type">[] = [
  { key: "date", value: (move) => [dateValue(move.date), move.index], defaultDirection: "desc" },
  { key: "from", value: (move) => move.from?.name ?? null, defaultDirection: "asc" },
  { key: "to", value: (move) => move.to?.name ?? null, defaultDirection: "asc" },
  { key: "fee", value: (move) => move.fee, defaultDirection: "desc" },
  { key: "type", value: (move) => MOVE_KIND_LABELS[move.kind], defaultDirection: "asc" },
];

function RatingCell({ line }: { line: PlayerStatLine }) {
  if (line.averageRating === null) return <span className="muted">—</span>;
  const rating = line.averageRating;
  return <Badge tone={rating >= 7 ? "green" : rating < 6 ? "red" : "amber"}>{rating.toFixed(2)}</Badge>;
}

function TransferTable({ moves, truncated }: { moves: PlayerMove[]; truncated: boolean }) {
  const { money } = useCurrency();
  const sorting = useSortableRows(
    moves.map((move, index) => ({ ...move, index })),
    MOVE_COLUMNS,
    {
      initial: { key: "date", direction: "desc" },
      tieBreakers: [{ value: (move) => move.index, defaultDirection: "desc" }],
    },
  );
  if (!moves.length) return <p className="muted player-history-empty">No transfers or loans recorded for this player yet.</p>;
  return (
    <>
      <div className="table-scroll" data-no-swipe role="region" aria-label="Transfers and loans" tabIndex={0}>
        <table className="data-table player-history-table">
          <thead>
            <tr>
              <SortHeader {...sorting.header("date")} label="Date" />
              <SortHeader {...sorting.header("from")} label="From" />
              <SortHeader {...sorting.header("to")} label="To" />
              <SortHeader {...sorting.header("fee")} label="Fee" />
              <SortHeader {...sorting.header("type")} label="Type" />
            </tr>
          </thead>
          <tbody>
            {sorting.rows.map((move) => {
              const fee = moveFee(move);
              const detail =
                move.kind === "loan" && move.loanUntil
                  ? `Until ${dateLabel(move.loanUntil)}`
                  : move.dealType && move.dealType !== MOVE_KIND_LABELS[move.kind]
                    ? move.dealType
                    : null;
              return (
                <tr key={move.index}>
                  <td>
                    {move.date ? (
                      <span
                        title={
                          move.dateEstimated
                            ? "Scheduled end of the loan; he returned on the first processed day on or after it"
                            : undefined
                        }
                      >
                        {move.dateEstimated ? "≈ " : ""}
                        {dateLabel(move.date)}
                      </span>
                    ) : (
                      <span className="muted">Not recorded</span>
                    )}
                  </td>
                  <td>
                    {move.from ? (
                      <ClubLink id={move.from.id} name={move.from.name} color={move.from.color ?? undefined} />
                    ) : (
                      <span className="muted">No club</span>
                    )}
                  </td>
                  <td>
                    {move.to ? (
                      <ClubLink id={move.to.id} name={move.to.name} color={move.to.color ?? undefined} />
                    ) : (
                      <span className="muted">No club</span>
                    )}
                  </td>
                  <td className="player-history-number">
                    {fee.kind === "amount" ? (
                      money(fee.value)
                    ) : fee.kind === "none" ? (
                      "No fee"
                    ) : (
                      <span className="muted" title={fee.kind === "unrecorded" ? "Fee not recorded" : undefined}>
                        —
                      </span>
                    )}
                  </td>
                  <td>
                    {MOVE_KIND_LABELS[move.kind]}
                    {detail && <small className="appearance-status">{detail}</small>}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {truncated && <p className="muted player-history-note">Only the latest 500 moves are listed.</p>}
    </>
  );
}

function Honours({ honours }: { honours: PlayerHonour[] }) {
  if (!honours.length) return <p className="muted player-history-empty">No trophies won yet.</p>;
  return (
    <>
      <ul className="honour-summary" aria-label="Trophy count">
        {honourSummary(honours).map((entry) => (
          <li key={entry.title}>
            <Trophy size={13} aria-hidden="true" />
            <span>{entry.title}</span>
            {entry.count > 1 && <strong>×{entry.count}</strong>}
          </li>
        ))}
      </ul>
      <div className="table-scroll" data-no-swipe role="region" aria-label="Honours" tabIndex={0}>
        <table className="data-table player-history-table">
          <thead>
            <tr>
              <th>Season</th>
              <th>Honour</th>
              <th>Team</th>
              <th>Part played</th>
            </tr>
          </thead>
          <tbody>
            {honours.map((honour) => (
              <tr key={`${honour.season}:${honour.kind}:${honour.competitionId}:${honour.club?.id}`}>
                <td>{seasonLabel(honour.season)}</td>
                <td>
                  {honour.title}
                  {honour.ageGroup && !honour.title.includes(honour.ageGroup) ? ` (${honour.ageGroup})` : ""}
                  <small className="appearance-status">{HONOUR_KIND_LABELS[honour.kind]}</small>
                </td>
                <td>
                  {honour.club ? (
                    <ClubLink id={honour.club.id} name={honour.club.name} color={honour.club.color ?? undefined} />
                  ) : (
                    <span className="muted">—</span>
                  )}
                </td>
                <td>
                  <Badge tone={honour.role === "regular" ? "green" : honour.role === "squad" ? "blue" : "neutral"}>
                    {HONOUR_ROLE_LABELS[honour.role]}
                  </Badge>
                  <small className="appearance-status">
                    {honour.appearances} app{honour.appearances === 1 ? "" : "s"}
                    {honour.matches !== null ? ` of ${honour.matches}` : ""}
                  </small>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

function Milestones({ milestones }: { milestones: PlayerMilestone[] }) {
  if (!milestones.length) return <p className="muted player-history-empty">No milestones reached yet.</p>;
  return (
    <ol className="milestone-list" aria-label="Milestones">
      {[...milestones].reverse().map((milestone) => (
        <li key={`${milestone.kind}:${milestone.club?.id}:${milestone.value}`}>
          <span className="milestone-date">
            {milestone.dateEstimated ? seasonLabel(milestone.season) : dateLabel(milestone.date)}
          </span>
          <strong>{milestoneText(milestone)}</strong>
          <small className="muted">
            {[milestone.competition, `aged ${milestone.age}`].filter(Boolean).join(" · ")}
          </small>
        </li>
      ))}
    </ol>
  );
}

function StatCells({ line, strong = false }: { line: PlayerStatLine; strong?: boolean }) {
  return (
    <>
      <td className="player-history-number">
        {strong ? <strong>{line.appearances}</strong> : line.appearances}
        <small className="appearance-status">{compactNumber(line.minutes)}'</small>
      </td>
      <td className="player-history-number">{strong ? <strong>{line.goals}</strong> : line.goals}</td>
      <td className="player-history-number">{strong ? <strong>{line.assists}</strong> : line.assists}</td>
      <td className="player-history-number" title={ratingNote(line)}>
        <RatingCell line={line} />
        {line.ratingCoverage === "partial" && (
          <small className="appearance-status">
            {line.ratedAppearances} of {line.appearances} rated
          </small>
        )}
      </td>
    </>
  );
}

function SeasonStatistics({ data }: { data: PlayerHistoryData }) {
  const [filter, setFilter] = useState<StatFilter>(NO_STAT_FILTER);
  const competitions = historyCompetitions(data);
  const clubs = historyClubs(data);
  const selected: StatFilter = {
    competition: competitions.some((entry) => entry.key === filter.competition) ? filter.competition : ALL_COMPETITIONS,
    club: clubs.some((entry) => String(entry.id) === filter.club) ? filter.club : ALL_CLUBS,
  };
  const blocks = seasonBlocks(data, selected);
  const totals = blockTotals(data, blocks, selected);
  if (!data.seasons.length) return <p className="muted player-history-empty">No appearances recorded yet.</p>;
  return (
    <>
      <div className="career-history-controls">
        <label className="field">
          <span>Competition</span>
          <select
            aria-label="Player history competition"
            value={selected.competition}
            onChange={(event) => setFilter({ ...selected, competition: event.target.value })}
          >
            <option value={ALL_COMPETITIONS}>All competitions</option>
            {competitions.map((entry) => (
              <option key={entry.key} value={entry.key}>
                {entry.label}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>Club</span>
          <select
            aria-label="Player history club"
            value={selected.club}
            onChange={(event) => setFilter({ ...selected, club: event.target.value })}
          >
            <option value={ALL_CLUBS}>All clubs</option>
            {clubs.map((entry) => (
              <option key={entry.id} value={entry.id}>
                {entry.name}
              </option>
            ))}
          </select>
        </label>
      </div>
      {blocks.length ? (
        <>
          <div className="career-season-summary">
            <span>
              <small>Appearances</small>
              <strong>{totals.competitive.appearances}</strong>
            </span>
            <span>
              <small>Minutes</small>
              <strong>{compactNumber(totals.competitive.minutes)}</strong>
            </span>
            <span>
              <small>Goals</small>
              <strong>{totals.competitive.goals}</strong>
            </span>
            <span>
              <small>Assists</small>
              <strong>{totals.competitive.assists}</strong>
            </span>
            <span title={ratingNote(totals.competitive)}>
              <small>Average rating</small>
              <strong>{totals.competitive.averageRating?.toFixed(2) ?? "—"}</strong>
            </span>
            {totals.friendlies && (
              <span title="Friendlies are listed apart and not part of the competitive totals">
                <small>Friendlies</small>
                <strong>{totals.friendlies.appearances}</strong>
              </span>
            )}
          </div>
          <div className="table-scroll" data-no-swipe role="region" aria-label="Season statistics" tabIndex={0}>
            <table className="data-table player-history-table season-stats-table">
              <thead>
                <tr>
                  <th scope="col">Season · club · competition</th>
                  <th scope="col" title="Appearances and minutes">
                    Apps
                  </th>
                  <th scope="col">Goals</th>
                  <th scope="col">Assists</th>
                  <th scope="col" title="Average match rating">
                    Avg rating
                  </th>
                </tr>
              </thead>
              {blocks.map((block) => (
                <tbody key={block.season}>
                  {block.clubs.length > 0 && (
                    <tr className="season-stats-season">
                      <th scope="row">{seasonLabel(block.season)}</th>
                      <StatCells line={block.total} strong />
                    </tr>
                  )}
                  {block.clubs.map((group) => {
                    const club = (
                      <ClubLink id={group.club.id} name={group.club.name} color={group.club.color ?? undefined} />
                    );
                    if (group.lines.length === 1)
                      return (
                        <tr key={group.club.id} className="season-stats-club">
                          <td>
                            {club}
                            <small className="appearance-status">{competitionLabel(group.lines[0].competition)}</small>
                          </td>
                          <StatCells line={group.lines[0]} />
                        </tr>
                      );
                    return (
                      <Fragment key={group.club.id}>
                        <tr className="season-stats-club">
                          <td>{club}</td>
                          <StatCells line={group.total} />
                        </tr>
                        {group.lines.map((line) => (
                          <tr key={line.competition.id} className="season-stats-competition">
                            <td>{competitionLabel(line.competition)}</td>
                            <StatCells line={line} />
                          </tr>
                        ))}
                      </Fragment>
                    );
                  })}
                  {block.friendlies.map((line) => (
                    <tr key={`f${line.club.id}`} className="season-stats-friendly">
                      <td>
                        {block.clubs.length ? "" : `${seasonLabel(block.season)} · `}Friendlies ·{" "}
                        <ClubLink id={line.club.id} name={line.club.name} color={line.club.color ?? undefined} />
                      </td>
                      <StatCells line={line} />
                    </tr>
                  ))}
                </tbody>
              ))}
              <tfoot>
                <tr className="season-stats-career">
                  <th scope="row">{selected.competition === ALL_COMPETITIONS && selected.club === ALL_CLUBS ? "Career" : "Total shown"}</th>
                  <StatCells line={totals.competitive} strong />
                </tr>
                {totals.friendlies && (
                  <tr className="season-stats-friendly">
                    <th scope="row">Friendlies</th>
                    <StatCells line={totals.friendlies} />
                  </tr>
                )}
              </tfoot>
            </table>
          </div>
          <p className="muted player-history-note">
            Totals cover every competitive match: league, cups, continental and international matches, a loan at the
            club he played for. Friendlies are listed apart. Match ratings and friendlies are kept for the current
            season and your club's matches; — means no rating on record.
          </p>
        </>
      ) : (
        <p className="muted player-history-empty">No appearances match these filters.</p>
      )}
    </>
  );
}

function CareerTimeline({ data, international }: { data: PlayerHistoryData; international: ReactNode }) {
  return (
    <>
      <section className="profile-section">
        <h3>Honours</h3>
        <Honours honours={data.honours} />
      </section>
      <section className="profile-section">
        <h3>Milestones</h3>
        <Milestones milestones={data.milestones} />
      </section>
      <section className="profile-section">
        <h3>Transfers & loans</h3>
        <TransferTable moves={data.transfers} truncated={data.movesTruncated} />
      </section>
      <section className="profile-section">
        <h3>Squad movements</h3>
        {data.squadMoves.length ? (
          <>
            <SquadMoveTable moves={data.squadMoves} label="Squad movements" />
            <p className="muted player-history-note">
              Moves between the club's own teams (first team, B-team, U19, U17). A call-up and his return are one
              entry; none of these are transfers.
            </p>
          </>
        ) : (
          <p className="muted player-history-empty">No moves between the club's own teams recorded.</p>
        )}
      </section>
      <section className="profile-section">
        <h3>International career</h3>
        {international}
      </section>
    </>
  );
}

type CareerView = "timeline" | "statistics" | "matches";
const VIEWS: [CareerView, string][] = [
  ["timeline", "Timeline"],
  ["statistics", "Season statistics"],
  ["matches", "Matches"],
];

/** The Career tab: honours, milestones, moves and caps; grouped season statistics; the full-engine match list. */
export default function PlayerCareer({
  playerId,
  matches,
  international,
}: {
  playerId: number;
  matches: ReactNode;
  international: ReactNode;
}) {
  const [view, setView] = useState<CareerView>("timeline");
  const { data, error } = useResource<PlayerHistoryData>(`players/${playerId}/history`);
  const empty =
    data &&
    !data.transfers.length &&
    !data.squadMoves.length &&
    !data.seasons.length &&
    !data.honours.length &&
    !data.milestones.length;
  return (
    <div className="player-history">
      <fieldset className="segmented-control career-views">
        <legend>Career view</legend>
        <div>
          {VIEWS.map(([id, text]) => (
            <label key={id}>
              <input
                type="radio"
                name={`career-view-${playerId}`}
                value={id}
                checked={view === id}
                onChange={() => setView(id)}
              />
              <span>{text}</span>
            </label>
          ))}
        </div>
      </fieldset>
      {view === "matches" ? (
        matches
      ) : error ? (
        <ErrorState message={error} />
      ) : !data ? (
        <Loading label="Opening player history" />
      ) : empty && view === "timeline" ? (
        <>
          <Empty
            icon={History}
            title="No history recorded yet"
            detail="Transfers, squad moves, honours and season statistics will appear here as this career goes on."
          />
          <section className="profile-section">
            <h3>International career</h3>
            {international}
          </section>
        </>
      ) : view === "timeline" ? (
        <CareerTimeline data={data} international={international} />
      ) : (
        <SeasonStatistics data={data} />
      )}
    </div>
  );
}
