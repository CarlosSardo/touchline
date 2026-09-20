import seedrandom from "seedrandom";
import { Store } from "./db.ts";
import { createCalendar, progressCompetitions } from "./calendar.ts";
import { simulateMatch } from "./match.ts";
import { generatePlayers, personName } from "./world.ts";
import {
  clubOf,
  completeNegotiation,
  defaultLoanTerms,
  experience,
  expireLoans,
  finishScouting,
  GameError,
  ledger,
  news,
  playerOf,
  reviewLoans,
  settingsOf,
  stateOf,
  transferProceeds,
} from "./systems.ts";
import {
  addDays,
  ageOn,
  clamp,
  daysBetween,
  internationalBreak,
  potentialInfluences,
  round,
  tacticalFit,
  transferWindow,
  valuation,
  WORLD_COUNTS,
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

export function matchTeam(
  store: Store,
  club: Club,
  ageGroup: AgeGroup,
  date: string,
): MatchTeam {
  const ageLimit =
    ageGroup === "U17"
      ? 17
      : ageGroup === "U19"
        ? 19
        : ageGroup === "U20"
          ? 20
          : 100;
  const eligible = store.all<Player & { confidence: number }>(
    `SELECT *, json_extract(profile,'$.mentalHealth.confidence') AS confidence FROM players WHERE ${club.type === "national" ? "country_id" : "club_id"} = ? AND age < ? AND role != 'Retired' AND (injury_until IS NULL OR injury_until <= ?) ORDER BY ability + fitness * 0.3 + CASE role WHEN 'Key player' THEN 5 WHEN 'Captain' THEN 6 WHEN 'Regular starter' THEN 3 ELSE 0 END + coalesce((SELECT json_extract(terms,'$.playingTime') / 15.0 FROM loans WHERE loans.player_id = players.id AND loans.status = 'active'),0) DESC LIMIT 60`,
    club.type === "national" ? club.country_id : club.id,
    ageLimit,
    date,
  );
  const lineup: MatchPlayer[] = [];
  for (const position of formations[club.formation] ?? formations["4-3-3"]) {
    const available = eligible.filter(
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
    const profile = JSON.parse(player.profile) as PlayerProfile;
    const fit =
      player.position === position
        ? 1
        : player.secondary_position === position
          ? 0.94
          : 0.8;
    lineup.push({
      id: player.id,
      name: player.name,
      position,
      ability: round(player.ability * fit),
      fitness: player.fitness,
      confidence: player.confidence,
      traits: profile.traits,
      pressureHandling: profile.personality.pressureHandling,
      consistency: profile.personality.consistency,
      height: profile.identity.height,
      attributes: {
        passing: profile.attributes.technical.passing,
        finishing: profile.attributes.technical.finishing,
        dribbling: profile.attributes.technical.dribbling,
        stamina: profile.attributes.physical.stamina,
        reflexes: profile.attributes.goalkeeper.reflexes,
        positioning: profile.attributes.tactical.positioning,
      },
    });
  }
  const setPieces = store.get<{
    routine: string;
    target: string;
    risk: number;
  }>("SELECT * FROM set_pieces WHERE club_id = ?", club.id) ?? {
    routine: "Near post",
    target: "Centre-back",
    risk: 50,
  };
  const staff = store.get<{ ability: number }>(
    "SELECT coalesce(avg(ability), 50) AS ability FROM staff WHERE club_id = ? AND role IN ('Assistant manager','Analyst','Set-piece coach')",
    club.id,
  )!;
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
    setPieces,
  };
}

function updateTable(store: Store, fixture: Fixture, result: MatchResult) {
  if (!fixture.league_id) return;
  const statement = store.db.prepare(
    "UPDATE standings SET played = played + 1, wins = wins + ?, draws = draws + ?, losses = losses + ?, gf = gf + ?, ga = ga + ?, points = points + ?, xg = xg + ?, xga = xga + ?, xpts = xpts + ?, form = ?, home_record = ?, away_record = ? WHERE league_id = ? AND club_id = ?",
  );
  for (const home of [true, false]) {
    const clubId = home ? fixture.home_id : fixture.away_id;
    const own = home ? result.homeGoals : result.awayGoals;
    const against = home ? result.awayGoals : result.homeGoals;
    const entry = store.get<Standing>(
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
    statement.run(
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

function standingsConsequences(
  store: Store,
  club: Club,
  league: League,
  result: number,
  margin: number,
) {
  if (league.kind !== "league" || league.age_group !== "Senior") return;
  const state = stateOf(store);
  const settings = settingsOf(store);
  const table = store.all<Standing>(
    "SELECT * FROM standings WHERE league_id = ? ORDER BY points DESC, (gf-ga) DESC, gf DESC, club_id",
    league.id,
  );
  const position = table.findIndex((entry) => entry.club_id === club.id) + 1;
  const row = table[position - 1];
  if (!row) return;
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
  store.run(
    "UPDATE clubs SET momentum = ?, crisis = ?, hype = ?, board_pressure = ?, board_confidence = ?, fan_mood = ?, manager_trust = ?, reputation = min(99,max(1,reputation + ?)) WHERE id = ?",
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
  store.run(
    "UPDATE players SET morale = min(99,max(1,morale + ?)), value = value * ? WHERE club_id = ?",
    result * 2 - crisis / 100,
    1 + hype / 20000 - crisis / 18000,
    club.id,
  );
  if (club.id === state.clubId) {
    if (crisis >= 55 && club.crisis < 55)
      news(
        store,
        "Board",
        "An urgent board meeting",
        `The club is ${position}${position === 1 ? "st" : position === 2 ? "nd" : position === 3 ? "rd" : "th"} in the table. The board wants a recovery plan, and agents are questioning the squad's direction.`,
        "warning",
        "board",
      );
    if (crisis >= 75 && club.crisis < 75)
      news(
        store,
        "Fans",
        "Supporters demand a response",
        "Organised supporters are planning a protest. Media criticism, transfer requests and pressure on the manager are intensifying.",
        "warning",
        "media",
      );
    if (hype >= 60 && club.hype < 60)
      news(
        store,
        "Fans",
        "Belief is building",
        "The winning run has lifted expectations. Targets are more interested, but market prices and the pressure to sustain results are rising.",
        "success",
        "competitions",
      );
  }
  if (streak === "LLLL") {
    store.run(
      "UPDATE clubs SET tactical_style = CASE tactical_style WHEN 'High press' THEN 'Counter attack' ELSE 'Balanced' END, chemistry = max(0,chemistry - 3) WHERE id = ?",
      club.id,
    );
    if (club.id === state.clubId)
      news(
        store,
        "Squad",
        "The manager changes approach",
        `${club.manager} has adjusted the tactical approach after four consecutive defeats. The squad needs time to adapt.`,
        "important",
        "squad",
      );
  }
}

export function playFixture(store: Store, fixture: Fixture) {
  if (fixture.status !== "scheduled") return;
  const state = stateOf(store);
  const settings = settingsOf(store);
  const homeClub = clubOf(store, fixture.home_id);
  const awayClub = clubOf(store, fixture.away_id);
  const league = fixture.league_id
    ? store.get<League>("SELECT * FROM leagues WHERE id = ?", fixture.league_id)
    : undefined;
  const ageGroup = league?.age_group ?? "Senior";
  const random = seedrandom(`${fixture.seed}:conditions`);
  const country = store.get<Country>(
    "SELECT * FROM countries WHERE id = ?",
    homeClub.country_id,
  )!;
  const latitudes: Record<string, number> = {
    EN: 52,
    ES: 40,
    DE: 51,
    FR: 47,
    IT: 43,
    PT: 39,
    NL: 52,
    BR: -12,
    AR: -34,
    AU: -25,
    NZ: -41,
    ZA: -29,
    JP: 36,
    US: 39,
    CA: 53,
    SA: 24,
    NO: 62,
    SE: 60,
    EG: 27,
  };
  const latitude =
    latitudes[country.code] ??
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
  const snapshot: MatchSnapshot = {
    rulesVersion: 2,
    home: matchTeam(store, homeClub, ageGroup, state.date),
    away: matchTeam(store, awayClub, ageGroup, state.date),
    weather,
    conditions: settings.weather ? conditions : undefined,
    importance:
      fixture.stage === "Final" ? 100 : league?.kind === "league" ? 65 : 78,
    detail: String(settings.matchDetail),
  };
  const result = simulateMatch(snapshot, fixture.seed, false);
  let winnerId: number | null =
    result.homeGoals > result.awayGoals
      ? fixture.home_id
      : result.awayGoals > result.homeGoals
        ? fixture.away_id
        : null;
  let penalties: { home: number; away: number } | null = null;
  if (
    !winnerId &&
    ["Qualifying", "Final", "Semi-final", "Quarter-final"]
      .concat(fixture.stage.startsWith("Round of") ? [fixture.stage] : [])
      .includes(fixture.stage)
  ) {
    const homeWins =
      random() < 0.5 + (snapshot.home.ability - snapshot.away.ability) / 200;
    const losing = 2 + Math.floor(random() * 3);
    penalties = {
      home: homeWins ? losing + 1 : losing,
      away: homeWins ? losing : losing + 1,
    };
    winnerId = homeWins ? fixture.home_id : fixture.away_id;
  }
  const payload = {
    snapshot,
    stats: result.stats,
    players: result.players,
    momentum: result.momentum,
    events: result.events,
    winnerId,
    penalties,
  };
  store.run(
    "UPDATE fixtures SET status = 'played', home_goals = ?, away_goals = ?, home_xg = ?, away_xg = ?, data = ? WHERE id = ? AND status = 'scheduled'",
    result.homeGoals,
    result.awayGoals,
    result.homeXg,
    result.awayXg,
    JSON.stringify(payload),
    fixture.id,
  );
  updateTable(store, fixture, result);
  const updatePlayer = store.db.prepare(
    "UPDATE players SET appearances = appearances + 1, minutes = minutes + ?, goals = goals + ?, assists = assists + ?, form = ?, fitness = max(25,fitness - ?), potential_bank = potential_bank + ? WHERE id = ?",
  );
  for (const team of [snapshot.home, snapshot.away]) {
    for (const player of team.lineup) {
      const stats = result.players[player.id];
      updatePlayer.run(
        stats.minutes,
        stats.goals,
        stats.assists,
        round(stats.rating),
        team.style === "High press" ? 20 : 15,
        ageGroup !== "Senior" && stats.rating > 7
          ? 0.07
          : stats.rating > 8
            ? 0.035
            : 0,
        player.id,
      );
      if (
        [fixture.home_id, fixture.away_id].includes(state.clubId) ||
        store.get(
          "SELECT id FROM loans WHERE player_id = ? AND status = ?",
          player.id,
          "active",
        )
      )
        store.run(
          "INSERT INTO history(season, entity_type, entity_id, date, data) VALUES (?, ?, ?, ?, ?)",
          state.season,
          "appearance",
          player.id,
          state.date,
          JSON.stringify({
            ...stats,
            fixtureId: fixture.id,
            position: player.position,
            clubId: team.id,
          }),
        );
    }
  }
  if (league) {
    standingsConsequences(
      store,
      homeClub,
      league,
      Math.sign(result.homeGoals - result.awayGoals),
      result.homeGoals - result.awayGoals,
    );
    standingsConsequences(
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
    news(
      store,
      "Match",
      `${homeClub.name} ${result.homeGoals} - ${result.awayGoals} ${awayClub.name}`,
      `${league?.name ?? "Pre-season friendly"}${ageGroup !== "Senior" ? ` (${ageGroup})` : ""}. Expected goals: ${result.homeXg.toFixed(2)} - ${result.awayXg.toFixed(2)}.${penalties ? ` Penalties: ${penalties.home} - ${penalties.away}.` : ""} The analyst's report is ready.`,
      difference > 0 ? "success" : difference < 0 ? "warning" : "info",
      "analytics",
      { fixtureId: fixture.id },
    );
    experience(
      store,
      3,
      difference > 0 && league?.kind === "league" ? 0.06 : 0,
    );
  }
}

interface DevelopmentClub extends Club {
  staff_ability: number;
  plan_focus: string;
  plan_youth: string;
  plan_intensity: number;
  rehab_ability: number;
  league_reputation: number;
}

export function developPlayers(store: Store, random: seedrandom.PRNG) {
  const state = stateOf(store);
  const settings = settingsOf(store);
  const clubs = new Map(
    store
      .all<DevelopmentClub>(
        `SELECT clubs.*, coalesce((SELECT avg(ability) FROM staff WHERE staff.club_id = clubs.id AND role IN ('Head of youth','Assistant manager','Fitness coach','Goalkeeper coach')),50) AS staff_ability, coalesce((SELECT avg(ability) FROM staff WHERE staff.club_id = clubs.id AND role = 'Physio'),50) AS rehab_ability, coalesce(training_plans.focus,'Balanced') AS plan_focus, coalesce(training_plans.youth_focus,'Technical') AS plan_youth, coalesce(training_plans.intensity,50) AS plan_intensity, coalesce(leagues.reputation,clubs.reputation) AS league_reputation FROM clubs LEFT JOIN training_plans ON training_plans.club_id = clubs.id LEFT JOIN leagues ON leagues.id = clubs.league_id WHERE clubs.type != 'national'`,
      )
      .map((club) => [club.id, club]),
  );
  const fallback = clubs.values().next().value!;
  const update = store.db.prepare(
    "UPDATE players SET ability = ?, potential = ?, development_bank = ?, potential_bank = 0, age = ?, value = ?, morale = ?, injury_until = ?, profile = coalesce(?,profile), loan_progress = 0 WHERE id = ?",
  );
  let cursor = 0;
  while (true) {
    const batch = store.all<Player>(
      "SELECT * FROM players WHERE id > ? AND role != 'Retired' ORDER BY id LIMIT 1500",
      cursor,
    );
    if (!batch.length) break;
    for (const player of batch) {
      cursor = player.id;
      const club = player.club_id
        ? (clubs.get(player.club_id) ?? fallback)
        : fallback;
      const profile = JSON.parse(player.profile) as PlayerProfile;
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
        tournament: player.age_group !== "Senior" && player.form > 7 ? 15 : 0,
        intensity: Number(settings.potentialIntensity),
        lifestyleImpact: Number(settings.lifestyleImpact),
      };
      const influences = potentialInfluences(player, profile, context);
      const volatility =
        ((((random() - 0.5) * player.volatility) / 75) *
          Number(settings.potentialIntensity)) /
        60;
      let potential = clamp(
        player.potential +
          influences.change +
          volatility +
          player.potential_bank,
      );
      const intensity = (player.intensity + club.plan_intensity) / 2;
      const youthFactor =
        age < 19
          ? 1.5
          : age < 23
            ? 1
            : age < 27
              ? 0.35
              : age < 30
                ? 0.05
                : -0.2 * (age - 28);
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
      const trainingFactor = player.injury_until
        ? effectiveFocus === "Injury rehab"
          ? -0.025
          : -0.12
        : (0.025 + context.staff / 700 + club.facilities / 1400) *
          youthFactor *
          (intensity / 70 + 0.25) *
          (profile.personality.professionalism / 100 + 0.4) *
          focusBonus *
          habits;
      const burnoutFactor = profile.mentalHealth.burnout > 65 ? -0.08 : 0;
      let progress =
        player.development_bank +
        trainingFactor +
        burnoutFactor +
        player.loan_progress +
        (profile.development.mentorId && age < 23 ? 0.035 : 0);
      let ability = player.ability;
      if (Math.abs(progress) >= 0.1) {
        const delta = Math.trunc(progress * 10) / 10;
        ability = clamp(Math.min(potential, player.ability + delta));
        progress -= delta;
      }
      potential = Math.max(ability, potential);
      let profileChanged = false;
      if (effectiveFocus === "Position" && profile.development.positionTarget) {
        profile.development.positionWeeks =
          (profile.development.positionWeeks ?? 0) + 1;
        if (
          profile.development.positionWeeks >=
          Math.max(6, 15 - Math.floor(profile.personality.adaptability / 10))
        ) {
          store.run(
            "UPDATE players SET secondary_position = ? WHERE id = ?",
            profile.development.positionTarget,
            player.id,
          );
          if (ownClub)
            news(
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
      if (
        age < 19 &&
        !profile.development.growthSpurt &&
        random() < (0.012 * Number(settings.youthRealism)) / 75
      ) {
        profile.identity.height += 2 + Math.floor(random() * 3);
        profile.identity.weight += 2;
        profile.development.growthSpurt = true;
        profile.attributes.physical.strength = clamp(
          profile.attributes.physical.strength + 3,
        );
        profile.attributes.physical.balance = clamp(
          profile.attributes.physical.balance - 1,
        );
        profileChanged = true;
        if (ownClub)
          news(
            store,
            "Academy",
            `${player.name}: growth spurt`,
            "Physical development has accelerated. Strength is improving, but coordination and training load need careful monitoring.",
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
          const mentor = store.get<{ profile: string; club_id: number | null }>(
            "SELECT profile, club_id FROM players WHERE id = ?",
            profile.development.mentorId,
          );
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
        const youthStress = age < 19 ? Number(settings.youthRealism) / 75 : 1;
        profile.mentalHealth.burnout = clamp(
          profile.mentalHealth.burnout +
            ((intensity > 75 ? 2.5 : -1.5) + (player.fitness < 55 ? 2 : 0)) *
              youthStress,
          0,
          100,
        );
        profile.mentalHealth.anxiety = clamp(
          profile.mentalHealth.anxiety +
            (club.crisis > 50 ? 1.5 : -0.5) -
            profile.personality.emotionalStability / 100,
          0,
          100,
        );
        profile.mentalHealth.confidence = clamp(
          profile.mentalHealth.confidence * 0.85 + player.morale * 0.15,
          0,
          100,
        );
        profile.mentalHealth.motivation = clamp(
          profile.mentalHealth.motivation +
            (club.momentum > 5 ? 1 : -0.15) -
            profile.mentalHealth.burnout / 100,
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
          ].slice(-36);
        const focus =
          effectiveFocus === "Youth development"
            ? dna === "Physical resilience"
              ? "Physical"
              : dna === "Relentless pressing"
                ? "Tactical"
                : "Technical"
            : effectiveFocus;
        const group =
          focus === "Technical"
            ? "technical"
            : focus === "Physical"
              ? "physical"
              : focus === "Tactical" || focus === "Position"
                ? "tactical"
                : focus === "Mental"
                  ? "mental"
                  : player.position === "GK" && focus === "Role"
                    ? "goalkeeper"
                    : "technical";
        if (random() < 0.35 && !player.injury_until) {
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
        (profile.lifestyle === "nightlife" ? 1.3 : 1);
      if (!injury && random() < injuryChance) {
        const duration =
          random() < 0.85
            ? 4 + Math.floor(random() * 24)
            : 35 + Math.floor(random() * 120);
        injury = addDays(state.date, duration);
        potential = Math.max(ability, potential - (duration > 60 ? 0.6 : 0.05));
        if (ownClub)
          news(
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
      const value = valuation(
        { ...player, ability, potential, age, injury_until: injury },
        {
          date: state.date,
          leagueReputation: club.league_reputation,
          balance: club.balance,
          philosophy: club.philosophy,
          inflation: Number(settings.transferInflation),
          crisis: club.crisis,
          hype: club.hype,
        },
      ).value;
      update.run(
        round(ability, 2),
        round(potential, 2),
        progress,
        age,
        value,
        round(morale, 2),
        injury,
        profileChanged ? JSON.stringify(profile) : null,
        player.id,
      );
    }
  }
}

function weeklyFinances(store: Store) {
  const state = stateOf(store);
  const settings = settingsOf(store);
  const salaries = new Map(
    store
      .all<{ club_id: number; total: number }>(
        "SELECT club_id, sum(wage) AS total FROM players WHERE club_id IS NOT NULL GROUP BY club_id",
      )
      .map((row) => [row.club_id, row.total]),
  );
  const staffCosts = new Map(
    store
      .all<{ club_id: number; total: number }>(
        "SELECT club_id, sum(wage) AS total FROM staff WHERE club_id IS NOT NULL GROUP BY club_id",
      )
      .map((row) => [row.club_id, row.total]),
  );
  for (const loan of store.all<{
    parent_id: number;
    destination_id: number;
    wage: number;
    salary_split: number;
  }>(
    "SELECT loans.parent_id, loans.destination_id, players.wage, json_extract(loans.terms,'$.salarySplit') AS salary_split FROM loans JOIN players ON players.id = loans.player_id WHERE loans.status = 'active'",
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
    store
      .all<{ home_id: number; count: number }>(
        "SELECT home_id, count(*) AS count FROM fixtures WHERE status = 'played' AND date > ? AND date <= ? GROUP BY home_id",
        addDays(state.date, -7),
        state.date,
      )
      .map((row) => [row.home_id, row.count]),
  );
  const update = store.db.prepare(
    "UPDATE clubs SET balance = balance + ?, income = income + ?, spending = spending + ?, ffp = ?, transfer_budget = max(0, transfer_budget + ?) WHERE id = ?",
  );
  for (const club of store.all<Club>(
    "SELECT * FROM clubs WHERE type != 'national'",
  )) {
    const wages = (salaries.get(club.id) ?? 0) + (staffCosts.get(club.id) ?? 0);
    const running = Math.round(
      club.facilities ** 2 * 2.2 + club.academy ** 2 * 1.6,
    );
    const sponsorship = Math.round(club.reputation ** 3 * 0.9);
    const gate = Math.round(
      (gates.get(club.id) ?? 0) *
        club.capacity *
        (0.25 + club.fan_mood / 250) *
        Math.max(5, club.reputation / 3),
    );
    const income = sponsorship + gate;
    const expenses = wages + running;
    const net = income - expenses;
    const ffp = Math.max(
      0,
      club.season_spend / 4 +
        club.spending +
        expenses -
        club.income -
        income -
        15_000_000,
    );
    update.run(net, income, expenses, ffp, net > 0 ? net * 0.08 : 0, club.id);
    if (club.id === state.clubId) {
      for (const [category, amount] of [
        ["Sponsorship & broadcasting", sponsorship],
        ["Matchday income", gate],
        ["Player & staff wages", -wages],
        ["Club operations & academy", -running],
      ] as [string, number][])
        store.run(
          "INSERT INTO ledger(club_id, date, category, amount, description) VALUES (?, ?, ?, ?, ?)",
          club.id,
          state.date,
          category,
          amount,
          "Weekly accounts",
        );
      store.run(
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
        news(
          store,
          "Finance",
          "Cash balance enters the red",
          "The board has requested a financial recovery plan. Player sales and wage reductions may be needed.",
          "warning",
          "finances",
        );
      if (settings.ffp && ffp > 60_000_000 && club.ffp <= 60_000_000)
        news(
          store,
          "Finance",
          "Financial sustainability warning",
          "The rolling in-game deficit has exceeded the monitoring threshold. A registration embargo follows if it reaches 100 million.",
          "warning",
          "finances",
        );
    }
  }
}

function weeklyStaffAndPolitics(store: Store, random: seedrandom.PRNG) {
  const state = stateOf(store);
  const club = clubOf(store);
  const relationships = store.all<{
    id: number;
    strength: number;
    club_id: number;
    source_id: number;
    target_id: number;
  }>("SELECT * FROM relationships WHERE source_type = 'staff'");
  const update = store.db.prepare(
    "UPDATE relationships SET strength = ? WHERE id = ?",
  );
  const clubUpdate = store.db.prepare(
    "UPDATE clubs SET chemistry = min(99,max(1,chemistry + ?)) WHERE id = ?",
  );
  for (const relationship of relationships) {
    const strength = clamp(
      relationship.strength +
        (random() - 0.5) * (settingsOf(store).directorDrama ? 8 : 3),
      -100,
      100,
    );
    update.run(strength, relationship.id);
    clubUpdate.run(
      strength > 50 ? 0.08 : strength < -30 ? -0.18 : 0,
      relationship.club_id,
    );
    if (
      relationship.club_id === state.clubId &&
      strength < -35 &&
      random() < 0.2
    )
      news(
        store,
        "Staff",
        "A disagreement in the backroom",
        "A staff rivalry is affecting communication and the development environment. A mediation meeting could help.",
        "important",
        "staff",
        { staffId: relationship.source_id },
      );
  }
  if (state.week % 4 === 0)
    store.run(
      "UPDATE staff SET ability = min(99,ability + CASE WHEN ambition > 70 THEN 1 ELSE 0 END), morale = max(1,min(99,morale + CASE WHEN personality = ? THEN -1 ELSE 1 END)) WHERE club_id IS NOT NULL",
      "Ambitious",
    );
  for (const troubled of store.all<Club>(
    "SELECT * FROM clubs WHERE type = 'club' AND manager_trust < 22 AND crisis > 50",
  )) {
    const country = store.get<Country>(
      "SELECT * FROM countries WHERE id = ?",
      troubled.country_id,
    )!;
    const nextManager = personName(random, country.language);
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
    store.run(
      "UPDATE clubs SET manager = ?, manager_trust = 65, chemistry = max(25,chemistry - 6), tactical_style = ?, data = ? WHERE id = ?",
      nextManager,
      ["Possession", "High press", "Counter attack", "Direct", "Balanced"][
        Math.floor(random() * 5)
      ],
      JSON.stringify(data),
      troubled.id,
    );
    store.run(
      "INSERT INTO history(season, entity_type, entity_id, date, data) VALUES (?, ?, ?, ?, ?)",
      state.season,
      "manager",
      troubled.id,
      state.date,
      JSON.stringify({ departed: troubled.manager, appointed: nextManager }),
    );
    if (troubled.id === state.clubId)
      news(
        store,
        "Board",
        "The board dismisses the manager",
        `${troubled.manager} has left. ${nextManager} takes charge with a new tactical approach. Your recruitment plan must adapt.`,
        "warning",
        "staff",
      );
  }
  if (club.crisis > 60) {
    const unsettled = store.get<Player>(
      "SELECT * FROM players WHERE club_id = ? AND age_group = 'Senior' AND listed = 0 ORDER BY morale ASC LIMIT 1",
      club.id,
    );
    if (unsettled && unsettled.morale < 40) {
      store.run("UPDATE players SET listed = 1 WHERE id = ?", unsettled.id);
      news(
        store,
        "Transfers",
        `${unsettled.name} requests a transfer`,
        "The player and agent have lost confidence in the current direction. Their request has unsettled the dressing room.",
        "warning",
        "transfers",
      );
    }
  }
  for (const troubled of store.all<Club>(
    "SELECT * FROM clubs WHERE type = 'club' AND crisis > 60 AND id != ? LIMIT 100",
    state.clubId,
  )) {
    const youth = store.get<Player>(
      "SELECT * FROM players WHERE club_id = ? AND age_group != 'Senior' AND age >= 16 ORDER BY ability DESC LIMIT 1",
      troubled.id,
    );
    if (youth)
      store.run(
        "UPDATE players SET age_group = 'Senior', role = 'Prospect', morale = min(99,morale + 5) WHERE id = ?",
        youth.id,
      );
  }
  if (
    club.crisis > 50 &&
    store.get<{ count: number }>(
      "SELECT count(*) AS count FROM players WHERE club_id = ? AND injury_until > ?",
      club.id,
      state.date,
    )!.count >= 3
  )
    news(
      store,
      "Loans",
      "Emergency cover is now an option",
      "The injury crisis makes an emergency loan available. The manager has asked for immediate cover.",
      "important",
      "loans",
    );
  if (club.board_confidence < 8 && state.week > 8) {
    const latest = stateOf(store);
    latest.gameOver = true;
    store.setMeta("state", latest);
    news(
      store,
      "Board",
      "The board ends your tenure",
      "Your contract has been terminated. Your career record remains available, and you can accept a new role at another club from Career settings.",
      "warning",
      "settings",
    );
  }
  const rhetoric =
    club.momentum > 10
      ? "A club finding its direction"
      : club.momentum < -10
        ? "Questions grow over the sporting project"
        : "The summer plan under scrutiny";
  news(
    store,
    "Media",
    rhetoric,
    club.momentum > 10
      ? "Supporters are celebrating the recent form. Local commentators are beginning to ask whether expectations should rise."
      : club.momentum < -10
        ? "Results have sharpened criticism. The local press is questioning recruitment and the depth of the squad."
        : `The press is discussing ${club.name}'s recruitment priorities. Fans want a clear pathway for young players without sacrificing results.`,
    club.momentum < -10 ? "warning" : "info",
    "media",
    {
      outlet: ["The Touchline", "Football Daily", "The Local Stand"][
        state.week % 3
      ],
      bias: JSON.parse(club.data).mediaBias ?? 0,
      trend: club.momentum > 10 ? "#BelieveInTheProject" : "#BackTheClub",
    },
  );
}

function checkPromises(store: Store) {
  const state = stateOf(store);
  for (const promise of store.all<{
    id: number;
    player_id: number;
    type: string;
    target: number;
    data: string;
  }>(
    "SELECT * FROM promises WHERE status = 'active' AND due_date <= ?",
    state.date,
  )) {
    const player = playerOf(store, promise.player_id);
    const data = JSON.parse(promise.data);
    const club = clubOf(store, data.clubId);
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
    store.run(
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
    store.run(
      "UPDATE players SET morale = min(99,max(1,morale + ?)), profile = ? WHERE id = ?",
      fulfilled ? 6 : -16,
      JSON.stringify(profile),
      player.id,
    );
    store.run(
      "UPDATE clubs SET board_confidence = min(100,max(0,board_confidence + ?)) WHERE id = ?",
      fulfilled ? 1 : -3,
      data.clubId,
    );
    if (data.clubId === state.clubId)
      news(
        store,
        "Squad",
        `${player.name}: promise ${fulfilled ? "fulfilled" : "broken"}`,
        `The ${promise.type.toLowerCase()} commitment has been reviewed. ${fulfilled ? "Trust and loyalty have improved." : "The player and agent are disappointed. Your reputation and dressing-room trust have suffered."}`,
        fulfilled ? "success" : "warning",
        "squad",
      );
    experience(store, fulfilled ? 10 : 0, fulfilled ? 0.2 : -0.7);
  }
  const boardPlan = store.get<{ value: string }>(
    "SELECT value FROM meta WHERE key = 'boardPlan'",
  );
  if (boardPlan) {
    const plan = JSON.parse(boardPlan.value);
    if (state.date >= plan.due) {
      const club = clubOf(store);
      const youthMinutes = store.get<{ total: number }>(
        "SELECT coalesce(sum(minutes),0) AS total FROM players WHERE club_id = ? AND age < 21",
        club.id,
      )!.total;
      const successful =
        plan.approach === "youth"
          ? youthMinutes - plan.youthMinutes >= 180
          : club.crisis < plan.crisis || club.crisis < 20;
      store.run(
        "UPDATE clubs SET board_confidence = max(0,min(100,board_confidence + ?)), board_pressure = max(0,min(100,board_pressure + ?)) WHERE id = ?",
        successful ? 7 : -12,
        successful ? -5 : 10,
        club.id,
      );
      news(
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
      store.run("DELETE FROM meta WHERE key = 'boardPlan'");
      experience(store, successful ? 20 : 0, successful ? 0.5 : -1);
    }
  }
}

function processNegotiations(store: Store, random: seedrandom.PRNG) {
  const state = stateOf(store);
  const settings = settingsOf(store);
  for (const negotiation of store.all<Negotiation>(
    "SELECT * FROM negotiations WHERE stage IN ('Club talks','Agent talks','Medical','Offer received')",
  )) {
    const data = JSON.parse(negotiation.data) as NegotiationData;
    if (
      negotiation.stage === "Medical" &&
      data.medicalDate &&
      state.date >= data.medicalDate
    ) {
      try {
        completeNegotiation(store, negotiation);
      } catch (error) {
        if (!(error instanceof GameError)) throw error;
        data.log.push({
          date: state.date,
          type: "Rejected",
          message: error.message,
        });
        store.run(
          "UPDATE negotiations SET stage = 'Rejected', data = ? WHERE id = ?",
          JSON.stringify(data),
          negotiation.id,
        );
      }
      continue;
    }
    if (state.date > negotiation.deadline) {
      store.run(
        "UPDATE negotiations SET stage = 'Expired' WHERE id = ?",
        negotiation.id,
      );
      news(
        store,
        "Transfers",
        "Negotiation deadline passed",
        `${playerOf(store, negotiation.player_id).name}'s representatives have closed talks.`,
        "important",
        "transfers",
      );
      continue;
    }
    const deadlineDay = ["09-01", "01-31"].includes(state.date.slice(5));
    const eventChance = (deadlineDay ? 0.18 : 0.015) * (settings.chaos ? 3 : 1);
    if (random() > eventChance) continue;
    const event = random();
    const player = playerOf(store, negotiation.player_id);
    if (event < 0.45 && !data.leak) {
      data.leak = true;
      data.log.push({
        date: state.date,
        type: "Leak",
        message:
          "Negotiation details leaked. Rival interest and the asking price have risen.",
      });
      store.run(
        "UPDATE negotiations SET tension = min(99,tension + 12), asking_price = asking_price * 1.08, public = 1, data = ? WHERE id = ?",
        JSON.stringify(data),
        negotiation.id,
      );
      news(
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
      data.hijack = true;
      data.log.push({
        date: state.date,
        type: "Hijack",
        message:
          "The player has prioritised a competing offer with a stronger career pathway.",
      });
      store.run(
        "UPDATE negotiations SET stage = 'Hijacked', data = ? WHERE id = ?",
        JSON.stringify(data),
        negotiation.id,
      );
      news(
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
      store.run(
        "UPDATE negotiations SET tension = min(99,tension + 18), interest = max(0,interest - 10), data = ? WHERE id = ?",
        JSON.stringify(data),
        negotiation.id,
      );
      news(
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

function worldTransfers(store: Store, random: seedrandom.PRNG) {
  const state = stateOf(store);
  if (!transferWindow(state.date)) return;
  const maxId = store.get<{ id: number }>(
    "SELECT max(id) AS id FROM players",
  )!.id;
  for (let index = 0; index < 60; index++) {
    const player = store.get<Player>(
      "SELECT * FROM players WHERE id >= ? AND club_id IS NOT NULL AND parent_club_id IS NULL AND age BETWEEN 18 AND 30 AND age_group = 'Senior' AND role != 'Retired' ORDER BY id LIMIT 1",
      Math.floor(random() * maxId),
    );
    if (!player || player.club_id === state.clubId || player.value <= 0)
      continue;
    const fee = Math.round(player.value * (0.95 + random() * 0.15));
    const buyer = store.get<Club>(
      "SELECT * FROM clubs WHERE type = 'club' AND id NOT IN (?,?) AND reputation BETWEEN ? AND ? AND transfer_budget > ? AND wage_budget > (SELECT coalesce(sum(wage),0) FROM players WHERE players.club_id = clubs.id) + ? ORDER BY abs(reputation - ?) LIMIT 1",
      player.club_id!,
      state.clubId,
      Math.max(20, player.ability - 8),
      player.ability + 14,
      fee,
      player.wage * 1.1,
      player.ability + random() * 10,
    );
    if (!buyer) continue;
    const sellerCount = store.get<{ count: number }>(
      "SELECT count(*) AS count FROM players WHERE club_id = ? AND age_group = 'Senior'",
      player.club_id,
    )!.count;
    if (sellerCount <= 17) continue;
    ledger(
      store,
      buyer.id,
      -fee,
      "Transfer fees",
      `${player.name}: recruitment`,
    );
    transferProceeds(
      store,
      player.id,
      player.club_id!,
      fee,
      `${player.name}: sale`,
    );
    store.run(
      "UPDATE clubs SET transfer_budget = transfer_budget - ?, season_spend = season_spend + ? WHERE id = ?",
      fee,
      fee,
      buyer.id,
    );
    store.run(
      "UPDATE players SET club_id = ?, wage = wage * 1.1, contract_end = ?, role = 'Squad player', morale = min(99,morale + 4) WHERE id = ?",
      buyer.id,
      `${state.season + 4}-06-30`,
      player.id,
    );
    store.run(
      "INSERT INTO history(season, entity_type, entity_id, date, data) VALUES (?, ?, ?, ?, ?)",
      state.season,
      "transfer",
      player.id,
      state.date,
      JSON.stringify({
        name: player.name,
        from: player.club_id,
        to: buyer.id,
        club: buyer.name,
        fee,
      }),
    );
    if (index < 2)
      news(
        store,
        "World",
        `${buyer.name} sign ${player.name}`,
        "The transfer market continues to move. Club finances, ambitions and squad needs have shaped another agreement.",
        "info",
        "transfers",
        { playerId: player.id, fee },
      );
  }
  const listed = store.get<Player>(
    "SELECT * FROM players WHERE club_id = ? AND (listed = 1 OR available_loan = 1) AND parent_club_id IS NULL ORDER BY value DESC LIMIT 1",
    state.clubId,
  );
  if (
    listed &&
    !store.get(
      "SELECT id FROM negotiations WHERE player_id = ? AND stage IN ('Offer received','Medical','Club talks','Agent talks')",
      listed.id,
    )
  ) {
    const buyer = store.get<Club>(
      "SELECT * FROM clubs WHERE id != ? AND type = 'club' AND transfer_budget > ? AND reputation >= ? ORDER BY abs(reputation - ?) LIMIT 1",
      state.clubId,
      listed.value * 0.9,
      listed.ability - 15,
      listed.ability,
    )!;
    if (buyer) {
      const profile = JSON.parse(listed.profile) as PlayerProfile;
      const isLoan = !listed.listed && !!listed.available_loan;
      const terms = defaultLoanTerms(listed, buyer);
      const fee = isLoan ? terms.fee : Math.round(listed.value * 0.9);
      const data = {
        log: [
          {
            date: state.date,
            type: "Offer",
            message: `${buyer.name} have submitted a formal ${isLoan ? "loan" : "transfer"} offer.`,
          },
        ],
        agent: profile.agent,
        years: 4,
        role: "Regular starter",
        promises: [],
        terms,
      };
      store.run(
        "INSERT INTO negotiations(player_id, buying_club_id, selling_club_id, type, stage, asking_price, offer, wage, interest, created, deadline, data) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        listed.id,
        buyer.id,
        state.clubId,
        isLoan ? "Development loan" : "Permanent transfer",
        "Offer received",
        isLoan ? fee : listed.value,
        fee,
        Math.round(listed.wage * (isLoan ? 1 : 1.15)),
        75,
        state.date,
        addDays(state.date, 7),
        JSON.stringify(data),
      );
      news(
        store,
        "Transfers",
        `An offer for ${listed.name}`,
        `${buyer.name} have made a proposal. The decision is yours.`,
        "important",
        "transfers",
      );
    }
  }
}

export function seasonRollover(store: Store) {
  const state = stateOf(store);
  const oldSeason = state.season;
  const random = seedrandom(`${state.seed}:season:${oldSeason + 1}`);
  for (const league of store.all<League>(
    "SELECT * FROM leagues WHERE kind = 'league'",
  )) {
    const table = store.all<Standing>(
      "SELECT * FROM standings WHERE league_id = ? ORDER BY points DESC, (gf-ga) DESC, gf DESC, club_id",
      league.id,
    );
    store.run(
      "INSERT INTO history(season, entity_type, entity_id, date, data) VALUES (?, ?, ?, ?, ?)",
      oldSeason,
      "league",
      league.id,
      state.date,
      JSON.stringify({ name: league.name, table }),
    );
  }
  for (const country of store.all<Country>("SELECT * FROM countries")) {
    const divisions = store.all<League>(
      "SELECT * FROM leagues WHERE country_id = ? AND kind = 'league' AND age_group = 'Senior' ORDER BY tier",
      country.id,
    );
    const rankings = divisions.map((league) =>
      store.all<Standing & { parent_id: number | null }>(
        "SELECT standings.*, clubs.parent_id FROM standings JOIN clubs ON clubs.id = standings.club_id WHERE standings.league_id = ? ORDER BY points DESC, (gf-ga) DESC, gf DESC, club_id",
        league.id,
      ),
    );
    const moves: {
      club: number;
      from: number;
      to: number;
      promoted: boolean;
    }[] = [];
    for (let tier = 0; tier < divisions.length - 1; tier++) {
      const relegated = rankings[tier].slice(-2);
      const promoted = rankings[tier + 1]
        .filter(
          (entry) =>
            !entry.parent_id ||
            store.get<{ league_id: number }>(
              "SELECT league_id FROM clubs WHERE id = ?",
              entry.parent_id,
            )?.league_id !== divisions[tier].id,
        )
        .slice(0, 2);
      for (let index = 0; index < promoted.length; index++) {
        moves.push({
          club: promoted[index].club_id,
          from: divisions[tier + 1].id,
          to: divisions[tier].id,
          promoted: true,
        });
        moves.push({
          club: relegated[index].club_id,
          from: divisions[tier].id,
          to: divisions[tier + 1].id,
          promoted: false,
        });
      }
    }
    for (const move of moves) {
      store.run(
        "DELETE FROM standings WHERE league_id = ? AND club_id = ?",
        move.from,
        move.club,
      );
      store.run(
        "INSERT OR IGNORE INTO standings(league_id, club_id) VALUES (?, ?)",
        move.to,
        move.club,
      );
      store.run(
        "UPDATE clubs SET league_id = ?, reputation = min(99,max(1,reputation + ?)), transfer_budget = transfer_budget * ?, fan_mood = min(99,max(1,fan_mood + ?)) WHERE id = ?",
        move.to,
        move.promoted ? 4 : -4,
        move.promoted ? 1.25 : 0.7,
        move.promoted ? 15 : -15,
        move.club,
      );
      if (move.club === state.clubId)
        news(
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
    store.run(
      "UPDATE countries SET reputation = min(99,max(10,reputation + ?)) WHERE id = ?",
      shift,
      country.id,
    );
    store.run(
      "UPDATE leagues SET reputation = min(99,max(10,reputation + ?)) WHERE country_id = ?",
      shift,
      country.id,
    );
  }
  store.run(
    "UPDATE standings SET played = 0, wins = 0, draws = 0, losses = 0, gf = 0, ga = 0, points = 0, xg = 0, xga = 0, xpts = 0, form = '', home_record = '0-0-0', away_record = '0-0-0', deducted = 0",
  );
  store.run(
    "UPDATE players SET age_group = CASE WHEN age >= 19 THEN 'Senior' WHEN age >= 17 AND age_group = 'U17' THEN 'U19' ELSE age_group END, appearances = 0, minutes = 0, goals = 0, assists = 0 WHERE role != 'Retired'",
  );
  for (const player of store.all<Player>(
    "SELECT * FROM players WHERE age >= 37 AND role != 'Retired'",
  )) {
    if (random() < 0.25 + (player.age - 37) * 0.15 && !player.parent_club_id) {
      store.run(
        "UPDATE players SET club_id = NULL, wage = 0, value = 0, role = 'Retired' WHERE id = ?",
        player.id,
      );
      if (player.club_id === state.clubId)
        news(
          store,
          "Squad",
          `${player.name} retires`,
          "The player has announced retirement. Their career record remains in the database.",
          "important",
          "squad",
        );
    }
  }
  store.run(
    "UPDATE clubs SET season_spend = 0, income = 0, spending = 0, board_confidence = min(90,board_confidence + 5), transfer_budget = max(0,balance * 0.4), momentum = 0, crisis = 0, hype = 0 WHERE type != ?",
    "national",
  );
  const academyClubs = store.all<Club>(
    "SELECT DISTINCT clubs.* FROM clubs JOIN standings ON standings.club_id = clubs.id JOIN leagues ON leagues.id = standings.league_id WHERE leagues.kind = 'league' AND leagues.age_group = 'U17'",
  );
  generatePlayers(store, {
    count: WORLD_COUNTS.annualRegens,
    youth: true,
    random,
    countries: store.all<Country>("SELECT * FROM countries"),
    clubs: academyClubs,
    startDate: state.date,
    regenStyle: String(settingsOf(store).regenStyle),
  });
  const latest = stateOf(store);
  latest.season = oldSeason + 1;
  latest.worldTrend = [
    "High press",
    "Possession",
    "Counter attack",
    "Direct",
    "Balanced",
  ][Math.floor(random() * 5)];
  store.setMeta("state", latest);
  store.setMeta("lastIntake", {
    date: state.date,
    count: WORLD_COUNTS.annualRegens,
  });
  news(
    store,
    "World",
    `Welcome to ${latest.season}/${String(latest.season + 1).slice(-2)}`,
    "15,000 new academy players have entered the world. Promotions, relegations, league reputations and club budgets have been updated.",
    "success",
    "academy",
  );
}

function weeklyUpdate(store: Store) {
  const state = stateOf(store);
  state.week++;
  store.setMeta("state", state);
  const random = seedrandom(`${state.seed}:week:${state.week}`);
  developPlayers(store, random);
  reviewLoans(store);
  weeklyFinances(store);
  weeklyStaffAndPolitics(store, random);
  worldTransfers(store, random);
  checkPromises(store);
  const settings = settingsOf(store);
  if (settings.ultraYouth)
    store.run(
      "UPDATE players SET development_bank = development_bank + 0.06 WHERE age < 21 AND role != 'Retired'",
    );
  if (state.week % 13 === 0) {
    const latest = stateOf(store);
    latest.worldTrend = [
      "High press",
      "Possession",
      "Counter attack",
      "Direct",
      "Balanced",
    ][Math.floor(random() * 5)];
    store.setMeta("state", latest);
    store.run(
      "UPDATE clubs SET tactical_style = ? WHERE type = 'club' AND id % 13 = ? AND id != ?",
      latest.worldTrend,
      state.week % 13,
      state.clubId,
    );
    news(
      store,
      "World",
      `Tactical trend: ${latest.worldTrend.toLowerCase()}`,
      "More clubs are recruiting for this approach. Tactical fit and the value of suitable profiles are shifting.",
      "info",
      "scouting",
    );
  }
  experience(store, 10);
}

export function advance(store: Store, days: number) {
  if (!Number.isInteger(days) || days < 1 || days > 28)
    throw new GameError("Advance between one and 28 days.");
  if (stateOf(store).gameOver)
    throw new GameError(
      "Your tenure has ended. Accept another club role to continue.",
    );
  createCalendar(store);
  const started = performance.now();
  const from = stateOf(store).date;
  let played = 0;
  for (let day = 0; day < days; day++) {
    let rollover = false;
    store.transaction(() => {
      const state = stateOf(store);
      state.date = addDays(state.date, 1);
      state.started = true;
      store.setMeta("state", state);
      const random = seedrandom(`${state.seed}:day:${state.date}`);
      store.run(
        "UPDATE players SET fitness = min(99,fitness + CASE WHEN injury_until IS NULL THEN 3.5 ELSE 0.8 END), injury_until = CASE WHEN injury_until <= ? THEN NULL ELSE injury_until END WHERE fitness < 99 OR injury_until IS NOT NULL",
        state.date,
      );
      processNegotiations(store, random);
      finishScouting(store);
      const fixtures = store.all<Fixture>(
        "SELECT * FROM fixtures WHERE date <= ? AND season = ? AND status = 'scheduled' ORDER BY date, id",
        state.date,
        state.season,
      );
      for (const fixture of fixtures) {
        playFixture(store, fixture);
        played++;
      }
      expireLoans(store);
      progressCompetitions(store, state.date);
      if (daysBetween("2026-07-01", state.date) % 7 === 0) weeklyUpdate(store);
      if (
        state.date.slice(5) === "07-01" &&
        Number(state.date.slice(0, 4)) > state.season
      ) {
        seasonRollover(store);
        rollover = true;
      }
      if (["09-01", "01-31"].includes(state.date.slice(5)))
        news(
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
        news(
          store,
          "World",
          "International break begins",
          "Domestic league fixtures pause. National-team and youth tournament commitments may affect fitness and development.",
          "info",
          "competitions",
        );
      for (const player of store.all<Player>(
        "SELECT * FROM players WHERE contract_end < ? AND club_id IS NOT NULL AND parent_club_id IS NULL AND role != 'Retired' LIMIT 1000",
        state.date,
      )) {
        store.run(
          "UPDATE players SET club_id = NULL, wage = 0, value = 0, role = 'Free agent' WHERE id = ?",
          player.id,
        );
        if (player.club_id === state.clubId)
          news(
            store,
            "Transfers",
            `${player.name}: contract expired`,
            "The player has left on a free transfer. The wage commitment has ended.",
            "warning",
            "squad",
          );
      }
    });
    if (rollover) createCalendar(store);
    if (stateOf(store).gameOver) break;
  }
  return {
    from,
    date: stateOf(store).date,
    days: daysBetween(from, stateOf(store).date),
    matches: played,
    seconds: round((performance.now() - started) / 1000, 2),
  };
}
