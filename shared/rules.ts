import type {
  Player,
  PlayerProfile,
  Settings,
  SettingValue,
  TransferTerms,
  Club,
  AffiliateWillingness,
} from "./types.ts";
import type { SaveSlot } from "./api.ts";

export function groupCareerSaves(slots: SaveSlot[], search = "") {
  const groups = new Map<string, SaveSlot[]>();
  for (const slot of slots) {
    const key = slot.career?.id
      ? `career:${slot.career.id}`
      : `legacy:${slot.file}`;
    const snapshots = groups.get(key) ?? [];
    snapshots.push(slot);
    groups.set(key, snapshots);
  }
  const query = search.trim().toLowerCase();
  return [...groups]
    .map(([key, snapshots]) => {
      const sorted = snapshots.toSorted(
        (left, right) =>
          right.modified.localeCompare(left.modified) ||
          right.file.localeCompare(left.file),
      );
      return {
        key,
        latest: sorted[0],
        manual: sorted.filter((slot) => !slot.automatic),
        autosaves: sorted.filter((slot) => slot.automatic),
        count: sorted.length,
        size: sorted.reduce((total, slot) => total + slot.size, 0),
      };
    })
    .filter(
      (group) =>
        !query ||
        [...group.manual, ...group.autosaves].some((slot) =>
          `${slot.name} ${slot.career?.name ?? ""} ${slot.career?.director ?? ""} ${slot.career?.club ?? ""}`
            .toLowerCase()
            .includes(query),
        ),
    )
    .sort(
      (left, right) =>
        right.latest.modified.localeCompare(left.latest.modified) ||
        left.key.localeCompare(right.key),
    );
}

export const START_DATE = "2026-07-01";
/**
 * Player-interest bands (percent). Below `refuse` (interest in the move, wages excluded) the player will not
 * negotiate at all; from `agree` (overall interest, wages included) he accepts personal terms that meet his wage floor.
 * Stance labels: Not interested (< refuse, move) / Needs convincing (< refuse, overall) / Open to talks (< 70) /
 * Interested (< agree) / Very interested (>= agree).
 */
export const INTEREST_BANDS = { refuse: 50, interested: 70, agree: 85 } as const;
export const DEFAULT_TRANSFER_TERMS: TransferTerms = {
  upfrontPercent: 100,
  installments: 0,
  intervalMonths: 6,
  buyBackFee: 0,
  buyBackYears: 2,
  sellOnPercent: 0,
};
export const TRANSFER_STAGES = [
  "Enquiry",
  "Club talks",
  "Agent talks",
  "Contract review",
  "Medical",
  "Registration",
  "Completed",
];
export const ACTIVE_TRANSFER_STAGES = [
  ...TRANSFER_STAGES.slice(0, -1),
  "Offer received",
  "Scheduled",
];
export const MAP_MODES = [
  "Pass map",
  "Carry map",
  "Dribble map",
  "Shot map",
  "Defensive map",
  "Heatmap",
  "Pressing zones",
  "Fatigue map",
];
/** World v4 targets: seniors = first teams, B-teams and home-based pools; youth = U19 and U17 academies. */
export const WORLD_COUNTS = {
  seniors: 75_000,
  youth: 100_000,
  annualRegens: 18_000,
};
export const POSITIONS = [
  "GK",
  "CB",
  "LB",
  "RB",
  "DM",
  "CM",
  "AM",
  "LW",
  "RW",
  "ST",
] as const;
export const STAFF_ROLES = [
  "Assistant manager",
  "Head of youth",
  "Scout",
  "Physio",
  "Fitness coach",
  "Analyst",
  "Set-piece coach",
  "Goalkeeper coach",
  "Sporting director assistant",
];
export const ASSISTANT_ROLE = "Sporting director assistant";
export const ASSISTANT_DUTIES = [
  {
    id: "briefings",
    label: "Weekly briefing",
    description: "Summarize squad needs, expiring contracts and loan concerns.",
  },
  {
    id: "shortlist",
    label: "Recruitment shortlist",
    description:
      "Add a small selection of affordable targets to your shortlist.",
  },
  {
    id: "scouting",
    label: "Scouting assignments",
    description:
      "Send available scouts to assess targets within the weekly allowance.",
  },
  {
    id: "contracts",
    label: "Prepare renewals",
    description:
      "Negotiate draft renewals for expiring contracts; you still sign them.",
  },
  {
    id: "training",
    label: "Individual development",
    description: "Set individual training plans for the squad.",
  },
  {
    id: "loans",
    label: "Loan monitoring",
    description:
      "Report playing-time and development concerns without recalling players.",
  },
] as const;
export type AssistantDuty = (typeof ASSISTANT_DUTIES)[number]["id"];
export const DEFAULT_ASSISTANT_DUTIES: Record<AssistantDuty, boolean> = {
  briefings: true,
  shortlist: false,
  scouting: false,
  contracts: false,
  training: false,
  loans: false,
};
export const TRAINING_TYPES = [
  "Balanced",
  "Technical",
  "Physical",
  "Tactical",
  "Mental",
  "Role",
  "Position",
  "Youth development",
  "Injury rehab",
];
export const LOAN_TYPES = [
  "Standard loan",
  "Short loan",
  "Development loan",
  "Emergency loan",
  "Loan with option",
  "Loan with obligation",
  "Loan with sell-on",
  "Two-year loan",
  "Cross-border loan",
];
export const PARTNERSHIP_TYPES = [
  "Feeder club",
  "Friendly club",
  "Development club",
  "Scouting club",
  "Foreign adaptation club",
];
export const AFFILIATION_BENEFITS: Record<string, string> = {
  "Feeder club":
    "A senior-to-feeder player pathway with easier loan negotiations and wage sharing.",
  "Friendly club":
    "A balanced club relationship with cooperation and preferential loan discussions.",
  "Development club":
    "A shared focus on young-player minutes, development and loan monitoring.",
  "Scouting club":
    "A relationship aimed at local knowledge and access to a different recruitment market.",
  "Foreign adaptation club":
    "An overseas pathway to support language, cultural adaptation and development loans.",
};
export function affiliationWillingness(
  own: Club,
  partner: Club,
  purpose: string,
  networkSize: number,
): AffiliateWillingness {
  const reasons: string[] = [];
  const gap = own.reputation - partner.reputation;
  const domestic = own.country_id === partner.country_id;
  let score = 66;
  let blocked = false;
  if (
    partner.id === own.id ||
    partner.type !== "club" ||
    !PARTNERSHIP_TYPES.includes(purpose)
  ) {
    blocked = true;
    reasons.push(
      "A valid agreement needs two different senior clubs and an available affiliation type.",
    );
  }
  if (networkSize >= 8) {
    blocked = true;
    reasons.push(
      `${partner.name} do not want to expand their current affiliate network.`,
    );
  }
  if (purpose === "Feeder club") {
    if (gap < 5) {
      blocked = true;
      reasons.push(
        `${partner.name} will not act as a feeder to a club of similar or lower standing.`,
      );
    } else {
      score += Math.min(18, gap * 0.6);
      reasons.push(
        `A link to the more established ${own.name} offers a credible player pathway.`,
      );
    }
  } else if (purpose === "Friendly club") {
    score += (domestic ? 8 : 0) - Math.abs(gap) * 0.45;
    reasons.push(
      Math.abs(gap) <= 20
        ? "The clubs are close enough in standing for a balanced relationship."
        : "The reputation gap makes a balanced friendly partnership less attractive.",
    );
  } else if (purpose === "Development club") {
    score +=
      8 - Math.abs(gap) * 0.3 + Math.max(0, own.academy - partner.academy) / 12;
    reasons.push(
      "Regular development loans and a suitable level of football are the main attraction.",
    );
  } else if (purpose === "Scouting club") {
    score += domestic ? -8 : 12;
    score -= Math.max(0, -gap - 15) * 0.4;
    reasons.push(
      domestic
        ? "Both clubs already cover the same national market, reducing the scouting benefit."
        : "The clubs offer access to different national recruitment markets.",
    );
  } else if (purpose === "Foreign adaptation club") {
    if (domestic) {
      blocked = true;
      reasons.push(
        "An overseas-adaptation agreement requires clubs in different countries.",
      );
    } else {
      score += 12 - Math.max(0, -gap - 15) * 0.4;
      reasons.push(
        "The cross-border link offers a useful adaptation and loan pathway.",
      );
    }
  }
  if (own.league_id !== null && own.league_id === partner.league_id) {
    score -= 24;
    reasons.push(
      "Direct league competition makes sharing sporting advantages less appealing.",
    );
  }
  if (networkSize > 3) {
    score -= (networkSize - 3) * 4;
    reasons.push(
      "Existing partnerships already use some of the club's development capacity.",
    );
  }
  if (partner.balance < 0) {
    score += 5;
    reasons.push(
      "The partnership funding is attractive to the other club's finances.",
    );
  }
  const willingness = Math.round(
    clamp(blocked ? Math.min(score, 20) : score, 0, 99),
  );
  return {
    willing: !blocked && willingness >= 55,
    score: willingness,
    stance:
      !blocked && willingness >= 55
        ? "Open to this affiliation"
        : "Would decline this affiliation",
    annualFee: 100000 + Math.round(partner.reputation ** 2 * 60),
    reasons,
    benefits: AFFILIATION_BENEFITS[purpose] ?? "",
  };
}
export const PERSONALITY_KEYS = [
  "professionalism",
  "ambition",
  "loyalty",
  "ego",
  "discipline",
  "consistency",
  "pressureHandling",
  "emotionalStability",
  "leadership",
  "adaptability",
];
export const ATTRIBUTE_GROUPS = {
  technical: [
    "passing",
    "firstTouch",
    "dribbling",
    "finishing",
    "crossing",
    "longShots",
    "technique",
    "heading",
    "tackling",
    "freeKicks",
    "penalties",
  ],
  mental: [
    "composure",
    "concentration",
    "decisions",
    "vision",
    "workRate",
    "teamwork",
    "bravery",
    "anticipation",
    "determination",
  ],
  physical: [
    "pace",
    "acceleration",
    "strength",
    "stamina",
    "agility",
    "balance",
    "jumping",
    "naturalFitness",
  ],
  tactical: [
    "positioning",
    "offTheBall",
    "pressing",
    "marking",
    "spatialAwareness",
    "versatility",
    "transition",
  ],
  goalkeeper: [
    "reflexes",
    "handling",
    "aerialReach",
    "oneOnOnes",
    "distribution",
    "commandOfArea",
  ],
};

export const clamp = (value: number, min = 1, max = 99) =>
  Math.max(min, Math.min(max, value));
export const round = (value: number, decimals = 1) =>
  Math.round(value * 10 ** decimals) / 10 ** decimals;
/** An attribute as it stands today: the generated value moved by the ability gained or lost since generation. */
export const currentAttribute = (value: number, ability: number, baseAbility: number) =>
  clamp(value + ability - baseAbility);
/** Every attribute group as it stands today (what the player page shows and the match engine plays with). */
export function currentAttributes(
  profile: Pick<PlayerProfile, "attributes" | "baseAbility">,
  ability: number,
): PlayerProfile["attributes"] {
  const base = profile.baseAbility ?? ability;
  return Object.fromEntries(
    Object.entries(profile.attributes).map(([group, values]) => [
      group,
      Object.fromEntries(
        Object.entries(values).map(([key, value]) => [key, round(currentAttribute(value, ability, base))]),
      ),
    ]),
  ) as PlayerProfile["attributes"];
}
/**
 * Discipline scope of a competition: every league and cup keeps its own cautions and bans (a B-team plays in another
 * competition than its parent), play-offs count as their league, continental bans cover the confederation.
 */
export function disciplineScope(
  league: { id: number; kind: string; confederation: string; data?: string } | undefined,
) {
  if (!league) return "friendly";
  if (league.kind === "continental") return `${league.confederation}:senior`;
  if (league.kind === "international") return `national:${league.id}`;
  if (league.kind === "cup" && league.data?.includes('"playoff":true')) {
    const parent = (JSON.parse(league.data) as { leagueId?: number }).leagueId;
    if (parent) return `league:${parent}`;
  }
  return `${league.kind === "cup" ? "cup" : "league"}:${league.id}`;
}
/** Discipline scopes written before competitions were scoped individually (`country:age group:kind`). */
export const LEGACY_DISCIPLINE_SCOPE = "%:%:%";
export const label = (value: string) =>
  value
    .replace(/([A-Z])/g, " $1")
    .replace(/^./, (character) => character.toUpperCase());
export const CURRENCIES = [
  { code: "GBP", name: "British pound", rate: 1 },
  { code: "EUR", name: "Euro", rate: 1 / 0.86 },
  { code: "USD", name: "US dollar", rate: 1.3 },
  { code: "BRL", name: "Brazilian real", rate: 7 },
  { code: "JPY", name: "Japanese yen", rate: 190 },
  { code: "CHF", name: "Swiss franc", rate: 1.1 },
  { code: "CAD", name: "Canadian dollar", rate: 1.8 },
  { code: "AUD", name: "Australian dollar", rate: 2 },
] as const;
export type CurrencyCode = (typeof CURRENCIES)[number]["code"];
export const currencyCode = (value: unknown): CurrencyCode =>
  CURRENCIES.find((currency) => currency.code === value)?.code ?? "GBP";
export const displayAmount = (value: number, currency: CurrencyCode) =>
  round(value * CURRENCIES.find((entry) => entry.code === currency)!.rate, 2);
export const accountingAmount = (value: number, currency: CurrencyCode) =>
  round(value / CURRENCIES.find((entry) => entry.code === currency)!.rate, 2);
export const compactNumber = (value: number, decimals = 1) =>
  new Intl.NumberFormat("en-US", {
    notation: "compact",
    maximumFractionDigits: decimals,
  }).format(value);
export const money = (
  value: number,
  precise = false,
  currency: CurrencyCode = "GBP",
) =>
  new Intl.NumberFormat("en-US", {
    style: "currency",
    currency,
    notation: precise ? "standard" : "compact",
    maximumFractionDigits: precise ? 0 : 1,
  }).format(displayAmount(value, currency));
export const dateLabel = (value: string) =>
  new Date(`${value.slice(0, 10)}T12:00:00Z`).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  });
export const addDays = (date: string, days: number) => {
  const result = new Date(`${date}T12:00:00Z`);
  result.setUTCDate(result.getUTCDate() + days);
  return result.toISOString().slice(0, 10);
};
export const daysBetween = (start: string, end: string) =>
  Math.round((Date.parse(end) - Date.parse(start)) / 86_400_000);
export const addMonths = (date: string, months: number) => {
  const result = new Date(`${date}T12:00:00Z`);
  const day = result.getUTCDate();
  result.setUTCDate(1);
  result.setUTCMonth(result.getUTCMonth() + months);
  const monthEnd = new Date(
    Date.UTC(result.getUTCFullYear(), result.getUTCMonth() + 1, 0),
  ).getUTCDate();
  result.setUTCDate(Math.min(day, monthEnd));
  return result.toISOString().slice(0, 10);
};
export function transferPaymentPlan(
  fee: number,
  terms: TransferTerms,
  date: string,
) {
  const totalPence = Math.round(fee * 100);
  if (!terms.installments)
    return totalPence > 0 ? [{ date, amount: totalPence / 100 }] : [];
  const upfrontPence = Math.round((totalPence * terms.upfrontPercent) / 100);
  const deferredPence = totalPence - upfrontPence;
  return [
    { date, amount: upfrontPence / 100 },
    ...Array.from({ length: terms.installments }, (_, index) => ({
      date: addMonths(date, (index + 1) * terms.intervalMonths),
      amount:
        (Math.floor(deferredPence / terms.installments) +
          (index < deferredPence % terms.installments ? 1 : 0)) /
        100,
    })),
  ].filter((payment) => payment.amount > 0);
}
export const ageOn = (birth: string, date: string) =>
  Number(date.slice(0, 4)) -
  Number(birth.slice(0, 4)) -
  (date.slice(5) < birth.slice(5) ? 1 : 0);
export const internationalBreak = (date: string) => {
  const monthDay = date.slice(5);
  // FIFA 2026/27 windows: one merged September–October window (Nations League 24 Sep – 6 Oct), then Nov, Mar, June.
  return [
    ["09-21", "10-06"],
    ["11-09", "11-17"],
    ["03-22", "03-30"],
    ["06-07", "06-15"],
  ].some(([start, end]) => monthDay >= start && monthDay <= end);
};
/**
 * Last day of the winter registration period in `year`: 1 February (Premier League 2026/27: 1 Jan - 1 Feb 2027), moved
 * to the following Monday when 31 January falls on a weekend.
 */
export function winterWindowClose(year: number) {
  const weekday = new Date(Date.UTC(year, 0, 31)).getUTCDay();
  const day = weekday === 6 ? 2 : 1;
  return `${year}-02-0${day}`;
}
export const transferWindow = (date: string) => {
  const monthDay = date.slice(5);
  return (
    (monthDay >= "06-15" && monthDay <= "09-01") ||
    (monthDay <= "02-02" && date <= winterWindowClose(Number(date.slice(0, 4))))
  );
};
/** Whether `date` is the last day of a registration period. */
export const deadlineDay = (date: string) =>
  date.slice(5) === "09-01" || date === winterWindowClose(Number(date.slice(0, 4)));
export function adultTransferArrival(birthDate: string) {
  const birthday = new Date(`${birthDate}T12:00:00Z`);
  birthday.setUTCFullYear(birthday.getUTCFullYear() + 18);
  const eligible = birthday.toISOString().slice(0, 10);
  if (transferWindow(eligible)) return eligible;
  const year = birthday.getUTCFullYear();
  return eligible.slice(5) < "06-15" ? `${year}-06-15` : `${year + 1}-01-01`;
}

export interface SettingDefinition {
  id: string;
  label: string;
  group: string;
  type: "select" | "range" | "toggle" | "color";
  default: SettingValue;
  options?: string[];
  min?: number;
  max?: number;
  step?: number;
  disabled?: boolean;
}

export const NOTIFICATION_TOPICS = [
  {
    id: "notifyTransfers",
    label: "Transfers and contracts",
    categories: ["Transfers"],
  },
  {
    id: "notifySquad",
    label: "Squad and medical",
    categories: ["Squad", "Medical"],
  },
  { id: "notifyScouting", label: "Scouting reports", categories: ["Scouting"] },
  {
    id: "notifyAcademy",
    label: "Academy and development",
    categories: ["Academy", "Training"],
  },
  { id: "notifyFinance", label: "Finances", categories: ["Finance"] },
  {
    id: "notifyClub",
    label: "Board, staff and club",
    categories: ["Club", "Board", "Staff", "Director", "Events"],
  },
  { id: "notifyMedia", label: "Media coverage", categories: ["Media"] },
  { id: "notifyWorld", label: "World updates", categories: ["World"] },
  {
    id: "notifyMatches",
    label: "Club match reports",
    categories: ["Match", "Matches"],
  },
  {
    id: "notifyCompetitions",
    label: "Favorite competitions",
    categories: ["Competitions"],
  },
] as const;

export const COMPETITION_ALERTS = [
  "fixtures",
  "results",
  "draws",
  "tables",
  "winners",
] as const;
export const DEFAULT_COMPETITION_ALERTS = {
  fixtures: true,
  results: true,
  draws: true,
  tables: false,
  winners: true,
};

export const SETTING_DEFINITIONS: SettingDefinition[] = [
  {
    id: "notificationImportance",
    label: "Notification priority",
    group: "Notifications",
    type: "select",
    default: "all",
    options: ["all", "important"],
  },
  ...NOTIFICATION_TOPICS.map((topic): SettingDefinition => ({
    id: topic.id,
    label: topic.label,
    group: "Notifications",
    type: "toggle",
    default: true,
  })),
  {
    id: "currency",
    label: "Currency",
    group: "Interface",
    type: "select",
    default: "GBP",
    options: CURRENCIES.map((currency) => currency.code),
  },
  {
    id: "uiTheme",
    label: "UI theme",
    group: "Appearance",
    type: "select",
    default: "minimal",
    options: ["minimal", "classic"],
  },
  {
    id: "theme",
    label: "Appearance",
    group: "Appearance",
    type: "select",
    default: "light",
    options: ["light", "dark", "system"],
  },
  {
    id: "accent",
    label: "Accent color",
    group: "Appearance",
    type: "color",
    default: "#087f6d",
  },
  {
    id: "fontWeight",
    label: "Font weight",
    group: "Appearance",
    type: "select",
    default: "regular",
    options: ["regular", "medium", "bold"],
  },
  {
    id: "animationSpeed",
    label: "Animation speed",
    group: "Appearance",
    type: "select",
    default: "normal",
    options: ["off", "slow", "normal", "fast"],
  },
  {
    id: "haptics",
    label: "Haptic feedback",
    group: "Interface",
    type: "toggle",
    default: true,
  },
  {
    id: "blur",
    label: "Glass blur intensity",
    group: "Appearance",
    type: "range",
    default: 14,
    min: 0,
    max: 30,
    step: 1,
  },
  {
    id: "simulationSpeed",
    label: "Simulation speed",
    group: "Simulation",
    type: "select",
    default: "balanced",
    options: ["deliberate", "balanced", "fast"],
  },
  {
    id: "unexpectedEvents",
    label: "Unexpected events",
    group: "Simulation",
    type: "select",
    default: "medium",
    options: ["low", "medium", "high"],
  },
  {
    id: "autoCallUps",
    label: "Coach call-ups",
    group: "Simulation",
    type: "toggle",
    default: true,
  },
  {
    id: "youthRelease",
    label: "Release for youth tournaments outside FIFA windows",
    group: "Simulation",
    type: "select",
    default: "club policy",
    options: ["club policy", "always", "mandatory only"],
  },
  {
    id: "matchDetail",
    label: "Match detail",
    group: "Simulation",
    type: "select",
    default: "full",
    options: ["key events", "standard", "full"],
  },
  {
    id: "youthRealism",
    label: "Youth realism",
    group: "Simulation",
    type: "range",
    default: 75,
    min: 0,
    max: 100,
  },
  {
    id: "injuryFrequency",
    label: "Injury frequency",
    group: "Simulation",
    type: "range",
    default: 50,
    min: 0,
    max: 100,
  },
  {
    id: "transferInflation",
    label: "Annual transfer inflation",
    group: "Simulation",
    type: "range",
    default: 4,
    min: -10,
    max: 25,
  },
  {
    id: "negotiationDifficulty",
    label: "Negotiation difficulty",
    group: "Difficulty",
    type: "select",
    default: "realistic",
    options: ["relaxed", "realistic", "ruthless"],
  },
  {
    id: "boardStrictness",
    label: "Board strictness",
    group: "Difficulty",
    type: "range",
    default: 50,
    min: 0,
    max: 100,
  },
  {
    id: "mediaPressure",
    label: "Media pressure",
    group: "Difficulty",
    type: "range",
    default: 50,
    min: 0,
    max: 100,
  },
  {
    id: "fanPressure",
    label: "Fan pressure",
    group: "Difficulty",
    type: "range",
    default: 50,
    min: 0,
    max: 100,
  },
  {
    id: "ffp",
    label: "FFP enforcement",
    group: "Difficulty",
    type: "toggle",
    default: true,
  },
  {
    id: "colorblind",
    label: "Color vision",
    group: "Accessibility",
    type: "select",
    default: "default",
    options: ["default", "deuteranopia", "protanopia", "tritanopia"],
  },
  {
    id: "textSize",
    label: "Text size",
    group: "Accessibility",
    type: "range",
    default: 100,
    min: 85,
    max: 140,
    step: 5,
  },
  {
    id: "highContrast",
    label: "High contrast",
    group: "Accessibility",
    type: "toggle",
    default: false,
  },
  {
    id: "simplifiedUI",
    label: "Simplified interface",
    group: "Accessibility",
    type: "toggle",
    default: false,
  },
  {
    id: "regenStyle",
    label: "Regen style",
    group: "Gameplay",
    type: "select",
    default: "balanced",
    options: ["balanced", "regional", "global", "wonderkids"],
  },
  {
    id: "youthTournamentFrequency",
    label: "Youth tournament frequency",
    group: "Gameplay",
    type: "select",
    default: "normal",
    options: ["low", "normal", "high"],
  },
  {
    id: "agentIntensity",
    label: "Agent personality intensity",
    group: "Gameplay",
    type: "range",
    default: 60,
    min: 0,
    max: 100,
  },
  {
    id: "potentialIntensity",
    label: "Dynamic potential intensity",
    group: "Gameplay",
    type: "range",
    default: 60,
    min: 0,
    max: 100,
  },
  {
    id: "lifestyleImpact",
    label: "Lifestyle impact",
    group: "Gameplay",
    type: "range",
    default: 60,
    min: 0,
    max: 100,
  },
  {
    id: "directorBackground",
    label: "Director background",
    group: "Director",
    type: "select",
    default: "Former scout",
    options: [
      "Former scout",
      "Former player",
      "Negotiator",
      "Finance executive",
      "Academy director",
    ],
  },
  {
    id: "skillTreeMode",
    label: "Skill tree",
    group: "Director",
    type: "select",
    default: "specialist",
    options: ["specialist", "open", "disabled"],
  },
  {
    id: "reputationGrowth",
    label: "Reputation growth speed",
    group: "Director",
    type: "select",
    default: "normal",
    options: ["slow", "normal", "fast"],
  },
  {
    id: "autosave",
    label: "Autosave frequency",
    group: "Saves",
    type: "select",
    default: "weekly",
    options: ["off", "daily", "weekly", "monthly"],
  },
  {
    id: "chaos",
    label: "Chaos mode",
    group: "Experimental",
    type: "toggle",
    default: false,
  },
  {
    id: "ultraYouth",
    label: "Ultra-youth mode",
    group: "Experimental",
    type: "toggle",
    default: false,
  },
  {
    id: "directorDrama",
    label: "Director drama",
    group: "Experimental",
    type: "toggle",
    default: false,
  },
  {
    id: "weather",
    label: "Hyper-realistic weather",
    group: "Experimental",
    type: "toggle",
    default: false,
  },
];
export const DEFAULT_SETTINGS: Settings = {
  cloudSync: false,
  saveCompression: true,
  ...Object.fromEntries(
    SETTING_DEFINITIONS.map((setting) => [setting.id, setting.default]),
  ),
};

// 2025/26 market levels in GBP at a top-flight league factor of about 1: mid-table Premier League squad players
// (ability ≈ 73–77) £10–25M, elite players (88–95) £75–160M; lower leagues and small nations far less.
const PLAYER_QUALITY_VALUES: readonly (readonly [number, number])[] = [
  [1, 100],
  [15, 1_000],
  [25, 5_000],
  [35, 30_000],
  [45, 120_000],
  [55, 330_000],
  [65, 1_800_000],
  [75, 14_000_000],
  [85, 55_000_000],
  [95, 160_000_000],
  [99, 220_000_000],
];
/** Player values stay within these bounds (world invariant 5). */
export const VALUE_RANGE = { min: 100, max: 250_000_000 } as const;

function qualityValue(ability: number) {
  for (let index = 1; index < PLAYER_QUALITY_VALUES.length; index++) {
    const [lowerAbility, lowerValue] = PLAYER_QUALITY_VALUES[index - 1];
    const [upperAbility, upperValue] = PLAYER_QUALITY_VALUES[index];
    if (ability <= upperAbility)
      return lowerValue * (upperValue / lowerValue) ** ((ability - lowerAbility) / (upperAbility - lowerAbility));
  }
  return PLAYER_QUALITY_VALUES[PLAYER_QUALITY_VALUES.length - 1][1];
}

export function valuation(
  player: Pick<
    Player,
    | "ability"
    | "potential"
    | "age"
    | "position"
    | "contract_end"
    | "form"
    | "injury_until"
  >,
  context: {
    date: string;
    leagueReputation: number;
    /** Market price level of the league nation (world-catalog MARKET_VALUE_FACTOR, server-side); default 1. */
    marketFactor?: number;
    balance: number;
    philosophy: string;
    inflation: number;
    crisis: number;
    hype: number;
    /** Youth international visibility multiplier (exposureValueFactor), 1–1.1. */
    exposure?: number;
  },
) {
  const ability = clamp(player.ability);
  const quality = qualityValue(ability);
  // Young players are priced on half of their projected upside (at most 15 points), fading out by 24.
  const upside =
    clamp(clamp(player.potential) - ability, 0, 30) *
    clamp((24 - player.age) / 8, 0, 1) *
    0.5;
  const potential = qualityValue(clamp(ability + upside)) / quality;
  const resalePeakAge = player.position === "GK" ? 31 : 28;
  const age =
    clamp((player.age - 12) / 7, 0.15, 1) *
    clamp(Math.exp(-Math.max(0, player.age - resalePeakAge) / 4.5), 0.025, 1);
  const position = {
    GK: 0.78,
    CB: 0.9,
    LB: 0.9,
    RB: 0.9,
    DM: 0.95,
    CM: 1,
    AM: 1.05,
    LW: 1.1,
    RW: 1.1,
    ST: 1.12,
  }[player.position];
  // Ability already separates the leagues; this is the market premium of richer leagues for equal quality.
  const league =
    (0.3 + 0.8 * (clamp(context.leagueReputation, 0, 100) / 100) ** 2) *
    clamp(context.marketFactor ?? 1, 0.1, 1.5);
  const months = clamp(
    daysBetween(context.date, player.contract_end) / 30.44,
    0,
    60,
  );
  const contract =
    months <= 12
      ? (months / 12) * 0.45
      : months <= 36
        ? 0.45 + ((months - 12) / 24) * 0.55
        : 1 + ((months - 36) / 24) * 0.1;
  const elapsed = Math.max(0, daysBetween(START_DATE, context.date) / 365.25);
  const inflation = clamp(
    (1 + clamp(context.inflation, -5, 10) / 100) ** Math.min(elapsed, 50),
    0.75,
    1.75,
  );
  const form = clamp(1 + (player.form - 6.5) * 0.035, 0.85, 1.1);
  const hype = 1 + clamp(context.hype, -100, 100) / 1000;
  const injuryDays = player.injury_until
    ? Math.max(0, daysBetween(context.date, player.injury_until))
    : 0;
  const injury = 1 - clamp(injuryDays / 365.25, 0, 1) * 0.3;
  const market = inflation * form * hype * injury * clamp(context.exposure ?? 1, 1, 1.1);
  const finances =
    context.balance < 0 ? 0.9 : context.balance > 100_000_000 ? 1.05 : 1;
  const philosophy =
    context.philosophy === "Develop and sell"
      ? 0.97
      : context.philosophy === "Win now"
        ? 1.05
        : 1;
  const standings = 1 - clamp(context.crisis, 0, 100) / 500;
  const value = clamp(
    Math.round(
      (quality *
        potential *
        age *
        position *
        league *
        contract *
        market *
        finances *
        philosophy *
        standings) /
        100,
    ) * 100,
    VALUE_RANGE.min,
    VALUE_RANGE.max,
  );
  return {
    value,
    layers: {
      "Player quality": quality,
      "Potential value": potential,
      "Age curve": age,
      "Position index": position,
      "League reputation": league,
      Contract: contract,
      "Market context": market,
      "Club finances": finances,
      "Club philosophy": philosophy,
      "Standings pressure": standings,
    },
  };
}

export const ADULT_LIFESTYLES = [
  "disciplined",
  "nightlife",
  "family-focused",
  "luxury-obsessed",
  "gym-rat",
] as const;
/** Lifestyle effect on potential; zero on average over ADULT_LIFESTYLES (minors' lifestyles count as neutral). */
const LIFESTYLE_EFFECT: Record<string, number> = {
  disciplined: 0.3,
  nightlife: -0.45,
  "family-focused": 0.15,
  "luxury-obsessed": -0.2,
  "gym-rat": 0.2,
};

/** Weight of the influences on potential by age: a youth's ceiling is still being formed, a veteran's is set. */
export function potentialDriftScale(age: number, position?: string) {
  const years = age - (position === "GK" ? 2.5 : 0);
  return years < 21 ? 1 : years < 24 ? 0.6 : years < 28 ? 0.3 : 0.1;
}

/**
 * Weekly influences on potential. Every factor is centred on the generated population (an average player at an
 * average club scores 0), so potential only drifts up or down with a better or worse environment than typical.
 * `performance` (centred match ratings this week) and `minutesShare` (share of team minutes) come from the simulation.
 */
export function potentialInfluences(
  player: Player,
  profile: PlayerProfile,
  context: {
    staff: number;
    academy: number;
    chemistry: number;
    fit: number;
    culture: string;
    director: number;
    fans: number;
    media: number;
    tournament: number;
    intensity: number;
    lifestyleImpact: number;
    performance?: number;
    minutesShare?: number;
  },
) {
  const factors = {
    personality:
      (profile.personality.professionalism +
        profile.personality.ambition +
        profile.personality.discipline -
        172) /
      150,
    lifestyle:
      player.age < 18
        ? 0
        : ((LIFESTYLE_EFFECT[profile.lifestyle] ?? 0) * context.lifestyleImpact) / 60,
    staff: (context.staff - 50) / 125,
    tournaments: context.tournament / 200,
    performance: clamp(context.performance ?? 0, -1.5, 1.5) * 0.8,
    minutes:
      context.minutesShare === undefined
        ? 0
        : (clamp(context.minutesShare, 0, 1) - 0.5) * 0.8,
    injuries: player.injury_until ? -0.45 : 0.02,
    media: (profile.personality.pressureHandling - 57 - (context.media - 50)) / 250,
    fans: (context.fans - 72) / 200,
    tacticalFit: (context.fit - 77) / 150,
    clubCulture:
      context.culture === "Development"
        ? 0.15
        : context.culture === "Demanding" &&
            profile.personality.pressureHandling < 45
          ? -0.25
          : -0.02,
    academy: player.age < 21 ? (context.academy - 53) / 150 : 0,
    chemistry: (context.chemistry - 69) / 200,
    director: (context.director - 40) / 250,
    mentalHealth:
      (profile.mentalHealth.motivation -
        profile.mentalHealth.burnout -
        profile.mentalHealth.anxiety / 2 -
        51) /
      200,
    confidence: (player.morale - 70) / 300,
  };
  const change =
    (Object.values(factors).reduce((sum, value) => sum + value, 0) *
      0.065 *
      context.intensity *
      potentialDriftScale(player.age, player.position)) /
    60;
  return {
    factors,
    change,
    low: clamp(Math.floor(player.potential - player.volatility)),
    high: clamp(Math.ceil(player.potential + player.volatility)),
  };
}

export function loanScore(factors: Record<string, number>) {
  const weights: Record<string, number> = {
    minutes: 0.2,
    position: 0.09,
    tacticalFit: 0.1,
    development: 0.13,
    performance: 0.12,
    personality: 0.05,
    lifestyle: 0.05,
    injury: 0.06,
    environment: 0.07,
    trust: 0.08,
    fans: 0.05,
  };
  return Math.round(
    clamp(
      Object.entries(weights).reduce(
        (sum, [key, weight]) =>
          sum + clamp(factors[key] ?? 50, 0, 100) * weight,
        0,
      ),
      0,
      100,
    ),
  );
}

export function tacticalFit(
  player: Player,
  club: { formation: string; tactical_style: string },
) {
  const preferred: Record<string, string[]> = {
    Possession: ["CM", "AM", "DM", "CB"],
    "High press": ["ST", "LW", "RW", "CM"],
    "Counter attack": ["LW", "RW", "ST", "DM"],
    Direct: ["ST", "CB", "RB", "LB"],
    Balanced: [...POSITIONS],
  };
  const positionFit = preferred[club.tactical_style]?.includes(player.position)
    ? 84
    : 65;
  const roleFit =
    club.formation === "3-5-2" && ["LW", "RW"].includes(player.position)
      ? -20
      : club.formation === "4-3-3" && player.position === "AM"
        ? -12
        : 0;
  return clamp(positionFit + roleFit + (player.morale - 60) / 5, 0, 100);
}
