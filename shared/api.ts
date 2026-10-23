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
import type { GbeAssessment, PlayerEligibility, RegistrationStatus } from "./eligibility.ts";

export const PORTABLE_SAVE_EXTENSION = ".touchline.gz";

export interface AccountUser {
  id: string;
  /** Authelia login name (OIDC preferred_username). */
  username: string;
  displayName: string;
  email: string | null;
  /** Member of the configured admin group: may approve access requests at /admin. */
  admin: boolean;
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

/**
 * Response of POST /api/advance. Each day commits on its own: when a later day fails, the days already simulated
 * are kept and `error` explains why the run stopped early (a failure on the first day is an error response).
 */
export interface AdvanceResult {
  from: string;
  date: string;
  days: number;
  matches: number;
  seconds: number;
  error?: string;
}

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
  database: "PostgreSQL";
  databaseName: string;
  schema: string;
  hosted: boolean;
  testCareer: boolean;
  date: string;
}

/**
 * 403 reasons for a signed-in identity without a Touchline world: the first sign-in files an access request that an
 * admin approves or denies at /admin; not_authorized is any other refusal.
 */
export type AccessIssueCode = "access_pending" | "access_denied" | "not_authorized";

export interface AccessIssueResponse {
  error: string;
  code: AccessIssueCode;
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
  /**
   * A lower bound when `totalCapped` (show "10,000+"): counting stops at 10,000, and skill, lifestyle, trait and
   * contract-status filters check only the first 10,000 candidates in the requested order (server/queries.ts).
   */
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
  /** Contract, association, competition and next-fixture eligibility at the player's current club. */
  eligibility: PlayerEligibility;
  /**
   * A signing by the user's club: transfer rules (never GBE or quotas) and the association registration it would
   * get; null for the user's own players.
   */
  signing: {
    ok: boolean;
    reasons: string[];
    registration: { status: RegistrationStatus; reasons: string[]; gbe?: GbeAssessment };
  } | null;
  buyBackClauses: BuyBackClause[];
  sellOnClauses: SellOnClause[];
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
 * Moves between different clubs: transfer: permanent move; free: joined without a fee (from no club or a free deal);
 * loan / loanReturn / loanRecall / loanPurchase: loan spells and how they ended; registration: an academy-age
 * registration with another club. Moves inside one club family are squad movements (PlayerSquadMove).
 */
export type PlayerMoveKind =
  | "transfer"
  | "free"
  | "loan"
  | "loanReturn"
  | "loanRecall"
  | "loanPurchase"
  | "registration";
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
}
/**
 * A move inside one club family (first team, B-team, U19, U17). callUp: a temporary call-up, folded together with
 * its return; move: a squad assignment; registration: an automatic registration with the family's other club.
 */
export type SquadMoveKind = "callUp" | "move" | "registration";
export interface PlayerSquadMove {
  kind: SquadMoveKind;
  date: string;
  season: number;
  from: PlayerHistoryClub | null;
  fromGroup: string | null;
  to: PlayerHistoryClub | null;
  toGroup: string | null;
  /** The destination squad as recorded, e.g. "Harbour FC / U19"; null if not recorded. */
  label: string | null;
  /** Up: to a more senior team (U17 < U19 < B-team < first team). */
  direction: "up" | "down" | "across";
  /** Call-ups only: the planned end, the day he went back (null: still there) and the length in days once back. */
  until?: string | null;
  returnedOn?: string | null;
  days?: number | null;
  /** Call-ups only, present only when true: a possible first-team debut. */
  debut?: boolean;
}
export type HonourKind = "league" | "cup" | "continental" | "international" | "youthInternational";
/** A trophy won by a team he appeared for in that competition and season. */
export interface PlayerHonour {
  season: number;
  kind: HonourKind;
  title: string;
  /** The winning team (a national team for international honours). */
  club: PlayerHistoryClub | null;
  competitionId: number | null;
  /** Youth competitions only. */
  ageGroup: string | null;
  appearances: number;
  /** The team's matches in the competition; null if not recorded. */
  matches: number | null;
  /** regular: half the matches or more; squad: a fifth or more; fringe: fewer. */
  role: "regular" | "squad" | "fringe";
}
export type MilestoneKind =
  | "seniorDebut"
  | "clubDebut"
  | "internationalDebut"
  | "firstGoal"
  | "firstInternationalGoal"
  | "appearances"
  | "clubAppearances"
  | "goals"
  | "caps";
export interface PlayerMilestone {
  kind: MilestoneKind;
  /** Counting milestones: the appearance, goal or cap number reached. */
  value: number | null;
  date: string;
  /** true: reached during that season (recorded before milestones were tracked); `date` is the season's end. */
  dateEstimated: boolean;
  season: number;
  /** The club (or national team) he played for. */
  club: PlayerHistoryClub | null;
  competition: string | null;
  fixtureId: number | null;
  age: number;
}
/**
 * appearances and minutes cover every recorded match. goals, assists and averageRating come only from
 * full-engine matches (the user's club family): null means not recorded, which is different from 0.
 */
/** Appearances, minutes, goals and assists cover every match of the line (competitive: the season statistics). */
export interface PlayerStatLine {
  appearances: number;
  minutes: number;
  goals: number;
  assists: number;
  /**
   * Appearances with a match rating on record (match rows: every match of the current season, the user's teams'
   * matches of earlier seasons); averageRating covers exactly these and is null without any.
   */
  ratedAppearances: number;
  averageRating: number | null;
  ratingCoverage: "full" | "partial" | "none";
}
export interface PlayerCompetitionStats extends PlayerStatLine {
  club: PlayerHistoryClub;
  /** id null: friendlies. */
  competition: { id: number | null; name: string; ageGroup: string | null };
}
/** One club's (or national team's) competitive lines of a season. */
export interface PlayerClubSeasonStats {
  club: PlayerHistoryClub;
  competitions: PlayerCompetitionStats[];
  total: PlayerStatLine;
}
export interface PlayerSeasonStats {
  season: number;
  /** Clubs by appearances, competitions by appearances. */
  clubs: PlayerClubSeasonStats[];
  /** Friendly lines per club (competition id null); not part of `total`. */
  friendlies: PlayerCompetitionStats[];
  /** Competitive matches only. */
  total: PlayerStatLine;
}
/** GET /api/players/:id/history. Moves oldest first; seasons newest first. */
export interface PlayerHistory {
  playerId: number;
  /** Transfers, free moves, loans (with their ends) and registrations between different clubs. */
  transfers: PlayerMove[];
  /** Moves inside one club family, call-ups folded with their returns. */
  squadMoves: PlayerSquadMove[];
  /** true: only the latest 500 recorded moves were read. */
  movesTruncated: boolean;
  seasons: PlayerSeasonStats[];
  /** Competitive matches of every season. */
  career: PlayerStatLine;
  /** Friendlies of every season; null when he played none. */
  careerFriendlies: PlayerStatLine | null;
  /** Honours newest first. */
  honours: PlayerHonour[];
  /** Milestones oldest first. */
  milestones: PlayerMilestone[];
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
}
/** A move inside the club's family (first team, B-team, youth squads), call-ups folded with their returns. */
export interface ClubSquadMove extends PlayerSquadMove {
  key: string;
  player: { id: number; name: string; position: string | null; ageAtMove: number | null };
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
  /** Squad movements inside the club family, both directions (call-ups excluded). */
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
  /** Moves inside the club family in the selected season (all seasons when none), newest first; never transfers. */
  squadMoves: { moves: ClubSquadMove[]; total: number };
}
export type InjurySeverity = "minor" | "moderate" | "serious" | "long-term";
export interface PlayerInjury {
  id: number;
  kind: string;
  severity: InjurySeverity;
  start: string;
  /** The (expected) return date. */
  end: string | null;
  days: number | null;
  /** null: recorded when injury tracking began (start is that day). */
  context: "match" | "training" | null;
  /** His club when it happened. */
  club: PlayerHistoryClub | null;
  fixtureId: number | null;
  backfilled: boolean;
  ongoing: boolean;
}
/** GET /api/players/:id/medical */
export interface PlayerMedical {
  playerId: number;
  today: string;
  injuredUntil: string | null;
  daysLeft: number | null;
  current: PlayerInjury | null;
  /** Newest first. */
  injuries: PlayerInjury[];
  summary: { injuries: number; daysMissed: number; seasonInjuries: number; seasonDaysMissed: number };
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
  loanOffers: Negotiation[];
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
  /** The director's players available for loan (and young players clubs may ask about), with open loan offers. */
  loanList: (Player & { open_offers: number; last_offer: string | null })[];
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
/** A club or national team a scorer played for in the competition season (several after a mid-season move). */
export interface CompetitionScorerTeam {
  id: number;
  name: string;
  color: string;
  type: string;
  goals: number;
  appearances: number;
  minutes: number;
}
export interface CompetitionScorer {
  /** Shared by players level on goals (1, 2, 2, 4). */
  rank: number;
  playerId: number;
  name: string;
  position: string;
  age: number;
  nationality: string;
  countryCode: string | null;
  goals: number;
  assists: number;
  appearances: number;
  minutes: number;
  minutesPerGoal: number;
  /** Most goals first. */
  teams: CompetitionScorerTeam[];
}
/** Top-scorer race of one competition season (GET /api/competitions/:id/scorers). */
export interface CompetitionScorers {
  leagueId: number;
  season: number;
  currentSeason: number;
  /** The current season, then past seasons that still have goals on record (newest first). */
  seasons: number[];
  /** Players with at least one goal. */
  total: number;
  /** Goals credited to those players. */
  goals: number;
  /** Players level on the most goals (joint leaders when above 1). */
  leaders: number;
  /** Goals desc, then fewer minutes, more assists and name. */
  scorers: CompetitionScorer[];
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
    /** Annual squad cost the club may still add before breaching its binding rule (planning gate). */
    ffpHeadroom: number;
    yearsObserved: number;
    projected: boolean;
    status: string;
    issues: string[];
    levyApplies: boolean;
    source: string;
  };
  /** Points deductions, embargoes, fines and settlements imposed on the club, newest first (server/sanctions.ts). */
  sanctions: {
    id: number;
    season: number;
    kind: "points" | "embargo" | "fine" | "settlement";
    points: number;
    amount: number;
    start_date: string;
    end_date: string | null;
    reason: string;
  }[];
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
export interface WorldNewsItem {
  id: number;
  date: string;
  title: string;
  body: string;
  kind: string;
  clubs: { id: number; name: string; color: string }[];
  playerId?: number;
  playerName?: string;
}
export interface WorldNewsData {
  items: WorldNewsItem[];
  total: number;
  page: number;
  pages: number;
  kinds: { kind: string; count: number }[];
  countries: { id: number; name: string }[];
  club: { id: number; name: string } | null;
}
export type DofPolicy = "balanced" | "youth" | "value" | "stars";
export type ClubProjectKind = "facilities" | "academy" | "stadium_expansion" | "new_stadium";
export interface ClubProjectView {
  id: number;
  kind: ClubProjectKind;
  cost: number;
  start_date: string;
  end_date: string;
  status: "planned" | "building" | "complete" | "cancelled";
  effect: { facilities?: number; academy?: number; capacity?: number; stadium?: string };
  cash: number;
  debt: number;
  weeklyRepayment: number;
  repayUntil: string | null;
}
export interface ClubAdministration {
  since: string;
  season: number;
  reason: string;
  points: number;
  pendingPoints: number;
  embargoUntil: string;
  forcedSales: { playerId: number; name: string }[];
}
export interface ClubLifeData {
  clubId: number;
  director: { id: number; name: string; ability: number; style: DofPolicy; since: string | null } | null;
  dofPolicy: DofPolicy;
  projects: ClubProjectView[];
  administration: ClubAdministration | null;
  administrations: { since: string; until: string; points: number; outcome: string }[];
  managers: { date: string; departed: string; appointed: string; formation?: string; style?: string }[];
}
export type OwnerTypeId = "local" | "billionaire" | "state" | "private_equity" | "members";
export interface OwnerSummary {
  id: number;
  name: string;
  type: OwnerTypeId;
  typeLabel: string;
  countryName: string | null;
  wealth: number;
  ambition: number;
  patience: number;
}
export interface OwnershipClubLink {
  id: number;
  name: string;
  color: string;
  countryName: string;
  leagueName: string | null;
  tier: number | null;
  stake: number;
  blindTrust: boolean;
}
export interface OwnershipEventView {
  id: number;
  date: string;
  clubId: number;
  clubName: string;
  kind: string;
  title: string;
  detail: string;
}
export interface ClubOwnershipView {
  clubId: number;
  /** False until the world's owners exist (older worlds get them on the next simulated day). */
  ready: boolean;
  owner: OwnerSummary | null;
  stake: number;
  since: string | null;
  memberOwned: boolean;
  president: string | null;
  presidentSince: string | null;
  nextElection: string | null;
  termYears: number | null;
  rule: string | null;
  exemption: string | null;
  blindTrust: boolean;
  debt: number;
  investors: { ownerId: number; name: string; stake: number }[];
  group: { ownerId: number; name: string; clubs: OwnershipClubLink[] } | null;
  pending: { stage: "rumour" | "talks"; buyerName: string | null; buyerType: string; expected: string } | null;
  election: { date: string; candidates: { name: string; promise: string; incumbent: boolean }[] } | null;
  events: OwnershipEventView[];
}
export interface OwnershipOverview {
  ready: boolean;
  types: { type: OwnerTypeId; label: string; clubs: number }[];
  groups: { owner: OwnerSummary; clubs: OwnershipClubLink[] }[];
  events: OwnershipEventView[];
}
/** The director's club: a takeover in progress, the new owners' review, or a presidential election. */
export interface OwnershipNotice {
  clubId: number;
  stage: "rumour" | "talks" | "review" | "election";
  title: string;
  detail: string;
  due: string | null;
  target: number | null;
  confidence: number | null;
}
