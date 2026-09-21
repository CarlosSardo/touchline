import type { Fixture } from "./types.ts";

export interface KnockoutRules {
  version: number;
  legs: 1 | 2;
  extraTime: boolean;
  awayGoals: boolean;
  neutral: boolean;
}

export interface KnockoutTie extends KnockoutRules {
  id: string;
  leg: 1 | 2;
}

export function knockoutRules(name: string, stage: string): KnockoutRules {
  const competition = name.replace(/ Qualifying$/, "");
  const final = stage === "Final";
  const europeanSenior = [
    "UEFA Champions League",
    "UEFA Europa League",
    "UEFA Conference League",
  ].includes(competition);
  return {
    version: 1,
    legs: europeanSenior && !final ? 2 : 1,
    extraTime: !/U17|U19|U20|Youth|MIC|Future Cup|Alkass|Adidas/.test(
      competition,
    ),
    awayGoals: false,
    neutral: final,
  };
}

export function aggregateScore(
  fixtures: Pick<
    Fixture,
    "home_id" | "away_id" | "home_goals" | "away_goals"
  >[],
  homeId: number,
) {
  let home = 0;
  let away = 0;
  let homeAwayGoals = 0;
  let awayAwayGoals = 0;
  for (const fixture of fixtures) {
    if (fixture.home_id === homeId) {
      home += fixture.home_goals ?? 0;
      away += fixture.away_goals ?? 0;
      awayAwayGoals += fixture.away_goals ?? 0;
    } else {
      home += fixture.away_goals ?? 0;
      away += fixture.home_goals ?? 0;
      homeAwayGoals += fixture.away_goals ?? 0;
    }
  }
  return { home, away, homeAwayGoals, awayAwayGoals };
}

export function knockoutWinner(fixtures: Fixture[]): number | null {
  const last =
    fixtures.find(
      (fixture) =>
        (JSON.parse(fixture.data).tie as KnockoutTie | undefined)?.leg === 2,
    ) ?? fixtures[0];
  if (!last) return null;
  const details = JSON.parse(last.data);
  const tie = details.tie as KnockoutTie | undefined;
  const aggregate = aggregateScore(fixtures, last.home_id);
  if (aggregate.home !== aggregate.away)
    return aggregate.home > aggregate.away ? last.home_id : last.away_id;
  if (tie?.awayGoals && aggregate.homeAwayGoals !== aggregate.awayAwayGoals)
    return aggregate.homeAwayGoals > aggregate.awayAwayGoals
      ? last.home_id
      : last.away_id;
  return details.winnerId ?? null;
}
