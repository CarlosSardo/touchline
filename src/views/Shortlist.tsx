import { useState } from "react";
import {
  ArrowLeftRight,
  Bookmark,
  BookmarkX,
  ClipboardCheck,
  Search,
  X,
} from "lucide-react";
import { api, useCurrency, useGame, useResource } from "../game-context.tsx";
import {
  Badge,
  Button,
  ClubLink,
  Empty,
  Field,
  IconButton,
  Nationalities,
  PlayerName,
  Rating,
  SectionHeading,
  SortHeader,
  TextLink,
} from "../ui.tsx";
import { useSortableRows } from "../useSortableRows.ts";
import {
  PLAYER_COLUMNS,
  PLAYER_TIE_BREAKERS,
  rankOf,
  type PlayerSortKey,
  type SortColumn,
} from "../sort.ts";
import {
  activeNegotiation,
  AGE_BANDS,
  clubLabel,
  isInternationalMinor,
  POSITION_LINES,
  positionLine,
  SHORTLIST_STATUSES,
  shortlistStatus,
  type PositionLine,
  type ShortlistContext,
  type ShortlistStatus,
} from "../players.ts";
import { addDays, dateLabel, POSITIONS } from "../../shared/rules.ts";
import type { TransferDesk } from "../../shared/api.ts";
import type { Player } from "../../shared/types.ts";

type ShortlistKey = PlayerSortKey | "status";
type Grouping = "line" | "status" | "none";
const GROUPINGS: [Grouping, string][] = [
  ["line", "Position line"],
  ["status", "Status"],
  ["none", "Single list"],
];
const VALUE_CAPS = [1_000_000, 5_000_000, 10_000_000, 25_000_000, 50_000_000, 100_000_000];
const STATUS_ORDER = SHORTLIST_STATUSES.map((entry) => entry.id);

export default function Shortlist({ players }: { players: Player[] }) {
  const { bootstrap, act, navigate, notify, openOffer, refresh, confirm } =
    useGame();
  const { money } = useCurrency();
  const { data: desk } = useResource<TransferDesk>("transfers");
  const [grouping, setGrouping] = useState<Grouping>("line");
  const [query, setQuery] = useState("");
  const [position, setPosition] = useState("");
  const [line, setLine] = useState<PositionLine | "">("");
  const [ageBand, setAgeBand] = useState("");
  const [maxValue, setMaxValue] = useState("");
  const [route, setRoute] = useState("");
  const [status, setStatus] = useState<ShortlistStatus | "">("");
  const [selected, setSelected] = useState<number[]>([]);
  const [removing, setRemoving] = useState(false);
  const context: ShortlistContext | null = bootstrap
    ? {
        clubId: bootstrap.club.id,
        clubCountryId: bootstrap.club.country_id,
        clubCountryName: bootstrap.club.country_name,
        transferBudget: bootstrap.club.transfer_budget,
        negotiations: desk?.negotiations ?? [],
      }
    : null;
  const statusOf = new Map(
    players.map((player) => [
      player.id,
      context ? shortlistStatus(player, context) : "available",
    ]),
  );
  const columns: SortColumn<Player, ShortlistKey>[] = [
    PLAYER_COLUMNS.name,
    PLAYER_COLUMNS.position,
    PLAYER_COLUMNS.age,
    PLAYER_COLUMNS.nationality,
    PLAYER_COLUMNS.club,
    PLAYER_COLUMNS.ability,
    PLAYER_COLUMNS.potential,
    PLAYER_COLUMNS.value,
    PLAYER_COLUMNS.wage,
    PLAYER_COLUMNS.contract,
    {
      key: "status",
      value: (player) => rankOf(STATUS_ORDER, statusOf.get(player.id)),
      defaultDirection: "asc",
    },
  ];
  const band = AGE_BANDS.find((entry) => entry.id === ageBand);
  const valueCap =
    maxValue === "budget"
      ? (bootstrap?.club.transfer_budget ?? 0)
      : maxValue
        ? Number(maxValue)
        : null;
  const search = query.trim().toLowerCase();
  const matches = (player: Player, ignore?: "line" | "status") =>
    (!search ||
      `${player.name} ${player.nationality} ${clubLabel(player)}`
        .toLowerCase()
        .includes(search)) &&
    (!position || player.position === position) &&
    (ignore === "line" || !line || positionLine(player.position) === line) &&
    (!band || (player.age >= band.min && player.age <= band.max)) &&
    (valueCap === null || player.value <= valueCap) &&
    (!route ||
      !context ||
      (route === "u18") === isInternationalMinor(player, context)) &&
    (ignore === "status" || !status || statusOf.get(player.id) === status);
  const filtered = players.filter((player) => matches(player));
  const sorting = useSortableRows(filtered, columns, {
    initial: { key: "potential", direction: "desc" },
    tieBreakers: PLAYER_TIE_BREAKERS,
  });
  if (!bootstrap || !context) return null;
  const filtersActive =
    !!query || !!position || !!line || !!ageBand || !!maxValue || !!route || !!status;
  function clearFilters() {
    setQuery("");
    setPosition("");
    setLine("");
    setAgeBand("");
    setMaxValue("");
    setRoute("");
    setStatus("");
  }
  const statusBase = players.filter((player) => matches(player, "status"));
  const statusCounts = new Map(
    STATUS_ORDER.map((id) => [
      id,
      statusBase.filter((player) => statusOf.get(player.id) === id).length,
    ]),
  );
  const lineCounts = new Map(
    POSITION_LINES.map((entry) => [
      entry.id,
      players.filter(
        (player) =>
          matches(player, "line") && positionLine(player.position) === entry.id,
      ).length,
    ]),
  );
  const rows = sorting.rows;
  const groups =
    grouping === "line"
      ? POSITION_LINES.map((entry) => ({
          id: entry.id,
          label: entry.label,
          players: rows.filter((player) => positionLine(player.position) === entry.id),
        }))
      : grouping === "status"
        ? SHORTLIST_STATUSES.map((entry) => ({
            id: entry.id,
            label: entry.label,
            players: rows.filter((player) => statusOf.get(player.id) === entry.id),
          }))
        : [{ id: "all", label: "", players: rows }];
  const shortlisted = new Set(players.map((player) => player.id));
  const selection = selected.filter((id) => shortlisted.has(id));
  const visibleIds = rows.map((player) => player.id);
  const allVisibleSelected =
    visibleIds.length > 0 && visibleIds.every((id) => selection.includes(id));
  const someVisibleSelected = visibleIds.some((id) => selection.includes(id));
  const expiry = addDays(bootstrap.state.date, 365);
  function toggleSelected(id: number, checked: boolean) {
    setSelected((current) =>
      checked ? [...new Set([...current, id])] : current.filter((entry) => entry !== id),
    );
  }
  async function removeSelected(ids: number[]) {
    setRemoving(true);
    let removed = 0;
    let failure: unknown = null;
    try {
      for (const playerId of ids) {
        await api("action", {
          method: "POST",
          body: JSON.stringify({ type: "shortlist", playerId, active: false }),
        });
        removed++;
      }
    } catch (error) {
      failure = error;
    }
    await refresh();
    setSelected([]);
    setRemoving(false);
    notify(
      failure instanceof Error
        ? failure.message
        : `${removed} ${removed === 1 ? "player" : "players"} removed from your shortlist.`,
      failure ? "error" : "success",
    );
  }
  if (!players.length)
    return (
      <Empty
        icon={Bookmark}
        title="Your shortlist is empty"
        detail="Bookmark players in the database, scout reports or a player dossier to track them here."
      >
        <Button icon={Search} onClick={() => navigate("database")}>
          Search the database
        </Button>
      </Empty>
    );
  return (
    <div className="shortlist">
      <SectionHeading
        title="Priority targets"
        subtitle={`${players.length} shortlisted / ${money(bootstrap.club.transfer_budget)} transfer budget`}
      >
        <TextLink onClick={() => navigate("database")}>Search the database</TextLink>
      </SectionHeading>
      <div className="shortlist-controls">
        <fieldset className="segmented-control" data-no-swipe>
          <legend>Group by</legend>
          <div>
            {GROUPINGS.map(([id, text]) => (
              <label key={id}>
                <input
                  type="radio"
                  name="shortlist-grouping"
                  value={id}
                  checked={grouping === id}
                  onChange={() => setGrouping(id)}
                />
                <span>{text}</span>
              </label>
            ))}
          </div>
        </fieldset>
        <div className="status-filter" role="group" aria-label="Shortlist status">
          <button
            type="button"
            aria-pressed={!status}
            aria-label={`All statuses: ${statusBase.length} players`}
            onClick={() => setStatus("")}
          >
            <span>All</span>
            <strong>{statusBase.length}</strong>
          </button>
          {SHORTLIST_STATUSES.map((entry) => (
            <button
              type="button"
              key={entry.id}
              title={entry.description}
              aria-pressed={status === entry.id}
              aria-label={`${entry.label}: ${statusCounts.get(entry.id)} players`}
              disabled={!statusCounts.get(entry.id) && status !== entry.id}
              onClick={() => setStatus(status === entry.id ? "" : entry.id)}
            >
              <span className={`status-swatch tone-${entry.tone}`} aria-hidden="true" />
              <span>{entry.label}</span>
              <strong>{statusCounts.get(entry.id)}</strong>
            </button>
          ))}
        </div>
      </div>
      <div className="filter-bar roster-toolbar">
        <div className="search-field">
          <Search size={17} aria-hidden="true" />
          <input
            aria-label="Search shortlist"
            placeholder="Search name, nationality or club"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
        </div>
        <Field label="Position">
          <select
            aria-label="Shortlist position"
            value={position}
            onChange={(event) => setPosition(event.target.value)}
          >
            <option value="">All positions</option>
            {POSITIONS.map((item) => (
              <option key={item}>{item}</option>
            ))}
          </select>
        </Field>
        <Field label="Age band">
          <select
            aria-label="Shortlist age band"
            value={ageBand}
            onChange={(event) => setAgeBand(event.target.value)}
          >
            <option value="">Any age</option>
            {AGE_BANDS.map((entry) => (
              <option key={entry.id} value={entry.id}>
                {entry.label}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Maximum value">
          <select
            aria-label="Shortlist maximum value"
            value={maxValue}
            onChange={(event) => setMaxValue(event.target.value)}
          >
            <option value="">No limit</option>
            <option value="budget">
              Within budget ({money(bootstrap.club.transfer_budget)})
            </option>
            {VALUE_CAPS.map((cap) => (
              <option key={cap} value={cap}>
                Up to {money(cap)}
              </option>
            ))}
          </select>
        </Field>
        <Field label="U18 route">
          <select
            aria-label="Shortlist U18 route"
            value={route}
            onChange={(event) => setRoute(event.target.value)}
          >
            <option value="">Any registration</option>
            <option value="ok">Can register (adult or national)</option>
            <option value="u18">International U18 (route needed)</option>
          </select>
        </Field>
        {filtersActive && (
          <IconButton icon={X} label="Clear shortlist filters" onClick={clearFilters} />
        )}
      </div>
      <div className="position-coverage line-coverage" role="group" aria-label="Shortlist position lines">
        {POSITION_LINES.map((entry) => (
          <button
            type="button"
            key={entry.id}
            aria-pressed={line === entry.id}
            aria-label={`${entry.label}: ${lineCounts.get(entry.id)} players`}
            onClick={() => setLine(line === entry.id ? "" : entry.id)}
          >
            <span>{entry.label}</span>
            <strong>{lineCounts.get(entry.id)}</strong>
          </button>
        ))}
      </div>
      <div className="roster-result-count" role="status">
        {rows.length} of {players.length} players
        {!desk ? " / Checking negotiations" : ""}
      </div>
      {selection.length > 0 && (
        <div className="shortlist-bulk" role="group" aria-label="Selected shortlist players">
          <strong>{selection.length} selected</strong>
          <Button
            variant="danger"
            icon={BookmarkX}
            disabled={removing}
            onClick={() =>
              confirm(
                "Remove from shortlist?",
                `${selection.length} ${selection.length === 1 ? "player" : "players"} will be removed from your shortlist. You can bookmark them again at any time.`,
                () => void removeSelected(selection),
              )
            }
          >
            {removing ? "Removing..." : "Remove selected"}
          </Button>
          <Button variant="ghost" disabled={removing} onClick={() => setSelected([])}>
            Clear selection
          </Button>
        </div>
      )}
      {rows.length ? (
        <div
          className="table-scroll roster-table-scroll"
          role="region"
          aria-label="Shortlisted players"
          tabIndex={0}
          data-no-swipe
        >
          <table className="data-table roster-table shortlist-table">
            <caption className="sr-only">
              Shortlisted players grouped by{" "}
              {grouping === "none" ? "nothing" : grouping === "line" ? "position line" : "status"}
            </caption>
            <thead>
              <tr>
                <SortHeader
                  {...sorting.header("name")}
                  label="Player"
                  leading={
                    <input
                      type="checkbox"
                      aria-label="Select all shown players"
                      checked={allVisibleSelected}
                      ref={(element) => {
                        if (element)
                          element.indeterminate = someVisibleSelected && !allVisibleSelected;
                      }}
                      onChange={(event) =>
                        setSelected((current) =>
                          event.target.checked
                            ? [...new Set([...current, ...visibleIds])]
                            : current.filter((id) => !visibleIds.includes(id)),
                        )
                      }
                    />
                  }
                />
                <SortHeader {...sorting.header("position")} label="Pos" title="Position" />
                <SortHeader {...sorting.header("age")} label="Age" />
                <SortHeader {...sorting.header("nationality")} label="Nationality" />
                <SortHeader {...sorting.header("club")} label="Club" />
                <SortHeader {...sorting.header("ability")} label="Ability" title="Current ability" />
                <SortHeader {...sorting.header("potential")} label="Potential" title="Current dynamic potential" />
                <SortHeader {...sorting.header("value")} label="Value" className="number" />
                <SortHeader {...sorting.header("wage")} label="Wage / wk" className="number" />
                <SortHeader {...sorting.header("contract")} label="Contract" title="Contract end" />
                <SortHeader {...sorting.header("status")} label="Status" />
                <th>
                  <span className="sr-only">Actions</span>
                </th>
              </tr>
            </thead>
            {groups
              .filter((group) => group.players.length)
              .map((group) => (
                <tbody key={group.id}>
                  {grouping !== "none" && (
                    <tr className="roster-group-row">
                      <th scope="rowgroup" colSpan={12}>
                        {group.label} <span>{group.players.length}</span>
                      </th>
                    </tr>
                  )}
                  {group.players.map((player) => {
                    const state = statusOf.get(player.id) ?? "available";
                    const meta = SHORTLIST_STATUSES.find((entry) => entry.id === state)!;
                    const negotiation = activeNegotiation(player, context);
                    const own = state === "own";
                    return (
                      <tr key={player.id} className={selection.includes(player.id) ? "selected-row" : ""}>
                        <td>
                          <div className="player-identity-actions shortlist-player">
                            <input
                              type="checkbox"
                              aria-label={`Select ${player.name}`}
                              checked={selection.includes(player.id)}
                              onChange={(event) => toggleSelected(player.id, event.target.checked)}
                            />
                            <PlayerName player={player} compact detail={player.role} />
                          </div>
                        </td>
                        <td>
                          <span className="position-tag">{player.position}</span>
                        </td>
                        <td>{player.age}</td>
                        <td>
                          <Nationalities player={player} />
                        </td>
                        <td className="club-cell">
                          <span className="club-dot" style={{ background: player.club_color }} />
                          <ClubLink id={player.club_id} name={clubLabel(player)} />
                        </td>
                        <td>
                          <Rating value={player.ability} />
                        </td>
                        <td>
                          <Rating value={player.potential} potential />
                        </td>
                        <td className="number money">{money(player.value)}</td>
                        <td className="number muted">{money(player.wage)}</td>
                        <td>
                          {player.club_id ? (
                            <span className="contract-cell">
                              {dateLabel(player.contract_end)}
                              {player.contract_end <= expiry && <small>Expiring</small>}
                            </span>
                          ) : (
                            <span className="muted">No contract</span>
                          )}
                        </td>
                        <td>
                          <Badge tone={meta.tone}>
                            {meta.label}
                            {negotiation ? ` / ${negotiation.stage}` : ""}
                          </Badge>
                        </td>
                        <td>
                          <div className="inline-controls row-actions">
                            <IconButton
                              icon={own ? ClipboardCheck : ArrowLeftRight}
                              label={own ? `Open contract for ${player.name}` : `Make an offer for ${player.name}`}
                              disabled={!!player.parent_club_id}
                              onClick={() => openOffer(player.id)}
                            />
                            <IconButton
                              icon={BookmarkX}
                              label={`Remove ${player.name} from shortlist`}
                              disabled={removing}
                              onClick={() =>
                                void act({ type: "shortlist", playerId: player.id, active: false })
                              }
                            />
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              ))}
          </table>
        </div>
      ) : (
        <Empty
          icon={Search}
          title="No shortlisted players match these filters"
          detail="Clear a filter or pick another status to see more targets."
        >
          <Button icon={X} variant="secondary" onClick={clearFilters}>
            Clear filters
          </Button>
        </Empty>
      )}
    </div>
  );
}
