import type { Country } from "./types.ts";

export const WORLD_VERSION = 2;
export const SQUAD_MINIMUMS = { Senior: 22, U19: 18, U17: 18 } as const;
export function footballConfederation(code: string, continent: string) {
  if (["AM", "AZ", "CY", "GE", "IL", "KZ", "RU", "TR", "XK"].includes(code))
    return "UEFA";
  if (["GY", "SR", "GF"].includes(code)) return "CONCACAF";
  if (code === "AU") return "AFC";
  return continent === "EU"
    ? "UEFA"
    : continent === "SA"
      ? "CONMEBOL"
      : continent === "AF"
        ? "CAF"
        : continent === "NA"
          ? "CONCACAF"
          : continent === "OC"
            ? "OFC"
            : "AFC";
}

export function associationNotes(code: string): string[] {
  const notes = [
    "Domestic formats, licensing, registration quotas and calendars are game models, not a complete federation rulebook.",
  ];
  if (["LI", "MC", "VA"].includes(code))
    notes.push(
      "The domestic pyramid is fictional; real clubs use cross-border or non-professional structures.",
    );
  if (["EN", "SCO", "WAL", "NIR", "US", "CA", "AU", "NZ"].includes(code))
    notes.push(
      "Cross-border club exceptions are not reproduced; clubs are assigned to their simulated home association.",
    );
  if (
    [
      "AC",
      "TA",
      "SH",
      "AX",
      "GG",
      "JE",
      "IM",
      "GL",
      "FK",
      "PM",
      "BL",
      "MF",
      "SX",
      "EH",
      "KI",
      "MH",
      "FM",
      "NR",
      "PW",
      "TV",
      "TK",
      "NU",
      "WF",
      "MC",
      "VA",
    ].includes(code)
  )
    notes.push(
      "Territory or non-FIFA association: international and continental entry is fictional and not a claim of FIFA membership.",
    );
  if (["US", "CA", "AU"].includes(code))
    notes.push(
      "No automatic promotion or relegation in this modeled closed pyramid.",
    );
  return notes;
}

const pyramidSizes: Record<string, number[]> = {
  EN: [20, 24, 24, 24, 24, 22, 20, 20],
  ES: [20, 22, 20, 20, 18, 18, 16],
  DE: [18, 18, 20, 18, 18, 18, 16],
  IT: [20, 20, 20, 20, 18, 18, 16],
  FR: [18, 18, 18, 16, 16, 16, 14],
  BR: [20, 20, 20, 20, 16, 16],
  AR: [20, 20, 20, 18, 16, 16],
  PT: [18, 18, 16, 16, 16, 14],
  NL: [18, 20, 18, 16, 16, 14],
  BE: [16, 16, 16, 16, 14, 14],
  US: [20, 20, 20, 18, 16, 16],
  MX: [18, 18, 18, 16, 16],
  JP: [20, 20, 20, 16, 16, 14],
  KR: [12, 14, 16, 16, 14],
  CN: [16, 16, 16, 16, 14],
  IN: [14, 14, 14, 14, 12],
  ID: [18, 18, 16, 16, 14],
  TR: [18, 20, 18, 18, 16, 16],
  RU: [16, 18, 18, 16, 16, 14],
  PL: [18, 18, 18, 16, 16, 14],
  SCO: [12, 10, 10, 10, 16, 16],
  WAL: [12, 16, 16, 14, 12],
  NIR: [12, 12, 12, 12, 10],
  IE: [10, 10, 12, 12, 10],
  AT: [12, 16, 16, 16, 14],
  CH: [12, 10, 16, 16, 14],
  DK: [12, 12, 12, 12, 12],
  NO: [16, 16, 14, 14, 12],
  SE: [16, 16, 16, 14, 14],
  FI: [12, 12, 12, 12, 10],
  CZ: [16, 16, 16, 14, 14],
  GR: [14, 16, 16, 14, 14],
  HR: [10, 12, 16, 14, 12],
  RS: [16, 16, 16, 14, 12],
  RO: [16, 18, 16, 14, 14],
  UA: [16, 16, 16, 14, 12],
  SA: [18, 18, 16, 16, 14],
  EG: [18, 18, 18, 16, 14],
  MA: [16, 16, 16, 14, 14],
  ZA: [16, 16, 16, 14, 14],
  NG: [20, 18, 16, 16, 14],
  GH: [18, 16, 16, 14, 12],
  TN: [16, 16, 14, 14, 12],
  DZ: [16, 16, 16, 14, 14],
  AU: [14, 16, 16, 14, 14],
  CA: [12, 12, 14, 14, 12],
  NZ: [10, 12, 12, 12],
  CO: [20, 16, 16, 14, 14],
  CL: [16, 16, 16, 14, 12],
  UY: [16, 14, 14, 12, 12],
  PE: [18, 16, 14, 14, 12],
  EC: [16, 12, 14, 14, 12],
  PY: [12, 16, 14, 14, 12],
  LU: [16, 16, 14, 12],
  IS: [12, 12, 12, 10],
  MT: [12, 12, 12, 10],
  CY: [14, 16, 14, 12],
};

const pyramidTitles: Record<string, string[]> = {
  EN: [
    "Premier Division",
    "Championship",
    "League One",
    "League Two",
    "National League",
    "National League Regional",
    "Regional Premier",
    "Regional Division",
  ],
  ES: [
    "Primera Division",
    "Segunda Division",
    "Primera Federacion",
    "Segunda Federacion",
    "Tercera Federacion",
    "Regional Preferente",
    "Primera Regional",
  ],
  DE: [
    "Bundesliga",
    "2. Bundesliga",
    "3. Liga",
    "Regionalliga",
    "Oberliga",
    "Landesliga",
    "Bezirksliga",
  ],
  IT: [
    "Serie A",
    "Serie B",
    "Serie C",
    "Serie D",
    "Eccellenza",
    "Promozione",
    "Prima Categoria",
  ],
  FR: [
    "Ligue 1",
    "Ligue 2",
    "Ligue 3",
    "National 1",
    "National 2",
    "Regional 1",
    "Regional 2",
  ],
  PT: [
    "Primeira Liga",
    "Segunda Liga",
    "Liga 3",
    "Campeonato Nacional",
    "Divisao Distrital",
    "Segunda Distrital",
  ],
  BR: [
    "Serie A",
    "Serie B",
    "Serie C",
    "Serie D",
    "Estadual Primeira",
    "Estadual Segunda",
  ],
  AR: [
    "Primera Division",
    "Primera Nacional",
    "Primera B",
    "Primera C",
    "Regional Federal",
    "Liga Regional",
  ],
  NL: [
    "Eredivisie",
    "Eerste Divisie",
    "Tweede Divisie",
    "Derde Divisie",
    "Vierde Divisie",
    "Eerste Klasse",
  ],
  BE: [
    "Pro League",
    "Challenger League",
    "Nationale 1",
    "Nationale 2",
    "Nationale 3",
    "Provinciale",
  ],
  JP: [
    "J1 League",
    "J2 League",
    "J3 League",
    "Football League",
    "Regional League",
    "Prefectural League",
  ],
  LU: [
    "Division Nationale",
    "Promotion d'Honneur",
    "Premiere Division",
    "Deuxieme Division",
  ],
  SCO: [
    "Premiership",
    "Championship",
    "League One",
    "League Two",
    "Regional League",
    "Regional Division",
  ],
};

const smallAssociations = new Set(
  "AD AI AS AW AX BL BM CK CW DM EH FK FO GG GI GL GP GU IM JE KI KN KY LC LI MC MF MH MP MS NC NR NU PM PW SB SC SH SM ST SX TC TK TO TV VA VG VI VU WF WS".split(
    " ",
  ),
);
const closedPyramids = new Set(["US", "CA", "AU"]);

export function domesticPyramid(
  country: Pick<Country, "code" | "name" | "reputation">,
) {
  const sizes =
    pyramidSizes[country.code] ??
    (smallAssociations.has(country.code)
      ? [8, 8, 8]
      : country.reputation >= 60
        ? [16, 16, 14, 14, 12]
        : [12, 12, 10, 10]);
  return sizes.map((clubs, index) => ({
    tier: index + 1,
    clubs,
    name: `${country.name} ${pyramidTitles[country.code]?.[index] ?? ["Premier League", "First Division", "Second Division", "Regional Division", "District League"][index] ?? `Division ${index + 1}`}`,
    promotion: index > 0 && !closedPyramids.has(country.code) ? 2 : 0,
    relegation:
      index < sizes.length - 1 && !closedPyramids.has(country.code) ? 2 : 0,
  }));
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

export interface ReservePolicy {
  mode: "pyramid" | "separate" | "unverified";
  highestTier: number | null;
  entryTier: number | null;
  professional: boolean | null;
  gap: number;
  naming: "B" | "II" | "2" | "U23" | "Jong" | "Reserves";
  evidence: "documented" | "historical" | "unverified";
  summary: string;
  source: string;
}

const reserveOverview = "https://en.wikipedia.org/wiki/Reserve_team";
const historicalReserves = "https://www.rsssf.org/miscellaneous/reserves.html";
const policy = (
  highestTier: number,
  entryTier: number,
  naming: ReservePolicy["naming"],
  source: string,
  summary: string,
  professional: boolean | null = true,
  gap = 1,
): ReservePolicy => ({
  mode: "pyramid",
  highestTier,
  entryTier,
  naming,
  source,
  summary,
  professional,
  gap,
  evidence: "documented",
});

const reservePolicies: Record<string, ReservePolicy> = {
  EN: {
    mode: "separate",
    highestTier: null,
    entryTier: 0,
    professional: false,
    gap: 1,
    naming: "Reserves",
    evidence: "documented",
    source: reserveOverview,
    summary:
      "Professional clubs use separate development competitions; no B-team entry into the professional senior pyramid.",
  },
  ES: policy(
    2,
    2,
    "B",
    reserveOverview,
    "Reserve teams may reach the second tier, always below their parent.",
  ),
  PT: policy(
    2,
    2,
    "B",
    "https://en.wikipedia.org/wiki/Liga_Portugal_2",
    "B teams play in the second tier and below, with no promotion to the top division.",
  ),
  DE: policy(
    3,
    3,
    "II",
    "https://en.wikipedia.org/wiki/3._Liga",
    "The third tier is the ceiling; a third-tier parent's reserves must drop to tier five.",
  ),
  IT: policy(
    2,
    3,
    "U23",
    "https://en.wikipedia.org/wiki/Juventus_Next_Gen#Regulations",
    "Second teams enter tier three and may reach tier two, never their parent's division.",
  ),
  BE: policy(
    2,
    2,
    "U23",
    "https://en.wikipedia.org/wiki/Challenger_Pro_League",
    "U23 sides may compete in the second tier but cannot enter the top division.",
  ),
  NL: policy(
    2,
    2,
    "Jong",
    "https://www.knvb.nl/competities/competitiezaken/competitiemodel/periodetitels-in-de-eerste-divisie",
    "Jong teams can play in the second tier; top-flight promotion is prohibited.",
  ),
  AT: policy(
    2,
    2,
    "II",
    "https://en.wikipedia.org/wiki/Austrian_Football_Second_League",
    "Reserve sides can play in the professional second tier but cannot be promoted to the Bundesliga.",
  ),
  CH: policy(
    3,
    3,
    "II",
    "https://en.wikipedia.org/wiki/Swiss_Promotion_League",
    "Reserves are limited to the semi-professional third tier and below.",
    false,
  ),
  FR: policy(
    4,
    4,
    "II",
    reserveOverview,
    "Academy reserves can reach tier four, below the professional national divisions.",
    false,
  ),
  NO: policy(
    3,
    3,
    "2",
    "https://en.wikipedia.org/wiki/Norwegian_reserve_football_teams",
    "Two-tier separation from parents in tiers one to three; one tier below lower parents.",
    null,
    2,
  ),
  PL: policy(
    2,
    3,
    "II",
    reserveOverview,
    "A one-tier parent gap replaced the former two-tier requirement in 2020.",
  ),
  BG: policy(
    2,
    2,
    "II",
    reserveOverview,
    "Reserve sides may play in the second tier, at least one level below their first team.",
  ),
  UA: policy(
    2,
    3,
    "2",
    reserveOverview,
    "Second teams may play in the senior pyramid below their parent; separate youth teams remain distinct.",
  ),
  US: {
    mode: "separate",
    highestTier: 3,
    entryTier: 3,
    professional: true,
    gap: 1,
    naming: "II",
    evidence: "documented",
    source: "https://en.wikipedia.org/wiki/MLS_Next_Pro",
    summary:
      "A separate professional tier-three development league has no promotion into its parents' competition.",
  },
};

const historicalCountries = new Set(
  "AD AM AZ CZ EC EE FO GE IR KZ LV LR LT MW MY MD NI PA PF VE".split(" "),
);

export function reservePolicy(code: string): ReservePolicy {
  if (reservePolicies[code]) return reservePolicies[code];
  if (historicalCountries.has(code))
    return {
      mode: "unverified",
      highestTier: null,
      entryTier: null,
      professional: null,
      gap: 1,
      naming: "B",
      evidence: "historical",
      source: historicalReserves,
      summary:
        "Senior-pyramid reserve participation is documented historically. Current entry and professional-tier permissions need federation verification; no automatic B-team admission.",
    };
  return {
    mode: "unverified",
    highestTier: null,
    entryTier: null,
    professional: null,
    gap: 1,
    naming: "Reserves",
    evidence: "unverified",
    source: "",
    summary:
      "Current reserve-team access has not been verified. No professional B-team permission is assumed; first-team, U19 and U17 squads are still provided.",
  };
}

export function minimumReserveTier(code: string, parentTier: number): number {
  const rules = reservePolicy(code);
  if (rules.mode !== "pyramid" || rules.highestTier === null)
    return Number.POSITIVE_INFINITY;
  const gap =
    code === "NO"
      ? parentTier <= 3
        ? 2
        : 1
      : code === "DE" && parentTier === 3
        ? 2
        : rules.gap;
  return Math.max(rules.highestTier, parentTier + gap);
}

export function reserveTeamName(parent: string, code: string): string {
  const style = reservePolicy(code).naming;
  return style === "Jong" ? `Jong ${parent}` : `${parent} ${style}`;
}

export interface PyramidDivision {
  id: number;
  tier: number;
  promotion: number;
  relegation: number;
  entries: { clubId: number; parentId: number | null }[];
}

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
