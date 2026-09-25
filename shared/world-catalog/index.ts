// Server-side entry point of the curated world catalog. src/ must not import it (bundle size); expose facts through the API.
import { AFC } from "./afc.ts";
import { CAF } from "./caf.ts";
import { CONCACAF_OFC } from "./concacaf-ofc.ts";
import { CONMEBOL } from "./conmebol.ts";
import { CONTINENTAL } from "./continental.ts";
import { UEFA_CENTRAL } from "./uefa-central.ts";
import { UEFA_EAST } from "./uefa-east.ts";
import { UEFA_NORTH } from "./uefa-north.ts";
import { UEFA_WEST } from "./uefa-west.ts";
import type {
  CatalogFileData,
  ConfederationCode,
  ContinentalCompetitionSpec,
  CrossBorderSpec,
  LeagueTierSpec,
  NamePool,
  NationSpec,
  WorldCatalog,
} from "./types.ts";

export type * from "./types.ts";
export {
  CATALOG_ASSIGNMENT,
  assertValidCatalog,
  summarizeCatalog,
  tierMatchdays,
  validateCatalog,
} from "./validate.ts";

/** Recorded in meta.world.catalogVersion; bump when catalog data changes generated worlds. */
export const CATALOG_VERSION = 1;

export const CATALOG_FILES: readonly CatalogFileData[] = [
  UEFA_WEST,
  UEFA_NORTH,
  UEFA_CENTRAL,
  UEFA_EAST,
  CAF,
  AFC,
  CONCACAF_OFC,
  CONMEBOL,
];
export const WORLD_CATALOG: WorldCatalog = {
  files: CATALOG_FILES,
  continental: CONTINENTAL,
};

const nationIndex = new Map<string, NationSpec>();
const poolIndex = new Map<string, NamePool>();
for (const file of CATALOG_FILES) {
  for (const nation of file.nations) nationIndex.set(nation.code, nation);
  for (const pool of file.namePools) poolIndex.set(pool.id, pool);
}

export const allNations = (): NationSpec[] => [...nationIndex.values()];
export const nationByCode = (code: string): NationSpec | undefined =>
  nationIndex.get(code);
export function requireNation(code: string): NationSpec {
  const nation = nationIndex.get(code);
  if (!nation) throw new Error(`Unknown catalog nation ${code}.`);
  return nation;
}
export const namePool = (id: string): NamePool | undefined => poolIndex.get(id);
export const nationsIn = (confederation: ConfederationCode): NationSpec[] =>
  allNations().filter((nation) => nation.confederation === confederation);

export const leagueTiers = (nation: NationSpec): LeagueTierSpec[] =>
  nation.football?.leagues ?? [];
export const hasOwnLeague = (nation: NationSpec) => leagueTiers(nation).length > 0;
/** Nations with clubs: own tiers or clubs hosted abroad (LI). */
export const isClubNation = (nation: NationSpec) =>
  hasOwnLeague(nation) || Boolean(nation.hostedAbroad?.length);

/** Clubs of other nations playing in `hostCode`'s pyramid. */
export function hostedClubsIn(
  hostCode: string,
): { home: NationSpec; spec: CrossBorderSpec }[] {
  return allNations().flatMap((home) =>
    (home.hostedAbroad ?? [])
      .filter((spec) => spec.host === hostCode)
      .map((spec) => ({ home, spec })),
  );
}

export const citizenshipGroup = (code: string): string =>
  nationIndex.get(code)?.nationality.citizenship.group ?? code;

/** Fictional citizenship rule: a person may hold both nationalities. */
export function permitsDualNationality(first: string, second: string): boolean {
  const left = nationIndex.get(first);
  const right = nationIndex.get(second);
  const leftGroup = citizenshipGroup(first);
  const rightGroup = citizenshipGroup(second);
  if (!left || !right || leftGroup === rightGroup) return false;
  const allows = (nation: NationSpec, other: string) => {
    const rule = nation.nationality.citizenship;
    return rule.dual === "allowed" ||
      (rule.dual === "partners" && Boolean(rule.partners?.includes(other)));
  };
  return allows(left, rightGroup) && allows(right, leftGroup);
}

export const hasEuEeaNationality = (codes: Iterable<string>): boolean =>
  [...codes].some((code) => nationIndex.get(code)?.euEea === true);

export const isSuspended = (code: string, scope: "club" | "national"): boolean =>
  Boolean(nationIndex.get(code)?.suspended?.[scope]);

export const continentalCompetition = (
  id: string,
): ContinentalCompetitionSpec | undefined =>
  CONTINENTAL.competitions.find((competition) => competition.id === id);

// Stable identities written to league.data.catalogKey and club.data.worldKey (independent of the seed).
export const leagueKey = (code: string, tier: number) => `L:${code}:${tier}`;
export const reserveLeagueKey = (code: string) => `R:${code}`;
export const youthLeagueKey = (
  code: string,
  age: "U19" | "U17",
  division: number,
  group: number,
) => `Y:${code}:${age}:${division}:${group}`;
export const clubKey = (code: string, tier: number, slot: number) =>
  `C:${code}:${tier}:${slot}`;
export const hostedClubKey = (home: string, index: number) => `C:${home}:H${index}`;
export const reserveClubKey = (parentKey: string) => `${parentKey}:B`;
