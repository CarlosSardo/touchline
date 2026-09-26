import { useState } from "react";
import { History } from "lucide-react";
import { useCurrency, useResource } from "./game-context.tsx";
import { Badge, ClubLink, Empty, ErrorState, Loading, SortHeader } from "./ui.tsx";
import { compactNumber, dateLabel } from "../shared/rules.ts";
import type { PlayerHistory as PlayerHistoryData, PlayerMove, PlayerStatLine } from "../shared/api.ts";
import { dateValue, type SortColumn } from "./sort.ts";
import { useSortableRows } from "./useSortableRows.ts";
import {
  ALL_COMPETITIONS,
  MOVE_KIND_LABELS,
  competitionLabel,
  historyCompetitions,
  moveFee,
  seasonLabel,
  seasonRows,
  totalStatLine,
  type SeasonStatRow,
} from "./player-history.ts";
import { callUpSummary, collapseCallUps, type CallUpFlags, type Collapsed } from "./callups.ts";
import "./PlayerHistory.css";

type MoveRow = Collapsed<PlayerMove & CallUpFlags> & { index: number };

const MOVE_COLUMNS: SortColumn<MoveRow, "date" | "from" | "to" | "fee" | "type">[] = [
  { key: "date", value: (move) => [dateValue(move.date), move.index], defaultDirection: "desc" },
  { key: "from", value: (move) => move.from?.name ?? null, defaultDirection: "asc" },
  { key: "to", value: (move) => move.to?.name ?? null, defaultDirection: "asc" },
  { key: "fee", value: (move) => move.fee, defaultDirection: "desc" },
  { key: "type", value: (move) => (move.callUp ? "Call-up" : MOVE_KIND_LABELS[move.kind]), defaultDirection: "asc" },
];

const SEASON_COLUMNS: SortColumn<
  SeasonStatRow,
  "season" | "club" | "competition" | "apps" | "goals" | "assists" | "rating"
>[] = [
  { key: "season", value: (row) => row.season, defaultDirection: "desc" },
  { key: "club", value: (row) => row.club.name, defaultDirection: "asc" },
  { key: "competition", value: (row) => competitionLabel(row.competition), defaultDirection: "asc" },
  { key: "apps", value: (row) => [row.appearances, row.minutes], defaultDirection: "desc" },
  { key: "goals", value: (row) => row.goals, defaultDirection: "desc" },
  { key: "assists", value: (row) => row.assists, defaultDirection: "desc" },
  { key: "rating", value: (row) => row.averageRating, defaultDirection: "desc" },
];

const NOT_RECORDED = "Not recorded for this season";

function coverageNote(line: PlayerStatLine) {
  return line.coverage === "partial"
    ? `Recorded in ${line.recordedAppearances} of ${line.appearances} appearances`
    : line.coverage === "none"
      ? NOT_RECORDED
      : undefined;
}

function RatingCell({ line }: { line: PlayerStatLine }) {
  if (line.averageRating === null) return <span className="muted">—</span>;
  const rating = line.averageRating;
  return (
    <Badge tone={rating >= 7 ? "green" : rating < 6 ? "red" : "amber"}>{rating.toFixed(2)}</Badge>
  );
}

function MoveTable({ moves, truncated }: { moves: PlayerMove[]; truncated: boolean }) {
  const { money } = useCurrency();
  const sorting = useSortableRows(
    collapseCallUps(moves as readonly (PlayerMove & CallUpFlags)[]).map((move, index) => ({ ...move, index })),
    MOVE_COLUMNS,
    {
      initial: { key: "date", direction: "desc" },
      tieBreakers: [{ value: (move) => move.index, defaultDirection: "desc" }],
    },
  );
  if (!moves.length)
    return <p className="muted player-history-empty">No moves recorded for this player yet.</p>;
  return (
    <>
      <div className="table-scroll" data-no-swipe role="region" aria-label="Transfers and moves" tabIndex={0}>
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
              const detail = move.callUp
                ? callUpSummary({
                    toLabel: move.dealType,
                    fromGroup: move.ageGroup?.from ?? null,
                    toGroup: move.ageGroup?.to ?? null,
                    start: move.date,
                    returnedOn: move.returnedOn,
                    until: move.until,
                  })
                : move.kind === "squad" && move.ageGroup
                  ? `${move.ageGroup.from ?? "—"} → ${move.ageGroup.to ?? "—"}`
                  : move.kind === "loan" && move.loanUntil
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
                    {move.callUp ? "Call-up" : MOVE_KIND_LABELS[move.kind]}
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

function SeasonTable({ rows }: { rows: SeasonStatRow[] }) {
  const sorting = useSortableRows(rows, SEASON_COLUMNS, {
    initial: { key: "season", direction: "desc" },
    tieBreakers: [
      { value: (row) => row.season, defaultDirection: "desc" },
      { value: (row) => row.appearances, defaultDirection: "desc" },
      { value: (row) => row.key },
    ],
  });
  return (
    <div className="table-scroll" data-no-swipe role="region" aria-label="Season statistics" tabIndex={0}>
      <table className="data-table player-history-table">
        <thead>
          <tr>
            <SortHeader {...sorting.header("season")} label="Season" />
            <SortHeader {...sorting.header("club")} label="Club" />
            <SortHeader {...sorting.header("competition")} label="Competition" />
            <SortHeader {...sorting.header("apps")} label="Apps" title="Appearances" />
            <SortHeader {...sorting.header("goals")} label="Goals" />
            <SortHeader {...sorting.header("assists")} label="Assists" />
            <SortHeader {...sorting.header("rating")} label="Avg rating" title="Average match rating" />
          </tr>
        </thead>
        <tbody>
          {sorting.rows.map((row) => {
            const note = coverageNote(row);
            return (
              <tr key={row.key}>
                <td>{seasonLabel(row.season)}</td>
                <td>
                  <ClubLink id={row.club.id} name={row.club.name} color={row.club.color ?? undefined} />
                </td>
                <td>{competitionLabel(row.competition)}</td>
                <td className="player-history-number">
                  <strong>{row.appearances}</strong>
                  <small className="appearance-status">{compactNumber(row.minutes)}'</small>
                </td>
                <td className="player-history-number" title={note}>
                  {row.goals ?? <span className="muted">—</span>}
                </td>
                <td className="player-history-number" title={note}>
                  {row.assists ?? <span className="muted">—</span>}
                </td>
                <td className="player-history-number" title={note}>
                  <RatingCell line={row} />
                  {row.coverage === "partial" && (
                    <small className="appearance-status">
                      {row.recordedAppearances} of {row.appearances}
                    </small>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

export default function PlayerHistory({ playerId }: { playerId: number }) {
  const [competition, setCompetition] = useState(ALL_COMPETITIONS);
  const { data, error } = useResource<PlayerHistoryData>(`players/${playerId}/history`);
  if (error) return <ErrorState message={error} />;
  if (!data) return <Loading label="Opening player history" />;
  if (!data.moves.length && !data.seasons.length)
    return (
      <Empty
        icon={History}
        title="No history recorded yet"
        detail="Transfers, loans and season statistics will appear here as this career goes on."
      />
    );
  const competitions = historyCompetitions(data);
  const selected = competitions.some((entry) => entry.key === competition) ? competition : ALL_COMPETITIONS;
  const rows = seasonRows(data, selected);
  const totals = selected === ALL_COMPETITIONS ? data.career : totalStatLine(rows);
  const note = coverageNote(totals);
  return (
    <div className="player-history">
      <section className="profile-section">
        <h3>Transfer history</h3>
        <MoveTable moves={data.moves} truncated={data.movesTruncated} />
      </section>
      <section className="profile-section">
        <h3>Season statistics</h3>
        <div className="career-history-controls">
          <label className="field">
            <span>Competition</span>
            <select
              aria-label="Player history competition"
              value={selected}
              onChange={(event) => setCompetition(event.target.value)}
            >
              <option value={ALL_COMPETITIONS}>All competitions</option>
              {competitions.map((entry) => (
                <option key={entry.key} value={entry.key}>
                  {entry.label}
                </option>
              ))}
            </select>
          </label>
        </div>
        {rows.length ? (
          <>
            <div className="career-season-summary" title={note}>
              <span>
                <small>Appearances</small>
                <strong>{totals.appearances}</strong>
              </span>
              <span>
                <small>Minutes</small>
                <strong>{compactNumber(totals.minutes)}</strong>
              </span>
              <span>
                <small>Goals</small>
                <strong>{totals.goals ?? "—"}</strong>
              </span>
              <span>
                <small>Assists</small>
                <strong>{totals.assists ?? "—"}</strong>
              </span>
              <span>
                <small>Average rating</small>
                <strong>{totals.averageRating?.toFixed(2) ?? "—"}</strong>
              </span>
            </div>
            <SeasonTable rows={rows} />
            <p className="muted player-history-note">
              — means not recorded. Appearances and minutes cover every competitive match; goals, assists and
              ratings come only from matches simulated in full detail, such as your club's matches.
            </p>
          </>
        ) : (
          <p className="muted player-history-empty">No appearances recorded yet.</p>
        )}
      </section>
    </div>
  );
}
