import type { Store } from "./db.ts";
import type { ClubPolicy } from "./club-policy.ts";
import { inAdministration, type LifeClub } from "./club-life-context.ts";
import { worldNewsBatch, type WorldNewsInput } from "./world-news.ts";
import { news } from "./systems.ts";
import { addDays, clamp, daysBetween, money } from "../shared/rules.ts";
import type { GameState } from "../shared/types.ts";
import type { ClubProjectKind, ClubProjectView } from "../shared/api.ts";

export const PROJECT_RULES = {
  /** Weekly chance a club reviews its infrastructure, rising with the owner's ambition (0-100). */
  reviewChance: (ambition: number) => 0.01 + clamp(ambition, 0, 100) / 8000,
  /** Clubs earning at least this much may run two projects at once. */
  twoProjectsRevenue: 100_000_000,
  /** Seasons before the same kind of project is considered again. */
  cooldownYears: { facilities: 2, academy: 2, stadium_expansion: 3, new_stadium: 15 } as Record<ClubProjectKind, number>,
  /** Cash kept back after the club's share of a project: a tenth of a season's revenue. */
  reserveShare: 0.1,
  /** Matchday demand: the share of capacity filled at which a club considers more seats (finance.ts attendance). */
  expansionUtilisation: 0.82,
  newStadiumRevenue: 30_000_000,
  debtYears: { stadium_expansion: 10, new_stadium: 20 } as Partial<Record<ClubProjectKind, number>>,
  interest: 0.04,
} as const;

export const PROJECT_LABELS: Record<ClubProjectKind, string> = {
  facilities: "training facilities upgrade",
  academy: "academy development",
  stadium_expansion: "stadium expansion",
  new_stadium: "new stadium",
};

interface ProjectRow {
  id: number;
  club_id: number;
  kind: ClubProjectKind;
  cost: number;
  start_date: string;
  end_date: string;
  status: ClubProjectView["status"];
  effect: string;
  data: string;
}

interface ProjectData {
  cash: number;
  debt: number;
  weeklyCash: number;
  weeklyRepayment: number;
  repayUntil: string | null;
}

/** Share of the stadium the finance model fills (finance.ts estimateClubRevenue attendance), relative to its 90% ceiling. */
export const stadiumUtilisation = (club: Pick<LifeClub, "reputation" | "fan_mood">) =>
  clamp(0.2 + (clamp(club.reputation, 0, 100) / 100) * 0.2 + clamp(club.fan_mood, 0, 100) / 200, 0.2, 0.9) / 0.9;

const median = (values: number[]) => {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted.length ? sorted[Math.floor(sorted.length / 2)] : 0;
};

interface Plan {
  kind: ClubProjectKind;
  score: number;
  cost: number;
  weeks: number;
  planningWeeks: number;
  cashShare: number;
  effect: ClubProjectView["effect"];
}

/** The project a club would start now, if any: facilities and academy against domestic peers, seats against demand. */
export function chooseProject(
  club: LifeClub,
  peers: { facilities: number; academy: number; capacity: number },
  ambition: number,
  random: () => number,
  blocked: ReadonlySet<ClubProjectKind>,
): Plan | null {
  const plans: Plan[] = [];
  const drive = (ambition - 50) / 10;
  const facilitiesGap = peers.facilities + drive - club.facilities;
  if (!blocked.has("facilities") && facilitiesGap >= 5 && club.facilities < 95) {
    const points = Math.round(clamp(facilitiesGap, 4, 10));
    plans.push({
      kind: "facilities",
      score: facilitiesGap,
      cost: Math.max(150_000, club.revenue * 0.012 * points),
      weeks: 30 + points * 3,
      planningWeeks: 0,
      cashShare: 1,
      effect: { facilities: Math.min(points, 99 - Math.round(club.facilities)) },
    });
  }
  const youth = club.philosophy === "Develop and sell" || club.culture === "Development" || club.data.dofPolicy === "youth";
  const academyGap = peers.academy + drive + (youth ? 3 : 0) - club.academy;
  if (!blocked.has("academy") && academyGap >= 5 && club.academy < 95) {
    const points = Math.round(clamp(academyGap, 4, 10));
    plans.push({
      kind: "academy",
      score: academyGap,
      cost: Math.max(100_000, club.revenue * 0.01 * points),
      weeks: 26 + points * 3,
      planningWeeks: 0,
      cashShare: 1,
      effect: { academy: Math.min(points, 99 - club.academy) },
    });
  }
  const utilisation = stadiumUtilisation(club);
  const perSeat = clamp(2000 + (club.revenue / Math.max(1000, club.capacity)) * 1.2, 1500, 15_000);
  if (utilisation >= PROJECT_RULES.expansionUtilisation && club.capacity < 95_000) {
    const shortfall = (peers.capacity - club.capacity) / Math.max(1, peers.capacity);
    if (!blocked.has("new_stadium") && shortfall >= 0.4 && club.revenue >= PROJECT_RULES.newStadiumRevenue) {
      const capacity = Math.round(Math.max(peers.capacity, club.capacity * 1.6) / 1000) * 1000;
      plans.push({
        kind: "new_stadium",
        score: 30 + shortfall * 20,
        cost: capacity * perSeat * 1.8,
        weeks: 104 + Math.floor(random() * 53),
        planningWeeks: 26,
        cashShare: 0.3,
        effect: { capacity, stadium: `${club.city} Stadium` },
      });
    } else if (!blocked.has("stadium_expansion") && club.capacity < peers.capacity * 1.25) {
      const seats = Math.max(1000, Math.round((club.capacity * (0.1 + random() * 0.15)) / 500) * 500);
      plans.push({
        kind: "stadium_expansion",
        score: (utilisation - 0.8) * 50 + Math.max(0, shortfall) * 20,
        cost: seats * perSeat,
        weeks: 40 + Math.floor(random() * 21),
        planningWeeks: 0,
        cashShare: club.revenue >= 10_000_000 ? 0.5 : 1,
        effect: { capacity: seats },
      });
    }
  }
  const affordable = plans.filter(
    (plan) => club.balance - plan.cost * plan.cashShare >= club.revenue * PROJECT_RULES.reserveShare,
  );
  return affordable.sort((a, b) => b.score - a.score)[0] ?? null;
}

/**
 * Weekly: projects move from planning to construction to completion (facilities, academy and capacity improve, so
 * revenue, development and youth intake follow), are paid in weekly instalments (cash share during the build, debt
 * after it; both outside the FFP result like real infrastructure spending), halt when a club enters administration,
 * and boards (the user's club's too) start new ones when their finances, ambition and stadium demand justify it.
 */
export async function clubProjectsWeekly(
  store: Store,
  state: GameState,
  random: () => number,
  clubs: readonly LifeClub[],
  policies: ReadonlyMap<number, ClubPolicy>,
) {
  const rows = await store.all<ProjectRow>(
    `SELECT id,club_id,kind,cost,start_date,end_date,status,effect,data FROM club_projects
     WHERE status IN ('planned','building') OR end_date >= ? OR (data::jsonb ->> 'repayUntil') > ?
     ORDER BY id`,
    addDays(state.date, -366 * 15),
    state.date,
  );
  const byId = new Map(clubs.map((club) => [club.id, club]));
  const items: WorldNewsInput[] = [];
  const userNews: { title: string; body: string; severity: string }[] = [];
  const statusChanges: { id: number; status: string }[] = [];
  const completed: ProjectRow[] = [];
  for (const project of rows) {
    const club = byId.get(project.club_id);
    if (!club || !["planned", "building"].includes(project.status)) continue;
    if (inAdministration(club)) {
      statusChanges.push({ id: project.id, status: "cancelled" });
      project.status = "cancelled";
      items.push({
        kind: "project",
        date: state.date,
        clubIds: [club.id],
        title: `${club.name}'s ${PROJECT_LABELS[project.kind]} halted`,
        body: `The administrators have stopped work on the ${PROJECT_LABELS[project.kind]} to protect the club's cash.`,
      });
    } else if (project.status === "planned" && project.start_date <= state.date) {
      statusChanges.push({ id: project.id, status: "building" });
      project.status = "building";
    } else if (project.status === "building" && project.end_date <= state.date) {
      statusChanges.push({ id: project.id, status: "complete" });
      project.status = "complete";
      completed.push(project);
    }
  }
  if (statusChanges.length)
    await store.run(
      "UPDATE club_projects AS target SET status = changes.status FROM unnest(?::integer[],?::text[]) AS changes(id,status) WHERE target.id = changes.id",
      statusChanges.map((change) => change.id),
      statusChanges.map((change) => change.status),
    );
  if (completed.length) {
    await store.run(
      `UPDATE clubs AS target SET
         facilities = LEAST(99, target.facilities + coalesce((effect.value ->> 'facilities')::double precision, 0)),
         academy = LEAST(99, target.academy + coalesce((effect.value ->> 'academy')::integer, 0)),
         capacity = CASE WHEN changes.kind = 'new_stadium' THEN (effect.value ->> 'capacity')::integer
           ELSE target.capacity + coalesce((effect.value ->> 'capacity')::integer, 0) END,
         stadium = coalesce(effect.value ->> 'stadium', target.stadium),
         fan_mood = CASE WHEN changes.kind IN ('new_stadium','stadium_expansion') THEN LEAST(99, target.fan_mood + 4) ELSE target.fan_mood END,
         reputation = CASE WHEN changes.kind = 'new_stadium' THEN LEAST(99, target.reputation + 1) ELSE target.reputation END
       FROM unnest(?::integer[],?::text[],?::text[]) AS changes(club_id,kind,effect)
       CROSS JOIN LATERAL (SELECT changes.effect::jsonb AS value) AS effect
       WHERE target.id = changes.club_id`,
      completed.map((project) => project.club_id),
      completed.map((project) => project.kind),
      completed.map((project) => project.effect),
    );
    for (const project of completed) {
      const club = byId.get(project.club_id)!;
      const effect = JSON.parse(project.effect) as ClubProjectView["effect"];
      const outcome = describeEffect(project.kind, effect);
      items.push({
        kind: "project",
        date: state.date,
        clubIds: [club.id],
        title: `${club.name} complete their ${PROJECT_LABELS[project.kind]}`,
        body: `${outcome} The ${money(project.cost)} project is finished.`,
        data: { projectId: project.id },
      });
      if (club.user)
        userNews.push({ title: `${PROJECT_LABELS[project.kind][0].toUpperCase()}${PROJECT_LABELS[project.kind].slice(1)} complete`, body: outcome, severity: "success" });
    }
  }
  await chargeProjects(store, state, rows);
  const active = new Map<number, number>();
  const recent = new Map<number, Set<ClubProjectKind>>();
  for (const project of rows) {
    if (["planned", "building"].includes(project.status)) active.set(project.club_id, (active.get(project.club_id) ?? 0) + 1);
    const years = project.status === "cancelled" ? 1 : PROJECT_RULES.cooldownYears[project.kind];
    if (["planned", "building"].includes(project.status) || daysBetween(project.end_date, state.date) < years * 365) {
      const kinds = recent.get(project.club_id) ?? new Set<ClubProjectKind>();
      kinds.add(project.kind);
      recent.set(project.club_id, kinds);
    }
  }
  const peerGroups = new Map<string, LifeClub[]>();
  for (const club of clubs) {
    const key = `${club.country_id}:${club.tier}`;
    peerGroups.set(key, [...(peerGroups.get(key) ?? []), club]);
  }
  const peerStats = new Map(
    [...peerGroups].map(([key, group]) => [
      key,
      {
        facilities: median(group.map((club) => club.facilities)),
        academy: median(group.map((club) => club.academy)),
        capacity: median(group.map((club) => club.capacity)),
      },
    ]),
  );
  const created: Record<string, unknown>[] = [];
  for (const club of clubs) {
    if (inAdministration(club) || !club.league_id) continue;
    const ambition = policies.get(club.id)?.ambition ?? club.reputation;
    if (random() >= PROJECT_RULES.reviewChance(ambition)) continue;
    if ((active.get(club.id) ?? 0) >= (club.revenue >= PROJECT_RULES.twoProjectsRevenue ? 2 : 1)) continue;
    const plan = chooseProject(club, peerStats.get(`${club.country_id}:${club.tier}`)!, ambition, random, recent.get(club.id) ?? new Set());
    if (!plan) continue;
    const cost = Math.round(plan.cost / 1000) * 1000;
    const startDate = addDays(state.date, plan.planningWeeks * 7);
    const endDate = addDays(startDate, plan.weeks * 7);
    const cash = Math.round(cost * plan.cashShare);
    const debt = cost - cash;
    const years = PROJECT_RULES.debtYears[plan.kind] ?? 0;
    const data: ProjectData = {
      cash,
      debt,
      weeklyCash: Math.round(cash / plan.weeks),
      weeklyRepayment: debt && years ? Math.round((debt * (1 + (PROJECT_RULES.interest * years) / 2)) / (years * 52)) : 0,
      repayUntil: debt && years ? addDays(endDate, years * 365) : null,
    };
    created.push({
      club_id: club.id,
      kind: plan.kind,
      cost,
      start_date: startDate,
      end_date: endDate,
      status: plan.planningWeeks ? "planned" : "building",
      effect: JSON.stringify(plan.effect),
      data: JSON.stringify(data),
    });
    const funding = debt ? ` (${money(cash)} from the club's reserves, ${money(debt)} borrowed)` : "";
    items.push({
      kind: "project",
      date: state.date,
      clubIds: [club.id],
      title: `${club.name} approve a ${money(cost)} ${PROJECT_LABELS[plan.kind]}`,
      body: `${describeEffect(plan.kind, plan.effect, true)} Work ${plan.planningWeeks ? "starts after planning approval" : "starts now"} and should finish around ${endDate.slice(0, 7)}${funding}.`,
    });
    if (club.user)
      userNews.push({
        title: `The board approves a ${PROJECT_LABELS[plan.kind]}`,
        body: `${describeEffect(plan.kind, plan.effect, true)} Cost ${money(cost)}${funding}, paid in weekly instalments outside the transfer budget; completion expected around ${endDate.slice(0, 7)}.`,
        severity: "info",
      });
  }
  if (created.length) await store.bulkInsert("club_projects", created);
  await worldNewsBatch(store, items);
  for (const item of userNews) await news(store, "Board", item.title, item.body, item.severity, "board");
  return { started: created.length, completed: completed.length };
}

function describeEffect(kind: ClubProjectKind, effect: ClubProjectView["effect"], planned = false) {
  const will = planned ? "will " : "";
  if (kind === "facilities") return `Training facilities ${will}improve by ${effect.facilities} points, helping player development.`;
  if (kind === "academy") return `The academy rating ${will}rise by ${effect.academy} points, improving future youth intakes.`;
  if (kind === "stadium_expansion") return `${effect.capacity?.toLocaleString("en-US")} seats ${planned ? "will be" : "have been"} added, raising matchday income.`;
  return `${effect.stadium} ${planned ? "will hold" : "opens with"} ${effect.capacity?.toLocaleString("en-US")} seats.`;
}

/** Weekly instalments: the cash share while building, debt repayments after completion; one write per table. */
async function chargeProjects(store: Store, state: GameState, rows: readonly ProjectRow[]) {
  const charges = new Map<number, number>();
  for (const project of rows) {
    const data = JSON.parse(project.data) as ProjectData;
    const amount =
      project.status === "building"
        ? data.weeklyCash
        : project.status === "complete" && data.repayUntil && data.repayUntil > state.date
          ? data.weeklyRepayment
          : 0;
    if (amount > 0) charges.set(project.club_id, (charges.get(project.club_id) ?? 0) + amount);
  }
  if (!charges.size) return;
  const ids = [...charges.keys()];
  const amounts = [...charges.values()];
  await store.run(
    "UPDATE clubs AS target SET balance = target.balance - changes.amount, spending = target.spending + changes.amount FROM unnest(?::integer[],?::double precision[]) AS changes(id,amount) WHERE target.id = changes.id",
    ids,
    amounts,
  );
  await store.run(
    `INSERT INTO financial_periods (club_id, season, excluded_investment)
     SELECT changes.id, ?::integer, -changes.amount FROM unnest(?::integer[],?::double precision[]) AS changes(id,amount)
     ON CONFLICT (club_id, season) DO UPDATE SET excluded_investment = financial_periods.excluded_investment + EXCLUDED.excluded_investment`,
    state.season,
    ids,
    amounts,
  );
  const own = charges.get(state.clubId);
  if (own)
    await store.run(
      "INSERT INTO ledger(club_id, date, category, amount, description) VALUES (?, ?, 'Infrastructure', ?, 'Club projects: weekly instalment')",
      state.clubId,
      state.date,
      -own,
    );
}

/** A club's projects for its club page and the boardroom, newest first. */
export async function clubProjects(store: Store, clubId: number): Promise<ClubProjectView[]> {
  return (
    await store.all<ProjectRow>(
      "SELECT id,club_id,kind,cost,start_date,end_date,status,effect,data FROM club_projects WHERE club_id = ? ORDER BY start_date DESC,id DESC LIMIT 20",
      clubId,
    )
  ).map((row) => {
    const data = JSON.parse(row.data) as ProjectData;
    return {
      id: row.id,
      kind: row.kind,
      cost: row.cost,
      start_date: row.start_date,
      end_date: row.end_date,
      status: row.status,
      effect: JSON.parse(row.effect),
      cash: data.cash,
      debt: data.debt,
      weeklyRepayment: data.weeklyRepayment,
      repayUntil: data.repayUntil,
    };
  });
}
