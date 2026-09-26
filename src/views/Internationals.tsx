import { useState } from "react";
import { CalendarDays, Flag, Medal, Trophy, Users } from "lucide-react";
import type { InternationalsDesk, ReleasePolicy } from "../../shared/features/youth-internationals.ts";
import { NATIONAL_TEAM_AGES } from "../../shared/features/youth-internationals.ts";
import type { WorldClubPage } from "../../shared/api.ts";
import type { League } from "../../shared/types.ts";
import { useGame, useResource } from "../game-context.tsx";
import { Badge, Button, Empty, ErrorState, Field, Loading, PageHeading, Panel, PlayerLink, SectionHeading } from "../ui.tsx";
import { NationalTeamSheet } from "../NationalTeam.tsx";
import { shortDate } from "../callups.ts";
import { seasonText } from "../format.ts";
import {
  INTERNATIONALS_PATH,
  RELEASE_OPTIONS,
  dutyPeriod,
  phaseText,
  phaseTone,
  tournamentsByAge,
} from "../internationals.ts";
import "../Internationals.css";

function leagueState(league: League) {
  try {
    const data = JSON.parse(league.data || "{}") as { phase?: string; championName?: string };
    return { phase: data.phase ?? null, championName: data.championName ?? null };
  } catch {
    return { phase: null, championName: null };
  }
}

export default function Internationals() {
  const { bootstrap, openLeague, changeSettings } = useGame();
  const { data, error } = useResource<InternationalsDesk>(INTERNATIONALS_PATH, { keepPreviousData: true });
  const { data: senior } = useResource<League[]>("leagues?kind=international&age=Senior&limit=50");
  const [country, setCountry] = useState("");
  const countryId = country || String(bootstrap?.club.country_id ?? "");
  const { data: teams } = useResource<WorldClubPage>(
    countryId ? `world/clubs?type=national&country=${countryId}&pageSize=10&sort=reputation` : null,
    { keepPreviousData: true },
  );
  const [team, setTeam] = useState<{ id: number; name: string } | null>(null);
  if (error) return <ErrorState message={error} />;
  if (!data || !bootstrap) return <Loading label="Opening internationals" />;
  const setting = bootstrap.settings.youthRelease;
  const policy = (typeof setting === "string" ? setting : data.releasePolicy) as ReleasePolicy;
  const policyHelp = RELEASE_OPTIONS.find(([id]) => id === policy)?.[2];
  const nationalTeams = [...(teams?.clubs ?? [])].sort(
    (left, right) => NATIONAL_TEAM_AGES.indexOf(left.age_group) - NATIONAL_TEAM_AGES.indexOf(right.age_group),
  );
  const away = data.clubPlayers.filter((entry) => entry.status === "selected").length;
  return (
    <div className="page">
      <PageHeading
        eyebrow="NATIONAL TEAMS"
        title="Internationals"
        subtitle={`${seasonText(bootstrap.state.season)} tournaments / ${away} of your players on duty`}
      />
      <div className="internationals-grid">
        <div className="stack">
          <Panel>
            <SectionHeading title="Your players" subtitle="On national duty now, or kept back by the club" />
            {data.clubPlayers.length ? (
              <ul className="internationals-list">
                {data.clubPlayers.map((entry) => (
                  <li className="internationals-row" key={entry.playerId}>
                    <span>
                      <strong>
                        <PlayerLink id={entry.playerId} name={entry.name} />
                      </strong>
                      <small>
                        {entry.competition} · {dutyPeriod(entry)}
                      </small>
                    </span>
                    <span className="internationals-actions">
                      <Badge tone={entry.status === "withheld" ? "amber" : "green"}>
                        {entry.status === "withheld" ? "Kept back" : "Away"}
                      </Badge>
                      <Button variant="secondary" onClick={() => setTeam({ id: entry.teamId, name: entry.teamName })}>
                        {entry.teamName}
                      </Button>
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <Empty icon={Users} title="Nobody is away" detail="Call-ups of your players also appear in the inbox." />
            )}
          </Panel>
          <Panel>
            <SectionHeading title="Youth tournaments" subtitle="Tables, fixtures and brackets open in Competitions" />
            {tournamentsByAge(data.tournaments).map((group) => (
              <section key={group.ageGroup} aria-label={`${group.ageGroup} tournaments`}>
                <h3 className="internationals-age">{group.ageGroup}</h3>
                <ul className="internationals-list">
                  {group.tournaments.map((tournament) => (
                    <li className="internationals-row" key={tournament.id}>
                      <span>
                        <strong>{tournament.name}</strong>
                        <small>
                          {tournament.confederation} · {tournament.held ? `${tournament.edition} edition from ${shortDate(tournament.start)}` : "Next edition next season"}
                          {tournament.championName ? ` · Champions: ${tournament.championName}` : ""}
                        </small>
                      </span>
                      <span className="internationals-actions">
                        <Badge tone={phaseTone(tournament)}>{phaseText(tournament)}</Badge>
                        {tournament.qualifyingLeagueId && (
                          <Button variant="secondary" onClick={() => openLeague(tournament.qualifyingLeagueId!)}>
                            Qualifying
                          </Button>
                        )}
                        {tournament.leagueId && tournament.held && (
                          <Button variant="secondary" icon={Trophy} onClick={() => openLeague(tournament.leagueId!)}>
                            Finals
                          </Button>
                        )}
                      </span>
                    </li>
                  ))}
                </ul>
              </section>
            ))}
            {!data.tournaments.length && <Empty icon={Medal} title="No youth tournaments in this world" />}
          </Panel>
          <Panel>
            <SectionHeading title="Senior tournaments" />
            {senior?.length ? (
              <ul className="internationals-list">
                {senior.map((league) => {
                  const state = leagueState(league);
                  return (
                    <li className="internationals-row" key={league.id}>
                      <span>
                        <strong>{league.name}</strong>
                        <small>
                          {league.confederation}
                          {state.championName ? ` · Champions: ${state.championName}` : ""}
                        </small>
                      </span>
                      <span className="internationals-actions">
                        {state.phase && <Badge tone="blue">{phaseText({ held: true, phase: state.phase })}</Badge>}
                        <Button variant="secondary" icon={Trophy} onClick={() => openLeague(league.id)}>
                          Table & fixtures
                        </Button>
                      </span>
                    </li>
                  );
                })}
              </ul>
            ) : (
              <Empty icon={CalendarDays} title={senior ? "No senior tournaments this season" : "Loading tournaments"} />
            )}
          </Panel>
        </div>
        <div className="stack">
          <Panel>
            <SectionHeading title="Release for youth tournaments" />
            <div className="internationals-release">
              <Field label="Outside FIFA windows">
                <select
                  aria-label="Release for youth tournaments outside FIFA windows"
                  value={policy}
                  onChange={(event) => void changeSettings({ youthRelease: event.target.value })}
                >
                  {RELEASE_OPTIONS.map(([id, text]) => (
                    <option key={id} value={id}>
                      {text}
                    </option>
                  ))}
                </select>
              </Field>
              {policyHelp && <p>{policyHelp}</p>}
              <p>Call-ups in FIFA windows and the close season (June to mid-July) are always released.</p>
            </div>
          </Panel>
          <Panel>
            <SectionHeading title="National teams">
              <Flag size={15} className="muted" />
            </SectionHeading>
            <div className="internationals-release">
              <Field label="Association">
                <select aria-label="National team association" value={countryId} onChange={(event) => setCountry(event.target.value)}>
                  {bootstrap.countries.map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.name}
                    </option>
                  ))}
                </select>
              </Field>
            </div>
            {nationalTeams.length ? (
              <ul className="internationals-list">
                {nationalTeams.map((club) => (
                  <li className="internationals-row" key={club.id}>
                    <span>
                      <strong>{club.name}</strong>
                      <small>{club.age_group === "Senior" ? "Senior team" : `${club.age_group} team`}</small>
                    </span>
                    <Button variant="secondary" onClick={() => setTeam({ id: club.id, name: club.name })}>
                      Squad & fixtures
                    </Button>
                  </li>
                ))}
              </ul>
            ) : (
              <Empty icon={Flag} title={teams ? "No national teams" : "Loading national teams"} />
            )}
          </Panel>
        </div>
      </div>
      {team && <NationalTeamSheet teamId={team.id} name={team.name} onClose={() => setTeam(null)} />}
    </div>
  );
}
