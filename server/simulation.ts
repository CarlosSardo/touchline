import seedrandom from "seedrandom";
import { Store } from "./db.ts";
import { processAffiliateRequests, processAssistant, processStaffCareers } from "./club-support.ts";
import { processUnexpectedEvents } from "./events.ts";
import { processCompetitionNotifications } from "./notifications.ts";
import {
  countryPyramid,
  createCalendar,
  progressCompetitions,
  type PlayoffData,
} from "./calendar.ts";
import {
  matchGoalFactor,
  needsHeadToHead,
  planMovement,
  rankTable,
  readLeagueData,
  resolvePlayoffBySeed,
  type LeagueResult,
  type PlayoffResult,
} from "../shared/league-rules.ts";
import {
  followsFixture,
  simulateFastMatch,
  simulateFixture,
} from "./fast-match.ts";
import {
  aggregateScore,
  isKnockoutStage,
  knockoutRules,
  type KnockoutTie,
} from "../shared/competition-rules.ts";
import { MATCH_RULES_VERSION } from "./match.ts";
import { recordAssociationCoefficients } from "./qualification.ts";
import { pruneSeason, storedAppearanceStats, storedMatchData } from "./retention.ts";
import { assessRegistration } from "./registration.ts";
import {
  assessPlayerInterest,
  buyerGoingRate,
  marketMoveInterest,
  marketWageOffer,
  MOVE_REFUSAL_THRESHOLD,
  processMinorApplications,
} from "./recruitment.ts";
import {
  executeMarketTransfer,
  processTransferBattles,
  recordShortlistBid,
  sellerCanRelease,
} from "./transfer-battles.ts";
import {
  dailyMedia,
  publishClubRoundup,
  publishTransferStory,
} from "./media.ts";
import {
  assessFinances,
  closeFinancialYear,
  estimateClubRevenue,
  leaguePrizeMoney,
  parachutePayment,
  postWeeklyAccounts,
  recordFinancialItem,
  seasonBudgets,
  MOVEMENT_BUDGET_FACTOR,
  spendRatio,
  weeklyOperatingCosts,
} from "./finance.ts";
import { personName } from "./people.ts";
import { maintainSquads, runYouthIntake, signClublessPlayers, youthBirthCutoff } from "./youth.ts";
import { AVERAGE_MINUTES_SHARE, developBody, exactAge, weeklyDevelopment } from "./growth.ts";
import {
  aiLineupCallUps,
  debutGates,
  minSeniorAge,
  aiMeritChance,
  aiNeedsLower,
  endAllCallUps,
  levelOf,
  lineupExtras,
  lowerTeam,
  processCallUps,
  restCutoff,
  type TargetLevel,
} from "./callups.ts";
import { CALL_UP_RULES } from "../shared/features/callups.ts";
import { exposureValueFactor, type NationalDutyRecord } from "../shared/features/youth-internationals.ts";
import { dutySquad, playersOnDuty, processInternationalDuty } from "./internationals.ts";
import { nationByCode } from "../shared/world-catalog/index.ts";
import { marketValueFactor } from "../shared/world-catalog/market.ts";
import { MIN_GOALKEEPERS, SQUAD_MINIMUMS } from "../shared/world-rules.ts";
import {
  clubOf,
  closeNegotiation,
  progressDealMilestones,
  processTransferPayments,
  defaultLoanTerms,
  experience,
  expireLoans,
  finishScouting,
  GameError,
  news,
  playerOf,
  reviewLoans,
  settingsOf,
  stateOf,
  weeklyWages,
} from "./systems.ts";
import {
  addDays,
  ADULT_LIFESTYLES,
  ageOn,
  clamp,
  currentAttributes,
  daysBetween,
  deadlineDay,
  disciplineScope,
  internationalBreak,
  LEGACY_DISCIPLINE_SCOPE,
  potentialInfluences,
  round,
  tacticalFit,
  transferWindow,
  valuation,
} from "../shared/rules.ts";
import type {
  AgeGroup,
  Club,
  Country,
  Fixture,
  League,
  MatchPlayer,
  MatchResult,
  MatchSnapshot,
  MatchTeam,
  Negotiation,
  NegotiationData,
  Player,
  PlayerProfile,
  Position,
  Standing,
} from "../shared/types.ts";

const formations: Record<string, Position[]> = {
  "4-3-3": ["GK", "RB", "CB", "CB", "LB", "DM", "CM", "CM", "RW", "ST", "LW"],
  "4-2-3-1": ["GK", "RB", "CB", "CB", "LB", "DM", "CM", "RW", "AM", "LW", "ST"],
  "3-5-2": ["GK", "CB", "CB", "CB", "RB", "CM", "DM", "CM", "LB", "ST", "ST"],
  "4-4-2": ["GK", "RB", "CB", "CB", "LB", "RW", "CM", "CM", "LW", "ST", "ST"],
};
const AGE_LIMITS: Record<string, number> = { U17: 17, U19: 19, U20: 20, U21: 21 };

async function updateSimulationRows(
  store: Store,
  table: "players" | "clubs" | "relationships",
  rows: Record<string, string | number | null>[],
  columns: string,
  assignments: string,
) {
  for (let offset = 0; offset < rows.length; offset += 1000)
    await store.run(
      `UPDATE target SET ${assignments} FROM ${table} AS target JOIN OPENJSON(?) WITH (${columns}) AS changes ON changes.id = target.id`,
      JSON.stringify(rows.slice(offset, offset + 1000)),
    );
}

export async function matchTeam(
  store: Store,
  club: Club,
  ageGroup: AgeGroup,
  date: string,
  league?: League,
  fixture?: Pick<Fixture, "home_id" | "away_id" | "stage">,
): Promise<MatchTeam> {
  const ageLimit = AGE_LIMITS[ageGroup] ?? 100;
  const scope = disciplineScope(league);
  const eligibilityDate =
    ageLimit < 100 ? `${(await stateOf(store)).season}-01-01` : date;
  const birthCutoff = `${Number(eligibilityDate.slice(0, 4)) - ageLimit + 1}-01-01`;
  // National teams on duty play their named squad; clubs lose players away with national teams.
  const squad = club.type === "national" ? await dutySquad(store, club.id, league?.id, date) : undefined;
  const onDuty = club.type === "national" ? new Set<number>() : await playersOnDuty(store, date);
  let eligible = squad
    ? await store.all<Player & { confidence: number }>(
        `SELECT TOP (60) *, TRY_CONVERT(float,JSON_VALUE(profile,'$.mentalHealth.confidence')) AS confidence FROM players WHERE id IN (SELECT [id] FROM OPENJSON(?) WITH ([id] INT '$')) AND role != 'Retired' AND (injury_until IS NULL OR injury_until <= ?) AND NOT EXISTS(SELECT 1 FROM discipline WHERE discipline.player_id = players.id AND discipline.scope = ? AND suspension > 0) AND NOT EXISTS(SELECT 1 FROM player_match_appearances WHERE player_match_appearances.player_id = players.id AND date = ? AND minutes > 0) ORDER BY ability + fitness * 0.3 DESC, id`,
        JSON.stringify(squad.players),
        date,
        scope,
        date,
      )
    : await store.all<Player & { confidence: number }>(
    `SELECT TOP (60) *, TRY_CONVERT(float,JSON_VALUE(profile,'$.mentalHealth.confidence')) AS confidence FROM players WHERE ${club.type === "national" ? "country_id" : "coalesce(squad_club_id,club_id)"} = ? AND birth_date >= ? AND role != 'Retired' AND (injury_until IS NULL OR injury_until <= ?) AND NOT EXISTS(SELECT 1 FROM discipline WHERE discipline.player_id = players.id AND discipline.scope = ? AND suspension > 0) ${club.type === "national" ? "" : "AND age_group = ?"} AND NOT EXISTS(SELECT 1 FROM player_match_appearances WHERE player_match_appearances.player_id = players.id AND date = ? AND minutes > 0) ORDER BY ability + fitness * 0.3 + CASE role WHEN 'Key player' THEN 5 WHEN 'Captain' THEN 6 WHEN 'Regular starter' THEN 3 ELSE 0 END + coalesce((SELECT TRY_CONVERT(float,JSON_VALUE(terms,'$.playingTime')) / 15.0 FROM loans WHERE loans.player_id = players.id AND loans.status = 'active'),0) DESC`,
    club.type === "national" ? club.country_id : club.id,
    birthCutoff,
    date,
    scope,
    ...(club.type === "national" ? [] : [ageGroup]),
    date,
  );
  if (onDuty.size) eligible = eligible.filter((player) => !onDuty.has(player.id));
  const extras = (await lineupExtras(
    store,
    club,
    ageGroup,
    date,
    league,
    eligible,
    (team, cutoff) =>
      store.all<Player & { confidence: number }>(
        "SELECT TOP (8) *, TRY_CONVERT(float,JSON_VALUE(profile,'$.mentalHealth.confidence')) AS confidence FROM players WHERE playing_club_id = ? AND age_group = ? AND birth_date >= ? AND role != 'Retired' AND fitness >= ? AND (injury_until IS NULL OR injury_until <= ?) AND NOT EXISTS(SELECT 1 FROM discipline WHERE discipline.player_id = players.id AND discipline.scope = ? AND suspension > 0) AND NOT EXISTS(SELECT 1 FROM player_match_appearances WHERE player_match_appearances.player_id = players.id AND date >= ? AND minutes > 0) ORDER BY ability DESC,id",
        team.clubId,
        team.ageGroup,
        cutoff,
        CALL_UP_RULES.minFitness,
        date,
        scope,
        restCutoff(date),
      ),
    birthCutoff,
  )).filter((player) => !onDuty.has(player.id));
  if (extras.length) {
    // Called-up players slot in by selection score; the squad keeps its SQL order.
    const score = (player: Player) => player.ability + player.fitness * 0.3;
    eligible = [...eligible];
    for (const extra of extras) {
      const at = eligible.findIndex((player) => score(player) < score(extra));
      eligible.splice(at < 0 ? eligible.length : at, 0, extra);
    }
  }
  const gates = await debutGates(
    store,
    club,
    ageGroup,
    eligible,
    fixture && { ...fixture, kind: league?.kind ?? null },
  );
  const asMatchPlayer = (
    player: Player & { confidence: number },
    position = player.position,
  ): MatchPlayer => {
    const profile = JSON.parse(player.profile) as PlayerProfile;
    const attributes = currentAttributes(profile, player.ability);
    const fit =
      player.position === position
        ? 1
        : player.secondary_position === position
          ? 0.94
          : 0.8;
    return {
      id: player.id,
      name: player.name,
      position,
      ability: round(player.ability * fit),
      fitness: player.fitness,
      confidence: player.confidence,
      traits: profile.traits,
      pressureHandling: profile.personality.pressureHandling,
      consistency: profile.personality.consistency,
      discipline: profile.personality.discipline,
      height: profile.identity.height,
      attributes: {
        ...attributes.technical,
        ...attributes.physical,
        ...attributes.tactical,
        ...attributes.goalkeeper,
      },
      // A gated keeper never starts (starters below), but may always replace an injured goalkeeper from the bench.
      ...(gates.has(player.id) && player.position !== "GK" ? { callUpDebut: gates.get(player.id) } : {}),
    };
  };
  const lineup: MatchPlayer[] = [];
  // Called-up debutants start on the bench (see debutGates).
  const starters = gates.size
    ? eligible.filter((player) => !gates.has(player.id))
    : eligible;
  for (const position of formations[club.formation] ?? formations["4-3-3"]) {
    const available = starters.filter(
      (player) => !lineup.some((selected) => selected.id === player.id),
    );
    const player =
      available.find((candidate) => candidate.position === position) ??
      available.find(
        (candidate) => candidate.secondary_position === position,
      ) ??
      available.find(
        (candidate) => position === "GK" || candidate.position !== "GK",
      ) ??
      available[0];
    if (!player) continue;
    lineup.push(asMatchPlayer(player, position));
  }
  const remaining = eligible.filter(
    (player) => !lineup.some((selected) => selected.id === player.id),
  );
  const reserveKeeper = remaining.find((player) => player.position === "GK");
  const bench = [
    ...(reserveKeeper ? [reserveKeeper] : []),
    ...remaining.filter(
      (player) => player.id !== reserveKeeper?.id && gates.has(player.id),
    ),
    ...remaining.filter(
      (player) => player.id !== reserveKeeper?.id && !gates.has(player.id),
    ),
  ]
    .slice(0, 12)
    .map((player) => asMatchPlayer(player));
  const setPieces = (await store.get<{
    routine: string;
    target: string;
    risk: number;
  }>("SELECT * FROM set_pieces WHERE club_id = ?", club.id)) ?? {
    routine: "Near post",
    target: "Centre-back",
    risk: 50,
  };
  const staff = (await store.get<{ ability: number }>(
    "SELECT coalesce(avg(CONVERT(float,ability)), 50) AS ability FROM staff WHERE club_id = ? AND role IN ('Assistant manager','Analyst','Set-piece coach')",
    club.id,
  ))!;
  return {
    id: club.id,
    name: club.name,
    color: club.color,
    ability: lineup.length
      ? lineup.reduce((sum, player) => sum + player.ability, 0) /
          lineup.length +
        (staff.ability - 50) / 20
      : 20,
    style: club.tactical_style,
    formation: club.formation,
    chemistry: club.chemistry,
    momentum: club.momentum,
    pressure: club.board_pressure,
    lineup,
    bench,
    setPieces,
  };
}

async function disciplinaryConsequences(
  store: Store,
  fixture: Fixture,
  league: League | undefined,
  result: MatchResult,
  snapshot: MatchSnapshot,
) {
  if (!league) return;
  const state = await stateOf(store);
  for (const team of [snapshot.home, snapshot.away]) {
    const club = await clubOf(store, team.id);
    const scope = disciplineScope(league);
    // Bans run down with the matches of the team that played (a B-team or youth side, not the parent club).
    await store.run(
      `UPDATE discipline SET suspension = GREATEST(0,suspension - 1) WHERE scope = ? AND suspension > 0 AND player_id IN (SELECT id FROM players WHERE ${club.type === "national" ? "country_id = ?" : "playing_club_id = ? AND age_group = ?"})`,
      scope,
      ...(club.type === "national" ? [club.country_id] : [club.id, league.age_group]),
    );
    const participants = [...team.lineup, ...(team.bench ?? [])].filter(
      (player) => result.players[player.id]?.minutes,
    );
    const previousRows = participants.length
      ? await store.all<{
          player_id: number;
          yellow_cards: number;
          suspension: number;
          season: number;
        }>(
          `SELECT player_id,yellow_cards,suspension,season FROM discipline WHERE scope = ? AND player_id IN (${participants.map(() => "?").join(",")})`,
          scope,
          ...participants.map((player) => player.id),
        )
      : [];
    const previousByPlayer = new Map(
      previousRows.map((row) => [row.player_id, row]),
    );
    const seasonStats: Record<string, string | number>[] = [];
    const disciplineRows: Record<string, string | number>[] = [];
    for (const player of participants) {
      const stats = result.players[player.id];
      if (!stats?.minutes) continue;
      if (fixture.league_id)
        seasonStats.push({
          player_id: player.id,
          season: state.season,
          club_id: team.id,
          league_id: fixture.league_id,
          minutes: stats.minutes,
          goals: stats.goals,
          assists: stats.assists,
        });
      const previous = previousByPlayer.get(player.id);
      const cautions =
        (previous?.season === state.season ? previous.yellow_cards : 0) +
        stats.yellowCards;
      const dismissal = result.events.find(
        (event) => event.playerId === player.id && event.type === "red card",
      );
      const ban = dismissal
        ? dismissal.text.includes("second caution")
          ? 1
          : 3
        : league.kind === "continental"
          ? cautions >= 3 && (cautions - 3) % 2 === 0 && stats.yellowCards > 0
            ? 1
            : 0
          : cautions > 0 && cautions % 5 === 0 && stats.yellowCards > 0
            ? 1
            : 0;
      disciplineRows.push({
        player_id: player.id,
        scope,
        yellow_cards: cautions,
        suspension: ban,
        season: state.season,
      });
      if (ban && team.id === state.clubId)
        await news(
          store,
          "Squad",
          `${player.name}: suspension`,
          `Unavailable for ${ban} match${ban === 1 ? "" : "es"} in the applicable competition scope.`,
          "warning",
          "squad",
        );
    }
    if (seasonStats.length)
      await store.run(
        `MERGE player_season_stats WITH (HOLDLOCK) AS target
       USING OPENJSON(?) WITH (player_id int,season int,club_id int,league_id int,minutes int,goals int,assists int) AS source
       ON target.player_id = source.player_id AND target.season = source.season AND target.club_id = source.club_id AND target.league_id = source.league_id
       WHEN MATCHED THEN UPDATE SET minutes = target.minutes + source.minutes, appearances = target.appearances + 1, goals = target.goals + source.goals, assists = target.assists + source.assists
       WHEN NOT MATCHED THEN INSERT (player_id,season,club_id,league_id,minutes,appearances,goals,assists)
       VALUES (source.player_id,source.season,source.club_id,source.league_id,source.minutes,1,source.goals,source.assists);`,
        JSON.stringify(seasonStats),
      );
    if (disciplineRows.length)
      await store.run(
        `MERGE discipline WITH (HOLDLOCK) AS target
       USING OPENJSON(?) WITH (player_id int,scope nvarchar(100),yellow_cards int,suspension int,season int) AS source
       ON target.player_id = source.player_id AND target.scope = source.scope
       WHEN MATCHED THEN UPDATE SET yellow_cards = source.yellow_cards, suspension = target.suspension + source.suspension, season = source.season
       WHEN NOT MATCHED THEN INSERT (player_id,scope,yellow_cards,suspension,season)
       VALUES (source.player_id,source.scope,source.yellow_cards,source.suspension,source.season);`,
        JSON.stringify(disciplineRows),
      );
  }
  for (const injury of result.injuries ?? [])
    await store.run(
      "UPDATE players SET injury_until = ?, training = 'Injury rehab' WHERE id = ?",
      addDays(fixture.date, injury.days),
      injury.playerId,
    );
}

async function updateTable(
  store: Store,
  fixture: Fixture,
  result: MatchResult,
) {
  if (!fixture.league_id || !tableFixture(fixture)) return;
  const statement =
    "UPDATE standings SET played = played + 1, wins = wins + ?, draws = draws + ?, losses = losses + ?, gf = gf + ?, ga = ga + ?, points = points + ?, xg = xg + ?, xga = xga + ?, xpts = xpts + ?, form = ?, home_record = ?, away_record = ? WHERE league_id = ? AND club_id = ?";
  for (const home of [true, false]) {
    const clubId = home ? fixture.home_id : fixture.away_id;
    const own = home ? result.homeGoals : result.awayGoals;
    const against = home ? result.awayGoals : result.homeGoals;
    const entry = await store.get<Standing>(
      "SELECT * FROM standings WHERE league_id = ? AND club_id = ?",
      fixture.league_id,
      clubId,
    );
    if (!entry) continue;
    const outcome = own > against ? "W" : own < against ? "L" : "D";
    const record = (home ? entry.home_record : entry.away_record)
      .split("-")
      .map(Number);
    record[outcome === "W" ? 0 : outcome === "D" ? 1 : 2]++;
    await store.run(
      statement,
      outcome === "W" ? 1 : 0,
      outcome === "D" ? 1 : 0,
      outcome === "L" ? 1 : 0,
      own,
      against,
      outcome === "W" ? 3 : outcome === "D" ? 1 : 0,
      home ? result.homeXg : result.awayXg,
      home ? result.awayXg : result.homeXg,
      home ? result.homeXpts : result.awayXpts,
      (entry.form + outcome).slice(-5),
      home ? record.join("-") : entry.home_record,
      home ? entry.away_record : record.join("-"),
      fixture.league_id,
      clubId,
    );
  }
}

function standingOutcome(
  club: Club,
  table: Standing[],
  settings: Awaited<ReturnType<typeof settingsOf>>,
  result: number,
  margin: number,
) {
  const position = table.findIndex((entry) => entry.club_id === club.id) + 1;
  const row = table[position - 1];
  if (!row) return undefined;
  const bottom = position > table.length - 3;
  const top = position <= 4;
  const streak = row.form.match(/(W+|L+|D+)$/)?.[0] ?? "";
  const caution = Math.min(1, row.played / 6);
  const crisis =
    clamp(
      (bottom ? 35 : 0) +
        Math.max(0, position - club.expectations) * 4 +
        (streak.startsWith("L") ? streak.length * 9 : 0) +
        (margin <= -3 ? 15 : 0),
      0,
      100,
    ) * caution;
  const hype =
    clamp(
      (top ? 20 : 0) +
        Math.max(0, club.expectations - position) * 4 +
        (streak.startsWith("W") ? streak.length * 9 : 0) +
        (margin >= 3 ? 15 : 0),
      0,
      100,
    ) * caution;
  const pressure =
    clamp(
      (bottom ? 65 : top ? 48 : 25) +
        (position - club.expectations) * 2 +
        crisis / 4 +
        Number(settings.boardStrictness) / 10,
      0,
      100,
    ) * Math.max(0.4, caution);
  const momentum = clamp(
    club.momentum * 0.65 + result * 12 + margin * 1.5,
    -50,
    50,
  );
  const confidence = clamp(
    club.board_confidence +
      result * (Number(settings.boardStrictness) / 50 + 0.5) -
      Math.max(0, position - club.expectations) * 0.12 * caution,
    0,
    100,
  );
  const mood = clamp(
    club.fan_mood +
      (result * 3 * Number(settings.fanPressure)) / 50 +
      margin * 0.35 -
      (bottom ? 0.7 : 0),
    0,
    100,
  );
  const trust = clamp(club.manager_trust + result * 1.8 - crisis / 180, 0, 100);
  return { position, streak, crisis, hype, pressure, momentum, confidence, mood, trust };
}

async function standingsConsequences(
  store: Store,
  club: Club,
  league: League,
  result: number,
  margin: number,
) {
  if (league.kind !== "league" || league.age_group !== "Senior") return;
  const state = await stateOf(store);
  const settings = await settingsOf(store);
  const table = await store.all<Standing>(
    "SELECT * FROM standings WHERE league_id = ? ORDER BY points DESC, (gf-ga) DESC, gf DESC, club_id",
    league.id,
  );
  const outcome = standingOutcome(club, table, settings, result, margin);
  if (!outcome) return;
  const { position, streak, crisis, hype, pressure, momentum, confidence, mood, trust } = outcome;
  await store.run(
    "UPDATE clubs SET momentum = ?, crisis = ?, hype = ?, board_pressure = ?, board_confidence = ?, fan_mood = ?, manager_trust = ?, reputation = LEAST(99,GREATEST(1,reputation + ?)) WHERE id = ?",
    momentum,
    crisis,
    hype,
    pressure,
    confidence,
    mood,
    trust,
    result * 0.035,
    club.id,
  );
  await store.run(
    "UPDATE players SET morale = LEAST(99,GREATEST(1,morale + ?)), value = value * ? WHERE club_id = ?",
    result * 2 - crisis / 100,
    1 + hype / 20000 - crisis / 18000,
    club.id,
  );
  if (club.id === state.clubId) {
    if (crisis >= 55 && club.crisis < 55)
      await news(
        store,
        "Board",
        "An urgent board meeting",
        `The club is ${position}${position === 1 ? "st" : position === 2 ? "nd" : position === 3 ? "rd" : "th"} in the table. The board wants a recovery plan, and agents are questioning the squad's direction.`,
        "warning",
        "board",
      );
    if (crisis >= 75 && club.crisis < 75)
      await news(
        store,
        "Fans",
        "Supporters demand a response",
        "Organised supporters are planning a protest. Media criticism, transfer requests and pressure on the manager are intensifying.",
        "warning",
        "media",
      );
    if (hype >= 60 && club.hype < 60)
      await news(
        store,
        "Fans",
        "Belief is building",
        "The winning run has lifted expectations. Targets are more interested, but market prices and the pressure to sustain results are rising.",
        "success",
        "competitions",
      );
  }
  if (streak === "LLLL") {
    await store.run(
      "UPDATE clubs SET tactical_style = CASE tactical_style WHEN 'High press' THEN 'Counter attack' ELSE 'Balanced' END, chemistry = GREATEST(0,chemistry - 3) WHERE id = ?",
      club.id,
    );
    if (club.id === state.clubId)
      await news(
        store,
        "Squad",
        "The manager changes approach",
        `${club.manager} has adjusted the tactical approach after four consecutive defeats. The squad needs time to adapt.`,
        "important",
        "squad",
      );
  }
}

export async function playFixture(store: Store, fixture: Fixture) {
  return store.transaction(async () => {
    if (
      fixture.status !== "scheduled" ||
      (
        await store.get<Fixture>(
          "SELECT * FROM fixtures WHERE id = ?",
          fixture.id,
        )
      )?.status !== "scheduled"
    )
      return;
    const state = await stateOf(store);
    const settings = await settingsOf(store);
    const homeClub = await clubOf(store, fixture.home_id);
    const awayClub = await clubOf(store, fixture.away_id);
    const league = fixture.league_id
      ? await store.get<League>(
          "SELECT * FROM leagues WHERE id = ?",
          fixture.league_id,
        )
      : undefined;
    const ageGroup = league?.age_group ?? "Senior";
    const random = seedrandom(`${fixture.seed}:conditions`);
    const country = (await store.get<Country>(
      "SELECT * FROM countries WHERE id = ?",
      homeClub.country_id,
    ))!;
    const latitude =
      nationByCode(country.code)?.latitude ??
      { EU: 48, AS: 28, AF: 8, NA: 25, SA: -15, OC: -18 }[country.continent] ??
      15;
    const month = Number(state.date.slice(5, 7));
    const seasonal =
      Math.cos(((month - 7) / 12) * Math.PI * 2) * Math.sign(latitude);
    const conditions = {
      temperature: round(
        29 -
          Math.abs(latitude) * 0.27 +
          seasonal * Math.min(12, Math.abs(latitude) * 0.23) +
          (random() - 0.5) * 9,
      ),
      wind: round(3 + random() * 32),
      humidity: Math.round(45 + random() * 48),
    };
    const weather = settings.weather
      ? conditions.temperature >= 29
        ? "Heat"
        : conditions.humidity > 80
          ? "Heavy rain"
          : conditions.wind > 25
            ? "Wind"
            : "Clear"
      : "Clear";
    const fixtureDetails = JSON.parse(fixture.data);
    const tie = fixtureDetails.tie as KnockoutTie | undefined;
    const knockout = isKnockoutStage(fixture.stage);
    const leagueCountry =
      league?.kind === "league" && league.age_group === "Senior" && league.country_id !== null
        ? league.country_id === country.id
          ? country
          : await store.get<Country>("SELECT * FROM countries WHERE id = ?", league.country_id)
        : undefined;
    const competitionRules =
      tie ?? knockoutRules(league?.name ?? "Friendly", fixture.stage);
    const previousLegs =
      tie?.leg === 2
        ? await store.all<Fixture>(
            "SELECT * FROM fixtures WHERE league_id = ? AND season = ? AND JSON_VALUE(data,'$.tie.id') = ? AND status = 'played'",
            fixture.league_id,
            fixture.season,
            tie.id,
          )
        : [];
    if (tie?.leg === 2 && previousLegs.length !== 1)
      throw new Error(
        "The first leg must be completed before the return fixture.",
      );
    const aggregate = aggregateScore(previousLegs, fixture.home_id);
    const snapshot: MatchSnapshot = {
      rulesVersion: MATCH_RULES_VERSION,
      goalFactor: leagueCountry ? matchGoalFactor(leagueCountry.code, league!.tier) : 1,
      home: await matchTeam(store, homeClub, ageGroup, state.date, league, fixture),
      away: await matchTeam(store, awayClub, ageGroup, state.date, league, fixture),
      weather,
      conditions: settings.weather ? conditions : undefined,
      importance:
        fixture.stage === "Final" ? 100 : league?.kind === "league" ? 65 : 78,
      detail: String(settings.matchDetail),
      rules: {
        decisive: knockout && (!tie || tie.legs === 1 || tie.leg === 2),
        extraTime: competitionRules.extraTime,
        neutral: competitionRules.neutral,
        awayGoals: competitionRules.awayGoals,
        substitutions: 5,
        substitutionWindows: 3,
        extraSubstitution: true,
        aggregate,
        injuryFrequency: Number(settings.injuryFrequency),
      },
    };
    const detailedMatch = [fixture.home_id, fixture.away_id, homeClub.parent_id, awayClub.parent_id].includes(state.clubId);
    // Only fixtures of the user's club family pay for the full engine.
    const result = simulateFixture(snapshot, fixture.seed, detailedMatch);
    const winnerId = result.abandoned
      ? result.abandoned.teamId === fixture.home_id
        ? fixture.away_id
        : fixture.home_id
      : result.winnerId;
    const penalties = result.shootout
      ? { home: result.shootout.home, away: result.shootout.away }
      : null;
    const awarded = result.abandoned
      ? {
          home: result.abandoned.teamId === fixture.home_id ? 0 : 3,
          away: result.abandoned.teamId === fixture.away_id ? 0 : 3,
          reason: result.abandoned.reason,
        }
      : null;
    const officialResult = awarded
      ? { ...result, homeGoals: awarded.home, awayGoals: awarded.away }
      : result;
    const payload = {
      ...fixtureDetails,
      snapshot,
      stats: result.stats,
      players: result.players,
      momentum: result.momentum,
      events: result.events,
      winnerId,
      penalties,
      awarded,
      regulationScore: result.regulationScore,
      wentToExtraTime: result.wentToExtraTime,
      duration: result.duration,
      shootout: result.shootout,
      substitutions: result.substitutions,
      injuries: result.injuries,
      aggregate: tie
        ? {
            home: result.homeGoals + aggregate.home,
            away: result.awayGoals + aggregate.away,
          }
        : undefined,
    };
    const saved = await store.run(
      "UPDATE fixtures SET status = 'played', home_goals = ?, away_goals = ?, home_xg = ?, away_xg = ?, data = ? WHERE id = ? AND status = 'scheduled'",
      officialResult.homeGoals,
      officialResult.awayGoals,
      result.homeXg,
      result.awayXg,
      storedMatchData(payload, detailedMatch),
      fixture.id,
    );
    if (!saved.changes) return;
    await updateTable(store, fixture, officialResult);
    const appearances: Record<string, string | number | null>[] = [];
    const playerUpdates: Record<string, string | number | null>[] = [];
    const history: Record<string, string | number>[] = [];
    const managedMatch = [fixture.home_id, fixture.away_id].includes(
      state.clubId,
    );
    const participantIds = Object.keys(result.players).map(Number);
    // Every active loan needs appearance history for loan reviews; only the user's loans keep full detail.
    const loanedPlayers = new Map(
      (!managedMatch && participantIds.length
        ? await store.all<{ player_id: number; followed: number }>(
            `SELECT loans.player_id, CASE WHEN ? IN (loans.parent_id, parent.parent_id) THEN 1 ELSE 0 END AS followed FROM loans JOIN clubs AS parent ON parent.id = loans.parent_id WHERE loans.status = 'active' AND loans.player_id IN (${participantIds.map(() => "?").join(",")})`,
            state.clubId,
            ...participantIds,
          )
        : []
      ).map((loan) => [loan.player_id, Boolean(loan.followed)]),
    );
    for (const team of [snapshot.home, snapshot.away]) {
      for (const player of [...team.lineup, ...(team.bench ?? [])]) {
        const stats = result.players[player.id];
        if (!stats?.minutes) continue;
        const on = result.substitutions?.find(
          (change) => change.onId === player.id,
        );
        const off = result.substitutions?.find(
          (change) => change.offId === player.id,
        );
        const exit = result.events.find(
          (event) =>
            event.playerId === player.id &&
            ["red card", "injury"].includes(event.type),
        );
        appearances.push({
          fixture_id: fixture.id,
          player_id: player.id,
          club_id: team.id,
          season: fixture.season,
          date: fixture.date,
          position: player.position,
          started: team.lineup.some((starter) => starter.id === player.id)
            ? 1
            : 0,
          minutes: stats.minutes,
          minute_on: on?.minute ?? 0,
          minute_off: off?.minute ?? exit?.minute ?? null,
          rating: stats.rating,
          goals: stats.goals,
          assists: stats.assists,
          stats: storedAppearanceStats(stats, detailedMatch || loanedPlayers.get(player.id) === true),
        });
        playerUpdates.push({
          id: player.id,
          minutes: stats.minutes,
          goals: stats.goals,
          assists: stats.assists,
          form: round(stats.rating),
          fatigue:
            ((team.style === "High press" ? 20 : 15) * stats.minutes) / 90,
          potential_bank: matchPerformance(stats.rating, stats.minutes),
        });
        if (managedMatch || loanedPlayers.has(player.id))
          history.push({
            season: state.season,
            entity_type: "appearance",
            entity_id: player.id,
            date: state.date,
            data: JSON.stringify({
              ...(managedMatch || loanedPlayers.get(player.id)
                ? stats
                : { minutes: stats.minutes, rating: stats.rating, goals: stats.goals, assists: stats.assists }),
              fixtureId: fixture.id,
              position: player.position,
              clubId: team.id,
            }),
          });
      }
    }
    if (appearances.length)
      await store.run(
        `INSERT INTO player_match_appearances(fixture_id,player_id,club_id,season,date,position,started,minutes,minute_on,minute_off,rating,goals,assists,stats)
     SELECT source.fixture_id,source.player_id,source.club_id,source.season,source.date,source.position,source.started,source.minutes,source.minute_on,source.minute_off,source.rating,source.goals,source.assists,source.stats
     FROM OPENJSON(?) WITH (fixture_id int,player_id int,club_id int,season int,date nvarchar(10),position nvarchar(10),started int,minutes int,minute_on int,minute_off int,rating float,goals int,assists int,stats nvarchar(max)) AS source
     WHERE NOT EXISTS (SELECT 1 FROM player_match_appearances WITH (UPDLOCK,HOLDLOCK) WHERE fixture_id = source.fixture_id AND player_id = source.player_id)`,
        JSON.stringify(appearances),
      );
    await updateSimulationRows(
      store,
      "players",
      playerUpdates,
      "id int,minutes int,goals int,assists int,form float,fatigue float,potential_bank float",
      "appearances = target.appearances + 1, minutes = target.minutes + changes.minutes, goals = target.goals + changes.goals, assists = target.assists + changes.assists, form = changes.form, fitness = GREATEST(25,target.fitness - changes.fatigue), potential_bank = target.potential_bank + changes.potential_bank",
    );
    if (history.length) {
      const lastId = (await store.get<{ id: number }>(
        "SELECT coalesce(max(id),0) AS id FROM history WITH (UPDLOCK,HOLDLOCK)",
      ))!.id;
      await store.bulkInsert(
        "history",
        history.map((row, index) => ({ id: lastId + index + 1, ...row })),
      );
    }
    await disciplinaryConsequences(store, fixture, league, result, snapshot);
    if (league) {
      await standingsConsequences(
        store,
        homeClub,
        league,
        Math.sign(result.homeGoals - result.awayGoals),
        result.homeGoals - result.awayGoals,
      );
      await standingsConsequences(
        store,
        awayClub,
        league,
        Math.sign(result.awayGoals - result.homeGoals),
        result.awayGoals - result.homeGoals,
      );
    }
    if ([fixture.home_id, fixture.away_id].includes(state.clubId)) {
      const home = fixture.home_id === state.clubId;
      const difference = home
        ? result.homeGoals - result.awayGoals
        : result.awayGoals - result.homeGoals;
      await news(
        store,
        "Match",
        `${homeClub.name} ${result.homeGoals} - ${result.awayGoals} ${awayClub.name}`,
        `${league?.name ?? "Pre-season friendly"}${ageGroup !== "Senior" ? ` (${ageGroup})` : ""}. Expected goals: ${result.homeXg.toFixed(2)} - ${result.awayXg.toFixed(2)}.${penalties ? ` Penalties: ${penalties.home} - ${penalties.away}.` : ""} The analyst's report is ready.`,
        difference > 0 ? "success" : difference < 0 ? "warning" : "info",
        "analytics",
        { fixtureId: fixture.id },
      );
      await experience(
        store,
        3,
        difference > 0 && league?.kind === "league" ? 0.06 : 0,
      );
    }
  });
}

interface BatchCandidate {
  k: number;
  id: number;
  name: string;
  position: Position;
  secondary_position: Position | null;
  ability: number;
  fitness: number;
}

/** Whether a result counts in the competition's table: league, league-phase and group matches, not knockout ties. */
function tableFixture(fixture: Pick<Fixture, "stage" | "data">) {
  return !isKnockoutStage(fixture.stage) && !/knockout/i.test(fixture.stage) && !fixture.data.includes('"tie":');
}

/** Development signal of one appearance (players.potential_bank): the rating against an average match, by involvement. */
export const matchPerformance = (rating: number, minutes: number) =>
  round((rating - 6.55) * Math.min(1, minutes / 90), 3);

async function writeChunks<Row>(
  rows: Row[],
  size: number,
  write: (json: string) => Promise<unknown>,
) {
  for (let offset = 0; offset < rows.length; offset += size)
    await write(JSON.stringify(rows.slice(offset, offset + size)));
}

/**
 * Lineup-only call-ups for fast-model sides (nothing persisted): a side short of a matchday squad, or passing its
 * pre-rolled merit chance (higher in the league's last rounds), sees the best fit players of the team below.
 * Extra reads: one covered max(round) per batch and one TOP (8) lookup per selected side.
 */
async function addBatchCallUps(
  store: Store,
  state: Awaited<ReturnType<typeof stateOf>>,
  batch: Fixture[],
  clubs: Map<number, Club>,
  leagues: Map<number, League>,
  sides: { k: number; scope: string; cutoff: string }[],
  candidates: Map<number, BatchCandidate[]>,
  onDuty: ReadonlySet<number>,
) {
  const leagueIds = [...new Set(batch.map((fixture) => fixture.league_id!))].filter((id) =>
    ["league", "youth"].includes(leagues.get(id)?.kind ?? ""),
  );
  const lastRound = new Map<number, number>();
  if (leagueIds.length)
    for (const row of await store.all<{ league_id: number; last: number }>(
      "SELECT league_id,max(round) AS last FROM fixtures WHERE season = ? AND league_id IN (SELECT [id] FROM OPENJSON(?) WITH ([id] INT '$')) GROUP BY league_id",
      state.season,
      JSON.stringify(leagueIds),
    ))
      lastRound.set(row.league_id, row.last);
  const selected: { k: number; owner: number; club_id: number; age_group: string; scope: string; cutoff: string; level: TargetLevel; roll: number; late: boolean; tier: number }[] = [];
  batch.forEach((fixture, index) => {
    const league = leagues.get(fixture.league_id!)!;
    const last = lastRound.get(league.id);
    const late = last !== undefined && last - fixture.round < CALL_UP_RULES.ai.lateRounds;
    [fixture.home_id, fixture.away_id].forEach((clubId, side) => {
      const club = clubs.get(clubId)!;
      const level = levelOf(club, league.age_group);
      if (!level) return;
      const k = index * 2 + side;
      const roll = seedrandom(`${fixture.seed}:callup:${side}`)();
      if (!aiNeedsLower(candidates.get(k) ?? []) && roll >= aiMeritChance(level, late, league.tier)) return;
      const lower = lowerTeam(club, level);
      if (lower)
        selected.push({ k, owner: clubId, club_id: lower.clubId, age_group: lower.ageGroup, scope: sides[k].scope, cutoff: sides[k].cutoff, level, roll, late, tier: league.tier });
    });
  });
  if (!selected.length) return;
  const codes = new Map(
    (await store.all<{ id: number; code: string }>("SELECT id,code FROM countries")).map((row) => [row.id, row.code]),
  );
  const lower = new Map<number, (BatchCandidate & { age: number })[]>();
  await writeChunks(selected, 1000, async (json) => {
    for (const row of await store.all<BatchCandidate & { age: number }>(
      `SELECT side.k, pick.id, pick.name, pick.position, pick.secondary_position, pick.ability, pick.fitness, pick.age
       FROM OPENJSON(?) WITH (k int, club_id int, age_group nvarchar(10), scope nvarchar(100), cutoff nvarchar(10)) AS side
       CROSS APPLY (SELECT TOP (8) players.id, players.name, players.position, players.secondary_position, players.ability, players.fitness, players.age FROM players
         WHERE players.playing_club_id = side.club_id AND players.age_group = side.age_group AND players.birth_date >= side.cutoff AND players.role != 'Retired' AND players.fitness >= ? AND (players.injury_until IS NULL OR players.injury_until <= ?)
         AND NOT EXISTS(SELECT 1 FROM discipline WHERE discipline.player_id = players.id AND discipline.scope = side.scope AND discipline.suspension > 0)
         AND NOT EXISTS(SELECT 1 FROM player_match_appearances WHERE player_match_appearances.player_id = players.id AND player_match_appearances.date >= ? AND player_match_appearances.minutes > 0)
         ORDER BY players.ability DESC, players.id) AS pick`,
      json,
      CALL_UP_RULES.minFitness,
      state.date,
      restCutoff(state.date),
    ))
      lower.set(row.k, [...(lower.get(row.k) ?? []), row]);
  });
  for (const side of selected) {
    const pool = candidates.get(side.k) ?? [];
    const rows = (lower.get(side.k) ?? []).filter((row) => !pool.some((entry) => entry.id === row.id) && !onDuty.has(row.id));
    const ids = aiLineupCallUps({
      level: side.level,
      pool,
      lower: rows,
      lateSeason: side.late,
      roll: side.roll,
      minAge: minSeniorAge(codes.get(clubs.get(side.owner)!.country_id)),
      tier: side.tier,
    });
    if (!ids.length) continue;
    // Called-up players slot in by selection score; the pool keeps its own order.
    const score = (row: BatchCandidate) => row.ability + row.fitness * 0.3;
    const merged = [...pool];
    for (const extra of rows.filter((row) => ids.includes(row.id))) {
      const at = merged.findIndex((row) => score(row) < score(extra));
      merged.splice(at < 0 ? merged.length : at, 0, extra);
    }
    candidates.set(side.k, merged);
  }
}

/**
 * Plays fixtures outside the user's club family with the fast result model and set-based
 * statements. Returns the fixtures it cannot handle (two-leg ties, national teams, friendlies).
 */
export async function playFixtureBatch(store: Store, fixtures: Fixture[]) {
  if (!fixtures.length) return [];
  const state = await stateOf(store);
  const settings = await settingsOf(store);
  const idList = (values: (number | null)[]) =>
    JSON.stringify([...new Set(values.filter((value) => value !== null))]);
  const inList = "IN (SELECT [id] FROM OPENJSON(?) WITH ([id] INT '$'))";
  const clubs = new Map(
    (
      await store.all<Club>(
        `SELECT * FROM clubs WHERE id ${inList}`,
        idList(fixtures.flatMap((fixture) => [fixture.home_id, fixture.away_id])),
      )
    ).map((club) => [club.id, club]),
  );
  const leagues = new Map(
    (
      await store.all<League>(
        `SELECT * FROM leagues WHERE id ${inList}`,
        idList(fixtures.map((fixture) => fixture.league_id)),
      )
    ).map((league) => [league.id, league]),
  );
  const leftover: Fixture[] = [];
  const squads = new Set<string>();
  // National teams join the batch once their squads are named (processInternationalDuty runs first each day).
  const named = new Map<string, NationalDutyRecord>();
  for (const fixture of fixtures)
    for (const id of [fixture.home_id, fixture.away_id])
      if (clubs.get(id)?.type === "national") {
        const record = await dutySquad(store, id, fixture.league_id, state.date);
        if (record?.leagueId === fixture.league_id) named.set(`${id}:${fixture.league_id}`, record);
      }
  const onDuty = await playersOnDuty(store, state.date);
  const batch = fixtures.filter((fixture) => {
    const league = fixture.league_id === null ? undefined : leagues.get(fixture.league_id);
    // One fixture per squad per batch keeps table and squad updates order-free.
    const keys = [fixture.home_id, fixture.away_id].map((id) => `${id}:${league?.age_group}`);
    const handled =
      league !== undefined &&
      !JSON.parse(fixture.data).tie &&
      keys.every((key) => !squads.has(key)) &&
      [fixture.home_id, fixture.away_id].every(
        (id) => clubs.has(id) && (clubs.get(id)!.type !== "national" || named.has(`${id}:${fixture.league_id}`)),
      );
    if (handled) for (const key of keys) squads.add(key);
    else leftover.push(fixture);
    return handled;
  });
  const sides = batch.flatMap((fixture, index) => {
    const league = leagues.get(fixture.league_id!)!;
    const limit = AGE_LIMITS[league.age_group] ?? 100;
    const year = Number((limit < 100 ? String(state.season) : state.date).slice(0, 4));
    return [fixture.home_id, fixture.away_id].map((clubId, side) => ({
      k: index * 2 + side,
      club_id: clubId,
      age_group: league.age_group,
      scope: disciplineScope(league),
      cutoff: `${year - limit + 1}-01-01`,
      squad: named.get(`${clubId}:${fixture.league_id}`)?.players,
    }));
  });
  const candidates = new Map<number, BatchCandidate[]>();
  // Players away with national teams are dropped from club sides; a few extra rows keep the squad full.
  const clubTop = onDuty.size ? 34 : 26;
  await writeChunks(sides.filter((side) => !side.squad), 1000, async (json) => {
    for (const row of await store.all<BatchCandidate>(
      `SELECT side.k, pick.id, pick.name, pick.position, pick.secondary_position, pick.ability, pick.fitness
       FROM OPENJSON(?) WITH (k int, club_id int, age_group nvarchar(10), scope nvarchar(100), cutoff nvarchar(10)) AS side
       CROSS APPLY (SELECT TOP (${clubTop}) players.id, players.name, players.position, players.secondary_position, players.ability, players.fitness FROM players
         WHERE players.playing_club_id = side.club_id AND players.age_group = side.age_group AND players.birth_date >= side.cutoff AND players.role != 'Retired' AND (players.injury_until IS NULL OR players.injury_until <= ?)
         AND NOT EXISTS(SELECT 1 FROM discipline WHERE discipline.player_id = players.id AND discipline.scope = side.scope AND discipline.suspension > 0)
         AND NOT EXISTS(SELECT 1 FROM player_match_appearances WHERE player_match_appearances.player_id = players.id AND player_match_appearances.date = ? AND player_match_appearances.minutes > 0)
         ORDER BY players.ability + players.fitness * 0.3 + CASE players.role WHEN 'Key player' THEN 5 WHEN 'Captain' THEN 6 WHEN 'Regular starter' THEN 3 ELSE 0 END + coalesce((SELECT TRY_CONVERT(float,JSON_VALUE(loans.terms,'$.playingTime')) / 15.0 FROM loans WHERE loans.player_id = players.id AND loans.status = 'active'),0) DESC) AS pick`,
      json,
      state.date,
      state.date,
    ))
      if (!onDuty.has(row.id) && (candidates.get(row.k)?.length ?? 0) < 26)
        candidates.set(row.k, [...(candidates.get(row.k) ?? []), row]);
  });
  await writeChunks(
    sides.filter((side) => side.squad).map((side) => ({ k: side.k, scope: side.scope, squad: side.squad })),
    500,
    async (json) => {
      for (const row of await store.all<BatchCandidate>(
        `SELECT side.k, pick.id, pick.name, pick.position, pick.secondary_position, pick.ability, pick.fitness
         FROM OPENJSON(?) WITH (k int, scope nvarchar(100), squad nvarchar(max) AS JSON) AS side
         CROSS APPLY (SELECT TOP (26) players.id, players.name, players.position, players.secondary_position, players.ability, players.fitness
           FROM OPENJSON(side.squad) WITH ([id] INT '$') AS member JOIN players ON players.id = member.[id]
           WHERE players.role != 'Retired' AND (players.injury_until IS NULL OR players.injury_until <= ?)
           AND NOT EXISTS(SELECT 1 FROM discipline WHERE discipline.player_id = players.id AND discipline.scope = side.scope AND discipline.suspension > 0)
           AND NOT EXISTS(SELECT 1 FROM player_match_appearances WHERE player_match_appearances.player_id = players.id AND player_match_appearances.date = ? AND player_match_appearances.minutes > 0)
           ORDER BY players.ability + players.fitness * 0.3 DESC, players.id) AS pick`,
        json,
        state.date,
        state.date,
      ))
        candidates.set(row.k, [...(candidates.get(row.k) ?? []), row]);
    },
  );
  await addBatchCallUps(store, state, batch, clubs, leagues, sides, candidates, onDuty);
  const used = new Set<number>();
  const team = (club: Club, rows: BatchCandidate[]): MatchTeam => {
    const pool = rows.filter((row) => !used.has(row.id));
    const player = (row: BatchCandidate, position = row.position): MatchPlayer => ({
      id: row.id,
      name: row.name,
      position,
      ability: round(
        row.ability *
          (row.position === position ? 1 : row.secondary_position === position ? 0.94 : 0.8),
      ),
      fitness: row.fitness,
      confidence: 65,
    });
    const lineup: MatchPlayer[] = [];
    for (const position of formations[club.formation] ?? formations["4-3-3"]) {
      const available = pool.filter((row) => !lineup.some((selected) => selected.id === row.id));
      const pick =
        available.find((row) => row.position === position) ??
        available.find((row) => row.secondary_position === position) ??
        available.find((row) => position === "GK" || row.position !== "GK") ??
        available[0];
      if (pick) lineup.push(player(pick, position));
    }
    const remaining = pool.filter((row) => !lineup.some((selected) => selected.id === row.id));
    const keeper = remaining.find((row) => row.position === "GK");
    const bench = [...(keeper ? [keeper] : []), ...remaining.filter((row) => row.id !== keeper?.id)]
      .slice(0, 12)
      .map((row) => player(row));
    for (const selected of [...lineup, ...bench]) used.add(selected.id);
    return {
      id: club.id,
      name: club.name,
      color: club.color,
      ability: lineup.length ? lineup.reduce((sum, entry) => sum + entry.ability, 0) / lineup.length : 20,
      style: club.tactical_style,
      formation: club.formation,
      chemistry: club.chemistry,
      momentum: club.momentum,
      pressure: club.board_pressure,
      lineup,
      bench,
      setPieces: { routine: "Near post", target: "Centre-back", risk: 50 },
    };
  };
  const leagueCountryIds = [...leagues.values()]
    .filter((league) => league.kind === "league" && league.age_group === "Senior")
    .map((league) => league.country_id);
  const countryCodes = new Map(
    leagueCountryIds.length
      ? (
          await store.all<{ id: number; code: string }>(
            `SELECT id, code FROM countries WHERE id ${inList}`,
            idList(leagueCountryIds),
          )
        ).map((country) => [country.id, country.code])
      : [],
  );
  const goalFactor = (league: League) =>
    league.kind === "league" && league.age_group === "Senior" && league.country_id !== null
      ? matchGoalFactor(countryCodes.get(league.country_id), league.tier)
      : 1;
  const matches = batch.map((fixture, index) => {
    const league = leagues.get(fixture.league_id!)!;
    const rules = knockoutRules(league.name, fixture.stage);
    const snapshot: MatchSnapshot = {
      rulesVersion: MATCH_RULES_VERSION,
      goalFactor: goalFactor(league),
      home: team(clubs.get(fixture.home_id)!, candidates.get(index * 2) ?? []),
      away: team(clubs.get(fixture.away_id)!, candidates.get(index * 2 + 1) ?? []),
      weather: "Clear",
      importance: fixture.stage === "Final" ? 100 : league.kind === "league" ? 65 : 78,
      detail: String(settings.matchDetail),
      rules: {
        decisive: isKnockoutStage(fixture.stage),
        extraTime: rules.extraTime,
        neutral: rules.neutral,
        awayGoals: rules.awayGoals,
        substitutions: 5,
        substitutionWindows: 3,
        extraSubstitution: true,
        aggregate: { home: 0, away: 0, homeAwayGoals: 0, awayAwayGoals: 0 },
        injuryFrequency: Number(settings.injuryFrequency),
      },
    };
    return {
      fixture,
      league,
      snapshot,
      scopes: [fixture.home_id, fixture.away_id].map(() => disciplineScope(league)),
      nations: [fixture.home_id, fixture.away_id].map((id) =>
        clubs.get(id)!.type === "national" ? clubs.get(id)!.country_id : null,
      ),
      result: simulateFastMatch(snapshot, fixture.seed),
    };
  });
  await writeMatchBatch(store, state, settings, matches);
  return leftover;
}

interface BatchMatch {
  fixture: Fixture;
  league: League;
  snapshot: MatchSnapshot;
  scopes: string[];
  /** Country of a national side (its suspensions are served by nationality), else null. */
  nations?: (number | null)[];
  result: MatchResult;
}

async function writeMatchBatch(
  store: Store,
  state: Awaited<ReturnType<typeof stateOf>>,
  settings: Awaited<ReturnType<typeof settingsOf>>,
  matches: BatchMatch[],
) {
  if (!matches.length) return;
  const participantIds = matches.flatMap(({ result }) =>
    Object.entries(result.players)
      .filter(([, stats]) => stats.minutes > 0)
      .map(([id]) => Number(id)),
  );
  const loanedPlayers = new Map(
    (participantIds.length
      ? await store.all<{ player_id: number; followed: number }>(
          "SELECT loans.player_id, CASE WHEN ? IN (loans.parent_id, parent.parent_id) THEN 1 ELSE 0 END AS followed FROM loans JOIN clubs AS parent ON parent.id = loans.parent_id WHERE loans.status = 'active' AND loans.player_id IN (SELECT [id] FROM OPENJSON(?) WITH ([id] INT '$'))",
          state.clubId,
          JSON.stringify(participantIds),
        )
      : []
    ).map((loan) => [loan.player_id, Boolean(loan.followed)]),
  );
  const fixtureRows: Record<string, string | number>[] = [];
  const tableRows = new Map<string, { league_id: number; club_id: number; own: number; against: number; xg: number; xga: number; xpts: number; home: boolean }>();
  const appearances: Record<string, string | number | null>[] = [];
  const playerUpdates: Record<string, string | number | null>[] = [];
  const history: Record<string, string | number>[] = [];
  const disciplineTeams: { club_id: number; scope: string; country_id: number; national: number; age_group: string }[] = [];
  const participants: { player: MatchPlayer; stats: Record<string, number>; team: MatchTeam; match: BatchMatch; scope: string }[] = [];
  const injuries: { id: number; until: string }[] = [];
  const senior: { club_id: number; league_id: number; result: number; margin: number }[] = [];
  for (const match of matches) {
    const { fixture, league, snapshot, result } = match;
    const awarded = result.abandoned
      ? {
          home: result.abandoned.teamId === fixture.home_id ? 0 : 3,
          away: result.abandoned.teamId === fixture.away_id ? 0 : 3,
          reason: result.abandoned.reason,
        }
      : null;
    const homeGoals = awarded ? awarded.home : result.homeGoals;
    const awayGoals = awarded ? awarded.away : result.awayGoals;
    fixtureRows.push({
      id: fixture.id,
      home_goals: homeGoals,
      away_goals: awayGoals,
      home_xg: result.homeXg,
      away_xg: result.awayXg,
      data: storedMatchData(
        {
          ...JSON.parse(fixture.data),
          snapshot,
          players: result.players,
          events: result.events,
          winnerId: result.abandoned
            ? result.abandoned.teamId === fixture.home_id
              ? fixture.away_id
              : fixture.home_id
            : result.winnerId,
          penalties: result.shootout
            ? { home: result.shootout.home, away: result.shootout.away }
            : null,
          awarded,
          regulationScore: result.regulationScore,
          wentToExtraTime: result.wentToExtraTime,
          shootout: result.shootout,
          duration: result.duration,
        },
        false,
      ),
    });
    if (tableFixture(fixture))
      for (const home of [true, false])
        tableRows.set(`${fixture.league_id}:${home ? fixture.home_id : fixture.away_id}`, {
          league_id: fixture.league_id!,
          club_id: home ? fixture.home_id : fixture.away_id,
          own: home ? homeGoals : awayGoals,
          against: home ? awayGoals : homeGoals,
          xg: home ? result.homeXg : result.awayXg,
          xga: home ? result.awayXg : result.homeXg,
          xpts: home ? result.homeXpts : result.awayXpts,
          home,
        });
    if (league.kind === "league" && league.age_group === "Senior")
      for (const home of [true, false]) {
        const margin = home ? result.homeGoals - result.awayGoals : result.awayGoals - result.homeGoals;
        senior.push({ club_id: home ? fixture.home_id : fixture.away_id, league_id: league.id, result: Math.sign(margin), margin });
      }
    for (const injury of result.injuries ?? [])
      injuries.push({ id: injury.playerId, until: addDays(fixture.date, injury.days) });
    for (const team of [snapshot.home, snapshot.away]) {
      const scope = match.scopes[team.id === fixture.home_id ? 0 : 1];
      const nation = match.nations?.[team.id === fixture.home_id ? 0 : 1] ?? null;
      disciplineTeams.push({ club_id: team.id, scope, country_id: nation ?? 0, national: nation === null ? 0 : 1, age_group: league.age_group });
      for (const player of [...team.lineup, ...(team.bench ?? [])]) {
        const stats = result.players[player.id];
        if (!stats?.minutes) continue;
        participants.push({ player, stats, team, match, scope });
        const on = result.substitutions?.find((change) => change.onId === player.id);
        const off = result.substitutions?.find((change) => change.offId === player.id);
        const exit = result.events.find(
          (event) => event.playerId === player.id && ["red card", "injury"].includes(event.type),
        );
        const followed = loanedPlayers.get(player.id) === true;
        appearances.push({
          fixture_id: fixture.id,
          player_id: player.id,
          club_id: team.id,
          season: fixture.season,
          date: fixture.date,
          position: player.position,
          started: team.lineup.some((starter) => starter.id === player.id) ? 1 : 0,
          minutes: stats.minutes,
          minute_on: on?.minute ?? 0,
          minute_off: off?.minute ?? exit?.minute ?? null,
          rating: stats.rating,
          goals: stats.goals,
          assists: stats.assists,
          stats: storedAppearanceStats(stats, followed),
        });
        playerUpdates.push({
          id: player.id,
          minutes: stats.minutes,
          goals: stats.goals,
          assists: stats.assists,
          form: round(stats.rating),
          fatigue: ((team.style === "High press" ? 20 : 15) * stats.minutes) / 90,
          potential_bank: matchPerformance(stats.rating, stats.minutes),
        });
        if (loanedPlayers.has(player.id))
          history.push({
            season: state.season,
            entity_type: "appearance",
            entity_id: player.id,
            date: state.date,
            data: JSON.stringify({
              ...(followed
                ? stats
                : { minutes: stats.minutes, rating: stats.rating, goals: stats.goals, assists: stats.assists }),
              fixtureId: fixture.id,
              position: player.position,
              clubId: team.id,
            }),
          });
      }
    }
  }
  await writeChunks(fixtureRows, 500, (json) =>
    store.run(
      "UPDATE target SET status = 'played', home_goals = changes.home_goals, away_goals = changes.away_goals, home_xg = changes.home_xg, away_xg = changes.away_xg, data = changes.data FROM fixtures AS target JOIN OPENJSON(?) WITH (id int, home_goals int, away_goals int, home_xg float, away_xg float, data nvarchar(max)) AS changes ON changes.id = target.id WHERE target.status = 'scheduled'",
      json,
    ),
  );
  const pairs = [...tableRows.values()];
  const current = new Map<string, Standing>();
  await writeChunks(
    pairs.map(({ league_id, club_id }) => ({ league_id, club_id })),
    2000,
    async (json) => {
      for (const row of await store.all<Standing>(
        "SELECT standings.* FROM standings JOIN OPENJSON(?) WITH (league_id int, club_id int) AS pair ON pair.league_id = standings.league_id AND pair.club_id = standings.club_id",
        json,
      ))
        current.set(`${row.league_id}:${row.club_id}`, row);
    },
  );
  const standingRows = pairs.flatMap((pair) => {
    const entry = current.get(`${pair.league_id}:${pair.club_id}`);
    if (!entry) return [];
    const outcome = pair.own > pair.against ? "W" : pair.own < pair.against ? "L" : "D";
    const record = (pair.home ? entry.home_record : entry.away_record).split("-").map(Number);
    record[outcome === "W" ? 0 : outcome === "D" ? 1 : 2]++;
    return [
      {
        league_id: pair.league_id,
        club_id: pair.club_id,
        wins: outcome === "W" ? 1 : 0,
        draws: outcome === "D" ? 1 : 0,
        losses: outcome === "L" ? 1 : 0,
        gf: pair.own,
        ga: pair.against,
        points: outcome === "W" ? 3 : outcome === "D" ? 1 : 0,
        xg: pair.xg,
        xga: pair.xga,
        xpts: pair.xpts,
        form: (entry.form + outcome).slice(-5),
        home_record: pair.home ? record.join("-") : entry.home_record,
        away_record: pair.home ? entry.away_record : record.join("-"),
      },
    ];
  });
  await writeChunks(standingRows, 2000, (json) =>
    store.run(
      "UPDATE target SET played = target.played + 1, wins = target.wins + changes.wins, draws = target.draws + changes.draws, losses = target.losses + changes.losses, gf = target.gf + changes.gf, ga = target.ga + changes.ga, points = target.points + changes.points, xg = target.xg + changes.xg, xga = target.xga + changes.xga, xpts = target.xpts + changes.xpts, form = changes.form, home_record = changes.home_record, away_record = changes.away_record FROM standings AS target JOIN OPENJSON(?) WITH (league_id int, club_id int, wins int, draws int, losses int, gf int, ga int, points int, xg float, xga float, xpts float, form nvarchar(20), home_record nvarchar(40), away_record nvarchar(40)) AS changes ON changes.league_id = target.league_id AND changes.club_id = target.club_id",
      json,
    ),
  );
  await writeChunks(appearances, 2000, (json) =>
    store.run(
      `INSERT INTO player_match_appearances(fixture_id,player_id,club_id,season,date,position,started,minutes,minute_on,minute_off,rating,goals,assists,stats)
     SELECT source.fixture_id,source.player_id,source.club_id,source.season,source.date,source.position,source.started,source.minutes,source.minute_on,source.minute_off,source.rating,source.goals,source.assists,source.stats
     FROM OPENJSON(?) WITH (fixture_id int,player_id int,club_id int,season int,date nvarchar(10),position nvarchar(10),started int,minutes int,minute_on int,minute_off int,rating float,goals int,assists int,stats nvarchar(max)) AS source
     WHERE NOT EXISTS (SELECT 1 FROM player_match_appearances WITH (UPDLOCK,HOLDLOCK) WHERE fixture_id = source.fixture_id AND player_id = source.player_id)`,
      json,
    ),
  );
  await updateSimulationRows(
    store,
    "players",
    playerUpdates,
    "id int,minutes int,goals int,assists int,form float,fatigue float,potential_bank float",
    "appearances = target.appearances + 1, minutes = target.minutes + changes.minutes, goals = target.goals + changes.goals, assists = target.assists + changes.assists, form = changes.form, fitness = GREATEST(25,target.fitness - changes.fatigue), potential_bank = target.potential_bank + changes.potential_bank",
  );
  if (history.length) {
    const lastId = (await store.get<{ id: number }>(
      "SELECT coalesce(max(id),0) AS id FROM history WITH (UPDLOCK,HOLDLOCK)",
    ))!.id;
    await store.bulkInsert(
      "history",
      history.map((row, index) => ({ id: lastId + index + 1, ...row })),
    );
  }
  await writeBatchDiscipline(store, state, disciplineTeams, participants);
  await writeChunks(injuries, 2000, (json) =>
    store.run(
      "UPDATE target SET injury_until = changes.until, training = 'Injury rehab' FROM players AS target JOIN OPENJSON(?) WITH (id int, until nvarchar(10)) AS changes ON changes.id = target.id",
      json,
    ),
  );
  await writeTableConsequences(store, settings, senior);
}

async function writeBatchDiscipline(
  store: Store,
  state: Awaited<ReturnType<typeof stateOf>>,
  teams: { club_id: number; scope: string; country_id: number; national: number; age_group: string }[],
  participants: { player: MatchPlayer; stats: Record<string, number>; team: MatchTeam; match: BatchMatch; scope: string }[],
) {
  await writeChunks(teams, 2000, (json) =>
    store.run(
      "UPDATE target SET suspension = target.suspension - 1 FROM discipline AS target JOIN players ON players.id = target.player_id JOIN OPENJSON(?) WITH (club_id int, scope nvarchar(100), country_id int, [national] int, age_group nvarchar(10)) AS team ON team.scope = target.scope AND ((team.[national] = 0 AND team.club_id = players.playing_club_id AND team.age_group = players.age_group) OR (team.[national] = 1 AND team.country_id = players.country_id)) WHERE target.suspension > 0",
      json,
    ),
  );
  const previous = new Map<string, { yellow_cards: number; season: number }>();
  await writeChunks(
    participants.map(({ player, scope }) => ({ player_id: player.id, scope })),
    2000,
    async (json) => {
      for (const row of await store.all<{ player_id: number; scope: string; yellow_cards: number; season: number }>(
        "SELECT discipline.player_id, discipline.scope, discipline.yellow_cards, discipline.season FROM discipline JOIN OPENJSON(?) WITH (player_id int, scope nvarchar(100)) AS source ON source.player_id = discipline.player_id AND source.scope = discipline.scope",
        json,
      ))
        previous.set(`${row.player_id}:${row.scope}`, row);
    },
  );
  const seasonStats: Record<string, string | number>[] = [];
  const disciplineRows: Record<string, string | number>[] = [];
  for (const { player, stats, team, match, scope } of participants) {
    seasonStats.push({
      player_id: player.id,
      season: state.season,
      club_id: team.id,
      league_id: match.league.id,
      minutes: stats.minutes,
      goals: stats.goals,
      assists: stats.assists,
    });
    const prior = previous.get(`${player.id}:${scope}`);
    const cautions = (prior?.season === state.season ? prior.yellow_cards : 0) + stats.yellowCards;
    const dismissal = match.result.events.find(
      (event) => event.playerId === player.id && event.type === "red card",
    );
    const ban = dismissal
      ? dismissal.text.includes("second caution")
        ? 1
        : 3
      : match.league.kind === "continental"
        ? cautions >= 3 && (cautions - 3) % 2 === 0 && stats.yellowCards > 0
          ? 1
          : 0
        : cautions > 0 && cautions % 5 === 0 && stats.yellowCards > 0
          ? 1
          : 0;
    if (prior || cautions || ban)
      disciplineRows.push({ player_id: player.id, scope, yellow_cards: cautions, suspension: ban, season: state.season });
  }
  await writeChunks(seasonStats, 2000, (json) =>
    store.run(
      `MERGE player_season_stats WITH (HOLDLOCK) AS target
       USING OPENJSON(?) WITH (player_id int,season int,club_id int,league_id int,minutes int,goals int,assists int) AS source
       ON target.player_id = source.player_id AND target.season = source.season AND target.club_id = source.club_id AND target.league_id = source.league_id
       WHEN MATCHED THEN UPDATE SET minutes = target.minutes + source.minutes, appearances = target.appearances + 1, goals = target.goals + source.goals, assists = target.assists + source.assists
       WHEN NOT MATCHED THEN INSERT (player_id,season,club_id,league_id,minutes,appearances,goals,assists)
       VALUES (source.player_id,source.season,source.club_id,source.league_id,source.minutes,1,source.goals,source.assists);`,
      json,
    ),
  );
  await writeChunks(disciplineRows, 2000, (json) =>
    store.run(
      `MERGE discipline WITH (HOLDLOCK) AS target
       USING OPENJSON(?) WITH (player_id int,scope nvarchar(100),yellow_cards int,suspension int,season int) AS source
       ON target.player_id = source.player_id AND target.scope = source.scope
       WHEN MATCHED THEN UPDATE SET yellow_cards = source.yellow_cards, suspension = target.suspension + source.suspension, season = source.season
       WHEN NOT MATCHED THEN INSERT (player_id,scope,yellow_cards,suspension,season)
       VALUES (source.player_id,source.scope,source.yellow_cards,source.suspension,source.season);`,
      json,
    ),
  );
}

async function writeTableConsequences(
  store: Store,
  settings: Awaited<ReturnType<typeof settingsOf>>,
  results: { club_id: number; league_id: number; result: number; margin: number }[],
) {
  if (!results.length) return;
  const tables = new Map<number, Standing[]>();
  for (const row of await store.all<Standing>(
    "SELECT * FROM standings WHERE league_id IN (SELECT [id] FROM OPENJSON(?) WITH ([id] INT '$')) ORDER BY league_id, points DESC, (gf-ga) DESC, gf DESC, club_id",
    JSON.stringify([...new Set(results.map((entry) => entry.league_id))]),
  ))
    tables.set(row.league_id, [...(tables.get(row.league_id) ?? []), row]);
  const clubs = new Map(
    (
      await store.all<Club>(
        "SELECT * FROM clubs WHERE id IN (SELECT [id] FROM OPENJSON(?) WITH ([id] INT '$'))",
        JSON.stringify(results.map((entry) => entry.club_id)),
      )
    ).map((club) => [club.id, club]),
  );
  const clubRows: Record<string, number>[] = [];
  const squadRows: Record<string, number>[] = [];
  for (const entry of results) {
    const club = clubs.get(entry.club_id);
    const outcome = club && standingOutcome(club, tables.get(entry.league_id) ?? [], settings, entry.result, entry.margin);
    if (!outcome) continue;
    clubRows.push({
      id: entry.club_id,
      momentum: outcome.momentum,
      crisis: outcome.crisis,
      hype: outcome.hype,
      pressure: outcome.pressure,
      confidence: outcome.confidence,
      mood: outcome.mood,
      trust: outcome.trust,
      reputation: entry.result * 0.035,
      reset: outcome.streak === "LLLL" ? 1 : 0,
    });
    squadRows.push({
      club_id: entry.club_id,
      morale: entry.result * 2 - outcome.crisis / 100,
      factor: 1 + outcome.hype / 20000 - outcome.crisis / 18000,
    });
  }
  await writeChunks(clubRows, 2000, (json) =>
    store.run(
      "UPDATE target SET momentum = changes.momentum, crisis = changes.crisis, hype = changes.hype, board_pressure = changes.pressure, board_confidence = changes.confidence, fan_mood = changes.mood, manager_trust = changes.trust, reputation = LEAST(99,GREATEST(1,target.reputation + changes.reputation)), tactical_style = CASE WHEN changes.reset = 1 THEN CASE target.tactical_style WHEN 'High press' THEN 'Counter attack' ELSE 'Balanced' END ELSE target.tactical_style END, chemistry = CASE WHEN changes.reset = 1 THEN GREATEST(0,target.chemistry - 3) ELSE target.chemistry END FROM clubs AS target JOIN OPENJSON(?) WITH (id int, momentum float, crisis float, hype float, pressure float, confidence float, mood float, trust float, reputation float, reset int) AS changes ON changes.id = target.id",
      json,
    ),
  );
  await writeChunks(squadRows, 2000, (json) =>
    store.run(
      "UPDATE target SET morale = LEAST(99,GREATEST(1,target.morale + changes.morale)), value = target.value * changes.factor FROM players AS target JOIN OPENJSON(?) WITH (club_id int, morale float, factor float) AS changes ON changes.club_id = target.club_id",
      json,
    ),
  );
}

interface DevelopmentClub extends Club {
  staff_ability: number;
  plan_focus: string;
  plan_youth: string;
  plan_intensity: number;
  rehab_ability: number;
  league_reputation: number;
  league_market: string | null;
}

export async function developPlayers(store: Store, random: seedrandom.PRNG) {
  const state = await stateOf(store);
  const settings = await settingsOf(store);
  const clubs = new Map(
    (
      await store.all<DevelopmentClub>(
        `SELECT clubs.*, coalesce((SELECT avg(CONVERT(float,ability)) FROM staff WHERE staff.club_id = clubs.id AND role IN ('Head of youth','Assistant manager','Fitness coach','Goalkeeper coach')),50) AS staff_ability, coalesce((SELECT avg(CONVERT(float,ability)) FROM staff WHERE staff.club_id = clubs.id AND role = 'Physio'),50) AS rehab_ability, coalesce(training_plans.focus,'Balanced') AS plan_focus, coalesce(training_plans.youth_focus,'Technical') AS plan_youth, coalesce(training_plans.intensity,50) AS plan_intensity, coalesce(leagues.reputation,clubs.reputation) AS league_reputation, (SELECT code FROM countries WHERE countries.id = coalesce(leagues.country_id,clubs.country_id)) AS league_market FROM clubs LEFT JOIN training_plans ON training_plans.club_id = clubs.id LEFT JOIN leagues ON leagues.id = clubs.league_id WHERE clubs.type != 'national' ORDER BY clubs.id`,
      )
    ).map((club) => [club.id, club]),
  );
  const fallback = clubs.values().next().value!;
  // Free agents and home-based pool players train in amateur football at home.
  const amateurContext: DevelopmentClub = {
    ...fallback,
    staff_ability: 35,
    rehab_ability: 35,
    academy: 35,
    facilities: 30,
    chemistry: 50,
    crisis: 0,
    hype: 0,
    momentum: 0,
    plan_focus: "Balanced",
    plan_youth: "Technical",
    plan_intensity: 50,
  };
  const bodyRandom = seedrandom(`${state.seed}:body:${state.week}`);
  const nationReputation = new Map(
    (await store.all<{ id: number; reputation: number }>("SELECT id,reputation FROM countries")).map((row) => [row.id, row.reputation]),
  );
  const nationCode = new Map(
    (await store.all<{ id: number; code: string }>("SELECT id,code FROM countries")).map((row) => [row.id, row.code]),
  );
  // League matches each team has played this season: the denominator of a player's minutes share.
  const teamMatches = new Map(
    (
      await store.all<{ club_id: number; age_group: string; played: number }>(
        "SELECT standings.club_id, leagues.age_group, max(standings.played) AS played FROM standings JOIN leagues ON leagues.id = standings.league_id WHERE leagues.kind IN ('league','youth') GROUP BY standings.club_id, leagues.age_group",
      )
    ).map((row) => [`${row.club_id}:${row.age_group}`, row.played]),
  );
  let cursor = 0;
  while (true) {
    const batch = await store.all<Player>(
      "SELECT TOP (1500) * FROM players WHERE id > ? AND role != 'Retired' ORDER BY id",
      cursor,
    );
    if (!batch.length) break;
    const profiles = new Map(
      batch.map((player) => [
        player.id,
        JSON.parse(player.profile) as PlayerProfile,
      ]),
    );
    const mentorIds = [
      ...new Set(
        [...profiles.values()]
          .map((profile) => profile.development.mentorId)
          .filter((id): id is number => typeof id === "number" && id > 0),
      ),
    ];
    const mentors = new Map(
      (mentorIds.length
        ? await store.all<{
            id: number;
            profile: string;
            club_id: number | null;
            role: string;
          }>(
            `SELECT id,profile,club_id,role FROM players WHERE id IN (${mentorIds.map(() => "?").join(",")})`,
            ...mentorIds,
          )
        : []
      ).map((mentor) => [mentor.id, mentor]),
    );
    const updates: Record<string, string | number | null>[] = [];
    for (const player of batch) {
      cursor = player.id;
      const club = player.club_id
        ? (clubs.get(player.club_id) ?? fallback)
        : amateurContext;
      const profile = profiles.get(player.id)!;
      let secondaryPosition: string | null = null;
      const age = ageOn(player.birth_date, state.date);
      const ownClub =
        player.club_id === state.clubId ||
        player.parent_club_id === state.clubId;
      const effectiveFocus =
        player.training === "Balanced"
          ? player.age_group !== "Senior"
            ? club.plan_youth
            : club.plan_focus
          : player.training;
      const clubless = player.club_id === null;
      const played = teamMatches.get(`${player.squad_club_id ?? player.club_id}:${player.age_group}`) ?? 0;
      // Early in a season the share is last season's; club-less players only get amateur football.
      const minutesShare = clubless
        ? 0.3
        : played >= 3
          ? Math.min(1, player.minutes / (90 * played))
          : (profile.development.minutesShare ?? AVERAGE_MINUTES_SHARE);
      const context = {
        staff:
          club.staff_ability +
          (ownClub ? state.director.skills.development * 3 : 0),
        academy: club.academy,
        chemistry: club.chemistry,
        fit: tacticalFit(player, club),
        culture: club.culture,
        director: ownClub ? state.director.reputation : club.reputation * 0.75,
        fans: club.fan_mood,
        media: Number(settings.mediaPressure) * (club.crisis > 50 ? 1.4 : 1),
        tournament: 0,
        intensity: Number(settings.potentialIntensity),
        lifestyleImpact: Number(settings.lifestyleImpact),
        performance: player.potential_bank,
        minutesShare,
      };
      const influences = potentialInfluences(player, profile, context);
      const intensity = (player.intensity + club.plan_intensity) / 2;
      const dna = JSON.parse(club.data).youthDNA ?? "Technical intelligence";
      const focusBonus =
        age < 21 && effectiveFocus === "Youth development"
          ? 1.18
          : effectiveFocus === "Role"
            ? 1.08
            : 1;
      const habits = profile.traits.includes("Lazy trainer")
        ? 0.75
        : profile.lifestyle === "gym-rat" && effectiveFocus === "Physical"
          ? 1.12
          : 1;
      const mentor = profile.development.mentorId ? mentors.get(profile.development.mentorId) : undefined;
      const mentored = age < 23 && mentor !== undefined && mentor.club_id === player.club_id && mentor.role !== "Retired";
      const injured = Boolean(player.injury_until && player.injury_until > state.date);
      const development = weeklyDevelopment({
        age: exactAge(player.birth_date, state.date),
        goalkeeper: player.position === "GK",
        ability: player.ability,
        potential: player.potential,
        bank: player.development_bank,
        minutesShare,
        environment:
          (0.7 + context.staff / 250 + club.facilities / 500) *
          (intensity / 100 + 0.5) *
          focusBonus *
          habits *
          (mentored ? 1.08 : 1) *
          (profile.mentalHealth.burnout > 65 ? 0.85 : 1) *
          (injured && effectiveFocus === "Injury rehab" ? 1.2 : 1),
        professionalism: profile.personality.professionalism,
        injured,
        drift: influences.change,
        volatility: player.volatility,
        noise: random() - 0.5,
        intensity: Number(settings.potentialIntensity),
        extra: player.loan_progress,
      });
      const ability = development.ability;
      let potential = development.potential;
      const progress = development.bank;
      let profileChanged = false;
      if (effectiveFocus === "Position" && profile.development.positionTarget) {
        profile.development.positionWeeks =
          (profile.development.positionWeeks ?? 0) + 1;
        if (
          profile.development.positionWeeks >=
          Math.max(6, 15 - Math.floor(profile.personality.adaptability / 10))
        ) {
          secondaryPosition = profile.development.positionTarget;
          if (ownClub)
            await news(
              store,
              "Training",
              `${player.name}: new position learned`,
              `The coaching team now considers ${profile.development.positionTarget} a competent secondary position.`,
              "success",
              "training",
            );
          delete profile.development.positionTarget;
          delete profile.development.positionWeeks;
        }
        profileChanged = true;
      }
      // Own-club bodies grow weekly; others every four weeks, when their profiles are rewritten anyway.
      if (ownClub || state.week % 4 === 0) {
        const wasSpurting = profile.development.growthSpurt;
        const body = developBody(profile.identity, {
          birthDate: player.birth_date,
          from: addDays(state.date, ownClub ? -7 : -28),
          to: state.date,
          random: bodyRandom,
          physicalTraining: effectiveFocus === "Physical",
          fitness: player.fitness,
          injured: Boolean(player.injury_until && player.injury_until > state.date),
        });
        profile.development.growthSpurt = body.spurt;
        if (body.changed || body.spurt !== wasSpurting) profileChanged = true;
        if (ownClub && body.spurt && !wasSpurting)
          await news(
            store,
            "Academy",
            `${player.name}: growth spurt`,
            `Now ${profile.identity.height} cm and growing quickly. Coordination and training load need careful monitoring until the spurt settles.`,
            "info",
            "academy",
          );
      }
      if (age < 23 && random() < 0.035) {
        const key = [
          "professionalism",
          "adaptability",
          "discipline",
          "ambition",
        ][Math.floor(random() * 4)];
        let mutation = Math.round((random() - 0.45) * 5);
        if (profile.development.mentorId) {
          const mentor = mentors.get(profile.development.mentorId);
          if (mentor && mentor.club_id === player.club_id)
            mutation +=
              ((JSON.parse(mentor.profile) as PlayerProfile).personality[key] -
                profile.personality[key]) /
              40;
        }
        profile.personality[key] = clamp(
          Math.round(profile.personality[key] + mutation),
        );
        profileChanged = true;
      }
      if (ownClub || state.week % 4 === 0) {
        // Own-club profiles update weekly at a quarter of the four-weekly step, so every club moves at the same rate.
        const step = ownClub ? 0.25 : 1;
        const youthStress = age < 19 ? Number(settings.youthRealism) / 75 : 1;
        // Mental health reverts towards generation levels (burnout 12, anxiety 24, motivation 75) under normal loads.
        profile.mentalHealth.burnout = clamp(
          profile.mentalHealth.burnout +
            ((intensity > 75 ? 2.5 : 0) + (player.fitness < 55 ? 2 : 0)) * youthStress * step +
            (12 - profile.mentalHealth.burnout) * 0.1 * step,
          0,
          100,
        );
        profile.mentalHealth.anxiety = clamp(
          profile.mentalHealth.anxiety +
            ((club.crisis > 50 ? 1.5 : 0) + (24 - profile.mentalHealth.anxiety) * 0.08 -
              (profile.personality.emotionalStability - 50) / 100) *
              step,
          0,
          100,
        );
        profile.mentalHealth.confidence = clamp(
          profile.mentalHealth.confidence +
            (player.morale - profile.mentalHealth.confidence) * (1 - 0.85 ** step),
          0,
          100,
        );
        profile.mentalHealth.motivation = clamp(
          profile.mentalHealth.motivation +
            ((club.momentum > 5 ? 1 : 0) +
              (75 - profile.mentalHealth.motivation) * 0.05 -
              Math.max(0, profile.mentalHealth.burnout - 40) / 100) *
              step,
          0,
          100,
        );
        if (state.week % 4 === 0)
          profile.development.history = [
            ...profile.development.history,
            {
              date: state.date,
              ability: round(ability),
              potential: round(potential),
            },
          ].slice(-24);
        if (played >= 3) profile.development.minutesShare = round(minutesShare, 2);
        // Adults get an adult lifestyle once (minors only ever draw positive ones, RAI); seeded per player.
        if (age >= 18 && age < 23 && !profile.development.adultLifestyle) {
          profile.lifestyle =
            ADULT_LIFESTYLES[Math.floor(seedrandom(`${state.seed}:lifestyle:${player.id}`)() * ADULT_LIFESTYLES.length)];
          profile.development.adultLifestyle = true;
        }
        const focus =
          effectiveFocus === "Youth development"
            ? dna === "Physical resilience"
              ? "Physical"
              : dna === "Relentless pressing"
                ? "Tactical"
                : "Technical"
            : effectiveFocus;
        // Goalkeepers' technical and role work is goalkeeping.
        const group =
          player.position === "GK" && ["Technical", "Role", "Balanced"].includes(focus)
            ? "goalkeeper"
            : focus === "Technical"
              ? "technical"
              : focus === "Physical"
                ? "physical"
                : focus === "Tactical" || focus === "Position"
                  ? "tactical"
                  : focus === "Mental"
                    ? "mental"
                    : "technical";
        // Attribute training runs every four weeks for every club; ability drives the overall level (currentAttributes).
        const developmentYears = age - (player.position === "GK" ? 2.5 : 0);
        if (state.week % 4 === 0 && !injured && developmentYears < 29 && random() < 0.35) {
          const roleAttributes: Record<string, string[]> = {
            ST: ["finishing", "firstTouch", "heading"],
            CB: ["tackling", "heading", "passing"],
            LB: ["crossing", "tackling", "dribbling"],
            RB: ["crossing", "tackling", "dribbling"],
            DM: ["passing", "tackling", "firstTouch"],
            CM: ["passing", "technique", "firstTouch"],
            AM: ["passing", "dribbling", "longShots"],
            LW: ["dribbling", "crossing", "finishing"],
            RW: ["dribbling", "crossing", "finishing"],
          };
          const keys =
            focus === "Role" && player.position !== "GK"
              ? roleAttributes[player.position]
              : Object.keys(profile.attributes[group]);
          const attribute = keys[Math.floor(random() * keys.length)];
          profile.attributes[group][attribute] = clamp(
            profile.attributes[group][attribute] + 1,
          );
        } else if (state.week % 4 === 0 && developmentYears >= 31 && random() < 0.35) {
          // Ageing takes the physical edge first.
          const keys = Object.keys(profile.attributes.physical);
          const attribute = keys[Math.floor(random() * keys.length)];
          profile.attributes.physical[attribute] = clamp(profile.attributes.physical[attribute] - 1);
        }
        profileChanged = true;
      }
      let injury =
        player.injury_until && player.injury_until > state.date
          ? player.injury_until
          : null;
      if (injury && effectiveFocus === "Injury rehab")
        injury = addDays(
          injury,
          -Math.min(
            Math.max(1, Math.floor(club.rehab_ability / 35)),
            Math.max(0, daysBetween(state.date, injury) - 1),
          ),
        );
      const injuryChance =
        ((0.004 * Number(settings.injuryFrequency)) / 50) *
        (1 + Math.max(0, intensity - 50) / 50) *
        (1 - club.rehab_ability / 250) *
        (1 + Math.max(0, age - 29) * 0.06) *
        (profile.lifestyle === "nightlife" ? 1.3 : 1);
      if (!injury && random() < injuryChance) {
        const duration =
          random() < 0.85
            ? 4 + Math.floor(random() * 24)
            : 35 + Math.floor(random() * 120);
        injury = addDays(state.date, duration);
        potential = Math.max(ability, potential - (duration > 60 ? 0.6 : 0.05));
        if (ownClub)
          await news(
            store,
            "Medical",
            `${player.name}: injury update`,
            `The medical team expects an absence of approximately ${duration} days. An individual rehabilitation plan is recommended.`,
            "warning",
            "training",
            { playerId: player.id },
          );
      }
      const morale = clamp(
        player.morale +
          (club.chemistry - 65) / 150 +
          (profile.mentalHealth.motivation - 60) / 200 -
          (injury ? 0.35 : 0) +
          (ownClub ? state.director.skills.leadership * 0.045 : 0),
        1,
        99,
      );
      // Club-less players (free agents, home-based pools) are priced in their nation's league market.
      const market = profile.homeBased?.countryId ?? profile.registration?.lastAssociationId ?? player.country_id;
      const value = valuation(
        { ...player, ability, potential, age, injury_until: injury },
        {
          date: state.date,
          leagueReputation: clubless
            ? (nationReputation.get(market) ?? 30)
            : club.league_reputation,
          marketFactor: marketValueFactor(clubless ? nationCode.get(market) : club.league_market),
          balance: clubless ? 0 : club.balance,
          philosophy: clubless ? "" : club.philosophy,
          inflation: Number(settings.transferInflation),
          crisis: clubless ? 0 : club.crisis,
          hype: clubless ? 0 : club.hype,
          exposure: exposureValueFactor(profile.international, state.date),
        },
      ).value;
      const updatedProfile = profileChanged ? JSON.stringify(profile) : null;
      updates.push({
        id: player.id,
        ability: round(ability, 2),
        potential: round(potential, 2),
        development_bank: progress,
        age,
        value,
        morale: round(morale, 2),
        injury_until: injury,
        profile: updatedProfile,
        secondary_position: secondaryPosition,
      });
      if (mentors.has(player.id))
        mentors.set(player.id, {
          id: player.id,
          profile: updatedProfile ?? player.profile,
          club_id: player.club_id,
          role: player.role,
        });
    }
    await updateSimulationRows(
      store,
      "players",
      updates,
      "id int, ability float, potential float, development_bank float, age int, value float, morale float, injury_until nvarchar(10), profile nvarchar(max), secondary_position nvarchar(10)",
      "ability = changes.ability, potential = changes.potential, development_bank = changes.development_bank, potential_bank = 0, age = changes.age, value = changes.value, morale = changes.morale, injury_until = changes.injury_until, profile = coalesce(changes.profile,target.profile), secondary_position = coalesce(changes.secondary_position,target.secondary_position), loan_progress = 0",
    );
  }
}

async function weeklyFinances(store: Store) {
  const state = await stateOf(store);
  const settings = await settingsOf(store);
  const salaries = new Map(
    (
      await store.all<{ club_id: number; total: number }>(
        "SELECT club_id, sum(wage) AS total FROM players WHERE club_id IS NOT NULL GROUP BY club_id",
      )
    ).map((row) => [row.club_id, row.total]),
  );
  const staffCosts = new Map(
    (
      await store.all<{ club_id: number; total: number }>(
        "SELECT club_id, sum(wage) AS total FROM staff WHERE club_id IS NOT NULL GROUP BY club_id",
      )
    ).map((row) => [row.club_id, row.total]),
  );
  for (const loan of await store.all<{
    parent_id: number;
    destination_id: number;
    wage: number;
    salary_split: number;
  }>(
    "SELECT loans.parent_id, loans.destination_id, players.wage, coalesce(TRY_CONVERT(float,JSON_VALUE(loans.terms,'$.salarySplit')),0) AS salary_split FROM loans JOIN players ON players.id = loans.player_id WHERE loans.status = 'active'",
  )) {
    const parentShare = loan.wage * (1 - loan.salary_split / 100);
    salaries.set(
      loan.destination_id,
      (salaries.get(loan.destination_id) ?? 0) - parentShare,
    );
    salaries.set(
      loan.parent_id,
      (salaries.get(loan.parent_id) ?? 0) + parentShare,
    );
  }
  const gates = new Map(
    (
      await store.all<{ home_id: number; count: number }>(
        "SELECT fixtures.home_id, count(*) AS count FROM fixtures LEFT JOIN leagues ON leagues.id = fixtures.league_id WHERE fixtures.status = 'played' AND fixtures.date > ? AND fixtures.date <= ? AND (leagues.age_group = 'Senior' OR fixtures.league_id IS NULL) GROUP BY fixtures.home_id",
        addDays(state.date, -7),
        state.date,
      )
    ).map((row) => [row.home_id, row.count]),
  );
  const leagues = new Map(
    (await store.all<League>("SELECT * FROM leagues")).map((league) => [league.id, league]),
  );
  const accountUpdates: Record<string, string | number | null>[] = [];
  const flushAccounts = async () => {
    await updateSimulationRows(
      store,
      "clubs",
      accountUpdates,
      "id int,net float,income float,expenses float,ffp float,budget_increase float",
      "balance = target.balance + changes.net, income = target.income + changes.income, spending = target.spending + changes.expenses, ffp = changes.ffp, transfer_budget = GREATEST(0,target.transfer_budget + changes.budget_increase)",
    );
    accountUpdates.length = 0;
  };
  // The first week fixes each club's reference wage budget, so budget rebalancing cannot lower operating costs.
  await store.run(
    "UPDATE clubs SET data = JSON_MODIFY(coalesce(data,'{}'),'$.operatingWageBudget',wage_budget) WHERE type != 'national' AND JSON_VALUE(coalesce(data,'{}'),'$.operatingWageBudget') IS NULL",
  );
  const clubs = await store.all<Club & { wage_reference: number | null }>(
    "SELECT *, TRY_CONVERT(float,JSON_VALUE(coalesce(data,'{}'),'$.operatingWageBudget')) AS wage_reference FROM clubs WHERE type != 'national' ORDER BY id",
  );
  const leagueSizes = new Map<number, number>();
  for (const club of clubs)
    leagueSizes.set(club.league_id ?? -1, (leagueSizes.get(club.league_id ?? -1) ?? 0) + 1);
  const countryCodes = new Map(
    (await store.all<{ id: number; code: string }>("SELECT id, code FROM countries")).map((row) => [row.id, row.code]),
  );
  for (const club of clubs) {
    const wages = (salaries.get(club.id) ?? 0) + (staffCosts.get(club.id) ?? 0);
    const league = leagues.get(club.league_id ?? -1);
    const countryCode = countryCodes.get(league?.country_id ?? club.country_id);
    const expected = estimateClubRevenue({
      reputation: club.reputation,
      leagueReputation: league?.reputation ?? club.reputation,
      tier: league?.tier ?? 1,
      capacity: club.capacity,
      fanMood: 72,
      homeMatches: Math.max(0, (leagueSizes.get(club.league_id ?? -1) ?? 1) - 1) + 2,
      countryCode,
    }).annualOperatingRevenue;
    const operating = weeklyOperatingCosts({
      annualRevenue: expected,
      wageShare: (0.88 * (club.wage_reference ?? club.wage_budget) * 52) / Math.max(1, expected),
      spendRatio: spendRatio(club.id, league?.tier ?? 1),
      facilities: club.facilities,
      academy: club.academy,
      balance: club.balance,
      staffWages: staffCosts.get(club.id) ?? 0,
    });
    const running = operating.total;
    const revenue = estimateClubRevenue({
      reputation: club.reputation,
      leagueReputation: league?.reputation ?? club.reputation,
      tier: league?.tier ?? 1,
      capacity: club.capacity,
      fanMood: club.fan_mood,
      homeMatches: gates.get(club.id) ?? 0,
      countryCode,
    });
    const sponsorship = Math.round(revenue.annualCommercial / 52);
    const gate = revenue.annualMatchday;
    const income = sponsorship + gate;
    const expenses = wages + running;
    const net = income - expenses;
    await postWeeklyAccounts(
      store,
      club.id,
      income,
      wages,
      operating.facilities + operating.operations,
      operating.academy,
    );
    const period = (await store.get<{ deficit: number }>(
      "SELECT GREATEST(0,wages + operating + amortization + agent_fees - revenue - sale_profit) AS deficit FROM financial_periods WHERE club_id = ? AND season = ?",
      club.id,
      state.season,
    ))!;
    const ffp = period.deficit;
    accountUpdates.push({
      id: club.id,
      net,
      income,
      expenses,
      ffp,
      budget_increase: net > 0 ? net * 0.08 : 0,
    });
    if (accountUpdates.length === 1000) await flushAccounts();
    if (club.id === state.clubId) {
      await flushAccounts();
      for (const [category, amount] of [
        ["Sponsorship & broadcasting", sponsorship],
        ["Matchday income", gate],
        ["Player & staff wages", -wages],
        ["Club operations & academy", -running],
      ] as [string, number][])
        await store.run(
          "INSERT INTO ledger(club_id, date, category, amount, description) VALUES (?, ?, ?, ?, ?)",
          club.id,
          state.date,
          category,
          amount,
          "Weekly accounts",
        );
      await store.run(
        "INSERT INTO history(season, entity_type, entity_id, date, data) VALUES (?, ?, ?, ?, ?)",
        state.season,
        "finance",
        club.id,
        state.date,
        JSON.stringify({
          balance: club.balance + net,
          income,
          expenses,
          ffp,
          wages,
          transferBudget: club.transfer_budget,
        }),
      );
      if (club.balance > 0 && club.balance + net < 0)
        await news(
          store,
          "Finance",
          "Cash balance enters the red",
          "The board has requested a financial recovery plan. Player sales and wage reductions may be needed.",
          "warning",
          "finances",
        );
      const assessment = await assessFinances(store, club.id);
      if (settings.ffp && assessment.issues.length && state.week % 4 === 0)
        await news(
          store,
          "Finance",
          "Financial sustainability warning",
          `${assessment.policy}: ${assessment.issues.join(" ")} The board requires a sustainable spending plan.`,
          "warning",
          "finances",
        );
    }
  }
  await flushAccounts();
}

async function weeklyStaffAndPolitics(store: Store, random: seedrandom.PRNG) {
  const state = await stateOf(store);
  const club = await clubOf(store);
  const settings = await settingsOf(store);
  const relationships = await store.all<{
    id: number;
    strength: number;
    club_id: number;
    source_id: number;
    target_id: number;
  }>("SELECT * FROM relationships WHERE source_type = 'staff' ORDER BY id");
  const chemistry = new Map(
    (
      await store.all<{ id: number; chemistry: number }>(
        "SELECT id,chemistry FROM clubs",
      )
    ).map((entry) => [entry.id, entry.chemistry]),
  );
  const relationshipUpdates: Record<string, number>[] = [];
  const chemistryUpdates = new Map<number, { id: number; chemistry: number }>();
  for (const relationship of relationships) {
    const strength = clamp(
      relationship.strength +
        (random() - 0.5) * (settings.directorDrama ? 8 : 3),
      -100,
      100,
    );
    relationshipUpdates.push({ id: relationship.id, strength });
    const nextChemistry = clamp(
      chemistry.get(relationship.club_id)! +
        (strength > 50 ? 0.08 : strength < -30 ? -0.18 : 0),
      1,
      99,
    );
    chemistry.set(relationship.club_id, nextChemistry);
    chemistryUpdates.set(relationship.club_id, {
      id: relationship.club_id,
      chemistry: nextChemistry,
    });
    if (
      relationship.club_id === state.clubId &&
      strength < -35 &&
      random() < 0.2
    )
      await news(
        store,
        "Staff",
        "A disagreement in the backroom",
        "A staff rivalry is affecting communication and the development environment. A mediation meeting could help.",
        "important",
        "staff",
        { staffId: relationship.source_id },
      );
  }
  await updateSimulationRows(
    store,
    "relationships",
    relationshipUpdates,
    "id int,strength float",
    "strength = changes.strength",
  );
  await updateSimulationRows(
    store,
    "clubs",
    [...chemistryUpdates.values()],
    "id int,chemistry float",
    "chemistry = changes.chemistry",
  );
  for (const troubled of await store.all<Club>(
    "SELECT * FROM clubs WHERE type = 'club' AND manager_trust < 22 AND crisis > 50 ORDER BY id",
  )) {
    const country = (await store.get<Country>(
      "SELECT * FROM countries WHERE id = ?",
      troubled.country_id,
    ))!;
    const nextManager = personName(random, country.code);
    const data = JSON.parse(troubled.data);
    data.managerCareer = [
      ...(data.managerCareer ?? []),
      {
        season: state.season,
        date: state.date,
        departed: troubled.manager,
        appointed: nextManager,
      },
    ];
    await store.run(
      "UPDATE clubs SET manager = ?, manager_trust = 65, chemistry = GREATEST(25,chemistry - 6), tactical_style = ?, data = ? WHERE id = ?",
      nextManager,
      ["Possession", "High press", "Counter attack", "Direct", "Balanced"][
        Math.floor(random() * 5)
      ],
      JSON.stringify(data),
      troubled.id,
    );
    await store.run(
      "INSERT INTO history(season, entity_type, entity_id, date, data) VALUES (?, ?, ?, ?, ?)",
      state.season,
      "manager",
      troubled.id,
      state.date,
      JSON.stringify({ departed: troubled.manager, appointed: nextManager }),
    );
    if (troubled.id === state.clubId)
      await news(
        store,
        "Board",
        "The board dismisses the manager",
        `${troubled.manager} has left. ${nextManager} takes charge with a new tactical approach. Your recruitment plan must adapt.`,
        "warning",
        "staff",
      );
  }
  if (club.crisis > 60) {
    const unsettled = await store.get<Player>(
      "SELECT TOP (1) * FROM players WHERE club_id = ? AND age_group = 'Senior' AND listed = 0 ORDER BY morale ASC,id",
      club.id,
    );
    if (unsettled && unsettled.morale < 40) {
      await store.run(
        "UPDATE players SET listed = 1 WHERE id = ?",
        unsettled.id,
      );
      await news(
        store,
        "Transfers",
        `${unsettled.name} requests a transfer`,
        "The player and agent have lost confidence in the current direction. Their request has unsettled the dressing room.",
        "warning",
        "transfers",
      );
    }
  }
  const troubledClubs = await store.all<Club>(
    "SELECT TOP (100) * FROM clubs WHERE type = 'club' AND crisis > 60 AND id != ? ORDER BY id",
    state.clubId,
  );
  if (troubledClubs.length) {
    // Only a youth his squad can spare: the weekly squad check refills youth squads to the minimum, not above it.
    const ids = JSON.stringify(troubledClubs.map((troubled) => troubled.id));
    const squads = new Map(
      (
        await store.all<{ club_id: number; age_group: string; players: number; keepers: number }>(
          "SELECT coalesce(squad_club_id,club_id) AS club_id,age_group,count(*) AS players,sum(CASE WHEN position = 'GK' THEN 1 ELSE 0 END) AS keepers FROM players WHERE coalesce(squad_club_id,club_id) IN (SELECT CAST([value] AS int) FROM OPENJSON(?)) AND club_id IS NOT NULL AND age_group IN ('U17','U19') AND role != 'Retired' AND (contract_end >= ? OR parent_club_id IS NOT NULL) AND birth_date >= CASE age_group WHEN 'U17' THEN ? ELSE ? END GROUP BY coalesce(squad_club_id,club_id),age_group",
          ids,
          state.date,
          youthBirthCutoff("U17", state.season),
          youthBirthCutoff("U19", state.season),
        )
      ).map((row) => [`${row.club_id}:${row.age_group}`, row]),
    );
    const candidates = await store.all<{ id: number; club_id: number; squad_club_id: number | null; age_group: string; position: string }>(
      "SELECT id,club_id,squad_club_id,age_group,position FROM players WHERE club_id IN (SELECT CAST([value] AS int) FROM OPENJSON(?)) AND age_group != 'Senior' AND age >= 16 ORDER BY club_id,ability DESC,id",
      ids,
    );
    const squadOf = (player: (typeof candidates)[number]) => squads.get(`${player.squad_club_id ?? player.club_id}:${player.age_group}`);
    for (const troubled of troubledClubs) {
      const youth = candidates.find((player) => {
        const squad = player.club_id === troubled.id ? squadOf(player) : undefined;
        return (
          !!squad &&
          squad.players > SQUAD_MINIMUMS[player.age_group as "U17" | "U19"] &&
          (player.position !== "GK" || squad.keepers > MIN_GOALKEEPERS)
        );
      });
      if (!youth) continue;
      const squad = squadOf(youth)!;
      squad.players--;
      if (youth.position === "GK") squad.keepers--;
      await store.run(
        "UPDATE players SET age_group = 'Senior', role = 'Prospect', morale = LEAST(99,morale + 5) WHERE id = ?",
        youth.id,
      );
    }
  }
  if (
    club.crisis > 50 &&
    (await store.get<{ count: number }>(
      "SELECT count(*) AS count FROM players WHERE club_id = ? AND injury_until > ?",
      club.id,
      state.date,
    ))!.count >= 3
  )
    await news(
      store,
      "Loans",
      "Emergency cover is now an option",
      "The injury crisis makes an emergency loan available. The manager has asked for immediate cover.",
      "important",
      "loans",
    );
  if (club.board_confidence < 8 && state.week > 8) {
    const latest = await stateOf(store);
    latest.gameOver = true;
    await store.setMeta("state", latest);
    await news(
      store,
      "Board",
      "The board ends your tenure",
      "Your contract has been terminated. Your career record remains available, and you can accept a new role at another club from Career settings.",
      "warning",
      "settings",
    );
  }
  await publishClubRoundup(store);
}

async function checkPromises(store: Store) {
  const state = await stateOf(store);
  for (const promise of await store.all<{
    id: number;
    player_id: number;
    type: string;
    target: number;
    data: string;
  }>(
    "SELECT * FROM promises WHERE status = 'active' AND due_date <= ? ORDER BY id",
    state.date,
  )) {
    const player = await playerOf(store, promise.player_id);
    const data = JSON.parse(promise.data);
    const club = await clubOf(store, data.clubId);
    const fulfilled =
      promise.type === "First-team minutes"
        ? player.minutes - data.startMinutes >= promise.target
        : promise.type === "Captaincy"
          ? player.role === "Captain"
          : promise.type === "Youth pathway"
            ? player.age_group === "Senior"
            : promise.type === "European football"
              ? club.hype > 50
              : club.facilities >= promise.target;
    await store.run(
      "UPDATE promises SET status = ? WHERE id = ?",
      fulfilled ? "fulfilled" : "broken",
      promise.id,
    );
    const profile = JSON.parse(player.profile) as PlayerProfile;
    profile.agent.frustration = clamp(
      profile.agent.frustration + (fulfilled ? -10 : 25),
      0,
      100,
    );
    profile.personality.loyalty = clamp(
      profile.personality.loyalty + (fulfilled ? 3 : -6),
    );
    await store.run(
      "UPDATE players SET morale = LEAST(99,GREATEST(1,morale + ?)), profile = ? WHERE id = ?",
      fulfilled ? 6 : -16,
      JSON.stringify(profile),
      player.id,
    );
    await store.run(
      "UPDATE clubs SET board_confidence = LEAST(100,GREATEST(0,board_confidence + ?)) WHERE id = ?",
      fulfilled ? 1 : -3,
      data.clubId,
    );
    if (data.clubId === state.clubId)
      await news(
        store,
        "Squad",
        `${player.name}: promise ${fulfilled ? "fulfilled" : "broken"}`,
        `The ${promise.type.toLowerCase()} commitment has been reviewed. ${fulfilled ? "Trust and loyalty have improved." : "The player and agent are disappointed. Your reputation and dressing-room trust have suffered."}`,
        fulfilled ? "success" : "warning",
        "squad",
      );
    await experience(store, fulfilled ? 10 : 0, fulfilled ? 0.2 : -0.7);
  }
  const boardPlan = await store.get<{ value: string }>(
    "SELECT value FROM meta WHERE [key] = 'boardPlan'",
  );
  if (boardPlan) {
    const plan = JSON.parse(boardPlan.value);
    if (state.date >= plan.due) {
      const club = await clubOf(store);
      const youthMinutes = (await store.get<{ total: number }>(
        "SELECT coalesce(sum(minutes),0) AS total FROM players WHERE club_id = ? AND age < 21",
        club.id,
      ))!.total;
      const successful =
        plan.approach === "youth"
          ? youthMinutes - plan.youthMinutes >= 180
          : club.crisis < plan.crisis || club.crisis < 20;
      await store.run(
        "UPDATE clubs SET board_confidence = GREATEST(0,LEAST(100,board_confidence + ?)), board_pressure = GREATEST(0,LEAST(100,board_pressure + ?)) WHERE id = ?",
        successful ? 7 : -12,
        successful ? -5 : 10,
        club.id,
      );
      await news(
        store,
        "Board",
        successful
          ? "The board endorses your plan"
          : "The board questions your commitment",
        successful
          ? "The promised progress has been delivered. Your credibility and the board relationship have improved."
          : "The review found that the promised improvement was not delivered. The board has tightened its scrutiny.",
        successful ? "success" : "warning",
        "board",
      );
      await store.run("DELETE FROM meta WHERE [key] = 'boardPlan'");
      await experience(store, successful ? 20 : 0, successful ? 0.5 : -1);
    }
  }
}

async function processNegotiations(store: Store, random: seedrandom.PRNG) {
  const state = await stateOf(store);
  const settings = await settingsOf(store);
  for (const negotiation of await store.all<Negotiation>(
    "SELECT * FROM negotiations WHERE stage IN ('Enquiry','Club talks','Agent talks','Contract review','Scheduled','Medical','Registration','Offer received') ORDER BY id",
  )) {
    const data = JSON.parse(negotiation.data) as NegotiationData;
    if (
      ["Scheduled", "Medical", "Registration"].includes(negotiation.stage) ||
      (data.buyerManaged &&
        ["Agent talks", "Contract review"].includes(negotiation.stage))
    ) {
      try {
        await progressDealMilestones(store, negotiation);
      } catch (error) {
        if (!(error instanceof GameError)) throw error;
        await closeNegotiation(store, negotiation, "Rejected", error.message);
      }
      continue;
    }
    if (state.date > negotiation.deadline) {
      await store.run(
        "UPDATE negotiations SET stage = 'Expired' WHERE id = ?",
        negotiation.id,
      );
      await news(
        store,
        "Transfers",
        "Negotiation deadline passed",
        `${(await playerOf(store, negotiation.player_id)).name}'s representatives have closed talks.`,
        "important",
        "transfers",
      );
      continue;
    }
    const lastWindowDay = deadlineDay(state.date);
    const eventChance = (lastWindowDay ? 0.18 : 0.015) * (settings.chaos ? 3 : 1);
    if (random() > eventChance) continue;
    const event = random();
    const player = await playerOf(store, negotiation.player_id);
    if (event < 0.45 && !data.leak) {
      data.leak = true;
      data.log.push({
        date: state.date,
        type: "Leak",
        message:
          "Negotiation details leaked. Rival interest and the asking price have risen.",
      });
      await store.run(
        "UPDATE negotiations SET tension = LEAST(99,tension + 12), asking_price = ROUND(asking_price * 1.08, 0), [public] = 1, data = ? WHERE id = ?",
        JSON.stringify(data),
        negotiation.id,
      );
      await news(
        store,
        "Media",
        `${player.name}: talks leaked`,
        "Details of the negotiations have reached the press. The selling club and agent want a quick response.",
        "warning",
        "transfers",
      );
    } else if (
      event > 0.85 &&
      negotiation.buying_club_id === state.clubId &&
      negotiation.interest < 65
    ) {
      // Club-to-club purchases are contested by real rival clubs (transfer-battles.ts), not by this abstract hijack.
      if (negotiation.type === "Permanent transfer" && negotiation.selling_club_id) continue;
      data.hijack = true;
      data.log.push({
        date: state.date,
        type: "Hijack",
        message:
          "The player has prioritised a competing offer with a stronger career pathway.",
      });
      await store.run(
        "UPDATE negotiations SET stage = 'Hijacked', data = ? WHERE id = ?",
        JSON.stringify(data),
        negotiation.id,
      );
      await news(
        store,
        "Transfers",
        `${player.name}: rival bid intervenes`,
        "The agent has paused your discussions in favour of a rival proposal.",
        "warning",
        "transfers",
      );
    } else if (settings.directorDrama && !data.sabotage) {
      data.sabotage = true;
      data.log.push({
        date: state.date,
        type: "Internal dispute",
        message:
          "An internal rival questioned the recruitment plan in the press.",
      });
      await store.run(
        "UPDATE negotiations SET tension = LEAST(99,tension + 18), interest = GREATEST(0,interest - 10), data = ? WHERE id = ?",
        JSON.stringify(data),
        negotiation.id,
      );
      await news(
        store,
        "Staff",
        "An internal dispute complicates talks",
        "A disagreement over the recruitment strategy has reached the agent. Confidence in the proposal has fallen.",
        "warning",
        "staff",
      );
    }
  }
}

export async function worldTransfers(store: Store, random: seedrandom.PRNG) {
  const state = await stateOf(store);
  const activity = { completed: 0, offers: 0 };
  if (
    !transferWindow(state.date) ||
    (
      await store.get<{ value: string }>(
        "SELECT value FROM meta WHERE [key] = 'lastMarketDate'",
      )
    )?.value === JSON.stringify(state.date)
  )
    return activity;
  await store.setMeta("lastMarketDate", state.date);
  const clubCount = (await store.get<{ total: number }>(
    "SELECT count(*) AS total FROM clubs WHERE type = 'club'",
  ))!.total;
  const deadlineWeek =
    ((state.date.slice(5, 7) === "08" || state.date.slice(5, 7) === "01") &&
      Number(state.date.slice(8)) >= 25) ||
    state.date.slice(5) === "09-01";
  const quota = Math.max(
    1,
    Math.round(
      clamp(clubCount / 250, 1, 30) *
        (deadlineWeek ? 1.6 : state.date.slice(5, 7) === "01" ? 0.8 : 1),
    ),
  );
  const maxId = (await store.get<{ id: number }>(
    "SELECT max(id) AS id FROM players",
  ))!.id;
  const userFamily = new Set(
    (await store.all<{ id: number }>("SELECT id FROM clubs WHERE id = ? OR parent_id = ?", state.clubId, state.clubId)).map((club) => club.id),
  );
  for (
    let index = 0;
    index < quota * 6 && activity.completed < quota;
    index++
  ) {
    const player = await store.get<Player>(
      "SELECT TOP (1) * FROM players WHERE id >= ? AND club_id IS NOT NULL AND parent_club_id IS NULL AND age BETWEEN 18 AND 31 AND age_group = 'Senior' AND role != 'Retired' AND contract_end > ? AND (injury_until IS NULL OR injury_until <= ?) AND NOT EXISTS (SELECT 1 FROM negotiations WHERE negotiations.player_id = players.id AND stage NOT IN ('Completed','Rejected','Withdrawn','Expired','Hijacked')) AND NOT EXISTS (SELECT 1 FROM history WHERE entity_type = 'transfer' AND entity_id = players.id AND date >= ?) ORDER BY id",
      Math.floor(random() * maxId),
      state.date,
      state.date,
      addDays(state.date, -90),
    );
    if (!player || userFamily.has(player.club_id!) || player.value <= 0)
      continue;
    const fee = Math.round(player.value * (0.95 + random() * 0.15));
    const minimumWage = Math.round(player.wage * 1.1);
    const buyers = await store.all<Club>(
      "SELECT TOP (8) * FROM clubs WHERE type = 'club' AND id NOT IN (?,?) AND reputation BETWEEN ? AND ? AND transfer_budget > ? AND balance > ? AND wage_budget > (SELECT coalesce(sum(wage),0) FROM players WHERE players.club_id = clubs.id) + ? AND (SELECT count(*) FROM players WHERE players.club_id = clubs.id AND age_group = 'Senior' AND role != 'Retired') < 28 ORDER BY (SELECT count(*) FROM players WHERE players.club_id = clubs.id AND players.position = ? AND age_group = 'Senior'),abs(reputation - ?),id",
      player.club_id!,
      state.clubId,
      Math.max(1, player.ability - 12),
      player.ability + 14,
      fee,
      fee,
      minimumWage,
      player.position,
      player.ability + random() * 10,
    );
    let buyer: Club | undefined;
    let newWage = 0;
    if (buyers.length) {
      const seller = await store.get<Club>("SELECT * FROM clubs WHERE id = ?", player.club_id);
      const profile = JSON.parse(player.profile) as PlayerProfile;
      for (const candidate of buyers) {
        // The player must want the move: below 50% he refuses; the buyer pays up to 1.5x his expectation to reach 85%.
        // His expectation is his wage + 10% or the buyer's going rate for his level, whichever is higher.
        const moveScore = marketMoveInterest(player, profile, candidate, seller, state.date);
        if (moveScore < MOVE_REFUSAL_THRESHOLD) continue;
        const wage = marketWageOffer(player.wage, moveScore, await buyerGoingRate(store, player, candidate));
        if (
          wage !== null &&
          (await weeklyWages(store, candidate.id)) + wage <=
            candidate.wage_budget &&
          (await assessRegistration(store, player, candidate)).allowed
        ) {
          buyer = candidate;
          newWage = wage;
          break;
        }
      }
    }
    if (!buyer) continue;
    if (!(await sellerCanRelease(store, player, state.date))) continue;
    // A shortlisted target is not taken at once: the director is alerted and has time to compete.
    if (player.shortlisted) {
      await recordShortlistBid(store, player, buyer, fee, newWage);
      continue;
    }
    await executeMarketTransfer(
      store,
      player,
      buyer,
      fee,
      newWage,
      activity.completed < 2 ? `world:${player.id}:${state.date}` : undefined,
    );
    activity.completed++;
  }
  activity.completed += await signClublessPlayers(store, state, Math.max(1, Math.round(quota / 2)), random);
  const recentOffers = (await store.get<{ total: number }>(
    "SELECT count(*) AS total FROM negotiations WHERE selling_club_id = ? AND buying_club_id != ? AND created >= ?",
    state.clubId,
    state.clubId,
    addDays(state.date, -6),
  ))!.total;
  if (recentOffers >= (deadlineWeek ? 5 : 3)) return activity;
  const prospects = await store.all<Player>(
    "SELECT TOP (12) * FROM players WHERE club_id = ? AND parent_club_id IS NULL AND age >= 18 AND age_group = 'Senior' AND role != 'Retired' AND contract_end > ? AND (listed = 1 OR available_loan = 1 OR form >= 7.2 OR (age <= 23 AND potential - ability >= 8) OR contract_end <= ?) AND NOT EXISTS (SELECT 1 FROM negotiations WHERE negotiations.player_id = players.id AND (stage NOT IN ('Completed','Rejected','Withdrawn','Expired','Hijacked') OR created >= ?)) AND (listed = 1 OR available_loan = 1 OR NOT EXISTS (SELECT 1 FROM history WHERE history.entity_type = 'transfer' AND history.entity_id = players.id AND history.date >= ?)) ORDER BY listed DESC,available_loan DESC,form DESC,potential DESC,id",
    state.clubId,
    state.date,
    addDays(state.date, 365),
    addDays(state.date, -21),
    // No unsolicited bids in a signing's first year: a bought player cannot be flipped at once for a premium.
    addDays(state.date, -365),
  );
  for (const listed of prospects) {
    if (
      !listed.listed &&
      !listed.available_loan &&
      random() > (deadlineWeek ? 0.35 : 0.15)
    )
      continue;
    const isLoan = !listed.listed && !!listed.available_loan;
    if (isLoan && listed.contract_end < addDays(state.date, 365)) continue;
    const fee = Math.round(
      listed.value *
        (isLoan
          ? 0.03
          : listed.listed
            ? 0.88 + random() * 0.16
            : 1 + random() * 0.1),
    );
    const interested = await store.all<Club>(
      "SELECT TOP (10) * FROM clubs WHERE id != ? AND type = 'club' AND transfer_budget > ? AND balance > ? AND reputation BETWEEN ? AND ? AND (SELECT count(*) FROM players WHERE players.club_id = clubs.id AND age_group = 'Senior' AND role != 'Retired') < 28 ORDER BY abs(reputation - ?),id",
      state.clubId,
      fee,
      fee,
      Math.max(1, listed.ability - 20),
      listed.ability + 20,
      listed.ability + (isLoan ? -5 : 3),
    );
    let buyer: Club | undefined;
    let offeredWage = 0;
    for (const candidate of interested) {
      // A permanent bidder offers a raise or its own going rate for the player's level, whichever is higher.
      const wage = isLoan
        ? listed.wage
        : Math.max(Math.round(listed.wage * 1.15), await buyerGoingRate(store, listed, candidate));
      if (
        (await weeklyWages(store, candidate.id)) +
          (isLoan ? listed.wage * 0.7 : wage) <=
          candidate.wage_budget &&
        (await assessRegistration(store, listed, candidate)).allowed
      ) {
        buyer = candidate;
        offeredWage = wage;
        break;
      }
    }
    if (buyer) {
      const profile = JSON.parse(listed.profile) as PlayerProfile;
      const terms = defaultLoanTerms(listed, buyer);
      // The player's real view of the move, so the director knows before accepting whether he may refuse terms.
      const interestDetails = await assessPlayerInterest(store, listed, buyer, {
        loan: isLoan,
        role: "Regular starter",
        wage: offeredWage,
        playingTime: isLoan ? terms.playingTime : undefined,
      });
      const data = {
        workflowVersion: 2,
        interestDetails,
        log: [
          {
            date: state.date,
            type: "Offer",
            message: `${buyer.name} have submitted a formal ${isLoan ? "loan" : "transfer"} offer.`,
          },
        ],
        agent: profile.agent,
        years: listed.age < 18 ? 3 : 4,
        role: "Regular starter",
        promises: [],
        terms,
      };
      const inserted = await store.run(
        "INSERT INTO negotiations(player_id, buying_club_id, selling_club_id, type, stage, asking_price, offer, wage, interest, created, deadline, data) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        listed.id,
        buyer.id,
        state.clubId,
        isLoan ? "Development loan" : "Permanent transfer",
        "Offer received",
        isLoan ? fee : listed.value,
        fee,
        offeredWage,
        interestDetails.score,
        state.date,
        addDays(state.date, 7),
        JSON.stringify(data),
      );
      await news(
        store,
        "Transfers",
        `An offer for ${listed.name}`,
        `${buyer.name} have made a proposal. The decision is yours.`,
        "important",
        "transfers",
        {
          playerId: listed.id,
          clubId: buyer.id,
          fee,
          unsolicited: !listed.listed && !listed.available_loan,
        },
      );
      await publishTransferStory(store, {
        key: `negotiation:${inserted.lastInsertRowid}:bid`,
        phase: "bid",
        playerId: listed.id,
        buyerId: buyer.id,
        sellerId: state.clubId,
        fee,
        loan: isLoan,
        negotiationId: Number(inserted.lastInsertRowid),
      });
      activity.offers++;
      break;
    }
  }
  return activity;
}

/**
 * League merit payments by final position (senior leagues, before promotion and relegation), credited to cash.
 * Returns each club's expected revenue in its final top-flight table (the base of a parachute payment).
 */
async function payLeaguePrizeMoney(
  store: Store,
  userClubId: number,
  season: number,
  leagues: League[],
  tables: Map<number, Standing[]>,
) {
  const clubs = new Map(
    (
      await store.all<Pick<Club, "id" | "reputation" | "capacity" | "country_id">>(
        "SELECT id,reputation,capacity,country_id FROM clubs WHERE type != 'national'",
      )
    ).map((club) => [club.id, club]),
  );
  const codes = new Map(
    (await store.all<{ id: number; code: string }>("SELECT id, code FROM countries")).map((row) => [row.id, row.code]),
  );
  const payments: Record<string, number>[] = [];
  const topFlight = new Map<number, number>();
  for (const league of leagues) {
    if (league.age_group !== "Senior") continue;
    const table = tables.get(league.id) ?? [];
    table.forEach((row, index) => {
      const club = clubs.get(row.club_id);
      if (!club) return;
      const revenue = estimateClubRevenue({
        reputation: club.reputation,
        leagueReputation: league.reputation,
        tier: league.tier,
        capacity: club.capacity,
        fanMood: 72,
        homeMatches: Math.max(0, table.length - 1) + 2,
        countryCode: codes.get(league.country_id ?? club.country_id),
      }).annualOperatingRevenue;
      if (league.tier === 1) topFlight.set(club.id, revenue);
      const prize = leaguePrizeMoney(index + 1, table.length, revenue);
      if (prize > 0) payments.push({ id: club.id, amount: prize, position: index + 1, league: league.id });
    });
  }
  await updateSimulationRows(store, "clubs", payments, "id int,amount float", "balance = target.balance + changes.amount");
  const own = payments.find((payment) => payment.id === userClubId);
  if (own) {
    await store.run(
      "INSERT INTO ledger(club_id, date, category, amount, description) VALUES (?, ?, ?, ?, ?)",
      userClubId,
      (await stateOf(store)).date,
      "League prize money",
      own.amount,
      `Merit payment for finishing ${own.position}${own.position === 1 ? "st" : own.position === 2 ? "nd" : own.position === 3 ? "rd" : "th"}`,
    );
    await recordFinancialItem(store, userClubId, "revenue", own.amount, season + 1);
  }
  return topFlight;
}

/** England's Premier League parachute: paid each summer after relegation until it runs out or the club goes back up. */
async function payParachutes(store: Store, userClubId: number, season: number) {
  const date = (await stateOf(store)).date;
  for (const club of await store.all<{ id: number; tier: number | null; parachute: string }>(
    "SELECT clubs.id,leagues.tier,JSON_QUERY(clubs.data,'$.parachute') AS parachute FROM clubs LEFT JOIN leagues ON leagues.id = clubs.league_id WHERE JSON_QUERY(clubs.data,'$.parachute') IS NOT NULL",
  )) {
    const plan = JSON.parse(club.parachute) as { code: string; first: number; seasons: number; revenue: number };
    const amount = club.tier === 1 ? 0 : parachutePayment(plan.code, season - plan.first + 1, plan.seasons, plan.revenue);
    if (amount <= 0) {
      await store.run("UPDATE clubs SET data = JSON_MODIFY(data,'$.parachute',NULL) WHERE id = ?", club.id);
      continue;
    }
    await store.run("UPDATE clubs SET balance = balance + ? WHERE id = ?", amount, club.id);
    if (club.id === userClubId) {
      await store.run(
        "INSERT INTO ledger(club_id, date, category, amount, description) VALUES (?, ?, ?, ?, ?)",
        club.id,
        date,
        "Parachute payment",
        amount,
        `Premier League parachute payment, season ${season - plan.first + 1} after relegation`,
      );
      await recordFinancialItem(store, club.id, "revenue", amount, season);
    }
  }
}

/**
 * Next season's budgets (finance.ts `seasonBudgets`): 40% of cash less reserved deals and every unpaid instalment,
 * wage budget back to the operating reference, both scaled by promotion/relegation; the new wage budget becomes the
 * reference. Warns the user's board when cash is negative.
 */
async function resetSeasonBudgets(store: Store, userClubId: number) {
  const rows = await store.all<{
    id: number;
    balance: number;
    wage_budget: number;
    wage_reference: number | null;
    movement: string | null;
    reserved: number;
    owed: number;
  }>(
    "SELECT clubs.id,clubs.balance,clubs.wage_budget,TRY_CONVERT(float,JSON_VALUE(coalesce(clubs.data,'{}'),'$.operatingWageBudget')) AS wage_reference,JSON_VALUE(coalesce(clubs.data,'{}'),'$.budgetMovement') AS movement,coalesce(reserved.total,0) AS reserved,coalesce(owed.total,0) AS owed FROM clubs OUTER APPLY (SELECT sum(TRY_CONVERT(float,JSON_VALUE(negotiations.data,'$.reservedBudget'))) AS total FROM negotiations WHERE negotiations.buying_club_id = clubs.id AND negotiations.stage IN ('Scheduled','Medical','Registration')) AS reserved OUTER APPLY (SELECT sum(transfer_payments.amount) AS total FROM transfer_payments WHERE transfer_payments.payer_id = clubs.id AND transfer_payments.paid_date IS NULL) AS owed WHERE clubs.type != 'national'",
  );
  const updates = rows.map((row) => {
    const movement = row.movement && row.movement in MOVEMENT_BUDGET_FACTOR ? (row.movement as keyof typeof MOVEMENT_BUDGET_FACTOR) : "none";
    const budgets = seasonBudgets({
      balance: row.balance,
      reserved: row.reserved,
      owedInstalments: row.owed,
      wageReference: row.wage_reference ?? row.wage_budget,
      movement,
    });
    return { id: row.id, transfer_budget: budgets.transferBudget, wage_budget: budgets.wageBudget };
  });
  await updateSimulationRows(
    store,
    "clubs",
    updates,
    "id int,transfer_budget float,wage_budget float",
    "transfer_budget = changes.transfer_budget, wage_budget = changes.wage_budget, data = JSON_MODIFY(JSON_MODIFY(coalesce(target.data,'{}'),'$.operatingWageBudget',changes.wage_budget),'$.budgetMovement',NULL)",
  );
  const own = rows.find((row) => row.id === userClubId);
  if (own && own.balance < 0)
    await news(
      store,
      "Finance",
      "Board warning: the club is in the red",
      "The season starts with a negative cash balance. There is no transfer budget, transfer fees cannot be paid until the accounts are back in credit, and the board expects sales or wage savings.",
      "warning",
      "finances",
    );
}

export async function seasonRollover(store: Store) {
  return store.transaction(async () => {
    const state = await stateOf(store);
    const oldSeason = state.season;
    // Called-up players return before the youth cycle recomputes age groups.
    await endAllCallUps(store);
    await closeFinancialYear(store, oldSeason);
    const financialReview = await assessFinances(store, state.clubId);
    if ((await settingsOf(store)).ffp && financialReview.status === "review") {
      await news(
        store,
        "Finance",
        "Year-end financial review",
        `${financialReview.policy}: ${financialReview.issues.join(" ")} Further discretionary spending is subject to the board's recovery plan.`,
        "warning",
        "finances",
      );
      await store.run(
        "UPDATE clubs SET board_confidence = GREATEST(0,board_confidence - 8), board_pressure = LEAST(100,board_pressure + 12) WHERE id = ?",
        state.clubId,
      );
    }
    await recordAssociationCoefficients(store, oldSeason, state.date);
    await store.run(
      "UPDATE discipline SET yellow_cards = 0 WHERE season <= ?",
      oldSeason,
    );
    const random = seedrandom(`${state.seed}:season:${oldSeason + 1}`);
    const tables = new Map<number, Standing[]>();
    for (const entry of await store.all<Standing>(
      "SELECT * FROM standings ORDER BY league_id,points DESC,(gf-ga) DESC,gf DESC,club_id",
    )) {
      const table = tables.get(entry.league_id) ?? [];
      table.push(entry);
      tables.set(entry.league_id, table);
    }
    // Play-offs still open at rollover continue by seed from their current round.
    const playoffResults = new Map<number, Map<string, PlayoffResult>>();
    const champions = new Map<number, number>();
    for (const competition of await store.all<League>(
      "SELECT * FROM leagues WHERE kind = 'cup' AND JSON_VALUE(data,'$.key') IS NOT NULL AND TRY_CONVERT(int, JSON_VALUE(data,'$.season')) = ?",
      oldSeason,
    )) {
      const playoff = JSON.parse(competition.data) as PlayoffData;
      if (playoff.key === "title") {
        const champion =
          playoff.champion ??
          (playoff.miniLeague
            ? rankTable(tables.get(competition.id) ?? [])[0]?.club_id
            : playoff.state && resolvePlayoffBySeed(playoff.state).winners[0]);
        if (champion) champions.set(playoff.leagueId, champion);
      } else if (playoff.state) {
        const results = playoffResults.get(competition.country_id!) ?? new Map<string, PlayoffResult>();
        results.set(playoff.key, playoff.state.result ?? resolvePlayoffBySeed(playoff.state));
        playoffResults.set(competition.country_id!, results);
      }
    }
    const lastHistoryId = (await store.get<{ id: number }>(
      "SELECT coalesce(max(id),0) AS id FROM history WITH (UPDLOCK,HOLDLOCK)",
    ))!.id;
    const leagueRows = await store.all<League>(
      "SELECT * FROM leagues WHERE kind = 'league' ORDER BY id",
    );
    // Final tables use each league's tiebreakers; head-to-head criteria need the season's results.
    const criteria = new Map(leagueRows.map((league) => [league.id, readLeagueData(league.data, league.tier).tiebreakers]));
    const headToHead = [...criteria].filter(([, list]) => needsHeadToHead(list)).map(([id]) => id);
    const leagueResults = new Map<number, LeagueResult[]>();
    if (headToHead.length)
      for (const row of await store.all<LeagueResult & { league_id: number }>(
        "SELECT league_id,home_id,away_id,home_goals,away_goals FROM fixtures WHERE season = ? AND status = 'played' AND league_id IN (SELECT [id] FROM OPENJSON(?) WITH ([id] INT '$'))",
        oldSeason,
        JSON.stringify(headToHead),
      ))
        leagueResults.set(row.league_id, [...(leagueResults.get(row.league_id) ?? []), row]);
    const rankedTables = new Map(
      leagueRows.map((league) => [
        league.id,
        rankTable(tables.get(league.id) ?? [], JSON.parse(league.data).split, {
          tiebreakers: criteria.get(league.id),
          results: leagueResults.get(league.id),
        }),
      ]),
    );
    const archives = leagueRows.map((league, index) => ({
      id: lastHistoryId + index + 1,
      season: oldSeason,
      entity_type: "league",
      entity_id: league.id,
      date: state.date,
      data: JSON.stringify({
        name: league.name,
        table: rankedTables.get(league.id),
        ...(champions.has(league.id) ? { champion: champions.get(league.id) } : {}),
      }),
    }));
    for (let offset = 0; offset < archives.length; offset += 1000)
      await store.bulkInsert("history", archives.slice(offset, offset + 1000));
    const topFlightRevenue = await payLeaguePrizeMoney(store, state.clubId, oldSeason, leagueRows, rankedTables);
    const shortfalls: Record<number, number> = {};
    for (const country of await store.all<Country>(
      "SELECT * FROM countries ORDER BY id",
    )) {
      const pyramid = await countryPyramid(store, country.id, oldSeason);
      const countryShortfalls = new Map<number, number>();
      const planned = planMovement(
        {
          ...pyramid,
          results: playoffResults.get(country.id),
        },
        countryShortfalls,
      );
      for (const [leagueId, short] of countryShortfalls) shortfalls[leagueId] = short;
      // A B-team with no legal modeled tier is parked: squad and registrations stay, no league place until its
      // parent's division allows it back into the league it left.
      for (const move of planned.filter((item) => item.reason === "parked" || item.reason === "readmitted")) {
        const parked = move.reason === "parked";
        if (parked) {
          await store.run("DELETE FROM standings WHERE league_id = ? AND club_id = ?", move.from, move.clubId);
          await store.run(
            "UPDATE clubs SET league_id = NULL, data = JSON_MODIFY(data,'$.parkedLeagueId',CAST(? AS int)) WHERE id = ?",
            move.parkedIn ?? move.from,
            move.clubId,
          );
        } else {
          await store.run(
            "INSERT INTO standings(league_id,club_id) SELECT source.league_id,source.club_id FROM (VALUES (?,?)) AS source(league_id,club_id) WHERE NOT EXISTS (SELECT 1 FROM standings WITH (UPDLOCK,HOLDLOCK) WHERE standings.league_id = source.league_id AND standings.club_id = source.club_id)",
            move.to,
            move.clubId,
          );
          await store.run(
            "UPDATE clubs SET league_id = ?, data = JSON_MODIFY(data,'$.parkedLeagueId',NULL) WHERE id = ?",
            move.to,
            move.clubId,
          );
        }
        const owner = await store.get<{ parent_id: number | null }>("SELECT parent_id FROM clubs WHERE id = ?", move.clubId);
        if (owner?.parent_id === state.clubId)
          await news(
            store,
            "Club",
            parked ? "B-team withdrawn from league play" : "B-team re-admitted",
            parked
              ? "With the first team now in its division and no lower league available, the B-team plays no league football this season. Its squad and registrations are unchanged; it returns once the first team goes up."
              : "The first team's promotion lets the B-team return to its league this season.",
            parked ? "warning" : "success",
            "competitions",
          );
      }
      const moves = planned.filter((move) => move.from !== null && move.to !== null);
      for (const tier of pyramid.tiers)
        if (JSON.parse(pyramid.leagues.find((league) => league.id === tier.leagueId)!.data).split)
          await store.run("UPDATE standings SET group_name = '' WHERE league_id = ?", tier.leagueId);
      for (const move of moves) {
        const club = move.clubId;
        const to = move.to!;
        await store.run(
          "DELETE FROM standings WHERE league_id = ? AND club_id = ?",
          move.from,
          club,
        );
        await store.run(
          "INSERT INTO standings(league_id,club_id) SELECT source.league_id,source.club_id FROM (VALUES (?,?)) AS source(league_id,club_id) WHERE NOT EXISTS (SELECT 1 FROM standings WITH (UPDLOCK,HOLDLOCK) WHERE standings.league_id = source.league_id AND standings.club_id = source.club_id)",
          to,
          club,
        );
        // Budgets are reset once, after every move (seasonBudgets); the flag carries the movement factor there.
        await store.run(
          "UPDATE clubs SET league_id = ?, reputation = LEAST(99,GREATEST(1,reputation + ?)), data = JSON_MODIFY(coalesce(data,'{}'),'$.budgetMovement',?), fan_mood = LEAST(99,GREATEST(1,fan_mood + ?)) WHERE id = ?",
          to,
          move.promoted ? 4 : -4,
          move.promoted ? "promoted" : "relegated",
          move.promoted ? 15 : -15,
          club,
        );
        const fromTier = pyramid.leagues.find((league) => league.id === move.from)?.tier;
        if (!move.promoted && fromTier === 1 && parachutePayment(country.code, 1, 1, 1_000_000) > 0) {
          const seasons = (await store.get<{ total: number }>(
            "SELECT count(*) AS total FROM history WHERE entity_type = 'league' AND entity_id = ? AND data LIKE ?",
            move.from,
            `%"club_id":${club}[,}]%`,
          ))!.total;
          await store.run(
            "UPDATE clubs SET data = JSON_MODIFY(coalesce(data,'{}'),'$.parachute',JSON_QUERY(?)) WHERE id = ?",
            JSON.stringify({ code: country.code, first: oldSeason + 1, seasons, revenue: topFlightRevenue.get(club) ?? 0 }),
            club,
          );
        }
        if (club === state.clubId)
          await news(
            store,
            "Club",
            move.promoted ? "Promotion secured" : "Relegation confirmed",
            move.promoted
              ? "A new division brings greater revenue and expectations."
              : "Relegation has reduced revenue, reputation and the available budget.",
            move.promoted ? "success" : "warning",
            "competitions",
          );
      }
      const shift = (random() - 0.48) * 1.5;
      await store.run(
        "UPDATE countries SET reputation = LEAST(99,GREATEST(10,reputation + ?)) WHERE id = ?",
        shift,
        country.id,
      );
      await store.run(
        "UPDATE leagues SET reputation = LEAST(99,GREATEST(10,reputation + ?)) WHERE country_id = ?",
        shift,
        country.id,
      );
    }
    // Read by the simulation check: boundaries that moved fewer clubs than their spec, per upper league.
    await store.setMeta("movementAudit", { season: oldSeason + 1, shortfalls });
    await payParachutes(store, state.clubId, oldSeason + 1);
    await store.run(
      "UPDATE standings SET played = 0, wins = 0, draws = 0, losses = 0, gf = 0, ga = 0, points = 0, xg = 0, xga = 0, xpts = 0, form = '', home_record = '0-0-0', away_record = '0-0-0', deducted = 0",
    );
    // Age groups follow the age at the season start: U17 until 17, U19 until 19.
    const ageCutoff = (years: number) =>
      `${Number(state.date.slice(0, 4)) - years}${state.date.slice(4)}`;
    await store.run(
      "UPDATE players SET age_group = CASE WHEN birth_date <= ? THEN 'Senior' WHEN birth_date <= ? AND age_group = 'U17' THEN 'U19' ELSE age_group END, appearances = 0, minutes = 0, goals = 0, assists = 0 WHERE role != 'Retired'",
      ageCutoff(19),
      ageCutoff(17),
    );
    await store.run(
      "UPDATE clubs SET season_spend = 0, income = 0, spending = 0, board_confidence = LEAST(90,board_confidence + 5), momentum = 0, crisis = 0, hype = 0 WHERE type != ?",
      "national",
    );
    await resetSeasonBudgets(store, state.clubId);
    const intake = await runYouthIntake(store, oldSeason + 1, state.date, random);
    const latest = await stateOf(store);
    latest.season = oldSeason + 1;
    latest.worldTrend = [
      "High press",
      "Possession",
      "Counter attack",
      "Direct",
      "Balanced",
    ][Math.floor(random() * 5)];
    await store.setMeta("state", latest);
    await store.setMeta("lastIntake", {
      date: state.date,
      count: intake.created,
      academy: intake.academy,
      topUps: intake.topUps,
      pools: intake.pools,
      retired: intake.retired,
      leftFootball: intake.leftFootball,
    });
    await news(
      store,
      "World",
      `Welcome to ${latest.season}/${String(latest.season + 1).slice(-2)}`,
      `${intake.academy.toLocaleString("en-US")} academy players aged 14-15 and ${intake.pools.toLocaleString("en-US")} home-based youngsters have entered the world, and ${intake.retired.toLocaleString("en-US")} players have retired. Promotions, relegations, league reputations and club budgets have been updated.`,
      "success",
      "academy",
    );
    await pruneSeason(store, oldSeason, state.date);
  });
}

async function weeklyUpdate(store: Store) {
  const state = await stateOf(store);
  state.week++;
  await store.setMeta("state", state);
  const random = seedrandom(`${state.seed}:week:${state.week}`);
  // Pre-scoping saves: cautions and bans under the shared `country:age group:kind` scopes can no longer be served.
  await store.run("DELETE FROM discipline WHERE scope LIKE ?", LEGACY_DISCIPLINE_SCOPE);
  await developPlayers(store, random);
  await reviewLoans(store);
  await weeklyFinances(store);
  await weeklyStaffAndPolitics(store, random);
  await checkPromises(store);
  const settings = await settingsOf(store);
  if (settings.ultraYouth)
    await store.run(
      "UPDATE players SET development_bank = development_bank + 0.06 WHERE age < 21 AND role != 'Retired'",
    );
  if (state.week % 13 === 0) {
    const latest = await stateOf(store);
    latest.worldTrend = [
      "High press",
      "Possession",
      "Counter attack",
      "Direct",
      "Balanced",
    ][Math.floor(random() * 5)];
    await store.setMeta("state", latest);
    await store.run(
      "UPDATE clubs SET tactical_style = ? WHERE type = 'club' AND id % 13 = ? AND id != ?",
      latest.worldTrend,
      state.week % 13,
      state.clubId,
    );
    await news(
      store,
      "World",
      `Tactical trend: ${latest.worldTrend.toLowerCase()}`,
      "More clubs are recruiting for this approach. Tactical fit and the value of suitable profiles are shifting.",
      "info",
      "scouting",
    );
  }
  await experience(store, 10);
}

export async function advance(store: Store, days: number) {
  if (!Number.isInteger(days) || days < 1 || days > 28)
    throw new GameError("Advance between one and 28 days.");
  if ((await stateOf(store)).gameOver)
    throw new GameError(
      "Your tenure has ended. Accept another club role to continue.",
    );
  await createCalendar(store);
  const started = performance.now();
  const from = (await stateOf(store)).date;
  let played = 0;
  for (let day = 0; day < days; day++) {
    let rollover = false;
    await store.transaction(async () => {
      const state = await stateOf(store);
      state.date = addDays(state.date, 1);
      state.started = true;
      await store.setMeta("state", state);
      const random = seedrandom(`${state.seed}:day:${state.date}`);
      await store.run(
        "UPDATE players SET fitness = LEAST(99,fitness + CASE WHEN injury_until IS NULL THEN 3.5 ELSE 0.8 END), injury_until = CASE WHEN injury_until <= ? THEN NULL ELSE injury_until END WHERE fitness < 99 OR injury_until IS NOT NULL",
        state.date,
      );
      await processMinorApplications(store);
      await processNegotiations(store, random);
      // After expiries (so closed talks hand their rivals to the market) and before the world market.
      await processTransferBattles(store);
      await processTransferPayments(store);
      await processAffiliateRequests(store);
      await processUnexpectedEvents(store);
      // AI squads keep their minimums (first team 25, B-team and youth 20; two goalkeepers) between windows too; self-throttles to weekly.
      await maintainSquads(store, state);
      await worldTransfers(store, random);
      await finishScouting(store);
      // The coach calls up/returns players of the user's club family before today's fixtures.
      await processCallUps(store);
      // National squads for fixtures in the next days; players away are unavailable to their clubs.
      await processInternationalDuty(store);
      const fixtures = await store.all<Fixture>(
        "SELECT * FROM fixtures WHERE date <= ? AND season = ? AND status = 'scheduled' ORDER BY date, id",
        state.date,
        state.season,
      );
      const family = new Set(
        (
          await store.all<{ id: number }>(
            "SELECT id FROM clubs WHERE id = ? OR parent_id = ?",
            state.clubId,
            state.clubId,
          )
        ).map((club) => club.id),
      );
      const followed = fixtures.filter((fixture) => followsFixture(fixture, family));
      for (const fixture of followed) await playFixture(store, fixture);
      for (const fixture of await playFixtureBatch(
        store,
        fixtures.filter((fixture) => !followed.includes(fixture)),
      ))
        await playFixture(store, fixture);
      played += fixtures.length;
      await dailyMedia(store);
      await expireLoans(store);
      await progressCompetitions(store, state.date);
      await processCompetitionNotifications(store);
      if (daysBetween("2026-07-01", state.date) % 7 === 0)
        await weeklyUpdate(store);
      await processAssistant(store);
      await processStaffCareers(store);
      if (
        state.date.slice(5) === "07-01" &&
        Number(state.date.slice(0, 4)) > state.season
      ) {
        await seasonRollover(store);
        rollover = true;
      }
      if (deadlineDay(state.date))
        await news(
          store,
          "Transfers",
          "Deadline day",
          "The registration window closes tonight. Clubs, agents and journalists are moving quickly; incomplete medicals may leave deals waiting for the next window.",
          "important",
          "transfers",
        );
      if (
        internationalBreak(state.date) &&
        !internationalBreak(addDays(state.date, -1))
      )
        await news(
          store,
          "World",
          "International break begins",
          "Domestic league fixtures pause. National-team and youth tournament commitments may affect fitness and development.",
          "info",
          "competitions",
        );
      const expired = await store.all<Player>(
        "SELECT TOP (1000) * FROM players WHERE contract_end < ? AND club_id IS NOT NULL AND parent_club_id IS NULL AND role != 'Retired' ORDER BY id",
        state.date,
      );
      await updateSimulationRows(
        store,
        "players",
        expired.map((player) => ({ id: player.id })),
        "id int",
        "profile = JSON_MODIFY(JSON_MODIFY(target.profile,'$.registration',JSON_QUERY(coalesce(JSON_QUERY(target.profile,'$.registration'),N'{}'))),'$.registration.lastAssociationId',(SELECT CASE WHEN JSON_VALUE(clubs.data,'$.hosted.registration') = 'host' THEN coalesce((SELECT id FROM countries WHERE code = JSON_VALUE(clubs.data,'$.hosted.host')),clubs.country_id) ELSE clubs.country_id END FROM clubs WHERE clubs.id = target.club_id)), club_id = NULL, squad_club_id = NULL, wage = 0, value = 100, listed = 0, available_loan = 0, role = 'Free agent'",
      );
      for (const player of expired) {
        if (player.club_id !== null && family.has(player.club_id))
          await news(
            store,
            "Transfers",
            `${player.name}: contract expired`,
            "The player has left on a free transfer. The wage commitment has ended.",
            "warning",
            "squad",
          );
      }
    });
    if (rollover) await createCalendar(store);
    if ((await stateOf(store)).gameOver) break;
  }
  return {
    from,
    date: (await stateOf(store)).date,
    days: daysBetween(from, (await stateOf(store)).date),
    matches: played,
    seconds: round((performance.now() - started) / 1000, 2),
  };
}
