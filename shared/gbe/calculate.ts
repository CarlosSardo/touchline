// Pure GBE calculator: evidence (what the player did, as the FA defines it) + ruleset → assessment with a per-table
// breakdown. No I/O and no randomness; server/gbe.ts builds the evidence from the world.
import {
  GBE_FINISH_LABEL,
  GBE_STAGE_LABEL,
  GBE_STAGE_ORDER,
  gbeContinentalBand,
  gbeLeagueBand,
  gbeStage,
  type GbeFinish,
  type GbePercentRow,
  type GbeRuleset,
  type GbeStage,
} from "./rules.ts";
import type { GbeAssessment, GbeCriterion, GbeCriterionResult, GbeCriterionStatus } from "./types.ts";

/** Minutes at one club in one domestic league or continental competition over the window. */
export interface GbeSpell {
  clubId: number;
  club: string;
  competition: string;
  /** Domestic league: country and tier (league band). */
  countryCode?: string | null;
  tier?: number | null;
  /** Continental competition: catalog id (continental band) and whether it is knockout-only (¶43). */
  catalogId?: string | null;
  available: number;
  minutes: number;
  appearances: number;
  listed: number;
  unavailable: number;
  estimated: boolean;
  simulated: boolean;
}

export interface GbeContinentalRun {
  club: string;
  competition: string;
  catalogId: string | null;
  /** Best game stage reached (fixtures' stage names). */
  stage: string;
  knockoutOnly?: boolean;
  estimated: boolean;
}

export interface GbeEvidence {
  playerId: number;
  asOf: string;
  birthDate: string;
  /** Passport groups of every nationality held (GB for EN/SCO/WAL/NIR). */
  passportGroups: readonly string[];
  nation: string;
  /** Senior national team over the International Reference Period; null when nothing is known about its matches. */
  international: {
    /** Aggregated ranking among all FIFA members over the period; null when unknown. */
    rank: number | null;
    competitive: number;
    friendlies: number;
    competitiveApps: number;
    friendlyApps: number;
    unavailable: number;
    estimated: boolean;
    simulated: boolean;
  } | null;
  /** Domestic league spells in the Reference Period. */
  domestic: readonly GbeSpell[];
  /** First senior appearance for a club, when it falls in the Reference Period. */
  debut: { month: string; club: string; countryCode: string | null; tier: number | null; estimated: boolean } | null;
  /** Continental competition spells (group stage onwards) in the Reference Period. */
  continental: readonly GbeSpell[];
  /** Domestic cup share of available cup minutes (percent) in the Reference Period and in the Last Season. */
  cupPercent: { reference: number; lastSeason: number };
  lastSeason: { season: number; label: string };
  /** Club played for at the end of the Last Season (null: no senior club that season). */
  lastClub: {
    club: string;
    countryCode: string | null;
    tier: number | null;
    /** False: the club's season outcome is not on record. */
    archived: boolean;
    position: number | null;
    clubs: number | null;
    champion: boolean;
    promoted: boolean;
    relegated: boolean;
    /** Continental places earned (null: not known yet). */
    qualified: readonly { catalogId: string | null; competition: string; phase: "group" | "qualifiers" }[] | null;
    continental: readonly GbeContinentalRun[];
    listedLeague: boolean;
    listedAny: boolean;
    estimated: boolean;
  } | null;
  /** Continental competitions started after the Last Season in which the player has appeared (¶42). */
  currentRuns: readonly GbeContinentalRun[];
  /** Current Club for Table 6 (¶45, glossary: the Last Club when not named in a squad of the registered club). */
  currentClub: {
    club: string;
    countryCode: string | null;
    tier: number | null;
    listed: boolean;
    estimated: boolean;
    /** The registered club named no squad with him: the club he last played for is used. */
    fallback: boolean;
    /** Parent club of a loanee who appeared for it in the Reference Period (¶47). */
    parent?: { club: string; countryCode: string | null; tier: number | null } | null;
  } | null;
  /** Elite Significant Contribution inputs over the ESC Player Reference Period (Appendix 1, 1.2). */
  esc: {
    seniorCompetitiveCaps: number;
    youthInternationals: number;
    continentalMatches: number;
    continentalYouthMatches: number;
    domesticSeniorMatches: number;
    domesticYouthMatches: number;
  };
  /** First month with any GBE data in this world (pre-game estimate included); null when there is none. */
  coverageFrom: string | null;
}

const LABELS: Record<GbeCriterion, string> = {
  international: "Table 1: international appearances",
  domestic_minutes: "Table 2: domestic league minutes",
  continental_minutes: "Table 3: continental minutes",
  league_position: "Table 4: Last Club's final league position",
  continental_progression: "Table 5: Last Club's continental progression",
  league_standard: "Table 6: Current Club's league",
};

/** ¶33: halves round up. */
export const gbePercent = (part: number, whole: number) =>
  whole > 0 ? Math.min(100, Math.round((part / whole) * 100 + 1e-9)) : 0;

const rowFor = <Cell>(rows: readonly GbePercentRow<Cell>[], percent: number) => rows.find((row) => percent >= row.min);

/** Table 1 column for an aggregated ranking (the last column for unranked associations). */
export function gbeRankColumn(ruleset: GbeRuleset, rank: number | null) {
  if (rank === null) return ruleset.rankColumns.length;
  const index = ruleset.rankColumns.findIndex((upper) => rank <= upper);
  return index < 0 ? ruleset.rankColumns.length : index;
}

export const gbeTable1 = (ruleset: GbeRuleset, percent: number, rank: number | null) =>
  rowFor(ruleset.table1, percent)?.cells[gbeRankColumn(ruleset, rank)] ?? 0;
export const gbeTable2 = (ruleset: GbeRuleset, percent: number, band: number) =>
  rowFor(ruleset.table2, percent)?.cells[band - 1] ?? 0;
export const gbeTable3 = (ruleset: GbeRuleset, percent: number, band: number) =>
  rowFor(ruleset.table3, percent)?.cells[band - 1] ?? 0;

const max = (values: readonly number[]) => values.reduce((best, value) => Math.max(best, value), 0);
const minutes = (value: number) => value.toLocaleString("en-GB");
const monthLabel = (month: string) =>
  new Date(`${month}-01T00:00:00Z`).toLocaleDateString("en-GB", { month: "short", year: "numeric", timeZone: "UTC" });

function status(points: number, estimated: boolean): GbeCriterionStatus {
  if (estimated) return "estimate";
  return points > 0 ? "scored" : "zero";
}

const shiftMonths = (date: string, months: number) => {
  const year = Number(date.slice(0, 4));
  const month = Number(date.slice(5, 7)) - 1 + months;
  const shifted = new Date(Date.UTC(year + Math.floor(month / 12), ((month % 12) + 12) % 12, 1));
  return shifted.toISOString().slice(0, 7);
};

/** First month of a window of `months` months ending with the month of `asOf`. */
export const gbeWindowStart = (asOf: string, months: number) => shiftMonths(asOf, -(months - 1));

function international(evidence: GbeEvidence, ruleset: GbeRuleset, youth: boolean): GbeCriterionResult {
  const months = youth ? ruleset.internationalYouthMonths : ruleset.internationalMonths;
  const base = { criterion: "international" as const, label: LABELS.international, max: max(ruleset.table1.flatMap((row) => row.cells.filter((cell): cell is number => typeof cell === "number"))) };
  const data = evidence.international;
  const played = data ? data.competitive + data.friendlies : 0;
  if (!data || played === 0)
    return {
      ...base,
      points: 0,
      status: "no_data",
      detail: `${evidence.nation} played no recorded senior international in the last ${months} months, so there are no available international matches.`,
    };
  const withFriendlies = played > 0 && data.competitive / played < ruleset.friendliesBelowCompetitiveShare;
  const available = Math.max(0, data.competitive + (withFriendlies ? data.friendlies : 0) - data.unavailable);
  const apps = Math.min(available, data.competitiveApps + (withFriendlies ? data.friendlyApps : 0));
  const percent = gbePercent(apps, available);
  const cell = gbeTable1(ruleset, percent, data.rank);
  const rank = data.rank === null ? "unranked" : `ranked ${data.rank} (aggregated)`;
  const scope = withFriendlies
    ? `${data.competitive} competitive and ${data.friendlies} friendly matches (friendlies count: under ${Math.round(ruleset.friendliesBelowCompetitiveShare * 100)}% were competitive)`
    : `${data.competitive} competitive matches`;
  const autoPass = cell === "auto";
  const points = autoPass ? 0 : cell;
  return {
    ...base,
    points,
    autoPass,
    status: data.estimated ? "estimate" : autoPass || points > 0 ? "scored" : "zero",
    detail:
      `${apps} of ${available} available senior internationals (${percent}%) in ${months} months: ${scope}${data.unavailable ? `, ${data.unavailable} missed while unavailable` : ""}; ${evidence.nation} ${rank}. ` +
      (autoPass ? "Automatic pass." : apps === 0 ? "No senior international appearances." : `${points} points.`),
  };
}

function spellBand(ruleset: GbeRuleset, spell: Pick<GbeSpell, "countryCode" | "tier">) {
  return gbeLeagueBand(ruleset, spell.countryCode, spell.tier);
}

function domestic(evidence: GbeEvidence, ruleset: GbeRuleset, youth: boolean, covered: boolean): GbeCriterionResult {
  const base = { criterion: "domestic_minutes" as const, label: LABELS.domestic_minutes, max: ruleset.table2[0].cells[0] };
  const spells = evidence.domestic.filter((spell) => spell.available > 0 || spell.minutes > 0 || spell.listed > 0);
  const debut = youth ? evidence.debut : null;
  if (!spells.length && !debut)
    return {
      ...base,
      points: 0,
      status: covered ? "zero" : "no_data",
      detail: covered
        ? `No senior domestic league football in the last ${ruleset.referenceMonths} months.`
        : `No senior league records cover the last ${ruleset.referenceMonths} months yet.`,
    };
  // ¶30-32: the percentage at each club weighted by its share of the period (available minutes stand in for days).
  const available = spells.reduce((total, spell) => total + spell.available, 0);
  const played = spells.reduce((total, spell) => total + Math.min(spell.minutes, spell.available), 0);
  const percent = gbePercent(played, available);
  // ¶37: the higher column when the player appeared in more than one domestic league (spells of real weight only).
  const columns = spells.filter((spell) => (spell.appearances > 0 || spell.listed > 0) && spell.available >= available * 0.25);
  const bands = [...new Set((columns.length ? columns : spells).map((spell) => spellBand(ruleset, spell)))].sort();
  const minutesPoints = max(bands.map((band) => gbeTable2(ruleset, percent, band)));
  const debutBand = debut ? gbeLeagueBand(ruleset, debut.countryCode, debut.tier) : 6;
  const debutPoints = debut ? ruleset.youthDebut[debutBand - 1] : 0;
  const points = Math.max(minutesPoints, debutPoints);
  const unavailable = spells.reduce((total, spell) => total + spell.unavailable, 0);
  const clubs = spells.map((spell) => `${spell.club} (${spell.competition}, Band ${spellBand(ruleset, spell)})`).join("; ");
  const parts = [
    available
      ? `${minutes(played)} of ${minutes(available)} available league minutes (${percent}%) in ${ruleset.referenceMonths} months: ${clubs}.`
      : `No available league minutes in ${ruleset.referenceMonths} months: ${clubs}.`,
    unavailable ? `${minutes(unavailable)} minutes excluded while injured, suspended or on international duty.` : "",
    percent < ruleset.table2.at(-1)!.min && available ? `Below ${ruleset.table2.at(-1)!.min}% earns no minutes points.` : "",
    debut && debutPoints >= minutesPoints
      ? `Youth Player debut for ${debut.club} (${monthLabel(debut.month)}, Band ${debutBand}): ${debutPoints} points.`
      : "",
  ];
  const estimated = spells.some((spell) => spell.estimated) || !!debut?.estimated;
  return { ...base, points, status: status(points, estimated), detail: parts.filter(Boolean).join(" ") };
}

function continental(evidence: GbeEvidence, ruleset: GbeRuleset, covered: boolean): GbeCriterionResult {
  const base = { criterion: "continental_minutes" as const, label: LABELS.continental_minutes, max: ruleset.table3[0].cells[0] };
  const byCompetition = new Map<string, GbeSpell[]>();
  for (const spell of evidence.continental) {
    const key = spell.catalogId ?? spell.competition;
    byCompetition.set(key, [...(byCompetition.get(key) ?? []), spell]);
  }
  if (!byCompetition.size)
    return {
      ...base,
      points: 0,
      status: covered ? "zero" : "no_data",
      detail: covered
        ? `No continental club football (group stage onwards) in the last ${ruleset.referenceMonths} months.`
        : `No continental records cover the last ${ruleset.referenceMonths} months yet.`,
    };
  let best = { points: -1, text: "", estimated: false };
  for (const spells of byCompetition.values()) {
    const band = gbeContinentalBand(ruleset, spells[0].catalogId);
    const available = spells.reduce((total, spell) => total + spell.available, 0);
    const played = spells.reduce((total, spell) => total + Math.min(spell.minutes, spell.available), 0);
    const percent = gbePercent(played, available);
    const points = gbeTable3(ruleset, percent, band);
    const text = `${spells[0].competition} (Band ${band}): ${minutes(played)} of ${minutes(available)} available minutes (${percent}%).`;
    if (points > best.points) best = { points, text, estimated: spells.some((spell) => spell.estimated) };
  }
  return { ...base, points: best.points, status: status(best.points, best.estimated), detail: best.text };
}

function finishRows(club: NonNullable<GbeEvidence["lastClub"]>, ruleset: GbeRuleset): { row: GbeFinish; why: string }[] {
  const rows: { row: GbeFinish; why: string }[] = [];
  if (club.champion) rows.push({ row: "title", why: "champions" });
  if (club.promoted) rows.push({ row: "promotion", why: "promoted" });
  if (club.relegated) rows.push({ row: "relegation", why: "relegated" });
  for (const place of club.qualified ?? []) {
    const band = gbeContinentalBand(ruleset, place.catalogId);
    if (band > 2) continue;
    rows.push({ row: `band${band}_${place.phase}` as GbeFinish, why: `qualified for the ${place.phase === "group" ? "group stage" : "qualifiers"} of the ${place.competition}` });
  }
  if (!rows.length) rows.push({ row: "mid_table", why: "mid-table" });
  return rows;
}

const uncovered = "No club records cover this period yet.";

function leaguePosition(evidence: GbeEvidence, ruleset: GbeRuleset, covered: boolean): GbeCriterionResult {
  const base = { criterion: "league_position" as const, label: LABELS.league_position, max: ruleset.table4.title[0] ?? 0 };
  const club = evidence.lastClub;
  const season = evidence.lastSeason.label;
  if (!club)
    return covered
      ? { ...base, points: 0, status: "zero", detail: `No senior club in the ${season} season (Last Season).` }
      : { ...base, points: 0, status: "no_data", detail: uncovered };
  if (!club.archived)
    return { ...base, points: 0, status: "no_data", detail: `${club.club}'s ${season} final league position is not on record.` };
  if (!club.listedLeague && evidence.cupPercent.lastSeason < 1)
    return {
      ...base,
      points: 0,
      status: club.estimated ? "estimate" : "zero",
      detail: `Not named in a ${club.club} matchday squad for a league match in ${season} (and under 1% of domestic cup minutes), so Table 4 does not apply.`,
    };
  const band = gbeLeagueBand(ruleset, club.countryCode, club.tier);
  const options = finishRows(club, ruleset).map((option) => ({ ...option, points: ruleset.table4[option.row][band - 1] ?? 0 }));
  const best = options.reduce((left, right) => (right.points > left.points ? right : left));
  const place = club.position && club.clubs ? `finished ${club.position} of ${club.clubs}` : "final position";
  return {
    ...base,
    points: best.points,
    status: status(best.points, club.estimated),
    detail: `${club.club} ${place} in ${season} (Band ${band}): ${GBE_FINISH_LABEL[best.row]}. ${best.points} points.${
      club.qualified === null ? " Continental qualification for this season is not known yet." : ""
    }`,
  };
}

function progression(evidence: GbeEvidence, ruleset: GbeRuleset, covered: boolean): GbeCriterionResult {
  const base = { criterion: "continental_progression" as const, label: LABELS.continental_progression, max: ruleset.table5.final[0] };
  const club = evidence.lastClub;
  const season = evidence.lastSeason.label;
  const eligibleLast = !!club && (club.listedAny || evidence.cupPercent.lastSeason >= 1);
  const runs = [...(eligibleLast ? club!.continental : []), ...evidence.currentRuns];
  if (!runs.length) {
    if (!club && !covered) return { ...base, points: 0, status: "no_data", detail: uncovered };
    if (club && !club.archived && !evidence.currentRuns.length)
      return { ...base, points: 0, status: "no_data", detail: `${club.club}'s ${season} continental record is not on file.` };
    const reason = !club
      ? `No senior club in the ${season} season and no continental appearance since.`
      : !eligibleLast && club.continental.length
        ? `Not named in a ${club.club} matchday squad in ${season}, so its continental run does not count.`
        : `${club.club} did not reach a continental group stage in ${season}.`;
    return { ...base, points: 0, status: club?.estimated ? "estimate" : "zero", detail: reason };
  }
  let best = { points: -1, run: runs[0], stage: "other" as GbeStage };
  for (const run of runs) {
    const stage = gbeStage(run.stage, run.knockoutOnly);
    const points = ruleset.table5[stage][gbeContinentalBand(ruleset, run.catalogId) - 1] ?? 0;
    if (points > best.points || (points === best.points && GBE_STAGE_ORDER.indexOf(stage) > GBE_STAGE_ORDER.indexOf(best.stage)))
      best = { points, run, stage };
  }
  const current = evidence.currentRuns.includes(best.run);
  return {
    ...base,
    points: best.points,
    status: status(best.points, best.run.estimated),
    detail: `${best.run.club} reached the ${GBE_STAGE_LABEL[best.stage]} of the ${best.run.competition} (Band ${gbeContinentalBand(ruleset, best.run.catalogId)}) ${
      current ? "this season (a competition started after the Last Season, with an appearance)" : `in ${season}`
    }. ${best.points} points.`,
  };
}

function leagueStandard(evidence: GbeEvidence, ruleset: GbeRuleset, covered: boolean): GbeCriterionResult {
  const base = { criterion: "league_standard" as const, label: LABELS.league_standard, max: ruleset.table6[0] };
  const club = evidence.currentClub;
  if (!club)
    return covered
      ? { ...base, points: 0, status: "zero", detail: "No club in the last half-season, so there is no Current Club." }
      : { ...base, points: 0, status: "no_data", detail: uncovered };
  if (!club.listed && evidence.cupPercent.reference < 1)
    return {
      ...base,
      points: 0,
      status: club.estimated ? "estimate" : "zero",
      detail: `Not named in a ${club.club} matchday squad for a league or continental match in the last ${ruleset.referenceMonths} months.`,
    };
  const band = gbeLeagueBand(ruleset, club.countryCode, club.tier);
  const parentBand = club.parent ? gbeLeagueBand(ruleset, club.parent.countryCode, club.parent.tier) : 6;
  const useParent = !!club.parent && parentBand < band;
  const points = ruleset.table6[(useParent ? parentBand : band) - 1];
  return {
    ...base,
    points,
    status: status(points, club.estimated),
    detail: useParent
      ? `On loan at ${club.club} (Band ${band}); appeared for parent club ${club.parent!.club} (Band ${parentBand}), whose band applies (¶47). ${points} points.`
      : `${club.club}${club.fallback ? " (Last Club: not yet named in a squad by the registered club)" : ""}, Band ${band}. ${points} points.`,
  };
}

function esc(evidence: GbeEvidence, ruleset: GbeRuleset, rank: number | null) {
  if (evidence.birthDate < ruleset.escBornOnOrAfter)
    return { eligible: false, detail: `Born before ${ruleset.escBornOnOrAfter}: not eligible for an ESC place.` };
  const inputs = evidence.esc;
  const top50 = rank !== null && rank <= 50;
  const met = [
    inputs.seniorCompetitiveCaps >= (top50 ? 1 : 5) && `${inputs.seniorCompetitiveCaps} senior competitive international${inputs.seniorCompetitiveCaps === 1 ? "" : "s"}`,
    inputs.youthInternationals >= (top50 ? 1 : 5) && `${inputs.youthInternationals} youth international${inputs.youthInternationals === 1 ? "" : "s"}`,
    inputs.continentalMatches >= 1 && `${inputs.continentalMatches} continental club match${inputs.continentalMatches === 1 ? "" : "es"}`,
    inputs.continentalYouthMatches >= 1 && `${inputs.continentalYouthMatches} continental youth match${inputs.continentalYouthMatches === 1 ? "" : "es"}`,
    inputs.domesticSeniorMatches >= 5 && `${inputs.domesticSeniorMatches} Band 1-5 league matches`,
    inputs.domesticYouthMatches >= 5 && `${inputs.domesticYouthMatches} youth competition matches in a Band 1-5 football nation`,
  ].filter((entry): entry is string => !!entry);
  return met.length
    ? { eligible: true, detail: `Elite Significant Contribution criteria met (${met.join("; ")}). Needs a free ESC place at a Premier League or EFL club.` }
    : { eligible: false, detail: `None of the Elite Significant Contribution criteria is met in the last ${ruleset.escMonths} months.` };
}

/** The assessment of one player on `evidence.asOf` under `ruleset`. */
export function calculateGbe(evidence: GbeEvidence, ruleset: GbeRuleset, options: { assumed?: boolean } = {}): GbeAssessment {
  const youth = evidence.birthDate >= ruleset.youthBornOnOrAfter;
  const referenceStart = gbeWindowStart(evidence.asOf, ruleset.referenceMonths);
  const covered = evidence.coverageFrom !== null && evidence.coverageFrom <= referenceStart;
  const breakdown = [
    international(evidence, ruleset, youth),
    domestic(evidence, ruleset, youth, covered),
    continental(evidence, ruleset, covered),
    leaguePosition(evidence, ruleset, covered),
    progression(evidence, ruleset, covered),
    leagueStandard(evidence, ruleset, covered),
  ];
  const points = breakdown.reduce((total, row) => total + row.points, 0);
  const autoPass = breakdown.some((row) => row.autoPass);
  const missing = breakdown.filter((row) => row.status === "no_data").length;
  const dataQuality: GbeAssessment["dataQuality"] =
    missing === breakdown.length
      ? "none"
      : missing
        ? "partial"
        : breakdown.some((row) => row.status === "estimate")
          ? "estimate"
          : "complete";
  const exempt = evidence.passportGroups.find((group) => ruleset.exemptPassportGroups.includes(group));
  const [panelFrom, panelTo] = ruleset.panel;
  const outcome: GbeAssessment["outcome"] = exempt
    ? "exempt"
    : dataQuality === "none"
      ? "no_data"
      : autoPass
        ? "auto_pass"
        : points >= ruleset.passMark
          ? "pass"
          : points >= panelFrom && points <= panelTo
            ? "panel"
            : "fail";
  const escResult = esc(evidence, ruleset, evidence.international?.rank ?? null);
  const notes = [
    exempt ? `${exempt === "GB" ? "British" : exempt === "IE" ? "Irish" : exempt} citizen: not a "Player" under the criteria, no endorsement needed.` : "",
    outcome === "panel"
      ? `${points} points is in the Exceptions Panel band (${panelFrom}-${panelTo}): the club may apply if it can show exceptional circumstances prevented ${ruleset.passMark} points.`
      : "",
    outcome === "fail" && youth ? "A Youth Player may also be referred to the Exceptions Panel for exceptional potential (¶27a), taking an ESC place." : "",
    !exempt && outcome !== "auto_pass" && outcome !== "pass" ? escResult.detail : "",
    breakdown.some((row) => row.status === "estimate")
      ? "Part of this record is a pre-game estimate of the seasons before the game began (derived from the player's role, club and national-team standing); it is replaced by played matches as the windows roll forward."
      : "",
    options.assumed ? `The criteria for this date are not published; the ${ruleset.title} are applied.` : "",
    !exempt ? "Only Premier League and EFL clubs can sponsor a player (¶3); clubs lower in the pyramid cannot register players who need an endorsement." : "",
  ].filter(Boolean);
  return {
    playerId: evidence.playerId,
    asOf: evidence.asOf,
    ruleset: ruleset.id,
    rulesetTitle: ruleset.title,
    ...(options.assumed ? { rulesetAssumed: true } : {}),
    source: ruleset.source,
    points,
    passMark: ruleset.passMark,
    autoPass,
    outcome,
    ...(exempt ? { exemptReason: exempt === "GB" ? "British citizen" : exempt === "IE" ? "Irish citizen" : `${exempt} citizen` } : {}),
    breakdown,
    dataQuality,
    esc: escResult,
    notes,
  };
}
