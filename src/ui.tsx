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
  ArrowUp,
  ArrowUpRight,
  Bookmark,
  Check,
  ChevronRight,
  Inbox,
  LoaderCircle,
  X,
  type LucideIcon,
} from "lucide-react";
import clsx from "clsx";
import { useCurrency, useGame } from "./game-context.tsx";
import { compactNumber, dateLabel } from "../shared/rules.ts";
import type { Fixture, Player, Standing } from "../shared/types.ts";

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
    <div className="page-heading">
      <div>
        {eyebrow && <div className="eyebrow">{eyebrow}</div>}
        <h1>{title}</h1>
        {subtitle && <p className="page-subtitle">{subtitle}</p>}
      </div>
      {children && <div className="heading-actions">{children}</div>}
    </div>
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
}: {
  player: Player;
  compact?: boolean;
  showClub?: boolean;
}) {
  const { setPlayer } = useGame();
  return (
    <button className="player-name" onClick={() => setPlayer(player.id)}>
      <Silhouette
        size={compact ? 30 : 38}
        color={player.club_color ?? "#087f6d"}
      />
      <span>
        <strong>{player.name}</strong>
        <small>
          {showClub
            ? (player.club_name ?? "Free agent")
            : `${player.nationality} / ${player.age}`}
        </small>
      </span>
    </button>
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

export function PlayerTable({
  players,
  compact = false,
  wages = false,
  children,
}: {
  players: Player[];
  compact?: boolean;
  wages?: boolean;
  children?: (player: Player) => ReactNode;
}) {
  const { money } = useCurrency();
  return (
    <div className="table-scroll" data-no-swipe>
      <table className="data-table player-table">
        <thead>
          <tr>
            <th>Player</th>
            <th>Pos</th>
            <th>Age</th>
            <th title="Current ability">Ability</th>
            <th title="Current dynamic potential">Potential</th>
            {!compact && <th>Club</th>}
            <th className="number">Value</th>
            {wages && <th className="number">Wage / wk</th>}
            {!compact && <th>Form</th>}
            <th>
              <span className="sr-only">Actions</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {players.map((player) => (
            <tr key={player.id}>
              <td>
                <PlayerName player={player} compact />
              </td>
              <td>
                <span className="position-tag">{player.position}</span>
              </td>
              <td>{player.age}</td>
              <td>
                <Rating value={player.ability} />
              </td>
              <td>
                <Rating value={player.potential} potential />
              </td>
              {!compact && (
                <td className="club-cell">
                  <span
                    className="club-dot"
                    style={{ background: player.club_color }}
                  />
                  <ClubLink
                    id={player.club_id}
                    name={player.club_name ?? "Free agent"}
                  />
                </td>
              )}
              <td className="number money">{money(player.value)}</td>
              {wages && <td className="number muted">{money(player.wage)}</td>}
              {!compact && (
                <td>
                  <span className={player.form >= 7 ? "positive" : "muted"}>
                    {player.form.toFixed(1)}
                  </span>
                </td>
              )}
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
}: {
  title: string;
  children: ReactNode;
  onClose: () => void;
  wide?: boolean;
  className?: string;
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
}: {
  items: { id: string; label: string; count?: number }[];
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <div className="tabs" role="tablist">
      {items.map((item) => (
        <button
          role="tab"
          aria-selected={value === item.id}
          className={value === item.id ? "active" : ""}
          key={item.id}
          onClick={() => onChange(item.id)}
        >
          {item.label}
          {item.count !== undefined && <span>{compactNumber(item.count)}</span>}
        </button>
      ))}
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
