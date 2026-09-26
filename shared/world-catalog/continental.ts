import type {
  AccessEntry,
  AccessRule,
  ContinentalCatalog,
  ContinentalCompetitionSpec,
  ContinentalStage,
} from "./types.ts";

const UCL = "uefa-champions-league";
const UEL = "uefa-europa-league";
const UECL = "uefa-conference-league";
const LIB = "copa-libertadores";
const SUD = "copa-sudamericana";
const ACLE = "afc-champions-league-elite";
const ACL2 = "afc-champions-league-two";
const ACGL = "afc-challenge-league";
const CAFCL = "caf-champions-league";
const CAFCC = "caf-confederation-cup";
const CCC = "concacaf-champions-cup";

const AFC_ZONES = [
  { name: "West", nations: ["SA", "QA", "AE", "IR", "UZ", "IQ", "JO", "IN"] },
  { name: "East", nations: ["JP", "KR", "CN", "AU", "TH", "MY", "VN", "ID", "PH"] },
];
type EuropeSpec = Omit<ContinentalCompetitionSpec, "confederation" | "age" | "kind" | "format" | "legs" | "finalLegs" | "neutralFinal">
  & Partial<ContinentalCompetitionSpec>;
const europe = (spec: EuropeSpec): ContinentalCompetitionSpec => ({
  confederation: "UEFA", age: "Senior", kind: "club", format: "league-phase", legs: 2, finalLegs: 1, neutralFinal: true, ...spec,
});

// Formats as of 2025/26. Club World Cup, Intercontinental Cup and OFC club football are out of scope (decision 17).
const COMPETITIONS: ContinentalCompetitionSpec[] = [
  europe({
    id: UCL, name: "UEFA Champions League", shortName: "Champions League", level: 1, teams: 36, matchdays: 8,
    advance: 24, byes: 8, start: "09-16",
    titleholders: [{ from: UCL, stage: "main", vacancyPath: "champions" }, { from: UEL, stage: "main" }],
    drops: [
      { from: "q1", path: "champions", to: UECL, stage: "q2" },
      { from: "q2", path: "champions", to: UEL, stage: "q3" },
      { from: "q2", path: "league", to: UEL, stage: "q3" },
      { from: "q3", path: "champions", to: UEL, stage: "playoff" },
      { from: "q3", path: "league", to: UEL, stage: "main" },
      { from: "playoff", to: UEL, stage: "main" },
    ],
  }),
  europe({
    id: UEL, name: "UEFA Europa League", shortName: "Europa League", level: 2, teams: 36, matchdays: 8,
    advance: 24, byes: 8, start: "09-24",
    titleholders: [{ from: UECL, stage: "main" }],
    drops: [
      { from: "q1", to: UECL, stage: "q2" },
      { from: "q2", to: UECL, stage: "q3" },
      { from: "q3", to: UECL, stage: "playoff" },
      { from: "playoff", to: UECL, stage: "main" },
    ],
  }),
  europe({
    id: UECL, name: "UEFA Conference League", shortName: "Conference League", level: 3, teams: 36, matchdays: 6,
    advance: 24, byes: 8, start: "10-02",
  }),
  // UEFA Champions League Path (the U19 sides of the 36 league-phase clubs) plus the Domestic Champions Path (qualifying).
  europe({
    id: "uefa-youth-league", name: "UEFA Youth League", shortName: "Youth League", age: "U19", level: 1, teams: 36,
    matchdays: 6, advance: 22, mirrors: UCL, legs: 1, qualifyingLegs: 2, start: "09-16",
  }),
  europe({
    id: "uefa-super-cup", name: "UEFA Super Cup", shortName: "Super Cup", kind: "super", format: "knockout", level: 1,
    teams: 2, advance: 1, legs: 1, start: "08-13",
    titleholders: [{ from: UCL, stage: "main" }, { from: UEL, stage: "main" }],
  }),
  {
    id: LIB, name: "CONMEBOL Libertadores", shortName: "Libertadores", confederation: "CONMEBOL", age: "Senior", level: 1,
    kind: "club", format: "groups", teams: 32, groupSize: 4, advance: 16, legs: 2, finalLegs: 1, neutralFinal: true,
    start: "04-01",
    titleholders: [{ from: LIB, stage: "main" }, { from: SUD, stage: "main" }],
    feeds: [{ to: SUD, positions: [3, 3], stage: "playoff" }],
    drops: [{ from: "q3", to: SUD, stage: "main" }],
  },
  {
    id: SUD, name: "CONMEBOL Sudamericana", shortName: "Sudamericana", confederation: "CONMEBOL", age: "Senior", level: 2,
    kind: "club", format: "groups", teams: 32, groupSize: 4, advance: 16, byes: 8, legs: 2, finalLegs: 1,
    neutralFinal: true, start: "04-02",
  },
  {
    id: "libertadores-sub-20", name: "CONMEBOL Libertadores Sub-20", shortName: "Libertadores Sub-20",
    confederation: "CONMEBOL", age: "U20", level: 1, kind: "club", format: "groups", teams: 12, groupSize: 4, advance: 4,
    legs: 1, finalLegs: 1, neutralFinal: true, start: "02-20",
    titleholders: [{ from: "libertadores-sub-20", stage: "main" }],
  },
  {
    id: "recopa-sudamericana", name: "CONMEBOL Recopa", shortName: "Recopa", confederation: "CONMEBOL", age: "Senior",
    level: 1, kind: "super", format: "knockout", teams: 2, advance: 1, legs: 2, finalLegs: 2, neutralFinal: false,
    start: "02-19",
    titleholders: [{ from: LIB, stage: "main" }, { from: SUD, stage: "main" }],
  },
  // From 2026/27: 16 clubs per zone (preliminary round of 2 ties per zone), 8 matches against own-zone opponents;
  // top 8 per zone reach the round of 16.
  {
    id: ACLE, name: "AFC Champions League Elite", shortName: "ACL Elite", confederation: "AFC", age: "Senior", level: 1,
    kind: "club", format: "league-phase", teams: 32, matchdays: 8, advance: 16, zones: AFC_ZONES, legs: 2,
    finalLegs: 1, neutralFinal: true, start: "09-14", qualifyingLegs: 1,
    drops: [{ from: "playoff", to: ACL2, stage: "main" }],
  },
  {
    id: ACL2, name: "AFC Champions League Two", shortName: "ACL Two", confederation: "AFC", age: "Senior", level: 2,
    kind: "club", format: "groups", teams: 32, groupSize: 4, advance: 16, zones: AFC_ZONES, legs: 2, finalLegs: 1,
    neutralFinal: false, start: "09-16",
  },
  {
    id: ACGL, name: "AFC Challenge League", shortName: "Challenge League", confederation: "AFC", age: "Senior",
    level: 3, kind: "club", format: "groups", teams: 8, groupSize: 4, advance: 4, zones: AFC_ZONES, legs: 2,
    finalLegs: 2, neutralFinal: false, start: "10-21",
  },
  {
    id: CAFCL, name: "CAF Champions League", shortName: "Champions League", confederation: "CAF", age: "Senior",
    level: 1, kind: "club", format: "groups", teams: 16, groupSize: 4, advance: 8, legs: 2, finalLegs: 2,
    neutralFinal: false, start: "11-21",
    drops: [{ from: "q2", to: CAFCC, stage: "playoff" }],
  },
  {
    id: CAFCC, name: "CAF Confederation Cup", shortName: "Confederation Cup", confederation: "CAF", age: "Senior",
    level: 2, kind: "club", format: "groups", teams: 16, groupSize: 4, advance: 8, legs: 2, finalLegs: 2,
    neutralFinal: false, start: "11-23",
  },
  // Round one (q1, 22 clubs) feeds the round of 16 alongside five byes; the final is one match at the better seed.
  {
    id: CCC, name: "CONCACAF Champions Cup", shortName: "Champions Cup", confederation: "CONCACAF", age: "Senior",
    level: 1, kind: "club", format: "knockout", teams: 16, advance: 1, legs: 2, finalLegs: 1, neutralFinal: false,
    start: "03-03",
  },
  {
    id: "concacaf-central-american-cup", name: "CONCACAF Central American Cup", shortName: "Central American Cup",
    confederation: "CONCACAF", age: "Senior", level: 2, kind: "club", format: "groups", teams: 20, groupSize: 5,
    advance: 8, legs: 2, finalLegs: 2, neutralFinal: false, start: "07-29", feeder: true,
    feeds: [{ to: CCC, positions: [1, 1], stage: "main" }, { to: CCC, positions: [2, 6], stage: "q1" }],
  },
  {
    id: "concacaf-caribbean-cup", name: "CONCACAF Caribbean Cup", shortName: "Caribbean Cup", confederation: "CONCACAF",
    age: "Senior", level: 2, kind: "club", format: "groups", teams: 8, groupSize: 4, advance: 4, legs: 2, finalLegs: 2,
    neutralFinal: false, start: "08-19", feeder: true,
    feeds: [{ to: CCC, positions: [1, 1], stage: "main" }, { to: CCC, positions: [2, 3], stage: "q1" }],
  },
  // MLS v Liga MX: three league-phase matches against the other league, then knockouts.
  {
    id: "leagues-cup", name: "Leagues Cup", shortName: "Leagues Cup", confederation: "CONCACAF", age: "Senior", level: 2,
    kind: "club", format: "league-phase", teams: 36, matchdays: 3, advance: 8, legs: 1, finalLegs: 1,
    neutralFinal: false, start: "07-29", feeder: true,
    feeds: [{ to: CCC, positions: [1, 1], stage: "main" }, { to: CCC, positions: [2, 3], stage: "q1" }],
  },
  {
    id: "campeones-cup", name: "Campeones Cup", shortName: "Campeones Cup", confederation: "CONCACAF", age: "Senior",
    level: 1, kind: "super", format: "knockout", teams: 2, advance: 1, legs: 1, finalLegs: 1, neutralFinal: false,
    start: "09-23",
  },
];

type Path = "champions" | "league";
const champion = (stage: ContinentalStage, path?: Path): AccessEntry => ({ source: "champion", stage, ...(path && { path }) });
const league = (position: number, stage: ContinentalStage, path?: Path): AccessEntry =>
  ({ source: "league", position, stage, ...(path && { path }) });
const leagues = (first: number, last: number, stage: ContinentalStage): AccessEntry[] =>
  Array.from({ length: last - first + 1 }, (_, index) => league(first + index, stage));
const cup = (stage: ContinentalStage): AccessEntry => ({ source: "cup-winner", stage });
const band = (first: number, last: number, ...entries: AccessEntry[]) => ({ ranks: [first, last] as [number, number], entries });
const fixed = (nations: string[], ...entries: AccessEntry[]) => ({ nations, entries });

/*
 * League slots are filled in list order by the best-placed club not yet qualified, so a cup winner that already
 * qualified passes its place down the table (UEFA/CONMEBOL rebalancing). Ranks are the real association positions:
 * associations without clubs in the game (and suspended Russia) keep their rank through `RANKING_ONLY`, and their
 * places are vacated and rebalanced by the resolver. UEFA follows the 2024–27 access list; the European Performance
 * Spots and titleholder rebalancing are applied by the resolver in shared/competition-rules.ts.
 */
const UEFA_ACCESS: AccessRule[] = [
  {
    competition: UCL, basis: "association-rank", bands: [
      band(1, 4, champion("main"), league(2, "main"), league(3, "main"), league(4, "main")),
      band(5, 5, champion("main"), league(2, "main"), league(3, "main"), league(4, "q3", "league")),
      band(6, 6, champion("main"), league(2, "main"), league(3, "q3", "league")),
      band(7, 9, champion("main"), league(2, "q3", "league")),
      band(10, 10, champion("main"), league(2, "q2", "league")),
      band(11, 14, champion("playoff", "champions"), league(2, "q2", "league")),
      band(15, 15, champion("q2", "champions"), league(2, "q2", "league")),
      band(16, 22, champion("q2", "champions")),
      band(23, 55, champion("q1", "champions")),
    ],
  },
  {
    competition: UEL, basis: "association-rank", bands: [
      band(1, 5, cup("main"), league(5, "main")),
      band(6, 6, cup("main"), league(4, "q2")),
      band(7, 7, cup("main"), league(3, "q2")),
      band(8, 12, cup("playoff"), league(3, "q2")),
      band(13, 15, cup("q3")),
      band(16, 33, cup("q1")),
    ],
  },
  {
    competition: UECL, basis: "association-rank", bands: [
      band(1, 5, league(6, "playoff")),
      band(6, 6, league(5, "q2")),
      band(7, 9, league(4, "q2")),
      band(10, 12, league(4, "q2")),
      band(13, 15, league(3, "q2"), league(4, "q2")),
      band(16, 29, league(2, "q2"), league(3, "q2")),
      band(30, 33, league(2, "q2"), league(3, "q1")),
      band(34, 37, cup("q2"), league(2, "q1"), league(3, "q1")),
      band(38, 50, cup("q1"), league(2, "q1"), league(3, "q1")),
      band(51, 55, cup("q1"), league(2, "q1")),
    ],
  },
  // Domestic Champions Path: every U19 champion (the top 30 from round 2); the Champions League Path mirrors the UCL.
  {
    competition: "uefa-youth-league", basis: "association-rank",
    bands: [
      band(1, 30, { source: "u19-champion", stage: "q2", path: "champions" }),
      band(31, 55, { source: "u19-champion", stage: "q1", path: "champions" }),
    ],
  },
];

const CONMEBOL_ACCESS: AccessRule[] = [
  {
    competition: LIB, basis: "fixed", fixed: [
      fixed(["BR"], champion("main"), league(2, "main"), league(3, "main"), league(4, "main"), cup("main"),
        league(5, "q2"), league(6, "q2")),
      fixed(["AR"], champion("main"), league(2, "main"), league(3, "main"), cup("main"), league(4, "main"), league(5, "q2")),
      fixed(["CL"], champion("main"), cup("main"), league(2, "q2"), league(3, "q2")),
      fixed(["CO"], champion("main"), cup("main"), league(2, "q2"), league(3, "q2")),
      fixed(["EC", "PY"], champion("main"), cup("main"), league(2, "q2"), league(3, "q1")),
      fixed(["UY", "PE", "VE", "BO"], champion("main"), league(2, "main"), league(3, "q2"), league(4, "q1")),
    ],
  },
  {
    competition: SUD, basis: "fixed", fixed: [
      fixed(["BR"], ...leagues(8, 13, "main")),
      fixed(["AR"], ...leagues(7, 12, "main")),
      fixed(["CL", "CO", "EC", "PY", "UY", "PE", "VE", "BO"], ...leagues(5, 8, "q1")),
    ],
  },
  {
    competition: "libertadores-sub-20", basis: "fixed",
    fixed: [fixed(["BR", "AR", "UY", "CO", "EC", "PY", "CL", "PE", "VE", "BO"], { source: "u20-champion", stage: "main" })],
  },
];

// Ranks per zone (AFC allocates by region). 2026/27 Elite slots: rank 1 4+1, 2 3+1, 3 3, 4 2, 5 1+1 by the
// regular-season table, 6 1, 7 0+1 ("playoff" = preliminary round).
const AFC_ACCESS: AccessRule[] = ["West", "East"].flatMap((zone): AccessRule[] => [
  {
    competition: ACLE, basis: "association-rank", zone, bands: [
      band(1, 1, champion("main"), cup("main"), league(2, "main"), league(3, "main"), league(4, "playoff")),
      band(2, 2, champion("main"), cup("main"), league(2, "main"), league(3, "playoff")),
      band(3, 3, champion("main"), cup("main"), league(2, "main")),
      band(4, 4, champion("main"), cup("main")),
      band(5, 5, league(1, "main"), league(2, "playoff")),
      band(6, 6, champion("main")),
      band(7, 7, champion("playoff")),
    ],
  },
  {
    competition: ACL2, basis: "association-rank", zone, bands: [
      band(1, 1, league(4, "main"), league(5, "main")),
      band(2, 2, league(4, "main")),
      band(3, 4, league(2, "main"), league(3, "main")),
      band(5, 5, cup("main"), league(2, "main")),
      ...(zone === "West"
        ? [band(6, 8, champion("main"), cup("main"), league(2, "main"))]
        : [band(6, 9, champion("main"), cup("main"))]),
    ],
  },
  {
    competition: ACGL, basis: "association-rank", zone, bands: zone === "West"
      ? [band(4, 4, league(4, "main")), band(5, 5, league(3, "main")), band(6, 8, league(3, "main"))]
      : [band(5, 5, league(3, "main")), band(6, 9, league(3, "main"))],
  },
]);

// Top 12 associations enter two clubs in each competition; first-round byes only balance round 2 (best seeds).
const CAF_ACCESS: AccessRule[] = [
  {
    competition: CAFCL, basis: "association-rank", bands: [
      band(1, 12, champion("q1"), league(2, "q1")),
      band(13, 54, champion("q1")),
    ],
  },
  {
    competition: CAFCC, basis: "association-rank",
    bands: [band(1, 12, cup("q1"), league(3, "q1")), band(13, 54, cup("q1"))],
  },
];

// "league 1" is the regular-season table (MLS Supporters' Shield, Liga MX general table); "champion" wins the play-offs.
const CONCACAF_ACCESS: AccessRule[] = [
  {
    competition: CCC, basis: "fixed", fixed: [
      fixed(["US"], champion("main"), league(1, "q1"), cup("q1"), ...leagues(2, 4, "q1")),
      fixed(["MX"], champion("main"), ...leagues(1, 5, "q1")),
      fixed(["CA"], cup("q1"), champion("q1"), league(1, "q1")),
    ],
  },
  {
    competition: "concacaf-central-american-cup", basis: "fixed",
    fixed: [fixed(["PA", "CR", "HN", "SV", "GT"], champion("main"), league(2, "main"), league(3, "main"), cup("main"))],
  },
  {
    competition: "concacaf-caribbean-cup", basis: "fixed",
    fixed: [fixed(["JM", "HT", "DO", "PR"], champion("main"), league(2, "main"))],
  },
  {
    competition: "leagues-cup", basis: "fixed",
    fixed: [fixed(["US", "MX"], ...leagues(1, 18, "main"))],
  },
  {
    competition: "campeones-cup", basis: "fixed",
    fixed: [fixed(["US", "MX"], champion("main"))],
  },
];

const ACCESS: AccessRule[] = [...UEFA_ACCESS, ...CONMEBOL_ACCESS, ...AFC_ACCESS, ...CAF_ACCESS, ...CONCACAF_ACCESS];

// UEFA: kassiesa.net country rankings 2025 and 2026. AFC: modeled per-entrant scale placed between the real neighbours
// of the AFC ranking after 2024–25 (MY 40.039 between AU and IQ; JO 36.905 between IQ and VN).
const RANKING_ONLY: ContinentalCatalog["rankingOnly"] = {
  IL: { association: [7.0, 6.75, 6.25, 8.75, 2.875], season2025: 2.875 },
  AZ: { association: [2.5, 4.375, 4.0, 5.875, 2.875], season2025: 5.812 },
  FO: { association: [2.75, 1.5, 2.25, 2.75, 1.5], season2025: 1.75 },
  MK: { association: [1.75, 0.625, 1.625, 1.5, 0.666], season2025: 3.343 },
  MY: { association: [7, 7, 7, 7.5, 7.5] },
  JO: { association: [5.5, 6, 6, 6.5, 6] },
  // CAF: inside the real 2025/26 two-club top 12 (between CI and CM on the catalog scale); order within it approximate.
  TZ: { association: [6, 6, 6.5, 6.5, 7] },
  LY: { association: [5.5, 6, 6, 6, 6.5] },
  SD: { association: [5, 5.5, 5.5, 5, 5] },
};

// Owner: Lead-competitions — club competitions and access lists per confederation (directive decisions 7, 8, 17).
export const CONTINENTAL: ContinentalCatalog = {
  competitions: COMPETITIONS,
  access: ACCESS,
  coefficientConfederations: ["UEFA", "CAF", "AFC", "CONCACAF", "CONMEBOL"],
  rankingOnly: RANKING_ONLY,
};
