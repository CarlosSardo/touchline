import type {
  AccessEntry,
  CatalogFile,
  CatalogFileData,
  CatalogIssue,
  ClubNameTemplate,
  ClubNamingSpec,
  ConfederationCode,
  CrossBorderSpec,
  CupSpec,
  DomesticFootballSpec,
  FakerNameLocale,
  LeagueTierSpec,
  NameConfig,
  NamePool,
  NationSpec,
  Span,
  TierBoundarySpec,
  WeightedCode,
  WorldCatalog,
} from "./types.ts";

export interface CatalogAssignment {
  code: string;
  file: CatalogFile;
  confederation: ConfederationCode;
  /** Own league tiers required by the directive. */
  tiers: number;
}

const assign = (
  file: CatalogFile,
  confederation: ConfederationCode,
  spec: string,
): CatalogAssignment[] =>
  spec.split(" ").map((entry) => {
    const [code, tiers = "0"] = entry.split(":");
    return { code, file, confederation, tiers: Number(tiers) };
  });

/**
 * The 211 FIFA members, their catalog file and own league tiers (directive 2026-09-25).
 * LI has no own league: its clubs play in the Swiss pyramid and its cup winner takes the UEFA place (decision 7).
 */
export const CATALOG_ASSIGNMENT: readonly CatalogAssignment[] = [
  ...assign("uefa-west", "UEFA", "ES:4 PT:3 FR:3 IT:3 GR:2 CY:1 AD:1 SM:1 MT:1 GI:1"),
  ...assign("uefa-north", "UEFA", "EN:6 SCO:1 WAL:1 NIR:1 IE:1 IS:1 FO NO:1 SE:2 DK:1 FI:1 EE:1 LV:1 LT:1"),
  ...assign("uefa-central", "UEFA", "DE:3 NL:2 BE:2 LU:2 CH:2 LI AT:1 PL:1 CZ:1 SK:1 HU:1 SI:1 HR:2"),
  ...assign("uefa-east", "UEFA", "TR:1 UA:1 RU:1 BY:1 MD:1 GE:1 AM:1 AZ KZ:1 RO:1 BG:2 IL RS:2 BA:1 ME:2 XK:1 AL:1 MK"),
  ...assign(
    "caf",
    "CAF",
    "MA:1 SN:1 EG:1 NG:2 DZ:1 CI:1 TN:1 CM:1 CD:2 ZA:1 GH:1 CV:1 AO:1 MZ:1 GQ:1 ZW:1 CG:1 GW:1 ET:1 BJ BW BF BI CF TD KM DJ ER SZ GA GM GN KE LS LR LY MG MW ML MR MU NA NE RW ST SC SL SO SS SD TZ TG UG ZM",
  ),
  ...assign(
    "afc",
    "AFC",
    "JP:1 IR:1 KR:1 AU:1 SA:1 QA:1 UZ:1 IQ:1 AE:1 CN:1 VN:1 TH:1 IN:1 ID:1 PH:1 AF BH BD BT BN KH TW GU HK JO KP KW KG LA LB MO MY MV MN MM NP OM PK PS SG LK SY TJ TL TM YE",
  ),
  ...assign(
    "concacaf-ofc",
    "CONCACAF",
    "MX:2 US:3 CA:2 PA:1 CR:1 JM:1 HN:2 HT:1 SV:1 GT:1 DO:1 PR:1 AI AG AW BS BB BZ BM VG KY CU CW DM GD GY MS NI KN LC VC SR TT TC VI",
  ),
  ...assign("concacaf-ofc", "OFC", "NZ:1 AS CK FJ NC PG WS SB PF TO VU"),
  ...assign("conmebol", "CONMEBOL", "AR:2 BR:3 CO:2 UY:2 EC:2 PY:1 CL:1 PE:1 VE:1 BO:1"),
];

export const CATALOG_FILE_KEYS: readonly CatalogFile[] = [
  "uefa-west",
  "uefa-north",
  "uefa-central",
  "uefa-east",
  "caf",
  "afc",
  "concacaf-ofc",
  "conmebol",
];

const EU_EEA = new Set(
  "AT BE BG HR CY CZ DK EE FI FR DE GR HU IE IT LV LT LU MT NL PL PT RO SK SI ES SE IS LI NO".split(" "),
);
const UK_ADMIN1: Record<string, string> = {
  EN: "ENG",
  SCO: "SCT",
  WAL: "WLS",
  NIR: "NIR",
};
// Decision 6 cross-border setups (home → host) that must exist.
const REQUIRED_CROSS_BORDER: readonly [string, string][] = [
  ["WAL", "EN"],
  ["NIR", "IE"],
  ["AD", "ES"],
  ["LI", "CH"],
  ["CA", "US"],
  ["NZ", "AU"],
];
// Male given/family name counts per faker v10 locale, measured in node_modules so validation stays faker-free.
const FAKER_NAME_COUNTS: Record<FakerNameLocale, [number, number]> = {
  af_ZA: [113, 162],
  az: [35, 10],
  cs_CZ: [793, 988],
  da: [118, 106],
  de: [562, 1688],
  de_AT: [572, 1688],
  de_CH: [178, 209],
  en: [1391, 473],
  en_AU: [100, 286],
  en_IN: [454, 92],
  en_NG: [67, 156],
  en_NP: [37, 39],
  en_ZA: [247, 237],
  es: [107, 625],
  es_MX: [139, 687],
  fi: [50, 50],
  fr: [480, 150],
  fr_BE: [1254, 615],
  fr_CH: [447, 199],
  fr_SN: [102, 148],
  hr: [167, 1000],
  hu: [100, 100],
  id_ID: [489, 148],
  it: [1083, 2170],
  ku_kmr_latin: [49, 58],
  lv: [91, 194],
  nb_NO: [50, 100],
  nl: [572, 131],
  nl_BE: [100, 32],
  pl: [230, 712],
  pt_BR: [88, 21],
  pt_PT: [95, 121],
  ro: [287, 300],
  ro_MD: [204, 299],
  sk: [191, 257],
  sl_SI: [100, 110],
  sr_RS_latin: [200, 999],
  sv: [100, 100],
  tr: [723, 370],
  uz_UZ_latin: [227, 207],
  vi: [1190, 26],
  yo_NG: [86, 98],
  zu_ZA: [49, 96],
};
const CITY_CAPACITY = { mega: 6, large: 3, medium: 2, small: 1, town: 1 };
const LATIN_NAME = /^[\p{Script=Latin}\p{M}'’ʻ .-]+$/u;
const LATIN_PLACE = /^[\p{Script=Latin}\p{M}\d'’ʻ .,()/-]+$/u;
const MONTH_DAY = /^(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;
const TEMPLATE_TOKEN = /\{([a-zA-Z0-9]+)\}/g;
const TEMPLATE_TOKENS = new Set(["city", "region", "demonym", "cityAdj", "of", "founded", "founded2"]);
/** Tokens skipped for cities without the matching CitySpec field. */
const OPTIONAL_TOKENS = ["{demonym}", "{cityAdj}"];
const MAX_MATCHDAYS = 46;

const isInt = (value: unknown): value is number => Number.isInteger(value);
const within = (value: number, min: number, max: number) =>
  Number.isFinite(value) && value >= min && value <= max;
const rounds = (teams: number, roundRobins: number) =>
  (teams % 2 === 0 ? teams - 1 : teams) * roundRobins;
const placeKey = (name: string) =>
  name.normalize("NFKD").replace(/\p{M}/gu, "").toLowerCase();

/** League matchdays: base round-robins (within conferences), inter-conference games, plus the longest split group. */
export function tierMatchdays(
  tier: Pick<LeagueTierSpec, "size" | "roundRobins" | "conferences" | "split"> &
    Partial<Pick<LeagueTierSpec, "interConference">>,
): number {
  const conferences = tier.conferences?.length ?? 0;
  const teams = conferences > 1 ? Math.ceil(tier.size / conferences) : tier.size;
  const split = (tier.split?.groups ?? []).map((group) =>
    rounds(group.positions[1] - group.positions[0] + 1, group.roundRobins),
  );
  return rounds(teams, tier.roundRobins ?? 2) + (tier.interConference ?? 0) + Math.max(0, ...split);
}

export interface CatalogSummary {
  nations: number;
  leagueNations: number;
  leagueTiers: number;
  /** First-team clubs incl. hosted cross-border clubs. */
  firstTeamClubs: number;
  bTeams: number;
  hostedClubs: number;
  homeBasedPlayers: number;
  /** First teams at mid squad size + 22 U19 + 22 U17 per club + 22 per B-team + home pools. */
  estimatedPlayers: number;
}

export function summarizeCatalog(catalog: WorldCatalog): CatalogSummary {
  const nations = catalog.files.flatMap((file) => file.nations);
  const summary: CatalogSummary = {
    nations: nations.length,
    leagueNations: 0,
    leagueTiers: 0,
    firstTeamClubs: 0,
    bTeams: 0,
    hostedClubs: 0,
    homeBasedPlayers: 0,
    estimatedPlayers: 0,
  };
  let seniors = 0;
  for (const nation of nations) {
    const tiers = nation.football?.leagues ?? [];
    if (tiers.length) summary.leagueNations++;
    summary.leagueTiers += tiers.length;
    for (const tier of tiers) {
      const firstTeams = tier.size - (tier.bTeams ?? 0);
      const [minimum, maximum] = tier.clubs.squadSize ?? [25, 30];
      summary.firstTeamClubs += firstTeams;
      summary.bTeams += tier.bTeams ?? 0;
      seniors += (firstTeams * (minimum + maximum)) / 2;
    }
    const reserves = nation.football?.reserves;
    if (reserves?.mode === "reserve-league")
      summary.bTeams += reserves.eligibility?.maxTeams ?? 0;
    for (const hosted of nation.hostedAbroad ?? [])
      summary.hostedClubs += hosted.tiers.length;
    summary.homeBasedPlayers +=
      (nation.homePool?.seniors ?? 0) + (nation.homePool?.youth ?? 0);
  }
  summary.estimatedPlayers = Math.round(
    seniors +
      summary.firstTeamClubs * 44 +
      summary.bTeams * 22 +
      summary.homeBasedPlayers,
  );
  return summary;
}

export interface ValidateOptions {
  /** Limit presence checks to these files while authors work in parallel; other files are checked against the assignment only. */
  scope?: readonly CatalogFile[];
  /** Subset worlds: check only these nations (their files form the default scope); other nations may be missing. */
  nations?: readonly string[];
}

export function validateCatalog(
  catalog: WorldCatalog,
  options: ValidateOptions = {},
): CatalogIssue[] {
  const issues: CatalogIssue[] = [];
  const assignment = new Map(
    CATALOG_ASSIGNMENT.map((entry) => [entry.code, entry]),
  );
  const subset = options.nations?.length ? new Set(options.nations) : undefined;
  const scope = new Set<CatalogFile>(
    options.scope?.length
      ? options.scope
      : subset
        ? [...subset].flatMap((code) => assignment.get(code)?.file ?? [])
        : CATALOG_FILE_KEYS,
  );
  for (const code of subset ?? [])
    if (!assignment.has(code))
      issues.push({ level: "error", path: code, message: "not a FIFA member in CATALOG_ASSIGNMENT" });
  const nations = new Map<string, NationSpec>();
  const pools = new Map<string, NamePool>();
  const hostedIn = new Map<string, number[]>();
  const reserveGuests = new Map<string, number>();

  function error(path: string, message: string) {
    issues.push({ level: "error", path, message });
  }
  function warn(path: string, message: string) {
    issues.push({ level: "warning", path, message });
  }
  function inScope(code: string) {
    const entry = assignment.get(code);
    return Boolean(entry && scope.has(entry.file) && (!subset || subset.has(code)));
  }
  function reference(path: string, code: string, what: string, needsLeague = false) {
    const entry = assignment.get(code);
    if (!entry) error(path, `${what} ${code} is not a catalog nation`);
    else if (needsLeague && !entry.tiers)
      error(path, `${what} ${code} has no own league`);
  }
  function weights(
    path: string,
    list: readonly WeightedCode[],
    what: string,
    self: string,
    needsLeague = false,
  ) {
    for (const item of list) {
      if (item.code === self) error(path, `${what} must not reference the nation itself`);
      reference(path, item.code, what, needsLeague);
      if (!(item.weight > 0)) error(path, `${what} ${item.code} needs a positive weight`);
    }
    if (new Set(list.map((item) => item.code)).size !== list.length)
      error(path, `${what} lists a nation twice`);
  }
  function span(path: string, label: string, value: Span, min: number, max: number) {
    if (!within(value.top, min, max) || !within(value.bottom, min, max))
      error(path, `${label} must be within ${min}-${max}`);
    else if (value.top < value.bottom)
      error(path, `${label}.top must be ≥ ${label}.bottom`);
  }
  function legsValid(...legs: (number | undefined)[]) {
    return legs.every((value) => value === undefined || value === 1 || value === 2);
  }

  function checkPool(data: CatalogFileData, pool: NamePool, path: string) {
    if (!new RegExp(`^${data.file}/[a-z0-9-]+$`).test(pool.id))
      error(path, `pool id must look like "${data.file}/<name>"`);
    if (pools.has(pool.id)) error(path, `duplicate pool id ${pool.id}`);
    pools.set(pool.id, pool);
    if (!pool.given?.length && !pool.family?.length)
      error(path, "pool needs given or family names");
    for (const side of ["given", "family"] as const) {
      const names = pool[side] ?? [];
      const invalid = names.filter((name) => !LATIN_NAME.test(name) || name.length > 40);
      if (invalid.length)
        error(path, `${side} names must be Latin script, ≤40 chars: ${invalid.slice(0, 5).join(", ")}`);
      if (new Set(names).size !== names.length)
        warn(path, `${side} names contain duplicates`);
    }
  }

  function checkNames(nation: NationSpec, leagueNation: boolean, path: string) {
    const config = nation.names;
    const counts = { given: 0, family: 0 };
    let unknown = false;
    const checkSources = (list: NameConfig["given"], side: "given" | "family") => {
      let count = 0;
      for (const { source, weight } of list) {
        if (!(weight > 0)) error(path, `${source} needs a positive weight`);
        if (source.startsWith("faker:")) {
          const size = FAKER_NAME_COUNTS[source.slice(6) as FakerNameLocale];
          if (size) count += side === "given" ? size[0] : size[1];
          else error(path, `${source} is not a Latin-script faker locale`);
          if (side === "family" && source === "faker:fr_BE")
            warn(path, "faker fr_BE family names are mostly English placeholders (Abbott, Altenwerth); use faker:fr");
          continue;
        }
        const id = source.slice(5);
        const pool = pools.get(id);
        if (!source.startsWith("pool:")) error(path, `invalid source ${source}`);
        else if (!pool) {
          const owner = id.split("/")[0] as CatalogFile;
          if (!CATALOG_FILE_KEYS.includes(owner) || scope.has(owner))
            error(path, `unknown pool ${id}`);
          else unknown = true;
        } else if (!pool[side]?.length) error(path, `pool ${id} has no ${side} names`);
        else count += new Set(pool[side]).size;
      }
      return count;
    };
    for (const side of ["given", "family"] as const) {
      if (!config[side].length) error(path, `${side} needs at least one source`);
      counts[side] = checkSources(config[side], side);
    }
    const cityRegions = new Set(nation.cities.major.map((city) => city.region));
    for (const rule of config.regional ?? []) {
      if (!rule.regions.length || (!rule.given?.length && !rule.family?.length))
        error(path, "regional name rules need regions and a given or family list");
      for (const region of rule.regions)
        if (!cityRegions.has(region)) error(path, `regional names: no city has region "${region}"`);
      for (const side of ["given", "family"] as const) if (rule[side]) checkSources(rule[side], side);
    }
    const [given, family] = leagueNation ? [60, 100] : [30, 40];
    if (!unknown && (counts.given < given || counts.family < family))
      error(path, `needs ≥${given} given and ≥${family} family names, found ${counts.given}/${counts.family}`);
    if (config.order && !["given-family", "family-given"].includes(config.order))
      error(path, "invalid order");
    for (const [label, rate] of [
      ["secondFamilyRate", config.secondFamilyRate],
      ["mononymRate", config.mononymRate],
    ] as const)
      if (rate !== undefined && !within(rate, 0, 0.5))
        error(path, `${label} must be 0-0.5`);
    if (config.mixRate !== undefined && !within(config.mixRate, 0, 1))
      error(path, "mixRate must be 0-1");
  }

  function checkNationality(nation: NationSpec, path: string) {
    const profile = nation.nationality;
    if (!within(profile.multipleRate, 0, 0.7)) error(path, "multipleRate must be 0-0.7");
    if (!within(profile.tripleRate, 0, profile.multipleRate))
      error(path, "tripleRate must be between 0 and multipleRate");
    if (!within(profile.bornAbroadRate, 0, 0.9)) error(path, "bornAbroadRate must be 0-0.9");
    if (!within(profile.diasporaPull, 0, 1)) error(path, "diasporaPull must be 0-1");
    if (profile.multipleRate > 0 && !profile.links.length)
      error(path, "multiple family roots need heritage links");
    weights(path, profile.links, "heritage link", nation.code);
    const rule = profile.citizenship;
    if (!["allowed", "restricted", "partners"].includes(rule.dual))
      error(path, "invalid citizenship.dual");
    if (rule.dual === "partners" && !rule.partners?.length)
      error(path, "citizenship partners are required");
    if (rule.dual !== "partners" && rule.partners?.length)
      error(path, "citizenship partners only apply to dual \"partners\"");
    if (UK_ADMIN1[nation.code] && rule.group !== "GB")
      error(path, "UK associations share citizenship group GB");
    if (rule.dual === "allowed" && profile.multipleRate < 0.15)
      warn(path, "the directive expects roughly 20-35% dual nationals where dual citizenship is allowed");
  }

  function checkCities(nation: NationSpec, clubs: number, topTier: number, path: string) {
    const catalogCities = nation.cities.major;
    if (!catalogCities.length) error(path, "needs at least one city");
    // Microstates (GI, SM, AD) legitimately cluster clubs in few places via maxClubs and districts.
    if (clubs && catalogCities.length < Math.min(8, topTier))
      warn(path, `fewer than ${Math.min(8, topTier)} major cities; clubs will cluster`);
    const seen = new Set<string>();
    let capacity = 0;
    for (const city of catalogCities) {
      const key = placeKey(city.name);
      if (!LATIN_PLACE.test(city.name)) error(path, `city ${city.name} must be Latin script`);
      if (seen.has(key)) error(path, `duplicate city ${city.name}`);
      seen.add(key);
      if (!city.region.trim()) error(path, `${city.name} needs a region`);
      if (!(city.size in CITY_CAPACITY)) error(path, `${city.name} has an invalid size`);
      if (city.maxClubs !== undefined && (!isInt(city.maxClubs) || city.maxClubs < 1))
        error(path, `${city.name}.maxClubs must be ≥1`);
      const districts = city.districts ?? [];
      if (new Set(districts).size !== districts.length || districts.some((name) => !LATIN_PLACE.test(name)))
        error(path, `${city.name} districts must be unique Latin-script names`);
      if (city.admin1 !== undefined && !/^[A-Z0-9]{1,8}$/.test(city.admin1))
        error(path, `${city.name}.admin1 must be a cities.json admin1 code`);
      if ((city.lat === undefined) !== (city.lng === undefined) ||
        (city.lat !== undefined && !(Math.abs(city.lat) <= 90 && Math.abs(city.lng!) <= 180)))
        error(path, `${city.name} needs both lat (±90) and lng (±180) or neither`);
      if (city.demonym !== undefined && !(LATIN_PLACE.test(city.demonym) && city.demonym.length <= 30))
        error(path, `${city.name}.demonym must be a Latin-script word of up to 30 characters`);
      if (city.adjective !== undefined && !(LATIN_PLACE.test(city.adjective) && city.adjective.length <= 30))
        error(path, `${city.name}.adjective must be a Latin-script word of up to 30 characters`);
      if (city.preposition !== undefined && !/^\p{Ll}{1,6}$/u.test(city.preposition))
        error(path, `${city.name}.preposition must be one lowercase word ("do", "da")`);
      capacity += city.maxClubs ?? CITY_CAPACITY[city.size] ?? 1;
    }
    const extra = nation.cities.extra;
    const admin1 = UK_ADMIN1[nation.code];
    if (admin1 && extra && (extra.admin1?.length !== 1 || extra.admin1[0] !== admin1))
      error(path, `extra.admin1 must be ["${admin1}"]`);
    if (extra?.max !== undefined && (!isInt(extra.max) || extra.max < 1))
      error(path, "extra.max must be ≥1");
    if (!extra && capacity < clubs)
      error(path, `cities host ${capacity} clubs but the nation has ${clubs}; add cities or an extra rule`);
  }

  function checkTier(tier: LeagueTierSpec, hosted: number, path: string) {
    if (!tier.name.trim() || !tier.shortName.trim()) error(path, "name and shortName are required");
    if (!["professional", "semi-professional", "amateur"].includes(tier.status))
      error(path, "invalid status");
    if (!within(tier.reputation, 1, 99)) error(path, "reputation must be 1-99");
    if (!isInt(tier.size) || tier.size < 6 || tier.size > 48) {
      error(path, "size must be 6-48");
      return;
    }
    const conferences = tier.conferences?.length ?? 0;
    if (conferences === 1 || conferences > 4) error(path, "conferences needs 2-4 names");
    if (tier.size > 24 && conferences < 2) error(path, "tiers above 24 teams need conferences");
    if (conferences > 1 && tier.size % conferences)
      error(path, "conferences must be equal in size");
    else if (conferences > 1 && tier.size / conferences > 24)
      error(path, "conferences hold at most 24 teams");
    if (tier.roundRobins !== undefined && ![1, 2, 3, 4].includes(tier.roundRobins))
      error(path, "roundRobins must be 1, 2, 3 or 4");
    if (tier.roundRobins === 1 && !tier.split) error(path, "a single round-robin needs a split");
    if (tier.interConference !== undefined) {
      const others = conferences > 1 ? tier.size - tier.size / conferences : 0;
      if (!isInt(tier.interConference) || tier.interConference < 1 || tier.interConference > others)
        error(path, `interConference needs conferences and 1..${others} games`);
    }
    if (tier.split) {
      let next = 1;
      for (const group of tier.split.groups) {
        const [first, last] = group.positions;
        if (first !== next || !isInt(last) || last <= first)
          error(path, `split group ${group.name} must continue at position ${next} with ≥2 teams`);
        if (![1, 2].includes(group.roundRobins) || !["full", "halved"].includes(group.points))
          error(path, `split group ${group.name} needs roundRobins 1-2 and points full/halved`);
        next = last + 1;
      }
      if (next !== tier.size + 1) error(path, "split groups must cover every position");
    }
    const matchdays = tierMatchdays(tier);
    if (matchdays > MAX_MATCHDAYS)
      error(path, `${matchdays} matchdays exceed the ${MAX_MATCHDAYS} season dates`);
    if (tier.championship) {
      const { positions, perConference, legs, finalLegs } = tier.championship;
      const limit = perConference && conferences > 1 ? tier.size / conferences : tier.size;
      // [1, 1] per conference is a final between the conference winners (Primera Nacional).
      const single = positions[0] === positions[1] && perConference && conferences > 1;
      if (!isInt(positions[0]) || !isInt(positions[1]) || positions[0] < 1 || positions[1] > limit || (positions[0] >= positions[1] && !single))
        error(path, `championship positions must lie within 1..${limit}`);
      if (!legsValid(legs, finalLegs)) error(path, "championship legs must be 1 or 2");
      const { format, roundRobins } = tier.championship;
      if (format !== undefined && !["knockout", "round-robin"].includes(format))
        error(path, "championship format must be knockout or round-robin");
      if (roundRobins !== undefined && (format !== "round-robin" || ![1, 2].includes(roundRobins)))
        error(path, "championship roundRobins (1-2) needs format round-robin");
    }
    const bTeams = tier.bTeams ?? 0;
    if (!isInt(bTeams) || bTeams < 0) error(path, "bTeams must be a non-negative integer");
    if (bTeams + hosted > tier.size - 2)
      error(path, "B-teams and hosted clubs must leave at least two own clubs");
    const model = tier.clubs;
    const clubs = `${path}.clubs`;
    span(clubs, "reputation", model.reputation, 1, 99);
    span(clubs, "facilities", model.facilities, 1, 99);
    span(clubs, "academy", model.academy, 1, 99);
    span(clubs, "capacity", model.capacity, 300, 120_000);
    span(clubs, "wageBill", model.wageBill, 10_000, 1_000_000_000);
    span(clubs, "transferBudget", model.transferBudget, 0, 1_000_000_000);
    if (!within(model.foreignShare, 0, 0.9)) error(clubs, "foreignShare must be 0-0.9");
    if (model.giants) {
      if (!isInt(model.giants.count) || model.giants.count < 1 || model.giants.count > tier.size)
        error(clubs, "giants.count must be 1..size");
      span(clubs, "giants", model.giants, 1, 99);
      if (model.giants.bottom < model.reputation.top)
        warn(clubs, "giants should sit above reputation.top");
    }
    if (model.squadSize) {
      const [minimum, maximum] = model.squadSize;
      if (!isInt(minimum) || !isInt(maximum) || minimum < 25 || maximum < minimum || maximum > 40)
        error(clubs, "squadSize must be [min ≥ 25, max ≤ 40]");
    }
  }

  function checkMovement(tiers: LeagueTierSpec[], boundaries: TierBoundarySpec[], path: string) {
    const seen = new Set<number>();
    for (const [index, boundary] of boundaries.entries()) {
      const at = `${path}[${index}]`;
      const upper = tiers.find((tier) => tier.tier === boundary.upper);
      const lower = tiers.find((tier) => tier.tier === boundary.upper + 1);
      if (!upper || !lower) {
        error(at, `no tier pair ${boundary.upper}/${boundary.upper + 1}`);
        continue;
      }
      if (seen.has(boundary.upper)) error(at, "duplicate boundary");
      seen.add(boundary.upper);
      if (!isInt(boundary.promoted) || boundary.promoted < 0 || !isInt(boundary.relegated) || boundary.relegated < 0) {
        error(at, "promoted and relegated must be non-negative integers");
        continue;
      }
      const playoffs = boundary.playoffs ?? [];
      if (upper.closed || lower.closed) {
        if (boundary.promoted || boundary.relegated || playoffs.length)
          error(at, "closed tiers exchange no clubs");
        continue;
      }
      const groupsOf = (tier: LeagueTierSpec) =>
        boundary.perConference && (tier.conferences?.length ?? 0) > 1 ? tier.conferences!.length : 1;
      const upperGroups = groupsOf(upper);
      const lowerGroups = groupsOf(lower);
      if (boundary.perConference && upperGroups === 1 && lowerGroups === 1)
        error(at, "perConference needs a tier with conferences");
      if (boundary.championPromoted && (!lower.championship || boundary.promoted < 1 || lowerGroups > 1))
        error(at, "championPromoted needs a lower-tier championship, promoted ≥ 1 and no per-conference split below");
      const upperSize = upper.size / upperGroups;
      const lowerSize = lower.size / lowerGroups;
      const each = (total: number, groups: number, what: string) => {
        if (total % groups) error(at, `${what} (${total}) must split evenly across ${groups} conferences`);
        return Math.floor(total / groups);
      };
      const relegatedEach = each(boundary.relegated, upperGroups, "relegated");
      const promotedEach = each(boundary.promoted, lowerGroups, "promoted");
      if (relegatedEach > upperSize - 2 || promotedEach > lowerSize - 2)
        error(at, "too many automatic moves");
      const upperTaken = new Set<number>();
      const lowerTaken = new Set<number>();
      for (let rank = upperSize - relegatedEach + 1; rank <= upperSize; rank++)
        upperTaken.add(rank);
      for (let rank = 1; rank <= promotedEach; rank++) lowerTaken.add(rank);
      const claim = (taken: Set<number>, ranks: number[], size: number, where: string) => {
        for (const rank of ranks) {
          if (!isInt(rank) || rank < 1 || rank > size)
            error(where, `position ${rank} is outside 1..${size}`);
          else if (taken.has(rank))
            error(where, `position ${rank} is already promoted, relegated or in another play-off`);
          taken.add(rank);
        }
      };
      let up = boundary.promoted;
      let down = boundary.relegated;
      for (const [playoffIndex, playoff] of playoffs.entries()) {
        const where = `${at}.playoffs[${playoffIndex}]`;
        if (!legsValid(playoff.legs, "finalLegs" in playoff ? playoff.finalLegs : undefined))
          error(where, "legs must be 1 or 2");
        if (playoff.type === "cross-tier") {
          if (boundary.perConference) error(where, "cross-tier play-offs are not supported per conference");
          if (!playoff.upperPositions.length || playoff.lowerPositions.length < playoff.upperPositions.length)
            error(where, "each upper position needs at least one lower-tier challenger");
          claim(upperTaken, playoff.upperPositions, upperSize, where);
          claim(lowerTaken, playoff.lowerPositions, lowerSize, where);
          continue;
        }
        const [first, last] = playoff.positions;
        if (!isInt(first) || !isInt(last) || first > last) {
          error(where, "positions must be [first, last]");
          continue;
        }
        const ranks = Array.from({ length: last - first + 1 }, (_, offset) => first + offset);
        const groups = playoff.type === "promotion" ? lowerGroups : upperGroups;
        const places = isInt(playoff.places) ? each(playoff.places, groups, "play-off places") : 0;
        if (places < 1 || places >= ranks.length)
          error(where, "places must be between 1 and the number of play-off teams minus one");
        if (playoff.type === "promotion") {
          claim(lowerTaken, ranks, lowerSize, where);
          up += playoff.places;
        } else {
          claim(upperTaken, ranks, upperSize, where);
          down += playoff.places;
        }
      }
      if (up !== down) error(at, `clubs going up (${up}) must equal clubs going down (${down})`);
    }
    for (let tier = 1; tier < tiers.length; tier++)
      if (!seen.has(tier)) error(path, `missing boundary between tiers ${tier} and ${tier + 1}`);
  }

  function checkCups(football: DomesticFootballSpec, path: string) {
    const cups = football.cups;
    const count = (kind: CupSpec["kind"]) => cups.filter((cup) => cup.kind === kind).length;
    // Zero is allowed: Mexico, Peru, Venezuela and Bolivia have no national cup in 2025/26.
    if (count("national") > 1) error(path, "at most one national cup");
    if (count("league") > 1 || count("super") > 1)
      error(path, "at most one league cup and one super cup");
    if (new Set(cups.map((cup) => cup.name)).size !== cups.length)
      error(path, "cup names must be unique");
    for (const [index, cup] of cups.entries()) {
      const at = `${path}[${index}]`;
      if (!cup.name.trim()) error(at, "name is required");
      for (const tier of cup.tiers ?? [])
        if (!isInt(tier) || tier < 1 || tier > football.leagues.length)
          error(at, `tier ${tier} is not an own tier`);
      if (cup.maxEntrants !== undefined && (!isInt(cup.maxEntrants) || cup.maxEntrants < 2))
        error(at, "maxEntrants must be ≥2");
      if (cup.rounds !== undefined && (!isInt(cup.rounds) || cup.rounds < 1 || cup.rounds > 10))
        error(at, "rounds must be 1-10");
      if (!legsValid(cup.legs, cup.finalLegs)) error(at, "legs must be 1 or 2");
      if (cup.start !== undefined && !MONTH_DAY.test(cup.start)) error(at, "start must be MM-DD");
      if (cup.kind === "super") {
        const participants = cup.participants ?? [];
        if (![2, 4].includes(participants.length) || new Set(participants).size !== participants.length)
          error(at, "super cups need 2 or 4 distinct participants");
        if (participants.includes("league-cup-winner") && !count("league"))
          error(at, "league-cup-winner needs a league cup");
      } else if (cup.participants) error(at, "participants only apply to super cups");
    }
  }

  function checkYouth(nation: NationSpec, football: DomesticFootballSpec, path: string) {
    const own = football.leagues.length;
    for (const age of ["U19", "U17"] as const) {
      const spec = football.youth[age];
      const at = `${path}.${age}`;
      if (spec.cup && !spec.cup.name.trim()) error(at, "cup name is required");
      if (!own) {
        if (spec.divisions.length) error(at, "nations without own tiers use the host's youth leagues");
        if ((nation.hostedAbroad ?? []).some((hosted) => hosted.youth === "home"))
          error(at, "hosted clubs with youth \"home\" need own youth divisions");
        continue;
      }
      if (!spec.divisions.length) error(at, "needs at least one division");
      const covered = new Map<number, number>();
      for (const [index, division] of spec.divisions.entries()) {
        const where = `${at}.divisions[${index}]`;
        if (!division.name.trim()) error(where, "name is required");
        const [first, last] = division.parentTiers;
        if (!isInt(first) || !isInt(last) || first < 1 || last > own || first > last) {
          error(where, `parentTiers must lie within 1..${own}`);
          continue;
        }
        for (let tier = first; tier <= last; tier++)
          covered.set(tier, (covered.get(tier) ?? 0) + 1);
        if (division.groupSize !== undefined && (!isInt(division.groupSize) || division.groupSize < 8 || division.groupSize > 16))
          error(where, "groupSize must be 8-16");
        const names = division.groupNames ?? [];
        if (names.some((name) => !name.trim()) || new Set(names).size !== names.length)
          error(where, "group names must be unique and non-empty");
      }
      for (let tier = 1; tier <= own; tier++)
        if (covered.get(tier) !== 1)
          error(at, `tier ${tier} academies must belong to exactly one division`);
    }
  }

  function checkReserves(nation: NationSpec, football: DomesticFootballSpec, path: string) {
    const policy = football.reserves;
    const tiers = football.leagues;
    const placed = tiers.reduce((total, tier) => total + (tier.bTeams ?? 0), 0);
    if (policy.mode === "none") {
      if (placed) error(path, "mode none allows no B-teams");
      if (policy.eligibility || policy.pyramid || policy.reserveLeague || policy.nameTemplate)
        error(path, "mode none must not define B-team settings");
      return;
    }
    if (!policy.nameTemplate?.includes("{club}")) error(path, "nameTemplate must contain {club}");
    const eligibility = policy.eligibility;
    if (!eligibility) error(path, "B-teams need eligibility");
    else {
      if (!eligibility.parentTiers.length || eligibility.parentTiers.some((tier) => !isInt(tier) || tier < 1 || tier > tiers.length))
        error(path, "eligibility.parentTiers must be own tiers");
      if (!within(eligibility.minReputation, 1, 99))
        error(path, "eligibility.minReputation must be 1-99");
      if (!isInt(eligibility.maxTeams) || eligibility.maxTeams < 1 || eligibility.maxTeams > 30)
        error(path, "eligibility.maxTeams must be 1-30");
      const parents = tiers
        .filter((tier) => eligibility.parentTiers.includes(tier.tier))
        .reduce((total, tier) => total + tier.size - (tier.bTeams ?? 0), 0);
      if (eligibility.maxTeams > parents) error(path, "more B-teams than eligible parent clubs");
    }
    const [minimum, maximum] = policy.squad ?? [0, 0];
    if (!isInt(minimum) || !isInt(maximum) || minimum < 20 || maximum < minimum || maximum > 32)
      error(path, "squad must be [min ≥ 20, max ≤ 32]");
    if (policy.ageRule && (!isInt(policy.ageRule.maxAge) || !within(policy.ageRule.maxAge, 19, 25) || !isInt(policy.ageRule.overage) || !within(policy.ageRule.overage, 0, 8)))
      error(path, "ageRule needs maxAge 19-25 and overage 0-8");
    if (policy.mode === "pyramid") {
      const pyramid = policy.pyramid;
      if (policy.reserveLeague) error(path, "pyramid mode must not define a reserve league");
      if (!pyramid) {
        error(path, "pyramid mode needs pyramid settings");
        return;
      }
      if (!isInt(pyramid.highestTier) || pyramid.highestTier < 2 || pyramid.highestTier > tiers.length)
        error(path, "pyramid.highestTier must be 2..n (never the top division)");
      if (!isInt(pyramid.minGapBelowParent) || pyramid.minGapBelowParent < 1)
        error(path, "pyramid.minGapBelowParent must be ≥1");
      if (pyramid.maxPerTier !== undefined && (!isInt(pyramid.maxPerTier) || pyramid.maxPerTier < 1))
        error(path, "pyramid.maxPerTier must be ≥1");
      if (!placed) error(path, "pyramid mode needs B-teams placed in tiers (bTeams)");
      if (eligibility && placed > eligibility.maxTeams)
        error(path, "placed B-teams exceed eligibility.maxTeams");
      const highestParent = Math.min(...(eligibility?.parentTiers ?? [1]));
      for (const tier of tiers) {
        const count = tier.bTeams ?? 0;
        if (!count) continue;
        if (tier.tier < pyramid.highestTier || tier.tier < highestParent + pyramid.minGapBelowParent)
          error(path, `tier ${tier.tier} is too high for B-teams`);
        if (pyramid.maxPerTier !== undefined && count > pyramid.maxPerTier)
          error(path, `tier ${tier.tier} exceeds maxPerTier`);
      }
      return;
    }
    if (placed) error(path, "reserve-league mode places no B-teams in the pyramid");
    const league = policy.reserveLeague;
    if (!league) {
      error(path, "reserve-league mode needs reserveLeague");
      return;
    }
    if (league.host) {
      if (league.host === nation.code) error(path, "reserveLeague.host must be another nation");
      reference(path, league.host, "reserve league host", true);
      const host = nations.get(league.host)?.football?.reserves;
      if (host && (host.mode !== "reserve-league" || host.reserveLeague?.host || host.reserveLeague?.name !== league.name))
        error(path, `host ${league.host} must run the reserve league "${league.name}"`);
      return;
    }
    if (!league.name.trim() || !league.shortName.trim())
      error(path, "reserve league needs name and shortName");
    if (!within(league.reputation, 1, 99)) error(path, "reserve league reputation must be 1-99");
    const conferences = league.conferences?.length ?? 0;
    if (conferences === 1 || conferences > 4) error(path, "reserve league conferences needs 2-4 names");
    const teams = (eligibility?.maxTeams ?? 0) + (reserveGuests.get(nation.code) ?? 0);
    if (teams > 24 && conferences < 2) error(path, "reserve leagues above 24 teams need conferences");
    if (tierMatchdays({ size: teams, roundRobins: league.roundRobins, conferences: league.conferences }) > MAX_MATCHDAYS)
      error(path, `reserve league exceeds ${MAX_MATCHDAYS} matchdays`);
  }

  function checkTemplate(template: ClubNameTemplate, own: number, path: string) {
    const tokens = [...template.pattern.matchAll(TEMPLATE_TOKEN)].map((match) => match[1]);
    if (!["city", "region", "demonym", "cityAdj"].some((token) => tokens.includes(token)))
      error(path, `template "${template.pattern}" needs {city}, {region}, {demonym} or {cityAdj}`);
    const unknown = tokens.filter((token) => !TEMPLATE_TOKENS.has(token));
    if (unknown.length)
      error(path, `template "${template.pattern}" uses unknown tokens ${unknown.join(", ")}`);
    if (!(template.weight > 0)) error(path, `template "${template.pattern}" needs a positive weight`);
    for (const tier of template.tiers ?? [])
      if (!isInt(tier) || tier < 1 || tier > own)
        error(path, `template "${template.pattern}" names a tier outside 1..${own}`);
  }

  function checkNaming(naming: ClubNamingSpec, own: number, path: string) {
    if (naming.templates.length < 3) error(path, "needs at least 3 templates");
    for (const name of naming.avoid ?? [])
      if (typeof name !== "string" || !name.trim() || name.length > 60)
        error(path, `avoid entry "${name}" must be a club name of 1-60 characters`);
    for (const template of naming.templates) checkTemplate(template, own, path);
    const plain = (templates: ClubNameTemplate[]) =>
      templates.some((template) => !OPTIONAL_TOKENS.some((token) => template.pattern.includes(token)));
    if (!plain(naming.templates)) error(path, "needs a template without {demonym} and {cityAdj} for cities without them");
    for (const rule of naming.regional ?? []) {
      if (!rule.regions.length || !rule.templates.length)
        error(path, "regional rules need regions and templates");
      else if (!plain(rule.templates)) error(path, "regional rules need a template without {demonym} and {cityAdj}");
      for (const template of rule.templates) checkTemplate(template, own, path);
    }
    for (const [label, range] of [
      ["top", naming.founded.top],
      ["bottom", naming.founded.bottom],
    ] as const) {
      const [first, last] = range;
      if (!isInt(first) || !isInt(last) || first < 1850 || last > 2025 || first > last)
        error(path, `founded.${label} must be [earliest, latest] within 1850-2025`);
    }
    if (naming.shortName && !["city", "initials"].includes(naming.shortName))
      error(path, "invalid shortName style");
    for (const color of naming.colors ?? [])
      if (!/^#[0-9a-fA-F]{6}$/.test(color)) error(path, `invalid colour ${color}`);
  }

  function checkFootball(nation: NationSpec, path: string) {
    const football = nation.football!;
    const tiers = football.leagues;
    tiers.forEach((tier, index) => {
      const at = `${path}.leagues[${index}]`;
      if (tier.tier !== index + 1) error(at, "tiers must be numbered 1..n in order");
      const hosted = (hostedIn.get(nation.code) ?? []).filter((entry) => entry === tier.tier).length;
      checkTier(tier, hosted, at);
      if (index && tier.reputation > tiers[index - 1].reputation)
        warn(at, "reputation should not exceed the tier above");
    });
    if (new Set(tiers.map((tier) => tier.name)).size !== tiers.length)
      error(`${path}.leagues`, "tier names must be unique");
    checkMovement(tiers, football.movement, `${path}.movement`);
    checkCups(football, `${path}.cups`);
    checkYouth(nation, football, `${path}.youth`);
    checkReserves(nation, football, `${path}.reserves`);
    checkNaming(football.clubNaming, tiers.length, `${path}.clubNaming`);
    if (tiers.length && !football.importSources.length)
      error(`${path}.importSources`, "league nations need import sources");
    weights(`${path}.importSources`, football.importSources, "import source", nation.code);
    const seed = football.coefficients?.association;
    if (nation.confederation !== "OFC" && (!seed || seed.length !== 5 || seed.some((value) => !within(value, 0, 40))))
      error(`${path}.coefficients`, "needs 5 association coefficient seasons (2021-2025), each 0-40");
  }

  function checkCrossBorder(nation: NationSpec, spec: CrossBorderSpec, path: string) {
    const host = assignment.get(spec.host);
    if (spec.host === nation.code) error(path, "host must be another nation");
    if (!host) {
      error(path, `host ${spec.host} is not a catalog nation`);
      return;
    }
    if (!host.tiers) error(path, `host ${spec.host} has no own league`);
    if (!spec.tiers.length) error(path, "needs at least one club");
    for (const tier of spec.tiers)
      if (!isInt(tier) || tier < 1 || tier > host.tiers)
        error(path, `host tier ${tier} does not exist`);
    if (spec.cities.length !== spec.tiers.length) error(path, "one city per hosted club");
    for (const city of spec.cities)
      if (!nation.cities.major.some((entry) => entry.name === city))
        error(path, `${city} must be one of this nation's major cities`);
    if (!["host", "home", "none"].includes(spec.cups) || !["host", "home", "none"].includes(spec.continental) || !["host", "home"].includes(spec.youth) || !["host", "home"].includes(spec.registration))
      error(path, "invalid cups, continental, youth or registration rule");
    if (spec.continental === "home" && !nation.football?.cups.some((cup) => cup.kind === "national" && cup.continental))
      error(path, "continental \"home\" needs a national cup with a continental slot");
  }

  function checkNation(nation: NationSpec, expected: CatalogAssignment, path: string) {
    if (!/^[A-Z]{2,3}$/.test(nation.code)) error(path, "code must be 2-3 uppercase letters");
    if (!/^[A-Z]{2}$/.test(nation.iso2)) error(path, "iso2 must be ISO 3166-1 alpha-2");
    if (UK_ADMIN1[nation.code] && nation.iso2 !== "GB") error(path, "UK associations use iso2 GB");
    if (!nation.name.trim() || !nation.capital.trim()) error(path, "name and capital are required");
    if (nation.confederation !== expected.confederation)
      error(path, `confederation must be ${expected.confederation}`);
    if (!["EU", "AS", "AF", "NA", "SA", "OC"].includes(nation.continent)) error(path, "invalid continent");
    if (!within(nation.latitude, -60, 72)) error(path, "latitude must be -60..72");
    if (!nation.languages.length) error(path, "needs at least one language");
    for (const language of nation.languages)
      if (!/^[a-z]{2,3}$/.test(language.code) || !(language.weight > 0))
        error(path, `invalid language ${language.code}`);
    if (!within(nation.reputation.national, 1, 99) || !within(nation.reputation.league, 1, 99))
      error(path, "reputations must be 1-99");
    if (nation.euEea !== EU_EEA.has(nation.code))
      error(path, `euEea must be ${EU_EEA.has(nation.code)}`);
    if (nation.code === "RU") {
      if (!nation.suspended?.club || !nation.suspended.national)
        error(path, "Russia is suspended from UEFA/FIFA club and national competitions (decision 8)");
    } else if (nation.suspended) warn(path, "only Russia is expected to be suspended");
    if (nation.physique && (!within(nation.physique.height, 165, 195) || (nation.physique.heightSd !== undefined && !within(nation.physique.heightSd, 3, 10))))
      error(path, "physique height must be 165-195 cm and sd 3-10");
    checkNames(nation, expected.tiers > 0, `${path}.names`);
    checkNationality(nation, `${path}.nationality`);

    const tiers = nation.football?.leagues ?? [];
    const abroad = nation.hostedAbroad ?? [];
    if (tiers.length !== expected.tiers)
      error(path, `needs ${expected.tiers} own league tiers (directive), found ${tiers.length}`);
    const clubNation = expected.tiers > 0 || abroad.length > 0;
    if (clubNation && !nation.football) error(path, "nations with clubs need a football spec");
    if (!clubNation && nation.football) error(path, "nations without clubs must not define football");
    if (!expected.tiers) {
      const pool = nation.homePool;
      if (!pool) error(path, "nations without an own league need a homePool");
      else if (!isInt(pool.seniors) || pool.seniors < 25 || !isInt(pool.youth) || pool.youth < 36)
        error(`${path}.homePool`, "needs ≥25 seniors and ≥36 youth for four national teams");
      if ((pool?.seniors ?? 0) + (nation.abroad?.seniors ?? 0) < 40)
        error(path, "homePool and abroad seniors must reach 40");
    } else if (nation.homePool) error(path, "homePool is only for nations without an own league");
    if (nation.abroad) {
      const { seniors, youth, destinations } = nation.abroad;
      if (!isInt(seniors) || seniors < 0 || !isInt(youth) || youth < 0)
        error(`${path}.abroad`, "counts must be non-negative integers");
      if (seniors + youth > 0 && !destinations.length) error(`${path}.abroad`, "needs destinations");
      weights(`${path}.abroad`, destinations, "destination", nation.code, true);
    }
    const hostedHere = hostedIn.get(nation.code)?.length ?? 0;
    const ownClubs = tiers.reduce((total, tier) => total + tier.size - (tier.bTeams ?? 0), 0);
    const hostedAway = abroad.reduce((total, spec) => total + spec.tiers.length, 0);
    checkCities(nation, ownClubs - hostedHere + hostedAway, tiers[0]?.size ?? hostedAway, `${path}.cities`);
    if (nation.football) checkFootball(nation, `${path}.football`);
    abroad.forEach((spec, index) => checkCrossBorder(nation, spec, `${path}.hostedAbroad[${index}]`));
  }

  function checkEntries(entries: AccessEntry[], path: string) {
    if (!entries.length) error(path, "needs entries");
    for (const entry of entries)
      if (entry.source === "league" && (!isInt(entry.position) || entry.position < 1))
        error(path, "league entries need a position");
  }

  const seenFiles = new Set<string>();
  for (const data of catalog.files) {
    if (!CATALOG_FILE_KEYS.includes(data.file)) {
      error(data.file, "unknown catalog file");
      continue;
    }
    if (seenFiles.has(data.file)) error(data.file, "duplicate catalog file");
    seenFiles.add(data.file);
    data.namePools.forEach((pool, index) => checkPool(data, pool, `${data.file}/namePools[${index}]`));
    for (const nation of data.nations) {
      const path = `${data.file}/${nation.code}`;
      const expected = assignment.get(nation.code);
      if (!expected) error(path, "not a FIFA member in CATALOG_ASSIGNMENT");
      else if (expected.file !== data.file) error(path, `belongs in ${expected.file}.ts`);
      else if (nations.has(nation.code)) error(path, "duplicate nation");
      else nations.set(nation.code, nation);
    }
  }
  for (const entry of CATALOG_ASSIGNMENT)
    if (inScope(entry.code) && !nations.has(entry.code))
      error(`${entry.file}/${entry.code}`, "missing nation");
  for (const nation of nations.values()) {
    for (const spec of nation.hostedAbroad ?? [])
      hostedIn.set(spec.host, [...(hostedIn.get(spec.host) ?? []), ...spec.tiers]);
    const reserves = nation.football?.reserves;
    if (reserves?.mode === "reserve-league" && reserves.reserveLeague?.host)
      reserveGuests.set(
        reserves.reserveLeague.host,
        (reserveGuests.get(reserves.reserveLeague.host) ?? 0) + (reserves.eligibility?.maxTeams ?? 0),
      );
  }
  for (const nation of nations.values())
    if (inScope(nation.code)) {
      const expected = assignment.get(nation.code)!;
      checkNation(nation, expected, `${expected.file}/${nation.code}`);
    }
  for (const [home, host] of REQUIRED_CROSS_BORDER) {
    const nation = nations.get(home);
    if (nation && inScope(home) && !nation.hostedAbroad?.some((spec) => spec.host === host))
      error(`${assignment.get(home)!.file}/${home}`, `decision 6 requires clubs hosted in ${host}`);
  }

  const continental = catalog.continental;
  if (continental.coefficientConfederations.includes("OFC"))
    error("continental", "OFC records no coefficients (no OFC club competition)");
  const ids = new Set<string>();
  continental.competitions.forEach((competition, index) => {
    const at = `continental.competitions[${index}]`;
    if (!/^[a-z0-9-]+$/.test(competition.id) || ids.has(competition.id))
      error(at, "ids must be unique kebab-case");
    ids.add(competition.id);
    if (competition.confederation === "OFC") error(at, "no OFC club competition (decision 17)");
    if (!competition.name.trim() || !competition.shortName.trim())
      error(at, "name and shortName are required");
    if (!isInt(competition.teams) || competition.teams < 2) error(at, "teams must be ≥2");
    if (!isInt(competition.advance) || competition.advance < 0 || competition.advance > competition.teams)
      error(at, "advance must be 0..teams");
    if (!legsValid(competition.legs, competition.finalLegs)) error(at, "legs must be 1 or 2");
    if (!MONTH_DAY.test(competition.start)) error(at, "start must be MM-DD");
    for (const zone of competition.zones ?? [])
      for (const code of zone.nations) reference(at, code, "zone nation", true);
  });
  continental.competitions.forEach((competition, index) => {
    const at = `continental.competitions[${index}]`;
    for (const holder of competition.titleholders ?? [])
      if (!ids.has(holder.from)) error(at, `unknown titleholder competition ${holder.from}`);
    for (const feed of competition.feeds ?? [])
      if (!ids.has(feed.to)) error(at, `unknown feed target ${feed.to}`);
    for (const drop of competition.drops ?? [])
      if (!ids.has(drop.to)) error(at, `unknown drop target ${drop.to}`);
    if (competition.mirrors && !ids.has(competition.mirrors)) error(at, `unknown mirrored competition ${competition.mirrors}`);
    if (competition.byes !== undefined && (!isInt(competition.byes) || competition.byes < 0 || competition.byes > competition.advance))
      error(at, "byes must be 0..advance");
  });
  continental.access.forEach((rule, index) => {
    const at = `continental.access[${index}]`;
    if (!ids.has(rule.competition)) error(at, `unknown competition ${rule.competition}`);
    if (rule.zone && !continental.competitions.find((item) => item.id === rule.competition)?.zones?.some((zone) => zone.name === rule.zone))
      error(at, `unknown zone ${rule.zone}`);
    if (rule.basis === "association-rank" ? !rule.bands?.length : !rule.fixed?.length)
      error(at, `${rule.basis} rules need ${rule.basis === "fixed" ? "fixed" : "bands"}`);
    for (const band of rule.bands ?? []) {
      const [first, last] = band.ranks;
      if (!isInt(first) || !isInt(last) || first < 1 || first > last)
        error(at, "ranks must be [first, last]");
      checkEntries(band.entries, at);
    }
    for (const group of rule.fixed ?? []) {
      for (const code of group.nations) {
        reference(at, code, "access nation");
        if (code === "RU") error(at, "Russia is suspended (decision 8)");
      }
      checkEntries(group.entries, at);
    }
  });

  if (scope.size === CATALOG_FILE_KEYS.length && !subset) {
    const summary = summarizeCatalog(catalog);
    if (summary.firstTeamClubs > 2600)
      warn("catalog", `${summary.firstTeamClubs} first-team clubs exceed the 2,600 budget`);
    if (summary.bTeams > 150) warn("catalog", `${summary.bTeams} B-teams exceed the 150 budget`);
    if (summary.estimatedPlayers > 210_000)
      warn("catalog", `about ${summary.estimatedPlayers} players exceed the 210,000 budget`);
  }
  return issues;
}

export function assertValidCatalog(catalog: WorldCatalog, options: ValidateOptions = {}) {
  const errors = validateCatalog(catalog, options).filter((issue) => issue.level === "error");
  if (errors.length)
    throw new Error(
      `World catalog has ${errors.length} error(s):\n${errors
        .slice(0, 25)
        .map((issue) => `${issue.path}: ${issue.message}`)
        .join("\n")}`,
    );
}
