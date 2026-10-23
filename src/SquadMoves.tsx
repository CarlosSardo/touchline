import { ArrowDown, ArrowRight, ArrowUp } from "lucide-react";
import { Badge, ClubLink, PlayerLink } from "./ui.tsx";
import type { ClubSquadMove, PlayerSquadMove } from "../shared/api.ts";
import { dateLabel } from "../shared/rules.ts";
import { SQUAD_KIND_LABELS, squadMovePeriod, squadMoveTitle, squadName } from "./player-history.ts";

const DIRECTION_ICONS = { up: ArrowUp, down: ArrowDown, across: ArrowRight } as const;
const DIRECTION_TEXT = { up: "Up", down: "Down", across: "Across" } as const;

/** Moves inside a club family (B-team, U19, U17 and call-ups), newest first; never transfers. */
export default function SquadMoveTable({
  moves,
  label,
  showPlayer = false,
}: {
  moves: readonly (PlayerSquadMove | ClubSquadMove)[];
  label: string;
  showPlayer?: boolean;
}) {
  const rows = [...moves].reverse().sort((left, right) => right.date.localeCompare(left.date));
  return (
    <div className="table-scroll" data-no-swipe role="region" aria-label={label} tabIndex={0}>
      <table className="data-table player-history-table squad-move-table" aria-label={label}>
        <thead>
          <tr>
            <th>Date</th>
            {showPlayer && <th>Player</th>}
            <th>Movement</th>
            <th>Type</th>
            <th>Period</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((move, index) => {
            const Icon = DIRECTION_ICONS[move.direction];
            const player = "player" in move ? move.player : null;
            return (
              <tr key={"key" in move ? move.key : `${move.date}:${index}`}>
                <td className="squad-move-date">{dateLabel(move.date)}</td>
                {showPlayer && (
                  <td>
                    {player ? <PlayerLink id={player.id} name={player.name} /> : <span className="muted">—</span>}
                    {player?.position && (
                      <small className="appearance-status">
                        {player.position}
                        {player.ageAtMove !== null ? ` · ${player.ageAtMove}` : ""}
                      </small>
                    )}
                  </td>
                )}
                <td>
                  <span className="squad-move-title">
                    <Icon size={13} aria-hidden="true" />
                    <span className="sr-only">{DIRECTION_TEXT[move.direction]}: </span>
                    {squadMoveTitle(move)}
                  </span>
                  <small className="appearance-status">
                    From{" "}
                    {move.from ? (
                      <ClubLink id={move.from.id} name={squadName(move.from, move.fromGroup)} color={move.from.color ?? undefined} />
                    ) : (
                      "another squad"
                    )}
                  </small>
                </td>
                <td>
                  {SQUAD_KIND_LABELS[move.kind]}
                  {move.debut && (
                    <small className="appearance-status">
                      <Badge tone="violet">Possible debut</Badge>
                    </small>
                  )}
                </td>
                <td>
                  {move.kind === "callUp" ? (
                    squadMovePeriod(move)
                  ) : (
                    <span className="muted">{move.kind === "move" ? "Permanent" : "Automatic"}</span>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
