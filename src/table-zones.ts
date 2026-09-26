// League table zones from each league's own movement rules (league.data, world v4 SeniorLeagueData).
// Minimal copies of the catalog boundary shapes: src may not import shared/world-catalog (import-boundary test).
type MovementPlayoffSpec =
  | { type: "promotion" | "relegation"; positions: [number, number] }
  | { type: "cross-tier"; upperPositions: number[]; lowerPositions: number[] };
interface TierBoundarySpec {
  promoted: number;
  relegated: number;
  playoffs?: MovementPlayoffSpec[];
  perConference?: boolean;
}

export type TableZone = "promoted" | "promotion-playoff" | "title-playoff" | "relegation-playoff" | "relegated";

export const ZONE_LABELS: Record<TableZone, string> = {
  promoted: "Promotion",
  "promotion-playoff": "Promotion play-offs",
  "title-playoff": "Title play-offs",
  "relegation-playoff": "Relegation play-off",
  relegated: "Relegation",
};

export interface ZoneSpec {
  promoted: number;
  promotionPlayoff: number[];
  titlePlayoff: number[];
  relegationPlayoff: number[];
  relegated: number;
}

const range = (from: number, to: number) => Array.from({ length: Math.max(0, to - from + 1) }, (_, index) => from + index);

function count(value: unknown) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : 0;
}

const isBoundary = (value: unknown): value is TierBoundarySpec =>
  !!value && typeof value === "object" && "promoted" in value && "relegated" in value;

/**
 * Zones for one league table. Returns null when the league has no movement or title play-off data (cups, groups,
 * youth leagues) so the table shows no invented zones. Continental places are not stored per league, so the top of
 * a top flight carries no zone.
 */
export function leagueZones(data: unknown): ZoneSpec | null {
  if (!data || typeof data !== "object") return null;
  const league = data as Record<string, unknown>;
  const conferences = Array.isArray(league.conferences) ? league.conferences.length : 1;
  const share = (boundary: TierBoundarySpec, total: number) =>
    boundary.perConference && conferences > 1 ? Math.round(total / conferences) : total;
  const spec: ZoneSpec = { promoted: 0, promotionPlayoff: [], titlePlayoff: [], relegationPlayoff: [], relegated: 0 };
  const up = league.movementUp;
  const down = league.movementDown;
  if (league.closed !== true) {
    if (isBoundary(up)) {
      spec.promoted = share(up, up.promoted);
      for (const playoff of (up.playoffs ?? []) as MovementPlayoffSpec[]) {
        if (playoff.type === "promotion") spec.promotionPlayoff.push(...range(playoff.positions[0], playoff.positions[1]));
        else if (playoff.type === "cross-tier") spec.promotionPlayoff.push(...playoff.lowerPositions);
      }
    } else if (up === undefined) spec.promoted = count(league.promotion);
    if (isBoundary(down)) {
      spec.relegated = share(down, down.relegated);
      for (const playoff of (down.playoffs ?? []) as MovementPlayoffSpec[]) {
        if (playoff.type === "relegation") spec.relegationPlayoff.push(...range(playoff.positions[0], playoff.positions[1]));
        else if (playoff.type === "cross-tier") spec.relegationPlayoff.push(...playoff.upperPositions);
      }
    } else if (down === undefined) spec.relegated = count(league.relegation);
  }
  const championship = league.championship as { positions?: [number, number] } | undefined;
  if (Array.isArray(championship?.positions)) spec.titlePlayoff = range(championship.positions[0], championship.positions[1]);
  const empty =
    !spec.promoted && !spec.relegated && !spec.promotionPlayoff.length && !spec.relegationPlayoff.length && !spec.titlePlayoff.length;
  return empty ? null : spec;
}

/** Zone of a 1-based final position in a table of `size` clubs. */
export function zoneAt(spec: ZoneSpec | null, position: number, size: number): TableZone | null {
  if (!spec || position < 1) return null;
  if (position <= spec.promoted) return "promoted";
  if (spec.promotionPlayoff.includes(position)) return "promotion-playoff";
  if (spec.titlePlayoff.includes(position)) return "title-playoff";
  if (spec.relegated && position > size - spec.relegated) return "relegated";
  if (spec.relegationPlayoff.includes(position)) return "relegation-playoff";
  return null;
}

/** Legend entries for the zones this table actually shows. */
export function zoneLegend(spec: ZoneSpec | null, size: number): TableZone[] {
  if (!spec) return [];
  const seen = new Set<TableZone>();
  for (let position = 1; position <= size; position++) {
    const zone = zoneAt(spec, position, size);
    if (zone) seen.add(zone);
  }
  return (Object.keys(ZONE_LABELS) as TableZone[]).filter((zone) => seen.has(zone));
}
