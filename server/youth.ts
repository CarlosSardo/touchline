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
} from "./people.ts";
import { baseWage, marketWage, professionalWageFloor, wageScale, wageScales } from "./finance.ts";
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
import { ageOn, clamp } from "../shared/rules.ts";
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

/** Probability that a senior retires at the end of a season. */
export function retirementChance(age: number, ability: number, clubless: boolean) {
  if (age >= 40) return 1;
  if (age < 33) return clubless && age >= 30 ? 0.12 : 0;
  return clamp(0.1 + (age - 33) * 0.12 + (ability < 55 ? 0.1 : 0) + (clubless ? 0.25 : 0), 0, 1);
}

/** Ability below which a club-less player cannot find a club in the nation's lowest modeled tier. */
export const leaveThreshold = (weakestClubReputation: number) =>
  weakestClubReputation * 0.66 + 22 - 10;

/** Age group for the season starting on `date`, as the rollover assigns it: U17 below 17, U19 below 19. */
export function ageGroupFor(birthDate: string, date: string): AgeGroup {
  const age = ageOn(birthDate, date);
  return age < 17 ? "U17" : age < 19 ? "U19" : "Senior";
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

async function updatePlayers(
  store: Store,
  rows: Record<string, string | number | null>[],
  columns: string,
  assignments: string,
) {
  for (let offset = 0; offset < rows.length; offset += 1000)
    await store.run(
      `UPDATE target SET ${assignments} FROM players AS target JOIN OPENJSON(?) WITH (${columns}) AS changes ON changes.id = target.id`,
      JSON.stringify(rows.slice(offset, offset + 1000)),
    );
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
  const clubs = await store.all<ClubRow>(
    `SELECT clubs.id,clubs.name,clubs.type,clubs.parent_id,clubs.country_id,clubs.league_id,clubs.reputation,clubs.academy,clubs.facilities,clubs.balance,clubs.wage_budget,clubs.philosophy,clubs.data,countries.code,countries.reputation AS nation_level,leagues.tier,(SELECT code FROM countries AS league_country WHERE league_country.id = leagues.country_id) AS league_code,coalesce(leagues.reputation,countries.reputation) AS league_reputation,coalesce((SELECT max(ability) FROM staff WHERE staff.club_id = clubs.id AND staff.role = 'Head of youth'),50) AS head_of_youth,coalesce((SELECT avg(CONVERT(float,ability)) FROM staff WHERE staff.club_id = clubs.id AND staff.role = 'Scout'),50) AS recruitment FROM clubs JOIN countries ON countries.id = clubs.country_id LEFT JOIN leagues ON leagues.id = clubs.league_id WHERE clubs.type IN ('club','bteam') ORDER BY clubs.id`,
  );
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
    "UPDATE players SET contract_end = ? WHERE club_id IS NOT NULL AND parent_club_id IS NULL AND role != 'Retired' AND age_group IN ('U17','U19') AND contract_end < ? AND (coalesce(JSON_VALUE(profile,'$.contract.status'),'professional') = 'amateur' OR club_id NOT IN (SELECT id FROM clubs WHERE id = ? OR parent_id = ?))",
    `${season + 1}-06-30`,
    date,
    state.clubId,
    state.clubId,
  );
  const locked = new Set(
    (
      await store.all<{ player_id: number }>(
        `SELECT DISTINCT player_id FROM negotiations WHERE stage NOT IN ${TERMINAL_STAGES}`,
      )
    ).map((entry) => entry.player_id),
  );
  const members = (
    await store.all<Member>(
      "SELECT id,club_id,squad_club_id,parent_club_id,country_id,age_group,position,ability,potential,birth_date,contract_end,wage,role,JSON_VALUE(profile,'$.contract.status') AS contract_status FROM players WHERE club_id IS NOT NULL AND role != 'Retired'",
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
  const touched = (member: Member) => changed.set(member.id, member);
  const scales = await wageScales(store);
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
    member.wage = wageFor(member, clubId);
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
      nationalities: [people.byId.get(member.country_id)?.code ?? ""].filter(Boolean),
    });
  };
  const leave = (member: Member, reason: Reason) => {
    detach(member);
    member.club_id = null;
    member.squad_club_id = null;
    leavers.set(member.id, reason);
    changed.delete(member.id);
  };

  // 1. Retirements of contracted seniors (loanees finish their loans first).
  const retiring = rng("retire");
  const retiredNames: string[] = [];
  for (const member of members)
    if (!member.parent_club_id && member.age_group === "Senior" && retiring() < retirementChance(member.age, member.ability, false)) {
      if (member.club_id !== null && userClubs.has(member.club_id)) retiredNames.push(String(member.id));
      leave(member, "retired");
    }

  // 2. Club-less players: retire, rejoin a home pool, or leave football after an unsigned window.
  const clubless = await store.all<Omit<Member, "age" | "locked" | "contract_status"> & { profile: string; code: string }>(
    "SELECT players.id,players.club_id,players.squad_club_id,players.parent_club_id,players.country_id,players.age_group,players.position,players.ability,players.potential,players.birth_date,players.contract_end,players.wage,players.role,players.profile,countries.code FROM players JOIN countries ON countries.id = players.country_id WHERE players.club_id IS NULL AND players.role != 'Retired'",
  );
  const poolSize = new Map<number, number>();
  const winterClosed = `${season}-01-01`;
  const yearAgo = `${season - 1}-07-01`;
  for (const row of clubless) {
    const profile = JSON.parse(row.profile) as PlayerProfile;
    const member: Member = { ...row, contract_status: profile.contract?.status ?? null, age: ageOn(row.birth_date, date), locked: locked.has(row.id) };
    if (retiring() < retirementChance(member.age, member.ability, !profile.homeBased) || (profile.homeBased && member.age >= 36)) {
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
    const below = member.ability < leaveThreshold(weakest.get(association) ?? weakest.get(member.country_id) ?? 0);
    if (!member.locked && unsigned && (member.age < 18 || below || member.contract_end < yearAgo)) {
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
    if (userClubs.has(club.id)) continue;
    const random = rng(`squad:${club.id}`);
    const bTeams = bTeamsOf.get(club.id) ?? [];
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
    }
    const seniors = squad(club.id, "Senior");
    const fixed = seniors.filter((member) => member.locked || member.club_id !== club.id);
    const own = seniors.filter((member) => !fixed.includes(member));
    const { kept, rest } = selectSquad(own, Math.max(0, squadTarget(club) - fixed.length), 3);
    for (const member of kept)
      if (member.contract_end < date || member.contract_status === "amateur") {
        if (member.contract_status === "amateur") member.role = "Prospect";
        signProfessional(member, club.id, random);
      }
    let count = fixed.length + kept.length;
    for (const member of rest) {
      const expiring = member.contract_end < date;
      const graduate = member.contract_status === "amateur";
      const bTeam = (graduate || member.age <= 23) && !expiring
        ? bTeams.find((team) => {
            const roster = squad(team.id, "Senior");
            const rule = reservePolicyOf(team).ageRule;
            return roster.length < (reservePolicyOf(team).squad?.[1] ?? SQUAD_CAPS.bTeam) &&
              (!rule || member.age <= rule.maxAge || roster.filter((entry) => entry.age > rule.maxAge).length < rule.overage);
          })
        : undefined;
      if (bTeam) {
        detach(member);
        member.squad_club_id = bTeam.id;
        attach(member);
        if (graduate) signProfessional(member, club.id, random);
        else touched(member);
      } else if (expiring || graduate || count >= firstTeamCap(club.league_code, club.tier)) release(member);
      else count++;
    }
    for (const bTeam of bTeams) {
      const roster = squad(bTeam.id, "Senior").filter((member) => !member.locked);
      const rule = reservePolicyOf(bTeam).ageRule;
      for (const member of roster.filter((entry) => entry.club_id === bTeam.id && entry.contract_end < date))
        if (member.age <= (rule?.maxAge ?? 23)) signProfessional(member, bTeam.id, random);
        else release(member);
      const cap = reservePolicyOf(bTeam).squad?.[1] ?? SQUAD_CAPS.bTeam;
      const { rest: surplus } = selectSquad(squad(bTeam.id, "Senior").filter((member) => !member.locked), cap, 2);
      for (const member of surplus) release(member);
    }
    // Youth squad caps, keeping room in the U17 squad for this season's academy intake.
    for (const group of ["U17", "U19"] as const) {
      const all = squad(club.id, group);
      const youth = all.filter((member) => !member.locked);
      const cap = SQUAD_CAPS.youth - (group === "U17" ? (intakeSizes.get(club.id) ?? 0) : 0);
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
  const makePlayer = (club: ClubRow, spec: Omit<PlayerSpec, "club" | "contextCode" | "date" | "leagueReputation" | "representCode"> & { representCode?: string }, random: Rng) => {
    const row = createPlayer(random, people, {
      ...spec,
      club,
      representCode: spec.representCode ?? club.code,
      contextCode: club.code,
      date,
      leagueReputation: club.league_reputation,
    });
    const age = ageOn(spec.birthDate, date);
    if (age < 18) legalizeMinor(row, club, registrations.get(club.id)!, people, date, random);
    created.push(row);
    const key = `${club.id}:${spec.ageGroup}`;
    createdPositions.set(key, [...(createdPositions.get(key) ?? []), spec.position]);
    createdFor.set(club.id, (createdFor.get(club.id) ?? 0) + 1);
    return row;
  };
  const youthRow = (club: ClubRow, group: "U17" | "U19", age: number, source: "academy" | "grassroots", random: Rng, position = pickPosition(random)) => {
    const ratings = youthRatings(random, {
      reputation: club.reputation,
      academy: club.academy,
      headOfYouth: club.head_of_youth,
      age,
      wonderkids: style === "wonderkids",
      grassroots: source === "grassroots",
    });
    const imports = (nationByCode(club.code)?.football?.importSources ?? []).filter((entry) => people.byCode.has(entry.code));
    const foreign = imports.length && random() < foreignYouthShare(club, style) * (source === "grassroots" ? 0.5 : 1);
    return makePlayer(club, {
      representCode: foreign ? imports[weightedIndex(imports.map((entry) => entry.weight), random())].code : club.code,
      ageGroup: group,
      position,
      birthDate: birthDateForAge(random, age, date),
      ability: ratings.ability,
      potential: ratings.potential,
      contract: "amateur",
      intake: { season, source },
    }, random);
  };
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
  const staying = (list: Member[]) => list.filter((member) => member.contract_end >= date || member.locked);
  const quotaUse = new Map<number, number>();
  // Club-less players registered in the club's association (or its home nation) first; seniors may also come from abroad.
  const take = (club: ClubRow, need: Position, test: (candidate: Available) => boolean, abroad = false) => {
    const registration = registrations.get(club.id)!;
    const rank = (candidate: Available) => (candidate.position === need ? 1000 : 0) + candidate.ability;
    let best: Available | undefined;
    const consider = (candidate: Available) => {
      if (gone.has(candidate) || candidate.locked || !test(candidate)) return;
      if (candidate.position !== need && (need === "GK" || candidate.position === "GK")) return;
      if (best && rank(candidate) <= rank(best)) return;
      if (canJoin(candidate, club, registration, people, date, quotaUse)) best = candidate;
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
    if (usesQuota(best, club, registration)) quotaUse.set(club.id, (quotaUse.get(club.id) ?? 0) + 1);
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
      target: Math.max(SQUAD_MINIMUMS.BTeam, reservePolicyOf(club).squad?.[0] ?? 0),
      bTeamOf: clubById.get(club.parent_id!)!,
    })),
  ];
  const userNotes: string[] = [];
  for (const { club, target, bTeamOf } of seniorNeeds) {
    const random = rng(`senior:${club.id}`);
    const current = staying(squad(club.id, "Senior"));
    const needs = missingPositions(present(current), target, !bTeamOf);
    const academyClub = bTeamOf ?? club;
    for (const need of needs) {
      const prospect = squad(academyClub.id, "U19")
        .filter((member) => !member.locked && member.age >= 17 && (member.position === need || (need !== "GK" && member.position !== "GK")))
        .sort((left, right) => (right.position === need ? 1 : 0) - (left.position === need ? 1 : 0) || keepScore(right) - keepScore(left))[0];
      if (prospect && (!userClubs.has(academyClub.id) || !bTeamOf)) {
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
      const agent = take(club, need, (candidate) => candidate.age >= 18 && candidate.age <= (bTeamOf ? 23 : 34) && candidate.ability <= level + 6, true);
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
      surplus.set(key, [
        ...(surplus.get(key) ?? []),
        ...selectSquad(youth.filter((member) => !member.locked), 22 - youth.filter((member) => member.locked).length, MIN_GOALKEEPERS).rest,
      ]);
    }
  }
  for (const group of ["U19", "U17"] as const) {
    const minimum = SQUAD_MINIMUMS[group];
    for (const club of firstTeams) {
      const random = rng(`${group}:${club.id}`);
      const extra: Position[] = [];
      const needs = missingPositions(present(staying(squad(club.id, group)), createdPositions.get(`${club.id}:${group}`)), minimum);
      for (const need of needs) {
        const agent = take(club, need, (candidate) => ageGroupFor(candidate.birth_date, date) === group && candidate.age >= (group === "U17" ? 14 : 16));
        if (agent) {
          sign(agent, club, group, club.id, random);
          topUps++;
          continue;
        }
        const pool = surplus.get(`${registrations.get(club.id)!.association}:${group}`) ?? [];
        const index = pool.findIndex((member) => member.club_id !== club.id && (member.position === need || (need !== "GK" && member.position !== "GK")));
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
  await updatePlayers(
    store,
    retirementRows,
    "id int, retirement nvarchar(max)",
    "club_id = NULL, squad_club_id = NULL, wage = 0, value = 0, role = 'Retired', listed = 0, available_loan = 0, shortlisted = 0, profile = JSON_MODIFY(target.profile,'$.retirement',JSON_QUERY(changes.retirement))",
  );
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
    "id int, club_id int, squad_club_id int, age_group nvarchar(10), contract_end nvarchar(10), wage float, role nvarchar(40)",
    "club_id = changes.club_id, squad_club_id = changes.squad_club_id, parent_club_id = CASE WHEN changes.club_id IS NULL THEN NULL ELSE target.parent_club_id END, age_group = changes.age_group, contract_end = changes.contract_end, wage = changes.wage, role = changes.role, listed = CASE WHEN changes.club_id IS NULL OR changes.club_id != coalesce(target.club_id,0) THEN 0 ELSE target.listed END, available_loan = CASE WHEN changes.club_id IS NULL OR changes.club_id != coalesce(target.club_id,0) THEN 0 ELSE target.available_loan END",
  );
  await updatePlayers(
    store,
    [...releasedFrom].map(([id, association]) => ({ id, association })),
    "id int, association int",
    "profile = JSON_MODIFY(JSON_MODIFY(target.profile,'$.registration',JSON_QUERY(coalesce(JSON_QUERY(target.profile,'$.registration'),N'{}'))),'$.registration.lastAssociationId',changes.association)",
  );
  await updatePlayers(
    store,
    [...professional].map((id) => ({ id, date })),
    "id int, date nvarchar(10)",
    "profile = JSON_MODIFY(JSON_MODIFY(JSON_MODIFY(target.profile,'$.contract.status','professional'),'$.contract.futureProfessionalContract',CAST(0 AS bit)),'$.contract.signedDate',changes.date)",
  );
  await updatePlayers(
    store,
    [...clearHome].map((id) => ({ id })),
    "id int",
    "profile = JSON_MODIFY(target.profile,'$.homeBased',NULL)",
  );
  await updatePlayers(
    store,
    [...joinPool].map(([id, countryId]) => ({ id, home: JSON.stringify({ countryId, since: date }) })),
    "id int, home nvarchar(200)",
    "role = 'Home-based', profile = JSON_MODIFY(target.profile,'$.homeBased',JSON_QUERY(changes.home))",
  );
  await store.run(
    "UPDATE players SET contract_end = ? WHERE club_id IS NULL AND role != 'Retired' AND JSON_VALUE(profile,'$.homeBased.countryId') IS NOT NULL AND contract_end < ?",
    `${season + 1}-06-30`,
    `${season + 1}-06-30`,
  );
  await insertPlayers(store, created);
  for (let offset = 0; offset < transfers.length; offset += 1000)
    await store.run(
      "INSERT INTO history(season,entity_type,entity_id,date,data) SELECT ?,'transfer',moves.id,?,(SELECT players.name,moves.[from],moves.[to],clubs.name AS club,0 AS fee,'Squad registration' AS type FOR JSON PATH,WITHOUT_ARRAY_WRAPPER) FROM OPENJSON(?) WITH (id int, [from] int, [to] int) AS moves JOIN players ON players.id = moves.id JOIN clubs ON clubs.id = moves.[to]",
      season,
      date,
      JSON.stringify(transfers.slice(offset, offset + 1000)),
    );
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
        userNotes.length ? `Minimum squad sizes: ${[...new Set(userNotes)].join("; ")}.` : "",
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

/** Registration check for automatic squad top-ups: Article 19 for minors, FA endorsement proxy and quotas for adults. */
function canJoin(
  candidate: Available,
  club: ClubRow,
  registration: ClubRegistration,
  people: PeopleContext,
  date: string,
  quotaUse: Map<number, number>,
) {
  const source = people.byId.get(candidate.association)?.code;
  const sameAssociation = source === registration.association || source === registration.home;
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
  if (!sameAssociation && passportGroup(registration.association) === "GB" && !candidate.nationalities.some((code) => ["GB", "IE"].includes(passportGroup(code))))
    return false;
  // One quota place per club and rollover for automatic signings; the club's own foreigners are not recounted here.
  return !usesQuota(candidate, club, registration) || (quotaUse.get(club.id) ?? 0) < 1;
}

function usesQuota(candidate: Pick<Available, "age" | "nationalities">, club: ClubRow, registration: ClubRegistration) {
  const quota = club.tier ? foreignQuota(registration.association, club.tier, registration.home) : undefined;
  return candidate.age >= 18 && !!quota && countsTowardQuota(quota, candidate.nationalities, registration.home);
}

/**
 * Fee-free AI signings of club-less adults in a transfer window: free agents and home-based pool players join
 * clubs at their level that are short of seniors or cover in their position, with wage room and a valid
 * registration. Returns the number of signings.
 */
export async function signClublessPlayers(
  store: Store,
  state: Pick<GameState, "date" | "season" | "clubId">,
  limit: number,
  random: Rng,
): Promise<number> {
  const maxId = (await store.get<{ id: number }>("SELECT max(id) AS id FROM players"))?.id ?? 0;
  const candidates = await store.all<Player>(
    `SELECT TOP (${Math.max(1, Math.round(limit) * 4)}) * FROM players WHERE club_id IS NULL AND role != 'Retired' AND age_group = 'Senior' AND age BETWEEN 18 AND 33 AND id >= ? AND (injury_until IS NULL OR injury_until <= ?) AND NOT EXISTS (SELECT 1 FROM negotiations WHERE negotiations.player_id = players.id AND stage NOT IN ${TERMINAL_STAGES}) ORDER BY id`,
    Math.floor(random() * maxId),
    state.date,
  );
  let signed = 0;
  for (const player of candidates) {
    if (signed >= limit) break;
    // Club level ≈ reputation × 0.66 + 22 (the generation anchor): the player fits clubs 6 above to 10 below.
    const buyers = await store.all<Club>(
      "SELECT TOP (6) * FROM clubs WHERE type = 'club' AND id != ? AND reputation BETWEEN ? AND ? AND (SELECT count(*) FROM players WHERE players.club_id = clubs.id AND players.squad_club_id IS NULL AND age_group = 'Senior' AND role != 'Retired') < ? ORDER BY (SELECT count(*) FROM players WHERE players.club_id = clubs.id AND players.position = ? AND age_group = 'Senior' AND role != 'Retired'),abs(reputation - ?),id",
      state.clubId,
      (player.ability - 6 - 22) / 0.66,
      (player.ability + 10 - 22) / 0.66,
      SQUAD_MINIMUMS.Senior + 1,
      player.position,
      (player.ability - 22) / 0.66 + random() * 6,
    );
    for (const buyer of buyers) {
      const wage = marketWage({ ...player, age_group: "Senior", wage: 0 }, await wageScale(store, buyer.id));
      const payroll = (await store.get<{ total: number }>(
        "SELECT coalesce(sum(wage),0) AS total FROM players WHERE (club_id = ? AND parent_club_id IS NULL) OR parent_club_id = ?",
        buyer.id,
        buyer.id,
      ))!.total;
      if (payroll + wage > buyer.wage_budget) continue;
      if (!(await assessRegistration(store, player, buyer)).allowed) continue;
      const years = player.age >= 30 ? 1 : 1 + Math.floor(random() * 3);
      const moved = await store.run(
        "UPDATE players SET club_id = ?, squad_club_id = NULL, parent_club_id = NULL, wage = ?, contract_end = ?, role = 'Squad player', listed = 0, available_loan = 0, profile = JSON_MODIFY(JSON_MODIFY(JSON_MODIFY(JSON_MODIFY(profile,'$.homeBased',NULL),'$.contract.status','professional'),'$.registration',JSON_QUERY(coalesce(JSON_QUERY(profile,'$.registration'),N'{}'))),'$.registration.lastAssociationId',?) WHERE id = ? AND club_id IS NULL",
        buyer.id,
        wage,
        `${state.season + years}-06-30`,
        await registrationAssociationId(store, buyer),
        player.id,
      );
      if (!moved.changes) break;
      await store.run(
        "INSERT INTO history(season,entity_type,entity_id,date,data) VALUES (?,'transfer',?,?,?)",
        state.season,
        player.id,
        state.date,
        JSON.stringify({ name: player.name, from: null, to: buyer.id, club: buyer.name, fee: 0, type: "Free transfer" }),
      );
      signed++;
      break;
    }
  }
  return signed;
}
