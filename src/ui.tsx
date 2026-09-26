import {
  useEffect,
  useEffectEvent,
  useId,
  useRef,
  useState,
  type ButtonHTMLAttributes,
  type CSSProperties,
  type InputHTMLAttributes,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import {
  ArrowDown,
  ArrowDownWideNarrow,
  ArrowUp,
  ArrowUpDown,
  ArrowUpNarrowWide,
  ArrowUpRight,
  Bookmark,
  Check,
  ChevronLeft,
  ChevronRight,
  Inbox,
  LoaderCircle,
  X,
  type LucideIcon,
} from "lucide-react";
import clsx from "clsx";
import { useCurrency, useGame } from "./game-context.tsx";
import { addDays, compactNumber, dateLabel } from "../shared/rules.ts";
import type { Fixture, Player, Standing } from "../shared/types.ts";
import {
  ariaSort,
  PLAYER_COLUMNS,
  PLAYER_TIE_BREAKERS,
  type PlayerSortKey,
  type SortDirection,
  type SortState,
} from "./sort.ts";
import { useSortableRows } from "./useSortableRows.ts";
import {
  bodyLabel,
  bodyOf,
  clubLabel,
  flagEmoji,
  nationalitiesOf,
  type ListedPlayer,
} from "./players.ts";

export function MoneyInput({
  value,
  onChange,
  min,
  max,
  ...props
}: Omit<
  InputHTMLAttributes<HTMLInputElement>,
  "value" | "onChange" | "min" | "max"
> & {
  value: number;
  onChange: (value: number) => void;
  min?: number;
  max?: number;
}) {
  const { currency, displayAmount, accountingAmount, money } = useCurrency();
  const [draft, setDraft] = useState<{
    base: number;
    currency: string;
    text: string;
  } | null>(null);
  const currentDraft =
    draft?.base === value && draft.currency === currency ? draft.text : null;
  return (
    <span className="money-input" title={money(value, true)}>
      <input
        {...props}
        type="number"
        step={props.step ?? "any"}
        value={currentDraft ?? displayAmount(value)}
        min={min === undefined ? undefined : displayAmount(min)}
        max={max === undefined ? undefined : displayAmount(max)}
        onChange={(event) => {
          const text = event.target.value;
          const amount = text === "" ? value : accountingAmount(Number(text));
          setDraft({ base: amount, currency, text });
          if (text !== "" && Number.isFinite(amount)) onChange(amount);
        }}
        onBlur={(event) => {
          if (currentDraft === "") onChange(0);
          setDraft(null);
          props.onBlur?.(event);
        }}
      />
      <span aria-hidden="true">{currency}</span>
    </span>
  );
}

export function IconButton({
  icon: Icon,
  label,
  className,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  icon: LucideIcon;
  label: string;
}) {
  return (
    <button
      {...props}
      type={props.type ?? "button"}
      title={label}
      aria-label={label}
      className={clsx("icon-button", className)}
    >
      <Icon size={18} strokeWidth={1.7} />
    </button>
  );
}
export function Button({
  icon: Icon,
  children,
  variant = "primary",
  className,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  icon?: LucideIcon;
  variant?: "primary" | "secondary" | "ghost" | "danger";
  children: ReactNode;
}) {
  return (
    <button
      {...props}
      type={props.type ?? "button"}
      className={clsx("button", `button-${variant}`, className)}
    >
      {Icon && <Icon size={16} strokeWidth={1.8} />}
      {children}
    </button>
  );
}
export function Badge({
  children,
  tone = "neutral",
  dot = false,
}: {
  children: ReactNode;
  tone?: string;
  dot?: boolean;
}) {
  return (
    <span className={`badge badge-${tone}`}>
      {dot && <span className="status-dot" />}
      {children}
    </span>
  );
}
export function PageHeading({
  eyebrow,
  title,
  subtitle,
  children,
}: {
  eyebrow?: string;
  title: string;
  subtitle?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <header className="page-heading">
      <div>
        {eyebrow && <div className="eyebrow">{eyebrow}</div>}
        <h1>{title}</h1>
        {subtitle && <p className="page-subtitle">{subtitle}</p>}
      </div>
      {children && <div className="heading-actions">{children}</div>}
    </header>
  );
}
export function SectionHeading({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle?: string;
  children?: ReactNode;
}) {
  return (
    <div className="section-heading">
      <div>
        <h2>{title}</h2>
        {subtitle && <p>{subtitle}</p>}
      </div>
      {children}
    </div>
  );
}
export function Panel({
  children,
  className = "",
}: {
  children: ReactNode;
  className?: string;
}) {
  return <section className={`panel ${className}`}>{children}</section>;
}
export function Loading({
  label = "Opening your workspace",
}: {
  label?: string;
}) {
  return (
    <div className="loading-state" role="status">
      <LoaderCircle className="spin" size={22} />
      <span>{label}</span>
    </div>
  );
}
export function ErrorState({ message }: { message: string }) {
  return (
    <div className="error-state" role="alert">
      {message}
    </div>
  );
}
export function Empty({
  icon: Icon = Inbox,
  title,
  detail,
  children,
}: {
  icon?: LucideIcon;
  title: string;
  detail?: string;
  children?: ReactNode;
}) {
  return (
    <div className="empty-state">
      <span className="empty-icon">
        <Icon size={26} strokeWidth={1.4} />
      </span>
      <h3>{title}</h3>
      {detail && <p>{detail}</p>}
      {children}
    </div>
  );
}
export function Meter({
  value,
  max = 100,
  tone = "green",
  label,
}: {
  value: number;
  max?: number;
  tone?: string;
  label?: string;
}) {
  return (
    <div
      className={`meter meter-${tone}`}
      role="meter"
      aria-label={label ?? "Rating"}
      aria-valuenow={Math.round(value)}
      aria-valuemin={0}
      aria-valuemax={max}
    >
      <span
        style={{ width: `${Math.max(0, Math.min(100, (value / max) * 100))}%` }}
      />
    </div>
  );
}
export function Rating({
  value,
  potential = false,
}: {
  value: number;
  potential?: boolean;
}) {
  return (
    <span
      className={clsx(
        "rating",
        potential && "rating-potential",
        !potential &&
          (value >= 80
            ? "rating-high"
            : value >= 65
              ? "rating-good"
              : value >= 45
                ? "rating-mid"
                : "rating-low"),
      )}
    >
      {Math.round(value)}
    </span>
  );
}
export function Trend({ value, label }: { value: number; label?: string }) {
  const Icon = value >= 0 ? ArrowUp : ArrowDown;
  return (
    <span className={clsx("trend", value >= 0 ? "positive" : "negative")}>
      <Icon size={12} />
      {label ?? `${Math.abs(value).toFixed(1)}%`}
    </span>
  );
}
export function Stat({
  label,
  value,
  detail,
  icon: Icon,
  tone = "green",
}: {
  label: string;
  value: ReactNode;
  detail?: ReactNode;
  icon?: LucideIcon;
  tone?: string;
}) {
  return (
    <div className={`stat stat-${tone}`}>
      <div className="stat-label">
        {label}
        {Icon && <Icon size={17} strokeWidth={1.5} />}
      </div>
      <div
        className="stat-value"
        title={typeof value === "number" ? String(value) : undefined}
      >
        {typeof value === "number" && Math.abs(value) >= 1000
          ? compactNumber(value)
          : value}
      </div>
      {detail && <div className="stat-detail">{detail}</div>}
    </div>
  );
}

export function Crest({
  name,
  color = "#087f6d",
  size = 36,
}: {
  name: string;
  color?: string;
  size?: number;
}) {
  const initials =
    name
      .split(" ")
      .filter((word) => !["FC", "SC", "B"].includes(word))
      .slice(0, 2)
      .map((word) => word[0])
      .join("") || "FC";
  return (
    <svg
      width={size}
      height={size * 1.1}
      viewBox="0 0 50 55"
      className="crest"
      role="img"
      aria-label={`${name} crest`}
    >
      <path d="M4 4H46V28C46 40 35 48 25 52C15 48 4 40 4 28Z" fill={color} />
      <path
        d="M9 9H41V28C41 37 33 44 25 47C17 44 9 37 9 28Z"
        fill="none"
        stroke="white"
        strokeOpacity=".65"
        strokeWidth="1"
      />
      <path d="M4 19H46V23H4Z" fill="white" opacity=".14" />
      <text
        x="25"
        y="33"
        textAnchor="middle"
        fill="white"
        fontFamily="Manrope Variable, sans-serif"
        fontSize="17"
        fontWeight="800"
      >
        {initials}
      </text>
      <path d="M21 40H29" stroke="white" strokeOpacity=".7" strokeWidth="1.5" />
    </svg>
  );
}

export function Silhouette({
  color = "#087f6d",
  size = 44,
  hologram = false,
}: {
  color?: string;
  size?: number;
  hologram?: boolean;
}) {
  const id = useId();
  return (
    <span
      className={clsx("silhouette", hologram && "silhouette-hologram")}
      style={
        {
          "--player-color": color,
          width: size,
          height: size * 1.12,
        } as CSSProperties
      }
    >
      <svg
        viewBox="0 0 80 90"
        width="100%"
        height="100%"
        aria-label="Faceless player silhouette"
        role="img"
      >
        <defs>
          <linearGradient id={id} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor={color} stopOpacity=".16" />
            <stop offset="1" stopColor={color} stopOpacity=".02" />
          </linearGradient>
        </defs>
        <path
          d="M29 42L29 36C24 32 23 25 24 18C25 9 31 5 40 5C49 5 55 9 56 18C57 25 56 32 51 36L51 42L66 48C72 51 75 57 77 66L79 87H1L3 66C5 57 8 51 14 48Z"
          fill={`url(#${id})`}
          stroke={color}
          strokeWidth="1.2"
          strokeOpacity=".85"
        />
        <path
          d="M29 42Q40 52 51 42M14 49L22 68V88M66 49L58 68V88M26 61H54M31 67H49"
          fill="none"
          stroke={color}
          strokeWidth=".8"
          strokeOpacity=".4"
        />
        {hologram && (
          <g stroke={color} opacity=".18" strokeWidth=".4">
            {Array.from({ length: 17 }, (_, index) => (
              <path key={index} d={`M0 ${index * 5 + 2}H80`} />
            ))}
          </g>
        )}
      </svg>
    </span>
  );
}

export function PlayerName({
  player,
  compact = false,
  showClub = false,
  detail,
}: {
  player: Player;
  compact?: boolean;
  showClub?: boolean;
  detail?: ReactNode;
}) {
  const { setPlayer } = useGame();
  return (
    <button type="button" className="player-name" onClick={() => setPlayer(player.id)}>
      <Silhouette
        size={compact ? 30 : 38}
        color={player.club_color ?? "#087f6d"}
      />
      <span>
        <strong>{player.name}</strong>
        <small>
          {detail ??
            (showClub
              ? clubLabel(player)
              : `${player.nationality} / ${player.age}`)}
        </small>
      </span>
    </button>
  );
}

export function Nationalities({ player }: { player: Player }) {
  const { bootstrap } = useGame();
  const [primary, ...others] = nationalitiesOf(player, bootstrap?.countries ?? []);
  const primaryFlag = flagEmoji(primary.code);
  return (
    <span className="nationality-cell">
      <span className={clsx("flag", !primaryFlag && "flag-code")} aria-hidden="true">
        {primaryFlag ?? primary.code ?? "-"}
      </span>
      <span className="nationality-name">{primary.name}</span>
      {others.length > 0 && (
        <span
          className="dual-nationality"
          title={`Also holds: ${others.map((entry) => entry.name).join(", ")}`}
        >
          {others.map((entry) => (
            <span key={entry.name} aria-hidden="true">
              {flagEmoji(entry.code) ?? entry.code ?? entry.name.slice(0, 3)}
            </span>
          ))}
          <span className="sr-only">
            Also holds {others.map((entry) => entry.name).join(", ")}
          </span>
        </span>
      )}
    </span>
  );
}

export function PlayerLink({ id, name }: { id: number; name: string }) {
  const { setPlayer } = useGame();
  return (
    <button
      type="button"
      className="profile-link"
      title={`View ${name}'s profile`}
      onClick={() => setPlayer(id)}
    >
      {name}
    </button>
  );
}

export function ClubLink({
  id,
  name,
  color,
  crest = false,
}: {
  id: number | null | undefined;
  name: string;
  color?: string;
  crest?: boolean;
}) {
  const { setClub } = useGame();
  if (!id) return <span>{name}</span>;
  return (
    <button
      type="button"
      className={`profile-link${crest ? " team-link" : ""}`}
      title={`View ${name}'s profile`}
      onClick={() => setClub(id)}
    >
      {crest && <Crest name={name} color={color} size={22} />}
      <span>{name}</span>
    </button>
  );
}

export function ShortlistButton({ player }: { player: Player }) {
  const { act } = useGame();
  return (
    <IconButton
      icon={Bookmark}
      label={player.shortlisted ? "Remove from shortlist" : "Add to shortlist"}
      aria-pressed={!!player.shortlisted}
      className={player.shortlisted ? "bookmarked" : ""}
      onClick={() =>
        void act({
          type: "shortlist",
          playerId: player.id,
          active: !player.shortlisted,
        })
      }
    />
  );
}

export function SortHeader<Key extends string>({
  column,
  label,
  sort,
  onSort,
  title,
  className,
  leading,
}: {
  column: Key;
  label: string;
  sort: SortState<Key> | null;
  onSort: (key: Key) => void;
  title?: string;
  className?: string;
  /** Control rendered before the sort button, e.g. a select-all checkbox. */
  leading?: ReactNode;
}) {
  const state = ariaSort(sort, column);
  const Icon =
    state === "ascending" ? ArrowUp : state === "descending" ? ArrowDown : ArrowUpDown;
  const button = (
    <button
      type="button"
      className="sort-button"
      title={`${title ?? label}. Click to ${state ? "reverse the order" : "sort"}.`}
      onClick={() => onSort(column)}
    >
      <span>{label}</span>
      <Icon className="sort-icon" size={12} strokeWidth={2} aria-hidden="true" />
    </button>
  );
  return (
    <th scope="col" className={clsx("sortable", state && "sorted", className)} aria-sort={state}>
      {leading ? (
        <div className="sort-header-leading">
          {leading}
          {button}
        </div>
      ) : (
        button
      )}
    </th>
  );
}

export function SortDirectionButton({
  direction,
  subject,
  onToggle,
  disabled = false,
}: {
  direction: SortDirection | undefined;
  subject: string;
  onToggle: () => void;
  disabled?: boolean;
}) {
  return (
    <IconButton
      icon={direction === "asc" ? ArrowUpNarrowWide : ArrowDownWideNarrow}
      label={`Sort ${subject} ${direction === "asc" ? "descending" : "ascending"}`}
      className="bordered sort-direction"
      disabled={disabled || !direction}
      onClick={onToggle}
    />
  );
}

export type PlayerTableColumn =
  | "position"
  | "age"
  | "nationality"
  | "ability"
  | "potential"
  | "club"
  | "value"
  | "wage"
  | "contract"
  | "height"
  | "form";

const PLAYER_TABLE_HEADERS: Record<
  PlayerTableColumn,
  { label: string; title?: string; className?: string }
> = {
  position: { label: "Pos", title: "Position" },
  age: { label: "Age" },
  nationality: { label: "Nationality", title: "Sporting nationality and other passports" },
  ability: { label: "Ability", title: "Current ability" },
  potential: { label: "Potential", title: "Current dynamic potential" },
  club: { label: "Club" },
  value: { label: "Value", className: "number" },
  wage: { label: "Wage / wk", className: "number" },
  contract: { label: "Contract", title: "Contract end" },
  height: { label: "Height", title: "Current height and weight" },
  form: { label: "Form", title: "Average match rating" },
};

export function ContractCell({ player, date }: { player: Player; date?: string }) {
  if (!player.club_id) return <span className="muted">No contract</span>;
  return (
    <span className="contract-cell">
      {dateLabel(player.contract_end)}
      {date && player.contract_end <= date && <small>Expiring</small>}
    </span>
  );
}

export function BodyCell({ player }: { player: ListedPlayer }) {
  const body = bodyOf(player);
  if (body.height === null) return <span className="muted">-</span>;
  return (
    <span className="body-cell">
      {bodyLabel(body)}
      {body.growing && <small>Still growing</small>}
    </span>
  );
}

export function PlayerTable({
  players,
  compact = false,
  wages = false,
  columns,
  children,
  label = "Player results",
  initialSort = null,
  sort,
  onSortChange,
}: {
  players: Player[];
  compact?: boolean;
  wages?: boolean;
  /** Columns after the player name, in order; overrides `compact` and `wages`. */
  columns?: readonly PlayerTableColumn[];
  children?: (player: Player) => ReactNode;
  label?: string;
  initialSort?: SortState<PlayerSortKey> | null;
  /** Server-side sort: rows are shown in the given order and header clicks call onSortChange. */
  sort?: SortState<PlayerSortKey> | null;
  onSortChange?: (sort: SortState<PlayerSortKey>) => void;
}) {
  const { money } = useCurrency();
  const { bootstrap } = useGame();
  const visible =
    columns ??
    ([
      "position",
      "age",
      "ability",
      "potential",
      ...(compact ? [] : ["club"]),
      "value",
      ...(wages ? ["wage"] : []),
      ...(compact ? [] : ["form"]),
    ] as PlayerTableColumn[]);
  const sorting = useSortableRows(
    players,
    [PLAYER_COLUMNS.name, ...visible.map((key) => PLAYER_COLUMNS[key])],
    {
      initial: initialSort,
      sort,
      presorted: sort !== undefined,
      onSortChange,
      tieBreakers: PLAYER_TIE_BREAKERS,
    },
  );
  const expiry = bootstrap ? addDays(bootstrap.state.date, 365) : undefined;
  function cell(player: Player, key: PlayerTableColumn) {
    switch (key) {
      case "position":
        return <span className="position-tag">{player.position}</span>;
      case "age":
        return player.age;
      case "nationality":
        return <Nationalities player={player} />;
      case "ability":
        return <Rating value={player.ability} />;
      case "potential":
        return <Rating value={player.potential} potential />;
      case "club":
        return (
          <>
            <span className="club-dot" style={{ background: player.club_color }} />
            <ClubLink id={player.club_id} name={clubLabel(player)} />
          </>
        );
      case "value":
        return money(player.value);
      case "wage":
        return money(player.wage);
      case "contract":
        return <ContractCell player={player} date={expiry} />;
      case "height":
        return <BodyCell player={player} />;
      case "form":
        return (
          <span className={player.form >= 7 ? "positive" : "muted"}>
            {player.form.toFixed(1)}
          </span>
        );
    }
  }
  const cellClass: Partial<Record<PlayerTableColumn, string>> = {
    club: "club-cell",
    value: "number money",
    wage: "number muted",
  };
  return (
    <div className="table-scroll" data-no-swipe role="region" aria-label={label} tabIndex={0}>
      <table className="data-table player-table">
      <caption className="sr-only">{label}</caption>
        <thead>
          <tr>
            <SortHeader {...sorting.header("name")} label="Player" />
            {visible.map((key) => (
              <SortHeader
                key={key}
                {...sorting.header(key)}
                {...PLAYER_TABLE_HEADERS[key]}
              />
            ))}
            <th>
              <span className="sr-only">Actions</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {sorting.rows.map((player) => (
            <tr key={player.id}>
              <td>
                <PlayerName player={player} compact />
              </td>
              {visible.map((key) => (
                <td key={key} className={cellClass[key]}>
                  {cell(player, key)}
                </td>
              ))}
              <td>
                {children?.(player) ?? <ShortlistButton player={player} />}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {!players.length && (
        <Empty
          title="No players found"
          detail="No players match the current selection."
        />
      )}
    </div>
  );
}

export function FormDots({ form }: { form: string }) {
  return (
    <span className="form-dots">
      {(form || "-----")
        .padStart(5, "-")
        .split("")
        .map((result, index) => (
          <span
            className={`form-${result}`}
            key={index}
            title={
              result === "W"
                ? "Win"
                : result === "L"
                  ? "Loss"
                  : result === "D"
                    ? "Draw"
                    : "No match"
            }
          >
            {result === "-" ? "" : result}
          </span>
        ))}
    </span>
  );
}
export function StandingsTable({
  entries,
  ownId,
  compact = false,
}: {
  entries: Standing[];
  ownId?: number;
  compact?: boolean;
}) {
  return (
    <div className="table-scroll" data-no-swipe>
      <table className="data-table standings-table">
        <thead>
          <tr>
            <th>#</th>
            <th>Club</th>
            <th>MP</th>
            {!compact && (
              <>
                <th>W</th>
                <th>D</th>
                <th>L</th>
                <th>GF</th>
                <th>GA</th>
              </>
            )}
            <th>GD</th>
            <th>Pts</th>
            <th>Form</th>
            {!compact && (
              <>
                <th>xPts</th>
                <th>xG</th>
                <th>xGA</th>
                <th>Home</th>
                <th>Away</th>
              </>
            )}
          </tr>
        </thead>
        <tbody>
          {entries.map((entry, index) => (
            <tr
              key={entry.club_id}
              className={entry.club_id === ownId ? "own-row" : ""}
            >
              <td>
                <span
                  className={clsx(
                    "table-position",
                    index < 4 && "zone-top",
                    index >= entries.length - 3 && !compact && "zone-bottom",
                  )}
                >
                  {index + 1}
                </span>
              </td>
              <td>
                <ClubLink
                  id={entry.club_id}
                  name={entry.club_name ?? "Club"}
                  color={entry.club_color}
                  crest
                />
              </td>
              <td>{entry.played}</td>
              {!compact && (
                <>
                  <td>{entry.wins}</td>
                  <td>{entry.draws}</td>
                  <td>{entry.losses}</td>
                  <td>{entry.gf}</td>
                  <td>{entry.ga}</td>
                </>
              )}
              <td>
                {entry.gf - entry.ga > 0 ? "+" : ""}
                {entry.gf - entry.ga}
              </td>
              <td className="points">{entry.points}</td>
              <td>
                <FormDots form={entry.form} />
              </td>
              {!compact && (
                <>
                  <td>{entry.xpts.toFixed(1)}</td>
                  <td>{entry.xg.toFixed(1)}</td>
                  <td>{entry.xga.toFixed(1)}</td>
                  <td>{entry.home_record}</td>
                  <td>{entry.away_record}</td>
                </>
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function FixtureRow({ fixture }: { fixture: Fixture }) {
  const { openMatch } = useGame();
  return (
    <div className="fixture-row">
      <button
        className="fixture-date"
        title="Open match report"
        onClick={() => openMatch(fixture.id)}
      >
        <strong>{new Date(`${fixture.date}T12:00:00Z`).getUTCDate()}</strong>
        <small>
          {new Date(`${fixture.date}T12:00:00Z`).toLocaleDateString("en-GB", {
            month: "short",
            timeZone: "UTC",
          })}
        </small>
      </button>
      <span className="fixture-teams">
        <span>
          <ClubLink
            id={fixture.home_id}
            name={fixture.home_name ?? "Home team"}
            color={fixture.home_color}
            crest
          />
        </span>
        <span>
          <ClubLink
            id={fixture.away_id}
            name={fixture.away_name ?? "Away team"}
            color={fixture.away_color}
            crest
          />
        </span>
      </span>
      {fixture.status === "played" ? (
        <span className="fixture-score">
          {fixture.home_goals}
          <br />
          {fixture.away_goals}
        </span>
      ) : (
        <span className="fixture-meta">
          <small>
            {fixture.age_group === "Senior"
              ? fixture.stage === "Pre-season friendly"
                ? "Friendly"
                : fixture.stage
              : fixture.age_group}
          </small>
          <span>15:00</span>
        </span>
      )}
      <IconButton
        icon={ChevronRight}
        label={`Open match ${fixture.home_name} vs ${fixture.away_name}`}
        onClick={() => openMatch(fixture.id)}
      />
    </div>
  );
}

export function Modal({
  title,
  children,
  onClose,
  wide = false,
  className = "",
  describedBy,
}: {
  title: string;
  children: ReactNode;
  onClose: () => void;
  wide?: boolean;
  className?: string;
  describedBy?: string;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const close = useEffectEvent(onClose);
  useEffect(() => {
    const dialog = ref.current!;
    const previous = document.activeElement as HTMLElement | null;
    dialog.showModal();
    const handler = (event: Event) => {
      event.preventDefault();
      close();
    };
    dialog.addEventListener("cancel", handler);
    return () => {
      dialog.removeEventListener("cancel", handler);
      dialog.close();
      previous?.focus();
    };
  }, []);
  return createPortal(
    <dialog
      ref={ref}
      className={clsx("modal-sheet", wide && "modal-wide", className)}
      aria-labelledby={titleId}
      aria-describedby={describedBy}
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div className="sheet-content">
        <div className="sheet-grabber" />
        <header className="sheet-header">
          <h2 id={titleId}>{title}</h2>
          <IconButton icon={X} label="Close dialog" onClick={onClose} />
        </header>
        {children}
      </div>
    </dialog>,
    document.body,
  );
}

export function Tabs({
  items,
  value,
  onChange,
  label = "Page sections",
}: {
  items: { id: string; label: string; count?: number }[];
  value: string;
  onChange: (value: string) => void;
  label?: string;
}) {
  const listRef = useRef<HTMLDivElement>(null);
  const [overflow, setOverflow] = useState({ left: false, right: false });
  useEffect(() => {
    const list = listRef.current;
    if (!list) return;
    function updateOverflow() {
      if (!list) return;
      const left = list.scrollLeft > 1;
      const right = list.scrollLeft + list.clientWidth < list.scrollWidth - 1;
      setOverflow((current) => current.left === left && current.right === right
        ? current : { left, right });
    }
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(updateOverflow);
    observer?.observe(list);
    Array.from(list.children).forEach((child) => observer?.observe(child));
    list.addEventListener("scroll", updateOverflow, { passive: true });
    updateOverflow();
    return () => {
      observer?.disconnect();
      list.removeEventListener("scroll", updateOverflow);
    };
  }, [items.length]);
  useEffect(() => {
    const list = listRef.current;
    const selected = list?.querySelector<HTMLButtonElement>('[aria-selected="true"]');
    if (!list || !selected) return;
    const listBounds = list.getBoundingClientRect();
    const selectedBounds = selected.getBoundingClientRect();
    if (selectedBounds.left < listBounds.left)
      list.scrollBy({ left: selectedBounds.left - listBounds.left });
    else if (selectedBounds.right > listBounds.right)
      list.scrollBy({ left: selectedBounds.right - listBounds.right });
  }, [value]);
  return (
    <div className="tab-navigation" data-no-swipe>
    <div className="tabs" role="tablist" aria-label={label} ref={listRef}>
      {items.map((item, index) => (
        <button
          type="button"
          role="tab"
          aria-selected={value === item.id}
          tabIndex={value === item.id ? 0 : -1}
          className={value === item.id ? "active" : ""}
          key={item.id}
          onClick={() => onChange(item.id)}
          onKeyDown={(event) => {
            const nextIndex = event.key === "ArrowRight" ? (index + 1) % items.length
              : event.key === "ArrowLeft" ? (index - 1 + items.length) % items.length
                : event.key === "Home" ? 0
                  : event.key === "End" ? items.length - 1 : null;
            if (nextIndex === null) return;
            event.preventDefault();
            onChange(items[nextIndex].id);
            listRef.current?.querySelectorAll<HTMLButtonElement>('[role="tab"]')[nextIndex]?.focus();
          }}
        >
          {item.label}
          {item.count !== undefined && <span>{compactNumber(item.count)}</span>}
        </button>
      ))}
    </div>
    {(overflow.left || overflow.right) && (
      <div className="tab-scroll-controls" role="group" aria-label={`${label} scrolling`}>
        <IconButton
          icon={ChevronLeft}
          label={`Scroll ${label.toLowerCase()} left`}
          disabled={!overflow.left}
          onClick={() => listRef.current?.scrollBy({ left: -Math.max(120, listRef.current.clientWidth * 0.75) })}
        />
        <IconButton
          icon={ChevronRight}
          label={`Scroll ${label.toLowerCase()} right`}
          disabled={!overflow.right}
          onClick={() => listRef.current?.scrollBy({ left: Math.max(120, listRef.current.clientWidth * 0.75) })}
        />
      </div>
    )}
    </div>
  );
}
export function Field({
  label,
  children,
  className = "",
}: {
  label: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <label className={`field ${className}`}>
      <span>{label}</span>
      {children}
    </label>
  );
}
export function Toggle({
  checked,
  onChange,
  label,
  disabled = false,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label: string;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      className={clsx("toggle", checked && "on")}
      onClick={() => onChange(!checked)}
    >
      <span>{checked && <Check size={10} />}</span>
    </button>
  );
}
export function TextLink({
  children,
  onClick,
}: {
  children: ReactNode;
  onClick: () => void;
}) {
  return (
    <button className="text-link" onClick={onClick}>
      {children}
      <ArrowUpRight size={14} />
    </button>
  );
}
export function DetailList({ items }: { items: [string, ReactNode][] }) {
  return (
    <dl className="detail-list">
      {items.map(([name, value]) => (
        <div key={name}>
          <dt>{name}</dt>
          <dd title={typeof value === "number" ? String(value) : undefined}>
            {typeof value === "number" && Math.abs(value) >= 1000
              ? compactNumber(value)
              : value}
          </dd>
        </div>
      ))}
    </dl>
  );
}
export function DateStamp({ date }: { date: string }) {
  return <time dateTime={date}>{dateLabel(date)}</time>;
}
