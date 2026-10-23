import { z } from "zod";
import { Store, type SqlParameter } from "./db.ts";
import {
  clubOf,
  clubSquads,
  canManagePlayer,
  squadDestinations,
  GameError,
  playerOf,
  relationshipMatrix,
  settingsOf,
  stateOf,
  weeklyWages,
} from "./systems.ts";
import {
  affiliateOptionsForNegotiation,
  affiliateSquadCounts,
} from "./affiliates.ts";
import {
  addDays,
  addMonths,
  ATTRIBUTE_GROUPS,
  LOAN_TYPES,
  PERSONALITY_KEYS,
  POSITIONS,
  potentialInfluences,
  tacticalFit,
  valuation,
} from "../shared/rules.ts";
import type {
  AcademyData,
  Bootstrap,
  CompetitionDetail,
  Dashboard,
  FinanceData,
  LoanDesk,
  MatchDetail,
  PlayerDetail,
  PlayerPage,
  ScoutingData,
  SquadData,
  StaffDesk,
  TrainingData,
  TransferDesk,
  WorldTotals,
  WorldClub,
  WorldClubPage,
  ClubDetail,
  PlayerCareer,
  PlayerAppearance,
} from "../shared/api.ts";
import type {
  Club,
  Country,
  Fixture,
  League,
  Loan,
  MatchSnapshot,
  Negotiation,
  NegotiationData,
  Player,
  PlayerProfile,
  ScoutReport,
  Staff,
  Standing,
  TransferPayment,
} from "../shared/types.ts";
import { simulateMatch } from "./match.ts";
import {
  assessFinances,
  annualAmortization,
  clubValuation,
  projectedOperatingRevenue,
} from "./finance.ts";
import { clubSanctions } from "./sanctions.ts";
import { canSign, eligibilitySummaries, playerEligibility, predictRegistration } from "./eligibility.ts";
import { assessPlayerInterest, assessYouthTransfer } from "./recruitment.ts";
import { clubAffiliates } from "./club-support.ts";
import { describeIdentity, peopleContext } from "./people.ts";
import { marketValueFactor } from "../shared/world-catalog/market.ts";
import { associationNotes, reservePolicy } from "../shared/world-rules.ts";
import { notificationFeed, notificationVisibility } from "./notifications.ts";
import { withBattleViews } from "./transfer-battles.ts";
import {
  PLAYER_SEARCH_RANGE_KEYS,
  PLAYER_SEARCH_RANGES,
  searchBounds,
  type PlayerSearchRange,
} from "../shared/player-search.ts";

const playerSelect = `SELECT players.*, clubs.name AS club_name, clubs.color AS club_color, countries.name AS country_name, countries.code AS country_code FROM players LEFT JOIN clubs ON clubs.id = players.club_id JOIN countries ON countries.id = players.country_id`;
const fixtureSelect = `SELECT fixtures.*, home.name AS home_name, away.name AS away_name, home.color AS home_color, away.color AS away_color, leagues.name AS competition_name, coalesce(leagues.age_group,'Senior') AS age_group FROM fixtures JOIN clubs AS home ON home.id = fixtures.home_id JOIN clubs AS away ON away.id = fixtures.away_id LEFT JOIN leagues ON leagues.id = fixtures.league_id`;
const standingSelect = `SELECT standings.*, clubs.name AS club_name, clubs.color AS club_color, clubs.reputation FROM standings JOIN clubs ON clubs.id = standings.club_id`;
const buyBackSelect =
  "SELECT clauses.*,players.name AS player_name,owner.name AS owner_name,beneficiary.name AS beneficiary_name FROM buy_back_clauses AS clauses JOIN players ON players.id = clauses.player_id JOIN clubs AS owner ON owner.id = clauses.owner_id JOIN clubs AS beneficiary ON beneficiary.id = clauses.beneficiary_id";
const sellOnSelect =
  "SELECT clauses.*,players.name AS player_name,owner.name AS owner_name,beneficiary.name AS beneficiary_name FROM sell_on_clauses AS clauses JOIN players ON players.id = clauses.player_id JOIN clubs AS owner ON owner.id = clauses.owner_id JOIN clubs AS beneficiary ON beneficiary.id = clauses.beneficiary_id";
async function transferPayments(store: Store, clubId: number) {
  return await store.all<TransferPayment>(
    "SELECT payments.*,players.name AS player_name,payer.name AS payer_name,payee.name AS payee_name FROM transfer_payments AS payments JOIN players ON players.id = payments.player_id JOIN clubs AS payer ON payer.id = payments.payer_id JOIN clubs AS payee ON payee.id = payments.payee_id WHERE payments.paid_date IS NULL AND (payer_id = ? OR payee_id = ?) ORDER BY due_date,payments.id",
    clubId,
    clubId,
  );
}
const worldTotals = new WeakMap<Store, { key: string; totals: WorldTotals }>();
/** An ILIKE ... ESCAPE '!' pattern matching `text` anywhere. */
export const likePattern = (text: string) => `%${text.replace(/[!%_]/g, "!$&")}%`;
const withoutProfile = (player: Player): Player => ({
  ...player,
  nationalities: (
    JSON.parse(player.profile) as PlayerProfile
  ).identity.nationalities?.map((entry) => entry.country) ?? [
    player.nationality,
  ],
  profile: "",
});

export async function worldClubs(
  store: Store,
  query: unknown,
): Promise<WorldClubPage> {
  const filter = z
    .object({
      q: z.string().max(100).default(""),
      country: z.coerce.number().int().positive().optional(),
      confederation: z
        .enum(["UEFA", "AFC", "CAF", "CONCACAF", "CONMEBOL", "OFC"])
        .optional(),
      type: z.enum(["club", "bteam", "national"]).optional(),
      tier: z.coerce.number().int().min(1).max(20).optional(),
      league: z.coerce.number().int().positive().optional(),
      reputationMin: z.coerce.number().min(0).max(99).default(0),
      sort: z
        .enum(["name", "reputation", "academy", "capacity", "division"])
        .default("reputation"),
      direction: z.enum(["asc", "desc"]).default("desc"),
      page: z.coerce.number().int().min(1).default(1),
      pageSize: z.coerce.number().int().min(10).max(100).default(30),
    })
    .parse(query);
  const conditions = ["clubs.reputation >= ?"];
  const params: (string | number)[] = [filter.reputationMin];
  if (filter.q) {
    const value = likePattern(filter.q);
    conditions.push(
      "(clubs.name ILIKE ? ESCAPE '!' OR clubs.city ILIKE ? ESCAPE '!' OR countries.name ILIKE ? ESCAPE '!')",
    );
    params.push(value, value, value);
  }
  if (filter.country) {
    conditions.push("clubs.country_id = ?");
    params.push(filter.country);
  }
  if (filter.confederation) {
    conditions.push("countries.confederation = ?");
    params.push(filter.confederation);
  }
  if (filter.type) {
    conditions.push("clubs.type = ?");
    params.push(filter.type);
  }
  if (filter.tier) {
    conditions.push("leagues.tier = ?");
    params.push(filter.tier);
  }
  if (filter.league) {
    conditions.push("clubs.league_id = ?");
    params.push(filter.league);
  }
  const joins =
    "FROM clubs JOIN countries ON countries.id = clubs.country_id LEFT JOIN leagues ON leagues.id = clubs.league_id";
  const where = conditions.join(" AND ");
  const total = (await store.get<{ count: number }>(
    `SELECT count(*) AS count ${joins} WHERE ${where}`,
    ...params,
  ))!.count;
  const page = Math.min(
    filter.page,
    Math.max(1, Math.ceil(total / filter.pageSize)),
  );
  const order =
    filter.sort === "division"
      ? "lower(countries.name) ASC,coalesce(leagues.tier,99) ASC,lower(clubs.name) ASC,clubs.id"
      : filter.sort === "name"
        ? `lower(clubs.name) ${filter.direction},clubs.id`
        : `clubs.${filter.sort} ${filter.direction},clubs.id`;
  const clubs = await store.all<WorldClub>(
    `SELECT clubs.*,countries.name AS country_name,countries.code AS country_code,countries.confederation,leagues.name AS league_name,leagues.tier,(SELECT count(*) FROM players WHERE players.club_id = clubs.id AND players.role <> 'Retired') AS squad_size ${joins} WHERE ${where} ORDER BY ${order} LIMIT ? OFFSET ?`,
    ...params,
    filter.pageSize,
    (page - 1) * filter.pageSize,
  );
  return {
    clubs,
    total,
    page,
    pageSize: filter.pageSize,
    pages: Math.max(1, Math.ceil(total / filter.pageSize)),
  };
}

async function clubWorth(store: Store, club: Club) {
  const annualOperatingRevenue = await projectedOperatingRevenue(store, club);
  const { enterpriseValue, revenueMultiple } = clubValuation({
    annualOperatingRevenue,
    reputation: club.reputation,
    cashBalance: club.balance,
    financialDebt: 0,
  });
  return { enterpriseValue, revenueMultiple, annualOperatingRevenue };
}

export async function clubDetail(
  store: Store,
  id: number,
): Promise<ClubDetail> {
  await clubOf(store, id);
  const club = (await store.get<Club>(
    "SELECT clubs.*,countries.name AS country_name,countries.code AS country_code,leagues.name AS league_name FROM clubs JOIN countries ON countries.id = clubs.country_id LEFT JOIN leagues ON leagues.id = clubs.league_id WHERE clubs.id = ?",
    id,
  ))!;
  const age =
    club.age_group === "U17"
      ? 17
      : club.age_group === "U19"
        ? 19
        : club.age_group === "U20"
          ? 20
          : club.age_group === "U21"
            ? 23
            : 100;
  const roster = await store.all<Player>(
    `${playerSelect} WHERE ${club.type === "national" ? "players.country_id" : "players.playing_club_id"} = ? AND players.role <> 'Retired' ${club.type === "national" ? "AND players.age < ?" : ""} ORDER BY players.ability DESC,players.id ${club.type === "national" ? "LIMIT 30" : ""}`,
    club.type === "national" ? club.country_id : id,
    ...(club.type === "national" ? [age] : []),
  );
  return {
    club,
    valuation: club.type === "national" ? null : await clubWorth(store, club),
    affiliates: await clubAffiliates(store, id),
    country: (await store.get<Country>(
      "SELECT * FROM countries WHERE id = ?",
      club.country_id,
    ))!,
    parent: club.parent_id
      ? ((await store.get<Club>(
          "SELECT * FROM clubs WHERE id = ?",
          club.parent_id,
        )) ?? null)
      : null,
    reserves: await store.all<Club>(
      "SELECT * FROM clubs WHERE parent_id = ? ORDER BY name",
      id,
    ),
    players: await withEligibility(store, roster.map(withoutProfile)),
    staff: await store.all<Staff>(
      "SELECT * FROM staff WHERE club_id = ? ORDER BY role,ability DESC",
      id,
    ),
    competitions: await store.all<League>(
      "SELECT leagues.* FROM leagues JOIN standings ON standings.league_id = leagues.id WHERE standings.club_id = ? ORDER BY leagues.age_group,leagues.reputation DESC",
      id,
    ),
    fixtures: (
      await store.all<Fixture>(
        `${fixtureSelect} WHERE (fixtures.home_id = ? OR fixtures.away_id = ?) AND fixtures.status = 'scheduled' ORDER BY fixtures.date,fixtures.id LIMIT 25`,
        id,
        id,
      )
    ).map((fixture) => ({ ...fixture, data: "" })),
    results: (
      await store.all<Fixture>(
        `${fixtureSelect} WHERE (fixtures.home_id = ? OR fixtures.away_id = ?) AND fixtures.status = 'played' ORDER BY fixtures.date DESC,fixtures.id DESC LIMIT 25`,
        id,
        id,
      )
    ).map((fixture) => ({ ...fixture, data: "" })),
    history: await store.all(
      "SELECT season,date,entity_type,data FROM history WHERE (entity_type = 'manager' AND entity_id = ?) OR (entity_type = 'champion' AND data::jsonb -> 'clubId' = to_jsonb(?::integer)) ORDER BY date DESC,id DESC LIMIT 50",
      id,
      id,
    ),
    summary: {
      squadSize: roster.length,
      averageAge:
        roster.reduce((total, player) => total + player.age, 0) /
        Math.max(1, roster.length),
      averageAbility:
        roster.reduce((total, player) => total + player.ability, 0) /
        Math.max(1, roster.length),
      squadValue: roster.reduce((total, player) => total + player.value, 0),
    },
  };
}

export async function bootstrap(store: Store): Promise<Bootstrap> {
  const state = await stateOf(store);
  const club = (await store.get<Club>(
    "SELECT clubs.*, countries.name AS country_name, countries.code AS country_code, leagues.name AS league_name FROM clubs JOIN countries ON countries.id = clubs.country_id LEFT JOIN leagues ON leagues.id = clubs.league_id WHERE clubs.id = ?",
    state.clubId,
  ))!;
  // Counting a full world reads every player row; the totals only change when the world does (new date or new ids).
  const identity = (await store.get<{ players: number | null; staff: number | null }>(
    "SELECT (SELECT max(id) FROM players) AS players, (SELECT max(id) FROM staff) AS staff",
  ))!;
  const key = JSON.stringify([state.careerId, state.seed, state.date, identity.players, identity.staff]);
  let cached = worldTotals.get(store);
  if (cached?.key !== key) {
    cached = {
      key,
      totals: (await store.get<WorldTotals>(
        `SELECT (SELECT count(*) FROM countries) AS countries, (SELECT count(*) FROM leagues WHERE kind = 'league') AS leagues, (SELECT count(*) FROM clubs WHERE type != 'national') AS clubs, people.players, people.seniors, people.youth, (SELECT count(*) FROM staff) AS staff FROM (SELECT count(*) AS players, coalesce(sum(CASE WHEN age_group = 'Senior' THEN 1 ELSE 0 END),0) AS seniors, coalesce(sum(CASE WHEN age_group != 'Senior' THEN 1 ELSE 0 END),0) AS youth FROM players) AS people`,
      ))!,
    };
    worldTotals.set(store, cached);
  }
  const world = {
    ...cached.totals,
    version: (await store.meta<{ version?: number }>("world")).version ?? 1,
  };
  return {
    state,
    club,
    settings: await settingsOf(store),
    world,
    countries: await store.all<Country>(
      "SELECT * FROM countries ORDER BY name",
    ),
  };
}

export async function worldAudit(store: Store) {
  return {
    countries: (
      await store.all<
        Country & { seniorDivisions: number; clubs: number; reserves: number }
      >(
        "SELECT countries.*,(SELECT count(*) FROM leagues WHERE leagues.country_id = countries.id AND leagues.kind = 'league' AND leagues.age_group = 'Senior' AND coalesce(leagues.data::jsonb ->> 'reserveOnly','false') NOT IN ('true','1')) AS \"seniorDivisions\",(SELECT count(*) FROM clubs WHERE clubs.country_id = countries.id AND clubs.type <> 'national') AS clubs,(SELECT count(*) FROM clubs WHERE clubs.country_id = countries.id AND clubs.type = 'bteam') AS reserves FROM countries ORDER BY name",
      )
    ).map((country) => ({
      ...country,
      reservePolicy: reservePolicy(country.code),
      notes: associationNotes(country.code),
    })),
  };
}

export async function dashboard(store: Store): Promise<Dashboard> {
  const state = await stateOf(store);
  const club = await clubOf(store);
  const notifications = await notificationVisibility(store);
  const squad = (await store.get<Dashboard["squad"]>(
    "SELECT count(*) AS count, coalesce(avg(CAST(age AS float)),0) AS age, coalesce(avg(ability),0) AS ability, coalesce(sum(wage),0) AS wages, coalesce(sum(CASE WHEN injury_until IS NOT NULL THEN 1 ELSE 0 END),0) AS injuries, coalesce(sum(value),0) AS value, coalesce(avg(potential),0) AS potential FROM players WHERE club_id = ? AND age_group = 'Senior'",
    state.clubId,
  ))!;
  squad.wages = await weeklyWages(store, state.clubId);
  return {
    squad,
    fixtures: await store.all<Fixture>(
      `${fixtureSelect} WHERE (home_id = ? OR away_id = ?) AND status = 'scheduled' AND (leagues.age_group = 'Senior' OR leagues.id IS NULL) ORDER BY date,fixtures.id LIMIT 5`,
      state.clubId,
      state.clubId,
    ),
    results: await store.all<Fixture>(
      `${fixtureSelect} WHERE (home_id = ? OR away_id = ?) AND status = 'played' AND (leagues.age_group = 'Senior' OR leagues.id IS NULL) ORDER BY date DESC,fixtures.id DESC LIMIT 4`,
      state.clubId,
      state.clubId,
    ),
    table: await store.all<Standing>(
      `${standingSelect} WHERE standings.league_id = ? ORDER BY points DESC, (gf-ga) DESC, gf DESC, club_id`,
      club.league_id,
    ),
    news: await notificationFeed(store, { limit: 12 }),
    shortlist: (
      await store.all<Player>(
        `${playerSelect} WHERE shortlisted = 1 ORDER BY potential DESC,players.id LIMIT 5`,
      )
    ).map(withoutProfile),
    expiring: (
      await store.all<Player>(
        `${playerSelect} WHERE players.club_id = ? AND contract_end <= ? ORDER BY ability DESC,players.id LIMIT 5`,
        state.clubId,
        addDays(state.date, 365),
      )
    ).map(withoutProfile),
    activeNegotiations: (await store.get<{ total: number }>(
      "SELECT count(*) AS total FROM negotiations WHERE (buying_club_id = ? OR selling_club_id = ?) AND stage IN ('Enquiry','Club talks','Agent talks','Contract review','Scheduled','Medical','Registration','Offer received')",
      state.clubId,
      state.clubId,
    ))!.total,
    activeLoans: (await store.get<{ total: number }>(
      "SELECT count(*) AS total FROM loans WHERE (parent_id = ? OR destination_id = ?) AND status = 'active'",
      state.clubId,
      state.clubId,
    ))!.total,
    activeAssignments: (await store.get<{ total: number }>(
      "SELECT count(*) AS total FROM assignments WHERE status = 'active'",
    ))!.total,
    unread: (await store.get<{ total: number }>(
      `SELECT count(*) AS total FROM news WHERE read = 0 AND ${notifications.where}`,
      ...notifications.params,
    ))!.total,
  };
}

const rangeBound = (key: PlayerSearchRange) =>
  z.coerce.number().min(0).max(PLAYER_SEARCH_RANGES[key].high).optional();
/** `${range}Min` / `${range}Max` for every numeric range; an omitted bound restricts nothing. */
const rangeParameters = Object.fromEntries(
  PLAYER_SEARCH_RANGE_KEYS.flatMap((key) => [
    [`${key}Min`, rangeBound(key)],
    [`${key}Max`, rangeBound(key)],
  ]),
) as { [Key in PlayerSearchRange as `${Key}Min` | `${Key}Max`]: ReturnType<typeof rangeBound> };

export const playerFilter = z.object({
  ...rangeParameters,
  q: z.string().max(100).default(""),
  position: z.enum(POSITIONS).optional(),
  country: z.coerce.number().int().positive().optional(),
  club: z.coerce.number().int().positive().optional(),
  /** Country of the player's club (not the player's nationality). */
  clubCountry: z.coerce.number().int().positive().optional(),
  league: z.coerce.number().int().positive().optional(),
  ageGroup: z.enum(["Senior", "U19", "U17", "U20", "U21"]).optional(),
  contractStatus: z.enum(["professional", "amateur"]).optional(),
  foot: z.enum(["Right", "Left", "Both"]).optional(),
  lifestyle: z.string().max(40).optional(),
  trait: z.string().max(80).optional(),
  attribute: z.string().max(60).optional(),
  personality: z.string().max(60).optional(),
  shortlisted: z.enum(["1", "0"]).optional(),
  listed: z.enum(["1", "0"]).optional(),
  availableLoan: z.enum(["1", "0"]).optional(),
  freeAgent: z.enum(["1", "0"]).optional(),
  injured: z.enum(["1", "0"]).optional(),
  sort: z
    .enum([
      "ability",
      "potential",
      "value",
      "age",
      "name",
      "position",
      "nationality",
      "club",
      "wage",
      "form",
      "fitness",
      "morale",
      "appearances",
      "goals",
      "minutes",
      "contract",
      "contract_end",
      "height",
      "weight",
    ])
    .default("ability"),
  direction: z.enum(["asc", "desc"]).default("desc"),
  page: z.coerce.number().int().min(1).max(100000).default(1),
  pageSize: z.coerce.number().int().min(10).max(100).default(30),
});

type PlayerFilter = z.infer<typeof playerFilter>;
/** Player searches count at most this many matches; larger results report `totalCapped`. */
export const PLAYER_SEARCH_CAP = 10_000;
/**
 * A profile-JSON condition (skill level, lifestyle, trait, contract status) is checked on at most this many
 * candidates: the players passing every column condition, taken in the requested order. Parsing a profile costs
 * about 20 µs here (several times that on a Raspberry Pi), so a rare match can no longer scan the whole world. The
 * pages shown are exact; beyond the candidates the total is a lower bound ("1,234+").
 */
export const PROFILE_SEARCH_CANDIDATES = 10_000;
/** Names sort case-insensitively; lower(players.name) is the player_name index. */
const sortName = (column: string) => `lower(${column})`;

type SearchColumn = (name: string) => string;
type SearchClause = (column: SearchColumn) => string;
type SearchOrder = (column: SearchColumn) => { order: string; joins: string[] };
/** One WHERE condition and the parameters of its placeholders. */
interface SearchCondition {
  clause: SearchClause;
  params: SqlParameter[];
}

/** The player search over `FROM players`: one alias, so the planner can combine the player indexes (bitmap AND/OR). */
export interface PlayerSearch {
  /** Extra joins only ORDER BY needs. */
  joins: string;
  where: string;
  order: string;
  params: SqlParameter[];
  /** A filter parses the profile JSON of every row it examines (no index can serve it). */
  readsProfile: boolean;
  /** The conditions on table columns (all of `where` unless `readsProfile`) and their parameters. */
  columnWhere: string;
  columnParams: SqlParameter[];
  /** The profile-JSON conditions over `profile_json.doc` (PROFILE_JSON parses each profile once), or null. */
  profileWhere: string | null;
  profileParams: SqlParameter[];
  /** Anything beyond "not retired". */
  filtered: boolean;
}

/** Join exposing each row's profile as jsonb, parsed once however many conditions read it (OFFSET 0 keeps it a subquery). */
const PROFILE_JSON = "CROSS JOIN LATERAL (SELECT players.profile::jsonb AS doc OFFSET 0) AS profile_json";

function compileSearch(conditions: SearchCondition[], orderOf: SearchOrder): PlayerSearch {
  const column: SearchColumn = (name) => `players.${name}`;
  const compiled = conditions.map(({ clause, params }) => {
    let profile = false;
    const sql = clause((name) => {
      if (name === "profile") profile = true;
      return column(name);
    });
    // `profile_json.doc::jsonb` is a no-op cast.
    const parsed = profile ? clause((name) => (name === "profile" ? "profile_json.doc" : column(name))) : sql;
    return { sql, parsed, params, profile };
  });
  const columns = compiled.filter((condition) => !condition.profile);
  const profile = compiled.filter((condition) => condition.profile);
  const where = (items: typeof compiled) => items.map((condition) => condition.sql).join(" AND ");
  const ordered = orderOf(column);
  return {
    joins: ordered.joins.join(" "),
    where: where(compiled),
    order: ordered.order,
    params: compiled.flatMap((condition) => condition.params),
    readsProfile: profile.length > 0,
    columnWhere: where(columns),
    columnParams: columns.flatMap((condition) => condition.params),
    profileWhere: profile.length ? profile.map((condition) => condition.parsed).join(" AND ") : null,
    profileParams: profile.flatMap((condition) => condition.params),
    filtered: compiled.length > 1,
  };
}

/** A numeric profile field; `path` is a literal key path such as `{baseAbility}`. */
const profileNumber = (column: SearchColumn, path: string) =>
  `(${column("profile")}::jsonb #>> '${path}')::double precision`;

/** ORDER BY for the player search: missing values last in both directions, ties by name then id. */
function playerOrder(
  sort: PlayerFilter["sort"],
  direction: "asc" | "desc",
): SearchOrder {
  return (column) => {
    const order = direction === "asc" ? "ASC" : "DESC";
    const reverse = direction === "asc" ? "DESC" : "ASC";
    const joins: string[] = [];
    const missingLast = (sql: string) => `${sql} ${order} NULLS LAST`;
    const contract = () =>
      `CASE WHEN ${column("club_id")} IS NULL THEN 1 ELSE 0 END,${column("contract_end")} ${order}`;
    const keys: Record<typeof sort, () => string> = {
      name: () => `${sortName(column("name"))} ${order}`,
      position: () =>
        `CASE ${column("position")} ${POSITIONS.map((position, index) => `WHEN '${position}' THEN ${index}`).join(" ")} ELSE ${POSITIONS.length} END ${order}`,
      age: () => `${column("age")} ${order},${column("birth_date")} ${reverse}`,
      // players.nationality is always the name of players.country_id (people.ts; never updated).
      nationality: () => {
        joins.push(`JOIN countries AS nationality ON nationality.id = ${column("country_id")}`);
        return `${sortName("nationality.name")} ${order}`;
      },
      club: () => {
        joins.push(`LEFT JOIN clubs ON clubs.id = ${column("club_id")}`);
        return missingLast(sortName("clubs.name"));
      },
      ability: () => `${column("ability")} ${order}`,
      potential: () => `${column("potential")} ${order}`,
      value: () => `${column("value")} ${order}`,
      wage: () => `${column("wage")} ${order}`,
      form: () => `${column("form")} ${order}`,
      fitness: () => `${column("fitness")} ${order}`,
      morale: () => `${column("morale")} ${order}`,
      appearances: () => `${column("appearances")} ${order}`,
      goals: () => `${column("goals")} ${order},${column("assists")} ${order}`,
      minutes: () => `${column("minutes")} ${order}`,
      contract,
      contract_end: contract,
      height: () => missingLast(column("height")),
      weight: () => missingLast(column("weight")),
    };
    return {
      order: `${keys[sort]()},${sortName(column("name"))} ASC,${column("id")} ASC`,
      joins,
    };
  };
}

/** Ranges over one player column, in clause order; skill, contract and division ranges have their own SQL. */
const rangeColumns: Partial<Record<PlayerSearchRange, (column: SearchColumn) => string>> = {
  age: (column) => column("age"),
  ability: (column) => column("ability"),
  potential: (column) => column("potential"),
  value: (column) => column("value"),
  wage: (column) => column("wage"),
  form: (column) => column("form"),
  appearances: (column) => column("appearances"),
  goals: (column) => column("goals"),
  assists: (column) => column("assists"),
  minutes: (column) => column("minutes"),
  // Plain columns copied from the profile (migration 11), indexed.
  height: (column) => column("height"),
  weight: (column) => column("weight"),
};

/**
 * The player-search WHERE/ORDER BY. Default ranges are omitted so the planner only sees real restrictions;
 * `today` dates contract ranges and `secondaryNationals` are the ids holding `filter.country` as a second nationality.
 */
export function playerSearch(
  filter: PlayerFilter,
  context: { today?: string; secondaryNationals?: readonly number[] } = {},
): PlayerSearch {
  const conditions: SearchCondition[] = [{ clause: (column) => `${column("role")} <> 'Retired'`, params: [] }];
  const where = (clause: SearchClause, ...params: SqlParameter[]) => conditions.push({ clause, params });
  const bounds = (key: PlayerSearchRange) =>
    searchBounds(key, filter[`${key}Min`], filter[`${key}Max`]);
  /** `valueParams` bind the placeholders inside `value` (repeated for each bound). */
  const range = (
    key: PlayerSearchRange,
    value: (column: SearchColumn) => string,
    ...valueParams: SqlParameter[]
  ) => {
    const { from, to } = bounds(key);
    if (from !== undefined) where((column) => `${value(column)} >= ?`, ...valueParams, from);
    if (to !== undefined) where((column) => `${value(column)} <= ?`, ...valueParams, to);
  };
  for (const [key, value] of Object.entries(rangeColumns) as [PlayerSearchRange, (column: SearchColumn) => string][])
    range(key, value);
  if (filter.q) {
    const search = likePattern(filter.q);
    // = ANY(ARRAY(subquery)) runs each lookup once and keeps country_id/club_id index scans open to a BitmapOr.
    where(
      (column) =>
        `(${column("name")} ILIKE ? ESCAPE '!' OR ${column("country_id")} = ANY(ARRAY(SELECT countries.id FROM countries WHERE countries.name ILIKE ? ESCAPE '!')) OR ${column("club_id")} = ANY(ARRAY(SELECT clubs.id FROM clubs WHERE clubs.name ILIKE ? ESCAPE '!')))`,
      search,
      search,
      search,
    );
  }
  if (filter.position) where((column) => `${column("position")} = ?`, filter.position);
  if (filter.country) {
    const secondary = context.secondaryNationals ?? [];
    if (secondary.length)
      where(
        (column) => `(${column("country_id")} = ? OR ${column("id")} = ANY(?::int[]))`,
        filter.country,
        secondary,
      );
    else where((column) => `${column("country_id")} = ?`, filter.country);
  }
  if (filter.club) where((column) => `${column("club_id")} = ?`, filter.club);
  // A semi-join on the (small) clubs table: the planner sees how many players the club set covers, so a broad
  // set (all top flights) still walks player_ability for the first page and a narrow one uses player_club.
  const tier = bounds("tier");
  const tiered = tier.from !== undefined || tier.to !== undefined;
  if (filter.clubCountry || filter.league || tiered) {
    const scope: string[] = [];
    const values: SqlParameter[] = [];
    if (filter.clubCountry) {
      scope.push("clubs.country_id = ?");
      values.push(filter.clubCountry);
    }
    if (filter.league) {
      scope.push("clubs.league_id = ?");
      values.push(filter.league);
    }
    if (tiered) {
      scope.push("leagues.tier >= ? AND leagues.tier <= ?");
      values.push(tier.from ?? PLAYER_SEARCH_RANGES.tier.low, tier.to ?? PLAYER_SEARCH_RANGES.tier.high);
    }
    where(
      (column) =>
        `${column("club_id")} IN (SELECT clubs.id FROM clubs${tiered ? " JOIN leagues ON leagues.id = clubs.league_id" : ""} WHERE ${scope.join(" AND ")})`,
      ...values,
    );
  }
  if (filter.ageGroup) where((column) => `${column("age_group")} = ?`, filter.ageGroup);
  if (filter.contractStatus)
    where(
      (column) => `coalesce(${column("profile")}::jsonb #>> '{contract,status}','professional') = ?`,
      filter.contractStatus,
    );
  if (filter.foot) where((column) => `${column("foot")} = ?`, filter.foot);
  if (filter.lifestyle)
    where((column) => `${column("profile")}::jsonb ->> 'lifestyle' = ?`, filter.lifestyle);
  if (filter.trait)
    where(
      (column) => `(${column("profile")}::jsonb -> 'traits') @> jsonb_build_array(?::text)`,
      filter.trait,
    );
  if (filter.attribute) {
    const attribute = filter.attribute;
    const group = Object.entries(ATTRIBUTE_GROUPS).find(([, keys]) => keys.includes(attribute))?.[0];
    if (!group) throw new GameError("Unknown player attribute.");
    // SQL mirror of shared `currentAttribute` (a missing baseAbility means no change since generation).
    range(
      "attribute",
      (column) =>
        `((${column("profile")}::jsonb #>> ?::text[])::double precision + (${column("ability")} - coalesce(${profileNumber(column, "{baseAbility}")},${column("ability")})))`,
      ["attributes", group, attribute],
    );
  }
  if (filter.personality) {
    const personality = filter.personality;
    if (!PERSONALITY_KEYS.includes(personality))
      throw new GameError("Unknown personality attribute.");
    range(
      "personality",
      (column) => `(${column("profile")}::jsonb #>> ?::text[])::double precision`,
      ["personality", personality],
    );
  }
  const contract = bounds("contractMonths");
  if (contract.from !== undefined || contract.to !== undefined) {
    const today = context.today;
    if (!today) throw new Error("A contract range needs today's date.");
    if (contract.from !== undefined)
      where((column) => `${column("contract_end")} >= ?`, addMonths(today, contract.from));
    if (contract.to !== undefined)
      where((column) => `${column("contract_end")} <= ?`, addMonths(today, contract.to));
  }
  // Matches the predicate of the partial index player_shortlist.
  if (filter.shortlisted === "1") where((column) => `${column("shortlisted")} = 1`);
  if (filter.shortlisted === "0") where((column) => `${column("shortlisted")} = 0`);
  if (filter.listed) where((column) => `${column("listed")} = ?`, Number(filter.listed));
  if (filter.availableLoan)
    where((column) => `${column("available_loan")} = ?`, Number(filter.availableLoan));
  if (filter.freeAgent === "1") where((column) => `${column("club_id")} IS NULL`);
  if (filter.injured === "1") where((column) => `${column("injury_until")} IS NOT NULL`);
  if (filter.injured === "0") where((column) => `${column("injury_until")} IS NULL`);
  return compileSearch(conditions, playerOrder(filter.sort, filter.direction));
}

/** Ranks a known id set (int[] parameter) by the search sort: primary-key lookups, no scan. */
export function playerRanking(filter: Pick<PlayerFilter, "sort" | "direction">): PlayerSearch {
  return compileSearch(
    [{ clause: (column) => `${column("id")} = ANY(?::int[])`, params: [] }],
    playerOrder(filter.sort, filter.direction),
  );
}

/** `partial`: a profile-JSON search had more candidates than it checks, so `count` is a lower bound. */
type SearchMatches = { at: number; count: number; ids?: number[]; partial?: boolean };
interface SearchCounts {
  generation: number;
  matches: Map<string, SearchMatches>;
  active?: { key: string; total: number };
  nationals?: { key: string; maxId: number; byCountry: Map<number, number[]> };
}
const searchCounts = new WeakMap<Store, SearchCounts>();
const MATCH_CACHE_SIZE = 32;
const MATCH_CACHE_MS = 10 * 60_000;
function searchCountsOf(store: Store) {
  let counts = searchCounts.get(store);
  if (!counts) {
    counts = { generation: 0, matches: new Map() };
    searchCounts.set(store, counts);
  }
  return counts;
}

/** Called after every world mutation: cached player-search matches belong to one revision of the world. */
export function playerSearchChanged(store: Store, worldReplaced = false) {
  const counts = searchCountsOf(store);
  counts.matches.clear();
  if (worldReplaced) {
    counts.generation++;
    counts.active = undefined;
    counts.nationals = undefined;
    worldTotals.delete(store);
  }
}

/** Pure: `byCountry` plus the new (id, second nationality) rows; one array copy per country, the input is not mutated. */
export function addNationals(byCountry: ReadonlyMap<number, number[]>, rows: Iterable<{ id: number; country: number }>) {
  const added = new Map<number, number[]>();
  for (const row of rows) {
    const ids = added.get(row.country);
    if (ids) ids.push(row.id);
    else added.set(row.country, [row.id]);
  }
  const next = new Map(byCountry);
  for (const [country, ids] of added) next.set(country, [...(byCountry.get(country) ?? []), ...ids]);
  return next;
}
const NATIONALS_BATCH_IDS = 25_000;

/** Ids holding `countryId` as a second nationality. Nationalities are set when a player is created, so only new ids are read. */
async function secondaryNationals(
  store: Store,
  state: { careerId?: string; seed: string },
  countryId: number,
) {
  const counts = searchCountsOf(store);
  const key = JSON.stringify([state.careerId, state.seed, counts.generation]);
  const maxId =
    (await store.get<{ id: number | null }>("SELECT max(id) AS id FROM players"))!.id ?? 0;
  let known = counts.nationals;
  if (known?.key !== key || maxId < known.maxId)
    known = { key, maxId: 0, byCountry: new Map() };
  if (maxId > known.maxId) {
    const rows: { id: number; country: number }[] = [];
    // Primary-key range batches, yielding between them so a cold build on a full world never blocks other accounts.
    for (let from = known.maxId; from < maxId; from += NATIONALS_BATCH_IDS) {
      for (const row of await store.all<{ id: number; country: number }>(
        "SELECT players.id, nationality.\"countryId\" AS country FROM players CROSS JOIN LATERAL jsonb_to_recordset(players.profile::jsonb #> '{identity,nationalities}') AS nationality(\"countryId\" integer) WHERE players.id > ? AND players.id <= ? AND nationality.\"countryId\" <> players.country_id",
        from,
        Math.min(maxId, from + NATIONALS_BATCH_IDS),
      ))
        rows.push(row);
      await new Promise((resolve) => setImmediate(resolve));
    }
    known = { key, maxId, byCountry: addNationals(known.byCountry, rows) };
  }
  counts.nationals = known;
  return known.byCountry.get(countryId) ?? [];
}

/**
 * Matches of a profile-JSON search: the column conditions pick at most `limit` candidates in the search order
 * (indexes serve them), then the profile conditions are checked on those rows only, by primary key. The ids are
 * kept, so ranking and paging never parse a profile again.
 */
async function profileMatches(store: Store, search: PlayerSearch, limit: number): Promise<SearchMatches> {
  const candidates = (
    await store.all<{ id: number }>(
      `SELECT players.id FROM players ${search.joins} WHERE ${search.columnWhere} ORDER BY ${search.order} LIMIT ?`,
      ...search.columnParams,
      limit + 1,
    )
  ).map((row) => row.id);
  const partial = candidates.length > limit;
  const examined = candidates.slice(0, limit);
  const ids = examined.length
    ? (
        await store.all<{ id: number }>(
          `SELECT players.id FROM players ${PROFILE_JSON} WHERE players.id = ANY(?::int[]) AND ${search.profileWhere}`,
          examined,
          ...search.profileParams,
        )
      ).map((row) => row.id)
    : [];
  return { at: Date.now(), count: ids.length, ids, partial };
}

/** Exact count of non-retired players for the unfiltered search (retirements and new players only happen on new days/ids). */
async function activePlayers(
  store: Store,
  state: { careerId?: string; seed: string; date: string },
) {
  const counts = searchCountsOf(store);
  const maxId = (await store.get<{ id: number | null }>("SELECT max(id) AS id FROM players"))!.id;
  const key = JSON.stringify([state.careerId, state.seed, state.date, counts.generation, maxId]);
  if (counts.active?.key !== key)
    counts.active = {
      key,
      total: (await store.get<{ count: number }>(
        "SELECT count(*) AS count FROM players WHERE role <> 'Retired'",
      ))!.count,
    };
  return counts.active.total;
}

/** Transfer rules and the registration a signing by the user's club would get (registration never blocks it). */
async function signingPreview(store: Store, playerId: number, clubId: number, kind: "transfer" | "free") {
  const { ok, reasons } = await canSign(store, playerId, clubId, kind);
  return { ok, reasons, registration: await predictRegistration(store, playerId, clubId) };
}

/** Adds the registration badge of each listed player (two queries per list). */
async function withEligibility<Row extends Player>(store: Store, rows: Row[]): Promise<Row[]> {
  const summaries = await eligibilitySummaries(store, rows);
  return rows.map((row) => ({ ...row, eligibility: summaries.get(row.id) }));
}

/** Search rows also carry the current body and whether a club-less player belongs to a home-based pool. */
function searchRow(player: Player) {
  const profile = JSON.parse(player.profile) as PlayerProfile;
  return {
    ...withoutProfile(player),
    height: profile.identity.height ?? null,
    weight: profile.identity.weight ?? null,
    home_based: player.club_id === null && profile.homeBased ? 1 : 0,
  };
}

export async function players(
  store: Store,
  query: unknown,
  limits: { profileCandidates?: number } = {},
): Promise<PlayerPage> {
  const candidates = limits.profileCandidates ?? PROFILE_SEARCH_CANDIDATES;
  const filter = playerFilter.parse(query);
  const state = await stateOf(store);
  const search = playerSearch(filter, {
    today: state.date,
    secondaryNationals: filter.country
      ? await secondaryNationals(store, state, filter.country)
      : [],
  });
  // A column-only match set ignores sort and paging, so changing either reuses it until the world changes; a
  // profile-JSON one depends on the order its candidates are taken in.
  const counts = searchCountsOf(store);
  const key = JSON.stringify([
    state.careerId,
    state.seed,
    state.date,
    {
      ...filter,
      ...(search.readsProfile ? {} : { sort: undefined, direction: undefined }),
      page: undefined,
      pageSize: undefined,
    },
    search.readsProfile ? candidates : null,
  ]);
  const cached = counts.matches.get(key);
  const matches: SearchMatches =
    cached && Date.now() - cached.at <= MATCH_CACHE_MS
      ? cached
      : search.readsProfile
        ? await profileMatches(store, search, candidates)
        : {
            at: Date.now(),
            count: (await store.get<{ count: number }>(
              `SELECT count(*) AS count FROM (SELECT players.id FROM players WHERE ${search.where} LIMIT ${PLAYER_SEARCH_CAP + 1}) AS matches`,
              ...search.params,
            ))!.count,
          };
  counts.matches.delete(key);
  counts.matches.set(key, matches);
  while (counts.matches.size > MATCH_CACHE_SIZE)
    counts.matches.delete(counts.matches.keys().next().value!);
  const partial = matches.partial === true;
  const capped = partial || matches.count > PLAYER_SEARCH_CAP;
  const total =
    partial || !capped
      ? matches.count
      : search.filtered
        ? PLAYER_SEARCH_CAP
        : await activePlayers(store, state);
  const pages = Math.max(1, Math.ceil(total / filter.pageSize));
  const page = Math.min(filter.page, pages);
  let ids: number[] = [];
  if (total > 0) {
    const known = partial || !capped ? matches.ids : undefined;
    const ranked = known ? playerRanking(filter) : search;
    const params = known ? [known] : search.params;
    ids = (
      await store.all<{ id: number }>(
        `SELECT players.id FROM players ${ranked.joins} WHERE ${ranked.where} ORDER BY ${ranked.order} LIMIT ? OFFSET ?`,
        ...params,
        filter.pageSize,
        (page - 1) * filter.pageSize,
      )
    ).map((row) => row.id);
  }
  // Display columns and joins only for the page.
  const rows = new Map(
    (ids.length
      ? await store.all<Player>(
          `${playerSelect} WHERE players.id = ANY(?::int[])`,
          ids,
        )
      : []
    ).map((player) => [player.id, player]),
  );
  return {
    players: await withEligibility(
      store,
      ids.flatMap((id) => {
        const player = rows.get(id);
        return player ? [searchRow(player)] : [];
      }),
    ),
    total,
    totalCapped: capped && search.filtered,
    page,
    pageSize: filter.pageSize,
    pages,
  };
}

/** valuation() context of the weekly revaluation (simulation.developPlayers); `club` null = club-less player. */
export function playerValueContext(
  market: { reputation: number | null; code: string | null } | undefined,
  club: Pick<Club, "reputation" | "balance" | "philosophy" | "crisis" | "hype"> | null,
  date: string,
  inflation: number,
) {
  return {
    date,
    leagueReputation: Number(market?.reputation ?? club?.reputation ?? 30),
    marketFactor: marketValueFactor(market?.code),
    balance: club?.balance ?? 0,
    philosophy: club?.philosophy ?? "",
    inflation,
    crisis: club?.crisis ?? 0,
    hype: club?.hype ?? 0,
  };
}

export async function playerDetail(
  store: Store,
  id: number,
): Promise<PlayerDetail> {
  await playerOf(store, id);
  const player = (await store.get<Player>(
    `${playerSelect} WHERE players.id = ?`,
    id,
  ))!;
  const profile = JSON.parse(player.profile) as PlayerProfile;
  if (!profile.identity.biography?.length)
    profile.identity.biography = describeIdentity(
      profile.identity,
      peopleContext(await store.all<Country>("SELECT * FROM countries")),
    );
  const club = player.club_id
    ? await clubOf(store, player.club_id)
    : await clubOf(store);
  // Same context as the weekly revaluation: the club's league, or the nation's league for club-less players.
  const market = await store.get<{ reputation: number; code: string | null }>(
    player.club_id
      ? "SELECT COALESCE(leagues.reputation, clubs.reputation) AS reputation, (SELECT code FROM countries WHERE countries.id = COALESCE(leagues.country_id, clubs.country_id)) AS code FROM clubs LEFT JOIN leagues ON leagues.id = clubs.league_id WHERE clubs.id = ?"
      : "SELECT reputation, code FROM countries WHERE id = ?",
    player.club_id ?? profile.homeBased?.countryId ?? profile.registration?.lastAssociationId ?? player.country_id,
  );
  const state = await stateOf(store);
  const settings = await settingsOf(store);
  const staff = (await store.get<{ ability: number }>(
    "SELECT coalesce(avg(CAST(ability AS float)),50) AS ability FROM staff WHERE club_id = ?",
    club.id,
  ))!.ability;
  return {
    canManage: await canManagePlayer(store, player),
    squadDestinations: await squadDestinations(store, player),
    youthTransfer: await assessYouthTransfer(
      store,
      player,
      await clubOf(store),
    ),
    eligibility: await playerEligibility(store, id),
    signing:
      player.club_id === state.clubId || player.parent_club_id === state.clubId
        ? null
        : await signingPreview(store, id, state.clubId, player.club_id ? "transfer" : "free"),
    interest: await assessPlayerInterest(store, player, await clubOf(store)),
    buyBackClauses: await store.all(
      `${buyBackSelect} WHERE clauses.player_id = ? AND clauses.status = 'active' AND clauses.expires >= ? ORDER BY clauses.expires`,
      id,
      state.date,
    ),
    sellOnClauses: await store.all(
      `${sellOnSelect} WHERE clauses.player_id = ? AND clauses.status IN ('active','triggered') ORDER BY clauses.id DESC`,
      id,
    ),
    player: withoutProfile(player),
    profile,
    report:
      (await store.get<ScoutReport>(
        "SELECT reports.*, staff.name AS scout_name FROM reports JOIN staff ON staff.id = reports.staff_id WHERE player_id = ? ORDER BY reports.id DESC LIMIT 1",
        id,
      )) ?? null,
    value: valuation(
      player,
      playerValueContext(
        market,
        player.club_id ? club : null,
        state.date,
        Number(settings.transferInflation),
      ),
    ),
    development: potentialInfluences(player, profile, {
      staff,
      academy: club.academy,
      chemistry: club.chemistry,
      fit: tacticalFit(player, club),
      culture: club.culture,
      director:
        club.id === state.clubId
          ? state.director.reputation
          : club.reputation * 0.75,
      fans: club.fan_mood,
      media: Number(settings.mediaPressure),
      tournament: player.age_group !== "Senior" && player.form > 7 ? 15 : 0,
      intensity: Number(settings.potentialIntensity),
      lifestyleImpact: Number(settings.lifestyleImpact),
    }),
    history: await store.all(
      "SELECT date, data, entity_type FROM history WHERE entity_id = ? AND entity_type IN ('appearance','transfer') ORDER BY id DESC LIMIT 20",
      id,
    ),
    promises: await store.all(
      "SELECT * FROM promises WHERE player_id = ? ORDER BY id DESC",
      id,
    ),
    loan:
      (await store.get<Loan>(
        "SELECT * FROM loans WHERE player_id = ? AND status = 'active'",
        id,
      )) ?? null,
  };
}

export async function playerCareer(
  store: Store,
  id: number,
  query: unknown,
): Promise<PlayerCareer> {
  await playerOf(store, id);
  const filter = z
    .object({
      season: z.coerce.number().int().min(2026).max(9999).optional(),
      club: z.coerce.number().int().positive().optional(),
      competition: z.coerce.number().int().min(0).optional(),
      page: z.coerce.number().int().min(1).default(1),
      pageSize: z.coerce.number().int().min(10).max(100).default(30),
    })
    .parse(query);
  const seasons = await store.all<PlayerCareer["seasons"][number]>(
    "SELECT season,count(*) AS appearances,sum(started) AS starts,sum(minutes) AS minutes,sum(goals) AS goals,sum(assists) AS assists,avg(rating) AS rating FROM player_match_appearances WHERE player_id = ? GROUP BY season ORDER BY season DESC",
    id,
  );
  const selectedSeason = filter.season ?? seasons[0]?.season ?? null;
  const conditions = ["appearance.player_id = ?"];
  const params: (string | number)[] = [id];
  if (selectedSeason !== null) {
    conditions.push("appearance.season = ?");
    params.push(selectedSeason);
  }
  if (filter.club) {
    conditions.push("appearance.club_id = ?");
    params.push(filter.club);
  }
  if (filter.competition !== undefined) {
    conditions.push("coalesce(fixtures.league_id,0) = ?");
    params.push(filter.competition);
  }
  const where = conditions.join(" AND ");
  const total = (await store.get<{ count: number }>(
    `SELECT count(*) AS count FROM player_match_appearances AS appearance JOIN fixtures ON fixtures.id = appearance.fixture_id WHERE ${where}`,
    ...params,
  ))!.count;
  const page = Math.min(
    filter.page,
    Math.max(1, Math.ceil(total / filter.pageSize)),
  );
  const appearances = (
    await store.all<Omit<PlayerAppearance, "stats"> & { stats: string }>(
      `SELECT appearance.*,clubs.name AS club_name,clubs.color AS club_color,fixtures.home_id,fixtures.away_id,home.name AS home_name,away.name AS away_name,home.color AS home_color,away.color AS away_color,fixtures.home_goals,fixtures.away_goals,fixtures.league_id,coalesce(leagues.name,'Friendly') AS competition_name,coalesce(leagues.age_group,'Senior') AS age_group,fixtures.stage FROM player_match_appearances AS appearance JOIN fixtures ON fixtures.id = appearance.fixture_id JOIN clubs ON clubs.id = appearance.club_id JOIN clubs AS home ON home.id = fixtures.home_id JOIN clubs AS away ON away.id = fixtures.away_id LEFT JOIN leagues ON leagues.id = fixtures.league_id WHERE ${where} ORDER BY appearance.date DESC,appearance.fixture_id DESC LIMIT ? OFFSET ?`,
      ...params,
      filter.pageSize,
      (page - 1) * filter.pageSize,
    )
  ).map((row) => ({
    ...row,
    stats: JSON.parse(row.stats) as Record<string, number>,
  }));
  const seasonWhere =
    selectedSeason === null ? "" : " AND appearance.season = ?";
  const seasonParams = selectedSeason === null ? [id] : [id, selectedSeason];
  return {
    seasons,
    selectedSeason,
    appearances,
    total,
    page,
    pageSize: filter.pageSize,
    pages: Math.max(1, Math.ceil(total / filter.pageSize)),
    teams: await store.all(
      `SELECT clubs.id,clubs.name,clubs.color,count(*) AS appearances,sum(appearance.minutes) AS minutes FROM player_match_appearances AS appearance JOIN clubs ON clubs.id = appearance.club_id WHERE appearance.player_id = ?${seasonWhere} GROUP BY clubs.id,clubs.name,clubs.color ORDER BY appearances DESC,clubs.id`,
      ...seasonParams,
    ),
    competitions: await store.all(
      `SELECT leagues.id,coalesce(leagues.name,'Friendlies') AS name,count(*) AS appearances,sum(appearance.minutes) AS minutes,sum(appearance.goals) AS goals,sum(appearance.assists) AS assists,avg(appearance.rating) AS rating FROM player_match_appearances AS appearance JOIN fixtures ON fixtures.id = appearance.fixture_id LEFT JOIN leagues ON leagues.id = fixtures.league_id WHERE appearance.player_id = ?${seasonWhere} GROUP BY leagues.id,leagues.name ORDER BY appearances DESC,leagues.id`,
      ...seasonParams,
    ),
  };
}

export async function squad(
  store: Store,
  input: unknown = {},
): Promise<SquadData> {
  const state = await stateOf(store);
  const filter = z
    .object({
      club: z.coerce.number().int().positive().default(state.clubId),
      ageGroup: z.enum(["Senior", "U19", "U17"]).default("Senior"),
    })
    .parse(input);
  const clubs = await clubSquads(store);
  if (!clubs.some((club) => club.id === filter.club))
    throw new GameError("Choose one of your club's squads.");
  const all = await store.all<Player>(
    `${playerSelect} WHERE players.playing_club_id = ? AND players.role <> 'Retired' ORDER BY players.ability DESC`,
    filter.club,
  );
  const senior = all.filter((player) => player.age_group === filter.ageGroup);
  return {
    clubs,
    selectedClubId: filter.club,
    ageGroup: filter.ageGroup,
    players: await withEligibility(store, senior.map(withoutProfile)),
    matrix: relationshipMatrix(senior),
    succession: POSITIONS.map((position) => {
      const current = senior.find((player) => player.position === position);
      const prospect = all
        .filter(
          (player) =>
            player.position === position &&
            player.age < 22 &&
            player.id !== current?.id,
        )
        .sort((left, right) => right.potential - left.potential)[0];
      return {
        position,
        current: current?.name ?? null,
        currentId: current?.id ?? null,
        age: current?.age ?? null,
        prospect: prospect ? withoutProfile(prospect) : null,
        risk: !current
          ? "Vacant"
          : current.age >= 30
            ? "Plan succession"
            : !prospect
              ? "No young cover"
              : "Covered",
      };
    }),
    promises: await store.all(
      "SELECT promises.*, players.name AS player_name FROM promises LEFT JOIN players ON players.id = promises.player_id ORDER BY promises.id DESC LIMIT 30",
    ),
  };
}

export async function scouting(store: Store): Promise<ScoutingData> {
  const clubId = (await stateOf(store)).clubId;
  return {
    scouts: await store.all<Staff>(
      "SELECT * FROM staff WHERE club_id = ? AND role = 'Scout' ORDER BY ability DESC",
      clubId,
    ),
    assignments: await store.all(
      "SELECT assignments.*, staff.name AS scout_name, players.name AS player_name, countries.name AS country_name FROM assignments JOIN staff ON staff.id = assignments.staff_id LEFT JOIN players ON players.id = assignments.player_id LEFT JOIN countries ON countries.id = assignments.country_id ORDER BY assignments.id DESC LIMIT 30",
    ),
    reports: await store.all(
      "SELECT reports.*, players.name AS player_name, players.position, players.age, players.club_id, clubs.name AS club_name, staff.name AS scout_name FROM reports JOIN players ON players.id = reports.player_id LEFT JOIN clubs ON clubs.id = players.club_id JOIN staff ON staff.id = reports.staff_id ORDER BY reports.id DESC LIMIT 50",
    ),
    shortlist: (
      await store.all<Player>(
        `${playerSelect} WHERE shortlisted = 1 ORDER BY potential DESC,players.id LIMIT 100`,
      )
    ).map(withoutProfile),
  };
}

export async function transfers(store: Store): Promise<TransferDesk> {
  const id = (await stateOf(store)).clubId;
  const negotiations = await withBattleViews(
    store,
    await store.all<Negotiation>(
      "SELECT negotiations.*, players.name AS player_name, players.position, players.age, players.ability, players.potential, (players.profile::jsonb #>> '{contract,releaseClause}')::double precision AS release_clause, buyer.name AS buyer_name, buyer.color AS buyer_color, buyer.reputation AS buyer_reputation, seller.name AS seller_name FROM negotiations JOIN players ON players.id = negotiations.player_id JOIN clubs AS buyer ON buyer.id = negotiations.buying_club_id LEFT JOIN clubs AS seller ON seller.id = negotiations.selling_club_id WHERE buying_club_id = ? OR selling_club_id = ? ORDER BY negotiations.id DESC",
      id,
      id,
    ),
  );
  const affiliateStages = ["Contract review", "Scheduled", "Medical", "Registration"];
  const needsAffiliateOptions = negotiations.some((negotiation) => {
    if (negotiation.buying_club_id !== id) return false;
    const data = JSON.parse(negotiation.data) as NegotiationData;
    return (
      (negotiation.type === "Future transfer" &&
        negotiation.stage === "Scheduled" &&
        !!data.futureArrivalDate &&
        !data.affiliatePlacement) ||
      (affiliateStages.includes(negotiation.stage) &&
        !["Contract renewal", "Youth approach"].includes(negotiation.type))
    );
  });
  const squadCounts = needsAffiliateOptions
    ? await affiliateSquadCounts(store)
    : undefined;
  for (const negotiation of negotiations) {
    const { placementOptions, onwardLoanOptions } =
      await affiliateOptionsForNegotiation(store, negotiation, squadCounts);
    negotiation.affiliatePlacementOptions = placementOptions;
    negotiation.onwardLoanOptions = onwardLoanOptions;
  }
  return {
    payments: await transferPayments(store, id),
    buyBackClauses: await store.all(
      `${buyBackSelect} WHERE (clauses.beneficiary_id = ? OR clauses.owner_id = ?) AND clauses.status = 'active' AND clauses.expires >= ? ORDER BY clauses.expires`,
      id,
      id,
      (await stateOf(store)).date,
    ),
    sellOnClauses: await store.all(
      `${sellOnSelect} WHERE (clauses.beneficiary_id = ? OR clauses.owner_id = ?) AND clauses.status IN ('active','triggered') ORDER BY clauses.id DESC`,
      id,
      id,
    ),
    negotiations,
    targets: (
      await store.all<Player>(
        `${playerSelect} WHERE shortlisted = 1 AND players.club_id <> ? ORDER BY potential DESC,players.id LIMIT 20`,
        id,
      )
    ).map(withoutProfile),
    market: await store.all(
      "SELECT * FROM history WHERE entity_type = 'transfer' ORDER BY id DESC LIMIT 20",
    ),
  };
}

export async function loans(store: Store): Promise<LoanDesk> {
  const id = (await stateOf(store)).clubId;
  const loanTypeList = LOAN_TYPES.map(() => "?").join(",");
  return {
    loans: await store.all<Loan>(
      "SELECT loans.*, players.name AS player_name, players.position, players.age, players.ability, players.potential, parent.name AS parent_name, destination.name AS destination_name, destination.color AS destination_color FROM loans JOIN players ON players.id = loans.player_id JOIN clubs AS parent ON parent.id = loans.parent_id JOIN clubs AS destination ON destination.id = loans.destination_id WHERE loans.parent_id = ? OR loans.destination_id = ? ORDER BY loans.id DESC",
      id,
      id,
    ),
    loanOffers: await withBattleViews(
      store,
      await store.all<Negotiation>(
        `SELECT negotiations.*, players.name AS player_name, players.position, players.age, players.ability, players.potential, buyer.name AS buyer_name, buyer.color AS buyer_color, buyer.reputation AS buyer_reputation, seller.name AS seller_name FROM negotiations JOIN players ON players.id = negotiations.player_id JOIN clubs AS buyer ON buyer.id = negotiations.buying_club_id LEFT JOIN clubs AS seller ON seller.id = negotiations.selling_club_id WHERE (negotiations.buying_club_id = ? OR negotiations.selling_club_id = ?) AND negotiations.type IN (${loanTypeList}) AND negotiations.stage IN ('Enquiry','Club talks','Agent talks','Contract review','Scheduled','Medical','Registration','Offer received') ORDER BY negotiations.id DESC`,
        id,
        id,
        ...LOAN_TYPES,
      ),
    ),
    partnerships: await store.all(
      "SELECT partnerships.*,clubs.id AS partner_id,clubs.name,clubs.color,clubs.reputation FROM partnerships JOIN clubs ON clubs.id = CASE WHEN partnerships.club_id = ? THEN partnerships.partner_id ELSE partnerships.club_id END WHERE partnerships.club_id = ? OR partnerships.partner_id = ? ORDER BY strength DESC",
      id,
      id,
      id,
    ),
    // Players clubs may approach for a loan: those the director made available, then young players by potential.
    loanList: await withEligibility(
      store,
      (await store.all<Player & { open_offers: number; last_offer: string | null }>(
        `SELECT players.*, clubs.name AS club_name, clubs.color AS club_color, countries.name AS country_name, countries.code AS country_code, (SELECT count(*) FROM negotiations WHERE negotiations.player_id = players.id AND negotiations.stage = 'Offer received' AND negotiations.type = ANY(?::text[])) AS open_offers, (SELECT max(created) FROM negotiations WHERE negotiations.player_id = players.id AND negotiations.selling_club_id = players.club_id AND negotiations.type = ANY(?::text[])) AS last_offer FROM players LEFT JOIN clubs ON clubs.id = players.club_id JOIN countries ON countries.id = players.country_id WHERE players.club_id = ? AND players.parent_club_id IS NULL AND players.role <> 'Retired' AND players.age >= 16 AND (players.available_loan = 1 OR players.age <= 23) ORDER BY available_loan DESC, potential DESC,players.id LIMIT 40`,
        LOAN_TYPES,
        LOAN_TYPES,
        id,
      )).map((row) => ({ ...withoutProfile(row), open_offers: row.open_offers, last_offer: row.last_offer })),
    ),
  };
}

export async function staff(store: Store): Promise<StaffDesk> {
  const id = (await stateOf(store)).clubId;
  return {
    staff: await store.all<Staff>(
      "SELECT * FROM staff WHERE club_id = ? ORDER BY role, ability DESC",
      id,
    ),
    candidates: await store.all<Staff>(
      "SELECT * FROM staff WHERE club_id IS NULL AND role <> 'Director of football' AND (data::jsonb ->> 'retired') IS DISTINCT FROM 'true' ORDER BY ability DESC,id LIMIT 40",
    ),
    relationships: await store.all(
      "SELECT relationships.*, source.name AS source_name, target.name AS target_name FROM relationships JOIN staff AS source ON source.id = source_id JOIN staff AS target ON target.id = target_id WHERE relationships.club_id = ? AND source_type = 'staff' AND source.club_id = ? AND target.club_id = ?",
      id,
      id,
      id,
    ),
  };
}

export async function competition(
  store: Store,
  id: number,
): Promise<CompetitionDetail> {
  const league = await store.get<League>(
    "SELECT leagues.*, countries.name AS country_name FROM leagues LEFT JOIN countries ON countries.id = leagues.country_id WHERE leagues.id = ?",
    id,
  );
  if (!league) throw new Error("Competition not found.");
  return {
    league,
    table: await store.all<Standing>(
      `${standingSelect} WHERE standings.league_id = ? ORDER BY group_name, points DESC, (gf-ga) DESC, gf DESC, club_id`,
      id,
    ),
    fixtures: await store.all<Fixture>(
      `${fixtureSelect} WHERE fixtures.league_id = ? AND fixtures.season = ? ORDER BY fixtures.date,fixtures.id LIMIT 600`,
      id,
      (await stateOf(store)).season,
    ),
    qualifiers: await store.all<League>(
      "SELECT * FROM leagues WHERE data::jsonb -> 'qualificationFor' = to_jsonb(?::integer)",
      id,
    ),
    history: await store.all(
      "SELECT * FROM history WHERE entity_id = ? AND entity_type IN ('league','champion') ORDER BY season DESC,id DESC LIMIT 10",
      id,
    ),
  };
}

export async function matches(
  store: Store,
  query: { club?: number; league?: number; age?: string; status?: string },
) {
  const conditions: string[] = ["fixtures.season = ?"];
  const params: (string | number)[] = [(await stateOf(store)).season];
  if (query.league) {
    conditions.push("fixtures.league_id = ?");
    params.push(query.league);
  } else {
    conditions.push("(fixtures.home_id = ? OR fixtures.away_id = ?)");
    params.push(
      query.club ?? (await stateOf(store)).clubId,
      query.club ?? (await stateOf(store)).clubId,
    );
  }
  if (query.age) {
    conditions.push("coalesce(leagues.age_group,'Senior') = ?");
    params.push(query.age);
  }
  if (query.status) {
    conditions.push("fixtures.status = ?");
    params.push(query.status);
  }
  return (
    await store.all<Fixture>(
      `${fixtureSelect} WHERE ${conditions.join(" AND ")} ORDER BY fixtures.date DESC,fixtures.id DESC LIMIT 120`,
      ...params,
    )
  ).map((fixture) => ({ ...fixture, data: "" }));
}

export async function matchDetail(
  store: Store,
  id: number,
): Promise<MatchDetail> {
  const fixture = await store.get<Fixture>(
    `${fixtureSelect} WHERE fixtures.id = ?`,
    id,
  );
  if (!fixture) throw new Error("Fixture not found.");
  if (fixture.status !== "played") return { fixture };
  const data = JSON.parse(fixture.data) as {
    snapshot?: MatchSnapshot;
    penalties: { home: number; away: number } | null;
    winnerId: number;
    aggregate?: { home: number; away: number };
    tie?: { id: string; leg: number; legs: number };
    awarded?: { home: number; away: number; reason: string } | null;
    compact?: boolean;
  };
  const summary = {
    penalties: data.penalties,
    winnerId: data.winnerId,
    aggregate: data.aggregate,
    tie: data.tie,
    awarded: data.awarded,
  };
  // Compacted non-user fixtures keep the result and scorers (in data) but no snapshot to replay.
  if (!data.snapshot) return { fixture: { ...fixture, data: data.compact ? fixture.data : "" }, ...summary };
  return {
    fixture: { ...fixture, data: "" },
    snapshot: data.snapshot,
    result: simulateMatch(data.snapshot, fixture.seed),
    ...summary,
  };
}

export async function finances(store: Store): Promise<FinanceData> {
  const club = await clubOf(store);
  const wages = await weeklyWages(store, club.id);
  const staffWages = (await store.get<{ total: number }>(
    "SELECT coalesce(sum(wage),0) AS total FROM staff WHERE club_id = ?",
    club.id,
  ))!.total;
  return {
    valuation: await clubWorth(store, club),
    ledger: await store.all(
      "SELECT * FROM ledger WHERE club_id = ? ORDER BY id DESC LIMIT 80",
      club.id,
    ),
    history: (
      await store.all<{ date: string; data: string }>(
        "SELECT * FROM history WHERE entity_type = 'finance' AND entity_id = ? ORDER BY date DESC,id DESC LIMIT 52",
        club.id,
      )
    )
      .reverse()
      .map((row) => ({ date: row.date, ...JSON.parse(row.data) })),
    wages,
    staffWages,
    squadValue: (await store.get<{ total: number }>(
      "SELECT coalesce(sum(value),0) AS total FROM players WHERE (club_id = ? AND parent_club_id IS NULL) OR parent_club_id = ?",
      club.id,
      club.id,
    ))!.total,
    projectedWages: (wages + staffWages) * 52,
    amortization: await annualAmortization(
      store,
      club.id,
      (await stateOf(store)).date,
    ),
    compliance: await assessFinances(store, club.id),
    sanctions: await clubSanctions(store, club.id),
    transferPayments: await transferPayments(store, club.id),
    futureTransferReserved: (await store.get<{ total: number }>(
      "SELECT coalesce(sum((data::jsonb ->> 'reservedBudget')::double precision),0) AS total FROM negotiations WHERE buying_club_id = ? AND stage IN ('Scheduled','Medical','Registration')",
      club.id,
    ))!.total,
    transferPayable: (await store.get<{ total: number }>(
      "SELECT coalesce(sum(amount),0) AS total FROM transfer_payments WHERE payer_id = ? AND paid_date IS NULL",
      club.id,
    ))!.total,
    transferReceivable: (await store.get<{ total: number }>(
      "SELECT coalesce(sum(amount),0) AS total FROM transfer_payments WHERE payee_id = ? AND paid_date IS NULL",
      club.id,
    ))!.total,
    commitments: await store.all(
      "SELECT players.name, (loans.terms::jsonb ->> 'optionFee')::double precision AS amount, loans.type FROM loans JOIN players ON players.id = loans.player_id WHERE loans.destination_id = ? AND loans.type IN ('Loan with option','Loan with obligation') AND loans.status = 'active'",
      club.id,
    ),
  };
}

export async function training(store: Store): Promise<TrainingData> {
  const id = (await stateOf(store)).clubId;
  return {
    plan: (await store.get<TrainingData["plan"]>(
      "SELECT * FROM training_plans WHERE club_id = ?",
      id,
    )) ?? {
      focus: "Balanced",
      intensity: 50,
      youth_focus: "Technical",
      data: "{}",
    },
    players: (
      await store.all<Player>(
        `${playerSelect} WHERE players.club_id = ? ORDER BY players.age_group, players.ability DESC`,
        id,
      )
    ).map(withoutProfile),
    injuries: (
      await store.all<Player>(
        `${playerSelect} WHERE players.club_id = ? AND injury_until IS NOT NULL ORDER BY injury_until`,
        id,
      )
    ).map(withoutProfile),
    setPieces: (await store.get<TrainingData["setPieces"]>(
      "SELECT * FROM set_pieces WHERE club_id = ?",
      id,
    )) ?? { routine: "Near post", target: "Centre-back", risk: 50 },
    mentors: (
      await store.all<Player>(
        `${playerSelect} WHERE players.club_id = ? AND age >= 25 ORDER BY (profile::jsonb #>> '{personality,professionalism}')::double precision DESC NULLS LAST,players.id`,
        id,
      )
    ).map(withoutProfile),
  };
}

export async function academy(store: Store): Promise<AcademyData> {
  const club = await clubOf(store);
  return {
    players: (
      await store.all<Player>(
        `${playerSelect} WHERE players.club_id = ? AND players.age_group != 'Senior' ORDER BY potential DESC`,
        club.id,
      )
    ).map((player) => ({
      ...withoutProfile(player),
      details: JSON.parse(player.profile),
    })),
    leagues: await store.all<League>(
      "SELECT leagues.* FROM leagues JOIN standings ON standings.league_id = leagues.id WHERE standings.club_id = ? AND leagues.age_group != 'Senior' ORDER BY leagues.kind, leagues.age_group",
      club.id,
    ),
    fixtures: await store.all<Fixture>(
      `${fixtureSelect} WHERE (home_id = ? OR away_id = ?) AND fixtures.date >= ? AND leagues.age_group != 'Senior' ORDER BY date,fixtures.id LIMIT 12`,
      club.id,
      club.id,
      (await stateOf(store)).date,
    ),
    intake: (await store.get<{ value: string }>(
      "SELECT value FROM meta WHERE key = 'lastIntake'",
    ))
      ? await store.meta("lastIntake")
      : null,
    dna: JSON.parse(club.data).youthDNA ?? "Technical intelligence",
  };
}
