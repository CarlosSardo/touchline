import type {
  Club,
  Country,
  Fixture,
  GameState,
  League,
  Loan,
  MatchResult,
  MatchSnapshot,
  Negotiation,
  NewsItem,
  Player,
  PlayerProfile,
  ScoutReport,
  Settings,
  Staff,
  Standing,
  BuyBackClause,
  SellOnClause,
  TransferPayment,
  PlayerInterest,
} from "./types.ts";
import type { AssistantDuty } from "./rules.ts";

export const PORTABLE_SAVE_EXTENSION = ".touchline.gz";

export interface AccountUser {
  id: string;
  displayName: string;
  email: string | null;
}

export interface AccountSession {
  user: AccountUser;
  hasWorld: boolean;
}

export interface Health {
  status: "ok";
}

export interface HealthDetails extends Health {
  database: "SQL Server";
  databaseName: string;
  schema: string;
  hosted: boolean;
  testCareer: boolean;
  date: string;
}

export interface AssistantAction {
  duty: AssistantDuty;
  message: string;
  playerId?: number;
  playerName?: string;
  negotiationId?: number;
  cost?: number;
}
export interface AssistantData {
  assistant: Staff | null;
  duties: Record<AssistantDuty, boolean>;
  weeklyBudget: number;
  spentLastWeek: number;
  lastRun: string | null;
  reports: {
    id: number;
    date: string;
    name: string;
    spending: number;
    actions: AssistantAction[];
  }[];
}
export interface AffiliateLink {
  id: number;
  partner_id: number;
  name: string;
  color: string;
  country_name: string;
  league_name: string | null;
  reputation: number;
  type: string;
  strength: number;
  data: string;
}
export interface AffiliateRequest {
  id: number;
  club_id: number;
  purpose: string;
  preferred_club_id: number | null;
  preferred_name: string | null;
  requested_date: string;
  due_date: string;
  status: "pending" | "approved" | "rejected";
  decision_date: string | null;
  reason: string;
  partner_id: number | null;
  partner_name: string | null;
}
export interface AffiliateData {
  affiliates: AffiliateLink[];
  requests: AffiliateRequest[];
  nextRequestDate: string | null;
}
export interface EventEffects {
  cash?: number;
  morale?: number;
  fitness?: number;
  fanMood?: number;
  boardPressure?: number;
  managerTrust?: number;
  playerMorale?: number;
}
export interface EventOption {
  id: string;
  label: string;
  outcome: string;
  effects: EventEffects;
}
export interface UnexpectedEvent {
  id: number;
  club_id: number;
  date: string;
  kind: string;
  title: string;
  body: string;
  deadline: string;
  status: "pending" | "resolved" | "expired";
  resolved_date: string | null;
  choice_id: string | null;
  outcome: string;
  details: {
    playerId?: number;
    playerName?: string;
    defaultChoice: string;
    options: EventOption[];
  };
}
export interface UnexpectedEventsData {
  frequency: "low" | "medium" | "high";
  pending: UnexpectedEvent[];
  history: UnexpectedEvent[];
}

export interface WorldTotals {
  version: number;
  countries: number;
  leagues: number;
  clubs: number;
  players: number;
  seniors: number;
  youth: number;
  staff: number;
}
export interface WorldAudit {
  countries: {
    id: number;
    code: string;
    name: string;
    confederation: string;
    seniorDivisions: number;
    clubs: number;
    reserves: number;
    reservePolicy: import("./world-rules.ts").ReservePolicy;
    notes: string[];
  }[];
}
export interface CompetitionFavorite {
  leagueId: number;
  name: string;
  kind: string;
  ageGroup: string;
  events: Record<
    "fixtures" | "results" | "draws" | "tables" | "winners",
    boolean
  >;
  since: string;
}
export interface Bootstrap {
  state: GameState;
  club: Club;
  settings: Settings;
  world: WorldTotals;
  countries: Country[];
}
export interface Dashboard {
  squad: {
    count: number;
    age: number;
    ability: number;
    wages: number;
    injuries: number;
    value: number;
    potential: number;
  };
  fixtures: Fixture[];
  results: Fixture[];
  table: Standing[];
  news: NewsItem[];
  shortlist: Player[];
  expiring: Player[];
  activeNegotiations: number;
  activeLoans: number;
  activeAssignments: number;
  unread: number;
}
export interface PlayerPage {
  players: Player[];
  total: number;
  page: number;
  pageSize: number;
  pages: number;
}
export interface WorldClub extends Club {
  tier: number | null;
  confederation: string;
  squad_size: number;
}
export interface WorldClubPage {
  clubs: WorldClub[];
  total: number;
  page: number;
  pageSize: number;
  pages: number;
}
export interface ClubWorth {
  enterpriseValue: number;
  annualOperatingRevenue: number;
  revenueMultiple: number;
}
export interface ClubDetail {
  valuation: ClubWorth | null;
  affiliates: AffiliateLink[];
  club: Club;
  country: Country;
  parent: Club | null;
  reserves: Club[];
  players: Player[];
  staff: Staff[];
  competitions: League[];
  fixtures: Fixture[];
  results: Fixture[];
  history: {
    season: number;
    date: string;
    entity_type: string;
    data: string;
  }[];
  summary: {
    squadSize: number;
    averageAge: number;
    averageAbility: number;
    squadValue: number;
  };
}
export interface PlayerDetail {
  canManage: boolean;
  squadDestinations: {
    clubId: number;
    ageGroup: "Senior" | "U19" | "U17";
    label: string;
    eligible: boolean;
    reason: string | null;
    current: boolean;
  }[];
  interest: PlayerInterest;
  youthTransfer: YouthTransferAssessment;
  buyBackClauses: BuyBackClause[];
  sellOnClauses: SellOnClause[];
  registration: {
    allowed: boolean;
    status: string;
    points: number;
    threshold: number;
    automatic: boolean;
    breakdown: Record<string, number>;
    reasons: string[];
    source: string;
  };
  player: Player;
  profile: PlayerProfile;
  report: ScoutReport | null;
  value: { value: number; layers: Record<string, number> };
  development: {
    factors: Record<string, number>;
    change: number;
    low: number;
    high: number;
  };
  history: { date: string; data: string; entity_type: string }[];
  promises: {
    id: number;
    type: string;
    due_date: string;
    status: string;
    target: number;
  }[];
  loan: Loan | null;
}
export interface YouthTransferAssessment {
  minor: boolean;
  international: boolean;
  eligibleToApply: boolean;
  approved: boolean;
  route:
    | "adult"
    | "domestic"
    | "eu-eea"
    | "same-country"
    | "parent-relocation"
    | "blocked";
  status: string;
  reasons: string[];
  source: string;
  application?: { id: number; status: string; dueDate: string; reason: string };
  contractStatus: "professional" | "amateur";
  canApproachWithoutFee: boolean;
  trainingCompensation: number;
  trainingClubId: number | null;
}
export interface PlayerAppearance {
  fixture_id: number;
  player_id: number;
  club_id: number;
  season: number;
  date: string;
  position: string;
  started: number;
  minutes: number;
  minute_on: number;
  minute_off: number | null;
  rating: number;
  goals: number;
  assists: number;
  stats: Record<string, number>;
  club_name: string;
  club_color: string;
  home_id: number;
  away_id: number;
  home_name: string;
  away_name: string;
  home_color: string;
  away_color: string;
  home_goals: number;
  away_goals: number;
  league_id: number | null;
  competition_name: string;
  age_group: string;
  stage: string;
}
export interface PlayerCareer {
  seasons: {
    season: number;
    appearances: number;
    starts: number;
    minutes: number;
    goals: number;
    assists: number;
    rating: number;
  }[];
  selectedSeason: number | null;
  appearances: PlayerAppearance[];
  teams: {
    id: number;
    name: string;
    color: string;
    appearances: number;
    minutes: number;
  }[];
  competitions: {
    id: number | null;
    name: string;
    appearances: number;
    minutes: number;
    goals: number;
    assists: number;
    rating: number;
  }[];
  total: number;
  page: number;
  pageSize: number;
  pages: number;
}
export interface Assignment {
  id: number;
  player_id: number | null;
  staff_id: number;
  scout_name: string;
  player_name: string | null;
  country_name: string | null;
  position: string | null;
  max_age: number;
  budget: number;
  due_date: string;
  status: string;
}
export interface ScoutingData {
  scouts: Staff[];
  assignments: Assignment[];
  reports: (ScoutReport & {
    club_id: number | null;
    position: string;
    age: number;
    club_name: string;
  })[];
  shortlist: Player[];
}
export interface SquadData {
  clubs: Club[];
  selectedClubId: number;
  ageGroup: "Senior" | "U19" | "U17";
  players: Player[];
  matrix: {
    id: number;
    name: string;
    group: string;
    connections: { id: number; strength: number; kind: string }[];
  }[];
  succession: {
    position: string;
    current: string | null;
    currentId: number | null;
    age: number | null;
    prospect: Player | null;
    risk: string;
  }[];
  promises: {
    id: number;
    player_id: number | null;
    player_name: string;
    type: string;
    due_date: string;
    status: string;
  }[];
}
export interface LoanDesk {
  loans: Loan[];
  partnerships: {
    id: number;
    partner_id: number;
    name: string;
    color: string;
    reputation: number;
    type: string;
    strength: number;
    data: string;
  }[];
  candidates: Player[];
}
export interface StaffDesk {
  staff: Staff[];
  candidates: Staff[];
  relationships: {
    id: number;
    source_id: number;
    target_id: number;
    source_name: string;
    target_name: string;
    strength: number;
    kind: string;
  }[];
}
export interface CompetitionDetail {
  league: League;
  table: Standing[];
  fixtures: Fixture[];
  qualifiers: League[];
  history: { season: number; data: string }[];
}
export interface MatchDetail {
  fixture: Fixture;
  snapshot?: MatchSnapshot;
  result?: MatchResult;
  penalties?: { home: number; away: number } | null;
  winnerId?: number | null;
  aggregate?: { home: number; away: number };
  tie?: { id: string; leg: number; legs: number };
  awarded?: { home: number; away: number; reason: string } | null;
}
export interface FinanceData {
  valuation: ClubWorth;
  futureTransferReserved: number;
  transferPayments: TransferPayment[];
  transferPayable: number;
  transferReceivable: number;
  compliance: {
    policy: string;
    squadCostLimit: number | null;
    squadCostRatio: number;
    squadCost: number;
    footballRevenue: number;
    rollingEarnings: number;
    allowableLoss: number | null;
    lossHeadroom: number | null;
    costHeadroom: number | null;
    yearsObserved: number;
    projected: boolean;
    status: string;
    issues: string[];
    levyApplies: boolean;
    source: string;
  };
  ledger: {
    id: number;
    date: string;
    category: string;
    amount: number;
    description: string;
  }[];
  history: {
    date: string;
    balance: number;
    income: number;
    expenses: number;
    ffp: number;
    wages: number;
    transferBudget: number;
  }[];
  wages: number;
  staffWages: number;
  squadValue: number;
  projectedWages: number;
  amortization: number;
  commitments: { name: string; amount: number; type: string }[];
}
export interface TrainingData {
  plan: { focus: string; intensity: number; youth_focus: string; data: string };
  players: Player[];
  injuries: Player[];
  setPieces: { routine: string; target: string; risk: number };
  mentors: Player[];
}
export interface AcademyData {
  players: Player[];
  leagues: League[];
  fixtures: Fixture[];
  intake: { date: string; count: number } | null;
  dna: string;
}
export interface TransferDesk {
  payments: TransferPayment[];
  buyBackClauses: BuyBackClause[];
  sellOnClauses: SellOnClause[];
  negotiations: Negotiation[];
  targets: Player[];
  market: { id: number; entity_id: number; date: string; data: string }[];
}
export interface Journalist {
  id: string;
  name: string;
  handle: string;
  outlet: string;
  beat: string;
  reliability: number;
  style: string;
  biography: string;
}
export interface MediaComment {
  id: string;
  author: string;
  handle: string;
  role: "Supporter" | "Analyst" | "Journalist";
  text: string;
  sentiment: "positive" | "critical" | "balanced";
  likes: number;
}
export interface MediaReport {
  mediaKey: string;
  topic: "transfer" | "player" | "match" | "club" | "press";
  status: "Reported" | "Confirmed" | "Analysis";
  journalistId: string;
  clubIds: number[];
  playerId?: number;
  playerName?: string;
  fixtureId?: number;
  negotiationId?: number;
  fee?: number;
  paragraphs: string[];
  comments: MediaComment[];
  confidence: number;
}
export interface MediaStory {
  id: number;
  date: string;
  title: string;
  body: string;
  category: string;
  severity: string;
  report: MediaReport | null;
  clubs: { id: number; name: string }[];
}
export interface MediaData {
  journalists: Journalist[];
  stories: MediaStory[];
  total: number;
  page: number;
  pages: number;
  pressQuestion: { text: string; journalistId: string; playerId?: number };
}
export interface SaveSlot {
  name: string;
  file: string;
  size: number;
  modified: string;
  compressed: boolean;
  automatic: boolean;
  career?: {
    id: string;
    name: string;
    director: string;
    club: string;
    date: string;
    season: number;
  };
}
