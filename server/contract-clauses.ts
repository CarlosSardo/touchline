import type { Store } from "./db.ts";
import type { PlayerRow } from "./people.ts";
import { RELEGATION_CLAUSE, relegationWageCutFor } from "../shared/contract-clauses.ts";
import type { PlayerProfile } from "../shared/types.ts";

const professional = "coalesce(player.profile::jsonb #>> '{contract,status}','professional') = 'professional'";
/** The contract object of a jsonb document expression ('{}' when absent). */
const contract = (doc: string) =>
  `coalesce(CASE WHEN jsonb_typeof(${doc} -> 'contract') = 'object' THEN ${doc} -> 'contract' END,'{}'::jsonb)`;

/** SQL mirror of shared relegationWageCutFor for `player` at `club` (tier expression given). */
function cutSql(tier: string) {
  const presence = "((player.id::bigint * 2654435761 + club.id::bigint * 40503) % 1000003)::double precision / 1000003";
  const size = "((player.id::bigint * 40503 + club.id::bigint * 2654435761 + 7) % 999983)::double precision / 999983";
  const share = `CASE WHEN ${tier} <= 1 THEN LEAST(0.85, GREATEST(0, (${RELEGATION_CLAUSE.establishedReputation} - club.reputation) / 30.0))
    WHEN ${tier} >= ${RELEGATION_CLAUSE.amateurTier} THEN ${RELEGATION_CLAUSE.amateurShare} ELSE ${RELEGATION_CLAUSE.lowerTierShare} END`;
  const steps = Math.round((RELEGATION_CLAUSE.maxCut - RELEGATION_CLAUSE.minCut) / 0.05) + 1;
  return `CASE WHEN ${presence} < ${share} THEN round((${RELEGATION_CLAUSE.minCut} + floor(${size} * ${steps}) * 0.05)::numeric, 2)::double precision END`;
}

interface ClauseSweep {
  /** Set once every contract existing at the time has its terms. */
  backfilled?: boolean;
  /** First player id the backfill has not reached yet (older worlds are termed a range of ids per day). */
  cursor?: number;
  /** Last day whose signings were termed. */
  date?: string;
}

/**
 * Player ids the backfill of an older world terms per day: one bounded statement (a few thousand contracts) instead
 * of one rewrite of every contract, which outlasts the statement timeout on a full world on a Raspberry Pi.
 */
export const CLAUSE_BACKFILL_IDS = 10_000;

const eligible = "player.age_group = 'Senior' AND player.role <> 'Retired' AND club.type = 'club'";
const termsOf = (doc: string, cut: string, clubId: string) =>
  `jsonb_set(${doc}, '{contract}', jsonb_build_object('status','professional') || ${contract(doc)}
     || jsonb_build_object('relegationWageCut', ${cut}, 'relegationClauseClubId', ${clubId}))::text`;

/**
 * Daily: contracts signed since the last run (players with a transfer recorded since then) get the relegation clause
 * terms of their new club. Contracts that existed before the clauses (an older save) get theirs once, `idsPerDay`
 * player ids per day in one statement that reads only the ids and writes only the contracts with a clause. Contracts
 * without terms on file have none of their club's clause yet: the terms are a deterministic function of player and
 * club, which relegation applies (season rollover) whether or not they were stamped.
 */
export async function sweepRelegationClauses(store: Store, date: string, idsPerDay = CLAUSE_BACKFILL_IDS) {
  const stored = (await store.get<{ value: string }>("SELECT value FROM meta WHERE key = 'clauseSweep'"))?.value;
  const sweep: ClauseSweep = stored ? JSON.parse(stored) : {};
  let changes = 0;
  let cursor: number | undefined;
  if (!sweep.backfilled) {
    const from = sweep.cursor ?? 0;
    changes += (
      await store.run(
        `UPDATE players AS target SET profile = ${termsOf("target.profile::jsonb", "terms.cut", "terms.club_id")}
         FROM (
           SELECT player.id, club.id AS club_id, ${cutSql("coalesce(leagues.tier, 9)")} AS cut
           FROM players AS player
           JOIN clubs AS club ON club.id = coalesce(player.parent_club_id, player.club_id)
           LEFT JOIN leagues ON leagues.id = club.league_id
           WHERE player.id >= ? AND player.id < ? AND ${eligible}
         ) AS terms
         WHERE target.id = terms.id AND terms.cut IS NOT NULL
           AND strpos(target.profile, '"relegationClauseClubId"') = 0 AND target.profile !~ '"status": ?"amateur"'`,
        from,
        from + idsPerDay,
      )
    ).changes;
    const last = (await store.get<{ id: number | null }>("SELECT max(id) AS id FROM players"))?.id ?? 0;
    if (from + idsPerDay <= last) cursor = from + idsPerDay;
  }
  // Signings are termed from the day after the sweep started, also while older contracts are still being backfilled.
  if (sweep.date) {
    const signed = (
      await store.all<{ id: number }>(
        "SELECT DISTINCT entity_id AS id FROM history WHERE entity_type = 'transfer' AND date >= ?",
        sweep.date,
      )
    ).map((row) => row.id);
    if (signed.length)
      changes += (
        await store.run(
          `WITH candidates AS MATERIALIZED (
             SELECT player.id, club.id AS club_id, ${cutSql("coalesce(leagues.tier, 9)")} AS cut, player.profile::jsonb AS doc
             FROM players AS player
             JOIN clubs AS club ON club.id = coalesce(player.parent_club_id, player.club_id)
             LEFT JOIN leagues ON leagues.id = club.league_id
             WHERE player.id = ANY(?::integer[]) AND ${eligible}
           )
           UPDATE players AS target SET profile = ${termsOf("candidates.doc", "candidates.cut", "candidates.club_id")}
           FROM candidates
           WHERE target.id = candidates.id
             AND coalesce(candidates.doc #>> '{contract,status}','professional') = 'professional'
             AND (candidates.doc #>> '{contract,relegationClauseClubId}') IS DISTINCT FROM candidates.club_id::text`,
          signed,
        )
      ).changes;
  }
  await store.setMeta("clauseSweep", cursor === undefined ? { backfilled: true, date } : { cursor, date });
  return changes;
}

/**
 * World generation: gives each new contract its relegation clause terms as the player rows are built (same terms as
 * the SQL backfill), so a new world needs no backfill. `clubs`/`leagues` are the planned rows; returns the stamper.
 */
export function relegationClauseStamper(
  clubs: readonly Record<string, string | number | null>[],
  leagues: readonly Record<string, string | number | null>[],
) {
  const tiers = new Map(leagues.map((league) => [Number(league.id), Number(league.tier)]));
  const terms = new Map(
    clubs
      .filter((club) => club.type === "club")
      .map((club) => [
        Number(club.id),
        { tier: club.league_id === null ? 9 : (tiers.get(Number(club.league_id)) ?? 9), reputation: Number(club.reputation) },
      ]),
  );
  return (row: PlayerRow & { id: number }): PlayerRow => {
    const clubId = Number(row.parent_club_id ?? row.club_id);
    const club = terms.get(clubId);
    if (!club || row.age_group !== "Senior" || row.role === "Retired") return row;
    const cut = relegationWageCutFor(row.id, clubId, club.tier, club.reputation);
    if (cut === null) return row;
    const profile = JSON.parse(String(row.profile)) as PlayerProfile;
    if (profile.contract?.status === "amateur") return row;
    profile.contract = { status: "professional", ...profile.contract, relegationWageCut: cut, relegationClauseClubId: clubId };
    return { ...row, profile: JSON.stringify(profile) };
  };
}

/** Marks a world whose contracts were termed at generation: the backfill does not run for it. */
export async function markClausesStamped(store: Store) {
  await store.setMeta("clauseSweep", { backfilled: true });
}

export interface RelegationCut {
  playerId: number;
  clubId: number;
  from: number;
  to: number;
}

/**
 * Season rollover, after promotion and relegation: contracts of relegated first teams with a relegation clause take
 * their wage cut (the clause terms on file, or the club's terms for contracts the sweep has not reached, using the
 * tier the contract was signed in). The player's morale drops; the wage bill falls from the next weekly accounts.
 * `season` is the season the reduced wage starts in.
 */
export async function applyRelegationClauses(store: Store, season: number): Promise<RelegationCut[]> {
  const cuts = await store.all<RelegationCut>(
    `WITH terms AS (${relegationTerms("club.data::jsonb ->> 'budgetMovement' = 'relegated'", "GREATEST(1, coalesce(leagues.tier, 9) - 1)")})
     UPDATE players AS target SET wage = round((terms.wage * (1 - terms.cut))::numeric)::double precision,
       morale = GREATEST(1, target.morale - ?),
       profile = jsonb_set(target.profile::jsonb, '{contract}',
         jsonb_build_object('status','professional') || ${contract("target.profile::jsonb")}
         || jsonb_build_object('relegationWageCut', terms.cut, 'relegationClauseClubId', terms.club_id,
           'relegationCutApplied', jsonb_build_object('season', ?::integer, 'cut', terms.cut, 'from', terms.wage,
             'to', round((terms.wage * (1 - terms.cut))::numeric))))::text
     FROM terms WHERE target.id = terms.id AND terms.cut > 0
     RETURNING target.id AS "playerId", terms.club_id AS "clubId", terms.wage AS "from", target.wage AS "to"`,
    RELEGATION_CLAUSE.morale,
    season,
  );
  // RETURNING follows the physical row order: sorted so the clubs' news is posted in the same order every run.
  return cuts.sort((left, right) => left.clubId - right.clubId || left.playerId - right.playerId);
}

/** Weekly wages each of `clubIds` saves from its relegation clauses if relegated now (pre-season FFP planning). */
export async function relegationWageSavings(store: Store, clubIds: readonly number[]) {
  if (!clubIds.length) return new Map<number, number>();
  return new Map(
    (
      await store.all<{ club_id: number; saved: number }>(
        `WITH terms AS (${relegationTerms("club.id = ANY(?::integer[])", "coalesce(leagues.tier, 9)")})
         SELECT club_id, sum(round((wage * cut)::numeric))::double precision AS saved FROM terms WHERE cut > 0 GROUP BY club_id`,
        [...clubIds],
      )
    ).map((row) => [row.club_id, row.saved]),
  );
}

/**
 * Contracts of the selected first teams with the relegation wage cut each would take: the clause on file, or the
 * club's terms for the tier the contract was signed in (`signedTier`: the club's league before the move).
 */
const relegationTerms = (clubs: string, signedTier: string) => `
  SELECT player.id, player.wage, club.id AS club_id,
    CASE WHEN (${contract("player.profile::jsonb")} ->> 'relegationClauseClubId') = club.id::text
      THEN CASE WHEN jsonb_typeof(${contract("player.profile::jsonb")} -> 'relegationWageCut') = 'number'
        THEN (${contract("player.profile::jsonb")} ->> 'relegationWageCut')::double precision END
      ELSE ${cutSql(signedTier)} END AS cut
  FROM clubs AS club
  LEFT JOIN leagues ON leagues.id = club.league_id
  JOIN players AS player ON coalesce(player.parent_club_id, player.club_id) = club.id
  WHERE club.type = 'club' AND ${clubs}
    AND player.age_group = 'Senior' AND player.role <> 'Retired' AND player.wage > 0 AND ${professional}`;
