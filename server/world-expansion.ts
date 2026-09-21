import seedrandom from "seedrandom";
import { Store } from "./db.ts";
import { generateWorld, ensureClubRosters } from "./world.ts";
import {
  clubIdentity,
  culturalPersonName,
  playerBackground,
} from "./world-names.ts";
import { ensureClubSupport } from "./club-support.ts";
import { scheduleDomesticLeagues } from "./calendar.ts";
import {
  WORLD_VERSION,
  footballConfederation,
  reservePolicy,
  reserveTeamName,
  youthGroups,
} from "../shared/world-rules.ts";
import type {
  Club,
  Country,
  GameState,
  League,
  PlayerProfile,
  Staff,
} from "../shared/types.ts";

async function insertRow(
  store: Store,
  table: "clubs" | "leagues" | "staff",
  row: object,
  overrides: Record<string, string | number | null> = {},
) {
  const { id: _id, ...values } = { ...row, ...overrides } as Record<
    string,
    string | number | null
  >;
  return Number(
    (
      await store.run(
        `INSERT INTO ${table} (${Object.keys(values).join(",")}) VALUES (${Object.keys(
          values,
        )
          .map(() => "?")
          .join(",")})`,
        ...Object.values(values),
      )
    ).lastInsertRowid,
  );
}

async function updateExpansionRows(
  store: Store,
  table: "players" | "clubs" | "staff",
  rows: Record<string, string | number | null>[],
  columns: string,
  assignments: string,
) {
  for (let offset = 0; offset < rows.length; offset += 1000)
    await store.run(
      `UPDATE target SET ${assignments} FROM ${table} AS target JOIN OPENJSON(?) WITH (${columns}) AS source ON source.id = target.id`,
      JSON.stringify(rows.slice(offset, offset + 1000)),
    );
}

export async function expandWorld(store: Store) {
  const world = await store.meta<{
    version?: number;
    countries: number;
    expanded?: boolean;
  }>("world");
  if ((world.version ?? 1) >= WORLD_VERSION)
    return { changed: false, clubsAdded: 0, leaguesAdded: 0, playersAdded: 0 };
  const state = await store.meta<GameState>("state");
  const blueprint = await Store.createTest("world-expansion");
  const counts = {
    changed: true,
    clubsAdded: 0,
    leaguesAdded: 0,
    playersAdded: 0,
  };
  try {
    await blueprint.schema();
    await generateWorld(blueprint, {
      expanded: true,
      structureOnly: true,
      countryLimit: world.countries,
      seed: state.seed,
    });
    const sourceCountries = new Map(
      (await blueprint.all<Country>("SELECT * FROM countries")).map(
        (country) => [country.code, country],
      ),
    );
    const blueprintClubs = await blueprint.all<Club>(
      "SELECT * FROM clubs ORDER BY id",
    );
    const blueprintLeagues = await blueprint.all<League>(
      "SELECT * FROM leagues ORDER BY tier,id",
    );
    const sourceStaff = new Map<number, Staff[]>();
    for (const staff of await blueprint.all<Staff>(
      "SELECT * FROM staff WHERE club_id IS NOT NULL ORDER BY id",
    )) {
      const staffRows = sourceStaff.get(staff.club_id!) ?? [];
      staffRows.push(staff);
      sourceStaff.set(staff.club_id!, staffRows);
    }
    const newLeagues: number[] = [];
    const activeFromSeason =
      state.date < `${state.season}-08-01` ? state.season : state.season + 1;
    const addLeague = async (
      country: Country,
      name: string,
      tier: number,
      age: string,
      data: object,
    ) => {
      const id = Number(
        (
          await store.run(
            "INSERT INTO leagues(name,country_id,confederation,tier,age_group,kind,reputation,format,data) VALUES (?,?,?,?,?,'league',?,'Double round-robin',?)",
            name,
            country.id,
            country.confederation,
            tier,
            age,
            Math.max(10, country.reputation - Math.max(0, tier - 1) * 10),
            JSON.stringify({
              ...data,
              activeFromSeason,
              worldVersion: WORLD_VERSION,
            }),
          )
        ).lastInsertRowid,
      );
      newLeagues.push(id);
      counts.leaguesAdded++;
      return id;
    };
    await store.transaction(async () => {
      const countries = await store.all<Country>(
        "SELECT * FROM countries ORDER BY id",
      );
      let nextStaffId = (await store.get<{ id: number }>(
        "SELECT coalesce(max(id),0) AS id FROM staff WITH (UPDLOCK,HOLDLOCK)",
      ))!.id;
      let newStandings: { league_id: number; club_id: number }[] = [];
      let newClubPlans: { club_id: number }[] = [];
      const flushClubs = async () => {
        if (!newClubPlans.length) return;
        await store.bulkInsert("standings", newStandings);
        await store.bulkInsert("training_plans", newClubPlans);
        await store.bulkInsert("set_pieces", newClubPlans);
        newStandings = [];
        newClubPlans = [];
      };
      for (const country of countries) {
        country.confederation = footballConfederation(
          country.code,
          country.continent,
        );
        await store.run(
          "UPDATE countries SET confederation = ? WHERE id = ?",
          country.confederation,
          country.id,
        );
        await store.run(
          "UPDATE leagues SET confederation = ? WHERE country_id = ?",
          country.confederation,
          country.id,
        );
        const sourceCountry = sourceCountries.get(country.code);
        if (!sourceCountry) continue;
        const sourceClubs = blueprintClubs.filter(
          (club) =>
            club.country_id === sourceCountry.id && club.type === "club",
        );
        const currentClubs = await store.all<Club>(
          "SELECT * FROM clubs WHERE country_id = ? AND type = 'club' ORDER BY id",
          country.id,
        );
        const sourceByKey = new Map(
          sourceClubs.map((club) => [
            JSON.parse(club.data).worldKey as string,
            club,
          ]),
        );
        const clubUpdates = currentClubs.map((club, index) => {
          const data = JSON.parse(club.data);
          const identity = clubIdentity(country, index);
          return {
            id: club.id,
            name: club.id === state.clubId ? club.name : identity.name,
            city: identity.city,
            short_name: identity.shortName,
            data: JSON.stringify({
              ...data,
              worldKey: `${country.code}:club:${index}`,
              worldVersion: WORLD_VERSION,
              previousName: data.previousName ?? club.name,
            }),
          };
        });
        await updateExpansionRows(
          store,
          "clubs",
          clubUpdates,
          "id int,name nvarchar(max),city nvarchar(max),short_name nvarchar(max),data nvarchar(max)",
          "name = source.name, city = source.city, short_name = source.short_name, data = source.data",
        );
        const divisions = await store.all<League>(
          "SELECT * FROM leagues WHERE country_id = ? AND kind = 'league' AND age_group = 'Senior' AND tier > 0 AND coalesce(JSON_VALUE(data,'$.reserveOnly'),'false') NOT IN ('true','1') ORDER BY tier",
          country.id,
        );
        const highestExistingTier = Math.max(
          0,
          ...divisions.map((league) => league.tier),
        );
        const sourceDivisions = blueprintLeagues.filter(
          (league) =>
            league.country_id === sourceCountry.id &&
            league.kind === "league" &&
            league.age_group === "Senior" &&
            league.tier > highestExistingTier &&
            !JSON.parse(league.data).reserveOnly,
        );
        let ordinal = currentClubs.length;
        const copyClub = async (
          source: Club,
          leagueId: number,
          parent: Club | null = null,
        ) => {
          const identity = clubIdentity(country, ordinal);
          const worldKey = parent
            ? `${JSON.parse(parent.data).worldKey}:reserves`
            : `${country.code}:club:${ordinal++}`;
          const id = await insertRow(store, "clubs", source, {
            country_id: country.id,
            league_id: leagueId,
            parent_id: parent?.id ?? null,
            name: parent
              ? reserveTeamName(parent.name, country.code)
              : identity.name,
            city: parent?.city ?? identity.city,
            short_name: parent ? `${parent.short_name}B` : identity.shortName,
            data: JSON.stringify({
              ...JSON.parse(source.data),
              worldKey,
              worldVersion: WORLD_VERSION,
            }),
          });
          newStandings.push({ league_id: leagueId, club_id: id });
          newClubPlans.push({ club_id: id });
          if (newClubPlans.length === 1000) await flushClubs();
          const staffRows = (sourceStaff.get(source.id) ?? []).map((staff) => ({
            ...staff,
            id: ++nextStaffId,
            club_id: id,
          }));
          if (staffRows.length) await store.bulkInsert("staff", staffRows);
          counts.clubsAdded++;
          return id;
        };
        for (const division of sourceDivisions) {
          const id = await addLeague(
            country,
            division.name,
            division.tier,
            "Senior",
            JSON.parse(division.data),
          );
          for (const source of sourceClubs.filter(
            (club) => club.league_id === division.id,
          )) {
            await copyClub(
              sourceByKey.get(`${country.code}:club:${ordinal}`) ?? source,
              id,
            );
          }
        }
        if (sourceDivisions.length && divisions.length) {
          const lowest = divisions.at(-1)!;
          const data = JSON.parse(lowest.data);
          await store.run(
            "UPDATE leagues SET data = ? WHERE id = ?",
            JSON.stringify({
              ...data,
              relegation: sourceDivisions[0]
                ? JSON.parse(sourceDivisions[0].data).promotion
                : 0,
              movementFromSeason: activeFromSeason,
            }),
            lowest.id,
          );
        }
        const policy = reservePolicy(country.code);
        const sourceReserves = blueprintClubs.filter(
          (club) =>
            club.country_id === sourceCountry.id && club.type === "bteam",
        );
        const existingReserves = await store.all<Club>(
          "SELECT * FROM clubs WHERE country_id = ? AND type = 'bteam'",
          country.id,
        );
        for (const reserve of existingReserves) {
          const parent = (await store.get<Club>(
            "SELECT * FROM clubs WHERE id = ?",
            reserve.parent_id!,
          ))!;
          await store.run(
            "UPDATE clubs SET name = ?,data = ? WHERE id = ?",
            reserveTeamName(parent.name, country.code),
            JSON.stringify({
              ...JSON.parse(reserve.data),
              reservePolicy: policy,
              worldVersion: WORLD_VERSION,
            }),
            reserve.id,
          );
        }
        if (policy.mode !== "unverified" && sourceReserves.length) {
          const parents = await store.all<Club>(
            "SELECT TOP (4) clubs.* FROM clubs JOIN leagues ON leagues.id = clubs.league_id WHERE clubs.country_id = ? AND clubs.type = 'club' AND leagues.tier = 1 ORDER BY clubs.reputation DESC,clubs.id",
            country.id,
          );
          const missingParents = parents.filter(
            (parent) =>
              !existingReserves.some(
                (reserve) => reserve.parent_id === parent.id,
              ),
          );
          if (missingParents.length) {
            const leagueId = await addLeague(
              country,
              `${country.name} Development League`,
              policy.mode === "separate" ? (policy.entryTier ?? 0) : 0,
              "Senior",
              {
                reserveOnly: true,
                promotion: 0,
                relegation: 0,
                reservePolicy: policy,
              },
            );
            for (const [index, parent] of missingParents.entries()) {
              const id = await copyClub(
                sourceReserves[index % sourceReserves.length],
                leagueId,
                parent,
              );
              if (policy.mode === "pyramid")
                await store.run(
                  "UPDATE clubs SET data = JSON_MODIFY(JSON_MODIFY(data,'$.pendingSeniorTier',?),'$.admitFromSeason',?) WHERE id = ?",
                  policy.entryTier!,
                  state.season + 1,
                  id,
                );
            }
          }
        }
        for (const age of ["U19", "U17"] as const) {
          const missing = await store.all<Club>(
            "SELECT * FROM clubs WHERE country_id = ? AND type != 'national' AND NOT EXISTS (SELECT 1 FROM standings JOIN leagues ON leagues.id = standings.league_id WHERE standings.club_id = clubs.id AND leagues.kind = 'league' AND leagues.age_group = ?)",
            country.id,
            age,
          );
          for (const [index, group] of youthGroups(missing).entries()) {
            const id = await addLeague(
              country,
              `${country.name} ${age} Development - Group ${index + 1}`,
              0,
              age,
              { youth: true, continental: 0, promotion: 0, relegation: 0 },
            );
            await store.bulkInsert(
              "standings",
              group.map((club) => ({
                league_id: id,
                club_id: club.id,
              })),
            );
          }
        }
        let playerCursor = 0;
        while (true) {
          const players = await store.all<{ id: number; profile: string }>(
            "SELECT TOP (1000) id,profile FROM players WHERE country_id = ? AND id > ? ORDER BY id",
            country.id,
            playerCursor,
          );
          if (!players.length) break;
          const updates = players.map((player) => {
            const profile = JSON.parse(player.profile) as PlayerProfile;
            profile.identity = {
              ...profile.identity,
              ...playerBackground(
                seedrandom(`${state.seed}:background:${player.id}`),
                country,
                countries,
              ),
            };
            const namingCountry =
              countries.find(
                (entry) => entry.id === profile.identity.nameOriginCountryId,
              ) ?? country;
            return {
              id: player.id,
              name: culturalPersonName(
                seedrandom(`${state.seed}:identity:${player.id}`),
                namingCountry,
              ),
              profile: JSON.stringify(profile),
            };
          });
          await updateExpansionRows(
            store,
            "players",
            updates,
            "id int,name nvarchar(max),profile nvarchar(max)",
            "name = source.name, profile = source.profile",
          );
          playerCursor = players.at(-1)!.id;
        }
        const managers = (
          await store.all<{ id: number }>(
            "SELECT id FROM clubs WHERE country_id = ? ORDER BY id",
            country.id,
          )
        ).map((club) => ({
          id: club.id,
          manager: culturalPersonName(
            seedrandom(`${state.seed}:manager:${club.id}`),
            country,
          ),
        }));
        await updateExpansionRows(
          store,
          "clubs",
          managers,
          "id int,manager nvarchar(max)",
          "manager = source.manager",
        );
        const staffNames = (
          await store.all<{ id: number }>(
            "SELECT staff.id FROM staff JOIN clubs ON clubs.id = staff.club_id WHERE clubs.country_id = ? ORDER BY staff.id",
            country.id,
          )
        ).map((staff) => ({
          id: staff.id,
          name: culturalPersonName(
            seedrandom(`${state.seed}:staff:${staff.id}`),
            country,
          ),
        }));
        await updateExpansionRows(
          store,
          "staff",
          staffNames,
          "id int,name nvarchar(max)",
          "name = source.name",
        );
      }
      await flushClubs();
      counts.playersAdded = await ensureClubRosters(store);
      const addedLeagues = new Set(newLeagues);
      await scheduleDomesticLeagues(
        store,
        (
          await store.all<League>(
            "SELECT * FROM leagues WHERE kind = 'league' ORDER BY id",
          )
        ).filter((league) => addedLeagues.has(league.id)),
        state.season,
        state.date,
      );
      await store.setMeta("world", {
        ...world,
        expanded: true,
        version: WORLD_VERSION,
        upgraded: state.date,
        activeFromSeason,
        clubs: (await store.get<{ total: number }>(
          "SELECT count(*) AS total FROM clubs WHERE type != 'national'",
        ))!.total,
        seniors: (await store.get<{ total: number }>(
          "SELECT count(*) AS total FROM players WHERE age_group = 'Senior'",
        ))!.total,
        youth: (await store.get<{ total: number }>(
          "SELECT count(*) AS total FROM players WHERE age_group != 'Senior'",
        ))!.total,
      });
    });
    await ensureClubSupport(store);
    return { ...counts, activeFromSeason };
  } finally {
    await blueprint.close();
  }
}
