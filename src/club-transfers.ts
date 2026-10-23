import type {
  ClubTransfer,
  ClubTransferTotals,
  ClubTransferSeasonSummary,
  PlayerMoveKind,
} from "../shared/api.ts";
import type { TransferTerms } from "../shared/types.ts";
import { LOAN_BACK_LABELS } from "../shared/rules.ts";
import { MOVE_KIND_LABELS } from "./player-history.ts";

export type TransferDirection = "all" | "in" | "out";

export interface ClubTransferFilter {
  /** null: all seasons. */
  season: number | null;
  direction: TransferDirection;
  /** "": every kind. */
  type: PlayerMoveKind | "";
  page: number;
}

export const DEFAULT_TRANSFER_FILTER: ClubTransferFilter = {
  season: null,
  direction: "all",
  type: "",
  page: 1,
};

export const DIRECTION_OPTIONS: readonly [TransferDirection, string][] = [
  ["all", "All"],
  ["in", "In"],
  ["out", "Out"],
];

/** Kinds in the order a director scans them; moves inside the club family are listed apart (squadMoves). */
const TYPE_ORDER: readonly PlayerMoveKind[] = [
  "transfer",
  "free",
  "loan",
  "loanReturn",
  "loanRecall",
  "loanPurchase",
  "registration",
];

export const TYPE_OPTIONS = TYPE_ORDER.map((kind) => ({ kind, label: MOVE_KIND_LABELS[kind] }));

export const TRANSFERS_PAGE_SIZE = 100;

export function clubTransfersPath(clubId: number, filter: ClubTransferFilter) {
  const query = new URLSearchParams();
  if (filter.season !== null) query.set("season", String(filter.season));
  if (filter.direction !== "all") query.set("direction", filter.direction);
  if (filter.type) query.set("type", filter.type);
  if (filter.page > 1) query.set("page", String(filter.page));
  query.set("pageSize", String(TRANSFERS_PAGE_SIZE));
  return `clubs/${clubId}/transfers?${query}`;
}

/** Any filter change other than paging goes back to the first page. */
export function updateFilter(
  filter: ClubTransferFilter,
  patch: Partial<Omit<ClubTransferFilter, "page">>,
): ClubTransferFilter {
  return { ...filter, ...patch, page: 1 };
}

export const isFiltered = (filter: ClubTransferFilter) =>
  filter.season !== null || filter.direction !== "all" || filter.type !== "";

/** Moves where a fee can apply; the rest (returns, recalls, registrations) show no fee at all. */
const FEE_KINDS = new Set<PlayerMoveKind>(["transfer", "free", "loan", "loanPurchase"]);

export type TransferFee =
  | { kind: "amount"; value: number }
  | { kind: "free" }
  | { kind: "noFee" }
  | { kind: "undisclosed" }
  | { kind: "notApplicable" };

/** A loan with a recorded fee of 0 is a loan without a fee, not a free transfer. */
export function transferFee(move: Pick<ClubTransfer, "kind" | "fee">): TransferFee {
  if (move.fee !== null && move.fee > 0) return { kind: "amount", value: move.fee };
  if (!FEE_KINDS.has(move.kind)) return { kind: "notApplicable" };
  if (move.kind === "loan" && move.fee === 0) return { kind: "noFee" };
  if (move.fee === 0 || move.kind === "free") return { kind: "free" };
  return { kind: "undisclosed" };
}

/** Readable clauses of a negotiated deal; `money` formats GBP in the career currency. */
export function transferClauses(terms: TransferTerms | null, money: (value: number) => string): string[] {
  if (!terms) return [];
  const clauses: string[] = [];
  if (terms.installments > 0)
    clauses.push(
      `${terms.upfrontPercent}% upfront, then ${terms.installments} instalment${terms.installments === 1 ? "" : "s"}` +
        (terms.intervalMonths > 0 ? ` every ${terms.intervalMonths} month${terms.intervalMonths === 1 ? "" : "s"}` : ""),
    );
  if (terms.sellOnPercent > 0) clauses.push(`${terms.sellOnPercent}% sell-on`);
  if (terms.buyBackFee > 0)
    clauses.push(
      `Buy-back ${money(terms.buyBackFee)}` +
        (terms.buyBackYears > 0 ? ` for ${terms.buyBackYears} year${terms.buyBackYears === 1 ? "" : "s"}` : ""),
    );
  if (terms.loanBack && terms.loanBack !== "none")
    clauses.push(LOAN_BACK_LABELS[terms.loanBack]);
  return clauses;
}

/** Short badge text for the fee cell, e.g. "Sell-on 20% · Instalments". */
export function clauseBadges(terms: TransferTerms | null): string[] {
  if (!terms) return [];
  return [
    terms.installments > 0 ? "Instalments" : null,
    terms.sellOnPercent > 0 ? `Sell-on ${terms.sellOnPercent}%` : null,
    terms.buyBackFee > 0 ? "Buy-back" : null,
    terms.loanBack && terms.loanBack !== "none" ? "Loan-back" : null,
  ].filter((value): value is string => value !== null);
}

export interface TransferRow extends ClubTransfer {
  /** Position in the server's newest-first order, the stable tie-breaker. */
  index: number;
}

export interface TransferSection {
  id: "in" | "out";
  title: string;
  /** Header of the other-club column. */
  clubLabel: string;
  rows: TransferRow[];
}

const SECTION_TITLES = {
  in: { title: "Arrivals", clubLabel: "From" },
  out: { title: "Departures", clubLabel: "To" },
} as const;

/** Arrivals then departures for "all"; a single table when a direction filter is set. */
export function transferSections(
  transfers: readonly ClubTransfer[],
  direction: TransferDirection,
): TransferSection[] {
  const rows = transfers.map((move, index) => ({ ...move, index }));
  const ids: ("in" | "out")[] = direction === "all" ? ["in", "out"] : [direction];
  return ids.map((id) => ({
    id,
    ...SECTION_TITLES[id],
    rows: rows.filter((row) => row.direction === id),
  }));
}

export function sumTotals(seasons: readonly ClubTransferSeasonSummary[]): ClubTransferTotals {
  const total: ClubTransferTotals = {
    spent: 0,
    received: 0,
    net: 0,
    countIn: 0,
    countOut: 0,
    unknownFees: 0,
  };
  for (const { totals } of seasons) {
    total.spent += totals.spent;
    total.received += totals.received;
    total.net += totals.net;
    total.countIn += totals.countIn;
    total.countOut += totals.countOut;
    total.unknownFees += totals.unknownFees;
  }
  return total;
}

/** Net transfer balance with an explicit sign: received − spent. */
export function signedMoney(value: number, money: (value: number) => string) {
  if (value === 0) return money(0);
  return value > 0 ? `+${money(value)}` : `−${money(-value)}`;
}

export function transferDetail(move: Pick<ClubTransfer, "kind" | "dealType" | "loanUntil">, date: (value: string) => string) {
  if (move.kind === "loan" && move.loanUntil) return `Until ${date(move.loanUntil)}`;
  if (move.dealType && move.dealType !== MOVE_KIND_LABELS[move.kind]) return move.dealType;
  return null;
}
