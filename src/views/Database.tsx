import { useDeferredValue, useState } from "react";
import {
  ArrowDownWideNarrow,
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
import { useGame, useResource } from "../game-context.tsx";
import {
  Badge,
  Button,
  Empty,
  ErrorState,
  Field,
  IconButton,
  Loading,
  PageHeading,
  Panel,
  PlayerTable,
} from "../ui.tsx";
import {
  ATTRIBUTE_GROUPS,
  label,
  PERSONALITY_KEYS,
  POSITIONS,
} from "../../shared/rules.ts";
import type { PlayerPage } from "../../shared/api.ts";

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

export default function Database() {
  const { bootstrap, search, setSearch, notify } = useGame();
  const [filters, setFilters] = useState<Filters>(defaultFilters);
  const [advanced, setAdvanced] = useState(false);
  const [shortlisted, setShortlisted] = useState(false);
  const [sort, setSort] = useState("ability");
  const [direction, setDirection] = useState("desc");
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
  const { data, loading, error } = useResource<PlayerPage>(`players?${params}`);
  const activeFilters =
    Object.values(filters).filter(Boolean).length + (shortlisted ? 1 : 0);
  function update(key: string, value: string) {
    setFilters((current) => ({ ...current, [key]: value }));
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
        subtitle={`${bootstrap?.world.players.toLocaleString() ?? "160,000"} players. Every career has a story.`}
      >
        <Button variant="secondary" icon={Download} onClick={download}>
          Export page
        </Button>
      </PageHeading>
      <Panel>
        <div className="filter-bar">
          <div className="search-field">
            <Search size={17} />
            <input
              aria-label="Search players"
              placeholder="Search players, clubs or nationalities..."
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />
          </div>
          <select
            aria-label="Position filter"
            value={filters.position}
            onChange={(event) => update("position", event.target.value)}
          >
            <option value="">All positions</option>
            {POSITIONS.map((position) => (
              <option key={position}>{position}</option>
            ))}
          </select>
          <select
            aria-label="Age filter"
            value={filters.ageMax}
            onChange={(event) => update("ageMax", event.target.value)}
          >
            <option value="">Any age</option>
            <option value="17">Under 18</option>
            <option value="20">Under 21</option>
            <option value="23">Under 24</option>
            <option value="29">Under 30</option>
          </select>
          <Button
            icon={SlidersHorizontal}
            variant={advanced ? "primary" : "secondary"}
            onClick={() => setAdvanced(!advanced)}
          >
            Filters{activeFilters > 0 ? ` (${activeFilters})` : ""}
          </Button>
          <IconButton
            label={
              shortlisted ? "Show all players" : "Show shortlisted players"
            }
            icon={Bookmark}
            className={shortlisted ? "bookmarked bordered" : "bordered"}
            onClick={() => setShortlisted(!shortlisted)}
          />
        </div>
        {advanced && (
          <div className="filter-extra">
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
            <Field label="Maximum value (GBP)">
              <input
                type="number"
                min="0"
                step="1000000"
                placeholder="No limit"
                value={filters.valueMax}
                onChange={(event) => update("valueMax", event.target.value)}
              />
            </Field>
            <Field label="Maximum wage / week">
              <input
                type="number"
                min="0"
                step="1000"
                placeholder="No limit"
                value={filters.wageMax}
                onChange={(event) => update("wageMax", event.target.value)}
              />
            </Field>
            <Field label="Preferred foot">
              <select
                value={filters.foot}
                onChange={(event) => update("foot", event.target.value)}
              >
                <option value="">Either foot</option>
                <option>Right</option>
                <option>Left</option>
                <option>Both</option>
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
                type="number"
                min="1"
                max="99"
                value={filters.attributeMin}
                onChange={(event) => update("attributeMin", event.target.value)}
                placeholder="1-99"
              />
            </Field>
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
            <Field label="Height minimum (cm)">
              <input
                type="number"
                min="140"
                max="220"
                placeholder="Any"
                value={filters.heightMin}
                onChange={(event) => update("heightMin", event.target.value)}
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
            <Field label="Availability">
              <select
                value={
                  filters.freeAgent
                    ? "freeAgent"
                    : filters.availableLoan
                      ? "availableLoan"
                      : filters.listed
                        ? "listed"
                        : ""
                }
                onChange={(event) =>
                  setFilters((current) => ({
                    ...current,
                    freeAgent: event.target.value === "freeAgent" ? "1" : "",
                    availableLoan:
                      event.target.value === "availableLoan" ? "1" : "",
                    listed: event.target.value === "listed" ? "1" : "",
                  }))
                }
              >
                <option value="">Any availability</option>
                <option value="listed">Transfer listed</option>
                <option value="availableLoan">Loan listed</option>
                <option value="freeAgent">Free agents</option>
              </select>
            </Field>
          </div>
        )}
        <div className="filter-summary">
          <DatabaseIcon size={13} />
          <span className="filter-total">
            {data?.total.toLocaleString() ?? "..."} players
          </span>
          <span>{loading ? "Updating results" : "in your selection"}</span>
          {shortlisted && <Badge tone="green">Shortlist</Badge>}
          <div className="sort-controls">
            <ArrowDownWideNarrow size={13} />
            <select
              aria-label="Sort players"
              value={sort}
              onChange={(event) => setSort(event.target.value)}
            >
              {[
                "ability",
                "potential",
                "value",
                "age",
                "name",
                "wage",
                "form",
                "goals",
                "minutes",
                "contract_end",
              ].map((key) => (
                <option key={key} value={key}>
                  {key === "contract_end" ? "Contract expiry" : label(key)}
                </option>
              ))}
            </select>
            <button
              className="text-link"
              onClick={() =>
                setDirection(direction === "desc" ? "asc" : "desc")
              }
            >
              {direction === "desc" ? "High to low" : "Low to high"}
            </button>
          </div>
          {(activeFilters > 0 || search) && (
            <IconButton
              icon={RotateCcw}
              label="Clear all filters"
              onClick={reset}
            />
          )}
        </div>
        {error ? (
          <ErrorState message={error} />
        ) : !data ? (
          <Loading label="Searching the player database" />
        ) : data.players.length ? (
          <PlayerTable players={data.players} />
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
                ? `${((data.page - 1) * data.pageSize + 1).toLocaleString()}-${Math.min(data.page * data.pageSize, data.total).toLocaleString()} of ${data.total.toLocaleString()}`
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
