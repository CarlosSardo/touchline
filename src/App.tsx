import {
  Component,
  lazy,
  Suspense,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  Activity,
  ArrowLeftRight,
  Bell,
  BriefcaseBusiness,
  ChartNoAxesCombined,
  Check,
  ChevronDown,
  ChevronRight,
  CircleHelp,
  Database,
  Dumbbell,
  Goal,
  GraduationCap,
  Handshake,
  House,
  Inbox,
  Landmark,
  LoaderCircle,
  Menu,
  MessageSquare,
  Play,
  Search,
  Settings2,
  ShieldCheck,
  SlidersHorizontal,
  Trophy,
  Users,
  Wallet,
  X,
  type LucideIcon,
} from "lucide-react";
import { GameProvider, useGame, type Page } from "./game-context.tsx";
import {
  Button,
  Crest,
  ErrorState,
  IconButton,
  Loading,
  Modal,
} from "./ui.tsx";
import { dateLabel } from "../shared/rules.ts";
import Office from "./views/Office.tsx";
const PlayerSheet = lazy(() => import("./PlayerSheet.tsx"));
const CareerSheet = lazy(() =>
  import("./views/Settings.tsx").then((module) => ({
    default: module.CareerSheet,
  })),
);

const DatabaseView = lazy(() => import("./views/Database.tsx"));
const SquadView = lazy(() =>
  import("./views/SquadScouting.tsx").then((module) => ({
    default: module.Squad,
  })),
);
const ScoutingView = lazy(() =>
  import("./views/SquadScouting.tsx").then((module) => ({
    default: module.Scouting,
  })),
);
const TransferView = lazy(() => import("./views/Transfers.tsx"));
const LoanView = lazy(() => import("./views/Loans.tsx"));
const AcademyView = lazy(() =>
  import("./views/Development.tsx").then((module) => ({
    default: module.Academy,
  })),
);
const TrainingView = lazy(() =>
  import("./views/Development.tsx").then((module) => ({
    default: module.Training,
  })),
);
const StaffView = lazy(() =>
  import("./views/Development.tsx").then((module) => ({
    default: module.StaffView,
  })),
);
const CompetitionView = lazy(() => import("./views/Competitions.tsx"));
const AnalyticsView = lazy(() => import("./views/Analytics.tsx"));
const FinanceView = lazy(() =>
  import("./views/ClubOffice.tsx").then((module) => ({
    default: module.Finances,
  })),
);
const BoardView = lazy(() =>
  import("./views/ClubOffice.tsx").then((module) => ({
    default: module.Board,
  })),
);
const MediaView = lazy(() =>
  import("./views/ClubOffice.tsx").then((module) => ({
    default: module.Media,
  })),
);
const InboxView = lazy(() =>
  import("./views/ClubOffice.tsx").then((module) => ({
    default: module.Inbox,
  })),
);
const SettingsView = lazy(() => import("./views/Settings.tsx"));

const navigation: {
  label: string;
  items: { id: Page; label: string; icon: LucideIcon }[];
}[] = [
  {
    label: "Workspace",
    items: [
      { id: "office", label: "Overview", icon: House },
      { id: "inbox", label: "Inbox", icon: Inbox },
    ],
  },
  {
    label: "Football",
    items: [
      { id: "squad", label: "Squad", icon: Users },
      { id: "scouting", label: "Scouting", icon: Search },
      { id: "transfers", label: "Transfers", icon: ArrowLeftRight },
      { id: "loans", label: "Loans", icon: Handshake },
      { id: "database", label: "Player database", icon: Database },
    ],
  },
  {
    label: "Development",
    items: [
      { id: "academy", label: "Academy", icon: GraduationCap },
      { id: "training", label: "Training", icon: Dumbbell },
      { id: "staff", label: "Staff", icon: BriefcaseBusiness },
    ],
  },
  {
    label: "The bigger picture",
    items: [
      { id: "competitions", label: "Competitions", icon: Trophy },
      { id: "analytics", label: "Match centre", icon: ChartNoAxesCombined },
      { id: "finances", label: "Finances", icon: Wallet },
      { id: "board", label: "Boardroom", icon: Landmark },
      { id: "media", label: "Media & fans", icon: MessageSquare },
    ],
  },
];
const allItems = [
  ...navigation.flatMap((group) => group.items),
  { id: "settings" as Page, label: "Settings", icon: Settings2 },
];
const views: Record<Page, ReactNode> = {
  office: <Office />,
  inbox: <InboxView />,
  squad: <SquadView />,
  scouting: <ScoutingView />,
  database: <DatabaseView />,
  transfers: <TransferView />,
  loans: <LoanView />,
  academy: <AcademyView />,
  training: <TrainingView />,
  staff: <StaffView />,
  competitions: <CompetitionView />,
  analytics: <AnalyticsView />,
  finances: <FinanceView />,
  board: <BoardView />,
  media: <MediaView />,
  settings: <SettingsView />,
};

class ScreenBoundary extends Component<
  { children: ReactNode },
  { message: string | null }
> {
  state = { message: null as string | null };
  static getDerivedStateFromError(error: Error) {
    return { message: error.message };
  }
  render() {
    return this.state.message ? (
      <div className="padded">
        <ErrorState message={this.state.message} />
        <Button variant="secondary" onClick={() => location.reload()}>
          Reload game
        </Button>
      </div>
    ) : (
      this.props.children
    );
  }
}

function Shell() {
  const {
    bootstrap,
    error,
    page,
    navigate,
    playerId,
    busy,
    advance,
    toast,
    dismissToast,
    search,
    setSearch,
    confirmation,
    closeConfirm,
    refresh,
  } = useGame();
  const [menu, setMenu] = useState(false);
  const [globalSearch, setGlobalSearch] = useState(false);
  const [career, setCareer] = useState(false);
  const [help, setHelp] = useState(false);
  const [advanceChoice, setAdvanceChoice] = useState<{
    speed: string;
    days: number;
  } | null>(null);
  const touch = useRef<{ x: number; y: number } | null>(null);
  useEffect(() => {
    const handleKey = (event: KeyboardEvent) => {
      if (
        event.key === "/" &&
        !(event.target as HTMLElement).closest("input,textarea,select") &&
        !document.querySelector("dialog[open]")
      ) {
        event.preventDefault();
        setGlobalSearch(true);
      }
    };
    document.addEventListener("keydown", handleKey);
    return () => document.removeEventListener("keydown", handleKey);
  }, []);
  if (!bootstrap)
    return (
      <div className="startup">
        <span className="brand">
          <span className="brand-mark">
            <Goal size={21} />
          </span>
          touchline.
        </span>
        {error ? (
          <>
            <ErrorState message={error} />
            <Button onClick={() => void refresh()}>
              Reconnect to local engine
            </Button>
          </>
        ) : (
          <>
            <Loading label="Opening your football world" />
            <span className="muted">SQLite / Local career</span>
          </>
        )}
      </div>
    );
  const { club, state } = bootstrap;
  const speed = String(bootstrap.settings.simulationSpeed);
  const advanceDays =
    advanceChoice?.speed === speed
      ? advanceChoice.days
      : speed === "fast"
        ? 28
        : speed === "deliberate"
          ? 1
          : 7;
  const current = allItems.find((item) => item.id === page)!;
  const navClick = (next: Page) => {
    navigate(next);
    setMenu(false);
  };
  const mobilePages: Page[] = ["office", "squad", "scouting", "transfers"];
  return (
    <>
      <div className="app-shell">
        <aside className="sidebar">
          <a
            href="#office"
            className="brand"
            onClick={(event) => {
              event.preventDefault();
              navClick("office");
            }}
            aria-label="Touchline home"
          >
            <span className="brand-mark">
              <Goal size={21} strokeWidth={1.65} />
            </span>
            touchline.<span className="brand-version">26</span>
          </a>
          <button className="club-switch" onClick={() => setCareer(true)}>
            <Crest name={club.name} color={club.color} size={31} />
            <span>
              <strong>{club.name}</strong>
              <small>
                {club.league_name?.replace(`${club.country_name} `, "")}
              </small>
            </span>
            <ChevronDown size={12} className="muted" />
          </button>
          <nav className="nav-scroll" aria-label="Main navigation">
            {navigation.map((group) => (
              <div className="nav-group" key={group.label}>
                <div className="nav-label">{group.label}</div>
                {group.items.map((item) => (
                  <button
                    key={item.id}
                    className={`nav-item ${page === item.id ? "active" : ""}`}
                    aria-current={page === item.id ? "page" : undefined}
                    onClick={() => navClick(item.id)}
                  >
                    <item.icon size={17} strokeWidth={1.55} />
                    <span>{item.label}</span>
                    {item.id === "inbox" && !state.started && (
                      <span className="nav-count">4</span>
                    )}
                  </button>
                ))}
              </div>
            ))}
          </nav>
          <div className="sidebar-bottom">
            <button
              className={`nav-item ${page === "settings" ? "active" : ""}`}
              onClick={() => navClick("settings")}
            >
              <Settings2 size={17} strokeWidth={1.55} />
              <span>Settings</span>
            </button>
            <div className="director-mini">
              <span className="director-avatar">
                {state.director.name
                  .split(" ")
                  .map((name) => name[0])
                  .slice(0, 2)
                  .join("")}
              </span>
              <div>
                <strong>{state.director.name}</strong>
                <small>Sporting Director</small>
              </div>
              <ShieldCheck size={15} strokeWidth={1.5} />
            </div>
          </div>
        </aside>
        <div className="workspace">
          <header className="topbar">
            <div className="breadcrumb">
              <span>Your workspace</span>
              <ChevronRight size={12} />
              <strong>{current.label}</strong>
            </div>
            <button
              className="mobile-brand"
              style={{ border: 0, background: "transparent", padding: 0 }}
              onClick={() => navigate("office")}
            >
              <span className="brand-mark">
                <Goal size={19} />
              </span>
              touchline.
            </button>
            <div className="topbar-actions">
              <div className="header-date">
                <strong>{dateLabel(state.date)}</strong>
                <small>
                  {new Date(`${state.date}T12:00:00Z`).toLocaleDateString(
                    "en-GB",
                    { weekday: "long", timeZone: "UTC" },
                  )}{" "}
                  /{" "}
                  {state.date.slice(5, 7) === "07"
                    ? "Pre-season"
                    : `${state.season}/${String(state.season + 1).slice(-2)}`}
                </small>
              </div>
              <IconButton
                icon={Search}
                label="Search the player database"
                className="mobile-essential"
                onClick={() => setGlobalSearch(true)}
              />
              <IconButton
                icon={Bell}
                label="Open inbox"
                onClick={() => navigate("inbox")}
              />
              <IconButton
                icon={Settings2}
                label="Open settings"
                className="mobile-essential"
                onClick={() => navigate("settings")}
              />
              <IconButton
                icon={CircleHelp}
                label="Career information"
                className="optional-header"
                onClick={() => setHelp(true)}
              />
              <div className="continue-control">
                <Button
                  icon={Play}
                  onClick={() => void advance(advanceDays)}
                  disabled={busy || state.gameOver}
                >
                  Continue{advanceDays > 1 ? ` ${advanceDays}d` : ""}
                </Button>
                <span className="advance-menu">
                  <ChevronDown size={13} aria-hidden="true" />
                  <select
                    aria-label="Days to advance"
                    value={advanceDays}
                    onChange={(event) =>
                      setAdvanceChoice({
                        speed,
                        days: Number(event.target.value),
                      })
                    }
                  >
                    <option value="1">1 day</option>
                    <option value="7">1 week</option>
                    <option value="14">2 weeks</option>
                    <option value="28">4 weeks</option>
                  </select>
                </span>
              </div>
            </div>
          </header>
          <main
            className="main-scroll"
            id="main-content"
            onTouchStart={(event) => {
              if (
                (event.target as HTMLElement).closest(
                  "button,a,input,select,textarea,[data-no-swipe],.table-scroll",
                )
              ) {
                touch.current = null;
                return;
              }
              touch.current = {
                x: event.touches[0].clientX,
                y: event.touches[0].clientY,
              };
            }}
            onTouchEnd={(event) => {
              if (!touch.current) return;
              const deltaX = event.changedTouches[0].clientX - touch.current.x;
              const deltaY = event.changedTouches[0].clientY - touch.current.y;
              touch.current = null;
              if (
                Math.abs(deltaX) < 110 ||
                Math.abs(deltaY) > Math.abs(deltaX) * 0.4
              )
                return;
              const index = allItems.findIndex((item) => item.id === page);
              const next = allItems[index + (deltaX < 0 ? 1 : -1)];
              if (next) navigate(next.id);
            }}
          >
            {state.gameOver && (
              <div className="tenure-banner">
                <Landmark size={18} />
                <span>Your tenure at {club.name} has ended.</span>
                <Button variant="secondary" onClick={() => setCareer(true)}>
                  Find your next role
                </Button>
              </div>
            )}
            <ScreenBoundary key={page}>
              <Suspense fallback={<Loading />}>{views[page]}</Suspense>
            </ScreenBoundary>
          </main>
        </div>
      </div>
      <nav className="mobile-tabs" aria-label="Mobile navigation">
        {mobilePages.map((id) => {
          const item = allItems.find((entry) => entry.id === id)!;
          return (
            <button
              key={id}
              className={page === id ? "active" : ""}
              aria-current={page === id ? "page" : undefined}
              onClick={() => navClick(id)}
            >
              <item.icon size={20} strokeWidth={1.7} />
              <span>{item.label}</span>
            </button>
          );
        })}
        <button
          className={!mobilePages.includes(page) ? "active" : ""}
          onClick={() => setMenu(true)}
        >
          <Menu size={20} strokeWidth={1.7} />
          <span>More</span>
        </button>
      </nav>
      {toast && (
        <div
          className={`dynamic-island ${toast.tone === "error" ? "is-error" : ""}`}
          role={toast.tone === "error" ? "alert" : "status"}
        >
          {toast.tone === "error" ? (
            <Activity size={16} />
          ) : (
            <Check size={16} />
          )}
          <span>{toast.message}</span>
          <IconButton
            icon={X}
            label="Dismiss notification"
            onClick={dismissToast}
          />
        </div>
      )}
      {busy && (
        <div className="simulation-overlay" role="status" aria-live="polite">
          <LoaderCircle size={34} className="spin" />
          <h2>The football world moves on.</h2>
          <p>Matches, markets and the people behind them.</p>
          <div className="simulation-track">
            <span />
          </div>
          <small>{dateLabel(state.date)} / SQLite career</small>
        </div>
      )}
      {playerId && (
        <Suspense fallback={null}>
          <PlayerSheet key={playerId} />
        </Suspense>
      )}
      {menu && (
        <Modal title="Your workspace" onClose={() => setMenu(false)}>
          <div className="mobile-menu-grid">
            {allItems.map((item) => (
              <button
                key={item.id}
                className={`nav-item ${page === item.id ? "active" : ""}`}
                onClick={() => navClick(item.id)}
              >
                <item.icon size={18} />
                <span>{item.label}</span>
              </button>
            ))}
          </div>
        </Modal>
      )}
      {globalSearch && (
        <Modal
          title="Search the football world"
          onClose={() => setGlobalSearch(false)}
        >
          <form
            onSubmit={(event) => {
              event.preventDefault();
              navigate("database");
              setGlobalSearch(false);
            }}
          >
            <div className="sheet-body">
              <div className="search-field">
                <Search size={18} />
                <input
                  autoFocus
                  aria-label="Global player search"
                  placeholder="Player, club or nationality..."
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                />
              </div>
            </div>
            <div className="sheet-footer">
              <Button icon={Search} type="submit">
                Search {bootstrap.world.players.toLocaleString()} players
              </Button>
            </div>
          </form>
        </Modal>
      )}
      {career && (
        <Suspense fallback={null}>
          <CareerSheet close={() => setCareer(false)} />
        </Suspense>
      )}
      {help && (
        <Modal title="Career information" onClose={() => setHelp(false)}>
          <div className="sheet-body">
            <div className="info-brand">
              <span className="brand-mark">
                <Goal size={21} />
              </span>
              <h2>touchline.</h2>
              <span>Sporting Director / 2026</span>
            </div>
            <dl className="detail-list">
              <div>
                <dt>Game date</dt>
                <dd>{dateLabel(state.date)}</dd>
              </div>
              <div>
                <dt>Associations</dt>
                <dd>{bootstrap.world.countries}</dd>
              </div>
              <div>
                <dt>Domestic leagues</dt>
                <dd>{bootstrap.world.leagues.toLocaleString()}</dd>
              </div>
              <div>
                <dt>Clubs</dt>
                <dd>{bootstrap.world.clubs.toLocaleString()}</dd>
              </div>
              <div>
                <dt>Players</dt>
                <dd>{bootstrap.world.players.toLocaleString()}</dd>
              </div>
              <div>
                <dt>World</dt>
                <dd>Procedurally generated</dd>
              </div>
              <div>
                <dt>Storage</dt>
                <dd>Local SQLite</dd>
              </div>
              <div>
                <dt>Cloud services</dt>
                <dd>None</dd>
              </div>
            </dl>
          </div>
          <footer className="sheet-footer">
            <Button
              variant="secondary"
              icon={SlidersHorizontal}
              onClick={() => {
                setHelp(false);
                navigate("settings");
              }}
            >
              Preferences
            </Button>
          </footer>
        </Modal>
      )}
      {confirmation && (
        <Modal title={confirmation.title} onClose={closeConfirm}>
          <div className="sheet-body">
            <p className="sheet-description">{confirmation.message}</p>
          </div>
          <footer className="sheet-footer">
            <Button variant="secondary" onClick={closeConfirm}>
              Cancel
            </Button>
            <Button
              onClick={() => {
                const action = confirmation.action;
                closeConfirm();
                action();
              }}
            >
              Confirm
            </Button>
          </footer>
        </Modal>
      )}
    </>
  );
}

export default function App() {
  return (
    <GameProvider>
      <Shell />
    </GameProvider>
  );
}
