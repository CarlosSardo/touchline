// Curated world catalog contract (world version 4). Types only; data lives in the per-confederation files.

export type ConfederationCode =
  | "UEFA"
  | "CAF"
  | "AFC"
  | "CONCACAF"
  | "CONMEBOL"
  | "OFC";
export type Continent = "EU" | "AS" | "AF" | "NA" | "SA" | "OC";
/** Stored in countries.code: ISO 3166-1 alpha-2, plus EN/SCO/WAL/NIR for the UK associations and XK for Kosovo. */
export type NationCode = string;
export type CatalogFile =
  | "uefa-west"
  | "uefa-north"
  | "uefa-central"
  | "uefa-east"
  | "caf"
  | "afc"
  | "concacaf-ofc"
  | "conmebol";

/** Value for the strongest/biggest club (top) and the weakest/smallest club (bottom) of a tier. */
export interface Span {
  top: number;
  bottom: number;
}
export interface WeightedCode {
  code: NationCode;
  weight: number;
}
/** ISO 639-1 language code; the first entry is the nation's primary language (countries.language). */
export interface WeightedLanguage {
  code: string;
  weight: number;
}

// ---------------------------------------------------------------- names

/** @faker-js/faker v10 locales whose male given and family names are Latin script (verified in node_modules). */
export type FakerNameLocale =
  | "af_ZA"
  | "az"
  | "cs_CZ"
  | "da"
  | "de"
  | "de_AT"
  | "de_CH"
  | "en"
  | "en_AU"
  | "en_IN"
  | "en_NG"
  | "en_NP"
  | "en_ZA"
  | "es"
  | "es_MX"
  | "fi"
  | "fr"
  | "fr_BE"
  | "fr_CH"
  | "fr_SN"
  | "hr"
  | "hu"
  | "id_ID"
  | "it"
  | "ku_kmr_latin"
  | "lv"
  | "nb_NO"
  | "nl"
  | "nl_BE"
  | "pl"
  | "pt_BR"
  | "pt_PT"
  | "ro"
  | "ro_MD"
  | "sk"
  | "sl_SI"
  | "sr_RS_latin"
  | "sv"
  | "tr"
  | "uz_UZ_latin"
  | "vi"
  | "yo_NG"
  | "zu_ZA";
/** "faker:<locale>" or "pool:<file>/<name>" (a NamePool defined in any catalog file). */
export type NameSource = `faker:${FakerNameLocale}` | `pool:${string}`;
export interface WeightedNameSource {
  source: NameSource;
  weight: number;
}
/** Curated romanized (Latin-script) names. Ids are global and prefixed by the defining file, e.g. "caf/wolof". */
export interface NamePool {
  id: string;
  given?: string[];
  family?: string[];
}
export interface NameConfig {
  given: WeightedNameSource[];
  family: WeightedNameSource[];
  /** Default "given-family"; HU, JP, KR, CN, VN and similar cultures use "family-given". */
  order?: "given-family" | "family-given";
  /** Chance of a second family name (Iberian/Lusophone usage), 0–0.5. */
  secondFamilyRate?: number;
  /** Chance the player is known by a single name (Brazil, Lusophone Africa), 0–0.5. */
  mononymRate?: number;
  /**
   * Chance (0–1) that the family name's culture is drawn independently of the given name's (melting-pot nations).
   * Default 0: given and family names share a culture wherever both lists name the same source; list the same
   * sources on both sides to pair cultures (IN, MY, SG). Both marginal weightings are always preserved.
   */
  mixRate?: number;
  /**
   * Regional cultures: people born in one of `regions` (CitySpec.region) draw from these lists instead of the
   * national ones (Catalan in Catalunya, Basque in País Vasco); an omitted side keeps the national list.
   */
  regional?: { regions: string[]; given?: WeightedNameSource[]; family?: WeightedNameSource[] }[];
}

// ---------------------------------------------------------- nationality

export type MigrationContext =
  | "lusophone"
  | "frenchAfrica"
  | "germanRecruitment"
  | "dutchDiaspora"
  | "britishIrish"
  | "commonwealth"
  | "crossBorder"
  | "mediterranean"
  | "americas"
  | "caribbean"
  | "pacific"
  | "regional"
  | "asianDiaspora"
  | "gulfLabour"
  | "postSoviet"
  | "yugoslav"
  | "arabWorld";
export interface HeritageLink {
  code: NationCode;
  weight: number;
  context: MigrationContext;
}
export interface CitizenshipRule {
  /** Shared passport group (EN/SCO/WAL/NIR → "GB", PR/GU/VI → "US", FO → "DK", AW/CW → "NL"...). Defaults to the code. */
  group?: string;
  /** "restricted": only one nationality is recorded; "partners": dual only with the listed citizenship groups. */
  dual: "allowed" | "restricted" | "partners";
  partners?: string[];
}
export interface NationalityProfile {
  /** Share of this nation's generated players with two or more family roots (drives dual nationality), 0–0.7. */
  multipleRate: number;
  /** Share with three roots; must not exceed multipleRate. */
  tripleRate: number;
  /** Share of this nation's generated players born in a heritage-link country, 0–0.9. */
  bornAbroadRate: number;
  /** 0–1: how strongly dual nationals choose this nation for international football. */
  diasporaPull: number;
  links: HeritageLink[];
  citizenship: CitizenshipRule;
}

// --------------------------------------------------------------- places

export type CitySize = "mega" | "large" | "medium" | "small" | "town";
export interface CitySpec {
  /** Local spelling in Latin script. */
  name: string;
  size: CitySize;
  /** Province, state or region (used for regional naming and youth grouping). */
  region: string;
  /** Clubs this city can host; defaults: mega 6, large 3, medium 2, small 1, town 1. */
  maxClubs?: number;
  /** Real districts/suburbs used as the identity of extra clubs in the same city. */
  districts?: string[];
  /** cities.json admin1 code for a name shared across states or provinces (US "OR", GeoNames codes elsewhere). */
  admin1?: string;
  /** Coordinates for a city missing from cities.json (both or neither). */
  lat?: number;
  lng?: number;
  /** Adjective for residents used by the {demonym} club-name token ("Ituano", "Luqueño"). */
  demonym?: string;
  /** Attributive form of the city name used by the {cityAdj} token (Hungarian "Debreceni", "Győri"). */
  adjective?: string;
  /** Form of "of" before the city name for the {of} token (Portuguese "do" Porto, "da" Maia); default "de". */
  preposition?: string;
}
export interface CityCatalog {
  /** Curated real cities and towns, biggest first. */
  major: CitySpec[];
  /** Pull extra real towns from the cities.json dependency (fields: name, lat, lng, country, admin1, admin2; no population). */
  extra?: {
    /** cities.json admin1 codes to include; required for EN (ENG), SCO (SCT), WAL (WLS) and NIR (NIR). */
    admin1?: string[];
    exclude?: string[];
    max?: number;
  };
}

// ---------------------------------------------------------------- clubs

/**
 * Tokens: {city} (or a district), {region}, {demonym} (the city's demonym; skipped for cities without one),
 * {cityAdj} (CitySpec.adjective; skipped likewise and for district clubs), {of} (CitySpec.preposition, "de" for
 * districts and by default), {founded} (1899), {founded2} (99). Needs {city}, {region}, {demonym} or {cityAdj}.
 */
export interface ClubNameTemplate {
  pattern: string;
  weight: number;
  /** Restrict to these own tiers; omitted = any tier. */
  tiers?: number[];
}
export interface ClubNamingSpec {
  templates: ClubNameTemplate[];
  /** Region-specific conventions (e.g. Basque/Catalan, Flemish/Walloon); regions match CitySpec.region. */
  regional?: { regions: string[]; templates: ClubNameTemplate[] }[];
  /** Founding-year ranges [earliest, latest] for tier-1 clubs (top) and lowest-tier clubs (bottom). */
  founded: { top: [number, number]; bottom: [number, number] };
  /** Short-name style; default "city" (first three letters). */
  shortName?: "city" | "initials";
  /**
   * Real club names the generator must never produce (decision 5). Matching ignores case, diacritics, punctuation
   * and a leading or trailing club affix (FC, AFC, CF, SC, AC, FK, SK, IF, FF, BK, IK), so "Malmö FF" also blocks "Malmo".
   */
  avoid?: string[];
  /** Typical kit colours (#RRGGBB). */
  colors?: string[];
}
export interface TierClubModel {
  /** Club reputation 1–99. */
  reputation: Span;
  /** Elite clubs at the top of the tier, above reputation.top. */
  giants?: { count: number } & Span;
  /** Stadium capacity. */
  capacity: Span;
  facilities: Span;
  /** Academy quality 1–99; drives youth intake and development. */
  academy: Span;
  /** Annual wage bill in GBP; wage_budget = wageBill / 52. */
  wageBill: Span;
  /** Transfer budget in GBP. */
  transferBudget: Span;
  /** Share of first-team players whose sporting nationality is foreign, 0–0.9. */
  foreignShare: number;
  /** First-team squad size [min, max]; default [25, 30]; min ≥ 25. */
  squadSize?: [number, number];
}

// -------------------------------------------------------------- leagues

export type LeagueStatus = "professional" | "semi-professional" | "amateur";
export interface LeagueSplitGroup {
  name: string;
  /** Positions after the base round-robins, e.g. [1, 6]. Groups partition 1..size. */
  positions: [number, number];
  roundRobins: 1 | 2;
  points: "full" | "halved";
}
export interface LeagueSplitSpec {
  groups: LeagueSplitGroup[];
}
/** Title decided by play-offs after the regular season (MLS Cup, Liguilla...). */
export interface ChampionshipPlayoffSpec {
  positions: [number, number];
  /** Qualification per conference instead of the combined table. */
  perConference?: boolean;
  /** "round-robin": the qualified clubs play a mini-league (Linafoot, Cape Verde); default knockout with byes for top seeds. */
  format?: "knockout" | "round-robin";
  /** Mini-league cycles; default 2. */
  roundRobins?: 1 | 2;
  legs: 1 | 2;
  finalLegs?: 1 | 2;
  neutralFinal?: boolean;
}
export interface LeagueTierSpec {
  /** 1..n, contiguous. */
  tier: number;
  /** Real name without sponsor, e.g. "LaLiga", "Segunda División". */
  name: string;
  shortName: string;
  /** Teams incl. B-teams and hosted cross-border clubs, 6–48 (≤ 24 per conference). Regional real tiers are merged into one division (decision 4). */
  size: number;
  status: LeagueStatus;
  /** League reputation 1–99. */
  reputation: number;
  /** No promotion/relegation into or out of this tier (MLS/USL, A-League, Liga MX while suspended). */
  closed?: boolean;
  /** Base round-robins; default 2. 1 only before a split (Egyptian Premier League). */
  roundRobins?: 1 | 2 | 3 | 4;
  /** Equal-size conferences; each plays roundRobins internally. Required above 24 teams. */
  conferences?: string[];
  /** Extra matches per club against other conferences (MLS: 28 conference + 6 = 34). */
  interConference?: number;
  split?: LeagueSplitSpec;
  championship?: ChampionshipPlayoffSpec;
  /** B-teams occupying slots at world start (pyramid reserve policy only). */
  bTeams?: number;
  clubs: TierClubModel;
}
/** Lower-tier teams at positions play off; `places` winners are promoted (e.g. Championship 3rd–6th). */
export interface PromotionPlayoffSpec {
  type: "promotion";
  positions: [number, number];
  places: number;
  legs: 1 | 2;
  finalLegs?: 1 | 2;
  neutralFinal?: boolean;
}
/** Upper-tier play-out; `places` losers are relegated (e.g. Serie B 16th v 17th). */
export interface RelegationPlayoffSpec {
  type: "relegation";
  positions: [number, number];
  places: number;
  legs: 1 | 2;
}
/** Upper-tier teams defend their places against lower-tier teams (e.g. Bundesliga 16th v 2. Bundesliga 3rd). */
export interface CrossTierPlayoffSpec {
  type: "cross-tier";
  upperPositions: number[];
  /** Lower-tier teams play each other first (higher seed advantage) until one challenger per upper position remains. */
  lowerPositions: number[];
  legs: 1 | 2;
  finalLegs?: 1 | 2;
}
export type MovementPlayoffSpec =
  | PromotionPlayoffSpec
  | RelegationPlayoffSpec
  | CrossTierPlayoffSpec;
/** Exchange between tier `upper` and tier `upper + 1`. Positions are 1-based final ranks of the respective tier. */
export interface TierBoundarySpec {
  upper: number;
  /** Automatic promotions: top N of the lower tier. */
  promoted: number;
  /** Automatic relegations: bottom N of the upper tier. */
  relegated: number;
  playoffs?: MovementPlayoffSpec[];
  /**
   * Movement per conference on whichever side has conferences (National League North/South): `promoted`,
   * `relegated` and play-off `places` are totals split evenly across its conferences, and that side's positions
   * are ranks within each conference. Cross-tier play-offs are not supported per conference.
   */
  perConference?: boolean;
  /**
   * The lower tier's title play-off winner takes the first automatic place; everyone else (the beaten finalist
   * included) keeps table order for the remaining places and play-offs (Primera Nacional final, then Reducido).
   */
  championPromoted?: boolean;
}

// ------------------------------------------------------ cups and youth

export type CupParticipant =
  | "champion"
  | "runner-up"
  | "cup-winner"
  | "cup-runner-up"
  | "league-cup-winner";
export interface CupSpec {
  kind: "national" | "league" | "super";
  /** Real name, e.g. "Copa del Rey", "EFL Cup", "Supercopa de España". */
  name: string;
  shortName?: string;
  /** Own tiers whose first teams enter; omitted = all own tiers (hosted clubs follow CrossBorderSpec.cups). */
  tiers?: number[];
  maxEntrants?: number;
  /** Higher tiers join in later rounds (FA Cup / Copa del Rey style). */
  seededEntry?: boolean;
  /** Fixed number of rounds; omitted = derived from entrants with byes. */
  rounds?: number;
  legs?: 1 | 2;
  finalLegs?: 1 | 2;
  neutralFinal?: boolean;
  /** Super cups only: 2 or 4 participants from last season. */
  participants?: CupParticipant[];
  /** The winner is the association's "cup-winner"/"league-cup-winner" for continental access. */
  continental?: boolean;
  /** "MM-DD" start override within the July–June season. */
  start?: string;
  /** "MM-DD" final; rounds are spread evenly up to it (default national cups 05-22, league cups 02-28). */
  final?: string;
  /** Open-draw home rule: a club at least this many tiers lower hosts (Copa del Rey 1, Coupe de France 2). */
  lowerTierHome?: number;
}
export interface YouthDivisionSpec {
  /** Real name, e.g. "División de Honor Juvenil", "U18 Premier League". */
  name: string;
  /** First-team tiers whose academies play in this division. Divisions cover every own tier exactly once. */
  parentTiers: [number, number];
  /** Max clubs per group, 8–16; default 16. */
  groupSize?: number;
  /** Regional group names in order; the generator numbers groups beyond the list. */
  groupNames?: string[];
}
export interface YouthCompetitionSpec {
  /** Empty only for nations whose clubs are all hosted abroad with youth "host". */
  divisions: YouthDivisionSpec[];
  cup?: { name: string };
}
export interface YouthSpec {
  U19: YouthCompetitionSpec;
  U17: YouthCompetitionSpec;
}
export interface ReservePolicySpec {
  mode: "none" | "pyramid" | "reserve-league";
  /** "{club} B", "Jong {club}", "{club} II", "{club} U23", "{club} Futures"... */
  nameTemplate?: string;
  /** Big clubs only: parents in these own tiers with at least minReputation; maxTeams caps B-teams. */
  eligibility?: {
    parentTiers: number[];
    minReputation: number;
    maxTeams: number;
  };
  /** B-teams play in the own pyramid, never in or above the parent's division. */
  pyramid?: {
    highestTier: number;
    minGapBelowParent: number;
    maxPerTier?: number;
  };
  /** B-teams play in a separate league (tier 0); `host` joins another nation's reserve league (CA → US). */
  reserveLeague?: {
    name: string;
    shortName: string;
    host?: NationCode;
    roundRobins?: 2 | 3 | 4;
    conferences?: string[];
    reputation: number;
  };
  /** Squad age rule: players older than maxAge limited to `overage`. */
  ageRule?: { maxAge: number; overage: number };
  /** B-team squad size [min, max]; min ≥ 20. */
  squad?: [number, number];
}
/** This nation's clubs playing in another nation's pyramid (WAL → EN, LI → CH, CA → US...). */
export interface CrossBorderSpec {
  host: NationCode;
  /** Host tier of each club at world start. */
  tiers: number[];
  /** Home city of each club (same order); must exist in this nation's cities.major. */
  cities: string[];
  /** National cups entered: host's, home's (e.g. Liechtenstein Cup) or none. */
  cups: "host" | "home" | "none";
  /** Association whose continental access list the clubs use. */
  continental: "host" | "home" | "none";
  youth: "host" | "home";
  registration: "host" | "home";
}
/** Association coefficient points per entrant (win 2, draw 1, qualifying halved) for seasons 2020/21..2024/25, oldest first. */
export interface CoefficientSeed {
  association: [number, number, number, number, number];
  /** Real 2025/26 points: the 2026/27 European Performance Spots and, one season lagged, the 2027/28 ranking. */
  season2025?: number;
}
export interface DomesticFootballSpec {
  /** Own tiers; length must equal the directive count (LI: none, clubs hosted in CH). */
  leagues: LeagueTierSpec[];
  /** One boundary per adjacent tier pair. */
  movement: TierBoundarySpec[];
  cups: CupSpec[];
  youth: YouthSpec;
  reserves: ReservePolicySpec;
  clubNaming: ClubNamingSpec;
  /** Sporting nationalities of foreign players at this nation's clubs. */
  importSources: WeightedCode[];
  /** Required outside OFC. */
  coefficients?: CoefficientSeed;
}

// -------------------------------------------------------------- nations

export interface HomePoolSpec {
  /** Club-less home-based seniors (19+), scoutable and signable, used by national teams. */
  seniors: number;
  /** Home-based players aged 15–18. */
  youth: number;
}
export interface AbroadSpec {
  /** Seniors of this sporting nationality placed at foreign clubs at world start. */
  seniors: number;
  /** U17/U19 players of this nationality in foreign academies. */
  youth: number;
  /** Nations with own leagues. */
  destinations: WeightedCode[];
}
export interface SuspensionSpec {
  club: boolean;
  national: boolean;
  reason: string;
}
export interface NationSpec {
  code: NationCode;
  /** ISO 3166-1 alpha-2 used for cities.json (GB for EN/SCO/WAL/NIR, XK for Kosovo). */
  iso2: string;
  name: string;
  confederation: ConfederationCode;
  continent: Continent;
  capital: string;
  latitude: number;
  languages: WeightedLanguage[];
  /** national: senior national-team strength; league: domestic league/association strength (countries.reputation). */
  reputation: { national: number; league: number };
  euEea: boolean;
  suspended?: SuspensionSpec;
  /** Mean adult height (cm) of male footballers; default 181, sd 6.5. */
  physique?: { height: number; heightSd?: number };
  names: NameConfig;
  nationality: NationalityProfile;
  cities: CityCatalog;
  /** Present for nations with clubs (own tiers or hosted abroad). */
  football?: DomesticFootballSpec;
  hostedAbroad?: CrossBorderSpec[];
  /** Required for nations without own tiers. */
  homePool?: HomePoolSpec;
  abroad?: AbroadSpec;
}

// ---------------------------------------------------------- continental

export type ContinentalStage = "main" | "playoff" | "q1" | "q2" | "q3" | "q4";
export type AccessSource =
  | "league"
  | "champion"
  | "cup-winner"
  | "league-cup-winner"
  | "u19-champion"
  | "u20-champion";
export interface AccessEntry {
  source: AccessSource;
  /** Final domestic rank for source "league". */
  position?: number;
  stage: ContinentalStage;
  path?: "champions" | "league";
}
export interface AccessRule {
  competition: string;
  basis: "association-rank" | "fixed";
  /** Ranks count only this zone's associations (AFC East/West). */
  zone?: string;
  /** Association-rank bands (UEFA, AFC, CAF). */
  bands?: { ranks: [number, number]; entries: AccessEntry[] }[];
  /** Fixed entries per nation (CONMEBOL, CONCACAF). */
  fixed?: { nations: NationCode[]; entries: AccessEntry[] }[];
}
export interface ContinentalCompetitionSpec {
  id: string;
  /** Real name, e.g. "AFC Champions League Elite", "CONCACAF Champions Cup". */
  name: string;
  shortName: string;
  confederation: ConfederationCode;
  age: "Senior" | "U19" | "U20";
  /** Prestige within the confederation (1 = top). */
  level: 1 | 2 | 3;
  /** "super" = one-off between titleholders (UEFA Super Cup, Recopa). */
  kind: "club" | "super";
  format: "league-phase" | "groups" | "knockout";
  teams: number;
  matchdays?: number;
  groupSize?: number;
  /** Teams advancing from the main phase. */
  advance: number;
  /** Geographic zones (AFC East/West). */
  zones?: { name: string; nations: NationCode[] }[];
  legs: 1 | 2;
  finalLegs: 1 | 2;
  neutralFinal: boolean;
  /** "MM-DD" main-phase start within the July–June season. */
  start: string;
  /** `vacancyPath`: a titleholder place left free (holder qualified otherwise) goes to that path's best club. */
  titleholders?: { from: string; stage: ContinentalStage; vacancyPath?: "champions" | "league" }[];
  /** Regional routes, e.g. Central American Cup top 6 → Champions Cup. */
  feeds?: { to: string; positions: [number, number]; stage: ContinentalStage }[];
  /** Regional qualifier: its entrants may also hold a direct place elsewhere. */
  feeder?: boolean;
  /** Entrants are the youth teams of this competition's main-phase clubs (UEFA Youth League). */
  mirrors?: string;
  /** Main-phase places that skip the knockout play-off round (UEFA 1st–8th). */
  byes?: number;
  /** Legs of qualifying rounds when they differ from `legs` (UYL Domestic Champions Path 2, ACL Elite preliminary 1). */
  qualifyingLegs?: 1 | 2;
  /** Qualifying losers moving to another competition (UCL Q3 losers → UEL). */
  drops?: { from: ContinentalStage; path?: "champions" | "league"; to: string; stage: ContinentalStage }[];
}
export interface ContinentalCatalog {
  competitions: ContinentalCompetitionSpec[];
  access: AccessRule[];
  /** Confederations that record association coefficients (never OFC). */
  coefficientConfederations: ConfederationCode[];
  /**
   * Associations ranked without clubs in the game (suspended Russia, nations without leagues): real seeds, then their
   * seeded average each season, so they keep their real rank while their access places are vacated.
   */
  rankingOnly?: Partial<Record<NationCode, CoefficientSeed>>;
}

// -------------------------------------------------------------- catalog

export interface CatalogFileData {
  file: CatalogFile;
  nations: NationSpec[];
  namePools: NamePool[];
  /** File-level real club names per nation, merged with each nation's `clubNaming.avoid`. */
  realClubNames?: Readonly<Record<NationCode, readonly string[]>>;
}
export interface WorldCatalog {
  files: readonly CatalogFileData[];
  continental: ContinentalCatalog;
}
export interface CatalogIssue {
  level: "error" | "warning";
  path: string;
  message: string;
}
