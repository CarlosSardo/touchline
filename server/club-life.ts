import type seedrandom from "seedrandom";
import type { Store } from "./db.ts";
import { clubPolicySnapshot } from "./club-policy.ts";
import { affiliateLifecycle } from "./affiliate-lifecycle.ts";
import { administrationWeekly, applyPendingDeductions } from "./administration.ts";
import { clubProjects, clubProjectsWeekly } from "./club-projects.ts";
import { DOF_ROLE, directorsWeekly } from "./club-directors.ts";
import { loadLifeClubs, type ClubLifeFields } from "./club-life-context.ts";
import { applyRelegationClauses, sweepRelegationClauses } from "./contract-clauses.ts";
import { worldNewsBatch, type WorldNewsInput } from "./world-news.ts";
import { GameError, news } from "./systems.ts";
import { daysBetween, money } from "../shared/rules.ts";
import type { GameState } from "../shared/types.ts";
import type { ClubLifeData, DofPolicy } from "../shared/api.ts";

export { worldNews, worldNewsBatch } from "./world-news.ts";

/** Weekday (days since 1 July 2026, mod 7) of each weekly pass; the weekly update runs on day 0. */
export const CLUB_LIFE_DAYS = { affiliates: 1, projects: 3, governance: 5 } as const;

/**
 * Daily club life, after the board's affiliate decisions: relegation-clause terms for new contracts, and
 * on staggered weekdays the AI affiliate lifecycle, infrastructure projects, then administration and directors of
 * football. Each pass reads the first teams once and writes set-based.
 */
export async function clubLifeDaily(store: Store, state: GameState, random: seedrandom.PRNG) {
  await sweepRelegationClauses(store, state.date);
  const day = ((daysBetween("2026-07-01", state.date) % 7) + 7) % 7;
  if (!Object.values(CLUB_LIFE_DAYS).includes(day as never)) return;
  const clubs = await loadLifeClubs(store, state);
  if (day === CLUB_LIFE_DAYS.affiliates) {
    await affiliateLifecycle(store, state, random, clubs);
    return;
  }
  const policies = await clubPolicySnapshot(store, state.date);
  if (day === CLUB_LIFE_DAYS.projects) await clubProjectsWeekly(store, state, random, clubs, policies);
  else {
    await administrationWeekly(store, state, random, clubs);
    await directorsWeekly(store, state, random, clubs, policies);
  }
}

/**
 * Season rollover, right after promotion and relegation: relegation wage-cut clauses of relegated first teams.
 * `season` is the new season.
 */
export async function relegationClausesAtRollover(store: Store, state: GameState, season: number) {
  const cuts = await applyRelegationClauses(store, season);
  if (!cuts.length) return cuts;
  const byClub = new Map<number, { players: number; from: number; to: number }>();
  for (const cut of cuts) {
    const total = byClub.get(cut.clubId) ?? { players: 0, from: 0, to: 0 };
    byClub.set(cut.clubId, { players: total.players + 1, from: total.from + cut.from, to: total.to + cut.to });
  }
  const names = new Map(
    (await store.all<{ id: number; name: string }>("SELECT id,name FROM clubs WHERE id = ANY(?::integer[])", [...byClub.keys()])).map(
      (club) => [club.id, club.name],
    ),
  );
  const items: WorldNewsInput[] = [...byClub].map(([clubId, total]) => ({
    kind: "contract",
    date: state.date,
    clubIds: [clubId],
    title: `Relegation clauses cut ${names.get(clubId)}'s wage bill`,
    body: `${total.players} contracts carried a relegation clause: weekly wages fall from ${money(total.from)} to ${money(total.to)}.`,
    data: { players: total.players, from: total.from, to: total.to },
  }));
  await worldNewsBatch(store, items);
  const own = byClub.get(state.clubId);
  if (own)
    await news(
      store,
      "Finance",
      "Relegation clauses take effect",
      `${own.players} players' contracts include a relegation wage cut. Their combined weekly wages fall from ${money(own.from)} to ${money(own.to)}; morale has dipped for the players affected.`,
      "warning",
      "finances",
    );
  return cuts;
}

/** End of the season rollover: administration deductions deferred to the new season. */
export async function clubLifeRollover(store: Store, season: number) {
  await applyPendingDeductions(store, season);
}

/** Club page / boardroom view: director of football and policy, projects, administration and recent managers. */
export async function clubLifeView(store: Store, clubId: number): Promise<ClubLifeData> {
  const club = await store.get<{ id: number; data: string }>("SELECT id,data FROM clubs WHERE id = ?", clubId);
  if (!club) throw new GameError("Club not found.");
  const data = JSON.parse(club.data) as ClubLifeFields;
  const director = await store.get<{ id: number; name: string; ability: number; data: string }>(
    "SELECT id,name,ability,data FROM staff WHERE club_id = ? AND role = ? ORDER BY id LIMIT 1",
    clubId,
    DOF_ROLE,
  );
  return {
    clubId,
    director: director
      ? {
          id: director.id,
          name: director.name,
          ability: director.ability,
          style: ((JSON.parse(director.data) as { policy?: DofPolicy }).policy ?? "balanced"),
          since: data.dofId === director.id ? (data.dofSince ?? null) : null,
        }
      : null,
    dofPolicy: data.dofPolicy ?? "balanced",
    projects: await clubProjects(store, clubId),
    administration: data.administration ?? null,
    administrations: data.administrations ?? [],
    managers: (data.managerCareer ?? []).flatMap((entry) =>
      entry.date && entry.departed && entry.appointed
        ? [{ date: entry.date, departed: entry.departed, appointed: entry.appointed, formation: entry.formation, style: entry.style }]
        : [],
    ).slice(-5).reverse(),
  };
}
