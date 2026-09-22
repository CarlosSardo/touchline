import type { Store } from "./db.ts";
import { buildWorldStructure, ensureClubRosters } from "./world.ts";
import { clubIdentity, localizedLegacyClubName } from "./world-names.ts";
import { ensureClubSupport } from "./club-support.ts";
import { scheduleDomesticLeagues } from "./calendar.ts";
import {
  WORLD_VERSION,
  footballConfederation,
  minimumReserveTier,
  reservePolicy,
  reserveTeamName,
  youthGroups,
} from "../shared/world-rules.ts";
import type {
  Club,
  Country,
  GameState,
  League,
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

export async function expandWorld(store: Store) {
  const world = await store.meta<{
    version?: number;
    countries: number;
    expanded?: boolean;
  }>("world");
  if ((world.version ?? 1) >= WORLD_VERSION)
    return { changed: false, clubsAdded: 0, leaguesAdded: 0, playersAdded: 0 };
  const state = await store.meta<GameState>("state");
  const countries = await store.all<Country>(
    "SELECT * FROM countries ORDER BY id",
  );
  const blueprint = buildWorldStructure(
    { expanded: true, structureOnly: true, seed: state.seed },
    countries,
  );
  const counts = {
    changed: true,
    clubsAdded: 0,
    leaguesAdded: 0,
    playersAdded: 0,
  };
  return store.transaction(async () => {
    const currentWorld = await store.meta<{ version?: number }>("world");
    if ((currentWorld.version ?? 1) >= WORLD_VERSION)
      return { changed: false, clubsAdded: 0, leaguesAdded: 0, playersAdded: 0 };
    const sourceCountries = new Map(
      blueprint.countryRows.map((country) => [country.code, country]),
    );
    const blueprintClubs = blueprint.rows.clubs as unknown as Club[];
    const blueprintLeagues = blueprint.rows.leagues as unknown as League[];
    const sourceStaff = new Map<number, Staff[]>();
    for (const staff of blueprint.rows.staff as unknown as Staff[]) {
      const staffRows = sourceStaff.get(staff.club_id!) ?? [];
      staffRows.push(staff);
      sourceStaff.set(staff.club_id!, staffRows);
    }
    const newLeagues: number[] = [];
    const calendarExists = await store.get(
      "SELECT TOP (1) id FROM fixtures WHERE season = ?",
      state.season,
    );
    const activeFromSeason =
      !calendarExists && state.date === `${state.season}-07-01`
        ? state.season
        : state.season + 1;
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
              ...(activeFromSeason > state.season ? {
                promotion: 0,
                relegation: 0,
                pendingStructure: {
                  ...data,
                  fromSeason: activeFromSeason,
                  worldVersion: WORLD_VERSION,
                },
              } : {}),
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
        const originalNames = new Map(currentClubs.map((club) => [club.id, club.name]));
        const usedNames = new Set(currentClubs.map((club) => club.name));
        for (const [index, club] of currentClubs.entries()) {
          const data = JSON.parse(club.data);
          let variant = index;
          let name = localizedLegacyClubName(country, club.name, club.city, variant);
          while (name !== club.name && usedNames.has(name))
            name = localizedLegacyClubName(country, club.name, club.city, ++variant);
          if (!data.worldKey || name !== club.name) {
            const nextData = JSON.stringify({
              ...data,
              worldKey: data.worldKey ?? `${country.code}:club:${index}`,
              worldVersion: WORLD_VERSION,
              ...(name !== club.name ? { legacyName: data.legacyName ?? club.name } : {}),
            });
            await store.run(
              "UPDATE clubs SET name = ?, data = ? WHERE id = ?",
              name,
              nextData,
              club.id,
            );
            usedNames.delete(club.name);
            usedNames.add(name);
            club.name = name;
            club.data = nextData;
          }
        }
        const divisions = await store.all<League>(
          "SELECT * FROM leagues WHERE country_id = ? AND kind = 'league' AND age_group = 'Senior' AND tier > 0 AND coalesce(JSON_VALUE(data,'$.reserveOnly'),'false') NOT IN ('true','1') ORDER BY tier",
          country.id,
        );
        const sourceDivisions = blueprintLeagues.filter(
          (league) =>
            league.country_id === sourceCountry.id &&
            league.kind === "league" &&
            league.age_group === "Senior" &&
            league.tier > 0 &&
            !JSON.parse(league.data).reserveOnly,
        );
        let ordinal = Math.max(
          currentClubs.length,
          ...currentClubs.map((club) => {
            const key = JSON.parse(club.data).worldKey;
            const prefix = `${country.code}:club:`;
            const index = typeof key === "string" && key.startsWith(prefix)
              ? Number(key.slice(prefix.length))
              : -1;
            return Number.isSafeInteger(index) ? index + 1 : 0;
          }),
        );
        const copyClub = async (
          source: Club,
          leagueId: number | null,
          parent: Club | null = null,
          admission: Record<string, number> = {},
        ) => {
          let identity = clubIdentity(country, ordinal);
          while (!parent && usedNames.has(identity.name))
            identity = clubIdentity(country, ++ordinal);
          const worldKey = parent
            ? `${JSON.parse(parent.data).worldKey}:reserves`
            : `${country.code}:club:${ordinal++}`;
          const name = parent
            ? reserveTeamName(parent.name, country.code)
            : identity.name;
          usedNames.add(name);
          const id = await insertRow(store, "clubs", source, {
            country_id: country.id,
            league_id: leagueId,
            parent_id: parent?.id ?? null,
            name,
            city: parent?.city ?? identity.city,
            short_name: parent ? `${parent.short_name}B` : identity.shortName,
            data: JSON.stringify({
              ...JSON.parse(source.data),
              worldKey,
              worldVersion: WORLD_VERSION,
              activeFromSeason,
              ...admission,
              managerCareer: [{ season: state.season, club: name }],
            }),
          });
          if (leagueId !== null)
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
          const templates = sourceClubs.filter(
            (club) => club.league_id === division.id,
          );
          const existing = divisions.filter(
            (league) => league.tier === division.tier,
          );
          const rules = JSON.parse(division.data);
          const id = existing[0]?.id ?? await addLeague(
            country, division.name, division.tier, "Senior", rules,
          );
          if (existing.length)
            await store.run(
              "UPDATE leagues SET data = ? WHERE id = ?",
              JSON.stringify({
                ...JSON.parse(existing[0].data),
                pendingStructure: {
                  name: division.name,
                  promotion: rules.promotion,
                  relegation: rules.relegation,
                  targetFirstTeams: templates.length,
                  fromSeason: activeFromSeason,
                  worldVersion: WORLD_VERSION,
                },
              }),
              id,
            );
          const existingIds = new Set(existing.map((league) => league.id));
          const occupied = currentClubs.filter((club) =>
            (club.league_id !== null && existingIds.has(club.league_id)) ||
            existingIds.has(Number(JSON.parse(club.data).pendingSeniorLeague)),
          ).length;
          for (let index = occupied; index < templates.length; index++) {
            await copyClub(
              templates[index],
              existing.length ? null : id,
              null,
              existing.length
                ? { pendingSeniorLeague: id, admitFromSeason: activeFromSeason }
                : {},
            );
          }
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
          const parent = currentClubs.find((club) => club.id === reserve.parent_id);
          const originalParent = originalNames.get(reserve.parent_id ?? -1);
          const name = parent && originalParent && parent.name !== originalParent &&
            [reserveTeamName(originalParent, country.code), `${originalParent} B`].includes(reserve.name)
            ? reserveTeamName(parent.name, country.code)
            : reserve.name;
          await store.run(
            "UPDATE clubs SET name = ?, data = ? WHERE id = ?",
            name,
            JSON.stringify({
              ...JSON.parse(reserve.data),
              ...(name !== reserve.name ? { legacyName: reserve.name } : {}),
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
            const existingDevelopment = await store.get<League>(
              "SELECT TOP (1) * FROM leagues WHERE country_id = ? AND kind = 'league' AND age_group = 'Senior' AND JSON_VALUE(data,'$.reserveOnly') IN ('true','1') ORDER BY id",
              country.id,
            );
            const leagueId = existingDevelopment?.id ?? await addLeague(
              country,
              `${country.name} Development League`,
              policy.mode === "separate" ? (policy.entryTier ?? 0) : 0,
              "Senior",
              {
                reserveOnly: true,
                reserveCompetition: policy.competition,
                promotion: 0,
                relegation: 0,
                reservePolicy: policy,
              },
            );
            for (const [index, parent] of missingParents.entries()) {
              await copyClub(
                sourceReserves[index % sourceReserves.length],
                leagueId,
                parent,
                policy.mode === "pyramid"
                  ? {
                      pendingSeniorTier: Math.max(
                        policy.entryTier!,
                        minimumReserveTier(country.code, 1),
                      ),
                      admitFromSeason: activeFromSeason,
                    }
                  : {},
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
          if (!missing.length) continue;
          const existingGroups = await store.all<{ id: number; members: number }>(
            "SELECT leagues.id,count(standings.club_id) AS members FROM leagues LEFT JOIN standings ON standings.league_id = leagues.id WHERE leagues.country_id = ? AND leagues.kind = 'league' AND leagues.age_group = ? GROUP BY leagues.id ORDER BY count(standings.club_id),leagues.id",
            country.id,
            age,
          );
          const deferYouthMembership = async (club: Club, leagueId: number) => {
            const data = JSON.parse(club.data);
            await store.run(
              "UPDATE clubs SET data = ? WHERE id = ?",
              JSON.stringify({
                ...data,
                admitFromSeason: Math.max(data.admitFromSeason ?? 0, activeFromSeason),
                pendingYouthLeagues: { ...data.pendingYouthLeagues, [age]: leagueId },
              }),
              club.id,
            );
          };
          if (missing.length === 1 && existingGroups.some((group) => group.members < 16)) {
            await deferYouthMembership(
              missing[0],
              existingGroups.find((group) => group.members < 16)!.id,
            );
            continue;
          }
          for (const [index, group] of youthGroups(missing).entries()) {
            const id = await addLeague(
              country,
              `${country.name} ${age} Development - Group ${existingGroups.length + index + 1}`,
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
            if (group.length === 1 && existingGroups.length) {
              const companion = await store.get<Club>(
                "SELECT TOP (1) clubs.* FROM clubs JOIN standings ON standings.club_id = clubs.id WHERE standings.league_id = ? ORDER BY clubs.id DESC",
                existingGroups[0].id,
              );
              if (companion) await deferYouthMembership(companion, id);
            }
          }
        }
      }
      await flushClubs();
      counts.playersAdded = await ensureClubRosters(store);
      await ensureClubSupport(store);
      const addedLeagues = new Set(newLeagues);
      await scheduleDomesticLeagues(
        store,
        (
          await store.all<League>(
            "SELECT * FROM leagues WHERE kind = 'league' ORDER BY id",
          )
        ).filter((league) =>
          activeFromSeason === state.season || addedLeagues.has(league.id),
        ),
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
    return { ...counts, activeFromSeason };
  });
}
