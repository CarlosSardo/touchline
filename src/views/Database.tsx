import { useDeferredValue, useState } from "react";
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
import type { PlayerPage } from "../../shared/api.ts";
import {
  PLAYER_COLUMNS,
  type PlayerSortKey,
  type SortDirection,
  type SortState,
} from "../sort.ts";

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

type Filters = Record<string, string>;
const defaultFilters: Filters = {
  position: "",
  ageMax: "",
  ageMin: "",
  country: "",
  abilityMin: "",
  potentialMin: "",
  valueMax: "",
  wageMax: "",
  foot: "",
  ageGroup: "",
  contractStatus: "",
  attribute: "",
  attributeMin: "",
  personality: "",
  personalityMin: "",
  lifestyle: "",
  trait: "",
  listed: "",
  availableLoan: "",
  contractMonths: "",
  formMin: "",
  heightMin: "",
  heightMax: "",
  goalsMin: "",
  minutesMin: "",
  injured: "",
  freeAgent: "",
};

const filterLabels: Record<string, string> = {
  position: "Position",
  ageMax: "Maximum age",
  ageMin: "Minimum age",
  country: "Nationality",
  abilityMin: "Minimum ability",
  potentialMin: "Minimum potential",
  valueMax: "Maximum value",
  wageMax: "Maximum weekly wage",
  foot: "Preferred foot",
  ageGroup: "Age group",
  contractStatus: "Contract status",
  attribute: "Attribute",
  attributeMin: "Attribute minimum",
  personality: "Personality",
  personalityMin: "Personality minimum",
  lifestyle: "Lifestyle",
  trait: "Trait",
  listed: "Transfer listed",
  availableLoan: "Loan listed",
  contractMonths: "Expiry within",
  formMin: "Minimum match rating",
  heightMin: "Minimum height",
  heightMax: "Maximum height",
  goalsMin: "Minimum goals",
  minutesMin: "Minimum minutes",
  injured: "Fitness",
  freeAgent: "Free agents & home-based",
};

function MoneyFilter({
  title,
  value,
  onChange,
}: {
  title: string;
  value: string;
  onChange: (value: string) => void;
}) {
  const { currency, displayAmount, accountingAmount } = useCurrency();
  const [draft, setDraft] = useState<{
    base: string;
    currency: string;
    text: string;
  } | null>(null);
  const text =
    draft?.base === value && draft.currency === currency
      ? draft.text
      : value === ""
        ? ""
        : displayAmount(Number(value));
  return (
    <Field label={`${title} (${currency})`}>
      <span className="money-input">
        <input
          type="number"
          min="0"
          step="any"
          placeholder="No limit"
          value={text}
          onChange={(event) => {
            const nextText = event.target.value;
            if (nextText !== "" && !Number.isFinite(Number(nextText))) return;
            const base =
              nextText === ""
                ? ""
                : String(accountingAmount(Number(nextText)));
            setDraft({ base, currency, text: nextText });
            onChange(base);
          }}
          onBlur={() => setDraft(null)}
        />
        <span aria-hidden="true">{currency}</span>
      </span>
    </Field>
  );
}

export default function Database() {
  const { bootstrap, search, setSearch, notify } = useGame();
  const { money } = useCurrency();
  const [filters, setFilters] = useState<Filters>(defaultFilters);
  const [advanced, setAdvanced] = useState(false);
  const [shortlisted, setShortlisted] = useState(false);
  const [sorting, setSorting] = useState<SortState<DatabaseSortKey>>({
    key: "ability",
    direction: "desc",
  });
  const { key: sort, direction } = sorting;
  const [pagination, setPagination] = useState({ key: "", page: 1 });
  const [pageSize, setPageSize] = useState(30);
  const deferredSearch = useDeferredValue(search);
  const deferredFilters = useDeferredValue(filters);
  const filterKey = JSON.stringify([
    deferredSearch,
    deferredFilters,
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
  for (const [key, value] of Object.entries(deferredFilters))
    if (value !== "") params.set(key, value);
  if (shortlisted) params.set("shortlisted", "1");
  const { data, loading, error } = useResource<PlayerPage>(`players?${params}`, {
    keepPreviousData: true,
  });
  const activeFilters =
    Object.values(filters).filter(Boolean).length + (shortlisted ? 1 : 0);
  const advancedCount = [
    "attribute", "attributeMin", "personality", "personalityMin", "lifestyle",
    "trait", "formMin", "minutesMin", "goalsMin", "heightMin", "foot",
  ].filter((key) => filters[key] !== "").length;
  function filterValue(key: string, value: string) {
    if (key === "country")
      return bootstrap?.countries.find((country) => String(country.id) === value)?.name ?? value;
    if (key === "valueMax" || key === "wageMax") return money(Number(value), true);
    if (key === "injured") return value === "1" ? "Injured" : "Fit";
    if (key === "contractMonths") return `${value} months`;
    if (key === "heightMin" || key === "heightMax") return `${value} cm`;
    if (key === "contractStatus")
      return value === "amateur" ? "Non-professional" : "Protected";
    if (["listed", "availableLoan", "freeAgent"].includes(key)) return "";
    return ["attribute", "personality", "lifestyle"].includes(key) ? label(value) : value;
  }
  function update(key: string, value: string) {
    setFilters((current) => ({
      ...current,
      [key]: value,
      ...(key === "attribute" && !value ? { attributeMin: "" } : {}),
      ...(key === "personality" && !value ? { personalityMin: "" } : {}),
    }));
  }
  function reset() {
    setFilters(defaultFilters);
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
            filters,
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
        {(activeFilters > 0 || search) && (
          <div className="active-filter-list" role="group" aria-label="Active player filters">
            {search && (
              <button type="button" className="filter-chip" aria-label={`Remove search: ${search}`} onClick={() => setSearch("")}>
                <span>Search: {search}</span><X size={13} aria-hidden="true" />
              </button>
            )}
            {Object.entries(filters).filter(([, value]) => value !== "").map(([key, value]) => (
              <button
                key={key}
                type="button"
                className="filter-chip"
                aria-label={`Remove ${filterLabels[key]}`}
                onClick={() => setFilters((current) => ({
                  ...current,
                  [key]: "",
                  ...(key === "attribute" ? { attributeMin: "" } : {}),
                  ...(key === "personality" ? { personalityMin: "" } : {}),
                }))}
              >
                <span>{filterLabels[key]}{filterValue(key, value) ? `: ${filterValue(key, value)}` : ""}</span>
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
          <fieldset className="filter-group">
            <legend>Identity & location</legend>
            <div className="filter-fields">
            <Field label="Nationality">
              <select
                value={filters.country}
                onChange={(event) => update("country", event.target.value)}
              >
                <option value="">All countries</option>
                {bootstrap?.countries.map((country) => (
                  <option value={country.id} key={country.id}>
                    {country.name}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Age group">
              <select
                value={filters.ageGroup}
                onChange={(event) => update("ageGroup", event.target.value)}
              >
                <option value="">All players</option>
                <option>Senior</option>
                <option>U19</option>
                <option>U17</option>
              </select>
            </Field>
            <Field label="Age">
              <select aria-label="Age filter" value={filters.ageMax} onChange={(event) => update("ageMax", event.target.value)}>
                <option value="">Any age</option>
                <option value="17">Under 18</option>
                <option value="20">Under 21</option>
                <option value="23">Under 24</option>
                <option value="29">Under 30</option>
              </select>
            </Field>
            </div>
          </fieldset>
          <fieldset className="filter-group">
            <legend>Position & ability</legend>
            <div className="filter-fields">
            <Field label="Position">
              <select aria-label="Position filter" value={filters.position} onChange={(event) => update("position", event.target.value)}>
                <option value="">All positions</option>
                {POSITIONS.map((position) => <option key={position}>{position}</option>)}
              </select>
            </Field>
            <Field label="Minimum ability">
              <input
                type="number"
                min="1"
                max="99"
                placeholder="1-99"
                value={filters.abilityMin}
                onChange={(event) => update("abilityMin", event.target.value)}
              />
            </Field>
            <Field label="Minimum potential">
              <input
                type="number"
                min="1"
                max="99"
                placeholder="1-99"
                value={filters.potentialMin}
                onChange={(event) => update("potentialMin", event.target.value)}
              />
            </Field>
            <Field label="Fitness status">
              <select
                value={filters.injured}
                onChange={(event) => update("injured", event.target.value)}
              >
                <option value="">Any status</option>
                <option value="0">Fit players</option>
                <option value="1">Injured players</option>
              </select>
            </Field>
            </div>
          </fieldset>
          <fieldset className="filter-group">
            <legend>Contract & availability</legend>
            <div className="filter-fields">
            <MoneyFilter title="Maximum value" value={filters.valueMax} onChange={(value) => update("valueMax", value)} />
            <MoneyFilter title="Maximum wage / week" value={filters.wageMax} onChange={(value) => update("wageMax", value)} />
            <Field label="Contract status">
              <select
                value={filters.contractStatus}
                onChange={(event) =>
                  update("contractStatus", event.target.value)
                }
              >
                <option value="">All registrations</option>
                <option value="professional">Protected contract</option>
                <option value="amateur">Non-professional registration</option>
              </select>
            </Field>
            <Field label="Expiring within">
              <select
                value={filters.contractMonths}
                onChange={(event) =>
                  update("contractMonths", event.target.value)
                }
              >
                <option value="">Any contract</option>
                <option value="6">6 months</option>
                <option value="12">12 months</option>
                <option value="24">24 months</option>
              </select>
            </Field>
            <Field label="Availability">
              <select
                value={filters.freeAgent ? "freeAgent" : filters.availableLoan ? "availableLoan" : filters.listed ? "listed" : ""}
                onChange={(event) => setFilters((current) => ({
                  ...current,
                  freeAgent: event.target.value === "freeAgent" ? "1" : "",
                  availableLoan: event.target.value === "availableLoan" ? "1" : "",
                  listed: event.target.value === "listed" ? "1" : "",
                }))}
              >
                <option value="">Any availability</option>
                <option value="listed">Transfer listed</option>
                <option value="availableLoan">Loan listed</option>
                <option value="freeAgent">Free agents & home-based</option>
              </select>
            </Field>
            </div>
          </fieldset>
        </div>
          <div className="database-filter-groups advanced-filter-groups" id="player-database-filters" hidden={!advanced}>
          <fieldset className="filter-group">
            <legend>Attributes & physical profile</legend>
            <div className="filter-fields">
            <Field label="Attribute">
              <select
                value={filters.attribute}
                onChange={(event) => update("attribute", event.target.value)}
              >
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
              </select>
            </Field>
            <Field label="Attribute minimum">
              <input
                aria-label="Attribute minimum"
                disabled={!filters.attribute}
                type="number"
                min="1"
                max="99"
                value={filters.attributeMin}
                onChange={(event) => update("attributeMin", event.target.value)}
                placeholder="1-99"
              />
            </Field>
            <Field label="Preferred foot">
              <select value={filters.foot} onChange={(event) => update("foot", event.target.value)}>
                <option value="">Either foot</option>
                <option>Right</option>
                <option>Left</option>
                <option>Both</option>
              </select>
            </Field>
            <Field label="Height minimum (cm)">
              <input type="number" min="140" max="220" placeholder="Any" value={filters.heightMin} onChange={(event) => update("heightMin", event.target.value)} />
            </Field>
            </div>
          </fieldset>
          <fieldset className="filter-group">
            <legend>Personality & traits</legend>
            <div className="filter-fields">
            <Field label="Personality">
              <select
                value={filters.personality}
                onChange={(event) => update("personality", event.target.value)}
              >
                <option value="">Any personality</option>
                {PERSONALITY_KEYS.map((key) => (
                  <option key={key} value={key}>
                    {label(key)}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Personality minimum">
              <input
                disabled={!filters.personality}
                type="number"
                min="1"
                max="99"
                value={filters.personalityMin}
                onChange={(event) =>
                  update("personalityMin", event.target.value)
                }
                placeholder="1-99"
              />
            </Field>
            <Field label="Lifestyle">
              <select
                value={filters.lifestyle}
                onChange={(event) => update("lifestyle", event.target.value)}
              >
                <option value="">All lifestyles</option>
                {[
                  "disciplined",
                  "nightlife",
                  "family-focused",
                  "luxury-obsessed",
                  "gym-rat",
                ].map((value) => (
                  <option key={value} value={value}>
                    {label(value)}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Player trait">
              <select
                value={filters.trait}
                onChange={(event) => update("trait", event.target.value)}
              >
                <option value="">Any trait</option>
                {[
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
                ].map((value) => (
                  <option key={value}>{value}</option>
                ))}
              </select>
            </Field>
            </div>
          </fieldset>
          <fieldset className="filter-group">
            <legend>Match performance</legend>
            <div className="filter-fields">
            <Field label="Minimum match rating">
              <input
                type="number"
                min="0"
                max="10"
                step=".1"
                placeholder="0-10"
                value={filters.formMin}
                onChange={(event) => update("formMin", event.target.value)}
              />
            </Field>
            <Field label="Minimum minutes">
              <input
                type="number"
                min="0"
                step="90"
                placeholder="Any"
                value={filters.minutesMin}
                onChange={(event) => update("minutesMin", event.target.value)}
              />
            </Field>
            <Field label="Minimum goals">
              <input
                type="number"
                min="0"
                placeholder="Any"
                value={filters.goalsMin}
                onChange={(event) => update("goalsMin", event.target.value)}
              />
            </Field>
            </div>
          </fieldset>
          </div>
        <div className="filter-summary" role="status" aria-live="polite">
          <DatabaseIcon size={13} aria-hidden="true" />
          <span className="filter-total">
            {data ? compactNumber(data.total) : "..."} players
          </span>
          <span>{loading ? "Updating results" : "in your selection"}</span>
        </div>
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
          />
        ) : (
          <Empty
            icon={Search}
            title="No players match this brief"
            detail="Adjust your filters to widen the search."
          >
            <Button icon={X} variant="secondary" onClick={reset}>
              Clear filters
            </Button>
          </Empty>
        )}
        {data && (
          <div className="pagination">
            <span>
              {data.total
                ? `${((data.page - 1) * data.pageSize + 1).toLocaleString()}-${Math.min(data.page * data.pageSize, data.total).toLocaleString()} of ${compactNumber(data.total)}`
                : "0 results"}
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
              <span>
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
