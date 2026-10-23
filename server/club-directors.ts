import type seedrandom from "seedrandom";
import type { Store } from "./db.ts";
import type { ClubPolicy } from "./club-policy.ts";
import { personName, staffCareerDefaults, weightedIndex } from "./people.ts";
import { contractEndFor, leaveClub } from "./club-support.ts";
import { inAdministration, patchClubData, type LifeClub } from "./club-life-context.ts";
import { worldNewsBatch, type WorldNewsInput } from "./world-news.ts";
import { clamp, daysBetween, FORMATION_POSITIONS } from "../shared/rules.ts";
import type { GameState, Staff } from "../shared/types.ts";
import type { DofPolicy } from "../shared/api.ts";

export const DOF_ROLE = "Director of football";

export const DIRECTOR_RULES = {
  /** First teams that employ a director of football: the top three tiers, or any club of this reputation. */
  maxTier: 3,
  minReputation: 50,
  /** Weekly chance a director is dismissed during a deep crisis, once he has had a year. */
  crisis: 70,
  dismissalChance: 0.08,
  tenureDays: 365,
  /** Days a transfer policy holds before finances or the owner can change it again. */
  policyDays: 91,
} as const;

export const DOF_POLICY_LABELS: Record<DofPolicy, string> = {
  balanced: "balanced recruitment",
  youth: "youth first",
  value: "value for money",
  stars: "star signings",
};

/** Director styles by club philosophy (balanced, youth, value, stars). */
const STYLE_WEIGHTS: Record<string, readonly number[]> = {
  "Develop and sell": [0.2, 0.45, 0.3, 0.05],
  "Win now": [0.35, 0.05, 0.15, 0.45],
  "Sustainable growth": [0.35, 0.2, 0.4, 0.05],
  "Local identity": [0.35, 0.45, 0.15, 0.05],
};
const STYLES: readonly DofPolicy[] = ["balanced", "youth", "value", "stars"];

export const dofEligible = (club: Pick<LifeClub, "tier" | "reputation" | "user">) =>
  !club.user && (club.tier <= DIRECTOR_RULES.maxTier || club.reputation >= DIRECTOR_RULES.minReputation);

export function directorStyle(philosophy: string, random: () => number): DofPolicy {
  return STYLES[weightedIndex([...(STYLE_WEIGHTS[philosophy] ?? [0.4, 0.2, 0.3, 0.1])], random())];
}

/**
 * The transfer policy a club follows: the director's own style, pushed toward stars by an ambitious owner with the
 * money, toward value by debt, low ambition or administration, toward youth by a develop-and-sell philosophy, and
 * toward an elected president's promise.
 */
export function dofPolicyFor(input: {
  style: DofPolicy;
  ambition: number;
  philosophy: string;
  balance: number;
  revenue: number;
  administration: boolean;
  /** A members' club president's election promise (club_ownership.data.policyHint). */
  hint?: DofPolicy;
}): DofPolicy {
  if (input.administration || input.balance < -0.1 * input.revenue) return "value";
  const score: Record<DofPolicy, number> = { balanced: 0, youth: 0, value: 0, stars: 0 };
  score[input.style] += 2;
  if (input.ambition >= 75 && input.balance > 0.25 * input.revenue) score.stars += 3;
  if (input.ambition <= 35) score.value += 2.5;
  if (input.balance < 0) score.value += 1.5;
  if (input.philosophy === "Develop and sell") score.youth += 1;
  if (input.philosophy === "Win now") score.stars += 0.5;
  if (input.hint) score[input.hint] += 2.5;
  return STYLES.reduce((best, policy) => (score[policy] > score[best] ? policy : best), input.style);
}

interface Director extends Pick<Staff, "id" | "club_id" | "name" | "ability"> {
  data: string;
}

/**
 * Weekly: AI first teams at the professional level keep a director of football (free directors of their level first,
 * otherwise a new appointment), deep crises cost a long-serving director his job, and every club's transfer policy
 * (clubs.data.dofPolicy, read by the market through the club policy snapshot) follows its director and owner.
 */
export async function directorsWeekly(
  store: Store,
  state: GameState,
  random: seedrandom.PRNG,
  clubs: readonly LifeClub[],
  policies: ReadonlyMap<number, ClubPolicy>,
) {
  const year = Number(state.date.slice(0, 4));
  const directors = new Map(
    (
      await store.all<Director>(
        "SELECT id,club_id,name,ability,data FROM staff WHERE role = ? AND club_id IS NOT NULL ORDER BY id",
        DOF_ROLE,
      )
    ).map((director) => [director.club_id!, director]),
  );
  const items: WorldNewsInput[] = [];
  const dismissed: Director[] = [];
  for (const club of clubs) {
    const director = directors.get(club.id);
    if (!director || club.user || club.crisis < DIRECTOR_RULES.crisis) continue;
    const since = club.data.dofId === director.id ? club.data.dofSince : undefined;
    if (since && daysBetween(since, state.date) >= DIRECTOR_RULES.tenureDays && random() < DIRECTOR_RULES.dismissalChance) {
      dismissed.push(director);
      directors.delete(club.id);
    }
  }
  for (const director of dismissed) {
    await leaveClub(store, director.id);
    await store.run("UPDATE staff SET data = (data::jsonb - 'contractEnd')::text WHERE id = ?", director.id);
  }
  const vacant = clubs.filter((club) => dofEligible(club) && !directors.has(club.id)).sort((a, b) => b.reputation - a.reputation);
  if (vacant.length) {
    const free = await store.all<Director>(
      "SELECT id,club_id,name,ability,data FROM staff WHERE role = ? AND club_id IS NULL AND data::jsonb ->> 'retired' IS NULL ORDER BY ability DESC,id",
      DOF_ROLE,
    );
    const dismissedIds = new Set(dismissed.map((director) => director.id));
    const hires: { id: number; club_id: number; wage: number; data: string }[] = [];
    const created: Record<string, unknown>[] = [];
    for (const club of vacant) {
      const index = free.findIndex(
        (candidate) =>
          !dismissedIds.has(candidate.id) &&
          candidate.ability >= club.reputation - 20 &&
          candidate.ability <= club.reputation + 8,
      );
      const contractEnd = contractEndFor(state.season, random);
      if (index >= 0) {
        const [candidate] = free.splice(index, 1);
        const data = JSON.parse(candidate.data);
        if (!STYLES.includes(data.policy)) data.policy = directorStyle(club.philosophy, random);
        hires.push({ id: candidate.id, club_id: club.id, wage: directorWage(candidate.ability), data: JSON.stringify({ ...data, contractEnd }) });
        directors.set(club.id, { ...candidate, club_id: club.id, data: JSON.stringify(data) });
        continue;
      }
      const ability = Math.round(clamp(club.reputation - 14 + random() * 24, 25, 95));
      const ambition = 30 + Math.floor(random() * 66);
      created.push({
        club_id: club.id,
        name: personName(random, club.code),
        role: DOF_ROLE,
        ability,
        influence: 45 + Math.floor(random() * 50),
        communication: 40 + Math.floor(random() * 56),
        tactical_knowledge: Math.round(clamp(ability + random() * 20 - 10)),
        personality: ["Collaborative", "Ambitious", "Reserved", "Outspoken", "Methodical"][Math.floor(random() * 5)],
        ambition,
        morale: 75,
        wage: directorWage(ability),
        data: JSON.stringify({
          policy: directorStyle(club.philosophy, random),
          preferredRegion: club.country_id,
          development: 0,
          ...staffCareerDefaults({ ability, ambition }, year, random),
          contractEnd,
        }),
      });
    }
    if (hires.length)
      await store.run(
        "UPDATE staff AS target SET club_id = changes.club_id, morale = 75, wage = changes.wage, data = changes.data FROM unnest(?::integer[],?::integer[],?::double precision[],?::text[]) AS changes(id,club_id,wage,data) WHERE target.id = changes.id AND target.club_id IS NULL",
        hires.map((hire) => hire.id),
        hires.map((hire) => hire.club_id),
        hires.map((hire) => hire.wage),
        hires.map((hire) => hire.data),
      );
    if (created.length) {
      await store.bulkInsert("staff", created);
      for (const director of await store.all<Director>(
        "SELECT id,club_id,name,ability,data FROM staff WHERE role = ? AND club_id = ANY(?::integer[])",
        DOF_ROLE,
        created.map((row) => row.club_id as number),
      ))
        directors.set(director.club_id!, director);
    }
  }
  const dismissedClubs = new Map(dismissed.map((director) => [director.club_id!, director]));
  const hints = new Map(
    (
      await store.all<{ club_id: number; hint: DofPolicy }>(
        "SELECT club_id,data::jsonb ->> 'policyHint' AS hint FROM club_ownership WHERE data::jsonb ->> 'policyHint' IN ('youth','stars','value')",
      )
    ).map((row) => [row.club_id, row.hint]),
  );
  const patches = new Map<number, Record<string, unknown>>();
  for (const club of clubs) {
    if (club.user) continue;
    const director = directors.get(club.id);
    const style = director ? (STYLES.find((entry) => entry === JSON.parse(director.data).policy) ?? "balanced") : "balanced";
    const policy = dofPolicyFor({
      style,
      ambition: policies.get(club.id)?.ambition ?? club.reputation,
      philosophy: club.philosophy,
      balance: club.balance,
      revenue: club.revenue,
      administration: inAdministration(club),
      hint: hints.get(club.id),
    });
    const appointed = director && club.data.dofId !== director.id;
    if (!appointed && policy === (club.data.dofPolicy ?? "balanced")) continue;
    // A policy holds for a quarter of a season unless the director changes or administration forces value.
    const held = club.data.dofPolicyDate && daysBetween(club.data.dofPolicyDate, state.date) < DIRECTOR_RULES.policyDays;
    if (!appointed && held && !inAdministration(club)) continue;
    patches.set(club.id, {
      dofPolicy: policy,
      dofPolicyDate: state.date,
      dofId: director?.id ?? null,
      dofSince: appointed ? state.date : (club.data.dofSince ?? null),
    });
    const departed = dismissedClubs.get(club.id);
    // The initial appointments of a world (or of an older save) are not news.
    if (!appointed) {
      if (club.data.dofPolicy)
        items.push({
          kind: "director",
          date: state.date,
          clubIds: [club.id],
          title: `${club.name} switch to a ${DOF_POLICY_LABELS[policy]} transfer policy`,
          body: `${club.name}'s recruitment now follows a ${DOF_POLICY_LABELS[policy]} policy instead of ${DOF_POLICY_LABELS[club.data.dofPolicy]}, reflecting the owner's ambition and the club's finances.`,
          data: { policy },
        });
    } else if (departed || club.data.dofId)
      items.push({
        kind: "director",
        date: state.date,
        clubIds: [club.id],
        title: departed ? `${club.name} dismiss director of football ${departed.name}` : `${club.name} appoint ${director!.name} as director of football`,
        body: `${departed ? `${departed.name} leaves after a difficult spell. ` : ""}${director!.name} takes over recruitment with a ${DOF_POLICY_LABELS[policy]} policy.`,
        data: { policy, directorId: director!.id },
      });
  }
  await patchClubData(store, patches);
  await worldNewsBatch(store, items);
  return { appointed: [...patches.values()].filter((patch) => patch.dofSince === state.date).length, dismissed: dismissed.length };
}

/** Directors of football earn more than the rest of the backroom staff. */
export const directorWage = (ability: number) => Math.round(ability ** 2 * 1.5);

/** Formation weights (4-3-3, 4-2-3-1, 3-5-2, 4-4-2) by football culture; lower English tiers still favour 4-4-2. */
function formationWeights(code: string, tier: number) {
  if (["IT", "DE", "NL", "AT", "CH"].includes(code)) return [0.3, 0.3, 0.3, 0.1];
  if (["EN", "SCO", "WAL", "NIR", "IE"].includes(code) && tier >= 3) return [0.2, 0.25, 0.1, 0.45];
  return [0.35, 0.35, 0.12, 0.18];
}

const TACTICAL_STYLES = ["Possession", "High press", "Counter attack", "Direct", "Balanced"];

/** A new manager's preferred shape and style; the world's tactical trend pulls part of the choices. */
export function managerPreference(random: () => number, code: string, tier: number, trend?: string) {
  const formations = Object.keys(FORMATION_POSITIONS);
  const order = ["4-3-3", "4-2-3-1", "3-5-2", "4-4-2"].filter((formation) => formations.includes(formation));
  const formation = order[weightedIndex(formationWeights(code, tier).slice(0, order.length), random())] ?? "4-3-3";
  const style =
    trend && TACTICAL_STYLES.includes(trend) && random() < 0.3
      ? trend
      : TACTICAL_STYLES[Math.floor(random() * TACTICAL_STYLES.length)];
  return { formation, style };
}

export const MANAGER_RULES = {
  base: 0.0065,
  /** Added weekly chance per point of crisis above `crisisFrom` and per point of manager trust below `trustFrom`. */
  crisisFrom: 20,
  perCrisis: 0.001,
  trustFrom: 50,
  perTrust: 0.0018,
  maximum: 0.35,
  /** A new manager is safe for this many days. */
  honeymoonDays: 70,
} as const;

/**
 * Weekly chance the board dismisses its manager: small for a settled club, rising with the sporting crisis (league
 * position against expectations, losing runs) and lost trust; certain once trust is gone in a crisis. Calibrated to
 * roughly a third to a half of clubs changing manager in a season, as in the major European leagues.
 */
export function sackingChance(crisis: number, trust: number) {
  if (trust < 22 && crisis > 50) return 1;
  return Math.min(
    MANAGER_RULES.maximum,
    MANAGER_RULES.base +
      Math.max(0, crisis - MANAGER_RULES.crisisFrom) * MANAGER_RULES.perCrisis +
      Math.max(0, MANAGER_RULES.trustFrom - trust) * MANAGER_RULES.perTrust,
  );
}
