import type { Store } from "./db.ts";
import { estimateClubRevenue, leagueGroupSizes, seasonHomeMatches } from "./finance.ts";
import type { GameState } from "../shared/types.ts";
import type { ClubAdministration, DofPolicy } from "../shared/api.ts";

/** Club-life fields kept in clubs.data. */
export interface ClubLifeFields {
  dofPolicy?: DofPolicy;
  dofId?: number;
  dofSince?: string;
  dofPolicyDate?: string;
  administration?: ClubAdministration;
  administrations?: { since: string; until: string; points: number; outcome: string }[];
  insolvency?: { weeks: number; since: string };
  managerCareer?: { season: number; date?: string; departed?: string; appointed?: string; formation?: string; style?: string }[];
  [key: string]: unknown;
}

/** A first team as the weekly club-life passes see it: one read per pass, expected revenue estimated once. */
export interface LifeClub {
  id: number;
  name: string;
  city: string;
  country_id: number;
  code: string;
  league_id: number | null;
  tier: number;
  league_reputation: number;
  league_size: number;
  reputation: number;
  balance: number;
  capacity: number;
  facilities: number;
  academy: number;
  philosophy: string;
  culture: string;
  fan_mood: number;
  crisis: number;
  manager: string;
  formation: string;
  tactical_style: string;
  stadium: string;
  data: ClubLifeFields;
  /** Expected annual operating revenue (neutral fan mood), as in the weekly accounts. */
  revenue: number;
  user: boolean;
}

export async function loadLifeClubs(store: Store, state: GameState): Promise<LifeClub[]> {
  const rows = await store.all<Omit<LifeClub, "data" | "revenue" | "user" | "league_size"> & { data: string }>(
    `SELECT clubs.id,clubs.name,clubs.city,clubs.country_id,countries.code,clubs.league_id,coalesce(leagues.tier,9) AS tier,
       coalesce(leagues.reputation,clubs.reputation) AS league_reputation,
       clubs.reputation,clubs.balance,clubs.capacity,clubs.facilities,clubs.academy,clubs.philosophy,clubs.culture,
       clubs.fan_mood,clubs.crisis,clubs.manager,clubs.formation,clubs.tactical_style,clubs.stadium,clubs.data
     FROM clubs JOIN countries ON countries.id = clubs.country_id
     LEFT JOIN leagues ON leagues.id = clubs.league_id
     WHERE clubs.type = 'club' ORDER BY clubs.id`,
  );
  const groups = await leagueGroupSizes(store);
  return rows.map((row) => ({
    ...row,
    data: JSON.parse(row.data) as ClubLifeFields,
    league_size: groups.get(row.id) ?? 0,
    revenue: estimateClubRevenue({
      reputation: row.reputation,
      leagueReputation: row.league_reputation,
      tier: row.tier,
      capacity: row.capacity,
      fanMood: 72,
      homeMatches: seasonHomeMatches(groups.get(row.id) ?? 0),
      countryCode: row.code,
    }).annualOperatingRevenue,
    user: row.id === state.clubId,
  }));
}

/** Writes changed clubs.data fields (top-level keys; null removes the key) in one statement. */
export async function patchClubData(store: Store, patches: ReadonlyMap<number, Record<string, unknown>>) {
  if (!patches.size) return;
  await store.run(
    `UPDATE clubs AS target SET data = ((target.data::jsonb - changes.removed) || changes.kept)::text
     FROM (SELECT patch.id,
         coalesce((SELECT jsonb_object_agg(entry.key, entry.value) FROM jsonb_each(patch.data::jsonb) AS entry
           WHERE entry.value <> 'null'::jsonb),'{}'::jsonb) AS kept,
         coalesce((SELECT array_agg(entry.key) FROM jsonb_each(patch.data::jsonb) AS entry
           WHERE entry.value = 'null'::jsonb),'{}'::text[]) AS removed
       FROM unnest(?::integer[],?::text[]) AS patch(id,data)) AS changes
     WHERE target.id = changes.id`,
    [...patches.keys()],
    [...patches.values()].map((patch) => JSON.stringify(patch)),
  );
}

export const inAdministration = (club: Pick<LifeClub, "data">) => !!club.data.administration;
