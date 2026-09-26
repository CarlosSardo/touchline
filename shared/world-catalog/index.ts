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
  /**
   * True when `name` copies one of this nation's real clubs: the same identity (CD Valencia, Roma Calcio, Kickers
   * Stuttgart), that identity less one word (Hove Albion), or a bare place a real club is known by (Birmingham FC).
   * `place` is the town the name was rendered from; curated cities and districts count as places anyway.
   */
  copiesRealClub(code: string, name: string, place?: string): boolean;
}

const CLUB_AFFIX = "(?:a?fc|cf|sc|ac|fk|sk|if|ff|bk|ik)";
const LEADING_AFFIX = new RegExp(`^(?:${CLUB_AFFIX} )+`);
const TRAILING_AFFIX = new RegExp(`(?: ${CLUB_AFFIX})+$`);
const FOLDED: Record<string, string> = { ø: "o", æ: "ae", œ: "oe", ß: "ss", ı: "i", đ: "d", ł: "l", þ: "th", ð: "d", ħ: "h" };
const plainWords = (name: string) =>
  name
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[øæœßıđłþðħ]/g, (letter) => FOLDED[letter])
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
/** Comparison key for club names: case, diacritics, punctuation and a leading/trailing club affix ignored. */
export function clubNameKey(name: string): string {
  const words = plainWords(name);
  const bare = words.replace(LEADING_AFFIX, "").replace(TRAILING_AFFIX, "").trim();
  return bare || words;
}

const CONNECTORS = ["de", "da", "do", "das", "dos", "di", "del", "della", "du", "des", "la", "le", "el", "the", "of"];
const CORE_CONNECTORS = new Set([...CONNECTORS, "al", "las", "los", "les", "lo", "il", "den", "het", "der", "am", "an", "im", "and", "et", "und", "upon", "on", "sur", "en"]);
// Words that only give a club's legal form: initials (FC, CD, SV, AC, SK…), club/sport/football/society in the catalog
// languages. Distinctive words (Town, United, Rovers, Real, Racing, Dinamo, Kickers…) are part of the identity.
const CLUB_FORM_WORDS = new Set(
  [
    "ac acd acf acs ad ae afc aif aik aj ak ao as asc asd asv bfc bk bois bsc bv ca cd cdf ce cf cfc cp cpd cr crb cs csd csm css",
    "ea ec es ess esv fa fb fbc fc fcv fk ff fsv fv gd gf gfc gif gks goif hnk ib if ifk ik il is jk js kaa kf kfc kks kmsk krc ks",
    "ksc kse ksk ksv kv kvc kvk lks mc mfc mfk mks mte nk ofk ogc oks pfc ps rc rcd rfc rkc rks rsc sad sc scp sco sd se sfc",
    "sg sk sks sl sm sp spvgg ss ssc ssd ssv sv te tj ts tsg tsv tus ud ue umf us usd usm usv vfb vfl vfr vsc vse vv wks",
    "club clube clubul klub kulubu nadi sport sports sportif sportive sportiva sportivo sportiv sportowy sportski sportclub",
    "sportklub sportverein sportfreunde deportivo deportiva deportes deportiu desportivo desportiva esporte esportivo",
    "esportiva esportiu polideportivo football futbol futebol fussball voetbal fotball fotboll fodbold fotbal futbal fudbal",
    "fudbalski nogomet nogometni labdarugo pilkarski calcio balompie foot soccer associazione associacao asociacion",
    "association asociatia societa sociedad sociedade societe grupo entente social spor boldklub bollklubb",
  ].join(" ").split(" "),
);
// Spellings of one distinctive word: Atlético ~ Athletic, Real ~ Royal, Dinamo ~ Dynamo, União ~ Union.
const CLUB_WORD_FORMS: Record<string, string> = {
  atletico: "athletic", atletica: "athletic", atletic: "athletic", athletico: "athletic", athletik: "athletic",
  real: "royal", reale: "royal", royale: "royal", koninklijke: "royal",
  olympique: "olympic", olympia: "olympic", olimpija: "olympic", olimpik: "olympic", olimpico: "olympic",
  unione: "union", uniao: "union", unio: "union", unia: "union",
  dinamo: "dynamo", lokomotiva: "lokomotiv", lokomotive: "lokomotiv", locomotive: "lokomotiv",
  metalurh: "metallurg", metalurg: "metallurg", shakhter: "shakhtar", utd: "united",
};
// Initials that spell out a distinctive word, so RC Lens also blocks Racing Lens and SC Braga Sporting Braga.
const FORM_EXPANSIONS: Record<string, string[]> = {
  rc: ["racing", "royal"], rcd: ["royal"], rsc: ["royal", "sporting"], krc: ["royal", "racing"], rfc: ["royal"],
  rkc: ["royal"], ksc: ["royal", "sporting"], kv: ["royal"], kvc: ["royal"], kaa: ["royal"], ksv: ["royal"],
  ksk: ["royal"], kvk: ["royal"], kmsk: ["royal"], sc: ["sporting"], scp: ["sporting"], ca: ["athletic"],
  ac: ["athletic"], ud: ["union"], ue: ["union"], us: ["union"], usd: ["union"], usm: ["union"], ogc: ["olympic"],
};
const looseWord = (word: string) => {
  const singular = word.length >= 6 ? word.replace(/s$/, "") : word;
  return singular.length >= 5 ? singular.replace(/o$/, "") : singular;
};
const identityWord = (word: string) => looseWord(CLUB_WORD_FORMS[word] ?? word);

function nameWords(name: string, aliases?: ReadonlyMap<string, string>): string[] {
  return plainWords(name)
    .split(" ")
    .flatMap((word) => (aliases?.get(word) ?? word).split(" "))
    .map((word) => (word.length > 6 && word.endsWith("spor") ? word.slice(0, -4) : word))
    .filter((word) => word.length > 1 && !/^\d+$/.test(word) && !CORE_CONNECTORS.has(word));
}

/**
 * Identity of a club name: legal forms, numbers and connectors dropped, a glued Turkish "spor" split off, spellings
 * folded (Atlético ~ Athletic), endings loosened (Milano ~ Milan), words sorted, so CD Valencia ~ Valencia CF,
 * 1. FC Stuttgart ~ VfB Stuttgart, while Birmingham Town ≠ Birmingham City. `aliases` maps a city demonym to the city
 * (stuttgarter → stuttgart). A name made only of form words keeps them.
 */
export function clubCoreKey(name: string, aliases?: ReadonlyMap<string, string>): string {
  const words = nameWords(name, aliases);
  const core = words.filter((word) => !CLUB_FORM_WORDS.has(word));
  return [...new Set((core.length ? core : words).map(identityWord))].sort().join(" ");
}

/** Identities of a real club: its own, plus each spelled-out form initial (RCD Mallorca ~ Real Mallorca). */
function realClubKeys(name: string, aliases: ReadonlyMap<string, string>): string[] {
  const words = nameWords(name, aliases);
  const base = clubCoreKey(name, aliases);
  let keys = [base ? base.split(" ") : []];
  for (const word of words)
    for (const expansion of words.length > 1 ? (FORM_EXPANSIONS[word] ?? []) : [])
      keys = [...keys, ...keys.map((key) => [...key, identityWord(expansion)])];
  return [...new Set(keys.map((key) => [...new Set(key)].sort().join(" ")))].filter(Boolean);
}

/** Every non-empty word subset of an identity key, marking the ones exactly one word shorter. */
function identitySubsets(key: string, into: Set<string>, shorter: Set<string>) {
  const words = key.split(" ");
  for (let mask = 1; mask < 1 << Math.min(words.length, 8); mask++) {
    const subset = words.filter((_, index) => mask & (1 << index));
    into.add(subset.join(" "));
    if (subset.length === words.length - 1) shorter.add(subset.join(" "));
  }
}

/** Single-word city demonyms and adjectives of a nation's curated cities, keyed like clubNameKey(); "-er" forms too (Stuttgarter). */
function clubNameAliases(nation: NationSpec | undefined): Map<string, string> {
  const aliases = new Map<string, string>();
  for (const city of nation?.cities.major ?? []) {
    const cityKey = clubNameKey(city.name);
    if (!cityKey.includes(" ")) for (const form of [`${cityKey}er`, ...(cityKey.endsWith("e") ? [`${cityKey}r`] : [])]) aliases.set(form, cityKey);
    for (const form of [city.demonym, city.adjective]) {
      const key = form ? clubNameKey(form) : "";
      if (key && !key.includes(" ")) aliases.set(key, cityKey);
    }
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
  interface RealClubs {
    aliases: Map<string, string>;
    exact: Set<string>;
    /** Real identities less one word (Hove Albion for Brighton & Hove Albion). */
    shorter: Set<string>;
    /** Every part of a real identity, for bare places (Birmingham for Birmingham City). */
    parts: Set<string>;
    places: Set<string>;
    /** Curated districts by their first identity word, with their city's words (Favoriten → Wien). */
    districts: Map<string, { words: string[]; city: string[] }[]>;
  }
  const realClubs = new Map<string, RealClubs>();
  const citizenshipGroup = (code: string): string =>
    nationIndex.get(code)?.nationality.citizenship.group ?? code;
  const realClubNames = (code: string) => [
    ...(nationIndex.get(code)?.football?.clubNaming.avoid ?? []),
    ...(fileNames.get(code) ?? []),
  ];
  const avoidedClubNames = (code: string): ReadonlySet<string> => {
    let keys = avoided.get(code);
    if (!keys) avoided.set(code, (keys = new Set(realClubNames(code).map(clubNameKey).filter(Boolean))));
    return keys;
  };
  const realClubsOf = (code: string): RealClubs => {
    let real = realClubs.get(code);
    if (!real) {
      const nation = nationIndex.get(code);
      const aliases = clubNameAliases(nation);
      real = { aliases, exact: new Set(), shorter: new Set(), parts: new Set(), places: new Set(), districts: new Map() };
      for (const name of realClubNames(code))
        for (const key of realClubKeys(name, aliases)) {
          real.exact.add(key);
          identitySubsets(key, real.parts, real.shorter);
        }
      for (const city of nation?.cities.major ?? []) {
        const cityWords = clubCoreKey(city.name, aliases).split(" ");
        for (const place of [city.name, ...(city.districts ?? [])]) real.places.add(clubCoreKey(place, aliases));
        for (const district of city.districts ?? []) {
          const words = clubCoreKey(district, aliases).split(" ").filter(Boolean);
          if (words.length) real.districts.set(words[0], [...(real.districts.get(words[0]) ?? []), { words, city: cityWords }]);
        }
      }
      realClubs.set(code, real);
    }
    return real;
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
    copiesRealClub(code, name, place) {
      const real = realClubsOf(code);
      const copies = (key: string) => real.exact.has(key) || real.shorter.has(key);
      const key = clubCoreKey(name, real.aliases);
      if (copies(key)) return true;
      const bare = real.places.has(key) || (place !== undefined && clubCoreKey(place, real.aliases) === key);
      if (bare) return real.parts.has(key);
      // A district with a word of its city's real club is that club: Austria Favoriten ~ Austria Wien.
      const words = key.split(" ");
      return words.some((word) =>
        (real.districts.get(word) ?? []).some((district) => {
          if (!district.words.every((part) => words.includes(part))) return false;
          const rest = words.filter((part) => !district.words.includes(part) && !district.city.includes(part));
          return rest.length > 0 && real.exact.has([...new Set([...rest, ...district.city])].sort().join(" "));
        }),
      );
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
