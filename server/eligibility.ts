// Signing, association registration, competition registration and match eligibility (see shared/eligibility.ts).
// Every caller (signing, loans, registration, both match engines, the UI) goes through this module.
import { Store } from "./db.ts";
import { addDays, ageOn, disciplineScope, transferWindow } from "../shared/rules.ts";
import { competitionRegistrationRule } from "../shared/competition-rules.ts";
import {
  blocking,
  eligibilityLabel,
  type CompetitionEligibility,
  type EligibilitySummary,
  type GbeAssessment,
  type PlayerEligibility,
  type RegistrationStatus,
} from "../shared/eligibility.ts";
import type { Club, GameState, League, Player, PlayerProfile } from "../shared/types.ts";
import { clubRegistration, countsTowardQuota, foreignQuota, heldNationalities, passportGroup } from "./registration.ts";
import { gbeAssessment } from "./gbe.ts";
import { assessYouthTransfer } from "./recruitment.ts";
import { transferEmbargo } from "./finance.ts";
import { activeEmbargo } from "./sanctions.ts";
import { internationalLoanIssue, news } from "./systems.ts";

export type { PlayerEligibility, RegistrationStatus } from "../shared/eligibility.ts";

const BLOCKING_SQL = "('pending','not_registered','refused')";
/** Days until a refused or incomplete work-permit case is looked at again (GBE evidence is refreshed weekly). */
const REVIEW_DAYS = 28;

interface AssociationRow {
  player_id: number;
  club_id: number;
  association_id: number;
  status: RegistrationStatus;
  basis: string;
  reasons: string;
  evaluated_on: string;
  next_review: string | null;
  data: string;
}

interface Verdict {
  status: RegistrationStatus;
  basis: string;
  reasons: string[];
  nextReview?: string;
  gbe?: GbeAssessment;
  associationId: number;
}

const stateOf = (store: Store) => store.meta<GameState>("state");

/**
 * SQL predicate: the player (table alias `player`) may be picked for a competitive fixture of `league` in `season`
 * (SQL expressions; a NULL league is a friendly, which needs only a contract). No stored row means registered.
 */
export function competitiveRegistrationSql(player: string, league: string, season: string) {
  return `(${league} IS NULL OR (NOT EXISTS (SELECT 1 FROM player_registrations AS reg WHERE reg.player_id = ${player}.id AND reg.club_id = ${player}.club_id AND reg.status IN ${BLOCKING_SQL})
    AND NOT EXISTS (SELECT 1 FROM competition_registrations AS comp WHERE comp.player_id = ${player}.id AND comp.league_id = ${league} AND comp.season = ${season} AND comp.status IN ${BLOCKING_SQL})))`;
}

/** Next date on or after `date` inside a registration window. */
export function nextWindowOpening(date: string) {
  let cursor = date;
  for (let days = 0; days < 370; days++) {
    if (transferWindow(cursor)) return cursor;
    cursor = addDays(cursor, 1);
  }
  return date;
}

// ------------------------------------------------------------------- association registration

async function associationOf(store: Store, club: Pick<Club, "country_id" | "data">) {
  const home = (await store.get<{ code: string }>("SELECT code FROM countries WHERE id = ?", club.country_id))!.code;
  const { association } = clubRegistration(home, club.data);
  const id =
    association === home
      ? club.country_id
      : ((await store.get<{ id: number }>("SELECT id FROM countries WHERE code = ?", association))?.id ?? club.country_id);
  return { code: association, home, id };
}

async function nationalitiesOf(store: Store, player: Player) {
  const code = (await store.get<{ code: string }>("SELECT code FROM countries WHERE id = ?", player.country_id))!.code;
  return heldNationalities(code, JSON.parse(player.profile) as PlayerProfile);
}

/** Stored association status of a player at a club; no row means an existing (grandfathered) registration. */
async function storedAssociation(store: Store, playerId: number, clubId: number) {
  return store.get<AssociationRow>(
    "SELECT * FROM player_registrations WHERE player_id = ? AND club_id = ?",
    playerId,
    clubId,
  );
}

/** Work authorisation and association registration of `player` at `club` (pure decision over loaded inputs). */
async function evaluateAssociation(
  store: Store,
  player: Player,
  club: Club,
  date: string,
  existing: boolean,
): Promise<Verdict> {
  const association = await associationOf(store, club);
  if (club.type === "national")
    return { status: "not_required", basis: "national-team", reasons: ["National teams select players by nationality."], associationId: association.id };
  if (association.code !== "EN")
    return {
      status: "registered",
      basis: "no-work-permit",
      reasons: [`No work-permit endorsement is required for ${association.code} registration in this model.`],
      associationId: association.id,
    };
  const nationalities = await nationalitiesOf(store, player);
  if (nationalities.some((code) => ["GB", "IE"].includes(passportGroup(code))))
    return {
      status: "registered",
      basis: "domestic",
      reasons: ["British or Irish national: no Governing Body Endorsement is needed."],
      associationId: association.id,
    };
  if (existing)
    return {
      status: "registered",
      basis: "existing",
      reasons: ["Existing registration in this association carried over from the previous club."],
      associationId: association.id,
    };
  const gbe = await gbeAssessment(store, player.id, date);
  const nextReview = addDays(date, REVIEW_DAYS);
  if (gbe.outcome === "exempt" || gbe.outcome === "auto_pass" || gbe.outcome === "pass")
    return {
      status: "registered",
      basis: "gbe",
      reasons: [
        gbe.outcome === "exempt"
          ? `GBE exempt${gbe.exemptReason ? `: ${gbe.exemptReason}` : "."}`
          : gbe.outcome === "auto_pass"
            ? "GBE granted: international automatic pass."
            : `GBE granted: ${gbe.points}/${gbe.passMark} points.`,
      ],
      gbe,
      associationId: association.id,
    };
  if (gbe.outcome === "no_data")
    return {
      status: "pending",
      basis: "gbe",
      reasons: ["The GBE evidence is not available yet; the FA application waits for data.", `Next review ${nextReview}.`],
      nextReview,
      gbe,
      associationId: association.id,
    };
  return {
    status: "refused",
    basis: "gbe",
    reasons: [
      `Insufficient GBE: ${gbe.points}/${gbe.passMark} points${gbe.outcome === "panel" ? " (Exceptions Panel range, not granted automatically)" : ""}.`,
      `Friendlies and training only. Re-evaluated when the evidence changes (next review ${nextReview}); a loan can build points.`,
    ],
    nextReview,
    gbe,
    associationId: association.id,
  };
}

async function writeAssociation(store: Store, player: Player, clubId: number, verdict: Verdict, date: string, trigger: string) {
  const previous = await storedAssociation(store, player.id, clubId);
  await store.run(
    `INSERT INTO player_registrations (player_id, club_id, association_id, status, basis, reasons, evaluated_on, next_review, data)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT (player_id, club_id) DO UPDATE SET association_id = EXCLUDED.association_id, status = EXCLUDED.status,
       basis = EXCLUDED.basis, reasons = EXCLUDED.reasons, evaluated_on = EXCLUDED.evaluated_on,
       next_review = EXCLUDED.next_review, data = EXCLUDED.data`,
    player.id,
    clubId,
    verdict.associationId,
    verdict.status,
    verdict.basis,
    JSON.stringify(verdict.reasons),
    date,
    verdict.nextReview ?? null,
    JSON.stringify({ trigger, ...(verdict.gbe ? { gbe: verdict.gbe } : {}) }),
  );
  if (previous?.status === verdict.status) return;
  // Status changes reach the director through the inbox; other clubs' changes are only stored.
  const state = await stateOf(store);
  if (clubId !== state.clubId && player.parent_club_id !== state.clubId) return;
  if (verdict.status === "registered" && previous)
    await news(store, "Squad", `${player.name}: now registered`, `${verdict.reasons.join(" ")} He can be selected for competitive matches.`, "success", "squad", { playerId: player.id });
  else if (blocking(verdict.status))
    await news(
      store,
      "Squad",
      `${player.name}: ${verdict.status === "pending" ? "registration pending" : "registration refused"}`,
      `${verdict.reasons.join(" ")} He remains under contract and available for friendlies and training.`,
      "warning",
      "squad",
      { playerId: player.id },
    );
}

export interface PreviousSpell {
  clubId: number;
  status: RegistrationStatus;
}

/** The spell a player is about to leave (call before changing club_id); passed to registerSpell after the move. */
export async function currentSpell(store: Store, playerId: number): Promise<PreviousSpell | null> {
  const player = await store.get<{ club_id: number | null }>("SELECT club_id FROM players WHERE id = ?", playerId);
  if (!player?.club_id) return null;
  return { clubId: player.club_id, status: (await storedAssociation(store, playerId, player.club_id))?.status ?? "registered" };
}

/**
 * Evaluates and stores the association registration of a player's current club spell after a move (signing, loan
 * start/return, purchase). A registered spell at the previous club in the same association carries over.
 */
export async function registerSpell(store: Store, playerId: number, trigger: string, previous?: PreviousSpell | null) {
  const player = await store.get<Player>("SELECT * FROM players WHERE id = ?", playerId);
  if (!player) return null;
  const date = (await stateOf(store)).date;
  // Spells at other clubs have ended; a loaned-out player is registered at the borrower.
  await store.run("DELETE FROM player_registrations WHERE player_id = ? AND club_id IS DISTINCT FROM ?", playerId, player.club_id);
  await store.run("DELETE FROM competition_registrations WHERE player_id = ? AND club_id IS DISTINCT FROM ?", playerId, player.club_id);
  if (previous && previous.clubId !== player.club_id) await refreshQuotaLists(store, [previous.clubId]);
  if (!player.club_id || player.role === "Retired") return null;
  const club = (await store.get<Club>("SELECT * FROM clubs WHERE id = ?", player.club_id))!;
  let existing = false;
  if (previous && previous.clubId !== club.id && !blocking(previous.status)) {
    const before = await store.get<Club>("SELECT * FROM clubs WHERE id = ?", previous.clubId);
    existing = !!before && before.type === "club" && (await associationOf(store, before)).id === (await associationOf(store, club)).id;
  }
  const verdict = await evaluateAssociation(store, player, club, date, existing);
  await writeAssociation(store, player, club.id, verdict, date, trigger);
  await refreshQuotaLists(store, [club.id]);
  return verdict;
}

/** Set-based registerSpell cleanup for bulk moves: the moved players' registrations at clubs they no longer play for. */
export async function endSpells(store: Store, playerIds: readonly number[]) {
  if (!playerIds.length) return;
  for (const table of ["player_registrations", "competition_registrations"])
    await store.run(
      `DELETE FROM ${table} AS reg USING players WHERE players.id = reg.player_id AND reg.player_id = ANY(?::integer[]) AND players.club_id IS DISTINCT FROM reg.club_id`,
      [...playerIds],
    );
}

/** The association registration a signing by `clubId` would get today (nothing stored; quotas excluded). */
export async function predictRegistration(store: Store, playerId: number, clubId: number) {
  const player = (await store.get<Player>("SELECT * FROM players WHERE id = ?", playerId))!;
  const club = (await store.get<Club>("SELECT * FROM clubs WHERE id = ?", clubId))!;
  const previous = await currentSpell(store, playerId);
  const before = previous && !blocking(previous.status) ? await store.get<Club>("SELECT * FROM clubs WHERE id = ?", previous.clubId) : undefined;
  const existing =
    !!before && before.type === "club" && (await associationOf(store, before)).id === (await associationOf(store, club)).id;
  const { status, reasons, gbe } = await evaluateAssociation(store, player, club, (await stateOf(store)).date, existing);
  return { status, reasons, ...(gbe ? { gbe } : {}) };
}

// ------------------------------------------------------------------- competition registration (quotas)

/** Competitions a club side takes part in this season (league, cups, continental). */
async function seasonCompetitions(store: Store, clubIds: readonly number[], season: number) {
  const rows = await store.all<League & { club_id: number }>(
    `SELECT DISTINCT entries.club_id, leagues.* FROM (
       SELECT standings.club_id, standings.league_id FROM standings WHERE standings.club_id = ANY(?::integer[])
       UNION SELECT fixtures.home_id, fixtures.league_id FROM fixtures WHERE fixtures.season = ? AND fixtures.home_id = ANY(?::integer[])
       UNION SELECT fixtures.away_id, fixtures.league_id FROM fixtures WHERE fixtures.season = ? AND fixtures.away_id = ANY(?::integer[])
     ) AS entries JOIN leagues ON leagues.id = entries.league_id
     WHERE leagues.kind <> 'international'
     ORDER BY entries.club_id, leagues.kind, leagues.reputation DESC, leagues.id`,
    clubIds,
    season,
    clubIds,
    season,
    clubIds,
  );
  const result = new Map<number, League[]>();
  for (const { club_id, ...league } of rows) result.set(club_id, [...(result.get(club_id) ?? []), league as League]);
  return result;
}

/**
 * Rebuilds the foreign-quota registrations of clubs whose association limits non-EU/international players.
 * Registered players keep their place for the season; free places are filled by ability inside a registration
 * window (or at season start), otherwise the player waits for the next window.
 */
export async function refreshQuotaLists(store: Store, clubIds?: readonly number[], seasonStart = false) {
  const state = await stateOf(store);
  const clubs = await store.all<Club & { tier: number | null; code: string }>(
    `SELECT clubs.*, leagues.tier, countries.code FROM clubs LEFT JOIN leagues ON leagues.id = clubs.league_id
     JOIN countries ON countries.id = clubs.country_id
     WHERE clubs.type = 'club' AND clubs.parent_id IS NULL ${clubIds ? "AND clubs.id = ANY(?::integer[])" : ""}`,
    ...(clubIds ? [[...clubIds]] : []),
  );
  const quotaClubs = clubs
    .map((club) => {
      const { association, home } = clubRegistration(club.code, club.data);
      return { club, home, quota: club.tier ? foreignQuota(association, club.tier, home) : undefined };
    })
    .filter((entry) => entry.quota);
  if (!quotaClubs.length) return;
  const ids = quotaClubs.map((entry) => entry.club.id);
  const competitions = await seasonCompetitions(store, ids, state.season);
  const players = await store.all<{
    id: number;
    club_id: number;
    ability: number;
    code: string;
    nationalities: string | null;
    association: RegistrationStatus | null;
  }>(
    `SELECT players.id, players.club_id, players.ability, countries.code,
       (players.profile::jsonb #> '{identity,nationalities}')::text AS nationalities,
       (SELECT reg.status FROM player_registrations AS reg WHERE reg.player_id = players.id AND reg.club_id = players.club_id) AS association
     FROM players JOIN countries ON countries.id = players.country_id
     WHERE players.club_id = ANY(?::integer[]) AND players.age_group = 'Senior' AND players.role <> 'Retired'
     ORDER BY players.ability DESC, players.id`,
    ids,
  );
  const stored = await store.all<{ player_id: number; league_id: number; status: RegistrationStatus }>(
    "SELECT player_id, league_id, status FROM competition_registrations WHERE club_id = ANY(?::integer[]) AND season = ?",
    ids,
    state.season,
  );
  const window = seasonStart || transferWindow(state.date);
  const review = nextWindowOpening(state.date);
  const rows: Record<string, unknown>[] = [];
  for (const { club, home, quota } of quotaClubs) {
    const leagues = (competitions.get(club.id) ?? []).filter(
      (league) => competitionRegistrationRule(league)?.foreignQuota,
    );
    if (!leagues.length) continue;
    const counted = players.filter((player) => {
      if (player.club_id !== club.id || (player.association && blocking(player.association))) return false;
      const extra = player.nationalities ? (JSON.parse(player.nationalities) as { code: string }[]).map((entry) => entry.code) : [];
      return countsTowardQuota(quota!, [...new Set([player.code, ...extra])], home);
    });
    for (const league of leagues) {
      const held = new Set(
        stored
          .filter((row) => row.league_id === league.id && row.status === "registered" && !seasonStart)
          .map((row) => row.player_id),
      );
      const keep = counted.filter((player) => held.has(player.id)).slice(0, quota!.limit);
      let free = quota!.limit - keep.length;
      const label = quota!.counts === "non-eu" ? "non-EU" : "international";
      for (const player of counted) {
        const kept = keep.includes(player);
        const status: RegistrationStatus = kept ? "registered" : free > 0 ? (window ? "registered" : "pending") : "not_registered";
        if (!kept && free > 0) free--;
        rows.push({
          player_id: player.id,
          club_id: club.id,
          league_id: league.id,
          season: state.season,
          status,
          reasons: JSON.stringify(
            status === "registered"
              ? [`Registered in a ${label} place (${quota!.source}).`]
              : status === "pending"
                ? [`A ${label} place is free, but registration opens with the next window (${review}).`]
                : [`${label[0].toUpperCase()}${label.slice(1)} quota full (${quota!.limit}/${quota!.limit}): ${quota!.source}.`],
          ),
          evaluated_on: state.date,
          next_review: status === "registered" ? null : review,
        });
      }
    }
  }
  // A player's competition registration belongs to his current club: rows left at a previous club (moves made without
  // registerSpell, e.g. at the rollover or by the world market, until processRegistrations' cleanup) would collide.
  await store.run(
    "DELETE FROM competition_registrations WHERE season = ? AND (club_id = ANY(?::integer[]) OR player_id = ANY(?::integer[]))",
    state.season,
    ids,
    [...new Set(rows.map((row) => row.player_id as number))],
  );
  if (rows.length) await store.bulkInsert("competition_registrations", rows);
}

// ------------------------------------------------------------------- re-evaluation triggers

/**
 * Re-evaluates association registrations that are not (yet) approved and the clubs' quota lists. Triggers: GBE
 * refresh, window opening, loan start/return, quota place freed, season rollover. An approved registration stays
 * valid for the whole club spell.
 */
export async function reevaluateRegistrations(store: Store, playerIds?: readonly number[], reason = "review") {
  const state = await stateOf(store);
  const rows = await store.all<AssociationRow>(
    `SELECT reg.* FROM player_registrations AS reg JOIN players ON players.id = reg.player_id AND players.club_id = reg.club_id
     WHERE reg.status IN ${BLOCKING_SQL} ${playerIds ? "AND reg.player_id = ANY(?::integer[])" : ""} ORDER BY reg.player_id`,
    ...(playerIds ? [[...playerIds]] : []),
  );
  for (const row of rows) {
    const player = (await store.get<Player>("SELECT * FROM players WHERE id = ?", row.player_id))!;
    const club = (await store.get<Club>("SELECT * FROM clubs WHERE id = ?", row.club_id))!;
    await writeAssociation(store, player, club.id, await evaluateAssociation(store, player, club, state.date, false), state.date, reason);
  }
  const clubs = playerIds
    ? (await store.all<{ club_id: number }>(
        "SELECT DISTINCT club_id FROM players WHERE id = ANY(?::integer[]) AND club_id IS NOT NULL",
        [...playerIds],
      )).map((row) => row.club_id)
    : undefined;
  if (!clubs || clubs.length) await refreshQuotaLists(store, clubs, reason === "season");
}

/**
 * Daily registration housekeeping: season lists (also the lazy backfill of worlds created before registrations were
 * stored), window openings, due reviews, ended spells and freed quota places.
 */
export async function processRegistrations(store: Store) {
  const state = await stateOf(store);
  // Spells ended by moves outside the hooked paths (released players, AI market moves).
  await store.run(
    "DELETE FROM player_registrations AS reg USING players WHERE players.id = reg.player_id AND players.club_id IS DISTINCT FROM reg.club_id",
  );
  const freed = await store.all<{ club_id: number }>(
    `DELETE FROM competition_registrations AS comp USING players
     WHERE players.id = comp.player_id AND players.club_id IS DISTINCT FROM comp.club_id RETURNING comp.club_id`,
  );
  const listed = await store.get<{ value: string }>("SELECT value FROM meta WHERE key = 'registrationSeason'");
  if (!listed || Number(listed.value) !== state.season) {
    await reevaluateRegistrations(store, undefined, "season");
    await store.setMeta("registrationSeason", state.season);
    return;
  }
  if (transferWindow(state.date) && !transferWindow(addDays(state.date, -1))) {
    await reevaluateRegistrations(store, undefined, "window");
    return;
  }
  // A GBE cache refresh (weekly, after international windows, at rollover: server/gbe.ts) reviews every GBE case.
  const gbe = await store.get<{ value: string }>("SELECT value FROM meta WHERE key = 'gbeRefresh'");
  const reviewed = await store.get<{ value: string }>("SELECT value FROM meta WHERE key = 'registrationGbeReview'");
  const refreshed = gbe ? (JSON.parse(gbe.value) as { date?: string }).date : undefined;
  if (refreshed && refreshed !== (reviewed ? JSON.parse(reviewed.value) : undefined)) {
    await store.setMeta("registrationGbeReview", refreshed);
    const cases = await store.all<{ player_id: number }>(
      `SELECT player_id FROM player_registrations WHERE basis = 'gbe' AND status IN ${BLOCKING_SQL}`,
    );
    if (cases.length) await reevaluateRegistrations(store, cases.map((row) => row.player_id), "gbe");
  }
  const due = await store.all<{ player_id: number }>(
    "SELECT player_id FROM player_registrations WHERE next_review IS NOT NULL AND next_review <= ? AND status IN " + BLOCKING_SQL,
    state.date,
  );
  if (due.length) await reevaluateRegistrations(store, due.map((row) => row.player_id), "review");
  if (transferWindow(state.date)) {
    const waiting = await store.all<{ club_id: number }>(
      "SELECT DISTINCT club_id FROM competition_registrations WHERE season = ? AND status IN ('pending','not_registered')",
      state.season,
    );
    const clubs = [...new Set([...waiting, ...freed].map((row) => row.club_id))];
    if (clubs.length) await refreshQuotaLists(store, clubs);
  }
}

// ------------------------------------------------------------------- match eligibility

/**
 * Players who may be picked for a fixture: not injured or suspended, plus a club contract and, for competitive
 * club fixtures, the association and competition registration (friendlies need only the contract; national-team
 * matches select by nationality).
 */
export async function eligibleForFixture(store: Store, fixtureId: number, playerIds: readonly number[]) {
  if (!playerIds.length) return new Set<number>();
  const fixture = await store.get<{ league_id: number | null; season: number; date: string; home_id: number; away_id: number }>(
    "SELECT league_id, season, date, home_id, away_id FROM fixtures WHERE id = ?",
    fixtureId,
  );
  if (!fixture) return new Set<number>();
  const league = fixture.league_id
    ? await store.get<League>("SELECT * FROM leagues WHERE id = ?", fixture.league_id)
    : undefined;
  const national = league?.kind === "international";
  const rows = await store.all<{ id: number }>(
    `SELECT players.id FROM players
     WHERE players.id = ANY(?::integer[]) AND players.role <> 'Retired' ${national ? "" : "AND players.club_id IS NOT NULL"}
       AND (players.injury_until IS NULL OR players.injury_until <= ?)
       AND NOT EXISTS (SELECT 1 FROM discipline WHERE discipline.player_id = players.id AND discipline.scope = ? AND discipline.suspension > 0)
       ${national ? "" : `AND ${competitiveRegistrationSql("players", "?::integer", "?::integer")}`}`,
    [...playerIds],
    fixture.date,
    disciplineScope(league),
    ...(national ? [] : [league?.id ?? null, league?.id ?? null, fixture.season]),
  );
  return new Set(rows.map((row) => row.id));
}

// ------------------------------------------------------------------- signing (contract layer)

export type SigningKind = "transfer" | "free" | "loan_in" | "youth";

/**
 * Real transfer prerequisites only: contract validity, the registration window for contracted players, funds,
 * FIFA Art. 19 for minors and the loan regulations. Never GBE, quotas or squad lists (those decide registration).
 */
export async function canSign(
  store: Store,
  playerId: number,
  clubId: number,
  kind: SigningKind,
  options: { fee?: number; wage?: number; emergency?: boolean } = {},
): Promise<{ ok: boolean; reasons: string[]; codes: string[] }> {
  const state = await stateOf(store);
  const player = await store.get<Player>("SELECT * FROM players WHERE id = ?", playerId);
  const club = await store.get<Club>("SELECT * FROM clubs WHERE id = ?", clubId);
  const blockers: [string, string][] = [];
  const done = () => ({ ok: !blockers.length, reasons: blockers.map(([, reason]) => reason), codes: blockers.map(([code]) => code) });
  if (!player || !club) return { ok: false, reasons: ["Player or club not found."], codes: ["missing"] };
  if (player.role === "Retired") blockers.push(["retired", "The player has retired."]);
  if (club.type !== "club") blockers.push(["club", "Only clubs can sign players."]);
  if (player.club_id === club.id && !player.parent_club_id) blockers.push(["same-club", "The player is already under contract with this club."]);
  if (player.parent_club_id) blockers.push(["on-loan", "The player is on loan; that agreement must end first."]);
  if (kind === "free" && player.club_id) blockers.push(["contracted", "The player is under contract; a fee or loan is needed."]);
  if (kind === "loan_in" && !player.club_id) blockers.push(["free-agent-loan", "Free agents can sign a contract, but cannot be loaned."]);
  const age = ageOn(player.birth_date, state.date);
  if (kind === "loan_in" && age < 16) blockers.push(["loan-age", "Players must be at least 16 for a loan."]);
  if (player.club_id && player.contract_end < state.date) blockers.push(["contract", "The current contract has expired."]);
  if (player.club_id && !transferWindow(state.date) && !options.emergency)
    blockers.push(["window", `The registration window is closed; the move can complete from ${nextWindowOpening(state.date)}.`]);
  if (transferEmbargo(club.balance, options.fee ?? 0)) blockers.push(["embargo", "Transfer embargo: the club's cash balance is negative."]);
  else if (club.type === "club" && (await activeEmbargo(store, club.id, state.date)))
    blockers.push(["embargo", "Registration embargo: the club may not register new signings while the sanction applies."]);
  if (options.fee !== undefined && options.fee > club.transfer_budget) blockers.push(["funds", "The fee exceeds the transfer budget."]);
  if (options.wage !== undefined) {
    const wages = (await store.get<{ total: number }>("SELECT coalesce(sum(wage),0) AS total FROM players WHERE club_id = ?", club.id))!.total;
    if (wages + options.wage > club.wage_budget) blockers.push(["wages", "The wage does not fit the weekly wage budget."]);
  }
  if (club.type === "club" && player.role !== "Retired") {
    // The stored age is refreshed on birthdays; the date decides (future transfers complete at 18).
    const youth = await assessYouthTransfer(store, { ...player, age }, club);
    if (youth.minor && !youth.eligibleToApply) blockers.push(["article-19", youth.reasons.join(" ")]);
    else if (youth.minor && !youth.approved && youth.application?.status !== "pending" && youth.application)
      blockers.push(["article-19", `${youth.status}. ${youth.reasons.join(" ")}`]);
  }
  if (kind === "loan_in" && player.club_id && !player.parent_club_id) {
    const parent = (await store.get<Club>("SELECT * FROM clubs WHERE id = ?", player.club_id))!;
    if ((await associationOf(store, parent)).id !== (await associationOf(store, club)).id) {
      if (options.emergency) blockers.push(["emergency", "Emergency loans outside the window are only allowed within the same association."]);
      const limit = await internationalLoanIssue(store, player, parent, club, state.date);
      if (limit) blockers.push(["loan-limit", limit]);
    }
  }
  return done();
}

// ------------------------------------------------------------------- read models

function parseList(text: string | null | undefined): string[] {
  try {
    const value: unknown = JSON.parse(text ?? "[]");
    return Array.isArray(value) ? value.map(String) : [];
  } catch {
    return [];
  }
}

function gbeOf(row: AssociationRow | undefined) {
  try {
    return row ? ((JSON.parse(row.data) as { gbe?: GbeAssessment }).gbe ?? undefined) : undefined;
  } catch {
    return undefined;
  }
}

/** Contract, association, per-competition and next-fixture eligibility of one player. */
export async function playerEligibility(store: Store, playerId: number, asOf?: string): Promise<PlayerEligibility> {
  const state = await stateOf(store);
  const date = asOf ?? state.date;
  const player = await store.get<Player & { playing_club_id: number | null }>("SELECT * FROM players WHERE id = ?", playerId);
  if (!player) throw new Error(`Player ${playerId} not found.`);
  const contracted = player.club_id !== null && player.role !== "Retired";
  const row = contracted ? await storedAssociation(store, player.id, player.club_id!) : undefined;
  const association: PlayerEligibility["association"] = !contracted
    ? { status: "not_registered", reasons: ["Not under contract with a club."] }
    : row
      ? { status: row.status, reasons: parseList(row.reasons), nextReview: row.next_review ?? undefined, gbe: gbeOf(row), basis: row.basis }
      : { status: "registered", reasons: ["Registration on file with the club's association."], basis: "existing" };
  const competitions: CompetitionEligibility[] = [];
  if (contracted) {
    const side = player.playing_club_id ?? player.club_id!;
    const leagues = (await seasonCompetitions(store, [side], state.season)).get(side) ?? [];
    const stored = await store.all<{ league_id: number; status: RegistrationStatus; reasons: string; next_review: string | null }>(
      "SELECT league_id, status, reasons, next_review FROM competition_registrations WHERE player_id = ? AND season = ?",
      player.id,
      state.season,
    );
    for (const league of leagues) {
      const entry = stored.find((item) => item.league_id === league.id);
      competitions.push(
        blocking(association.status)
          ? { leagueId: league.id, name: league.name, status: association.status, reasons: ["Association registration required first."] }
          : entry
            ? { leagueId: league.id, name: league.name, status: entry.status, reasons: parseList(entry.reasons), nextReview: entry.next_review ?? undefined }
            : { leagueId: league.id, name: league.name, status: "registered", reasons: [] },
      );
    }
  }
  const gbeFailed = association.basis === "gbe" && association.status === "refused";
  const clubLeague = contracted
    ? (await store.get<{ league_id: number | null }>("SELECT league_id FROM clubs WHERE id = ?", player.playing_club_id ?? player.club_id))?.league_id
    : null;
  const { label, text } = eligibilityLabel({
    contracted,
    onLoanFromParent: !!player.parent_club_id,
    association: { status: association.status, gbeFailed, points: association.gbe?.points, passMark: association.gbe?.passMark },
    competitions: competitions.map((entry) => ({ ...entry, primary: entry.leagueId === clubLeague })),
  });
  let nextFixture: PlayerEligibility["nextFixture"];
  if (contracted) {
    const side = player.playing_club_id ?? player.club_id!;
    const fixture = await store.get<{ id: number; date: string; competition: string | null }>(
      `SELECT fixtures.id, fixtures.date, leagues.name AS competition FROM fixtures LEFT JOIN leagues ON leagues.id = fixtures.league_id
       WHERE fixtures.status = 'scheduled' AND (fixtures.home_id = ? OR fixtures.away_id = ?) AND fixtures.date >= ?
       ORDER BY fixtures.date, fixtures.id LIMIT 1`,
      side,
      side,
      date,
    );
    if (fixture) {
      const eligible = (await eligibleForFixture(store, fixture.id, [player.id])).has(player.id);
      const reasons: string[] = [];
      if (!eligible) {
        if (player.injury_until && player.injury_until > fixture.date) reasons.push(`Injured until ${player.injury_until}.`);
        const competition = competitions.find((entry) => entry.name === fixture.competition);
        if (fixture.competition && (blocking(association.status) || (competition && blocking(competition.status))))
          reasons.push(`Not registered for ${fixture.competition}.`);
        if (!reasons.length) reasons.push("Suspended for this competition.");
      }
      nextFixture = { fixtureId: fixture.id, date: fixture.date, competition: fixture.competition ?? "Friendly", eligible, reasons };
    }
  }
  return {
    playerId: player.id,
    clubId: player.club_id,
    contracted,
    association,
    competitions,
    label,
    text,
    friendliesOnly: contracted && competitions.length > 0 && competitions.every((entry) => blocking(entry.status)),
    ...(nextFixture ? { nextFixture } : {}),
  };
}

/** Badge summaries for lists (set-based: two queries for any number of players). */
export async function eligibilitySummaries(
  store: Store,
  players: readonly Pick<Player, "id" | "club_id" | "parent_club_id" | "role">[],
): Promise<Map<number, EligibilitySummary>> {
  const result = new Map<number, EligibilitySummary>();
  if (!players.length) return result;
  const state = await stateOf(store);
  const ids = players.map((player) => player.id);
  const associations = new Map(
    (
      await store.all<AssociationRow>(
        "SELECT reg.* FROM player_registrations AS reg JOIN players ON players.id = reg.player_id AND players.club_id = reg.club_id WHERE reg.player_id = ANY(?::integer[])",
        ids,
      )
    ).map((row) => [row.player_id, row]),
  );
  const competitions = new Map<number, { status: RegistrationStatus; next_review: string | null; reasons: string; club_league: boolean }[]>();
  for (const row of await store.all<{ player_id: number; status: RegistrationStatus; next_review: string | null; reasons: string; club_league: boolean }>(
    `SELECT comp.player_id, comp.status, comp.next_review, comp.reasons, comp.league_id = clubs.league_id AS club_league
     FROM competition_registrations AS comp JOIN clubs ON clubs.id = comp.club_id
     WHERE comp.player_id = ANY(?::integer[]) AND comp.season = ?`,
    ids,
    state.season,
  ))
    competitions.set(row.player_id, [...(competitions.get(row.player_id) ?? []), row]);
  for (const player of players) {
    const row = associations.get(player.id);
    const contracted = player.club_id !== null && player.role !== "Retired";
    const gbe = gbeOf(row);
    const entries = competitions.get(player.id) ?? [];
    const { label, text } = eligibilityLabel({
      contracted,
      onLoanFromParent: !!player.parent_club_id,
      association: {
        status: row?.status ?? "registered",
        gbeFailed: row?.basis === "gbe" && row.status === "refused",
        points: gbe?.points,
        passMark: gbe?.passMark,
      },
      // Competitions without a stored row are registered (rows exist only where a list rule applies).
      competitions: [
        ...entries.map((entry) => ({ status: entry.status, nextReview: entry.next_review ?? undefined, primary: entry.club_league })),
        { status: "registered" as const },
      ],
    });
    const reason = row && blocking(row.status) ? parseList(row.reasons)[0] : parseList(entries.find((entry) => blocking(entry.status))?.reasons)[0];
    result.set(player.id, { label, text, ...(reason ? { reason } : {}) });
  }
  return result;
}
