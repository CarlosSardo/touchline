import { useState } from "react";
import { ArrowLeftRight, ChevronLeft, ChevronRight, FileText } from "lucide-react";
import { useCurrency, useResource } from "./game-context.tsx";
import { Badge, ClubLink, Empty, ErrorState, IconButton, Loading, PlayerLink, SortHeader } from "./ui.tsx";
import { dateLabel } from "../shared/rules.ts";
import type { ClubTransfer, ClubTransfers as ClubTransfersData, ClubTransferTotals, PlayerMoveKind } from "../shared/api.ts";
import { callUpSummary, collapseCallUps, type CallUpFlags, type Collapsed } from "./callups.ts";
import { ageValue, dateValue, positionRank, type SortColumn } from "./sort.ts";
import { useSortableRows } from "./useSortableRows.ts";
import { MOVE_KIND_LABELS, seasonLabel } from "./player-history.ts";
import {
  DEFAULT_TRANSFER_FILTER,
  DIRECTION_OPTIONS,
  TYPE_OPTIONS,
  clauseBadges,
  clubTransfersPath,
  isFiltered,
  signedMoney,
  sumTotals,
  transferClauses,
  transferDetail,
  transferFee,
  transferSections,
  updateFilter,
  type TransferDirection,
  type TransferRow,
  type TransferSection,
} from "./club-transfers.ts";
import "./ClubTransfers.css";

type ColumnKey = "date" | "player" | "position" | "age" | "club" | "type" | "fee";

const COLUMNS: SortColumn<TransferRow, ColumnKey>[] = [
  { key: "date", value: (row) => [dateValue(row.date), -row.index], defaultDirection: "desc" },
  { key: "player", value: (row) => row.player.name, defaultDirection: "asc" },
  { key: "position", value: (row) => positionRank(row.player.position), defaultDirection: "asc" },
  { key: "age", value: (row) => ageValue(row.player.ageAtMove), defaultDirection: "asc" },
  { key: "club", value: (row) => row.club?.name ?? null, defaultDirection: "asc" },
  { key: "type", value: (row) => MOVE_KIND_LABELS[row.kind], defaultDirection: "asc" },
  { key: "fee", value: (row) => row.fee, defaultDirection: "desc" },
];

function TotalsStrip({ totals, label }: { totals: ClubTransferTotals; label: string }) {
  const { money } = useCurrency();
  return (
    <dl className="club-transfer-totals" aria-label={label}>
      <div>
        <dt>Spent</dt>
        <dd>{money(totals.spent)}</dd>
      </div>
      <div>
        <dt>Received</dt>
        <dd>{money(totals.received)}</dd>
      </div>
      <div>
        <dt>Net</dt>
        <dd className={totals.net > 0 ? "positive" : totals.net < 0 ? "negative" : undefined}>
          {signedMoney(totals.net, money)}
        </dd>
      </div>
      <div>
        <dt>In / Out</dt>
        <dd title="All recorded moves, including loan returns and moves between the club's own teams">
          {totals.countIn} / {totals.countOut}
        </dd>
      </div>
      {totals.unknownFees > 0 && (
        <div>
          <dt>Fees</dt>
          <dd className="muted" title="Fee-bearing moves whose fee was not recorded; not included in the totals">
            {totals.unknownFees} undisclosed
          </dd>
        </div>
      )}
    </dl>
  );
}

function TransferTable({ section, showTitle }: { section: TransferSection; showTitle: boolean }) {
  const { money } = useCurrency();
  const sorting = useSortableRows(section.rows, COLUMNS, {
    initial: { key: "date", direction: "desc" },
    tieBreakers: [{ value: (row) => row.index }, { value: (row) => row.key }],
  });
  return (
    <section className="club-transfer-section">
      {showTitle && (
        <h4>
          {section.title} <span className="muted">{section.rows.length}</span>
        </h4>
      )}
      {!section.rows.length ? (
        <p className="muted club-transfer-empty">
          No {section.id === "in" ? "arrivals" : "departures"} on this page.
        </p>
      ) : (
        <div className="table-scroll" data-no-swipe role="region" aria-label={section.title} tabIndex={0}>
          <table className="data-table club-transfer-table" aria-label={section.title}>
            <thead>
              <tr>
                <SortHeader {...sorting.header("date")} label="Date" />
                <SortHeader {...sorting.header("player")} label="Player" />
                <SortHeader {...sorting.header("position")} label="Pos" title="Position" />
                <SortHeader {...sorting.header("age")} label="Age" title="Age at the move" />
                <SortHeader {...sorting.header("club")} label={section.clubLabel} />
                <SortHeader {...sorting.header("type")} label="Type" />
                <SortHeader {...sorting.header("fee")} label="Fee" className="club-transfer-number" />
              </tr>
            </thead>
            <tbody>
              {sorting.rows.map((row) => {
                const fee = transferFee(row);
                const callUp = row as TransferRow & Collapsed<CallUpFlags>;
                const detail = callUp.callUp
                  ? callUpSummary({
                      toLabel: row.dealType,
                      fromGroup: null,
                      toGroup: null,
                      start: row.date,
                      returnedOn: callUp.returnedOn,
                      until: callUp.until,
                    })
                  : transferDetail(row, dateLabel);
                const clauses = transferClauses(row.terms, money);
                const badges = clauseBadges(row.terms);
                return (
                  <tr key={row.key}>
                    <td className="club-transfer-date">
                      {row.date ? (
                        <span
                          title={
                            row.dateEstimated
                              ? "Scheduled end of the loan; the return was processed on or after it"
                              : undefined
                          }
                        >
                          {row.dateEstimated ? "≈ " : ""}
                          {dateLabel(row.date)}
                        </span>
                      ) : (
                        <span className="muted">Not recorded</span>
                      )}
                    </td>
                    <td>
                      <PlayerLink id={row.player.id} name={row.player.name} />
                    </td>
                    <td>{row.player.position ?? <span className="muted">—</span>}</td>
                    <td className="club-transfer-number">
                      {row.player.ageAtMove ?? <span className="muted">—</span>}
                    </td>
                    <td>
                      {row.club ? (
                        <ClubLink id={row.club.id} name={row.club.name} color={row.club.color ?? undefined} />
                      ) : (
                        <span className="muted">Free agent</span>
                      )}
                    </td>
                    <td>
                      {callUp.callUp ? "Call-up" : MOVE_KIND_LABELS[row.kind]}
                      {detail && <small className="appearance-status">{detail}</small>}
                    </td>
                    <td className="club-transfer-number">
                      {fee.kind === "amount" ? (
                        money(fee.value)
                      ) : fee.kind === "free" ? (
                        "Free"
                      ) : fee.kind === "noFee" ? (
                        "No fee"
                      ) : fee.kind === "undisclosed" ? (
                        <span className="muted" title="Fee not recorded">
                          Undisclosed
                        </span>
                      ) : (
                        <span className="muted">—</span>
                      )}
                      {clauses.length > 0 && (
                        <small className="club-transfer-terms" title={clauses.join("\n")}>
                          <FileText size={11} aria-hidden="true" />
                          <span className="sr-only">Clauses: {clauses.join("; ")}. </span>
                          <span aria-hidden="true">{badges.join(" · ")}</span>
                        </small>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

export default function ClubTransfers({ clubId }: { clubId: number }) {
  const [filter, setFilter] = useState(DEFAULT_TRANSFER_FILTER);
  const { money } = useCurrency();
  const { data, error, loading } = useResource<ClubTransfersData>(clubTransfersPath(clubId, filter), {
    keepPreviousData: true,
  });
  if (error) return <ErrorState message={error} />;
  if (!data) return <Loading label="Opening transfer history" />;
  const seasons = data.seasons;
  const everything = sumTotals(seasons);
  if (!isFiltered(filter) && !data.total && !everything.countIn && !everything.countOut)
    return (
      <Empty
        icon={ArrowLeftRight}
        title="No transfers recorded yet"
        detail="Signings, sales and loans will appear here season by season."
      />
    );
  const direction: TransferDirection = data.filter.direction;
  const selectedSeason = seasons.find((entry) => entry.season === filter.season);
  return (
    <div className="club-transfers" aria-busy={loading || undefined}>
      <div className="club-transfer-controls" data-no-swipe>
        <label className="field">
          <span>Season</span>
          <select
            aria-label="Transfer season"
            value={filter.season ?? ""}
            onChange={(event) =>
              setFilter(updateFilter(filter, { season: event.target.value ? Number(event.target.value) : null }))
            }
          >
            <option value="">All seasons</option>
            {seasons.map((entry) => (
              <option key={entry.season} value={entry.season}>
                {seasonLabel(entry.season)}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>Type</span>
          <select
            aria-label="Transfer type"
            value={filter.type}
            onChange={(event) =>
              setFilter(updateFilter(filter, { type: event.target.value as PlayerMoveKind | "" }))
            }
          >
            <option value="">All types</option>
            {TYPE_OPTIONS.map((option) => (
              <option key={option.kind} value={option.kind}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
        <fieldset className="segmented-control">
          <legend>Direction</legend>
          <div>
            {DIRECTION_OPTIONS.map(([id, text]) => (
              <label key={id}>
                <input
                  type="radio"
                  name={`club-transfer-direction-${clubId}`}
                  value={id}
                  checked={filter.direction === id}
                  onChange={() => setFilter(updateFilter(filter, { direction: id }))}
                />
                <span>{text}</span>
              </label>
            ))}
          </div>
        </fieldset>
      </div>
      <TotalsStrip
        totals={selectedSeason?.totals ?? everything}
        label={selectedSeason ? `${seasonLabel(selectedSeason.season)} totals` : "All-season totals"}
      />
      {!data.groups.length ? (
        <p className="muted club-transfer-empty">No moves match these filters.</p>
      ) : (
        data.groups.map((group) => (
          <section className="club-transfer-season" key={group.season}>
            <header>
              <h3>{seasonLabel(group.season)}</h3>
              <span className="club-transfer-season-summary">
                <Badge tone="green">{group.totals.countIn} in</Badge>
                <Badge tone="red">{group.totals.countOut} out</Badge>
                <span>Spent {money(group.totals.spent)}</span>
                <span>Received {money(group.totals.received)}</span>
                <strong className={group.totals.net > 0 ? "positive" : group.totals.net < 0 ? "negative" : undefined}>
                  Net {signedMoney(group.totals.net, money)}
                </strong>
                {group.totals.unknownFees > 0 && (
                  <span className="muted">{group.totals.unknownFees} undisclosed</span>
                )}
              </span>
            </header>
            {transferSections(
              collapseCallUps(group.transfers as readonly (ClubTransfer & CallUpFlags)[], (row) => row.player.id),
              direction,
            ).map((section) => (
              <TransferTable key={section.id} section={section} showTitle={direction === "all"} />
            ))}
          </section>
        ))
      )}
      {data.pages > 1 && (
        <div className="pagination">
          <span>{data.total} moves match</span>
          <span className="pagination-actions">
            <IconButton
              icon={ChevronLeft}
              label="Previous transfers"
              disabled={data.page <= 1 || loading}
              onClick={() => setFilter({ ...filter, page: data.page - 1 })}
            />
            {data.page} / {data.pages}
            <IconButton
              icon={ChevronRight}
              label="Next transfers"
              disabled={data.page >= data.pages || loading}
              onClick={() => setFilter({ ...filter, page: data.page + 1 })}
            />
          </span>
        </div>
      )}
      {data.truncated && (
        <p className="muted club-transfer-note">
          Only the club's latest 20,000 recorded moves were read, so the oldest seasons may be incomplete.
        </p>
      )}
      <p className="muted club-transfer-note">
        Season totals cover every move of the season at the agreed fee, whatever the filters. Undisclosed fees are
        not counted. Contract releases and retirements are not recorded yet, so players who left that way are not
        listed.
      </p>
    </div>
  );
}
