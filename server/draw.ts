import solverPackage, {
  type Model,
  type SolveResult,
} from "javascript-lp-solver";
import seedrandom from "seedrandom";

const solver = solverPackage as unknown as {
  Solve: (model: Model) => SolveResult;
};

export interface DrawEntrant {
  id: number;
  countryId: number;
  coefficient: number;
}
export interface DrawFixture {
  homeId: number;
  awayId: number;
  round: number;
}
export interface LeaguePhaseDraw {
  pots: number[][];
  fixtures: DrawFixture[];
  constraints: {
    associationProtection: boolean;
    maxSameAssociation: number;
    homeMatches: number;
    awayMatches: number;
  };
}

function integerModel() {
  return {
    optimize: "objective",
    opType: "min" as const,
    timeout: 1800,
    tolerance: 0,
    constraints: {} as Record<
      string,
      { equal?: number; max?: number; min?: number }
    >,
    variables: {} as Record<string, Record<string, number>>,
    binaries: {} as Record<string, 1>,
  };
}

function shuffle<Value>(values: Value[], random: seedrandom.PRNG) {
  const result = [...values];
  for (let index = result.length - 1; index > 0; index--) {
    const other = Math.floor(random() * (index + 1));
    [result[index], result[other]] = [result[other], result[index]];
  }
  return result;
}

export function drawLeaguePhase(
  entrants: DrawEntrant[],
  competition: string,
  seed: string,
): LeaguePhaseDraw {
  if (
    entrants.length !== 36 ||
    new Set(entrants.map((entrant) => entrant.id)).size !== 36
  )
    throw new Error("A UEFA league-phase draw requires 36 distinct clubs.");
  const conference = competition === "UEFA Conference League";
  const rounds = conference ? 6 : 8;
  const potCount = conference ? 6 : 4;
  const potSize = 36 / potCount;
  const sorted = [...entrants].sort(
    (left, right) => right.coefficient - left.coefficient || left.id - right.id,
  );
  const pots = Array.from({ length: potCount }, (_, index) =>
    sorted
      .slice(index * potSize, (index + 1) * potSize)
      .map((entrant) => entrant.id),
  );
  const countries = [...new Set(entrants.map((entrant) => entrant.countryId))];
  if (countries.length < (conference ? 4 : 5))
    throw new Error(
      "The association restrictions cannot be met by this entrant field.",
    );

  const byId = new Map(entrants.map((entrant) => [entrant.id, entrant]));
  for (let attempt = 0; attempt < 36; attempt++) {
    const random = seedrandom(`${seed}:draw:${attempt}`);
    const selected: [number, number][] = [];
    const associationCounts = new Map<string, number>();
    let valid = true;
    if (!conference) {
      const blocks: [number, number][] = [];
      for (let homePot = 0; homePot < potCount; homePot++)
        for (let awayPot = 0; awayPot < potCount; awayPot++)
          blocks.push([homePot, awayPot]);
      for (const [homePot, awayPot] of shuffle(blocks, random)) {
        const model = integerModel();
        for (const id of pots[homePot])
          model.constraints[`home_${id}`] = { equal: 1 };
        for (const id of pots[awayPot])
          model.constraints[`away_${id}`] = { equal: 1 };
        const choices = new Map<string, [number, number]>();
        for (const homeId of pots[homePot])
          for (const awayId of pots[awayPot]) {
            const home = byId.get(homeId)!;
            const away = byId.get(awayId)!;
            if (
              homeId === awayId ||
              home.countryId === away.countryId ||
              selected.some(
                ([first, second]) =>
                  (first === awayId && second === homeId) ||
                  (first === homeId && second === awayId),
              )
            )
              continue;
            if (
              (associationCounts.get(`${homeId}:${away.countryId}`) ?? 0) >=
                2 ||
              (associationCounts.get(`${awayId}:${home.countryId}`) ?? 0) >= 2
            )
              continue;
            const pair = `pair_${Math.min(homeId, awayId)}_${Math.max(homeId, awayId)}`;
            model.constraints[pair] = { max: 1 };
            const key = `match_${homeId}_${awayId}`;
            model.variables[key] = {
              objective: random(),
              [`home_${homeId}`]: 1,
              [`away_${awayId}`]: 1,
              [pair]: 1,
            };
            for (const [club, opponent] of [
              [homeId, awayId],
              [awayId, homeId],
            ]) {
              const association = byId.get(opponent)!.countryId;
              const constraint = `association_${club}_${association}`;
              model.constraints[constraint] = {
                max: 2 - (associationCounts.get(`${club}:${association}`) ?? 0),
              };
              model.variables[key][constraint] = 1;
            }
            model.binaries[key] = 1;
            choices.set(key, [homeId, awayId]);
          }
        const solution = solver.Solve(model);
        const matches = [...choices]
          .filter(([key]) => Number(solution[key]) > 0.5)
          .map(([, pair]) => pair);
        if (!solution.feasible || matches.length !== potSize) {
          valid = false;
          break;
        }
        for (const [homeId, awayId] of matches) {
          selected.push([homeId, awayId]);
          for (const [club, opponent] of [
            [homeId, awayId],
            [awayId, homeId],
          ]) {
            const key = `${club}:${byId.get(opponent)!.countryId}`;
            associationCounts.set(key, (associationCounts.get(key) ?? 0) + 1);
          }
        }
      }
    } else {
      const homeCount = new Map(entrants.map((entrant) => [entrant.id, 0]));
      const blocks: [number, number][] = [];
      for (let first = 0; first < potCount; first++)
        for (let second = first; second < potCount; second++)
          blocks.push([first, second]);
      for (const [firstPot, secondPot] of blocks) {
        const model = integerModel();
        const first = pots[firstPot];
        const second = pots[secondPot];
        for (const id of new Set([...first, ...second]))
          model.constraints[`club_${id}`] = { equal: 1 };
        const choices = new Map<string, [number, number]>();
        for (const homeId of first)
          for (const awayId of second) {
            if (firstPot === secondPot && homeId >= awayId) continue;
            const home = byId.get(homeId)!;
            const away = byId.get(awayId)!;
            if (
              home.countryId === away.countryId ||
              (associationCounts.get(`${homeId}:${away.countryId}`) ?? 0) >=
                2 ||
              (associationCounts.get(`${awayId}:${home.countryId}`) ?? 0) >= 2
            )
              continue;
            const key = `match_${homeId}_${awayId}`;
            model.variables[key] = {
              objective: random(),
              [`club_${homeId}`]: 1,
              [`club_${awayId}`]: 1,
            };
            model.binaries[key] = 1;
            choices.set(key, [homeId, awayId]);
          }
        const solution = solver.Solve(model);
        const matches = [...choices]
          .filter(([key]) => Number(solution[key]) > 0.5)
          .map(([, pair]) => pair);
        if (
          !solution.feasible ||
          matches.length !== (firstPot === secondPot ? potSize / 2 : potSize)
        ) {
          valid = false;
          break;
        }
        for (const [firstId, secondId] of matches) {
          selected.push([firstId, secondId]);
          for (const [club, opponent] of [
            [firstId, secondId],
            [secondId, firstId],
          ]) {
            const key = `${club}:${byId.get(opponent)!.countryId}`;
            associationCounts.set(key, (associationCounts.get(key) ?? 0) + 1);
          }
        }
      }
      if (valid) {
        const model = integerModel();
        for (const id of homeCount.keys())
          model.constraints[`home_${id}`] = { equal: 3 };
        selected.forEach(([first, second], index) => {
          model.constraints[`edge_${index}`] = { equal: 1 };
          for (const home of [first, second]) {
            const key = `home_${index}_${home}`;
            model.variables[key] = {
              objective: random(),
              [`home_${home}`]: 1,
              [`edge_${index}`]: 1,
            };
            model.binaries[key] = 1;
          }
        });
        const solution = solver.Solve(model);
        if (!solution.feasible) valid = false;
        else
          selected.forEach(([first, second], index) => {
            if (Number(solution[`home_${index}_${second}`]) > 0.5)
              selected[index] = [second, first];
          });
      }
    }
    if (!valid) continue;
    for (
      let schedulingAttempt = 0;
      schedulingAttempt < 96;
      schedulingAttempt++
    ) {
      const remaining = selected.map((pair, index) => ({ pair, index }));
      const fixtures: DrawFixture[] = [];
      let scheduled = true;
      for (let round = 1; round <= rounds; round++) {
        const model = integerModel();
        for (const entrant of entrants)
          model.constraints[`club_${entrant.id}`] = { equal: 1 };
        for (const {
          pair: [home, away],
          index,
        } of remaining) {
          model.variables[`match_${index}`] = {
            objective: random(),
            [`club_${home}`]: 1,
            [`club_${away}`]: 1,
          };
          model.binaries[`match_${index}`] = 1;
        }
        const solution = solver.Solve(model);
        const matches = remaining.filter(
          ({ index }) => Number(solution[`match_${index}`]) > 0.5,
        );
        if (!solution.feasible || matches.length !== 18) {
          scheduled = false;
          break;
        }
        for (const match of matches) {
          fixtures.push({
            homeId: match.pair[0],
            awayId: match.pair[1],
            round,
          });
          remaining.splice(remaining.indexOf(match), 1);
        }
      }
      if (scheduled)
        return {
          pots,
          fixtures,
          constraints: {
            associationProtection: true,
            maxSameAssociation: 2,
            homeMatches: rounds / 2,
            awayMatches: rounds / 2,
          },
        };
    }
  }
  throw new Error(
    "A legal league-phase draw could not be found. The entrant field must be reviewed; constraints were not relaxed.",
  );
}
