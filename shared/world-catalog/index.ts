// Server-side entry point of the curated world catalog. src/ must not import it (bundle size); expose facts through the API.
import { AFC } from "./afc.ts";
import { CAF } from "./caf.ts";
import { CONCACAF_OFC } from "./concacaf-ofc.ts";
import { CONMEBOL } from "./conmebol.ts";
import { CONTINENTAL } from "./continental.ts";
import { UEFA_CENTRAL } from "./uefa-central.ts";
import { UEFA_EAST } from "./uefa-east.ts";
import { UEFA_NORTH, UEFA_NORTH_REAL_CLUB_NAMES } from "./uefa-north.ts";
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
export { CONTINENTAL };
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
  { ...UEFA_NORTH, realClubNames: UEFA_NORTH_REAL_CLUB_NAMES },
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

/** Indexed lookups over one catalog: the curated world by default, fixtures in tests. */
export interface CatalogLookup {
  readonly catalog: WorldCatalog;
  allNations(): NationSpec[];
  nationByCode(code: string): NationSpec | undefined;
  requireNation(code: string): NationSpec;
  namePool(id: string): NamePool | undefined;
  hostedClubsIn(hostCode: string): { home: NationSpec; spec: CrossBorderSpec }[];
  citizenshipGroup(code: string): string;
  permitsDualNationality(first: string, second: string): boolean;
  hasEuEeaNationality(codes: Iterable<string>): boolean;
  isSuspended(code: string, scope: "club" | "national"): boolean;
  /** clubNameKey()s of real clubs the generator must not reproduce for this nation. */
  avoidedClubNames(code: string): ReadonlySet<string>;
}

const CLUB_AFFIX = "(?:a?fc|cf|sc|ac|fk|sk|if|ff|bk|ik)";
const LEADING_AFFIX = new RegExp(`^(?:${CLUB_AFFIX} )+`);
const TRAILING_AFFIX = new RegExp(`(?: ${CLUB_AFFIX})+$`);
const FOLDED: Record<string, string> = { ø: "o", æ: "ae", œ: "oe", ß: "ss", ı: "i", đ: "d", ł: "l", þ: "th", ð: "d", ħ: "h" };
/** Comparison key for club names: case, diacritics, punctuation and a leading/trailing club affix ignored. */
export function clubNameKey(name: string): string {
  const words = name
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[øæœßıđłþðħ]/g, (letter) => FOLDED[letter])
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
  const bare = words.replace(LEADING_AFFIX, "").replace(TRAILING_AFFIX, "").trim();
  return bare || words;
}

export function catalogLookup(catalog: WorldCatalog): CatalogLookup {
  const nationIndex = new Map<string, NationSpec>();
  const poolIndex = new Map<string, NamePool>();
  const fileNames = new Map<string, readonly string[]>();
  for (const file of catalog.files) {
    for (const nation of file.nations) nationIndex.set(nation.code, nation);
    for (const pool of file.namePools) poolIndex.set(pool.id, pool);
    for (const [code, names] of Object.entries(file.realClubNames ?? {}))
      fileNames.set(code, [...(fileNames.get(code) ?? []), ...names]);
  }
  const avoided = new Map<string, ReadonlySet<string>>();
  const citizenshipGroup = (code: string): string =>
    nationIndex.get(code)?.nationality.citizenship.group ?? code;
  return {
    catalog,
    allNations: () => [...nationIndex.values()],
    nationByCode: (code) => nationIndex.get(code),
    requireNation(code) {
      const nation = nationIndex.get(code);
      if (!nation) throw new Error(`Unknown catalog nation ${code}.`);
      return nation;
    },
    namePool: (id) => poolIndex.get(id),
    hostedClubsIn: (hostCode) =>
      [...nationIndex.values()].flatMap((home) =>
        (home.hostedAbroad ?? [])
          .filter((spec) => spec.host === hostCode)
          .map((spec) => ({ home, spec })),
      ),
    citizenshipGroup,
    permitsDualNationality(first, second) {
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
    },
    hasEuEeaNationality: (codes) =>
      [...codes].some((code) => nationIndex.get(code)?.euEea === true),
    isSuspended: (code, scope) =>
      Boolean(nationIndex.get(code)?.suspended?.[scope]),
    avoidedClubNames(code) {
      let keys = avoided.get(code);
      if (!keys) {
        const names = [
          ...(nationIndex.get(code)?.football?.clubNaming.avoid ?? []),
          ...(fileNames.get(code) ?? []),
        ];
        avoided.set(code, (keys = new Set(names.map(clubNameKey).filter(Boolean))));
      }
      return keys;
    },
  };
}

let defaultLookup: CatalogLookup | undefined;
/** The curated catalog, indexed on first use so importing this module stays side-effect free. */
export const worldCatalog = (): CatalogLookup =>
  (defaultLookup ??= catalogLookup(WORLD_CATALOG));

export const allNations = (): NationSpec[] => worldCatalog().allNations();
export const nationByCode = (code: string): NationSpec | undefined =>
  worldCatalog().nationByCode(code);
export const requireNation = (code: string): NationSpec =>
  worldCatalog().requireNation(code);
export const namePool = (id: string): NamePool | undefined =>
  worldCatalog().namePool(id);
export const nationsIn = (confederation: ConfederationCode): NationSpec[] =>
  allNations().filter((nation) => nation.confederation === confederation);

export const leagueTiers = (nation: NationSpec): LeagueTierSpec[] =>
  nation.football?.leagues ?? [];
export const hasOwnLeague = (nation: NationSpec) => leagueTiers(nation).length > 0;
/** Nations with clubs: own tiers or clubs hosted abroad (LI). */
export const isClubNation = (nation: NationSpec) =>
  hasOwnLeague(nation) || Boolean(nation.hostedAbroad?.length);

/** Clubs of other nations playing in `hostCode`'s pyramid. */
export const hostedClubsIn = (
  hostCode: string,
): { home: NationSpec; spec: CrossBorderSpec }[] =>
  worldCatalog().hostedClubsIn(hostCode);

export const citizenshipGroup = (code: string): string =>
  worldCatalog().citizenshipGroup(code);

/** Fictional citizenship rule: a person may hold both nationalities. */
export const permitsDualNationality = (first: string, second: string): boolean =>
  worldCatalog().permitsDualNationality(first, second);

export const hasEuEeaNationality = (codes: Iterable<string>): boolean =>
  worldCatalog().hasEuEeaNationality(codes);

export const isSuspended = (code: string, scope: "club" | "national"): boolean =>
  worldCatalog().isSuspended(code, scope);

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
