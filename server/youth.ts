// Youth intake, squad maintenance and leavers at season rollover (world version 4).
import seedrandom from "seedrandom";
import type { Store } from "./db.ts";
import {
  birthDateForAge,
  createPlayer,
  insertPlayers,
  peopleContext,
  weightedIndex,
  type PeopleContext,
  type PlayerRow,
  type PlayerSpec,
  type Rng,
  contractYearsLeft,
  seniorRetirementChance,
} from "./people.ts";
import { retirementNotice } from "./notifications.ts";
import { baseWage, marketWage, professionalWageFloor, RENEWAL_BUDGET_SHARE, wageScale, wageScales } from "./finance.ts";
import {
  assessRegistration,
  clubRegistration,
  countsTowardQuota,
  familyResidence,
  foreignQuota,
  heldNationalities,
  minorPresenceLegal,
  minorRoute,
  passportGroup,
  registrationAssociationId,
  residenceYears,
  type ClubRegistration,
} from "./registration.ts";
import { news } from "./systems.ts";
import { ageOn, clamp, daysBetween, transferWindow, winterWindowClose } from "../shared/rules.ts";
import { MIN_GOALKEEPERS, SQUAD_MINIMUMS } from "../shared/world-rules.ts";
import { hasOwnLeague, nationByCode } from "../shared/world-catalog/index.ts";
import type {
  AgeGroup,
  Club,
  Country,
  GameState,
  Player,
  PlayerProfile,
  Position,
  Settings,
} from "../shared/types.ts";

export const INTAKE = { min: 5, max: 12 } as const;
/** Registered squad caps: youth squads for every club, first teams for AI clubs. */
export const SQUAD_CAPS = { youth: 26, firstTeam: 32, bTeam: 30 } as const;
/** AI youth squads after the rollover, below the cap: the top of the generated range (world.ts 20-24). */
export const AI_YOUTH_TARGET = 24;
const DEFAULT_SQUAD_SIZE: [number, number] = [25, 30];
const TERMINAL_STAGES = "('Completed','Rejected','Withdrawn','Expired','Hijacked')";

// ------------------------------------------------------------------ pure planning

/** Academy intake for one club: 5-12, rising with academy, youth coaching, facilities, recruitment, reputation and nation. */
export function intakeSize(
  club: Pick<Club, "academy" | "facilities" | "reputation">,
  context: { nationLevel: number; headOfYouth: number; recruitment: number },
  random: Rng,
): number {
  const quality =
    (0.34 * club.academy +
      0.18 * context.headOfYouth +
      0.14 * club.facilities +
      0.12 * context.recruitment +
      0.12 * club.reputation +
      0.1 * context.nationLevel) /
    99;
  const expected = INTAKE.min + (INTAKE.max - INTAKE.min) * clamp(quality, 0, 1) ** 0.9;
  return Math.round(clamp(expected + (random() + random() - 1) * 2.2, INTAKE.min, INTAKE.max));
}

/** Ability and potential of a youth of `age` produced at a club (same anchor as world generation). */
export function youthRatings(
  random: Rng,
  input: { reputation: number; academy: number; headOfYouth: number; age: number; wonderkids?: boolean; grassroots?: boolean },
) {
  const integer = (min: number, max: number) => Math.floor(random() * (max - min + 1)) + min;
  const ability = Math.round(
    clamp(
      input.reputation * 0.66 + 22 + integer(-11, 9) - (22 + (18 - input.age) * 2) +
        (input.academy - 50) * 0.08 - (input.grassroots ? 3 : 0),
      5,
      90,
    ),
  );
  const potential = Math.round(
    clamp(
      ability + integer(10, input.wonderkids ? 45 : 30) + (input.academy - 50) * 0.06 +
        (input.headOfYouth - 50) * 0.05 - (input.grassroots ? 2 : 0),
      ability,
      99,
    ),
  );
  return { ability, potential };
}

const YOUTH_TEMPLATE: readonly Position[] = ["GK", "GK", "CB", "CB", "CB", "CB", "LB", "LB", "RB", "RB", "DM", "DM", "CM", "CM", "AM", "AM", "LW", "RW", "ST", "ST"];
const SENIOR_TEMPLATE: readonly Position[] = ["GK", "GK", "GK", "CB", "CB", "CB", "CB", "LB", "LB", "RB", "RB", "DM", "DM", "DM", "CM", "CM", "CM", "AM", "AM", "LW", "LW", "RW", "RW", "ST", "ST"];
const OUTFIELD_CYCLE: readonly Position[] = ["CM", "CB", "ST", "DM", "RB", "LB", "AM", "RW", "LW"];
const INTAKE_POSITIONS: readonly [Position, number][] = [["GK", 10], ["CB", 16], ["LB", 8], ["RB", 8], ["DM", 10], ["CM", 14], ["AM", 8], ["LW", 8], ["RW", 8], ["ST", 10]];

/** Positions to add so a squad reaches `minimum` players and MIN_GOALKEEPERS, following the template shape. */
export function missingPositions(
  present: ReadonlyMap<Position, number>,
  minimum: number,
  senior = false,
): Position[] {
  const template = senior ? SENIOR_TEMPLATE : YOUTH_TEMPLATE;
  const left = new Map(present);
  const wanted: Position[] = [];
  for (const position of template) {
    const available = left.get(position) ?? 0;
    if (available > 0) left.set(position, available - 1);
    else wanted.push(position);
  }
  const total = [...present.values()].reduce((sum, count) => sum + count, 0);
  const keeperGap = Math.max(0, MIN_GOALKEEPERS - (present.get("GK") ?? 0));
  const additions: Position[] = Array.from({ length: keeperGap }, () => "GK" as Position);
  let skipKeepers = keeperGap;
  for (const position of wanted) {
    if (total + additions.length >= minimum) break;
    if (position === "GK" && skipKeepers > 0) {
      skipKeepers--;
      continue;
    }
    additions.push(position);
  }
  for (let index = 0; total + additions.length < minimum; index++)
    additions.push(OUTFIELD_CYCLE[index % OUTFIELD_CYCLE.length]);
  return additions;
}

/** Retention value for squad decisions: current level, youthful upside, age decline. */
export function keepScore(player: { ability: number; potential: number; age: number }) {
  const upside =
    Math.max(0, player.potential - player.ability) *
    (player.age <= 21 ? 0.6 : player.age <= 23 ? 0.35 : 0.1);
  return player.ability + upside - Math.max(0, player.age - 31) * 2;
}

/** Best `size` players by keepScore, holding at least `goalkeepers` keepers when available. */
export function selectSquad<Player extends { position: Position; ability: number; potential: number; age: number }>(
  players: readonly Player[],
  size: number,
  goalkeepers: number,
): { kept: Player[]; rest: Player[] } {
  const ranked = [...players].sort((left, right) => keepScore(right) - keepScore(left));
  const kept = ranked.filter((player) => player.position === "GK").slice(0, Math.min(goalkeepers, size));
  for (const player of ranked) {
    if (kept.length >= size) break;
    if (!kept.includes(player)) kept.push(player);
  }
  return { kept, rest: ranked.filter((player) => !kept.includes(player)) };
}

/** Ability below which a club-less player cannot find a club in the nation's lowest modeled tier. */
export const leaveThreshold = (weakestClubReputation: number) =>
  weakestClubReputation * 0.66 + 22 - 10;

/**
 * Chance that a player released at the rollover, and not re-signed by another club's top-up, tries the free-agent
 * market for one window instead of leaving the modeled game. Released academy players mostly drop out at once.
 */
export function freeAgentChance(player: { age: number; ability: number; potential: number }, threshold: number) {
  if (player.age < 18) return player.potential >= threshold + 20 ? 0.25 : 0;
  // Released graduates mostly drop into non-league football: lower-tier clubs fill their squads from their own academies.
  return clamp((player.ability - threshold) / 25, 0, 0.9) * (player.age <= 21 ? 0.35 : player.age >= 32 ? 0.5 : 1);
}

/**
 * Whether a free agent still unsigned when a registration period closes leaves the modeled game: no club of his
 * level wants him (below the weakest club's level + 10, veterans from 32, minors without a prospect's potential) or
 * he has been without a club for more than half a year.
 */
export function leavesFreeAgency(player: { age: number; ability: number; potential: number }, threshold: number, daysUnsigned: number) {
  if (daysUnsigned >= 180) return true;
  if (player.age < 18) return player.potential < threshold + 20;
  return player.ability < threshold + 10 || player.age >= 32;
}

/** Age group for the season starting on `date`, as the rollover assigns it: U17 below 17, U19 below 19. */
export function ageGroupFor(birthDate: string, date: string): AgeGroup {
  const age = ageOn(birthDate, date);
  return age < 17 ? "U17" : age < 19 ? "U19" : "Senior";
}

/** Youth competitions of `season` admit players born on or after this date (simulation lineups: 1 January, season − 16 or − 18). */
export function youthBirthCutoff(group: "U17" | "U19", season: number) {
  return `${season - (group === "U17" ? 16 : 18)}-01-01`;
}

/** Youngest age group whose competitions a player born on `birthDate` may enter in `season`. */
export function competitionGroup(birthDate: string, season: number): AgeGroup {
  return birthDate >= youthBirthCutoff("U17", season) ? "U17" : birthDate >= youthBirthCutoff("U19", season) ? "U19" : "Senior";
}

const pickPosition = (random: Rng) =>
  INTAKE_POSITIONS[weightedIndex(INTAKE_POSITIONS.map(([, weight]) => weight), random())][0];

// ------------------------------------------------------------------ world state

interface ClubRow
  extends Pick<
    Club,
    "id" | "name" | "type" | "parent_id" | "country_id" | "league_id" | "reputation" | "academy" | "facilities" | "balance" | "philosophy" | "data" | "wage_budget"
  > {
  code: string;
  nation_level: number;
  tier: number | null;
  league_code: string | null;
  league_reputation: number;
  head_of_youth: number;
  recruitment: number;
}

interface Member {
  id: number;
  club_id: number | null;
  squad_club_id: number | null;
  parent_club_id: number | null;
  country_id: number;
  age_group: AgeGroup;
  position: Position;
  ability: number;
  potential: number;
  birth_date: string;
  contract_end: string;
  wage: number;
  role: string;
  contract_status: string | null;
  injury_until?: string | null;
  /** profile.identity.nationalities, for quota and passport checks. */
  citizenships?: { code: string }[] | null;
  /** profile.identity.birthCountryId and profile.familyMove: the family's nation, for minors' registrations. */
  birth_country_id?: number | null;
  family_move?: PlayerProfile["familyMove"] | null;
  age: number;
  locked: boolean;
}

interface Available extends Member {
  /** Association (country id) the player was last registered with. */
  association: number;
  nationalities: string[];
  profile?: PlayerProfile;
  homeBased?: number;
}

type Reason = "retired" | "left-football";

/** An integer from a JSON text value, or NULL when it is missing or not an integer. */
const jsonInteger = (text: string) => `(CASE WHEN ${text} ~ '^-?[0-9]+$' THEN (${text})::integer END)`;

/** A JSON object member as jsonb, `{}` when it is missing or not an object. */
const jsonObject = (member: string) => `(CASE WHEN jsonb_typeof(${member}) = 'object' THEN ${member} ELSE '{}'::jsonb END)`;

/** A JSON text column rewritten by `edit`, which sees it parsed once as `doc`. */
const editJson = (column: string, edit: string) =>
  `(SELECT (${edit})::text FROM (SELECT ${column}::jsonb AS doc OFFSET 0) AS parsed)`;

/** Players leaving the modeled game (retired or left football, `profile.retirement` for Data's retention). */
const LEAVE_ASSIGNMENTS =
  "club_id = NULL, squad_club_id = NULL, wage = 0, value = 0, role = 'Retired', listed = 0, available_loan = 0, shortlisted = 0, profile = jsonb_set(target.profile::jsonb, '{retirement}', changes.retirement::jsonb)::text";

type ColumnType = "integer" | "text" | "double precision";

/** Per-player changes, one `UPDATE ... FROM unnest(...)` per 5 000 rows; `columns` (with `id`) are visible as `changes.*`. */
async function updatePlayers(
  store: Store,
  rows: readonly Record<string, string | number | null>[],
  columns: Record<string, ColumnType>,
  assignments: string,
) {
  const names = Object.keys(columns);
  for (let offset = 0; offset < rows.length; offset += 5000) {
    const batch = rows.slice(offset, offset + 5000);
    await store.run(
      `UPDATE players AS target SET ${assignments}
       FROM unnest(${names.map((name) => `?::${columns[name]}[]`).join(", ")}) AS changes(${names.join(", ")})
       WHERE changes.id = target.id`,
      ...names.map((name) => batch.map((row) => row[name] ?? null)),
    );
  }
}

const CLUB_ROWS =
  "SELECT clubs.id,clubs.name,clubs.type,clubs.parent_id,clubs.country_id,clubs.league_id,clubs.reputation,clubs.academy,clubs.facilities,clubs.balance,clubs.wage_budget,clubs.philosophy,clubs.data,countries.code,countries.reputation AS nation_level,leagues.tier,(SELECT code FROM countries AS league_country WHERE league_country.id = leagues.country_id) AS league_code,coalesce(leagues.reputation,countries.reputation) AS league_reputation,coalesce((SELECT max(ability) FROM staff WHERE staff.club_id = clubs.id AND staff.role = 'Head of youth'),50) AS head_of_youth,coalesce((SELECT avg(ability) FROM staff WHERE staff.club_id = clubs.id AND staff.role = 'Scout'),50) AS recruitment FROM clubs JOIN countries ON countries.id = clubs.country_id LEFT JOIN leagues ON leagues.id = clubs.league_id";

interface CreateContext {
  people: PeopleContext;
  registrations: Map<number, ClubRegistration>;
  date: string;
  season: number;
  style: string;
}

type NewPlayerSpec = Omit<PlayerSpec, "club" | "contextCode" | "date" | "leagueReputation" | "representCode"> & { representCode?: string };

function newPlayer(context: CreateContext, club: ClubRow, spec: NewPlayerSpec, random: Rng) {
  const row = createPlayer(random, context.people, {
    ...spec,
    club,
    representCode: spec.representCode ?? club.code,
    contextCode: club.code,
    marketCode: club.league_code ?? club.code,
    date: context.date,
    leagueReputation: club.league_reputation,
  });
  if (ageOn(spec.birthDate, context.date) < 18)
    legalizeMinor(row, club, context.registrations.get(club.id) ?? clubRegistration(club.code, club.data), context.people, context.date, random);
  return row;
}

/** An amateur youth of `age` for a club's U17 or U19 squad, born late enough for the group's competitions this season. */
function youthPlayer(context: CreateContext, club: ClubRow, group: "U17" | "U19", age: number, source: "academy" | "grassroots", random: Rng, position: Position) {
  const ratings = youthRatings(random, {
    reputation: club.reputation,
    academy: club.academy,
    headOfYouth: club.head_of_youth,
    age,
    wonderkids: context.style === "wonderkids",
    grassroots: source === "grassroots",
  });
  const imports = (nationByCode(club.code)?.football?.importSources ?? []).filter((entry) => context.people.byCode.has(entry.code));
  const foreign = imports.length && random() < foreignYouthShare(club, context.style) * (source === "grassroots" ? 0.5 : 1);
  const representCode = foreign ? imports[weightedIndex(imports.map((entry) => entry.weight), random())].code : club.code;
  const born = birthDateForAge(random, age, context.date);
  const cutoff = youthBirthCutoff(group, context.season);
  return newPlayer(context, club, {
    representCode,
    ageGroup: group,
    position,
    birthDate: born < cutoff ? cutoff : born,
    ability: ratings.ability,
    potential: ratings.potential,
    contract: "amateur",
    intake: { season: context.season, source },
  }, random);
}

/**
 * Over-age youths (born before their group's competition cutoff for `season`) move up: U17 to U19, U19 to the
 * first team. Loanees keep their squad; the user's club family only with `includeUser`. Returns all and the user's moves.
 */
async function moveOverageYouth(store: Store, season: number, userClubId: number, includeUser: boolean) {
  const u17 = youthBirthCutoff("U17", season);
  const u19 = youthBirthCutoff("U19", season);
  const family = "club_id IN (SELECT id FROM clubs WHERE id = ? OR parent_id = ?)";
  const where =
    "club_id IS NOT NULL AND parent_club_id IS NULL AND role != 'Retired' AND ((age_group = 'U17' AND birth_date < ?) OR (age_group = 'U19' AND birth_date < ?))";
  const user = includeUser
    ? ((await store.get<{ count: number }>(`SELECT count(*) AS count FROM players WHERE ${where} AND ${family}`, u17, u19, userClubId, userClubId))?.count ?? 0)
    : 0;
  const moved = await store.run(
    `UPDATE players SET age_group = CASE WHEN birth_date >= ? THEN 'U19' ELSE 'Senior' END, squad_club_id = CASE WHEN birth_date >= ? THEN squad_club_id ELSE NULL END WHERE ${where}${includeUser ? "" : ` AND NOT ${family}`}`,
    u19,
    u19,
    u17,
    u19,
    ...(includeUser ? [] : [userClubId, userClubId]),
  );
  return { moved: moved.changes, user };
}

const reservePolicyOf = (club: ClubRow) =>
  (JSON.parse(club.data || "{}").reservePolicy ?? {}) as {
    ageRule?: { maxAge: number; overage: number };
    squad?: [number, number];
  };

function squadTarget(club: ClubRow) {
  const tier = club.league_code && club.tier
    ? nationByCode(club.league_code)?.football?.leagues.find((entry) => entry.tier === club.tier)
    : undefined;
  const [low, high] = tier?.clubs.squadSize ?? DEFAULT_SQUAD_SIZE;
  return clamp(Math.round((low + high) / 2), SQUAD_MINIMUMS.Senior, firstTeamCap(club.league_code, club.tier));
}

/** AI B-team size kept at the rollover: the middle of the reserve policy's range, as world.ts generates. */
function bTeamTarget(club: ClubRow) {
  const [low, high] = reservePolicyOf(club).squad ?? [22, 26];
  return clamp(Math.round((low + high) / 2), SQUAD_MINIMUMS.BTeam, Math.max(SQUAD_MINIMUMS.BTeam, high));
}

/** A B-team withdrawn from league play (`clubs.data.parkedLeagueId`) receives players only up to the B-team minimum. */
const isParked = (club: Pick<ClubRow, "data">) => JSON.parse(club.data || "{}").parkedLeagueId != null;

/** B-team size the rollover tops up to: the reserve policy's lower bound, the minimum while parked. */
function bTeamFloor(club: ClubRow) {
  return isParked(club) ? SQUAD_MINIMUMS.BTeam : Math.max(SQUAD_MINIMUMS.BTeam, reservePolicyOf(club).squad?.[0] ?? 0);
}

/** AI first-team cap: 32, or the tier's larger catalog squad maximum (J1, K League 1, ISL, Série A/B, LPF). */
export function firstTeamCap(leagueCode: string | null | undefined, tier: number | null | undefined) {
  const spec = leagueCode && tier
    ? nationByCode(leagueCode)?.football?.leagues.find((entry) => entry.tier === tier)
    : undefined;
  return Math.max(SQUAD_CAPS.firstTeam, spec?.clubs.squadSize?.[1] ?? 0);
}

function foreignYouthShare(club: ClubRow, style: string) {
  const tier = club.league_code && club.tier
    ? nationByCode(club.league_code)?.football?.leagues.find((entry) => entry.tier === club.tier)
    : undefined;
  return (tier?.clubs.foreignShare ?? 0.2) * 0.35 * (style === "regional" ? 0.3 : style === "global" ? 2 : 1);
}

/**
 * An AI club's renewal of an expiring first-team contract. The offer starts from the club's going rate for the player
 * (`market`: his ability at its pay level) and moves with his standing: a first-choice player gets 5% more, a squad
 * player 5% less and a fringe player 15% less; a regular (60%+ of last season's league minutes) 5% more and a bit
 * part (under 20%) 8% less; youngsters 5% more and players past their peak (30, keepers 33) 6% less per year. It
 * stays within 60-130% of his current wage. The club only commits what its budget can sustain (`room`, weekly): it
 * cuts the offer by up to a fifth to fit, or lets him go. He refuses more often the deeper the cut, and a starter in
 * his prime sometimes leaves for a new challenge anyway. Returns the agreed wage, or who ended the talks.
 */
export function aiRenewalTerms(input: {
  wage: number;
  market: number;
  floor: number;
  age: number;
  position: Position;
  /** Place in the club's keep order (1 = first choice). */
  rank: number;
  minutesShare: number;
  room: number;
  /** The player's draw (0-1) against his refusal chance. */
  random: number;
}): { wage: number } | { leaves: "club" | "player" } {
  const role = input.rank <= 11 ? 1.05 : input.rank <= 18 ? 0.95 : 0.85;
  const form = input.minutesShare >= 0.6 ? 1.05 : input.minutesShare < 0.2 ? 0.92 : 1;
  const peak = input.position === "GK" ? 33 : 30;
  const age = input.age <= 23 ? 1.05 : input.age >= peak ? Math.max(0.6, 1 - 0.06 * (input.age - peak + 1)) : 1;
  const ask = clamp(input.market * role * form * age, input.wage * 0.6, Math.max(input.wage, 50) * 1.3);
  let wage = Math.max(input.floor, Math.round(ask / 10) * 10);
  if (wage > input.room) {
    const fitted = Math.floor(Math.max(0, input.room) / 10) * 10;
    if (fitted < wage * 0.8 || fitted < input.floor) return { leaves: "club" };
    wage = fitted;
  }
  const ratio = wage / Math.max(1, input.wage);
  const refusal = clamp(0.06 + Math.max(0, 0.95 - ratio) * 1.6 + (input.rank <= 11 && input.age <= 28 ? 0.06 : 0), 0, 0.75);
  return input.random < refusal ? { leaves: "player" } : { wage };
}

function contractYears(age: number, random: Rng) {
  const span = age < 18 ? [2, 3] : age < 24 ? [3, 4] : age < 30 ? [2, 3] : [1, 2];
  return span[0] + Math.floor(random() * (span[1] - span[0] + 1));
}

/**
 * Season rollover youth and squad cycle (`season` is the season that starts on `date`): retirements and
 * left-football marking, AI renewals/releases/B-team moves and caps, academy intake (5-12 aged 14-15 per club),
 * U17/U19 top-ups to 20 with two goalkeepers, first team to 25, B-teams to 20, and home-pool intake.
 */
export async function runYouthIntake(
  store: Store,
  season: number,
  date: string,
  random: Rng,
): Promise<{ academy: number; topUps: number; pools: number; created: number; retired: number; leftFootball: number; released: number }> {
  const state = await store.meta<GameState>("state");
  const settings = await store.meta<Settings>("settings");
  const style = String(settings.regenStyle ?? "balanced");
  const base = Math.floor(random() * 2 ** 31);
  const rng = (key: string) => seedrandom(`${base}:${key}`);
  const countries = await store.all<Country>("SELECT * FROM countries ORDER BY id");
  const people = peopleContext(countries);
  const clubs = await store.all<ClubRow>(`${CLUB_ROWS} WHERE clubs.type IN ('club','bteam') ORDER BY clubs.id`);
  const clubById = new Map(clubs.map((club) => [club.id, club]));
  const firstTeams = clubs.filter((club) => club.type === "club");
  const bTeamsOf = new Map<number, ClubRow[]>();
  for (const club of clubs)
    if (club.type === "bteam" && club.parent_id)
      bTeamsOf.set(club.parent_id, [...(bTeamsOf.get(club.parent_id) ?? []), club]);
  const userClubs = new Set(
    clubs.filter((club) => club.id === state.clubId || club.parent_id === state.clubId).map((club) => club.id),
  );
  const registrations = new Map<number, ClubRegistration>(
    clubs.map((club) => [club.id, clubRegistration(club.code, club.data)]),
  );
  const associationId = (clubId: number | null) =>
    clubId === null ? null : (people.byCode.get(registrations.get(clubId)?.association ?? "")?.id ?? clubById.get(clubId)?.country_id ?? null);
  const weakest = new Map<number, number>();
  for (const club of firstTeams)
    weakest.set(club.country_id, Math.min(weakest.get(club.country_id) ?? 99, club.reputation));

  // Youth registrations carry on until a club releases the player (amateur registrations for every club).
  await store.run(
    "UPDATE players SET contract_end = ? WHERE club_id IS NOT NULL AND parent_club_id IS NULL AND role != 'Retired' AND age_group IN ('U17','U19') AND contract_end < ? AND (profile::jsonb #>> '{contract,status}' = 'amateur' OR club_id NOT IN (SELECT id FROM clubs WHERE id = ? OR parent_id = ?))",
    `${season + 1}-06-30`,
    date,
    state.clubId,
    state.clubId,
  );
  const overage = await moveOverageYouth(store, season, state.clubId, true);
  const locked = new Set(
    (
      await store.all<{ player_id: number }>(
        `SELECT DISTINCT player_id FROM negotiations WHERE stage NOT IN ${TERMINAL_STAGES}`,
      )
    ).map((entry) => entry.player_id),
  );
  const members = (
    await store.all<Member>(
      `SELECT id,club_id,squad_club_id,parent_club_id,country_id,age_group,position,ability,potential,birth_date,contract_end,wage,role,injury_until,
         doc #>> '{contract,status}' AS contract_status,doc #> '{identity,nationalities}' AS citizenships,
         ${jsonInteger("doc #>> '{identity,birthCountryId}'")} AS birth_country_id,doc -> 'familyMove' AS family_move
       FROM players CROSS JOIN LATERAL (SELECT players.profile::jsonb AS doc OFFSET 0) AS parsed
       WHERE club_id IS NOT NULL AND role != 'Retired'`,
    )
  ).map((member) => ({
    ...member,
    age: ageOn(member.birth_date, date),
    locked: locked.has(member.id) || member.parent_club_id !== null,
  }));
  const rosters = new Map<number, Member[]>();
  const playing = (member: Member) => member.squad_club_id ?? member.club_id;
  const attach = (member: Member) => {
    const id = playing(member);
    if (id === null) return;
    const list = rosters.get(id);
    if (list) list.push(member);
    else rosters.set(id, [member]);
  };
  const detach = (member: Member) => {
    const list = rosters.get(playing(member) ?? -1);
    const index = list?.indexOf(member) ?? -1;
    if (index >= 0) list!.splice(index, 1);
  };
  for (const member of members) attach(member);
  const squad = (clubId: number, group: AgeGroup) =>
    (rosters.get(clubId) ?? []).filter((member) => member.age_group === group);

  const changed = new Map<number, Member>();
  const releasedFrom = new Map<number, number>();
  const professional = new Set<number>();
  const clearHome = new Set<number>();
  const joinPool = new Map<number, number>();
  const leavers = new Map<number, Reason>();
  const transfers: { id: number; from: number | null; to: number }[] = [];
  const available: Available[] = [];
  const userNotes: string[] = [];
  if (overage.user) userNotes.push(`moved ${overage.user} over-age youth player${overage.user === 1 ? "" : "s"} up an age group`);
  const touched = (member: Member) => changed.set(member.id, member);
  const heldBy = new Map<number, string[]>();
  const nationalitiesOf = (member: Member) => {
    let held = heldBy.get(member.id);
    if (!held) {
      const extra = member.citizenships ?? [];
      held = heldNationalities(people.byId.get(member.country_id)?.code ?? "", { identity: { nationalities: extra } } as Pick<PlayerProfile, "identity">).filter(Boolean);
      heldBy.set(member.id, held);
    }
    return held;
  };
  const scales = await wageScales(store);
  // Payroll each club is already committed to next season (contracts running on) and last season's league minutes.
  const committed = new Map<number, number>();
  for (const member of members)
    if (member.contract_end >= date) {
      const payer = member.parent_club_id ?? member.club_id!;
      committed.set(payer, (committed.get(payer) ?? 0) + member.wage);
    }
  const minutes = new Map(
    (
      await store.all<{ player_id: number; minutes: number }>(
        "SELECT player_id, sum(minutes) AS minutes FROM player_season_stats WHERE season = ? AND league_id IN (SELECT id FROM leagues WHERE kind = 'league') GROUP BY player_id",
        season - 1,
      )
    ).map((row) => [row.player_id, row.minutes]),
  );
  const payroll = new Map<number, { professionals: number; allowances: number }>();
  for (const member of members) {
    const payer = member.parent_club_id ?? member.club_id!;
    const entry = payroll.get(payer) ?? { professionals: 0, allowances: 0 };
    if ((member.contract_status ?? "professional") === "professional") entry.professionals++;
    else entry.allowances += member.wage;
    payroll.set(payer, entry);
  }
  const floors = new Map(
    clubs.map((club) => {
      const entry = payroll.get(club.id);
      return [club.id, professionalWageFloor(club.wage_budget, entry?.allowances ?? 0, entry?.professionals ?? 0)];
    }),
  );
  const wageFor = (member: Pick<Member, "ability" | "age">, clubId: number) =>
    Math.max(floors.get(clubId) ?? 50, Math.round((baseWage(member.ability) * (scales.get(clubId) ?? 1) * (member.age <= 20 ? 0.75 : 1)) / 10) * 10);
  const signProfessional = (member: Member, clubId: number, random: Rng) => {
    const market = wageFor(member, clubId);
    // Renewals keep >= 90% of the wage; ability only falls past the peak (growth.ts: ~30, keepers ~33).
    const declining = member.age >= (member.position === "GK" ? 33 : 30);
    const renewal = member.contract_status !== "amateur" && member.wage > 0 && !declining;
    member.wage = renewal ? Math.max(market, Math.ceil((member.wage * 0.9) / 10) * 10) : market;
    member.contract_end = `${season + contractYears(member.age, random)}-06-30`;
    member.contract_status = "professional";
    professional.add(member.id);
    touched(member);
  };
  const renewAt = (member: Member, wage: number, random: Rng) => {
    member.wage = wage;
    member.contract_end = `${season + contractYears(member.age, random)}-06-30`;
    member.contract_status = "professional";
    professional.add(member.id);
    touched(member);
  };
  const release = (member: Member) => {
    detach(member);
    const association = associationId(member.club_id);
    if (association !== null) releasedFrom.set(member.id, association);
    member.club_id = null;
    member.squad_club_id = null;
    member.role = "Free agent";
    member.wage = 0;
    member.contract_end = date;
    touched(member);
    available.push({
      ...member,
      association: association ?? member.country_id,
      nationalities: nationalitiesOf(member),
    });
  };
  const leave = (member: Member, reason: Reason) => {
    detach(member);
    member.club_id = null;
    member.squad_club_id = null;
    leavers.set(member.id, reason);
    changed.delete(member.id);
  };

  // 1. Retirements of contracted seniors (loanees finish their loans first); the user's clubs follow the 1 May notice.
  const retiring = rng("retire");
  const retiredNames: string[] = [];
  const notice = await retirementNotice(store, season - 1);
  for (const member of members)
    if (!member.parent_club_id && member.age_group === "Senior") {
      const roll = retiring();
      const user = member.club_id !== null && userClubs.has(member.club_id);
      const retires = user && notice
        ? notice.has(member.id)
        : roll <
          seniorRetirementChance({
            age: member.age,
            ability: member.ability,
            position: member.position,
            contractYears: contractYearsLeft(member.contract_end, date),
            injuryDays: member.injury_until && member.injury_until > date ? daysBetween(date, member.injury_until) : 0,
          });
      if (!retires) continue;
      if (user) retiredNames.push(String(member.id));
      leave(member, "retired");
    }

  // 2. Club-less players: retire, rejoin a home pool, or leave football after an unsigned window.
  const clubless = await store.all<Omit<Member, "age" | "locked" | "contract_status"> & { profile: string; code: string }>(
    "SELECT players.id,players.club_id,players.squad_club_id,players.parent_club_id,players.country_id,players.age_group,players.position,players.ability,players.potential,players.birth_date,players.contract_end,players.wage,players.role,players.profile,countries.code FROM players JOIN countries ON countries.id = players.country_id WHERE players.club_id IS NULL AND players.role != 'Retired'",
  );
  const poolSize = new Map<number, number>();
  const winterClosed = `${season}-01-01`;
  for (const row of clubless) {
    const profile = JSON.parse(row.profile) as PlayerProfile;
    const member: Member = { ...row, contract_status: profile.contract?.status ?? null, age: ageOn(row.birth_date, date), locked: locked.has(row.id) };
    if (
      retiring() < seniorRetirementChance({ age: member.age, ability: member.ability, position: member.position, clubless: !profile.homeBased }) ||
      (profile.homeBased && member.age >= 36)
    ) {
      leave(member, "retired");
      continue;
    }
    if (profile.homeBased) {
      poolSize.set(profile.homeBased.countryId, (poolSize.get(profile.homeBased.countryId) ?? 0) + 1);
      available.push({ ...member, association: profile.homeBased.countryId, nationalities: heldNationalities(row.code, profile), profile, homeBased: profile.homeBased.countryId });
      continue;
    }
    const association = profile.registration?.lastAssociationId ?? member.country_id;
    const unsigned = member.contract_end < winterClosed;
    const nation = nationByCode(row.code);
    if (unsigned && !member.locked && nation && !hasOwnLeague(nation) && nation.homePool && member.age < 33) {
      joinPool.set(member.id, member.country_id);
      poolSize.set(member.country_id, (poolSize.get(member.country_id) ?? 0) + 1);
      available.push({ ...member, association: member.country_id, nationalities: heldNationalities(row.code, profile), profile, homeBased: member.country_id });
      continue;
    }
    // Unsigned through a whole transfer window: out of the modeled game.
    if (!member.locked && unsigned) {
      leave(member, "left-football");
      continue;
    }
    available.push({ ...member, association, nationalities: heldNationalities(row.code, profile), profile });
  }

  // 3. AI clubs: B-team age rules, renewals, graduations, releases and first-team size.
  const intakeRandom = new Map(firstTeams.map((club) => [club.id, rng(`intake:${club.id}`)]));
  const intakeSizes = new Map(
    firstTeams.map((club) => [
      club.id,
      intakeSize(club, { nationLevel: club.nation_level, headOfYouth: club.head_of_youth, recruitment: club.recruitment }, intakeRandom.get(club.id)!),
    ]),
  );
  for (const club of firstTeams) {
    const bTeams = bTeamsOf.get(club.id) ?? [];
    // Reserve-team age rules bind every club, the user's included: surplus over-age players join the first team.
    for (const bTeam of bTeams) {
      const rule = reservePolicyOf(bTeam).ageRule;
      if (!rule) continue;
      const over = squad(bTeam.id, "Senior")
        .filter((member) => member.age > rule.maxAge && !member.locked)
        .sort((left, right) => keepScore(right) - keepScore(left));
      for (const member of over.slice(rule.overage)) {
        detach(member);
        member.club_id = club.id;
        member.squad_club_id = null;
        attach(member);
        touched(member);
      }
      const moved = Math.max(0, over.length - rule.overage);
      if (moved && userClubs.has(club.id))
        userNotes.push(`moved ${moved} over-age player${moved === 1 ? "" : "s"} (over ${rule.maxAge}, ${rule.overage} allowed) from the reserve team to the first team`);
    }
    if (userClubs.has(club.id)) continue;
    const random = rng(`squad:${club.id}`);
    const seniors = squad(club.id, "Senior");
    const fixed = seniors.filter((member) => member.locked || member.club_id !== club.id);
    const own = seniors.filter((member) => !fixed.includes(member));
    const { kept, rest } = selectSquad(own, Math.max(0, squadTarget(club) - fixed.length), 3);
    const order = [...kept].sort((left, right) => keepScore(right) - keepScore(left));
    let room = club.wage_budget * RENEWAL_BUDGET_SHARE - (committed.get(club.id) ?? 0);
    let count = fixed.length;
    // Expiring contracts are renewed best first, each on budget-aware terms (aiRenewalTerms); the rest go free.
    for (const member of order) {
      if (member.contract_status === "amateur") {
        member.role = "Prospect";
        signProfessional(member, club.id, random);
      } else if (member.contract_end < date) {
        const terms = aiRenewalTerms({
          wage: member.wage,
          market: wageFor(member, club.id),
          floor: floors.get(club.id) ?? 50,
          age: member.age,
          position: member.position,
          rank: order.indexOf(member) + 1,
          minutesShare: Math.min(1, (minutes.get(member.id) ?? 0) / 2700),
          room,
          random: random(),
        });
        if (!("wage" in terms)) {
          release(member);
          continue;
        }
        renewAt(member, terms.wage, random);
        room -= terms.wage;
      }
      count++;
    }
    for (const member of rest) {
      const expiring = member.contract_end < date;
      const graduate = member.contract_status === "amateur";
      const bTeam = (graduate || member.age <= 23) && !expiring
        ? bTeams.find((team) => {
            const roster = squad(team.id, "Senior");
            const rule = reservePolicyOf(team).ageRule;
            return roster.length < (isParked(team) ? SQUAD_MINIMUMS.BTeam : bTeamTarget(team)) &&
              (!rule || member.age <= rule.maxAge || roster.filter((entry) => entry.age > rule.maxAge).length < rule.overage);
          })
        : undefined;
      if (bTeam) {
        detach(member);
        member.squad_club_id = bTeam.id;
        attach(member);
        if (graduate) signProfessional(member, club.id, random);
        else touched(member);
      } else if (expiring || graduate || count >= squadTarget(club)) release(member);
      else count++;
    }
    for (const bTeam of bTeams) {
      const roster = squad(bTeam.id, "Senior").filter((member) => !member.locked);
      const rule = reservePolicyOf(bTeam).ageRule;
      for (const member of roster.filter((entry) => entry.club_id === bTeam.id && entry.contract_end < date))
        if (member.age <= (rule?.maxAge ?? 23)) signProfessional(member, bTeam.id, random);
        else release(member);
      const cap = bTeamTarget(bTeam);
      const { rest: surplus } = selectSquad(squad(bTeam.id, "Senior").filter((member) => !member.locked), cap, 2);
      for (const member of surplus) release(member);
    }
    // Youth squads down to the AI target, keeping room for this season's academy intake (U17) and the goalkeepers the top-ups add.
    for (const group of ["U17", "U19"] as const) {
      const all = squad(club.id, group);
      const youth = all.filter((member) => !member.locked);
      const cutoff = youthBirthCutoff(group, season);
      const keeperGap = Math.max(0, MIN_GOALKEEPERS - all.filter((member) => member.position === "GK" && member.birth_date >= cutoff).length);
      const cap = AI_YOUTH_TARGET - keeperGap - (group === "U17" ? (intakeSizes.get(club.id) ?? 0) : 0);
      if (all.length <= cap) continue;
      const room = cap - (all.length - youth.length);
      for (const member of selectSquad(youth, Math.max(0, room), MIN_GOALKEEPERS).rest) release(member);
    }
  }
  // Released adults below every club's level leave football at once; the rest look for a club.
  const gone = new Set<Available>();
  for (const member of available)
    if (releasedFrom.has(member.id) && member.age >= 18 && member.ability < leaveThreshold(weakest.get(member.association) ?? 0)) {
      gone.add(member);
      releasedFrom.delete(member.id);
      leave(member, "left-football");
    }
  const byAssociation = new Map<number, Available[]>();
  for (const candidate of available) {
    if (gone.has(candidate)) continue;
    const bucket = byAssociation.get(candidate.association);
    if (bucket) bucket.push(candidate);
    else byAssociation.set(candidate.association, [candidate]);
  }

  // 4. Academy intake.
  const created: PlayerRow[] = [];
  const createdPositions = new Map<string, Position[]>();
  const createdFor = new Map<number, number>();
  let academy = 0;
  const context: CreateContext = { people, registrations, date, season, style };
  const record = (club: ClubRow, group: AgeGroup, position: Position, row: PlayerRow) => {
    created.push(row);
    const key = `${club.id}:${group}`;
    createdPositions.set(key, [...(createdPositions.get(key) ?? []), position]);
    createdFor.set(club.id, (createdFor.get(club.id) ?? 0) + 1);
    return row;
  };
  const makePlayer = (club: ClubRow, spec: NewPlayerSpec, random: Rng) =>
    record(club, spec.ageGroup, spec.position, newPlayer(context, club, spec, random));
  const youthRow = (club: ClubRow, group: "U17" | "U19", age: number, source: "academy" | "grassroots", random: Rng, position = pickPosition(random)) =>
    record(club, group, position, youthPlayer(context, club, group, age, source, random, position));
  for (const club of firstTeams) {
    const random = intakeRandom.get(club.id)!;
    const count = intakeSizes.get(club.id)!;
    for (let index = 0; index < count; index++) youthRow(club, "U17", random() < 0.55 ? 14 : 15, "academy", random);
    academy += count;
  }
  const intakeByClub = new Map(createdFor);

  // 5. Top-ups: first teams to 25 and B-teams to 20 (seniors), then U19 and U17 to 20; two goalkeepers each.
  const present = (list: readonly { position: Position }[], extra: readonly Position[] = []) => {
    const counts = new Map<Position, number>();
    for (const position of [...list.map((entry) => entry.position), ...extra]) counts.set(position, (counts.get(position) ?? 0) + 1);
    return counts;
  };
  // advance() releases every expired non-loan contract at the end of this day, negotiations included.
  const staying = (list: Member[]) => list.filter((member) => member.contract_end >= date || member.parent_club_id !== null);
  // Club-less players registered in the club's association (or its home nation) first; seniors may also come from abroad.
  const take = (club: ClubRow, need: Position, test: (candidate: Available) => boolean, abroad = false, group: AgeGroup = "Senior") => {
    const registration = registrations.get(club.id)!;
    // Foreign-player quotas bind senior registrations: count every registered senior on all his nationalities.
    const quota = group === "Senior" && club.tier ? foreignQuota(registration.association, club.tier, registration.home) : undefined;
    const quotaFull = !!quota &&
      squad(club.id, "Senior").filter((member) => countsTowardQuota(quota, nationalitiesOf(member), registration.home)).length >= quota.limit;
    const rank = (candidate: Available) => (candidate.position === need ? 1000 : 0) + candidate.ability;
    let best: Available | undefined;
    const consider = (candidate: Available) => {
      if (gone.has(candidate) || candidate.locked || !test(candidate)) return;
      if (candidate.position !== need && (need === "GK" || candidate.position === "GK")) return;
      if (best && rank(candidate) <= rank(best)) return;
      if (quotaFull && usesQuota(candidate, club, registration)) return;
      if (canJoin(candidate, club, registration, people, date)) best = candidate;
    };
    const local = new Set([associationId(club.id), club.country_id]);
    for (const id of local) for (const candidate of byAssociation.get(id ?? -1) ?? []) consider(candidate);
    if (!best && abroad && available.length) {
      const start = (club.id * 7919) % available.length;
      for (let step = 0; step < Math.min(400, available.length); step++) {
        const candidate = available[(start + step) % available.length];
        if (!local.has(candidate.association)) consider(candidate);
      }
    }
    if (!best) return undefined;
    gone.add(best);
    heldBy.set(best.id, best.nationalities);
    return best;
  };
  const sign = (candidate: Available, club: ClubRow, group: AgeGroup, contractedTo: number, random: Rng) => {
    const member: Member = candidate;
    transfers.push({ id: member.id, from: releasedFrom.has(member.id) ? null : member.club_id, to: club.id });
    member.club_id = contractedTo;
    member.squad_club_id = contractedTo === club.id ? null : club.id;
    member.parent_club_id = null;
    member.age_group = group;
    member.role = group === "Senior" ? "Squad player" : "Prospect";
    if (candidate.homeBased !== undefined) clearHome.add(member.id);
    joinPool.delete(member.id);
    releasedFrom.delete(member.id);
    if (group === "Senior") signProfessional(member, contractedTo, random);
    else {
      member.wage = Math.round(10 + club.academy * 0.35);
      member.contract_end = `${season + 1}-06-30`;
      touched(member);
    }
    attach(member);
  };
  let topUps = 0;
  const seniorNeeds: { club: ClubRow; target: number; bTeamOf?: ClubRow }[] = [
    ...firstTeams.map((club) => ({ club, target: SQUAD_MINIMUMS.Senior })),
    ...clubs.filter((club) => club.type === "bteam" && club.parent_id && clubById.has(club.parent_id)).map((club) => ({
      club,
      target: bTeamFloor(club),
      bTeamOf: clubById.get(club.parent_id!)!,
    })),
  ];
  // AI squads give a player up to a senior squad only while they stay above their floor with two goalkeepers.
  const spares = (list: readonly Member[], floor: number, need: Position) =>
    list.length > floor && (need !== "GK" || list.filter((member) => member.position === "GK").length > MIN_GOALKEEPERS);
  const u19Cutoff = youthBirthCutoff("U19", season);
  for (const { club, target, bTeamOf } of seniorNeeds) {
    const random = rng(`senior:${club.id}`);
    const current = staying(squad(club.id, "Senior"));
    const needs = missingPositions(present(current), target, !bTeamOf);
    const academyClub = bTeamOf ?? club;
    const ai = !userClubs.has(academyClub.id);
    for (const need of needs) {
      const fits = (member: Member) => !member.locked && (member.position === need || (need !== "GK" && member.position !== "GK"));
      const byFit = (left: Member, right: Member) =>
        (right.position === need ? 1 : 0) - (left.position === need ? 1 : 0) || keepScore(right) - keepScore(left);
      // AI first teams call up a B-team player first, then a U19 player aged 17+, while those squads stay above their floors.
      if (ai && !bTeamOf) {
        let called: Member | undefined;
        for (const team of bTeamsOf.get(club.id) ?? []) {
          const roster = staying(squad(team.id, "Senior"));
          called = spares(roster, bTeamFloor(team), need) ? roster.filter(fits).sort(byFit)[0] : undefined;
          if (called) break;
        }
        if (called) {
          detach(called);
          called.club_id = club.id;
          called.squad_club_id = null;
          attach(called);
          touched(called);
          continue;
        }
      }
      const eligibleU19 = staying(squad(academyClub.id, "U19")).filter((member) => member.birth_date >= u19Cutoff);
      // The user's prospects keep their own contracts, so an expired one leaves tonight and cannot fill a place.
      const prospect = ai && !spares(eligibleU19, SQUAD_MINIMUMS.U19, need)
        ? undefined
        : squad(academyClub.id, "U19").filter((member) => fits(member) && member.contract_end >= date && member.age >= 17).sort(byFit)[0];
      if (prospect && (ai || !bTeamOf)) {
        detach(prospect);
        prospect.age_group = "Senior";
        prospect.squad_club_id = bTeamOf ? club.id : null;
        prospect.role = "Prospect";
        attach(prospect);
        if (userClubs.has(academyClub.id)) {
          touched(prospect);
          userNotes.push(`promoted a U19 ${need} to the ${bTeamOf ? "reserve team" : "first team"}`);
        } else signProfessional(prospect, academyClub.id, random);
        continue;
      }
      const level = club.reputation * 0.66 + 22;
      const suits = (candidate: Available) => candidate.age >= 18 && candidate.age <= (bTeamOf ? 23 : 34) && candidate.ability <= level + 6;
      // Free agents first, then home-based pool players.
      const agent =
        take(club, need, (candidate) => candidate.homeBased === undefined && suits(candidate), true) ??
        take(club, need, (candidate) => candidate.homeBased !== undefined && suits(candidate), true);
      if (agent) {
        sign(agent, club, "Senior", club.id, random);
        topUps++;
        if (userClubs.has(club.id)) userNotes.push(`signed free agent ${need}`);
        continue;
      }
      const age = 18 + Math.floor(random() * (bTeamOf ? 4 : 5));
      const ability = Math.round(clamp(level - 8 + (random() - 0.5) * 10 - Math.max(0, 23 - age), 10, 85));
      makePlayer(club, {
        ageGroup: "Senior",
        position: need,
        birthDate: birthDateForAge(random, age, date),
        ability,
        potential: Math.round(clamp(ability + random() * (age < 22 ? 14 : 6), ability, 99)),
        contract: "professional",
        wageScale: scales.get(club.id) ?? 1,
        wageFloor: floors.get(club.id) ?? 50,
        role: "Squad player",
        intake: { season, source: "trial" },
      }, random);
      topUps++;
      if (userClubs.has(club.id)) userNotes.push(`signed a ${need} after a trial`);
    }
  }
  const surplus = new Map<string, Member[]>();
  for (const club of firstTeams) {
    if (userClubs.has(club.id)) continue;
    for (const group of ["U19", "U17"] as const) {
      const youth = squad(club.id, group);
      if (youth.length <= 22) continue;
      const key = `${registrations.get(club.id)!.association}:${group}`;
      const cutoff = youthBirthCutoff(group, season);
      surplus.set(key, [
        ...(surplus.get(key) ?? []),
        ...selectSquad(youth.filter((member) => !member.locked), 22 - youth.filter((member) => member.locked).length, MIN_GOALKEEPERS).rest
          .filter((member) => member.birth_date >= cutoff && member.contract_end >= date),
      ]);
    }
  }
  // Youth squads count only players eligible for the group's competitions this season.
  for (const group of ["U19", "U17"] as const) {
    const minimum = SQUAD_MINIMUMS[group];
    const cutoff = youthBirthCutoff(group, season);
    for (const club of firstTeams) {
      const random = rng(`${group}:${club.id}`);
      const extra: Position[] = [];
      const eligible = staying(squad(club.id, group)).filter((member) => member.birth_date >= cutoff);
      const needs = missingPositions(present(eligible, createdPositions.get(`${club.id}:${group}`)), minimum);
      for (const need of needs) {
        const agent = take(club, need, (candidate) => competitionGroup(candidate.birth_date, season) === group && candidate.age >= (group === "U17" ? 14 : 16), false, group);
        if (agent) {
          sign(agent, club, group, club.id, random);
          topUps++;
          continue;
        }
        const pool = surplus.get(`${registrations.get(club.id)!.association}:${group}`) ?? [];
        const index = pool.findIndex((member) =>
          member.club_id !== club.id &&
          (member.position === need || (need !== "GK" && member.position !== "GK")) &&
          minorMayJoin(member, undefined, nationalitiesOf(member), registrations.get(club.id)!, people, date));
        if (index >= 0) {
          const [member] = pool.splice(index, 1);
          transfers.push({ id: member.id, from: member.club_id, to: club.id });
          detach(member);
          member.club_id = club.id;
          member.squad_club_id = null;
          attach(member);
          touched(member);
          topUps++;
          continue;
        }
        extra.push(need);
      }
      for (const need of extra) {
        youthRow(club, group, group === "U17" ? (random() < 0.5 ? 14 : 15) : random() < 0.7 ? 17 : 16, "grassroots", random, need);
        topUps++;
      }
    }
  }
  // Released players nobody re-signed: most leave the modeled game now, the rest try the free-agent market.
  const market = rng("free-agents");
  for (const member of available)
    if (releasedFrom.has(member.id) && !gone.has(member) && market() >= freeAgentChance(member, leaveThreshold(weakest.get(member.association) ?? 0))) {
      releasedFrom.delete(member.id);
      leave(member, "left-football");
    }

  // 6. Home-based pools of nations without an own league.
  let pools = 0;
  for (const country of countries) {
    const spec = nationByCode(country.code);
    if (!spec?.homePool || hasOwnLeague(spec)) continue;
    const random = rng(`pool:${country.id}`);
    const target = spec.homePool.seniors + spec.homePool.youth;
    const count = Math.round(clamp(spec.homePool.youth / 4 + (target - (poolSize.get(country.id) ?? 0)) * 0.5, 0, spec.homePool.youth));
    for (let index = 0; index < count; index++) {
      const age = random() < 0.7 ? 15 : 16;
      const integer = (min: number, max: number) => Math.floor(random() * (max - min + 1)) + min;
      const ability = Math.round(clamp(country.reputation * 0.66 + 22 + integer(-11, 9) - (22 + (18 - age) * 2), 5, 80));
      created.push(
        createPlayer(random, people, {
          club: null,
          representCode: country.code,
          contextCode: country.code,
          ageGroup: "U17",
          position: pickPosition(random),
          birthDate: birthDateForAge(random, age, date),
          date,
          ability,
          potential: Math.round(clamp(ability + integer(8, style === "wonderkids" ? 40 : 28), ability, 99)),
          leagueReputation: country.reputation,
          contract: "pool",
          intake: { season, source: "pool" },
        }),
      );
      pools++;
    }
  }

  // 7. Persist.
  const retirementRows = [...leavers].map(([id, reason]) => ({ id, retirement: JSON.stringify({ season: season - 1, date, reason }) }));
  await updatePlayers(store, retirementRows, { id: "integer", retirement: "text" }, LEAVE_ASSIGNMENTS);
  await updatePlayers(
    store,
    [...changed.values()].map((member) => ({
      id: member.id,
      club_id: member.club_id,
      squad_club_id: member.squad_club_id,
      age_group: member.age_group,
      contract_end: member.contract_end,
      wage: member.wage,
      role: member.role,
    })),
    {
      id: "integer",
      club_id: "integer",
      squad_club_id: "integer",
      age_group: "text",
      contract_end: "text",
      wage: "double precision",
      role: "text",
    },
    "club_id = changes.club_id, squad_club_id = changes.squad_club_id, parent_club_id = CASE WHEN changes.club_id IS NULL THEN NULL ELSE target.parent_club_id END, age_group = changes.age_group, contract_end = changes.contract_end, wage = changes.wage, role = changes.role, listed = CASE WHEN changes.club_id IS NULL OR changes.club_id != coalesce(target.club_id,0) THEN 0 ELSE target.listed END, available_loan = CASE WHEN changes.club_id IS NULL OR changes.club_id != coalesce(target.club_id,0) THEN 0 ELSE target.available_loan END",
  );
  await updatePlayers(
    store,
    [...releasedFrom].map(([id, association]) => ({ id, association })),
    { id: "integer", association: "integer" },
    `profile = ${editJson(
      "target.profile",
      `jsonb_set(doc, '{registration}', ${jsonObject("doc -> 'registration'")} || jsonb_build_object('lastAssociationId', changes.association))`,
    )}`,
  );
  await updatePlayers(
    store,
    [...professional].map((id) => ({ id, date })),
    { id: "integer", date: "text" },
    `profile = ${editJson(
      "target.profile",
      `jsonb_set(doc, '{contract}', ${jsonObject("doc -> 'contract'")} ||
        jsonb_build_object('status', 'professional', 'futureProfessionalContract', false, 'signedDate', changes.date))`,
    )}`,
  );
  await updatePlayers(
    store,
    [...clearHome].map((id) => ({ id })),
    { id: "integer" },
    "profile = (target.profile::jsonb - 'homeBased')::text",
  );
  await updatePlayers(
    store,
    [...joinPool].map(([id, countryId]) => ({ id, home: JSON.stringify({ countryId, since: date }) })),
    { id: "integer", home: "text" },
    "role = 'Home-based', profile = jsonb_set(target.profile::jsonb, '{homeBased}', changes.home::jsonb)::text",
  );
  await store.run(
    "UPDATE players SET contract_end = ? WHERE club_id IS NULL AND role != 'Retired' AND contract_end < ? AND profile::jsonb #>> '{homeBased,countryId}' IS NOT NULL",
    `${season + 1}-06-30`,
    `${season + 1}-06-30`,
  );
  await insertPlayers(store, created);
  for (let offset = 0; offset < transfers.length; offset += 5000) {
    const batch = transfers.slice(offset, offset + 5000);
    // A released player's transfer omits "from" rather than storing null.
    await store.run(
      `INSERT INTO history(season,entity_type,entity_id,date,data)
       SELECT ?::integer,'transfer',moves.id,?::text,json_strip_nulls(json_build_object('name',players.name,'from',moves.from_id,'to',moves.to_id,'club',clubs.name,'fee',0,'type','Squad registration'))::text
       FROM unnest(?::int[], ?::int[], ?::int[]) AS moves(id, from_id, to_id)
       JOIN players ON players.id = moves.id JOIN clubs ON clubs.id = moves.to_id`,
      season,
      date,
      batch.map((move) => move.id),
      batch.map((move) => move.from),
      batch.map((move) => move.to),
    );
  }
  await store.setMeta("youthIntake", {
    season,
    date,
    clubs: Object.fromEntries(intakeByClub),
  });
  const userIntake = intakeByClub.get(state.clubId) ?? 0;
  if (userIntake || userNotes.length || retiredNames.length)
    await news(
      store,
      "Academy",
      `${season}/${String(season + 1).slice(-2)} academy intake`,
      [
        userIntake ? `${userIntake} new players aged 14-15 have joined the U17 squad from the academy.` : "",
        userNotes.length ? `Squad registration: ${[...new Set(userNotes)].join("; ")}.` : "",
        retiredNames.length ? `${retiredNames.length} senior player${retiredNames.length === 1 ? " has" : "s have"} retired.` : "",
      ].filter(Boolean).join(" "),
      "success",
      "academy",
    );
  return {
    academy,
    topUps,
    pools,
    created: created.length,
    retired: [...leavers.values()].filter((reason) => reason === "retired").length,
    leftFootball: [...leavers.values()].filter((reason) => reason === "left-football").length,
    released: releasedFrom.size,
  };
}

/** A minor generated abroad without citizenship or residence came with parents who moved for work or family. */
function legalizeMinor(row: PlayerRow, club: ClubRow, registration: ClubRegistration, people: PeopleContext, date: string, random: Rng) {
  const profile = JSON.parse(String(row.profile)) as PlayerProfile;
  const code = people.byId.get(Number(row.country_id))?.code ?? club.code;
  const move = {
    age: ageOn(String(row.birth_date), date),
    nationalities: heldNationalities(code, profile),
    destination: registration,
    residence: familyResidence(profile, String(row.birth_date), date, (id) => people.byId.get(id)?.code),
  };
  if (minorPresenceLegal(move)) return;
  const years = 1 + Math.floor(random() * Math.max(1, move.age - 6));
  profile.familyMove = {
    countryId: club.country_id,
    reason: random() < 0.7 ? "employment" : "family",
    verified: true,
    date: `${Number(date.slice(0, 4)) - years}-${String(1 + Math.floor(random() * 12)).padStart(2, "0")}-15`,
  };
  row.profile = JSON.stringify(profile);
}

/**
 * A minor moved by the rollover must be lawfully present at the new club without the move history, as the soak
 * checks: one registration association is not enough (a Derry youth, FAI-registered, at a Republic club).
 */
export function minorMayJoin(
  member: Pick<Member, "age" | "birth_date" | "birth_country_id" | "family_move">,
  profile: PlayerProfile | undefined,
  nationalities: readonly string[],
  registration: ClubRegistration,
  people: PeopleContext,
  date: string,
) {
  if (member.age >= 18) return true;
  const family = profile ?? {
    identity: { birthCountryId: member.birth_country_id ?? undefined },
    ...(member.family_move ? { familyMove: member.family_move } : {}),
  };
  const residence = familyResidence(family, member.birth_date, date, (id) => people.byId.get(id)?.code);
  return minorPresenceLegal({ age: member.age, nationalities, destination: registration, residence });
}

/** Registration check for automatic squad top-ups: Article 19 for minors, FA endorsement proxy for adults (quotas: `take`). */
function canJoin(
  candidate: Available,
  club: ClubRow,
  registration: ClubRegistration,
  people: PeopleContext,
  date: string,
) {
  const source = people.byId.get(candidate.association)?.code;
  const sameAssociation = source === registration.association || source === registration.home;
  if (!minorMayJoin(candidate, candidate.profile, candidate.nationalities, registration, people, date)) return false;
  if (!candidate.profile) return sameAssociation;
  if (candidate.age < 18) {
    const route = minorRoute({
      age: candidate.age,
      nationalities: candidate.nationalities,
      source: source ? { home: source, association: source } : null,
      destination: registration,
      residenceYears: residenceYears(candidate.profile, club.country_id, candidate.birth_date, date),
    });
    return route.route === "domestic" || route.route === "first-registration";
  }
  return sameAssociation || passportGroup(registration.association) !== "GB" || candidate.nationalities.some((code) => ["GB", "IE"].includes(passportGroup(code)));
}

function usesQuota(candidate: Pick<Available, "age" | "nationalities">, club: ClubRow, registration: ClubRegistration) {
  const quota = club.tier ? foreignQuota(registration.association, club.tier, registration.home) : undefined;
  return candidate.age >= 18 && !!quota && countsTowardQuota(quota, candidate.nationalities, registration.home);
}

/** Last day of the latest registration period closed before `date` (FIFA RSTP Art. 6.1 cut-off for free agents). */
function lastWindowClose(date: string) {
  const year = Number(date.slice(0, 4));
  const winter = winterWindowClose(year);
  return date.slice(5) > "09-01" ? `${year}-09-01` : date > winter ? winter : `${year - 1}-09-01`;
}

/** Free agents left unsigned by the registration period that closed on `closedAt` and no longer wanted leave football. */
async function freeAgentDepartures(store: Store, state: Pick<GameState, "date" | "season">, closedAt: string) {
  const weakest = new Map(
    (await store.all<{ country_id: number; reputation: number }>(
      "SELECT country_id,min(reputation) AS reputation FROM clubs WHERE type = 'club' GROUP BY country_id",
    )).map((row) => [row.country_id, row.reputation]),
  );
  const unsigned = await store.all<{ id: number; age: number; ability: number; potential: number; contract_end: string; association: number }>(
    `SELECT id,age,ability,potential,contract_end,coalesce(${jsonInteger("doc #>> '{registration,lastAssociationId}'")},country_id) AS association
     FROM players CROSS JOIN LATERAL (SELECT players.profile::jsonb AS doc OFFSET 0) AS parsed WHERE club_id IS NULL AND role = 'Free agent' AND contract_end <= ? AND NOT EXISTS (SELECT 1 FROM negotiations WHERE negotiations.player_id = players.id AND stage NOT IN ${TERMINAL_STAGES})`,
    closedAt,
  );
  const leaving = unsigned.filter((player) =>
    leavesFreeAgency(player, leaveThreshold(weakest.get(player.association) ?? 0), daysBetween(player.contract_end, state.date)),
  );
  const retirement = JSON.stringify({ season: state.season, date: state.date, reason: "left-football" });
  await updatePlayers(store, leaving.map(({ id }) => ({ id, retirement })), { id: "integer", retirement: "text" }, LEAVE_ASSIGNMENTS);
  return leaving.length;
}

interface Promotable {
  id: number;
  position: Position;
  ability: number;
  potential: number;
  age: number;
  role: string;
}

/**
 * In-season squad check of AI clubs, at most weekly (daily loop): over-age youths move up, free agents left unsigned by a
 * closed window and no longer wanted leave football, and every squad keeps its minimum of eligible players
 * (SQUAD_MINIMUMS: first team 25, B-team, U19 and U17 20) with two eligible goalkeepers. No transfers. First teams call up
 * B-team players, then U19 players aged 17+, while those squads stay above their minimums; then sign free agents (outside
 * a window only those out of contract before it closed, FIFA RSTP Art. 6.1), then home-based pool players (in a window),
 * then promote U19 players anyway. B-teams follow the same order without the B-team step, up to their minimum only (a
 * parked B-team keeps its 20). U19 squads promote U17 players the U17 can spare; youth squads then register grassroots
 * trialists (amateur). From 1 June the rollover rebuilds squads, so nothing is added. The user's club family is left to
 * the user.
 */
export async function maintainSquads(store: Store, state: Pick<GameState, "date" | "season" | "clubId">) {
  const result = { moved: 0, left: 0, promoted: 0, signed: 0, registered: 0 };
  if (state.date >= `${state.season + 1}-06-01`) return result;
  const last = await store.get<{ value: string }>("SELECT value FROM meta WHERE key = 'youthSquadCheck'");
  const previous = last ? (JSON.parse(last.value) as { date: string; season: number; totals?: typeof result }) : undefined;
  if (previous && previous.season === state.season && daysBetween(previous.date, state.date) < 7) return result;
  result.moved = (await moveOverageYouth(store, state.season, state.clubId, false)).moved;
  const window = transferWindow(state.date);
  const closedAt = lastWindowClose(state.date);
  if (!window && previous && previous.date <= closedAt) result.left = await freeAgentDepartures(store, state, closedAt);
  const cutoffs = { U17: youthBirthCutoff("U17", state.season), U19: youthBirthCutoff("U19", state.season) };
  const counts = await store.all<{ club_id: number; age_group: AgeGroup; position: Position; count: number }>(
    "SELECT coalesce(squad_club_id,club_id) AS club_id,age_group,position,count(*) AS count FROM players WHERE club_id IS NOT NULL AND role != 'Retired' AND (contract_end >= ? OR parent_club_id IS NOT NULL) AND (age_group = 'Senior' OR (age_group = 'U17' AND birth_date >= ?) OR (age_group = 'U19' AND birth_date >= ?)) GROUP BY coalesce(squad_club_id,club_id),age_group,position",
    state.date,
    cutoffs.U17,
    cutoffs.U19,
  );
  const present = new Map<string, Map<Position, number>>();
  for (const row of counts) {
    const key = `${row.club_id}:${row.age_group}`;
    present.set(key, (present.get(key) ?? new Map()).set(row.position, row.count));
  }
  const squadOf = (clubId: number, group: AgeGroup) => {
    let entry = present.get(`${clubId}:${group}`);
    if (!entry) present.set(`${clubId}:${group}`, (entry = new Map()));
    return entry;
  };
  const sizeOf = (squad: Map<Position, number>) => [...squad.values()].reduce((sum, count) => sum + count, 0);
  const clubs = await store.all<{ id: number; type: string; parent_id: number | null }>(
    "SELECT id,type,parent_id FROM clubs WHERE type IN ('club','bteam') AND id != ? AND coalesce(parent_id,0) != ? ORDER BY id",
    state.clubId,
    state.clubId,
  );
  const firstTeams = clubs.filter((club) => club.type === "club");
  const firstTeamIds = new Set(firstTeams.map((club) => club.id));
  const bTeams = clubs.filter((club) => club.type === "bteam" && firstTeamIds.has(club.parent_id ?? -1));
  const reservesOf = new Map<number, number[]>();
  for (const bTeam of bTeams) reservesOf.set(bTeam.parent_id!, [...(reservesOf.get(bTeam.parent_id!) ?? []), bTeam.id]);
  const lists = new Map<string, Promotable[]>();
  // Players a squad can move up: a B-team's contracted seniors, or academy players eligible by cutoff (U19 aged 17+).
  const promotable = async (sourceId: number, group: "Senior" | "U17" | "U19") => {
    const key = `${sourceId}:${group}`;
    let list = lists.get(key);
    if (!list) {
      list = group === "Senior"
        ? await store.all<Promotable>(
            "SELECT id,position,ability,potential,age,role FROM players WHERE playing_club_id = ? AND age_group = 'Senior' AND parent_club_id IS NULL AND role != 'Retired' AND contract_end >= ?",
            sourceId,
            state.date,
          )
        : await store.all<Promotable>(
            "SELECT id,position,ability,potential,age,role FROM players WHERE club_id = ? AND squad_club_id IS NULL AND parent_club_id IS NULL AND age_group = ? AND role != 'Retired' AND contract_end >= ? AND birth_date >= ? AND age >= ?",
            sourceId,
            group,
            state.date,
            cutoffs[group],
            group === "U19" ? 17 : 0,
          );
      lists.set(key, list);
    }
    return list;
  };
  const promotions: { id: number; club_id: number; age_group: AgeGroup; squad_club_id: number | null; role: string }[] = [];
  // Moves the best fitting player of squad `from` at `sourceId` into `to`; `spare` keeps the source above its minimum.
  const promote = async (sourceId: number, from: "Senior" | "U17" | "U19", to: { clubId: number; group: AgeGroup }, need: Position, spare: boolean) => {
    const source = squadOf(sourceId, from);
    const floor = from === "Senior" ? SQUAD_MINIMUMS.BTeam : SQUAD_MINIMUMS[from];
    if (spare && (sizeOf(source) <= floor || (need === "GK" && (source.get("GK") ?? 0) <= MIN_GOALKEEPERS))) return false;
    const list = await promotable(sourceId, from);
    const fits = list.filter((player) => (need === "GK" ? player.position === "GK" : player.position !== "GK"));
    const best = fits.sort((left, right) => (right.position === need ? 1 : 0) - (left.position === need ? 1 : 0) || keepScore(right) - keepScore(left))[0];
    if (!best) return false;
    list.splice(list.indexOf(best), 1);
    source.set(best.position, (source.get(best.position) ?? 1) - 1);
    const target = squadOf(to.clubId, to.group);
    target.set(best.position, (target.get(best.position) ?? 0) + 1);
    // B-team players move to the first team's registration; academy players keep theirs.
    const clubId = from === "Senior" ? to.clubId : sourceId;
    promotions.push({
      id: best.id,
      club_id: clubId,
      age_group: to.group,
      squad_club_id: to.clubId === clubId ? null : to.clubId,
      role: to.group === "Senior" && from !== "Senior" ? "Prospect" : best.role,
    });
    result.promoted++;
    return true;
  };
  // Club-less adults at the club's level: free agents, or home-based pool players (`pool`, in a window only).
  const signClubless = async (clubId: number, need: Position, maxAge: number, pool: boolean) => {
    const buyer = await store.get<Club>("SELECT * FROM clubs WHERE id = ?", clubId);
    if (!buyer) return false;
    const level = buyer.reputation * 0.66 + 22;
    const candidates = await store.all<Player>(
      `SELECT * FROM players WHERE club_id IS NULL AND ${pool ? "role = 'Home-based'" : "role = 'Free agent' AND contract_end <= ?"} AND age_group = 'Senior' AND age BETWEEN 18 AND ? AND ability BETWEEN ? AND ? AND (injury_until IS NULL OR injury_until <= ?) AND ${need === "GK" ? "position = 'GK'" : "position != 'GK'"} AND NOT EXISTS (SELECT 1 FROM negotiations WHERE negotiations.player_id = players.id AND stage NOT IN ${TERMINAL_STAGES}) ORDER BY CASE WHEN position = ? THEN 0 ELSE 1 END,abs(ability - ?),id LIMIT 8`,
      ...(pool ? [] : [window ? state.date : closedAt]),
      maxAge,
      level - 10,
      level + 6,
      state.date,
      need,
      level,
    );
    const payroll = (await store.get<{ total: number }>(
      "SELECT coalesce(sum(wage),0) AS total FROM players WHERE (club_id = ? AND parent_club_id IS NULL) OR parent_club_id = ?",
      buyer.id,
      buyer.id,
    ))!.total;
    const scale = await wageScale(store, buyer.id);
    for (const player of candidates) {
      const wage = marketWage({ ...player, age_group: "Senior", wage: 0 }, scale);
      if (payroll + wage > buyer.wage_budget || !(await assessRegistration(store, player, buyer)).allowed) continue;
      if (!(await registerFreeAgent(store, state, player, buyer, wage, player.age >= 30 ? 1 : 2))) continue;
      const squad = squadOf(buyer.id, "Senior");
      squad.set(player.position, (squad.get(player.position) ?? 0) + 1);
      result.signed++;
      return true;
    }
    return false;
  };
  // Senior squads first: their promotions can leave a B-team or the U19 short, and U19 promotions the U17.
  for (const club of [...firstTeams, ...bTeams]) {
    const first = club.type === "club";
    const academyId = first ? club.id : club.parent_id!;
    const maxAge = first ? 34 : 23;
    const to = { clubId: club.id, group: "Senior" as const };
    for (const need of missingPositions(squadOf(club.id, "Senior"), first ? SQUAD_MINIMUMS.Senior : SQUAD_MINIMUMS.BTeam, true)) {
      let called = false;
      for (const reserve of first ? (reservesOf.get(club.id) ?? []) : []) {
        called = await promote(reserve, "Senior", to, need, true);
        if (called) break;
      }
      if (called || (await promote(academyId, "U19", to, need, true))) continue;
      if (await signClubless(club.id, need, maxAge, false)) continue;
      if (window && (await signClubless(club.id, need, maxAge, true))) continue;
      await promote(academyId, "U19", to, need, false);
    }
  }
  const short: { clubId: number; group: "U17" | "U19"; needs: Position[] }[] = [];
  for (const group of ["U19", "U17"] as const)
    for (const { id } of firstTeams) {
      const needs: Position[] = [];
      for (const need of missingPositions(squadOf(id, group), SQUAD_MINIMUMS[group]))
        if (group === "U17" || !(await promote(id, "U17", { clubId: id, group: "U19" }, need, true))) needs.push(need);
      if (needs.length) {
        // Grassroots trialists count at once, so the U17 check sees the squad as it will be.
        const squad = squadOf(id, group);
        for (const need of needs) squad.set(need, (squad.get(need) ?? 0) + 1);
        short.push({ clubId: id, group, needs });
      }
    }
  await updatePlayers(
    store,
    promotions,
    { id: "integer", club_id: "integer", age_group: "text", squad_club_id: "integer", role: "text" },
    "club_id = changes.club_id, age_group = changes.age_group, squad_club_id = changes.squad_club_id, role = changes.role",
  );
  if (short.length) {
    const people = peopleContext(await store.all<Country>("SELECT * FROM countries ORDER BY id"));
    const settings = await store.meta<Settings>("settings");
    const rows = new Map(
      (await store.all<ClubRow>(
        `${CLUB_ROWS} WHERE clubs.id = ANY(?::int[]) ORDER BY clubs.id`,
        [...new Set(short.map((entry) => entry.clubId))],
      )).map((club) => [club.id, club]),
    );
    const context: CreateContext = {
      people,
      registrations: new Map([...rows.values()].map((club) => [club.id, clubRegistration(club.code, club.data)])),
      date: state.date,
      season: state.season,
      style: String(settings.regenStyle ?? "balanced"),
    };
    const created: PlayerRow[] = [];
    for (const { clubId, group, needs } of short) {
      const club = rows.get(clubId);
      if (!club) continue;
      const random = seedrandom(`youth-squads:${state.date}:${clubId}:${group}`);
      for (const need of needs)
        created.push(youthPlayer(context, club, group, group === "U17" ? (random() < 0.5 ? 14 : 15) : random() < 0.7 ? 17 : 16, "grassroots", random, need));
    }
    await insertPlayers(store, created);
    result.registered = created.length;
  }
  // Season totals for the simulation check: over-age moves, free agents leaving, promotions, signings, trialists.
  const before = previous?.season === state.season ? previous.totals : undefined;
  const totals = Object.fromEntries(Object.entries(result).map(([key, value]) => [key, value + (before?.[key as keyof typeof result] ?? 0)]));
  await store.setMeta("youthSquadCheck", { date: state.date, season: state.season, totals });
  return result;
}

/** Fee-free professional registration of a club-less player at `buyer`, recorded as a free transfer. */
async function registerFreeAgent(store: Store, state: Pick<GameState, "date" | "season">, player: Player, buyer: Club, wage: number, years: number) {
  const moved = await store.run(
    `UPDATE players SET club_id = ?, squad_club_id = NULL, parent_club_id = NULL, wage = ?, contract_end = ?, role = 'Squad player', listed = 0, available_loan = 0,
       profile = ${editJson(
         "players.profile",
         `(doc - 'homeBased') || jsonb_build_object(
           'contract', ${jsonObject("doc -> 'contract'")} || jsonb_build_object('status', 'professional'),
           'registration', ${jsonObject("doc -> 'registration'")} || jsonb_build_object('lastAssociationId', ?::integer))`,
       )}
     WHERE id = ? AND club_id IS NULL`,
    buyer.id,
    wage,
    `${state.season + years}-06-30`,
    await registrationAssociationId(store, buyer),
    player.id,
  );
  if (!moved.changes) return false;
  await store.run(
    "INSERT INTO history(season,entity_type,entity_id,date,data) VALUES (?,'transfer',?,?,?)",
    state.season,
    player.id,
    state.date,
    JSON.stringify({ name: player.name, from: null, to: buyer.id, club: buyer.name, fee: 0, type: "Free transfer" }),
  );
  return true;
}
