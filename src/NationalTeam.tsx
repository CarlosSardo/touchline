import { CalendarDays, Flag, Users } from "lucide-react";
import type { NationalTeamView, PlayerCaps } from "../shared/features/youth-internationals.ts";
import { useGame, useResource } from "./game-context.tsx";
import { Badge, ClubLink, Empty, ErrorState, Loading, Modal, PlayerLink, TextLink } from "./ui.tsx";
import { dateLabel } from "../shared/rules.ts";
import { dateRange, shortDate } from "./callups.ts";
import { SQUAD_STATUS_LABELS, capSeasons, capsText, nationalTeamPath, playerCapsPath } from "./internationals.ts";
import "./Internationals.css";

const STATUS_TONES = { selected: "green", provisional: "neutral", withheld: "amber" } as const;

/** Squad, eligibility cutoff, competitions and fixtures of one national team (any age group). */
export function NationalTeamPanel({ teamId }: { teamId: number }) {
  const { openLeague, openMatch } = useGame();
  const { data, error } = useResource<NationalTeamView>(nationalTeamPath(teamId));
  if (error) return <ErrorState message={error} />;
  if (!data) return <Loading label="Opening national team" />;
  const youth = data.team.ageGroup !== "Senior";
  return (
    <div className="national-team">
      <div className="national-team-summary">
        {data.duty ? (
          <Badge tone="green">
            On duty · {data.duty.competition} · {dateRange(data.duty.from, data.duty.until)}
          </Badge>
        ) : (
          <Badge>Between fixtures: provisional squad</Badge>
        )}
        {data.duty?.mandatory === false && <Badge tone="amber">Clubs may refuse release</Badge>}
        {youth && data.cutoff && <span>Eligible: born on or after {dateLabel(data.cutoff)}</span>}
      </div>
      {data.competitions.length > 0 && (
        <p className="national-team-summary">
          {data.competitions.map((competition) => (
            <TextLink key={competition.leagueId} onClick={() => openLeague(competition.leagueId)}>
              {competition.name}
              {!competition.held ? " (not held this season)" : competition.phase ? ` · ${competition.phase}` : ""}
            </TextLink>
          ))}
        </p>
      )}
      <h3 className="subsection-title">{data.duty ? "Named squad" : "Provisional squad"}</h3>
      {data.players.length ? (
        <div className="table-scroll" data-no-swipe role="region" aria-label={`${data.team.name} squad`} tabIndex={0}>
          <table className="data-table">
            <thead>
              <tr>
                <th>Player</th>
                <th>Pos</th>
                <th>Age</th>
                <th>Club</th>
                <th title="Appearances for this team">Caps</th>
                <th>Goals</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {data.players.map((player) => (
                <tr key={player.id}>
                  <td>
                    <PlayerLink id={player.id} name={player.name} />
                  </td>
                  <td>
                    <span className="position-tag">{player.position}</span>
                  </td>
                  <td>{player.age}</td>
                  <td>
                    {player.clubId ? (
                      <ClubLink id={player.clubId} name={player.clubName ?? "Club"} />
                    ) : (
                      <span className="muted">No club</span>
                    )}
                  </td>
                  <td>{player.caps}</td>
                  <td>{player.goals}</td>
                  <td>
                    <Badge tone={STATUS_TONES[player.status]}>{SQUAD_STATUS_LABELS[player.status]}</Badge>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <Empty icon={Users} title="No eligible players found" />
      )}
      <h3 className="subsection-title section-space">Fixtures this season</h3>
      {data.fixtures.length ? (
        <ul className="national-fixtures">
          {data.fixtures.map((fixture) => (
            <li key={fixture.id}>
              <time dateTime={fixture.date}>{shortDate(fixture.date)}</time>
              <span>
                {fixture.homeName} {fixture.status === "played" ? `${fixture.homeGoals}–${fixture.awayGoals}` : "v"}{" "}
                {fixture.awayName}
                <small className="muted"> · {fixture.competition}{fixture.stage ? ` · ${fixture.stage}` : ""}</small>
              </span>
              <TextLink onClick={() => openMatch(fixture.id)}>
                {fixture.status === "played" ? "Report" : "Preview"}
              </TextLink>
            </li>
          ))}
        </ul>
      ) : (
        <Empty icon={CalendarDays} title="No fixtures this season" />
      )}
    </div>
  );
}

export function NationalTeamSheet({ teamId, name, onClose }: { teamId: number; name: string; onClose: () => void }) {
  return (
    <Modal title={name} wide onClose={onClose}>
      <div className="sheet-body">
        <NationalTeamPanel teamId={teamId} />
      </div>
    </Modal>
  );
}

/** Caps per national team for the player sheet. */
export function PlayerCapsBlock({ playerId }: { playerId: number }) {
  const { data, error } = useResource<PlayerCaps>(playerCapsPath(playerId));
  if (error) return <p className="dossier-copy">Caps could not be loaded.</p>;
  if (!data) return <Loading label="Loading caps" />;
  const exposure = data.exposure ? `Recent tournament exposure: ${data.exposure.tournament}` : null;
  return (
    <>
      <p className="dossier-copy">
        <Flag size={13} aria-hidden="true" /> {capsText(data.total)}
        {exposure ? ` · ${exposure}` : ""}
      </p>
      {data.teams.length > 0 && (
        <div className="table-scroll" data-no-swipe role="region" aria-label="International caps" tabIndex={0}>
          <table className="data-table caps-table">
            <thead>
              <tr>
                <th>Team</th>
                <th>Caps</th>
                <th>Goals</th>
                <th>Assists</th>
                <th>Seasons</th>
              </tr>
            </thead>
            <tbody>
              {data.teams.map((line) => (
                <tr key={line.teamId}>
                  <td>
                    <ClubLink id={line.teamId} name={line.teamName} />
                  </td>
                  <td>{line.appearances}</td>
                  <td>{line.goals}</td>
                  <td>{line.assists}</td>
                  <td>{capSeasons(line)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
