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
  addDays,
  ATTRIBUTE_GROUPS,
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
import { associationNotes, reservePolicy } from "../shared/world-rules.ts";
import { notificationFeed, notificationVisibility } from "./notifications.ts";

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
          : 100;
  const roster = await store.all<Player>(
    `${playerSelect} WHERE ${club.type === "national" ? "players.country_id" : "coalesce(players.squad_club_id,players.club_id)"} = ? AND players.role != 'Retired' ${club.type === "national" ? "AND players.age < ?" : ""} ORDER BY players.ability DESC,players.id ${club.type === "national" ? "OFFSET 0 ROWS FETCH NEXT 30 ROWS ONLY" : ""}`,
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
  const world = (await store.get<WorldTotals>(
    `SELECT (SELECT count(*) FROM countries) AS countries, (SELECT count(*) FROM leagues WHERE kind = 'league') AS leagues, (SELECT count(*) FROM clubs WHERE type != 'national') AS clubs, (SELECT count(*) FROM players) AS players, (SELECT count(*) FROM players WHERE age_group = 'Senior') AS seniors, (SELECT count(*) FROM players WHERE age_group != 'Senior') AS youth, (SELECT count(*) FROM staff) AS staff`,
  ))!;
  world.version =
    (await store.meta<{ version?: number }>("world")).version ?? 1;
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
  ageGroup: z.enum(["Senior", "U19", "U17", "U20"]).optional(),
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
      "wage",
      "form",
      "goals",
      "minutes",
      "contract_end",
    ])
    .default("ability"),
  direction: z.enum(["asc", "desc"]).default("desc"),
  page: z.coerce.number().int().min(1).max(100000).default(1),
  pageSize: z.coerce.number().int().min(10).max(100).default(30),
});

export async function players(
  store: Store,
  query: unknown,
): Promise<PlayerPage> {
  const filter = playerFilter.parse(query);
  const conditions = [
    "players.role != 'Retired'",
    "players.age BETWEEN ? AND ?",
    "players.ability BETWEEN ? AND ?",
    "players.potential BETWEEN ? AND ?",
    "players.value BETWEEN ? AND ?",
    "players.wage <= ?",
    "players.form >= ?",
    "players.goals >= ?",
    "players.minutes >= ?",
  ];
  const params: (string | number)[] = [
    filter.ageMin,
    filter.ageMax,
    filter.abilityMin,
    filter.abilityMax,
    filter.potentialMin,
    filter.potentialMax,
    filter.valueMin,
    filter.valueMax,
    filter.wageMax,
    filter.formMin,
    filter.goalsMin,
    filter.minutesMin,
  ];
  const add = (sql: string, value: string | number) => {
    conditions.push(sql);
    params.push(value);
  };
  if (filter.q) {
    const search = `%${filter.q.replace(/[!%_[]/g, "!$&")}%`;
    conditions.push(
      "(players.name LIKE ? ESCAPE '!' OR players.nationality LIKE ? ESCAPE '!' OR clubs.name LIKE ? ESCAPE '!')",
    );
    params.push(search, search, search);
  }
  if (filter.position) add("players.position = ?", filter.position);
  if (filter.country) {
    conditions.push(
      "(players.country_id = ? OR EXISTS(SELECT 1 FROM OPENJSON(players.profile,'$.identity.nationalities') AS nationality WHERE TRY_CONVERT(int, JSON_VALUE(nationality.[value],'$.countryId')) = ?))",
    );
    params.push(filter.country, filter.country);
  }
  if (filter.club) add("players.club_id = ?", filter.club);
  if (filter.ageGroup) add("players.age_group = ?", filter.ageGroup);
  if (filter.contractStatus)
    add(
      "coalesce(JSON_VALUE(players.profile,'$.contract.status'),'professional') = ?",
      filter.contractStatus,
    );
  if (filter.foot) add("players.foot = ?", filter.foot);
  if (filter.lifestyle)
    add("JSON_VALUE(profile,'$.lifestyle') = ?", filter.lifestyle);
  if (filter.trait)
    add(
      "EXISTS(SELECT 1 FROM OPENJSON(profile,'$.traits') AS trait WHERE trait.[value] = ?)",
      filter.trait,
    );
  if (filter.attribute) {
    const group = Object.entries(ATTRIBUTE_GROUPS).find(([, keys]) =>
      keys.includes(filter.attribute!),
    )?.[0];
    if (!group) throw new GameError("Unknown player attribute.");
    conditions.push(
      "TRY_CONVERT(float, JSON_VALUE(profile, ?)) + (players.ability - TRY_CONVERT(float, JSON_VALUE(profile,'$.baseAbility'))) >= ?",
    );
    params.push(
      `$.attributes.${group}.${filter.attribute}`,
      filter.attributeMin,
    );
  }
  if (filter.personality) {
    if (!PERSONALITY_KEYS.includes(filter.personality))
      throw new GameError("Unknown personality attribute.");
    conditions.push("TRY_CONVERT(float, JSON_VALUE(profile, ?)) >= ?");
    params.push(`$.personality.${filter.personality}`, filter.personalityMin);
  }
  if (filter.heightMin > 0)
    add(
      "TRY_CONVERT(float, JSON_VALUE(profile,'$.identity.height')) >= ?",
      filter.heightMin,
    );
  if (filter.heightMax < 230)
    add(
      "TRY_CONVERT(float, JSON_VALUE(profile,'$.identity.height')) <= ?",
      filter.heightMax,
    );
  if (filter.contractMonths !== undefined)
    add(
      "players.contract_end <= ?",
      addDays(
        (await stateOf(store)).date,
        Math.floor(filter.contractMonths * 30.44),
      ),
    );
  if (filter.shortlisted)
    add("players.shortlisted = ?", Number(filter.shortlisted));
  if (filter.listed) add("players.listed = ?", Number(filter.listed));
  if (filter.availableLoan)
    add("players.available_loan = ?", Number(filter.availableLoan));
  if (filter.freeAgent === "1") conditions.push("players.club_id IS NULL");
  if (filter.injured === "1")
    conditions.push("players.injury_until IS NOT NULL");
  if (filter.injured === "0") conditions.push("players.injury_until IS NULL");
  const where = conditions.join(" AND ");
  const total = (await store.get<{ count: number }>(
    `SELECT count(*) AS count FROM players LEFT JOIN clubs ON clubs.id = players.club_id WHERE ${where}`,
    ...params,
  ))!.count;
  const page = Math.min(
    filter.page,
    Math.max(1, Math.ceil(total / filter.pageSize)),
  );
  return {
    players: (
      await store.all<Player>(
        `${playerSelect} WHERE ${where} ORDER BY players.${filter.sort} ${filter.direction}, players.id OFFSET ? ROWS FETCH NEXT ? ROWS ONLY`,
        ...params,
        (page - 1) * filter.pageSize,
        filter.pageSize,
      )
    ).map(withoutProfile),
    total,
    page,
    pageSize: filter.pageSize,
    pages: Math.max(1, Math.ceil(total / filter.pageSize)),
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
  const club = player.club_id
    ? await clubOf(store, player.club_id)
    : await clubOf(store);
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
    value: valuation(player, {
      date: state.date,
      leagueReputation: club.reputation,
      balance: club.balance,
      philosophy: club.philosophy,
      inflation: Number(settings.transferInflation),
      crisis: club.crisis,
      hype: club.hype,
    }),
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
    `${playerSelect} WHERE coalesce(players.squad_club_id,players.club_id) = ? AND players.role != 'Retired' ORDER BY players.ability DESC`,
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
    negotiations: await store.all(
      "SELECT negotiations.*, players.name AS player_name, players.position, players.age, players.ability, players.potential, buyer.name AS buyer_name, seller.name AS seller_name FROM negotiations JOIN players ON players.id = negotiations.player_id JOIN clubs AS buyer ON buyer.id = negotiations.buying_club_id LEFT JOIN clubs AS seller ON seller.id = negotiations.selling_club_id WHERE buying_club_id = ? OR selling_club_id = ? ORDER BY negotiations.id DESC",
      id,
      id,
    ),
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
  return {
    loans: await store.all<Loan>(
      "SELECT loans.*, players.name AS player_name, players.position, players.age, players.ability, players.potential, parent.name AS parent_name, destination.name AS destination_name, destination.color AS destination_color FROM loans JOIN players ON players.id = loans.player_id JOIN clubs AS parent ON parent.id = loans.parent_id JOIN clubs AS destination ON destination.id = loans.destination_id WHERE loans.parent_id = ? OR loans.destination_id = ? ORDER BY loans.id DESC",
      id,
      id,
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
      "SELECT TOP (40) * FROM staff WHERE club_id IS NULL ORDER BY ability DESC,id",
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
    snapshot: MatchSnapshot;
    penalties: { home: number; away: number } | null;
    winnerId: number;
    aggregate?: { home: number; away: number };
    tie?: { id: string; leg: number; legs: number };
    awarded?: { home: number; away: number; reason: string } | null;
  };
  return {
    fixture: { ...fixture, data: "" },
    snapshot: data.snapshot,
    result: simulateMatch(data.snapshot, fixture.seed),
    penalties: data.penalties,
    winnerId: data.winnerId,
    aggregate: data.aggregate,
    tie: data.tie,
    awarded: data.awarded,
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
