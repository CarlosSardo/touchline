import { countries as countryData } from "countries-list";
import seedrandom from "seedrandom";
import { Store } from "./db.ts";
import { ensureClubSupport } from "./club-support.ts";
import {
  clubIdentity,
  culturalPersonName,
  playerBackground,
} from "./world-names.ts";
import {
  domesticPyramid,
  footballConfederation,
  reservePolicy,
  reserveTeamName,
  SQUAD_MINIMUMS,
  WORLD_VERSION,
  youthGroups,
} from "../shared/world-rules.ts";
import {
  ATTRIBUTE_GROUPS,
  ASSISTANT_ROLE,
  DEFAULT_SETTINGS,
  PERSONALITY_KEYS,
  STAFF_ROLES,
  START_DATE,
  WORLD_COUNTS,
  clamp,
  valuation,
} from "../shared/rules.ts";
import type {
  AgeGroup,
  Club,
  Country,
  GameState,
  PlayerProfile,
  Position,
} from "../shared/types.ts";

export interface WorldOptions {
  seniors?: number;
  youth?: number;
  countryLimit?: number;
  seed?: string;
  expanded?: boolean;
  structureOnly?: boolean;
}
const excluded = new Set([
  "AQ",
  "BV",
  "HM",
  "TF",
  "GS",
  "UM",
  "SJ",
  "CC",
  "CX",
  "NF",
  "PN",
  "IO",
]);
const reputations: Record<string, number> = {
  EN: 94,
  ES: 90,
  DE: 89,
  IT: 89,
  FR: 85,
  PT: 80,
  NL: 79,
  BR: 82,
  AR: 80,
  BE: 75,
  US: 72,
  MX: 75,
  JP: 70,
  KR: 69,
  SA: 75,
  TR: 76,
  SCO: 69,
  AT: 69,
  CH: 70,
  DK: 70,
  HR: 67,
  RS: 65,
  GR: 70,
  CZ: 65,
  NO: 64,
  SE: 65,
  PL: 67,
  AU: 65,
  ZA: 61,
  EG: 70,
  MA: 67,
  NG: 59,
  TN: 62,
  NZ: 45,
};
const cityLists: Record<string, string[]> = {
  EN: [
    "Northbridge",
    "Kingsport",
    "Eastford",
    "Westhaven",
    "Ravenswick",
    "Ashbourne",
    "Meridian",
    "Portwell",
    "Whitmore",
    "Redcliffe",
    "Stonebridge",
    "Alderwick",
    "Blackthorn",
    "Bayswater",
    "Hartwick",
    "Ellington",
    "Oakchester",
    "Fairhaven",
    "Millbrook",
    "Southgate",
  ],
  ES: [
    "Madrid",
    "Barcelona",
    "Seville",
    "Valencia",
    "Bilbao",
    "Malaga",
    "Granada",
    "Vigo",
    "Cadiz",
    "Girona",
    "Oviedo",
    "Zaragoza",
    "Cordoba",
    "Alicante",
    "Toledo",
    "Murcia",
  ],
  IT: [
    "Milano",
    "Roma",
    "Torino",
    "Napoli",
    "Firenze",
    "Bologna",
    "Genova",
    "Bari",
    "Parma",
    "Como",
    "Verona",
    "Palermo",
    "Cagliari",
    "Brescia",
    "Trieste",
    "Lecce",
  ],
  DE: [
    "Berlin",
    "Munich",
    "Hamburg",
    "Dortmund",
    "Bremen",
    "Leipzig",
    "Cologne",
    "Frankfurt",
    "Dresden",
    "Mainz",
    "Stuttgart",
    "Augsburg",
    "Freiburg",
    "Essen",
    "Bonn",
    "Kiel",
  ],
  FR: [
    "Paris",
    "Lyon",
    "Marseille",
    "Lille",
    "Nice",
    "Bordeaux",
    "Rennes",
    "Nantes",
    "Lens",
    "Toulouse",
    "Brest",
    "Strasbourg",
    "Reims",
    "Metz",
    "Dijon",
    "Caen",
  ],
  PT: [
    "Lisboa",
    "Porto",
    "Braga",
    "Faro",
    "Coimbra",
    "Aveiro",
    "Setubal",
    "Evora",
    "Viseu",
    "Leiria",
    "Lagos",
    "Funchal",
    "Guimaraes",
    "Chaves",
    "Beja",
    "Portimao",
  ],
  NL: [
    "Amsterdam",
    "Rotterdam",
    "Eindhoven",
    "Utrecht",
    "Arnhem",
    "Alkmaar",
    "Breda",
    "Tilburg",
    "Zwolle",
    "Groningen",
    "Twente",
    "Venlo",
    "Emmen",
    "Delft",
    "Leiden",
    "Haarlem",
  ],
  BR: [
    "Sao Paulo",
    "Rio de Janeiro",
    "Santos",
    "Belo Horizonte",
    "Porto Alegre",
    "Recife",
    "Salvador",
    "Fortaleza",
    "Curitiba",
    "Goiania",
    "Natal",
    "Belem",
    "Manaus",
    "Campinas",
    "Maceio",
    "Vitoria",
  ],
  AR: [
    "Buenos Aires",
    "Rosario",
    "Cordoba",
    "Mendoza",
    "La Plata",
    "Santa Fe",
    "Tucuman",
    "Salta",
    "Lanus",
    "Banfield",
    "Quilmes",
    "Tigre",
    "Avellaneda",
    "San Juan",
    "Santa Cruz",
    "Neuquen",
  ],
  BE: [
    "Brussels",
    "Bruges",
    "Antwerp",
    "Ghent",
    "Genk",
    "Liege",
    "Leuven",
    "Mechelen",
    "Namur",
    "Charleroi",
    "Kortrijk",
    "Mons",
    "Hasselt",
    "Eupen",
    "Ostend",
    "Wavre",
  ],
  US: [
    "New York",
    "Los Angeles",
    "Seattle",
    "Austin",
    "Chicago",
    "Atlanta",
    "Portland",
    "Miami",
    "Boston",
    "Dallas",
    "Denver",
    "Detroit",
    "Orlando",
    "Nashville",
    "Charlotte",
    "Houston",
  ],
  JP: [
    "Tokyo",
    "Osaka",
    "Yokohama",
    "Kobe",
    "Kyoto",
    "Nagoya",
    "Sapporo",
    "Sendai",
    "Fukuoka",
    "Hiroshima",
    "Nagasaki",
    "Niigata",
    "Kawasaki",
    "Nara",
    "Chiba",
    "Oita",
  ],
};
const names: Record<string, [string[], string[]]> = {
  en: [
    [
      "Oliver",
      "Elliot",
      "Jude",
      "Noah",
      "Finley",
      "James",
      "Theo",
      "Isaac",
      "Callum",
      "Owen",
      "Harrison",
      "Ethan",
      "Archie",
      "Reuben",
      "Charlie",
      "Max",
      "Joshua",
      "Rowan",
      "Alfie",
      "Samuel",
    ],
    [
      "Bennett",
      "Clarke",
      "Reid",
      "Palmer",
      "Whitfield",
      "Hayes",
      "Morgan",
      "Collins",
      "Foster",
      "Walsh",
      "Hughes",
      "Brooks",
      "Campbell",
      "Turner",
      "Mitchell",
      "Watson",
      "Walker",
      "Price",
      "Cooper",
      "Mason",
    ],
  ],
  es: [
    [
      "Mateo",
      "Nicolas",
      "Santiago",
      "Pablo",
      "Diego",
      "Alvaro",
      "Hugo",
      "Rafael",
      "Lucas",
      "Adrian",
      "Alejandro",
      "Emilio",
      "Javier",
      "Marcos",
      "Enzo",
      "Gabriel",
    ],
    [
      "Morales",
      "Vega",
      "Romero",
      "Castillo",
      "Medina",
      "Torres",
      "Navarro",
      "Silva",
      "Rojas",
      "Santos",
      "Herrera",
      "Acosta",
      "Vargas",
      "Molina",
      "Fuentes",
      "Cabrera",
    ],
  ],
  pt: [
    [
      "Tiago",
      "Diogo",
      "Joao",
      "Rafael",
      "Pedro",
      "Bruno",
      "Gabriel",
      "Luis",
      "Andre",
      "Felipe",
      "Caio",
      "Matheus",
      "Vinicius",
      "Gustavo",
      "Rodrigo",
      "Davi",
    ],
    [
      "Moreira",
      "Andrade",
      "Ferreira",
      "Costa",
      "Almeida",
      "Pereira",
      "Rocha",
      "Teixeira",
      "Ribeiro",
      "Cardoso",
      "Barbosa",
      "Lima",
      "Mendes",
      "Araujo",
      "Gomes",
      "Nunes",
    ],
  ],
  fr: [
    [
      "Jules",
      "Louis",
      "Ibrahim",
      "Amine",
      "Mathis",
      "Noe",
      "Yanis",
      "Theo",
      "Hugo",
      "Idrissa",
      "Moussa",
      "Rayan",
      "Baptiste",
      "Sacha",
      "Malik",
      "Nathan",
    ],
    [
      "Laurent",
      "Diallo",
      "Moreau",
      "Traore",
      "Lefevre",
      "Dumont",
      "Kone",
      "Martin",
      "Bernard",
      "Diop",
      "Girard",
      "Petit",
      "Fofana",
      "Dubois",
      "Roux",
      "Sow",
    ],
  ],
  de: [
    [
      "Leon",
      "Lukas",
      "Florian",
      "Jonas",
      "Felix",
      "Maximilian",
      "Nico",
      "Emil",
      "Finn",
      "Julian",
      "Anton",
      "Tobias",
      "Paul",
      "Erik",
      "Moritz",
      "David",
    ],
    [
      "Weber",
      "Schneider",
      "Wagner",
      "Keller",
      "Hoffmann",
      "Fischer",
      "Schulz",
      "Hartmann",
      "Becker",
      "Wolff",
      "Vogel",
      "Bauer",
      "Richter",
      "Koch",
      "Neumann",
      "Braun",
    ],
  ],
  it: [
    [
      "Luca",
      "Matteo",
      "Lorenzo",
      "Nicolo",
      "Alessandro",
      "Marco",
      "Federico",
      "Andrea",
      "Riccardo",
      "Simone",
      "Tommaso",
      "Gabriele",
      "Davide",
      "Pietro",
      "Edoardo",
      "Fabio",
    ],
    [
      "Rossi",
      "Moretti",
      "Romano",
      "Conti",
      "Ricci",
      "Marino",
      "De Luca",
      "Rinaldi",
      "Costa",
      "Lombardi",
      "Gallo",
      "Ferraro",
      "Greco",
      "Caruso",
      "Mancini",
      "Bruno",
    ],
  ],
  nl: [
    [
      "Daan",
      "Lars",
      "Milan",
      "Sem",
      "Finn",
      "Thijs",
      "Bram",
      "Luuk",
      "Jesse",
      "Timo",
      "Niels",
      "Ruben",
      "Joep",
      "Sven",
      "Wout",
      "Jasper",
    ],
    [
      "de Vries",
      "van Dijk",
      "Bakker",
      "Visser",
      "Smit",
      "de Jong",
      "van Leeuwen",
      "Vos",
      "Mulder",
      "Bos",
      "Meijer",
      "Kuiper",
      "Jansen",
      "van Beek",
      "Dekker",
      "Dijkstra",
    ],
  ],
  ar: [
    [
      "Youssef",
      "Omar",
      "Amir",
      "Karim",
      "Rami",
      "Sami",
      "Hamza",
      "Bilal",
      "Ilyas",
      "Nabil",
      "Zayd",
      "Walid",
    ],
    [
      "Haddad",
      "Mansour",
      "Farouk",
      "Idrissi",
      "Bennani",
      "Salem",
      "Nasser",
      "Khalil",
      "Rahman",
      "Saidi",
      "Hakim",
      "Aziz",
    ],
  ],
  ja: [
    [
      "Haruto",
      "Ren",
      "Yuto",
      "Sota",
      "Daichi",
      "Kaito",
      "Riku",
      "Takumi",
      "Yuki",
      "Shota",
      "Ryota",
      "Hiroto",
    ],
    [
      "Tanaka",
      "Sato",
      "Suzuki",
      "Nakamura",
      "Kobayashi",
      "Watanabe",
      "Yamamoto",
      "Ito",
      "Takahashi",
      "Mori",
      "Sasaki",
      "Hayashi",
    ],
  ],
  ko: [
    [
      "Min-jun",
      "Ji-ho",
      "Seo-jun",
      "Do-yun",
      "Hyun-woo",
      "Jun-seo",
      "Si-woo",
      "Jae-min",
    ],
    ["Kim", "Park", "Lee", "Choi", "Jung", "Kang", "Cho", "Yoon"],
  ],
};
const styles = [
  "Possession",
  "High press",
  "Counter attack",
  "Direct",
  "Balanced",
];
const colors = [
  "#087f6d",
  "#d44e4b",
  "#3465a4",
  "#a45d86",
  "#df9a2b",
  "#3d4855",
  "#27a0a2",
  "#af3e52",
];
const rosterPositions: Position[] = [
  "GK",
  "CB",
  "CB",
  "LB",
  "RB",
  "DM",
  "CM",
  "AM",
  "LW",
  "RW",
  "ST",
  "GK",
  "CB",
  "CM",
  "ST",
  "LB",
  "RB",
  "DM",
  "LW",
  "RW",
  "CM",
  "CB",
  "ST",
  "AM",
  "GK",
];

export function countryDefinitions(limit?: number): Omit<Country, "id">[] {
  const definitions: Omit<Country, "id">[] = Object.entries(countryData)
    .filter(([code]) => !excluded.has(code) && code !== "GB")
    .map(([code, country]) => ({
      code,
      name: country.name,
      continent: country.continent,
      confederation: footballConfederation(code, country.continent),
      reputation:
        reputations[code] ??
        24 + ((code.charCodeAt(0) + code.charCodeAt(1)) % 30),
      language: country.languages[0] ?? "en",
      region: country.capital || country.name,
    }));
  definitions.push(
    ...[
      ["EN", "England"],
      ["SCO", "Scotland"],
      ["WAL", "Wales"],
      ["NIR", "Northern Ireland"],
    ].map(([code, name]) => ({
      code,
      name,
      continent: "EU",
      confederation: "UEFA",
      reputation: reputations[code] ?? 59,
      language: "en",
      region: name,
    })),
  );
  definitions.sort((left, right) =>
    left.code === "EN"
      ? -1
      : right.code === "EN"
        ? 1
        : right.reputation - left.reputation ||
          left.name.localeCompare(right.name),
  );
  return limit ? definitions.slice(0, limit) : definitions;
}

export function makeProfile(
  random: seedrandom.PRNG,
  country: Country,
  club: Club,
  ability: number,
  position: Position,
  age: number,
): PlayerProfile {
  const pick = <Value>(values: Value[]) =>
    values[Math.floor(random() * values.length)];
  const integer = (min: number, max: number) =>
    Math.floor(random() * (max - min + 1)) + min;
  const attributes = Object.fromEntries(
    Object.entries(ATTRIBUTE_GROUPS).map(([group, keys]) => [
      group,
      Object.fromEntries(
        keys.map((key) => {
          const offset =
            group === "goalkeeper"
              ? position === "GK"
                ? 5
                : -50
              : position === "GK" && group === "technical"
                ? -22
                : 0;
          return [key, Math.round(clamp(ability + integer(-17, 14) + offset))];
        }),
      ),
    ]),
  ) as PlayerProfile["attributes"];
  const height = integer(
    position === "GK" || position === "CB" ? 181 : 165,
    position === "GK" ? 201 : 195,
  );
  const personality = Object.fromEntries(
    PERSONALITY_KEYS.map((key) => [key, integer(20, 95)]),
  );
  return {
    identity: {
      heritage: [{ country: country.name, percentage: 100 }],
      languages: [{ language: country.language, fluency: 5 }],
      region: country.region,
      height,
      weight: Math.round((height - 100) * (0.84 + random() * 0.22)),
      bodyType: pick(["Lean", "Athletic", "Powerful", "Compact"]),
    },
    attributes,
    personality,
    traits: [
      pick([
        "Cuts inside",
        "Shoots from distance",
        "Dribbles often",
        "Aggressive presser",
        "Big-game player",
        "Lazy trainer",
        "Plays one-twos",
        "Dictates tempo",
        "Arrives late in box",
        "Stays on feet",
      ]),
      pick([
        "Tries killer balls",
        "Leads by example",
        "Runs with ball",
        "Plays safe passes",
        "Likes to beat offside trap",
        "Long throw specialist",
      ]),
    ],
    lifestyle: pick([
      "disciplined",
      "nightlife",
      "family-focused",
      "luxury-obsessed",
      "gym-rat",
    ]),
    mentalHealth: {
      confidence: integer(45, 85),
      anxiety: integer(8, 40),
      burnout: integer(2, 22),
      motivation: integer(55, 95),
    },
    careerVision: [
      pick([
        "Wants a big club",
        "Wants captaincy",
        "Wants the national team",
        "Wants Champions League football",
      ]),
      age < 21 ? "Wants first-team minutes" : "Wants long-term security",
    ],
    baseAbility: ability,
    agent: {
      name: `${pick(["Adrian", "Marco", "Sofia", "Lucas", "Lena", "Daniel"])} ${pick(["Hart", "Mendes", "Costa", "Moreau", "Russo", "Keller"])}`,
      personality: pick([
        "Pragmatic",
        "Loyal",
        "Ambitious",
        "Combative",
        "Opportunist",
      ]),
      difficulty: integer(20, 90),
      commission: integer(3, 10),
      frustration: 0,
    },
    development: {
      growthSpurt: false,
      mentorId: null,
      history: [{ date: START_DATE, ability, potential: ability }],
    },
    relationships: {
      group:
        country.id === club.country_id
          ? "Local core"
          : age < 22
            ? "Young internationals"
            : "International core",
      loyalty: personality.loyalty,
      influence: integer(20, 90),
    },
  };
}

export function personName(
  random: seedrandom.PRNG,
  language: string | Country,
) {
  if (typeof language !== "string") return culturalPersonName(random, language);
  const pool = names[language] ?? names.en;
  return `${pool[0][Math.floor(random() * pool[0].length)]} ${pool[1][Math.floor(random() * pool[1].length)]}`;
}

export async function generateWorld(store: Store, options: WorldOptions = {}) {
  if (await store.get("SELECT [key] FROM meta WHERE [key] = ?", "state"))
    return;
  const seed = options.seed ?? "touchline-2026";
  const expanded =
    options.expanded ??
    (options.seniors === undefined && options.youth === undefined);
  let seniorCount = options.seniors ?? WORLD_COUNTS.seniors;
  let youthCount = options.youth ?? WORLD_COUNTS.youth;
  const random = seedrandom(seed);
  const integer = (min: number, max: number) =>
    Math.floor(random() * (max - min + 1)) + min;
  const pick = <Value>(values: Value[]) =>
    values[integer(0, values.length - 1)];
  const countryRows: Country[] = [];
  const clubRows: Club[] = [];
  const academyClubs: Club[] = [];
  type Row = Record<string, string | number | null>;
  const rows = {
    countries: [] as Row[],
    leagues: [] as Row[],
    clubs: [] as Row[],
    standings: [] as Row[],
    staff: [] as Row[],
    relationships: [] as Row[],
    training_plans: [] as Row[],
    set_pieces: [] as Row[],
  };
  const addClub = (...values: (string | number | null)[]) => {
    const row: Row = {
      id: rows.clubs.length + 1,
      ...Object.fromEntries(
        "name short_name city country_id league_id type parent_id age_group color reputation academy facilities balance transfer_budget wage_budget philosophy culture formation tactical_style chemistry manager manager_trust board_confidence board_pressure fan_mood fan_loyalty fan_patience expectations stadium capacity data"
          .split(" ")
          .map((column, index) => [column, values[index]]),
      ),
      momentum: 0,
      crisis: 0,
      hype: 0,
      income: 0,
      spending: 0,
      season_spend: 0,
      ffp: 0,
    };
    rows.clubs.push(row);
    return { ...row } as unknown as Club;
  };
  const addLeague = (...values: (string | number | null)[]) => {
    const id = rows.leagues.length + 1;
    rows.leagues.push({
      id,
      ...Object.fromEntries(
        "name country_id confederation tier age_group kind reputation format data"
          .split(" ")
          .map((column, index) => [column, values[index]]),
      ),
    });
    return id;
  };
  const addStanding = (leagueId: number, clubId: number) =>
    rows.standings.push({ league_id: leagueId, club_id: clubId });
  const addStaff = (...values: (string | number | null)[]) => {
    const id = rows.staff.length + 1;
    rows.staff.push({
      id,
      ...Object.fromEntries(
        "club_id name role ability influence communication tactical_knowledge personality ambition morale wage data"
          .split(" ")
          .map((column, index) => [column, values[index]]),
      ),
    });
    return id;
  };
  const insertRows = async (table: keyof typeof rows) => {
    for (let offset = 0; offset < rows[table].length; offset += 1000)
      await store.bulkInsert(table, rows[table].slice(offset, offset + 1000));
  };
  await store.transaction(async () => {
    for (const definition of countryDefinitions(options.countryLimit)) {
      const country: Country = {
        ...definition,
        id: countryRows.length + 1,
      };
      countryRows.push(country);
      rows.countries.push({ ...country });
      const localClubs: Club[] = [];
      let countryClubIndex = 0;
      const pyramid = expanded ? domesticPyramid(country) : undefined;
      for (const tier of pyramid?.map((division) => division.tier) ?? [
        1, 2, 3,
      ]) {
        const title =
          tier === 1
            ? country.code === "EN"
              ? "Premier Division"
              : "Premier League"
            : tier === 2
              ? "Championship"
              : "National League";
        const division = pyramid?.find((entry) => entry.tier === tier);
        const reputation = clamp(
          country.reputation - (tier - 1) * (expanded ? 10 : 17),
        );
        const leagueId = Number(
          addLeague(
            division?.name ?? `${country.name} ${title}`,
            country.id,
            country.confederation,
            tier,
            "Senior",
            "league",
            reputation,
            "Double round-robin",
            JSON.stringify({
              promotion: division?.promotion ?? (tier > 1 ? 2 : 0),
              relegation: division?.relegation ?? (tier < 3 ? 2 : 0),
              worldVersion: expanded ? WORLD_VERSION : 1,
              continental: tier === 1 ? 4 : 0,
              tiebreakers: [
                "points",
                "goal difference",
                "goals scored",
                "head-to-head",
              ],
            }),
          ),
        );
        const count =
          division?.clubs ??
          (country.code === "EN" && tier <= 2
            ? 20
            : cityLists[country.code] && tier <= 2
              ? 16
              : 8);
        for (let index = 0; index < count; index++) {
          const cities = cityLists[country.code];
          const legacyCity = cities
            ? cities[index % cities.length]
            : `${country.region}${index > 0 ? ` ${["North", "South", "East", "West", "Central", "Coastal", "Valley"][index - 1] ?? index}` : ""}`;
          const suffix =
            country.code === "EN"
              ? tier === 1
                ? ["Athletic", "City", "United", "Rovers", "FC"][index % 5]
                : tier === 2
                  ? "Town"
                  : "Wanderers"
              : tier === 1
                ? ["FC", "United", "Sporting", "Athletic"][index % 4]
                : tier === 2
                  ? "SC"
                  : "Olympic";
          const identity = expanded
            ? clubIdentity(country, countryClubIndex++, cities)
            : { city: legacyCity, name: `${legacyCity} ${suffix}` };
          const { city, name } = identity;
          const rep = clamp(reputation - index * (16 / count) + integer(-5, 3));
          const balance = Math.round((rep / 100) ** 5 * 190_000_000);
          const youth = integer(30, 90);
          const club = addClub(
            name,
            city.slice(0, 3).toUpperCase(),
            city,
            country.id,
            leagueId,
            "club",
            null,
            "Senior",
            colors[index % colors.length],
            rep,
            youth,
            clamp(rep + integer(-12, 8)),
            balance,
            Math.round(balance * 0.45),
            Math.round((rep / 100) ** 5 * 2_200_000),
            pick([
              "Develop and sell",
              "Win now",
              "Sustainable growth",
              "Local identity",
            ]),
            pick(["Development", "Demanding", "Family", "Professional"]),
            pick(["4-3-3", "4-2-3-1", "3-5-2", "4-4-2"]),
            pick(styles),
            integer(55, 85),
            personName(random, expanded ? country : country.language),
            72,
            72,
            28,
            72,
            integer(65, 95),
            integer(40, 85),
            index < 3
              ? 3
              : index < count / 2
                ? Math.ceil(count / 2)
                : count - 2,
            `${city} ${pick(["Park", "Stadium", "Arena", "Ground"])}`,
            Math.round(rep ** 2 * 6),
            JSON.stringify({
              youthDNA: pick([
                "Technical intelligence",
                "Relentless pressing",
                "Creative freedom",
                "Physical resilience",
              ]),
              ultras: integer(10, 80),
              boardPersonality: pick([
                "Patient",
                "Ambitious",
                "Interfering",
                "Pragmatic",
              ]),
              mediaBias: integer(-30, 30),
              ticketPrice: Math.round(rep / 2),
              sponsors: Math.round(balance * 0.22),
              financialHistory: [],
              managerCareer: [{ season: 2026, club: name }],
              relationship: 50,
              ...(expanded
                ? {
                    worldKey: `${country.code}:club:${countryClubIndex - 1}`,
                    worldVersion: WORLD_VERSION,
                  }
                : {}),
            }),
          );
          addStanding(leagueId, club.id);
          clubRows.push(club);
          localClubs.push(club);
          const staffIds: number[] = [];
          for (const role of STAFF_ROLES.filter(
            (role) => role !== ASSISTANT_ROLE,
          )) {
            const staffAbility = clamp(rep + integer(-20, 12));
            staffIds.push(
              Number(
                addStaff(
                  club.id,
                  personName(random, expanded ? country : country.language),
                  role,
                  staffAbility,
                  integer(30, 90),
                  integer(40, 95),
                  clamp(rep + integer(-25, 12)),
                  pick([
                    "Collaborative",
                    "Ambitious",
                    "Reserved",
                    "Outspoken",
                    "Methodical",
                  ]),
                  integer(25, 90),
                  75,
                  Math.round(staffAbility ** 2 * 0.4),
                  JSON.stringify({
                    bias: pick([
                      "Youth",
                      "Physical",
                      "Technical",
                      "Home nation",
                      "Reputation",
                    ]),
                    accuracy: clamp(staffAbility + integer(-5, 10)),
                    detail: integer(45, 95),
                    riskTolerance: integer(20, 90),
                    preferredRegion: country.id,
                    development: 0,
                    contractEnd: "2029-06-30",
                  }),
                ),
              ),
            );
          }
          rows.relationships.push({
            club_id: club.id,
            source_type: "staff",
            source_id: staffIds[0],
            target_type: "staff",
            target_id: staffIds[1],
            strength: integer(-40, 75),
            kind: pick(["Alliance", "Professional", "Rivalry"]),
          });
          rows.training_plans.push({ club_id: club.id });
          rows.set_pieces.push({ club_id: club.id });
        }
      }
      const academyCount = cityLists[country.code] ? 8 : 6;
      const localAcademies = expanded
        ? localClubs
        : localClubs.slice(0, academyCount);
      academyClubs.push(...localAcademies);
      const reserves = reservePolicy(country.code);
      if (
        expanded
          ? reserves.mode !== "unverified"
          : ["ES", "PT", "DE", "NL"].includes(country.code)
      ) {
        const reserveParents = expanded
          ? [...localClubs]
              .filter((club) => club.league_id === localClubs[0].league_id)
              .sort((left, right) => right.reputation - left.reputation)
              .slice(0, 4)
          : localClubs.slice(0, 2);
        const separateLeague =
          expanded && reserves.mode === "separate"
            ? Number(
                addLeague(
                  `${country.name} Development League`,
                  country.id,
                  country.confederation,
                  reserves.entryTier ?? 0,
                  "Senior",
                  "league",
                  country.reputation * 0.6,
                  "Double round-robin",
                  JSON.stringify({
                    reserveOnly: true,
                    promotion: 0,
                    relegation: 0,
                    worldVersion: WORLD_VERSION,
                    reservePolicy: reserves,
                  }),
                ),
              )
            : undefined;
        for (const [reserveIndex, parent] of reserveParents.entries()) {
          const thirdTier = expanded
            ? (separateLeague ??
              Number(
                rows.leagues.find(
                  (league) =>
                    league.country_id === country.id &&
                    league.kind === "league" &&
                    league.age_group === "Senior" &&
                    league.tier ===
                      (reserves.entryTier ?? 3) +
                        (country.code === "NL"
                          ? 0
                          : Math.floor(reserveIndex / 2)),
                )!.id,
              ))
            : (localClubs.find(
                (club) =>
                  club.league_id !== localClubs[0].league_id &&
                  club.league_id !== localClubs[16]?.league_id,
              )?.league_id ?? localClubs.at(-1)!.league_id);
          const club = addClub(
            expanded
              ? reserveTeamName(parent.name, country.code)
              : `${parent.name} B`,
            `${parent.short_name}B`,
            parent.city,
            country.id,
            thirdTier,
            "bteam",
            parent.id,
            "Senior",
            parent.color,
            clamp(parent.reputation - 30),
            parent.academy,
            parent.facilities,
            1_000_000,
            400_000,
            40_000,
            "Develop and sell",
            "Development",
            parent.formation,
            parent.tactical_style,
            65,
            personName(random, expanded ? country : country.language),
            65,
            70,
            20,
            65,
            70,
            80,
            6,
            `${parent.city} Training Ground`,
            4000,
            JSON.stringify({
              noSameDivision: true,
              youthDNA: "Pathway to first team",
              ...(expanded
                ? {
                    reservePolicy: reserves,
                    worldVersion: WORLD_VERSION,
                    worldKey: `${JSON.parse(parent.data).worldKey}:reserves`,
                  }
                : {}),
            }),
          );
          addStanding(thirdTier!, club.id);
          clubRows.push(club);
          if (expanded) {
            academyClubs.push(club);
            localAcademies.push(club);
            rows.training_plans.push({ club_id: club.id });
            rows.set_pieces.push({ club_id: club.id });
          }
        }
      }
      for (const ageGroup of ["U19", "U17"] as AgeGroup[]) {
        const groups = expanded
          ? youthGroups(localAcademies)
          : [localAcademies];
        for (const [groupIndex, members] of groups.entries()) {
          const leagueId = Number(
            addLeague(
              `${country.name} ${ageGroup} League${groups.length > 1 ? ` - Group ${groupIndex + 1}` : ""}`,
              country.id,
              country.confederation,
              0,
              ageGroup,
              "league",
              country.reputation * 0.7,
              "Double round-robin",
              JSON.stringify({
                youth: true,
                continental: 2,
                promotion: 0,
                relegation: 0,
                worldVersion: expanded ? WORLD_VERSION : 1,
              }),
            ),
          );
          for (const club of members) addStanding(leagueId, club.id);
        }
      }
      for (const ageGroup of ["Senior", "U17", "U19", "U20"] as AgeGroup[]) {
        addClub(
          `${country.name}${ageGroup === "Senior" ? "" : ` ${ageGroup}`}`,
          country.code,
          country.region,
          country.id,
          null,
          "national",
          null,
          ageGroup,
          colors[country.id % colors.length],
          country.reputation,
          70,
          75,
          0,
          0,
          0,
          "Win now",
          "Professional",
          "4-3-3",
          "Balanced",
          65,
          personName(random, expanded ? country : country.language),
          75,
          75,
          35,
          70,
          90,
          50,
          3,
          `${country.region} National Stadium`,
          30000,
          "{}",
        );
      }
    }
    Object.assign(rows.clubs[0], {
      reputation: 78,
      balance: 82500000,
      transfer_budget: 48500000,
      wage_budget: 1650000,
      academy: 84,
      facilities: 81,
      manager: "Julian Mercer",
      philosophy: "Sustainable growth",
      culture: "Development",
      formation: "4-3-3",
      tactical_style: "High press",
      board_confidence: 72,
      fan_mood: 76,
      expectations: 6,
    });
    clubRows[0] = { ...rows.clubs[0] } as unknown as Club;
    for (const table of [
      "countries",
      "leagues",
      "clubs",
      "standings",
      "training_plans",
      "set_pieces",
    ] as const)
      await insertRows(table);
    if (expanded) {
      seniorCount = Math.max(
        seniorCount,
        clubRows.length * SQUAD_MINIMUMS.Senior,
      );
      youthCount = Math.max(
        youthCount,
        academyClubs.length * (SQUAD_MINIMUMS.U19 + SQUAD_MINIMUMS.U17),
      );
    }
    if (!options.structureOnly)
      await generatePlayers(store, {
        count: seniorCount,
        youth: false,
        random,
        countries: countryRows,
        clubs: clubRows,
        startDate: START_DATE,
        modernNames: expanded,
      });
    if (!options.structureOnly)
      await generatePlayers(store, {
        count: youthCount,
        youth: true,
        random,
        countries: countryRows,
        clubs: academyClubs,
        startDate: START_DATE,
        modernNames: expanded,
      });
    for (let index = 0; index < 120; index++) {
      const role = STAFF_ROLES[index % STAFF_ROLES.length];
      const ability = integer(45, 95);
      addStaff(
        null,
        personName(random, "en"),
        role,
        ability,
        integer(30, 90),
        integer(35, 95),
        integer(35, 95),
        pick(["Collaborative", "Ambitious", "Outspoken", "Methodical"]),
        integer(30, 90),
        65,
        Math.round(ability ** 2 * 0.45),
        JSON.stringify({
          bias: pick(["Youth", "Technical", "Physical"]),
          accuracy: ability,
          detail: integer(50, 95),
          riskTolerance: integer(20, 90),
          development: 0,
        }),
      );
    }
    const state: GameState = {
      date: START_DATE,
      season: 2026,
      seed,
      clubId: 1,
      started: false,
      director: {
        name: "Alex Morgan",
        background: "Former scout",
        reputation: 48,
        experience: 0,
        skillPoints: 3,
        skills: {
          scouting: 1,
          negotiations: 1,
          development: 0,
          finance: 0,
          leadership: 0,
        },
      },
      week: 0,
      worldTrend: "High press",
      lastAutosave: START_DATE,
      gameOver: false,
    };
    await insertRows("staff");
    await insertRows("relationships");
    await store.setMeta("state", state);
    await store.setMeta("settings", DEFAULT_SETTINGS);
    await store.setMeta("schemaVersion", 1);
    await store.setMeta("world", {
      seed,
      generated: START_DATE,
      countries: countryRows.length,
      clubs: clubRows.length,
      seniors: options.structureOnly ? 0 : seniorCount,
      youth: options.structureOnly ? 0 : youthCount,
      expanded,
      version: expanded ? WORLD_VERSION : 1,
    });
  });
  await ensureClubSupport(store);
}

interface PlayerGenerationOptions {
  count: number;
  youth: boolean;
  random: seedrandom.PRNG;
  countries: Country[];
  clubs: Club[];
  startDate: string;
  regenStyle?: string;
  modernNames?: boolean;
  ageGroup?: "U17" | "U19";
  positions?: Position[];
  amateurOnly?: boolean;
}

function* playerRows(options: PlayerGenerationOptions) {
  const { random, countries, clubs } = options;
  const countryMap = new Map(countries.map((country) => [country.id, country]));
  const integer = (min: number, max: number) =>
    Math.floor(random() * (max - min + 1)) + min;
  for (let index = 0; index < options.count; index++) {
    const club = clubs[index % clubs.length];
    const ownCountry = countryMap.get(club.country_id)!;
    const foreignChance =
      options.regenStyle === "regional"
        ? 0.05
        : options.regenStyle === "global"
          ? 0.65
          : options.youth
            ? 0.09
            : 0.23;
    const country =
      random() < foreignChance
        ? countries[integer(0, Math.min(45, countries.length - 1))]
        : ownCountry;
    const serial = Math.floor(index / clubs.length);
    const youthBand = options.ageGroup ?? (serial % 2 === 0 ? "U17" : "U19");
    const birthYear =
      Number(options.startDate.slice(0, 4)) -
      (options.youth
        ? youthBand === "U17"
          ? integer(14, 16)
          : integer(17, 18)
        : integer(19, options.modernNames && club.type === "bteam" ? 22 : 34));
    const birthDate = `${birthYear}-${String(integer(1, 6)).padStart(2, "0")}-${String(integer(1, 28)).padStart(2, "0")}`;
    const age = Number(options.startDate.slice(0, 4)) - birthYear;
    const position =
      options.positions?.[index] ??
      rosterPositions[
        (options.youth ? Math.floor(serial / 2) : serial) %
          rosterPositions.length
      ];
    const ability = Math.round(
      clamp(
        club.reputation * 0.66 +
          22 +
          integer(-11, 9) -
          (options.youth ? 22 + (18 - age) * 2 : Math.max(0, 23 - age)),
      ),
    );
    const potential = Math.round(
      clamp(
        ability +
          (options.youth
            ? integer(10, options.regenStyle === "wonderkids" ? 45 : 30)
            : age < 26
              ? integer(0, 18)
              : integer(0, 4)),
      ),
    );
    const profile = makeProfile(random, country, club, ability, position, age);
    if (options.modernNames)
      profile.identity = {
        ...profile.identity,
        ...playerBackground(
          seedrandom(`background:${club.id}:${index}:${options.startDate}`),
          country,
          countries,
        ),
      };
    if (country.id !== ownCountry.id) {
      const percentage = integer(55, 90);
      if (!options.modernNames)
        profile.identity.heritage = [
          { country: country.name, percentage },
          { country: ownCountry.name, percentage: 100 - percentage },
        ];
      if (
        !profile.identity.languages.some(
          (entry) => entry.language === ownCountry.language,
        )
      )
        profile.identity.languages.push({
          language: ownCountry.language,
          fluency: integer(1, 4),
        });
    }
    profile.development.history[0] = {
      date: options.startDate,
      ability,
      potential,
    };
    const wage = options.amateurOnly
      ? Math.round(10 + club.academy * 0.35)
      : Math.round(
          ((ability / 100) ** 7 * 190_000 * (options.youth ? 0.08 : 1)) / 10,
        ) *
          10 +
        50;
    const contractEnd = `${Number(options.startDate.slice(0, 4)) + (options.youth ? Math.min(3, integer(1, 3)) : integer(1, 5))}-06-30`;
    const contractRandom = seedrandom(
      `contract:${club.id}:${index}:${options.startDate}`,
    );
    const amateur =
      options.youth &&
      (options.amateurOnly || age < 16 || contractRandom() < 0.45);
    profile.contract = {
      status: amateur ? "amateur" : "professional",
      trainingClubId: club.id,
      trainingStartAge: 12,
      ...(amateur
        ? {
            expenseAllowance: wage,
            futureProfessionalContract: age >= 16 && contractRandom() < 0.15,
          }
        : {}),
    };
    if (options.youth && contractRandom() < 0.035) {
      const destination =
        countries[Math.floor(contractRandom() * countries.length)];
      if (destination.id !== ownCountry.id)
        profile.familyMove = {
          countryId: destination.id,
          reason: "employment",
          verified: true,
          date: options.startDate,
        };
    }
    const form = Math.round((6.2 + random() * 1.3) * 10) / 10;
    const value = valuation(
      {
        ability,
        potential,
        age,
        position,
        contract_end: contractEnd,
        form,
        injury_until: null,
      },
      {
        date: options.startDate,
        leagueReputation: ownCountry.reputation,
        balance: club.balance,
        philosophy: club.philosophy,
        inflation: 4,
        crisis: 0,
        hype: 0,
      },
    ).value;
    yield {
      name: personName(
        random,
        options.modernNames
          ? countryMap.get(profile.identity.nameOriginCountryId ?? country.id)!
          : country.language,
      ),
      nationality: country.name,
      country_id: country.id,
      club_id: club.id,
      position,
      secondary_position:
        position === "GK" ? "GK" : rosterPositions[integer(1, 10)],
      birth_date: birthDate,
      age,
      age_group: options.youth ? youthBand : "Senior",
      foot: random() > 0.25 ? "Right" : random() > 0.15 ? "Left" : "Both",
      ability,
      base_potential: potential,
      potential,
      volatility: options.youth ? integer(5, 20) : integer(0, 12),
      value,
      wage,
      contract_end: contractEnd,
      morale: integer(60, 87),
      fitness: integer(86, 99),
      form,
      role: options.youth
        ? "Prospect"
        : serial < 11
          ? "Regular starter"
          : "Squad player",
      profile: JSON.stringify(profile),
      knowledge: club.id === 1 ? 100 : integer(0, 25),
      available_loan: !options.youth && age <= 23 && serial >= 11 ? 1 : 0,
    };
  }
}

async function insertPlayerRows(
  store: Store,
  rows: Iterable<Record<string, string | number>>,
) {
  await store.transaction(async () => {
    let nextId = (await store.get<{ id: number }>(
      "SELECT coalesce(max(id),0) AS id FROM players WITH (UPDLOCK,HOLDLOCK)",
    ))!.id;
    let batch: Record<string, string | number>[] = [];
    for (const row of rows) {
      batch.push({ id: ++nextId, ...row });
      if (batch.length === 1000) {
        await store.bulkInsert("players", batch);
        batch = [];
      }
    }
    if (batch.length) await store.bulkInsert("players", batch);
  });
}

export async function generatePlayers(
  store: Store,
  options: PlayerGenerationOptions,
) {
  await insertPlayerRows(store, playerRows(options));
}

export async function ensureClubRosters(
  store: Store,
  options: { clubs?: Club[]; youthOnly?: boolean; date?: string } = {},
) {
  const state = await store.meta<GameState>("state");
  const date = options.date ?? state.date;
  const clubs =
    options.clubs ??
    (await store.all<Club>(
      "SELECT * FROM clubs WHERE type != 'national' ORDER BY id",
    ));
  const countries = await store.all<Country>(
    "SELECT * FROM countries ORDER BY id",
  );
  const counts = new Map<string, Map<Position, number>>();
  for (const row of await store.all<{
    club_id: number;
    age_group: AgeGroup;
    position: Position;
    count: number;
  }>(
    "SELECT club_id,age_group,position,count(*) AS count FROM players WHERE club_id IS NOT NULL AND role != 'Retired' GROUP BY club_id,age_group,position",
  )) {
    const key = `${row.club_id}:${row.age_group}`;
    const positions = counts.get(key) ?? new Map<Position, number>();
    positions.set(row.position, row.count);
    counts.set(key, positions);
  }
  let added = 0;
  function* additions() {
    for (const club of clubs) {
      for (const ageGroup of options.youthOnly
        ? (["U19", "U17"] as const)
        : (["Senior", "U19", "U17"] as const)) {
        const present = new Map(counts.get(`${club.id}:${ageGroup}`));
        const missing: Position[] = [];
        for (const position of rosterPositions.slice(
          0,
          SQUAD_MINIMUMS[ageGroup],
        )) {
          const available = present.get(position) ?? 0;
          if (available > 0) present.set(position, available - 1);
          else missing.push(position);
        }
        if (!missing.length) continue;
        yield* playerRows({
          count: missing.length,
          youth: ageGroup !== "Senior",
          clubs: [club],
          countries,
          random: seedrandom(
            `${state.seed}:roster:${club.id}:${ageGroup}:${date}:${WORLD_VERSION}`,
          ),
          startDate: date,
          modernNames: true,
          positions: missing,
          ...(ageGroup === "Senior" ? {} : { ageGroup, amateurOnly: true }),
        });
        added += missing.length;
      }
    }
  }
  await insertPlayerRows(store, additions());
  return added;
}
