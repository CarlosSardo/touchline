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
import { useCurrency, useGame, useResource } from "../game-context.tsx";
import {
  Badge,
  Button,
  ClubLink,
  PlayerLink,
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
  SortHeader,
  Stat,
  Tabs,
  TextLink,
} from "../ui.tsx";
import {
  dateLabel,
  label,
  PARTNERSHIP_TYPES,
  AFFILIATION_BENEFITS,
} from "../../shared/rules.ts";
import { AffiliateInterest } from "./ClubSupport.tsx";
import { IncomingOffers, NegotiationSheet } from "./Transfers.tsx";
import type { LoanDesk } from "../../shared/api.ts";
import type { Club, Loan, LoanTerms, Negotiation, NegotiationData, OfferReason } from "../../shared/types.ts";
import { dateValue, type SortColumn } from "../sort.ts";
import { useSortableRows } from "../useSortableRows.ts";

const LOAN_COLUMNS: SortColumn<
  Loan,
  "player" | "club" | "type" | "score" | "fit" | "pressure" | "ends"
>[] = [
  { key: "player", value: (loan) => loan.player_name, defaultDirection: "asc" },
  { key: "club", value: (loan) => loan.destination_name, defaultDirection: "asc" },
  { key: "type", value: (loan) => loan.type, defaultDirection: "asc" },
  { key: "score", value: (loan) => loan.score, defaultDirection: "desc" },
  { key: "fit", value: (loan) => loan.fit, defaultDirection: "desc" },
  { key: "pressure", value: (loan) => loan.pressure, defaultDirection: "desc" },
  { key: "ends", value: (loan) => dateValue(loan.end_date), defaultDirection: "asc" },
];

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

function ClubNetworkSheet({ close }: { close: () => void }) {
  const { act } = useGame();
  const { money } = useCurrency();
  const [club, setClub] = useState<Club | null>(null);
  const [type, setType] = useState("Development club");
  const [pending, setPending] = useState(false);
  async function submit() {
    if (!club) return;
    setPending(true);
    const result = await act({
      type: "partnership",
      clubId: club.id,
      partnershipType: type,
    });
    setPending(false);
    if (result) close();
  }
  return (
    <Modal title="Build a club partnership" onClose={close}>
      <div className="sheet-body">
        <div className="form-section">
          <Field label="Affiliation type">
            <select
              value={type}
              onChange={(event) => setType(event.target.value)}
            >
              {PARTNERSHIP_TYPES.map((value) => (
                <option key={value}>{value}</option>
              ))}
            </select>
          </Field>
          <p className="sheet-description">{AFFILIATION_BENEFITS[type]}</p>
        </div>
        <ClubChooser selected={club} onChoose={setClub} />
        {club && <AffiliateInterest partnerId={club.id} purpose={type} />}
        {club && (
          <div className="section-space">
            <DetailList
              items={[
                [
                  "Partner club",
                  <ClubLink key="partner" id={club.id} name={club.name} />,
                ],
                ["Academy", `${club.academy}/100`],
                ["Facilities", `${club.facilities}/100`],
                ["Manager trust", `${Math.round(club.manager_trust)}/100`],
                ["Formation", club.formation],
                ["Philosophy", club.philosophy],
                [
                  "Annual partnership fee",
                  money(100_000 + Math.round(club.reputation ** 2 * 60)),
                ],
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
          icon={Handshake}
          onClick={() => void submit()}
          disabled={!club || pending}
        >
          Propose affiliation
        </Button>
      </footer>
    </Modal>
  );
}

function LoanReport({ loan, close }: { loan: Loan; close: () => void }) {
  const { bootstrap, act, confirm, setPlayer } = useGame();
  const { money } = useCurrency();
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
    reason?: OfferReason;
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
            <h3>
              <ClubLink
                id={loan.destination_id}
                name={loan.destination_name ?? "Loan club"}
              />
            </h3>
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
                ...(details.reason ? ([["Why they wanted him", details.reason.text]] as [string, string][]) : []),
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
  const { navigate, bootstrap, openOffer, openContract, act } = useGame();
  const { money } = useCurrency();
  const [tab, setTab] = useState("active");
  const [network, setNetwork] = useState(false);
  const [offer, setOffer] = useState<number | null>(null);
  const [selected, setSelected] = useState<number | null>(null);
  const shown = (data?.loans ?? []).filter((loan) =>
    tab === "history" ? loan.status !== "active" : loan.status === "active",
  );
  const tracker = useSortableRows(shown, LOAN_COLUMNS, {
    initial: { key: "ends", direction: "asc" },
    tieBreakers: [{ value: (loan) => loan.id }],
  });
  if (error) return <ErrorState message={error} />;
  if (!data || !bootstrap) return <Loading />;
  const active = data.loans.filter((loan) => loan.status === "active");
  const loanOffers = data.loanOffers ?? [];
  // Clubs' approaches for the director's players await his answer; the rest are deals already in progress.
  const received = loanOffers.filter(
    (negotiation) => negotiation.stage === "Offer received" && negotiation.selling_club_id === bootstrap.club.id,
  );
  const inProgress = loanOffers.filter((negotiation) => !received.includes(negotiation));
  const opened = loanOffers.find((negotiation) => negotiation.id === offer);
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
          label="Loan offers"
          value={received.length}
          icon={ShieldCheck}
          detail="Clubs' offers awaiting your answer"
        />
      </div>
      <Panel>
        <Tabs
          items={[
            { id: "active", label: "Loan tracker", count: active.length },
            {
              id: "offers",
              label: "Loan offers",
              count: received.length,
            },
            {
              id: "list",
              label: "Loan list",
              count: data.loanList.filter((player) => player.available_loan).length,
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
          (shown.length ? (
            <div className="table-scroll" role="region" aria-label={tab === "active" ? "Loan tracker" : "Loan history"} tabIndex={0}>
              <table className="data-table">
                <thead>
                  <tr>
                    <SortHeader {...tracker.header("player")} label="Player" />
                    <SortHeader {...tracker.header("club")} label="Loan club" />
                    <SortHeader {...tracker.header("type")} label="Agreement" />
                    <SortHeader {...tracker.header("score")} label="LSS" title="Loan Success Score" />
                    <SortHeader {...tracker.header("fit")} label="Fit" />
                    <SortHeader {...tracker.header("pressure")} label="Pressure" />
                    <SortHeader {...tracker.header("ends")} label="Ends" />
                    <th>Review</th>
                  </tr>
                </thead>
                <tbody>
                  {tracker.rows.map((loan) => (
                    <tr key={loan.id}>
                      <td>
                        <div className="report-player">
                          <strong>
                            <PlayerLink
                              id={loan.player_id}
                              name={loan.player_name ?? "Player"}
                            />
                          </strong>
                          <small>
                            {loan.position} / {loan.age}
                          </small>
                        </div>
                      </td>
                      <td>
                        <ClubLink
                          id={loan.destination_id}
                          name={loan.destination_name ?? "Loan club"}
                          color={loan.destination_color}
                          crest
                        />
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
                onClick={() => setTab("list")}
              >
                Open the loan list
              </Button>
            </Empty>
          ))}
        {tab === "offers" && (
          <>
            <IncomingOffers
              offers={received}
              onOpen={(negotiation) => setOffer(negotiation.id)}
              emptyTitle="No loan offers yet"
              emptyDetail="Clubs that need a player at your squad's level send loan offers during the registration windows, more often for players on your loan list or not registered for your competitions."
            />
            {inProgress.length > 0 && (
              <>
                <SectionHeading title="Loan deals in progress" />
                <div className="table-scroll" role="region" aria-label="Loan deals in progress" tabIndex={0}>
                  <table className="data-table">
                    <thead>
                      <tr>
                        <th>Player</th>
                        <th>Direction</th>
                        <th>Club</th>
                        <th>Type</th>
                        <th>Terms</th>
                        <th>Status</th>
                        <th>Open</th>
                      </tr>
                    </thead>
                    <tbody>
                      {inProgress.map((negotiation: Negotiation) => {
                        const details = JSON.parse(negotiation.data) as NegotiationData;
                        const outgoing = negotiation.selling_club_id === bootstrap.club.id;
                        return (
                          <tr key={negotiation.id}>
                            <td>
                              <strong>
                                <PlayerLink
                                  id={negotiation.player_id}
                                  name={negotiation.player_name ?? "Player"}
                                />
                              </strong>
                              <small>
                                {negotiation.position} / {negotiation.age}
                              </small>
                            </td>
                            <td>{outgoing ? "Loaning out" : "Loaning in"}</td>
                            <td>{(outgoing ? negotiation.buyer_name : negotiation.seller_name) ?? "Club"}</td>
                            <td>
                              <Badge>{negotiation.type}</Badge>
                            </td>
                            <td>
                              {money(negotiation.offer)} / {details.terms.salarySplit}% wage share
                            </td>
                            <td>
                              <Badge tone="amber">{negotiation.stage}</Badge>
                            </td>
                            <td>
                              <Button
                                variant="secondary"
                                icon={ArrowUpRight}
                                onClick={() =>
                                  outgoing || ["Agent talks", "Contract review", "Medical", "Registration"].includes(negotiation.stage)
                                    ? openContract(negotiation.player_id)
                                    : openOffer(negotiation.player_id)
                                }
                              >
                                Open
                              </Button>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </>
            )}
          </>
        )}
        {tab === "list" && (
          <>
            <SectionHeading title="Your loan list">
              <TextLink onClick={() => navigate("database")}>
                Find incoming loans
              </TextLink>
            </SectionHeading>
            <p className="dossier-copy padded">
              Clubs approach you with loan offers for players you make available, and for young or unregistered
              players they need. Offers arrive in the registration windows at the frequency set in Settings.
            </p>
            <PlayerTable players={data.loanList} compact>
              {(player) => {
                const entry = data.loanList.find((item) => item.id === player.id)!;
                return (
                  <div className="inline-controls">
                    {entry.open_offers > 0 && (
                      <Badge tone="green">{`${entry.open_offers} offer${entry.open_offers === 1 ? "" : "s"}`}</Badge>
                    )}
                    <Button
                      variant="secondary"
                      icon={ArrowLeftRight}
                      onClick={() =>
                        void act({
                          type: "availability",
                          playerId: player.id,
                          listed: !!player.listed,
                          loan: !player.available_loan,
                        })
                      }
                    >
                      {player.available_loan ? "Remove from loan list" : "Make available for loan"}
                    </Button>
                  </div>
                );
              }}
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
                    <h3>
                      <ClubLink id={partner.partner_id} name={partner.name} />
                    </h3>
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
      {opened && (
        <NegotiationSheet
          key={opened.id}
          negotiation={opened}
          close={() => setOffer(null)}
        />
      )}
      {current && <LoanReport loan={current} close={() => setSelected(null)} />}
    </div>
  );
}
