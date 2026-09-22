import { useDeferredValue, useState } from "react";
import {
  Activity,
  ArrowLeftRight,
  ArrowUpRight,
  CheckCheck,
  CircleDollarSign,
  ChevronLeft,
  ChevronRight,
  Flag,
  GraduationCap,
  Handshake,
  Heart,
  Inbox as InboxIcon,
  Landmark,
  Megaphone,
  MessageCircle,
  MessageSquare,
  Mic,
  Newspaper,
  RotateCcw,
  Search,
  ShieldCheck,
  Target,
  TrendingUp,
  Users,
  Wallet,
} from "lucide-react";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import {
  useCurrency,
  useGame,
  useResource,
  type Page,
} from "../game-context.tsx";
import {
  Badge,
  Button,
  ClubLink,
  Crest,
  DetailList,
  Empty,
  ErrorState,
  Field,
  IconButton,
  Loading,
  Meter,
  Modal,
  PageHeading,
  Panel,
  PlayerLink,
  SectionHeading,
  Stat,
  Tabs,
} from "../ui.tsx";
import { compactNumber, dateLabel, label } from "../../shared/rules.ts";
import type {
  Dashboard,
  FinanceData,
  Journalist,
  MediaData,
  MediaStory,
  CompetitionFavorite,
} from "../../shared/api.ts";
import type { NewsItem } from "../../shared/types.ts";
import { TransferPaymentTable } from "./Transfers.tsx";
import { AffiliatesPanel, EventsPanel } from "./ClubSupport.tsx";

function BudgetSheet({ close, wages }: { close: () => void; wages: number }) {
  const { bootstrap, act } = useGame();
  const { money } = useCurrency();
  const [adjustment, setAdjustment] = useState(0);
  const [pending, setPending] = useState(false);
  if (!bootstrap) return null;
  const { club } = bootstrap;
  const minimum = Math.max(
    -100_000_000,
    Math.ceil((wages - club.wage_budget) * 52),
  );
  const maximum = Math.min(100_000_000, Math.floor(club.transfer_budget));
  const available = minimum <= maximum;
  const amount = available
    ? Math.min(maximum, Math.max(minimum, adjustment))
    : 0;
  const position =
    maximum > minimum ? ((amount - minimum) / (maximum - minimum)) * 100 : 0;
  const transferBudget = club.transfer_budget - amount;
  const wageBudget = club.wage_budget + amount / 52;
  async function confirmAllocation() {
    setPending(true);
    const result = await act({ type: "budget", amount });
    setPending(false);
    if (result) close();
  }
  return (
    <Modal title="Rebalance your budgets" onClose={close}>
      <div className="sheet-body">
        <Field
          label="Transfer and wage budget allocation"
          className="budget-allocation-field"
        >
          <input
            type="range"
            min="0"
            max="100"
            step="0.1"
            value={position}
            aria-valuetext={`${money(transferBudget, true)} transfer budget; ${money(wageBudget, true)} weekly wage budget`}
            disabled={pending || !available || minimum === maximum}
            onChange={(event) =>
              setAdjustment(
                Math.round(
                  minimum +
                    (Number(event.target.value) / 100) * (maximum - minimum),
                ),
              )
            }
          />
        </Field>
        <div className="budget-slider-labels" aria-hidden="true">
          <span>More transfer funds</span>
          <span>More weekly wages</span>
        </div>
        {!available && (
          <p className="sheet-description negative">
            Available funds cannot cover the current wage commitments.
          </p>
        )}
        <div className="section-space">
          <DetailList
            items={[
              ["Revised transfer budget", money(transferBudget)],
              ["Revised weekly wage budget", money(wageBudget)],
              ["Current weekly wages", money(wages)],
              [
                "Weekly wage change",
                amount === 0
                  ? money(0)
                  : `${amount > 0 ? "+" : "-"}${money(Math.abs(amount) / 52)}`,
              ],
            ]}
          />
        </div>
      </div>
      <footer className="sheet-footer">
        <Button variant="secondary" onClick={close} disabled={pending}>
          Cancel
        </Button>
        <Button
          icon={ArrowLeftRight}
          disabled={pending || !available || amount === 0}
          onClick={() => void confirmAllocation()}
        >
          Confirm allocation
        </Button>
      </footer>
    </Modal>
  );
}

export function Finances() {
  const { bootstrap, act, confirm } = useGame();
  const { money, currency } = useCurrency();
  const { data, error } = useResource<FinanceData>("finances");
  const [tab, setTab] = useState("overview");
  const [budgetOpen, setBudgetOpen] = useState(false);
  if (error) return <ErrorState message={error} />;
  if (!data || !bootstrap) return <Loading />;
  const club = bootstrap.club;
  const chart = data.history.length
    ? data.history
    : [
        {
          date: bootstrap.state.date,
          balance: club.balance,
          income: club.income,
          expenses: club.spending,
          ffp: club.ffp,
          wages: data.wages,
          transferBudget: club.transfer_budget,
        },
      ];
  return (
    <div className="page">
      <PageHeading
        eyebrow="SUSTAINABLE AMBITION"
        title="Club finances"
        subtitle={`${club.name} / ${currency}`}
      >
        <Button
          icon={ArrowLeftRight}
          variant="secondary"
          onClick={() => setBudgetOpen(true)}
        >
          Adjust budgets
        </Button>
      </PageHeading>
      <div className="stat-strip">
        <Stat
          label="Club balance"
          value={money(club.balance)}
          icon={Landmark}
          detail={
            <span className={club.balance >= 0 ? "positive" : "negative"}>
              {club.balance >= 0 ? "Positive cash position" : "Cash deficit"}
            </span>
          }
        />
        <Stat
          label="Transfer budget"
          value={money(club.transfer_budget)}
          icon={Wallet}
          detail="Available allocation"
        />
        <Stat
          label="Weekly player wages"
          value={money(data.wages)}
          icon={Users}
          detail={`${money(club.wage_budget - data.wages)} headroom`}
        />
        <Stat
          label="Squad market value"
          value={money(data.squadValue)}
          icon={TrendingUp}
          detail="Includes players loaned out"
        />
      </div>
      <Panel>
        <Tabs
          items={[
            { id: "overview", label: "Overview" },
            { id: "ledger", label: "Transactions" },
            { id: "payments", label: "Transfer payments" },
            { id: "ffp", label: "Financial regulations" },
            { id: "investments", label: "Infrastructure" },
          ]}
          value={tab}
          onChange={setTab}
        />
        {tab === "payments" && (
          <>
            <div className="padded">
              <DetailList
                items={[
                  ["Outstanding payable", money(data.transferPayable)],
                  [
                    "Reserved for future arrivals",
                    money(data.futureTransferReserved),
                  ],
                  ["Outstanding receivable", money(data.transferReceivable)],
                  [
                    "Net scheduled cash",
                    money(data.transferReceivable - data.transferPayable),
                  ],
                ]}
              />
            </div>
            <TransferPaymentTable
              payments={data.transferPayments}
              clubId={club.id}
            />
          </>
        )}
        {tab === "overview" && (
          <div className="padded">
            <div className="profile-columns">
              <section>
                <h3 className="subsection-title">Cash balance</h3>
                <div className="chart-box">
                  <ResponsiveContainer width="100%" height="100%">
                    <AreaChart
                      data={chart}
                      margin={{ top: 10, right: 10, left: 0, bottom: 0 }}
                    >
                      <CartesianGrid
                        stroke="var(--line)"
                        vertical={false}
                        strokeDasharray="3 3"
                      />
                      <XAxis
                        dataKey="date"
                        tickFormatter={(value: string) => value.slice(5)}
                        tick={{ fontSize: 10, fill: "var(--muted)" }}
                        axisLine={false}
                        tickLine={false}
                      />
                      <YAxis
                        tickFormatter={(value: number) => money(value)}
                        tick={{ fontSize: 10, fill: "var(--muted)" }}
                        axisLine={false}
                        tickLine={false}
                        width={65}
                      />
                      <Tooltip
                        formatter={(value) => money(Number(value))}
                        contentStyle={{
                          background: "var(--surface)",
                          borderColor: "var(--line)",
                          fontSize: 12,
                        }}
                      />
                      <Area
                        dataKey="balance"
                        name="Cash balance"
                        stroke="var(--accent)"
                        fill="var(--accent)"
                        fillOpacity={0.09}
                        strokeWidth={2}
                      />
                    </AreaChart>
                  </ResponsiveContainer>
                </div>
              </section>
              <section>
                <h3 className="subsection-title">Season position</h3>
                <DetailList
                  items={[
                    ["Club enterprise estimate", money(data.valuation.enterpriseValue)],
                    ["Operating revenue / year (estimate)", money(data.valuation.annualOperatingRevenue)],
                    ["Revenue multiple", `${data.valuation.revenueMultiple.toFixed(2)}x`],
                    ["Operating income", money(club.income)],
                    ["Operating expenditure", money(club.spending)],
                    [
                      "Net cash movement",
                      <span
                        key="net-cash"
                        className={
                          club.income >= club.spending ? "positive" : "negative"
                        }
                      >
                        {money(club.income - club.spending)}
                      </span>,
                    ],
                    ["Staff wages / week", money(data.staffWages)],
                    ["Annual wage commitment", money(data.projectedWages)],
                    ["Transfer amortization / year", money(data.amortization)],
                    ["Transfer investment", money(club.season_spend)],
                  ]}
                />
              </section>
            </div>
            <h3 className="subsection-title section-space">
              Income & expenditure
            </h3>
            <div className="chart-box">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={chart} margin={{ left: 0, right: 15 }}>
                  <CartesianGrid
                    stroke="var(--line)"
                    vertical={false}
                    strokeDasharray="3 3"
                  />
                  <XAxis
                    dataKey="date"
                    tickFormatter={(value: string) => value.slice(5)}
                    tick={{ fontSize: 10 }}
                    axisLine={false}
                    tickLine={false}
                  />
                  <YAxis
                    tickFormatter={(value: number) => money(value)}
                    tick={{ fontSize: 10 }}
                    width={65}
                    axisLine={false}
                    tickLine={false}
                  />
                  <Tooltip
                    formatter={(value) => money(Number(value))}
                    contentStyle={{
                      background: "var(--surface)",
                      borderColor: "var(--line)",
                      fontSize: 12,
                    }}
                  />
                  <Bar
                    dataKey="income"
                    name="Income"
                    fill="var(--accent)"
                    radius={[3, 3, 0, 0]}
                  />
                  <Bar
                    dataKey="expenses"
                    name="Expenditure"
                    fill="var(--amber)"
                    radius={[3, 3, 0, 0]}
                  />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>
        )}
        {tab === "ledger" &&
          (data.ledger.length ? (
            <div className="table-scroll">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Date</th>
                    <th>Category</th>
                    <th>Description</th>
                    <th className="number">Amount</th>
                  </tr>
                </thead>
                <tbody>
                  {data.ledger.map((entry) => (
                    <tr key={entry.id}>
                      <td>{dateLabel(entry.date)}</td>
                      <td>
                        <Badge tone={entry.amount >= 0 ? "green" : "neutral"}>
                          {entry.category}
                        </Badge>
                      </td>
                      <td>{entry.description}</td>
                      <td
                        className={`number money ${entry.amount >= 0 ? "positive" : "negative"}`}
                      >
                        {entry.amount > 0 ? "+" : ""}
                        {money(entry.amount)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <Empty
              icon={Wallet}
              title="A fresh set of accounts"
              detail="The first weekly accounts close after seven days. Recruitment and investment decisions are recorded immediately."
            />
          ))}
        {tab === "ffp" && (
          <div className="padded">
            <div className="equal-columns">
              <div>
                <div className="compliance-status">
                  <ShieldCheck size={30} />
                  <div>
                    <h3>
                      {!bootstrap.settings.ffp
                        ? "Enforcement disabled"
                        : data.compliance.status === "review"
                          ? "Closed accounts under review"
                          : data.compliance.status === "monitoring"
                            ? "Forecast requires attention"
                            : "Within modeled limits"}
                    </h3>
                    <p>{data.compliance.policy}</p>
                  </div>
                </div>
                <DetailList
                  items={[
                    [
                      "Accounts",
                      data.compliance.projected
                        ? "Current-season forecast"
                        : "Closed financial period",
                    ],
                    [
                      "Football revenue",
                      money(data.compliance.footballRevenue),
                    ],
                    ["Squad costs", money(data.compliance.squadCost)],
                    [
                      "Squad-cost ratio",
                      `${(data.compliance.squadCostRatio * 100).toFixed(1)}%`,
                    ],
                    [
                      "Squad-cost limit",
                      data.compliance.squadCostLimit === null
                        ? "Club budgets only"
                        : `${Math.round(data.compliance.squadCostLimit * 100)}%`,
                    ],
                    [
                      "Squad-cost headroom",
                      data.compliance.costHeadroom === null
                        ? "Not applicable"
                        : money(data.compliance.costHeadroom),
                    ],
                    [
                      "Recorded rolling earnings",
                      money(data.compliance.rollingEarnings),
                    ],
                    [
                      "Equity-supported allowable loss",
                      data.compliance.allowableLoss === null
                        ? "Not applicable"
                        : money(data.compliance.allowableLoss),
                    ],
                    [
                      "Simulated periods observed",
                      `${data.compliance.yearsObserved} / 3`,
                    ],
                    [
                      "Enforcement",
                      bootstrap.settings.ffp ? "Enabled" : "Disabled",
                    ],
                    ["Annual amortization", money(data.amortization)],
                  ]}
                />
                {data.compliance.issues.map((issue) => (
                  <p className="sheet-description negative" key={issue}>
                    {issue}
                  </p>
                ))}
                <p className="sheet-description">{data.compliance.source}</p>
              </div>
              <div>
                <h3 className="subsection-title">
                  Contingent purchase commitments
                </h3>
                {data.commitments.length ? (
                  data.commitments.map((commitment) => (
                    <div className="promise-item" key={commitment.name}>
                      <div>
                        <strong>{commitment.name}</strong>
                        <p>{commitment.type}</p>
                      </div>
                      <strong>{money(commitment.amount)}</strong>
                    </div>
                  ))
                ) : (
                  <Empty icon={FileIcon} title="No contingent purchase fees" />
                )}
              </div>
            </div>
          </div>
        )}
        {tab === "investments" && (
          <div className="padded">
            <div className="equal-columns">
              {(["academy", "facilities"] as const).map((kind) => (
                <section key={kind}>
                  <SectionHeading
                    title={
                      kind === "academy"
                        ? "Academy development"
                        : "Training facilities"
                    }
                  />
                  <div className="investment-rating">
                    <strong>{club[kind]}</strong>
                    <span>/99</span>
                    <Meter value={club[kind]} max={99} />
                  </div>
                  <DetailList
                    items={[
                      ["Improvement", "+3 rating"],
                      [
                        "Investment cost",
                        money(
                          Math.round(
                            (1_000_000 + club[kind] * 25_000) *
                              (1 -
                                bootstrap.state.director.skills.finance *
                                  0.035),
                          ),
                        ),
                      ],
                      [
                        "Current level",
                        club[kind] > 80
                          ? "Excellent"
                          : club[kind] > 60
                            ? "Good"
                            : "Developing",
                      ],
                    ]}
                  />
                  <div className="section-space">
                    <Button
                      icon={TrendingUp}
                      variant="secondary"
                      disabled={club[kind] >= 99}
                      onClick={() =>
                        confirm(
                          "Approve this investment?",
                          "The cost will be deducted from the club balance and transfer allocation.",
                          () => {
                            void act({ type: "investment", kind });
                          },
                        )
                      }
                    >
                      Approve investment
                    </Button>
                  </div>
                </section>
              ))}
            </div>
          </div>
        )}
      </Panel>
      {budgetOpen && (
        <BudgetSheet wages={data.wages} close={() => setBudgetOpen(false)} />
      )}
    </div>
  );
}

const FileIcon = CircleDollarSign;

export function Board() {
  const { bootstrap, act } = useGame();
  const { data } = useResource<Dashboard>("dashboard");
  if (!bootstrap) return <Loading />;
  const club = bootstrap.club;
  const position =
    (data?.table.findIndex((entry) => entry.club_id === club.id) ?? -1) + 1;
  const choices = [
    {
      id: "youth",
      title: "Present a youth pathway",
      detail:
        "Commit to more academy minutes. The board will review progress in five weeks.",
      icon: GraduationCap,
    },
    {
      id: "back-manager",
      title: "Back the manager",
      detail:
        "Build trust with the coaching team. You share responsibility for the results.",
      icon: Handshake,
    },
    {
      id: "budget",
      title: "Request transfer funds",
      detail:
        "Greater investment brings a stronger mandate and higher expectations.",
      icon: Wallet,
    },
    {
      id: "recovery",
      title: "Submit a recovery plan",
      detail:
        "Ask for time and commit to reducing the current sporting crisis.",
      icon: Target,
    },
  ];
  return (
    <div className="page">
      <PageHeading
        eyebrow="ACCOUNTABILITY & AMBITION"
        title="The boardroom"
        subtitle={`${club.name} / ${JSON.parse(club.data).boardPersonality ?? "Pragmatic"} ownership`}
      >
        <Badge tone={club.board_confidence < 40 ? "red" : "green"}>
          {club.board_confidence < 40 ? "Under pressure" : "Board backing"}
        </Badge>
      </PageHeading>
      <div className="stat-strip">
        <Stat
          label="Board confidence"
          value={`${Math.round(club.board_confidence)}%`}
          icon={Landmark}
          detail={<Meter value={club.board_confidence} />}
        />
        <Stat
          label="Board pressure"
          value={Math.round(club.board_pressure)}
          icon={Activity}
          detail="Scrutiny / 100"
        />
        <Stat
          label="Crisis meter"
          value={Math.round(club.crisis)}
          icon={ShieldCheck}
          detail={
            club.crisis < 30
              ? "Stable footing"
              : club.crisis < 60
                ? "Concerns emerging"
                : "Recovery required"
          }
        />
        <Stat
          label="Hype meter"
          value={Math.round(club.hype)}
          icon={TrendingUp}
          detail="Momentum of expectation"
        />
      </div>
      <div className="two-column">
        <Panel>
          <SectionHeading
            title="Your mandate"
            subtitle="A long-term sporting project with near-term expectations"
          />
          <div className="padded">
            <div className="mandate-club">
              <Crest name={club.name} color={club.color} size={52} />
              <div>
                <strong>{club.name}</strong>
                <small>{club.philosophy}</small>
              </div>
            </div>
            <DetailList
              items={[
                ["League objective", `Top ${club.expectations}`],
                [
                  "Current position",
                  data?.table[0]?.played
                    ? `${position} of ${data.table.length}`
                    : "Pre-season",
                ],
                ["Manager", club.manager],
                ["Manager trust", `${Math.round(club.manager_trust)}%`],
                ["Club culture", club.culture],
                ["Academy rating", club.academy],
                [
                  "Wage sustainability",
                  data
                    ? data.squad.wages <= club.wage_budget
                      ? "Within budget"
                      : "Over budget"
                    : "-",
                ],
                [
                  "Financial health",
                  club.balance >= 0 ? "Positive cash balance" : "Cash deficit",
                ],
              ]}
            />
          </div>
        </Panel>
        <Panel>
          <SectionHeading title="Your standing" />
          <div className="padded">
            <DetailList
              items={[
                ["Director", bootstrap.state.director.name],
                ["Background", bootstrap.state.director.background],
                [
                  "Reputation",
                  `${Math.round(bootstrap.state.director.reputation)}/100`,
                ],
                ["Career experience", bootstrap.state.director.experience],
                ["Skill points", bootstrap.state.director.skillPoints],
                [
                  "Club relationship",
                  club.board_confidence >= 65
                    ? "Trusted"
                    : club.board_confidence >= 40
                      ? "Professional"
                      : "Strained",
                ],
              ]}
            />
            <div className="section-space">
              <Meter value={bootstrap.state.director.reputation} />
            </div>
          </div>
        </Panel>
      </div>
      <div className="unframed-heading">
        <h2>Set the direction</h2>
      </div>
      <div className="action-card-grid">
        {choices.map((choice) => (
          <article className="action-card" key={choice.id}>
            <choice.icon size={21} strokeWidth={1.6} />
            <strong>{choice.title}</strong>
            <small>{choice.detail}</small>
            <Button
              variant="secondary"
              icon={MessageSquare}
              onClick={() => void act({ type: "board", approach: choice.id })}
            >
              Meet the board
            </Button>
          </article>
        ))}
      </div>
      <AffiliatesPanel />
      <EventsPanel />
    </div>
  );
}

export function Inbox() {
  const { act, navigate, openMatch, openLeague, setPlayer } = useGame();
  const [category, setCategory] = useState("");
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("all");
  const [priority, setPriority] = useState("all");
  const [competition, setCompetition] = useState("");
  const [archive, setArchive] = useState(false);
  const [pagination, setPagination] = useState({ key: "", page: 1 });
  const deferred = useDeferredValue(search);
  const filterKey = JSON.stringify([
    category,
    deferred,
    status,
    priority,
    competition,
    archive,
  ]);
  const page = pagination.key === filterKey ? pagination.page : 1;
  const params = new URLSearchParams({
    q: deferred,
    category,
    status,
    priority,
    archive: archive ? "1" : "0",
    page: String(page),
    limit: "100",
  });
  if (competition) params.set("league", competition);
  const { data: favorites } = useResource<CompetitionFavorite[]>(
    "competitions/favorites",
  );
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const { data, error } = useResource<NewsItem[]>(`news?${params}`, {
    keepPreviousData: true,
  });
  if (error) return <ErrorState message={error} />;
  if (!data) return <Loading />;
  const selected = data.find((item) => item.id === selectedId) ?? data[0];
  function openAction(item: NewsItem) {
    const details = JSON.parse(item.data);
    if (details.competitionId) openLeague(details.competitionId);
    else if (details.fixtureId) openMatch(details.fixtureId);
    else if (details.playerId) setPlayer(details.playerId);
    else navigate((item.action ?? "office") as Page);
  }
  return (
    <div className="page">
      <PageHeading
        eyebrow="YOUR CORRESPONDENCE"
        title="Inbox"
        subtitle={`${data.filter((item) => !item.read).length} unread updates / The people, decisions and stories around your club`}
      >
        <Button
          icon={CheckCheck}
          variant="secondary"
          onClick={() => void act({ type: "read-news" })}
        >
          Mark all read
        </Button>
      </PageHeading>
      <Panel>
        <div className="organized-filters" aria-label="Inbox filters">
          <div className="search-field">
            <Search size={16} />
            <input
              aria-label="Search inbox"
              placeholder="Search correspondence..."
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />
          </div>
          <fieldset className="filter-group">
            <legend>Topic</legend>
            <select
              aria-label="Inbox category"
              value={category}
              onChange={(event) => setCategory(event.target.value)}
            >
              <option value="">All correspondence</option>
              {[
                "Board",
                "Scouting",
                "Transfers",
                "Loans",
                "Academy",
                "Squad",
                "Match",
                "Staff",
                "Medical",
                "Finance",
                "Media",
                "Fans",
                "World",
                "Club",
                "Competitions",
                "Director",
                "Events",
              ].map((value) => (
                <option key={value}>{value}</option>
              ))}
            </select>
            <select
              aria-label="Inbox competition"
              value={competition}
              onChange={(event) => setCompetition(event.target.value)}
            >
              <option value="">All competitions</option>
              {favorites?.map((favorite) => (
                <option key={favorite.leagueId} value={favorite.leagueId}>
                  {favorite.name}
                </option>
              ))}
            </select>
          </fieldset>
          <fieldset className="filter-group">
            <legend>Status and priority</legend>
            <select
              aria-label="Inbox read status"
              value={status}
              onChange={(event) => setStatus(event.target.value)}
            >
              <option value="all">Read and unread</option>
              <option value="unread">Unread only</option>
              <option value="read">Read only</option>
            </select>
            <select
              aria-label="Inbox priority"
              value={priority}
              onChange={(event) => setPriority(event.target.value)}
            >
              <option value="all">All priorities</option>
              <option value="important">Important and warnings</option>
            </select>
          </fieldset>
          <fieldset className="filter-group">
            <legend>View</legend>
            <label className="filter-check">
              <input
                type="checkbox"
                checked={archive}
                onChange={(event) => setArchive(event.target.checked)}
              />
              Include muted archive
            </label>
            <IconButton
              icon={RotateCcw}
              label="Reset inbox filters"
              onClick={() => {
                setSearch("");
                setCategory("");
                setStatus("all");
                setPriority("all");
                setCompetition("");
                setArchive(false);
              }}
            />
          </fieldset>
        </div>
        {data.length ? (
          <div className="inbox-layout">
            <div className="inbox-list">
              {data.map((item) => (
                <button
                  className={item.id === selected?.id ? "active" : ""}
                  key={item.id}
                  onClick={() => {
                    setSelectedId(item.id);
                    if (!item.read)
                      void act({ type: "read-news", id: item.id });
                  }}
                >
                  <span className="news-meta">
                    <span>
                      {item.category}
                      {!item.read && <span className="unread-dot" />}
                    </span>
                    <time>{dateLabel(item.date).replace(/ \d{4}$/, "")}</time>
                  </span>
                  <strong>{item.title}</strong>
                  <p>{item.body}</p>
                </button>
              ))}
            </div>
            {selected && (
              <article className="inbox-message">
                <Badge tone={selected.severity}>{selected.category}</Badge>
                <p className="message-date">{dateLabel(selected.date)}</p>
                <h2>{selected.title}</h2>
                <p>{selected.body}</p>
                {selected.action && (
                  <Button
                    icon={ArrowUpRight}
                    variant="secondary"
                    onClick={() => openAction(selected)}
                  >
                    Open{" "}
                    {selected.action === "office"
                      ? "club overview"
                      : selected.action}
                  </Button>
                )}
              </article>
            )}
          </div>
        ) : (
          <Empty
            icon={InboxIcon}
            title="Nothing in this folder"
            detail="New correspondence arrives as your career unfolds."
          />
        )}
        <div className="pagination">
          <span>Page {page}</span>
          <div className="inline-controls">
            <IconButton
              icon={ChevronLeft}
              label="Previous inbox page"
              disabled={page === 1}
              onClick={() => setPagination({ key: filterKey, page: page - 1 })}
            />
            <IconButton
              icon={ChevronRight}
              label="Next inbox page"
              disabled={data.length < 100}
              onClick={() => setPagination({ key: filterKey, page: page + 1 })}
            />
          </div>
        </div>
      </Panel>
    </div>
  );
}

function MediaArticle({
  story,
  journalists,
  onJournalist,
}: {
  story: MediaStory;
  journalists: Journalist[];
  onJournalist: (id: string) => void;
}) {
  const { openMatch } = useGame();
  const { money } = useCurrency();
  const report = story.report;
  const journalist = journalists.find(
    (entry) => entry.id === report?.journalistId,
  );
  return (
    <article className="media-article" aria-label={story.title}>
      <header className="media-byline">
        <div className="media-author">
          <span className="director-avatar" aria-hidden="true">
            {journalist
              ? journalist.name
                  .split(" ")
                  .map((part) => part[0])
                  .slice(0, 2)
                  .join("")
              : "ND"}
          </span>
          <div>
            {journalist ? (
              <button
                className="profile-link"
                onClick={() => onJournalist(journalist.id)}
              >
                {journalist.name}
              </button>
            ) : (
              <strong>Club news desk</strong>
            )}
            <small>
              {journalist?.outlet ?? story.category}
              {report && ` / ${label(report.topic)}`}
            </small>
          </div>
        </div>
        <div>
          <Badge
            tone={
              report?.status === "Confirmed"
                ? "green"
                : report?.status === "Reported"
                  ? "amber"
                  : "blue"
            }
          >
            {report?.status ?? "Archive"}
          </Badge>
          <time dateTime={story.date}>{dateLabel(story.date)}</time>
        </div>
      </header>
      <h2>{story.title}</h2>
      <p>{story.body}</p>
      {report && (
        <>
          <div className="media-story-subjects">
            {report.playerId && (
              <PlayerLink
                id={report.playerId}
                name={report.playerName ?? "Player"}
              />
            )}
            {story.clubs.map((club) => (
              <ClubLink key={club.id} id={club.id} name={club.name} />
            ))}
            {report.fee !== undefined && <span>Fee {money(report.fee)}</span>}
            {report.fixtureId && (
              <Button
                variant="ghost"
                icon={ArrowUpRight}
                onClick={() => openMatch(report.fixtureId!, report.playerId)}
              >
                Match report
              </Button>
            )}
          </div>
          {report.paragraphs.length > 1 && (
            <details className="media-analysis">
              <summary>Read analysis</summary>
              {report.paragraphs.slice(1).map((paragraph, index) => (
                <p key={index}>{paragraph}</p>
              ))}
            </details>
          )}
          <details className="media-discussion">
            <summary>
              <MessageCircle size={16} />
              Discussion <span>{report.comments.length}</span>
            </summary>
            <div className="media-comments">
              {report.comments.map((comment) => (
                <article className="media-comment" key={comment.id}>
                  <header>
                    <strong>{comment.author}</strong>
                    <Badge
                      tone={
                        comment.sentiment === "positive"
                          ? "green"
                          : comment.sentiment === "critical"
                            ? "amber"
                            : "neutral"
                      }
                    >
                      {comment.role}
                    </Badge>
                  </header>
                  <small>{comment.handle}</small>
                  <p>{comment.text}</p>
                  <span className="comment-likes">
                    <Heart size={13} />
                    {compactNumber(comment.likes)}
                  </span>
                </article>
              ))}
            </div>
          </details>
        </>
      )}
    </article>
  );
}

export function Media() {
  const { bootstrap, act } = useGame();
  const [tab, setTab] = useState("headlines");
  const [scope, setScope] = useState("club");
  const [topic, setTopic] = useState("");
  const [source, setSource] = useState("");
  const [search, setSearch] = useState("");
  const [selectedJournalist, setSelectedJournalist] = useState<string | null>(
    null,
  );
  const [pagination, setPagination] = useState({ key: "", page: 1 });
  const deferred = useDeferredValue(search);
  const filterKey = JSON.stringify([scope, topic, source, deferred]);
  const page = pagination.key === filterKey ? pagination.page : 1;
  const params = new URLSearchParams({
    scope,
    page: String(page),
    q: deferred,
  });
  if (topic) params.set("topic", topic);
  if (source) params.set("journalist", source);
  const { data, loading, error } = useResource<MediaData>(`media?${params}`, {
    keepPreviousData: true,
  });
  if (error) return <ErrorState message={error} />;
  if (!bootstrap || !data) return <Loading />;
  const club = bootstrap.club;
  const details = JSON.parse(club.data);
  const journalist = data.journalists.find(
    (entry) => entry.id === selectedJournalist,
  );
  const interviewer = data.journalists.find(
    (entry) => entry.id === data.pressQuestion.journalistId,
  )!;
  const comments = data.stories.flatMap((story) =>
    (story.report?.comments ?? []).map((comment) => ({ ...comment, story })),
  );
  function readCoverage(id: string) {
    setSource(id);
    setScope("all");
    setTopic("");
    setSearch("");
    setTab("headlines");
    setSelectedJournalist(null);
  }
  const mood =
    club.fan_mood > 75
      ? "Optimistic"
      : club.fan_mood > 50
        ? "Hopeful"
        : club.fan_mood > 30
          ? "Restless"
          : "Angry";
  const approaches = [
    {
      id: "measured",
      title: "Trust the process",
      quote:
        "Our decisions are guided by a clear plan. We will judge progress over time.",
      icon: Target,
    },
    {
      id: "ambitious",
      title: "Set a higher standard",
      quote:
        "This club should aim higher. We intend to compete at the next level.",
      icon: Flag,
    },
    {
      id: "protect",
      title: "Protect your people",
      quote:
        "The players and staff have our full support. Responsibility starts with me.",
      icon: ShieldCheck,
    },
    {
      id: "challenge",
      title: "Demand a response",
      quote:
        "We expect more. Everyone at this club must be accountable for improvement.",
      icon: Megaphone,
    },
  ];
  return (
    <div className="page">
      <PageHeading
        eyebrow="THE CONVERSATION AROUND YOUR CLUB"
        title="Media & supporters"
        subtitle={`${club.name} / Public sentiment`}
      />
      <div className="stat-strip">
        <Stat
          label="Fan mood"
          value={`${Math.round(club.fan_mood)}%`}
          icon={Heart}
          detail={mood}
        />
        <Stat
          label="Fan loyalty"
          value={Math.round(club.fan_loyalty)}
          icon={Users}
          detail="Long-term bond / 100"
        />
        <Stat
          label="Fan patience"
          value={Math.round(club.fan_patience)}
          icon={Activity}
          detail="Tolerance for setbacks"
        />
        <Stat
          label="Organised supporter intensity"
          value={details.ultras ?? 50}
          icon={Megaphone}
          detail={
            club.crisis > 70 ? "Protest risk elevated" : "No organised protest"
          }
        />
      </div>
      <Panel>
        <Tabs
          items={[
            { id: "headlines", label: "News feed" },
            {
              id: "journalists",
              label: "Journalists",
              count: data.journalists.length,
            },
            { id: "supporters", label: "Supporter feed" },
            { id: "press", label: "Press room" },
          ]}
          value={tab}
          onChange={setTab}
        />
        {tab === "press" && (
          <div className="padded">
            <div className="press-question">
              <Mic size={21} />
              <div>
                <Badge tone="blue">PRESS CONFERENCE</Badge>
                <h3>{data.pressQuestion.text}</h3>
                <p>
                  <button
                    className="profile-link"
                    onClick={() => setSelectedJournalist(interviewer.id)}
                  >
                    {interviewer.name}
                  </button>{" "}
                  / {interviewer.outlet} / {dateLabel(bootstrap.state.date)}
                </p>
              </div>
            </div>
            <div className="press-choices">
              {approaches.map((approach) => (
                <button
                  key={approach.id}
                  onClick={() =>
                    void act({ type: "media", approach: approach.id }).then(
                      (result) => {
                        if (result) {
                          setScope("club");
                          setTopic("");
                          setSource("");
                          setSearch("");
                          setTab("headlines");
                        }
                      },
                    )
                  }
                >
                  <approach.icon size={19} />
                  <span>
                    <strong>{approach.title}</strong>
                    <small>"{approach.quote}"</small>
                  </span>
                  <ArrowUpRight size={16} />
                </button>
              ))}
            </div>
          </div>
        )}
        {(tab === "headlines" || tab === "supporters") && (
          <>
            <div className="filter-bar media-filters">
              <div className="search-field">
                <Search size={16} />
                <input
                  aria-label="Search media stories"
                  placeholder="Player, signing or headline..."
                  maxLength={100}
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                />
              </div>
              <select
                aria-label="Media scope"
                value={scope}
                onChange={(event) => setScope(event.target.value)}
              >
                <option value="club">Your club</option>
                <option value="world">World football</option>
                <option value="all">All coverage</option>
              </select>
              <select
                aria-label="Media topic"
                value={topic}
                onChange={(event) => setTopic(event.target.value)}
              >
                <option value="">All topics</option>
                <option value="transfer">Transfers</option>
                <option value="player">Players</option>
                <option value="match">Matches</option>
                <option value="press">Press conferences</option>
                <option value="club">Club affairs</option>
              </select>
              <select
                aria-label="Media journalist"
                value={source}
                onChange={(event) => setSource(event.target.value)}
              >
                <option value="">All journalists</option>
                {data.journalists.map((entry) => (
                  <option key={entry.id} value={entry.id}>
                    {entry.name}
                  </option>
                ))}
              </select>
            </div>
            {tab === "headlines" ? (
              data.stories.length ? (
                <div className="media-feed">
                  {data.stories.map((story) => (
                    <MediaArticle
                      story={story}
                      journalists={data.journalists}
                      key={story.id}
                      onJournalist={setSelectedJournalist}
                    />
                  ))}
                </div>
              ) : (
                <Empty
                  icon={Newspaper}
                  title="No stories match these filters"
                />
              )
            ) : comments.length ? (
              <div className="supporter-discussions">
                {comments.map((comment) => (
                  <article className="media-comment" key={comment.id}>
                    <header>
                      <strong>{comment.author}</strong>
                      <Badge>{comment.role}</Badge>
                      <time>{dateLabel(comment.story.date)}</time>
                    </header>
                    <small>{comment.handle}</small>
                    <p>{comment.text}</p>
                    <div className="social-post-footer">
                      <span>
                        <Heart size={13} />
                        {compactNumber(comment.likes)}
                      </span>
                      {comment.story.report?.playerId && (
                        <PlayerLink
                          id={comment.story.report.playerId}
                          name={comment.story.report.playerName ?? "Player"}
                        />
                      )}
                    </div>
                    <small className="discussion-story">
                      On: {comment.story.title}
                    </small>
                  </article>
                ))}
              </div>
            ) : (
              <Empty
                icon={MessageCircle}
                title="No discussions in this selection"
              />
            )}
            <div className="pagination">
              <span>{compactNumber(data.total)} stories</span>
              <span>
                <IconButton
                  icon={ChevronLeft}
                  label="Previous media page"
                  disabled={loading || data.page <= 1}
                  onClick={() =>
                    setPagination({ key: filterKey, page: data.page - 1 })
                  }
                />
                {data.page} / {data.pages}
                <IconButton
                  icon={ChevronRight}
                  label="Next media page"
                  disabled={loading || data.page >= data.pages}
                  onClick={() =>
                    setPagination({ key: filterKey, page: data.page + 1 })
                  }
                />
              </span>
            </div>
          </>
        )}
        {tab === "journalists" && (
          <div className="journalist-directory">
            {data.journalists.map((entry) => (
              <article className="journalist-profile" key={entry.id}>
                <div className="media-author">
                  <span className="director-avatar" aria-hidden="true">
                    {entry.name
                      .split(" ")
                      .map((part) => part[0])
                      .slice(0, 2)
                      .join("")}
                  </span>
                  <div>
                    <h3>{entry.name}</h3>
                    <small>{entry.handle}</small>
                  </div>
                </div>
                <p>{entry.outlet}</p>
                <Badge tone="blue">{entry.beat}</Badge>
                <DetailList
                  items={[
                    ["Source reliability", `${entry.reliability}/100`],
                    ["Approach", entry.style],
                  ]}
                />
                <p className="dossier-copy">{entry.biography}</p>
                <Button
                  icon={Newspaper}
                  variant="secondary"
                  onClick={() => readCoverage(entry.id)}
                >
                  Read coverage
                </Button>
              </article>
            ))}
          </div>
        )}
      </Panel>
      {journalist && (
        <Modal
          title={journalist.name}
          onClose={() => setSelectedJournalist(null)}
        >
          <div className="sheet-body">
            <Badge tone="blue">Fictional journalist</Badge>
            <p className="sheet-description">{journalist.biography}</p>
            <DetailList
              items={[
                ["Outlet", journalist.outlet],
                ["Beat", journalist.beat],
                ["Source reliability", `${journalist.reliability}/100`],
                ["Style", journalist.style],
              ]}
            />
          </div>
          <footer className="sheet-footer">
            <Button
              variant="secondary"
              onClick={() => setSelectedJournalist(null)}
            >
              Close
            </Button>
            <Button
              icon={Newspaper}
              onClick={() => readCoverage(journalist.id)}
            >
              Read coverage
            </Button>
          </footer>
        </Modal>
      )}
    </div>
  );
}
