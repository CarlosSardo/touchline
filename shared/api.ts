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
} from "./types.ts";

export interface WorldTotals {
  countries: number;
  leagues: number;
  clubs: number;
  players: number;
  seniors: number;
  youth: number;
  staff: number;
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
export interface PlayerDetail {
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
export interface Assignment {
  id: number;
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
    position: string;
    age: number;
    club_name: string;
  })[];
  shortlist: Player[];
}
export interface SquadData {
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
    age: number | null;
    prospect: Player | null;
    risk: string;
  }[];
  promises: {
    id: number;
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
}
export interface FinanceData {
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
  negotiations: Negotiation[];
  targets: Player[];
  market: { id: number; date: string; data: string }[];
}
export interface SaveSlot {
  name: string;
  file: string;
  size: number;
  modified: string;
  compressed: boolean;
  automatic: boolean;
}
