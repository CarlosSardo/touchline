// Call-ups inside the user's club family, the coach layer that proposes/makes them, and lineup-only call-ups for AI clubs.
import seedrandom from "seedrandom";
import type { Store } from "./db.ts";
import {
  clubSquads,
  GameError,
  movePlayerSquad,
  news,
  requireOwnPlayer,
  settingsOf,
  squadDestinations,
  stateOf,
} from "./systems.ts";
import { minorMayJoin, youthBirthCutoff } from "./youth.ts";
import { peopleContext } from "./people.ts";
import { clubRegistration, heldNationalities } from "./registration.ts";
import { addDays, ageOn, daysBetween, disciplineScope } from "../shared/rules.ts";
import {
  CALL_UP_RULES,
  type CallUp,
  type CallUpDesk,
  type CallUpDuration,
  type CallUpGroup,
  type CallUpLevel,
  type CallUpMeta,
  type CallUpPlayerView,
  type CallUpReason,
  type CallUpTeam,
  type DebutStanding,
} from "../shared/features/callups.ts";
import type { Club, Country, League, Player, PlayerProfile, Position } from "../shared/types.ts";

// ------------------------------------------------------------------ pure rules

export type Line = "GK" | "DEF" | "MID" | "ATT";
export const LINES: readonly Line[] = ["GK", "DEF", "MID", "ATT"];
export type TargetLevel = Exclude<CallUpLevel, "U17">;

export function lineOf(position: Position): Line {
  if (position === "GK") return "GK";
  if (position === "CB" || position === "LB" || position === "RB") return "DEF";
  if (position === "DM" || position === "CM" || position === "AM") return "MID";
  return "ATT";
}

export function median(values: readonly number[]) {
  if (!values.length) return 0;
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

/** Debut-budget standing: tier 3+, tier 2, or the top flight split by reputation rank (0 = most famous) in its league. */
export function debutStanding(tier: number | null | undefined, rank: number, size: number): DebutStanding {
  if (!tier || tier >= 3) return "lower";
  if (tier === 2) return "second";
  const rule = CALL_UP_RULES.debutBudget;
  const share = size > 0 ? rank / size : 0.5;
  return share < rule.eliteShare ? "elite" : share >= rule.bottomShare ? "bottom" : "mid";
}

/**
 * First-team academy debuts per season: the standing's base, +1 (not cumulative) for a strong academy or a youth
 * philosophy up to the standing's cap, then +1 / +2 in an injury crisis (`fitOutfield` fit senior outfielders).
 */
export function debutBudget(club: Pick<Club, "academy" | "philosophy">, standing: DebutStanding = "mid", fitOutfield?: number) {
  const rule = CALL_UP_RULES.debutBudget;
  const youth = club.academy >= rule.strongAcademy || club.philosophy === rule.youthPhilosophy ? 1 : 0;
  const crisis = fitOutfield === undefined ? 0 : fitOutfield < rule.severeBelow ? 2 : fitOutfield < rule.crisisBelow ? 1 : 0;
  return Math.min(rule.max[standing], rule.base[standing] + youth) + crisis;
}

/** Youngest age for senior football (first team, B-team) in an association. */
export function minSeniorAge(code: string | undefined) {
  const floors = CALL_UP_RULES.minSeniorAge;
  return code !== undefined && code !== "default" && floors[code] !== undefined ? floors[code] : floors.default;
}

/** Per-country B-team bar (only ✅ rules): Italy's second teams take no player with more than 50 Serie A appearances. */
export function bTeamIneligible(code: string | undefined, topFlightApps: number) {
  const rule = code === undefined ? undefined : CALL_UP_RULES.bTeamEligibility[code];
  return rule && topFlightApps > rule.maxTopFlightApps
    ? `Second teams may not field players with more than ${rule.maxTopFlightApps} top-flight appearances (${topFlightApps}).`
    : null;
}

/** Players per line wanted in the matchday squad (U19: leaner); congestion adds outfield cover. */
export function matchdayNeeds(congestion: boolean, level: TargetLevel = "Senior"): Record<Line, number> {
  const extra = congestion ? CALL_UP_RULES.congestionExtra : 0;
  const base = level === "U19" ? CALL_UP_RULES.youthMatchday : CALL_UP_RULES.matchday;
  return { GK: base.GK, DEF: base.DEF + extra, MID: base.MID + extra, ATT: base.ATT + extra };
}

export function lineCounts(pool: readonly { position: Position }[]) {
  const counts: Record<Line, number> = { GK: 0, DEF: 0, MID: 0, ATT: 0 };
  for (const player of pool) counts[lineOf(player.position)]++;
  return counts;
}

/**
 * League position can no longer change for `clubId`: nobody above can be caught and nobody below can catch up.
 * Other clubs' games left are estimated from the club's own (`remaining`) and games played.
 */
export function positionSettled(
  table: readonly { club_id: number; points: number; played: number }[],
  clubId: number,
  remaining: number,
) {
  const index = table.findIndex((row) => row.club_id === clubId);
  if (index < 0 || remaining <= 0) return remaining <= 0 && index >= 0;
  const me = table[index];
  const left = (row: { played: number }) => Math.max(0, remaining + me.played - row.played);
  const above = table[index - 1];
  const below = table[index + 1];
  const cannotRise = !above || me.points + 3 * remaining < above.points;
  const cannotFall = !below || below.points + 3 * left(below) < me.points;
  return cannotRise && cannotFall;
}

export interface CoachCandidate {
  id: number;
  position: Position;
  ability: number;
  potential: number;
  age: number;
  form: number;
  /** Source team, in the caller's preference order (a B-team before the U19 for the first team). */
  sourceRank: number;
  /** A first-team call-up would be his first senior appearance for the club. */
  debut: boolean;
  /** Director development request: relaxed merit gate and a higher chance. */
  requested?: boolean;
  /** One of the club's top academy prospects (relaxed merit gate). */
  topProspect?: boolean;
}

export interface CoachContext {
  level: TargetLevel;
  /** Available players of the target team (fit, not suspended, not injured). */
  available: readonly { position: Position; ability: number }[];
  /** Every registered player of the target team: the incumbents merit is measured against. */
  squad: readonly { position: Position; ability: number }[];
  candidates: readonly CoachCandidate[];
  /** The target team's last league rounds (`CALL_UP_RULES.endOfSeason.lastRounds`). */
  endOfSeason: boolean;
  /** Its final league round (only with `endOfSeason`). */
  finalRound?: boolean;
  deadRubber: boolean;
  congestion: boolean;
  /** The source team's league is over (U19 -> B-team, U17 -> U19). */
  youthSeasonOver?: boolean;
  /** A cup tie against lower-tier opposition. */
  cupVsLower?: boolean;
  /** The club's academy is strong (`CALL_UP_RULES.strongAcademyMult`). */
  strongAcademy?: boolean;
  /** First team's debut standing (`CALL_UP_RULES.standingMult`). */
  standing?: DebutStanding;
  /** Youngest age for senior football in the target's association (`minSeniorAge`). */
  minAge?: number;
  debuts: { used: number; limit: number };
  /** Registered places left under the squad cap. */
  room: number;
  /** Merit is rolled once per fixture; later passes only cover need. */
  merit?: boolean;
  random: () => number;
}

export interface CoachDecision {
  playerId: number;
  reason: Exclude<CallUpReason, "instruction">;
  /** Need: the next match only; merit and end-of-season: for a period. */
  duration: "match" | "until";
  debut: boolean;
  line: Line;
  /** Called up thanks to a development request (or the prospect floor). */
  development?: boolean;
}

const LEVEL_NAME: Record<TargetLevel, string> = { Senior: "first-team", BTeam: "reserve-team", U19: "U19" };

/** Per-candidate merit chance: base, end-of-season (last rounds / final round), youth season over, cup tie, request. */
export function meritChance(
  context: Pick<
    CoachContext,
    "level" | "endOfSeason" | "finalRound" | "deadRubber" | "youthSeasonOver" | "cupVsLower" | "strongAcademy" | "standing"
  >,
  requested = false,
) {
  const rules = CALL_UP_RULES;
  const late = context.endOfSeason && (context.level !== "Senior" || context.deadRubber);
  const season = late ? (context.finalRound ? rules.endOfSeason.finalRoundMult : rules.endOfSeason.lastRoundsMult) : 1;
  const chance =
    rules.merit.chance[context.level] *
    season *
    (context.youthSeasonOver ? rules.youthSeasonOverMult[context.level] : 1) *
    (context.cupVsLower ? rules.cupVsLowerMult : 1) *
    (context.strongAcademy ? rules.strongAcademyMult[context.level] : 1) *
    (context.level === "Senior" && context.standing ? rules.standingMult[context.standing] : 1) *
    (requested ? rules.development.mult : 1);
  return Math.min(rules.maxChance, chance);
}

/**
 * The coach's selective call-ups for one target fixture, plus a reason for every requested candidate left out.
 * NEED: a line below the matchday squad (congestion adds cover) takes the best candidate of the most senior source,
 * a debutant only while the debut budget lasts (a missing goalkeeper always). MERIT: a candidate clearly above the
 * incumbents' median at his line (a top prospect or requested player: at least 90% of the weakest incumbent), in
 * form and old enough passes a per-fixture chance within a cap. In the last league rounds youth teams (and the first
 * team in dead rubbers) lower the bar and call up more often.
 */
export function coachCallUpPlan(context: CoachContext): { decisions: CoachDecision[]; reasons: Map<number, string> } {
  const decisions: CoachDecision[] = [];
  const reasons = new Map<number, string>();
  const taken = new Set<number>();
  let room = context.room;
  let debutsLeft = Math.max(0, context.debuts.limit - context.debuts.used);
  const counts = lineCounts(context.available);
  const needs = matchdayNeeds(context.congestion, context.level);
  const level = context.level;
  const floor = level === "U19" ? 0 : (context.minAge ?? CALL_UP_RULES.minSeniorAge.default);
  const minAge = level === "U19" ? CALL_UP_RULES.merit.minAge.U19 : floor;
  const ordered = [...context.candidates]
    .filter((entry) => entry.age >= floor)
    .sort((left, right) => left.sourceRank - right.sourceRank || right.ability - left.ability || left.id - right.id);
  const explain = (candidate: CoachCandidate, reason: string) => {
    if (candidate.requested && !reasons.has(candidate.id)) reasons.set(candidate.id, reason);
  };
  for (const candidate of context.candidates)
    if (candidate.age < floor) explain(candidate, `Too young for ${LEVEL_NAME[level]} football (${candidate.age}; minimum ${floor}).`);
  let needCalls = 0;
  for (const line of LINES) {
    let deficit = needs[line] - counts[line];
    while (deficit > 0 && room > 0 && needCalls < CALL_UP_RULES.maxNeedPerFixture) {
      const emergency = line === "GK" && counts.GK + decisions.filter((entry) => entry.line === "GK").length < 1;
      const candidate =
        ordered.find((entry) => !taken.has(entry.id) && lineOf(entry.position) === line && !entry.debut) ??
        ordered.find((entry) => !taken.has(entry.id) && lineOf(entry.position) === line && (debutsLeft > 0 || emergency));
      if (!candidate) break;
      taken.add(candidate.id);
      if (candidate.debut) debutsLeft = Math.max(0, debutsLeft - 1);
      decisions.push({
        playerId: candidate.id,
        reason: "need",
        duration: "match",
        debut: candidate.debut,
        line,
        ...(candidate.requested ? { development: true } : {}),
      });
      deficit--;
      room--;
      needCalls++;
    }
  }
  if (context.merit === false) {
    for (const candidate of ordered)
      if (!taken.has(candidate.id)) explain(candidate, "The coach already settled this squad; only injuries change it now.");
    return { decisions, reasons };
  }
  const late = context.endOfSeason && (level !== "Senior" || context.deadRubber);
  const margin = CALL_UP_RULES.merit.margin[level] + (late ? CALL_UP_RULES.endOfSeason.marginDelta : 0);
  const cap = late ? CALL_UP_RULES.endOfSeason.perFixture[level] : CALL_UP_RULES.merit.perFixture[level];
  const overall = median(context.squad.map((player) => player.ability));
  const byLine = new Map<Line, { median: number; weakest: number }>();
  for (const line of LINES) {
    const abilities = context.squad.filter((player) => lineOf(player.position) === line).map((player) => player.ability);
    byLine.set(line, abilities.length ? { median: median(abilities), weakest: Math.min(...abilities) } : { median: overall, weakest: overall });
  }
  const edge = (candidate: CoachCandidate) => candidate.ability - byLine.get(lineOf(candidate.position))!.median;
  const qualifies = (candidate: CoachCandidate) =>
    edge(candidate) >= margin ||
    ((candidate.debut || candidate.requested || candidate.topProspect) &&
      candidate.ability >= CALL_UP_RULES.merit.prospectShareOfWeakest * byLine.get(lineOf(candidate.position))!.weakest);
  const betterOptions = (candidate: CoachCandidate) => {
    const same = context.available.filter((player) => player.position === candidate.position);
    const pool = same.length ? same : context.available.filter((player) => lineOf(player.position) === lineOf(candidate.position));
    const count = pool.filter((player) => player.ability >= candidate.ability).length;
    return count
      ? `${count} better option${count === 1 ? "" : "s"} at ${same.length ? candidate.position : lineOf(candidate.position)}.`
      : `Not yet ahead of the ${lineOf(candidate.position)} options.`;
  };
  let meritCalls = 0;
  const merit = [...ordered].sort(
    (left, right) => Number(!!right.requested) - Number(!!left.requested) || edge(right) - edge(left) || left.id - right.id,
  );
  for (const candidate of merit) {
    if (taken.has(candidate.id)) continue;
    if (candidate.age < minAge) explain(candidate, `Too young for ${LEVEL_NAME[level]} football yet (${candidate.age}).`);
    else if (!late && candidate.form < CALL_UP_RULES.merit.minForm)
      explain(candidate, `Form ${candidate.form.toFixed(1)} is below the ${CALL_UP_RULES.merit.minForm} the coach wants.`);
    else if (!qualifies(candidate)) explain(candidate, betterOptions(candidate));
    else if (candidate.debut && debutsLeft <= 0) explain(candidate, "The first-team debut budget for this season is used up.");
    else if (meritCalls >= cap || room <= 0) explain(candidate, "The coach called up other players for this match.");
    else if (context.random() >= meritChance(context, candidate.requested)) explain(candidate, "Close: the coach kept faith with the current squad this time.");
    else {
      taken.add(candidate.id);
      if (candidate.debut) debutsLeft--;
      decisions.push({
        playerId: candidate.id,
        reason: late ? "end-of-season" : "merit",
        duration: late || edge(candidate) >= margin + CALL_UP_RULES.merit.extendedEdge ? "until" : "match",
        debut: candidate.debut,
        line: lineOf(candidate.position),
        ...(candidate.requested ? { development: true } : {}),
      });
      meritCalls++;
      room--;
    }
  }
  return { decisions, reasons };
}

export const coachCallUps = (context: CoachContext) => coachCallUpPlan(context).decisions;

/**
 * Tier 1-2 clubs in the last league rounds: the first top academy prospect (old enough) without a first-team call-up
 * this season gets a bench call-up for the next match (outside the debut budget; the match gate decides if he plays).
 */
export function prospectFloorPick(input: {
  tier: number | null | undefined;
  remaining: number;
  candidates: readonly CoachCandidate[];
  calledThisSeason: (id: number) => boolean;
  minAge: number;
}) {
  const rule = CALL_UP_RULES.prospectFloor;
  if (!input.tier || input.tier > rule.maxTier || input.remaining <= 0 || input.remaining > rule.lastRounds) return undefined;
  return input.candidates.find((entry) => entry.topProspect && entry.age >= input.minAge && !input.calledThisSeason(entry.id));
}

/** Whether an AI side's pool is short enough to look at the team below (no lower query otherwise). */
export function aiNeedsLower(pool: readonly { position: Position }[]) {
  if (pool.length < CALL_UP_RULES.ai.needPool) return true;
  const counts = lineCounts(pool);
  return LINES.some((line) => counts[line] < CALL_UP_RULES.ai.minimum[line]);
}

/** AI merit chance; a first team below the top flight uses the standing multiplier of its tier (`second` / `lower`). */
export function aiMeritChance(level: TargetLevel, lateSeason: boolean, tier?: number) {
  const chance = (lateSeason ? CALL_UP_RULES.ai.endOfSeasonChance : CALL_UP_RULES.ai.meritChance)[level];
  return level === "Senior" && tier && tier >= 2 ? chance * CALL_UP_RULES.standingMult[debutStanding(tier, 0, 0)] : chance;
}

/**
 * Lineup-only call-ups for AI clubs (nothing persisted): line gaps take the best player below, then, when `roll`
 * passes the merit chance, players clearly above the incumbents' median (lower bar late in the season).
 */
export function aiLineupCallUps(input: {
  level: TargetLevel;
  pool: readonly { position: Position; ability: number }[];
  lower: readonly { id: number; position: Position; ability: number; age: number }[];
  lateSeason: boolean;
  roll: number;
  /** Youngest age for senior football (first team, B-team); ignored for U19. */
  minAge?: number;
  /** League tier of the side (first teams below the top flight call up more often). */
  tier?: number;
}): number[] {
  const picked: number[] = [];
  const counts = lineCounts(input.pool);
  const needs = CALL_UP_RULES.ai.minimum;
  const floor = input.level === "U19" ? 0 : (input.minAge ?? CALL_UP_RULES.minSeniorAge.default);
  const lower = [...input.lower]
    .filter((player) => player.age >= floor)
    .sort((left, right) => right.ability - left.ability || left.id - right.id);
  for (const line of LINES)
    for (let deficit = needs[line] - counts[line]; deficit > 0 && picked.length < CALL_UP_RULES.ai.maxAdded; deficit--) {
      const next = lower.find((player) => lineOf(player.position) === line && !picked.includes(player.id));
      if (!next) break;
      picked.push(next.id);
    }
  if (input.roll >= aiMeritChance(input.level, input.lateSeason, input.tier)) return picked;
  const margin =
    CALL_UP_RULES.merit.margin[input.level] + (input.lateSeason ? CALL_UP_RULES.endOfSeason.marginDelta : 0);
  const overall = median(input.pool.map((player) => player.ability));
  const lineAbilities = (line: Line) => input.pool.filter((player) => lineOf(player.position) === line).map((player) => player.ability);
  const lineMedian = (line: Line) => {
    const abilities = lineAbilities(line);
    return abilities.length ? median(abilities) : overall;
  };
  // Senior levels: the youngsters are stepping into senior football, so Fact Checker's debut gate (90% of the weakest
  // at the line) applies.
  const debutGate = (line: Line) => {
    const abilities = lineAbilities(line);
    return CALL_UP_RULES.merit.prospectShareOfWeakest * (abilities.length ? Math.min(...abilities) : overall);
  };
  const cap = (input.lateSeason ? CALL_UP_RULES.endOfSeason.perFixture : CALL_UP_RULES.merit.perFixture)[input.level];
  const qualifying = lower.filter((player) => {
    if (picked.includes(player.id) || player.age < (input.level === "U19" ? CALL_UP_RULES.merit.minAge.U19 : floor)) return false;
    const line = lineOf(player.position);
    return player.ability - lineMedian(line) >= margin || (input.level !== "U19" && player.ability >= debutGate(line));
  });
  // The passing roll, rescaled to [0, 1), picks where to start so the minutes spread over the qualifying players.
  const start = Math.floor((input.roll / aiMeritChance(input.level, input.lateSeason, input.tier)) * qualifying.length);
  const rotated = [...qualifying.slice(start), ...qualifying.slice(0, start)];
  for (const player of rotated.slice(0, Math.max(0, Math.min(cap, CALL_UP_RULES.ai.maxAdded - picked.length))))
    picked.push(player.id);
  return picked;
}

/** A call-up ends: a single match once its fixture is no longer scheduled (or a week after), a period after its last day. */
export function callUpDue(callUp: Pick<CallUp, "duration" | "until">, date: string, fixtureScheduled: boolean | undefined) {
  if (callUp.duration === "until") return date > callUp.until;
  return fixtureScheduled !== true || date > addDays(callUp.until, 7);
}

/** Last day of a temporary call-up (`match` and `permanent` are resolved elsewhere). */
export function callUpUntil(duration: Exclude<CallUpDuration, { kind: "match" } | { kind: "permanent" }>, date: string) {
  const until = duration.kind === "days" ? addDays(date, duration.days) : duration.date;
  if (until <= date) throw new GameError("Choose an end date after today.");
  if (daysBetween(date, until) > CALL_UP_RULES.maxDays)
    throw new GameError(`A temporary call-up lasts at most ${CALL_UP_RULES.maxDays} days; use a permanent move instead.`);
  return until;
}

// ------------------------------------------------------------------ state

const META_KEY = "callUps";

const freshMeta = (season: number): CallUpMeta => ({ season, active: [], proposals: [], debuts: {}, vetoes: {} });

async function loadMeta(store: Store, season: number): Promise<CallUpMeta> {
  const row = await store.get<{ value: string }>("SELECT value FROM meta WHERE key = ?", META_KEY);
  const meta = row ? (JSON.parse(row.value) as CallUpMeta) : undefined;
  if (!meta) return freshMeta(season);
  // Debut budgets are per season; call-ups end at the rollover (`endAllCallUps`); development requests carry over.
  return meta.season === season
    ? { ...freshMeta(season), ...meta }
    : { ...freshMeta(season), active: meta.active ?? [], vetoes: meta.vetoes ?? {}, ...(meta.requests ? { requests: meta.requests } : {}) };
}

const saveMeta = (store: Store, meta: CallUpMeta) => store.setMeta(META_KEY, meta);

/** Debuts that count against a first team's budget: played this season plus debut call-ups still running. */
export function usedDebuts(meta: { debuts: Record<string, number>; active: readonly Pick<CallUp, "debut" | "to">[] }, clubId: number) {
  return (
    (meta.debuts[clubId] ?? 0) +
    meta.active.filter((entry) => entry.debut && entry.to.clubId === clubId && entry.to.ageGroup === "Senior").length
  );
}

interface FamilyTeam extends CallUpTeam {
  label: string;
  level: CallUpLevel;
  club: Club;
}

async function familyTeams(store: Store): Promise<FamilyTeam[]> {
  const clubs = await clubSquads(store);
  return clubs.flatMap((club): FamilyTeam[] =>
    club.type === "bteam"
      ? [{ clubId: club.id, ageGroup: "Senior", level: "BTeam", label: `${club.name} / Reserve team`, club }]
      : (["Senior", "U19", "U17"] as const).map((ageGroup) => ({
          clubId: club.id,
          ageGroup,
          level: ageGroup,
          label: `${club.name} / ${ageGroup === "Senior" ? "First team" : ageGroup}`,
          club,
        })),
  );
}

/** Teams a target calls up from, most senior first: first team <- B-teams, U19; B-team <- U19; U19 <- U17. */
function sourcesOf(target: FamilyTeam, teams: readonly FamilyTeam[]) {
  const first = teams.find((team) => team.level === "Senior")!;
  const academy = first.clubId;
  if (target.level === "Senior")
    return [...teams.filter((team) => team.level === "BTeam"), ...teams.filter((team) => team.clubId === academy && team.level === "U19")];
  if (target.level === "BTeam") return teams.filter((team) => team.clubId === academy && team.level === "U19");
  if (target.level === "U19") return teams.filter((team) => team.clubId === academy && team.level === "U17");
  return [];
}

const sameTeam = (left: CallUpTeam, right: CallUpTeam) => left.clubId === right.clubId && left.ageGroup === right.ageGroup;

/** Discipline scope of a fixture, as the match writers record suspensions. */
function fixtureScope(fixture: TargetFixture | undefined) {
  if (!fixture?.league_id || !fixture.kind) return "friendly";
  return disciplineScope({
    id: fixture.league_id,
    kind: fixture.kind,
    confederation: fixture.confederation ?? "",
    data: fixture.league_data ?? undefined,
  });
}

interface TargetFixture {
  id: number;
  date: string;
  home_id: number;
  away_id: number;
  stage: string;
  league_id: number | null;
  kind: League["kind"] | null;
  confederation: string | null;
  league_data: string | null;
  age_group: CallUpGroup | null;
}

async function nextFixture(store: Store, team: CallUpTeam, from: string, to?: string) {
  return store.get<TargetFixture>(
    `SELECT fixtures.id,fixtures.date,fixtures.home_id,fixtures.away_id,fixtures.stage,fixtures.league_id,leagues.kind,leagues.confederation,leagues.data AS league_data,leagues.age_group FROM fixtures LEFT JOIN leagues ON leagues.id = fixtures.league_id WHERE fixtures.status = 'scheduled' AND (fixtures.home_id = ? OR fixtures.away_id = ?) AND coalesce(leagues.age_group,'Senior') = ? AND fixtures.date >= ? ${to ? "AND fixtures.date <= ?" : ""} ORDER BY fixtures.date,fixtures.id LIMIT 1`,
    team.clubId,
    team.clubId,
    team.ageGroup,
    from,
    ...(to ? [to] : []),
  );
}

/** League tier of a club and its reputation rank in that league (the debut-budget standing). */
async function clubStanding(store: Store, clubId: number) {
  const row = await store.get<{ tier: number | null; rank: number; size: number }>(
    "SELECT leagues.tier,(SELECT count(*) FROM clubs AS other WHERE other.league_id = clubs.league_id AND other.reputation > clubs.reputation) AS rank,(SELECT count(*) FROM clubs AS other WHERE other.league_id = clubs.league_id) AS size FROM clubs LEFT JOIN leagues ON leagues.id = clubs.league_id WHERE clubs.id = ?",
    clubId,
  );
  return { tier: row?.tier ?? null, standing: debutStanding(row?.tier, row?.rank ?? 0, row?.size ?? 0) };
}

/** A cup tie before the quarter-finals against a club from a lower tier. */
async function cupVsLowerTier(store: Store, fixture: Pick<TargetFixture, "kind" | "stage" | "home_id" | "away_id">, clubId: number) {
  if (fixture.kind !== "cup" || ["Final", "Semi-final", "Quarter-final"].includes(fixture.stage)) return false;
  const tiers = await store.all<{ id: number; tier: number | null }>(
    "SELECT clubs.id,leagues.tier FROM clubs LEFT JOIN leagues ON leagues.id = clubs.league_id WHERE clubs.id IN (?,?)",
    fixture.home_id,
    fixture.away_id,
  );
  const own = tiers.find((row) => row.id === clubId)?.tier;
  const other = tiers.find((row) => row.id !== clubId)?.tier;
  return !!own && !!other && other > own;
}

const countryCode = async (store: Store, countryId: number) =>
  (await store.get<{ code: string }>("SELECT code FROM countries WHERE id = ?", countryId))?.code;

/** The team's league season is over (it had league fixtures and none is left). */
async function leagueOver(store: Store, team: CallUpTeam, season: number, date: string) {
  const row = await store.get<{ last: string | null }>(
    "SELECT max(fixtures.date) AS last FROM fixtures JOIN leagues ON leagues.id = fixtures.league_id WHERE (fixtures.home_id = ? OR fixtures.away_id = ?) AND leagues.age_group = ? AND leagues.kind IN ('league','youth') AND fixtures.season = ?",
    team.clubId,
    team.clubId,
    team.ageGroup,
    season,
  );
  return !!row?.last && row.last < date;
}

const suspended = async (store: Store, playerId: number, scope: string) =>
  !!(await store.get("SELECT 1 AS found FROM discipline WHERE player_id = ? AND scope = ? AND suspension > 0", playerId, scope));

const squadSize = async (store: Store, team: CallUpTeam) =>
  (await store.get<{ count: number }>(
    "SELECT count(*) AS count FROM players WHERE playing_club_id = ? AND age_group = ? AND role != 'Retired'",
    team.clubId,
    team.ageGroup,
  ))!.count;

const hasSeniorDebut = async (store: Store, playerId: number, firstTeamId: number) =>
  !!(await store.get(
    "SELECT 1 AS found FROM player_match_appearances JOIN fixtures ON fixtures.id = player_match_appearances.fixture_id LEFT JOIN leagues ON leagues.id = fixtures.league_id WHERE player_match_appearances.player_id = ? AND player_match_appearances.club_id = ? AND coalesce(leagues.age_group,'Senior') = 'Senior' LIMIT 1",
    playerId,
    firstTeamId,
  ));

/** Whether a first-team call-up would be an academy debut (`CALL_UP_RULES.debutMaxAge`, no first-team senior games yet). */
export function academyDebut(age: number, firstTeamApps: number) {
  return age <= CALL_UP_RULES.debutMaxAge && firstTeamApps === 0;
}

/** Senior first-team appearances for any club (season stats survive retention; B-team and national games excluded). */
const firstTeamApps = async (store: Store, playerId: number) =>
  (await store.get<{ found: number }>(
    "SELECT CASE WHEN EXISTS (SELECT 1 FROM player_season_stats AS stat JOIN clubs ON clubs.id = stat.club_id JOIN leagues ON leagues.id = stat.league_id WHERE stat.player_id = ? AND stat.appearances > 0 AND clubs.type = 'club' AND leagues.age_group = 'Senior') THEN 1 ELSE 0 END AS found",
    playerId,
  ))!.found;

const isAcademyDebut = async (store: Store, playerId: number, age: number) =>
  age <= CALL_UP_RULES.debutMaxAge && academyDebut(age, await firstTeamApps(store, playerId));

/** Earliest appearance date that still rules a candidate out (`CALL_UP_RULES.restDays`; today included). */
export const restCutoff = (date: string) => addDays(date, -CALL_UP_RULES.restDays);

/**
 * Temporary call-up eligibility (the user's squad-move rules plus match rules): squad destination (age at the season
 * start, loans, B-team over-age quota), competition cutoff, senior age floor, per-country B-team bar, injury,
 * suspension in the target's competition, squad cap, and Article 19 presence for a minor who changes registered club
 * (youth.ts `minorMayJoin`).
 */
async function eligibility(
  store: Store,
  player: Player,
  target: FamilyTeam,
  fixture: TargetFixture | undefined,
  date: string,
  season: number,
): Promise<string | null> {
  const destination = (await squadDestinations(store, player)).find(
    (entry) => entry.clubId === target.clubId && entry.ageGroup === target.ageGroup,
  );
  if (!destination) return "Choose a squad belonging to your club.";
  if (!destination.eligible) return destination.reason;
  if (destination.current) return "This player is already in that squad.";
  if (target.ageGroup !== "Senior" && player.birth_date < youthBirthCutoff(target.ageGroup, season))
    return `${player.name} is too old for ${target.ageGroup} competitions this season.`;
  const code = target.ageGroup === "Senior" ? await countryCode(store, target.club.country_id) : undefined;
  if (target.ageGroup === "Senior" && ageOn(player.birth_date, date) < minSeniorAge(code))
    return `${player.name} is too young for senior football (minimum age ${minSeniorAge(code)}).`;
  if (target.level === "BTeam" && code && CALL_UP_RULES.bTeamEligibility[code]) {
    const apps = (await store.get<{ count: number }>(
      "SELECT count(*) AS count FROM player_match_appearances JOIN fixtures ON fixtures.id = player_match_appearances.fixture_id JOIN leagues ON leagues.id = fixtures.league_id WHERE player_match_appearances.player_id = ? AND player_match_appearances.minutes > 0 AND leagues.kind = 'league' AND leagues.tier = 1 AND leagues.age_group = 'Senior' AND leagues.country_id = ?",
      player.id,
      target.club.country_id,
    ))!.count;
    const barred = bTeamIneligible(code, apps);
    if (barred) return `${player.name}: ${barred}`;
  }
  if (player.injury_until && player.injury_until > date) return `${player.name} is injured until ${player.injury_until}.`;
  if (fixture && (await suspended(store, player.id, fixtureScope(fixture))))
    return `${player.name} is suspended for that competition.`;
  const cap = CALL_UP_RULES.squadCaps[target.level];
  if ((await squadSize(store, target)) >= cap) return `${target.label} already has ${cap} registered players.`;
  const current = player.squad_club_id ?? player.club_id;
  if (current !== target.clubId && ageOn(player.birth_date, date) < 18) {
    const countries = await store.all<Country>("SELECT * FROM countries ORDER BY id");
    const people = peopleContext(countries);
    const profile = JSON.parse(player.profile) as PlayerProfile;
    const code = people.byId.get(player.country_id)?.code ?? "";
    const destinationCode = people.byId.get(target.club.country_id)?.code ?? code;
    const legal = minorMayJoin(
      { age: ageOn(player.birth_date, date), birth_date: player.birth_date },
      profile,
      heldNationalities(code, profile),
      clubRegistration(destinationCode, target.club.data),
      people,
      date,
    );
    if (!legal) return `${player.name} is a minor and cannot be registered with ${target.club.name}.`;
  }
  return null;
}

async function historyRow(store: Store, season: number, date: string, playerId: number, data: Record<string, unknown>) {
  await store.run("INSERT INTO history(season,entity_type,entity_id,date,data) VALUES (?,'squad',?,?,?)", season, playerId, date, JSON.stringify(data));
}

async function applyCallUp(
  store: Store,
  meta: CallUpMeta,
  player: Player,
  target: FamilyTeam,
  from: FamilyTeam,
  entry: CallUp,
  state: { season: number; date: string },
) {
  const moved = await store.run(
    "UPDATE players SET squad_club_id = ?, age_group = ? WHERE id = ? AND playing_club_id = ? AND age_group = ?",
    target.clubId === player.club_id ? null : target.clubId,
    target.ageGroup,
    player.id,
    from.clubId,
    from.ageGroup,
  );
  if (!moved.changes) return false;
  await historyRow(store, state.season, state.date, player.id, {
    fromClubId: from.clubId,
    fromAgeGroup: from.ageGroup,
    toClubId: target.clubId,
    ageGroup: target.ageGroup,
    label: target.label,
    callUp: true,
    until: entry.until,
    duration: entry.duration,
    by: entry.by,
    reason: entry.reason,
    ...(entry.debut ? { debut: true } : {}),
    ...(entry.development ? { development: true } : {}),
  });
  const previous = meta.active.find((active) => active.playerId === player.id);
  if (previous) await settleDebut(store, meta, previous);
  meta.active = [...meta.active.filter((active) => active.playerId !== player.id), entry];
  if (target.level === "Senior")
    meta.firstTeamCalls = { ...meta.firstTeamCalls, [player.id]: (meta.firstTeamCalls?.[player.id] ?? 0) + 1 };
  return true;
}

/** A debut call-up leaves the active list: it uses the season's budget only if the player actually appeared. */
async function settleDebut(store: Store, meta: CallUpMeta, entry: CallUp) {
  if (!entry.debut || entry.to.ageGroup !== "Senior") return;
  if (await hasSeniorDebut(store, entry.playerId, entry.to.clubId)) meta.debuts[entry.to.clubId] = (meta.debuts[entry.to.clubId] ?? 0) + 1;
}

/** Sends a called-up player back to the team he came from; a player moved or sold meanwhile is just forgotten. */
async function returnPlayer(store: Store, meta: CallUpMeta, entry: CallUp, state: { season: number; date: string }, labels: Map<string, string>) {
  await settleDebut(store, meta, entry);
  meta.active = meta.active.filter((active) => active.playerId !== entry.playerId);
  const player = await store.get<Player>("SELECT * FROM players WHERE id = ?", entry.playerId);
  if (!player || player.role === "Retired" || player.club_id === null) return false;
  const moved = await store.run(
    "UPDATE players SET squad_club_id = ?, age_group = ? WHERE id = ? AND playing_club_id = ? AND age_group = ?",
    entry.from.clubId === player.club_id ? null : entry.from.clubId,
    entry.from.ageGroup,
    entry.playerId,
    entry.to.clubId,
    entry.to.ageGroup,
  );
  if (!moved.changes) return false;
  await historyRow(store, state.season, state.date, entry.playerId, {
    fromClubId: entry.to.clubId,
    fromAgeGroup: entry.to.ageGroup,
    toClubId: entry.from.clubId,
    ageGroup: entry.from.ageGroup,
    label: labels.get(`${entry.from.clubId}:${entry.from.ageGroup}`) ?? "Previous squad",
    callUpReturn: true,
  });
  return true;
}

const teamKey = (team: CallUpTeam) => `${team.clubId}:${team.ageGroup}`;

// ------------------------------------------------------------------ daily pass

interface SourcePlayer {
  id: number;
  name: string;
  position: Position;
  ability: number;
  potential: number;
  age: number;
  form: number;
  fitness: number;
}

interface RequestRow {
  id: number;
  fitness: number;
  injury_until: string | null;
  playing_club_id: number | null;
  age_group: string;
  club_id: number | null;
  squad_club_id: number | null;
  role: string;
}

/** Players with a development request (requests for players who left or reached the first team are dropped). */
async function requestedPlayers(store: Store, meta: CallUpMeta, clubId: number) {
  const ids = Object.keys(meta.requests ?? {}).map(Number);
  const rows = ids.length
    ? await store.all<RequestRow>(
        "SELECT id,fitness,injury_until,playing_club_id,age_group,club_id,squad_club_id,role FROM players WHERE id = ANY(?::int[])",
        ids,
      )
    : [];
  const onCallUp = new Set(meta.active.map((entry) => entry.playerId));
  const keep = rows.filter(
    (row) => row.club_id === clubId && row.role !== "Retired" && (onCallUp.has(row.id) || row.age_group !== "Senior" || row.squad_club_id !== null),
  );
  if (meta.requests) {
    const requests = { ...meta.requests };
    for (const id of ids) if (!keep.some((row) => row.id === id)) delete requests[id];
    meta.requests = requests;
  }
  return {
    rows: keep,
    byId: new Set(keep.map((row) => row.id)),
    verdict(id: number, status: string, date: string) {
      const request = meta.requests?.[id];
      if (request) meta.requests = { ...meta.requests, [id]: { ...request, status, checked: date } };
    },
  };
}

/** Why a requested player is not even a candidate for a team's next match. */
export function unavailableReason(row: Pick<RequestRow, "id" | "fitness" | "injury_until">, date: string, busy: ReadonlySet<number>) {
  if (row.injury_until && row.injury_until > date) return `Injured until ${row.injury_until}.`;
  if (row.fitness < CALL_UP_RULES.minFitness) return `Fitness ${row.fitness}: the coach wants ${CALL_UP_RULES.minFitness}+.`;
  if (busy.has(row.id)) return "Already on a call-up, proposed, or recently sent back.";
  return "Played in the last day or suspended for this competition; the coach looks again next match.";
}

/** The family's top academy prospects by potential: U19/U17 players and B-team players aged 21 or under. */
const topProspects = async (store: Store, clubId: number) =>
  (
    await store.all<{ id: number }>(
      `SELECT id FROM players WHERE club_id = ? AND parent_club_id IS NULL AND role != 'Retired' AND (age_group IN ('U19','U17') OR (age_group = 'Senior' AND squad_club_id IS NOT NULL AND age <= 21)) ORDER BY potential DESC,id LIMIT ${CALL_UP_RULES.prospectFloor.top}`,
      clubId,
    )
  ).map((row) => row.id);

/**
 * League games left (today's included), last rounds, final round and dead rubber of a target team. Reads: the team's
 * league row, a count of its scheduled league fixtures and, in the last rounds only, the table.
 */
export async function seasonPhase(store: Store, team: CallUpTeam, season: number) {
  const none = { endOfSeason: false, finalRound: false, deadRubber: false, remaining: 0 };
  const league = await store.get<{ league_id: number; group_name: string }>(
    "SELECT standings.league_id,standings.group_name FROM standings JOIN leagues ON leagues.id = standings.league_id WHERE standings.club_id = ? AND leagues.age_group = ? AND leagues.kind IN ('league','youth') ORDER BY leagues.tier,leagues.id LIMIT 1",
    team.clubId,
    team.ageGroup,
  );
  if (!league) return none;
  const remaining = (await store.get<{ count: number }>(
    "SELECT count(*) AS count FROM fixtures WHERE league_id = ? AND season = ? AND status = 'scheduled' AND (home_id = ? OR away_id = ?)",
    league.league_id,
    season,
    team.clubId,
    team.clubId,
  ))!.count;
  const endOfSeason = remaining > 0 && remaining <= CALL_UP_RULES.endOfSeason.lastRounds;
  if (!endOfSeason) return { ...none, remaining };
  const table = await store.all<{ club_id: number; points: number; played: number }>(
    // Points are stored net of deductions (points = wins × 3 + draws - deducted).
    "SELECT club_id,points,played FROM standings WHERE league_id = ? AND group_name = ? ORDER BY points DESC,(gf - ga) DESC,gf DESC,club_id",
    league.league_id,
    league.group_name,
  );
  return { endOfSeason, finalRound: remaining === 1, deadRubber: positionSettled(table, team.clubId, remaining), remaining };
}

/**
 * Daily, before fixtures: ends due call-ups, drops stale proposals and vetoes, then the coach looks at every team of
 * the user's family with a fixture today and calls up for need/merit (automatic setting on) or proposes (off).
 * Work: a handful of indexed queries per family team on its match days only.
 */
export async function processCallUps(store: Store) {
  const state = await stateOf(store);
  const meta = await loadMeta(store, state.season);
  const teams = await familyTeams(store);
  const labels = new Map(teams.map((team) => [teamKey(team), team.label]));
  const before = JSON.stringify(meta);
  const matchIds = meta.active.flatMap((entry) => (entry.fixtureId ? [entry.fixtureId] : []));
  const scheduled = new Set(
    matchIds.length
      ? (
          await store.all<{ id: number }>(
            "SELECT id FROM fixtures WHERE status = 'scheduled' AND id = ANY(?::int[])",
            matchIds,
          )
        ).map((row) => row.id)
      : [],
  );
  for (const entry of [...meta.active])
    if (callUpDue(entry, state.date, entry.fixtureId ? scheduled.has(entry.fixtureId) : undefined))
      await returnPlayer(store, meta, entry, state, labels);
  meta.proposals = meta.proposals.filter((proposal) => proposal.expires >= state.date);
  meta.vetoes = Object.fromEntries(Object.entries(meta.vetoes).filter(([, until]) => until >= state.date));
  const auto = (await settingsOf(store)).autoCallUps !== false;
  const first = teams.find((team) => team.level === "Senior");
  const requests = await requestedPlayers(store, meta, state.clubId);
  const codes = new Map<number, string | undefined>();
  const codeOf = async (countryId: number) => {
    if (!codes.has(countryId)) codes.set(countryId, await countryCode(store, countryId));
    return codes.get(countryId);
  };
  for (const target of teams) {
    if (!first || target.level === "U17") continue;
    const fixture = await nextFixture(store, target, state.date, addDays(state.date, CALL_UP_RULES.lookaheadDays));
    // Automatic call-ups happen on match day (the player does not miss his own team's games before); proposals come early.
    if (!fixture || (auto && fixture.date !== state.date)) continue;
    const sources = sourcesOf(target, teams);
    if (!sources.length) continue;
    const scope = fixtureScope(fixture);
    const senior = target.level !== "U19";
    const floor = senior ? minSeniorAge(await codeOf(target.club.country_id)) : 0;
    const squad = await store.all<{ id: number; position: Position; ability: number; fitness: number; injury_until: string | null; banned: number }>(
      "SELECT id,position,ability,fitness,injury_until,CASE WHEN EXISTS(SELECT 1 FROM discipline WHERE discipline.player_id = players.id AND discipline.scope = ? AND discipline.suspension > 0) THEN 1 ELSE 0 END AS banned FROM players WHERE playing_club_id = ? AND age_group = ? AND role != 'Retired' ORDER BY id",
      scope,
      target.clubId,
      target.ageGroup,
    );
    const available = squad.filter(
      (player) => (!player.injury_until || player.injury_until <= state.date) && !player.banned && player.fitness >= CALL_UP_RULES.minFitness,
    );
    // Pending proposals already cover their line, so the coach does not repeat them each day.
    for (const proposal of meta.proposals)
      if (sameTeam(proposal.to, target)) available.push({ id: proposal.playerId, position: proposal.position, ability: 0, fitness: 99, injury_until: null, banned: 0 });
    const busy = new Set([
      ...meta.active.map((entry) => entry.playerId),
      ...Object.keys(meta.vetoes).map(Number),
      ...meta.proposals.map((proposal) => proposal.playerId),
    ]);
    const candidates: (CoachCandidate & { source: FamilyTeam; name: string })[] = [];
    const prospects = target.level === "Senior" ? await topProspects(store, first.clubId) : [];
    for (const [rank, source] of sources.entries()) {
      const rows = await store.all<SourcePlayer>(
        `SELECT id,name,position,ability,potential,age,form,fitness FROM players WHERE playing_club_id = ? AND age_group = ? AND role != 'Retired' AND parent_club_id IS NULL AND fitness >= ? AND (injury_until IS NULL OR injury_until <= ?) ${target.ageGroup === "Senior" ? "" : "AND birth_date >= ?"} AND NOT EXISTS(SELECT 1 FROM discipline WHERE discipline.player_id = players.id AND discipline.scope = ? AND discipline.suspension > 0) AND NOT EXISTS(SELECT 1 FROM player_match_appearances WHERE player_match_appearances.player_id = players.id AND player_match_appearances.date >= ? AND player_match_appearances.minutes > 0) ORDER BY ability DESC,id`,
        source.clubId,
        source.ageGroup,
        CALL_UP_RULES.minFitness,
        state.date,
        ...(target.ageGroup === "Senior" ? [] : [youthBirthCutoff(target.ageGroup, state.season)]),
        scope,
        restCutoff(state.date),
      );
      for (const row of rows)
        if (!busy.has(row.id))
          candidates.push({
            ...row,
            sourceRank: rank,
            debut: false,
            source,
            ...(requests.byId.has(row.id) ? { requested: true } : {}),
            ...(prospects.includes(row.id) ? { topProspect: true } : {}),
          });
    }
    // Requested players the query left out still get a verdict (injured, unfit, rested, busy, too old...).
    for (const request of requests.rows)
      if (sources.some((source) => source.clubId === request.playing_club_id && source.ageGroup === request.age_group) && !candidates.some((entry) => entry.id === request.id))
        requests.verdict(request.id, `${target.label}: ${unavailableReason(request, state.date, busy)}`, state.date);
    if (!candidates.length) continue;
    if (target.level === "Senior")
      for (const candidate of candidates) candidate.debut = await isAcademyDebut(store, candidate.id, candidate.age);
    const phase = await seasonPhase(store, target, state.season);
    const congestion =
      (await store.get<{ count: number }>(
        "SELECT count(*) AS count FROM fixtures LEFT JOIN leagues ON leagues.id = fixtures.league_id WHERE (fixtures.home_id = ? OR fixtures.away_id = ?) AND coalesce(leagues.age_group,'Senior') = ? AND fixtures.date BETWEEN ? AND ?",
        target.clubId,
        target.clubId,
        target.ageGroup,
        addDays(state.date, -(CALL_UP_RULES.congestionDays - 1)),
        addDays(state.date, CALL_UP_RULES.congestionDays - 1),
      ))!.count >= 2;
    const standing = target.level === "Senior" ? await clubStanding(store, target.clubId) : undefined;
    // Proposals pushed into `available` above are stand-ins; the crisis count uses real fit outfielders only.
    const fitOutfield = available.filter((player) => player.position !== "GK" && player.ability > 0).length;
    const youthSeasonOver =
      target.level !== "Senior" && sources.length === 1 && (await leagueOver(store, sources[0], state.season, state.date));
    const plan = coachCallUpPlan({
      level: target.level,
      available,
      squad,
      candidates,
      endOfSeason: phase.endOfSeason,
      finalRound: phase.finalRound,
      deadRubber: phase.deadRubber,
      congestion,
      youthSeasonOver,
      cupVsLower: await cupVsLowerTier(store, fixture, target.clubId),
      strongAcademy: first.club.academy >= CALL_UP_RULES.debutBudget.strongAcademy,
      standing: standing?.standing,
      minAge: senior ? floor : undefined,
      debuts: {
        used: usedDebuts(meta, target.clubId),
        limit: standing ? debutBudget(target.club, standing.standing, fitOutfield) : 0,
      },
      room: CALL_UP_RULES.squadCaps[target.level] - squad.length,
      merit: meta.reviewed?.[teamKey(target)] !== fixture.id,
      random: seedrandom(`${state.seed}:callups:${fixture.id}:${teamKey(target)}`),
    });
    const decisions = [...plan.decisions];
    const floorPick =
      standing && decisions.length < CALL_UP_RULES.squadCaps.Senior - squad.length
        ? prospectFloorPick({
            tier: standing.tier,
            remaining: phase.remaining,
            candidates: candidates.filter((entry) => !decisions.some((decision) => decision.playerId === entry.id)),
            calledThisSeason: (id) => (meta.firstTeamCalls?.[id] ?? 0) > 0,
            minAge: floor,
          })
        : undefined;
    if (floorPick)
      decisions.push({ playerId: floorPick.id, reason: "merit", duration: "match", debut: floorPick.debut, line: lineOf(floorPick.position), development: true });
    for (const [id, reason] of plan.reasons) requests.verdict(id, `${target.label}: ${reason}`, state.date);
    meta.reviewed = { ...meta.reviewed, [teamKey(target)]: fixture.id };
    const lastLeagueDay =
      phase.endOfSeason
        ? ((await store.get<{ last: string | null }>(
            "SELECT max(fixtures.date) AS last FROM fixtures LEFT JOIN leagues ON leagues.id = fixtures.league_id WHERE (fixtures.home_id = ? OR fixtures.away_id = ?) AND coalesce(leagues.age_group,'Senior') = ? AND fixtures.season = ?",
            target.clubId,
            target.clubId,
            target.ageGroup,
            state.season,
          ))?.last ?? undefined)
        : undefined;
    for (const decision of decisions) {
      const candidate = candidates.find((entry) => entry.id === decision.playerId)!;
      const player = await store.get<Player>("SELECT * FROM players WHERE id = ?", decision.playerId);
      const barred = player ? await eligibility(store, player, target, fixture, state.date, state.season) : "No longer at the club.";
      if (!player || barred) {
        if (candidate.requested) requests.verdict(decision.playerId, `${target.label}: ${barred}`, state.date);
        continue;
      }
      const until =
        decision.duration === "match"
          ? fixture.date
          : decision.reason === "end-of-season" && lastLeagueDay
            ? lastLeagueDay
            : addDays(state.date, CALL_UP_RULES.merit.days);
      const entry: CallUp = {
        playerId: player.id,
        position: player.position,
        from: { clubId: candidate.source.clubId, ageGroup: candidate.source.ageGroup },
        to: { clubId: target.clubId, ageGroup: target.ageGroup },
        since: state.date,
        until,
        duration: decision.duration,
        ...(decision.duration === "match" ? { fixtureId: fixture.id } : {}),
        by: "coach",
        reason: decision.reason,
        ...(decision.debut ? { debut: true } : {}),
        ...(decision.development ? { development: true } : {}),
      };
      const note =
        floorPick?.id === decision.playerId
          ? "One of the academy's top prospects: a place on the bench to taste first-team football."
          : decision.reason === "need"
            ? `Cover at ${decision.line} for the next match.`
            : decision.reason === "merit"
              ? `${decision.development ? "Development request: " : ""}Outperforming the ${target.label} options at ${decision.line}.`
              : "End-of-season minutes with a higher team.";
      if (candidate.requested) requests.verdict(player.id, `${target.label}: ${auto ? "called up" : "proposed"} (${note})`, state.date);
      if (auto) {
        if (!(await applyCallUp(store, meta, player, target, candidate.source, entry, state))) continue;
        busy.add(player.id);
        await news(
          store,
          "Squad",
          `${player.name} called up to ${target.label}${decision.debut ? " (possible debut)" : ""}`,
          `${note} ${decision.duration === "match" ? "He returns after the match." : `Until ${until}.`}`,
          decision.debut ? "success" : "info",
          "squad",
          { playerId: player.id, clubId: target.clubId, ageGroup: target.ageGroup, callUp: true },
        );
      } else {
        const { by: _by, since: _since, ...proposal } = entry;
        meta.proposals.push({ ...proposal, id: `${state.date}:${player.id}:${teamKey(target)}`, expires: fixture.date, note });
        busy.add(player.id);
      }
    }
  }
  if (JSON.stringify(meta) !== before) await saveMeta(store, meta);
}

/** Season rollover: everyone returns before age groups are recomputed; proposals and debut counts reset. */
export async function endAllCallUps(store: Store) {
  const state = await stateOf(store);
  const row = await store.get<{ value: string }>("SELECT value FROM meta WHERE key = ?", META_KEY);
  if (!row) return 0;
  const meta = JSON.parse(row.value) as CallUpMeta;
  const labels = new Map((await familyTeams(store)).map((team) => [teamKey(team), team.label]));
  let returned = 0;
  for (const entry of [...(meta.active ?? [])]) if (await returnPlayer(store, meta, entry, state, labels)) returned++;
  await saveMeta(store, { ...freshMeta(state.season + 1), ...(meta.requests ? { requests: meta.requests } : {}) });
  return returned;
}

// ------------------------------------------------------------------ director actions and desk

function viewOf(player: Player): CallUpPlayerView {
  return {
    id: player.id,
    name: player.name,
    position: player.position,
    age: player.age,
    ability: player.ability,
    potential: player.potential,
    fitness: player.fitness,
    injuryUntil: player.injury_until,
  };
}

export async function callUpDesk(store: Store): Promise<CallUpDesk> {
  const state = await stateOf(store);
  const meta = await loadMeta(store, state.season);
  const teams = await familyTeams(store);
  const labels = new Map(teams.map((team) => [teamKey(team), team.label]));
  const ids = [
    ...new Set([
      ...meta.active.map((entry) => entry.playerId),
      ...meta.proposals.map((entry) => entry.playerId),
      ...Object.keys(meta.requests ?? {}).map(Number),
    ]),
  ];
  const players = new Map(
    (ids.length
      ? await store.all<Player>("SELECT * FROM players WHERE id = ANY(?::int[])", ids)
      : []
    ).map((player) => [player.id, player]),
  );
  const label = (team: CallUpTeam) => labels.get(teamKey(team)) ?? "Other squad";
  const budgets = [];
  for (const team of teams.filter((entry) => entry.level === "Senior"))
    budgets.push({
      clubId: team.clubId,
      clubName: team.club.name,
      used: usedDebuts(meta, team.clubId),
      limit: debutBudget(team.club, (await clubStanding(store, team.clubId)).standing),
      played: meta.debuts[team.clubId] ?? 0,
    });
  return {
    autoCallUps: (await settingsOf(store)).autoCallUps !== false,
    active: meta.active.flatMap((entry) => {
      const player = players.get(entry.playerId);
      return player ? [{ ...entry, player: viewOf(player), fromLabel: label(entry.from), toLabel: label(entry.to) }] : [];
    }),
    proposals: meta.proposals
      .filter((proposal) => proposal.expires >= state.date)
      .flatMap((proposal) => {
        const player = players.get(proposal.playerId);
        return player ? [{ ...proposal, player: viewOf(player), fromLabel: label(proposal.from), toLabel: label(proposal.to) }] : [];
      }),
    debutBudgets: budgets,
    teams: teams.map(({ clubId, ageGroup, label: name, level }) => ({ clubId, ageGroup, label: name, level })),
    requests: Object.entries(meta.requests ?? {}).flatMap(([id, request]) => {
      const player = players.get(Number(id));
      if (!player) return [];
      const from = { clubId: player.squad_club_id ?? player.club_id ?? 0, ageGroup: player.age_group as CallUpGroup };
      return [{ ...request, playerId: player.id, player: viewOf(player), fromLabel: label(from) }];
    }),
  };
}

/**
 * Director development request for an academy or reserve player: the coach calls him up more readily (x2.5, relaxed
 * merit gate) within the usual timing and debut rules and reports why when he does not.
 */
export async function setDevelopmentRequest(store: Store, playerId: number, active: boolean) {
  const state = await stateOf(store);
  const player = await requireOwnPlayer(store, playerId);
  const meta = await loadMeta(store, state.season);
  const requests = { ...meta.requests };
  if (!active) {
    delete requests[playerId];
    meta.requests = requests;
    await saveMeta(store, meta);
    return { message: `Development request for ${player.name} withdrawn.` };
  }
  const onCallUp = meta.active.some((entry) => entry.playerId === playerId);
  if (player.age_group === "Senior" && player.squad_club_id === null && !onCallUp)
    throw new GameError(`${player.name} is already in the first team.`);
  if (!requests[playerId] && Object.keys(requests).length >= CALL_UP_RULES.development.maxRequests)
    throw new GameError(`The coaches follow at most ${CALL_UP_RULES.development.maxRequests} development requests at once.`);
  requests[playerId] = requests[playerId] ?? { since: state.date };
  meta.requests = requests;
  await saveMeta(store, meta);
  return { message: `The coaches will look for chances to give ${player.name} minutes with a higher team.` };
}

/**
 * Director instruction: a temporary call-up (next match, N days or until a date) or a permanent squad move, up or
 * down within the family. A player already called up keeps his original team as the one he returns to; choosing
 * that team ends the call-up.
 */
export async function callUpPlayer(
  store: Store,
  input: { playerId: number; clubId: number; ageGroup: CallUpGroup; duration: CallUpDuration },
) {
  const state = await stateOf(store);
  const player = await requireOwnPlayer(store, input.playerId);
  const meta = await loadMeta(store, state.season);
  const teams = await familyTeams(store);
  const labels = new Map(teams.map((team) => [teamKey(team), team.label]));
  const target = teams.find((team) => team.clubId === input.clubId && team.ageGroup === input.ageGroup);
  if (!target) throw new GameError("Choose a squad belonging to your club, not an affiliate or another club.");
  const active = meta.active.find((entry) => entry.playerId === player.id);
  if (input.duration.kind === "permanent") {
    if (active) await settleDebut(store, meta, active);
    meta.active = meta.active.filter((entry) => entry.playerId !== player.id);
    meta.proposals = meta.proposals.filter((entry) => entry.playerId !== player.id);
    const result = await movePlayerSquad(store, player.id, input.clubId, input.ageGroup);
    await saveMeta(store, meta);
    return result;
  }
  if (active && sameTeam(active.from, target)) {
    await returnPlayer(store, meta, active, state, labels);
    await saveMeta(store, meta);
    return { message: `${player.name} returned to ${target.label}.` };
  }
  const current = teams.find((team) => team.clubId === (player.squad_club_id ?? player.club_id) && team.ageGroup === player.age_group);
  if (!current) throw new GameError("This player is not in one of your squads.");
  const fixture = await nextFixture(store, target, state.date);
  if (input.duration.kind === "match" && !fixture) throw new GameError(`${target.label} has no scheduled fixture.`);
  const reason = await eligibility(store, player, target, fixture, state.date, state.season);
  if (reason) throw new GameError(reason);
  const until = input.duration.kind === "match" ? fixture!.date : callUpUntil(input.duration, state.date);
  const debut = target.level === "Senior" && (await isAcademyDebut(store, player.id, ageOn(player.birth_date, state.date)));
  const entry: CallUp = {
    playerId: player.id,
    position: player.position,
    from: active ? active.from : { clubId: current.clubId, ageGroup: current.ageGroup },
    to: { clubId: target.clubId, ageGroup: target.ageGroup },
    since: state.date,
    until,
    duration: input.duration.kind === "match" ? "match" : "until",
    ...(input.duration.kind === "match" ? { fixtureId: fixture!.id } : {}),
    by: "user",
    reason: "instruction",
    ...(debut ? { debut: true } : {}),
  };
  if (!(await applyCallUp(store, meta, player, target, current, entry, state)))
    throw new GameError("The squad changed meanwhile; refresh and try again.");
  meta.proposals = meta.proposals.filter((proposal) => proposal.playerId !== player.id);
  await saveMeta(store, meta);
  return {
    message: `${player.name} moved to ${target.label} ${entry.duration === "match" ? "for the next match" : `until ${until}`}. Contract and wage unchanged.`,
  };
}

/** Director ends a call-up now; a coach call-up also keeps the coach away from the player for two weeks. */
export async function endCallUp(store: Store, playerId: number) {
  const state = await stateOf(store);
  await requireOwnPlayer(store, playerId);
  const meta = await loadMeta(store, state.season);
  const entry = meta.active.find((active) => active.playerId === playerId);
  if (!entry) throw new GameError("This player is not on a call-up.");
  const labels = new Map((await familyTeams(store)).map((team) => [teamKey(team), team.label]));
  await returnPlayer(store, meta, entry, state, labels);
  if (entry.by === "coach") meta.vetoes[playerId] = addDays(state.date, 14);
  await saveMeta(store, meta);
  return { message: `Player returned to ${labels.get(teamKey(entry.from)) ?? "his squad"}.` };
}

/** Accept (the call-up is made as a director instruction) or decline (no new proposal for a week) a coach proposal. */
export async function answerCallUpProposal(store: Store, id: string, accept: boolean) {
  const state = await stateOf(store);
  const meta = await loadMeta(store, state.season);
  const proposal = meta.proposals.find((entry) => entry.id === id && entry.expires >= state.date);
  if (!proposal) throw new GameError("This proposal has expired.");
  meta.proposals = meta.proposals.filter((entry) => entry.id !== id);
  if (!accept) {
    meta.vetoes[proposal.playerId] = addDays(state.date, 7);
    await saveMeta(store, meta);
    return { message: "Proposal declined." };
  }
  await saveMeta(store, meta);
  const duration: CallUpDuration =
    proposal.duration === "match" ? { kind: "match" } : { kind: "until", date: proposal.until };
  return callUpPlayer(store, { playerId: proposal.playerId, clubId: proposal.to.clubId, ageGroup: proposal.to.ageGroup, duration });
}

// ------------------------------------------------------------------ AI lineups (not persisted)

/** Call-up level of a side, or undefined when it has nobody below (U17, U20, national teams). */
export function levelOf(club: Pick<Club, "type">, ageGroup: string): TargetLevel | undefined {
  if (club.type === "national") return undefined;
  if (ageGroup === "Senior") return club.type === "bteam" ? "BTeam" : "Senior";
  return ageGroup === "U19" ? "U19" : undefined;
}

/** Team below a side: its club's U19 for a first team, the parent's U19 for a B-team, the U17 for a U19. */
export function lowerTeam(club: Pick<Club, "id" | "type" | "parent_id">, level: TargetLevel): CallUpTeam | undefined {
  if (level === "U19") return { clubId: club.id, ageGroup: "U17" };
  const academy = level === "BTeam" ? club.parent_id : club.id;
  return academy ? { clubId: academy, ageGroup: "U19" } : undefined;
}

/**
 * Extra players for a full-engine lineup (`matchTeam`): AI clubs get the lineup-only call-ups; the user's family only
 * an emergency fill (fewer than 11 players or no goalkeeper) so a short squad never forfeits.
 */
export async function lineupExtras<Row extends { id: number; position: Position; ability: number; age: number }>(
  store: Store,
  club: Club,
  ageGroup: string,
  date: string,
  league: League | undefined,
  eligible: readonly Row[],
  select: (team: CallUpTeam, cutoff: string) => Promise<Row[]>,
  cutoff: string,
): Promise<Row[]> {
  const level = levelOf(club, ageGroup);
  if (!level) return [];
  const state = await stateOf(store);
  const family = club.id === state.clubId || club.parent_id === state.clubId;
  const emergency = eligible.length < 11 || !eligible.some((player) => player.position === "GK");
  const roll = seedrandom(`${state.seed}:lineup-callup:${date}:${club.id}:${ageGroup}`)();
  const late =
    !!league &&
    ["league", "youth"].includes(league.kind) &&
    (await store.get<{ count: number }>(
      "SELECT count(*) AS count FROM fixtures WHERE league_id = ? AND season = ? AND status = 'scheduled' AND (home_id = ? OR away_id = ?)",
      league.id,
      state.season,
      club.id,
      club.id,
    ))!.count <= CALL_UP_RULES.ai.lateRounds;
  if (family ? !emergency : !aiNeedsLower(eligible) && roll >= aiMeritChance(level, late, league?.tier)) return [];
  const lower = lowerTeam(club, level);
  if (!lower) return [];
  const floor = level === "U19" ? 0 : minSeniorAge(await countryCode(store, club.country_id));
  const rows = (await select(lower, cutoff)).filter((row) => !eligible.some((player) => player.id === row.id) && row.age >= floor);
  if (family) {
    const missing = Math.max(0, 11 - eligible.length);
    const keeper = eligible.some((player) => player.position === "GK") ? [] : rows.filter((row) => row.position === "GK").slice(0, 1);
    return [...keeper, ...rows.filter((row) => !keeper.includes(row)).slice(0, missing)];
  }
  const ids = aiLineupCallUps({ level, pool: eligible, lower: rows, lateSeason: late, roll, minAge: floor, tier: league?.tier });
  return rows.filter((row) => ids.includes(row.id));
}

/**
 * Substitution gates for the user's first team (full engine): called-up players who have not yet played for it wait
 * on the bench for a late, comfortable moment (`lead`), or from the 75th at any score in a dead rubber or a cup tie
 * against lower-tier opposition (`open`); once the season's debut budget is spent they stay on the bench (`hold`).
 * An injury crisis (fewer than 16 fit senior outfielders of his own) lifts the gate, so the debutant may even start.
 */
export async function debutGates(
  store: Store,
  club: Club,
  ageGroup: string,
  eligible: readonly { id: number; position: Position }[],
  fixture?: { home_id: number; away_id: number; stage: string; kind: League["kind"] | null },
): Promise<Map<number, "lead" | "open" | "hold">> {
  const gates = new Map<number, "lead" | "open" | "hold">();
  if (club.type !== "club" || ageGroup !== "Senior") return gates;
  const state = await stateOf(store);
  if (club.id !== state.clubId) return gates;
  const meta = await loadMeta(store, state.season);
  const team = { clubId: club.id, ageGroup: "Senior" as const };
  const calledIn = new Set(meta.active.filter((entry) => sameTeam(entry.to, team)).map((entry) => entry.playerId));
  const debutants = meta.active.filter((entry) => entry.debut && sameTeam(entry.to, team) && eligible.some((player) => player.id === entry.playerId));
  if (!debutants.length) return gates;
  const ownOutfield = eligible.filter((player) => !calledIn.has(player.id) && player.position !== "GK").length;
  if (ownOutfield < CALL_UP_RULES.debutBudget.crisisBelow) return gates;
  const limit = debutBudget(club, (await clubStanding(store, club.id)).standing, ownOutfield);
  const open =
    (!!fixture && (await cupVsLowerTier(store, fixture, club.id))) ||
    (await seasonPhase(store, team, state.season)).deadRubber;
  let played = meta.debuts[club.id] ?? 0;
  for (const entry of debutants) {
    if (await hasSeniorDebut(store, entry.playerId, club.id)) continue;
    const keeper = eligible.find((player) => player.id === entry.playerId)?.position === "GK";
    // A debutant goalkeeper is only on the bench because no other keeper is fit: no gate.
    if (keeper && !eligible.some((player) => player.position === "GK" && player.id !== entry.playerId)) continue;
    gates.set(entry.playerId, played >= limit ? "hold" : open ? "open" : "lead");
    played++;
  }
  return gates;
}
