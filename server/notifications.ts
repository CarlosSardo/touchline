import { z } from "zod";
import type { Store } from "./db.ts";
import {
  addDays,
  DEFAULT_COMPETITION_ALERTS,
  NOTIFICATION_TOPICS,
} from "../shared/rules.ts";
import { GameError, news, settingsOf, stateOf } from "./systems.ts";
import type { Fixture, League, NewsItem } from "../shared/types.ts";
import type { CompetitionFavorite } from "../shared/api.ts";

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
