import { ACTIVE_TRANSFER_STAGES } from "../shared/rules.ts";
import type { Country, Negotiation, Player, PlayerProfile } from "../shared/types.ts";

/** Player search rows also carry `home_based`, `height` and `weight`; other list rows may not yet. */
export type ListedPlayer = Player & {
  home_based?: boolean | number;
  height?: number | null;
  weight?: number | null;
};

/** Current height and weight (they change as players develop), rounded for display. */
export function bodyOf(
  player: ListedPlayer,
  profile?: Pick<PlayerProfile, "identity"> | null,
) {
  const identity = profile?.identity ?? player.details?.identity;
  const height = player.height ?? identity?.height ?? null;
  const weight = player.weight ?? identity?.weight ?? null;
  const adultHeight = identity?.growth?.adultHeight;
  return {
    height: height === null ? null : Math.round(height),
    weight: weight === null ? null : Math.round(weight),
    growing:
      height !== null && adultHeight !== undefined && adultHeight - height >= 1,
  };
}

export function bodyLabel(body: ReturnType<typeof bodyOf>) {
  if (body.height === null) return "Not recorded";
  return body.weight === null
    ? `${body.height} cm`
    : `${body.height} cm / ${body.weight} kg`;
}

/** Players who left football are pruned at season end, so old links can point at a missing record. */
export function isMissingPlayer(error: string | null | undefined) {
  return error === "Player not found.";
}

export function isHomeBased(
  player: ListedPlayer,
  profile?: Pick<PlayerProfile, "homeBased"> | null,
) {
  return (
    !player.club_id &&
    !!(profile?.homeBased ?? player.details?.homeBased ?? player.home_based)
  );
}

/** Club name, or the club-less label: home-based pool players are not free agents on the market. */
export function clubLabel(
  player: ListedPlayer,
  profile?: Pick<PlayerProfile, "homeBased"> | null,
) {
  return (
    player.club_name ??
    (isHomeBased(player, profile) ? "Home-based" : "Free agent")
  );
}

export const POSITION_LINES = [
  { id: "GK", label: "Goalkeepers", positions: ["GK"] },
  { id: "DEF", label: "Defenders", positions: ["CB", "LB", "RB"] },
  { id: "MID", label: "Midfielders", positions: ["DM", "CM", "AM"] },
  { id: "ATT", label: "Forwards", positions: ["LW", "RW", "ST"] },
] as const;
export type PositionLine = (typeof POSITION_LINES)[number]["id"];

export function positionLine(position: string): PositionLine | null {
  return (
    POSITION_LINES.find((line) =>
      (line.positions as readonly string[]).includes(position),
    )?.id ?? null
  );
}

const SUBDIVISION_FLAGS: Record<string, string> = {
  EN: "gbeng",
  SCO: "gbsct",
  WAL: "gbwls",
};

/** Emoji flag for a country code, or null when no flag exists (e.g. Northern Ireland). */
export function flagEmoji(code: string | null | undefined) {
  const upper = code?.toUpperCase() ?? "";
  const subdivision = SUBDIVISION_FLAGS[upper];
  if (subdivision)
    return String.fromCodePoint(
      0x1f3f4,
      ...[...subdivision].map((letter) => 0xe0000 + letter.charCodeAt(0)),
      0xe007f,
    );
  if (!/^[A-Z]{2}$/.test(upper)) return null;
  return String.fromCodePoint(
    ...[...upper].map((letter) => 0x1f1e6 + letter.charCodeAt(0) - 65),
  );
}

export interface Nationality {
  name: string;
  code: string | null;
}

/** Sporting nationality first, then the other passports the player holds. */
export function nationalitiesOf(player: Player, countries: readonly Country[]) {
  const names = [
    player.nationality,
    ...(player.nationalities ?? []).filter((name) => name !== player.nationality),
  ];
  return names.map<Nationality>((name, index) => ({
    name,
    code:
      index === 0 && player.country_code
        ? player.country_code
        : (countries.find((country) => country.name === name)?.code ?? null),
  }));
}

export const AGE_BANDS = [
  { id: "u18", label: "Under 18", min: 0, max: 17 },
  { id: "18-21", label: "18-21", min: 18, max: 21 },
  { id: "22-25", label: "22-25", min: 22, max: 25 },
  { id: "26-29", label: "26-29", min: 26, max: 29 },
  { id: "30+", label: "30 and over", min: 30, max: 99 },
] as const;

export type ShortlistStatus =
  | "talks"
  | "available"
  | "free"
  | "budget"
  | "u18"
  | "own";

export const SHORTLIST_STATUSES: {
  id: ShortlistStatus;
  label: string;
  tone: string;
  description: string;
}[] = [
  { id: "talks", label: "In talks", tone: "blue", description: "An active negotiation is open." },
  { id: "available", label: "Available", tone: "green", description: "Valued within your transfer budget." },
  { id: "free", label: "No fee", tone: "green", description: "Free agents and home-based players cost no transfer fee." },
  { id: "budget", label: "Over budget", tone: "red", description: "Market value above your transfer budget." },
  { id: "u18", label: "International U18", tone: "amber", description: "Under 18 without your club's nationality: an approved minor route is needed. The dossier shows the exact route." },
  { id: "own", label: "Your squad", tone: "neutral", description: "Already registered with your club." },
];

export interface ShortlistContext {
  clubId: number;
  clubCountryId: number;
  clubCountryName?: string;
  transferBudget: number;
  negotiations: readonly Pick<Negotiation, "player_id" | "buying_club_id" | "stage">[];
}

export function activeNegotiation(player: Player, context: ShortlistContext) {
  return context.negotiations.find(
    (negotiation) =>
      negotiation.player_id === player.id &&
      negotiation.buying_club_id === context.clubId &&
      ACTIVE_TRANSFER_STAGES.includes(negotiation.stage),
  );
}

/** Under 18 and not holding the buying club's nationality. */
export function isInternationalMinor(player: Player, context: ShortlistContext) {
  return (
    player.age < 18 &&
    player.country_id !== context.clubCountryId &&
    !(context.clubCountryName &&
      player.nationalities?.includes(context.clubCountryName))
  );
}

export function shortlistStatus(
  player: Player,
  context: ShortlistContext,
): ShortlistStatus {
  if (player.club_id === context.clubId || player.parent_club_id === context.clubId)
    return "own";
  if (activeNegotiation(player, context)) return "talks";
  if (isInternationalMinor(player, context)) return "u18";
  if (!player.club_id) return "free";
  return player.value > context.transferBudget ? "budget" : "available";
}
