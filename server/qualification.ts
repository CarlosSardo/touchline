import { Store } from "./db.ts";
import type { Club, Country, Standing } from "../shared/types.ts";

export interface AssociationCoefficient {
  countryId: number;
  name: string;
  points: number;
  previousSeason: number;
  rank: number;
}
export interface QualificationEntry {
  club: Club;
  domesticPosition: number;
  associationRank: number;
  basis: string;
  coefficient: number;
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
    season - 5,
    season - 1,
  );
  const histories = new Map<number, typeof history>();
  for (const row of history) {
    const rows = histories.get(row.entity_id) ?? [];
    rows.push(row);
    histories.set(row.entity_id, rows);
  }
  return countries
    .map((country) => {
      const seasons = histories.get(country.id) ?? [];
      const totals = new Map(
        seasons.map((row) => [
          row.season,
          JSON.parse(row.data).points as number,
        ]),
      );
      let points = 0;
      for (let year = season - 5; year < season; year++)
        points += totals.get(year) ?? country.reputation / 5;
      return {
        countryId: country.id,
        name: country.name,
        points: Math.round(points * 1000) / 1000,
        previousSeason: totals.get(season - 1) ?? country.reputation / 5,
        rank: 0,
      };
    })
    .sort(
      (left, right) =>
        right.points - left.points ||
        right.previousSeason - left.previousSeason ||
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

export async function continentalEntries(
  store: Store,
  competition: string,
  season: number,
  excluded: Set<number>,
): Promise<QualificationEntry[]> {
  const associations = await associationCoefficients(store, "UEFA", season);
  const performance = [...associations]
    .sort((left, right) => right.previousSeason - left.previousSeason)
    .slice(0, 2)
    .map((entry) => entry.countryId);
  const entries: QualificationEntry[] = [];
  for (const association of associations) {
    const table = await domesticOrder(store, association.countryId, season);
    const championsPlaces =
      (association.rank <= 4
        ? 4
        : association.rank === 5
          ? 3
          : association.rank === 6
            ? 2
            : 1) + (performance.includes(association.countryId) ? 1 : 0);
    let selected: Club[];
    if (competition === "UEFA Champions League")
      selected = table.slice(0, championsPlaces);
    else if (competition === "UEFA Europa League")
      selected = table.slice(
        championsPlaces,
        championsPlaces + (association.rank <= 15 ? 2 : 1),
      );
    else
      selected = table.slice(
        championsPlaces + (association.rank <= 15 ? 2 : 1),
        championsPlaces +
          (association.rank <= 15 ? 2 : 1) +
          (association.rank <= 5 ? 1 : 2),
      );
    const cup = await store.get<{ data: string }>(
      "SELECT TOP (1) history.data FROM history JOIN leagues ON leagues.id = history.entity_id WHERE history.entity_type = 'champion' AND history.season = ? AND leagues.country_id = ? AND leagues.kind = 'cup' AND leagues.age_group = 'Senior' ORDER BY history.id DESC",
      season - 1,
      association.countryId,
    );
    const cupId: number | undefined = cup
      ? JSON.parse(cup.data).clubId
      : undefined;
    const cupWinner = cupId
      ? await store.get<Club>("SELECT * FROM clubs WHERE id = ?", cupId)
      : undefined;
    if (
      competition === "UEFA Europa League" &&
      cupWinner &&
      !excluded.has(cupWinner.id)
    )
      selected = [
        cupWinner,
        ...selected.filter((club) => club.id !== cupWinner.id),
      ].slice(0, association.rank <= 15 ? 2 : 1);
    for (const club of selected) {
      if (excluded.has(club.id)) continue;
      entries.push({
        club,
        domesticPosition: table.findIndex((entry) => entry.id === club.id) + 1,
        associationRank: association.rank,
        basis:
          club.id === cupId && competition === "UEFA Europa League"
            ? "Domestic cup winner"
            : "Domestic league position",
        coefficient: club.reputation,
      });
    }
  }
  const holderNames =
    competition === "UEFA Champions League"
      ? ["UEFA Champions League", "UEFA Europa League"]
      : competition === "UEFA Europa League"
        ? ["UEFA Conference League"]
        : [];
  const holders: QualificationEntry[] = [];
  for (const name of holderNames) {
    const champion = await store.get<{ data: string }>(
      "SELECT TOP (1) history.data FROM history JOIN leagues ON leagues.id = history.entity_id WHERE history.entity_type = 'champion' AND history.season = ? AND leagues.name = ? ORDER BY history.id DESC",
      season - 1,
      name,
    );
    const club = champion
      ? await store.get<Club>(
          "SELECT * FROM clubs WHERE id = ?",
          JSON.parse(champion.data).clubId,
        )
      : undefined;
    if (club && !excluded.has(club.id))
      holders.push({
        club,
        domesticPosition: 0,
        associationRank:
          associations.find((entry) => entry.countryId === club.country_id)
            ?.rank ?? 100,
        basis: `${name} titleholder`,
        coefficient: club.reputation,
      });
  }
  const holderIds = new Set(holders.map((entry) => entry.club.id));
  return [
    ...holders,
    ...entries
      .filter((entry) => !holderIds.has(entry.club.id))
      .sort(
        (left, right) =>
          left.associationRank - right.associationRank ||
          left.domesticPosition - right.domesticPosition,
      ),
  ];
}

export async function recordAssociationCoefficients(
  store: Store,
  season: number,
  date: string,
) {
  const rows = await store.all<{
    country_id: number;
    club_id: number;
    points: number;
  }>(
    `SELECT clubs.country_id,clubs.id AS club_id,sum(CASE WHEN fixtures.home_goals = fixtures.away_goals THEN 1 WHEN (fixtures.home_id = clubs.id AND fixtures.home_goals > fixtures.away_goals) OR (fixtures.away_id = clubs.id AND fixtures.away_goals > fixtures.home_goals) THEN 2 ELSE 0 END * CASE WHEN fixtures.stage = 'Qualifying' THEN 0.5 ELSE 1 END) AS points FROM fixtures JOIN leagues ON leagues.id = fixtures.league_id JOIN clubs ON clubs.id IN (fixtures.home_id,fixtures.away_id) WHERE fixtures.season = ? AND fixtures.status = 'played' AND leagues.confederation = 'UEFA' AND leagues.kind = 'continental' GROUP BY clubs.country_id,clubs.id ORDER BY clubs.id`,
    season,
  );
  const history: Record<string, string | number>[] = [];
  for (const countryId of new Set(rows.map((row) => row.country_id))) {
    const clubs = rows.filter((row) => row.country_id === countryId);
    const points =
      clubs.reduce((total, club) => total + club.points, 0) / clubs.length;
    history.push({
      season,
      entity_type: "associationCoefficient",
      entity_id: countryId,
      date,
      data: JSON.stringify({
        points,
        participants: clubs.length,
        basis:
          "Continental match points per entrant; seeded prehistory until five simulated seasons exist",
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
