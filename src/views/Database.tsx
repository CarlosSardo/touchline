import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import {
  Bookmark,
  ChevronLeft,
  ChevronRight,
  Database as DatabaseIcon,
  Download,
  RotateCcw,
  Search,
  SlidersHorizontal,
  X,
} from "lucide-react";
import { useCurrency, useGame, useResource } from "../game-context.tsx";
import {
  Button,
  Empty,
  ErrorState,
  Field,
  IconButton,
  Loading,
  PageHeading,
  Panel,
  PlayerTable,
  ShortlistButton,
  SortDirectionButton,
  type PlayerTableColumn,
} from "../ui.tsx";
import {
  ATTRIBUTE_GROUPS,
  compactNumber,
  label,
  PERSONALITY_KEYS,
  POSITIONS,
} from "../../shared/rules.ts";
import type { PlayerPage, WorldClubPage } from "../../shared/api.ts";
import type { League } from "../../shared/types.ts";
import type { PlayerSearchRange } from "../../shared/player-search.ts";
import {
  PLAYER_COLUMNS,
  type PlayerSortKey,
  type SortDirection,
  type SortState,
} from "../sort.ts";
import { createDebouncer, totalLabel } from "../resource-cache.ts";
import { EligibilityBadge } from "../EligibilityBadge.tsx";
import {
  amountText,
  defaultFilters,
  FILTER_GROUPS,
  isActiveRange,
  parseAmount,
  playerQuery,
  RANGE_FILTERS,
  rangeHint,
  rangeSpec,
  rangeText,
  readRange,
  SELECT_FILTERS,
  withFilter,
  type FilterGroupId,
  type Filters,
  type RangeSpec,
} from "../database-filters.ts";

const TYPING_DELAY_MS = 300;

/** Follows `value` after a pause in typing; clearing applies at once. */
function useTypedValue(value: string) {
  const [typed, setTyped] = useState(value);
  if (value === "" && typed !== "") setTyped("");
  useEffect(() => {
    if (value === "") return;
    const timer = setTimeout(() => setTyped(value), TYPING_DELAY_MS);
    return () => clearTimeout(timer);
  }, [value]);
  return value === "" ? "" : typed;
}

type DatabaseSortKey = PlayerSortKey | "minutes";
const SORT_OPTIONS: [DatabaseSortKey, string][] = [
  ["ability", "Ability"],
  ["potential", "Potential"],
  ["value", "Value"],
  ["age", "Age"],
  ["name", "Name"],
  ["position", "Position"],
  ["nationality", "Nationality"],
  ["club", "Club"],
  ["wage", "Wage"],
  ["contract", "Contract expiry"],
  ["height", "Height"],
  ["weight", "Weight"],
  ["form", "Form"],
  ["goals", "Goals"],
  ["minutes", "Minutes"],
];
const DATABASE_COLUMNS: PlayerTableColumn[] = [
  "position",
  "age",
  "nationality",
  "ability",
  "potential",
  "club",
  "value",
  "wage",
  "contract",
  "height",
  "form",
];
const sortDirection = (key: DatabaseSortKey): SortDirection =>
  key === "minutes" ? "desc" : (PLAYER_COLUMNS[key].defaultDirection ?? "asc");

const LIFESTYLES = ["disciplined", "nightlife", "family-focused", "luxury-obsessed", "gym-rat"];
const TRAITS = [
  "Cuts inside",
  "Shoots from distance",
  "Dribbles often",
  "Aggressive presser",
  "Big-game player",
  "Lazy trainer",
  "Plays one-twos",
  "Dictates tempo",
  "Arrives late in box",
  "Stays on feet",
  "Tries killer balls",
  "Leads by example",
  "Runs with ball",
  "Plays safe passes",
  "Likes to beat offside trap",
  "Long throw specialist",
];
const AVAILABILITY_LABELS: Record<string, string> = {
  listed: "Transfer listed",
  availableLoan: "Loan listed",
  freeAgent: "Free agents & home-based",
};

interface RangeProps {
  spec: RangeSpec;
  /** What the inputs show (updates on every keystroke). */
  filters: Filters;
  /** What the search uses (after the typing pause); corrections are explained against it. */
  applied: Filters;
  onType: (key: string, value: string) => void;
  title?: string;
  disabled?: boolean;
}

/** A labelled min–max pair with an inline note when the search had to correct it. */
function RangeLayout({
  id,
  title,
  help,
  hint,
  children,
}: {
  id: string;
  title: string;
  help?: string;
  hint: string | null;
  children: [ReactNode, ReactNode];
}) {
  return (
    <div className="range-filter" role="group" aria-labelledby={`${id}-label`}>
      <span className="range-filter-label" id={`${id}-label`}>
        {title}
        {help && <small> · {help}</small>}
      </span>
      <div className="range-filter-inputs">
        {children[0]}
        <span className="range-filter-separator" aria-hidden="true">–</span>
        {children[1]}
      </div>
      <p className="range-filter-hint" id={`${id}-hint`} aria-live="polite">{hint}</p>
    </div>
  );
}

function RangeField({ spec, filters, applied, onType, title, disabled = false }: RangeProps) {
  const id = useId();
  const reading = readRange(spec, applied[`${spec.key}Min`], applied[`${spec.key}Max`]);
  const hint = disabled ? null : rangeHint(spec, reading);
  const input = (side: "min" | "max") => {
    const key = `${spec.key}${side === "min" ? "Min" : "Max"}`;
    return (
      <input
        type="number"
        inputMode={spec.step ? "decimal" : "numeric"}
        aria-label={`${spec.label} ${side === "min" ? "minimum" : "maximum"}`}
        aria-describedby={hint ? `${id}-hint` : undefined}
        aria-invalid={(!disabled && reading.clamped.includes(side)) || undefined}
        placeholder={side === "min" ? "Min" : "Max"}
        min={spec.min}
        max={spec.max}
        step={spec.step ?? 1}
        disabled={disabled}
        value={filters[key]}
        onChange={(event) => onType(key, event.target.value)}
      />
    );
  };
  return (
    <RangeLayout
      id={id}
      title={`${title ?? spec.label}${spec.unit ? ` (${spec.unit})` : ""}`}
      help={spec.help}
      hint={hint}
    >
      {input("min")}
      {input("max")}
    </RangeLayout>
  );
}

/** Amounts are typed in the display currency ("750k", "2.5m") and stored in the accounting currency. */
function MoneyRangeField({ spec, filters, applied, onType }: RangeProps) {
  const id = useId();
  const { currency, money, displayAmount, accountingAmount } = useCurrency();
  const [drafts, setDrafts] = useState<
    Record<string, { base: string; currency: string; text: string } | undefined>
  >({});
  const draftOf = (key: string) => {
    const draft = drafts[key];
    return draft?.base === filters[key] && draft.currency === currency ? draft : undefined;
  };
  const keys = [`${spec.key}Min`, `${spec.key}Max`];
  const unreadable = keys.filter((key) => {
    const draft = draftOf(key);
    return draft !== undefined && parseAmount(draft.text) === null;
  });
  const reading = readRange(spec, applied[keys[0]], applied[keys[1]]);
  const hint = unreadable.length
    ? "Type an amount such as 750k or 2.5m."
    : rangeHint(spec, reading, (value) => money(value));
  const input = (key: string, side: "minimum" | "maximum") => (
    <input
      type="text"
      autoComplete="off"
      spellCheck={false}
      aria-label={`${spec.label} ${side}`}
      aria-describedby={hint ? `${id}-hint` : undefined}
      aria-invalid={unreadable.includes(key) || undefined}
      placeholder={side === "minimum" ? "Min" : "Max"}
      value={
        draftOf(key)?.text ??
        (filters[key] === "" ? "" : amountText(displayAmount(Number(filters[key]))))
      }
      onChange={(event) => {
        const text = event.target.value;
        const amount = parseAmount(text);
        const base =
          amount === undefined ? "" : amount === null ? filters[key] : String(accountingAmount(amount));
        setDrafts((current) => ({ ...current, [key]: { base, currency, text } }));
        if (amount !== null) onType(key, base);
      }}
      onBlur={() => {
        if (!unreadable.includes(key)) setDrafts((current) => ({ ...current, [key]: undefined }));
      }}
    />
  );
  return (
    <RangeLayout id={id} title={`${spec.label} (${currency})`} hint={hint}>
      {input(keys[0], "minimum")}
      {input(keys[1], "maximum")}
    </RangeLayout>
  );
}

interface FilterChip {
  key: string;
  /** Names the chip's remove button: "Remove {name} filter". */
  name: string;
  text: string;
  group: FilterGroupId;
  clear: string[];
}

export default function Database() {
  const { bootstrap, search, setSearch, notify } = useGame();
  const { money } = useCurrency();
  const [filters, setFilters] = useState<Filters>(defaultFilters);
  // Query filters: selects and chips apply at once, typed numbers after a pause.
  const [appliedFilters, setAppliedFilters] = useState<Filters>(defaultFilters);
  const typing = useRef(createDebouncer(TYPING_DELAY_MS));
  useEffect(() => {
    const debouncer = typing.current;
    return () => debouncer.cancel();
  }, []);
  const [generation, setGeneration] = useState(0);
  const [advanced, setAdvanced] = useState(false);
  const [shortlisted, setShortlisted] = useState(false);
  const [sorting, setSorting] = useState<SortState<DatabaseSortKey>>({
    key: "ability",
    direction: "desc",
  });
  const { key: sort, direction } = sorting;
  const [pagination, setPagination] = useState({ key: "", page: 1 });
  const [pageSize, setPageSize] = useState(30);
  const deferredSearch = useTypedValue(search);
  const query = playerQuery(appliedFilters);
  const filterKey = JSON.stringify([
    deferredSearch,
    query,
    sort,
    direction,
    shortlisted,
    pageSize,
  ]);
  const page = pagination.key === filterKey ? pagination.page : 1;
  const setPage = (value: number) =>
    setPagination({ key: filterKey, page: value });
  const params = new URLSearchParams({
    q: deferredSearch,
    sort,
    direction,
    page: String(page),
    pageSize: String(pageSize),
  });
  for (const [key, value] of Object.entries(query)) params.set(key, value);
  if (shortlisted) params.set("shortlisted", "1");
  const next = new URLSearchParams(params);
  next.set("page", String(page + 1));
  const [knownPages, setKnownPages] = useState(0);
  const { data, loading, error } = useResource<PlayerPage & { totalCapped?: boolean }>(
    `players?${params}`,
    {
      keepPreviousData: true,
      cache: true,
      prefetch: page < knownPages ? `players?${next}` : null,
    },
  );
  const settledPages = data && !loading ? data.pages : knownPages;
  if (settledPages !== knownPages) setKnownPages(settledPages);
  const totalText = data
    ? totalLabel(data.total, data.totalCapped === true)
    : "...";
  // League options load with the club filters (or for a chip); the club list once a league is chosen.
  const { data: leagues } = useResource<League[]>(
    advanced || filters.clubCountry || filters.league
      ? "leagues?kind=league&age=Senior&limit=500"
      : null,
    { cache: true },
  );
  const { data: leagueClubs } = useResource<WorldClubPage>(
    filters.league
      ? `world/clubs?league=${filters.league}&sort=name&direction=asc&pageSize=100`
      : null,
    { cache: true },
  );
  const sortedLeagues = [...(leagues ?? [])].sort(
    (left, right) =>
      (left.country_name ?? "").localeCompare(right.country_name ?? "") ||
      left.tier - right.tier ||
      left.name.localeCompare(right.name),
  );
  const clubCountries = [
    ...new Map(
      sortedLeagues.map((league) => [league.country_id, league.country_name ?? ""]),
    ),
  ].filter(([id]) => id !== null);
  const leagueOptions = sortedLeagues.filter(
    (league) => !filters.clubCountry || String(league.country_id) === filters.clubCountry,
  );
  const leagueLabel = (league: League) =>
    `${league.name}${league.tier > 0 ? ` (tier ${league.tier})` : " (reserves)"}`;
  const countryName = (id: string) =>
    bootstrap?.countries.find((country) => String(country.id) === id)?.name ?? `#${id}`;
  function selectText(key: string, value: string) {
    if (key === "country" || key === "clubCountry") return countryName(value);
    if (key === "league")
      return leagues?.find((league) => String(league.id) === value)?.name ?? `#${value}`;
    if (key === "club")
      return leagueClubs?.clubs.find((club) => String(club.id) === value)?.name ?? `#${value}`;
    if (key === "injured") return value === "1" ? "Injured" : "Fit";
    if (key === "contractStatus") return value === "amateur" ? "Non-professional" : "Protected";
    if (key === "availability") return AVAILABILITY_LABELS[value] ?? value;
    return ["attribute", "personality", "lifestyle"].includes(key) ? label(value) : value;
  }
  // One chip per select and per range of the search in use, in panel order: "Age 18–21", "Value ≤ £5M".
  const chips: FilterChip[] = FILTER_GROUPS.flatMap(({ id: group }) => [
    ...SELECT_FILTERS.filter((select) => select.group === group && appliedFilters[select.key]).map(
      (select): FilterChip => ({
        key: select.key,
        name: select.label,
        text: `${select.label}: ${selectText(select.key, appliedFilters[select.key])}`,
        group,
        clear: [select.key],
      }),
    ),
    ...RANGE_FILTERS.filter(
      (spec) => spec.group === group && (!spec.requires || appliedFilters[spec.requires]),
    ).flatMap((spec): FilterChip[] => {
      const reading = readRange(
        spec,
        appliedFilters[`${spec.key}Min`],
        appliedFilters[`${spec.key}Max`],
      );
      if (!isActiveRange(reading)) return [];
      const title = spec.requires ? label(appliedFilters[spec.requires]) : spec.label;
      const format = spec.money ? (value: number) => money(value) : String;
      return [
        {
          key: `${spec.key}Range`,
          name: spec.requires ? `${spec.label} level` : spec.label,
          text: `${title} ${rangeText(reading, format, spec.unit)}`,
          group,
          clear: [`${spec.key}Min`, `${spec.key}Max`],
        },
      ];
    }),
  ]);
  const advancedGroups = new Set(
    FILTER_GROUPS.filter((group) => group.advanced).map((group) => group.id),
  );
  const advancedCount = chips.filter((chip) => advancedGroups.has(chip.group)).length;
  function change(transform: (current: Filters) => Filters, typed = false) {
    const nextFilters = transform(filters);
    setFilters(nextFilters);
    const applyFilters = () => setAppliedFilters(nextFilters);
    if (typed) typing.current.schedule(applyFilters);
    else typing.current.now(applyFilters);
  }
  const update = (key: string, value: string) =>
    change((current) => withFilter(current, key, value));
  const typeFilter = (key: string, value: string) =>
    change((current) => ({ ...current, [key]: value }), true);
  const range = (key: PlayerSearchRange, props: Partial<RangeProps> = {}) => {
    const spec = rangeSpec(key);
    const Range = spec.money ? MoneyRangeField : RangeField;
    return (
      <Range
        // A new generation after "Clear all" also drops unreadable amount drafts.
        key={`${key}:${generation}`}
        spec={spec}
        filters={filters}
        applied={appliedFilters}
        onType={typeFilter}
        {...props}
      />
    );
  };
  const select = (
    key: string,
    title: string,
    options: ReactNode,
    props: { wide?: boolean; ariaLabel?: string; disabled?: boolean } = {},
  ) => (
    <Field label={title} className={props.wide ? "wide" : ""} key={key}>
      <select
        aria-label={props.ariaLabel}
        value={filters[key]}
        disabled={props.disabled}
        onChange={(event) => update(key, event.target.value)}
      >
        {options}
      </select>
    </Field>
  );
  const fields: Record<FilterGroupId, ReactNode> = {
    player: [
      select(
        "country",
        "Nationality",
        <>
          <option value="">All countries</option>
          {bootstrap?.countries.map((country) => (
            <option value={country.id} key={country.id}>
              {country.name}
            </option>
          ))}
        </>,
      ),
      select(
        "position",
        "Position",
        <>
          <option value="">All positions</option>
          {POSITIONS.map((position) => <option key={position}>{position}</option>)}
        </>,
        { ariaLabel: "Position filter" },
      ),
      select(
        "ageGroup",
        "Age group",
        <>
          <option value="">All players</option>
          <option>Senior</option>
          <option>U19</option>
          <option>U17</option>
        </>,
      ),
      select(
        "foot",
        "Preferred foot",
        <>
          <option value="">Either foot</option>
          <option>Right</option>
          <option>Left</option>
          <option>Both</option>
        </>,
      ),
      range("age"),
    ],
    ability: [
      range("ability"),
      range("potential"),
      select(
        "injured",
        "Fitness status",
        <>
          <option value="">Any status</option>
          <option value="0">Fit players</option>
          <option value="1">Injured players</option>
        </>,
        { wide: true },
      ),
    ],
    contract: [
      range("value"),
      range("wage"),
      range("contractMonths"),
      select(
        "contractStatus",
        "Contract status",
        <>
          <option value="">All registrations</option>
          <option value="professional">Protected contract</option>
          <option value="amateur">Non-professional registration</option>
        </>,
      ),
      select(
        "availability",
        "Availability",
        <>
          <option value="">Any availability</option>
          {Object.entries(AVAILABILITY_LABELS).map(([value, text]) => (
            <option key={value} value={value}>
              {text}
            </option>
          ))}
        </>,
      ),
    ],
    club: [
      select(
        "clubCountry",
        "Club country",
        <>
          <option value="">All countries</option>
          {clubCountries.map(([id, name]) => (
            <option key={id} value={id!}>
              {name}
            </option>
          ))}
        </>,
        { wide: true },
      ),
      select(
        "league",
        "League",
        <>
          <option value="">All leagues</option>
          {filters.clubCountry
            ? leagueOptions.map((league) => (
                <option key={league.id} value={league.id}>
                  {leagueLabel(league)}
                </option>
              ))
            : clubCountries.map(([id, name]) => (
                <optgroup key={id} label={name}>
                  {leagueOptions
                    .filter((league) => league.country_id === id)
                    .map((league) => (
                      <option key={league.id} value={league.id}>
                        {leagueLabel(league)}
                      </option>
                    ))}
                </optgroup>
              ))}
        </>,
        { wide: true },
      ),
      select(
        "club",
        "Club",
        <>
          <option value="">{filters.league ? "All clubs" : "Choose a league first"}</option>
          {leagueClubs?.clubs.map((club) => (
            <option key={club.id} value={club.id}>
              {club.name}
            </option>
          ))}
        </>,
        { wide: true, disabled: !filters.league },
      ),
      range("tier"),
    ],
    physical: [
      range("height"),
      range("weight"),
      select(
        "attribute",
        "Attribute",
        <>
          <option value="">Any attribute</option>
          {Object.entries(ATTRIBUTE_GROUPS).map(([group, keys]) => (
            <optgroup key={group} label={label(group)}>
              {keys.map((key) => (
                <option key={key} value={key}>
                  {label(key)}
                </option>
              ))}
            </optgroup>
          ))}
        </>,
        { wide: true },
      ),
      range("attribute", {
        title: filters.attribute ? `${label(filters.attribute)} level` : "Attribute level",
        disabled: !filters.attribute,
      }),
    ],
    personality: [
      select(
        "personality",
        "Personality",
        <>
          <option value="">Any personality</option>
          {PERSONALITY_KEYS.map((key) => (
            <option key={key} value={key}>
              {label(key)}
            </option>
          ))}
        </>,
        { wide: true },
      ),
      range("personality", {
        title: filters.personality ? `${label(filters.personality)} level` : "Personality level",
        disabled: !filters.personality,
      }),
      select(
        "lifestyle",
        "Lifestyle",
        <>
          <option value="">All lifestyles</option>
          {LIFESTYLES.map((value) => (
            <option key={value} value={value}>
              {label(value)}
            </option>
          ))}
        </>,
      ),
      select(
        "trait",
        "Player trait",
        <>
          <option value="">Any trait</option>
          {TRAITS.map((value) => (
            <option key={value}>{value}</option>
          ))}
        </>,
      ),
    ],
    performance: [
      range("form"),
      range("appearances"),
      range("minutes"),
      range("goals"),
      range("assists"),
    ],
  };
  const filterGroup = (group: (typeof FILTER_GROUPS)[number]) => (
    <fieldset className="filter-group" key={group.id}>
      <legend>{group.title}</legend>
      <div className="filter-fields">{fields[group.id]}</div>
    </fieldset>
  );
  function reset() {
    change(() => defaultFilters);
    setGeneration((current) => current + 1);
    setSearch("");
    setShortlisted(false);
    setPage(1);
  }
  function download() {
    if (!data) return;
    const blob = new Blob(
      [
        JSON.stringify(
          {
            date: bootstrap?.state.date,
            filters: query,
            total: data.total,
            page: data.page,
            players: data.players.map(
              ({ profile: _profile, ...player }) => player,
            ),
          },
          null,
          2,
        ),
      ],
      { type: "application/json" },
    );
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = `Touchline-player-page-${data.page}.json`;
    link.click();
    URL.revokeObjectURL(link.href);
    notify("Current player page exported.");
  }
  return (
    <div className="page">
      <PageHeading
        eyebrow="GLOBAL INTELLIGENCE"
        title="Player database"
        subtitle={`${compactNumber(bootstrap?.world.players ?? 0)} players`}
      >
        <Button variant="secondary" icon={Download} onClick={download} disabled={!data || loading}>
          Export page
        </Button>
      </PageHeading>
      <Panel className="database-workspace">
        <div className="database-toolbar">
          <div className="search-field">
            <Search size={17} />
            <input
              aria-label="Search players"
              placeholder="Search players, clubs or nationalities..."
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />
          </div>
          <div className="database-sort" role="group" aria-label="Player sorting">
            <select
              aria-label="Sort players"
              value={sort}
              onChange={(event) => {
                const key = event.target.value as DatabaseSortKey;
                setSorting({ key, direction: sortDirection(key) });
              }}
            >
              {SORT_OPTIONS.map(([key, text]) => (
                <option key={key} value={key}>
                  {text}
                </option>
              ))}
            </select>
            <SortDirectionButton
              subject="players"
              direction={direction}
              onToggle={() =>
                setSorting({ key: sort, direction: direction === "desc" ? "asc" : "desc" })
              }
            />
          </div>
          <Button
            icon={SlidersHorizontal}
            variant={advanced ? "primary" : "secondary"}
            className="database-filter-toggle"
            aria-label={`Advanced filters${advancedCount > 0 ? ` (${advancedCount})` : ""}`}
            title="Advanced filters"
            aria-expanded={advanced}
            aria-controls="player-database-filters"
            onClick={() => setAdvanced(!advanced)}
          >
            <span>Advanced filters{advancedCount > 0 ? ` (${advancedCount})` : ""}</span>
          </Button>
          <IconButton
            label={
              shortlisted ? "Show all players" : "Show shortlisted players"
            }
            icon={Bookmark}
            aria-pressed={shortlisted}
            className={shortlisted ? "bookmarked bordered" : "bordered"}
            onClick={() => setShortlisted(!shortlisted)}
          />
        </div>
        {(chips.length > 0 || shortlisted || search) && (
          <div className="active-filter-list" role="group" aria-label="Active player filters">
            {search && (
              <button type="button" className="filter-chip" aria-label={`Remove search: ${search}`} onClick={() => setSearch("")}>
                <span>Search: {search}</span><X size={13} aria-hidden="true" />
              </button>
            )}
            {chips.map((chip) => (
              <button
                key={chip.key}
                type="button"
                className="filter-chip"
                aria-label={`Remove ${chip.name} filter`}
                onClick={() =>
                  change((current) =>
                    chip.clear.reduce((next, key) => withFilter(next, key, ""), current),
                  )
                }
              >
                <span>{chip.text}</span>
                <X size={13} aria-hidden="true" />
              </button>
            ))}
            {shortlisted && (
              <button type="button" className="filter-chip" aria-label="Remove shortlist filter" onClick={() => setShortlisted(false)}>
                <span>Shortlist</span><X size={13} aria-hidden="true" />
              </button>
            )}
            <Button variant="ghost" icon={RotateCcw} onClick={reset}>Clear all filters</Button>
          </div>
        )}
        <div className="database-filter-groups">
          {FILTER_GROUPS.filter((group) => !group.advanced).map(filterGroup)}
        </div>
        <div
          className="database-filter-groups advanced-filter-groups"
          id="player-database-filters"
          hidden={!advanced}
        >
          {FILTER_GROUPS.filter((group) => group.advanced).map(filterGroup)}
        </div>
        <div className="filter-summary" role="status" aria-live="polite">
          <DatabaseIcon size={13} aria-hidden="true" />
          <span className="filter-total">
            {totalText} players
          </span>
          <span>{loading ? "Updating results" : "in your selection"}</span>
        </div>
        <div className={`database-results${loading && data ? " is-stale" : ""}`} aria-busy={loading}>
        {error ? (
          <ErrorState message={error} />
        ) : !data ? (
          <Loading label="Searching the player database" />
        ) : data.players.length ? (
          <PlayerTable
            players={data.players}
            label="Player database results"
            columns={DATABASE_COLUMNS}
            sort={sort === "minutes" ? null : { key: sort, direction }}
            onSortChange={setSorting}
          >
            {(player) => (
              <div className="database-row-actions">
                <EligibilityBadge eligibility={player.eligibility} hideEligible />
                <ShortlistButton player={player} />
              </div>
            )}
          </PlayerTable>
        ) : (
          <Empty
            icon={Search}
            title="No players match this brief"
            detail={
              data.totalCapped
                ? "Skill, lifestyle, trait and contract-status filters check the first 10,000 players in this order. Add a position, age, club or other filter to search further."
                : "Adjust your filters to widen the search."
            }
          >
            <Button icon={X} variant="secondary" onClick={reset}>
              Clear filters
            </Button>
          </Empty>
        )}
        </div>
        {data && (
          <div className="pagination">
            <span>
              {data.total
                ? `${((data.page - 1) * data.pageSize + 1).toLocaleString("en-GB")}-${Math.min(data.page * data.pageSize, data.total).toLocaleString("en-GB")} of ${totalText}`
                : "0 results"}
              {data.totalCapped && data.page >= data.pages && (
                <span className="muted"> / refine the filters to see more</span>
              )}
            </span>
            <div className="pagination-actions">
              <select
                className="page-size"
                aria-label="Players per page"
                value={pageSize}
                onChange={(event) => setPageSize(Number(event.target.value))}
              >
                <option value="30">30 / page</option>
                <option value="50">50 / page</option>
                <option value="100">100 / page</option>
              </select>
              <IconButton
                icon={ChevronLeft}
                label="Previous player page"
                disabled={data.page <= 1 || loading}
                onClick={() => setPage(data.page - 1)}
              />
              <span title={data.totalCapped ? "More players match than are paged; refine the filters" : undefined}>
                {data.page} / {data.pages}
              </span>
              <IconButton
                icon={ChevronRight}
                label="Next player page"
                disabled={data.page >= data.pages || loading}
                onClick={() => setPage(data.page + 1)}
              />
            </div>
          </div>
        )}
      </Panel>
    </div>
  );
}
