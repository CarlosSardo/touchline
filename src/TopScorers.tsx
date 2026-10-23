import { useState } from "react";
import clsx from "clsx";
import { Award, ChevronDown, Goal } from "lucide-react";
import { useGame, useResource } from "./game-context.tsx";
import { Button, ClubLink, Empty, ErrorState, Loading, PlayerLink } from "./ui.tsx";
import { flagEmoji } from "./players.ts";
import { seasonText } from "./format.ts";
import {
  goalsText,
  leaderLine,
  nextScorersLimit,
  rankLabel,
  SCORERS_STEP,
  scorersPath,
  teamHeading,
  teamSummary,
} from "./top-scorers.ts";
import type { CompetitionScorer, CompetitionScorers } from "../shared/api.ts";
import type { League } from "../shared/types.ts";
import "./TopScorers.css";

function Teams({ scorer }: { scorer: CompetitionScorer }) {
  const several = scorer.teams.length > 1;
  return (
    <span className="scorer-teams">
      {scorer.teams.map((team) => (
        <span key={team.id} className="scorer-team" title={several ? teamSummary(team) : undefined}>
          <ClubLink id={team.id} name={team.name} color={team.color} crest={!several} />
          {several && <small aria-label={goalsText(team.goals)}>{team.goals}</small>}
        </span>
      ))}
    </span>
  );
}

function Nationality({ scorer }: { scorer: CompetitionScorer }) {
  const flag = flagEmoji(scorer.countryCode);
  return (
    <span className="nationality-cell" title={scorer.nationality}>
      <span className={clsx("flag", !flag && "flag-code")} aria-hidden="true">
        {flag ?? scorer.countryCode ?? "-"}
      </span>
      {flag && scorer.countryCode && <span className="scorer-country" aria-hidden="true">{scorer.countryCode}</span>}
      <span className="sr-only">{scorer.nationality}</span>
    </span>
  );
}

function GoldenBoot({ race }: { race: CompetitionScorers }) {
  const leader = race.scorers[0];
  return (
    <section className="golden-boot" aria-label="Golden Boot leader">
      <span className="golden-boot-icon">
        <Award size={26} strokeWidth={1.6} />
      </span>
      <div className="golden-boot-leader">
        <small>{race.leaders > 1 ? "JOINT TOP SCORER" : "GOLDEN BOOT LEADER"}</small>
        <strong>
          <PlayerLink id={leader.playerId} name={leader.name} />
        </strong>
        <span className="golden-boot-detail">
          <Teams scorer={leader} />
          <span>{leaderLine(race)}</span>
        </span>
      </div>
      <dl className="golden-boot-stats">
        <div className="golden-boot-goals">
          <dt>Goals</dt>
          <dd>{leader.goals}</dd>
        </div>
        <div>
          <dt>Assists</dt>
          <dd>{leader.assists}</dd>
        </div>
        <div>
          <dt>Min/goal</dt>
          <dd>{leader.minutesPerGoal}</dd>
        </div>
      </dl>
    </section>
  );
}

/** The competition's top-scorer race: Golden Boot leader, ranked scorers and earlier seasons. */
export default function TopScorers({ league }: { league: League }) {
  const { bootstrap } = useGame();
  const [season, setSeason] = useState<number | null>(null);
  const [limit, setLimit] = useState(SCORERS_STEP);
  const { data, error, loading } = useResource<CompetitionScorers>(
    scorersPath(league.id, season, limit),
    { keepPreviousData: true },
  );
  if (error) return <ErrorState message={error} />;
  if (!data) return <Loading label="Counting the goals" />;
  const more = nextScorersLimit(data.scorers.length, data.total);
  const ownClub = bootstrap?.club.id;
  const current = data.season === data.currentSeason;
  return (
    <div className="top-scorers" aria-busy={loading}>
      <div className="filter-bar">
        <select
          aria-label="Top scorer season"
          value={season ?? data.season}
          onChange={(event) => {
            setSeason(Number(event.target.value));
            setLimit(SCORERS_STEP);
          }}
        >
          {data.seasons.map((value) => (
            <option key={value} value={value}>
              {seasonText(value)}
              {value === data.currentSeason ? " (current)" : ""}
            </option>
          ))}
        </select>
        <span className="muted top-scorers-total">
          {data.total} scorer{data.total === 1 ? "" : "s"} / {goalsText(data.goals)}
        </span>
      </div>
      {data.scorers.length ? (
        <>
          <GoldenBoot race={data} />
          <div
            className="table-scroll"
            data-no-swipe
            role="region"
            aria-label={`${league.name} top scorers`}
            tabIndex={0}
          >
            <table className="data-table top-scorers-table">
              <thead>
                <tr>
                  <th>#</th>
                  <th>Player</th>
                  <th>{teamHeading(data.scorers)}</th>
                  <th>Nat</th>
                  <th title="Goals">G</th>
                  <th title="Assists">A</th>
                  <th title="Appearances">Apps</th>
                  <th title="Minutes">Min</th>
                  <th title="Minutes per goal">Min/G</th>
                </tr>
              </thead>
              <tbody>
                {data.scorers.map((scorer, index) => (
                  <tr
                    key={scorer.playerId}
                    className={scorer.teams.some((team) => team.id === ownClub) ? "own-row" : ""}
                  >
                    <td>
                      <span className="scorer-rank" title={rankLabel(data.scorers, index)}>
                        {scorer.rank}
                      </span>
                    </td>
                    <td>
                      <span className="scorer-player">
                        <PlayerLink id={scorer.playerId} name={scorer.name} />
                        <small>
                          {scorer.position} / {scorer.age}
                        </small>
                      </span>
                    </td>
                    <td>
                      <Teams scorer={scorer} />
                    </td>
                    <td>
                      <Nationality scorer={scorer} />
                    </td>
                    <td className="scorer-goals">{scorer.goals}</td>
                    <td>{scorer.assists}</td>
                    <td>{scorer.appearances}</td>
                    <td>{scorer.minutes}</td>
                    <td>{scorer.minutesPerGoal}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="top-scorers-footer">
            <span className="muted">
              Players level on goals share a rank, listed by fewer minutes, then more assists.
            </span>
            {more !== null && (
              <Button
                variant="secondary"
                icon={ChevronDown}
                disabled={loading}
                onClick={() => setLimit(more)}
              >
                Show more scorers
              </Button>
            )}
          </div>
        </>
      ) : (
        <Empty
          icon={Goal}
          title={current ? "No goals yet" : `No goals on record for ${seasonText(data.season)}`}
          detail={
            current
              ? `The race for the Golden Boot starts with the first goal of the season.${data.seasons.length > 1 ? " Earlier races are in the season list." : ""}`
              : "No scorers are on record for this season."
          }
        />
      )}
    </div>
  );
}
