import { z } from "zod";
import { Store } from "./db.ts";
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
import { assessRegistration } from "./registration.ts";
import { assessPlayerInterest, assessYouthTransfer } from "./recruitment.ts";
import { clubAffiliates } from "./club-support.ts";
import { describeIdentity, peopleContext } from "./people.ts";
import { marketValueFactor } from "../shared/world-catalog/market.ts";
import { associationNotes, reservePolicy } from "../shared/world-rules.ts";
import { notificationFeed, notificationVisibility } from "./notifications.ts";
import { withBattleViews } from "./transfer-battles.ts";

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
    const value = `%${filter.q.replace(/[!%_[]/g, "!$&")}%`;
    conditions.push(
      "(clubs.name LIKE ? ESCAPE '!' OR clubs.city LIKE ? ESCAPE '!' OR countries.name LIKE ? ESCAPE '!')",
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
      ? "countries.name COLLATE Latin1_General_100_CI_AS ASC,coalesce(leagues.tier,99) ASC,clubs.name COLLATE Latin1_General_100_CI_AS ASC,clubs.id"
      : `clubs.${filter.sort} ${filter.direction},clubs.id`;
  const clubs = await store.all<WorldClub>(
    `SELECT clubs.*,countries.name AS country_name,countries.code AS country_code,countries.confederation,leagues.name AS league_name,leagues.tier,(SELECT count(*) FROM players WHERE players.club_id = clubs.id AND players.role != 'Retired') AS squad_size ${joins} WHERE ${where} ORDER BY ${order} OFFSET ? ROWS FETCH NEXT ? ROWS ONLY`,
    ...params,
    (page - 1) * filter.pageSize,
    filter.pageSize,
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
    `${playerSelect} WHERE ${club.type === "national" ? "players.country_id" : "players.playing_club_id"} = ? AND players.role != 'Retired' ${club.type === "national" ? "AND players.age < ?" : ""} ORDER BY players.ability DESC,players.id ${club.type === "national" ? "OFFSET 0 ROWS FETCH NEXT 30 ROWS ONLY" : ""}`,
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
    players: roster.map(withoutProfile),
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
        `${fixtureSelect} WHERE (fixtures.home_id = ? OR fixtures.away_id = ?) AND fixtures.status = 'scheduled' ORDER BY fixtures.date,fixtures.id OFFSET 0 ROWS FETCH NEXT 25 ROWS ONLY`,
        id,
        id,
      )
    ).map((fixture) => ({ ...fixture, data: "" })),
    results: (
      await store.all<Fixture>(
        `${fixtureSelect} WHERE (fixtures.home_id = ? OR fixtures.away_id = ?) AND fixtures.status = 'played' ORDER BY fixtures.date DESC,fixtures.id DESC OFFSET 0 ROWS FETCH NEXT 25 ROWS ONLY`,
        id,
        id,
      )
    ).map((fixture) => ({ ...fixture, data: "" })),
    history: await store.all(
      "SELECT TOP (50) season,date,entity_type,data FROM history WHERE (entity_type = 'manager' AND entity_id = ?) OR (entity_type = 'champion' AND TRY_CONVERT(int, JSON_VALUE(data,'$.clubId')) = ?) ORDER BY date DESC,id DESC",
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
        "SELECT countries.*,(SELECT count(*) FROM leagues WHERE leagues.country_id = countries.id AND leagues.kind = 'league' AND leagues.age_group = 'Senior' AND coalesce(TRY_CONVERT(bit, JSON_VALUE(leagues.data,'$.reserveOnly')),0) = 0) AS seniorDivisions,(SELECT count(*) FROM clubs WHERE clubs.country_id = countries.id AND clubs.type != 'national') AS clubs,(SELECT count(*) FROM clubs WHERE clubs.country_id = countries.id AND clubs.type = 'bteam') AS reserves FROM countries ORDER BY name",
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
      `${fixtureSelect} WHERE (home_id = ? OR away_id = ?) AND status = 'scheduled' AND (leagues.age_group = 'Senior' OR leagues.id IS NULL) ORDER BY date,fixtures.id OFFSET 0 ROWS FETCH NEXT 5 ROWS ONLY`,
      state.clubId,
      state.clubId,
    ),
    results: await store.all<Fixture>(
      `${fixtureSelect} WHERE (home_id = ? OR away_id = ?) AND status = 'played' AND (leagues.age_group = 'Senior' OR leagues.id IS NULL) ORDER BY date DESC,fixtures.id DESC OFFSET 0 ROWS FETCH NEXT 4 ROWS ONLY`,
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
        `${playerSelect} WHERE shortlisted = 1 ORDER BY potential DESC,players.id OFFSET 0 ROWS FETCH NEXT 5 ROWS ONLY`,
      )
    ).map(withoutProfile),
    expiring: (
      await store.all<Player>(
        `${playerSelect} WHERE players.club_id = ? AND contract_end <= ? ORDER BY ability DESC,players.id OFFSET 0 ROWS FETCH NEXT 5 ROWS ONLY`,
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
      `SELECT count(*) AS total FROM news WHERE [read] = 0 AND ${notifications.where}`,
      ...notifications.params,
    ))!.total,
  };
}

export const playerFilter = z.object({
  q: z.string().max(100).default(""),
  position: z.enum(POSITIONS).optional(),
  country: z.coerce.number().int().positive().optional(),
  club: z.coerce.number().int().positive().optional(),
  ageMin: z.coerce.number().min(0).max(100).default(0),
  ageMax: z.coerce.number().min(0).max(100).default(100),
  abilityMin: z.coerce.number().min(0).max(99).default(0),
  abilityMax: z.coerce.number().min(1).max(99).default(99),
  potentialMin: z.coerce.number().min(0).max(99).default(0),
  potentialMax: z.coerce.number().min(1).max(99).default(99),
  valueMin: z.coerce.number().min(0).default(0),
  valueMax: z.coerce.number().min(0).default(1_000_000_000),
  wageMax: z.coerce.number().min(0).default(1_000_000_000),
  ageGroup: z.enum(["Senior", "U19", "U17", "U20", "U21"]).optional(),
  contractStatus: z.enum(["professional", "amateur"]).optional(),
  foot: z.enum(["Right", "Left", "Both"]).optional(),
  lifestyle: z.string().max(40).optional(),
  trait: z.string().max(80).optional(),
  attribute: z.string().max(60).optional(),
  attributeMin: z.coerce.number().min(0).max(99).default(0),
  personality: z.string().max(60).optional(),
  personalityMin: z.coerce.number().min(0).max(99).default(0),
  heightMin: z.coerce.number().min(0).max(230).default(0),
  heightMax: z.coerce.number().min(0).max(230).default(230),
  formMin: z.coerce.number().min(0).max(10).default(0),
  goalsMin: z.coerce.number().int().min(0).default(0),
  minutesMin: z.coerce.number().min(0).default(0),
  contractMonths: z.coerce.number().min(0).max(120).optional(),
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
/** The zod default of valueMax/wageMax, i.e. "no limit". */
const NO_MONEY_LIMIT = 1_000_000_000;
const sortName = "COLLATE Latin1_General_100_CI_AI";

// Each alias is a self-join on players.id that SQL Server can read from one nonclustered index:
// players = player_filter, squad = player_market_squad, named = player_name, nation = player_nationality.
const SEARCH_ALIASES = ["players", "squad", "named", "nation"] as const;
type SearchAlias = (typeof SEARCH_ALIASES)[number];
const INDEXED_COLUMNS: Record<string, SearchAlias> = {
  position: "players",
  age: "players",
  ability: "players",
  potential: "players",
  value: "players",
  role: "squad",
  wage: "squad",
  club_id: "squad",
  age_group: "squad",
  name: "named",
  country_id: "nation",
};
type SearchColumn = (name: string) => string;
type SearchClause = (column: SearchColumn) => string;
type SearchOrder = (column: SearchColumn) => { order: string; joins: string[] };

export interface PlayerSearch {
  /** Id column of the base alias. */
  id: string;
  /** FROM clause with the index self-joins. */
  from: string;
  /** Extra joins only ORDER BY needs. */
  joins: string;
  where: string;
  order: string;
  params: (string | number)[];
  /** Every column comes from a nonclustered index, so the wide clustered rows (profile JSON) are never scanned. */
  indexOnly: boolean;
  /** Anything beyond "not retired". */
  filtered: boolean;
}

function compileSearch(
  clauses: SearchClause[],
  params: (string | number)[],
  orderOf: SearchOrder,
  single = false,
): PlayerSearch {
  const used = new Set<string>();
  const probe: SearchColumn = (name) => {
    used.add(name);
    return name;
  };
  for (const clause of clauses) clause(probe);
  orderOf(probe);
  const indexOnly = [...used].every(
    (name) => name === "id" || Object.hasOwn(INDEXED_COLUMNS, name),
  );
  const aliases =
    indexOnly && !single
      ? SEARCH_ALIASES.filter((alias) =>
          [...used].some((name) => INDEXED_COLUMNS[name] === alias),
        )
      : [];
  const base: SearchAlias = aliases[0] ?? "players";
  const column: SearchColumn = (name) =>
    `${aliases.length && name !== "id" ? INDEXED_COLUMNS[name] : base}.${name}`;
  const ordered = orderOf(column);
  return {
    id: `${base}.id`,
    from: `FROM players AS ${base}${aliases
      .slice(1)
      .map((alias) => ` JOIN players AS ${alias} ON ${alias}.id = ${base}.id`)
      .join("")}`,
    joins: ordered.joins.join(" "),
    where: clauses.map((clause) => clause(column)).join(" AND "),
    order: ordered.order,
    params,
    indexOnly,
    filtered: clauses.length > 1,
  };
}

/** ORDER BY for the player search: missing values last in both directions, ties by name then id. */
function playerOrder(
  sort: PlayerFilter["sort"],
  direction: "asc" | "desc",
): SearchOrder {
  return (column) => {
    const order = direction === "asc" ? "ASC" : "DESC";
    const reverse = direction === "asc" ? "DESC" : "ASC";
    const joins: string[] = [];
    const missingLast = (value: string, sql = value) =>
      `CASE WHEN ${value} IS NULL THEN 1 ELSE 0 END,${sql} ${order}`;
    const json = (path: string) =>
      `TRY_CONVERT(float, JSON_VALUE(${column("profile")},'${path}'))`;
    const contract = () =>
      `CASE WHEN ${column("club_id")} IS NULL THEN 1 ELSE 0 END,${column("contract_end")} ${order}`;
    // Only the chosen key may touch `column`: it records which indexes the query needs.
    const keys: Record<typeof sort, () => string> = {
      name: () => `${column("name")} ${sortName} ${order}`,
      position: () =>
        `CASE ${column("position")} ${POSITIONS.map((position, index) => `WHEN '${position}' THEN ${index}`).join(" ")} ELSE ${POSITIONS.length} END ${order}`,
      age: () => `${column("age")} ${order},${column("birth_date")} ${reverse}`,
      // players.nationality is always the name of players.country_id (people.ts; never updated).
      nationality: () => {
        joins.push(`JOIN countries AS nationality ON nationality.id = ${column("country_id")}`);
        return `nationality.name ${sortName} ${order}`;
      },
      club: () => {
        joins.push(`LEFT JOIN clubs ON clubs.id = ${column("club_id")}`);
        return missingLast("clubs.name", `clubs.name ${sortName}`);
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
      height: () => missingLast(json("$.identity.height")),
      weight: () => missingLast(json("$.identity.weight")),
    };
    return {
      order: `${keys[sort]()},${column("name")} ${sortName} ASC,${column("id")} ASC`,
      joins,
    };
  };
}

/**
 * The player-search WHERE/ORDER BY. Default ranges are omitted so they cannot force the clustered index;
 * `secondaryNationals` are the ids holding `filter.country` as a second nationality.
 */
export function playerSearch(
  filter: PlayerFilter,
  context: { contractBefore?: string; secondaryNationals?: readonly number[] } = {},
): PlayerSearch {
  const clauses: SearchClause[] = [(column) => `${column("role")} <> N'Retired'`];
  const params: (string | number)[] = [];
  const where = (clause: SearchClause, ...values: (string | number)[]) => {
    clauses.push(clause);
    params.push(...values);
  };
  // age is an integer column: integer bounds keep the parameter from converting the column to float.
  if (filter.ageMin > 0) where((column) => `${column("age")} >= ?`, Math.ceil(filter.ageMin));
  if (filter.ageMax < 100) where((column) => `${column("age")} <= ?`, Math.floor(filter.ageMax));
  if (filter.abilityMin > 1) where((column) => `${column("ability")} >= ?`, filter.abilityMin);
  if (filter.abilityMax < 99) where((column) => `${column("ability")} <= ?`, filter.abilityMax);
  if (filter.potentialMin > 1) where((column) => `${column("potential")} >= ?`, filter.potentialMin);
  if (filter.potentialMax < 99) where((column) => `${column("potential")} <= ?`, filter.potentialMax);
  if (filter.valueMin > 0) where((column) => `${column("value")} >= ?`, filter.valueMin);
  if (filter.valueMax < NO_MONEY_LIMIT) where((column) => `${column("value")} <= ?`, filter.valueMax);
  if (filter.wageMax < NO_MONEY_LIMIT) where((column) => `${column("wage")} <= ?`, filter.wageMax);
  if (filter.formMin > 0) where((column) => `${column("form")} >= ?`, filter.formMin);
  if (filter.goalsMin > 0) where((column) => `${column("goals")} >= ?`, filter.goalsMin);
  if (filter.minutesMin > 0) where((column) => `${column("minutes")} >= ?`, filter.minutesMin);
  if (filter.q) {
    const search = `%${filter.q.replace(/[!%_[]/g, "!$&")}%`;
    where(
      (column) =>
        `(${column("name")} LIKE ? ESCAPE '!' OR ${column("country_id")} IN (SELECT countries.id FROM countries WHERE countries.name LIKE ? ESCAPE '!') OR ${column("club_id")} IN (SELECT clubs.id FROM clubs WHERE clubs.name LIKE ? ESCAPE '!'))`,
      search,
      search,
      search,
    );
  }
  // Typed like the columns: the driver sends strings as nvarchar(max).
  if (filter.position)
    where((column) => `${column("position")} = CAST(? AS nvarchar(16))`, filter.position);
  if (filter.country) {
    const secondary = context.secondaryNationals ?? [];
    if (secondary.length)
      where(
        (column) =>
          `(${column("country_id")} = ? OR ${column("id")} IN (SELECT CAST([value] AS int) FROM OPENJSON(?)))`,
        filter.country,
        JSON.stringify(secondary),
      );
    else where((column) => `${column("country_id")} = ?`, filter.country);
  }
  if (filter.club) where((column) => `${column("club_id")} = ?`, filter.club);
  if (filter.ageGroup)
    where((column) => `${column("age_group")} = CAST(? AS nvarchar(32))`, filter.ageGroup);
  if (filter.contractStatus)
    where(
      (column) =>
        `coalesce(JSON_VALUE(${column("profile")},'$.contract.status'),'professional') = ?`,
      filter.contractStatus,
    );
  if (filter.foot) where((column) => `${column("foot")} = ?`, filter.foot);
  if (filter.lifestyle)
    where((column) => `JSON_VALUE(${column("profile")},'$.lifestyle') = ?`, filter.lifestyle);
  if (filter.trait)
    where(
      (column) =>
        `EXISTS(SELECT 1 FROM OPENJSON(${column("profile")},'$.traits') AS trait WHERE trait.[value] = ?)`,
      filter.trait,
    );
  if (filter.attribute) {
    const group = Object.entries(ATTRIBUTE_GROUPS).find(([, keys]) =>
      keys.includes(filter.attribute!),
    )?.[0];
    if (!group) throw new GameError("Unknown player attribute.");
    // SQL mirror of shared `currentAttribute` (a missing baseAbility means no change since generation).
    where(
      (column) =>
        `TRY_CONVERT(float, JSON_VALUE(${column("profile")}, ?)) + (${column("ability")} - coalesce(TRY_CONVERT(float, JSON_VALUE(${column("profile")},'$.baseAbility')),${column("ability")})) >= ?`,
      `$.attributes.${group}.${filter.attribute}`,
      filter.attributeMin,
    );
  }
  if (filter.personality) {
    if (!PERSONALITY_KEYS.includes(filter.personality))
      throw new GameError("Unknown personality attribute.");
    where(
      (column) => `TRY_CONVERT(float, JSON_VALUE(${column("profile")}, ?)) >= ?`,
      `$.personality.${filter.personality}`,
      filter.personalityMin,
    );
  }
  if (filter.heightMin > 0)
    where(
      (column) => `TRY_CONVERT(float, JSON_VALUE(${column("profile")},'$.identity.height')) >= ?`,
      filter.heightMin,
    );
  if (filter.heightMax < 230)
    where(
      (column) => `TRY_CONVERT(float, JSON_VALUE(${column("profile")},'$.identity.height')) <= ?`,
      filter.heightMax,
    );
  if (context.contractBefore !== undefined)
    where((column) => `${column("contract_end")} <= ?`, context.contractBefore);
  // The filtered index player_shortlist holds exactly the shortlisted ids.
  if (filter.shortlisted === "1")
    where(
      (column) =>
        `${column("id")} IN (SELECT shortlist.id FROM players AS shortlist WHERE shortlist.shortlisted = 1)`,
    );
  if (filter.shortlisted === "0") where((column) => `${column("shortlisted")} = 0`);
  if (filter.listed) where((column) => `${column("listed")} = ?`, Number(filter.listed));
  if (filter.availableLoan)
    where((column) => `${column("available_loan")} = ?`, Number(filter.availableLoan));
  if (filter.freeAgent === "1") where((column) => `${column("club_id")} IS NULL`);
  if (filter.injured === "1") where((column) => `${column("injury_until")} IS NOT NULL`);
  if (filter.injured === "0") where((column) => `${column("injury_until")} IS NULL`);
  return compileSearch(clauses, params, playerOrder(filter.sort, filter.direction));
}

/** Ranks a known id set (JSON array parameter) by the search sort: one clustered seek per id, no scan. */
export function playerRanking(filter: Pick<PlayerFilter, "sort" | "direction">): PlayerSearch {
  return compileSearch(
    [(column) => `${column("id")} IN (SELECT CAST([value] AS int) FROM OPENJSON(?))`],
    [],
    playerOrder(filter.sort, filter.direction),
    true,
  );
}

type SearchMatches = { at: number; count: number; ids?: number[]; json?: string };
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
    // Id-range batches (clustered seeks), yielding between them so a cold build on a full world never blocks other accounts.
    for (let from = known.maxId; from < maxId; from += NATIONALS_BATCH_IDS) {
      for (const row of await store.all<{ id: number; country: number }>(
        "SELECT players.id, TRY_CONVERT(int, JSON_VALUE(nationality.[value],'$.countryId')) AS country FROM players CROSS APPLY OPENJSON(players.profile,'$.identity.nationalities') AS nationality WHERE players.id > ? AND players.id <= ? AND TRY_CONVERT(int, JSON_VALUE(nationality.[value],'$.countryId')) <> players.country_id",
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
        "SELECT count(*) AS count FROM players WHERE role <> N'Retired'",
      ))!.count,
    };
  return counts.active.total;
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
): Promise<PlayerPage> {
  const filter = playerFilter.parse(query);
  const state = await stateOf(store);
  const search = playerSearch(filter, {
    contractBefore:
      filter.contractMonths === undefined
        ? undefined
        : addDays(state.date, Math.floor(filter.contractMonths * 30.44)),
    secondaryNationals: filter.country
      ? await secondaryNationals(store, state, filter.country)
      : [],
  });
  // The match set ignores sort and paging, so changing either reuses it until the world changes.
  const counts = searchCountsOf(store);
  const key = JSON.stringify([
    state.careerId,
    state.seed,
    state.date,
    { ...filter, sort: undefined, direction: undefined, page: undefined, pageSize: undefined },
  ]);
  const cached = counts.matches.get(key);
  const top = `SELECT TOP (${PLAYER_SEARCH_CAP + 1}) ${search.id} AS id ${search.from} WHERE ${search.where}`;
  const matches: SearchMatches =
    cached && Date.now() - cached.at <= MATCH_CACHE_MS
      ? cached
      : search.indexOnly
        ? {
            at: Date.now(),
            count: (await store.get<{ count: number }>(
              `SELECT count(*) AS count FROM (${top}) AS matches`,
              ...search.params,
            ))!.count,
          }
        : // A JSON-filtered search reads the wide rows; keep its ids so ranking and paging don't scan again.
          await store
            .all<{ id: number }>(top, ...search.params)
            .then((rows) => ({ at: Date.now(), count: rows.length, ids: rows.map((row) => row.id) }));
  counts.matches.delete(key);
  counts.matches.set(key, matches);
  while (counts.matches.size > MATCH_CACHE_SIZE)
    counts.matches.delete(counts.matches.keys().next().value!);
  const capped = matches.count > PLAYER_SEARCH_CAP;
  const total = !capped
    ? matches.count
    : search.filtered
      ? PLAYER_SEARCH_CAP
      : await activePlayers(store, state);
  const pages = Math.max(1, Math.ceil(total / filter.pageSize));
  const page = Math.min(filter.page, pages);
  let ids: number[] = [];
  if (total > 0) {
    const known = !capped ? matches.ids : undefined;
    const ranked = known ? playerRanking(filter) : search;
    const params = known ? [(matches.json ??= JSON.stringify(known))] : search.params;
    ids = (
      await store.all<{ id: number }>(
        `SELECT ${ranked.id} AS id ${ranked.from} ${ranked.joins} WHERE ${ranked.where} ORDER BY ${ranked.order} OFFSET ? ROWS FETCH NEXT ? ROWS ONLY`,
        ...params,
        (page - 1) * filter.pageSize,
        filter.pageSize,
      )
    ).map((row) => row.id);
  }
  // Display columns and joins only for the page.
  const rows = new Map(
    (ids.length
      ? await store.all<Player>(
          `${playerSelect} WHERE players.id IN (SELECT CAST([value] AS int) FROM OPENJSON(?))`,
          JSON.stringify(ids),
        )
      : []
    ).map((player) => [player.id, player]),
  );
  return {
    players: ids.flatMap((id) => {
      const player = rows.get(id);
      return player ? [searchRow(player)] : [];
    }),
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
    registration: await assessRegistration(store, player, await clubOf(store)),
    youthTransfer: await assessYouthTransfer(
      store,
      player,
      await clubOf(store),
    ),
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
        "SELECT TOP (1) reports.*, staff.name AS scout_name FROM reports JOIN staff ON staff.id = reports.staff_id WHERE player_id = ? ORDER BY reports.id DESC",
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
      "SELECT TOP (20) date, data, entity_type FROM history WHERE entity_id = ? AND entity_type IN ('appearance','transfer') ORDER BY id DESC",
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
      `SELECT appearance.*,clubs.name AS club_name,clubs.color AS club_color,fixtures.home_id,fixtures.away_id,home.name AS home_name,away.name AS away_name,home.color AS home_color,away.color AS away_color,fixtures.home_goals,fixtures.away_goals,fixtures.league_id,coalesce(leagues.name,'Friendly') AS competition_name,coalesce(leagues.age_group,'Senior') AS age_group,fixtures.stage FROM player_match_appearances AS appearance JOIN fixtures ON fixtures.id = appearance.fixture_id JOIN clubs ON clubs.id = appearance.club_id JOIN clubs AS home ON home.id = fixtures.home_id JOIN clubs AS away ON away.id = fixtures.away_id LEFT JOIN leagues ON leagues.id = fixtures.league_id WHERE ${where} ORDER BY appearance.date DESC,appearance.fixture_id DESC OFFSET ? ROWS FETCH NEXT ? ROWS ONLY`,
      ...params,
      (page - 1) * filter.pageSize,
      filter.pageSize,
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
    `${playerSelect} WHERE players.playing_club_id = ? AND players.role != 'Retired' ORDER BY players.ability DESC`,
    filter.club,
  );
  const senior = all.filter((player) => player.age_group === filter.ageGroup);
  return {
    clubs,
    selectedClubId: filter.club,
    ageGroup: filter.ageGroup,
    players: senior.map(withoutProfile),
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
      "SELECT TOP (30) promises.*, players.name AS player_name FROM promises LEFT JOIN players ON players.id = promises.player_id ORDER BY promises.id DESC",
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
      "SELECT TOP (30) assignments.*, staff.name AS scout_name, players.name AS player_name, countries.name AS country_name FROM assignments JOIN staff ON staff.id = assignments.staff_id LEFT JOIN players ON players.id = assignments.player_id LEFT JOIN countries ON countries.id = assignments.country_id ORDER BY assignments.id DESC",
    ),
    reports: await store.all(
      "SELECT TOP (50) reports.*, players.name AS player_name, players.position, players.age, players.club_id, clubs.name AS club_name, staff.name AS scout_name FROM reports JOIN players ON players.id = reports.player_id LEFT JOIN clubs ON clubs.id = players.club_id JOIN staff ON staff.id = reports.staff_id ORDER BY reports.id DESC",
    ),
    shortlist: (
      await store.all<Player>(
        `${playerSelect} WHERE shortlisted = 1 ORDER BY potential DESC,players.id OFFSET 0 ROWS FETCH NEXT 100 ROWS ONLY`,
      )
    ).map(withoutProfile),
  };
}

export async function transfers(store: Store): Promise<TransferDesk> {
  const id = (await stateOf(store)).clubId;
  const negotiations = await withBattleViews(
    store,
    await store.all<Negotiation>(
      "SELECT negotiations.*, players.name AS player_name, players.position, players.age, players.ability, players.potential, buyer.name AS buyer_name, seller.name AS seller_name FROM negotiations JOIN players ON players.id = negotiations.player_id JOIN clubs AS buyer ON buyer.id = negotiations.buying_club_id LEFT JOIN clubs AS seller ON seller.id = negotiations.selling_club_id WHERE buying_club_id = ? OR selling_club_id = ? ORDER BY negotiations.id DESC",
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
        `${playerSelect} WHERE shortlisted = 1 AND players.club_id != ? ORDER BY potential DESC,players.id OFFSET 0 ROWS FETCH NEXT 20 ROWS ONLY`,
        id,
      )
    ).map(withoutProfile),
    market: await store.all(
      "SELECT TOP (20) * FROM history WHERE entity_type = 'transfer' ORDER BY id DESC",
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
        `SELECT negotiations.*, players.name AS player_name, players.position, players.age, players.ability, players.potential, buyer.name AS buyer_name, seller.name AS seller_name FROM negotiations JOIN players ON players.id = negotiations.player_id JOIN clubs AS buyer ON buyer.id = negotiations.buying_club_id LEFT JOIN clubs AS seller ON seller.id = negotiations.selling_club_id WHERE (negotiations.buying_club_id = ? OR negotiations.selling_club_id = ?) AND negotiations.type IN (${loanTypeList}) AND negotiations.stage IN ('Enquiry','Club talks','Agent talks','Contract review','Scheduled','Medical','Registration','Offer received') ORDER BY negotiations.id DESC`,
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
    candidates: (
      await store.all<Player>(
        `${playerSelect} WHERE players.club_id = ? AND players.age BETWEEN 16 AND 24 AND players.parent_club_id IS NULL ORDER BY available_loan DESC, potential DESC,players.id OFFSET 0 ROWS FETCH NEXT 30 ROWS ONLY`,
        id,
      )
    ).map(withoutProfile),
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
      "SELECT TOP (40) * FROM staff WHERE club_id IS NULL AND coalesce(JSON_VALUE(coalesce(data,'{}'),'$.retired'),'false') <> 'true' ORDER BY ability DESC,id",
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
      `${fixtureSelect} WHERE fixtures.league_id = ? AND fixtures.season = ? ORDER BY fixtures.date,fixtures.id OFFSET 0 ROWS FETCH NEXT 600 ROWS ONLY`,
      id,
      (await stateOf(store)).season,
    ),
    qualifiers: await store.all<League>(
      "SELECT * FROM leagues WHERE TRY_CONVERT(int, JSON_VALUE(data,'$.qualificationFor')) = ?",
      id,
    ),
    history: await store.all(
      "SELECT TOP (10) * FROM history WHERE entity_id = ? AND entity_type IN ('league','champion') ORDER BY season DESC,id DESC",
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
      `${fixtureSelect} WHERE ${conditions.join(" AND ")} ORDER BY fixtures.date DESC,fixtures.id DESC OFFSET 0 ROWS FETCH NEXT 120 ROWS ONLY`,
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
      "SELECT TOP (80) * FROM ledger WHERE club_id = ? ORDER BY id DESC",
      club.id,
    ),
    history: (
      await store.all<{ date: string; data: string }>(
        "SELECT TOP (52) * FROM history WHERE entity_type = 'finance' AND entity_id = ? ORDER BY date DESC,id DESC",
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
    transferPayments: await transferPayments(store, club.id),
    futureTransferReserved: (await store.get<{ total: number }>(
      "SELECT coalesce(sum(TRY_CONVERT(float, JSON_VALUE(data,'$.reservedBudget'))),0) AS total FROM negotiations WHERE buying_club_id = ? AND stage IN ('Scheduled','Medical','Registration')",
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
      "SELECT players.name, TRY_CONVERT(float, JSON_VALUE(loans.terms,'$.optionFee')) AS amount, loans.type FROM loans JOIN players ON players.id = loans.player_id WHERE loans.destination_id = ? AND loans.type IN ('Loan with option','Loan with obligation') AND loans.status = 'active'",
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
        `${playerSelect} WHERE players.club_id = ? AND age >= 25 ORDER BY TRY_CONVERT(float, JSON_VALUE(profile,'$.personality.professionalism')) DESC,players.id`,
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
      `${fixtureSelect} WHERE (home_id = ? OR away_id = ?) AND fixtures.date >= ? AND leagues.age_group != 'Senior' ORDER BY date,fixtures.id OFFSET 0 ROWS FETCH NEXT 12 ROWS ONLY`,
      club.id,
      club.id,
      (await stateOf(store)).date,
    ),
    intake: (await store.get<{ value: string }>(
      "SELECT value FROM meta WHERE [key] = 'lastIntake'",
    ))
      ? await store.meta("lastIntake")
      : null,
    dna: JSON.parse(club.data).youthDNA ?? "Technical intelligence",
  };
}
