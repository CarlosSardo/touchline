import { Store } from "./db.ts";
import type { Club, Country, Standing } from "../shared/types.ts";
import {
  CONTINENTAL,
  isSuspended,
  nationByCode,
} from "../shared/world-catalog/index.ts";
import type { ContinentalStage } from "../shared/world-catalog/types.ts";
import {
  associationSeed,
  clubCompetitionEligible,
  coefficientSeedRows,
  coefficientTotal,
  frozenAssociationPoints,
  resolveContinentalAccess,
  type AccessNation,
} from "../shared/competition-rules.ts";

async function insertHistory(
  store: Store,
  rows: Record<string, string | number>[],
) {
  if (!rows.length) return;
  await store.transaction(async () => {
    const lastId = (await store.get<{ id: number }>(
      "SELECT coalesce(max(id),0) AS id FROM history WITH (UPDLOCK,HOLDLOCK)",
    ))!.id;
    for (let offset = 0; offset < rows.length; offset += 1000)
      await store.bulkInsert(
        "history",
        rows.slice(offset, offset + 1000).map((row, index) => ({
          id: lastId + offset + index + 1,
          ...row,
        })),
      );
  });
}

/** Writes the catalog 2020/21–2025/26 association coefficients (seasons firstSeason-6..-1); idempotent. */
export async function seedAssociationCoefficients(
  store: Store,
  firstSeason: number,
): Promise<number> {
  const confederations = new Set<string>(CONTINENTAL.coefficientConfederations);
  const existing = new Set(
    (
      await store.all<{ entity_id: number; season: number }>(
        "SELECT entity_id,season FROM history WHERE entity_type = 'associationCoefficient' AND season BETWEEN ? AND ?",
        firstSeason - 6,
        firstSeason - 1,
      )
    ).map((row) => `${row.entity_id}:${row.season}`),
  );
  const countries = (await store.all<Country>("SELECT * FROM countries ORDER BY id")).filter((country) =>
    confederations.has(country.confederation),
  );
  const rows = coefficientSeedRows(
    countries,
    existing,
    firstSeason,
    (code) => associationSeed(code, nationByCode(code)?.football?.coefficients),
  ).map((row) => ({
    season: row.season,
    entity_type: "associationCoefficient",
    entity_id: row.entityId,
    date: `${row.season + 1}-06-30`,
    data: JSON.stringify({
      points: row.points,
      participants: 0,
      basis: "Catalog association coefficient (points per entrant)",
      seeded: true,
    }),
  }));
  await insertHistory(store, rows);
  return rows.length;
}

export interface AssociationCoefficient {
  countryId: number;
  code: string;
  name: string;
  points: number;
  /** Points of season-1: European Performance Spots. */
  previousSeason: number;
  /** Points of season-2, the latest ranked season: tie-break. */
  latestRanked: number;
  rank: number;
}
export interface QualificationEntry {
  club: Club;
  domesticPosition: number;
  associationRank: number;
  basis: string;
  coefficient: number;
  stage: ContinentalStage;
  path?: "champions" | "league";
}

export async function associationCoefficients(
  store: Store,
  confederation: string,
  season: number,
): Promise<AssociationCoefficient[]> {
  const countries = await store.all<Country>(
    "SELECT * FROM countries WHERE confederation = ? ORDER BY id",
    confederation,
  );
  const history = await store.all<{
    entity_id: number;
    season: number;
    data: string;
  }>(
    "SELECT history.entity_id,history.season,history.data FROM history JOIN countries ON countries.id = history.entity_id WHERE history.entity_type = 'associationCoefficient' AND countries.confederation = ? AND history.season BETWEEN ? AND ? ORDER BY history.season DESC,history.id",
    confederation,
    season - 6,
    season - 1,
  );
  const histories = new Map<number, typeof history>();
  for (const row of history) {
    const rows = histories.get(row.entity_id) ?? [];
    rows.push(row);
    histories.set(row.entity_id, rows);
  }
  // Real positions: suspended and club-less associations stay ranked (their places are vacated in the resolver).
  return countries
    .filter((country) => associationSeed(country.code, nationByCode(country.code)?.football?.coefficients) ||
      nationByCode(country.code)?.football)
    .map((country) => {
      const seasons = histories.get(country.id) ?? [];
      const totals = new Map(
        seasons.map((row) => [
          row.season,
          JSON.parse(row.data).points as number,
        ]),
      );
      return {
        countryId: country.id,
        code: country.code,
        name: country.name,
        points: coefficientTotal(totals, season, confederation === "CAF"),
        previousSeason: totals.get(season - 1) ?? 0,
        latestRanked: totals.get(season - 2) ?? 0,
        rank: 0,
      };
    })
    .sort(
      (left, right) =>
        right.points - left.points ||
        right.latestRanked - left.latestRanked ||
        left.countryId - right.countryId,
    )
    .map((entry, index) => ({ ...entry, rank: index + 1 }));
}

export async function domesticOrder(
  store: Store,
  countryId: number,
  season: number,
): Promise<Club[]> {
  const clubs = await store.all<Club>(
    "SELECT clubs.* FROM clubs JOIN leagues ON leagues.id = clubs.league_id WHERE clubs.country_id = ? AND clubs.type = 'club' AND leagues.tier = 1 ORDER BY clubs.reputation DESC,clubs.id",
    countryId,
  );
  const archived = await store.get<{ data: string }>(
    "SELECT TOP (1) data FROM history WHERE entity_type = 'league' AND entity_id = ? AND season = ? ORDER BY id DESC",
    clubs[0]?.league_id ?? 0,
    season - 1,
  );
  if (!archived) return clubs;
  const table = (JSON.parse(archived.data).table ?? []) as Standing[];
  const ids = table.map((entry) => entry.club_id);
  return clubs.sort((left, right) => {
    const leftRank = ids.indexOf(left.id);
    const rightRank = ids.indexOf(right.id);
    return (
      (leftRank < 0 ? 100 : leftRank) - (rightRank < 0 ? 100 : rightRank) ||
      right.reputation - left.reputation
    );
  });
}

async function latestChampion(store: Store, season: number, name: string, countryId?: number) {
  const row = await store.get<{ data: string }>(
    `SELECT TOP (1) history.data FROM history JOIN leagues ON leagues.id = history.entity_id WHERE history.entity_type = 'champion' AND history.season = ? AND leagues.name = ? ${countryId === undefined ? "" : "AND leagues.country_id = ?"} ORDER BY history.id DESC`,
    season,
    name,
    ...(countryId === undefined ? [] : [countryId]),
  );
  return row ? Number(JSON.parse(row.data).clubId) : undefined;
}

/** A lone cup entrant wins by walkover at calendar creation, so it stands in for a missing previous edition. */
async function walkoverWinner(store: Store, season: number, name: string, countryId: number) {
  const row = await store.get<{ data: string }>(
    "SELECT TOP (1) history.data FROM history JOIN leagues ON leagues.id = history.entity_id WHERE history.entity_type = 'champion' AND history.season = ? AND leagues.name = ? AND leagues.country_id = ? AND JSON_VALUE(history.data,'$.walkover') = 'true' ORDER BY history.id DESC",
    season,
    name,
    countryId,
  );
  return row ? Number(JSON.parse(row.data).clubId) : undefined;
}

async function archivedOrder(store: Store, leagueId: number | undefined, season: number) {
  if (!leagueId) return { order: [] as number[], champion: undefined as number | undefined };
  const archived = await store.get<{ data: string }>(
    "SELECT TOP (1) data FROM history WHERE entity_type = 'league' AND entity_id = ? AND season = ? ORDER BY id DESC",
    leagueId,
    season,
  );
  const data = archived ? JSON.parse(archived.data) : {};
  return {
    order: ((data.table ?? []) as Standing[]).map((entry) => entry.club_id),
    champion: data.champion === undefined ? undefined : Number(data.champion),
  };
}

/** Access data of one association: its tier-1 table (hosted clubs counted where `continental` points), cups, youth. */
async function accessNation(store: Store, country: Country, season: number): Promise<AccessNation> {
  const football = nationByCode(country.code)?.football;
  const top = await store.get<{ id: number }>(
    "SELECT TOP (1) id FROM leagues WHERE country_id = ? AND kind = 'league' AND age_group = 'Senior' AND tier = 1 AND coalesce(JSON_VALUE(data,'$.reserveOnly'),'false') NOT IN ('true','1') ORDER BY id",
    country.id,
  );
  const clubs = (
    await store.all<Club>(
      "SELECT clubs.* FROM clubs JOIN standings ON standings.club_id = clubs.id WHERE standings.league_id = ? AND clubs.type = 'club' ORDER BY clubs.reputation DESC, clubs.id",
      top?.id ?? 0,
    )
  ).filter((club) => {
    if (!clubCompetitionEligible(club, "continental", season)) return false;
    const hosted = JSON.parse(club.data).hosted as { continental: string } | undefined;
    return club.country_id === country.id ? !hosted || hosted.continental === "home" : hosted?.continental === "host";
  });
  const ids = new Set(clubs.map((club) => club.id));
  const last = await archivedOrder(store, top?.id, season - 1);
  const archivedIds = last.order.filter((id) => ids.has(id));
  const table = [...archivedIds, ...clubs.map((club) => club.id).filter((id) => !archivedIds.includes(id))];
  const cupName = (kind: "national" | "league") =>
    football?.cups.find((cup) => cup.kind === kind && cup.continental)?.name;
  const national = cupName("national");
  const leagueCup = cupName("league");
  const youth = await store.get<{ id: number }>(
    "SELECT TOP (1) id FROM leagues WHERE country_id = ? AND kind = 'league' AND age_group = 'U19' ORDER BY tier, id",
    country.id,
  );
  const archivedYouth = (await archivedOrder(store, youth?.id, season - 1)).order;
  // First season: no archived U19 table yet, so the strongest U19 side stands in for the champion.
  const youthOrder = archivedYouth.length
    ? archivedYouth
    : (
        await store.all<{ id: number }>(
          "SELECT TOP (1) clubs.id FROM clubs JOIN standings ON standings.club_id = clubs.id WHERE standings.league_id = ? AND clubs.type = 'club' ORDER BY clubs.reputation DESC, clubs.id",
          youth?.id ?? 0,
        )
      ).map((club) => club.id);
  const champion = last.champion !== undefined && ids.has(last.champion) ? last.champion : undefined;
  return {
    code: country.code,
    table,
    coefficients: Object.fromEntries(clubs.map((club) => [club.id, club.reputation])),
    ...(champion !== undefined && { champion }),
    ...(national && {
      cupWinner:
        (await latestChampion(store, season - 1, national, country.id)) ??
        (await walkoverWinner(store, season, national, country.id)),
    }),
    ...(leagueCup && { leagueCupWinner: await latestChampion(store, season - 1, leagueCup, country.id) }),
    ...(youthOrder.length && { u19Champion: youthOrder[0], u20Champion: youthOrder[0] }),
  };
}

/** Access-list entrants of one continental competition (catalog id or real name), main-phase places first. */
export async function continentalEntries(
  store: Store,
  competition: string,
  season: number,
  excluded: Set<number>,
): Promise<QualificationEntry[]> {
  const spec = CONTINENTAL.competitions.find((item) => item.id === competition || item.name === competition);
  if (!spec) return [];
  const associations = await associationCoefficients(store, spec.confederation, season);
  const countries = await store.all<Country>(
    "SELECT * FROM countries WHERE confederation = ? ORDER BY id",
    spec.confederation,
  );
  const ranked = new Set(associations.map((entry) => entry.countryId));
  const nations: AccessNation[] = [];
  for (const country of countries)
    if (ranked.has(country.id) && nationByCode(country.code)?.football && !isSuspended(country.code, "club"))
      nations.push(await accessNation(store, country, season));
  const titleholders: Record<string, number> = {};
  const feederResults: Record<string, number[]> = {};
  for (const item of CONTINENTAL.competitions.filter((entry) => entry.confederation === spec.confederation)) {
    const winner = await latestChampion(store, season - 1, item.name);
    if (winner !== undefined) titleholders[item.id] = winner;
    if (item.feeder && winner !== undefined) {
      const league = await store.get<{ id: number }>(
        "SELECT TOP (1) leagues.id FROM leagues JOIN history ON history.entity_id = leagues.id AND history.entity_type = 'champion' AND history.season = ? WHERE leagues.name = ? ORDER BY history.id DESC",
        season - 1,
        item.name,
      );
      const order = (await archivedOrder(store, league?.id, season - 1)).order;
      feederResults[item.id] = [winner, ...order.filter((id) => id !== winner)];
    }
  }
  const resolved = resolveContinentalAccess(CONTINENTAL, {
    confederation: spec.confederation,
    ranking: associations.map((entry) => entry.code),
    // Youth League Domestic Champions Path: the ranking published a season later (N-5..N-1, not N-6..N-2).
    ...(spec.id === "uefa-youth-league" && {
      rankings: {
        [spec.id]: (await associationCoefficients(store, spec.confederation, season + 1)).map((entry) => entry.code),
      },
    }),
    nations,
    titleholders,
    feederResults,
    performanceSpots:
      spec.confederation === "UEFA"
        ? [...associations]
            .sort((left, right) => right.previousSeason - left.previousSeason)
            .slice(0, 2)
            .map((entry) => entry.code)
        : [],
  }).filter((entry) => entry.competition === spec.id && !excluded.has(entry.clubId));
  const clubs = new Map<number, Club>();
  for (const entry of resolved) {
    const club = await store.get<Club>("SELECT * FROM clubs WHERE id = ?", entry.clubId);
    if (club) clubs.set(club.id, club);
  }
  return resolved
    .filter((entry) => clubs.has(entry.clubId))
    .map((entry) => ({
      club: clubs.get(entry.clubId)!,
      domesticPosition: entry.domesticPosition,
      associationRank: entry.associationRank,
      basis: entry.basis,
      coefficient: clubs.get(entry.clubId)!.reputation,
      stage: entry.stage,
      ...(entry.path && { path: entry.path }),
    }));
}

export async function recordAssociationCoefficients(
  store: Store,
  season: number,
  date: string,
) {
  const confederations = CONTINENTAL.coefficientConfederations;
  const supers = CONTINENTAL.competitions.filter((item) => item.kind === "super").map((item) => item.name);
  const played = await store.all<{
    country_id: number;
    club_id: number;
    club_data: string;
    competition: string;
    points: number;
  }>(
    `SELECT clubs.country_id,clubs.id AS club_id,clubs.data AS club_data,leagues.name AS competition,sum(CASE WHEN fixtures.home_goals = fixtures.away_goals THEN 1 WHEN (fixtures.home_id = clubs.id AND fixtures.home_goals > fixtures.away_goals) OR (fixtures.away_id = clubs.id AND fixtures.away_goals > fixtures.home_goals) THEN 2 ELSE 0 END * CASE WHEN fixtures.stage = 'Qualifying' THEN 0.5 ELSE 1 END) AS points FROM fixtures JOIN leagues ON leagues.id = fixtures.league_id JOIN clubs ON clubs.id IN (fixtures.home_id,fixtures.away_id) WHERE fixtures.season = ? AND fixtures.status = 'played' AND leagues.confederation IN (${confederations.map(() => "?").join(",")}) AND leagues.kind = 'continental' AND leagues.age_group = 'Senior' GROUP BY clubs.country_id,clubs.id,clubs.data,leagues.name ORDER BY clubs.id`,
    season,
    ...confederations,
  );
  const countries = (
    await store.all<Country>(
      `SELECT * FROM countries WHERE confederation IN (${confederations.map(() => "?").join(",")}) ORDER BY id`,
      ...confederations,
    )
  ).filter((country) => associationSeed(country.code, nationByCode(country.code)?.football?.coefficients) ||
    nationByCode(country.code)?.football);
  const byCode = new Map(countries.map((country) => [country.code, country.id]));
  // Hosted clubs earn points for the association whose access list they use (Welsh clubs in England count for England).
  const perClub = new Map<number, { countryId: number; points: number }>();
  for (const row of played.filter((item) => !supers.includes(item.competition))) {
    const hosted = JSON.parse(row.club_data).hosted as { host: string; continental: string } | undefined;
    const countryId = hosted?.continental === "host" ? byCode.get(hosted.host) ?? row.country_id : row.country_id;
    const current = perClub.get(row.club_id) ?? { countryId, points: 0 };
    perClub.set(row.club_id, { countryId, points: current.points + row.points });
  }
  const rows = [...perClub.entries()].map(([club_id, value]) => ({ club_id, country_id: value.countryId, points: value.points }));
  const history: Record<string, string | number>[] = [];
  for (const country of countries) {
    const clubs = rows.filter((row) => row.country_id === country.id);
    const football = nationByCode(country.code)?.football;
    const seed = associationSeed(country.code, football?.coefficients);
    const suspended = isSuspended(country.code, "club");
    const frozen = seed && (suspended || !football) ? frozenAssociationPoints(seed, suspended) : undefined;
    const points = frozen ?? (clubs.length
      ? clubs.reduce((total, club) => total + club.points, 0) / clubs.length
      : 0);
    history.push({
      season,
      entity_type: "associationCoefficient",
      entity_id: country.id,
      date,
      data: JSON.stringify({
        points: Math.round(points * 1000) / 1000,
        participants: clubs.length,
        basis: frozen === undefined
          ? "Continental match points per entrant; seeded prehistory until five simulated seasons exist"
          : "No clubs in the game: frozen per-season points",
      }),
    });
  }
  if (history.length)
    await store.transaction(async () => {
      const lastId = (await store.get<{ id: number }>(
        "SELECT coalesce(max(id),0) AS id FROM history WITH (UPDLOCK,HOLDLOCK)",
      ))!.id;
      await store.bulkInsert(
        "history",
        history.map((row, index) => ({
          id: lastId + index + 1,
          ...row,
        })),
      );
    });
}
