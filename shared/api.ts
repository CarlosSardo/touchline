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
  TransferTerms,
  PlayerInterest,
} from "./types.ts";
import type { AssistantDuty } from "./rules.ts";

export const PORTABLE_SAVE_EXTENSION = ".touchline.gz";

export interface AccountUser {
  id: string;
  displayName: string;
  email: string | null;
}

export type WorldOperation =
  | "prepare_world"
  | "start_career"
  | "load_career"
  | "delete_career"
  | "advance_days"
  | "create_save"
  | "restore_save"
  | "export_save"
  | "import_save"
  | "game_action"
  | "update_settings"
  | "favorite_competition";

export interface WorldActivity {
  operation: WorldOperation;
  startedAt: string;
}

/** Only 409 with this code is transient; retry after the Retry-After header. */
export type WorldBusyResponse = {
  error: string;
  code: "world_busy";
} & WorldActivity;

/** hasWorld is null exactly when activity is set: the world is busy and was not read. */
export interface AccountSession {
  user: AccountUser;
  hasWorld: boolean | null;
  activity: WorldActivity | null;
}

/** Body of DELETE /api/careers/active, copied from the loaded GameState. */
export interface DeleteActiveCareerRequest {
  careerId: string | null;
  seed: string;
}

export interface DeleteActiveCareerResult {
  deleted: true;
  careerId: string | null;
  snapshots: number;
  message: string;
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
    reservePolicy: import("./types.ts").ReservePolicy;
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
  /** Capped at 10,000 when `totalCapped` (more players match: show "10,000+"). */
  total: number;
  totalCapped?: boolean;
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
export interface PlayerHistoryClub {
  id: number;
  name: string;
  color: string | null;
}
/**
 * transfer: permanent move between clubs; free: joined without a fee (from no club or a free deal);
 * loan / loanReturn / loanRecall / loanPurchase: loan spells and how they ended; registration: automatic move
 * inside a club family (B-team, age group); squad: the user's own squad assignment (e.g. a youth promotion).
 */
export type PlayerMoveKind =
  | "transfer"
  | "free"
  | "loan"
  | "loanReturn"
  | "loanRecall"
  | "loanPurchase"
  | "registration"
  | "squad";
export interface PlayerMove {
  kind: PlayerMoveKind;
  /** null: the move happened but its date was not recorded (loan recalls and purchases before recording began). */
  date: string | null;
  /** true: `date` is the loan's scheduled end, the player returned on the first processed day on or after it. */
  dateEstimated: boolean;
  season: number | null;
  /** null: no club (a free agent or club-less player). */
  from: PlayerHistoryClub | null;
  to: PlayerHistoryClub | null;
  /** GBP; 0 = no fee; null = not recorded. */
  fee: number | null;
  /** The recorded deal type, e.g. "Standard loan", "Free transfer", "Squad registration"; null if none. */
  dealType: string | null;
  /** Loans only: the scheduled end of the spell. */
  loanUntil: string | null;
  /** Squad moves only. */
  ageGroup: { from: string | null; to: string | null } | null;
  /** Squad moves only, present only when true: a temporary call-up / the return from one. */
  callUp?: boolean;
  callUpReturn?: boolean;
  /** Call-ups only: the recorded end (match date or chosen date). */
  until?: string | null;
}
/**
 * appearances and minutes cover every recorded match. goals, assists and averageRating come only from
 * full-engine matches (the user's club family): null means not recorded, which is different from 0.
 */
export interface PlayerStatLine {
  appearances: number;
  minutes: number;
  /** Full-engine matches in this line; goals, assists and averageRating cover exactly these. */
  recordedAppearances: number;
  goals: number | null;
  assists: number | null;
  averageRating: number | null;
  coverage: "full" | "partial" | "none";
}
export interface PlayerCompetitionStats extends PlayerStatLine {
  club: PlayerHistoryClub;
  /** id null: friendlies. */
  competition: { id: number | null; name: string; ageGroup: string | null };
}
export interface PlayerSeasonStats {
  season: number;
  competitions: PlayerCompetitionStats[];
  total: PlayerStatLine;
}
/** GET /api/players/:id/history. Moves oldest first; seasons newest first. */
export interface PlayerHistory {
  playerId: number;
  moves: PlayerMove[];
  /** true: only the latest 500 moves are listed. */
  movesTruncated: boolean;
  seasons: PlayerSeasonStats[];
  career: PlayerStatLine;
}
export interface ClubTransferClub extends PlayerHistoryClub {
  country: { id: number; name: string; code: string } | null;
}
export interface ClubTransfer {
  /** Stable row key. */
  key: string;
  kind: PlayerMoveKind;
  direction: "in" | "out";
  /** null: recalled or purchased loan whose end date was not recorded. */
  date: string | null;
  /** true: `date` is the loan's scheduled end (return processed on or after it). */
  dateEstimated: boolean;
  season: number;
  /** ageAtMove, position null: unknown or the player has since been removed (retired and pruned). */
  player: { id: number; name: string; position: string | null; ageAtMove: number | null };
  /** The other club; null: no club (a free agent). */
  club: ClubTransferClub | null;
  /** GBP agreed fee (loan fee for loans, option fee for loan purchases); 0 = no fee; null = not recorded. */
  fee: number | null;
  dealType: string | null;
  loanUntil: string | null;
  /** Instalments, sell-on and buy-back agreed in the director's own negotiations; null for AI deals. */
  terms: TransferTerms | null;
  /** Squad moves only, present only when true; call-ups never count in the season totals. */
  callUp?: boolean;
  callUpReturn?: boolean;
  until?: string | null;
}
/** Fees count in the season of the move, at the agreed amount (instalments are not spread). */
export interface ClubTransferTotals {
  spent: number;
  received: number;
  /** received - spent. */
  net: number;
  /** Moves with another club: transfers, free signings, loan starts and loan purchases. */
  countIn: number;
  countOut: number;
  /** Registrations and squad moves inside the club family, both directions (call-ups excluded). */
  countInternal?: number;
  /** Loans ending (returns and recalls), both directions. */
  countLoanEnds?: number;
  /** Fee-bearing moves (transfer, loan, loan purchase) with no recorded fee. */
  unknownFees: number;
}
export interface ClubTransferSeasonSummary {
  season: number;
  /** Every move of the season, regardless of the direction/type filter. */
  totals: ClubTransferTotals;
}
export interface ClubTransferSeason extends ClubTransferSeasonSummary {
  /** This page's moves of the season, newest first. */
  transfers: ClubTransfer[];
}
/** GET /api/clubs/:id/transfers?season=&direction=in|out|all&type=kind[,kind]&page=&pageSize= */
export interface ClubTransfers {
  club: ClubTransferClub;
  /** Seasons with a recorded move plus the current season, newest first. */
  seasons: ClubTransferSeasonSummary[];
  filter: { season: number | null; direction: "in" | "out" | "all"; types: PlayerMoveKind[] };
  /** The page's moves grouped by season, newest first. */
  groups: ClubTransferSeason[];
  /** Filtered moves across all pages. */
  total: number;
  page: number;
  pageSize: number;
  pages: number;
  /** true: only the club's latest 20,000 recorded moves were read. */
  truncated: boolean;
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
