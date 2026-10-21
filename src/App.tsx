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
  BookOpen,
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
  Globe2,
  Handshake,
  House,
  Inbox,
  Landmark,
  LoaderCircle,
  Medal,
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
import { GameProvider, useGame, useResource, type Page } from "./game-context.tsx";
import { accessStateContent } from "./access-state.ts";
import {
  Button,
  Crest,
  ErrorState,
  IconButton,
  Loading,
  Modal,
} from "./ui.tsx";
import type { AccessIssue } from "./api-error.ts";
import { compactNumber, dateLabel } from "../shared/rules.ts";
import type { NewsItem } from "../shared/types.ts";
import { seasonText, unreadLabel } from "./format.ts";
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
const OfferView = lazy(() =>
  import("./views/Transfers.tsx").then((module) => ({
    default: module.OfferBuilder,
  })),
);
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
const InternationalsView = lazy(() => import("./views/Internationals.tsx"));
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
const StartView = lazy(() => import("./views/Start.tsx"));
const WorldView = lazy(() => import("./views/World.tsx"));
const ClubSheet = lazy(() => import("./ClubSheet.tsx"));

/** Internationals lives under the competitions page (`#competitions/internationals`) so deep links and Back work. */
type Screen = Page | "internationals";
const INTERNATIONALS_HASH = "#competitions/internationals";

function useHashSegment() {
  const [hash, setHash] = useState(() => location.hash);
  useEffect(() => {
    const handler = () => setHash(location.hash);
    window.addEventListener("hashchange", handler);
    return () => window.removeEventListener("hashchange", handler);
  }, []);
  return { segment: hash.slice(1).split("/")[1] ?? "", setHash };
}

const UNREAD_LIMIT = 100;

const navigation: {
  label: string;
  items: { id: Screen; label: string; icon: LucideIcon }[];
}[] = [
  {
    label: "Workspace",
    items: [
      { id: "office", label: "Overview", icon: House },
      { id: "inbox", label: "Inbox", icon: Inbox },
    ],
  },
  {
    label: "Squad & development",
    items: [
      { id: "squad", label: "Squad", icon: Users },
      { id: "academy", label: "Academy", icon: GraduationCap },
      { id: "training", label: "Training", icon: Dumbbell },
      { id: "staff", label: "Staff", icon: BriefcaseBusiness },
    ],
  },
  {
    label: "Recruitment",
    items: [
      { id: "database", label: "Player database", icon: Database },
      { id: "scouting", label: "Scouting", icon: Search },
      { id: "transfers", label: "Transfers", icon: ArrowLeftRight },
      { id: "loans", label: "Loans", icon: Handshake },
    ],
  },
  {
    label: "World",
    items: [
      { id: "world", label: "World browser", icon: Globe2 },
      { id: "competitions", label: "Competitions", icon: Trophy },
      { id: "internationals", label: "Internationals", icon: Medal },
      { id: "analytics", label: "Match centre", icon: ChartNoAxesCombined },
    ],
  },
  {
    label: "Club",
    items: [
      { id: "finances", label: "Finances", icon: Wallet },
      { id: "board", label: "Boardroom", icon: Landmark },
      { id: "media", label: "Media & fans", icon: MessageSquare },
    ],
  },
];
const mainItems = navigation.flatMap((group) => group.items);
const allItems: { id: Screen; label: string; icon: LucideIcon }[] = [
  ...mainItems,
  { id: "settings", label: "Settings", icon: Settings2 },
  { id: "offer", label: "Make an offer", icon: ArrowLeftRight },
  { id: "contract", label: "Player contract", icon: ArrowLeftRight },
];
const views: Record<Screen, ReactNode> = {
  start: <StartView />,
  office: <Office />,
  inbox: <InboxView />,
  squad: <SquadView />,
  scouting: <ScoutingView />,
  database: <DatabaseView />,
  world: <WorldView />,
  transfers: <TransferView />,
  offer: <OfferView />,
  contract: <OfferView />,
  loans: <LoanView />,
  academy: <AcademyView />,
  training: <TrainingView />,
  staff: <StaffView />,
  competitions: <CompetitionView />,
  internationals: <InternationalsView />,
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
    session,
    loading,
    bootstrap,
    error,
    accessIssue,
    page,
    navigate,
    playerId,
    clubProfileId,
    setClub,
    busy,
    advance,
    toast,
    dismissToast,
    search,
    setSearch,
    confirmation,
    closeConfirm,
    refresh,
    checkAccess,
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
  const { segment, setHash } = useHashSegment();
  const { data: unread } = useResource<NewsItem[]>(
    `news?status=unread&limit=${UNREAD_LIMIT}`,
    { keepPreviousData: true },
  );
  useEffect(() => {
    if (!bootstrap) return;
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
  }, [bootstrap]);
  if (loading || accessIssue || error || !session)
    return (
      <div className="startup">
        <span className="brand">
          <span className="brand-mark">
            <Goal size={21} />
          </span>
          touchline.
        </span>
        {accessIssue ? (
          <AccessState issue={accessIssue} onRetry={checkAccess} />
        ) : error ? (
          <>
            <ErrorState message={error} />
            <Button onClick={() => void refresh()}>
              Reconnect to account
            </Button>
          </>
        ) : (
          <>
            <Loading label="Opening your account" />
            <span className="muted">SQL career / Portable snapshots</span>
          </>
        )}
      </div>
    );
  if (page === "start" || !bootstrap)
    return (
      <ScreenBoundary>
        <Suspense fallback={<Loading label="Opening careers" />}>
          <StartView />
        </Suspense>
      </ScreenBoundary>
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
  const screen: Screen =
    page === "competitions" && segment === "internationals" ? "internationals" : page;
  const current = allItems.find((item) => item.id === screen) ?? allItems[0];
  const open = (next: Screen) => {
    if (next !== "internationals") {
      navigate(next);
      return;
    }
    navigate("competitions");
    history.replaceState(history.state, "", INTERNATIONALS_HASH);
    setHash(INTERNATIONALS_HASH);
  };
  const navClick = (next: Screen) => {
    open(next);
    setMenu(false);
  };
  const mobilePages: Page[] = ["office", "database", "squad", "academy"];
  return (
    <>
      <a
        className="skip-link"
        href="#main-content"
        onClick={(event) => {
          event.preventDefault();
          document.getElementById("main-content")?.focus();
        }}
      >
        Skip to content
      </a>
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
          <button className="club-switch" onClick={() => setClub(club.id)}>
            <Crest name={club.name} color={club.color} size={31} />
            <span>
              <strong>{club.name}</strong>
              <small>{club.league_name}</small>
            </span>
            <ChevronDown size={12} className="muted" />
          </button>
          <nav className="nav-scroll" aria-label="Main navigation">
            {navigation.map((group) => (
              <div className="nav-group" key={group.label} role="group" aria-label={group.label}>
                <div className="nav-label">{group.label}</div>
                {group.items.map((item) => (
                  <button
                    key={item.id}
                    className={`nav-item ${screen === item.id ? "active" : ""}`}
                    aria-current={screen === item.id ? "page" : undefined}
                    onClick={() => navClick(item.id)}
                  >
                    <item.icon size={17} strokeWidth={1.55} />
                    <span>{item.label}</span>
                    {item.id === "inbox" && !!unread?.length && (
                      <span className="nav-count" aria-label={`${unread.length} unread`}>
                        {unreadLabel(unread.length, UNREAD_LIMIT)}
                      </span>
                    )}
                  </button>
                ))}
              </div>
            ))}
          </nav>
          <div className="sidebar-bottom">
            <button className="nav-item" onClick={() => navClick("start")}>
              <BookOpen size={17} strokeWidth={1.55} />
              <span>Careers</span>
            </button>
            <button
              className={`nav-item ${page === "settings" ? "active" : ""}`}
              aria-current={page === "settings" ? "page" : undefined}
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
                <strong>
                  <button
                    className="profile-link"
                    onClick={() => setCareer(true)}
                  >
                    {state.director.name}
                  </button>
                </strong>
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
                  {seasonText(state.season, state.date.slice(5, 7) === "07")}
                </small>
              </div>
              <IconButton
                icon={BookOpen}
                label="Career start menu"
                className="mobile-essential"
                onClick={() => navigate("start")}
              />
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
            tabIndex={-1}
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
              // Swipe only between the main navigation pages, never into settings or the offer/contract pages.
              const index = mainItems.findIndex((item) => item.id === screen);
              if (index < 0) return;
              const next = mainItems[index + (deltaX < 0 ? 1 : -1)];
              if (next) open(next.id);
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
            <ScreenBoundary key={screen}>
              <Suspense fallback={<Loading />}>{views[screen]}</Suspense>
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
              <span>{id === "database" ? "Database" : item.label}</span>
            </button>
          );
        })}
        <button
          className={!mobilePages.includes(page) ? "active" : ""}
          aria-haspopup="dialog"
          aria-expanded={menu}
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
          <small>{dateLabel(state.date)} / Active career</small>
        </div>
      )}
      {playerId && (
        <Suspense fallback={null}>
          <PlayerSheet key={playerId} />
        </Suspense>
      )}
      {clubProfileId && (
        <Suspense fallback={null}>
          <ClubSheet key={clubProfileId} />
        </Suspense>
      )}
      {menu && (
        <Modal title="Your workspace" onClose={() => setMenu(false)}>
          <nav className="mobile-menu-sections" aria-label="All pages">
            {navigation.map((group) => (
              <section className="mobile-menu-section" key={group.label} aria-label={group.label}>
                <h3>{group.label}</h3>
                <div className="mobile-menu-grid">
                  {group.items.map((item) => (
                    <button
                      type="button"
                      key={item.id}
                      className={`nav-item ${screen === item.id ? "active" : ""}`}
                      aria-current={screen === item.id ? "page" : undefined}
                      onClick={() => navClick(item.id)}
                    >
                      <item.icon size={18} aria-hidden="true" />
                      <span>{item.label}</span>
                    </button>
                  ))}
                </div>
              </section>
            ))}
            <section className="mobile-menu-section" aria-label="Career & actions">
              <h3>Career & actions</h3>
              <div className="mobile-menu-grid">
                <button type="button" className="nav-item" onClick={() => navClick("start")}>
                  <BookOpen size={18} aria-hidden="true" /><span>Careers</span>
                </button>
                {allItems.filter((item) => ["settings", "offer", "contract"].includes(item.id)).map((item) => (
                  <button
                    type="button"
                    key={item.id}
                    className={`nav-item ${page === item.id ? "active" : ""}`}
                    aria-current={page === item.id ? "page" : undefined}
                    onClick={() => navClick(item.id)}
                  >
                    <item.icon size={18} aria-hidden="true" /><span>{item.label}</span>
                  </button>
                ))}
              </div>
            </section>
          </nav>
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
                Search {compactNumber(bootstrap.world.players)} players
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
                <dd>{compactNumber(bootstrap.world.leagues)}</dd>
              </div>
              <div>
                <dt>Clubs</dt>
                <dd>{compactNumber(bootstrap.world.clubs)}</dd>
              </div>
              <div>
                <dt>Players</dt>
                <dd>{compactNumber(bootstrap.world.players)}</dd>
              </div>
              <div>
                <dt>World</dt>
                <dd>Procedurally generated</dd>
              </div>
              <div>
                <dt>Storage</dt>
                <dd>PostgreSQL</dd>
              </div>
              <div>
                <dt>Save format</dt>
                <dd>Portable .touchline.gz</dd>
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

function AccessState({
  issue,
  onRetry,
}: {
  issue: AccessIssue;
  onRetry: () => Promise<void>;
}) {
  // The provider remounts this screen after every failed check, so only `checking` is local.
  const [checking, setChecking] = useState(false);
  const content = accessStateContent(
    issue,
    `${location.pathname}${location.search}${location.hash}`,
  );
  async function retry() {
    setChecking(true);
    try {
      await onRetry();
    } finally {
      setChecking(false);
    }
  }
  const unchanged = issue.rechecked
    ? content.actions.find((action) => action.kind === "retry")?.unchanged
    : undefined;
  return (
    <main className="access-state" aria-labelledby="access-state-title">
      <span className="eyebrow">{content.eyebrow}</span>
      <h1 id="access-state-title">{content.heading}</h1>
      <p>{content.explanation}</p>
      <div className="access-actions">
        {content.actions.map((action, index) => {
          const variant = index === 0 ? "primary" : "secondary";
          if (action.kind === "link")
            return (
              <a key={action.label} className={`button button-${variant}`} href={action.href}>
                {action.label}
              </a>
            );
          if (action.kind === "form")
            return (
              <form key={action.label} method="post" action={action.action} style={{ display: "contents" }}>
                <button type="submit" className={`button button-${variant}`}>
                  {action.label}
                </button>
              </form>
            );
          return (
            <Button
              key={action.label}
              variant={variant}
              disabled={checking}
              aria-busy={checking || undefined}
              onClick={() => void retry()}
            >
              {checking ? "Checking..." : action.label}
            </Button>
          );
        })}
      </div>
      <p role="status" className="access-status">
        {checking ? "" : unchanged}
      </p>
    </main>
  );
}

export default function App() {
  return (
    <GameProvider>
      <Shell />
    </GameProvider>
  );
}
