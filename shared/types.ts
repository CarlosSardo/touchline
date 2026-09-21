export type Position =
  "GK" | "CB" | "LB" | "RB" | "DM" | "CM" | "AM" | "LW" | "RW" | "ST";
export type AgeGroup = "Senior" | "U19" | "U17" | "U20";
export type SettingValue = string | number | boolean;
export type Settings = Record<string, SettingValue>;
export type Attributes = Record<string, number>;

export interface PlayerProfile {
  contract?: {
    status: "professional" | "amateur";
    futureProfessionalContract?: boolean;
    trainingClubId?: number;
    trainingStartAge?: number;
    expenseAllowance?: number;
    signedDate?: string;
  };
  familyMove?: {
    countryId: number;
    reason: "employment" | "family" | "football";
    verified: boolean;
    date: string;
  };
  identity: {
    heritage: { country: string; percentage: number }[];
    nationalities?: {
      countryId: number;
      code: string;
      country: string;
      basis: "birth" | "parent";
    }[];
    birthCountryId?: number;
    birthplace?: string;
    familyOrigins?: { maternal: string; paternal: string };
    biography?: string[];
    nameOriginCountryId?: number;
    internationalCountryId?: number;
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
  registration?: {
    workPermitPoints: number;
    adaptedCountries: number[];
    lastAssociationId?: number;
  };
}

export interface Player {
  id: number;
  name: string;
  nationality: string;
  nationalities?: string[];
  country_id: number;
  club_id: number | null;
  squad_club_id?: number | null;
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
  careerId?: string;
  careerName?: string;
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
  period?: number;
  addedTime?: number;
  elapsed?: number;
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
  discipline?: number;
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
  bench?: MatchPlayer[];
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
  rules?: {
    decisive: boolean;
    extraTime: boolean;
    neutral: boolean;
    awayGoals: boolean;
    substitutions: number;
    substitutionWindows: number;
    extraSubstitution: boolean;
    aggregate: {
      home: number;
      away: number;
      homeAwayGoals: number;
      awayAwayGoals: number;
    };
    injuryFrequency: number;
  };
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
  duration?: number;
  stoppageTime?: number[];
  regulationScore?: { home: number; away: number };
  wentToExtraTime?: boolean;
  winnerId?: number | null;
  shootout?: {
    home: number;
    away: number;
    kicks: {
      teamId: number;
      playerId: number;
      scored: boolean;
      probability: number;
    }[];
  };
  abandoned?: { teamId: number; reason: string };
  substitutions?: {
    teamId: number;
    offId: number;
    onId: number;
    minute: number;
    elapsed: number;
    window: number;
  }[];
  injuries?: { playerId: number; days: number }[];
  events: {
    minute: number;
    second?: number;
    addedTime?: number;
    period?: number;
    elapsed?: number;
    type: string;
    teamId: number;
    playerId: number;
    text: string;
    playerOnId?: number;
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

export interface TransferTerms {
  upfrontPercent: number;
  installments: number;
  intervalMonths: number;
  buyBackFee: number;
  buyBackYears: number;
  sellOnPercent: number;
}

export interface TransferPayment {
  id: number;
  negotiation_id: number;
  player_id: number;
  payer_id: number;
  payee_id: number;
  amount: number;
  due_date: string;
  paid_date: string | null;
  kind: "fee" | "sell-on";
  sell_on_clause_id: number | null;
  player_name?: string;
  payer_name?: string;
  payee_name?: string;
}

export interface BuyBackClause {
  id: number;
  negotiation_id: number;
  player_id: number;
  beneficiary_id: number;
  owner_id: number;
  fee: number;
  expires: string;
  status: "active" | "exercised" | "expired" | "void";
  player_name?: string;
  owner_name?: string;
  beneficiary_name?: string;
}

export interface SellOnClause {
  id: number;
  player_id: number;
  beneficiary_id: number;
  owner_id: number;
  percentage: number;
  status: string;
  paid: number;
  player_name: string;
  beneficiary_name: string;
  owner_name: string;
}

export interface AffiliateWillingness {
  willing: boolean;
  score: number;
  stance: string;
  annualFee: number;
  reasons: string[];
  benefits: string;
}

export interface PlayerInterest {
  score: number;
  stance: string;
  expectedRole: string;
  expectedWage: number;
  factors: { id: string; label: string; impact: number; reason: string }[];
  concerns: string[];
}

export interface NegotiationData {
  futureArrivalDate?: string;
  originalContractEnd?: string;
  reservedBudget?: number;
  guardianConsent?: boolean;
  interestDetails?: PlayerInterest;
  trainingCompensation?: number;
  trainingClubId?: number;
  preparedBy?: { id: number; name: string; date: string };
  transferTerms?: TransferTerms;
  buyBackClauseId?: number;
  workflowVersion?: number;
  buyerManaged?: boolean;
  nextStageDate?: string;
  signedDate?: string;
  registrationDate?: string;
  medicalPassed?: boolean;
  offerCount?: number;
  contractRevision?: number;
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
