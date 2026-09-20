import type { Player, PlayerProfile, Settings, SettingValue } from "./types.ts";

export const START_DATE = "2026-07-01";
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
export const WORLD_COUNTS = {
  seniors: 120_000,
  youth: 40_000,
  annualRegens: 15_000,
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
];
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
export const label = (value: string) =>
  value
    .replace(/([A-Z])/g, " $1")
    .replace(/^./, (character) => character.toUpperCase());
export const money = (value: number, precise = false) =>
  new Intl.NumberFormat("en-GB", {
    style: "currency",
    currency: "GBP",
    notation: precise ? "standard" : "compact",
    maximumFractionDigits: precise ? 0 : 1,
  }).format(value);
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
export const ageOn = (birth: string, date: string) =>
  Number(date.slice(0, 4)) -
  Number(birth.slice(0, 4)) -
  (date.slice(5) < birth.slice(5) ? 1 : 0);
export const internationalBreak = (date: string) => {
  const monthDay = date.slice(5);
  return [
    ["09-01", "09-15"],
    ["10-05", "10-13"],
    ["11-09", "11-17"],
    ["03-22", "03-30"],
    ["06-01", "06-15"],
  ].some(([start, end]) => monthDay >= start && monthDay <= end);
};
export const transferWindow = (date: string) => {
  const monthDay = date.slice(5);
  return (
    (monthDay >= "06-15" && monthDay <= "09-01") ||
    (monthDay >= "01-01" && monthDay <= "01-31")
  );
};

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

export const SETTING_DEFINITIONS: SettingDefinition[] = [
  {
    id: "theme",
    label: "Appearance",
    group: "Interface",
    type: "select",
    default: "light",
    options: ["light", "dark", "system"],
  },
  {
    id: "accent",
    label: "Accent color",
    group: "Interface",
    type: "color",
    default: "#087f6d",
  },
  {
    id: "fontWeight",
    label: "Font weight",
    group: "Interface",
    type: "select",
    default: "regular",
    options: ["regular", "medium", "bold"],
  },
  {
    id: "animationSpeed",
    label: "Animation speed",
    group: "Interface",
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
    group: "Interface",
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
    id: "cloudSync",
    label: "Cloud sync (local-only game)",
    group: "Saves",
    type: "toggle",
    default: false,
    disabled: true,
  },
  {
    id: "saveCompression",
    label: "Save compression",
    group: "Saves",
    type: "toggle",
    default: true,
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
export const DEFAULT_SETTINGS: Settings = Object.fromEntries(
  SETTING_DEFINITIONS.map((setting) => [setting.id, setting.default]),
);

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
    balance: number;
    philosophy: string;
    inflation: number;
    crisis: number;
    hype: number;
  },
) {
  const quality = 100_000_000 * (player.ability / 100) ** 5;
  const potential =
    1 +
    (Math.max(0, player.potential - player.ability) / 60) *
      (player.age < 25 ? 1 : 0.25);
  const age =
    player.age <= 17
      ? 0.65
      : player.age <= 20
        ? 0.9
        : player.age <= 24
          ? 1.2
          : player.age <= 28
            ? 1.1
            : player.age <= 31
              ? 0.75
              : player.age <= 34
                ? 0.42
                : 0.2;
  const position = {
    GK: 0.65,
    CB: 0.85,
    LB: 0.9,
    RB: 0.9,
    DM: 0.92,
    CM: 1,
    AM: 1.1,
    LW: 1.17,
    RW: 1.17,
    ST: 1.22,
  }[player.position];
  const league = 0.2 + context.leagueReputation / 125;
  const months = Math.max(
    0,
    daysBetween(context.date, player.contract_end) / 30.44,
  );
  const contract = months === 0 ? 0 : clamp(months / 36, 0.15, 1.2);
  const elapsed = Math.max(0, daysBetween(START_DATE, context.date) / 365.25);
  const market = Math.max(
    0.2,
    (1 + context.inflation / 100) ** elapsed +
      (player.form - 6.5) * 0.035 +
      context.hype / 1000 -
      (player.injury_until && player.injury_until > context.date ? 0.16 : 0),
  );
  const finances =
    context.balance < 0 ? 0.78 : context.balance > 100_000_000 ? 1.1 : 1;
  const philosophy =
    context.philosophy === "Develop and sell"
      ? 0.94
      : context.philosophy === "Win now"
        ? 1.08
        : 1;
  const standings = clamp(
    1 + context.hype / 700 - context.crisis / 500,
    0.65,
    1.25,
  );
  const value =
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
        1000,
    ) * 1000;
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
  },
) {
  const factors = {
    personality:
      (profile.personality.professionalism +
        profile.personality.ambition +
        profile.personality.discipline -
        150) /
      150,
    lifestyle:
      (({
        disciplined: 0.4,
        nightlife: -0.55,
        "family-focused": 0.2,
        "luxury-obsessed": -0.2,
        "gym-rat": 0.35,
      }[profile.lifestyle] ?? 0) *
        context.lifestyleImpact) /
      60,
    staff: (context.staff - 50) / 125,
    tournaments: context.tournament / 100,
    injuries: player.injury_until ? -0.55 : 0.05,
    media: (profile.personality.pressureHandling - context.media) / 250,
    fans: (context.fans - 50) / 200,
    tacticalFit: (context.fit - 50) / 150,
    clubCulture:
      context.culture === "Development"
        ? 0.3
        : context.culture === "Demanding" &&
            profile.personality.pressureHandling < 45
          ? -0.3
          : 0.05,
    academy: player.age < 21 ? (context.academy - 40) / 150 : 0,
    chemistry: (context.chemistry - 50) / 200,
    director: (context.director - 40) / 250,
    mentalHealth:
      (profile.mentalHealth.motivation -
        profile.mentalHealth.burnout -
        profile.mentalHealth.anxiety / 2) /
      200,
    confidence: (player.morale - 50) / 200,
    age: player.age < 23 ? 0.1 : player.age > 29 ? -0.45 : -0.1,
  };
  const change =
    (Object.values(factors).reduce((sum, value) => sum + value, 0) *
      0.065 *
      context.intensity) /
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
