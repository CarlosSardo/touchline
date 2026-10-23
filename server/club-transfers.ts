import { z } from "zod";
import type { Store } from "./db.ts";
import { GameError, stateOf } from "./systems.ts";
import {
  foldSquadMoves,
  idOrNull,
  numberOrNull,
  parse,
  registrationEntry,
  squadEntry,
  textOrNull,
  transferKind,
  type FamilyClub,
  type HistoryLoanRow,
  type HistoryMoveRow,
  type SquadEntry,
} from "./player-history.ts";
import { ageOn } from "../shared/rules.ts";
import type {
  ClubSquadMove,
  ClubTransfer,
  ClubTransferClub,
  ClubTransfers,
  ClubTransferSeasonSummary,
  ClubTransferTotals,
  PlayerMoveKind,
} from "../shared/api.ts";
import type { TransferTerms } from "../shared/types.ts";

export const CLUB_TRANSFER_ROW_LIMIT = 20_000;
/** Squad movements listed per request (newest first). */
export const CLUB_SQUAD_MOVE_LIMIT = 200;
export const CLUB_TRANSFER_KINDS = [
  "transfer",
  "free",
  "loan",
  "loanReturn",
  "loanRecall",
  "loanPurchase",
  "registration",
] as const satisfies readonly PlayerMoveKind[];
const FEE_KINDS = new Set<PlayerMoveKind>(["transfer", "loan", "loanPurchase"]);
const LOAN_END_KINDS = new Set<PlayerMoveKind>(["loanReturn", "loanRecall"]);

export const clubTransfersQuerySchema = z.object({
  season: z.coerce.number().int().min(1900).max(3000).optional(),
  direction: z.enum(["in", "out", "all"]).default("all"),
  type: z
    .string()
    .max(200)
    .optional()
    .transform((value) => (value ? [...new Set(value.split(",").map((entry) => entry.trim()).filter(Boolean))] : []))
    .pipe(z.array(z.enum(CLUB_TRANSFER_KINDS))),
  page: z.coerce.number().int().min(1).max(100_000).default(1),
  pageSize: z.coerce.number().int().min(1).max(500).default(100),
});
export type ClubTransfersQuery = z.infer<typeof clubTransfersQuerySchema>;

export interface ClubHistoryRow extends HistoryMoveRow {
  entity_id: number;
}
export interface ClubLoanRow extends HistoryLoanRow {
  player_id: number;
}
/** One recorded move seen from the club; players, clubs and terms are attached for the page only. */
export interface ClubMoveRecord {
  key: string;
  kind: PlayerMoveKind;
  direction: "in" | "out";
  date: string | null;
  dateEstimated: boolean;
  season: number;
  playerId: number;
  playerName: string | null;
  fromClubId: number | null;
  toClubId: number | null;
  fee: number | null;
  dealType: string | null;
  loanUntil: string | null;
  /** Newest-first sort key: the date, or just after the loan start for an undated end. */
  order: string;
}

/** Seasons start on 1 July (the 2026 season runs 2026-07-01 to 2027-06-30). */
export const seasonOfDate = (date: string) => Number(date.slice(0, 4)) - (date.slice(5, 7) < "07" ? 1 : 0);

/**
 * Pure: every recorded move with another club into or out of `clubId`, newest first, and apart from them the moves
 * inside the club's family that involve it (squad moves, call-ups, B-team and age-group registrations).
 */
export function clubMoves(
  clubId: number,
  rows: ClubHistoryRow[],
  loans: ClubLoanRow[],
  rowsTruncated: boolean,
  family: ReadonlySet<number> = new Set([clubId]),
): { moves: ClubMoveRecord[]; squad: SquadEntry[] } {
  const squad: SquadEntry[] = [];
  const touches = (entry: SquadEntry) => entry.fromClubId === clubId || entry.toClubId === clubId;
  const moves: { move: ClubMoveRecord; sequence: number }[] = [];
  const push = (move: Omit<ClubMoveRecord, "direction">) => {
    const direction =
      move.toClubId === clubId && move.fromClubId !== clubId
        ? "in"
        : move.fromClubId === clubId && move.toClubId !== clubId
          ? "out"
          : null;
    if (direction) moves.push({ move: { ...move, direction }, sequence: moves.length });
  };
  const matchedLoans = new Set<number>();
  for (const row of [...rows].sort((left, right) => left.id - right.id)) {
    const data = parse(row.data);
    const base = {
      key: `h${row.id}`,
      date: row.date,
      dateEstimated: false,
      season: Number(row.season),
      playerId: Number(row.entity_id),
      playerName: textOrNull(data.name),
      fee: null,
      loanUntil: null,
      order: row.date,
    };
    if (row.entity_type === "squad") {
      const entry = squadEntry(row, Number(row.entity_id));
      if (touches(entry)) squad.push(entry);
      continue;
    }
    const from = idOrNull(data.from);
    const to = idOrNull(data.to);
    const type = textOrNull(data.type);
    if (row.entity_type === "transfer" && from !== null && to !== null && family.has(from) && family.has(to)) {
      const entry = registrationEntry(row, Number(row.entity_id));
      if (touches(entry)) squad.push(entry);
      continue;
    }
    if (row.entity_type === "loan") {
      const loan = loans.find(
        (entry) =>
          !matchedLoans.has(entry.id) &&
          entry.player_id === Number(row.entity_id) &&
          entry.destination_id === to &&
          entry.start_date === row.date,
      );
      if (loan) matchedLoans.add(loan.id);
      push({
        ...base,
        kind: "loan",
        fromClubId: from,
        toClubId: to,
        fee: numberOrNull(data.fee),
        dealType: type,
        loanUntil: loan?.end_date ?? null,
      });
    } else
      push({ ...base, kind: transferKind(type, from), fromClubId: from, toClubId: to, fee: numberOrNull(data.fee), dealType: type });
  }
  for (const loan of loans) {
    const spell = {
      playerId: loan.player_id,
      playerName: null,
      dealType: loan.type,
      loanUntil: loan.end_date,
      fee: null,
      dateEstimated: false,
    };
    // A loan whose start was never written to history is listed from its loan row.
    if (!matchedLoans.has(loan.id) && !rowsTruncated)
      push({
        ...spell,
        key: `l${loan.id}`,
        kind: "loan",
        date: loan.start_date,
        season: seasonOfDate(loan.start_date),
        fromClubId: loan.parent_id,
        toClubId: loan.destination_id,
        order: loan.start_date,
      });
    const endedOn = textOrNull(parse(loan.data).endedOn);
    const end = { ...spell, key: `l${loan.id}e`, order: endedOn ?? `${loan.start_date}~` };
    const undated = { date: endedOn, season: seasonOfDate(endedOn ?? loan.start_date) };
    if (loan.status === "completed")
      push({
        ...end,
        kind: "loanReturn",
        date: endedOn ?? loan.end_date,
        dateEstimated: !endedOn,
        season: seasonOfDate(endedOn ?? loan.end_date),
        fromClubId: loan.destination_id,
        toClubId: loan.parent_id,
        order: endedOn ?? loan.end_date,
      });
    else if (loan.status === "recalled")
      push({ ...end, ...undated, kind: "loanRecall", fromClubId: loan.destination_id, toClubId: loan.parent_id });
    else if (loan.status === "purchased")
      push({
        ...end,
        ...undated,
        kind: "loanPurchase",
        fromClubId: loan.parent_id,
        toClubId: loan.destination_id,
        fee: numberOrNull(parse(loan.terms).optionFee),
      });
  }
  return {
    moves: moves
      .sort(
        (left, right) =>
          right.move.season - left.move.season ||
          right.move.order.localeCompare(left.move.order) ||
          right.sequence - left.sequence,
      )
      .map((entry) => entry.move),
    squad,
  };
}

const emptyTotals = (): ClubTransferTotals => ({
  spent: 0,
  received: 0,
  net: 0,
  countIn: 0,
  countOut: 0,
  countInternal: 0,
  countLoanEnds: 0,
  unknownFees: 0,
});

/**
 * Pure: per-season totals, newest season first; `currentSeason` is always listed. Loan ends are counted apart from
 * the in/out moves with other clubs; family moves (`squad`, call-ups and their returns left out) apart from both.
 */
export function seasonSummaries(
  moves: ClubMoveRecord[],
  currentSeason: number,
  squad: readonly SquadEntry[] = [],
): ClubTransferSeasonSummary[] {
  const seasons = new Map<number, ClubTransferTotals>([[currentSeason, emptyTotals()]]);
  const totalsOf = (season: number) => {
    let totals = seasons.get(season);
    if (!totals) seasons.set(season, (totals = emptyTotals()));
    return totals;
  };
  for (const entry of squad) if (!entry.callUp && !entry.callUpReturn) totalsOf(entry.season).countInternal!++;
  for (const move of moves) {
    const totals = totalsOf(move.season);
    if (LOAN_END_KINDS.has(move.kind)) totals.countLoanEnds!++;
    else if (move.direction === "in") {
      totals.countIn++;
      totals.spent += Math.max(0, move.fee ?? 0);
    } else {
      totals.countOut++;
      totals.received += Math.max(0, move.fee ?? 0);
    }
    if (move.fee === null && FEE_KINDS.has(move.kind)) totals.unknownFees++;
  }
  return [...seasons.entries()]
    .sort(([left], [right]) => right - left)
    .map(([season, totals]) => ({
      season,
      totals: { ...totals, net: Math.round((totals.received - totals.spent) * 100) / 100 },
    }));
}

/** Pure: filtered moves, and the requested page of them. */
export function filterClubMoves(moves: ClubMoveRecord[], query: ClubTransfersQuery) {
  const types = new Set<PlayerMoveKind>(query.type);
  const filtered = moves.filter(
    (move) =>
      (query.season === undefined || move.season === query.season) &&
      (query.direction === "all" || move.direction === query.direction) &&
      (!types.size || types.has(move.kind)),
  );
  const pages = Math.max(1, Math.ceil(filtered.length / query.pageSize));
  const start = (query.page - 1) * query.pageSize;
  return { total: filtered.length, pages, page: filtered.slice(start, start + query.pageSize) };
}

const termsOf = (text: string | null): TransferTerms | null => {
  if (!text) return null;
  const data = parse(text);
  const keys = ["upfrontPercent", "installments", "intervalMonths", "buyBackFee", "buyBackYears", "sellOnPercent"] as const;
  return keys.every((key) => numberOrNull(data[key]) !== null) ? (data as unknown as TransferTerms) : null;
};

interface ClubRow {
  id: number;
  name: string;
  color: string | null;
  country_id: number | null;
  country_name: string | null;
  country_code: string | null;
}
const clubView = (row: ClubRow): ClubTransferClub => ({
  id: Number(row.id),
  name: row.name,
  color: row.color,
  country:
    row.country_id === null
      ? null
      : { id: Number(row.country_id), name: row.country_name ?? "", code: row.country_code ?? "" },
});
const CLUB_SELECT =
  "SELECT clubs.id,clubs.name,clubs.color,clubs.country_id,countries.name AS country_name,countries.code AS country_code FROM clubs LEFT JOIN countries ON countries.id = clubs.country_id";
const idList = (ids: Iterable<number>) => [...new Set(ids)];

// history has no club index. Move rows are append-only (retention prunes only 'appearance'), so a club's
// rows are scanned once and later requests read only ids above the last one seen.
interface ClubScan {
  careerKey: string;
  maxId: number;
  /** Newest first. */
  rows: ClubHistoryRow[];
  truncated: boolean;
}
const scans = new WeakMap<Store, Map<number, ClubScan>>();
const SCAN_CACHE_CLUBS = 16;

/** Called when the world is replaced (load, restore, import, new or deleted career): restores reseed history ids. */
export function clubTransfersChanged(store: Store) {
  scans.delete(store);
}

/** Pure: newer rows (newest first, up to limit + 1) in front of a cached scan, keeping the newest `limit`. */
export function mergeClubRows(
  previous: Pick<ClubScan, "rows" | "truncated">,
  fresh: ClubHistoryRow[],
  limit = CLUB_TRANSFER_ROW_LIMIT,
) {
  const rows = fresh.length ? [...fresh.slice(0, limit), ...previous.rows] : previous.rows;
  return {
    rows: rows.length > limit ? rows.slice(0, limit) : rows,
    truncated: previous.truncated || rows.length > limit || fresh.length > limit,
  };
}

async function clubHistoryRows(store: Store, clubId: number, careerKey: string) {
  const latest = (await store.get<{ latest: number | null }>("SELECT max(id) AS latest FROM history"))!.latest ?? 0;
  let cache = scans.get(store);
  if (!cache) scans.set(store, (cache = new Map()));
  const hit = cache.get(clubId);
  const usable = hit && hit.careerKey === careerKey && hit.maxId <= latest;
  const id = String(clubId);
  const found =
    usable && hit.maxId === latest
      ? []
      : await store.all<ClubHistoryRow>(
          // OFFSET 0 keeps the lateral subquery from being inlined, so each row's JSON is parsed once.
          `SELECT id,season,date,entity_type,entity_id,data FROM history CROSS JOIN LATERAL (SELECT data::jsonb AS doc OFFSET 0) AS parsed WHERE id > ? AND id <= ? AND entity_type IN ('transfer','loan','squad') AND ? IN (parsed.doc ->> 'to',parsed.doc ->> 'from',parsed.doc ->> 'toClubId',parsed.doc ->> 'fromClubId') ORDER BY id DESC LIMIT ${CLUB_TRANSFER_ROW_LIMIT + 1}`,
          usable ? hit.maxId : 0,
          latest,
          id,
        );
  const entry: ClubScan = {
    careerKey,
    maxId: latest,
    ...mergeClubRows(usable ? hit : { rows: [], truncated: false }, found),
  };
  cache.delete(clubId);
  cache.set(clubId, entry);
  while (cache.size > SCAN_CACHE_CLUBS) cache.delete(cache.keys().next().value!);
  return entry;
}

/** GET /api/clubs/:id/transfers: the club's recorded moves in and out, grouped by season. */
export async function clubTransfers(store: Store, clubId: number, rawQuery: unknown): Promise<ClubTransfers> {
  const query = clubTransfersQuerySchema.parse(rawQuery ?? {});
  const clubRow = await store.get<ClubRow>(`${CLUB_SELECT} WHERE clubs.id = ?`, clubId);
  if (!clubRow) {
    const error = new GameError("Club not found.");
    error.status = 404;
    throw error;
  }
  const state = await stateOf(store);
  const scan = await clubHistoryRows(store, clubId, `${state.careerId ?? ""}|${state.seed}`);
  const loans = await store.all<ClubLoanRow>(
    "SELECT id,player_id,parent_id,destination_id,type,start_date,end_date,status,terms,data FROM loans WHERE parent_id = ? OR destination_id = ?",
    clubId,
    clubId,
  );
  const familyClubs = await store.all<FamilyClub>(
    "SELECT id,name,color,parent_id FROM clubs WHERE id = (SELECT coalesce(parent_id,id) FROM clubs WHERE id = ?) OR parent_id = (SELECT coalesce(parent_id,id) FROM clubs WHERE id = ?)",
    clubId,
    clubId,
  );
  const { moves, squad } = clubMoves(clubId, scan.rows, loans, scan.truncated, new Set(familyClubs.map((club) => Number(club.id))));
  const seasons = seasonSummaries(moves, state.season, squad);
  const { total, pages, page } = filterClubMoves(moves, query);

  const playerIds = page.map((move) => move.playerId);
  const players = new Map(
    (playerIds.length
      ? await store.all<{ id: number; name: string; position: string; birth_date: string }>(
          "SELECT id,name,position,birth_date FROM players WHERE id = ANY(?::integer[])",
          idList(playerIds),
        )
      : []
    ).map((row) => [Number(row.id), row]),
  );
  const otherIds = page.flatMap((move) => [move.fromClubId, move.toClubId]).filter((id): id is number => id !== null && id !== clubId);
  const clubs = new Map(
    (otherIds.length
      ? await store.all<ClubRow>(
          `${CLUB_SELECT} WHERE clubs.id = ANY(?::integer[])`,
          idList(otherIds),
        )
      : []
    ).map((row) => [Number(row.id), clubView(row)]),
  );
  const dealIds = page.filter((move) => move.kind === "transfer" || move.kind === "free").map((move) => move.playerId);
  const deals = dealIds.length
    ? await store.all<{ player_id: number; buying_club_id: number; selling_club_id: number | null; created: string; terms: string | null }>(
        "SELECT player_id,buying_club_id,selling_club_id,created,(data::jsonb -> 'transferTerms')::text AS terms FROM negotiations WHERE stage = 'Completed' AND (buying_club_id = ? OR selling_club_id = ?) AND player_id = ANY(?::integer[]) ORDER BY created DESC,id DESC",
        clubId,
        clubId,
        idList(dealIds),
      )
    : [];

  const view = (move: ClubMoveRecord): ClubTransfer => {
    const player = players.get(move.playerId);
    const otherId = move.direction === "in" ? move.fromClubId : move.toClubId;
    const deal =
      move.kind === "transfer" || move.kind === "free"
        ? deals.find(
            (entry) =>
              Number(entry.player_id) === move.playerId &&
              Number(entry.buying_club_id) === move.toClubId &&
              (entry.selling_club_id === null ? null : Number(entry.selling_club_id)) === move.fromClubId &&
              move.date !== null &&
              entry.created <= move.date,
          )
        : undefined;
    return {
      key: move.key,
      kind: move.kind,
      direction: move.direction,
      date: move.date,
      dateEstimated: move.dateEstimated,
      season: move.season,
      player: {
        id: move.playerId,
        name: player?.name ?? move.playerName ?? "Unknown player",
        position: player?.position ?? null,
        ageAtMove: player && move.date ? ageOn(player.birth_date, move.date) : null,
      },
      club: otherId === null ? null : (clubs.get(otherId) ?? { id: otherId, name: "Unknown club", color: null, country: null }),
      fee: move.fee,
      dealType: move.dealType,
      loanUntil: move.loanUntil,
      terms: termsOf(deal?.terms ?? null),
    };
  };
  const totals = new Map(seasons.map((entry) => [entry.season, entry.totals]));
  const groups: ClubTransfers["groups"] = [];
  for (const move of page) {
    const last = groups.at(-1);
    if (last?.season === move.season) last.transfers.push(view(move));
    else groups.push({ season: move.season, totals: totals.get(move.season)!, transfers: [view(move)] });
  }
  return {
    club: clubView(clubRow),
    seasons,
    filter: { season: query.season ?? null, direction: query.direction, types: query.type },
    groups,
    total,
    page: query.page,
    pageSize: query.pageSize,
    pages,
    truncated: scan.truncated,
    squadMoves: await clubSquadMoves(store, squad, familyClubs, query.season),
  };
}

/** The family moves of the selected season (or all), call-ups folded, newest first and capped. */
async function clubSquadMoves(
  store: Store,
  entries: readonly SquadEntry[],
  familyClubs: readonly FamilyClub[],
  season: number | undefined,
): Promise<ClubTransfers["squadMoves"]> {
  const clubs = new Map(familyClubs.map((club) => [Number(club.id), club]));
  const folded = foldSquadMoves(entries, (id) =>
    id === null ? null : (clubs.get(id) ?? { id, name: "Unknown club", color: null, parent_id: null }),
  )
    .filter((move) => season === undefined || move.season === season)
    .reverse();
  const listed = folded.slice(0, CLUB_SQUAD_MOVE_LIMIT);
  const players = new Map(
    (listed.length
      ? await store.all<{ id: number; name: string; position: string; birth_date: string }>(
          "SELECT id,name,position,birth_date FROM players WHERE id = ANY(?::integer[])",
          idList(listed.map((move) => move.playerId)),
        )
      : []
    ).map((row) => [Number(row.id), row]),
  );
  const names = new Map(entries.filter((entry) => entry.name).map((entry) => [entry.playerId, entry.name]));
  return {
    total: folded.length,
    moves: listed.map(({ playerId, ...move }): ClubSquadMove => {
      const player = players.get(playerId);
      return {
        ...move,
        player: {
          id: playerId,
          name: player?.name ?? names.get(playerId) ?? "Unknown player",
          position: player?.position ?? null,
          ageAtMove: player ? ageOn(player.birth_date, move.date) : null,
        },
      };
    }),
  };
}
