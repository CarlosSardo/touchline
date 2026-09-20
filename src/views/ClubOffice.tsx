import { useState } from "react";
import {
  Activity,
  ArrowLeftRight,
  ArrowUpRight,
  CheckCheck,
  CircleDollarSign,
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
import { useGame, useResource, type Page } from "../game-context.tsx";
import {
  Badge,
  Button,
  Crest,
  DetailList,
  Empty,
  ErrorState,
  Field,
  Loading,
  Meter,
  Modal,
  PageHeading,
  Panel,
  SectionHeading,
  Stat,
  Tabs,
} from "../ui.tsx";
import { dateLabel, money } from "../../shared/rules.ts";
import type { Dashboard, FinanceData } from "../../shared/api.ts";
import type { NewsItem } from "../../shared/types.ts";

function BudgetSheet({ close }: { close: () => void }) {
  const { bootstrap, act } = useGame();
  const [amount, setAmount] = useState(1_000_000);
  return (
    <Modal title="Rebalance your budgets" onClose={close}>
      <div className="sheet-body">
        <Field label="Transfer allocation to move into annual wages (GBP)">
          <input
            type="number"
            min="-100000000"
            max={bootstrap?.club.transfer_budget ?? 0}
            step="100000"
            value={amount}
            onChange={(event) => setAmount(Number(event.target.value))}
          />
        </Field>
        <div className="section-space">
          <DetailList
            items={[
              [
                "Revised transfer budget",
                money((bootstrap?.club.transfer_budget ?? 0) - amount),
              ],
              [
                "Revised weekly wage budget",
                money((bootstrap?.club.wage_budget ?? 0) + amount / 52),
              ],
              [
                "Weekly wage change",
                `${amount >= 0 ? "+" : ""}${money(amount / 52)}`,
              ],
            ]}
          />
        </div>
      </div>
      <footer className="sheet-footer">
        <Button variant="secondary" onClick={close}>
          Cancel
        </Button>
        <Button
          icon={ArrowLeftRight}
          onClick={() =>
            void act({ type: "budget", amount }).then((result) => {
              if (result) close();
            })
          }
        >
          Confirm allocation
        </Button>
      </footer>
    </Modal>
  );
}

export function Finances() {
  const { bootstrap, act, confirm } = useGame();
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
        subtitle={`${club.name} / All amounts in GBP`}
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
          label="Squad asset value"
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
            { id: "ffp", label: "Financial regulations" },
            { id: "investments", label: "Infrastructure" },
          ]}
          value={tab}
          onChange={setTab}
        />
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
                        {money(entry.amount, true)}
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
                        : club.ffp > 100_000_000
                          ? "Registration embargo"
                          : club.ffp > 60_000_000
                            ? "Under review"
                            : "Within monitoring limits"}
                    </h3>
                    <p>Financial sustainability / In-game rules</p>
                  </div>
                </div>
                <DetailList
                  items={[
                    ["Current deficit", money(club.ffp)],
                    ["Monitoring threshold", money(60_000_000)],
                    ["Registration embargo threshold", money(100_000_000)],
                    [
                      "Enforcement",
                      bootstrap.settings.ffp ? "Enabled" : "Disabled",
                    ],
                    ["Amortization", money(data.amortization)],
                  ]}
                />
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
      {budgetOpen && <BudgetSheet close={() => setBudgetOpen(false)} />}
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
    </div>
  );
}

export function Inbox() {
  const { act, navigate, openMatch, setPlayer } = useGame();
  const [category, setCategory] = useState("");
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const { data, error } = useResource<NewsItem[]>(
    `news${category ? `?category=${encodeURIComponent(category)}` : ""}`,
  );
  if (error) return <ErrorState message={error} />;
  if (!data) return <Loading />;
  const selected = data.find((item) => item.id === selectedId) ?? data[0];
  function openAction(item: NewsItem) {
    const details = JSON.parse(item.data);
    if (details.fixtureId) openMatch(details.fixtureId);
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
        <div className="filter-bar">
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
            ].map((value) => (
              <option key={value}>{value}</option>
            ))}
          </select>
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
      </Panel>
    </div>
  );
}

export function Media() {
  const { bootstrap, act } = useGame();
  const { data } = useResource<NewsItem[]>("news");
  const [tab, setTab] = useState("press");
  if (!bootstrap || !data) return <Loading />;
  const club = bootstrap.club;
  const details = JSON.parse(club.data);
  const stories = data
    .filter((item) =>
      ["Media", "Fans", "World", "Transfers"].includes(item.category),
    )
    .slice(0, 12);
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
            { id: "press", label: "Press room" },
            { id: "headlines", label: "Headlines & narratives" },
            { id: "supporters", label: "Supporter feed" },
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
                <h3>
                  {club.crisis > 50
                    ? "Is the sporting project still on track?"
                    : club.hype > 50
                      ? "How far can this team go?"
                      : "What should supporters expect from your project?"}
                </h3>
                <p>The Touchline / {dateLabel(bootstrap.state.date)}</p>
              </div>
            </div>
            <div className="press-choices">
              {approaches.map((approach) => (
                <button
                  key={approach.id}
                  onClick={() =>
                    void act({ type: "media", approach: approach.id })
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
        {tab === "headlines" &&
          (stories.length ? (
            stories.map((story) => (
              <article key={story.id} className="headline-item">
                <div>
                  <Badge tone={story.severity}>{story.category}</Badge>
                  <time>{dateLabel(story.date)}</time>
                </div>
                <h3>{story.title}</h3>
                <p>{story.body}</p>
                {JSON.parse(story.data).bias !== undefined && (
                  <small className="muted">
                    Outlet bias:{" "}
                    {JSON.parse(story.data).bias > 10
                      ? "Supportive"
                      : JSON.parse(story.data).bias < -10
                        ? "Critical"
                        : "Balanced"}
                  </small>
                )}
              </article>
            ))
          ) : (
            <Empty
              icon={Newspaper}
              title="A quiet news cycle"
              detail="The first decisions of your tenure will shape the headlines."
            />
          ))}
        {tab === "supporters" && (
          <div className="padded">
            <div className="social-grid">
              {[
                {
                  name: `${club.city} Stand`,
                  handle: "@thelocalstand",
                  text:
                    club.fan_mood > 65
                      ? `A new chapter for ${club.name}. Give the project time, but let's see a clear plan. The academy has to be part of it.`
                      : `We need answers. ${club.name} belongs to its supporters. The board cannot keep asking for patience without progress.`,
                  likes: Math.round(club.fan_loyalty * 13),
                  comments: Math.round(club.crisis + 21),
                },
                {
                  name: "The Academy Watch",
                  handle: "@nextgeneration",
                  text: `Academy rating: ${club.academy}. ${club.academy > 75 ? "There is genuine talent coming through. First-team minutes are the next step." : "The academy needs investment and a clearer route to senior football."}`,
                  likes: Math.round(club.academy * 7),
                  comments: 12 + Math.floor(club.academy / 3),
                },
                {
                  name: "Supporters Collective",
                  handle: "@clubcollective",
                  text:
                    club.crisis > 70
                      ? `The collective is discussing a protest. We expect a meeting with the board and a credible recovery plan.`
                      : `The priority is a sustainable club. Invest wisely, keep the dressing room together, and respect the badge.`,
                  likes: Math.round(club.fan_patience * 9),
                  comments: Math.round(club.board_pressure / 2),
                },
                {
                  name: "Matchday Voice",
                  handle: "@matchdayvoice",
                  text:
                    club.momentum > 10
                      ? `The momentum is real. Expectations are rising, and this team has earned that belief. Keep going.`
                      : club.momentum < -10
                        ? `Another difficult week. The next result matters, but so does how the club responds off the pitch.`
                        : `Looking ahead to the next fixture. ${club.manager} has the team; the director has the bigger picture.`,
                  likes: Math.round(club.fan_mood * 6),
                  comments: Math.round(20 + Math.abs(club.momentum)),
                },
              ].map((post, index) => (
                <article className="social-post" key={post.handle}>
                  <div className="social-post-head">
                    <span
                      className="director-avatar"
                      style={{
                        background:
                          index % 2
                            ? "color-mix(in srgb,var(--blue) 10%,var(--surface))"
                            : "var(--accent-soft)",
                      }}
                    >
                      {post.name
                        .split(" ")
                        .map((word) => word[0])
                        .slice(0, 2)
                        .join("")}
                    </span>
                    <span>
                      <strong>{post.name}</strong>
                      <small>{post.handle}</small>
                    </span>
                  </div>
                  <p>{post.text}</p>
                  <div className="social-post-footer">
                    <span>
                      <Heart size={13} />
                      {post.likes.toLocaleString()}
                    </span>
                    <span>
                      <MessageCircle size={13} />
                      {post.comments}
                    </span>
                    <span>
                      {club.hype > 50 ? "#BelieveInTheProject" : "#BackTheClub"}
                    </span>
                  </div>
                </article>
              ))}
            </div>
          </div>
        )}
      </Panel>
    </div>
  );
}
