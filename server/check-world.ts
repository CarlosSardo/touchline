// World v4 check: generates the curated world (or --nations=EN,ES) in an isolated schema and asserts the section 8 invariants.
import assert from "node:assert/strict";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { Store } from "./db.ts";
import { SQUAD_CAPS, firstTeamCap } from "./youth.ts";
import { generateWorld, type WorldOptions } from "./world.ts";
import {
  summarizeCatalog,
  worldCatalog,
  type CatalogLookup,
  type ReservePolicySpec,
} from "../shared/world-catalog/index.ts";
import { MIN_GOALKEEPERS, SQUAD_MINIMUMS, WORLD_VERSION } from "../shared/world-rules.ts";
import type { PlayerProfile } from "../shared/types.ts";

export async function checkSqlConstraints(store: Store) {
  assert(
    store.testMode && store.schemaName !== "dbo",
    "Checks require an isolated test schema",
  );
  const tables = await store.all<{ object_id: number; name: string }>(
    "SELECT object_id,name FROM sys.tables WHERE schema_id = SCHEMA_ID(?) ORDER BY name",
    store.schemaName,
  );
  assert(tables.length > 0, "The isolated schema must contain game tables");
  for (const table of tables) {
    assert(Number.isSafeInteger(table.object_id));
    const violations = await store.all(
      `DBCC CHECKCONSTRAINTS (${table.object_id}) WITH ALL_CONSTRAINTS, ALL_ERRORMSGS`,
    );
    assert.equal(
      violations.length,
      0,
      `${table.name}: SQL constraint violations`,
    );
  }
}

interface CountryRow { id: number; code: string }
interface LeagueRow { id: number; name: string; country_id: number; tier: number; age_group: string; data: string }
interface ClubRow {
  id: number;
  name: string;
  country_id: number;
  league_id: number | null;
  type: string;
  parent_id: number | null;
  age_group: string;
  wage_budget: number;
  data: string;
}
export interface WorldReport {
  totals: Record<string, number>;
  /** Section 8 violations at world start (first 250); empty when the world is valid. */
  problems: string[];
  problemCount: number;
}

const json = <Value>(text: string | null | undefined): Value =>
  (text ? JSON.parse(text) : {}) as Value;

/** FIFA Art. 19: a U18 player of another sporting nationality needs its citizenship, birth there, a family move or the EU/EEA 16+ route. */
export function hasMinorRoute(
  profile: PlayerProfile,
  age: number,
  club: { countryId: number; code: string },
  lookup: CatalogLookup = worldCatalog(),
): boolean {
  const held = (profile.identity.nationalities ?? []).map((entry) => entry.code);
  return (
    held.some((code) => lookup.citizenshipGroup(code) === lookup.citizenshipGroup(club.code)) ||
    profile.identity.birthCountryId === club.countryId ||
    profile.familyMove?.countryId === club.countryId ||
    (age >= 16 && lookup.nationByCode(club.code)?.euEea === true && lookup.hasEuEeaNationality(held))
  );
}

/** Section 8 structure, squad, orphan, registration and value invariants of a freshly generated world. */
export async function verifyWorld(
  store: Store,
  options: { nations?: string[]; lookup?: CatalogLookup } = {},
): Promise<WorldReport> {
  const lookup = options.lookup ?? worldCatalog();
  const problems: string[] = [];
  let problemCount = 0;
  const fail = (message: string) => {
    if (++problemCount <= 250) problems.push(message);
  };
  const countries = await store.all<CountryRow>("SELECT id, code FROM countries");
  const leagues = await store.all<LeagueRow>("SELECT id, name, country_id, tier, age_group, data FROM leagues");
  const clubs = await store.all<ClubRow>(
    "SELECT id, name, country_id, league_id, type, parent_id, age_group, wage_budget, data FROM clubs",
  );
  const standings = await store.all<{ league_id: number; club_id: number }>(
    "SELECT league_id, club_id FROM standings",
  );
  const codeOf = new Map(countries.map((country) => [country.id, country.code]));
  const leagueById = new Map(leagues.map((league) => [league.id, league]));
  const clubById = new Map(clubs.map((club) => [club.id, club]));
  const leagueData = new Map(leagues.map((league) => [league.id, json<Record<string, unknown>>(league.data)]));
  const clubData = new Map(clubs.map((club) => [club.id, json<Record<string, unknown>>(club.data)]));
  const expected = options.nations?.length
    ? options.nations
    : lookup.allNations().map((nation) => nation.code);

  // 1. Structure.
  if (countries.length !== expected.length) fail(`countries: ${countries.length}, expected ${expected.length}`);
  const members = new Map<number, number[]>();
  for (const row of standings) {
    if (!leagueById.has(row.league_id)) fail(`standing references missing league ${row.league_id}`);
    if (!clubById.has(row.club_id)) fail(`standing references missing club ${row.club_id}`);
    members.set(row.league_id, [...(members.get(row.league_id) ?? []), row.club_id]);
  }
  const seniorTiers = new Map<number, number>();
  for (const league of leagues) {
    const data = leagueData.get(league.id)!;
    if (data.worldVersion !== WORLD_VERSION) fail(`${league.name}: league.data.worldVersion is not ${WORLD_VERSION}`);
    if (league.age_group !== "Senior" || league.tier <= 0) continue;
    seniorTiers.set(league.country_id, (seniorTiers.get(league.country_id) ?? 0) + 1);
    const code = codeOf.get(league.country_id)!;
    const spec = lookup.nationByCode(code)?.football?.leagues.find((tier) => tier.tier === league.tier);
    const entrants = members.get(league.id) ?? [];
    const bTeams = entrants.filter((id) => clubById.get(id)?.type === "bteam").length;
    if (!spec) fail(`${league.name}: no catalog tier ${code} ${league.tier}`);
    else {
      if (entrants.length !== spec.size) fail(`${league.name}: ${entrants.length} clubs, catalog size ${spec.size}`);
      if (bTeams !== (spec.bTeams ?? 0)) fail(`${league.name}: ${bTeams} B-teams, catalog ${spec.bTeams ?? 0}`);
    }
  }
  for (const country of countries) {
    const tiers = lookup.nationByCode(country.code)?.football?.leagues.length ?? 0;
    if ((seniorTiers.get(country.id) ?? 0) !== tiers)
      fail(`${country.code}: ${seniorTiers.get(country.id) ?? 0} senior tiers, catalog ${tiers}`);
  }
  const seniorOf = new Map<number, number[]>();
  const youthOf = new Map<number, { U19: number[]; U17: number[] }>();
  for (const row of standings) {
    const league = leagueById.get(row.league_id);
    if (!league) continue;
    if (league.age_group === "Senior") seniorOf.set(row.club_id, [...(seniorOf.get(row.club_id) ?? []), league.id]);
    else if (league.age_group === "U19" || league.age_group === "U17") {
      const entry = youthOf.get(row.club_id) ?? { U19: [], U17: [] };
      entry[league.age_group].push(league.id);
      youthOf.set(row.club_id, entry);
    }
  }
  const bTeamsByNation = new Map<string, number>();
  const reserveTeamsByNation = new Map<string, number>();
  for (const club of clubs) {
    if (club.type === "national") {
      if (club.league_id !== null || seniorOf.has(club.id)) fail(`${club.name}: national team in a league`);
      continue;
    }
    const data = clubData.get(club.id)!;
    const senior = seniorOf.get(club.id) ?? [];
    if (senior.length !== 1 || senior[0] !== club.league_id)
      fail(`${club.name}: in ${senior.length} senior leagues (league_id ${club.league_id})`);
    const league = club.league_id ? leagueById.get(club.league_id) : undefined;
    if (!league) {
      fail(`${club.name}: missing league ${club.league_id}`);
      continue;
    }
    if (data.worldVersion !== WORLD_VERSION || typeof data.worldKey !== "string")
      fail(`${club.name}: club.data needs worldVersion ${WORLD_VERSION} and worldKey`);
    const hosted = data.hosted as { host?: string; youth?: string } | undefined;
    const leagueCode = codeOf.get(league.country_id);
    if (hosted && leagueCode !== hosted.host) fail(`${club.name}: hosted club plays in ${leagueCode}, not ${hosted.host}`);
    if (!hosted && club.type === "club" && league.country_id !== club.country_id)
      fail(`${club.name}: plays abroad without a cross-border spec`);
    const youth = youthOf.get(club.id) ?? { U19: [], U17: [] };
    if (club.type === "club") {
      if (youth.U19.length !== 1 || youth.U17.length !== 1)
        fail(`${club.name}: in ${youth.U19.length} U19 and ${youth.U17.length} U17 leagues`);
      const youthCode = hosted?.youth === "host" ? hosted.host : codeOf.get(club.country_id);
      for (const id of [...youth.U19, ...youth.U17]) {
        const actual = codeOf.get(leagueById.get(id)!.country_id);
        if (actual !== youthCode) fail(`${club.name}: youth team plays in ${actual}, not ${youthCode}`);
      }
    }
    if (club.type !== "bteam") continue;
    if (youth.U19.length || youth.U17.length) fail(`${club.name}: B-team in a youth league`);
    const parent = club.parent_id ? clubById.get(club.parent_id) : undefined;
    const policy = data.reservePolicy as ReservePolicySpec | undefined;
    const code = codeOf.get(club.country_id)!;
    const reserves = lookup.nationByCode(code)?.football?.reserves;
    if (!parent || parent.type !== "club") fail(`${club.name}: B-team without a first-team parent`);
    if (league.tier === 0) {
      const host = reserves?.reserveLeague?.host ?? code;
      if (reserves?.mode !== "reserve-league") fail(`${club.name}: ${code} has no reserve league`);
      if (!leagueData.get(league.id)!.reserveOnly || leagueCode !== host)
        fail(`${club.name}: tier-0 league ${league.name} is not the ${host} reserve league`);
      reserveTeamsByNation.set(code, (reserveTeamsByNation.get(code) ?? 0) + 1);
    } else {
      if (reserves?.mode !== "pyramid") fail(`${club.name}: ${code} allows no pyramid B-teams`);
      bTeamsByNation.set(code, (bTeamsByNation.get(code) ?? 0) + 1);
      const parentTier = parent?.league_id ? leagueById.get(parent.league_id)?.tier ?? 0 : 0;
      const gap = policy?.pyramid?.minGapBelowParent ?? 1;
      if (league.tier < parentTier + Math.max(1, gap))
        fail(`${club.name}: tier ${league.tier} is not ${Math.max(1, gap)} below the parent's tier ${parentTier}`);
      if (policy?.pyramid && league.tier < policy.pyramid.highestTier)
        fail(`${club.name}: above the highest B-team tier ${policy.pyramid.highestTier}`);
    }
  }
  for (const code of expected) {
    const football = lookup.nationByCode(code)?.football;
    const planned = (football?.leagues ?? []).reduce((total, tier) => total + (tier.bTeams ?? 0), 0);
    if ((bTeamsByNation.get(code) ?? 0) !== planned)
      fail(`${code}: ${bTeamsByNation.get(code) ?? 0} pyramid B-teams, catalog ${planned}`);
    const cap = football?.reserves.mode === "reserve-league" ? football.reserves.eligibility?.maxTeams ?? 0 : 0;
    if ((reserveTeamsByNation.get(code) ?? 0) > cap)
      fail(`${code}: ${reserveTeamsByNation.get(code)} reserve-league B-teams, cap ${cap}`);
  }
  for (const league of leagues) {
    if (league.age_group === "Senior") continue;
    const size = members.get(league.id)?.length ?? 0;
    if (size < 2 || size > 16) fail(`${league.name}: youth league of ${size} clubs (2-16)`);
  }
  const national = clubs.filter((club) => club.type === "national");
  if (national.length !== countries.length * 4)
    fail(`${national.length} national teams, expected ${countries.length * 4}`);
  const nationalGroups = new Map<number, string[]>();
  for (const team of national)
    nationalGroups.set(team.country_id, [...(nationalGroups.get(team.country_id) ?? []), team.age_group]);
  for (const country of countries) {
    const groups = (nationalGroups.get(country.id) ?? []).sort().join(",");
    if (groups !== "Senior,U17,U19,U20") fail(`${country.code}: national teams ${groups || "none"}, expected Senior,U17,U19,U20`);
  }

  // 2. Squads.
  const squads = await store.all<{ club_id: number; age_group: string; total: number; keepers: number }>(
    "SELECT club_id, age_group, count(*) AS total, sum(CASE WHEN position = 'GK' THEN 1 ELSE 0 END) AS keepers FROM players WHERE club_id IS NOT NULL GROUP BY club_id, age_group",
  );
  const squadOf = new Map(squads.map((row) => [`${row.club_id}:${row.age_group}`, row]));
  for (const club of clubs) {
    const league = club.league_id ? leagueById.get(club.league_id) : undefined;
    const firstTeam = firstTeamCap(league ? codeOf.get(league.country_id) : null, league?.tier ?? null);
    const groups: [string, number, number][] =
      club.type === "club"
        ? [["Senior", SQUAD_MINIMUMS.Senior, firstTeam], ["U19", SQUAD_MINIMUMS.U19, SQUAD_CAPS.youth], ["U17", SQUAD_MINIMUMS.U17, SQUAD_CAPS.youth]]
        : club.type === "bteam"
          ? [["Senior", SQUAD_MINIMUMS.BTeam, SQUAD_CAPS.bTeam]]
          : [];
    for (const [ageGroup, minimum, maximum] of groups) {
      const row = squadOf.get(`${club.id}:${ageGroup}`);
      const total = row?.total ?? 0;
      if (total < minimum || total > maximum) fail(`${club.name} ${ageGroup}: ${total} players (${minimum}-${maximum})`);
      if ((row?.keepers ?? 0) < MIN_GOALKEEPERS) fail(`${club.name} ${ageGroup}: ${row?.keepers ?? 0} goalkeepers`);
    }
    if (club.type === "bteam" && (squadOf.has(`${club.id}:U19`) || squadOf.has(`${club.id}:U17`)))
      fail(`${club.name}: B-team with youth players`);
  }
  const contractedAtNational = (await store.get<{ total: number }>(
    "SELECT count(*) AS total FROM players JOIN clubs ON clubs.id = players.club_id WHERE clubs.type = 'national'",
  ))!.total;
  if (contractedAtNational) fail(`${contractedAtNational} players contracted to national teams`);
  const bTeamIds = clubs.filter((club) => club.type === "bteam").map((club) => club.id);
  if (bTeamIds.length) {
    const ages = await store.all<{ club_id: number; age: number }>(
      "SELECT coalesce(squad_club_id, club_id) AS club_id, age FROM players WHERE coalesce(squad_club_id, club_id) IN (SELECT id FROM clubs WHERE type = 'bteam')",
    );
    for (const club of clubs.filter((entry) => entry.type === "bteam")) {
      const rule = (clubData.get(club.id)!.reservePolicy as ReservePolicySpec | undefined)?.ageRule;
      if (!rule) continue;
      const count = ages.filter((row) => row.club_id === club.id && row.age > rule.maxAge).length;
      if (count > rule.overage) fail(`${club.name}: ${count} players over ${rule.maxAge} (limit ${rule.overage})`);
    }
  }

  // 3. No orphans.
  const orphans = await store.all<{ label: string; total: number }>(
    `SELECT 'players.club_id' AS label, count(*) AS total FROM players LEFT JOIN clubs ON clubs.id = players.club_id WHERE players.club_id IS NOT NULL AND clubs.id IS NULL
     UNION ALL SELECT 'players.country_id', count(*) FROM players LEFT JOIN countries ON countries.id = players.country_id WHERE countries.id IS NULL
     UNION ALL SELECT 'staff.club_id', count(*) FROM staff LEFT JOIN clubs ON clubs.id = staff.club_id WHERE staff.club_id IS NOT NULL AND clubs.id IS NULL
     UNION ALL SELECT 'clubs.parent_id', count(*) FROM clubs LEFT JOIN clubs AS parents ON parents.id = clubs.parent_id WHERE clubs.parent_id IS NOT NULL AND parents.id IS NULL
     UNION ALL SELECT 'clubs.league_id', count(*) FROM clubs LEFT JOIN leagues ON leagues.id = clubs.league_id WHERE clubs.league_id IS NOT NULL AND leagues.id IS NULL
     UNION ALL SELECT 'home-based without profile.homeBased', count(*) FROM players WHERE club_id IS NULL AND JSON_VALUE(profile,'$.homeBased.countryId') IS NULL
     UNION ALL SELECT 'staff at B-teams or national teams', count(*) FROM staff JOIN clubs ON clubs.id = staff.club_id WHERE clubs.type != 'club'`,
  );
  for (const row of orphans) if (row.total) fail(`${row.label}: ${row.total} orphan rows`);
  const nationalRefs = await store.all<{ label: string; total: number }>(
    `SELECT 'players.parent_club_id' AS label, count(*) AS total FROM players JOIN clubs ON clubs.id = players.parent_club_id WHERE clubs.type = 'national'
     UNION ALL SELECT 'loans', count(*) FROM loans JOIN clubs ON clubs.id IN (loans.parent_id, loans.destination_id) WHERE clubs.type = 'national'
     UNION ALL SELECT 'negotiations', count(*) FROM negotiations JOIN clubs ON clubs.id IN (negotiations.buying_club_id, negotiations.selling_club_id) WHERE clubs.type = 'national'
     UNION ALL SELECT 'partnerships', count(*) FROM partnerships JOIN clubs ON clubs.id IN (partnerships.club_id, partnerships.partner_id) WHERE clubs.type = 'national'`,
  );
  for (const row of nationalRefs) if (row.total) fail(`${row.label}: ${row.total} rows reference national teams`);

  // 4. Registration: U18 players of another nationality joined by an allowed route (FIFA Art. 19).
  // A cross-border club is local both to its home nation and to the association it registers with (Derry City: FAI).
  const countryByCode = new Map(countries.map((country) => [country.code, country.id]));
  const localNations = (club: ClubRow) => {
    const hosted = clubData.get(club.id)!.hosted as { host: string; registration: string } | undefined;
    const host = hosted?.registration === "host" ? countryByCode.get(hosted.host) : undefined;
    return host && host !== club.country_id ? [club.country_id, host] : [club.country_id];
  };
  const minors = await store.all<{ name: string; age: number; club_id: number; country_id: number; profile: string }>(
    "SELECT players.name, players.age, players.club_id, players.country_id, players.profile FROM players JOIN clubs ON clubs.id = players.club_id WHERE players.age < 18 AND clubs.type != 'national' AND players.country_id != clubs.country_id",
  );
  let minorViolations = 0;
  let minorsAbroad = 0;
  for (const minor of minors) {
    const local = localNations(clubById.get(minor.club_id)!);
    if (local.includes(minor.country_id)) continue;
    minorsAbroad++;
    const profile = json<PlayerProfile>(minor.profile);
    const allowed = local.some((countryId) =>
      hasMinorRoute(profile, minor.age, { countryId, code: codeOf.get(countryId)! }, lookup),
    );
    if (!allowed && ++minorViolations <= 10)
      fail(`${minor.name} (${minor.age}) joined a ${codeOf.get(local[0])} club without an allowed U18 route`);
  }

  // 5. Values and wages.
  const values = (await store.get<{ bad: number; players: number }>(
    "SELECT sum(CASE WHEN value IS NULL OR value < 100 OR value > 250000000 OR wage IS NULL OR wage < 0 OR wage > 1200000 THEN 1 ELSE 0 END) AS bad, count(*) AS players FROM players",
  ))!;
  if (values.bad) fail(`${values.bad} players with value outside 100-250M or wage outside 0-1.2M/week`);
  const payrolls = await store.all<{ id: number; wage_budget: number; payroll: number }>(
    "SELECT clubs.id, clubs.wage_budget, sum(players.wage) AS payroll FROM clubs JOIN players ON players.club_id = clubs.id WHERE clubs.type != 'national' GROUP BY clubs.id, clubs.wage_budget",
  );
  const withinBudget = payrolls.filter((row) => row.payroll <= 1.1 * row.wage_budget).length;
  if (payrolls.length && withinBudget < 0.95 * payrolls.length)
    fail(`payroll within 1.1 × wage budget for ${withinBudget}/${payrolls.length} clubs (< 95%)`);

  const homeBased = (await store.get<{ total: number }>(
    "SELECT count(*) AS total FROM players WHERE club_id IS NULL",
  ))!.total;
  return {
    totals: {
      countries: countries.length,
      seniorLeagues: leagues.filter((league) => league.age_group === "Senior" && league.tier > 0).length,
      reserveLeagues: leagues.filter((league) => league.age_group === "Senior" && league.tier === 0).length,
      youthLeagues: leagues.filter((league) => league.age_group !== "Senior").length,
      firstTeams: clubs.filter((club) => club.type === "club").length,
      hostedClubs: clubs.filter((club) => clubData.get(club.id)!.hosted).length,
      bTeams: bTeamIds.length,
      nationalTeams: national.length,
      players: values.players,
      homeBased,
      minorsAbroad,
      clubsWithinPayroll: withinBudget,
    },
    problems,
    problemCount,
  };
}

/** Reserved and used KB and rows per table of the store's schema. */
export async function tableSizes(store: Store) {
  const rows = await store.all<{ name: string; rows: number | string; reservedKb: number | string; usedKb: number | string }>(
    `SELECT tables.name, max(CASE WHEN partitions.index_id IN (0, 1) THEN partitions.rows ELSE 0 END) AS rows,
       sum(units.total_pages) * 8 AS reservedKb, sum(units.used_pages) * 8 AS usedKb
     FROM sys.tables AS tables
     JOIN sys.partitions AS partitions ON partitions.object_id = tables.object_id
     JOIN sys.allocation_units AS units ON units.container_id = partitions.partition_id
     WHERE tables.schema_id = SCHEMA_ID(?)
     GROUP BY tables.name ORDER BY reservedKb DESC`,
    store.schemaName,
  );
  // bigint columns arrive as strings; summing them unconverted concatenated the text (reservedMb 1.6e67).
  return rows.map((row) => ({ name: row.name, rows: Number(row.rows), reservedKb: Number(row.reservedKb), usedKb: Number(row.usedKb) }));
}

const within = (actual: number, target: number, tolerance = 0.1) =>
  target === 0 ? actual === 0 : Math.abs(actual - target) / target <= tolerance;

/** Generates the world in an isolated schema and prints one JSON line; false when any invariant fails. */
export async function checkWorld(options: WorldOptions = {}): Promise<boolean> {
  const store = await Store.createTest("world-check");
  try {
    assert(
      store.testMode && store.schemaName !== "dbo",
      "World checks cannot use gameplay schemas",
    );
    await store.schema();
    const started = performance.now();
    await generateWorld(store, options);
    const generationSeconds = Math.round((performance.now() - started) / 100) / 10;
    const report = await verifyWorld(store, { nations: options.nations });
    const problems = [...report.problems];
    let problemCount = report.problemCount;
    const add = (message: string) => {
      problemCount++;
      problems.push(message);
    };
    const catalog = summarizeCatalog(worldCatalog().catalog);
    const world = await store.meta<Record<string, unknown>>("world");
    if (world.version !== WORLD_VERSION) add(`meta world.version ${world.version}, expected ${WORLD_VERSION}`);
    if (!options.nations?.length) {
      const exact: [string, number, number][] = [
        ["countries", report.totals.countries, catalog.nations],
        ["senior leagues", report.totals.seniorLeagues, catalog.leagueTiers],
        ["first teams", report.totals.firstTeams, catalog.firstTeamClubs],
        ["hosted clubs", report.totals.hostedClubs, catalog.hostedClubs],
        ["B-teams", report.totals.bTeams, catalog.bTeams],
        ["national teams", report.totals.nationalTeams, catalog.nations * 4],
      ];
      for (const [label, actual, target] of exact)
        if (actual !== target) add(`${actual} ${label}, catalog ${target}`);
      if (!within(report.totals.players, catalog.estimatedPlayers))
        add(`${report.totals.players} players, catalog estimate ${catalog.estimatedPlayers} (±10%)`);
    }
    try {
      await checkSqlConstraints(store);
    } catch (error) {
      add(error instanceof Error ? error.message : String(error));
    }
    const sizes = await tableSizes(store);
    console.log(
      JSON.stringify({
        ok: problemCount === 0,
        problemCount,
        worldVersion: world.version,
        catalogVersion: world.catalogVersion,
        nations: options.nations ?? "all",
        generationSeconds,
        reservedMb: Math.round(sizes.reduce((total, row) => total + row.reservedKb, 0) / 1024),
        catalog,
        totals: report.totals,
        tables: Object.fromEntries(
          sizes.slice(0, 12).map((row) => [row.name, { rows: row.rows, mb: Math.round(row.reservedKb / 102.4) / 10 }]),
        ),
        schemaName: store.schemaName,
        problems,
      }),
    );
    return problemCount === 0;
  } finally {
    await store.close();
  }
}

function cliOptions(args: string[]): WorldOptions {
  const value = (name: string) => args.find((arg) => arg.startsWith(`--${name}=`))?.slice(name.length + 3);
  const nations = value("nations")?.split(",").map((code) => code.trim()).filter(Boolean);
  const squads = value("squads");
  return {
    ...(value("seed") ? { seed: value("seed") } : {}),
    ...(nations?.length ? { nations } : {}),
    ...(squads === "minimum" || squads === "full" ? { squads } : {}),
  };
}

if (
  process.argv[1] &&
  pathToFileURL(resolve(process.argv[1])).href === import.meta.url
) {
  if (!(await checkWorld(cliOptions(process.argv.slice(2))))) {
    console.error("world:check failed: see problems in the JSON line above");
    process.exitCode = 1;
  }
}
