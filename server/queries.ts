import type { SQLInputValue } from "node:sqlite";
import { z } from "zod";
import { Store } from "./db.ts";
import {
  clubOf,
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
} from "../shared/types.ts";
import { simulateMatch } from "./match.ts";

const playerSelect = `SELECT players.*, clubs.name AS club_name, clubs.color AS club_color, countries.name AS country_name, countries.code AS country_code FROM players LEFT JOIN clubs ON clubs.id = players.club_id JOIN countries ON countries.id = players.country_id`;
const fixtureSelect = `SELECT fixtures.*, home.name AS home_name, away.name AS away_name, home.color AS home_color, away.color AS away_color, leagues.name AS competition_name, coalesce(leagues.age_group,'Senior') AS age_group FROM fixtures JOIN clubs AS home ON home.id = fixtures.home_id JOIN clubs AS away ON away.id = fixtures.away_id LEFT JOIN leagues ON leagues.id = fixtures.league_id`;
const standingSelect = `SELECT standings.*, clubs.name AS club_name, clubs.color AS club_color, clubs.reputation FROM standings JOIN clubs ON clubs.id = standings.club_id`;
const withoutProfile = (player: Player): Player => ({ ...player, profile: "" });

export function bootstrap(store: Store): Bootstrap {
  const state = stateOf(store);
  const club = store.get<Club>(
    "SELECT clubs.*, countries.name AS country_name, countries.code AS country_code, leagues.name AS league_name FROM clubs JOIN countries ON countries.id = clubs.country_id LEFT JOIN leagues ON leagues.id = clubs.league_id WHERE clubs.id = ?",
    state.clubId,
  )!;
  const world = store.get<WorldTotals>(
    `SELECT (SELECT count(*) FROM countries) AS countries, (SELECT count(*) FROM leagues WHERE kind = 'league') AS leagues, (SELECT count(*) FROM clubs WHERE type != 'national') AS clubs, (SELECT count(*) FROM players) AS players, (SELECT count(*) FROM players WHERE age_group = 'Senior') AS seniors, (SELECT count(*) FROM players WHERE age_group != 'Senior') AS youth, (SELECT count(*) FROM staff) AS staff`,
  )!;
  return {
    state,
    club,
    settings: settingsOf(store),
    world,
    countries: store.all<Country>("SELECT * FROM countries ORDER BY name"),
  };
}

export function dashboard(store: Store): Dashboard {
  const state = stateOf(store);
  const club = clubOf(store);
  const squad = store.get<Dashboard["squad"]>(
    "SELECT count(*) AS count, coalesce(avg(age),0) AS age, coalesce(avg(ability),0) AS ability, coalesce(sum(wage),0) AS wages, coalesce(sum(CASE WHEN injury_until IS NOT NULL THEN 1 ELSE 0 END),0) AS injuries, coalesce(sum(value),0) AS value, coalesce(avg(potential),0) AS potential FROM players WHERE club_id = ? AND age_group = 'Senior'",
    state.clubId,
  )!;
  squad.wages = weeklyWages(store, state.clubId);
  return {
    squad,
    fixtures: store.all<Fixture>(
      `${fixtureSelect} WHERE (home_id = ? OR away_id = ?) AND status = 'scheduled' AND (leagues.age_group = 'Senior' OR leagues.id IS NULL) ORDER BY date LIMIT 5`,
      state.clubId,
      state.clubId,
    ),
    results: store.all<Fixture>(
      `${fixtureSelect} WHERE (home_id = ? OR away_id = ?) AND status = 'played' AND (leagues.age_group = 'Senior' OR leagues.id IS NULL) ORDER BY date DESC LIMIT 4`,
      state.clubId,
      state.clubId,
    ),
    table: store.all<Standing>(
      `${standingSelect} WHERE standings.league_id = ? ORDER BY points DESC, (gf-ga) DESC, gf DESC, club_id`,
      club.league_id,
    ),
    news: store.all("SELECT * FROM news ORDER BY id DESC LIMIT 12"),
    shortlist: store
      .all<Player>(
        `${playerSelect} WHERE shortlisted = 1 ORDER BY potential DESC LIMIT 5`,
      )
      .map(withoutProfile),
    expiring: store
      .all<Player>(
        `${playerSelect} WHERE players.club_id = ? AND contract_end <= ? ORDER BY ability DESC LIMIT 5`,
        state.clubId,
        addDays(state.date, 365),
      )
      .map(withoutProfile),
    activeNegotiations: store.get<{ total: number }>(
      "SELECT count(*) AS total FROM negotiations WHERE (buying_club_id = ? OR selling_club_id = ?) AND stage IN ('Club talks','Agent talks','Medical','Offer received')",
      state.clubId,
      state.clubId,
    )!.total,
    activeLoans: store.get<{ total: number }>(
      "SELECT count(*) AS total FROM loans WHERE (parent_id = ? OR destination_id = ?) AND status = 'active'",
      state.clubId,
      state.clubId,
    )!.total,
    activeAssignments: store.get<{ total: number }>(
      "SELECT count(*) AS total FROM assignments WHERE status = 'active'",
    )!.total,
    unread: store.get<{ total: number }>(
      "SELECT count(*) AS total FROM news WHERE read = 0",
    )!.total,
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

export function players(store: Store, query: unknown): PlayerPage {
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
  const params: SQLInputValue[] = [
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
  const add = (sql: string, value: SQLInputValue) => {
    conditions.push(sql);
    params.push(value);
  };
  if (filter.q) {
    const search = `%${filter.q.replace(/[!%_]/g, "!$&")}%`;
    conditions.push(
      "(players.name LIKE ? ESCAPE '!' OR players.nationality LIKE ? ESCAPE '!' OR clubs.name LIKE ? ESCAPE '!')",
    );
    params.push(search, search, search);
  }
  if (filter.position) add("players.position = ?", filter.position);
  if (filter.country) add("players.country_id = ?", filter.country);
  if (filter.club) add("players.club_id = ?", filter.club);
  if (filter.ageGroup) add("players.age_group = ?", filter.ageGroup);
  if (filter.foot) add("players.foot = ?", filter.foot);
  if (filter.lifestyle)
    add("json_extract(profile,'$.lifestyle') = ?", filter.lifestyle);
  if (filter.trait)
    add(
      "EXISTS(SELECT 1 FROM json_each(profile,'$.traits') WHERE value = ?)",
      filter.trait,
    );
  if (filter.attribute) {
    const group = Object.entries(ATTRIBUTE_GROUPS).find(([, keys]) =>
      keys.includes(filter.attribute!),
    )?.[0];
    if (!group) throw new GameError("Unknown player attribute.");
    conditions.push(
      "json_extract(profile, ?) + (players.ability - json_extract(profile,'$.baseAbility')) >= ?",
    );
    params.push(
      `$.attributes.${group}.${filter.attribute}`,
      filter.attributeMin,
    );
  }
  if (filter.personality) {
    if (!PERSONALITY_KEYS.includes(filter.personality))
      throw new GameError("Unknown personality attribute.");
    conditions.push("json_extract(profile, ?) >= ?");
    params.push(`$.personality.${filter.personality}`, filter.personalityMin);
  }
  if (filter.heightMin > 0)
    add("json_extract(profile,'$.identity.height') >= ?", filter.heightMin);
  if (filter.heightMax < 230)
    add("json_extract(profile,'$.identity.height') <= ?", filter.heightMax);
  if (filter.contractMonths !== undefined)
    add(
      "players.contract_end <= ?",
      addDays(stateOf(store).date, Math.floor(filter.contractMonths * 30.44)),
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
  const total = store.get<{ count: number }>(
    `SELECT count(*) AS count FROM players LEFT JOIN clubs ON clubs.id = players.club_id WHERE ${where}`,
    ...params,
  )!.count;
  const page = Math.min(
    filter.page,
    Math.max(1, Math.ceil(total / filter.pageSize)),
  );
  return {
    players: store
      .all<Player>(
        `${playerSelect} WHERE ${where} ORDER BY players.${filter.sort} ${filter.direction}, players.id LIMIT ? OFFSET ?`,
        ...params,
        filter.pageSize,
        (page - 1) * filter.pageSize,
      )
      .map(withoutProfile),
    total,
    page,
    pageSize: filter.pageSize,
    pages: Math.max(1, Math.ceil(total / filter.pageSize)),
  };
}

export function playerDetail(store: Store, id: number): PlayerDetail {
  playerOf(store, id);
  const player = store.get<Player>(`${playerSelect} WHERE players.id = ?`, id)!;
  const profile = JSON.parse(player.profile) as PlayerProfile;
  const club = player.club_id ? clubOf(store, player.club_id) : clubOf(store);
  const state = stateOf(store);
  const settings = settingsOf(store);
  const staff = store.get<{ ability: number }>(
    "SELECT coalesce(avg(ability),50) AS ability FROM staff WHERE club_id = ?",
    club.id,
  )!.ability;
  return {
    player: withoutProfile(player),
    profile,
    report:
      store.get<ScoutReport>(
        "SELECT reports.*, staff.name AS scout_name FROM reports JOIN staff ON staff.id = reports.staff_id WHERE player_id = ? ORDER BY reports.id DESC LIMIT 1",
        id,
      ) ?? null,
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
    history: store.all(
      "SELECT date, data, entity_type FROM history WHERE entity_id = ? AND entity_type IN ('appearance','transfer') ORDER BY id DESC LIMIT 20",
      id,
    ),
    promises: store.all(
      "SELECT * FROM promises WHERE player_id = ? ORDER BY id DESC",
      id,
    ),
    loan:
      store.get<Loan>(
        "SELECT * FROM loans WHERE player_id = ? AND status = 'active'",
        id,
      ) ?? null,
  };
}

export function squad(store: Store): SquadData {
  const state = stateOf(store);
  const all = store.all<Player>(
    `${playerSelect} WHERE players.club_id = ? ORDER BY players.ability DESC`,
    state.clubId,
  );
  const senior = all.filter((player) => player.age_group === "Senior");
  return {
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
    promises: store.all(
      "SELECT promises.*, players.name AS player_name FROM promises LEFT JOIN players ON players.id = promises.player_id ORDER BY promises.id DESC LIMIT 30",
    ),
  };
}

export function scouting(store: Store): ScoutingData {
  const clubId = stateOf(store).clubId;
  return {
    scouts: store.all<Staff>(
      "SELECT * FROM staff WHERE club_id = ? AND role = 'Scout' ORDER BY ability DESC",
      clubId,
    ),
    assignments: store.all(
      "SELECT assignments.*, staff.name AS scout_name, players.name AS player_name, countries.name AS country_name FROM assignments JOIN staff ON staff.id = assignments.staff_id LEFT JOIN players ON players.id = assignments.player_id LEFT JOIN countries ON countries.id = assignments.country_id ORDER BY assignments.id DESC LIMIT 30",
    ),
    reports: store.all(
      "SELECT reports.*, players.name AS player_name, players.position, players.age, clubs.name AS club_name, staff.name AS scout_name FROM reports JOIN players ON players.id = reports.player_id LEFT JOIN clubs ON clubs.id = players.club_id JOIN staff ON staff.id = reports.staff_id ORDER BY reports.id DESC LIMIT 50",
    ),
    shortlist: store
      .all<Player>(
        `${playerSelect} WHERE shortlisted = 1 ORDER BY potential DESC LIMIT 100`,
      )
      .map(withoutProfile),
  };
}

export function transfers(store: Store): TransferDesk {
  const id = stateOf(store).clubId;
  return {
    negotiations: store.all(
      "SELECT negotiations.*, players.name AS player_name, players.position, players.age, players.ability, players.potential, buyer.name AS buyer_name, seller.name AS seller_name FROM negotiations JOIN players ON players.id = negotiations.player_id JOIN clubs AS buyer ON buyer.id = negotiations.buying_club_id LEFT JOIN clubs AS seller ON seller.id = negotiations.selling_club_id WHERE buying_club_id = ? OR selling_club_id = ? ORDER BY negotiations.id DESC",
      id,
      id,
    ),
    targets: store
      .all<Player>(
        `${playerSelect} WHERE shortlisted = 1 AND players.club_id != ? ORDER BY potential DESC LIMIT 20`,
        id,
      )
      .map(withoutProfile),
    market: store.all(
      "SELECT * FROM history WHERE entity_type = 'transfer' ORDER BY id DESC LIMIT 20",
    ),
  };
}

export function loans(store: Store): LoanDesk {
  const id = stateOf(store).clubId;
  return {
    loans: store.all<Loan>(
      "SELECT loans.*, players.name AS player_name, players.position, players.age, players.ability, players.potential, parent.name AS parent_name, destination.name AS destination_name, destination.color AS destination_color FROM loans JOIN players ON players.id = loans.player_id JOIN clubs AS parent ON parent.id = loans.parent_id JOIN clubs AS destination ON destination.id = loans.destination_id WHERE loans.parent_id = ? OR loans.destination_id = ? ORDER BY loans.id DESC",
      id,
      id,
    ),
    partnerships: store.all(
      "SELECT partnerships.*, clubs.name, clubs.color, clubs.reputation FROM partnerships JOIN clubs ON clubs.id = partnerships.partner_id WHERE partnerships.club_id = ? ORDER BY strength DESC",
      id,
    ),
    candidates: store
      .all<Player>(
        `${playerSelect} WHERE players.club_id = ? AND players.age BETWEEN 16 AND 24 AND players.parent_club_id IS NULL ORDER BY available_loan DESC, potential DESC LIMIT 30`,
        id,
      )
      .map(withoutProfile),
  };
}

export function staff(store: Store): StaffDesk {
  const id = stateOf(store).clubId;
  return {
    staff: store.all<Staff>(
      "SELECT * FROM staff WHERE club_id = ? ORDER BY role, ability DESC",
      id,
    ),
    candidates: store.all<Staff>(
      "SELECT * FROM staff WHERE club_id IS NULL ORDER BY ability DESC LIMIT 40",
    ),
    relationships: store.all(
      "SELECT relationships.*, source.name AS source_name, target.name AS target_name FROM relationships JOIN staff AS source ON source.id = source_id JOIN staff AS target ON target.id = target_id WHERE relationships.club_id = ? AND source_type = 'staff' AND source.club_id = ? AND target.club_id = ?",
      id,
      id,
      id,
    ),
  };
}

export function competition(store: Store, id: number): CompetitionDetail {
  const league = store.get<League>(
    "SELECT leagues.*, countries.name AS country_name FROM leagues LEFT JOIN countries ON countries.id = leagues.country_id WHERE leagues.id = ?",
    id,
  );
  if (!league) throw new Error("Competition not found.");
  return {
    league,
    table: store.all<Standing>(
      `${standingSelect} WHERE standings.league_id = ? ORDER BY group_name, points DESC, (gf-ga) DESC, gf DESC, club_id`,
      id,
    ),
    fixtures: store.all<Fixture>(
      `${fixtureSelect} WHERE fixtures.league_id = ? AND fixtures.season = ? ORDER BY fixtures.date LIMIT 600`,
      id,
      stateOf(store).season,
    ),
    qualifiers: store.all<League>(
      "SELECT * FROM leagues WHERE json_extract(data,'$.qualificationFor') = ?",
      id,
    ),
    history: store.all(
      "SELECT * FROM history WHERE entity_id = ? AND entity_type IN ('league','champion') ORDER BY season DESC LIMIT 10",
      id,
    ),
  };
}

export function matches(
  store: Store,
  query: { club?: number; league?: number; age?: string; status?: string },
) {
  const conditions: string[] = ["fixtures.season = ?"];
  const params: SQLInputValue[] = [stateOf(store).season];
  if (query.league) {
    conditions.push("fixtures.league_id = ?");
    params.push(query.league);
  } else {
    conditions.push("(fixtures.home_id = ? OR fixtures.away_id = ?)");
    params.push(
      query.club ?? stateOf(store).clubId,
      query.club ?? stateOf(store).clubId,
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
  return store
    .all<Fixture>(
      `${fixtureSelect} WHERE ${conditions.join(" AND ")} ORDER BY fixtures.date DESC LIMIT 120`,
      ...params,
    )
    .map((fixture) => ({ ...fixture, data: "" }));
}

export function matchDetail(store: Store, id: number): MatchDetail {
  const fixture = store.get<Fixture>(
    `${fixtureSelect} WHERE fixtures.id = ?`,
    id,
  );
  if (!fixture) throw new Error("Fixture not found.");
  if (fixture.status !== "played") return { fixture };
  const data = JSON.parse(fixture.data) as {
    snapshot: MatchSnapshot;
    penalties: { home: number; away: number } | null;
    winnerId: number;
  };
  return {
    fixture: { ...fixture, data: "" },
    snapshot: data.snapshot,
    result: simulateMatch(data.snapshot, fixture.seed),
    penalties: data.penalties,
    winnerId: data.winnerId,
  };
}

export function finances(store: Store): FinanceData {
  const club = clubOf(store);
  const wages = weeklyWages(store, club.id);
  const staffWages = store.get<{ total: number }>(
    "SELECT coalesce(sum(wage),0) AS total FROM staff WHERE club_id = ?",
    club.id,
  )!.total;
  return {
    ledger: store.all(
      "SELECT * FROM ledger WHERE club_id = ? ORDER BY id DESC LIMIT 80",
      club.id,
    ),
    history: store
      .all<{ date: string; data: string }>(
        "SELECT * FROM history WHERE entity_type = 'finance' AND entity_id = ? ORDER BY date DESC LIMIT 52",
        club.id,
      )
      .reverse()
      .map((row) => ({ date: row.date, ...JSON.parse(row.data) })),
    wages,
    staffWages,
    squadValue: store.get<{ total: number }>(
      "SELECT coalesce(sum(value),0) AS total FROM players WHERE (club_id = ? AND parent_club_id IS NULL) OR parent_club_id = ?",
      club.id,
      club.id,
    )!.total,
    projectedWages: (wages + staffWages) * 52,
    amortization: club.season_spend / 4,
    commitments: store.all(
      "SELECT players.name, json_extract(loans.terms,'$.optionFee') AS amount, loans.type FROM loans JOIN players ON players.id = loans.player_id WHERE loans.destination_id = ? AND loans.type IN ('Loan with option','Loan with obligation') AND loans.status = 'active'",
      club.id,
    ),
  };
}

export function training(store: Store): TrainingData {
  const id = stateOf(store).clubId;
  return {
    plan: store.get<TrainingData["plan"]>(
      "SELECT * FROM training_plans WHERE club_id = ?",
      id,
    ) ?? {
      focus: "Balanced",
      intensity: 50,
      youth_focus: "Technical",
      data: "{}",
    },
    players: store
      .all<Player>(
        `${playerSelect} WHERE players.club_id = ? ORDER BY players.age_group, players.ability DESC`,
        id,
      )
      .map(withoutProfile),
    injuries: store
      .all<Player>(
        `${playerSelect} WHERE players.club_id = ? AND injury_until IS NOT NULL ORDER BY injury_until`,
        id,
      )
      .map(withoutProfile),
    setPieces: store.get<TrainingData["setPieces"]>(
      "SELECT * FROM set_pieces WHERE club_id = ?",
      id,
    ) ?? { routine: "Near post", target: "Centre-back", risk: 50 },
    mentors: store
      .all<Player>(
        `${playerSelect} WHERE players.club_id = ? AND age >= 25 ORDER BY json_extract(profile,'$.personality.professionalism') DESC`,
        id,
      )
      .map(withoutProfile),
  };
}

export function academy(store: Store): AcademyData {
  const club = clubOf(store);
  return {
    players: store
      .all<Player>(
        `${playerSelect} WHERE players.club_id = ? AND players.age_group != 'Senior' ORDER BY potential DESC`,
        club.id,
      )
      .map((player) => ({
        ...withoutProfile(player),
        details: JSON.parse(player.profile),
      })),
    leagues: store.all<League>(
      "SELECT leagues.* FROM leagues JOIN standings ON standings.league_id = leagues.id WHERE standings.club_id = ? AND leagues.age_group != 'Senior' ORDER BY leagues.kind, leagues.age_group",
      club.id,
    ),
    fixtures: store.all<Fixture>(
      `${fixtureSelect} WHERE (home_id = ? OR away_id = ?) AND fixtures.date >= ? AND leagues.age_group != 'Senior' ORDER BY date LIMIT 12`,
      club.id,
      club.id,
      stateOf(store).date,
    ),
    intake: store.get<{ value: string }>(
      "SELECT value FROM meta WHERE key = 'lastIntake'",
    )
      ? store.meta("lastIntake")
      : null,
    dna: JSON.parse(club.data).youthDNA ?? "Technical intelligence",
  };
}
