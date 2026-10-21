import type { EligibilitySummary } from "./eligibility.ts";
export type Position =
  "GK" | "CB" | "LB" | "RB" | "DM" | "CM" | "AM" | "LW" | "RW" | "ST";
export type AgeGroup = "Senior" | "U19" | "U17" | "U20" | "U21";
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
    /** Adult targets for natural height/weight development (server/growth.ts); maturation -1 early … 1 late. */
    growth?: { adultHeight: number; adultWeight: number; maturation: number };
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
    /** Share of team minutes last measured (carries a player's playing time into the next season's first weeks). */
    minutesShare?: number;
    /** Adult lifestyle drawn (minors only draw positive lifestyles). */
    adultLifestyle?: boolean;
  };
  relationships: { group: string; loyalty: number; influence: number };
  registration?: {
    workPermitPoints: number;
    adaptedCountries: number[];
    lastAssociationId?: number;
  };
  /** Club-less player of a nation without an own league (home-based pool). */
  homeBased?: { countryId: number; since: string };
  intake?: {
    season: number;
    source: "academy" | "grassroots" | "trial" | "top-up" | "pool";
  };
  retirement?: {
    season: number;
    date: string;
    reason: "retired" | "left-football";
  };
  /** Announced on 1 May (user's club family): retires at the end of `season`. */
  retirementPlan?: { season: number; announced: string };
  /** Visibility from youth national-team finals (shared/features/youth-internationals.ts); fades over time. */
  international?: { value: number; date: string; tournament: string };
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
  /** Registration badge in squad and club lists (server/eligibility.ts eligibilitySummaries). */
  eligibility?: EligibilitySummary;
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

/** B-team policy of an association (world audit); built by shared/world-rules.ts from the catalog. */
export interface ReservePolicy {
  mode: "pyramid" | "separate" | "none" | "unverified";
  competition:
    | "senior-pyramid"
    | "reserve-league"
    | "closed-development"
    | "none"
    | "unknown";
  highestTier: number | null;
  entryTier: number | null;
  professional: boolean | null;
  gap: number;
  naming: "B" | "II" | "2" | "U23" | "Jong" | "Reserves";
  /** Catalog name template, e.g. "{club} B" or "Jong {club}". */
  nameTemplate?: string;
  /** Maximum number of B-teams. */
  maxTeams?: number;
  evidence: "documented" | "historical" | "unverified";
  verification: "official-rule" | "official-participation" | "secondary" | "unverified";
  summary: string;
  source: string;
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
  /** Called-up first-team debutant: substitution gate (shared/features/callups.ts `debutSubAllowed`). */
  callUpDebut?: "lead" | "open" | "hold";
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
  /** League scoring level relative to the engine reference (shared/league-rules.ts matchGoalFactor); rules 4+. */
  goalFactor?: number;
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
  buyer_color?: string;
  buyer_reputation?: number;
  seller_name?: string;
  /** Transfer desk only: rivals for this player as the director knows them (data.rivals is removed). */
  rivals?: RivalInterest[];
  battle?: TransferBattleView | null;
  affiliatePlacementOptions?: AffiliateOption[];
  onwardLoanOptions?: AffiliateOption[];
}

export interface TransferTerms {
  upfrontPercent: number;
  installments: number;
  intervalMonths: number;
  buyBackFee: number;
  buyBackYears: number;
  sellOnPercent: number;
  /** The selling club keeps the player on loan after the sale ("none"/absent: he joins the buyer at once). */
  loanBack?: LoanBackOption;
}

export type LoanBackOption = "none" | "season" | "year" | "two-seasons";

/** An onward loan the buying club arranged to one of its affiliates, started as the signing registers. */
export interface OnwardLoanPlan {
  clubId: number;
  clubName: string;
  until: "season" | "year";
  setOn: string;
}

/** A future signing already registered at one of the buyer's affiliates in the player's own association. */
export interface AffiliatePlacement {
  clubId: number;
  clubName: string;
  date: string;
  originalSellerId: number;
  originalSellerName: string;
  fee: number;
}

export interface AffiliateOption {
  clubId: number;
  clubName: string;
  eligible: boolean;
  reasons: string[];
  strength: number;
  squadCount: number;
  adjustedArrival?: string;
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
  /** Interest in the move itself, wages excluded (absent in saves before the refusal rule). */
  moveScore?: number;
  /** The player refuses personal terms whatever the wage. */
  refuses?: boolean;
  /**
   * Bands this assessment applies: below `negotiate` (moveScore) he will not talk; from `agree` (score, wages
   * included) he accepts terms that meet his wage floor. Absent in older saves: use INTEREST_BANDS.
   */
  thresholds?: { negotiate: number; agree: number };
  stance: string;
  expectedRole: string;
  expectedWage: number;
  /**
   * Weekly wage that would lift overall interest to the acceptance band with the other assessed terms unchanged;
   * null when he refuses or no wage within the cap is enough (absent in older saves).
   */
  wageToAgree?: number | null;
  /** Rival clubs chasing the same player, as far as the director knows (interest preview and player detail). */
  rivals?: RivalInterest[];
  factors: { id: string; label: string; impact: number; reason: string }[];
  concerns: string[];
}

export type RivalStatus =
  | "monitoring"
  | "bid"
  | "fee-agreed"
  | "withdrawn"
  | "won"
  | "lost";

/** Server-side truth about a rival club's pursuit, stored in NegotiationData.rivals. Never sent to the client. */
export interface RivalBid {
  clubId: number;
  since: string;
  status: RivalStatus;
  /** Latest bid (GBP); 0 while monitoring or for a club-less player. */
  fee: number;
  /** Weekly wage the rival offers. */
  wage: number;
  /** The player's overall interest in the rival's package. */
  interest: number;
  raises: number;
  nextAction: string;
  source: "market" | "shortlist";
  /** The rival has put personal terms to the player (its `interest` is then the player's real answer). */
  termsOffered?: boolean;
  /** Why the pursuit ended (withdrawn/lost/won). */
  outcome?: string;
}

/** Server-side state of a contested negotiation, stored in NegotiationData.battle. */
export interface TransferBattle {
  status: "open" | "final-offers" | "decision";
  finalOffersRequested?: boolean;
  finalOffersDeadline?: string;
  /** The director's lodged final fee (below the floor offers are countered as usual). */
  userFinalOffer?: number;
  decisionDeadline?: string;
  /** Rival fees were handed to the market after the director's talks closed. */
  handedOver?: boolean;
}

/** A rival as the director sees it: identity and fee are only as precise as scouting and press knowledge. */
export interface RivalInterest {
  /** Stable React key. */
  key: string;
  /** null while the club is only rumoured. */
  clubId: number | null;
  /** The club's name, or e.g. "A club in Spain" while rumoured. */
  clubName: string;
  countryName: string | null;
  reputation: number | null;
  /** confirmed = told by the selling club/agent; reported = press and scouting; rumoured = unnamed. */
  certainty: "confirmed" | "reported" | "rumoured";
  status: RivalStatus;
  /** Estimated bid (GBP) that contains the real bid; null while monitoring or for a club-less player. */
  feeRange: { low: number; high: number } | null;
  /** Whom the player currently leans towards, when the agent or scouting reveals it. */
  preference: "rival" | "you" | "undecided" | "unknown";
  since: string;
  negotiationId: number | null;
  /** Pursuit ended: why, in plain words. */
  outcome: string | null;
}

/** A contested negotiation as the director sees it. */
export interface TransferBattleView {
  status: "open" | "final-offers" | "decision";
  /** Best-and-final offers are due by this date (selling club's bidding war). */
  finalOffersDeadline: string | null;
  /** Your lodged final fee, if any. */
  yourFinalOffer: number | null;
  /** The player chooses between the clubs with agreed fees on this date. */
  decisionDeadline: string | null;
  /** The selling club's indication of the leading rival bid during final offers. */
  leadingBid: { low: number; high: number } | null;
  message: string;
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
  /** Wage share (%) the parent club expects a borrower to pay; lower splits are priced into the loan fee. */
  loanReferenceSplit?: number;
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
  rivals?: RivalBid[];
  battle?: TransferBattle;
  /** Affiliate loan the buyer starts when this signing registers (not with a loan-back). */
  onwardLoan?: OnwardLoanPlan;
  /** Future transfers only: the minor already moved domestically to the buyer's affiliate. */
  affiliatePlacement?: AffiliatePlacement;
  /** "approach": an unsolicited offer an AI club made for one of the director's players (market-offers.ts). */
  origin?: "approach";
  /** Why the club made the approach (shown with the offer and copied to the loan record). */
  reason?: OfferReason;
  /** Expected start: the loan start or arrival date (the window opening for pre-window approaches). */
  plannedStart?: string;
  /** Why an open approach was withdrawn by the club or closed by another agreement. */
  closedReason?: "accepted-elsewhere" | "needs-changed" | "window" | "injury" | "budget" | "unavailable";
}

export type OfferReasonCode =
  | "starter-need"
  | "depth"
  | "injury-cover"
  | "upgrade"
  | "development-pathway"
  | "registration"
  | "option-to-buy"
  | "contract-expiry"
  | "listed";

export interface OfferReason {
  code: OfferReasonCode;
  text: string;
}
