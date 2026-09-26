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
  /** True when `name` has the identity core of one of this nation's real clubs (CD Valencia, Roma Calcio, SV Utrecht). */
  copiesRealClub(code: string, name: string): boolean;
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

const CONNECTORS = ["de", "da", "do", "das", "dos", "di", "del", "della", "du", "des", "la", "le", "el", "the", "of"];
const CORE_CONNECTORS = new Set([...CONNECTORS, "al", "las", "los", "les", "lo", "il", "den", "het", "der", "am", "an", "im", "and", "et", "und", "upon", "on", "sur", "en"]);
// Words that name the kind of club, not the club: legal forms and their initials, club/sport/football/royal/union in
// the catalog languages, sports societies (Dinamo, Lokomotiv, Borussia) and the English town suffixes.
const GENERIC_CLUB_WORDS = new Set(
  [
    "ac acd acf acs ad ae afc aif aik aj ak ao as asc asd asv bfc bk bsc bv ca cd cdf ce cf cfc cp cpd cr crb cs csd csm css",
    "ea ec es ess esv fa fb fbc fc fcv fk ff fsv fv gd gf gfc gif gks hnk ib if ifk ik il is jk js kaa kf kfc kks krc ks ksc",
    "kse ksv kv kvc lks mc mfc mfk mks mte nk ofk ogc oks pfc ps rc rcd rfc rkc rks rsc sad sc sco sd se sfc sg sk sks sl sm",
    "sp spvgg ss ssc ssd ssv sv te tj ts tsg tsv tus ud ue umf us usd usm usv vfb vfl vfr vsc vse vv wks",
    "club clube clubul klub kulubu nadi sport sports sportif sportive sportiva sportivo sportiv sportowy sportski sportclub",
    "sportklub sportverein sportfreunde deportivo deportiva deportes deportiu desportivo desportiva esporte esportivo",
    "esportiva esportiu polideportivo athletic athletico atletico atletica atletic athletik football futbol futebol fussball",
    "voetbal fotball fotboll fodbold fotbal futbal fudbal fudbalski nogomet nogometni labdarugo pilkarski calcio balompie",
    "foot soccer real royal royale reale koninklijke sporting racing olympique olympic olympia olimpija olimpik stade union",
    "unione uniao unio unia associazione associacao asociacion association asociatia societa sociedad sociedade societe",
    "grupo entente social spor belediye buyuksehir",
    "dinamo dynamo spartak lokomotiv lokomotiva lokomotive locomotive torpedo cska metallurg metalurh metalurg khimik",
    "chemik shakhtar shakhter banik rudar gornik banyasz zeljeznicar radnik radnicki traktor energetik neftchi stal dukla",
    "sokol slavia slovan sloga jedinstvo buducnost sloboda borac iskra hutnik borussia eintracht fortuna viktoria kickers",
    "alemannia germania teutonia preussen arminia concordia wacker",
    "united city town county borough rovers wanderers albion",
  ].join(" ").split(" "),
);
const looseWord = (word: string) => {
  const singular = word.length >= 6 ? word.replace(/s$/, "") : word;
  return singular.length >= 5 ? singular.replace(/o$/, "") : singular;
};

/**
 * Identity core of a club name: generic club words, numbers, initials and connectors dropped, a glued Turkish "spor"
 * split off, endings loosened (Milano ~ Milan, Helsingborgs ~ Helsingborg), words sorted, so CD Valencia ~ Valencia CF,
 * Roma Calcio ~ AS Roma, 1. FC Stuttgart ~ VfB Stuttgart. `aliases` maps a city demonym to the city (rennais → rennes).
 * A name made only of generic words keeps them (Athletic Club, Racing Club).
 */
export function clubCoreKey(name: string, aliases?: ReadonlyMap<string, string>): string {
  const words = clubNameKey(name)
    .split(" ")
    .flatMap((word) => (aliases?.get(word) ?? word).split(" "))
    .map((word) => (word.length > 6 && word.endsWith("spor") ? word.slice(0, -4) : word))
    .filter((word) => word.length > 1 && !/^\d+$/.test(word) && !CORE_CONNECTORS.has(word));
  const core = words.filter((word) => !GENERIC_CLUB_WORDS.has(word));
  return (core.length ? core : words).map(looseWord).sort().join(" ");
}

/** Single-word city demonyms and adjectives of a nation's curated cities, keyed like clubNameKey(). */
function clubNameAliases(nation: NationSpec | undefined): Map<string, string> {
  const aliases = new Map<string, string>();
  for (const city of nation?.cities.major ?? [])
    for (const form of [city.demonym, city.adjective]) {
      const key = form ? clubNameKey(form) : "";
      if (key && !key.includes(" ")) aliases.set(key, clubNameKey(city.name));
    }
  return aliases;
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
  const realCores = new Map<string, { aliases: Map<string, string>; cores: Set<string> }>();
  const citizenshipGroup = (code: string): string =>
    nationIndex.get(code)?.nationality.citizenship.group ?? code;
  const avoidedClubNames = (code: string): ReadonlySet<string> => {
    let keys = avoided.get(code);
    if (!keys) {
      const names = [
        ...(nationIndex.get(code)?.football?.clubNaming.avoid ?? []),
        ...(fileNames.get(code) ?? []),
      ];
      avoided.set(code, (keys = new Set(names.map(clubNameKey).filter(Boolean))));
    }
    return keys;
  };
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
    avoidedClubNames,
    copiesRealClub(code, name) {
      let real = realCores.get(code);
      if (!real) {
        const aliases = clubNameAliases(nationIndex.get(code));
        const cores = new Set([...avoidedClubNames(code)].map((key) => clubCoreKey(key, aliases)));
        realCores.set(code, (real = { aliases, cores }));
      }
      return real.cores.has(clubCoreKey(name, real.aliases));
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
