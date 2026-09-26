import type { Country, ReservePolicy } from "./types.ts";
import {
  hostedClubsIn,
  leagueTiers,
  nationByCode,
  type NationSpec,
} from "./world-catalog/index.ts";

export type { ReservePolicy } from "./types.ts";

export const WORLD_VERSION = 4;
/** Registered squad minimums per team type (world v4 directive); B-teams have no own academy. */
export const SQUAD_MINIMUMS = { Senior: 25, U19: 20, U17: 20, BTeam: 20 } as const;
/** Goalkeepers every team and age group keeps (first teams are generated with three). */
export const MIN_GOALKEEPERS = 2;

const listed = (items: string[]) =>
  items.length <= 1
    ? (items[0] ?? "")
    : `${items.slice(0, -1).join(", ")} and ${items.at(-1)}`;
const nationName = (code: string) => nationByCode(code)?.name ?? code;
const CROSS_BORDER_RULE = {
  host: "the host association's",
  home: "their home association's",
  none: "no",
} as const;

export function associationNotes(code: string): string[] {
  const notes = [
    "Leagues, cups and youth competitions follow their 2025/26 structure in one July-June season; regional real tiers are merged into one national division per level.",
    "Clubs are fictional clubs from real cities and towns; league and cup names are real, without sponsors.",
    "Licensing, registration quotas and calendars are game models, not a complete federation rulebook.",
  ];
  const nation = nationByCode(code);
  if (!nation) return [...notes, "This association is not part of the curated world catalog."];
  const tiers = leagueTiers(nation);
  if (!tiers.length && !nation.hostedAbroad?.length)
    notes.push(
      `No domestic league is modelled: ${nation.name} players are home-based without a club or play for clubs abroad.`,
    );
  for (const hosted of nation.hostedAbroad ?? [])
    notes.push(
      `${listed(hosted.cities)} ${hosted.cities.length > 1 ? "clubs play" : "club plays"} in the ${nationName(hosted.host)} pyramid; ${CROSS_BORDER_RULE[hosted.cups]} cups and ${CROSS_BORDER_RULE[hosted.continental]} continental places apply.`,
    );
  const guests = hostedClubsIn(code);
  if (guests.length)
    notes.push(
      `The pyramid includes ${listed(guests.map(({ home, spec }) => `${spec.tiers.length} ${home.name} club${spec.tiers.length > 1 ? "s" : ""}`))}.`,
    );
  const closed = tiers.filter((tier) => tier.closed).map((tier) => tier.name);
  if (closed.length)
    notes.push(`${listed(closed)} ${closed.length > 1 ? "are" : "is"} closed: no promotion or relegation.`);
  if (nation.suspended)
    notes.push(
      `Suspended from ${[nation.suspended.club ? "club" : "", nation.suspended.national ? "national-team" : ""].filter(Boolean).join(" and ")} competitions: ${nation.suspended.reason}`,
    );
  return notes;
}

export function youthGroups<Value>(clubs: Value[], maximum = 16): Value[][] {
  if (!clubs.length) return [];
  const groups = Math.ceil(clubs.length / maximum);
  const size = Math.floor(clubs.length / groups);
  const extra = clubs.length % groups;
  return Array.from({ length: groups }, (_, index) => {
    const start = index * size + Math.min(index, extra);
    return clubs.slice(start, start + size + (index < extra ? 1 : 0));
  });
}

function namingStyle(template: string | undefined): ReservePolicy["naming"] {
  if (!template) return "Reserves";
  if (/^Jong \{club\}/.test(template)) return "Jong";
  if (/\{club\} B$/.test(template)) return "B";
  if (/\{club\} II$/.test(template)) return "II";
  if (/\{club\} 2$/.test(template)) return "2";
  if (/U2\d$/.test(template)) return "U23";
  return "Reserves";
}

function catalogReservePolicy(nation: NationSpec): ReservePolicy {
  const base = {
    evidence: "documented" as const,
    verification: "secondary" as const,
    source: "",
    gap: 1,
  };
  const football = nation.football;
  const policy = football?.reserves;
  const tiers = football?.leagues ?? [];
  const age = policy?.ageRule
    ? ` Squads may include at most ${policy.ageRule.overage} players older than ${policy.ageRule.maxAge}.`
    : "";
  if (!policy || policy.mode === "none")
    return {
      ...base,
      mode: "none",
      competition: "none",
      highestTier: null,
      entryTier: null,
      professional: null,
      naming: "Reserves",
      summary: tiers.length || nation.hostedAbroad?.length
        ? "No reserve teams in senior competitions; clubs develop players through their U19 and U17 squads."
        : "No domestic league; players are home-based or play for clubs abroad.",
    };
  const shared = {
    ...base,
    naming: namingStyle(policy.nameTemplate),
    ...(policy.nameTemplate ? { nameTemplate: policy.nameTemplate } : {}),
    ...(policy.eligibility ? { maxTeams: policy.eligibility.maxTeams } : {}),
  };
  const bigClubs = policy.eligibility
    ? `Up to ${policy.eligibility.maxTeams} B-teams of clubs with reputation ${policy.eligibility.minReputation}+`
    : "B-teams";
  if (policy.mode === "reserve-league") {
    const league = policy.reserveLeague;
    const host = league?.host ? ` (in ${nationName(league.host)})` : "";
    return {
      ...shared,
      mode: "separate",
      competition: "reserve-league",
      highestTier: null,
      entryTier: 0,
      professional: true,
      summary: `${bigClubs} play in ${league?.name ?? "a reserve league"}${host}, separate from the senior pyramid and without promotion.${age}`,
    };
  }
  const pyramid = policy.pyramid;
  const highestTier = pyramid?.highestTier ?? null;
  const entry = tiers.find((tier) => (tier.bTeams ?? 0) > 0)?.tier ?? highestTier;
  const ceiling = tiers.find((tier) => tier.tier === highestTier);
  return {
    ...shared,
    mode: "pyramid",
    competition: "senior-pyramid",
    highestTier,
    entryTier: entry,
    professional: ceiling ? ceiling.status === "professional" : null,
    gap: pyramid?.minGapBelowParent ?? 1,
    summary: `${bigClubs} play in the senior pyramid, no higher than ${ceiling?.name ?? `tier ${highestTier}`} and at least ${pyramid?.minGapBelowParent ?? 1} tier${(pyramid?.minGapBelowParent ?? 1) > 1 ? "s" : ""} below their parent.${age}`,
  };
}

export function reservePolicy(code: string): ReservePolicy {
  const nation = nationByCode(code);
  if (nation) return catalogReservePolicy(nation);
  return {
    mode: "unverified",
    competition: "unknown",
    highestTier: null,
    entryTier: null,
    professional: null,
    gap: 1,
    naming: "Reserves",
    evidence: "unverified",
    verification: "unverified",
    source: "",
    summary: "This association is not part of the curated world catalog; no B-team admission is assumed.",
  };
}

/** Highest tier (lowest number) a B-team may play in when its parent plays in parentTier; Infinity when none is allowed. */
export function minimumReserveTier(code: string, parentTier: number): number {
  const policy = nationByCode(code)?.football?.reserves;
  if (
    policy?.mode !== "pyramid" ||
    !policy.pyramid ||
    !Number.isInteger(parentTier) ||
    parentTier < 1
  )
    return Number.POSITIVE_INFINITY;
  return Math.max(
    policy.pyramid.highestTier,
    parentTier + policy.pyramid.minGapBelowParent,
  );
}

export function associationRuleAudit(
  country: Pick<Country, "code" | "name" | "reputation">,
) {
  const nation = nationByCode(country.code);
  const tiers = nation ? leagueTiers(nation) : [];
  const closed = tiers.filter((tier) => tier.closed).length;
  return {
    code: country.code,
    name: country.name,
    reviewedOn: "2026-09-25",
    scope: "partial" as const,
    reserve: reservePolicy(country.code),
    pyramid: {
      evidence: nation ? ("catalog" as const) : ("unverified" as const),
      tiers: tiers.length,
      movement: !tiers.length
        ? "none"
        : closed === tiers.length
          ? "closed"
          : closed
            ? "partial"
            : "open",
      labelSource: "",
    },
    notes: associationNotes(country.code),
  };
}

export function reserveTeamName(parent: string, code: string): string {
  const template = nationByCode(code)?.football?.reserves.nameTemplate;
  return template?.includes("{club}")
    ? template.replace("{club}", parent)
    : `${parent} B`;
}

export interface PyramidDivision {
  id: number;
  tier: number;
  promotion: number;
  relegation: number;
  entries: { clubId: number; parentId: number | null }[];
}

/** @deprecated Replaced by shared/league-rules.ts (Lead-competitions); closed tiers carry promotion/relegation 0. */
export function planPyramidMoves(code: string, divisions: PyramidDivision[]) {
  const ordered = [...divisions].sort((left, right) => left.tier - right.tier);
  const tiers = new Map(
    ordered.map((division) => [division.id, division.tier]),
  );
  const entries = ordered.flatMap((division) =>
    division.entries.map((entry, rank) => ({
      ...entry,
      leagueId: division.id,
      rank,
    })),
  );
  const original = new Map(
    entries.map((entry) => [entry.clubId, entry.leagueId]),
  );
  const destination = new Map<number, number | null>(original);
  const canEnter = (
    entry: (typeof entries)[number],
    division: PyramidDivision,
  ) => {
    if (!entry.parentId) return true;
    const parentLeague = destination.get(entry.parentId);
    const parentTier = parentLeague ? tiers.get(parentLeague) : undefined;
    return (
      parentTier !== undefined &&
      division.tier >= minimumReserveTier(code, parentTier)
    );
  };
  for (let index = 0; index < ordered.length - 1; index++) {
    const upper = ordered[index];
    const lower = ordered[index + 1];
    const maximum = Math.min(upper.relegation, lower.promotion);
    if (!maximum || lower.tier !== upper.tier + 1) continue;
    const relegated = entries
      .filter(
        (entry) =>
          entry.leagueId === upper.id &&
          destination.get(entry.clubId) === upper.id,
      )
      .slice(-maximum);
    const promoted = entries
      .filter(
        (entry) =>
          entry.leagueId === lower.id &&
          destination.get(entry.clubId) === lower.id &&
          canEnter(entry, upper),
      )
      .slice(0, Math.min(maximum, relegated.length));
    for (const [moveIndex, entry] of promoted.entries()) {
      destination.set(entry.clubId, upper.id);
      destination.set(relegated[moveIndex].clubId, lower.id);
    }
  }
  for (const reserve of entries.filter((entry) => entry.parentId)) {
    let current = ordered.find(
      (division) => division.id === destination.get(reserve.clubId),
    );
    while (current && !canEnter(reserve, current)) {
      const lower = ordered.find(
        (division) => division.tier === current!.tier + 1,
      );
      if (!lower) {
        destination.set(reserve.clubId, null);
        break;
      }
      const replacement = entries
        .filter(
          (entry) =>
            !entry.parentId &&
            entry.clubId !== reserve.parentId &&
            destination.get(entry.clubId) === lower.id,
        )
        .sort(
          (left, right) =>
            tiers.get(left.leagueId)! - tiers.get(right.leagueId)! ||
            left.rank - right.rank,
        )[0];
      if (replacement) destination.set(replacement.clubId, current.id);
      destination.set(reserve.clubId, lower.id);
      current = lower;
    }
  }
  return entries.flatMap((entry) => {
    const to = destination.get(entry.clubId)!;
    return to === entry.leagueId
      ? []
      : [
          {
            club: entry.clubId,
            from: entry.leagueId,
            to,
            promoted:
              to !== null && tiers.get(to)! < tiers.get(entry.leagueId)!,
          },
        ];
  });
}
