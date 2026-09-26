// World generation (world version 4): the curated catalog becomes countries, leagues, clubs, squads, staff and meta.
import seedrandom from "seedrandom";
import type { Store } from "./db.ts";
import { ensureClubSupport } from "./club-support.ts";
import { initialClubFinances } from "./finance.ts";
import { seedAssociationCoefficients } from "./qualification.ts";
import {
  amateurAllowance,
  birthDateForAge,
  createPlayer,
  insertPlayers,
  nationPlaces,
  peopleContext,
  personName as cultureName,
  professionalBaseWage,
  professionalWage,
  weightedIndex,
  type PeopleContext,
  type Place,
  type PlayerRow,
  type PlayerSpec,
  type Rng,
} from "./people.ts";
import {
  CATALOG_VERSION,
  assertValidCatalog,
  clubKey,
  clubNameKey,
  hasOwnLeague,
  hostedClubKey,
  isClubNation,
  leagueKey,
  looseClubNameKey,
  reserveClubKey,
  reserveLeagueKey,
  tierMatchdays,
  worldCatalog,
  youthLeagueKey,
  type CatalogLookup,
  type CitySpec,
  type ClubNamingSpec,
  type CrossBorderSpec,
  type LeagueStatus,
  type LeagueTierSpec,
  type NationSpec,
  type ReservePolicySpec,
  type TierBoundarySpec,
  type TierClubModel,
} from "../shared/world-catalog/index.ts";
import {
  SQUAD_MINIMUMS,
  WORLD_VERSION,
  youthGroups,
} from "../shared/world-rules.ts";
import {
  ASSISTANT_ROLE,
  DEFAULT_SETTINGS,
  STAFF_ROLES,
  START_DATE,
  clamp,
} from "../shared/rules.ts";
import type {
  Country,
  GameState,
  PlayerProfile,
  Position,
} from "../shared/types.ts";

export interface WorldOptions {
  seed?: string;
  /** Subset for tests/tools; hosted clubs of excluded home nations become local clubs. */
  nations?: string[];
  /** "minimum" = exact minimums (tests). */
  squads?: "full" | "minimum";
  /** Leagues, clubs, national teams; no players/staff (calendar tests). */
  structureOnly?: boolean;
  /** @deprecated Phase 1 shim: first N club nations in catalog order. */
  countryLimit?: number;
  /** @deprecated ignored */
  seniors?: number;
  /** @deprecated ignored */
  youth?: number;
  /** @deprecated ignored */
  expanded?: boolean;
}

type Row = Record<string, string | number | null>;
const DEFAULT_SEED = "touchline-2026";
const STRUCTURE_TABLES = [
  "countries",
  "leagues",
  "clubs",
  "standings",
  "training_plans",
  "set_pieces",
] as const;
const TIEBREAKERS = ["points", "goal difference", "goals scored", "head-to-head"];
const STYLES = ["Possession", "High press", "Counter attack", "Direct", "Balanced"];
const PALETTE = [
  "#087f6d",
  "#d44e4b",
  "#3465a4",
  "#a45d86",
  "#df9a2b",
  "#3d4855",
  "#27a0a2",
  "#af3e52",
];
// Squad order: the first 11 form the base shape, 25 carry three goalkeepers, 40 is the largest catalog squad.
const ROSTER: Position[] = [
  "GK", "CB", "CB", "LB", "RB", "DM", "CM", "AM", "LW", "RW", "ST",
  "GK", "CB", "CM", "ST", "LB", "RB", "DM", "LW", "RW", "CM", "CB", "ST", "AM", "GK",
  "CB", "CM", "DM", "ST", "AM", "LW", "RW", "LB", "RB", "CB", "CM", "ST", "DM", "AM", "GK",
];
const STARTING_SHAPE = ROSTER.slice(0, 11);
const SENIOR_AGES = Array.from({ length: 17 }, (_, index) => 19 + index);
const SENIOR_AGE_WEIGHTS = [3, 5, 6, 7, 8, 8.5, 8.5, 8.5, 8, 7.5, 6.5, 5.5, 4.5, 3.3, 2.3, 1.4, 0.7];
const CITY_CAPACITY: Record<CitySpec["size"], number> = {
  mega: 6,
  large: 3,
  medium: 2,
  small: 1,
  town: 1,
};
// Chance weight of one club place in a city by size; raised to 1 + 3·prestige² so giants almost never come from towns.
const CITY_WEIGHT: Record<CitySpec["size"], number> = {
  mega: 1,
  large: 0.8,
  medium: 0.35,
  small: 0.12,
  town: 0.04,
};
const STADIUM_FORMS: Record<string, string[]> = {
  en: ["{city} Park", "{city} Stadium", "{city} Arena", "{city} Ground"],
  es: ["Estadio de {city}", "Estadio Municipal de {city}", "Campo Municipal de {city}"],
  pt: ["Estádio de {city}", "Estádio Municipal de {city}"],
  fr: ["Stade de {city}", "Stade Municipal de {city}"],
  it: ["Stadio {city}", "Stadio Comunale di {city}"],
  de: ["Stadion {city}", "{city} Arena", "Sportpark {city}"],
  nl: ["Stadion {city}", "Sportpark {city}"],
  tr: ["{city} Stadyumu"],
};

const integer = (random: Rng, min: number, max: number) =>
  Math.floor(random() * (max - min + 1)) + min;
const pick = <Value>(random: Rng, values: readonly Value[]) =>
  values[Math.floor(random() * values.length)];
const lerp = (from: number, to: number, share: number) => from + (to - from) * share;
const geometric = (from: number, to: number, share: number) =>
  Math.exp(lerp(Math.log(Math.max(1, from)), Math.log(Math.max(1, to)), share));
const ascii = (value: string) => value.normalize("NFKD").replace(/\p{M}/gu, "");
const pad = (value: number) => String(value).padStart(2, "0");
const listed = (items: string[]) =>
  items.length <= 1
    ? (items[0] ?? "")
    : `${items.slice(0, -1).join(", ")} and ${items.at(-1)}`;
function gaussian(random: Rng) {
  const first = Math.max(Number.EPSILON, random());
  return Math.sqrt(-2 * Math.log(first)) * Math.cos(2 * Math.PI * random());
}
function stochasticRound(value: number, random: Rng) {
  const floor = Math.floor(value);
  return floor + (random() < value - floor ? 1 : 0);
}
function shuffle<Value>(random: Rng, values: Value[]) {
  for (let index = values.length - 1; index > 0; index--) {
    const other = Math.floor(random() * (index + 1));
    [values[index], values[other]] = [values[other], values[index]];
  }
  return values;
}
/** Integer split of `total` proportional to weights (largest remainder). */
function apportion(total: number, weights: readonly number[]): number[] {
  const sum = weights.reduce((acc, weight) => acc + weight, 0);
  if (!sum || total <= 0) return weights.map(() => 0);
  const exact = weights.map((weight) => (total * weight) / sum);
  const counts = exact.map(Math.floor);
  let left = total - counts.reduce((acc, count) => acc + count, 0);
  const order = exact
    .map((value, index) => ({ index, rest: value - Math.floor(value) }))
    .sort((first, second) => second.rest - first.rest || first.index - second.index);
  for (const { index } of order) {
    if (left <= 0) break;
    counts[index]++;
    left--;
  }
  return counts;
}

// ------------------------------------------------------------------ plan

export interface PlanClub {
  id: number;
  /** club.data.worldKey (stable across seeds). */
  key: string;
  /** Club nation (clubs.country_id). */
  code: string;
  /** Nation whose pyramid and foreign-player market the club belongs to (host for cross-border clubs). */
  market: string;
  type: "club" | "bteam";
  /** Tier the club plays in (host tier for cross-border clubs, 0 in reserve leagues). */
  tier: number;
  model: TierClubModel;
  status: LeagueStatus;
  leagueReputation: number;
  row: Row;
  parent?: PlanClub;
  hosted?: CrossBorderSpec;
  reserves?: ReservePolicySpec;
  region: string;
  lat?: number;
  lng?: number;
}

export interface WorldPlan {
  seed: string;
  lookup: CatalogLookup;
  squads: "full" | "minimum";
  nations: NationSpec[];
  countries: Country[];
  /** Non-national clubs in id order. */
  clubs: PlanClub[];
  rows: Record<(typeof STRUCTURE_TABLES)[number], Row[]>;
  counts: {
    firstTeams: number;
    bTeams: number;
    hostedClubs: number;
    nationalTeams: number;
    seniorLeagues: number;
    reserveLeagues: number;
    youthLeagues: number;
  };
}

/** EN first, then nations with own leagues by league reputation, then the others by national-team reputation. */
export function orderNations(nations: readonly NationSpec[]): NationSpec[] {
  const rank = (nation: NationSpec) =>
    nation.code === "EN" ? 0 : hasOwnLeague(nation) ? 1 : 2;
  return [...nations].sort(
    (left, right) =>
      rank(left) - rank(right) ||
      (rank(left) === 1
        ? right.reputation.league - left.reputation.league
        : right.reputation.national - left.reputation.national) ||
      left.name.localeCompare(right.name),
  );
}

function worldNations(options: WorldOptions, lookup: CatalogLookup) {
  if (options.nations?.length) return [...new Set(options.nations)];
  if (options.countryLimit)
    return orderNations(lookup.allNations())
      .filter(isClubNation)
      .slice(0, options.countryLimit)
      .map((nation) => nation.code);
  return undefined;
}

interface CityState {
  spec: CitySpec;
  place: Place;
  capacity: number;
  /** Clubs counted against maxClubs, including reserved cross-border clubs not created yet. */
  used: number;
  reserved: number;
  created: number;
  districts: string[];
}
interface NationState {
  nation: NationSpec;
  random: Rng;
  cities: CityState[];
  extra: Place[];
  extraIndex: number;
  /** clubNameKey()s already used in this nation. */
  names: Set<string>;
  /** clubNameKey()s of real clubs (catalog avoid lists). */
  avoid: ReadonlySet<string>;
  /** looseClubNameKey()s of the avoided names, so near-copies (AC Milano, Stade Reims) are refused too. */
  avoidLoose: ReadonlySet<string>;
}

/**
 * maxClubs counts the whole pyramid: cities are drawn with weight place^(1 + 3·prestige²) × remaining^0.75, so a
 * nation's giants sit in its big cities while a metropolis still spreads its clubs across tiers.
 * `prestige` is the club's reputation position within the nation (0 bottom tier, 1 strongest giant).
 */
function chooseCity(
  state: NationState,
  fixed?: string,
  prestige = 0.5,
): { place: Place; token: string; city?: CityState } {
  let city = fixed
    ? state.cities.find((entry) => entry.place.name === fixed)
    : undefined;
  if (!city && !fixed) {
    const exponent = 1 + 3 * prestige ** 2;
    const weights = state.cities.map((entry) =>
      entry.used >= entry.capacity
        ? 0
        : CITY_WEIGHT[entry.spec.size] ** exponent * (entry.capacity - entry.used) ** 0.75,
    );
    const roll = state.random();
    if (weights.some((weight) => weight > 0)) city = state.cities[weightedIndex(weights, roll)];
    if (!city && state.extraIndex < state.extra.length) {
      const place = state.extra[state.extraIndex++];
      return { place, token: place.name };
    }
    city ??= [...state.cities].sort(
      (left, right) => left.used / left.capacity - right.used / right.capacity,
    )[0];
  }
  if (!city) {
    const name = fixed ?? state.nation.capital;
    return { place: { name, region: state.nation.capital, size: "large" }, token: name };
  }
  // The first club created in a city carries its name; a reserved cross-border club keeps that right.
  const claimsReservation = Boolean(fixed) && city.reserved > 0;
  const extraClub = city.created > 0 || (!claimsReservation && city.reserved > 0);
  if (claimsReservation) city.reserved--;
  else city.used++;
  city.created++;
  return {
    place: city.place,
    token: (extraClub && city.districts.shift()) || city.place.name,
    city,
  };
}

function renderName(pattern: string, tokens: Record<string, string>) {
  return pattern
    .replace(/\{([a-zA-Z0-9]+)\}/g, (_, token: string) => tokens[token] ?? "")
    .replace(/\s+/g, " ")
    .trim();
}

/** Unique per nation, never a real club name: weighted templates, every template, the city's districts, then a year suffix. */
function uniqueClubName(
  state: NationState,
  naming: ClubNamingSpec,
  tier: number,
  region: string,
  token: string,
  founded: number,
  city?: CityState,
): { name: string; token: string } {
  const regional = naming.regional?.find((rule) => rule.regions.includes(region));
  const demonym = city?.spec.demonym;
  // The adjective belongs to the city name; district clubs (Kispest, Újpest) use their own name.
  const adjective = city && token === city.place.name ? city.spec.adjective : undefined;
  const pool = (regional?.templates ?? naming.templates).filter(
    (template) =>
      (demonym || !template.pattern.includes("{demonym}")) &&
      (adjective || !template.pattern.includes("{cityAdj}")),
  );
  const eligible = pool.filter((template) => !template.tiers || template.tiers.includes(tier));
  const templates = eligible.length ? eligible : pool;
  const tokensFor = (place: string) => ({
    city: place,
    region,
    demonym: demonym ?? "",
    cityAdj: adjective ?? "",
    // Districts and unlisted towns take the plain "de".
    of: (city && place === city.place.name && city.spec.preposition) || "de",
    founded: String(founded),
    founded2: String(founded).slice(-2),
  });
  const tokens = tokensFor(token);
  const taken = (name: string) => {
    const key = clubNameKey(name);
    return !key || state.names.has(key) || state.avoid.has(key) || state.avoidLoose.has(looseClubNameKey(key));
  };
  const accept = (name: string, used = token) => {
    state.names.add(clubNameKey(name));
    return { name, token: used };
  };
  const weights = templates.map((template) => template.weight);
  for (let attempt = 0; attempt < templates.length * 3; attempt++) {
    const name = renderName(templates[weightedIndex(weights, state.random())].pattern, tokens);
    if (name && !taken(name)) return accept(name);
  }
  for (const template of templates) {
    const name = renderName(template.pattern, tokens);
    if (name && !taken(name)) return accept(name);
  }
  while (city?.districts.length) {
    const district = city.districts.shift()!;
    for (const template of templates) {
      if (template.pattern.includes("{cityAdj}")) continue;
      const name = renderName(template.pattern, tokensFor(district));
      if (name && !taken(name)) return accept(name, district);
    }
  }
  const base = renderName(templates[0]?.pattern ?? "{city}", tokens) || token;
  for (const suffix of [tokens.founded, tokens.founded2])
    if (!taken(`${base} ${suffix}`)) return accept(`${base} ${suffix}`);
  let counter = 2;
  while (taken(`${base} ${counter}`)) counter++;
  return accept(`${base} ${counter}`);
}

function shortName(style: ClubNamingSpec["shortName"], name: string, token: string) {
  if (style === "initials") {
    const initials = ascii(name)
      .split(/[\s-]+/)
      .filter((word) => /^[A-Z0-9]/.test(word))
      .map((word) => word[0])
      .join("");
    if (initials.length >= 2) return initials.slice(0, 4).toUpperCase();
  }
  return ascii(token).replace(/[^A-Za-z]/g, "").slice(0, 3).toUpperCase() || "CLB";
}

function foundedYear(naming: ClubNamingSpec, tier: number, tiers: number, random: Rng) {
  const share = tiers > 1 ? (tier - 1) / (tiers - 1) : 0;
  const earliest = Math.round(lerp(naming.founded.top[0], naming.founded.bottom[0], share));
  const latest = Math.round(lerp(naming.founded.top[1], naming.founded.bottom[1], share));
  return integer(random, earliest, Math.max(earliest, latest));
}

/** Reputations of a tier's first teams, strongest first: giants, then top..bottom, ±2 jitter. */
function tierReputations(model: TierClubModel, count: number, random: Rng) {
  const giants = Math.min(model.giants?.count ?? 0, count);
  const rest = count - giants;
  const values: number[] = [];
  for (let index = 0; index < giants; index++)
    values.push(lerp(model.giants!.top, model.giants!.bottom, giants > 1 ? index / (giants - 1) : 0));
  for (let index = 0; index < rest; index++)
    values.push(lerp(model.reputation.top, model.reputation.bottom, rest > 1 ? index / (rest - 1) : 0));
  return values
    .map((value) => Math.round(clamp(value + random() * 4 - 2, 1, 99)))
    .sort((left, right) => right - left);
}

/** Position of a reputation within the tier's spans (0 weakest, 1 strongest). */
function spanShare(model: TierClubModel, reputation: number) {
  const top = model.giants?.top ?? model.reputation.top;
  const bottom = model.reputation.bottom;
  return top > bottom ? clamp((reputation - bottom) / (top - bottom), 0, 1) : 1;
}

function clubEconomy(
  model: TierClubModel,
  tier: Pick<LeagueTierSpec, "tier" | "reputation" | "size" | "roundRobins" | "conferences" | "split">,
  reputation: number,
  random: Rng,
  options: { share?: number; players?: number } = {},
) {
  const share = options.share ?? spanShare(model, reputation);
  const academy = Math.round(clamp(lerp(model.academy.bottom, model.academy.top, share) + integer(random, -6, 6), 1, 99));
  const facilities = Math.round(clamp(lerp(model.facilities.bottom, model.facilities.top, share) + integer(random, -5, 5), 1, 99));
  const capacity = Math.round(geometric(model.capacity.bottom, model.capacity.top, share) * (0.9 + random() * 0.2));
  const wageBill = geometric(model.wageBill.bottom, model.wageBill.top, share) * (0.9 + random() * 0.2);
  const transfer = model.transferBudget.top > 0
    ? geometric(model.transferBudget.bottom + 1, model.transferBudget.top + 1, share) - 1
    : 0;
  const transferBudget = Math.max(0, Math.round((transfer * (0.85 + random() * 0.3)) / 1000) * 1000);
  const finances = initialClubFinances({
    reputation,
    leagueReputation: tier.reputation,
    tier: Math.max(1, tier.tier),
    capacity,
    fanMood: 72,
    homeMatches: Math.round(tierMatchdays(tier) / 2) + 2,
  });
  // Even amateur clubs can pay every registered player's expense allowance (payroll ≤ wage budget).
  const players = options.players ?? (model.squadSize?.[1] ?? 30) + 48;
  const allowances = Math.ceil((players * amateurAllowance(academy)) / 0.88);
  return {
    academy,
    facilities,
    capacity,
    wage_budget: Math.max(Math.round(wageBill / 52), allowances),
    transfer_budget: transferBudget,
    balance: Math.max(finances.balance, Math.round(1.25 * transferBudget)),
  };
}

const boundaryMoves = (boundary: TierBoundarySpec | undefined, direction: "up" | "down") =>
  !boundary
    ? 0
    : (direction === "up" ? boundary.promoted : boundary.relegated) +
      (boundary.playoffs ?? [])
        .filter((playoff) => playoff.type === (direction === "up" ? "promotion" : "relegation"))
        .reduce((total, playoff) => total + ("places" in playoff ? playoff.places : 0), 0);

/** Section 4 snapshot: read by calendar, qualification and simulation; never re-derived mid-career. */
function leagueSnapshot(nation: NationSpec, tier: LeagueTierSpec) {
  const football = nation.football!;
  const up = football.movement.find((boundary) => boundary.upper === tier.tier - 1);
  const down = football.movement.find((boundary) => boundary.upper === tier.tier);
  const pyramid = football.reserves.mode === "pyramid" ? football.reserves.pyramid : undefined;
  return {
    worldVersion: WORLD_VERSION,
    catalogKey: leagueKey(nation.code, tier.tier),
    shortName: tier.shortName,
    status: tier.status,
    roundRobins: tier.roundRobins ?? 2,
    ...(tier.conferences?.length ? { conferences: tier.conferences } : {}),
    ...(tier.conferences?.length && tier.interConference ? { interConference: tier.interConference } : {}),
    ...(tier.split ? { split: tier.split } : {}),
    ...(tier.championship ? { championship: tier.championship } : {}),
    closed: Boolean(tier.closed),
    promotion: boundaryMoves(up, "up"),
    relegation: boundaryMoves(down, "down"),
    movementUp: up ?? null,
    movementDown: down ?? null,
    bTeamsAllowed: Boolean(pyramid && tier.tier >= pyramid.highestTier),
    targetFirstTeams: tier.size - (tier.bTeams ?? 0),
    continental: tier.tier === 1 ? 4 : 0,
    tiebreakers: TIEBREAKERS,
  };
}

function leagueFormat(
  tier: Pick<LeagueTierSpec, "roundRobins" | "conferences" | "interConference" | "split" | "championship" | "closed">,
) {
  const base = ["Single", "Double", "Triple", "Quadruple"][(tier.roundRobins ?? 2) - 1] + " round-robin";
  const parts = [tier.conferences?.length ? `${base} in ${tier.conferences.length} conferences` : base];
  if (tier.conferences?.length && tier.interConference)
    parts.push(`plus ${tier.interConference} inter-conference matches`);
  if (tier.split) parts.push(`then split into ${listed(tier.split.groups.map((group) => group.name))}`);
  if (tier.championship)
    parts.push(`title play-offs for places ${tier.championship.positions[0]}-${tier.championship.positions[1]}`);
  if (tier.closed) parts.push("closed league");
  return parts.join(", ");
}

const NORTH = /north|norte|nord|norr|pohjoi|sever|kuzey|észak/i;
const SOUTH = /south|\bsur\b|\bsul\b|süd|\bsud|söder|södra|syd|etelä|\bjug|güney|dél\b/i;
const CENTRAL = /central|centre|centro|middle|mitte|midlands|kesk/i;
const WEST = /west|oeste|ouest|väst|vest|länsi|zapad|batı|nyugat/i;
const EAST = /east|\beste\b|leste|\best\b|öst|\bost|itä|istok|doğu|kelet|orient/i;
/** Compass sense of a group name: north 1 / central 0 / south -1 and east 1 / west -1; null when absent. */
function compass(name: string): { ns: number | null; ew: number | null } {
  return {
    ns: NORTH.test(name) ? 1 : SOUTH.test(name) ? -1 : CENTRAL.test(name) ? 0 : null,
    ew: WEST.test(name) ? -1 : EAST.test(name) ? 1 : null,
  };
}
/** Consecutive runs of equal values; null unless the run values are strictly monotonic. */
function bands(values: number[]): number[][] | null {
  const runs: number[][] = [];
  values.forEach((value, index) => {
    if (runs.length && values[runs.at(-1)![0]] === value) runs.at(-1)!.push(index);
    else runs.push([index]);
  });
  const heads = runs.map((run) => values[run[0]]);
  const falling = heads.every((value, index) => !index || value < heads[index - 1]);
  const rising = heads.every((value, index) => !index || value > heads[index - 1]);
  return falling || rising ? runs : null;
}
/**
 * Orders located clubs so that consecutive chunks of `sizes` follow compass names (North/South, East/West,
 * North West/North East/South West/South East, North/Central/South); undefined when the names carry no compass.
 */
function compassOrder<Value extends { lat?: number; lng?: number }>(
  members: Value[],
  names: readonly string[] | undefined,
  sizes: number[],
): Value[] | undefined {
  if (sizes.length < 2 || !names || names.length < sizes.length) return undefined;
  if (members.some((member) => member.lat === undefined || member.lng === undefined)) return undefined;
  const senses = names.slice(0, sizes.length).map(compass);
  const byLatitude = senses.every((sense) => sense.ns !== null);
  if (!byLatitude && !senses.every((sense) => sense.ew !== null)) return undefined;
  const primary = senses.map((sense) => (byLatitude ? sense.ns! : sense.ew!));
  const runs = bands(primary);
  if (!runs) return undefined;
  const axis = (member: Value) => (byLatitude ? member.lat! : member.lng!);
  const sorted = [...members].sort((left, right) => (axis(right) - axis(left)) * Math.sign(primary[0] - primary.at(-1)!));
  const ordered: Value[] = [];
  let offset = 0;
  for (const run of runs) {
    const count = run.reduce((total, index) => total + sizes[index], 0);
    const band = sorted.slice(offset, offset + count);
    offset += count;
    const secondary = run.map((index) => senses[index].ew);
    if (byLatitude && run.length > 1 && secondary.every((sense) => sense !== null) && bands(secondary as number[]))
      band.sort((left, right) => (right.lng! - left.lng!) * Math.sign(secondary[0]! - secondary.at(-1)!));
    ordered.push(...band);
  }
  return ordered;
}

/** Equal conferences: geographic when the names carry a compass sense, otherwise balanced by reputation. */
function conferenceOf(clubs: PlanClub[], names: readonly string[]): Map<number, string> {
  const result = new Map<number, string>();
  if (names.length < 2 || !clubs.length) return result;
  const size = Math.ceil(clubs.length / names.length);
  const sizes = names.map((_, index) => Math.max(0, Math.min(size, clubs.length - index * size)));
  const ordered = compassOrder(clubs, names, sizes);
  if (ordered) {
    ordered.forEach((club, index) => result.set(club.id, names[Math.min(names.length - 1, Math.floor(index / size))]));
    return result;
  }
  const ranked = [...clubs].sort((left, right) => Number(right.row.reputation) - Number(left.row.reputation));
  ranked.forEach((club, index) => {
    const round = Math.floor(index / names.length);
    const slot = index % names.length;
    result.set(club.id, names[round % 2 ? names.length - 1 - slot : slot]);
  });
  return result;
}

const expectationFor = (rank: number, size: number) =>
  rank < 3 ? 3 : rank < size / 2 ? Math.ceil(size / 2) : size - 2;

/** Standings rows are unique: each club once in its own senior league and at most once per youth age group. */
export function assertPlanStandings(rows: Pick<WorldPlan["rows"], "leagues" | "clubs" | "standings">) {
  const ageOf = new Map(rows.leagues.map((league) => [Number(league.id), String(league.age_group)]));
  const byAge = new Map<string, number>();
  for (const row of rows.standings) {
    const leagueId = Number(row.league_id);
    const key = `${row.club_id}:${ageOf.get(leagueId)}`;
    if (byAge.has(key))
      throw new Error(
        `World plan: club ${row.club_id} stands in ${ageOf.get(leagueId)} leagues ${byAge.get(key)} and ${leagueId}.`,
      );
    byAge.set(key, leagueId);
  }
  for (const club of rows.clubs)
    if (club.league_id !== null && byAge.get(`${club.id}:Senior`) !== Number(club.league_id))
      throw new Error(`World plan: club ${club.id} has no standings row in its league ${club.league_id}.`);
}

/** Leagues, clubs (first teams, cross-border, B-teams), youth leagues and national teams; pure and seed-independent. */
export function planWorld(
  options: WorldOptions = {},
  lookup: CatalogLookup = worldCatalog(),
): WorldPlan {
  const seed = options.seed ?? DEFAULT_SEED;
  const codes = worldNations(options, lookup);
  const nations = orderNations(
    codes ? codes.map((code) => lookup.requireNation(code)) : lookup.allNations(),
  );
  if (!nations.length) throw new Error("The world catalog has no nations yet.");
  const inWorld = new Map(nations.map((nation) => [nation.code, nation]));
  const countries: Country[] = nations.map((nation, index) => ({
    id: index + 1,
    code: nation.code,
    name: nation.name,
    continent: nation.continent,
    confederation: nation.confederation,
    reputation: nation.reputation.league,
    language: nation.languages[0]?.code ?? "en",
    region: nation.capital,
  }));
  const countryId = new Map(countries.map((country) => [country.code, country.id]));
  const rows: WorldPlan["rows"] = {
    countries: countries.map((country) => ({ ...country })),
    leagues: [],
    clubs: [],
    standings: [],
    training_plans: [],
    set_pieces: [],
  };
  const counts: WorldPlan["counts"] = {
    firstTeams: 0,
    bTeams: 0,
    hostedClubs: 0,
    nationalTeams: 0,
    seniorLeagues: 0,
    reserveLeagues: 0,
    youthLeagues: 0,
  };
  const clubs: PlanClub[] = [];
  const states = new Map<string, NationState>();
  const nationState = (nation: NationSpec): NationState => {
    let state = states.get(nation.code);
    if (!state) {
      const places = nationPlaces(lookup, nation.code);
      state = {
        nation,
        random: seedrandom(`touchline-world:v${WORLD_VERSION}:${CATALOG_VERSION}:${nation.code}`),
        cities: nation.cities.major.map((spec, index) => ({
          spec,
          place: places.curated[index] ?? { name: spec.name, region: spec.region, size: spec.size },
          capacity: spec.maxClubs ?? CITY_CAPACITY[spec.size] ?? 1,
          used: 0,
          reserved: 0,
          created: 0,
          districts: [...(spec.districts ?? [])],
        })),
        extra: places.extra,
        extraIndex: 0,
        names: new Set(),
        avoid: lookup.avoidedClubNames(nation.code),
        avoidLoose: new Set([...lookup.avoidedClubNames(nation.code)].map(looseClubNameKey)),
      };
      states.set(nation.code, state);
    }
    return state;
  };
  const addLeague = (values: Omit<Row, "id">) => {
    const id = rows.leagues.length + 1;
    rows.leagues.push({ id, ...values });
    return id;
  };
  const addStandings = (leagueId: number, members: PlanClub[], conferences?: readonly string[]) => {
    const groups = conferences?.length ? conferenceOf(members, conferences) : undefined;
    for (const club of members)
      rows.standings.push({ league_id: leagueId, club_id: club.id, group_name: groups?.get(club.id) ?? "" });
  };
  const addClub = (club: Omit<PlanClub, "id" | "row">, values: Omit<Row, "id">) => {
    const id = rows.clubs.length + 1;
    const row: Row = {
      id,
      ...values,
      momentum: 0,
      crisis: 0,
      hype: 0,
      income: 0,
      spending: 0,
      season_spend: 0,
      ffp: 0,
    };
    rows.clubs.push(row);
    rows.training_plans.push({ club_id: id });
    rows.set_pieces.push({ club_id: id });
    const planned: PlanClub = { ...club, id, row };
    clubs.push(planned);
    return planned;
  };
  const stadium = (nation: NationSpec, city: string, random: Rng) =>
    renderName(pick(random, STADIUM_FORMS[nation.languages[0]?.code ?? ""] ?? ["{city} Stadium", "{city} Arena", "{city} Park"]), { city });

  const firstTeam = (input: {
    nation: NationSpec;
    naming: NationSpec;
    tier: LeagueTierSpec;
    ownTier: number;
    ownTiers: number;
    leagueId: number;
    reputation: number;
    rank: number;
    key: string;
    hosted?: CrossBorderSpec;
    city?: string;
  }) => {
    const state = nationState(input.naming);
    const naming = input.naming.football!.clubNaming;
    const { random } = state;
    const ladder = input.naming.football!.leagues;
    const strongest = ladder[0]?.clubs.giants?.top ?? ladder[0]?.clubs.reputation.top ?? input.reputation;
    const weakest = ladder.at(-1)?.clubs.reputation.bottom ?? input.reputation;
    const prestige = strongest > weakest ? clamp((input.reputation - weakest) / (strongest - weakest), 0, 1) : 0.5;
    const { place, token: cityToken, city } = chooseCity(state, input.city, prestige);
    const founded = foundedYear(naming, input.ownTier, input.ownTiers, random);
    const { name, token } = uniqueClubName(state, naming, input.ownTier, place.region, cityToken, founded, city);
    const economy = clubEconomy(input.tier.clubs, input.tier, input.reputation, random);
    const balance = economy.balance;
    const nation = input.naming;
    // Unlocated curated cities take a located city of the same region, else the nation's centre, so tiers stay geographic.
    const located = state.cities.filter((entry) => entry.place.lat !== undefined && entry.place.lng !== undefined);
    const centre = (axis: "lat" | "lng") => located.reduce((total, entry) => total + entry.place[axis]!, 0) / located.length;
    const anchor = place.lat !== undefined
      ? place
      : located.find((entry) => entry.place.region === place.region)?.place ??
        (located.length ? { lat: centre("lat"), lng: centre("lng") } : undefined);
    return addClub(
      {
        key: input.key,
        code: nation.code,
        market: input.nation.code,
        type: "club",
        tier: input.tier.tier,
        model: input.tier.clubs,
        status: input.tier.status,
        leagueReputation: input.tier.reputation,
        ...(input.hosted ? { hosted: input.hosted } : {}),
        region: place.region,
        ...(anchor?.lat !== undefined ? { lat: anchor.lat, lng: anchor.lng } : {}),
      },
      {
        name,
        short_name: shortName(naming.shortName, name, token),
        city: place.name,
        country_id: countryId.get(nation.code)!,
        league_id: input.leagueId,
        type: "club",
        parent_id: null,
        age_group: "Senior",
        color: pick(random, naming.colors?.length ? naming.colors : PALETTE),
        reputation: input.reputation,
        academy: economy.academy,
        facilities: economy.facilities,
        balance,
        transfer_budget: economy.transfer_budget,
        wage_budget: economy.wage_budget,
        philosophy: pick(random, ["Develop and sell", "Win now", "Sustainable growth", "Local identity"]),
        culture: pick(random, ["Development", "Demanding", "Family", "Professional"]),
        formation: pick(random, ["4-3-3", "4-2-3-1", "3-5-2", "4-4-2"]),
        tactical_style: pick(random, STYLES),
        chemistry: integer(random, 55, 85),
        manager: cultureName(random, nation.code, { catalog: lookup }),
        manager_trust: 72,
        board_confidence: 72,
        board_pressure: 28,
        fan_mood: 72,
        fan_loyalty: integer(random, 65, 95),
        fan_patience: integer(random, 40, 85),
        expectations: expectationFor(input.rank, input.tier.size),
        stadium: stadium(nation, token, random),
        capacity: economy.capacity,
        data: JSON.stringify({
          worldKey: input.key,
          worldVersion: WORLD_VERSION,
          founded,
          catalogTier: input.tier.tier,
          ...(input.hosted
            ? {
                hosted: {
                  host: input.hosted.host,
                  cups: input.hosted.cups,
                  continental: input.hosted.continental,
                  youth: input.hosted.youth,
                  registration: input.hosted.registration,
                },
              }
            : {}),
          youthDNA: pick(random, ["Technical intelligence", "Relentless pressing", "Creative freedom", "Physical resilience"]),
          ultras: integer(random, 10, 80),
          boardPersonality: pick(random, ["Patient", "Ambitious", "Interfering", "Pragmatic"]),
          mediaBias: integer(random, -30, 30),
          ticketPrice: Math.round(input.reputation / 2),
          sponsors: Math.round(balance * 0.22),
          financialHistory: [],
          managerCareer: [{ season: 2026, club: name }],
          relationship: 50,
        }),
      },
    );
  };

  const reserveTeam = (input: {
    parent: PlanClub;
    owner: NationSpec;
    policy: ReservePolicySpec;
    leagueId: number;
    tier: number;
    finance: LeagueTierSpec;
    status: LeagueStatus;
    leagueReputation: number;
    size: number;
  }) => {
    const { parent, owner } = input;
    const random = nationState(owner).random;
    const parentRow = parent.row;
    const reputation = Math.round(clamp(Number(parentRow.reputation) - integer(random, 25, 30), 1, 99));
    const economy = clubEconomy(input.finance.clubs, input.finance, reputation, random, {
      share: 0,
      players: input.policy.squad?.[1] ?? 26,
    });
    const founded = JSON.parse(String(parentRow.data)).founded as number;
    const key = reserveClubKey(parent.key);
    counts.bTeams++;
    return addClub(
      {
        key,
        code: parent.code,
        market: parent.code,
        type: "bteam",
        tier: input.tier,
        model: input.finance.clubs,
        status: input.status,
        leagueReputation: input.leagueReputation,
        parent,
        reserves: input.policy,
        region: parent.region,
        ...(parent.lat !== undefined ? { lat: parent.lat, lng: parent.lng } : {}),
      },
      {
        name: (input.policy.nameTemplate ?? "{club} B").replace("{club}", String(parentRow.name)),
        short_name: `${parentRow.short_name}B`,
        city: parentRow.city,
        country_id: parentRow.country_id,
        league_id: input.leagueId,
        type: "bteam",
        parent_id: parent.id,
        age_group: "Senior",
        color: parentRow.color,
        reputation,
        academy: parentRow.academy,
        facilities: parentRow.facilities,
        balance: economy.balance,
        transfer_budget: economy.transfer_budget,
        wage_budget: economy.wage_budget,
        philosophy: "Develop and sell",
        culture: "Development",
        formation: parentRow.formation,
        tactical_style: parentRow.tactical_style,
        chemistry: 65,
        manager: cultureName(random, parent.code, { catalog: lookup }),
        manager_trust: 65,
        board_confidence: 70,
        board_pressure: 20,
        fan_mood: 65,
        fan_loyalty: 70,
        fan_patience: 80,
        expectations: Math.ceil(input.size / 2),
        stadium: `${parentRow.city} Training Ground`,
        capacity: Math.min(economy.capacity, 6000),
        data: JSON.stringify({
          worldKey: key,
          worldVersion: WORLD_VERSION,
          founded,
          catalogTier: input.tier,
          noSameDivision: true,
          youthDNA: "Pathway to first team",
          reservePolicy: input.policy,
          financialHistory: [],
          relationship: 50,
        }),
      },
    );
  };

  // Cross-border clubs of nations in this world, keyed by host code; they count against their home city from the start.
  const guests = new Map<string, { home: NationSpec; spec: CrossBorderSpec; index: number; slot: number }[]>();
  for (const home of nations) {
    let index = 0;
    for (const spec of home.hostedAbroad ?? []) {
      spec.tiers.forEach((_, slot) => {
        if (inWorld.has(spec.host)) {
          guests.set(spec.host, [...(guests.get(spec.host) ?? []), { home, spec, index, slot }]);
          const city = nationState(home).cities.find((entry) => entry.place.name === spec.cities[slot]);
          if (city) {
            city.used++;
            city.reserved++;
          }
        }
        index++;
      });
    }
  }

  // Pass 1: senior tiers, first teams, cross-border clubs and pyramid B-teams.
  for (const nation of nations) {
    const football = nation.football;
    const tiers = football?.leagues ?? [];
    const own: PlanClub[] = [];
    const parentsUsed = new Set<number>();
    const confederation = nation.confederation;
    for (const tier of tiers) {
      const leagueId = addLeague({
        name: tier.name,
        country_id: countryId.get(nation.code)!,
        confederation,
        tier: tier.tier,
        age_group: "Senior",
        kind: "league",
        reputation: tier.reputation,
        format: leagueFormat(tier),
        data: JSON.stringify(leagueSnapshot(nation, tier)),
      });
      counts.seniorLeagues++;
      const policy = football!.reserves;
      const parents: PlanClub[] = [];
      if (policy.mode === "pyramid" && policy.pyramid && tier.bTeams && policy.eligibility) {
        const { parentTiers, minReputation } = policy.eligibility;
        const gap = policy.pyramid.minGapBelowParent;
        const eligible = own
          .filter((club) => parentTiers.includes(club.tier) && club.tier + gap <= tier.tier && !parentsUsed.has(club.id))
          .sort((left, right) => Number(right.row.reputation) - Number(left.row.reputation));
        const chosen = [
          ...eligible.filter((club) => Number(club.row.reputation) >= minReputation),
          ...eligible.filter((club) => Number(club.row.reputation) < minReputation),
        ].slice(0, tier.bTeams);
        for (const parent of chosen) {
          parents.push(parent);
          parentsUsed.add(parent.id);
        }
      }
      const visitors = (guests.get(nation.code) ?? []).filter((guest) => guest.spec.tiers[guest.slot] === tier.tier);
      const random = nationState(nation).random;
      const reputations = tierReputations(tier.clubs, tier.size - parents.length, random);
      // Cross-border clubs take seeded places below the giants and the leader.
      const protectedTop = Math.max(1, Math.min(tier.clubs.giants?.count ?? 0, reputations.length - visitors.length));
      const open = shuffle(random, Array.from({ length: reputations.length - protectedTop }, (_, index) => index + protectedTop));
      const visitorAt = new Map(open.slice(0, visitors.length).map((position, index) => [position, visitors[index]]));
      const members: PlanClub[] = [];
      let slot = 0;
      reputations.forEach((reputation, rank) => {
        const visitor = visitorAt.get(rank);
        if (visitor) {
          counts.hostedClubs++;
          counts.firstTeams++;
          members.push(
            firstTeam({
              nation,
              naming: visitor.home,
              tier,
              ownTier: 1,
              ownTiers: Math.max(1, visitor.home.football?.leagues.length ?? 1),
              leagueId,
              reputation,
              rank,
              key: hostedClubKey(visitor.home.code, visitor.index),
              hosted: visitor.spec,
              city: visitor.spec.cities[visitor.slot],
            }),
          );
          return;
        }
        counts.firstTeams++;
        const club = firstTeam({
          nation,
          naming: nation,
          tier,
          ownTier: tier.tier,
          ownTiers: tiers.length,
          leagueId,
          reputation,
          rank,
          key: clubKey(nation.code, tier.tier, slot++),
        });
        own.push(club);
        members.push(club);
      });
      for (const parent of parents)
        members.push(
          reserveTeam({
            parent,
            owner: nation,
            policy,
            leagueId,
            tier: tier.tier,
            finance: tier,
            status: tier.status,
            leagueReputation: tier.reputation,
            size: tier.size,
          }),
        );
      addStandings(leagueId, members, tier.conferences);
    }
  }

  // Pass 2: reserve leagues (reserve-league mode), including guest nations (CA II teams in MLS NEXT Pro).
  const reserveParents = (owner: NationSpec) => {
    const policy = owner.football!.reserves;
    const eligibility = policy.eligibility;
    if (!eligibility) return [];
    const eligible = clubs
      .filter((club) => club.type === "club" && club.code === owner.code && (club.hosted || eligibility.parentTiers.includes(club.tier)))
      .sort((left, right) => Number(right.row.reputation) - Number(left.row.reputation));
    return [
      ...eligible.filter((club) => Number(club.row.reputation) >= eligibility.minReputation),
      ...eligible.filter((club) => Number(club.row.reputation) < eligibility.minReputation && !club.hosted),
    ].slice(0, eligibility.maxTeams);
  };
  for (const nation of nations) {
    const policy = nation.football?.reserves;
    if (policy?.mode !== "reserve-league" || !policy.reserveLeague || policy.reserveLeague.host) continue;
    const league = policy.reserveLeague;
    const owners = [
      nation,
      ...nations.filter((other) => other.football?.reserves.mode === "reserve-league" && other.football.reserves.reserveLeague?.host === nation.code),
    ];
    const entries = owners.flatMap((owner) => reserveParents(owner).map((parent) => ({ owner, parent })));
    if (entries.length < 2) continue;
    const spec = { roundRobins: league.roundRobins, conferences: league.conferences };
    const leagueId = addLeague({
      name: league.name,
      country_id: countryId.get(nation.code)!,
      confederation: nation.confederation,
      tier: 0,
      age_group: "Senior",
      kind: "league",
      reputation: league.reputation,
      format: leagueFormat(spec),
      data: JSON.stringify({
        worldVersion: WORLD_VERSION,
        catalogKey: reserveLeagueKey(nation.code),
        reserveOnly: true,
        shortName: league.shortName,
        roundRobins: league.roundRobins ?? 2,
        ...(league.conferences?.length ? { conferences: league.conferences } : {}),
        promotion: 0,
        relegation: 0,
        tiebreakers: TIEBREAKERS,
      }),
    });
    counts.reserveLeagues++;
    const members = entries.map(({ owner, parent }) => {
      const ownerPolicy = owner.football!.reserves;
      const lowest = owner.football!.leagues.at(-1) ?? nation.football!.leagues.at(-1)!;
      return reserveTeam({
        parent,
        owner,
        policy: ownerPolicy,
        leagueId,
        tier: 0,
        finance: lowest,
        status: "professional",
        leagueReputation: league.reputation,
        size: entries.length,
      });
    });
    addStandings(leagueId, members, league.conferences);
  }

  // Pass 3: youth leagues; every first team plays in exactly one U19 and one U17 league.
  for (const nation of nations) {
    const football = nation.football;
    if (!football?.leagues.length) continue;
    for (const age of ["U19", "U17"] as const) {
      football.youth[age].divisions.forEach((division, divisionIndex) => {
        const [first, last] = division.parentTiers;
        const members = clubs
          .filter((club) => {
            if (club.type !== "club") return false;
            const inRange = club.tier >= first && club.tier <= last;
            if (!club.hosted) return club.code === nation.code && inRange;
            if (club.code === nation.code) return club.hosted.youth === "home" && divisionIndex === 0;
            return club.hosted.host === nation.code && club.hosted.youth === "host" && inRange;
          })
          .sort((left, right) => left.region.localeCompare(right.region) || Number(right.row.reputation) - Number(left.row.reputation));
        const maximum = division.groupSize ?? 16;
        const sizes = youthGroups(members, maximum).map((group) => group.length);
        const located = members.every((club) => club.lat !== undefined);
        const ordered =
          compassOrder(members, division.groupNames, sizes) ??
          (located ? [...members].sort((left, right) => right.lat! - left.lat!) : members);
        const groups = youthGroups(ordered, maximum);
        const reputation = football.leagues.find((tier) => tier.tier === first)?.reputation ?? nation.reputation.league;
        groups.forEach((group, groupIndex) => {
          const leagueId = addLeague({
            name: groups.length > 1
              ? `${division.name} - ${division.groupNames?.[groupIndex] ?? `Group ${groupIndex + 1}`}`
              : division.name,
            country_id: countryId.get(nation.code)!,
            confederation: nation.confederation,
            tier: 0,
            age_group: age,
            kind: "league",
            reputation: Math.round(reputation * 0.7),
            format: "Double round-robin",
            data: JSON.stringify({
              worldVersion: WORLD_VERSION,
              catalogKey: youthLeagueKey(nation.code, age, divisionIndex, groupIndex),
              youth: true,
              division: division.name,
              parentTiers: division.parentTiers,
              continental: 2,
              promotion: 0,
              relegation: 0,
            }),
          });
          counts.youthLeagues++;
          addStandings(leagueId, group);
        });
      });
    }
  }

  // Pass 4: senior, U20, U19 and U17 national teams for every nation.
  for (const nation of nations) {
    const random = nationState(nation).random;
    for (const [age, drop] of [["Senior", 0], ["U20", 3], ["U19", 5], ["U17", 6]] as const) {
      const id = rows.clubs.length + 1;
      rows.clubs.push({
        id,
        name: `${nation.name}${age === "Senior" ? "" : ` ${age}`}`,
        short_name: nation.code,
        city: nation.capital,
        country_id: countryId.get(nation.code)!,
        league_id: null,
        type: "national",
        parent_id: null,
        age_group: age,
        color: pick(random, nation.football?.clubNaming.colors?.length ? nation.football.clubNaming.colors : PALETTE),
        reputation: Math.round(clamp(nation.reputation.national - drop, 1, 99)),
        academy: 70,
        facilities: 75,
        balance: 0,
        transfer_budget: 0,
        wage_budget: 0,
        philosophy: "Win now",
        culture: "Professional",
        formation: "4-3-3",
        tactical_style: "Balanced",
        chemistry: 65,
        manager: cultureName(random, nation.code, { catalog: lookup }),
        manager_trust: 75,
        board_confidence: 75,
        board_pressure: 35,
        fan_mood: 70,
        fan_loyalty: 90,
        fan_patience: 50,
        expectations: 3,
        stadium: `${nation.capital} National Stadium`,
        capacity: 30000,
        data: JSON.stringify({ worldKey: `N:${nation.code}:${age}`, worldVersion: WORLD_VERSION }),
        momentum: 0,
        crisis: 0,
        hype: 0,
        income: 0,
        spending: 0,
        season_spend: 0,
        ffp: 0,
      });
      counts.nationalTeams++;
    }
  }

  assertPlanStandings(rows);
  return {
    seed,
    lookup,
    squads: options.squads ?? "full",
    nations,
    countries,
    clubs,
    rows,
    counts,
  };
}

// --------------------------------------------------------------- players

interface Slot {
  club: PlanClub | null;
  /** Squad nation: club nation, or the pool nation for home-based players. */
  code: string;
  ageGroup: "Senior" | "U19" | "U17";
  position: Position;
  age: number;
  represent: string;
  context: string;
  foreign: boolean;
  allowSwitch: boolean;
  bornIn?: string;
  familyMove?: NonNullable<PlayerProfile["familyMove"]>;
}

function squadSlots(club: PlanClub, squads: WorldPlan["squads"], random: Rng): Slot[] {
  const slots: Slot[] = [];
  const add = (ageGroup: Slot["ageGroup"], size: number, age: () => number, share: number) => {
    const group = Array.from({ length: size }, (_, index): Slot => {
      const code = club.hosted && random() < (ageGroup === "Senior" ? 0.45 : 0.2) ? club.hosted.host : club.code;
      return {
        club,
        code: club.code,
        ageGroup,
        position: ROSTER[index % ROSTER.length],
        age: age(),
        represent: code,
        context: code,
        foreign: false,
        allowSwitch: true,
        // Host-nation academy players of a cross-border club grew up locally (border region).
        ...(code !== club.code && ageGroup !== "Senior" ? { bornIn: club.code } : {}),
      };
    });
    const foreign = Math.min(size, stochasticRound(size * share, random));
    for (const index of shuffle(random, group.map((_, position) => position)).slice(0, foreign))
      group[index].foreign = true;
    slots.push(...group);
  };
  const share = club.model.foreignShare;
  if (club.type === "bteam") {
    const policy = club.reserves;
    const [minimum, maximum] = policy?.squad ?? [22, 26];
    const size = squads === "minimum" ? SQUAD_MINIMUMS.BTeam : integer(random, Math.max(SQUAD_MINIMUMS.BTeam, minimum), Math.max(minimum, maximum));
    const maxAge = policy?.ageRule?.maxAge ?? 23;
    const overage = Math.min(3, policy?.ageRule?.overage ?? 2);
    let older = 0;
    add("Senior", size, () => (older++ < overage ? integer(random, maxAge + 1, maxAge + 4) : integer(random, 19, maxAge)), share * 0.5);
    return slots;
  }
  const [minimum, maximum] = club.model.squadSize ?? [25, 30];
  const senior = squads === "minimum" ? SQUAD_MINIMUMS.Senior : integer(random, Math.max(SQUAD_MINIMUMS.Senior, minimum), Math.max(minimum, maximum));
  add("Senior", senior, () => SENIOR_AGES[weightedIndex(SENIOR_AGE_WEIGHTS, random())], share);
  const youth = () => (squads === "minimum" ? SQUAD_MINIMUMS.U19 : integer(random, SQUAD_MINIMUMS.U19, 24));
  add("U19", youth(), () => (random() < 0.1 ? 16 : integer(random, 17, 18)), share * 0.35);
  add("U17", youth(), () => (random() < 0.1 ? 14 : integer(random, 15, 16)), share * 0.35);
  return slots;
}

function planSlots(plan: WorldPlan, random: Rng) {
  const byCode = new Map(plan.nations.map((nation) => [nation.code, nation]));
  const countryId = new Map(plan.countries.map((country) => [country.code, country.id]));
  const byClub = new Map<number, Slot[]>();
  const markets = new Map<string, { senior: Slot[]; youth: Slot[]; locals: Slot[] }>();
  const market = (code: string) => {
    let entry = markets.get(code);
    if (!entry) markets.set(code, (entry = { senior: [], youth: [], locals: [] }));
    return entry;
  };
  for (const club of plan.clubs) {
    const slots = squadSlots(club, plan.squads, random);
    byClub.set(club.id, slots);
    const entry = market(club.type === "bteam" ? club.code : club.market);
    for (const slot of slots) {
      if (slot.foreign) (slot.ageGroup === "Senior" ? entry.senior : entry.youth).push(slot);
      else if (slot.ageGroup === "Senior" && !slot.club?.hosted) entry.locals.push(slot);
    }
  }
  // Abroad allocations (pushed by the sending nation) per destination market.
  const pushed = new Map<string, { senior: string[]; youth: string[] }>();
  for (const nation of plan.nations) {
    const abroad = nation.abroad;
    if (!abroad) continue;
    const destinations = abroad.destinations.filter((entry) => markets.has(entry.code));
    if (!destinations.length) continue;
    const weights = destinations.map((entry) => entry.weight);
    for (const [side, total] of [["senior", abroad.seniors], ["youth", abroad.youth]] as const)
      apportion(total, weights).forEach((count, index) => {
        const code = destinations[index].code;
        let entry = pushed.get(code);
        if (!entry) pushed.set(code, (entry = { senior: [], youth: [] }));
        for (let copy = 0; copy < count; copy++) entry[side].push(nation.code);
      });
  }
  const strength = (code: string) => (byCode.get(code)?.reputation.national ?? 40) + gaussian(random) * 7;
  const familyMoveDate = () => `${Number(START_DATE.slice(0, 4)) - integer(random, 1, 5)}-${pad(integer(random, 1, 12))}-01`;
  const configure = (slot: Slot, code: string, destination: string, youth: boolean) => {
    if (code === destination) {
      slot.foreign = false;
      return;
    }
    slot.represent = code;
    slot.allowSwitch = false;
    const nation = byCode.get(code);
    const linked = nation?.nationality.links.some((link) => link.code === destination);
    const raisedHere = Boolean(linked && random() < clamp(0.15 + 0.5 * (nation?.nationality.diasporaPull ?? 0), 0, 0.6));
    if (!youth) {
      slot.context = raisedHere ? destination : code;
      return;
    }
    if (nation?.euEea && byCode.get(destination)?.euEea && slot.age >= 16) {
      slot.context = code;
      return;
    }
    if (raisedHere) {
      slot.context = destination;
      slot.bornIn = destination;
      return;
    }
    slot.context = code;
    slot.familyMove = {
      countryId: countryId.get(destination)!,
      reason: "employment",
      verified: true,
      date: familyMoveDate(),
    };
  };
  const assign = (destination: string, slots: Slot[], sent: string[], locals: Slot[], youth: boolean) => {
    if (sent.length > slots.length && locals.length) {
      const extra = Math.min(sent.length - slots.length, Math.ceil(slots.length * 0.5), locals.length);
      for (const local of shuffle(random, [...locals]).slice(0, extra)) {
        local.foreign = true;
        slots.push(local);
      }
    }
    const placed = sent.length > slots.length ? shuffle(random, [...sent]).slice(0, slots.length) : sent;
    const imports = (byCode.get(destination)?.football?.importSources ?? []).filter(
      (source) => byCode.has(source.code) && source.code !== destination,
    );
    const importWeights = imports.map((source) => source.weight);
    const candidates = [...placed];
    while (candidates.length < slots.length)
      candidates.push(imports.length ? imports[weightedIndex(importWeights, random())].code : destination);
    const ranked = candidates
      .map((code) => ({ code, key: strength(code) }))
      .sort((left, right) => right.key - left.key);
    slots
      .map((slot) => ({ slot, key: Number(slot.club?.row.reputation ?? 0) + gaussian(random) * 4 }))
      .sort((left, right) => right.key - left.key)
      .forEach(({ slot }, index) => configure(slot, ranked[index].code, destination, youth));
  };
  for (const [code, entry] of markets) {
    assign(code, entry.senior, pushed.get(code)?.senior ?? [], entry.locals, false);
    assign(code, entry.youth, pushed.get(code)?.youth ?? [], [], true);
  }
  // Home-based pools of nations without an own league.
  const pools: Slot[] = [];
  for (const nation of plan.nations) {
    const pool = nation.homePool;
    if (!pool) continue;
    const add = (ageGroup: Slot["ageGroup"], age: number, index: number) =>
      pools.push({
        club: null,
        code: nation.code,
        ageGroup,
        position: ROSTER[index % ROSTER.length],
        age,
        represent: nation.code,
        context: nation.code,
        foreign: false,
        allowSwitch: true,
      });
    for (let index = 0; index < pool.seniors; index++)
      add("Senior", SENIOR_AGES[weightedIndex(SENIOR_AGE_WEIGHTS, random())], index);
    for (let index = 0; index < pool.youth; index++) {
      const age = integer(random, 15, 18);
      add(age <= 16 ? "U17" : "U19", age, index);
    }
  }
  return { byClub, pools };
}

function abilityFor(reputation: number, age: number, youth: boolean, foreign: boolean, random: Rng) {
  const anchor = reputation * 0.66 + 22 + integer(random, -11, 9);
  const penalty = youth
    ? 22 + (18 - age) * 2
    : Math.max(0, 23 - age) + Math.max(0, age - 31) * 1.5;
  return Math.round(clamp(anchor - penalty + (foreign && !youth ? 1.5 : 0), 1, 99));
}
function potentialFor(ability: number, age: number, youth: boolean, random: Rng) {
  const gain = youth
    ? integer(random, 10, 30)
    : age < 26
      ? integer(random, 0, 18)
      : age < 30
        ? integer(random, 0, 4)
        : 0;
  return Math.round(clamp(ability + gain, ability, 99));
}

function* clubPlayers(club: PlanClub, slots: Slot[], people: PeopleContext, random: Rng): Generator<PlayerRow> {
  const row = club.row;
  const reputation = Number(row.reputation);
  const academy = Number(row.academy);
  const drafts = slots.map((slot) => {
    const youth = slot.ageGroup !== "Senior";
    const ability = abilityFor(reputation, slot.age, youth, slot.foreign, random);
    const contract: PlayerSpec["contract"] = !youth
      ? club.status === "amateur" ? "amateur" : "professional"
      : club.status !== "professional" || slot.age < 16 || random() < 0.45
        ? "amateur"
        : "professional";
    return {
      slot,
      ability,
      potential: potentialFor(ability, slot.age, youth, random),
      contract,
      role: undefined as string | undefined,
    };
  });
  const seniors = drafts.filter((draft) => draft.slot.ageGroup === "Senior");
  for (const position of STARTING_SHAPE) {
    const best = seniors
      .filter((draft) => !draft.role && draft.slot.position === position)
      .sort((left, right) => right.ability - left.ability)[0];
    if (best) best.role = "Regular starter";
  }
  let base = 0;
  let allowances = 0;
  for (const draft of drafts)
    if (draft.contract === "professional") base += professionalBaseWage(draft.ability, draft.slot.ageGroup);
    else allowances += amateurAllowance(academy);
  // Section 5: professional payroll is calibrated to about 88% of the weekly wage budget.
  const available = 0.88 * Number(row.wage_budget) - allowances;
  const professionals = drafts.filter((draft) => draft.contract === "professional");
  // Thin budgets (low-income leagues, small B-teams) pay professionals below the usual 50/week minimum.
  const wageFloor = professionals.length
    ? clamp(Math.floor(available / professionals.length / 10) * 10, 10, 50)
    : 50;
  const payrollAt = (scale: number) =>
    professionals.reduce((total, draft) => total + professionalWage(draft.ability, draft.slot.ageGroup, scale, wageFloor), 0);
  let wageScale = base > 0 ? clamp(available / base, 0.02, 4) : 1;
  if (base > 0 && payrollAt(wageScale) > available) {
    let low = 0;
    let high = wageScale;
    for (let step = 0; step < 24; step++) {
      const middle = (low + high) / 2;
      if (payrollAt(middle) <= available) low = middle;
      else high = middle;
    }
    wageScale = low;
  }
  const owner = {
    id: club.id,
    country_id: Number(row.country_id),
    reputation,
    academy,
    balance: Number(row.balance),
    philosophy: String(row.philosophy),
    type: club.type,
  };
  for (const draft of drafts) {
    const { slot } = draft;
    const player = createPlayer(random, people, {
      club: owner,
      representCode: slot.represent,
      contextCode: slot.context,
      ageGroup: slot.ageGroup,
      position: slot.position,
      birthDate: birthDateForAge(random, slot.age, START_DATE),
      date: START_DATE,
      ability: draft.ability,
      potential: draft.potential,
      leagueReputation: club.leagueReputation,
      wageScale,
      wageFloor,
      contract: draft.contract,
      ...(draft.role ? { role: draft.role } : {}),
      allowSwitch: slot.allowSwitch,
      ...(slot.bornIn ? { bornIn: slot.bornIn } : {}),
      ...(slot.familyMove ? { familyMove: slot.familyMove } : {}),
    });
    if (club.id === 1) player.knowledge = 100;
    yield player;
  }
}

/** Every generated player of the plan (clubs in id order, then home-based pools); deterministic for plan.seed. */
export function* worldPlayers(plan: WorldPlan): Generator<PlayerRow> {
  const random = seedrandom(`${plan.seed}:players`);
  const people = peopleContext(plan.countries, plan.lookup);
  const { byClub, pools } = planSlots(plan, random);
  for (const club of plan.clubs) yield* clubPlayers(club, byClub.get(club.id) ?? [], people, random);
  const byCode = new Map(plan.nations.map((nation) => [nation.code, nation]));
  for (const slot of pools) {
    const reputation = byCode.get(slot.code)?.reputation.league ?? 30;
    const youth = slot.ageGroup !== "Senior";
    const ability = abilityFor(reputation, slot.age, youth, false, random);
    yield createPlayer(random, people, {
      club: null,
      representCode: slot.represent,
      contextCode: slot.context,
      ageGroup: slot.ageGroup,
      position: slot.position,
      birthDate: birthDateForAge(random, slot.age, START_DATE),
      date: START_DATE,
      ability,
      potential: potentialFor(ability, slot.age, youth, random),
      leagueReputation: reputation,
      contract: "pool",
      allowSwitch: false,
    });
  }
}

/** Eight staff per first team (the director assistant comes from ensureClubSupport) and about 5% free staff. */
export function worldStaff(plan: WorldPlan): { staff: Row[]; relationships: Row[] } {
  const random = seedrandom(`${plan.seed}:staff`);
  const staff: Row[] = [];
  const relationships: Row[] = [];
  const roles = STAFF_ROLES.filter((role) => role !== ASSISTANT_ROLE);
  const add = (clubId: number | null, code: string, role: string, ability: number, countryId: number | null) => {
    const id = staff.length + 1;
    staff.push({
      id,
      club_id: clubId,
      name: cultureName(random, code, { catalog: plan.lookup }),
      role,
      ability,
      influence: integer(random, 30, 90),
      communication: integer(random, 40, 95),
      tactical_knowledge: clamp(ability + integer(random, -25, 12)),
      personality: pick(random, ["Collaborative", "Ambitious", "Reserved", "Outspoken", "Methodical"]),
      ambition: integer(random, 25, 90),
      morale: 75,
      wage: Math.round(ability ** 2 * (clubId ? 0.4 : 0.45)),
      data: JSON.stringify({
        bias: pick(random, ["Youth", "Physical", "Technical", "Home nation", "Reputation"]),
        accuracy: clamp(ability + integer(random, -5, 10)),
        detail: integer(random, 45, 95),
        riskTolerance: integer(random, 20, 90),
        ...(countryId ? { preferredRegion: countryId } : {}),
        development: 0,
        ...(clubId ? { contractEnd: "2029-06-30" } : {}),
      }),
    });
    return id;
  };
  const firstTeams = plan.clubs.filter((club) => club.type === "club");
  for (const club of firstTeams) {
    const reputation = Number(club.row.reputation);
    const ids = roles.map((role) =>
      add(club.id, club.code, role, clamp(reputation + integer(random, -20, 12)), Number(club.row.country_id)),
    );
    relationships.push({
      club_id: club.id,
      source_type: "staff",
      source_id: ids[0],
      target_type: "staff",
      target_id: ids[1],
      strength: integer(random, -40, 75),
      kind: pick(random, ["Alliance", "Professional", "Rivalry"]),
    });
  }
  const free = Math.max(10, Math.round(firstTeams.length * 0.05));
  for (let index = 0; index < free; index++) {
    const club = firstTeams.length ? pick(random, firstTeams) : undefined;
    add(null, club?.code ?? plan.nations[0].code, STAFF_ROLES[index % STAFF_ROLES.length], integer(random, 45, 95), null);
  }
  return { staff, relationships };
}

async function insertRows(store: Store, table: string, rows: Row[]) {
  for (let offset = 0; offset < rows.length; offset += 5000)
    await store.bulkInsert(table, rows.slice(offset, offset + 5000));
}

export async function generateWorld(store: Store, options: WorldOptions = {}): Promise<void> {
  if (await store.get("SELECT [key] FROM meta WHERE [key] = ?", "state")) return;
  const lookup = worldCatalog();
  const nations = worldNations(options, lookup);
  assertValidCatalog(lookup.catalog, nations ? { nations } : {});
  const plan = planWorld(options, lookup);
  const state: GameState = {
    date: START_DATE,
    season: Number(START_DATE.slice(0, 4)),
    seed: plan.seed,
    clubId: 1,
    started: false,
    director: {
      name: "Alex Morgan",
      background: "Former scout",
      reputation: 48,
      experience: 0,
      skillPoints: 3,
      skills: { scouting: 1, negotiations: 1, development: 0, finance: 0, leadership: 0 },
    },
    week: 0,
    worldTrend: "High press",
    lastAutosave: START_DATE,
    gameOver: false,
  };
  await store.transaction(async () => {
    for (const table of STRUCTURE_TABLES) await insertRows(store, table, plan.rows[table]);
    let players = 0;
    let homeBased = 0;
    if (!options.structureOnly) {
      const { staff, relationships } = worldStaff(plan);
      await insertRows(store, "staff", staff);
      await insertRows(store, "relationships", relationships);
      players = await insertPlayers(
        store,
        (function* counted() {
          for (const row of worldPlayers(plan)) {
            if (row.club_id === null) homeBased++;
            yield row;
          }
        })(),
      );
    }
    await store.setMeta("state", state);
    await store.setMeta("settings", DEFAULT_SETTINGS);
    await store.setMeta("schemaVersion", 1);
    await store.setMeta("world", {
      seed: plan.seed,
      generated: START_DATE,
      version: WORLD_VERSION,
      catalogVersion: CATALOG_VERSION,
      nations: plan.countries.length,
      clubs: plan.counts.firstTeams,
      bTeams: plan.counts.bTeams,
      nationalTeams: plan.counts.nationalTeams,
      players,
      homeBased,
      // Read back when a career regenerates this world (saves.ts regenerationOptions).
      options: {
        ...(nations ? { nations } : {}),
        squads: plan.squads,
        ...(options.structureOnly ? { structureOnly: true } : {}),
      },
    });
  });
  await ensureClubSupport(store);
  await seedAssociationCoefficients(store, Number(START_DATE.slice(0, 4)));
}

