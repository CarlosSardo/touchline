import { countries as countryData } from "countries-list";
import seedrandom from "seedrandom";
import { Store } from "./db.ts";
import {
  ATTRIBUTE_GROUPS,
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
      confederation:
        country.continent === "EU"
          ? "UEFA"
          : country.continent === "SA"
            ? "CONMEBOL"
            : country.continent === "AF"
              ? "CAF"
              : country.continent === "NA"
                ? "CONCACAF"
                : country.continent === "OC" && code !== "AU"
                  ? "OFC"
                  : "AFC",
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

export function personName(random: seedrandom.PRNG, language: string) {
  const pool = names[language] ?? names.en;
  return `${pool[0][Math.floor(random() * pool[0].length)]} ${pool[1][Math.floor(random() * pool[1].length)]}`;
}

export function generateWorld(store: Store, options: WorldOptions = {}) {
  if (store.get("SELECT key FROM meta WHERE key = ?", "state")) return;
  const seed = options.seed ?? "touchline-2026";
  const random = seedrandom(seed);
  const integer = (min: number, max: number) =>
    Math.floor(random() * (max - min + 1)) + min;
  const pick = <Value>(values: Value[]) =>
    values[integer(0, values.length - 1)];
  const countryRows: Country[] = [];
  const clubRows: Club[] = [];
  const academyClubs: Club[] = [];
  const addClub = store.db.prepare(
    `INSERT INTO clubs (name, short_name, city, country_id, league_id, type, parent_id, age_group, color, reputation, academy, facilities, balance, transfer_budget, wage_budget, philosophy, culture, formation, tactical_style, chemistry, manager, manager_trust, board_confidence, board_pressure, fan_mood, fan_loyalty, fan_patience, expectations, stadium, capacity, data) VALUES (${Array(31).fill("?").join(",")})`,
  );
  const addLeague = store.db.prepare(
    "INSERT INTO leagues(name, country_id, confederation, tier, age_group, kind, reputation, format, data) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
  );
  const addStanding = store.db.prepare(
    "INSERT INTO standings(league_id, club_id) VALUES (?, ?)",
  );
  const addStaff = store.db.prepare(
    "INSERT INTO staff(club_id, name, role, ability, influence, communication, tactical_knowledge, personality, ambition, morale, wage, data) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
  );
  store.transaction(() => {
    for (const definition of countryDefinitions(options.countryLimit)) {
      const result = store.run(
        "INSERT INTO countries(code, name, continent, confederation, reputation, language, region) VALUES (?, ?, ?, ?, ?, ?, ?)",
        definition.code,
        definition.name,
        definition.continent,
        definition.confederation,
        definition.reputation,
        definition.language,
        definition.region,
      );
      const country: Country = {
        ...definition,
        id: Number(result.lastInsertRowid),
      };
      countryRows.push(country);
      const localClubs: Club[] = [];
      for (const tier of [1, 2, 3]) {
        const title =
          tier === 1
            ? country.code === "EN"
              ? "Premier Division"
              : "Premier League"
            : tier === 2
              ? "Championship"
              : "National League";
        const reputation = clamp(country.reputation - (tier - 1) * 17);
        const leagueId = Number(
          addLeague.run(
            `${country.name} ${title}`,
            country.id,
            country.confederation,
            tier,
            "Senior",
            "league",
            reputation,
            "Double round-robin",
            JSON.stringify({
              promotion: tier > 1 ? 2 : 0,
              relegation: tier < 3 ? 2 : 0,
              continental: tier === 1 ? 4 : 0,
              tiebreakers: [
                "points",
                "goal difference",
                "goals scored",
                "head-to-head",
              ],
            }),
          ).lastInsertRowid,
        );
        const count =
          country.code === "EN" && tier <= 2
            ? 20
            : cityLists[country.code] && tier <= 2
              ? 16
              : 8;
        for (let index = 0; index < count; index++) {
          const cities = cityLists[country.code];
          const city = cities
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
          const name = `${city} ${suffix}`;
          const rep = clamp(reputation - index * (16 / count) + integer(-5, 3));
          const balance = Math.round((rep / 100) ** 5 * 190_000_000);
          const youth = integer(30, 90);
          const clubResult = addClub.run(
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
            personName(random, country.language),
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
            }),
          );
          const club = store.get<Club>(
            "SELECT * FROM clubs WHERE id = ?",
            Number(clubResult.lastInsertRowid),
          )!;
          addStanding.run(leagueId, club.id);
          clubRows.push(club);
          localClubs.push(club);
          const staffIds: number[] = [];
          for (const role of STAFF_ROLES) {
            const staffAbility = clamp(rep + integer(-20, 12));
            staffIds.push(
              Number(
                addStaff.run(
                  club.id,
                  personName(random, country.language),
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
                ).lastInsertRowid,
              ),
            );
          }
          store.run(
            "INSERT INTO relationships(club_id, source_type, source_id, target_type, target_id, strength, kind) VALUES (?, ?, ?, ?, ?, ?, ?)",
            club.id,
            "staff",
            staffIds[0],
            "staff",
            staffIds[1],
            integer(-40, 75),
            pick(["Alliance", "Professional", "Rivalry"]),
          );
          store.run("INSERT INTO training_plans(club_id) VALUES (?)", club.id);
          store.run("INSERT INTO set_pieces(club_id) VALUES (?)", club.id);
        }
      }
      const academyCount = cityLists[country.code] ? 8 : 6;
      const localAcademies = localClubs.slice(0, academyCount);
      academyClubs.push(...localAcademies);
      for (const ageGroup of ["U19", "U17"] as AgeGroup[]) {
        const leagueId = Number(
          addLeague.run(
            `${country.name} ${ageGroup} League`,
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
            }),
          ).lastInsertRowid,
        );
        for (const club of localAcademies) addStanding.run(leagueId, club.id);
      }
      if (["ES", "PT", "DE", "NL"].includes(country.code)) {
        for (const parent of localClubs.slice(0, 2)) {
          const thirdTier =
            localClubs.find(
              (club) =>
                club.league_id !== localClubs[0].league_id &&
                club.league_id !== localClubs[16]?.league_id,
            )?.league_id ?? localClubs.at(-1)!.league_id;
          const result = addClub.run(
            `${parent.name} B`,
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
            personName(random, country.language),
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
            }),
          );
          const club = store.get<Club>(
            "SELECT * FROM clubs WHERE id = ?",
            Number(result.lastInsertRowid),
          )!;
          addStanding.run(thirdTier, club.id);
          clubRows.push(club);
        }
      }
      for (const ageGroup of ["Senior", "U17", "U19", "U20"] as AgeGroup[]) {
        addClub.run(
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
          personName(random, country.language),
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
    store.run(
      "UPDATE clubs SET reputation = 78, balance = 82500000, transfer_budget = 48500000, wage_budget = 1650000, academy = 84, facilities = 81, manager = 'Julian Mercer', philosophy = 'Sustainable growth', culture = 'Development', formation = '4-3-3', tactical_style = 'High press', board_confidence = 72, fan_mood = 76, expectations = 6 WHERE id = 1",
    );
    clubRows[0] = store.get<Club>("SELECT * FROM clubs WHERE id = 1")!;
    generatePlayers(store, {
      count: options.seniors ?? WORLD_COUNTS.seniors,
      youth: false,
      random,
      countries: countryRows,
      clubs: clubRows,
      startDate: START_DATE,
    });
    generatePlayers(store, {
      count: options.youth ?? WORLD_COUNTS.youth,
      youth: true,
      random,
      countries: countryRows,
      clubs: academyClubs,
      startDate: START_DATE,
    });
    for (let index = 0; index < 120; index++) {
      const role = STAFF_ROLES[index % STAFF_ROLES.length];
      const ability = integer(45, 95);
      addStaff.run(
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
    store.setMeta("state", state);
    store.setMeta("settings", DEFAULT_SETTINGS);
    store.setMeta("schemaVersion", 1);
    store.setMeta("world", {
      seed,
      generated: START_DATE,
      countries: countryRows.length,
      clubs: clubRows.length,
      seniors: options.seniors ?? WORLD_COUNTS.seniors,
      youth: options.youth ?? WORLD_COUNTS.youth,
    });
  });
}

export function generatePlayers(
  store: Store,
  options: {
    count: number;
    youth: boolean;
    random: seedrandom.PRNG;
    countries: Country[];
    clubs: Club[];
    startDate: string;
    regenStyle?: string;
  },
) {
  const { random, countries, clubs } = options;
  const countryMap = new Map(countries.map((country) => [country.id, country]));
  const integer = (min: number, max: number) =>
    Math.floor(random() * (max - min + 1)) + min;
  const statement = store.db.prepare(
    `INSERT INTO players(name, nationality, country_id, club_id, position, secondary_position, birth_date, age, age_group, foot, ability, base_potential, potential, volatility, value, wage, contract_end, morale, fitness, form, role, profile, knowledge, available_loan) VALUES (${Array(24).fill("?").join(",")})`,
  );
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
    const youthBand = serial % 2 === 0 ? "U17" : "U19";
    const birthYear =
      Number(options.startDate.slice(0, 4)) -
      (options.youth
        ? youthBand === "U17"
          ? integer(14, 16)
          : integer(17, 18)
        : integer(19, 34));
    const birthDate = `${birthYear}-${String(integer(1, 6)).padStart(2, "0")}-${String(integer(1, 28)).padStart(2, "0")}`;
    const age = Number(options.startDate.slice(0, 4)) - birthYear;
    const position =
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
    if (country.id !== ownCountry.id) {
      const percentage = integer(55, 90);
      profile.identity.heritage = [
        { country: country.name, percentage },
        { country: ownCountry.name, percentage: 100 - percentage },
      ];
      if (country.language !== ownCountry.language)
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
    const wage =
      Math.round(
        ((ability / 100) ** 7 * 190_000 * (options.youth ? 0.08 : 1)) / 10,
      ) *
        10 +
      50;
    const contractEnd = `${Number(options.startDate.slice(0, 4)) + (options.youth ? Math.min(3, integer(1, 3)) : integer(1, 5))}-06-30`;
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
    statement.run(
      personName(random, country.language),
      country.name,
      country.id,
      club.id,
      position,
      position === "GK" ? "GK" : rosterPositions[integer(1, 10)],
      birthDate,
      age,
      options.youth ? youthBand : "Senior",
      random() > 0.25 ? "Right" : random() > 0.15 ? "Left" : "Both",
      ability,
      potential,
      potential,
      options.youth ? integer(5, 20) : integer(0, 12),
      value,
      wage,
      contractEnd,
      integer(60, 87),
      integer(86, 99),
      form,
      options.youth
        ? "Prospect"
        : serial < 11
          ? "Regular starter"
          : "Squad player",
      JSON.stringify(profile),
      club.id === 1 ? 100 : integer(0, 25),
      !options.youth && age <= 23 && serial >= 11 ? 1 : 0,
    );
  }
}
