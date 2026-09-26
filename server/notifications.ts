import seedrandom from "seedrandom";
import { z } from "zod";
import type { Store } from "./db.ts";
import {
  addDays,
  ageOn,
  daysBetween,
  DEFAULT_COMPETITION_ALERTS,
  NOTIFICATION_TOPICS,
} from "../shared/rules.ts";
import { GameError, news, settingsOf, stateOf } from "./systems.ts";
import { CAREER_RULES, contractYearsLeft, seniorRetirementChance } from "./people.ts";
import type { Fixture, League, NewsItem, Player } from "../shared/types.ts";
import type { CompetitionFavorite } from "../shared/api.ts";

/** Day (MM-DD) of the spring squad notice: retirements at the end of the season and contracts ending on 30 June. */
export const SQUAD_NOTICE_DAY = "05-01";
/** Youngest senior whose retirement is considered in the notice. */
const NOTICE_MIN_AGE = 30;

/** Meta `retirementNotice`: the user's family players who retire at the end of `season` (decided in May). */
export interface RetirementNotice {
  season: number;
  date: string;
  playerIds: number[];
}

/** The spring decision for the season ending on this rollover (`finishedSeason`), if one was made. */
export async function retirementNotice(store: Store, finishedSeason: number): Promise<ReadonlySet<number> | undefined> {
  const row = await store.get<{ value: string }>("SELECT [value] FROM meta WHERE [key] = 'retirementNotice'");
  const notice = row ? (JSON.parse(row.value) as RetirementNotice) : undefined;
  return notice?.season === finishedSeason ? new Set(notice.playerIds) : undefined;
}

/** Deterministic spring retirement decision (same seed, season and player always give the same answer). */
export function plannedRetirement(
  seed: string,
  season: number,
  player: Pick<Player, "id" | "birth_date" | "ability" | "position" | "contract_end" | "injury_until">,
  date: string,
) {
  const end = `${season + 1}-07-01`;
  const chance = seniorRetirementChance({
    age: ageOn(player.birth_date, end),
    ability: player.ability,
    position: player.position,
    contractYears: contractYearsLeft(player.contract_end, end),
    injuryDays: player.injury_until && player.injury_until > date ? daysBetween(date, player.injury_until) : 0,
  });
  return seedrandom(`${seed}:retire-plan:${season}:${player.id}`)() < chance;
}

const nameList = (names: string[], limit = 8) =>
  names.length > limit ? `${names.slice(0, limit).join(", ")} and ${names.length - limit} more` : names.join(", ");

/**
 * 1 May: the club family's seniors who will retire at the end of the season (the rollover honours this list for the
 * user's clubs), and the player and staff contracts that end on 30 June across first team, B-teams, youth and loans.
 * Work: one family query, one senior query, one contract query and one staff query per season.
 */
export async function processSquadNotices(store: Store) {
  const state = await stateOf(store);
  if (state.date.slice(5) !== SQUAD_NOTICE_DAY || Number(state.date.slice(0, 4)) !== state.season + 1) return;
  if (await retirementNotice(store, state.season)) return;
  const end = `${state.season + 1}-06-30`;
  const clubs = await store.all<{ id: number; name: string }>("SELECT id,name FROM clubs WHERE id = ? OR parent_id = ?", state.clubId, state.clubId);
  const family = JSON.stringify(clubs.map((club) => club.id));
  const inFamily = "(SELECT CAST([value] AS int) FROM OPENJSON(?))";
  const seniors = await store.all<Player>(
    `SELECT id,name,position,ability,birth_date,contract_end,injury_until,club_id,squad_club_id FROM players WHERE club_id IN ${inFamily} AND parent_club_id IS NULL AND age_group = 'Senior' AND role != 'Retired' AND birth_date <= ?`,
    family,
    `${state.season + 1 - NOTICE_MIN_AGE}-07-01`,
  );
  const retiring = seniors.filter((player) => plannedRetirement(state.seed, state.season, player, state.date));
  await store.setMeta("retirementNotice", { season: state.season, date: state.date, playerIds: retiring.map((player) => player.id) } satisfies RetirementNotice);
  if (retiring.length) {
    await store.run(
      "UPDATE target SET profile = JSON_MODIFY(target.profile,'$.retirementPlan',JSON_QUERY(?)) FROM players AS target WHERE target.id IN (SELECT CAST([value] AS int) FROM OPENJSON(?))",
      JSON.stringify({ season: state.season, announced: state.date }),
      JSON.stringify(retiring.map((player) => player.id)),
    );
    await news(
      store,
      "Squad",
      retiring.length === 1 ? `${retiring[0].name} will retire at the end of the season` : `${retiring.length} players will retire at the end of the season`,
      `${nameList(retiring.map((player) => `${player.name} (${ageOn(player.birth_date, `${state.season + 1}-07-01`)}, ${player.position})`))} ${retiring.length === 1 ? "has" : "have"} told the club that this season is the last. Plan the replacements before 1 July.`,
      "important",
      "squad",
      { playerIds: retiring.map((player) => player.id), retirementNotice: true },
    );
  }
  const planned = new Set(retiring.map((player) => player.id));
  const expiring = (
    await store.all<Player>(
      `SELECT id,name,age_group,club_id,squad_club_id,parent_club_id,contract_end FROM players WHERE ((club_id IN ${inFamily} AND parent_club_id IS NULL) OR parent_club_id IN ${inFamily}) AND role != 'Retired' AND contract_end >= ? AND contract_end <= ? AND coalesce(JSON_VALUE(profile,'$.contract.status'),'professional') = 'professional' ORDER BY contract_end,ability DESC,id`,
      family,
      family,
      state.date,
      end,
    )
  ).filter((player) => !planned.has(player.id));
  if (expiring.length) {
    const clubName = new Map(clubs.map((club) => [club.id, club.name]));
    const groups = new Map<string, string[]>();
    for (const player of expiring) {
      const label = player.parent_club_id
        ? "On loan"
        : `${clubName.get(player.squad_club_id ?? player.club_id!) ?? "Club"}${player.age_group === "Senior" ? "" : ` ${player.age_group}`}`;
      groups.set(label, [...(groups.get(label) ?? []), player.name]);
    }
    await news(
      store,
      "Squad",
      `${expiring.length} contract${expiring.length === 1 ? "" : "s"} end on 30 June`,
      `${[...groups].map(([label, names]) => `${label}: ${nameList(names)}`).join(". ")}. Renew the players you want to keep; the others leave on a free transfer.`,
      "warning",
      "squad",
      { playerIds: expiring.map((player) => player.id), contractNotice: true },
    );
  }
  const staff = await store.all<{ name: string; role: string }>(
    "SELECT name,role FROM staff WHERE club_id = ? AND JSON_VALUE(data,'$.contractEnd') BETWEEN ? AND ? ORDER BY id",
    state.clubId,
    state.date,
    end,
  );
  if (staff.length)
    await news(
      store,
      "Staff",
      `${staff.length} staff contract${staff.length === 1 ? "" : "s"} end on 30 June`,
      `${nameList(staff.map((member) => `${member.name} (${member.role})`))}. They are extended for two years unless released; staff aged ${CAREER_RULES.staff.userRetireAt} or over retire instead.`,
      "info",
      "staff",
    );
}

export async function notificationVisibility(store: Store) {
  const settings = await settingsOf(store);
  const muted = NOTIFICATION_TOPICS.filter(
    (topic) => settings[topic.id] === false,
  ).flatMap((topic) => [...topic.categories]);
  const conditions = muted.length
    ? [`news.category NOT IN (${muted.map(() => "?").join(",")})`]
    : ["1 = 1"];
  if (settings.notificationImportance === "important")
    conditions.push("news.severity IN ('important','warning')");
  return {
    where: conditions.join(" AND "),
    params: muted as (string | number)[],
  };
}

export async function notificationFeed(store: Store, input: unknown) {
  const filter = z
    .object({
      category: z.string().max(30).optional(),
      q: z.string().max(100).default(""),
      status: z.enum(["all", "unread", "read"]).default("all"),
      priority: z.enum(["all", "important"]).default("all"),
      league: z.coerce.number().int().positive().optional(),
      archive: z.enum(["0", "1"]).default("0"),
      page: z.coerce.number().int().min(1).max(100000).default(1),
      limit: z.coerce.number().int().min(10).max(200).default(100),
    })
    .parse(input);
  const visible =
    filter.archive === "1"
      ? { where: "1 = 1", params: [] as (string | number)[] }
      : await notificationVisibility(store);
  const conditions = [visible.where];
  const params = [...visible.params];
  if (filter.category) {
    conditions.push("news.category = ?");
    params.push(filter.category);
  }
  if (filter.status !== "all") {
    conditions.push("news.[read] = ?");
    params.push(filter.status === "read" ? 1 : 0);
  }
  if (filter.priority === "important")
    conditions.push("news.severity IN ('important','warning')");
  if (filter.league) {
    conditions.push(
      "TRY_CONVERT(int, JSON_VALUE(news.data,'$.competitionId')) = ?",
    );
    params.push(filter.league);
  }
  if (filter.q) {
    const search = `%${filter.q.replace(/[!%_[]/g, "!$&")}%`;
    conditions.push(
      "(news.title LIKE ? ESCAPE '!' OR news.body LIKE ? ESCAPE '!')",
    );
    params.push(search, search);
  }
  return store.all<NewsItem>(
    `SELECT * FROM news WHERE ${conditions.join(" AND ")} ORDER BY id DESC OFFSET ? ROWS FETCH NEXT ? ROWS ONLY`,
    ...params,
    (filter.page - 1) * filter.limit,
    filter.limit,
  );
}

function phaseKey(league: League) {
  const data = JSON.parse(league.data);
  return JSON.stringify([
    data.season,
    data.phase,
    data.nextRound,
    data.champion,
  ]);
}

export async function competitionFavorites(
  store: Store,
): Promise<CompetitionFavorite[]> {
  return (
    await store.all<League & { events: string; since: string }>(
      "SELECT leagues.*,competition_favorites.events,competition_favorites.since FROM competition_favorites JOIN leagues ON leagues.id = competition_favorites.league_id ORDER BY leagues.name",
    )
  ).map((league) => ({
    leagueId: league.id,
    name: league.name,
    kind: league.kind,
    ageGroup: league.age_group,
    events: { ...DEFAULT_COMPETITION_ALERTS, ...JSON.parse(league.events) },
    since: league.since,
  }));
}

export async function favoriteCompetition(
  store: Store,
  leagueId: number,
  input: unknown,
) {
  const request = z
    .object({
      active: z.boolean(),
      events: z
        .object({
          fixtures: z.boolean().optional(),
          results: z.boolean().optional(),
          draws: z.boolean().optional(),
          tables: z.boolean().optional(),
          winners: z.boolean().optional(),
        })
        .strict()
        .optional(),
    })
    .strict()
    .parse(input);
  const league = await store.get<League>(
    "SELECT * FROM leagues WHERE id = ?",
    leagueId,
  );
  if (!league) throw new GameError("Competition not found.");
  if (!request.active) {
    await store.run(
      "DELETE FROM competition_favorites WHERE league_id = ?",
      leagueId,
    );
    return { message: "Competition removed from favorites." };
  }
  const current = await store.get<{ events: string }>(
    "SELECT events FROM competition_favorites WHERE league_id = ?",
    leagueId,
  );
  const events = {
    ...DEFAULT_COMPETITION_ALERTS,
    ...(current ? JSON.parse(current.events) : {}),
    ...request.events,
  };
  await store.run(
    "MERGE competition_favorites WITH (HOLDLOCK) AS target USING (VALUES (?,?,?,?)) AS source(league_id,events,since,last_phase) ON target.league_id = source.league_id WHEN MATCHED THEN UPDATE SET events = source.events WHEN NOT MATCHED THEN INSERT (league_id,events,since,last_phase) VALUES (source.league_id,source.events,source.since,source.last_phase);",
    leagueId,
    JSON.stringify(events),
    (await stateOf(store)).date,
    phaseKey(league),
  );
  return {
    message: current
      ? "Competition alerts updated."
      : "Competition added to favorites.",
  };
}

export async function processCompetitionNotifications(store: Store) {
  // Daily notification pass: the spring squad notice rides along (it acts on one day a year).
  await processSquadNotices(store);
  const state = await stateOf(store);
  const tomorrow = addDays(state.date, 1);
  for (const favorite of await competitionFavorites(store)) {
    const league = (await store.get<League>(
      "SELECT * FROM leagues WHERE id = ?",
      favorite.leagueId,
    ))!;
    const emit = async (
      type: keyof typeof DEFAULT_COMPETITION_ALERTS,
      key: string,
      title: string,
      body: string,
      fixtureId?: number,
    ) => {
      if (!favorite.events[type]) return;
      const notificationKey = `competition:${league.id}:${key}`;
      if (
        await store.get(
          "SELECT id FROM news WHERE JSON_VALUE(data,'$.notificationKey') = ?",
          notificationKey,
        )
      )
        return;
      await news(
        store,
        "Competitions",
        title,
        body,
        type === "winners" ? "important" : "info",
        "competitions",
        {
          competitionId: league.id,
          notificationType: type,
          notificationKey,
          fixtureId,
        },
      );
    };
    const fixtures = await store.all<
      Fixture & { home_name: string; away_name: string }
    >(
      "SELECT fixtures.*,home.name AS home_name,away.name AS away_name FROM fixtures JOIN clubs AS home ON home.id = fixtures.home_id JOIN clubs AS away ON away.id = fixtures.away_id WHERE fixtures.league_id = ? AND fixtures.season = ? AND fixtures.date IN (?,?) ORDER BY fixtures.id",
      league.id,
      state.season,
      state.date,
      tomorrow,
    );
    const upcoming = fixtures.filter(
      (fixture) => fixture.date === tomorrow && fixture.status === "scheduled",
    );
    const results = fixtures.filter(
      (fixture) => fixture.date === state.date && fixture.status === "played",
    );
    if (upcoming.length)
      await emit(
        "fixtures",
        `fixtures:${tomorrow}`,
        `${league.name}: tomorrow's fixtures`,
        upcoming
          .map((fixture) => `${fixture.home_name} v ${fixture.away_name}`)
          .join("; "),
        upcoming[0].id,
      );
    if (results.length) {
      await emit(
        "results",
        `results:${state.date}`,
        `${league.name}: results`,
        results
          .map(
            (fixture) =>
              `${fixture.home_name} ${fixture.home_goals}-${fixture.away_goals} ${fixture.away_name}`,
          )
          .join("; "),
        results[0].id,
      );
      const leaders = await store.all<{
        name: string;
        points: number;
        played: number;
      }>(
        "SELECT TOP (3) clubs.name,standings.points,standings.played FROM standings JOIN clubs ON clubs.id = standings.club_id WHERE standings.league_id = ? ORDER BY points DESC,(gf-ga) DESC,gf DESC,club_id",
        league.id,
      );
      if (league.kind === "league")
        await emit(
          "tables",
          `table:${state.date}`,
          `${league.name}: standings`,
          leaders
            .map(
              (club, index) =>
                `${index + 1}. ${club.name}, ${club.points} points (${club.played} played)`,
            )
            .join("; "),
        );
      if (
        league.kind === "league" &&
        !(await store.get(
          "SELECT TOP (1) id FROM fixtures WHERE league_id = ? AND season = ? AND status = 'scheduled'",
          league.id,
          state.season,
        )) &&
        leaders[0]
      )
        await emit(
          "winners",
          `winner:${state.season}`,
          `${leaders[0].name} win ${league.name}`,
          `${leaders[0].points} points from ${leaders[0].played} matches.`,
        );
    }
    const currentPhase = phaseKey(league);
    const previous = (await store.get<{ last_phase: string }>(
      "SELECT last_phase FROM competition_favorites WHERE league_id = ?",
      league.id,
    ))!.last_phase;
    if (currentPhase !== previous) {
      const data = JSON.parse(league.data);
      if (data.championName)
        await emit(
          "winners",
          `winner:${state.season}`,
          `${data.championName} win ${league.name}`,
          `${state.season}/${String(state.season + 1).slice(-2)} champions.`,
        );
      else if (data.phase)
        await emit(
          "draws",
          `draw:${state.season}:${currentPhase}`,
          `${league.name}: competition update`,
          `${String(data.phase).replace(/-/g, " ")}${data.nextRound ? `, round ${data.nextRound}` : ""}. The next fixtures are available.`,
        );
      await store.run(
        "UPDATE competition_favorites SET last_phase = ? WHERE league_id = ?",
        currentPhase,
        league.id,
      );
    }
  }
}
