import { useDeferredValue, useState, type ReactNode } from "react";
import {
  ArrowLeftRight,
  ArrowLeft,
  ArrowUpRight,
  Check,
  Clock3,
  FileSignature,
  Handshake,
  Megaphone,
  MessageSquare,
  Search,
  X,
} from "lucide-react";
import { useCurrency, useGame, useResource } from "../game-context.tsx";
import InterestSummary from "../InterestSummary.tsx";
import RivalPanel from "../RivalPanel.tsx";
import {
  Badge,
  Button,
  ClubLink,
  PlayerLink,
  DetailList,
  Empty,
  ErrorState,
  Field,
  MoneyInput,
  Loading,
  Meter,
  Modal,
  PageHeading,
  Panel,
  PlayerTable,
  Rating,
  SectionHeading,
  SortHeader,
  Stat,
  Tabs,
  TextLink,
} from "../ui.tsx";
import {
  dateLabel,
  addDays,
  adultTransferArrival,
  ageOn,
  daysBetween,
  DEFAULT_TRANSFER_TERMS,
  LOAN_BACK_LABELS,
  LOAN_TYPES,
  POSITIONS,
  PRE_CONTRACT_WINDOW_DAYS,
  TRAINING_TYPES,
  transferWindow,
  TRANSFER_STAGES,
  ACTIVE_TRANSFER_STAGES,
} from "../../shared/rules.ts";
import { plural } from "../format.ts";
import type { PlayerDetail, TransferDesk } from "../../shared/api.ts";
import type {
  BuyBackClause,
  LoanTerms,
  LoanBackOption,
  Negotiation,
  NegotiationData,
  Position,
  SellOnClause,
  TransferTerms,
  TransferPayment,
  PlayerInterest,
} from "../../shared/types.ts";
import { dateValue, rankOf, type SortColumn } from "../sort.ts";
import { useSortableRows } from "../useSortableRows.ts";
import { clubLabel, isMissingPlayer } from "../players.ts";

const PAYMENT_COLUMNS: SortColumn<
  TransferPayment,
  "due" | "player" | "from" | "to" | "amount" | "kind"
>[] = [
  { key: "due", value: (payment) => dateValue(payment.due_date), defaultDirection: "asc" },
  { key: "player", value: (payment) => payment.player_name, defaultDirection: "asc" },
  { key: "from", value: (payment) => payment.payer_name, defaultDirection: "asc" },
  { key: "to", value: (payment) => payment.payee_name, defaultDirection: "asc" },
  { key: "amount", value: (payment) => payment.amount, defaultDirection: "desc" },
  { key: "kind", value: (payment) => rankOf(["fee", "sell-on"], payment.kind), defaultDirection: "asc" },
];
const BUY_BACK_COLUMNS: SortColumn<
  BuyBackClause,
  "player" | "owner" | "holder" | "fee" | "expires"
>[] = [
  { key: "player", value: (clause) => clause.player_name, defaultDirection: "asc" },
  { key: "owner", value: (clause) => clause.owner_name, defaultDirection: "asc" },
  { key: "holder", value: (clause) => clause.beneficiary_name, defaultDirection: "asc" },
  { key: "fee", value: (clause) => clause.fee, defaultDirection: "desc" },
  { key: "expires", value: (clause) => dateValue(clause.expires), defaultDirection: "asc" },
];
const SELL_ON_COLUMNS: SortColumn<
  SellOnClause,
  "player" | "owner" | "beneficiary" | "percentage" | "paid" | "status"
>[] = [
  { key: "player", value: (clause) => clause.player_name, defaultDirection: "asc" },
  { key: "owner", value: (clause) => clause.owner_name, defaultDirection: "asc" },
  { key: "beneficiary", value: (clause) => clause.beneficiary_name, defaultDirection: "asc" },
  { key: "percentage", value: (clause) => clause.percentage, defaultDirection: "desc" },
  { key: "paid", value: (clause) => clause.paid, defaultDirection: "desc" },
  { key: "status", value: (clause) => rankOf(["active", "triggered"], clause.status), defaultDirection: "asc" },
];
type MarketMove = TransferDesk["market"][number] & {
  move: { name?: string; club?: string; fee?: number; playerId?: number; to?: number };
};
const MARKET_COLUMNS: SortColumn<
  MarketMove,
  "player" | "destination" | "fee" | "date"
>[] = [
  { key: "player", value: (event) => event.move.name, defaultDirection: "asc" },
  { key: "destination", value: (event) => event.move.club, defaultDirection: "asc" },
  { key: "fee", value: (event) => event.move.fee, defaultDirection: "desc" },
  { key: "date", value: (event) => dateValue(event.date), defaultDirection: "desc" },
];
const ID_TIE_BREAKER = [{ value: (row: { id: number }) => row.id }];
const CLOSED_STAGES = ["Rejected", "Expired", "Withdrawn", "Hijacked"];
const RIVAL_ACTIVE = ["monitoring", "bid", "fee-agreed"];
const stageTone = (stage: string, open = "green") =>
  CLOSED_STAGES.includes(stage) ? "red" : stage === "Completed" ? "green" : open;

export function OfferBuilder() {
  const { offerPlayerId } = useGame();
  return <OfferPage key={offerPlayerId ?? "new"} />;
}

function OfferPage() {
  const {
    bootstrap,
    offerPlayerId,
    navigate,
    act,
    page,
    openOffer,
    openContract,
  } = useGame();
  const { money, text } = useCurrency();
  const { data, error } = useResource<PlayerDetail>(
    offerPlayerId ? `players/${offerPlayerId}` : null,
  );
  const { data: desk, error: deskError } = useResource<TransferDesk>(
    offerPlayerId ? "transfers" : null,
  );
  const [category, setCategory] = useState("transfer");
  const [loanType, setLoanType] = useState(LOAN_TYPES[0]);
  const [transferType, setTransferType] = useState("cash");
  const [guardianConsent, setGuardianConsent] = useState(false);
  const [selected, setSelected] = useState<number | null>(null);
  const [pending, setPending] = useState(false);
  if (!offerPlayerId)
    return (
      <div className="page">
        <PageHeading title="Make an offer" eyebrow="RECRUITMENT" />
        <Empty icon={Search} title="Choose a player">
          <Button icon={Search} onClick={() => navigate("database")}>
            Find a player
          </Button>
        </Empty>
      </div>
    );
  if (isMissingPlayer(error))
    return (
      <div className="page">
        <PageHeading title="Make an offer" eyebrow="RECRUITMENT" />
        <Empty
          icon={Search}
          title="This player is no longer in the database"
          detail="They left football at the end of a season. Choose another target."
        >
          <Button icon={Search} onClick={() => navigate("database")}>
            Find a player
          </Button>
        </Empty>
      </div>
    );
  if (error) return <ErrorState message={error} />;
  if (deskError) return <ErrorState message={deskError} />;
  // Without the desk an open deal would look like a fresh offer and invite duplicate enquiries.
  if (!data || !bootstrap || !desk) return <Loading />;
  const player = data.player;
  const own = player.club_id === bootstrap.club.id;
  const canLoan = !own && player.club_id !== null && !player.parent_club_id;
  const age = ageOn(player.birth_date, bootstrap.state.date);
  const futureAvailable = !own && age >= 14 && age < 18;
  const preContractAvailable =
    !own &&
    player.club_id !== null &&
    !player.parent_club_id &&
    daysBetween(bootstrap.state.date, player.contract_end) >= 0 &&
    daysBetween(bootstrap.state.date, player.contract_end) <=
      PRE_CONTRACT_WINDOW_DAYS &&
    ageOn(player.birth_date, addDays(player.contract_end, 1)) >= 18;
  const future =
    category === "transfer" && transferType === "future" && futureAvailable;
  const preContract =
    category === "transfer" &&
    transferType === "pre-contract" &&
    preContractAvailable;
  const dealType = own
    ? "Contract renewal"
    : category === "loan" && canLoan
      ? loanType
      : future
        ? "Future transfer"
        : preContract
          ? "Pre-contract agreement"
        : transferType === "youth" && data.youthTransfer.canApproachWithoutFee
          ? "Youth approach"
          : "Permanent transfer";
  const negotiation =
    desk?.negotiations.find((entry) => entry.id === selected) ??
    desk?.negotiations.find(
      (entry) =>
        entry.player_id === player.id &&
        ACTIVE_TRANSFER_STAGES.includes(entry.stage),
    );
  const contractPage = page === "contract";
  const closed = !!negotiation && CLOSED_STAGES.includes(negotiation.stage);
  const previous = negotiation
    ? undefined
    : desk?.negotiations.find(
        (entry) =>
          entry.player_id === player.id &&
          entry.buying_club_id === bootstrap.club.id &&
          CLOSED_STAGES.includes(entry.stage),
      );
  const previousResponse = previous
    ? (JSON.parse(previous.data) as NegotiationData).log.at(-1)
    : undefined;
  const clubAgreed =
    negotiation &&
    [
      "Agent talks",
      "Contract review",
      "Scheduled",
      "Medical",
      "Registration",
      "Completed",
    ].includes(negotiation.stage);
  const futureArrival = negotiation
    ? (JSON.parse(negotiation.data) as NegotiationData).futureArrivalDate
    : future
      ? adultTransferArrival(player.birth_date)
      : preContract
        ? addDays(player.contract_end, 1)
      : undefined;
  async function begin() {
    setPending(true);
    const result = await act({
      type: "enquiry",
      playerId: offerPlayerId,
      dealType,
      ...(future ? { guardianConsent } : {}),
    });
    if (result?.id) {
      const next =
        result.stage === "Enquiry"
          ? await act({
              type: "negotiation",
              id: result.id,
              action: "formalize",
            })
          : result;
      setSelected(Number(result.id));
      if (next?.stage === "Agent talks") openContract(offerPlayerId!);
    }
    setPending(false);
  }
  return (
    <div className="page offer-page">
      <PageHeading
        title={
          contractPage
            ? "Player contract"
            : negotiation
              ? own
                ? "Contract talks"
                : "Club offer"
              : own
                ? "Renew contract"
                : "Make an offer"
        }
        eyebrow={own ? "CONTRACTS" : "RECRUITMENT"}
      >
        <Button
          variant="secondary"
          icon={ArrowLeft}
          onClick={() => navigate("transfers")}
        >
          Transfer desk
        </Button>
      </PageHeading>
      <section className="offer-player-summary">
        <div>
          <h2>
            <PlayerLink id={player.id} name={player.name} />
          </h2>
          <p>
            {player.position} / {plural(player.age, "year")} /{" "}
            <ClubLink
              id={player.club_id}
              name={clubLabel(player, data.profile)}
            />
          </p>
        </div>
        <DetailList
          items={[
            ["Value", money(player.value)],
            ["Weekly wage", money(player.wage)],
            ["Transfer budget", money(bootstrap.club.transfer_budget)],
          ]}
        />
      </section>
      {negotiation && (
        <nav className="offer-stage-navigation" aria-label="Negotiation pages">
          <Button
            variant={contractPage ? "ghost" : "secondary"}
            icon={Handshake}
            aria-current={!contractPage ? "page" : undefined}
            onClick={() => openOffer(player.id)}
          >
            Club offer
          </Button>
          <Button
            variant={contractPage ? "secondary" : "ghost"}
            icon={FileSignature}
            disabled={!clubAgreed}
            aria-current={contractPage ? "page" : undefined}
            onClick={() => openContract(player.id)}
          >
            Player contract
          </Button>
        </nav>
      )}
      {futureArrival ? (
        <div className="information-note section-space">
          <Clock3 size={16} />
          <span>
            {preContract
              ? `Pre-contract arrival: ${dateLabel(futureArrival)}. The current club is informed and no transfer fee is due if the contract expires.`
              : `Future arrival: ${dateLabel(futureArrival)}. The player cannot join before turning 18. Medical, registration and work-permission checks still apply on arrival.`}
          </span>
        </div>
      ) : (
        data.youthTransfer.minor && <YouthEligibility data={data} />
      )}
      {previous && (
        <div className="information-note section-space" role="status">
          <MessageSquare size={16} />
          <span>
            Previous talks ({previous.type}) ended: {previous.stage}
            {previousResponse
              ? ` on ${dateLabel(previousResponse.date)}. ${text(previousResponse.message)}`
              : "."}
          </span>
        </div>
      )}
      {!negotiation && <InterestSummary assessment={data.interest} />}
      {!negotiation &&
        (previous?.stage === "Hijacked" ? (
          <RivalPanel
            rivals={previous.rivals}
            battle={previous.battle}
            stage="Hijacked"
          />
        ) : (
          !own && <RivalPanel rivals={data.interest.rivals} />
        ))}
      {!negotiation && (
        <section className="offer-choices">
          <SectionHeading title="1. Offer category" />
          <div
            className="theme-choices offer-category"
            role="radiogroup"
            aria-label="Offer category"
          >
            {[
              {
                id: "transfer",
                name: own ? "Contract offer" : "Transfer offer",
                icon: FileSignature,
              },
              { id: "loan", name: "Loan offer", icon: Handshake },
            ]
              .filter((option) => option.id !== "loan" || canLoan)
              .map((option) => (
                <label className="theme-choice" key={option.id}>
                  <input
                    type="radio"
                    name="offer-category"
                    value={option.id}
                    checked={
                      category === option.id ||
                      (!canLoan && option.id === "transfer")
                    }
                    onChange={() => setCategory(option.id)}
                  />
                  <span>
                    <option.icon size={17} />
                    {option.name}
                  </span>
                </label>
              ))}
          </div>
          <SectionHeading title="2. Offer type" />
          <Field label="Offer type">
            <select
              value={category === "loan" && canLoan ? loanType : transferType}
              onChange={(event) =>
                category === "loan" && canLoan
                  ? setLoanType(event.target.value)
                  : setTransferType(event.target.value)
              }
            >
              {category === "loan" && canLoan ? (
                LOAN_TYPES.map((type) => <option key={type}>{type}</option>)
              ) : (
                <>
                  <option value="cash">
                    {own
                      ? "Contract renewal"
                      : player.club_id
                        ? "Permanent transfer"
                        : "Free-agent contract"}
                  </option>
                  {!own && player.club_id && (
                    <option value="instalments">
                      Transfer with instalments
                    </option>
                  )}
                  {data.youthTransfer.canApproachWithoutFee && (
                    <option value="youth">Approach to sign (youth)</option>
                  )}
                  {futureAvailable && (
                    <option value="future">Future transfer at 18</option>
                  )}
                  {preContractAvailable && (
                    <option value="pre-contract">Pre-contract agreement</option>
                  )}
                </>
              )}
            </select>
          </Field>
          {future && (
            <label className="checkbox-field section-space">
              <input
                type="checkbox"
                checked={guardianConsent}
                onChange={(event) => setGuardianConsent(event.target.checked)}
              />
              Guardian consent for the conditional future agreement
            </label>
          )}
          <div className="offer-page-actions">
            <Button variant="secondary" onClick={() => navigate("transfers")}>
              Cancel
            </Button>
            <Button
              icon={ArrowUpRight}
              disabled={
                pending ||
                !!player.parent_club_id ||
                player.role === "Retired" ||
                (future
                  ? !guardianConsent
                  : !data.youthTransfer.eligibleToApply)
              }
              onClick={() => void begin()}
            >
              {pending ? "Opening talks..." : "Continue to negotiation"}
            </Button>
          </div>
        </section>
      )}
      {negotiation && (
        <NegotiationSheet
          key={`${negotiation.id}:${page}`}
          negotiation={negotiation}
          fullPage
          onAction={() => setSelected(negotiation.id)}
          initialTransferTerms={
            transferType === "instalments"
              ? {
                  ...DEFAULT_TRANSFER_TERMS,
                  upfrontPercent: 50,
                  installments: 3,
                }
              : undefined
          }
          close={() => navigate("transfers")}
        />
      )}
      {closed && (
        <div className="offer-page-actions">
          <Button icon={ArrowUpRight} onClick={() => setSelected(null)}>
            Start new talks
          </Button>
        </div>
      )}
    </div>
  );
}

function YouthEligibility({ data }: { data: PlayerDetail }) {
  const { act } = useGame();
  const { money } = useCurrency();
  const assessment = data.youthTransfer;
  const [safeguards, setSafeguards] = useState({
    football: false,
    education: false,
    care: false,
    mentor: false,
    parentalConsent: false,
  });
  const [pending, setPending] = useState(false);
  const obligations = [
    ["football", "Football education and training programme"],
    ["education", "Academic or vocational education"],
    ["care", "Suitable accommodation and welfare support"],
    ["mentor", "Club mentor appointed"],
    ["parentalConsent", "Parent or guardian consent"],
  ] as const;
  async function submit() {
    setPending(true);
    await act({
      type: "minor-application",
      playerId: data.player.id,
      safeguards,
    });
    setPending(false);
  }
  return (
    <details className="youth-eligibility" open={!assessment.approved}>
      <summary>
        <Badge
          tone={
            assessment.approved
              ? "green"
              : assessment.eligibleToApply
                ? "amber"
                : "red"
          }
        >
          {assessment.status}
        </Badge>
        <span>Youth eligibility</span>
      </summary>
      <div>
        <DetailList
          items={[
            [
              "Registration status",
              assessment.contractStatus === "amateur"
                ? "Non-professional youth registration"
                : "Protected contract",
            ],
            [
              "No-fee approach",
              assessment.canApproachWithoutFee
                ? "Available; compensation may still apply"
                : "Not available",
            ],
            ...(assessment.canApproachWithoutFee
              ? [
                  [
                    "Training compensation estimate",
                    money(assessment.trainingCompensation),
                  ] as [string, string],
                ]
              : []),
          ]}
        />
        {assessment.reasons.map((reason) => (
          <p key={reason}>{reason}</p>
        ))}
        {assessment.application && (
          <p>
            {assessment.application.status === "pending"
              ? `Review due ${dateLabel(assessment.application.dueDate)}.`
              : assessment.application.reason}
          </p>
        )}
        {!assessment.approved &&
          assessment.eligibleToApply &&
          assessment.application?.status !== "pending" && (
            <div className="minor-application">
              <div className="minor-obligations">
                {obligations.map(([id, name]) => (
                  <label className="checkbox-field" key={id}>
                    <input
                      type="checkbox"
                      checked={safeguards[id]}
                      onChange={(event) =>
                        setSafeguards({
                          ...safeguards,
                          [id]: event.target.checked,
                        })
                      }
                    />
                    {name}
                  </label>
                ))}
              </div>
              <Button
                icon={FileSignature}
                disabled={pending || !Object.values(safeguards).every(Boolean)}
                onClick={() => void submit()}
              >
                Submit minor application
              </Button>
            </div>
          )}
        <small>{assessment.source}</small>
      </div>
    </details>
  );
}

function TransferTermsForm({
  terms,
  setTerms,
  fee,
  loanBack = true,
}: {
  terms: TransferTerms;
  setTerms: (terms: TransferTerms) => void;
  fee: number;
  loanBack?: boolean;
}) {
  return (
    <>
      <h3 className="form-heading">Payment schedule & clauses</h3>
      <div className="term-grid">
        <Field label="Deferred instalments">
          <select
            value={terms.installments}
            onChange={(event) => {
              const installments = Number(event.target.value);
              setTerms({
                ...terms,
                installments,
                intervalMonths:
                  installments * terms.intervalMonths > 60
                    ? 6
                    : terms.intervalMonths,
                upfrontPercent: installments
                  ? Math.min(terms.upfrontPercent, 50)
                  : 100,
              });
            }}
          >
            {[0, 1, 2, 3, 4, 6, 8].map((count) => (
              <option key={count} value={count}>
                {count ? `${count} instalments` : "Pay in full"}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Payment interval">
          <select
            value={terms.intervalMonths}
            disabled={!terms.installments}
            onChange={(event) =>
              setTerms({ ...terms, intervalMonths: Number(event.target.value) })
            }
          >
            {[1, 3, 6, 12].map((months) => (
              <option
                key={months}
                value={months}
                disabled={months * terms.installments > 60}
              >
                Every {months} {months === 1 ? "month" : "months"}
              </option>
            ))}
          </select>
        </Field>
        <Field label={`Upfront payment / ${terms.upfrontPercent}%`}>
          <input
            aria-label="Upfront payment percentage"
            type="range"
            min="0"
            max={terms.installments ? 95 : 100}
            step="5"
            disabled={!terms.installments}
            value={terms.upfrontPercent}
            onChange={(event) =>
              setTerms({ ...terms, upfrontPercent: Number(event.target.value) })
            }
          />
        </Field>
        <Field label={`Percentage of next sale / ${terms.sellOnPercent}%`}>
          <input
            aria-label="Percentage of next sale"
            type="range"
            min="0"
            max="50"
            value={terms.sellOnPercent}
            onChange={(event) =>
              setTerms({ ...terms, sellOnPercent: Number(event.target.value) })
            }
          />
        </Field>
        {loanBack && (
          <Field label="Seller loan-back">
            <select
              value={terms.loanBack ?? "none"}
              onChange={(event) =>
                setTerms({
                  ...terms,
                  loanBack: event.target.value as LoanBackOption,
                })
              }
            >
              {(["none", "season", "year", "two-seasons"] as LoanBackOption[]).map(
                (option) => (
                  <option key={option} value={option}>
                    {LOAN_BACK_LABELS[option]}
                  </option>
                ),
              )}
            </select>
          </Field>
        )}
        <label className="checkbox-field">
          <input
            type="checkbox"
            checked={terms.buyBackFee > 0}
            onChange={(event) =>
              setTerms({
                ...terms,
                buyBackFee: event.target.checked
                  ? Math.max(100000, Math.round(fee * 1.5))
                  : 0,
              })
            }
          />
          Selling club buy-back right
        </label>
        {terms.buyBackFee > 0 && (
          <>
            <Field label="Buy-back fee">
              <MoneyInput
                min={fee}
                value={terms.buyBackFee}
                onChange={(buyBackFee) => setTerms({ ...terms, buyBackFee })}
              />
            </Field>
            <Field label="Buy-back validity">
              <select
                value={terms.buyBackYears}
                onChange={(event) =>
                  setTerms({
                    ...terms,
                    buyBackYears: Number(event.target.value),
                  })
                }
              >
                {[1, 2, 3, 4, 5].map((years) => (
                  <option key={years} value={years}>
                    {years} {years === 1 ? "year" : "years"}
                  </option>
                ))}
              </select>
            </Field>
          </>
        )}
      </div>
    </>
  );
}

export function TransferPaymentTable({
  payments,
  clubId,
}: {
  payments: TransferPayment[];
  clubId: number;
}) {
  const { money } = useCurrency();
  const sorting = useSortableRows(payments, PAYMENT_COLUMNS, {
    initial: { key: "due", direction: "asc" },
    tieBreakers: ID_TIE_BREAKER,
  });
  return payments.length ? (
    <div className="table-scroll" role="region" aria-label="Outstanding transfer payments" tabIndex={0}>
      <table className="data-table">
        <thead>
          <tr>
            <SortHeader {...sorting.header("due")} label="Due" />
            <SortHeader {...sorting.header("player")} label="Player" />
            <SortHeader {...sorting.header("from")} label="From" />
            <SortHeader {...sorting.header("to")} label="To" />
            <SortHeader {...sorting.header("amount")} label="Amount" />
            <SortHeader {...sorting.header("kind")} label="Agreement" />
          </tr>
        </thead>
        <tbody>
          {sorting.rows.map((payment) => (
            <tr key={payment.id}>
              <td>{dateLabel(payment.due_date)}</td>
              <td>
                <PlayerLink
                  id={payment.player_id}
                  name={payment.player_name ?? "Player"}
                />
              </td>
              <td>
                <ClubLink
                  id={payment.payer_id}
                  name={payment.payer_name ?? "Club"}
                />
              </td>
              <td>
                <ClubLink
                  id={payment.payee_id}
                  name={payment.payee_name ?? "Club"}
                />
              </td>
              <td
                className={
                  payment.payer_id === clubId ? "negative" : "positive"
                }
              >
                {payment.payer_id === clubId ? "-" : "+"}
                {money(payment.amount)}
              </td>
              <td>
                <Badge>
                  {payment.kind === "sell-on"
                    ? "Sell-on payment"
                    : "Transfer instalment"}
                </Badge>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  ) : (
    <Empty icon={Clock3} title="No outstanding transfer payments" />
  );
}

// Mirrors MIN_LOAN_SALARY_SPLIT / MAX_LOAN_SELL_ON in server/systems.ts.
const MIN_LOAN_SALARY_SPLIT = 25;
const MAX_LOAN_SELL_ON = 50;
const DEFAULT_LOAN_SALARY_SPLIT = 70;

function withLoanLimits(terms: LoanTerms): LoanTerms {
  const split = Number(terms.salarySplit);
  const sellOn = Number(terms.sellOn);
  return {
    ...terms,
    salarySplit:
      Number.isFinite(split) && split >= MIN_LOAN_SALARY_SPLIT
        ? Math.min(100, split)
        : DEFAULT_LOAN_SALARY_SPLIT,
    sellOn: Number.isFinite(sellOn)
      ? Math.min(MAX_LOAN_SELL_ON, Math.max(0, sellOn))
      : 0,
  };
}

function loanEndDateLabel(type: string, startDate: string, duration: number) {
  if (type === "Short loan") return dateLabel(addDays(startDate, 182));
  if (type === "Emergency loan") return dateLabel(addDays(startDate, 90));
  const seasonEndYear =
    Number(startDate.slice(0, 4)) + (startDate.slice(5) >= "06-01" ? 1 : 0);
  if (type === "Two-year loan") return dateLabel(`${seasonEndYear + 1}-06-30`);
  if (type === "Standard loan" || duration === 365)
    return dateLabel(`${seasonEndYear}-06-30`);
  return dateLabel(addDays(startDate, duration));
}

/** The terms that matter for one incoming offer: dates, money, role and only the clauses this deal includes. */
function incomingOfferItems(
  negotiation: Negotiation,
  details: NegotiationData,
  money: (value: number) => string,
): [string, ReactNode][] {
  const loan = LOAN_TYPES.includes(negotiation.type);
  const start = details.plannedStart ?? negotiation.created;
  const terms = details.terms;
  const items: [string, ReactNode][] = [
    [
      loan ? "Borrowing club" : "Buying club",
      <ClubLink
        key="offer-club"
        id={negotiation.buying_club_id}
        name={negotiation.buyer_name ?? "Club"}
        color={negotiation.buyer_color}
        crest
      />,
    ],
    ...(details.reason ? ([["Why they want him", details.reason.text]] as [string, ReactNode][]) : []),
  ];
  if (!loan)
    return [
      ...items,
      ["Transfer fee", money(negotiation.offer)],
      ["Wage offered to the player", `${money(negotiation.wage)} / week`],
      ["Contract offered", `${plural(details.years, "year")} / ${details.role.toLowerCase()}`],
      ["Reply by", dateLabel(negotiation.deadline)],
    ];
  return [
    ...items,
    ["Loan", negotiation.type],
    ["Starts / ends", `${dateLabel(start)} to ${loanEndDateLabel(negotiation.type, start, terms.duration)}`],
    ["Loan fee", money(negotiation.offer)],
    ["Wage split", `${terms.salarySplit}% paid by them / ${100 - terms.salarySplit}% by you`],
    ["Role / playing time", `${terms.role} / about ${terms.playingTime}% of minutes`],
    ["Recall / injury recall", `${terms.recall ? "Yes" : "No"} / ${terms.injuryRecall ? "Yes" : "No"}`],
    ...(negotiation.type === "Loan with option"
      ? ([["Option to buy", money(terms.optionFee)]] as [string, ReactNode][])
      : []),
    ...(negotiation.type === "Loan with obligation"
      ? ([
          [
            "Obligation to buy",
            `${money(terms.optionFee)}${terms.obligationCondition === "Unconditional" ? "" : ` (${terms.obligationCondition.toLowerCase()})`}`,
          ],
        ] as [string, ReactNode][])
      : []),
    ...(negotiation.type === "Loan with sell-on"
      ? ([["Their share of a future sale", `${terms.sellOn}%`]] as [string, ReactNode][])
      : []),
    ...(terms.bonus > 0
      ? ([["Minutes bonus you pay", `${money(terms.bonus)} at ${terms.mandatoryMinutes} minutes`]] as [string, ReactNode][])
      : []),
    ["Reply by", dateLabel(negotiation.deadline)],
  ];
}

/**
 * Offers clubs have made for the director's players, with the details and reason of each deal: accept or reject
 * here, or open the offer to counter.
 */
export function IncomingOffers({
  offers,
  onOpen,
  emptyTitle,
  emptyDetail,
}: {
  offers: Negotiation[];
  onOpen: (negotiation: Negotiation) => void;
  emptyTitle: string;
  emptyDetail: string;
}) {
  const { act, confirm } = useGame();
  const { money } = useCurrency();
  const [pending, setPending] = useState<number | null>(null);
  if (!offers.length) return <Empty icon={Handshake} title={emptyTitle} detail={emptyDetail} />;
  async function respond(negotiation: Negotiation, action: "accept" | "reject") {
    setPending(negotiation.id);
    await act({ type: "negotiation", id: negotiation.id, action });
    setPending(null);
  }
  return (
    <div className="padded">
      <div className="cards-list incoming-offers">
        {offers.map((negotiation) => {
          const details = JSON.parse(negotiation.data) as NegotiationData;
          const loan = LOAN_TYPES.includes(negotiation.type);
          return (
            <article className="entity-card" key={negotiation.id} aria-label={`${negotiation.buyer_name} offer for ${negotiation.player_name}`}>
              <div className="entity-card-top">
                <Badge tone={loan ? "blue" : "green"}>{negotiation.type}</Badge>
                {negotiation.buyer_reputation !== undefined && (
                  <Badge>{`Reputation ${Math.round(negotiation.buyer_reputation)}`}</Badge>
                )}
              </div>
              <h3>
                <PlayerLink id={negotiation.player_id} name={negotiation.player_name ?? "Player"} />
              </h3>
              <p>
                {negotiation.position} / {negotiation.age} yrs / {money(negotiation.offer)}
              </p>
              <DetailList items={incomingOfferItems(negotiation, details, money)} />
              <div className="inline-controls">
                <Button
                  icon={Check}
                  disabled={pending === negotiation.id}
                  onClick={() =>
                    confirm(
                      `Accept ${negotiation.buyer_name}'s offer?`,
                      loan
                        ? `${negotiation.player_name} joins them on these terms once the medical and registration are complete. Other offers for him are withdrawn.`
                        : `${negotiation.player_name} is sold for ${money(negotiation.offer)} once personal terms, the medical and registration are complete. Other offers for him are withdrawn.`,
                      () => void respond(negotiation, "accept"),
                    )
                  }
                >
                  Accept
                </Button>
                <Button
                  variant="secondary"
                  icon={MessageSquare}
                  disabled={pending === negotiation.id}
                  onClick={() => onOpen(negotiation)}
                >
                  Counter
                </Button>
                <Button
                  variant="ghost"
                  icon={X}
                  disabled={pending === negotiation.id}
                  onClick={() => void respond(negotiation, "reject")}
                >
                  Reject
                </Button>
              </div>
            </article>
          );
        })}
      </div>
    </div>
  );
}

export function LoanTermsForm({
  terms,
  setTerms,
  type,
}: {
  terms: LoanTerms;
  setTerms: (terms: LoanTerms) => void;
  type: string;
}) {
  const update = <Key extends keyof LoanTerms>(
    key: Key,
    value: LoanTerms[Key],
  ) => setTerms({ ...terms, [key]: value });
  return (
    <>
      <div className="form-heading">Loan agreement</div>
      <div className="term-grid">
        <Field label={`Playing time guarantee / ${terms.playingTime}%`}>
          <input
            type="range"
            min="0"
            max="100"
            value={terms.playingTime}
            onChange={(event) =>
              update("playingTime", Number(event.target.value))
            }
          />
        </Field>
        <Field
          label={`Borrowing club salary share (${MIN_LOAN_SALARY_SPLIT}-100%) / ${terms.salarySplit}%`}
        >
          <input
            type="range"
            min={MIN_LOAN_SALARY_SPLIT}
            max="100"
            value={terms.salarySplit}
            onChange={(event) =>
              update(
                "salarySplit",
                Math.min(
                  100,
                  Math.max(MIN_LOAN_SALARY_SPLIT, Number(event.target.value)),
                ),
              )
            }
          />
        </Field>
        <Field label="Guaranteed position">
          <select
            value={terms.position}
            onChange={(event) =>
              update("position", event.target.value as Position)
            }
          >
            {POSITIONS.map((position) => (
              <option key={position}>{position}</option>
            ))}
          </select>
        </Field>
        <Field label="Guaranteed role">
          <select
            value={terms.role}
            onChange={(event) => update("role", event.target.value)}
          >
            {["Key player", "Regular starter", "Squad player", "Prospect"].map(
              (role) => (
                <option key={role}>{role}</option>
              ),
            )}
          </select>
        </Field>
        <Field label="Development plan">
          <select
            value={terms.developmentPlan}
            onChange={(event) => update("developmentPlan", event.target.value)}
          >
            {TRAINING_TYPES.map((focus) => (
              <option key={focus}>{focus}</option>
            ))}
          </select>
        </Field>
        <Field label="Mandatory season minutes">
          <input
            type="number"
            min="0"
            max="6000"
            step="90"
            value={terms.mandatoryMinutes}
            onChange={(event) =>
              update("mandatoryMinutes", Number(event.target.value))
            }
          />
        </Field>
        <Field label="Development bonus">
          <MoneyInput
            min={0}
            value={terms.bonus}
            onChange={(value) => update("bonus", value)}
          />
        </Field>
        <Field label="Duration (days)">
          <input
            type="number"
            min="30"
            max="730"
            value={
              type === "Short loan"
                ? 182
                : type === "Two-year loan"
                  ? 730
                  : type === "Emergency loan"
                    ? 90
                    : terms.duration
            }
            disabled={[
              "Short loan",
              "Two-year loan",
              "Emergency loan",
            ].includes(type)}
            onChange={(event) => update("duration", Number(event.target.value))}
          />
        </Field>
        <Field label={`Minimum tactical fit / ${terms.tacticalFit}`}>
          <input
            type="range"
            min="0"
            max="100"
            value={terms.tacticalFit}
            onChange={(event) =>
              update("tacticalFit", Number(event.target.value))
            }
          />
        </Field>
        <Field label={`Minimum manager trust / ${terms.managerTrust}`}>
          <input
            type="range"
            min="0"
            max="100"
            value={terms.managerTrust}
            onChange={(event) =>
              update("managerTrust", Number(event.target.value))
            }
          />
        </Field>
        <label className="checkbox-field">
          <input
            type="checkbox"
            checked={terms.recall}
            onChange={(event) => update("recall", event.target.checked)}
          />
          Standard recall clause
        </label>
        <label className="checkbox-field">
          <input
            type="checkbox"
            checked={terms.injuryRecall}
            onChange={(event) => update("injuryRecall", event.target.checked)}
          />
          Injury recall clause
        </label>
        {["Loan with option", "Loan with obligation"].includes(type) && (
          <Field label="Agreed purchase fee">
            <MoneyInput
              min={0}
              value={terms.optionFee}
              onChange={(value) => update("optionFee", value)}
            />
          </Field>
        )}
        {type === "Loan with obligation" && (
          <Field label="Purchase obligation">
            <select
              value={terms.obligationCondition}
              onChange={(event) =>
                update(
                  "obligationCondition",
                  event.target.value as LoanTerms["obligationCondition"],
                )
              }
            >
              <option>Unconditional</option>
              <option>Minutes played</option>
              <option>Avoid relegation</option>
            </select>
          </Field>
        )}
        {type === "Loan with sell-on" && (
          <Field
            label={`Sell-on clause (0-${MAX_LOAN_SELL_ON}%) / ${terms.sellOn}%`}
          >
            <input
              type="range"
              min="0"
              max={MAX_LOAN_SELL_ON}
              value={terms.sellOn}
              onChange={(event) =>
                update(
                  "sellOn",
                  Math.min(
                    MAX_LOAN_SELL_ON,
                    Math.max(0, Number(event.target.value)),
                  ),
                )
              }
            />
          </Field>
        )}
      </div>
      <p className="term-relationship">
        Club relationship <strong>{Math.round(terms.relationship)}/100</strong>
      </p>
    </>
  );
}

function DealProgress({
  stage,
  future = false,
  preContract = false,
}: {
  stage: string;
  future?: boolean;
  preContract?: boolean;
}) {
  const stages = future
    ? [...TRANSFER_STAGES.slice(0, 4), "Scheduled", ...TRANSFER_STAGES.slice(4)]
    : TRANSFER_STAGES;
  const current = stages.indexOf(stage);
  return (
    <ol
      className="deal-stage-list"
      aria-label="Transfer progress"
      style={{
        gridTemplateColumns: `repeat(${stages.length}, minmax(0, 1fr))`,
      }}
    >
      {stages.map((name, index) => (
        <li
          key={name}
          className={
            index < current ? "complete" : index === current ? "current" : ""
          }
          aria-current={index === current ? "step" : undefined}
        >
          <span>{index < current ? <Check size={11} /> : index + 1}</span>
          <small>{preContract && name === "Scheduled" ? "Pre-contract" : name}</small>
        </li>
      ))}
    </ol>
  );
}

function AffiliateControls({
  negotiation,
  details,
  compact = false,
  onDone,
}: {
  negotiation: Negotiation;
  details: NegotiationData;
  compact?: boolean;
  onDone?: () => void;
}) {
  const { act, bootstrap, confirm } = useGame();
  const { money } = useCurrency();
  const placementOptions = negotiation.affiliatePlacementOptions ?? [];
  const loanOptions = negotiation.onwardLoanOptions ?? [];
  const eligiblePlacements = placementOptions.filter((option) => option.eligible);
  const eligibleLoans = loanOptions.filter((option) => option.eligible);
  const [placementClub, setPlacementClub] = useState(
    String(eligiblePlacements[0]?.clubId ?? ""),
  );
  const [loanClub, setLoanClub] = useState(
    String(details.onwardLoan?.clubId ?? eligibleLoans[0]?.clubId ?? ""),
  );
  const [loanUntil, setLoanUntil] = useState<"season" | "year">(
    details.onwardLoan?.until ?? "season",
  );
  if (!bootstrap || negotiation.buying_club_id !== bootstrap.club.id)
    return null;
  const hasLoanBack =
    !!details.transferTerms?.loanBack && details.transferTerms.loanBack !== "none";
  const canPlace =
    !!details.futureArrivalDate &&
    negotiation.type === "Future transfer" &&
    negotiation.stage === "Scheduled" &&
    !details.affiliatePlacement &&
    !hasLoanBack &&
    eligiblePlacements.length > 0;
  const canPlanLoan =
    ["Contract review", "Scheduled", "Medical", "Registration"].includes(
      negotiation.stage,
    ) &&
    !LOAN_TYPES.includes(negotiation.type) &&
    !["Contract renewal", "Youth approach"].includes(negotiation.type) &&
    !hasLoanBack;
  return (
    <div className={compact ? "affiliate-controls compact" : "affiliate-controls"}>
      {details.affiliatePlacement ? (
        <p>
          Placed at <strong>{details.affiliatePlacement.clubName}</strong>; fee{" "}
          {money(details.affiliatePlacement.fee)} already settled.
        </p>
      ) : details.futureArrivalDate &&
        negotiation.type === "Future transfer" &&
        negotiation.stage === "Scheduled" &&
        !hasLoanBack ? (
        <div className="inline-controls">
          <Field label="Place at affiliate now">
            <select
              aria-label="Affiliate placement club"
              value={placementClub}
              onChange={(event) => setPlacementClub(event.target.value)}
            >
              {eligiblePlacements.length === 0 && (
                <option value="">No eligible affiliate</option>
              )}
              {placementOptions.map((option) => (
                <option
                  key={option.clubId}
                  value={option.clubId}
                  disabled={!option.eligible}
                >
                  {option.clubName}
                  {option.eligible ? "" : ` — ${option.reasons[0]}`}
                </option>
              ))}
            </select>
          </Field>
          <Button
            variant="secondary"
            icon={ArrowLeftRight}
            disabled={!canPlace || !placementClub}
            onClick={() => {
              const option = placementOptions.find(
                (entry) => entry.clubId === Number(placementClub),
              );
              if (!option) return;
              confirm(
                "Place at affiliate now?",
                `This registers the player domestically at ${option.clubName}, settles the current fee from the reserved allocation now, and keeps only the future move to your club. FIFA bridge-transfer rules require at least 16 weeks before the onward registration${option.adjustedArrival ? `, so arrival becomes ${dateLabel(option.adjustedArrival)}` : ""}.`,
                () => {
                  void act({
                    type: "affiliate-placement",
                    id: negotiation.id,
                    clubId: option.clubId,
                  }).then((result) => {
                    if (result) onDone?.();
                  });
                },
              );
            }}
          >
            Place now
          </Button>
        </div>
      ) : null}
      {canPlanLoan && (
        <div className="inline-controls">
          <Field label="On arrival, loan to affiliate">
            <select
              aria-label="Onward affiliate loan club"
              value={loanClub}
              onChange={(event) => setLoanClub(event.target.value)}
            >
              <option value="">No affiliate loan</option>
              {details.onwardLoan &&
                !loanOptions.some(
                  (option) => option.clubId === details.onwardLoan!.clubId,
                ) && (
                  <option value={details.onwardLoan.clubId}>
                    {details.onwardLoan.clubName} (currently ineligible)
                  </option>
                )}
              {loanOptions.map((option) => (
                <option
                  key={option.clubId}
                  value={option.clubId}
                  disabled={!option.eligible}
                >
                  {option.clubName}
                  {option.eligible ? "" : ` — ${option.reasons[0]}`}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Loan length">
            <select
              aria-label="Onward affiliate loan length"
              value={loanUntil}
              onChange={(event) =>
                setLoanUntil(event.target.value as "season" | "year")
              }
            >
              <option value="season">End of season</option>
              <option value="year">One year</option>
            </select>
          </Field>
          <Button
            variant="secondary"
            icon={Handshake}
            onClick={() =>
              void act({
                type: "onward-loan",
                id: negotiation.id,
                clubId: loanClub ? Number(loanClub) : null,
                until: loanUntil,
              }).then((result) => {
                if (result) onDone?.();
              })
            }
          >
            Save loan plan
          </Button>
        </div>
      )}
      {details.onwardLoan && (
        <p>
          Planned affiliate loan: <strong>{details.onwardLoan.clubName}</strong>{" "}
          ({details.onwardLoan.until === "season" ? "to season end" : "one year"}).
        </p>
      )}
      {!compact &&
        [...placementOptions, ...loanOptions]
          .filter((option) => !option.eligible)
          .slice(0, 3)
          .map((option) => (
            <small key={`${option.clubId}-${option.reasons[0]}`}>
              {option.clubName}: {option.reasons.join(" ")}
            </small>
          ))}
    </div>
  );
}

export function NegotiationSheet({
  negotiation,
  close,
  fullPage = false,
  initialTransferTerms,
  onAction,
}: {
  negotiation: Negotiation;
  close: () => void;
  fullPage?: boolean;
  initialTransferTerms?: TransferTerms;
  /** Runs before a response is requested, so the page keeps showing this deal if it closes. */
  onAction?: () => void;
}) {
  const { act, bootstrap, confirm, page, openContract, openOffer } = useGame();
  const { money, text } = useCurrency();
  const details = JSON.parse(negotiation.data) as NegotiationData;
  const [fee, setFee] = useState(
    Math.round(negotiation.offer || negotiation.asking_price),
  );
  const [wage, setWage] = useState(
    Math.round(
      details.requiredWage ??
        negotiation.wage * (LOAN_TYPES.includes(negotiation.type) ? 1 : 1.25),
    ),
  );
  const [years, setYears] = useState(details.years || 4);
  const [role, setRole] = useState(details.role || "Regular starter");
  const [promises, setPromises] = useState(details.promises);
  const [terms, setTerms] = useState<LoanTerms>(() =>
    withLoanLimits(details.terms),
  );
  const [transferTerms, setTransferTerms] = useState<TransferTerms>({
    ...DEFAULT_TRANSFER_TERMS,
    ...initialTransferTerms,
    ...details.transferTerms,
  });
  const [bonus, setBonus] = useState(details.signingBonus ?? 0);
  const [pending, setPending] = useState(false);
  const loan = LOAN_TYPES.includes(negotiation.type);
  const preContract = negotiation.type === "Pre-contract agreement";
  const buyerManaged =
    !!details.buyerManaged && negotiation.buying_club_id !== bootstrap?.club.id;
  const playerPhase = [
    "Agent talks",
    "Contract review",
    "Scheduled",
    "Medical",
    "Registration",
    "Completed",
  ].includes(negotiation.stage);
  const contractPage = fullPage ? page === "contract" : playerPhase;
  const active =
    !buyerManaged &&
    (contractPage
      ? negotiation.stage === "Agent talks"
      : negotiation.stage === "Club talks");
  const incoming = negotiation.stage === "Offer received";
  const permanent =
    ["Permanent transfer", "Future transfer"].includes(negotiation.type) &&
    negotiation.selling_club_id !== null;
  const enquiry = !contractPage && negotiation.stage === "Enquiry";
  const review = contractPage && negotiation.stage === "Contract review";
  const agentFee = Math.round(
    ((loan ? negotiation.offer : negotiation.wage * 52) *
      details.agent.commission) /
      100,
  );
  const personalStage = negotiation.stage === "Agent talks";
  const interestParams = new URLSearchParams({
    negotiationId: String(negotiation.id),
    wage: String(wage),
    role,
    years: String(years),
    promises: JSON.stringify(promises),
  });
  const interestPath = useDeferredValue(
    personalStage && active
      ? `players/${negotiation.player_id}/interest?${interestParams}`
      : null,
  );
  const { data: interestPreview } = useResource<PlayerInterest>(interestPath, {
    keepPreviousData: true,
  });
  const previewFee = active || incoming ? fee : negotiation.offer;
  const shownTerms =
    active || incoming
      ? transferTerms
      : { ...DEFAULT_TRANSFER_TERMS, ...details.transferTerms };
  const cashFee =
    permanent && shownTerms.installments
      ? Math.round(previewFee * shownTerms.upfrontPercent) / 100
      : previewFee;
  async function step(action: "formalize" | "sign" | "revise") {
    onAction?.();
    setPending(true);
    const result = await act({
      type: "negotiation",
      id: negotiation.id,
      action,
    });
    setPending(false);
    if (fullPage && result?.stage === "Agent talks")
      openContract(negotiation.player_id);
    if (result?.stage === "Medical" && !fullPage) close();
  }
  async function submit() {
    onAction?.();
    setPending(true);
    const result = await act({
      type: "offer",
      id: negotiation.id,
      fee,
      wage,
      years,
      role,
      promises,
      signingBonus: bonus,
      ...(permanent ? { transferTerms } : {}),
      ...(loan ? { terms: { ...terms, fee } } : {}),
    });
    setPending(false);
    if (
      fullPage &&
      negotiation.stage === "Club talks" &&
      result?.stage === "Agent talks"
    )
      openContract(negotiation.player_id);
    // A rejection stays open so its reason remains readable after the toast.
    if (!fullPage && result?.stage === "Medical") close();
  }
  async function counterOffer() {
    onAction?.();
    setPending(true);
    const result = await act({
      type: loan ? "counter-loan" : "counter-transfer",
      id: negotiation.id,
      fee,
      ...(loan ? { terms: { ...terms, fee } } : { transferTerms }),
    });
    setPending(false);
    if (result?.stage === "Agent talks") close();
  }
  const content = (
    <>
      <div className="sheet-body">
        <div className="negotiation-sheet-top">
          <div>
            <Badge tone={stageTone(negotiation.stage)}>
              {negotiation.stage}
            </Badge>
            <h3>
              <ClubLink
                id={negotiation.selling_club_id}
                name={negotiation.seller_name ?? "No club"}
              />{" "}
              <ArrowUpRight size={15} />{" "}
              <ClubLink
                id={negotiation.buying_club_id}
                name={negotiation.buyer_name ?? "Buying club"}
              />
            </h3>
            <p>Deadline {dateLabel(negotiation.deadline)}</p>
          </div>
          <div className="negotiation-agent">
            <strong>{details.agent.name}</strong>
            <small>
              {details.agent.personality} / Difficulty{" "}
              {details.agent.difficulty}
            </small>
          </div>
        </div>
        <DealProgress
          stage={negotiation.stage}
          future={!!details.futureArrivalDate}
          preContract={preContract}
        />
        <RivalPanel
          rivals={negotiation.rivals}
          battle={negotiation.battle}
          stage={negotiation.stage}
        />
        {details.futureArrivalDate && (
          <div className="future-transfer-details">
            <DetailList
              items={[
                [
                  preContract ? "Joins on free transfer" : "Earliest arrival",
                  dateLabel(details.futureArrivalDate),
                ],
                [
                  "Transfer allocation reserved",
                  money(details.reservedBudget ?? 0),
                ],
                ...(details.affiliatePlacement
                  ? ([
                      [
                        "Affiliate placement",
                        `${details.affiliatePlacement.clubName} (${dateLabel(details.affiliatePlacement.date)})`,
                      ],
                    ] as [string, string][])
                  : []),
                ...(details.onwardLoan
                  ? ([
                      [
                        "On-arrival loan",
                        `${details.onwardLoan.clubName} / ${details.onwardLoan.until === "season" ? "season" : "one year"}`,
                      ],
                    ] as [string, string][])
                  : []),
                ["Contract starts", "On registration, not today"],
              ]}
            />
            <AffiliateControls
              negotiation={negotiation}
              details={details}
              onDone={onAction}
            />
          </div>
        )}
        {!details.futureArrivalDate && (
          <AffiliateControls
            negotiation={negotiation}
            details={details}
            onDone={onAction}
          />
        )}
        {(interestPreview ?? details.interestDetails) && (
          <InterestSummary
            assessment={(interestPreview ?? details.interestDetails)!}
          />
        )}
        {details.log.length > 0 && (
          <p
            className={`negotiation-latest${CLOSED_STAGES.includes(negotiation.stage) ? " is-rejected" : ""}`}
            role="status"
          >
            {text(details.log.at(-1)!.message)}
          </p>
        )}
        {details.preparedBy && (
          <div className="information-note section-space">
            <FileSignature size={16} />
            <span>
              Draft prepared by {details.preparedBy.name} on{" "}
              {dateLabel(details.preparedBy.date)}.
              {review ? " Your signature is still required." : ""}
            </span>
          </div>
        )}
        {negotiation.type === "Youth approach" && (
          <div className="information-note section-space">
            <FileSignature size={16} />
            <span>
              No club transfer fee. Modelled training compensation:{" "}
              {money(details.trainingCompensation ?? 0)}. Youth clearance and
              contract approval are separate requirements.
            </span>
          </div>
        )}
        <div className="tension-bar">
          <span>Negotiation tension</span>
          <Meter
            value={negotiation.tension}
            tone={negotiation.tension > 65 ? "red" : "amber"}
          />
          <strong>{Math.round(negotiation.tension)}%</strong>
        </div>
        <details className="negotiation-history">
          <summary>
            Negotiation history <span>{details.log.length}</span>
          </summary>
          <div className="negotiation-log">
            {details.log.map((entry, index) => (
              <div className="log-item" key={index}>
                <small>
                  {dateLabel(entry.date)} / {entry.type}
                </small>
                <p>{text(entry.message)}</p>
              </div>
            ))}
          </div>
        </details>
        {permanent && !contractPage && (active || incoming) && (
          <fieldset
            className="agreed-loan-terms"
            disabled={
              pending || (!incoming && negotiation.stage !== "Club talks")
            }
          >
            {incoming && (
              <Field label="Counteroffer fee">
                <MoneyInput min={0} value={fee} onChange={setFee} />
              </Field>
            )}
            <TransferTermsForm
              terms={transferTerms}
              setTerms={setTransferTerms}
              fee={fee}
              loanBack={negotiation.type === "Permanent transfer"}
            />
          </fieldset>
        )}
        {permanent && (
          <details className="transfer-payment-summary" open={!contractPage}>
            <summary>Club agreement</summary>
            <DetailList
              items={[
                ["Transfer fee committed", money(previewFee)],
                ["Fee at registration", money(cashFee)],
                ["Deferred transfer fee", money(previewFee - cashFee)],
                [
                  "Payment schedule",
                  shownTerms.installments
                    ? `${plural(shownTerms.installments, "instalment")} / every ${plural(shownTerms.intervalMonths, "month")}`
                    : "Paid at registration",
                ],
                [
                  "Selling club buy-back",
                  shownTerms.buyBackFee
                    ? `${money(shownTerms.buyBackFee)} / ${plural(shownTerms.buyBackYears, "year")}`
                    : "None",
                ],
                ["Next-sale percentage", `${shownTerms.sellOnPercent}%`],
                [
                  "Seller loan-back",
                  LOAN_BACK_LABELS[shownTerms.loanBack ?? "none"],
                ],
              ]}
            />
          </details>
        )}
        {incoming && (
          <details className="transfer-payment-summary" open>
            <summary>{loan ? "Loan offer" : "Transfer offer"}</summary>
            <DetailList
              items={[
                ...incomingOfferItems(negotiation, details, money),
                ...(details.counter !== undefined
                  ? ([[loan ? "Borrower's maximum fee" : "Buyer's maximum fee", money(details.counter)]] as [string, ReactNode][])
                  : []),
              ]}
            />
          </details>
        )}
        {loan && incoming && (
          <>
            <fieldset className="agreed-loan-terms" disabled={pending}>
              <Field label="Counteroffer loan fee">
                <MoneyInput min={0} value={fee} onChange={setFee} />
              </Field>
              <LoanTermsForm
                terms={terms}
                setTerms={setTerms}
                type={negotiation.type}
              />
            </fieldset>
          </>
        )}
        {active && (
          <>
            <div className="form-grid">
              {!contractPage && (
                <Field label={loan ? "Loan fee" : "Transfer fee"}>
                  <MoneyInput
                    aria-label="Proposed transfer fee"
                    min={0}
                    value={fee}
                    disabled={personalStage}
                    onChange={setFee}
                  />
                </Field>
              )}
              {contractPage && (
                <Field label="Weekly wage">
                  <MoneyInput
                    aria-label="Proposed weekly wage"
                    min={0}
                    value={wage}
                    disabled={!personalStage}
                    onChange={setWage}
                  />
                </Field>
              )}
              {contractPage && !loan && (
                <>
                  <Field label="Contract length">
                    <select
                      value={years}
                      disabled={!personalStage}
                      onChange={(event) => setYears(Number(event.target.value))}
                    >
                      {[1, 2, 3, 4, 5]
                        .filter(
                          (year) => (negotiation.age ?? 20) >= 18 || year <= 3,
                        )
                        .map((year) => (
                          <option key={year} value={year}>
                            {plural(year, "year")}
                          </option>
                        ))}
                    </select>
                  </Field>
                  <Field label="Squad role">
                    <select
                      value={role}
                      disabled={!personalStage}
                      onChange={(event) => setRole(event.target.value)}
                    >
                      {[
                        "Captain",
                        "Key player",
                        "Regular starter",
                        "Squad player",
                        "Fringe player",
                        "Prospect",
                      ].map((value) => (
                        <option key={value}>{value}</option>
                      ))}
                    </select>
                  </Field>
                  <Field label="Signing bonus">
                    <MoneyInput
                      min={0}
                      value={bonus}
                      disabled={!personalStage}
                      onChange={setBonus}
                    />
                  </Field>
                </>
              )}
            </div>
            {loan && !contractPage && (
              <fieldset className="agreed-loan-terms" disabled={personalStage}>
                <LoanTermsForm
                  terms={terms}
                  setTerms={setTerms}
                  type={negotiation.type}
                />
              </fieldset>
            )}
            {contractPage && (
              <>
                <div className="form-heading">Contract promises</div>
                <div className="promise-options">
                  {[
                    "First-team minutes",
                    "Captaincy",
                    "Youth pathway",
                    "European football",
                    "Facilities investment",
                  ].map((promise) => (
                    <label key={promise} className="checkbox-field">
                      <input
                        type="checkbox"
                        checked={promises.includes(promise)}
                        disabled={!personalStage}
                        onChange={(event) =>
                          setPromises(
                            event.target.checked
                              ? [...promises, promise]
                              : promises.filter((value) => value !== promise),
                          )
                        }
                      />
                      {promise}
                    </label>
                  ))}
                </div>
              </>
            )}
            <div className="negotiation-budget">
              {contractPage ? (
                <>
                  {details.requiredWage !== undefined && (
                    <span>
                      Agent wage request{" "}
                      <strong>{money(details.requiredWage)} / week</strong>
                    </span>
                  )}
                  <span>
                    Agreed fee <strong>{money(negotiation.offer)}</strong>
                  </span>
                </>
              ) : (
                <>
                  <span>
                    Asking price{" "}
                    <strong>{money(negotiation.asking_price)}</strong>
                  </span>
                  {negotiation.stage === "Club talks" &&
                    details.counter !== undefined && (
                      <span>
                        Club counter-offer{" "}
                        <strong>{money(details.counter)}</strong>
                      </span>
                    )}
                </>
              )}
              <span>
                Your available budget{" "}
                <strong>{money(bootstrap?.club.transfer_budget ?? 0)}</strong>
              </span>
            </div>
          </>
        )}
        {!active && contractPage && !incoming && (
          <DetailList
            items={[
              ["Fee", money(negotiation.offer)],
              ["Wage", `${money(negotiation.wage)} / week`],
              ["Status", negotiation.stage],
              ...(review ||
              ["Scheduled", "Medical", "Registration", "Completed"].includes(
                negotiation.stage,
              )
                ? [
                    ["Contract length", plural(details.years, "year")] as [
                      string,
                      string,
                    ],
                    ["Squad role", details.role] as [string, string],
                    ["Signing bonus", money(details.signingBonus ?? 0)] as [
                      string,
                      string,
                    ],
                    [
                      "Agent commission",
                      `${money(agentFee)} (${details.agent.commission}%)`,
                    ] as [string, string],
                    [
                      "Upfront commitment",
                      money(
                        cashFee +
                          agentFee +
                          (details.signingBonus ?? 0) +
                          (details.trainingCompensation ?? 0),
                      ),
                    ] as [string, string],
                    [
                      "Promises",
                      details.promises.length
                        ? details.promises.join(", ")
                        : "None",
                    ] as [string, string],
                  ]
                : []),
              ...(details.medicalDate
                ? [
                    ["Medical date", dateLabel(details.medicalDate)] as [
                      string,
                      string,
                    ],
                  ]
                : []),
            ]}
          />
        )}
        {review && loan && (
          <>
            <h3 className="form-heading">Agreed loan terms</h3>
            <DetailList
              items={[
                ["Playing time", `${details.terms.playingTime}%`],
                [
                  "Role / position",
                  `${details.terms.role} / ${details.terms.position}`,
                ],
                ["Borrowing wage share", `${details.terms.salarySplit}%`],
                ["Training plan", details.terms.developmentPlan],
                ["Mandatory minutes", details.terms.mandatoryMinutes],
                [
                  "Recall / injury recall",
                  `${details.terms.recall ? "Yes" : "No"} / ${details.terms.injuryRecall ? "Yes" : "No"}`,
                ],
              ]}
            />
          </>
        )}
        {enquiry && (
          <div className="information-note section-space">
            <MessageSquare size={16} />
            <span>
              {Math.round(negotiation.interest)}% player interest. Indicative
              club valuation: {money(negotiation.asking_price)}. Formal
              permission and terms have not yet been agreed.
            </span>
          </div>
        )}
        {buyerManaged &&
          ["Agent talks", "Contract review"].includes(negotiation.stage) && (
            <div className="information-note section-space">
              <Clock3 size={16} />
              <span>
                The buying club is{" "}
                {review
                  ? "reviewing and signing the player contract"
                  : "negotiating personal terms with the agent"}
                {details.nextStageDate
                  ? `. Next update: ${dateLabel(details.nextStageDate)}`
                  : ""}
                .
              </span>
            </div>
          )}
        {negotiation.stage === "Registration" && (
          <div className="information-note section-space">
            <Clock3 size={16} />
            <span>
              Medical passed. Contract documents, international clearance and
              funds are being finalized (work permission and competition
              registration are assessed after signing and never stop it)
              {details.registrationDate
                ? ` from ${dateLabel(details.registrationDate)}`
                : ""}
              .
            </span>
          </div>
        )}
      </div>
      <footer className="sheet-footer">
        {fullPage && !contractPage && playerPhase && (
          <Button
            icon={ArrowUpRight}
            onClick={() => openContract(negotiation.player_id)}
          >
            Continue to player contract
          </Button>
        )}
        {fullPage && contractPage && !playerPhase && (
          <Button
            variant="secondary"
            icon={ArrowLeft}
            onClick={() => openOffer(negotiation.player_id)}
          >
            Return to club offer
          </Button>
        )}
        <div className="footer-left">
          {details.futureArrivalDate &&
            ["Scheduled", "Medical", "Registration"].includes(
              negotiation.stage,
            ) && (
              <Button
                variant="ghost"
                icon={X}
                disabled={pending}
                onClick={() =>
                  confirm(
                    "Cancel future agreement?",
                    details.affiliatePlacement
                      ? `${money(details.reservedBudget ?? 0)} of remaining reserved allocation will be returned. The fee already paid to ${details.affiliatePlacement.originalSellerName} is not refunded, and the player stays registered with ${details.affiliatePlacement.clubName}.`
                      : `${money(details.reservedBudget ?? 0)} of reserved transfer allocation will be returned. No player registration or cash payment will change.`,
                    () => {
                      void act({
                        type: "negotiation",
                        id: negotiation.id,
                        action: "withdraw",
                      }).then((result) => {
                        if (result) close();
                      });
                    },
                  )
                }
              >
                Cancel future agreement
              </Button>
            )}
          {(active || enquiry || (review && !buyerManaged)) && (
            <>
              <Button
                variant="secondary"
                icon={Megaphone}
                disabled={!!negotiation.public || pending || review}
                onClick={() =>
                  void act({
                    type: "negotiation",
                    id: negotiation.id,
                    action: "declare",
                  })
                }
              >
                {negotiation.public ? "Interest public" : "Declare interest"}
              </Button>
              <Button
                variant="ghost"
                icon={X}
                onClick={() =>
                  confirm(
                    "Withdraw from talks?",
                    "The agent and selling club will be informed. No transfer fee has been committed.",
                    () => {
                      void act({
                        type: "negotiation",
                        id: negotiation.id,
                        action: "withdraw",
                      }).then((result) => {
                        if (result) close();
                      });
                    },
                  )
                }
              >
                Withdraw
              </Button>
            </>
          )}
        </div>
        {enquiry && (
          <Button
            icon={MessageSquare}
            disabled={pending}
            onClick={() => void step("formalize")}
          >
            Request formal talks
          </Button>
        )}
        {review && !buyerManaged && (
          <>
            <Button
              variant="secondary"
              icon={MessageSquare}
              disabled={pending}
              onClick={() => void step("revise")}
            >
              Revise personal terms
            </Button>
            <Button
              icon={FileSignature}
              disabled={pending}
              onClick={() => void step("sign")}
            >
              Sign conditional agreement
            </Button>
          </>
        )}
        {active && (
          <Button
            icon={FileSignature}
            disabled={pending}
            onClick={() => void submit()}
          >
            {negotiation.stage === "Club talks"
              ? "Submit club offer"
              : "Submit personal terms"}
          </Button>
        )}
        {incoming && (
          <>
            <Button
              variant="secondary"
              icon={X}
              onClick={() =>
                void act({
                  type: "negotiation",
                  id: negotiation.id,
                  action: "reject",
                }).then((result) => {
                  if (result) close();
                })
              }
            >
              Reject
            </Button>
            <Button
              icon={Check}
              disabled={
                pending ||
                (permanent &&
                  (Math.round(fee) !== Math.round(negotiation.offer) ||
                    JSON.stringify(transferTerms) !==
                      JSON.stringify({
                        ...DEFAULT_TRANSFER_TERMS,
                        ...details.transferTerms,
                      }))) ||
                (loan &&
                  (Math.round(fee) !== Math.round(negotiation.offer) ||
                    JSON.stringify(terms) !==
                      JSON.stringify(withLoanLimits(details.terms))))
              }
              onClick={() =>
                void act({
                  type: "negotiation",
                  id: negotiation.id,
                  action: "accept",
                }).then((result) => {
                  if (result) close();
                })
              }
            >
              Accept offer
            </Button>
            {(permanent || loan) && (
              <Button
                icon={MessageSquare}
                variant="secondary"
                disabled={pending}
                onClick={() => void counterOffer()}
              >
                Submit counteroffer
              </Button>
            )}
          </>
        )}
        {!active && !incoming && (!review || buyerManaged) && !enquiry && (
          <Button variant="secondary" onClick={close}>
            Close
          </Button>
        )}
      </footer>
    </>
  );
  return fullPage ? (
    <section
      className="offer-negotiation"
      aria-label={
        contractPage ? "Player contract negotiation" : "Offer negotiation"
      }
    >
      {content}
    </section>
  ) : (
    <Modal
      title={`${negotiation.player_name} / ${negotiation.type}`}
      onClose={close}
      wide={loan}
    >
      {content}
    </Modal>
  );
}

export default function Transfers() {
  const { bootstrap, navigate, act, confirm, openOffer, openContract } =
    useGame();
  const { money } = useCurrency();
  const { data, error } = useResource<TransferDesk>("transfers");
  const [tab, setTab] = useState("active");
  const [selected, setSelected] = useState<number | null>(null);
  const buyBacks = useSortableRows(data?.buyBackClauses ?? [], BUY_BACK_COLUMNS, {
    initial: { key: "expires", direction: "asc" },
    tieBreakers: ID_TIE_BREAKER,
  });
  const sellOns = useSortableRows(data?.sellOnClauses ?? [], SELL_ON_COLUMNS, {
    tieBreakers: ID_TIE_BREAKER,
  });
  const market = useSortableRows(
    (data?.market ?? []).map((event) => ({ ...event, move: JSON.parse(event.data) })),
    MARKET_COLUMNS,
    { initial: { key: "date", direction: "desc" }, tieBreakers: ID_TIE_BREAKER },
  );
  if (error) return <ErrorState message={error} />;
  if (!data || !bootstrap) return <Loading />;
  const activeStages = ACTIVE_TRANSFER_STAGES;
  // Offers clubs made for the director's players have their own inbox; Negotiations holds deals in progress.
  const received = data.negotiations.filter(
    (item) => item.stage === "Offer received" && item.selling_club_id === bootstrap.club.id,
  );
  const active = data.negotiations.filter(
    (item) => activeStages.includes(item.stage) && !received.includes(item),
  );
  const completed = data.negotiations.filter(
    (item) => item.stage === "Completed",
  );
  const current = data.negotiations.find((item) => item.id === selected);
  const futureDeals = data.negotiations.filter(
    (item) =>
      ACTIVE_TRANSFER_STAGES.includes(item.stage) &&
      !!(JSON.parse(item.data) as NegotiationData).futureArrivalDate,
  );
  const displayed =
    tab === "future"
      ? futureDeals
      : tab === "history"
        ? data.negotiations.filter((item) => !activeStages.includes(item.stage))
        : active;
  return (
    <div className="page">
      <PageHeading
        eyebrow="THE TRANSFER DESK"
        title="Make your move"
        subtitle={`${dateLabel(bootstrap.state.date)} / ${transferWindow(bootstrap.state.date) ? "Registration window open" : "Deals await the next registration window"}`}
      >
        <Button
          icon={Search}
          variant="secondary"
          onClick={() => navigate("database")}
        >
          Find a target
        </Button>
      </PageHeading>
      <div className="stat-strip">
        <Stat
          label="Available budget"
          value={money(bootstrap.club.transfer_budget)}
          icon={ArrowLeftRight}
          detail="Before contingent commitments"
        />
        <Stat
          label="Active negotiations"
          value={active.length}
          icon={MessageSquare}
          detail="Club, agent or medical stage"
        />
        <Stat
          label="Deals completed"
          value={completed.length}
          icon={Handshake}
          detail="Registered agreements"
        />
        <Stat
          label="Season investment"
          value={money(bootstrap.club.season_spend)}
          icon={FileSignature}
          detail="Transfers and signing costs"
        />
      </div>
      <Panel>
        <Tabs
          items={[
            { id: "active", label: "Negotiations", count: active.length },
            { id: "offers", label: "Offers received", count: received.length },
            {
              id: "targets",
              label: "Priority targets",
              count: data.targets.length,
            },
            { id: "history", label: "Deal history" },
            {
              id: "future",
              label: "Future arrivals",
              count: futureDeals.length,
            },
            {
              id: "clauses",
              label: "Clauses & payments",
              count: data.buyBackClauses.length + data.sellOnClauses.length,
            },
            { id: "market", label: "World market" },
          ]}
          value={tab}
          onChange={setTab}
        />
        {(tab === "active" || tab === "history" || tab === "future") &&
          (displayed.length ? (
            <div className="padded">
              <div className="cards-list">
                {displayed.map((negotiation) => {
                  const details = JSON.parse(
                    negotiation.data,
                  ) as NegotiationData;
                  const stages = details.futureArrivalDate
                    ? [
                        ...TRANSFER_STAGES.slice(0, 4),
                        "Scheduled",
                        ...TRANSFER_STAGES.slice(4),
                      ]
                    : TRANSFER_STAGES;
                  const stageIndex = stages.indexOf(negotiation.stage);
                  const rivalCount = (negotiation.rivals ?? []).filter(
                    (rival) => RIVAL_ACTIVE.includes(rival.status),
                  ).length;
                  return (
                    <article className="entity-card" key={negotiation.id}>
                      <div className="entity-card-top">
                        <Badge tone={stageTone(negotiation.stage, "blue")}>
                          {negotiation.stage}
                        </Badge>
                        <Rating value={negotiation.ability ?? 0} />
                      </div>
                      <h3>
                        <PlayerLink
                          id={negotiation.player_id}
                          name={negotiation.player_name ?? "Player"}
                        />
                      </h3>
                      <p>
                        {negotiation.position} / {negotiation.age} yrs /{" "}
                        {negotiation.type}
                      </p>
                      <div className="negotiation-progress">
                        {stages.map((name, step) => (
                          <span
                            className={step <= stageIndex ? "done" : ""}
                            key={name}
                            title={name}
                          />
                        ))}
                      </div>
                      <DetailList
                        items={[
                          [
                            "Club",
                            <ClubLink
                              key="deal-club"
                              id={
                                negotiation.buying_club_id === bootstrap.club.id
                                  ? negotiation.selling_club_id
                                  : negotiation.buying_club_id
                              }
                              name={
                                negotiation.buying_club_id === bootstrap.club.id
                                  ? (negotiation.seller_name ?? "No club")
                                  : (negotiation.buyer_name ?? "Club")
                              }
                            />,
                          ],
                          ["Asking price", money(negotiation.asking_price)],
                          ["Your offer", money(negotiation.offer)],
                          ["Interest", `${Math.round(negotiation.interest)}%`],
                          ...(rivalCount ||
                          negotiation.battle?.status === "final-offers" ||
                          negotiation.battle?.status === "decision"
                            ? ([
                                [
                                  "Rival interest",
                                  negotiation.battle?.status === "final-offers"
                                    ? "Best and final offers"
                                    : negotiation.battle?.status === "decision"
                                      ? "Player deciding"
                                      : `${rivalCount} rival club${rivalCount === 1 ? "" : "s"}`,
                                ],
                              ] as [string, string][])
                            : []),
                          ...(details.futureArrivalDate
                            ? ([
                                [
                                  "Arrival",
                                  dateLabel(details.futureArrivalDate),
                                ],
                                [
                                  "Reserved allocation",
                                  money(details.reservedBudget ?? 0),
                                ],
                                ...(details.affiliatePlacement
                                  ? ([
                                      [
                                        "Affiliate",
                                        details.affiliatePlacement.clubName,
                                      ],
                                    ] as [string, string][])
                                  : []),
                                ...(details.onwardLoan
                                  ? ([
                                      [
                                        "Arrival loan",
                                        details.onwardLoan.clubName,
                                      ],
                                    ] as [string, string][])
                                  : []),
                              ] as [string, string][])
                            : []),
                        ]}
                      />
                      {tab === "future" && (
                        <AffiliateControls
                          negotiation={negotiation}
                          details={details}
                          compact
                          onDone={() => setSelected(negotiation.id)}
                        />
                      )}
                      <div className="tension-bar">
                        <span>Tension</span>
                        <Meter
                          value={negotiation.tension}
                          tone={negotiation.tension > 65 ? "red" : "amber"}
                        />
                        <strong>{Math.round(negotiation.tension)}</strong>
                      </div>
                      <div className="inline-controls">
                        <Button
                          icon={MessageSquare}
                          variant="secondary"
                          onClick={() => {
                            if (!activeStages.includes(negotiation.stage))
                              setSelected(negotiation.id);
                            else if (
                              [
                                "Agent talks",
                                "Contract review",
                                "Scheduled",
                                "Medical",
                                "Registration",
                              ].includes(negotiation.stage)
                            )
                              openContract(negotiation.player_id);
                            else openOffer(negotiation.player_id);
                          }}
                        >
                          {activeStages.includes(negotiation.stage)
                            ? "Open negotiations"
                            : "View agreement"}
                        </Button>
                      </div>
                    </article>
                  );
                })}
              </div>
            </div>
          ) : (
            <Empty
              icon={Handshake}
              title={
                tab === "active"
                  ? "No negotiations in progress"
                  : "The story is still to be written"
              }
              detail={
                tab === "active"
                  ? "Your shortlisted players are ready for a closer look."
                  : "Completed and closed negotiations will be recorded here."
              }
            >
              <Button
                variant="secondary"
                icon={ArrowUpRight}
                onClick={() => setTab("targets")}
              >
                View priority targets
              </Button>
            </Empty>
          ))}
        {tab === "offers" && (
          <IncomingOffers
            offers={received}
            onOpen={(negotiation) => setSelected(negotiation.id)}
            emptyTitle="No offers on the table"
            emptyDetail="Clubs that need your listed, surplus or loan-available players make offers during the registration windows. Offer frequency is set in Settings."
          />
        )}
        {tab === "clauses" && (
          <>
            <SectionHeading title="Outstanding transfer payments" />
            <TransferPaymentTable
              payments={data.payments}
              clubId={bootstrap.club.id}
            />
            <SectionHeading title="Buy-back clauses" />
            {data.buyBackClauses.length ? (
              <div className="table-scroll" role="region" aria-label="Buy-back clauses" tabIndex={0}>
                <table className="data-table">
                  <thead>
                    <tr>
                      <SortHeader {...buyBacks.header("player")} label="Player" />
                      <SortHeader {...buyBacks.header("owner")} label="Current owner" />
                      <SortHeader {...buyBacks.header("holder")} label="Right held by" />
                      <SortHeader {...buyBacks.header("fee")} label="Fixed fee" />
                      <SortHeader {...buyBacks.header("expires")} label="Expires" />
                      <th>Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {buyBacks.rows.map((clause) => (
                      <tr key={clause.id}>
                        <td>
                          <PlayerLink
                            id={clause.player_id}
                            name={clause.player_name ?? "Player"}
                          />
                        </td>
                        <td>
                          <ClubLink
                            id={clause.owner_id}
                            name={clause.owner_name ?? "Club"}
                          />
                        </td>
                        <td>
                          <ClubLink
                            id={clause.beneficiary_id}
                            name={clause.beneficiary_name ?? "Club"}
                          />
                        </td>
                        <td>{money(clause.fee)}</td>
                        <td>{dateLabel(clause.expires)}</td>
                        <td>
                          {clause.beneficiary_id === bootstrap.club.id ? (
                            <Button
                              icon={ArrowLeftRight}
                              variant="secondary"
                              disabled={!transferWindow(bootstrap.state.date)}
                              onClick={() =>
                                confirm(
                                  "Exercise buy-back clause?",
                                  `Open personal talks at the fixed fee of ${money(clause.fee)}. No payment is made until registration.`,
                                  () => {
                                    void act({
                                      type: "buy-back",
                                      id: clause.id,
                                    }).then((result) => {
                                      if (result?.id) {
                                        openContract(clause.player_id);
                                      }
                                    });
                                  },
                                )
                              }
                            >
                              Exercise buy-back
                            </Button>
                          ) : (
                            <Badge>Other club's right</Badge>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <Empty icon={FileSignature} title="No active buy-back clauses" />
            )}
            <SectionHeading title="Sell-on clauses" />
            {data.sellOnClauses.length ? (
              <div className="table-scroll" role="region" aria-label="Sell-on clauses" tabIndex={0}>
                <table className="data-table">
                  <thead>
                    <tr>
                      <SortHeader {...sellOns.header("player")} label="Player" />
                      <SortHeader {...sellOns.header("owner")} label="Club owing" />
                      <SortHeader {...sellOns.header("beneficiary")} label="Beneficiary" />
                      <SortHeader {...sellOns.header("percentage")} label="Next sale" />
                      <SortHeader {...sellOns.header("paid")} label="Paid" />
                      <SortHeader {...sellOns.header("status")} label="Status" />
                    </tr>
                  </thead>
                  <tbody>
                    {sellOns.rows.map((clause) => (
                      <tr key={clause.id}>
                        <td>
                          <PlayerLink
                            id={clause.player_id}
                            name={clause.player_name}
                          />
                        </td>
                        <td>
                          <ClubLink
                            id={clause.owner_id}
                            name={clause.owner_name}
                          />
                        </td>
                        <td>
                          <ClubLink
                            id={clause.beneficiary_id}
                            name={clause.beneficiary_name}
                          />
                        </td>
                        <td>{clause.percentage}%</td>
                        <td>{money(clause.paid)}</td>
                        <td>
                          <Badge>
                            {clause.status === "triggered"
                              ? "Awaiting payments"
                              : "Active"}
                          </Badge>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <Empty icon={FileSignature} title="No active sell-on clauses" />
            )}
          </>
        )}
        {tab === "targets" && (
          <>
            <SectionHeading title="Your recruitment shortlist">
              <TextLink onClick={() => navigate("scouting")}>
                Scouting centre
              </TextLink>
            </SectionHeading>
            <PlayerTable players={data.targets}>
              {(player) => (
                <Button
                  icon={MessageSquare}
                  variant="secondary"
                  onClick={() => openOffer(player.id)}
                >
                  Make an offer
                </Button>
              )}
            </PlayerTable>
          </>
        )}
        {tab === "market" &&
          (data.market.length ? (
            <div className="table-scroll" role="region" aria-label="World transfer market" tabIndex={0}>
              <table className="data-table">
                <thead>
                  <tr>
                    <SortHeader {...market.header("player")} label="Player" />
                    <SortHeader {...market.header("destination")} label="Destination" />
                    <SortHeader {...market.header("fee")} label="Fee" />
                    <SortHeader {...market.header("date")} label="Completed" />
                  </tr>
                </thead>
                <tbody>
                  {market.rows.map((event) => {
                    const move = event.move;
                    return (
                      <tr key={event.id}>
                        <td>
                          <strong>
                            <PlayerLink
                              id={event.entity_id ?? move.playerId}
                              name={move.name}
                            />
                          </strong>
                        </td>
                        <td>
                          <ClubLink id={move.to} name={move.club} />
                        </td>
                        <td className="money">{money(move.fee)}</td>
                        <td>{dateLabel(event.date)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ) : (
            <Empty
              icon={Clock3}
              title="The window is just opening"
              detail="Completed transfers around the world will appear as the calendar advances."
            />
          ))}
      </Panel>
      {current && (
        <NegotiationSheet
          key={current.id}
          negotiation={current}
          close={() => setSelected(null)}
        />
      )}
    </div>
  );
}
