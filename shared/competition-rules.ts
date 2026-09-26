import type { Club, Fixture, League } from "./types.ts";
import { CONTINENTAL } from "./world-catalog/continental.ts";
import type {
  AccessEntry,
  ContinentalCatalog,
  ContinentalCompetitionSpec,
  ContinentalStage,
} from "./world-catalog/types.ts";

export function clubCompetitionEligible(
  club: Pick<Club, "type" | "parent_id" | "data">,
  kind: League["kind"],
  season: number,
) {
  if (club.type === "national") return false;
  const data = JSON.parse(club.data);
  const activeFromSeason = Number(data.activeFromSeason ?? season);
  if (!Number.isInteger(activeFromSeason) || activeFromSeason > season)
    return false;
  if (kind === "league") return true;
  return club.type === "club" && club.parent_id === null &&
    !data.pendingSeniorLeague;
}

export interface KnockoutRules {
  version: number;
  legs: 1 | 2;
  extraTime: boolean;
  awayGoals: boolean;
  neutral: boolean;
}

export interface KnockoutTie extends KnockoutRules {
  id: string;
  leg: 1 | 2;
}

const CONTINENTAL_BY_NAME = new Map(CONTINENTAL.competitions.map((item) => [item.name, item]));

export function knockoutRules(name: string, stage: string): KnockoutRules {
  const competition = name.replace(/ Qualifying$/, "");
  const final = stage === "Final";
  const spec = CONTINENTAL_BY_NAME.get(competition);
  if (spec) {
    // ACL Elite: two-legged round of 16, then single matches at a centralised venue.
    const centralised = spec.id === "afc-champions-league-elite" && /Quarter|Semi|Final/i.test(stage);
    return {
      version: 1,
      legs: final ? spec.finalLegs : centralised ? 1 : spec.legs,
      extraTime: spec.age === "Senior" && spec.id !== "leagues-cup",
      awayGoals: false,
      neutral: (final && spec.neutralFinal) || centralised,
    };
  }
  const europeanSenior = [
    "UEFA Champions League",
    "UEFA Europa League",
    "UEFA Conference League",
  ].includes(competition);
  return {
    version: 1,
    legs: europeanSenior && !final ? 2 : 1,
    extraTime: !/U17|U19|U20|Youth|MIC|Future Cup|Alkass|Adidas/.test(
      competition,
    ),
    awayGoals: false,
    neutral: final,
  };
}

export function aggregateScore(
  fixtures: Pick<
    Fixture,
    "home_id" | "away_id" | "home_goals" | "away_goals"
  >[],
  homeId: number,
) {
  let home = 0;
  let away = 0;
  let homeAwayGoals = 0;
  let awayAwayGoals = 0;
  for (const fixture of fixtures) {
    if (fixture.home_id === homeId) {
      home += fixture.home_goals ?? 0;
      away += fixture.away_goals ?? 0;
      awayAwayGoals += fixture.away_goals ?? 0;
    } else {
      home += fixture.away_goals ?? 0;
      away += fixture.home_goals ?? 0;
      homeAwayGoals += fixture.away_goals ?? 0;
    }
  }
  return { home, away, homeAwayGoals, awayAwayGoals };
}

export function knockoutWinner(fixtures: Fixture[]): number | null {
  const last =
    fixtures.find(
      (fixture) =>
        (JSON.parse(fixture.data).tie as KnockoutTie | undefined)?.leg === 2,
    ) ?? fixtures[0];
  if (!last) return null;
  const details = JSON.parse(last.data);
  const tie = details.tie as KnockoutTie | undefined;
  const aggregate = aggregateScore(fixtures, last.home_id);
  if (aggregate.home !== aggregate.away)
    return aggregate.home > aggregate.away ? last.home_id : last.away_id;
  if (tie?.awayGoals && aggregate.homeAwayGoals !== aggregate.awayAwayGoals)
    return aggregate.homeAwayGoals > aggregate.awayAwayGoals
      ? last.home_id
      : last.away_id;
  return details.winnerId ?? null;
}

// ------------------------------------------------------------ continental access

export interface AccessNation {
  code: string;
  /** Continental-eligible clubs of this association in final regular-table order. */
  table: number[];
  champion?: number;
  /** Winners of cups with a continental slot only. */
  cupWinner?: number;
  leagueCupWinner?: number;
  u19Champion?: number;
  u20Champion?: number;
}
export interface AccessInput {
  confederation: string;
  /** Association codes in coefficient order; suspended and club-less associations already removed. */
  ranking: string[];
  nations: AccessNation[];
  /** Last season's winner per competition id. */
  titleholders?: Record<string, number>;
  /** Associations with a European Performance Spot. */
  performanceSpots?: string[];
  /** Last season's final order of feeder competitions (Leagues Cup, regional cups). */
  feederResults?: Record<string, number[]>;
}
export interface AccessEntrant {
  competition: string;
  clubId: number;
  nation: string;
  stage: ContinentalStage;
  path?: "champions" | "league";
  basis: string;
  associationRank: number;
  domesticPosition: number;
}

export const STAGE_ORDER: readonly ContinentalStage[] = ["main", "playoff", "q4", "q3", "q2", "q1"];

/** Five-season sum (seasons season-5..season-1); missing seasons count 0. */
export function coefficientTotal(points: ReadonlyMap<number, number>, season: number) {
  let total = 0;
  for (let year = season - 5; year < season; year++) total += points.get(year) ?? 0;
  return Math.round(total * 1000) / 1000;
}

export function rankAssociations(rows: { code: string; points: number; previous: number }[]): string[] {
  return [...rows]
    .sort((left, right) => right.points - left.points || right.previous - left.previous || left.code.localeCompare(right.code))
    .map((row) => row.code);
}

/** Seed rows (seasons firstSeason-5..-1) missing from `existing` ("entityId:season"); never OFC or suspended nations. */
export function coefficientSeedRows(
  countries: { id: number; code: string; confederation: string }[],
  existing: ReadonlySet<string>,
  firstSeason: number,
  seeds: (code: string) => readonly number[] | undefined,
  suspended: (code: string) => boolean,
) {
  const confederations = new Set<string>(CONTINENTAL.coefficientConfederations);
  const rows: { entityId: number; season: number; points: number }[] = [];
  for (const country of countries) {
    const points = seeds(country.code);
    if (!points || !confederations.has(country.confederation) || suspended(country.code)) continue;
    points.forEach((value, index) => {
      const season = firstSeason - 5 + index;
      if (!existing.has(`${country.id}:${season}`)) rows.push({ entityId: country.id, season, points: value });
    });
  }
  return rows;
}

const BASIS: Record<AccessEntry["source"], string> = {
  league: "Domestic league position",
  champion: "Domestic champion",
  "cup-winner": "Domestic cup winner",
  "league-cup-winner": "League cup winner",
  "u19-champion": "U19 champion",
  "u20-champion": "U20 champion",
};

interface PoolState {
  assigned: Map<number, { competition: ContinentalCompetitionSpec; stage: ContinentalStage }>;
  entrants: AccessEntrant[];
}

function pickClub(nation: AccessNation, entry: AccessEntry, taken: ReadonlyMap<number, unknown>) {
  const free = (id: number | undefined) => id !== undefined && !taken.has(id);
  const nextInTable = () => nation.table.find((id) => !taken.has(id));
  switch (entry.source) {
    case "u19-champion":
      return free(nation.u19Champion) ? nation.u19Champion : undefined;
    case "u20-champion":
      return free(nation.u20Champion) ? nation.u20Champion : undefined;
    case "champion":
      return free(nation.champion) ? nation.champion : nextInTable();
    case "cup-winner":
      return free(nation.cupWinner) ? nation.cupWinner : nextInTable();
    case "league-cup-winner":
      return free(nation.leagueCupWinner) ? nation.leagueCupWinner : nextInTable();
    default:
      return nextInTable();
  }
}

function resolvePool(
  catalog: ContinentalCatalog,
  input: AccessInput,
  pool: ContinentalCompetitionSpec[],
  preassigned: AccessEntrant[],
  mirrored: AccessEntrant[],
): PoolState {
  const byCode = new Map(input.nations.map((nation) => [nation.code, nation]));
  const state: PoolState = { assigned: new Map(), entrants: [] };
  const add = (competition: ContinentalCompetitionSpec, entrant: AccessEntrant) => {
    state.assigned.set(entrant.clubId, { competition, stage: entrant.stage });
    state.entrants.push(entrant);
  };
  // Titleholders and performance spots are reserved before any list slot is filled.
  for (const entrant of preassigned) {
    const competition = pool.find((item) => item.id === entrant.competition);
    if (competition && !state.assigned.has(entrant.clubId)) add(competition, entrant);
  }
  for (const competition of pool) {
    if (competition.mirrors)
      for (const entrant of mirrored.filter((item) => item.competition === competition.mirrors && item.stage === "main"))
        if (!state.assigned.has(entrant.clubId))
          add(competition, { ...entrant, competition: competition.id, basis: `${entrant.basis} (Champions League Path)` });
    const slots: { code: string; rank: number; entry: AccessEntry }[] = [];
    for (const rule of catalog.access.filter((item) => item.competition === competition.id)) {
      if (rule.basis === "fixed") {
        for (const group of rule.fixed ?? [])
          for (const code of group.nations)
            for (const entry of group.entries)
              slots.push({ code, rank: input.ranking.indexOf(code) + 1, entry });
        continue;
      }
      const zone = rule.zone ? competition.zones?.find((item) => item.name === rule.zone) : undefined;
      const ranking = zone ? input.ranking.filter((code) => zone.nations.includes(code)) : input.ranking;
      ranking.forEach((code, index) => {
        for (const band of rule.bands ?? [])
          if (index + 1 >= band.ranks[0] && index + 1 <= band.ranks[1])
            for (const entry of band.entries) slots.push({ code, rank: index + 1, entry });
      });
    }
    for (const slot of slots) {
      const nation = byCode.get(slot.code);
      if (!nation) continue;
      const clubId = pickClub(nation, slot.entry, state.assigned);
      if (clubId === undefined) continue;
      add(competition, {
        competition: competition.id,
        clubId,
        nation: nation.code,
        stage: slot.entry.stage,
        ...(slot.entry.path && { path: slot.entry.path }),
        basis: BASIS[slot.entry.source],
        associationRank: slot.rank,
        domesticPosition: nation.table.indexOf(clubId) + 1,
      });
    }
    for (const feeder of catalog.competitions)
      for (const feed of (feeder.feeds ?? []).filter((item) => item.to === competition.id && !pool.includes(feeder))) {
        const order = input.feederResults?.[feeder.id] ?? [];
        let wanted = feed.positions[1] - feed.positions[0] + 1;
        for (const clubId of order.slice(feed.positions[0] - 1)) {
          if (!wanted) break;
          if (state.assigned.has(clubId)) continue;
          const nation = input.nations.find((item) => item.table.includes(clubId) || item.cupWinner === clubId);
          add(competition, {
            competition: competition.id,
            clubId,
            nation: nation?.code ?? "",
            stage: feed.stage,
            basis: `${feeder.name} qualifier`,
            associationRank: nation ? input.ranking.indexOf(nation.code) + 1 : 0,
            domesticPosition: nation ? nation.table.indexOf(clubId) + 1 : 0,
          });
          wanted--;
        }
      }
  }
  return state;
}

function entrantOrder(left: AccessEntrant, right: AccessEntrant) {
  return (
    STAGE_ORDER.indexOf(left.stage) - STAGE_ORDER.indexOf(right.stage) ||
    (left.associationRank || 999) - (right.associationRank || 999) ||
    left.domesticPosition - right.domesticPosition
  );
}

/**
 * Resolves one confederation's continental entrants for a season from the access lists. Each club holds at most one
 * place per pool (senior club competitions, each age group, each feeder and each super cup are separate pools).
 */
export function resolveContinentalAccess(catalog: ContinentalCatalog, input: AccessInput): AccessEntrant[] {
  const competitions = catalog.competitions.filter((item) => item.confederation === input.confederation);
  const pools = new Map<string, ContinentalCompetitionSpec[]>();
  for (const competition of [...competitions].sort((left, right) => left.level - right.level)) {
    const key = competition.kind === "super" || competition.feeder ? competition.id : competition.age;
    pools.set(key, [...(pools.get(key) ?? []), competition]);
  }
  const holderOf = (id: string) => input.titleholders?.[id];
  const nationOf = (clubId: number) => input.nations.find((item) => item.table.includes(clubId))?.code ?? "";
  const holderEntrant = (competition: ContinentalCompetitionSpec, from: string, stage: ContinentalStage, clubId: number): AccessEntrant => {
    const nation = nationOf(clubId);
    return {
      competition: competition.id,
      clubId,
      nation,
      stage,
      basis: `${catalog.competitions.find((item) => item.id === from)?.name ?? from} titleholder`,
      associationRank: input.ranking.indexOf(nation) + 1,
      domesticPosition: (input.nations.find((item) => item.code === nation)?.table.indexOf(clubId) ?? -1) + 1,
    };
  };
  const result: AccessEntrant[] = [];
  const keys = [...pools.keys()].sort((left, right) => Number(left !== "Senior") - Number(right !== "Senior"));
  for (const key of keys) {
    const pool = pools.get(key)!;
    const first = resolvePool(catalog, input, pool, [], result);
    const preassigned: AccessEntrant[] = [];
    const upgrades: { clubId: number; basis: string }[] = [];
    const vacancies = new Map<string, number>();
    for (const competition of pool) {
      for (const holder of competition.titleholders ?? []) {
        const clubId = holderOf(holder.from);
        if (clubId === undefined || preassigned.some((item) => item.clubId === clubId)) continue;
        const current = first.assigned.get(clubId);
        const qualified = current && (current.competition.level < competition.level ||
          (current.competition === competition && current.stage === "main"));
        if (competition.kind !== "super" && qualified)
          vacancies.set(competition.id, (vacancies.get(competition.id) ?? 0) + 1);
        else preassigned.push(holderEntrant(competition, holder.from, holder.stage, clubId));
      }
      if (competition.confederation === "UEFA" && competition.level === 1 && competition.age === "Senior" && competition.kind === "club")
        for (const code of input.performanceSpots ?? []) {
          const nation = input.nations.find((item) => item.code === code);
          const clubId = nation?.table.find((id) => {
            const current = first.assigned.get(id);
            return !(current?.competition === competition && current.stage === "main") &&
              !preassigned.some((item) => item.clubId === id);
          });
          if (!nation || clubId === undefined) continue;
          if (first.assigned.get(clubId)?.competition === competition)
            upgrades.push({ clubId, basis: "European Performance Spot" });
          else
            preassigned.push({
              competition: competition.id,
              clubId,
              nation: code,
              stage: "main",
              basis: "European Performance Spot",
              associationRank: input.ranking.indexOf(code) + 1,
              domesticPosition: nation.table.indexOf(clubId) + 1,
            });
        }
    }
    const second = resolvePool(catalog, input, pool, preassigned, result);
    for (const upgrade of upgrades) {
      const entrant = second.entrants.find((item) => item.clubId === upgrade.clubId);
      if (!entrant) continue;
      entrant.stage = "main";
      entrant.basis = upgrade.basis;
      delete entrant.path;
    }
    for (const [competition, count] of vacancies) {
      const candidates = second.entrants
        .filter((item) => item.competition === competition && item.stage !== "main")
        .sort(entrantOrder)
        .slice(0, count);
      for (const entrant of candidates) {
        entrant.stage = "main";
        entrant.basis = `${entrant.basis} (titleholder rebalancing)`;
        delete entrant.path;
      }
    }
    result.push(...second.entrants);
  }
  return result.sort(
    (left, right) =>
      competitions.findIndex((item) => item.id === left.competition) -
        competitions.findIndex((item) => item.id === right.competition) || entrantOrder(left, right),
  );
}
