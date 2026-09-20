import { useDeferredValue, useState } from "react";
import {
  ArrowLeftRight,
  ArrowUpRight,
  Globe2,
  Handshake,
  Network,
  Plus,
  RotateCcw,
  Search,
  ShieldCheck,
  TrendingUp,
} from "lucide-react";
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { useGame, useResource } from "../game-context.tsx";
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
  PlayerTable,
  SectionHeading,
  Stat,
  Tabs,
  TextLink,
} from "../ui.tsx";
import {
  dateLabel,
  label,
  LOAN_TYPES,
  money,
  PARTNERSHIP_TYPES,
} from "../../shared/rules.ts";
import type { LoanDesk } from "../../shared/api.ts";
import type { Club, Loan, LoanTerms, Player } from "../../shared/types.ts";

function ClubChooser({
  onChoose,
  selected,
}: {
  onChoose: (club: Club) => void;
  selected: Club | null;
}) {
  const { bootstrap } = useGame();
  const [search, setSearch] = useState("");
  const [country, setCountry] = useState("");
  const deferred = useDeferredValue(search);
  const { data } = useResource<Club[]>(
    `clubs?q=${encodeURIComponent(deferred)}${country ? `&country=${country}` : ""}&limit=30`,
  );
  return (
    <div>
      <div className="club-chooser-controls">
        <div className="search-field">
          <Search size={16} />
          <input
            aria-label="Search destination clubs"
            placeholder="Search clubs..."
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
        </div>
        <select
          aria-label="Club country"
          value={country}
          onChange={(event) => setCountry(event.target.value)}
        >
          <option value="">All countries</option>
          {bootstrap?.countries.map((item) => (
            <option key={item.id} value={item.id}>
              {item.name}
            </option>
          ))}
        </select>
      </div>
      <div className="club-chooser-list">
        {data
          ?.filter((club) => club.id !== bootstrap?.club.id)
          .map((club) => (
            <button
              key={club.id}
              className={selected?.id === club.id ? "selected" : ""}
              onClick={() => onChoose(club)}
            >
              <Crest name={club.name} color={club.color} size={27} />
              <span>
                <strong>{club.name}</strong>
                <small>
                  {club.country_name} / {club.tactical_style}
                </small>
              </span>
              <Badge tone={selected?.id === club.id ? "green" : "neutral"}>
                {Math.round(club.reputation)}
              </Badge>
            </button>
          ))}
      </div>
    </div>
  );
}

export function ClubNetworkSheet({
  player,
  close,
}: {
  player?: Player;
  close: () => void;
}) {
  const { act, navigate } = useGame();
  const [club, setClub] = useState<Club | null>(null);
  const [type, setType] = useState(
    player ? "Development loan" : "Development club",
  );
  const [pending, setPending] = useState(false);
  async function submit() {
    if (!club) return;
    setPending(true);
    const result = player
      ? await act({
          type: "enquiry",
          playerId: player.id,
          dealType: type,
          destinationId: club.id,
        })
      : await act({
          type: "partnership",
          clubId: club.id,
          partnershipType: type,
        });
    setPending(false);
    if (result) {
      close();
      if (player) navigate("transfers");
    }
  }
  return (
    <Modal
      title={
        player ? `Find a loan for ${player.name}` : "Build a club partnership"
      }
      onClose={close}
    >
      <div className="sheet-body">
        <div className="form-section">
          <Field label={player ? "Loan type" : "Partnership type"}>
            <select
              value={type}
              onChange={(event) => setType(event.target.value)}
            >
              {(player ? LOAN_TYPES : PARTNERSHIP_TYPES).map((value) => (
                <option key={value}>{value}</option>
              ))}
            </select>
          </Field>
        </div>
        <ClubChooser selected={club} onChoose={setClub} />
        {club && (
          <div className="section-space">
            <DetailList
              items={[
                ["Receiving club", club.name],
                ["Academy", `${club.academy}/100`],
                ["Facilities", `${club.facilities}/100`],
                ["Manager trust", `${Math.round(club.manager_trust)}/100`],
                ["Formation", club.formation],
                ["Philosophy", club.philosophy],
                ...(!player
                  ? [
                      [
                        "Annual partnership fee",
                        money(100_000 + Math.round(club.reputation ** 2 * 60)),
                      ] as [string, string],
                    ]
                  : []),
              ]}
            />
          </div>
        )}
      </div>
      <footer className="sheet-footer">
        <Button variant="secondary" onClick={close}>
          Cancel
        </Button>
        <Button
          icon={player ? ArrowLeftRight : Handshake}
          onClick={() => void submit()}
          disabled={!club || pending}
        >
          {player ? "Send loan enquiry" : "Agree partnership"}
        </Button>
      </footer>
    </Modal>
  );
}

function LoanReport({ loan, close }: { loan: Loan; close: () => void }) {
  const { bootstrap, act, confirm, setPlayer } = useGame();
  const terms = JSON.parse(loan.terms) as LoanTerms;
  const details = JSON.parse(loan.data) as {
    factors: Record<string, number>;
    history: {
      date: string;
      score: number;
      minutes: number;
      pressure: number;
    }[];
    weeks: number;
    failures: number;
  };
  const parent = loan.parent_id === bootstrap?.club.id;
  function recall(injury = false) {
    confirm(
      "Recall this player?",
      injury
        ? "The injury recall will return the player for rehabilitation."
        : "The loan will end immediately. The receiving club relationship may suffer.",
      () => {
        void act({ type: "loan-recall", id: loan.id, injury }).then(
          (result) => {
            if (result) close();
          },
        );
      },
    );
  }
  return (
    <Modal title={`${loan.player_name} / Loan review`} onClose={close} wide>
      <div className="sheet-body">
        <div className="loan-report-heading">
          <div>
            <Badge
              tone={
                loan.score >= 70 ? "green" : loan.score >= 40 ? "amber" : "red"
              }
            >
              {loan.status === "active" ? "Active loan" : label(loan.status)}
            </Badge>
            <h3>{loan.destination_name}</h3>
            <p>
              {loan.type} / {dateLabel(loan.start_date)} to{" "}
              {dateLabel(loan.end_date)}
            </p>
          </div>
          <div className="loan-score-large">
            <strong>{Math.round(loan.score)}</strong>
            <small>Loan Success Score</small>
          </div>
        </div>
        <div className="profile-columns">
          <div>
            <SectionHeading title="Development & environment" />
            <div className="loan-factors">
              {Object.entries(details.factors).map(([key, value]) => (
                <div className="attribute-row" key={key}>
                  <span className="attribute-label">{label(key)}</span>
                  <Meter value={value} tone={value < 40 ? "red" : "green"} />
                  <strong>{Math.round(value)}</strong>
                </div>
              ))}
            </div>
            {!Object.keys(details.factors).length && (
              <p className="dossier-copy">
                The first weekly review is pending.
              </p>
            )}
            <div className="chart-box">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart
                  data={details.history}
                  margin={{ top: 20, left: -30, right: 10 }}
                >
                  <CartesianGrid
                    stroke="var(--line)"
                    strokeDasharray="3 3"
                    vertical={false}
                  />
                  <XAxis
                    dataKey="date"
                    tickFormatter={(value: string) => value.slice(5)}
                    tick={{ fontSize: 10 }}
                    axisLine={false}
                    tickLine={false}
                  />
                  <YAxis
                    domain={[0, 100]}
                    tick={{ fontSize: 10 }}
                    axisLine={false}
                    tickLine={false}
                  />
                  <Tooltip
                    contentStyle={{
                      background: "var(--surface)",
                      border: "1px solid var(--line)",
                      fontSize: 11,
                    }}
                  />
                  <Area
                    dataKey="score"
                    name="Success score"
                    stroke="var(--accent)"
                    fill="var(--accent)"
                    fillOpacity={0.1}
                  />
                  <Area
                    dataKey="pressure"
                    name="Pressure"
                    stroke="var(--amber)"
                    fill="var(--amber)"
                    fillOpacity={0.05}
                  />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </div>
          <div>
            <SectionHeading title="The agreement" />
            <DetailList
              items={[
                ["Playing time", `${terms.playingTime}%`],
                ["Position / role", `${terms.position} / ${terms.role}`],
                ["Development plan", terms.developmentPlan],
                ["Wage split", `${terms.salarySplit}% borrowing club`],
                ["Mandatory minutes", terms.mandatoryMinutes],
                ["Development bonus", money(terms.bonus)],
                ["Tactical-fit requirement", `${terms.tacticalFit}/100`],
                ["Manager-trust requirement", `${terms.managerTrust}/100`],
                ["Club relationship", `${Math.round(loan.relationship)}/100`],
                ["Loan pressure", `${Math.round(loan.pressure)}/100`],
                [
                  "Recall / injury recall",
                  `${terms.recall ? "Yes" : "No"} / ${terms.injuryRecall ? "Yes" : "No"}`,
                ],
                ...(loan.type.includes("option") ||
                loan.type.includes("obligation")
                  ? [
                      ["Purchase fee", money(terms.optionFee)] as [
                        string,
                        string,
                      ],
                    ]
                  : []),
                ...(loan.type.includes("sell-on")
                  ? [["Sell-on clause", `${terms.sellOn}%`] as [string, string]]
                  : []),
              ]}
            />
          </div>
        </div>
      </div>
      <footer className="sheet-footer">
        <div className="footer-left">
          <Button
            variant="secondary"
            icon={ArrowUpRight}
            onClick={() => {
              close();
              setPlayer(loan.player_id);
            }}
          >
            Player dossier
          </Button>
        </div>
        {loan.status === "active" && parent && (
          <>
            <Button
              variant="secondary"
              icon={ShieldCheck}
              disabled={!terms.injuryRecall}
              onClick={() => recall(true)}
            >
              Injury recall
            </Button>
            <Button
              variant="secondary"
              icon={RotateCcw}
              disabled={!terms.recall}
              onClick={() => recall()}
            >
              Recall player
            </Button>
          </>
        )}
        {loan.status === "active" &&
          !parent &&
          loan.type === "Loan with option" && (
            <Button
              icon={Handshake}
              onClick={() =>
                confirm(
                  "Exercise the purchase option?",
                  `${money(terms.optionFee)} will be paid to the parent club. The player will join permanently.`,
                  () => {
                    void act({ type: "loan-option", id: loan.id }).then(
                      (result) => {
                        if (result) close();
                      },
                    );
                  },
                )
              }
            >
              Exercise option
            </Button>
          )}
      </footer>
    </Modal>
  );
}

export default function Loans() {
  const { data, error } = useResource<LoanDesk>("loans");
  const { navigate, bootstrap } = useGame();
  const [tab, setTab] = useState("active");
  const [network, setNetwork] = useState(false);
  const [offer, setOffer] = useState<Player | null>(null);
  const [selected, setSelected] = useState<number | null>(null);
  if (error) return <ErrorState message={error} />;
  if (!data || !bootstrap) return <Loading />;
  const active = data.loans.filter((loan) => loan.status === "active");
  const average = active.length
    ? Math.round(
        active.reduce((sum, loan) => sum + loan.score, 0) / active.length,
      )
    : null;
  const current = data.loans.find((loan) => loan.id === selected);
  return (
    <div className="page">
      <PageHeading
        eyebrow="LOAN MANAGEMENT"
        title="Development, away from home"
        subtitle="The right minutes. The right environment. A clear return."
      >
        <Button icon={Plus} onClick={() => setNetwork(true)}>
          New partnership
        </Button>
      </PageHeading>
      <div className="stat-strip">
        <Stat
          label="Active loans"
          value={active.length}
          icon={ArrowLeftRight}
          detail={`${active.filter((loan) => loan.parent_id === bootstrap.club.id).length} outgoing / ${active.filter((loan) => loan.destination_id === bootstrap.club.id).length} incoming`}
        />
        <Stat
          label="Average success"
          value={average ?? "-"}
          icon={TrendingUp}
          detail={
            average === null
              ? "First loan review pending"
              : "Loan Success Score / 100"
          }
        />
        <Stat
          label="Club partnerships"
          value={data.partnerships.length}
          icon={Network}
          detail="Your development network"
        />
        <Stat
          label="Loans under pressure"
          value={active.filter((loan) => loan.pressure > 60).length}
          icon={ShieldCheck}
          detail="Agreements requiring attention"
        />
      </div>
      <Panel>
        <Tabs
          items={[
            { id: "active", label: "Loan tracker", count: active.length },
            {
              id: "candidates",
              label: "Loan candidates",
              count: data.candidates.length,
            },
            {
              id: "network",
              label: "Club network",
              count: data.partnerships.length,
            },
            { id: "history", label: "History" },
          ]}
          value={tab}
          onChange={setTab}
        />
        {(tab === "active" || tab === "history") &&
          ((tab === "active"
            ? active
            : data.loans.filter((loan) => loan.status !== "active")
          ).length ? (
            <div className="table-scroll">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Player</th>
                    <th>Loan club</th>
                    <th>Agreement</th>
                    <th>LSS</th>
                    <th>Fit</th>
                    <th>Pressure</th>
                    <th>Ends</th>
                    <th>Review</th>
                  </tr>
                </thead>
                <tbody>
                  {(tab === "active"
                    ? active
                    : data.loans.filter((loan) => loan.status !== "active")
                  ).map((loan) => (
                    <tr key={loan.id}>
                      <td>
                        <button
                          className="report-player"
                          onClick={() => setSelected(loan.id)}
                        >
                          <strong>{loan.player_name}</strong>
                          <small>
                            {loan.position} / {loan.age}
                          </small>
                        </button>
                      </td>
                      <td>
                        <span className="table-club">
                          <Crest
                            name={loan.destination_name ?? ""}
                            color={loan.destination_color}
                            size={24}
                          />
                          {loan.destination_name}
                        </span>
                      </td>
                      <td>
                        <Badge>{loan.type}</Badge>
                      </td>
                      <td>
                        <Badge
                          tone={
                            loan.score > 70
                              ? "green"
                              : loan.score < 40
                                ? "red"
                                : "amber"
                          }
                        >
                          {Math.round(loan.score)}
                        </Badge>
                      </td>
                      <td>{Math.round(loan.fit)}%</td>
                      <td>
                        <div className="cell-meter">
                          <Meter
                            value={loan.pressure}
                            tone={loan.pressure > 60 ? "red" : "amber"}
                          />
                          <small>{Math.round(loan.pressure)}</small>
                        </div>
                      </td>
                      <td>{dateLabel(loan.end_date)}</td>
                      <td>
                        <Button
                          variant="secondary"
                          icon={ArrowUpRight}
                          onClick={() => setSelected(loan.id)}
                        >
                          Review
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <Empty
              icon={ArrowLeftRight}
              title={
                tab === "active"
                  ? "A pathway beyond your first team"
                  : "No completed loans yet"
              }
              detail={
                tab === "active"
                  ? "Agree a development loan or bring in a player to strengthen the squad."
                  : "Finished and recalled loans will appear here."
              }
            >
              <Button
                icon={Search}
                variant="secondary"
                onClick={() => setTab("candidates")}
              >
                Review loan candidates
              </Button>
            </Empty>
          ))}
        {tab === "candidates" && (
          <>
            <SectionHeading title="Players with room to grow">
              <TextLink onClick={() => navigate("database")}>
                Find incoming loans
              </TextLink>
            </SectionHeading>
            <PlayerTable players={data.candidates} compact>
              {(player) => (
                <Button
                  variant="secondary"
                  icon={ArrowLeftRight}
                  onClick={() => setOffer(player)}
                >
                  Find a club
                </Button>
              )}
            </PlayerTable>
          </>
        )}
        {tab === "network" &&
          (data.partnerships.length ? (
            <div className="padded">
              <div className="cards-list">
                {data.partnerships.map((partner) => (
                  <article className="entity-card" key={partner.id}>
                    <div className="entity-card-top">
                      <Crest
                        name={partner.name}
                        color={partner.color}
                        size={34}
                      />
                      <Badge tone="green">{partner.type}</Badge>
                    </div>
                    <h3>{partner.name}</h3>
                    <div className="attribute-row">
                      <span className="attribute-label">Relationship</span>
                      <Meter value={partner.strength} />
                      <strong>{Math.round(partner.strength)}</strong>
                    </div>
                    <DetailList
                      items={[
                        ["Reputation", Math.round(partner.reputation)],
                        [
                          "Annual fee",
                          money(JSON.parse(partner.data).annualFee),
                        ],
                        ["Since", dateLabel(JSON.parse(partner.data).since)],
                      ]}
                    />
                  </article>
                ))}
              </div>
            </div>
          ) : (
            <Empty
              icon={Globe2}
              title="Build your development network"
              detail="Feeder, development and adaptation partnerships create better loan opportunities."
            >
              <Button icon={Handshake} onClick={() => setNetwork(true)}>
                Agree a partnership
              </Button>
            </Empty>
          ))}
      </Panel>
      {network && <ClubNetworkSheet close={() => setNetwork(false)} />}
      {offer && (
        <ClubNetworkSheet player={offer} close={() => setOffer(null)} />
      )}
      {current && <LoanReport loan={current} close={() => setSelected(null)} />}
    </div>
  );
}
