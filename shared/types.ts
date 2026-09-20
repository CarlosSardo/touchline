export type Position =
  "GK" | "CB" | "LB" | "RB" | "DM" | "CM" | "AM" | "LW" | "RW" | "ST";
export type AgeGroup = "Senior" | "U19" | "U17" | "U20";
export type SettingValue = string | number | boolean;
export type Settings = Record<string, SettingValue>;
export type Attributes = Record<string, number>;

export interface PlayerProfile {
  identity: {
    heritage: { country: string; percentage: number }[];
    languages: { language: string; fluency: number }[];
    region: string;
    height: number;
    weight: number;
    bodyType: string;
  };
  attributes: Record<
    "technical" | "mental" | "physical" | "tactical" | "goalkeeper",
    Attributes
  >;
  personality: Attributes;
  traits: string[];
  lifestyle: string;
  mentalHealth: {
    confidence: number;
    anxiety: number;
    burnout: number;
    motivation: number;
  };
  careerVision: string[];
  baseAbility: number;
  agent: {
    name: string;
    personality: string;
    difficulty: number;
    commission: number;
    frustration: number;
  };
  development: {
    growthSpurt: boolean;
    mentorId: number | null;
    history: { date: string; ability: number; potential: number }[];
    positionTarget?: Position;
    positionWeeks?: number;
    lastSupport?: string;
  };
  relationships: { group: string; loyalty: number; influence: number };
  registration?: { workPermitPoints: number; adaptedCountries: number[] };
}

export interface Player {
  id: number;
  name: string;
  nationality: string;
  country_id: number;
  club_id: number | null;
  parent_club_id: number | null;
  position: Position;
  secondary_position: Position;
  birth_date: string;
  age: number;
  age_group: AgeGroup;
  foot: string;
  ability: number;
  base_potential: number;
  potential: number;
  volatility: number;
  value: number;
  wage: number;
  contract_end: string;
  morale: number;
  fitness: number;
  injury_until: string | null;
  form: number;
  goals: number;
  assists: number;
  appearances: number;
  minutes: number;
  role: string;
  training: string;
  intensity: number;
  profile: string;
  shortlisted: number;
  listed: number;
  available_loan: number;
  knowledge: number;
  development_bank: number;
  potential_bank: number;
  loan_progress: number;
  club_name?: string;
  club_color?: string;
  country_name?: string;
  country_code?: string;
  report?: ScoutReport;
  details?: PlayerProfile;
}

export interface Country {
  id: number;
  code: string;
  name: string;
  continent: string;
  confederation: string;
  reputation: number;
  language: string;
  region: string;
}

export interface Club {
  id: number;
  name: string;
  short_name: string;
  city: string;
  country_id: number;
  league_id: number | null;
  type: "club" | "bteam" | "national";
  parent_id: number | null;
  age_group: AgeGroup;
  color: string;
  reputation: number;
  academy: number;
  facilities: number;
  balance: number;
  transfer_budget: number;
  wage_budget: number;
  philosophy: string;
  culture: string;
  formation: string;
  tactical_style: string;
  chemistry: number;
  manager: string;
  manager_trust: number;
  board_confidence: number;
  board_pressure: number;
  fan_mood: number;
  fan_loyalty: number;
  fan_patience: number;
  expectations: number;
  momentum: number;
  crisis: number;
  hype: number;
  income: number;
  spending: number;
  season_spend: number;
  ffp: number;
  stadium: string;
  capacity: number;
  data: string;
  country_name?: string;
  country_code?: string;
  league_name?: string;
}

export interface League {
  id: number;
  name: string;
  country_id: number | null;
  confederation: string;
  tier: number;
  age_group: AgeGroup;
  kind: "league" | "cup" | "continental" | "international" | "youth";
  reputation: number;
  format: string;
  data: string;
  country_name?: string;
}

export interface Standing {
  league_id: number;
  club_id: number;
  group_name: string;
  played: number;
  wins: number;
  draws: number;
  losses: number;
  gf: number;
  ga: number;
  points: number;
  xg: number;
  xga: number;
  xpts: number;
  form: string;
  home_record: string;
  away_record: string;
  deducted: number;
  club_name?: string;
  club_color?: string;
  reputation?: number;
}

export interface Fixture {
  id: number;
  league_id: number | null;
  date: string;
  season: number;
  home_id: number;
  away_id: number;
  stage: string;
  group_name: string;
  round: number;
  status: string;
  home_goals: number | null;
  away_goals: number | null;
  home_xg: number | null;
  away_xg: number | null;
  seed: string;
  data: string;
  home_name?: string;
  away_name?: string;
  home_color?: string;
  away_color?: string;
  competition_name?: string;
  age_group?: AgeGroup;
}

export interface Staff {
  id: number;
  club_id: number | null;
  name: string;
  role: string;
  ability: number;
  influence: number;
  communication: number;
  tactical_knowledge: number;
  personality: string;
  ambition: number;
  morale: number;
  wage: number;
  data: string;
}

export interface ScoutReport {
  id: number;
  player_id: number;
  staff_id: number;
  date: string;
  accuracy: number;
  ability_low: number;
  ability_high: number;
  potential_low: number;
  potential_high: number;
  fit: number;
  risk: number;
  data: string;
  player_name?: string;
  scout_name?: string;
}

export interface GameState {
  date: string;
  season: number;
  seed: string;
  clubId: number;
  started: boolean;
  director: {
    name: string;
    background: string;
    reputation: number;
    experience: number;
    skillPoints: number;
    skills: Record<string, number>;
  };
  week: number;
  worldTrend: string;
  lastAutosave: string;
  gameOver: boolean;
}

export interface NewsItem {
  id: number;
  date: string;
  category: string;
  title: string;
  body: string;
  severity: string;
  read: number;
  action: string | null;
  data: string;
}

export interface MatchAction {
  minute: number;
  second: number;
  teamId: number;
  playerId: number;
  targetId?: number;
  x: number;
  y: number;
  endX: number;
  endY: number;
  type: string;
  outcome: string;
  difficulty: number;
  xg?: number;
  xa?: number;
  progressive?: boolean;
  key?: boolean;
  fatigue: number;
}

export interface MatchPlayer {
  id: number;
  name: string;
  position: Position;
  ability: number;
  fitness: number;
  confidence: number;
  traits?: string[];
  attributes?: Record<string, number>;
  pressureHandling?: number;
  consistency?: number;
  height?: number;
  stats?: Record<string, number>;
}

export interface MatchTeam {
  id: number;
  name: string;
  color: string;
  ability: number;
  style: string;
  formation: string;
  chemistry: number;
  momentum: number;
  pressure: number;
  lineup: MatchPlayer[];
  setPieces: { routine: string; target: string; risk: number };
}

export interface MatchSnapshot {
  rulesVersion?: number;
  home: MatchTeam;
  away: MatchTeam;
  weather: string;
  importance: number;
  detail: string;
  conditions?: { temperature: number; wind: number; humidity: number };
}

export interface MatchResult {
  homeGoals: number;
  awayGoals: number;
  homeXg: number;
  awayXg: number;
  homeXpts: number;
  awayXpts: number;
  actions: MatchAction[];
  stats: Record<number, Record<string, number>>;
  players: Record<number, Record<string, number>>;
  momentum: { minute: number; home: number; away: number }[];
  events: {
    minute: number;
    type: string;
    teamId: number;
    playerId: number;
    text: string;
  }[];
}

export interface LoanTerms {
  playingTime: number;
  position: Position;
  role: string;
  developmentPlan: string;
  recall: boolean;
  injuryRecall: boolean;
  salarySplit: number;
  fee: number;
  bonus: number;
  mandatoryMinutes: number;
  tacticalFit: number;
  managerTrust: number;
  relationship: number;
  optionFee: number;
  sellOn: number;
  duration: number;
  obligationCondition: "Unconditional" | "Minutes played" | "Avoid relegation";
}

export interface Loan {
  id: number;
  player_id: number;
  parent_id: number;
  destination_id: number;
  type: string;
  start_date: string;
  end_date: string;
  status: string;
  score: number;
  pressure: number;
  fit: number;
  relationship: number;
  terms: string;
  data: string;
  player_name?: string;
  position?: Position;
  age?: number;
  parent_name?: string;
  destination_name?: string;
  destination_color?: string;
  ability?: number;
  potential?: number;
}

export interface Negotiation {
  id: number;
  player_id: number;
  buying_club_id: number;
  selling_club_id: number | null;
  type: string;
  stage: string;
  tension: number;
  asking_price: number;
  offer: number;
  wage: number;
  interest: number;
  created: string;
  deadline: string;
  public: number;
  data: string;
  player_name?: string;
  position?: Position;
  age?: number;
  ability?: number;
  potential?: number;
  buyer_name?: string;
  seller_name?: string;
}

export interface NegotiationData {
  log: { date: string; message: string; type: string }[];
  agent: PlayerProfile["agent"];
  terms: LoanTerms;
  years: number;
  role: string;
  promises: string[];
  medicalDate?: string;
  counter?: number;
  requiredWage?: number;
  declared?: boolean;
  leak?: boolean;
  hijack?: boolean;
  sabotage?: boolean;
  signingBonus?: number;
}
