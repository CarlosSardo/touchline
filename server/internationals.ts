// National-team duty: squads named before international fixtures, club release, duty exclusion, finals rewards,
// and the read models behind /api/internationals. State lives in one meta row (`internationalDuty`), no schema change.
import seedrandom from "seedrandom";
import type { Store } from "./db.ts";
import { GameError, news, settingsOf, stateOf } from "./systems.ts";
import { addDays, internationalBreak } from "../shared/rules.ts";
import {
  cohortCutoff,
  editionYear,
  exposureValueFactor,
  heldInSeason,
  NATIONAL_DUTY_RULES,
  NATIONAL_TEAM_AGES,
  releaseDecision,
  selectNationalSquad,
  STANDOUT,
  TEAM_REPUTATION_BAND,
  TEAM_REPUTATION_BY_STAGE,
  tournamentExposure,
  YOUTH_TOURNAMENT_BY_NAME,
  YOUTH_TOURNAMENTS,
  type InternationalsDesk,
  type NationalDutyMeta,
  type NationalDutyRecord,
  type NationalSquadPlayer,
  type NationalTeamView,
  type PlayerCaps,
  type ReleasePolicy,
  type SquadCandidate,
  type YouthTournamentSpec,
} from "../shared/features/youth-internationals.ts";
import type { AgeGroup, Club, Position } from "../shared/types.ts";

export const DUTY_META = "internationalDuty";
const AGE_LIMIT: Record<string, number> = { U17: 17, U19: 19, U20: 20, U21: 21 };
const STAGE_ORDER = ["Qualifying", "Group stage", "Round of 32", "Round of 16", "Final round", "Quarter-final", "Semi-final", "Final", "Champion"];

interface DutyCache {
  date: string;
  ids: Set<number>;
  byTeam: Map<number, NationalDutyRecord[]>;
}
const cache = new WeakMap<Store, DutyCache>();

function remember(store: Store, date: string, duty: NationalDutyMeta | null) {
  const byTeam = new Map<number, NationalDutyRecord[]>();
  const ids = new Set<number>();
  for (const record of duty?.squads ?? []) {
    byTeam.set(record.teamId, [...(byTeam.get(record.teamId) ?? []), record]);
    for (const id of record.players) ids.add(id);
  }
  const entry = { date, ids, byTeam };
  cache.set(store, entry);
  return entry;
}

export async function readDuty(store: Store): Promise<NationalDutyMeta | null> {
  const row = await store.get<{ value: string }>("SELECT [value] FROM meta WHERE [key] = ?", DUTY_META);
  return row ? (JSON.parse(row.value) as NationalDutyMeta) : null;
}

async function dutyOn(store: Store, date: string) {
  const hit = cache.get(store);
  return hit?.date === date ? hit : remember(store, date, await readDuty(store));
}

/** Players away with a national team today; clubs cannot pick them. Empty outside windows and tournaments. */
export async function playersOnDuty(store: Store, date: string): Promise<ReadonlySet<number>> {
  return (await dutyOn(store, date)).ids;
}

/** The named squad of a national team for a competition, when it is on duty. */
export async function dutySquad(store: Store, teamId: number, leagueId: number | null | undefined, date: string) {
  const records = (await dutyOn(store, date)).byTeam.get(teamId) ?? [];
  return records.find((record) => record.leagueId === leagueId) ?? records[0];
}

const notFound = (message: string) => Object.assign(new GameError(message), { status: 404 });

/** Worlds generated before U21 national teams existed get them from their U20 rows (data only, no schema change). */
export async function ensureNationalTeams(store: Store) {
  await store.run(
    `INSERT INTO clubs (name,short_name,city,country_id,league_id,type,parent_id,age_group,color,reputation,academy,facilities,balance,transfer_budget,wage_budget,philosophy,culture,formation,tactical_style,chemistry,manager,manager_trust,board_confidence,board_pressure,fan_mood,fan_loyalty,fan_patience,expectations,stadium,capacity,data)
     SELECT CASE WHEN RIGHT(base.name,4) = N' U20' THEN LEFT(base.name,LEN(base.name)-4) ELSE base.name END + N' U21',base.short_name,base.city,base.country_id,NULL,N'national',NULL,N'U21',base.color,LEAST(99,base.reputation+1),base.academy,base.facilities,0,0,0,base.philosophy,base.culture,base.formation,base.tactical_style,base.chemistry,base.manager,base.manager_trust,base.board_confidence,base.board_pressure,base.fan_mood,base.fan_loyalty,base.fan_patience,base.expectations,base.stadium,base.capacity,
       JSON_MODIFY(base.data,'$.worldKey',CONCAT(N'N:',countries.code,N':U21'))
     FROM clubs AS base JOIN countries ON countries.id = base.country_id
     WHERE base.type = N'national' AND base.age_group = N'U20'
       AND NOT EXISTS (SELECT 1 FROM clubs AS other WHERE other.type = N'national' AND other.age_group = N'U21' AND other.country_id = base.country_id)`,
  );
}

const tournamentOf = (name: string) => YOUTH_TOURNAMENT_BY_NAME.get(name.replace(/ Qualifying$/, ""));

/** Consecutive fixture dates from the first, no gap longer than the look-ahead: one duty stretch. */
function stretchEnd(dates: readonly string[]) {
  let end = dates[0];
  for (const date of dates.slice(1)) {
    if (date > addDays(end, NATIONAL_DUTY_RULES.lookaheadDays)) break;
    end = date;
  }
  return end;
}

/** Club seasons are over from June to mid-July: youth finals then get every player (U21/U19 EUROs). */
const offSeason = (date: string) => date.slice(5) >= "06-01" && date.slice(5) <= "07-20";

interface LeagueRow {
  id: number;
  name: string;
  age_group: AgeGroup;
  phase: string | null;
  season: number | null;
  for_season: number | null;
}

interface CandidateRow extends SquadCandidate {
  k: number;
  name: string;
  club_id: number | null;
  parent_club_id: number | null;
  age_group: AgeGroup;
  role: string;
  club_reputation: number | null;
}

/**
 * Daily, before fixtures: names squads for national fixtures within the look-ahead (senior first, so a player plays
 * for the oldest team that wants him), applies club release, ends duty when a team has no fixture close enough,
 * and rewards finals once they are complete. Days without international football cost one meta read.
 */
export async function processInternationalDuty(store: Store) {
  const state = await stateOf(store);
  const date = state.date;
  let duty = await readDuty(store);
  if (!duty || duty.season !== state.season) duty = { season: state.season, squads: [], rewarded: [] };
  if (!duty.squads.length && duty.nextCheck && date < duty.nextCheck) {
    remember(store, date, duty);
    return;
  }
  const leagues = await store.all<LeagueRow>(
    "SELECT id,name,age_group,JSON_VALUE(data,'$.phase') AS phase,TRY_CONVERT(int,JSON_VALUE(data,'$.season')) AS season,TRY_CONVERT(int,JSON_VALUE(data,'$.forSeason')) AS for_season FROM leagues WHERE kind = 'international'",
  );
  const leagueById = new Map(leagues.map((league) => [league.id, league]));
  const upcoming = leagues.length
    ? await store.all<{ league_id: number; date: string; home_id: number; away_id: number }>(
        "SELECT league_id,date,home_id,away_id FROM fixtures WHERE season = ? AND status = 'scheduled' AND date >= ? AND league_id IN (SELECT [id] FROM OPENJSON(?) WITH ([id] INT '$')) ORDER BY date",
        state.season,
        date,
        JSON.stringify(leagues.map((league) => league.id)),
      )
    : [];
  const dates = new Map<string, string[]>();
  for (const fixture of upcoming)
    for (const teamId of [fixture.home_id, fixture.away_id]) {
      const key = `${teamId}:${fixture.league_id}`;
      dates.set(key, [...(dates.get(key) ?? []), fixture.date]);
    }
  const horizon = addDays(date, NATIONAL_DUTY_RULES.lookaheadDays - 1);
  const active: NationalDutyRecord[] = [];
  const ended: NationalDutyRecord[] = [];
  for (const record of duty.squads) {
    const own = dates.get(`${record.teamId}:${record.leagueId}`);
    if (own && own[0] <= horizon) active.push({ ...record, until: stretchEnd(own) });
    else ended.push(record);
  }
  const needed = [...dates.entries()]
    .filter(([key, own]) => own[0] <= horizon && !active.some((record) => `${record.teamId}:${record.leagueId}` === key))
    .map(([key, own]) => {
      const [teamId, leagueId] = key.split(":").map(Number);
      return { teamId, leagueId, dates: own };
    });
  const named = needed.length ? await nameSquads(store, state, needed, leagueById, active) : [];
  const squads = [...active, ...named];
  const later = [...dates.entries()]
    .filter(([key]) => !squads.some((record) => `${record.teamId}:${record.leagueId}` === key))
    .map(([, own]) => own[0])
    .sort()[0];
  const idle = addDays(date, NATIONAL_DUTY_RULES.idleCheckDays);
  const next: NationalDutyMeta = {
    season: state.season,
    squads,
    rewarded: duty.rewarded ?? [],
    nextCheck: later && addDays(later, -NATIONAL_DUTY_RULES.lookaheadDays + 1) < idle ? addDays(later, -NATIONAL_DUTY_RULES.lookaheadDays + 1) : idle,
  };
  if (ended.length) await endDuty(store, state.season, ended);
  for (const league of leagues) {
    const spec = YOUTH_TOURNAMENT_BY_NAME.get(league.name);
    if (!spec || league.phase !== "complete" || league.season !== state.season || next.rewarded!.includes(league.id)) continue;
    await rewardFinals(store, league.id, spec, state.season, date);
    next.rewarded!.push(league.id);
  }
  await store.setMeta(DUTY_META, next);
  remember(store, date, next);
}

async function nameSquads(
  store: Store,
  state: Awaited<ReturnType<typeof stateOf>>,
  needed: { teamId: number; leagueId: number; dates: string[] }[],
  leagues: Map<number, LeagueRow>,
  active: NationalDutyRecord[],
) {
  const teams = new Map(
    (
      await store.all<Pick<Club, "id" | "name" | "country_id" | "age_group">>(
        "SELECT id,name,country_id,age_group FROM clubs WHERE id IN (SELECT [id] FROM OPENJSON(?) WITH ([id] INT '$'))",
        JSON.stringify(needed.map((entry) => entry.teamId)),
      )
    ).map((team) => [team.id, team]),
  );
  const year = Number(state.date.slice(0, 4));
  const plans = needed
    .map((entry, k) => {
      const team = teams.get(entry.teamId)!;
      const league = leagues.get(entry.leagueId)!;
      const spec = tournamentOf(league.name);
      const qualifying = league.name.endsWith(" Qualifying");
      const cutoff =
        team.age_group === "Senior"
          ? "1900-01-01"
          : spec
            ? cohortCutoff(spec, qualifying ? (league.for_season ?? state.season) : state.season)
            : `${state.season + 1 - AGE_LIMIT[team.age_group]}-01-01`;
      const size =
        team.age_group === "Senior"
          ? NATIONAL_DUTY_RULES.seniorSquad
          : spec && !qualifying
            ? spec.squad
            : NATIONAL_DUTY_RULES.windowSquad[team.age_group as keyof typeof NATIONAL_DUTY_RULES.windowSquad] ?? 20;
      const goalkeepers = team.age_group === "Senior" ? NATIONAL_DUTY_RULES.seniorGoalkeepers : spec && !qualifying ? spec.goalkeepers : 2;
      const until = stretchEnd(entry.dates);
      const stretch = entry.dates.filter((day) => day <= until);
      return {
        k,
        entry,
        team,
        league,
        spec,
        cutoff,
        size,
        goalkeepers,
        until,
        mandatory: stretch.every(internationalBreak) || offSeason(stretch[0]),
        maxAge: team.age_group === "Senior" ? 40 : year - Number(cutoff.slice(0, 4)) + 1,
      };
    })
    .sort((left, right) => NATIONAL_TEAM_AGES.indexOf(left.team.age_group) - NATIONAL_TEAM_AGES.indexOf(right.team.age_group));
  const candidates = new Map<number, CandidateRow[]>();
  for (let offset = 0; offset < plans.length; offset += 200)
    for (const row of await store.all<CandidateRow>(
      `SELECT team.k, pick.id, pick.name, pick.position, pick.ability, pick.potential, pick.form, pick.club_id, pick.parent_club_id, pick.age_group, pick.role, club.reputation AS club_reputation
       FROM OPENJSON(?) WITH (k int, country_id int, cutoff nvarchar(10), max_age int, fit_by nvarchar(10)) AS team
       CROSS APPLY (
         SELECT TOP (${NATIONAL_DUTY_RULES.candidatePool}) players.id, players.name, players.position, players.ability, players.potential, players.form, players.club_id, players.parent_club_id, players.age_group, players.role
         FROM (SELECT TOP (200) ranked.id FROM players AS ranked WHERE ranked.country_id = team.country_id AND ranked.age <= team.max_age ORDER BY ranked.ability DESC, ranked.id) AS top_ids
         JOIN players ON players.id = top_ids.id
         WHERE players.birth_date >= team.cutoff AND players.role != 'Retired' AND (players.injury_until IS NULL OR players.injury_until <= team.fit_by)
         ORDER BY players.ability DESC, players.id) AS pick
       LEFT JOIN clubs AS club ON club.id = pick.club_id`,
      JSON.stringify(
        plans.slice(offset, offset + 200).map((plan) => ({
          k: plan.k,
          country_id: plan.team.country_id,
          cutoff: plan.cutoff,
          max_age: plan.maxAge,
          fit_by: plan.entry.dates[0],
        })),
      ),
    ))
      candidates.set(row.k, [...(candidates.get(row.k) ?? []), row]);
  const settings = await settingsOf(store);
  const policy = (settings.youthRelease as ReleasePolicy | undefined) ?? "club policy";
  const family = new Set(
    (await store.all<{ id: number }>("SELECT id FROM clubs WHERE id = ? OR parent_id = ?", state.clubId, state.clubId)).map((club) => club.id),
  );
  const rank = (age: AgeGroup) => NATIONAL_TEAM_AGES.indexOf(age);
  const records: NationalDutyRecord[] = [];
  const refused: number[] = [];
  for (const plan of plans) {
    const pool = candidates.get(plan.k) ?? [];
    const byId = new Map(pool.map((row) => [row.id, row]));
    const taken = new Set<number>();
    for (const record of [...active, ...records])
      if (rank(record.ageGroup) <= rank(plan.team.age_group)) for (const id of record.players) taken.add(id);
    const withheld: NationalDutyRecord["withheld"] = [];
    const decided = new Set<number>();
    let chosen: number[] = [];
    for (let attempt = 0; attempt < 6; attempt++) {
      chosen = selectNationalSquad(pool, {
        ageGroup: plan.team.age_group,
        size: plan.size,
        goalkeepers: plan.goalkeepers,
        excluded: new Set([...taken, ...withheld.map((entry) => entry.playerId)]),
      });
      let refusedNow = false;
      for (const id of chosen) {
        if (decided.has(id)) continue;
        decided.add(id);
        const row = byId.get(id)!;
        const own = row.club_id !== null && (family.has(row.club_id) || family.has(row.parent_club_id ?? -1));
        const released = releaseDecision({
          mandatory: plan.mandatory,
          clubless: row.club_id === null,
          senior: row.age_group === "Senior",
          role: row.role,
          clubReputation: row.club_reputation ?? 0,
          prestige: plan.spec?.prestige ?? 0.5,
          roll: seedrandom(`${state.seed}:release:${plan.league.id}:${id}:${state.season}`)(),
          policy: own ? policy : undefined,
        });
        if (!released) {
          withheld.push({ playerId: id, clubId: row.club_id! });
          refusedNow = true;
        }
      }
      if (!refusedNow) break;
    }
    chosen = chosen.filter((id) => !withheld.some((entry) => entry.playerId === id));
    // A player named by an older team leaves the younger squad he was with.
    for (const record of [...active, ...records])
      if (rank(record.ageGroup) > rank(plan.team.age_group)) record.players = record.players.filter((id) => !chosen.includes(id));
    refused.push(...withheld.map((entry) => entry.playerId));
    records.push({
      teamId: plan.team.id,
      countryId: plan.team.country_id,
      ageGroup: plan.team.age_group,
      leagueId: plan.league.id,
      competition: plan.league.name,
      from: state.date,
      until: plan.until,
      cutoff: plan.cutoff,
      mandatory: plan.mandatory,
      players: chosen,
      withheld,
    });
    const ownNamed = pool.filter((row) => chosen.includes(row.id) && row.club_id !== null && (family.has(row.club_id) || family.has(row.parent_club_id ?? -1)));
    const ownKept = pool.filter((row) => withheld.some((entry) => entry.playerId === row.id) && (family.has(row.club_id!) || family.has(row.parent_club_id ?? -1)));
    if (ownNamed.length)
      await news(
        store,
        "Squad",
        `International call-up: ${plan.team.name}`,
        `${ownNamed.map((row) => row.name).join(", ")} ${ownNamed.length === 1 ? "joins" : "join"} ${plan.team.name} for the ${plan.league.name} (${state.date} to ${plan.until}). ${plan.mandatory ? "Release is compulsory for these dates." : "The club agreed to release them."}`,
        "info",
        "squad",
        { internationalDuty: true, teamId: plan.team.id, leagueId: plan.league.id, players: ownNamed.map((row) => row.id) },
      );
    if (ownKept.length)
      await news(
        store,
        "Squad",
        `Call-up declined: ${plan.team.name}`,
        `The club kept ${ownKept.map((row) => row.name).join(", ")} for club duty instead of the ${plan.league.name}; release outside FIFA windows is not compulsory. ${ownKept.length === 1 ? "He is" : "They are"} disappointed.`,
        "warning",
        "squad",
        { internationalDuty: true, withheld: true, teamId: plan.team.id, leagueId: plan.league.id, players: ownKept.map((row) => row.id) },
      );
  }
  if (refused.length)
    await store.run(
      "UPDATE players SET morale = LEAST(99,GREATEST(1,morale + ?)) WHERE id IN (SELECT [id] FROM OPENJSON(?) WITH ([id] INT '$'))",
      NATIONAL_DUTY_RULES.refusalMorale,
      JSON.stringify(refused),
    );
  return records;
}

/** Players who played return with travel fatigue. */
async function endDuty(store: Store, season: number, ended: NationalDutyRecord[]) {
  const played = ended.filter((record) => record.players.length);
  if (!played.length) return;
  await store.run(
    `UPDATE players SET fitness = GREATEST(25,fitness - ?) WHERE id IN (
       SELECT stats.player_id FROM player_season_stats AS stats
       JOIN OPENJSON(?) WITH (team_id int, league_id int) AS record ON record.team_id = stats.club_id AND record.league_id = stats.league_id
       WHERE stats.season = ? AND stats.appearances > 0)`,
    NATIONAL_DUTY_RULES.travelFitness,
    JSON.stringify(played.map((record) => ({ team_id: record.teamId, league_id: record.leagueId }))),
    season,
  );
}

/** Finals rewards: visibility (value multiplier, scouting knowledge, morale) for players with minutes; team reputation. */
async function rewardFinals(store: Store, leagueId: number, spec: YouthTournamentSpec, season: number, date: string) {
  const fixtures = await store.all<{ id: number; home_id: number; away_id: number; stage: string }>(
    "SELECT id,home_id,away_id,stage FROM fixtures WHERE league_id = ? AND season = ? AND status = 'played'",
    leagueId,
    season,
  );
  if (!fixtures.length) return;
  const champion = (await store.get<{ champion: number | null }>(
    "SELECT TRY_CONVERT(int,JSON_VALUE(data,'$.champion')) AS champion FROM leagues WHERE id = ?",
    leagueId,
  ))?.champion;
  const reached = new Map<number, string>();
  for (const fixture of fixtures)
    for (const teamId of [fixture.home_id, fixture.away_id]) {
      const stage = fixture.stage === "League phase" ? "Group stage" : fixture.stage;
      const current = reached.get(teamId);
      if (!current || STAGE_ORDER.indexOf(stage) > STAGE_ORDER.indexOf(current)) reached.set(teamId, stage);
    }
  if (champion) reached.set(champion, "Champion");
  const performances = await store.all<{ player_id: number; club_id: number; matches: number; rating: number; international: string | null }>(
    `SELECT appearance.player_id, appearance.club_id, count(*) AS matches, avg(appearance.rating) AS rating, JSON_QUERY(players.profile,'$.international') AS international
     FROM player_match_appearances AS appearance JOIN players ON players.id = appearance.player_id
     WHERE appearance.fixture_id IN (SELECT [id] FROM OPENJSON(?) WITH ([id] INT '$')) AND appearance.minutes > 0
     GROUP BY appearance.player_id, appearance.club_id, JSON_QUERY(players.profile,'$.international')`,
    JSON.stringify(fixtures.map((fixture) => fixture.id)),
  );
  const rows = performances.map((row) => {
    const stage = reached.get(row.club_id) ?? "Group stage";
    const earned = tournamentExposure(stage, spec.prestige, row.matches >= STANDOUT.matches && row.rating >= STANDOUT.rating);
    const previous = row.international ? (JSON.parse(row.international) as { value: number; date: string }) : undefined;
    const remaining = exposureValueFactor(previous, date) - 1;
    const value = Math.max(earned, remaining);
    return {
      id: row.player_id,
      international: JSON.stringify(value === earned ? { value: earned, date, tournament: spec.name } : { ...previous, value: remaining }),
      morale: stage === "Champion" ? 4 : STAGE_ORDER.indexOf(stage) >= STAGE_ORDER.indexOf("Semi-final") ? 2 : 0,
    };
  });
  for (let offset = 0; offset < rows.length; offset += 1000)
    await store.run(
      "UPDATE target SET profile = JSON_MODIFY(target.profile,'$.international',JSON_QUERY(changes.international)), knowledge = CASE WHEN target.knowledge < ? THEN ? ELSE target.knowledge END, morale = LEAST(99,target.morale + changes.morale) FROM players AS target JOIN OPENJSON(?) WITH (id int, international nvarchar(max), morale float) AS changes ON changes.id = target.id",
      NATIONAL_DUTY_RULES.exposureKnowledge,
      NATIONAL_DUTY_RULES.exposureKnowledge,
      JSON.stringify(rows.slice(offset, offset + 1000)),
    );
  await store.run(
    `UPDATE team SET reputation = LEAST(senior.reputation + ?, GREATEST(senior.reputation - ?, LEAST(99, GREATEST(1, team.reputation + change.delta))))
     FROM clubs AS team JOIN OPENJSON(?) WITH (id int, delta float) AS change ON change.id = team.id
     JOIN clubs AS senior ON senior.country_id = team.country_id AND senior.type = 'national' AND senior.age_group = 'Senior'`,
    TEAM_REPUTATION_BAND / 2,
    TEAM_REPUTATION_BAND,
    JSON.stringify([...reached].map(([id, stage]) => ({ id, delta: TEAM_REPUTATION_BY_STAGE[stage] ?? 0 }))),
  );
}

// ------------------------------------------------------------------ read models

interface SquadRow {
  id: number;
  name: string;
  position: Position;
  age: number;
  birth_date: string;
  ability: number;
  potential: number;
  form: number;
  club_id: number | null;
  club_name: string | null;
  caps: number | null;
  goals: number | null;
}

const capsJoin =
  "OUTER APPLY (SELECT sum(stats.appearances) AS caps, sum(stats.goals) AS goals FROM player_season_stats AS stats WHERE stats.player_id = players.id AND stats.club_id = ?) AS record";

/** One national team: the squad on duty (or the provisional squad for its next fixture), competitions and fixtures. */
export async function nationalTeamView(store: Store, teamId: number): Promise<NationalTeamView> {
  const state = await stateOf(store);
  const team = await store.get<Club & { country_name: string }>(
    "SELECT clubs.*, countries.name AS country_name FROM clubs JOIN countries ON countries.id = clubs.country_id WHERE clubs.id = ? AND clubs.type = 'national'",
    teamId,
  );
  if (!team) throw notFound("National team not found.");
  const record = await dutySquad(store, teamId, undefined, state.date);
  const nextFixture = await store.get<{ league_id: number; name: string; for_season: number | null }>(
    "SELECT TOP (1) fixtures.league_id, leagues.name, TRY_CONVERT(int,JSON_VALUE(leagues.data,'$.forSeason')) AS for_season FROM fixtures JOIN leagues ON leagues.id = fixtures.league_id WHERE (fixtures.home_id = ? OR fixtures.away_id = ?) AND fixtures.status = 'scheduled' ORDER BY fixtures.date, fixtures.id",
    teamId,
    teamId,
  );
  const spec = tournamentOf(record?.competition ?? nextFixture?.name ?? "") ??
    YOUTH_TOURNAMENTS.find((item) => item.team === team.age_group && heldInSeason(item, state.season));
  const cutoff =
    record?.cutoff ??
    (team.age_group === "Senior"
      ? "1900-01-01"
      : spec
        ? cohortCutoff(spec, nextFixture?.name.endsWith(" Qualifying") ? (nextFixture.for_season ?? state.season) : state.season)
        : `${state.season + 1 - AGE_LIMIT[team.age_group]}-01-01`);
  const select = `SELECT players.id, players.name, players.position, players.age, players.birth_date, players.ability, players.potential, players.form, players.club_id, clubs.name AS club_name, record.caps, record.goals FROM players LEFT JOIN clubs ON clubs.id = players.club_id ${capsJoin}`;
  let players: NationalSquadPlayer[];
  const view = (row: SquadRow, status: NationalSquadPlayer["status"]): NationalSquadPlayer => ({
    id: row.id,
    name: row.name,
    position: row.position,
    age: row.age,
    birthDate: row.birth_date,
    ability: row.ability,
    potential: row.potential,
    clubId: row.club_id,
    clubName: row.club_name,
    caps: row.caps ?? 0,
    goals: row.goals ?? 0,
    status,
  });
  if (record) {
    const ids = [...record.players, ...record.withheld.map((entry) => entry.playerId)];
    const rows = ids.length
      ? await store.all<SquadRow>(`${select} WHERE players.id IN (SELECT [id] FROM OPENJSON(?) WITH ([id] INT '$'))`, teamId, JSON.stringify(ids))
      : [];
    players = rows.map((row) => view(row, record.players.includes(row.id) ? "selected" : "withheld"));
  } else {
    const maxAge = team.age_group === "Senior" ? 40 : Number(state.date.slice(0, 4)) - Number(cutoff.slice(0, 4)) + 1;
    const rows = await store.all<SquadRow>(
      `${select} WHERE players.id IN (SELECT TOP (200) ranked.id FROM players AS ranked WHERE ranked.country_id = ? AND ranked.age <= ? ORDER BY ranked.ability DESC, ranked.id) AND players.birth_date >= ? AND players.role != 'Retired'`,
      teamId,
      team.country_id,
      maxAge,
      cutoff,
    );
    const size = team.age_group === "Senior" ? NATIONAL_DUTY_RULES.seniorSquad : (spec?.squad ?? 20);
    const picked = new Set(
      selectNationalSquad(rows, { ageGroup: team.age_group, size, goalkeepers: team.age_group === "Senior" ? 3 : (spec?.goalkeepers ?? 2) }),
    );
    players = rows.filter((row) => picked.has(row.id)).map((row) => view(row, "provisional"));
  }
  players.sort((left, right) => right.ability - left.ability || left.id - right.id);
  const competitions = await store.all<{ leagueId: number; name: string; phase: string | null; season: number | null }>(
    "SELECT DISTINCT leagues.id AS leagueId, leagues.name, JSON_VALUE(leagues.data,'$.phase') AS phase, TRY_CONVERT(int,JSON_VALUE(leagues.data,'$.season')) AS season FROM leagues JOIN standings ON standings.league_id = leagues.id WHERE standings.club_id = ?",
    teamId,
  );
  const fixtures = await store.all<NationalTeamView["fixtures"][number]>(
    `SELECT TOP (40) fixtures.id, fixtures.date, fixtures.league_id AS leagueId, leagues.name AS competition, fixtures.stage, fixtures.home_id AS homeId, fixtures.away_id AS awayId, home.name AS homeName, away.name AS awayName, fixtures.status, fixtures.home_goals AS homeGoals, fixtures.away_goals AS awayGoals
     FROM fixtures JOIN leagues ON leagues.id = fixtures.league_id JOIN clubs AS home ON home.id = fixtures.home_id JOIN clubs AS away ON away.id = fixtures.away_id
     WHERE (fixtures.home_id = ? OR fixtures.away_id = ?) AND fixtures.season = ? ORDER BY fixtures.date, fixtures.id`,
    teamId,
    teamId,
    state.season,
  );
  return {
    team: { id: team.id, name: team.name, ageGroup: team.age_group, countryId: team.country_id, countryName: team.country_name, reputation: team.reputation },
    duty: record ? { teamId: record.teamId, countryId: record.countryId, ageGroup: record.ageGroup, leagueId: record.leagueId, competition: record.competition, from: record.from, until: record.until, cutoff: record.cutoff, mandatory: record.mandatory } : null,
    cutoff,
    players,
    competitions: competitions.map((row) => ({ ...row, held: row.season === state.season && row.phase !== "rest year" })),
    fixtures,
  };
}

/** Youth tournaments this season and the user's club family players away with (or kept from) national teams. */
export async function internationalsDesk(store: Store): Promise<InternationalsDesk> {
  const state = await stateOf(store);
  const settings = await settingsOf(store);
  const leagues = new Map(
    (
      await store.all<{ id: number; name: string; phase: string | null; champion_name: string | null }>(
        "SELECT id,name,JSON_VALUE(data,'$.phase') AS phase,JSON_VALUE(data,'$.championName') AS champion_name FROM leagues WHERE kind = 'international' AND country_id IS NULL",
      )
    ).map((league) => [league.name, league]),
  );
  const duty = await dutyOn(store, state.date);
  const family = (await store.all<{ id: number }>("SELECT id FROM clubs WHERE id = ? OR parent_id = ?", state.clubId, state.clubId)).map((club) => club.id);
  const records = [...duty.byTeam.values()].flat();
  const ids = records.flatMap((record) => [...record.players, ...record.withheld.map((entry) => entry.playerId)]);
  const own = ids.length
    ? await store.all<{ id: number; name: string }>(
        "SELECT id,name FROM players WHERE id IN (SELECT [id] FROM OPENJSON(?) WITH ([id] INT '$')) AND (club_id IN (SELECT [id] FROM OPENJSON(?) WITH ([id] INT '$')) OR parent_club_id IN (SELECT [id] FROM OPENJSON(?) WITH ([id] INT '$')))",
        JSON.stringify(ids),
        JSON.stringify(family),
        JSON.stringify(family),
      )
    : [];
  const teamNames = new Map(
    records.length
      ? (
          await store.all<{ id: number; name: string }>(
            "SELECT id,name FROM clubs WHERE id IN (SELECT [id] FROM OPENJSON(?) WITH ([id] INT '$'))",
            JSON.stringify(records.map((record) => record.teamId)),
          )
        ).map((team) => [team.id, team.name])
      : [],
  );
  const clubPlayers = own.flatMap((player) => {
    const record = records.find((item) => item.players.includes(player.id) || item.withheld.some((entry) => entry.playerId === player.id));
    return record
      ? [{
          playerId: player.id,
          name: player.name,
          teamId: record.teamId,
          teamName: teamNames.get(record.teamId) ?? "",
          competition: record.competition,
          from: record.from,
          until: record.until,
          status: record.players.includes(player.id) ? ("selected" as const) : ("withheld" as const),
        }]
      : [];
  });
  return {
    date: state.date,
    tournaments: YOUTH_TOURNAMENTS.map((spec) => {
      const league = leagues.get(spec.name);
      return {
        id: spec.id,
        name: spec.name,
        confederation: spec.confederation,
        ageGroup: spec.team,
        leagueId: league?.id ?? null,
        qualifyingLeagueId: leagues.get(`${spec.name} Qualifying`)?.id ?? null,
        held: heldInSeason(spec, state.season),
        edition: editionYear(spec, state.season),
        start: `${Number(spec.start.slice(0, 2)) >= 7 ? state.season : state.season + 1}-${spec.start}`,
        phase: league?.phase ?? null,
        championName: league?.champion_name ?? null,
      };
    }),
    clubPlayers,
    releasePolicy: (settings.youthRelease as ReleasePolicy | undefined) ?? "club policy",
  };
}

/** A player's national-team record by team (season totals survive retention), plus his current exposure. */
export async function playerCaps(store: Store, playerId: number): Promise<PlayerCaps> {
  const player = await store.get<{ id: number; international: string | null }>(
    "SELECT id, JSON_QUERY(profile,'$.international') AS international FROM players WHERE id = ?",
    playerId,
  );
  if (!player) throw notFound("Player not found.");
  const rows = await store.all<{ team_id: number; team_name: string; age_group: AgeGroup; appearances: number; minutes: number; goals: number; assists: number; first_season: number; last_season: number }>(
    `SELECT clubs.id AS team_id, clubs.name AS team_name, clubs.age_group, sum(stats.appearances) AS appearances, sum(stats.minutes) AS minutes, sum(stats.goals) AS goals, sum(stats.assists) AS assists, min(stats.season) AS first_season, max(stats.season) AS last_season
     FROM player_season_stats AS stats JOIN clubs ON clubs.id = stats.club_id
     WHERE stats.player_id = ? AND clubs.type = 'national' GROUP BY clubs.id, clubs.name, clubs.age_group`,
    playerId,
  );
  const teams = rows
    .map((row) => ({
      teamId: row.team_id,
      teamName: row.team_name,
      ageGroup: row.age_group,
      appearances: row.appearances,
      minutes: row.minutes,
      goals: row.goals,
      assists: row.assists,
      firstSeason: row.first_season,
      lastSeason: row.last_season,
    }))
    .sort((left, right) => NATIONAL_TEAM_AGES.indexOf(left.ageGroup) - NATIONAL_TEAM_AGES.indexOf(right.ageGroup));
  return {
    playerId,
    teams,
    total: { appearances: teams.reduce((sum, row) => sum + row.appearances, 0), goals: teams.reduce((sum, row) => sum + row.goals, 0) },
    exposure: player.international ? JSON.parse(player.international) : null,
  };
}
