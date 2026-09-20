import {
  ArrowDownLeft,
  ArrowUpRight,
  CalendarDays,
  Check,
  ChevronRight,
  CircleDollarSign,
  ClipboardList,
  Compass,
  Flag,
  Inbox,
  Landmark,
  ScanLine,
  ShieldCheck,
  Sparkles,
  Target,
  TrendingUp,
  Users,
  Wallet,
} from "lucide-react";
import { useGame, useResource } from "../game-context.tsx";
import {
  Badge,
  Button,
  Crest,
  Empty,
  ErrorState,
  FixtureRow,
  Loading,
  Meter,
  PageHeading,
  Panel,
  SectionHeading,
  Silhouette,
  StandingsTable,
  Stat,
  TextLink,
  Rating,
} from "../ui.tsx";
import {
  addDays,
  dateLabel,
  daysBetween,
  money,
  transferWindow,
} from "../../shared/rules.ts";
import type { Dashboard } from "../../shared/api.ts";
import type { Player } from "../../shared/types.ts";

function MiniPitch() {
  const { bootstrap } = useGame();
  const positions = [
    [50, 84],
    [18, 67],
    [39, 71],
    [61, 71],
    [82, 67],
    [50, 54],
    [32, 42],
    [68, 42],
    [18, 22],
    [50, 16],
    [82, 22],
  ];
  return (
    <div className="mini-pitch secondary-detail">
      <svg
        viewBox="0 0 140 160"
        role="img"
        aria-label={`${bootstrap?.club.formation} squad formation`}
      >
        <g transform="translate(14 6)">
          <rect
            width="112"
            height="134"
            rx="3"
            fill="var(--accent-soft)"
            stroke="var(--accent)"
            strokeOpacity=".22"
          />
          <path
            d="M0 67H112M23 0V27H89V0M40 0V11H72V0M23 134V107H89V134M40 134V123H72V134"
            fill="none"
            stroke="var(--accent)"
            strokeOpacity=".22"
          />
          <circle
            cx="56"
            cy="67"
            r="18"
            stroke="var(--accent)"
            strokeOpacity=".22"
            fill="none"
          />
          {positions.map(([x, y], index) => (
            <g key={index} transform={`translate(${x * 1.12},${y * 1.5})`}>
              <circle
                r="6.5"
                fill={index === 0 ? "var(--amber)" : "var(--accent)"}
                opacity={index > 7 ? 1 : 0.75}
                stroke="var(--surface)"
                strokeWidth="2"
              />
            </g>
          ))}
        </g>
      </svg>
      <span className="pitch-label">
        {bootstrap?.club.formation} / {bootstrap?.club.tactical_style}
      </span>
    </div>
  );
}

function WatchCard({ player }: { player: Player }) {
  const { setPlayer } = useGame();
  return (
    <article className="watch-card">
      <Badge tone="green">{player.position}</Badge>
      <button
        className="icon-button"
        title={`View ${player.name}`}
        aria-label={`View ${player.name}`}
        onClick={() => setPlayer(player.id)}
      >
        <ArrowUpRight size={15} />
      </button>
      <button className="watch-identity" onClick={() => setPlayer(player.id)}>
        <Silhouette size={47} color={player.club_color} />
        <span>
          <strong>{player.name}</strong>
          <small>
            {player.age} yrs / {player.nationality}
          </small>
        </span>
      </button>
      <div className="watch-data">
        <div>
          <strong>{money(player.value)}</strong>
          <small>Market value</small>
        </div>
        <div>
          <Rating value={player.potential} potential />
          <small>Potential</small>
        </div>
        <div>
          <strong>{Math.round(player.ability)}</strong>
          <small>Ability</small>
        </div>
      </div>
    </article>
  );
}

export default function Office() {
  const { bootstrap, navigate, openLeague, openMatch, setPlayer } = useGame();
  const { data, error, loading } = useResource<Dashboard>("dashboard");
  if (error) return <ErrorState message={error} />;
  if (!data || !bootstrap) return <Loading />;
  const { club, state } = bootstrap;
  const inWindow = transferWindow(state.date);
  const monthDay = state.date.slice(5);
  const deadline =
    monthDay <= "01-31"
      ? `${state.date.slice(0, 4)}-01-31`
      : `${state.date.slice(0, 4)}-09-01`;
  const deadlineDays = Math.max(0, daysBetween(state.date, deadline));
  const ownPosition =
    data.table.findIndex((entry) => entry.club_id === club.id) + 1;
  const newsItems = data.news
    .filter((item) => item.category !== "Match")
    .slice(0, 3);
  const surnames = state.director.name.split(" ");
  const firstName = surnames[0];
  const openNews = (action: string | null, payload: string) => {
    const parsed = JSON.parse(payload);
    if (parsed.fixtureId) openMatch(parsed.fixtureId);
    else if (parsed.playerId) setPlayer(parsed.playerId);
    else
      navigate(
        action === "board"
          ? "board"
          : action === "scouting"
            ? "scouting"
            : action === "academy"
              ? "academy"
              : action === "transfers"
                ? "transfers"
                : "inbox",
      );
  };
  return (
    <div className="page" aria-busy={loading}>
      <PageHeading
        eyebrow={`THE DIRECTOR'S OFFICE / ${state.season}-${String(state.season + 1).slice(-2)}`}
        title={`Good morning, ${firstName}.`}
        subtitle={
          <>
            {club.name} <span className="muted">/</span> {dateLabel(state.date)}
          </>
        }
      >
        <Badge tone="green" dot>
          {inWindow ? "Transfer window open" : "Season in progress"}
        </Badge>
        <Button
          icon={Inbox}
          variant="secondary"
          onClick={() => navigate("inbox")}
        >
          Inbox{" "}
          {data.unread > 0 && <span className="nav-count">{data.unread}</span>}
        </Button>
      </PageHeading>
      <div className="stat-strip">
        <Stat
          label="Transfer budget"
          value={money(club.transfer_budget)}
          icon={Wallet}
          detail={
            <>
              <span className="positive">
                <ArrowUpRight size={11} /> Available
              </span>
              <span>this window</span>
            </>
          }
        />
        <Stat
          label="Wage budget"
          value={money(club.wage_budget - data.squad.wages)}
          icon={CircleDollarSign}
          detail={
            <>
              <Meter
                value={data.squad.wages}
                max={club.wage_budget}
                tone="blue"
              />
              <span>
                {Math.round((data.squad.wages / club.wage_budget) * 100)}%
                committed
              </span>
            </>
          }
        />
        <Stat
          label="Board confidence"
          value={
            <>
              {Math.round(club.board_confidence)}
              <small>/100</small>
            </>
          }
          icon={Landmark}
          detail={
            <>
              <span className="status-dot positive" />
              <span>
                {club.board_confidence >= 65
                  ? "Pleased with your direction"
                  : club.board_confidence >= 40
                    ? "Expecting progress"
                    : "Under significant pressure"}
              </span>
            </>
          }
        />
        <Stat
          label="Squad harmony"
          value={
            <>
              {Math.round(club.chemistry)}
              <small>/100</small>
            </>
          }
          icon={Users}
          detail={
            <>
              <span className="status-dot positive" />
              <span>
                {club.chemistry >= 65
                  ? "A settled dressing room"
                  : "Relationships need attention"}
              </span>
            </>
          }
        />
      </div>
      <div className="office-grid">
        <div className="office-main">
          <section className="window-overview">
            <div className="window-copy">
              <Badge tone="green">
                <span className="status-dot" />{" "}
                {inWindow ? "RECRUITMENT WINDOW" : "THE SPORTING PROJECT"}
              </Badge>
              <h2>
                {inWindow
                  ? "Build for what comes next."
                  : "Keep the project moving."}
              </h2>
              <p>
                {inWindow
                  ? `${deadlineDays} days to shape the squad. Every signing is a decision about your future.`
                  : `${club.manager} leads the team. The long-term direction is in your hands.`}
              </p>
              <div className="window-bottom">
                <span>
                  <strong>{data.activeNegotiations}</strong> Active talks
                </span>
                <span>
                  <strong>{data.shortlist.length}</strong> Priority targets
                </span>
                <span>
                  <strong>{data.squad.count}</strong> Senior players
                </span>
              </div>
            </div>
            <MiniPitch />
          </section>
          <Panel>
            <SectionHeading
              title="On your desk"
              subtitle="The decisions that need your attention"
            >
              <Badge tone="neutral">
                {data.expiring.length ? 3 : 2} priorities
              </Badge>
            </SectionHeading>
            <div className="priority-list">
              <button
                className="priority-row"
                onClick={() => navigate("scouting")}
              >
                <span className="priority-icon">
                  <ScanLine size={17} />
                </span>
                <span className="priority-copy">
                  <strong>Define your recruitment priorities</strong>
                  <small>
                    {data.shortlist.length} scouted targets. A clear brief makes
                    the difference.
                  </small>
                </span>
                <Badge tone="green">Scouting</Badge>
                <ChevronRight size={15} />
              </button>
              {data.expiring.length > 0 && (
                <button
                  className="priority-row"
                  onClick={() => setPlayer(data.expiring[0].id)}
                >
                  <span className="priority-icon amber-icon">
                    <ClipboardList size={17} />
                  </span>
                  <span className="priority-copy">
                    <strong>
                      {data.expiring.length} contracts need a decision
                    </strong>
                    <small>
                      {data.expiring
                        .slice(0, 2)
                        .map((player) => player.name)
                        .join(" and ")}{" "}
                      enter their final year.
                    </small>
                  </span>
                  <Badge tone="amber">Contracts</Badge>
                  <ChevronRight size={15} />
                </button>
              )}
              <button
                className="priority-row"
                onClick={() => navigate("academy")}
              >
                <span className="priority-icon blue-icon">
                  <Sparkles size={17} />
                </span>
                <span className="priority-copy">
                  <strong>Give the next generation a pathway</strong>
                  <small>
                    Review academy prospects and agree a mentoring plan.
                  </small>
                </span>
                <Badge tone="blue">Academy</Badge>
                <ChevronRight size={15} />
              </button>
            </div>
          </Panel>
          <Panel>
            <SectionHeading
              title={
                club.league_name?.replace(`${club.country_name} `, "") ??
                "League standings"
              }
              subtitle={
                data.table[0]?.played
                  ? `Matchweek ${Math.max(...data.table.map((entry) => entry.played))} / ${ownPosition}${ownPosition === 1 ? "st" : ownPosition === 2 ? "nd" : ownPosition === 3 ? "rd" : "th"} place`
                  : "2026/27 season / Kick-off in August"
              }
            >
              <TextLink
                onClick={() => club.league_id && openLeague(club.league_id)}
              >
                Full table
              </TextLink>
            </SectionHeading>
            <StandingsTable
              entries={data.table.slice(0, 6)}
              ownId={club.id}
              compact
            />
            <div className="pulse-footer">
              <span className="status-dot positive" />
              {data.table[0]?.played
                ? "Live standings and expected points"
                : "A new season. A level playing field."}
            </div>
          </Panel>
          <section className="watchlist-section">
            <div className="unframed-heading">
              <h2>On your radar</h2>
              <TextLink onClick={() => navigate("scouting")}>
                Your shortlist
              </TextLink>
            </div>
            <div className="watchlist-grid">
              {data.shortlist.slice(0, 3).map((player) => (
                <WatchCard key={player.id} player={player} />
              ))}
            </div>
            {!data.shortlist.length && (
              <Empty
                icon={Compass}
                title="Your next signing starts here"
                detail="The scouting team is ready for a brief."
              />
            )}
          </section>
        </div>
        <aside className="office-side">
          <Panel>
            <SectionHeading title="Coming up">
              <CalendarDays size={16} className="muted" />
            </SectionHeading>
            {data.fixtures.slice(0, 3).map((fixture) => (
              <FixtureRow key={fixture.id} fixture={fixture} />
            ))}
            {!data.fixtures.length && (
              <Empty
                title="Season complete"
                detail="The new calendar will follow at the season rollover."
              />
            )}
            <div className="pulse-footer">
              <TextLink onClick={() => navigate("analytics")}>
                Match centre
              </TextLink>
            </div>
          </Panel>
          <Panel>
            <SectionHeading title="Around the club">
              <span className="status-dot positive" />
            </SectionHeading>
            <div className="news-feed">
              {newsItems.map((item) => (
                <button
                  key={item.id}
                  className="news-item"
                  onClick={() => openNews(item.action, item.data)}
                >
                  <span className="news-meta">
                    <span
                      className={`news-category-dot ${item.category.toLowerCase()}`}
                    />
                    {item.category}
                    <span>/</span>
                    {dateLabel(item.date).replace(
                      ` ${state.date.slice(0, 4)}`,
                      "",
                    )}
                  </span>
                  <strong>{item.title}</strong>
                  <p>
                    {item.body.length > 115
                      ? `${item.body.slice(0, 112)}...`
                      : item.body}
                  </p>
                </button>
              ))}
            </div>
            <div className="pulse-footer">
              <TextLink onClick={() => navigate("inbox")}>All updates</TextLink>
            </div>
          </Panel>
          <Panel className="board-snapshot">
            <SectionHeading title="The season mandate">
              <Flag size={15} className="muted" />
            </SectionHeading>
            <div className="padded" style={{ paddingTop: 0 }}>
              <div className="mandate-club">
                <Crest name={club.name} color={club.color} size={32} />
                <div>
                  <strong>{club.name}</strong>
                  <small>{club.philosophy}</small>
                </div>
              </div>
              <ul className="mandate-list">
                <li>
                  <Target size={14} />
                  <span>Finish in the top {club.expectations}</span>
                </li>
                <li>
                  <ArrowDownLeft size={14} />
                  <span>Maintain a sustainable wage bill</span>
                </li>
                <li>
                  <TrendingUp size={14} />
                  <span>Develop the academy pathway</span>
                </li>
                <li>
                  <ShieldCheck size={14} />
                  <span>Respect financial regulations</span>
                </li>
              </ul>
              <TextLink onClick={() => navigate("board")}>Boardroom</TextLink>
            </div>
          </Panel>
        </aside>
      </div>
      <footer className="save-status">
        <Check size={12} />
        <span>Local career / SQLite</span>
        <span>
          Next weekly review: {dateLabel(addDays(state.date, 7))}{" "}
          <span style={{ paddingInline: 8 }}>/</span>{" "}
          {bootstrap.world.players.toLocaleString()} players in your world
        </span>
      </footer>
    </div>
  );
}
