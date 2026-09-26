import type {
  CatalogFileData,
  CitizenshipRule,
  CitySize,
  CitySpec,
  ClubNameTemplate,
  ConfederationCode,
  Continent,
  FakerNameLocale,
  HeritageLink,
  MigrationContext,
  NamePool,
  NationSpec,
  WeightedCode,
  WeightedLanguage,
  WeightedNameSource,
  YouthDivisionSpec,
} from "./types.ts";

// Owner: catalog author "concacaf-ofc" — 35 CONCACAF + 11 OFC FIFA members, 13 with leagues (validate.ts CATALOG_ASSIGNMENT).
// 2025/26 structures on one July–June season (decision 10), money in GBP. MLS, USL, the CPL, League1 Canada and
// Liga MX/Expansión are closed. Coefficient seeds keep CONCACAF's club-ranking order (2021..2025, oldest first);
// OFC has no club competition and records none.

/** Names are "|"-separated when any of them contains a space, otherwise whitespace-separated. */
const list = (text: string) =>
  (text.includes("|") ? text.split("|") : text.split(/\s+/))
    .map((entry) => entry.trim())
    .filter(Boolean);
const pool = (name: string, given: string, family: string): NamePool => ({
  id: `concacaf-ofc/${name}`,
  ...(given.trim() ? { given: list(given) } : {}),
  ...(family.trim() ? { family: list(family) } : {}),
});
/** "american=4 faker:en=3 uefa-north/irish=0.6": bare names are this file's pools. */
const sources = (spec: string): WeightedNameSource[] =>
  spec
    .trim()
    .split(/\s+/)
    .map((entry) => {
      const at = entry.lastIndexOf("=");
      const name = entry.slice(0, at);
      const weight = Number(entry.slice(at + 1));
      if (name.startsWith("faker:")) return { source: name as `faker:${FakerNameLocale}`, weight };
      return { source: `pool:${name.includes("/") ? name : `concacaf-ofc/${name}`}`, weight };
    });
/** "DE:12 NL:6" → weighted nation codes. */
const weighted = (spec: string): WeightedCode[] =>
  spec
    .trim()
    .split(/\s+/)
    .map((entry) => {
      const [code, weight] = entry.split(":");
      return { code, weight: Number(weight) };
    });
const links = (context: MigrationContext, spec: string): HeritageLink[] =>
  weighted(spec).map((entry) => ({ ...entry, context }));
const languages = (spec: string): WeightedLanguage[] => weighted(spec);
const allowed: CitizenshipRule = { dual: "allowed" };
const restricted: CitizenshipRule = { dual: "restricted" };
/** Districts are "|"-separated because some contain spaces. */
const city = (name: string, size: CitySize, region: string, maxClubs?: number, districts?: string): CitySpec => ({
  name,
  size,
  region,
  ...(maxClubs ? { maxClubs } : {}),
  ...(districts ? { districts: districts.split("|") } : {}),
});
/** One region's towns: "Kingston:large:4, Spanish Town:medium" (size defaults to town). */
const cities = (region: string, spec: string): CitySpec[] =>
  spec
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((entry) => {
      const [name, size = "town", maxClubs] = entry.split(":");
      return city(name, size as CitySize, region, maxClubs ? Number(maxClubs) : undefined);
    });
/** "{city} FC:2; {city} SC:1" → weighted club-name templates (patterns never contain ":"). */
const templates = (spec: string, tiers?: number[]): ClubNameTemplate[] =>
  spec
    .split(";")
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((entry) => {
      const at = entry.lastIndexOf(":");
      return {
        pattern: entry.slice(0, at).trim(),
        weight: Number(entry.slice(at + 1)),
        ...(tiers ? { tiers } : {}),
      };
    });
const division = (
  name: string,
  parentTiers: [number, number],
  groupSize?: number,
  groupNames?: string,
): YouthDivisionSpec => ({
  name,
  parentTiers,
  ...(groupSize ? { groupSize } : {}),
  ...(groupNames ? { groupNames: groupNames.split("|") } : {}),
});
/** Member without an own league: home-based pool plus players at foreign clubs. */
const homeNation = (
  confederation: ConfederationCode,
  spec: Omit<NationSpec, "iso2" | "confederation" | "continent" | "euEea" | "football" | "hostedAbroad"> & {
    continent?: Continent;
  },
): NationSpec => ({
  iso2: spec.code,
  confederation,
  continent: confederation === "OFC" ? "OC" : "NA",
  euEea: false,
  ...spec,
});

// ------------------------------------------------------------------ name pools (romanized, Latin script only)

const AMERICAN = pool(
  "american",
  `Tyler Weston Brenden Christian Walker Tanner Paxten Auston Aidan Jack Gio Josh Zack Matt Tim Brandon Cole Chase
   Hunter Colton Landon Caden Brayden Logan Mason Ethan Owen Ryan Kyle Kevin Sean Bryce Blake Tristan Dylan Garrett
   Trevor Cameron Connor Chris Jordan Justin Jake Nick Luke Drew Devin Brady Brendan Cade Keegan Jonah Noah Eli
   Caleb Gavin Griffin Holden Jesse Julian Miles Sam Brian Andrew Alex Jonathan Daniel Michael David Joseph Kellyn
   Paul Clint Bobby Eddie Steve Cobi Frankie Aaron Seth Nathan Zach Quinn Riley Carson Parker Spencer Reid Wyatt
   Brock Tucker Chandler Preston Grant Graham Pierce Beckett Brooks Easton Hayden Harrison Jackson Bennett Declan
   Rowan Nolan Mitchell Travis Dalton Austin Brett Dane Kai Luca Max Wesley Zane Emmett Finn Jace Jett Kaden Asher
   Sawyer Benji Diego Gianluca Jalen Maximilian Henry Cooper Carter Colin Dax Hudson Lennon`,
  "",
);
const AFRICAN_AMERICAN = pool(
  "african-american",
  `DeAndre DaMarcus Jalen Jaylen Malik Tyrese Darius Marquis Terrence Tyrone Jamal Jamar Rashad Andre Darnell Dwayne
   Lamar Demetrius Antoine Cedric Keon Kendall Jermaine Maurice Desmond Xavier Isaiah Marcus DeShawn Jaden Jayden
   Omari Khalil Terrell Trey Devonte Dontae Javon Jarrett Rasheed Quincy Reggie Tavon Zion Amari Elijah Jeremiah
   Josiah Darien Dorian Jabari Kareem Kordell Rayshawn Shaquille Stefon Tariq Tremaine Kellen Kobe Kyrie Jamil
   Cortez Darrius Haji Jozy Brandon Justin Aron Mekhi Kenyon`,
  "",
);
const CANADIAN_FRENCH = pool(
  "canadian-french",
  `Samuel Mathieu Maxime Olivier Félix Antoine Gabriel Alexandre Jean-François Marc-André Philippe Vincent Nathan
   Mathis Zachary Justin Guillaume Simon Étienne Frédéric Sébastien Jérôme Julien Louis Raphaël Thomas William Émile
   Xavier Hugo Loïc Mikaël Kevin Patrice Jean-Philippe Pier-Luc Pierre-Olivier Marc-Olivier Jean-Sébastien Benoît
   Dominic Éric Luc Yannick Rémi Théo Léo Zacharie Laurent Nicolas Anthony Jonathan Alexis Édouard Jacob Tristan
   Samy Karl Francis Denis Martin Stéphane Sylvain Christophe Joël Gaël Noé Arnaud Cédric Mathias Jérémie Ludovic
   Ismaël Moïse`,
  `Tremblay Gagnon Roy Côté Bouchard Gauthier Morin Lavoie Fortin Gagné Ouellet Pelletier Bélanger Lévesque Bergeron
   Leblanc Paquette Girard Simard Boucher Caron Beaulieu Cloutier Dubé Poirier Fournier Lapointe Leclerc Lefebvre
   Poulin Thibault St-Pierre Nadeau Martin Landry Martel Bédard Grenier Lessard Bernier Richard Michaud Hébert
   Desjardins Couture Turcotte Lachance Parent Blais Gosselin Savard Proulx Beaudoin Demers Perreault Boudreau
   Lemieux Cyr Perron Dufour Dion Mercier Bolduc Bérubé Boisvert Langlois Ménard Therrien Plante Bilodeau Blanchette
   Dussault Carrier Guay Laroche Champagne Piette Choinière Crépeau Brault Lacroix Rousseau Vachon Charbonneau Rioux
   Arsenault Gingras Lemay Sauvé Hamel Tessier Chartrand Dagenais Bisson Lalonde Beauchamp Robitaille Racine
   Brisebois Veilleux Labelle Goulet Lavallée Paradis Marcoux Houle Larivière Jodoin Desrosiers Vaillancourt`,
);

// ------------------------------------------------------------------ United States

const US: NationSpec = {
  code: "US",
  iso2: "US",
  name: "United States",
  confederation: "CONCACAF",
  continent: "NA",
  capital: "Washington",
  latitude: 38.9,
  languages: languages("en:10 es:0.8"),
  reputation: { national: 76, league: 66 },
  euEea: false,
  physique: { height: 181 },
  names: {
    given: sources("american=4 faker:en=3 african-american=1.2 faker:es_MX=1.3"),
    family: sources("faker:en=6 faker:es_MX=1.6 faker:de=0.6 uefa-north/irish=0.6 faker:it=0.4 faker:pl=0.25"),
  },
  nationality: {
    multipleRate: 0.34,
    tripleRate: 0.07,
    bornAbroadRate: 0.1,
    diasporaPull: 0.55,
    links: [
      ...links("americas", "MX:12 SV:3 GT:2.5 HN:2.5 CO:2 CU:1.5 DO:1.5 CR:1 BR:1 AR:1 CA:2"),
      ...links("caribbean", "JM:3 HT:3 TT:1"),
      ...links("commonwealth", "EN:4 NG:3 GH:3"),
      ...links("britishIrish", "IE:2 SCO:1"),
      ...links("crossBorder", "DE:4 IT:2 PL:1 NL:1 HR:1 RS:1"),
      ...links("regional", "LR:1 CM:1 SN:0.8 CI:0.8 ET:0.5"),
      ...links("asianDiaspora", "KR:1 JP:1 PH:1 VN:0.5"),
    ],
    citizenship: allowed,
  },
  cities: {
    major: [
      city("New York City", "mega", "New York", 3, "Queens|Brooklyn|The Bronx|Harlem|Staten Island|Flushing"),
      city("Los Angeles", "mega", "California", 3, "Hollywood|Pasadena|Inglewood|Carson|Long Beach|Santa Monica|Burbank"),
      city("Chicago", "mega", "Illinois", 2, "Bridgeview|Evanston|Naperville|Hyde Park|Lincoln Park"),
      { ...city("Houston", "mega", "Texas", 2, "Sugar Land|Katy|The Woodlands|Humble|Spring"), admin1: "TX" },
      { ...city("Dallas", "mega", "Texas", 2, "Frisco|Arlington|Plano|Irving|Garland"), admin1: "TX" },
      { ...city("Philadelphia", "large", "Pennsylvania", 2, "Chester|Germantown|Kensington|Manayunk"), admin1: "PA" },
      city("Miami", "large", "Florida", 2, "Fort Lauderdale|Hialeah|Doral|Coral Gables|Miami Beach"),
      city("Atlanta", "large", "Georgia", 2, "Marietta|Decatur|Kennesaw|Sandy Springs"),
      city("Washington", "large", "District of Columbia", 2, "Georgetown|Anacostia|Leesburg|Alexandria"),
      { ...city("Boston", "large", "Massachusetts", 2, "Foxborough|Cambridge|Quincy|Somerville"), admin1: "MA" },
      { ...city("Phoenix", "large", "Arizona", 2, "Scottsdale|Tempe|Mesa|Chandler|Glendale"), admin1: "AZ" },
      { ...city("San Diego", "large", "California", 2, "Chula Vista|La Jolla|Escondido|Oceanside"), admin1: "CA" },
      { ...city("Denver", "large", "Colorado", 2, "Commerce City|Aurora|Lakewood"), admin1: "CO" },
      city("Tampa", "large", "Florida", 2, "St. Petersburg|Clearwater|Brandon"),
      city("Charlotte", "large", "North Carolina", 2, "Matthews|Concord|Gastonia"),
      city("Kansas City", "large", "Kansas", 2, "Overland Park|Independence|Olathe"),
      city("Salt Lake City", "medium", "Utah", 2, "Sandy|Herriman|West Valley City"),
      city("San Francisco", "large", "California", 1),
      city("Seattle", "large", "Washington", 1),
      { ...city("Minneapolis", "large", "Minnesota", 1, "Saint Paul|Blaine|Bloomington"), admin1: "MN" },
      city("St. Louis", "large", "Missouri", 1),
      city("Orlando", "large", "Florida", 1, "Kissimmee|Sanford"),
      { ...city("San Antonio", "large", "Texas", 1), admin1: "TX" },
      { ...city("Portland", "large", "Oregon", 1, "Beaverton|Hillsboro|Gresham"), admin1: "OR" },
      city("Sacramento", "large", "California", 1),
      city("Pittsburgh", "large", "Pennsylvania", 1),
      { ...city("Las Vegas", "large", "Nevada", 1, "Henderson|Paradise"), admin1: "NV" },
      { ...city("Austin", "large", "Texas", 1, "Round Rock"), admin1: "TX" },
      city("Cincinnati", "large", "Ohio", 1),
      { ...city("Columbus", "large", "Ohio", 1), admin1: "OH" },
      city("Indianapolis", "large", "Indiana", 1),
      city("San Jose", "large", "California", 1),
      { ...city("Nashville", "large", "Tennessee", 1), admin1: "TN" },
      city("Detroit", "large", "Michigan", 1),
      city("Milwaukee", "medium", "Wisconsin", 1),
      { ...city("Raleigh", "medium", "North Carolina", 1, "Cary"), admin1: "NC" },
      { ...city("Louisville", "medium", "Kentucky", 1), admin1: "KY" },
      { ...city("Memphis", "medium", "Tennessee", 1), admin1: "TN" },
      { ...city("Jacksonville", "medium", "Florida", 1), admin1: "FL" },
      city("Oklahoma City", "medium", "Oklahoma", 1),
      { ...city("Hartford", "medium", "Connecticut", 1), admin1: "CT" },
      city("Pawtucket", "small", "Rhode Island", 1),
      { ...city("Richmond", "medium", "Virginia", 1), admin1: "VA" },
      city("Birmingham", "medium", "Alabama", 1),
      city("New Orleans", "medium", "Louisiana", 1),
      city("Tulsa", "medium", "Oklahoma", 1),
      city("Albuquerque", "medium", "New Mexico", 1),
      { ...city("El Paso", "medium", "Texas", 1), admin1: "TX" },
      { ...city("Oakland", "medium", "California", 1), admin1: "CA" },
      city("Colorado Springs", "medium", "Colorado", 1),
      city("Tucson", "medium", "Arizona", 1),
      { ...city("Fresno", "medium", "California", 1), admin1: "CA" },
      city("Omaha", "medium", "Nebraska", 1),
      city("Baltimore", "medium", "Maryland", 1),
      city("Spokane", "small", "Washington", 1),
      city("Tacoma", "small", "Washington", 1),
      { ...city("Madison", "small", "Wisconsin", 1), admin1: "WI" },
      { ...city("Greenville", "small", "South Carolina", 1), admin1: "SC" },
      { ...city("Knoxville", "small", "Tennessee", 1), admin1: "TN" },
      city("Chattanooga", "small", "Tennessee", 1),
      { ...city("Charleston", "small", "South Carolina", 1), admin1: "SC" },
      { ...city("Lexington", "small", "Kentucky", 1), admin1: "KY" },
      city("Des Moines", "small", "Iowa", 1),
      city("Savannah", "small", "Georgia", 1),
      city("Wichita", "small", "Kansas", 1),
      city("Fort Worth", "medium", "Texas", 1),
      city("Bakersfield", "small", "California", 1),
      city("Durham", "small", "North Carolina", 1),
      city("Norfolk", "small", "Virginia", 1),
      city("Boise", "small", "Idaho", 1),
      city("Corpus Christi", "small", "Texas", 1),
      city("Santa Barbara", "small", "California", 1),
      city("Naples", "town", "Florida", 1),
      city("Statesboro", "town", "Georgia", 1),
    ],
  },
  football: {
    leagues: [
      {
        tier: 1,
        // 30 clubs incl. Toronto, Vancouver and Montréal (hosted, see CA): 2 round-robins inside each 15-team
        // conference (28) plus 6 inter-conference games = the real 34.
        name: "Major League Soccer",
        shortName: "MLS",
        size: 30,
        status: "professional",
        reputation: 66,
        closed: true,
        conferences: ["Eastern Conference", "Western Conference"],
        interConference: 6,
        // MLS Cup Playoffs: top nine per conference (8 v 9 wild card), single matches, higher seed hosts the final.
        championship: { positions: [1, 9], perConference: true, legs: 1, finalLegs: 1 },
        clubs: {
          reputation: { top: 66, bottom: 56 },
          giants: { count: 4, top: 72, bottom: 68 },
          capacity: { top: 45_000, bottom: 18_000 },
          facilities: { top: 84, bottom: 68 },
          academy: { top: 76, bottom: 58 },
          // Salary budget about US$5.95m plus Designated Players and allocation money; payrolls about $13m–$46m.
          wageBill: { top: 36_000_000, bottom: 10_000_000 },
          transferBudget: { top: 14_000_000, bottom: 1_500_000 },
          foreignShare: 0.5,
          squadSize: [28, 30],
        },
      },
      {
        tier: 2,
        // 24 clubs in two 12-team conferences; 3 round-robins (33) approximate the real 30-game schedule.
        name: "USL Championship",
        shortName: "USL Championship",
        size: 24,
        status: "professional",
        reputation: 46,
        closed: true,
        roundRobins: 3,
        conferences: ["Eastern Conference", "Western Conference"],
        championship: { positions: [1, 8], perConference: true, legs: 1, finalLegs: 1 },
        clubs: {
          reputation: { top: 50, bottom: 43 },
          capacity: { top: 15_000, bottom: 5_000 },
          facilities: { top: 62, bottom: 46 },
          academy: { top: 52, bottom: 36 },
          wageBill: { top: 3_200_000, bottom: 1_100_000 },
          transferBudget: { top: 250_000, bottom: 10_000 },
          foreignShare: 0.35,
          squadSize: [25, 28],
        },
      },
      {
        tier: 3,
        name: "USL League One",
        shortName: "USL League One",
        size: 14,
        status: "professional",
        reputation: 36,
        closed: true,
        championship: { positions: [1, 8], legs: 1, finalLegs: 1 },
        clubs: {
          reputation: { top: 41, bottom: 34 },
          capacity: { top: 7_000, bottom: 2_500 },
          facilities: { top: 46, bottom: 34 },
          academy: { top: 40, bottom: 28 },
          wageBill: { top: 900_000, bottom: 380_000 },
          transferBudget: { top: 40_000, bottom: 0 },
          foreignShare: 0.3,
          squadSize: [25, 27],
        },
      },
    ],
    movement: [
      { upper: 1, promoted: 0, relegated: 0 },
      { upper: 2, promoted: 0, relegated: 0 },
    ],
    cups: [
      // MLS clubs join in the round of 32; the winner takes a Champions Cup place.
      { kind: "national", name: "U.S. Open Cup", shortName: "Open Cup", seededEntry: true, legs: 1, continental: true },
      // USL Cup (launched 2025): USL Championship and League One clubs only.
      { kind: "league", name: "USL Cup", tiers: [2, 3], legs: 1 },
    ],
    youth: {
      U19: {
        divisions: [division("MLS NEXT U19", [1, 1], 15), division("USL Academy U19", [2, 3], 13)],
        cup: { name: "MLS NEXT Cup" },
      },
      U17: {
        divisions: [division("MLS NEXT U17", [1, 1], 15), division("USL Academy U17", [2, 3], 13)],
      },
    },
    // MLS NEXT Pro: reserve sides of MLS clubs (independent members are not modeled), incl. two Canadian guests.
    reserves: {
      mode: "reserve-league",
      nameTemplate: "{club} II",
      eligibility: { parentTiers: [1], minReputation: 55, maxTeams: 25 },
      reserveLeague: {
        name: "MLS NEXT Pro",
        shortName: "MLS NEXT Pro",
        roundRobins: 2,
        conferences: ["Eastern Conference", "Western Conference"],
        reputation: 34,
      },
      squad: [24, 30],
    },
    clubNaming: {
      templates: [
        ...templates(
          `{city} FC:5; FC {city}:1.5; {city} SC:2; {city} United:2.5; {city} City:1.5; {city} Union:0.6;
           {city} Athletic:0.6; Sporting {city}:0.6; Real {city}:0.3; Atlético {city}:0.2; {city} Rovers:0.4;
           {region} FC:0.5; {region} United:0.3`,
        ),
        ...templates(
          `{city} Republic:0.3; {city} Legion:0.3; {city} Independence:0.3; {city} Rising:0.2; {city} Battery:0.2;
           {city} Athletic Club:0.3; {city} Locomotive:0.2; {city} Kickers:0.2`,
          [2, 3],
        ),
      ],
      founded: { top: [1994, 2023], bottom: [1993, 2024] },
      // Not real clubs: blocks "{city} City" doubling the word in these city names.
      avoid: list("New York City City|Salt Lake City City|Kansas City City|Oklahoma City City"),
      colors: ["#002B5C", "#C8102E", "#FFFFFF", "#000000", "#F7B5CD", "#80000A", "#5D9741", "#FFD200", "#6CACE4"],
    },
    importSources: weighted(
      `AR:7 CO:6 BR:5 VE:3 UY:3 MX:3 EN:3 JM:3 GH:3 ES:3 HN:2 CR:2 PY:2 EC:2 FR:2 DE:2 CA:2 NG:1 SE:1 NO:1 DK:1
       NL:1 PT:1 IT:1 JP:1 KR:1 AU:1 PA:1 HT:1 CI:1 SN:1 CM:1 CL:1 PE:1 IE:1 SCO:1`,
    ),
    coefficients: { association: [13.0, 15.5, 14.0, 14.5, 14.0] },
  },
  abroad: {
    seniors: 120,
    youth: 25,
    destinations: weighted(
      `EN:14 DE:12 NL:7 BE:4 IT:5 FR:4 ES:3 PT:3 SCO:3 DK:3 NO:3 SE:2 AT:3 CH:2 TR:2 GR:2 PL:1 HR:1 MX:8 CA:2 SA:1 JP:1`,
    ),
  },
};

// ------------------------------------------------------------------ Canada

const CA: NationSpec = {
  code: "CA",
  iso2: "CA",
  name: "Canada",
  confederation: "CONCACAF",
  continent: "NA",
  capital: "Ottawa",
  latitude: 45.4,
  languages: languages("en:7.5 fr:2.5"),
  reputation: { national: 72, league: 44 },
  euEea: false,
  physique: { height: 181 },
  names: {
    given: sources("faker:en=5 canadian-french=1.6 american=1"),
    family: sources("uefa-north/english=2 faker:en=2 uefa-north/scottish=1.2 uefa-north/irish=0.8 canadian-french=1.8"),
  },
  nationality: {
    multipleRate: 0.36,
    tripleRate: 0.08,
    bornAbroadRate: 0.18,
    diasporaPull: 0.5,
    links: [
      ...links("commonwealth", "EN:7 SCO:2 GH:4 NG:3 IN:2 KE:0.5"),
      ...links("britishIrish", "IE:2"),
      ...links("caribbean", "JM:6 HT:5 TT:2 GY:1"),
      ...links("americas", "US:5 CO:1 SV:1 MX:1 CL:0.5"),
      ...links("crossBorder", "IT:5 PT:5 DE:1 PL:1 GR:1 HR:1 RS:1 NL:1"),
      ...links("frenchAfrica", "FR:3 CI:2 CM:2 CD:2 MA:2 SN:1 DZ:1"),
      ...links("asianDiaspora", "PH:2 KR:1 CN:1 VN:0.5"),
    ],
    citizenship: allowed,
  },
  cities: {
    major: [
      city("Toronto", "mega", "Ontario", 4, "Scarborough|North York|Etobicoke|East York|Downsview"),
      city("Montréal", "large", "Québec", 3, "Saint-Laurent|Outremont|Verdun|Anjou|Saint-Léonard|Pierrefonds"),
      city("Vancouver", "large", "British Columbia", 2),
      city("Calgary", "large", "Alberta", 2),
      city("Edmonton", "large", "Alberta", 2),
      city("Ottawa", "large", "Ontario", 2),
      city("Mississauga", "large", "Ontario", 2),
      city("Winnipeg", "large", "Manitoba", 1),
      city("Québec", "medium", "Québec", 2, "Beauport|Sainte-Foy|Charlesbourg"),
      city("Laval", "medium", "Québec", 2),
      city("Vaughan", "medium", "Ontario", 2, "Woodbridge|Maple"),
      city("Hamilton", "medium", "Ontario", 1),
      city("Brampton", "medium", "Ontario", 1),
      city("Surrey", "medium", "British Columbia", 1),
      city("Halifax", "medium", "Nova Scotia", 1),
      city("London", "medium", "Ontario", 1),
      city("Markham", "medium", "Ontario", 1),
      city("Gatineau", "medium", "Québec", 1),
      city("Longueuil", "medium", "Québec", 1),
      city("Burnaby", "medium", "British Columbia", 1),
      city("Kitchener", "medium", "Ontario", 1),
      city("Saanich", "medium", "British Columbia", 1),
      city("Saskatoon", "medium", "Saskatchewan", 1),
      city("Regina", "medium", "Saskatchewan", 1),
      ...cities(
        "British Columbia",
        "Langford:small, Langley:small, Coquitlam:small, Kelowna:small, Abbotsford:small, Nanaimo:small, Kamloops:small",
      ),
      ...cities(
        "Ontario",
        "Oakville:small, Burlington:small, Oshawa:small, Barrie:small, Guelph:small, Cambridge:small, St. Catharines:small, Peterborough:small, Thunder Bay:small, Brantford, Sarnia",
      ),
      ...cities(
        "Québec",
        "Sherbrooke:small, Trois-Rivières:small, Saguenay:small, Lévis:small, Terrebonne:small, Blainville, Boisbriand, Brossard, Repentigny, Saint-Jean-sur-Richelieu",
      ),
      ...cities("Alberta", "Red Deer:small, Lethbridge:small"),
      ...cities("New Brunswick", "Moncton:small, Saint John:small, Fredericton:small"),
      city("St. John's", "small", "Newfoundland and Labrador"),
      city("Charlottetown", "town", "Prince Edward Island"),
    ],
  },
  football: {
    leagues: [
      {
        tier: 1,
        name: "Canadian Premier League",
        shortName: "CPL",
        size: 8,
        status: "professional",
        reputation: 44,
        closed: true,
        roundRobins: 4,
        // Top five: play-in 4 v 5, then knockout; the final is hosted by the higher seed.
        championship: { positions: [1, 5], legs: 1, finalLegs: 1 },
        clubs: {
          reputation: { top: 46, bottom: 40 },
          capacity: { top: 24_000, bottom: 4_000 },
          facilities: { top: 55, bottom: 42 },
          academy: { top: 50, bottom: 36 },
          // Salary cap about CA$1.35m plus exemptions.
          wageBill: { top: 1_300_000, bottom: 800_000 },
          transferBudget: { top: 120_000, bottom: 10_000 },
          foreignShare: 0.3,
          squadSize: [25, 28],
        },
      },
      {
        tier: 2,
        // League1 Ontario, Ligue1 Québec and League1 BC/Alberta merged into one pro-am division (decision 4).
        name: "League1 Canada",
        shortName: "League1",
        size: 36,
        status: "semi-professional",
        reputation: 28,
        closed: true,
        conferences: ["Eastern Conference", "Central Conference", "Western Conference"],
        // Inter-Provincial Championship between the provincial front-runners.
        championship: { positions: [1, 2], perConference: true, legs: 1, finalLegs: 1, neutralFinal: true },
        clubs: {
          reputation: { top: 30, bottom: 22 },
          capacity: { top: 3_500, bottom: 500 },
          facilities: { top: 38, bottom: 24 },
          academy: { top: 42, bottom: 26 },
          wageBill: { top: 90_000, bottom: 15_000 },
          transferBudget: { top: 5_000, bottom: 0 },
          foreignShare: 0.08,
          squadSize: [25, 27],
        },
      },
    ],
    movement: [{ upper: 1, promoted: 0, relegated: 0 }],
    cups: [
      // MLS (hosted), CPL and League1 provincial champions; the winner takes a Champions Cup place.
      { kind: "national", name: "Canadian Championship", maxEntrants: 14, legs: 2, finalLegs: 1, continental: true },
    ],
    youth: {
      U19: { divisions: [division("League1 Canada U19", [1, 2], 15)] },
      U17: { divisions: [division("League1 Canada U17", [1, 2], 15)] },
    },
    // Toronto FC II and Whitecaps FC 2 play in MLS NEXT Pro (US); CF Montréal fields no reserve side.
    reserves: {
      mode: "reserve-league",
      nameTemplate: "{club} II",
      eligibility: { parentTiers: [1], minReputation: 55, maxTeams: 2 },
      reserveLeague: { name: "MLS NEXT Pro", shortName: "MLS NEXT Pro", host: "US", reputation: 34 },
      squad: [24, 30],
    },
    clubNaming: {
      templates: templates(
        `{city} FC:4; FC {city}:1.5; {city} SC:1.5; {city} United:2; {city} City:1; {city} Wanderers:0.5;
         Atlético {city}:0.3; {city} Rovers:0.6; {city} Athletic:0.4; {city} Olympic:0.3; {region} FC:0.3`,
      ),
      regional: [
        {
          regions: ["Québec"],
          templates: templates(`CS {city}:3; AS {city}:2; FC {city}:2; {city} FC:1; CF {city}:0.6; Royal {city}:0.3`),
        },
      ],
      founded: { top: [2006, 2023], bottom: [1965, 2022] },
      colors: ["#D80621", "#FFFFFF", "#000000", "#00245D", "#FDB913", "#6CACE4", "#00843D", "#7A2531"],
    },
    importSources: weighted(
      "US:4 EN:3 JM:2 BR:2 AR:2 CO:2 FR:2 ES:2 HT:2 GH:1 NG:1 CM:1 MX:1 IE:1 SCO:1 DE:1 NL:1 TT:1 PA:1 CR:1",
    ),
    coefficients: { association: [6.5, 6.0, 7.0, 7.0, 9.5] },
  },
  hostedAbroad: [
    {
      host: "US",
      tiers: [1, 1, 1],
      cities: ["Toronto", "Vancouver", "Montréal"],
      cups: "home",
      continental: "home",
      youth: "host",
      registration: "host",
    },
  ],
  abroad: {
    seniors: 70,
    youth: 15,
    destinations: weighted("US:14 EN:4 SCO:3 BE:2 NL:1 DE:2 FR:2 PT:2 IT:1 NO:2 SE:1 DK:1 TR:1 GR:1 PL:1 MX:1 AT:1 CH:1 HR:1"),
  },
};

// ------------------------------------------------------------------ Mexico

const MEXICAN = pool(
  "mexican",
  `Hirving Raúl Edson Santiago Julián César Orbelín Érick Alexis Jesús Uriel Johan Obed Kevin Brian Israel Diego Alan
   Roberto Guillermo Ángel Jorge Carlos Andrés Rodolfo Víctor Jonathan Efraín Fernando Luis Héctor Javier Hugo Rafael
   Gerardo Marcelo Sebastián Emilio Alejandro Iván Omar Ulises Jair Ozziel Jordan Gilberto Isaac Gael Rubén Ricardo
   Francisco Eduardo Arturo Adrián Alonso Mauricio Emiliano Leonardo Aldo Axel Marco Jaime Salvador Óscar Gustavo
   Armando Josué Brandon Bryan Ronaldo Rogelio Germán Íñigo Cuauhtémoc Rigoberto Heriberto Fidel Ramón Erubey`,
  "",
);

const MX: NationSpec = {
  code: "MX",
  iso2: "MX",
  name: "Mexico",
  confederation: "CONCACAF",
  continent: "NA",
  capital: "Ciudad de México",
  latitude: 19.4,
  languages: languages("es:10"),
  reputation: { national: 77, league: 68 },
  euEea: false,
  physique: { height: 176, heightSd: 6 },
  names: { given: sources("faker:es_MX=4 mexican=3"), family: sources("faker:es_MX=1"), secondFamilyRate: 0.06 },
  nationality: {
    multipleRate: 0.2,
    tripleRate: 0.03,
    bornAbroadRate: 0.08,
    diasporaPull: 0.6,
    links: [
      ...links("americas", "US:12 GT:3 AR:3 CO:2 CA:1 SV:1 HN:1 CU:1 UY:1 VE:1"),
      ...links("mediterranean", "ES:3 IT:1"),
      ...links("arabWorld", "LB:0.5"),
    ],
    citizenship: allowed,
  },
  cities: {
    major: [
      city("Ciudad de México", "mega", "Ciudad de México", 4, "Coyoacán|Tlalpan|Iztapalapa|Azcapotzalco|Xochimilco|Coapa|Tlatelolco"),
      city("Guadalajara", "mega", "Jalisco", 3, "Tlaquepaque|Tonalá|Tlajomulco"),
      { ...city("Monterrey", "mega", "Nuevo León", 3, "San Nicolás|Guadalupe|Apodaca|Santa Catarina"), admin1: "19" },
      city("Puebla", "large", "Puebla", 2),
      city("Zapopan", "large", "Jalisco", 1),
      city("Nezahualcóyotl", "large", "Estado de México", 1),
      city("Toluca", "large", "Estado de México", 1),
      city("León", "large", "Guanajuato", 1),
      city("Tijuana", "large", "Baja California", 1),
      city("Querétaro", "large", "Querétaro", 1),
      city("Ciudad Juárez", "large", "Chihuahua", 1),
      city("Torreón", "large", "Coahuila", 1),
      city("San Luis Potosí", "large", "San Luis Potosí", 1),
      city("Aguascalientes", "large", "Aguascalientes", 1),
      city("Mérida", "large", "Yucatán", 1),
      city("Cancún", "large", "Quintana Roo", 1),
      city("Culiacán", "large", "Sinaloa", 1),
      city("Morelia", "large", "Michoacán", 1),
      city("Chihuahua", "large", "Chihuahua", 1),
      city("Hermosillo", "large", "Sonora", 1),
      city("Saltillo", "large", "Coahuila", 1),
      city("Mexicali", "large", "Baja California", 1),
      city("Veracruz", "large", "Veracruz", 1),
      city("Mazatlán", "medium", "Sinaloa", 1),
      city("Pachuca", "medium", "Hidalgo", 1),
      city("Oaxaca", "medium", "Oaxaca", 1),
      city("Tampico", "medium", "Tamaulipas", 1),
      city("Ciudad Victoria", "medium", "Tamaulipas", 1),
      city("Durango", "medium", "Durango", 1),
      city("Zacatecas", "medium", "Zacatecas", 1),
      city("Celaya", "medium", "Guanajuato", 1),
      city("Irapuato", "medium", "Guanajuato", 1),
      city("Acapulco", "medium", "Guerrero", 1),
      city("Cuernavaca", "medium", "Morelos", 1),
      city("Villahermosa", "medium", "Tabasco", 1),
      city("Tuxtla Gutiérrez", "medium", "Chiapas", 1),
      city("Tepic", "medium", "Nayarit", 1),
      { ...city("La Paz", "medium", "Baja California Sur", 1), admin1: "03" },
      city("Reynosa", "medium", "Tamaulipas", 1),
      city("Xalapa", "medium", "Veracruz", 1),
      city("Tlaxcala", "small", "Tlaxcala", 1),
      city("Tepatitlán", "small", "Jalisco", 1),
      city("Colima", "small", "Colima", 1),
      city("Tapachula", "small", "Chiapas", 1),
      city("Los Mochis", "small", "Sinaloa", 1),
      city("Ciudad Obregón", "small", "Sonora", 1),
      city("Uruapan", "small", "Michoacán", 1),
      city("Ensenada", "small", "Baja California", 1),
      city("Zacatepec", "town", "Morelos", 1),
      city("Playa del Carmen", "town", "Quintana Roo", 1),
    ],
  },
  football: {
    leagues: [
      {
        tier: 1,
        // Apertura and Clausura merge into one double round-robin (decision 10); relegation is suspended.
        name: "Liga MX",
        shortName: "Liga MX",
        size: 18,
        status: "professional",
        reputation: 68,
        closed: true,
        // Liguilla: top six plus a 7th-10th play-in; two-legged ties and final.
        championship: { positions: [1, 10], legs: 2, finalLegs: 2 },
        clubs: {
          reputation: { top: 67, bottom: 58 },
          giants: { count: 5, top: 76, bottom: 70 },
          capacity: { top: 58_000, bottom: 20_000 },
          facilities: { top: 78, bottom: 60 },
          academy: { top: 78, bottom: 58 },
          wageBill: { top: 32_000_000, bottom: 6_000_000 },
          transferBudget: { top: 15_000_000, bottom: 500_000 },
          foreignShare: 0.35,
          squadSize: [27, 32],
        },
      },
      {
        tier: 2,
        // Incl. two reserve sides (Tapatío, Raya2 style); no promotion while Liga MX relegation is suspended.
        name: "Liga de Expansión MX",
        shortName: "Expansión MX",
        size: 16,
        status: "professional",
        reputation: 44,
        closed: true,
        bTeams: 2,
        // Reclassification 5th-12th, then quarter-finals onwards over two legs.
        championship: { positions: [1, 12], legs: 2, finalLegs: 2 },
        clubs: {
          reputation: { top: 46, bottom: 38 },
          capacity: { top: 30_000, bottom: 5_000 },
          facilities: { top: 52, bottom: 38 },
          academy: { top: 52, bottom: 36 },
          wageBill: { top: 1_800_000, bottom: 350_000 },
          transferBudget: { top: 150_000, bottom: 0 },
          foreignShare: 0.12,
          squadSize: [25, 28],
        },
      },
    ],
    movement: [{ upper: 1, promoted: 0, relegated: 0 }],
    cups: [
      // No national cup: Copa MX has not been played since 2019-20.
      // Campeón de Campeones pairs the Apertura and Clausura champions: here champion v play-off finalist.
      { kind: "super", name: "Campeón de Campeones", participants: ["champion", "runner-up"], legs: 1, start: "07-05" },
    ],
    youth: {
      U19: { divisions: [division("Liga MX Sub-19", [1, 1], 9), division("Liga de Expansión MX Sub-19", [2, 2], 14)] },
      U17: { divisions: [division("Liga MX Sub-17", [1, 1], 9), division("Liga de Expansión MX Sub-17", [2, 2], 14)] },
    },
    reserves: {
      mode: "pyramid",
      nameTemplate: "{club} B",
      eligibility: { parentTiers: [1], minReputation: 70, maxTeams: 2 },
      pyramid: { highestTier: 2, minGapBelowParent: 1, maxPerTier: 2 },
      squad: [22, 28],
    },
    clubNaming: {
      templates: templates(
        `Club {city}:2; Deportivo {city}:2; Atlético {city}:2; Real {city}:1; Club Atlético {city}:1; {city} FC:1.5;
         Club Deportivo {city}:0.8; Unión {city}:0.6; Racing {city}:0.3; Toros de {city}:0.4; Leones de {city}:0.4;
         Halcones de {city}:0.3; Coyotes de {city}:0.3; Potros de {city}:0.3; Venados de {city}:0.2;
         Alacranes de {city}:0.2; Cañeros de {city}:0.2; Club {region}:0.3; {region} FC:0.3`,
      ),
      founded: { top: [1901, 2020], bottom: [1917, 2022] },
      colors: ["#FFD100", "#0033A0", "#C8102E", "#006341", "#FFFFFF", "#000000", "#8A1538", "#F47A20"],
    },
    importSources: weighted(
      "AR:10 CO:7 UY:6 PY:4 BR:4 CL:3 EC:3 VE:2 US:2 ES:2 PE:1 PA:1 CR:1 HN:1 FR:1 PT:1 BE:1 NL:1 BO:1 GH:1 NG:1 CM:1 SE:1",
    ),
    coefficients: { association: [17.5, 16.0, 17.0, 17.5, 18.0] },
  },
  abroad: {
    seniors: 45,
    youth: 12,
    destinations: weighted("US:12 ES:4 NL:2 PT:2 BE:2 EN:2 IT:3 GR:2 TR:1 RU:1 SCO:1 FR:1 DE:1 CA:1"),
  },
};

// ------------------------------------------------------------------ New Zealand and Polynesian pools

const MAORI = pool(
  "maori",
  `Tamati Wiremu Hemi Rawiri Tane Nikau Manaia Kahu Ariki Rangi Tipene Mikaere Hohepa Pita Hone Rewi Ihaia Matiu Paora
   Anaru Kauri Kereama Kingi Maui Mana Piripi Rahiri Rehua Taika Tawera Waka Whetu Aperahama Timoti Ropata Hirini
   Tamihana Hamiora Tuhi Awatea`,
  `Ngata Parata Walker Tamihana Rangihuna Wihongi Kereama Tipene Tawhai Paewai Hohaia Ruru Rewiti Tomoana Ngatai
   Waititi Tuhiwai Karaka Tapsell Horomona Pomare Tamatea Ratana Heke Wiremu Rangi Hapi Tautari Ranginui Takerei Pene
   Mahuta Taurima Poutama Paki Toia Harawira Kingi Tapiata Rewi Wharepapa Manahi Nikora Rata Matenga Paora Hetaraka
   Aperahama Tutaki Hemara Hura Kawana Maaka Ngawati Potae Rakena Tamaki Tuhoe Whaanga Herewini Hapeta Kopu Rikihana
   Tamepo Ngarimu Pohatu`,
);
const SAMOAN = pool(
  "samoan",
  `Tavita Ioane Sione Tui Leka Afa Isaia Siaosi Pita Mika Lealofi Fetu Filipo Iosefa Lopeti Mose Paulo Petelo Sefo
   Sila Tasi Viliamu Aukuso Fa'afetai Iakopo Kalolo Losa Malaki Nofo Onosai Pasi Sami Semisi Tomasi Uili Faamanu
   Lomasi Setefano Sakaio Aleki Fonoti Keni Matai`,
  `Tuiloma Leota Faumuina Tupuola Toelupe Mataia Aiono Lemalu Tagaloa Tuilagi Fa'asavalu Fonoti Masoe Seumanutafa
   Afamasaga Amituanai Aumua Fruean Iosefo Lauina Leavasa Mulitalo Pouono Salave'a Schwalger Soliai Sopoaga Tagiilima
   Tamapeau Toala Tuala Tuitama Tuiasosopo Ulugia Vaifale Vaili Faleafa Galuvao Leiataua Mealamu Naea Pula Sapolu
   Seiuli Sila Suaalii Talataina Tauiliili Toleafoa Tuimavave Fuimaono Lefiti Pauga Salapu Tiatia Lealaiauloto
   Stanley Retzlaff Brown Schuster Meredith`,
);
const TONGAN = pool(
  "tongan",
  `Sione Tevita Salesi Viliami Meleki Siaosi Lopeti Taniela Samuela Sitani Semisi Tomasi Kalolo Paula Mosese Etuini
   Kiliona Loni Manu Nikolasi Ofa Pauliasi Saia Sosefo Tavite Uasi Folau Haloti Isileli Maka Penisoni Soane Tangitau
   Lisiate Hemaloto Kaveinga Sifa Vaka Lotu`,
  `Tupou Taufua Fifita Kaufusi Latu Vea Fusitu'a Faletau Havili Fekitoa Tuipulotu Vainikolo Hufanga Folau Piutau Ma'afu
   Vaipulu Taione Lolohea Moala Naufahu Taumalolo Veikune Mafi Pulu Tonga'uiha Fonua Manu Taufahema Tu'ungafasi Vunipola
   Fa'otusia Koloamatangi Lavaka Mahe Pasikala Sika Talakai Uasi Vaka Kioa Motuliki Halafihi Helu Tau'alupe Kata
   Funaki Lokotui Ahoafi Pangai`,
);

const NZ: NationSpec = {
  code: "NZ",
  iso2: "NZ",
  name: "New Zealand",
  confederation: "OFC",
  continent: "OC",
  capital: "Wellington",
  latitude: -41.3,
  languages: languages("en:10"),
  reputation: { national: 55, league: 30 },
  euEea: false,
  physique: { height: 182 },
  names: {
    given: sources("faker:en_AU=4 faker:en=2 maori=1 samoan=0.4 tongan=0.2"),
    family: sources(
      "uefa-north/english=3 uefa-north/scottish=2 uefa-north/irish=1 maori=1.2 samoan=0.5 tongan=0.25 faker:nl=0.2",
    ),
  },
  nationality: {
    multipleRate: 0.34,
    tripleRate: 0.07,
    bornAbroadRate: 0.18,
    diasporaPull: 0.45,
    links: [
      ...links("pacific", "AU:10 WS:5 TO:4 FJ:3 CK:2"),
      ...links("commonwealth", "EN:8 SCO:3 ZA:3 WAL:1 IN:1"),
      ...links("britishIrish", "IE:2"),
      ...links("crossBorder", "NL:1 HR:1 RS:1"),
      ...links("mediterranean", "GR:0.5 IT:0.5"),
      ...links("asianDiaspora", "CN:1 KR:0.5 PH:0.5"),
    ],
    citizenship: allowed,
  },
  cities: {
    major: [
      city("Auckland", "large", "Auckland", 6, "North Shore|Manukau|Waitakere|Eastern Suburbs|Onehunga|Papatoetoe|Birkenhead|Western Springs|Glenfield|Ellerslie|East Coast Bays"),
      city("Wellington", "medium", "Wellington", 3, "Miramar|Karori|Island Bay|Petone|Johnsonville|Seatoun"),
      city("Christchurch", "medium", "Canterbury", 3, "Cashmere|Ferrymead|Riccarton|Halswell|Burwood|Selwyn"),
      city("Hamilton", "medium", "Waikato", 2, "Melville|Hillcrest"),
      city("Dunedin", "medium", "Otago", 2, "Mosgiel|Caversham|Green Island"),
      city("Tauranga", "medium", "Bay of Plenty", 1),
      city("Lower Hutt", "medium", "Wellington", 1),
      city("Palmerston North", "medium", "Manawatū-Whanganui", 1),
      city("Napier", "small", "Hawke's Bay", 1),
      city("Hastings", "small", "Hawke's Bay", 1),
      city("Nelson", "small", "Nelson", 1),
      city("Rotorua", "small", "Bay of Plenty", 1),
      city("New Plymouth", "small", "Taranaki", 1),
      city("Whangārei", "small", "Northland", 1),
      city("Invercargill", "small", "Southland", 1),
      city("Porirua", "small", "Wellington", 1),
      city("Upper Hutt", "small", "Wellington", 1),
      city("Whanganui", "small", "Manawatū-Whanganui", 1),
      city("Gisborne", "small", "Gisborne", 1),
      ...cities("Canterbury", "Timaru, Ashburton, Rangiora"),
      ...cities("Otago", "Queenstown, Oamaru"),
      ...cities("Marlborough", "Blenheim"),
      ...cities("Wellington", "Masterton, Paraparaumu"),
      ...cities("Waikato", "Taupō, Cambridge, Te Awamutu"),
      ...cities("Manawatū-Whanganui", "Levin"),
      ...cities("Northland", "Kerikeri"),
    ],
  },
  football: {
    leagues: [
      {
        tier: 1,
        // The Northern, Central and Southern Leagues feed the national championship: one division (decision 4).
        name: "New Zealand National League",
        shortName: "National League",
        size: 30,
        status: "semi-professional",
        reputation: 30,
        conferences: ["Northern League", "Central League", "Southern League"],
        championship: { positions: [1, 3], perConference: true, legs: 1, finalLegs: 1, neutralFinal: true },
        clubs: {
          reputation: { top: 32, bottom: 22 },
          giants: { count: 1, top: 36, bottom: 35 },
          capacity: { top: 4_000, bottom: 500 },
          facilities: { top: 42, bottom: 26 },
          academy: { top: 46, bottom: 28 },
          wageBill: { top: 150_000, bottom: 15_000 },
          transferBudget: { top: 5_000, bottom: 0 },
          foreignShare: 0.15,
          squadSize: [25, 27],
        },
      },
    ],
    movement: [],
    cups: [{ kind: "national", name: "Chatham Cup", legs: 1, neutralFinal: true }],
    // Wellington Phoenix and Auckland FC academies (hosted in AU, youth "home") join the first division.
    youth: {
      U19: { divisions: [division("National Youth League", [1, 1], 11)] },
      U17: { divisions: [division("National Under-17 League", [1, 1], 11)] },
    },
    reserves: { mode: "none" },
    clubNaming: {
      templates: templates(
        `{city} AFC:2; {city} United:3; {city} City:2; {city} Rangers:1.2; {city} Wanderers:1; {city} Olympic:0.8;
         {city} Rovers:0.8; {city} Athletic:0.6; {city} Technical:0.4; {city} FC:1.5; {city} Bays:0.2;
         {region} United:0.4`,
      ),
      founded: { top: [1890, 2012], bottom: [1890, 2015] },
      colors: ["#000000", "#FFFFFF", "#FFD200", "#0055A5", "#C8102E", "#00843D", "#6CACE4"],
    },
    importSources: weighted("EN:4 AU:3 SCO:2 IE:1 US:2 JP:2 KR:1 BR:2 ES:2 FJ:1 SB:1 NC:1 PF:1 VU:1 ZA:1 NL:1 DE:1 FR:1 CA:1"),
  },
  // A-League Men 2025/26 (12 clubs, see afc AU): no Australia Cup and no AFC access for New Zealand clubs.
  hostedAbroad: [
    {
      host: "AU",
      tiers: [1, 1],
      cities: ["Wellington", "Auckland"],
      cups: "none",
      continental: "none",
      youth: "home",
      registration: "host",
    },
  ],
  abroad: {
    seniors: 45,
    youth: 10,
    destinations: weighted("AU:10 EN:5 SCO:2 US:6 NL:2 DK:2 NO:2 SE:1 DE:1 BE:1 IT:1 GR:1 JP:1"),
  },
};

// ------------------------------------------------------------------ Central America

const CENTRAL_AMERICAN = pool(
  "central-american",
  `Brayan Bryan Kevin Kendall Jairo Yeltsin Darwin Wilmer Elvin Denil Alberth Romell Deiby Kervin Jostin Keysher Haxzel
   Jewison Yostin Ronald Wilson Maynor Rubilio Boniek Andy Allan Randall Francisco José Luis Carlos Jorge Juan Mario
   Óscar Marvin Edwin Erick Jonathan Alexander Anthony Christian Cristian Joshua Josué Walter Nelson Henry Harold
   Jefferson Anderson Wilfredo Rolando Rodrigo Gerson Selvin Héctor Rigoberto Arnold Axel Aarón Alejandro Andrés
   Brandon Dennis Eduardo Emilio Ever Fabián Freddy Gabriel Geovanny Hansel Iván Jafet Jeison Jonny Josimar Julio
   Junior Keyner Kenneth Leonel Manfred Mauricio Michael Nahúm Néstor Orlando Osman Pablo Ramiro Randy Ricardo Roger
   Ronny Samuel Santos Sergio Stheven Víctor Yordy Élmer Darixon Dixon Fredy Arquímides Nicolás Cecilio Amílcar Blas
   Román Aníbal Adalberto Fidel Ismael Yoel Édgar Gustavo Ariel Warren Everardo Froylán Alonso`,
  "",
);
const COSTA_RICAN = pool(
  "costa-rican",
  "",
  `Navas Ruiz Campbell Borges Calvo Waston Oviedo Duarte González Gamboa Tejeda Venegas Bennette Aguilera Ugalde
   Contreras Galo Vargas Alcócer Brenes Quirós Mora Solís Araya Arias Chaves Zúñiga Leiva Alfaro Madrigal Camacho
   Umaña Jiménez Rojas Castro Salas Monge Soto Cubero Murillo Montero Sequeira Barrantes Villalobos Porras Picado
   Cordero Esquivel Segura Carvajal Herrera Méndez Hidalgo Obando Valverde Fonseca Víquez Marín Retana Gutiérrez
   Badilla Bolaños Matarrita Ledezma Centeno Guzmán Rodríguez Wallace Forbes`,
);
const HONDURAN = pool(
  "honduran",
  "",
  `Palacios Arzú Martínez Álvarez Güity Bernárdez Suazo Lalín Bengtson Castillo Figueroa Izaguirre Najar Quioto Elis
   Lozano Maldonado Arriaga Flores Palma Rodríguez Moya Chirinos Benguché Pineda Mejía Reyes Zelaya Canales Cardona
   García Hernández Portillo Velásquez Espinoza Rosales Rivas Salgado Sabillón Aceituno Cruz Mendoza Varela Guevara
   Bodden Brooks Crisanto Meléndez Montes Núñez Oliva Padilla Pavón Ramos Solano Sosa Tábora Turcios Valladares
   Vallecillo Discua Cárcamo Cálix Oseguera Róchez Lagos Barahona Aguilar Elvir Leverón`,
);
const GUATEMALAN = pool(
  "guatemalan",
  "",
  `Rubín Herrera Santis Samayoa Pinto Mejía Lom Ordóñez López Saravia Morales Robles Moscoso Hagen Galindo Altán
   Ávila Ruiz Pappa Pezzarossi Castellanos Cabrera Monterroso Méndez Estrada Barrios Chinchilla Arévalo Rivera Aldana
   Cardona Velásquez Contreras Girón Juárez Morán Orellana Paredes Quiñónez Reyes Sandoval Toledo Vásquez Xitumul Ajú
   Batz Cumes Chen Tzul Coc Pop Caal Xol Choc Ixcot Cuxil Tuyuc Yax Sic Chavajay Guarcas Solórzano Guerra Motta Lemus
   Figueroa Castañeda Mazariegos Aguilar`,
);
const SALVADORAN = pool(
  "salvadoran",
  "",
  `Henríquez Gil Cerén Bonilla Roldán Zavaleta Tejada González Orellana Tamacas Osorio Landaverde Rodríguez Sibrián
   Hernández Martínez Rivas Alfaro Ayala Barahona Benítez Canales Chávez Deras Escobar Flores Fuentes Galdámez
   Guevara Larín Lemus Menjívar Molina Monterrosa Portillo Quintanilla Ramírez Recinos Sandoval Serrano Umanzor
   Vásquez Zelaya Pacheco Cienfuegos Burgos Castro Cortez Anzora Velásquez Argueta Villalta Mejía Aparicio Alvarado
   Palacios Magaña Jovel Mancía Revelo`,
);
const PANAMANIAN = pool(
  "panamanian",
  "",
  `Godoy Carrasquilla Murillo Escobar Cummings Davis Fajardo Waterman Bárcenas Díaz Pérez Torres Tejada Henríquez
   Blackburn Arroyo Quintero Góndola Andrade Blackman Mosquera Mejía Gutiérrez Rodríguez Guerrero Harvey Londoño
   Phillips Welch Baloy Gómez Camargo Machado Samudio Castillo Walker Stephens Cooper Anderson Miller Small Browne
   Williams Jackson Bennett Allen Ávila Barría Caballero Cedeño Córdoba Frías Herrera Jaén Mena Moreno Núñez Ortega
   Pimentel Rentería Saldaña Tuñón Vargas Villarreal Yanis Gálvez Ortiz Palacios`,
);

const PA: NationSpec = {
  code: "PA",
  iso2: "PA",
  name: "Panama",
  confederation: "CONCACAF",
  continent: "NA",
  capital: "Panamá",
  latitude: 9.0,
  languages: languages("es:10"),
  reputation: { national: 66, league: 38 },
  euEea: false,
  physique: { height: 177 },
  names: { given: sources("central-american=3 faker:es=2"), family: sources("panamanian=3 faker:es=2") },
  nationality: {
    multipleRate: 0.22,
    tripleRate: 0.03,
    bornAbroadRate: 0.06,
    diasporaPull: 0.5,
    links: [
      ...links("americas", "CO:6 US:4 CR:2 VE:2 MX:1"),
      ...links("caribbean", "JM:3 BB:1 TT:1"),
      ...links("mediterranean", "ES:1"),
      ...links("asianDiaspora", "CN:1"),
    ],
    citizenship: allowed,
  },
  cities: {
    major: [
      city("Panamá", "large", "Panamá", 4, "Juan Díaz|Pedregal|Río Abajo|Chorrillo|Bethania|Pueblo Nuevo|Calidonia|Tocumen"),
      city("San Miguelito", "medium", "Panamá", 2),
      city("La Chorrera", "medium", "Panamá Oeste", 2),
      city("Colón", "medium", "Colón", 2),
      city("Arraiján", "medium", "Panamá Oeste", 1),
      city("David", "medium", "Chiriquí", 1),
      city("Santiago de Veraguas", "small", "Veraguas", 1),
      city("Chitré", "small", "Herrera", 1),
      city("Penonomé", "small", "Coclé", 1),
      ...cities("Los Santos", "Las Tablas"),
      ...cities("Coclé", "Aguadulce, Antón"),
      ...cities("Bocas del Toro", "Changuinola, Bocas del Toro"),
      ...cities("Chiriquí", "Boquete, Puerto Armuelles"),
      ...cities("Panamá Oeste", "Capira"),
    ],
  },
  football: {
    leagues: [
      {
        tier: 1,
        // Apertura and Clausura merge (decision 10); 3 round-robins approximate the yearly schedule.
        name: "Liga Panameña de Fútbol",
        shortName: "LPF",
        size: 12,
        status: "professional",
        reputation: 38,
        roundRobins: 3,
        championship: { positions: [1, 8], legs: 2, finalLegs: 1, neutralFinal: true },
        clubs: {
          reputation: { top: 42, bottom: 33 },
          capacity: { top: 12_000, bottom: 1_500 },
          facilities: { top: 46, bottom: 30 },
          academy: { top: 52, bottom: 34 },
          wageBill: { top: 1_200_000, bottom: 250_000 },
          transferBudget: { top: 120_000, bottom: 0 },
          foreignShare: 0.12,
          squadSize: [25, 28],
        },
      },
    ],
    movement: [],
    cups: [{ kind: "national", name: "Copa Panamá", legs: 1 }],
    youth: {
      U19: { divisions: [division("LPF Sub-20", [1, 1], 12)] },
      U17: { divisions: [division("LPF Sub-17", [1, 1], 12)] },
    },
    reserves: { mode: "none" },
    clubNaming: {
      templates: templates(
        `CD {city}:2; {city} FC:2; Sporting {city}:1.5; Club Atlético {city}:1; Atlético {city}:1; Deportivo {city}:1;
         Real {city}:0.8; Unión {city}:0.8; Alianza {city}:0.4; Independiente {city}:0.6; {region} FC:0.5;
         {region} United:0.5`,
      ),
      founded: { top: [1935, 2016], bottom: [1935, 2016] },
      colors: ["#DA121A", "#072357", "#FFFFFF", "#FFD100", "#00843D", "#000000", "#F47A20"],
    },
    importSources: weighted("CO:6 VE:2 CR:1 HN:1 AR:1 BR:1 CU:1 JM:1 NI:1 UY:1"),
    coefficients: { association: [4.0, 4.5, 5.5, 5.0, 5.5] },
  },
  abroad: {
    seniors: 45,
    youth: 10,
    destinations: weighted("US:14 CR:4 CO:3 MX:3 ES:2 PT:1 BE:1 FR:1 GT:1 HN:1 SV:1 CA:1 SA:1"),
  },
};

const CR: NationSpec = {
  code: "CR",
  iso2: "CR",
  name: "Costa Rica",
  confederation: "CONCACAF",
  continent: "NA",
  capital: "San José",
  latitude: 9.9,
  languages: languages("es:10"),
  reputation: { national: 62, league: 44 },
  euEea: false,
  physique: { height: 176 },
  names: { given: sources("central-american=3 faker:es=2"), family: sources("costa-rican=3 faker:es=1.5") },
  nationality: {
    multipleRate: 0.2,
    tripleRate: 0.03,
    bornAbroadRate: 0.05,
    diasporaPull: 0.5,
    links: [
      ...links("americas", "NI:5 US:4 CO:2 PA:2 SV:1 HN:1 VE:1"),
      ...links("caribbean", "JM:2"),
      ...links("mediterranean", "ES:2 IT:1"),
      ...links("asianDiaspora", "CN:0.5"),
    ],
    citizenship: allowed,
  },
  cities: {
    major: [
      city("San José", "large", "San José", 3, "Tibás|Desamparados|Pavas|Hatillo|Moravia|Guadalupe|Escazú"),
      city("Alajuela", "medium", "Alajuela", 2),
      city("Cartago", "medium", "Cartago", 1),
      city("Heredia", "medium", "Heredia", 1),
      city("Liberia", "small", "Guanacaste", 1),
      city("Puntarenas", "small", "Puntarenas", 1),
      city("Limón", "small", "Limón", 1),
      city("Ciudad Quesada", "small", "Alajuela", 1),
      city("San Isidro de El General", "small", "San José", 1),
      ...cities("Alajuela", "Grecia, San Ramón, Palmares"),
      ...cities("Limón", "Guápiles"),
      ...cities("San José", "Santa Ana"),
      ...cities("Guanacaste", "Nicoya, Santa Cruz"),
      ...cities("Cartago", "Turrialba"),
      ...cities("Puntarenas", "Jicaral"),
      ...cities("Heredia", "Belén, Santo Domingo"),
    ],
  },
  football: {
    leagues: [
      {
        tier: 1,
        // Apertura and Clausura (22 rounds each) merge into 4 round-robins (decision 10).
        name: "Primera División de Costa Rica",
        shortName: "Liga FPD",
        size: 12,
        status: "professional",
        reputation: 44,
        roundRobins: 4,
        championship: { positions: [1, 4], legs: 2, finalLegs: 2 },
        clubs: {
          reputation: { top: 44, bottom: 36 },
          giants: { count: 3, top: 52, bottom: 48 },
          capacity: { top: 18_000, bottom: 3_000 },
          facilities: { top: 58, bottom: 36 },
          academy: { top: 62, bottom: 38 },
          wageBill: { top: 4_000_000, bottom: 500_000 },
          transferBudget: { top: 400_000, bottom: 10_000 },
          foreignShare: 0.15,
          squadSize: [25, 28],
        },
      },
    ],
    movement: [],
    cups: [
      { kind: "national", name: "Copa de Costa Rica", legs: 1 },
      { kind: "super", name: "Supercopa de Costa Rica", participants: ["champion", "cup-winner"], legs: 1 },
    ],
    youth: {
      U19: { divisions: [division("Alto Rendimiento Sub-19", [1, 1], 12)] },
      U17: { divisions: [division("Alto Rendimiento Sub-17", [1, 1], 12)] },
    },
    reserves: { mode: "none" },
    clubNaming: {
      templates: templates(
        `AD {city}:2.5; CS {city}:2; Municipal {city}:2; Deportivo {city}:1; {city} FC:1.5; Sporting {city}:0.8;
         CF {city}:0.5; Club Sport {city}:0.5; Santos de {city}:0.3; AS {city}:0.4; {region} FC:0.3`,
      ),
      founded: { top: [1905, 2005], bottom: [1905, 2019] },
      colors: ["#8E1B2E", "#C8102E", "#FFD100", "#FFFFFF", "#000000", "#002B7F", "#00843D"],
    },
    importSources: weighted("CO:3 PA:3 AR:2 BR:2 HN:2 VE:2 NI:1 UY:1 MX:1 JM:1 US:1 CM:1 ES:1"),
    coefficients: { association: [7.5, 8.0, 7.0, 7.5, 7.0] },
  },
  abroad: {
    seniors: 35,
    youth: 8,
    destinations: weighted("US:10 MX:3 ES:2 PT:1 BE:1 DK:1 NO:1 SE:1 GR:1 GT:1 HN:1 SV:1 PA:1 CA:1 SA:1"),
  },
};

const HN: NationSpec = {
  code: "HN",
  iso2: "HN",
  name: "Honduras",
  confederation: "CONCACAF",
  continent: "NA",
  capital: "Tegucigalpa",
  latitude: 14.1,
  languages: languages("es:10"),
  reputation: { national: 56, league: 40 },
  euEea: false,
  physique: { height: 176 },
  names: { given: sources("central-american=3 faker:es=2"), family: sources("honduran=3 faker:es=1.5") },
  nationality: {
    multipleRate: 0.2,
    tripleRate: 0.03,
    bornAbroadRate: 0.07,
    diasporaPull: 0.5,
    links: [
      ...links("americas", "US:8 SV:2 GT:2 NI:2 MX:1 CR:1 BZ:1"),
      ...links("mediterranean", "ES:2"),
      ...links("caribbean", "JM:0.5"),
    ],
    citizenship: allowed,
  },
  cities: {
    major: [
      city("Tegucigalpa", "large", "Francisco Morazán", 4, "Comayagüela|Kennedy|Villa Olímpica|Los Pinos|El Hatillo"),
      city("San Pedro Sula", "large", "Cortés", 4, "Chamelecón|Rivera Hernández|Cofradía|Los Andes|Satélite"),
      city("Choloma", "medium", "Cortés", 2),
      city("La Ceiba", "medium", "Atlántida", 2),
      city("El Progreso", "medium", "Yoro", 2),
      city("Choluteca", "medium", "Choluteca", 2),
      city("Comayagua", "medium", "Comayagua", 1),
      ...cities(
        "Cortés",
        "Puerto Cortés:small, Villanueva:small, La Lima:small, Potrerillos, Omoa, Quimistán:town",
      ),
      ...cities("El Paraíso", "Danlí:small"),
      ...cities("Olancho", "Juticalpa:small, Catacamas:small"),
      ...cities("Comayagua", "Siguatepeque:small"),
      ...cities("Atlántida", "Tela:small"),
      ...cities("Copán", "Santa Rosa de Copán:small"),
      ...cities("Yoro", "Olanchito:small, Yoro, Morazán"),
      ...cities("Colón", "Tocoa:small, Trujillo"),
      ...cities("Santa Bárbara", "Santa Bárbara"),
      ...cities("Valle", "Nacaome, San Lorenzo"),
      ...cities("Lempira", "Gracias"),
      ...cities("La Paz", "Marcala"),
      ...cities("Francisco Morazán", "Talanga"),
    ],
  },
  football: {
    leagues: [
      {
        tier: 1,
        // Apertura and Clausura (18 rounds each) merge into 4 round-robins (decision 10).
        name: "Liga Nacional de Fútbol Profesional de Honduras",
        shortName: "Liga Nacional",
        size: 10,
        status: "professional",
        reputation: 40,
        roundRobins: 4,
        // Liguilla: 3rd-6th play-in, then semi-finals and final over two legs.
        championship: { positions: [1, 6], legs: 2, finalLegs: 2 },
        clubs: {
          reputation: { top: 42, bottom: 34 },
          giants: { count: 3, top: 50, bottom: 46 },
          capacity: { top: 35_000, bottom: 3_000 },
          facilities: { top: 50, bottom: 32 },
          academy: { top: 56, bottom: 36 },
          wageBill: { top: 3_000_000, bottom: 350_000 },
          transferBudget: { top: 250_000, bottom: 5_000 },
          foreignShare: 0.12,
          squadSize: [25, 28],
        },
      },
      {
        tier: 2,
        name: "Liga de Ascenso de Honduras",
        shortName: "Liga de Ascenso",
        size: 24,
        status: "semi-professional",
        reputation: 24,
        roundRobins: 3,
        conferences: ["Zona Norte", "Zona Centro-Sur"],
        clubs: {
          reputation: { top: 30, bottom: 22 },
          capacity: { top: 6_000, bottom: 500 },
          facilities: { top: 32, bottom: 20 },
          academy: { top: 40, bottom: 26 },
          wageBill: { top: 150_000, bottom: 25_000 },
          transferBudget: { top: 10_000, bottom: 0 },
          foreignShare: 0.05,
          squadSize: [25, 27],
        },
      },
    ],
    // One club relegated on the aggregate table; the Liga de Ascenso play-off winner goes up.
    movement: [
      {
        upper: 1,
        promoted: 0,
        relegated: 1,
        playoffs: [{ type: "promotion", positions: [1, 8], places: 1, legs: 2, finalLegs: 2 }],
      },
    ],
    cups: [{ kind: "national", name: "Copa de Honduras", seededEntry: true, legs: 1 }],
    youth: {
      U19: { divisions: [division("Liga Nacional de Reservas", [1, 1], 10), division("Liga de Ascenso Sub-19", [2, 2], 12)] },
      U17: { divisions: [division("Liga Nacional Sub-17", [1, 1], 10), division("Liga de Ascenso Sub-17", [2, 2], 12)] },
    },
    reserves: { mode: "none" },
    clubNaming: {
      templates: templates(
        `CD {city}:3; Real {city}:1.5; Atlético {city}:1.2; {city} FC:1.5; Deportivo {city}:1; Club Deportivo {city}:0.5;
         Juventud {city}:0.4; Unión {city}:0.4; Social {city}:0.3; Independiente {city}:0.3; Sporting {city}:0.3;
         Lobos de {city}:0.2; {region} FC:0.4`,
      ),
      founded: { top: [1912, 2010], bottom: [1930, 2022] },
      colors: ["#FFFFFF", "#002B7F", "#FFD100", "#C8102E", "#6CACE4", "#000000", "#00843D"],
    },
    importSources: weighted("CO:4 BR:3 AR:3 UY:2 PA:2 VE:1 CR:1 NI:1 JM:1 MX:1 SV:1 GT:1"),
    coefficients: { association: [6.0, 6.5, 5.5, 6.0, 5.0] },
  },
  abroad: {
    seniors: 35,
    youth: 8,
    destinations: weighted("US:12 MX:3 CR:3 GT:3 SV:2 ES:1 PT:1 GR:1 BE:1 CA:1 PA:1"),
  },
};

const SV: NationSpec = {
  code: "SV",
  iso2: "SV",
  name: "El Salvador",
  confederation: "CONCACAF",
  continent: "NA",
  capital: "San Salvador",
  latitude: 13.7,
  languages: languages("es:10"),
  reputation: { national: 50, league: 34 },
  euEea: false,
  physique: { height: 174 },
  names: { given: sources("central-american=3 faker:es=2"), family: sources("salvadoran=3 faker:es=1.5") },
  nationality: {
    multipleRate: 0.24,
    tripleRate: 0.03,
    bornAbroadRate: 0.12,
    diasporaPull: 0.55,
    links: [...links("americas", "US:12 GT:2 HN:2 MX:1 CA:1 NI:0.5"), ...links("mediterranean", "ES:1")],
    citizenship: allowed,
  },
  cities: {
    major: [
      city("San Salvador", "large", "San Salvador", 3, "Mejicanos|San Marcos|Cuscatancingo|Ciudad Delgado|Ayutuxtepeque"),
      city("Santa Ana", "medium", "Santa Ana", 2),
      city("San Miguel", "medium", "San Miguel", 2),
      city("Soyapango", "medium", "San Salvador", 1),
      city("Santa Tecla", "medium", "La Libertad", 1),
      ...cities("San Salvador", "Apopa:small, Ilopango:small"),
      ...cities("Usulután", "Usulután:small, Jiquilisco"),
      ...cities("Sonsonate", "Sonsonate:small, Acajutla"),
      ...cities("La Unión", "La Unión:small, Santa Rosa de Lima"),
      ...cities("La Paz", "Zacatecoluca:small"),
      ...cities("Ahuachapán", "Ahuachapán:small"),
      ...cities("Chalatenango", "Chalatenango"),
      ...cities("San Vicente", "San Vicente"),
      ...cities("Cuscatlán", "Cojutepeque"),
      ...cities("Santa Ana", "Metapán, Chalchuapa"),
      ...cities("Cabañas", "Sensuntepeque, Ilobasco"),
      ...cities("La Libertad", "La Libertad"),
    ],
  },
  football: {
    leagues: [
      {
        tier: 1,
        // Apertura and Clausura (22 rounds each) merge into 4 round-robins (decision 10).
        name: "Primera División de El Salvador",
        shortName: "Primera División",
        size: 12,
        status: "professional",
        reputation: 34,
        roundRobins: 4,
        championship: { positions: [1, 8], legs: 2, finalLegs: 1, neutralFinal: true },
        clubs: {
          reputation: { top: 38, bottom: 30 },
          giants: { count: 3, top: 44, bottom: 41 },
          capacity: { top: 35_000, bottom: 2_500 },
          facilities: { top: 44, bottom: 28 },
          academy: { top: 48, bottom: 30 },
          wageBill: { top: 1_500_000, bottom: 200_000 },
          transferBudget: { top: 100_000, bottom: 0 },
          foreignShare: 0.12,
          squadSize: [25, 27],
        },
      },
    ],
    movement: [],
    cups: [{ kind: "national", name: "Copa El Salvador", legs: 1 }],
    youth: {
      U19: { divisions: [division("Torneo de Reservas", [1, 1], 12)] },
      U17: { divisions: [division("Liga Nacional Sub-17", [1, 1], 12)] },
    },
    reserves: { mode: "none" },
    clubNaming: {
      templates: templates(
        `CD {city}:3; AD {city}:1.2; Atlético {city}:1; {city} FC:1.5; Municipal {city}:1; Once {city}:0.5;
         Real {city}:0.6; Deportivo {city}:0.8; Juventud {city}:0.3; Independiente {city}:0.4; {region} FC:0.3`,
      ),
      founded: { top: [1921, 2010], bottom: [1921, 2016] },
      colors: ["#FFFFFF", "#002B7F", "#C8102E", "#000000", "#FFD100", "#00843D", "#6CACE4"],
    },
    importSources: weighted("CO:5 BR:3 AR:3 UY:2 PA:2 HN:2 CR:1 VE:1 MX:1 NI:1 GT:1 CU:1"),
    coefficients: { association: [3.5, 3.0, 3.5, 3.0, 3.5] },
  },
  abroad: { seniors: 25, youth: 6, destinations: weighted("US:14 GT:2 HN:2 CR:1 MX:1 ES:1 CA:1") },
};

const GT: NationSpec = {
  code: "GT",
  iso2: "GT",
  name: "Guatemala",
  confederation: "CONCACAF",
  continent: "NA",
  capital: "Ciudad de Guatemala",
  latitude: 14.6,
  languages: languages("es:10"),
  reputation: { national: 47, league: 38 },
  euEea: false,
  physique: { height: 172 },
  names: { given: sources("central-american=3 faker:es=2"), family: sources("guatemalan=3 faker:es=1.5") },
  nationality: {
    multipleRate: 0.2,
    tripleRate: 0.03,
    bornAbroadRate: 0.08,
    diasporaPull: 0.5,
    links: [
      ...links("americas", "US:10 MX:4 SV:2 HN:2 CR:1 AR:1 BZ:0.5"),
      ...links("mediterranean", "ES:2 IT:1"),
      ...links("crossBorder", "DE:0.5"),
    ],
    citizenship: allowed,
  },
  cities: {
    major: [
      city("Guatemala", "large", "Guatemala", 3, "La Florida|El Gallito|La Reformita|Vista Hermosa"),
      city("Mixco", "medium", "Guatemala", 2),
      city("Villa Nueva", "medium", "Guatemala", 2),
      city("Quetzaltenango", "medium", "Quetzaltenango", 1),
      city("Escuintla", "medium", "Escuintla", 1),
      ...cities("Sacatepéquez", "Antigua Guatemala:small"),
      ...cities("Alta Verapaz", "Cobán:small"),
      ...cities("Huehuetenango", "Huehuetenango:small"),
      ...cities("Suchitepéquez", "Mazatenango:small"),
      ...cities("Chiquimula", "Chiquimula:small"),
      ...cities("Zacapa", "Zacapa:small"),
      ...cities("Izabal", "Puerto Barrios:small"),
      ...cities("Retalhuleu", "Retalhuleu:small"),
      ...cities("San Marcos", "San Marcos, Malacatán"),
      ...cities("Quetzaltenango", "Coatepeque"),
      ...cities("Escuintla", "Santa Lucía Cotzumalguapa"),
      ...cities("Jalapa", "Jalapa"),
      ...cities("Chimaltenango", "Chimaltenango"),
      ...cities("Sololá", "Sololá"),
      ...cities("Petén", "Flores"),
      ...cities("Jutiapa", "Jutiapa"),
      ...cities("Totonicapán", "Totonicapán"),
      ...cities("El Progreso", "Guastatoya"),
    ],
  },
  football: {
    leagues: [
      {
        tier: 1,
        // Apertura and Clausura (22 rounds each) merge into 4 round-robins (decision 10).
        name: "Liga Nacional de Guatemala",
        shortName: "Liga Nacional",
        size: 12,
        status: "professional",
        reputation: 38,
        roundRobins: 4,
        championship: { positions: [1, 8], legs: 2, finalLegs: 2 },
        clubs: {
          reputation: { top: 42, bottom: 33 },
          giants: { count: 2, top: 48, bottom: 45 },
          capacity: { top: 26_000, bottom: 2_000 },
          facilities: { top: 48, bottom: 30 },
          academy: { top: 50, bottom: 32 },
          wageBill: { top: 2_500_000, bottom: 250_000 },
          transferBudget: { top: 200_000, bottom: 0 },
          foreignShare: 0.12,
          squadSize: [25, 28],
        },
      },
    ],
    movement: [],
    cups: [{ kind: "national", name: "Copa de Guatemala", legs: 1 }],
    youth: {
      U19: { divisions: [division("Liga Nacional de Reservas", [1, 1], 12)] },
      U17: { divisions: [division("Liga Nacional Sub-17", [1, 1], 12)] },
    },
    reserves: { mode: "none" },
    clubNaming: {
      templates: templates(
        `Deportivo {city}:3; CSD {city}:1.5; {city} FC:1.2; Club {city}:0.8; Municipal {city}:0.6; Atlético {city}:0.8;
         Juventud {city}:0.4; Real {city}:0.5; Club Social y Deportivo {city}:0.3; {region} FC:0.3`,
      ),
      founded: { top: [1928, 2010], bottom: [1940, 2018] },
      colors: ["#FFFFFF", "#C8102E", "#002B7F", "#6CACE4", "#00843D", "#000000", "#FFD100"],
    },
    importSources: weighted("CO:4 AR:4 BR:3 UY:3 MX:3 HN:2 CR:2 PA:1 SV:1 PY:1 CL:1 VE:1"),
    coefficients: { association: [5.0, 4.5, 4.5, 4.0, 4.5] },
  },
  abroad: { seniors: 20, youth: 6, destinations: weighted("US:10 MX:3 SV:1 HN:1 CR:1 ES:1") },
};

// ------------------------------------------------------------------ Caribbean

const ANGLO_CARIBBEAN = pool(
  "anglo-caribbean",
  `Kemar Shamar Damion Dever Jermaine Ricardo Andre Leon Michail Kasey Demarai Ethan Bobby Kemoy Kaheem Lamar Rodolph
   Ravel Romario Trivante Oneil Dwayne Damani Tyreek Nicholas Christopher Deshane Garfield Kevaughn Jevani Alvas
   Tarrick Javain Oquassa Kevon Kadeem Shaquille Kyle Jamar Kenroy Rondell Levi Nathaniel Wesley Marlon Cory Theo
   Tevin Jahmali Jahshaun Jourdaine Joel Kamal Akeem Rashawn Rushawn Chevone Craig Desmond Everton Fabian Horace Ian
   Kerr Linval Lance Mark Neville Orville Owayne Peter Joevin Mekeil Aubrey Kareem Alvin Sheldon Marvin Daniel Reon
   Neveal Justin Jelani Radanfah Kenwyne Stern Dwight Russell Densill Hallam Thierry Rashad Mario Nahki Zeiko
   Reggie Dante Kane Lejuan Troy Duwayne Keston Ottani Kithson Tahj Akil Shandel Jomo`,
  `Brown Williams Campbell Thompson Reid Lewis Smith Johnson Wright Morgan Clarke Robinson Scott James Walker Gordon
   Hall Grant Davis Bailey Palmer Pinnock Bell Lowe Blake Nicholson Roofe Antonio Gray Mattocks Leigh Lambert
   Latibeaudiere Hector Burke Fisher Francis Powell Mullings Morrison Barnes Harriott Taylor Stewart McLeary Bernard
   Moore Watson Russell Dawes Graham Henry Marshall Richards Samuels Simpson Spence Whyte Wilson Young Allen Anderson
   Barrett Bennett Bryan Chambers Christie Cunningham Dixon Edwards Ellis Ferguson Forbes Fraser Gayle Green Hamilton
   Harris Hinds Hylton Jackson Jarrett Jones Kelly Kerr Lindo McDonald McKenzie Miller Mitchell Murray Nelson Nugent
   Parkes Peart Phillips Rhoden Roberts Rose Salmon Shaw Sinclair Stephenson Tulloch Walters Watts Wedderburn Bogle
   Cole Dunkley Ebanks Gooden Haughton Minott Ricketts Thomas Garcia Molino Bateau Hackshaw Telfer Goddard Latapy
   Yorke Theobald Joseph Charles Cyrus Primus Boyce Harte Gale Jules Cumberbatch Gittens Greenidge Hinkson Holder
   Lashley Skeete Springer Worrell Alleyne Babb Bynoe Browne Carrington Drakes Ifill Maynard Rollock Weekes`,
);
const HAITIAN = pool(
  "haitian",
  `Frantzdy Duckens Derrick Carlens Mikaël Wilde-Donald Kervens Johny Danley Bryan Steeven Ricardo Garven Carnejy
   Jean-Ricner Leverton Jeff-Reine Mondy Louicius Josué Wilner Widner Kevin Soni Fabrice Frantz Wesner Jean Sony
   Wilson Jean-Kévin Jean-Philippe Jean-Robert Jean-Marc Djimy Dimitri Yves Pierre-Richard Emmanuel Réginald Lesly
   Fritz Gérard Jacques Stéphane Kenson Kendy Kerby Mackenson Obed Peterson Roody Rudy Stanley Steve Stevenson
   Wildens Woody Yvenson Mickaël Jonel Judelin Jems Hervé Jonathan Alexandre Daniel Nicolas Sébastien Charles
   Joseph Gabriel Donald Ralph Kerlin Kenny Luckson Rood Wedner Marckenson Mackendy Fafane Guerby`,
  `Pierre Jean Louis Joseph Charles Nazon Pierrot Alceus Bellegarde Duverger Arcus Placide Adé Lafrance Casimir
   Etienne Jérôme Désir Saint-Fleur Cantave Guerrier Lorfils Picault Sanon Bazile Belfort Bélizaire Bien-Aimé Charlot
   Délice Deedson Dorsainvil Dorval Dumas Élie Estimé Exantus Fils-Aimé Florestal François Geffrard Georges Germain
   Gilles Guillaume Hilaire Innocent Jacques Janvier Jasmin Jeune Jules Laguerre Lamour Lebrun Legros Léger Lucien
   Maxime Metellus Michel Moïse Noël Obas Paul Philippe Présumé Raymond Rémy Romulus Salomon Saintil Séide Simon
   Sylvain Télusma Théodore Toussaint Ulysse Valcourt Vilsaint Volcy Jean-Baptiste Jean-Louis Jean-Pierre
   Jean-Charles Augustin Baptiste Bernard Cadet Célestin Chéry Clerveaux Destin Dieudonné Dorélien Duvivier Faustin
   Fleurimond Fortuné Joachim Lafortune Lindor Louissaint Mathurin Merisier Norelus Octave Pétion Pierre-Louis Riché`,
);
const DOMINICAN = pool(
  "dominican",
  `Edarlyn Heinz Junior Mariano Edison Rafael Peter Nowend Dorny Luiyi Edipo Erick Carlos Wilkin Yeison Yunior Edinson
   Wander Yefri Starlin Juniel Anderson Robinson Franklin Wilton Rubén Omar Pedro Juan Luis Miguel Jonathan Ronaldo
   Domingo Kelvin Jonny Darío Johan Nelson Manuel Ramón Héctor Víctor Félix Freddy Alexander Elvis Ángel Joel Jefry
   Yoel Emmanuel Eduardo Leandro Ismael Wellington Wilfrido Yordy Ronny Ricardo Gregory Enmanuel Jhonatan Jeremy
   Deyvi Danilo Diego Frailyn Isaac Jesús Keury Lorenzo Maikel Moisés Nathanael Randy Reymond Richard Sergio
   Santiago Teodoro Vladimir Wagner`,
  `Reyes Peña Batista Mateo Encarnación Almonte Tavárez Polanco Castillo Guerrero Mejía Rosario Mercedes Féliz Santana
   Vásquez Paulino Abreu Montás Soriano Sosa Pujols Guzmán Núñez Ortiz Pimentel Ramírez Rodríguez Rivas Cabrera
   Fernández Hernández Jiménez Marte Medina Morillo Ogando Pichardo Rosa Sánchez Suero Taveras Tejada Valdez Ventura
   Vargas Veloz Cuevas Díaz Durán Espaillat Estévez Frías García Gómez Hidalgo Lora Liriano Matos Méndez Minaya
   Montero Moreno Nova Pérez Perdomo Piña Quezada Rojas Román Rondón Rosado Rubio Santos Severino Silverio Toribio
   Ureña Brito Beltré Bautista Carrasco Contreras Cordero Cepeda Firpo Lorenzo`,
);
const PUERTO_RICAN = pool(
  "puerto-rican",
  `Ricardo Juan Jeremy Nicolás Wilfredo Leandro Joshua Christian Jean Gabriel Héctor Andrés Ángel Yamil Isaac Jorge
   Luis Carlos José Javier Kevin Alexis Rafael Emmanuel Gustavo Francisco Joel Jonathan Josué Julián Marcos Miguel
   Orlando Pedro Rubén Sebastián Víctor Xavier Zamir Darren Devin Giovanni Iván Jaime Jomar Josean Justin Kenneth
   Luisangel Nelson Omar Rolando Samuel Steven Wilmer Yadiel Yeriel Axel Ian`,
  `Rivera Santiago Colón Rodríguez Vélez Ortiz Figueroa Maldonado Torres Cruz Rosado Negrón Antonetti Ramos Pagán Rosa
   Meléndez Quiñones Vázquez Acevedo Alicea Arroyo Ayala Báez Burgos Caraballo Cintrón Cordero Cotto Díaz Espada
   Feliciano Fontánez García Hernández Irizarry Laboy López Lugo Marrero Martínez Medina Méndez Mercado Montalvo
   Morales Nieves Ocasio Oquendo Otero Pabón Padilla Pérez Quintero Reyes Ríos Rivas Rolón Román Ruiz Sánchez
   Serrano Soto Sotomayor Toro Valentín Vega Velázquez Villanueva Cardona Carrasquillo Echevarría Fuentes Galarza
   Mojica Nazario Pizarro Santana Tirado Trinidad`,
);

const JM: NationSpec = {
  code: "JM",
  iso2: "JM",
  name: "Jamaica",
  confederation: "CONCACAF",
  continent: "NA",
  capital: "Kingston",
  latitude: 18.0,
  languages: languages("en:10"),
  reputation: { national: 58, league: 32 },
  euEea: false,
  physique: { height: 180 },
  names: { given: sources("anglo-caribbean=4 faker:en=1"), family: sources("anglo-caribbean=4 faker:en=1") },
  nationality: {
    multipleRate: 0.3,
    tripleRate: 0.05,
    bornAbroadRate: 0.2,
    diasporaPull: 0.45,
    links: [
      ...links("commonwealth", "EN:12 CA:6 SCO:1"),
      ...links("americas", "US:9 PA:0.5"),
      ...links("caribbean", "TT:2 HT:0.5 CU:0.5 KY:0.5"),
    ],
    citizenship: allowed,
  },
  cities: {
    major: [
      city("Kingston", "large", "Kingston", 5, "Half Way Tree|Cross Roads|Trench Town|Harbour View|Waterhouse|Arnett Gardens|Constant Spring|Liguanea|Duhaney Park"),
      city("Spanish Town", "medium", "St. Catherine", 2),
      city("Portmore", "medium", "St. Catherine", 2),
      city("Montego Bay", "medium", "St. James", 2),
      city("May Pen", "small", "Clarendon", 1),
      city("Mandeville", "small", "Manchester", 1),
      ...cities("St. Catherine", "Old Harbour:small, Linstead"),
      ...cities("St. Ann", "Ocho Rios:small, St. Ann's Bay"),
      ...cities("Westmoreland", "Savanna-la-Mar"),
      ...cities("Portland", "Port Antonio"),
      ...cities("St. Thomas", "Morant Bay"),
      ...cities("Trelawny", "Falmouth"),
      ...cities("St. Elizabeth", "Black River, Santa Cruz"),
      ...cities("Hanover", "Lucea"),
      ...cities("St. Mary", "Port Maria"),
      ...cities("Clarendon", "Chapelton"),
    ],
  },
  football: {
    leagues: [
      {
        tier: 1,
        name: "Jamaica Premier League",
        shortName: "JPL",
        size: 14,
        status: "semi-professional",
        reputation: 32,
        championship: { positions: [1, 6], legs: 2, finalLegs: 1, neutralFinal: true },
        clubs: {
          reputation: { top: 34, bottom: 26 },
          capacity: { top: 6_000, bottom: 800 },
          facilities: { top: 38, bottom: 22 },
          academy: { top: 46, bottom: 28 },
          wageBill: { top: 350_000, bottom: 60_000 },
          transferBudget: { top: 20_000, bottom: 0 },
          foreignShare: 0.05,
          squadSize: [25, 27],
        },
      },
    ],
    movement: [],
    cups: [{ kind: "national", name: "JFF Champions Cup", legs: 1 }],
    youth: {
      U19: { divisions: [division("JFF Under-20 League", [1, 1], 14)] },
      U17: { divisions: [division("JFF Under-17 League", [1, 1], 14)] },
    },
    reserves: { mode: "none" },
    clubNaming: {
      templates: templates(
        `{city} FC:3; {city} United:2.5; {city} SC:1; {city} FA:1; {city} Rangers:0.6; {city} Lions:0.5;
         {city} Strikers:0.4; {city} Athletic:0.4; {city} City:0.6; {city} Wanderers:0.3; {city} Rovers:0.3;
         {region} United:0.4`,
      ),
      founded: { top: [1940, 2014], bottom: [1940, 2018] },
      colors: ["#009B3A", "#FED100", "#000000", "#FFFFFF", "#C8102E", "#002B7F", "#6CACE4"],
    },
    importSources: weighted("TT:2 GY:1 HT:1 US:1 GH:1 NG:1 CM:1 KN:1"),
    coefficients: { association: [2.5, 3.0, 3.0, 2.5, 3.0] },
  },
  abroad: {
    seniors: 70,
    youth: 12,
    destinations: weighted("US:14 EN:10 CA:4 SCO:2 BE:1 DK:1 NO:1 SE:1 IS:1 CR:1 HN:1 SV:1"),
  },
};

const HT: NationSpec = {
  code: "HT",
  iso2: "HT",
  name: "Haiti",
  confederation: "CONCACAF",
  continent: "NA",
  capital: "Port-au-Prince",
  latitude: 18.5,
  languages: languages("ht:7 fr:3"),
  reputation: { national: 50, league: 26 },
  euEea: false,
  physique: { height: 178 },
  names: { given: sources("haitian=4 faker:fr=1"), family: sources("haitian=4 faker:fr=0.6") },
  nationality: {
    multipleRate: 0.3,
    tripleRate: 0.05,
    bornAbroadRate: 0.25,
    diasporaPull: 0.55,
    links: [
      ...links("americas", "US:10 CA:7 DO:4 BR:1 CL:1"),
      ...links("frenchAfrica", "FR:7 BE:1"),
      ...links("caribbean", "BS:1"),
    ],
    // Dual nationality for Haitian-born citizens since the 2012 constitutional amendment.
    citizenship: allowed,
  },
  cities: {
    major: [
      city("Port-au-Prince", "large", "Ouest", 4, "Pétion-Ville|Delmas|Carrefour|Tabarre|Croix-des-Bouquets|Cité Soleil"),
      city("Cap-Haïtien", "medium", "Nord", 2),
      city("Gonaïves", "medium", "Artibonite", 2),
      city("Les Cayes", "medium", "Sud", 2),
      city("Saint-Marc", "medium", "Artibonite", 2),
      city("Jacmel", "small", "Sud-Est", 1),
      city("Léogâne", "small", "Ouest", 1),
      city("Hinche", "small", "Centre", 1),
      city("Jérémie", "small", "Grand'Anse", 1),
      city("Port-de-Paix", "small", "Nord-Ouest", 1),
      ...cities("Centre", "Mirebalais"),
      ...cities("Ouest", "Petit-Goâve, Arcahaie, Grand-Goâve"),
      ...cities("Nord-Est", "Fort-Liberté, Ouanaminthe"),
      ...cities("Nord", "Limbé"),
      ...cities("Nord-Ouest", "Saint-Louis-du-Nord"),
      ...cities("Nippes", "Miragoâne"),
    ],
  },
  football: {
    leagues: [
      {
        tier: 1,
        name: "Ligue Haïtienne",
        shortName: "Ligue Haïtienne",
        size: 16,
        status: "semi-professional",
        reputation: 26,
        championship: { positions: [1, 4], legs: 2, finalLegs: 1, neutralFinal: true },
        clubs: {
          reputation: { top: 30, bottom: 22 },
          capacity: { top: 10_000, bottom: 800 },
          facilities: { top: 30, bottom: 16 },
          academy: { top: 44, bottom: 28 },
          wageBill: { top: 150_000, bottom: 25_000 },
          transferBudget: { top: 10_000, bottom: 0 },
          foreignShare: 0.03,
          squadSize: [25, 27],
        },
      },
    ],
    movement: [],
    cups: [{ kind: "national", name: "Coupe d'Haïti", legs: 1 }],
    youth: {
      U19: { divisions: [division("Championnat National U20", [1, 1], 16)] },
      U17: { divisions: [division("Championnat National U17", [1, 1], 16)] },
    },
    reserves: { mode: "none" },
    clubNaming: {
      templates: templates(
        `AS {city}:3; FC {city}:1.5; AC {city}:1; US {city}:0.8; {city} FC:1; CS {city}:0.5; Racing Club {city}:0.5;
         Racing FC {city}:0.4; Étoile de {city}:0.4; Olympique {city}:0.4; Real {city}:0.3; Juventus de {city}:0.2`,
      ),
      founded: { top: [1914, 2010], bottom: [1920, 2015] },
      colors: ["#00209F", "#D21034", "#FFFFFF", "#000000", "#FFD100", "#6D2077", "#00843D"],
    },
    importSources: weighted("DO:1 US:1 JM:1 CM:1 CI:1"),
    coefficients: { association: [1.8, 1.5, 2.0, 2.5, 2.0] },
  },
  abroad: {
    seniors: 55,
    youth: 10,
    destinations: weighted("US:12 CA:4 FR:6 BE:1 DO:3 CH:1 SE:1 PT:1 IS:1 JM:1"),
  },
};

const DO: NationSpec = {
  code: "DO",
  iso2: "DO",
  name: "Dominican Republic",
  confederation: "CONCACAF",
  continent: "NA",
  capital: "Santo Domingo",
  latitude: 18.5,
  languages: languages("es:10"),
  reputation: { national: 40, league: 26 },
  euEea: false,
  physique: { height: 176 },
  names: { given: sources("dominican=3 faker:es=1.5"), family: sources("dominican=2 faker:es=2") },
  nationality: {
    multipleRate: 0.32,
    tripleRate: 0.05,
    bornAbroadRate: 0.2,
    diasporaPull: 0.6,
    links: [
      ...links("mediterranean", "ES:10 IT:1"),
      ...links("americas", "US:8 PR:3 VE:2 CU:1 CO:1"),
      ...links("caribbean", "HT:3"),
      ...links("crossBorder", "DE:1 CH:1"),
    ],
    citizenship: allowed,
  },
  cities: {
    major: [
      city("Santo Domingo", "large", "Distrito Nacional", 4, "Los Mina|Villa Mella|Herrera|Villa Juana|Gazcue|Cristo Rey"),
      city("Santiago de los Caballeros", "large", "Santiago", 2),
      city("San Francisco de Macorís", "medium", "Duarte", 1),
      city("La Romana", "medium", "La Romana", 1),
      city("San Pedro de Macorís", "medium", "San Pedro de Macorís", 1),
      city("San Cristóbal", "medium", "San Cristóbal", 1),
      city("La Vega", "medium", "La Vega", 1),
      ...cities("Puerto Plata", "Puerto Plata:small"),
      ...cities("La Altagracia", "Higüey:small"),
      ...cities("Espaillat", "Moca:small"),
      ...cities("Peravia", "Baní:small"),
      ...cities("Monseñor Nouel", "Bonao:small"),
      ...cities("Barahona", "Barahona:small"),
      ...cities("La Vega", "Jarabacoa, Constanza"),
      ...cities("Azua", "Azua"),
      ...cities("Valverde", "Mao"),
      ...cities("San Juan", "San Juan de la Maguana"),
      ...cities("María Trinidad Sánchez", "Nagua"),
      ...cities("Sánchez Ramírez", "Cotuí"),
      ...cities("Hermanas Mirabal", "Salcedo"),
    ],
  },
  football: {
    leagues: [
      {
        tier: 1,
        name: "Liga Dominicana de Fútbol",
        shortName: "LDF",
        size: 12,
        status: "semi-professional",
        reputation: 26,
        championship: { positions: [1, 4], legs: 2, finalLegs: 1 },
        clubs: {
          reputation: { top: 30, bottom: 22 },
          capacity: { top: 8_000, bottom: 800 },
          facilities: { top: 36, bottom: 20 },
          academy: { top: 38, bottom: 24 },
          wageBill: { top: 400_000, bottom: 60_000 },
          transferBudget: { top: 20_000, bottom: 0 },
          foreignShare: 0.15,
          squadSize: [25, 27],
        },
      },
    ],
    movement: [],
    cups: [{ kind: "national", name: "Copa Dominicana", legs: 1 }],
    youth: {
      U19: { divisions: [division("LDF Sub-20", [1, 1], 12)] },
      U17: { divisions: [division("LDF Sub-17", [1, 1], 12)] },
    },
    reserves: { mode: "none" },
    clubNaming: {
      templates: templates(
        `{city} FC:3; Atlético {city}:2; Club Atlético {city}:0.8; Deportivo {city}:0.8; Inter {city}:0.6;
         Real {city}:0.6; Unión {city}:0.4; Leones de {city}:0.3; Delfines de {city}:0.2; Universidad {city}:0.3;
         {region} FC:0.4`,
      ),
      founded: { top: [1970, 2015], bottom: [1970, 2019] },
      colors: ["#002D62", "#CE1126", "#FFFFFF", "#FFD100", "#00843D", "#000000", "#F47A20"],
    },
    importSources: weighted("VE:4 CO:3 HT:3 ES:2 CU:2 US:2 BR:1 AR:1 PR:1 JM:1"),
    coefficients: { association: [2.0, 2.2, 2.5, 2.0, 2.5] },
  },
  abroad: { seniors: 30, youth: 8, destinations: weighted("ES:12 US:6 PR:2 IT:1 DE:1 CH:1 PT:1 CO:1") },
};

const PR: NationSpec = {
  code: "PR",
  iso2: "PR",
  name: "Puerto Rico",
  confederation: "CONCACAF",
  continent: "NA",
  capital: "San Juan",
  latitude: 18.4,
  languages: languages("es:7 en:3"),
  reputation: { national: 36, league: 22 },
  euEea: false,
  physique: { height: 176 },
  names: {
    given: sources("puerto-rican=2 faker:es=2 faker:en=1"),
    family: sources("puerto-rican=2.5 faker:es=2"),
  },
  nationality: {
    multipleRate: 0.28,
    tripleRate: 0.04,
    bornAbroadRate: 0.3,
    diasporaPull: 0.5,
    links: [...links("americas", "US:12 DO:3 CU:1 VE:1 CO:0.5"), ...links("mediterranean", "ES:2")],
    // Puerto Ricans are US citizens.
    citizenship: { group: "US", dual: "allowed" },
  },
  cities: {
    major: [
      city("San Juan", "large", "San Juan", 3, "Río Piedras|Santurce|Hato Rey|Condado|Cupey"),
      city("Bayamón", "medium", "Bayamón", 2),
      city("Ponce", "medium", "Ponce", 2),
      city("Carolina", "medium", "Carolina", 1),
      city("Caguas", "medium", "Caguas", 1),
      city("Guaynabo", "medium", "Guaynabo", 1),
      city("Mayagüez", "medium", "Mayagüez", 1),
      ...cities("Arecibo", "Arecibo:small"),
      ...cities("Toa Baja", "Toa Baja:small"),
      ...cities("Trujillo Alto", "Trujillo Alto:small"),
      ...cities("Humacao", "Humacao:small"),
      ...cities("Aguadilla", "Aguadilla:small"),
      ...cities("Dorado", "Dorado"),
      ...cities("Fajardo", "Fajardo"),
      ...cities("Manatí", "Manatí"),
      ...cities("Vega Baja", "Vega Baja"),
      ...cities("Cayey", "Cayey"),
      ...cities("Guayama", "Guayama"),
      ...cities("Aguada", "Aguada"),
      ...cities("Isabela", "Isabela"),
    ],
  },
  football: {
    leagues: [
      {
        tier: 1,
        name: "Liga Puerto Rico Pro",
        shortName: "LPR Pro",
        size: 10,
        status: "semi-professional",
        reputation: 22,
        championship: { positions: [1, 4], legs: 1, finalLegs: 1 },
        clubs: {
          reputation: { top: 26, bottom: 18 },
          capacity: { top: 8_000, bottom: 800 },
          facilities: { top: 38, bottom: 22 },
          academy: { top: 36, bottom: 22 },
          wageBill: { top: 180_000, bottom: 25_000 },
          transferBudget: { top: 10_000, bottom: 0 },
          foreignShare: 0.25,
          squadSize: [25, 27],
        },
      },
    ],
    movement: [],
    cups: [{ kind: "national", name: "Copa Luis Villarejo", legs: 1 }],
    youth: {
      U19: { divisions: [division("LPR Sub-19", [1, 1], 10)] },
      U17: { divisions: [division("LPR Sub-17", [1, 1], 10)] },
    },
    reserves: { mode: "none" },
    clubNaming: {
      templates: templates(
        `{city} FC:3; {city} SC:1.2; Atlético {city}:1; Academia {city}:0.6; Real {city}:0.5; Club Atlético {city}:0.5;
         Sporting {city}:0.5; {city} United:0.6; Inter {city}:0.3`,
      ),
      founded: { top: [1990, 2019], bottom: [1990, 2020] },
      colors: ["#ED0A3F", "#0050F0", "#FFFFFF", "#000000", "#FFD100", "#00843D"],
    },
    importSources: weighted("US:6 DO:3 VE:2 CO:2 ES:2 BR:1 AR:1 CU:1 JM:1 HT:1 MX:1"),
    coefficients: { association: [1.2, 1.4, 1.2, 1.5, 1.3] },
  },
  abroad: { seniors: 25, youth: 8, destinations: weighted("US:14 ES:2 DO:1 MX:1") },
};

// ------------------------------------------------------------------ CONCACAF members without an own league

const PAPIAMENTO = pool(
  "papiamento",
  `Leandro Eloy Jürgen Armando Kevin Jeremy Joshua Anthony Darryl Ayrton Gino Denzel Dwight Edson Javier Raymond Marlon
   Erwin Glenn Emilio Ronald Edwin Hubert Ricardo Eduardo Rudy Franklin Hensley Ivan Luis Carlos José Juan Pedro Miguel
   Rafael Roberto Gregory Randall Ruben Rodney Jeffrey Richard Steven Michael Mauricio Sidney Eugene Orlando Angelo`,
  `Martina Maria Martha Isenia Zimmerman Pinedo Francisca Carolina Sambo Anita Anthonia Bernabela Cijntje Leito Martis
   Nepomuceno Pieternella Rosaria Statia Winklaar Croes Wever Erasmus Britten Bislip Oduber Ridderstap Geerman Rasmijn
   Arends Kock Dijkhoff Werleman Every Vrolijk Silberie Donata Constancia Juliana Clemencia Mercelina Paulina Victoria
   Josephina Rojer Koeiman Girigorie Tromp Lacle Boekhoudt Figaroa Semeleer Thijsen`,
);
const SURINAMESE_CREOLE = pool(
  "surinamese-creole",
  `Ramon Denzel Giovanni Kenneth Delano Clifton Marvin Quincy Warner Tyrone Ryan Kelvin Etienne Virgil Mitchell Romeo
   Dion Stefano Nigel Jimmy Edgar Ruud Clarence Aron Jerry Henk Frank Gerald Stanley Winston Orlando Florian Romano
   Ricardo Edwin Glenn Roy Hugo Iwan Rudy Harold Franklin Errol Humphrey Gregory Rodney Randy Roland Lloyd Earl Eugene
   Marciano Roel Sergio Jeffrey Raoul Carlo Andy Remy`,
  `Pinas Essed Pengel Kappel Redan Becker Abena Margaret Ondaan Refos Sabajo Nelom Linger Aloema Asabina
   Macnack Kerk Fraenk Rustenberg Sporkslede Rellum Wooter Brandon Tokomo Gefferie Esajas Wijngaarde Sno Deekman Kross
   Held Plet Kolader Neede Vrede Tjin Amelo Karsters Doelwijt Leter Stuger Blijd`,
);
const HINDUSTANI_CARIBBEAN = pool(
  "hindustani-caribbean",
  `Ravi Sunil Rajesh Vijay Anil Ramesh Ashwin Dev Sachin Vishnu Kishore Ramdath Kavish Anand Deonarine Rishi Rakesh
   Sanjay Suresh Vikash Navin Kamal Dinesh Amit Mahendra Shiva Krishna Arjun Rohan Rohit Imran Rashid Fazal Nazim
   Rafiq Ishmael Zaheer Kavi Shane Diego`,
  `Sewnarain Ramdin Baldew Mungra Bisoen Binda Jagai Jadnanansing Biseswar Doekhi Persaud Ramkissoon Seepersad
   Rampersad Ramlal Boodram Maharaj Beharry Doodnath Sookram Singh Khan Mohammed Ali Ramsaroop Jagdeo Bharrat
   Chanderpaul Sarwan Samaroo Rampaul Ramdass Deonarine Sookdeo Balgobin Gopaul Harrinarine Jaggernauth Kissoon Lalla
   Mahabir Narine Persad Ragoonath Rambharose Ramcharan Ramnath Ramoutar Roopnarine Sahadeo Samlal Seetaram Sookhoo
   Sukhu Teeluck`,
);
const JAVANESE_SURINAMESE = pool(
  "javanese-surinamese",
  "Willy Ronny Soewarto Benny Kasan Soekardi Slamet Soejono Paul Rinaldo Sergio Dennis Iwan Hardjo Karto Samsi Soemarno Waldo",
  `Somohardjo Sastroredjo Atmodikoro Kartokromo Kromodihardjo Djojoseparto Pawiroredjo Karijodimedjo Kasanwirjo Soemita
   Wongsodikromo Sarmo Kartodikromo Mangoenkarso Sonoredjo Setrosentono Wirjosentono Moestadja Kartoidjojo
   Pawirodihardjo Sastrowidjojo Hardjopawiro Sodikromo Tjokro`,
);
const CUBAN = pool(
  "cuban",
  `Onel Yasmany Yordan Yosel Yunior Maykel Daniel Luis Karel Arichel Sandro Alain Yoel Yosvani Dairon Yaudel Rolando
   Adrián Frank Leonel Ernesto Osvaldo Reinier Yoandir Dagoberto Jorge Ariel Aldo Alberto Andy Brian Carlos Denis
   Dayron Duniesky Eduardo Erlys Geobel Héctor Jean Jesús Joel José Julio Lázaro Liván Marcel Mario Michel Orlando
   Pedro Raidel Rey Roberto Sergio Yasiel Yunier Yusniel`,
  `Hernández Reyes Martínez Pérez Duarte Morejón Sánchez Márquez Alarcón Paradela Espino Ramírez Linares Cruz Céspedes
   Díaz Machado González Echevarría Galano Guerra Hechavarría Ledesma López Mendoza Nápoles Pardo Pozo Quintana
   Rodríguez Salazar Sosa Suárez Valdés Vázquez Zamora Borrero Batista Cabrera Castillo Delgado Fonseca Garcés Hidalgo
   Izquierdo Jiménez Lorenzo Mora Núñez Ortega Portal Puig Rivero Tamayo Velázquez`,
);
const NICARAGUAN = pool(
  "nicaraguan",
  "",
  `Moreno Barrera Smith Bonilla Acevedo Pérez Quijano Hernández Coronel Chavarría Rodríguez López García Martínez
   Ortega Solórzano Aráuz Arróliga Blandón Calero Castellón Centeno Cuadra Espinoza Gaitán Guadamuz Jarquín Lacayo
   Lanzas Membreño Mendieta Montenegro Obando Palacios Pastora Picado Rivas Rocha Román Salazar Somarriba Téllez
   Úbeda Zamora Zeledón`,
);
const ANGLOPHONE = "anglo-caribbean=4 faker:en=1";

const AI = homeNation("CONCACAF", {
  code: "AI",
  name: "Anguilla",
  capital: "The Valley",
  latitude: 18.2,
  languages: languages("en:10"),
  reputation: { national: 14, league: 8 },
  physique: { height: 178 },
  names: { given: sources(ANGLOPHONE), family: sources(ANGLOPHONE) },
  nationality: {
    multipleRate: 0.25,
    tripleRate: 0.04,
    bornAbroadRate: 0.2,
    diasporaPull: 0.35,
    links: [...links("commonwealth", "EN:6"), ...links("americas", "US:5"), ...links("caribbean", "KN:3 VI:2 VG:1 AG:1")],
    citizenship: allowed,
  },
  cities: {
    major: cities("Anguilla", "The Valley, Blowing Point, Sandy Ground, Island Harbour, North Hill, Stoney Ground, East End, West End"),
  },
  homePool: { seniors: 25, youth: 36 },
  abroad: { seniors: 15, youth: 3, destinations: weighted("EN:4 US:4") },
});

const AG = homeNation("CONCACAF", {
  code: "AG",
  name: "Antigua and Barbuda",
  capital: "St. John's",
  latitude: 17.1,
  languages: languages("en:10"),
  reputation: { national: 32, league: 18 },
  physique: { height: 179 },
  names: { given: sources(ANGLOPHONE), family: sources(ANGLOPHONE) },
  nationality: {
    multipleRate: 0.28,
    tripleRate: 0.05,
    bornAbroadRate: 0.2,
    diasporaPull: 0.4,
    links: [...links("commonwealth", "EN:8 CA:1"), ...links("americas", "US:5"), ...links("caribbean", "DM:2 JM:1 GY:1 KN:1")],
    citizenship: allowed,
  },
  cities: {
    major: [
      ...cities("Saint John", "St. John's:small, Bolans, Piggotts"),
      ...cities("Saint Paul", "Liberta, Falmouth, English Harbour"),
      ...cities("Saint Peter", "Parham"),
      ...cities("Saint Mary", "All Saints, Swetes"),
      ...cities("Barbuda", "Codrington"),
    ],
  },
  homePool: { seniors: 40, youth: 36 },
  abroad: { seniors: 15, youth: 3, destinations: weighted("EN:6 US:5 JM:1 CA:1") },
});

const AW = homeNation("CONCACAF", {
  code: "AW",
  name: "Aruba",
  capital: "Oranjestad",
  latitude: 12.5,
  languages: languages("pap:6 nl:4"),
  reputation: { national: 24, league: 14 },
  physique: { height: 179 },
  names: {
    given: sources("papiamento=3 faker:nl=1 faker:es=0.5"),
    family: sources("papiamento=3 faker:nl=0.8 faker:es=0.4"),
  },
  nationality: {
    multipleRate: 0.35,
    tripleRate: 0.06,
    bornAbroadRate: 0.25,
    diasporaPull: 0.35,
    links: [...links("dutchDiaspora", "NL:10 CW:5 SR:2"), ...links("americas", "VE:5 CO:3 DO:1")],
    // Arubans are Dutch nationals.
    citizenship: { group: "NL", dual: "allowed" },
  },
  cities: {
    major: cities("Aruba", "Oranjestad:small, San Nicolaas:small, Noord, Santa Cruz, Paradera, Savaneta, Tanki Leendert, Pos Chiquito"),
  },
  homePool: { seniors: 30, youth: 36 },
  abroad: { seniors: 12, youth: 4, destinations: weighted("NL:10 US:1 CO:1") },
});

const BS = homeNation("CONCACAF", {
  code: "BS",
  name: "Bahamas",
  capital: "Nassau",
  latitude: 25.0,
  languages: languages("en:10"),
  reputation: { national: 22, league: 10 },
  physique: { height: 180 },
  names: { given: sources(ANGLOPHONE), family: sources(ANGLOPHONE) },
  nationality: {
    multipleRate: 0.2,
    tripleRate: 0.03,
    bornAbroadRate: 0.15,
    diasporaPull: 0.3,
    links: [...links("americas", "US:8"), ...links("commonwealth", "EN:3 CA:2"), ...links("caribbean", "HT:3 JM:2 TC:1")],
    // Adult Bahamians may not hold a second citizenship.
    citizenship: restricted,
  },
  cities: {
    major: [
      city("Nassau", "medium", "New Providence"),
      city("Freeport", "small", "Grand Bahama"),
      ...cities("Grand Bahama", "West End"),
      ...cities("Abaco", "Marsh Harbour, Cooper's Town"),
      ...cities("Andros", "Andros Town"),
      ...cities("Exuma", "George Town"),
      ...cities("Eleuthera", "Spanish Wells, Governor's Harbour"),
      ...cities("Bimini", "Alice Town"),
      ...cities("Inagua", "Matthew Town"),
    ],
  },
  homePool: { seniors: 30, youth: 36 },
  abroad: { seniors: 12, youth: 3, destinations: weighted("US:8 EN:1 CA:1") },
});

const BB = homeNation("CONCACAF", {
  code: "BB",
  name: "Barbados",
  capital: "Bridgetown",
  latitude: 13.1,
  languages: languages("en:10"),
  reputation: { national: 27, league: 16 },
  physique: { height: 180 },
  names: { given: sources(ANGLOPHONE), family: sources(ANGLOPHONE) },
  nationality: {
    multipleRate: 0.3,
    tripleRate: 0.05,
    bornAbroadRate: 0.2,
    diasporaPull: 0.4,
    links: [...links("commonwealth", "EN:10 CA:6"), ...links("americas", "US:4"), ...links("caribbean", "TT:3 GY:2 LC:1 VC:1")],
    citizenship: allowed,
  },
  cities: {
    major: [
      city("Bridgetown", "small", "Saint Michael"),
      ...cities("Saint Peter", "Speightstown"),
      ...cities("Christ Church", "Oistins"),
      ...cities("Saint James", "Holetown"),
      ...cities("Saint Joseph", "Bathsheba"),
      ...cities("Saint Philip", "Six Cross Roads, Crane"),
      ...cities("Saint Lucy", "Checker Hall"),
      ...cities("Saint Andrew", "Belleplaine"),
      ...cities("Saint Thomas", "Welchman Hall"),
    ],
  },
  homePool: { seniors: 35, youth: 36 },
  abroad: { seniors: 15, youth: 4, destinations: weighted("EN:6 US:4 CA:2 SCO:1") },
});

const BZ = homeNation("CONCACAF", {
  code: "BZ",
  name: "Belize",
  capital: "Belmopan",
  latitude: 17.3,
  languages: languages("en:5 es:5"),
  reputation: { national: 32, league: 16 },
  physique: { height: 176 },
  names: {
    given: sources("anglo-caribbean=2 central-american=2 faker:es=1"),
    family: sources("anglo-caribbean=2 faker:es=2 honduran=0.5 guatemalan=0.5"),
  },
  nationality: {
    multipleRate: 0.25,
    tripleRate: 0.04,
    bornAbroadRate: 0.12,
    diasporaPull: 0.4,
    links: [...links("americas", "US:6 GT:4 HN:3 MX:3 SV:2"), ...links("commonwealth", "EN:1")],
    citizenship: allowed,
  },
  cities: {
    major: [
      city("Belize City", "medium", "Belize"),
      ...cities("Belize", "Ladyville, San Pedro"),
      ...cities("Cayo", "Belmopan:small, San Ignacio:small, Santa Elena, Benque Viejo del Carmen"),
      ...cities("Orange Walk", "Orange Walk Town:small"),
      ...cities("Stann Creek", "Dangriga, Independence"),
      ...cities("Corozal", "Corozal Town"),
      ...cities("Toledo", "Punta Gorda"),
    ],
  },
  homePool: { seniors: 45, youth: 36 },
  abroad: { seniors: 10, youth: 3, destinations: weighted("HN:3 GT:3 US:3 MX:1 SV:1") },
});

const BM = homeNation("CONCACAF", {
  code: "BM",
  name: "Bermuda",
  capital: "Hamilton",
  latitude: 32.3,
  languages: languages("en:10"),
  reputation: { national: 33, league: 12 },
  physique: { height: 180 },
  names: {
    given: sources("anglo-caribbean=3 faker:en=1.5"),
    family: sources("anglo-caribbean=3 uefa-north/english=1 faker:pt_PT=0.3"),
  },
  nationality: {
    multipleRate: 0.35,
    tripleRate: 0.06,
    bornAbroadRate: 0.25,
    diasporaPull: 0.35,
    links: [
      ...links("commonwealth", "EN:10 CA:3 WAL:1 SCO:1"),
      ...links("americas", "US:5"),
      ...links("crossBorder", "PT:2"),
      ...links("caribbean", "JM:1 KN:0.5"),
    ],
    citizenship: allowed,
  },
  cities: {
    major: cities(
      "Bermuda",
      "Hamilton:small, St. George's, Somerset Village, Flatts Village, Devonshire, Pembroke, Warwick, Southampton, Paget, Smith's",
    ),
  },
  homePool: { seniors: 30, youth: 36 },
  abroad: { seniors: 15, youth: 4, destinations: weighted("EN:8 US:5 SCO:1 IS:1") },
});

const VG = homeNation("CONCACAF", {
  code: "VG",
  name: "British Virgin Islands",
  capital: "Road Town",
  latitude: 18.4,
  languages: languages("en:10"),
  reputation: { national: 18, league: 8 },
  physique: { height: 178 },
  names: { given: sources(ANGLOPHONE), family: sources(ANGLOPHONE) },
  nationality: {
    multipleRate: 0.3,
    tripleRate: 0.05,
    bornAbroadRate: 0.3,
    diasporaPull: 0.3,
    links: [
      ...links("caribbean", "VI:5 KN:2 AG:2 DM:1 GY:1 JM:1"),
      ...links("americas", "US:4"),
      ...links("commonwealth", "EN:3"),
    ],
    citizenship: allowed,
  },
  cities: {
    major: [
      ...cities("Tortola", "Road Town:small, East End, West End, Carrot Bay, Cane Garden Bay"),
      ...cities("Virgin Gorda", "Spanish Town"),
      ...cities("Jost Van Dyke", "Great Harbour"),
      ...cities("Anegada", "The Settlement"),
    ],
  },
  homePool: { seniors: 25, youth: 36 },
  abroad: { seniors: 15, youth: 3, destinations: weighted("US:6 EN:2 JM:1") },
});

const KY = homeNation("CONCACAF", {
  code: "KY",
  name: "Cayman Islands",
  capital: "George Town",
  latitude: 19.3,
  languages: languages("en:10"),
  reputation: { national: 20, league: 10 },
  physique: { height: 179 },
  names: { given: sources(ANGLOPHONE), family: sources(ANGLOPHONE) },
  nationality: {
    multipleRate: 0.3,
    tripleRate: 0.05,
    bornAbroadRate: 0.3,
    diasporaPull: 0.3,
    links: [...links("caribbean", "JM:6"), ...links("commonwealth", "EN:4 CA:2"), ...links("americas", "US:4 HN:1")],
    citizenship: allowed,
  },
  cities: {
    major: [
      ...cities("Grand Cayman", "George Town:small, West Bay, Bodden Town, East End, North Side, Savannah"),
      ...cities("Cayman Brac", "Stake Bay"),
    ],
  },
  homePool: { seniors: 25, youth: 36 },
  abroad: { seniors: 15, youth: 3, destinations: weighted("US:6 EN:3 JM:2 CA:1") },
});

const CU = homeNation("CONCACAF", {
  code: "CU",
  name: "Cuba",
  capital: "La Habana",
  latitude: 23.1,
  languages: languages("es:10"),
  reputation: { national: 35, league: 20 },
  physique: { height: 177 },
  names: { given: sources("cuban=3 faker:es=1"), family: sources("cuban=2 faker:es=2"), secondFamilyRate: 0.05 },
  nationality: {
    multipleRate: 0.15,
    tripleRate: 0.02,
    bornAbroadRate: 0.05,
    diasporaPull: 0.3,
    links: [...links("americas", "US:5 MX:2 VE:1 DO:1"), ...links("mediterranean", "ES:4")],
    // Cuba does not recognise a second citizenship of its nationals.
    citizenship: restricted,
  },
  cities: {
    major: [
      city("La Habana", "large", "La Habana"),
      city("Santiago de Cuba", "medium", "Santiago de Cuba"),
      city("Camagüey", "medium", "Camagüey"),
      city("Holguín", "medium", "Holguín"),
      city("Santa Clara", "medium", "Villa Clara"),
      city("Guantánamo", "medium", "Guantánamo"),
      city("Bayamo", "small", "Granma"),
      city("Las Tunas", "small", "Las Tunas"),
      city("Cienfuegos", "small", "Cienfuegos"),
      city("Pinar del Río", "small", "Pinar del Río"),
      city("Matanzas", "small", "Matanzas"),
      city("Ciego de Ávila", "small", "Ciego de Ávila"),
      city("Sancti Spíritus", "small", "Sancti Spíritus"),
      ...cities("Granma", "Manzanillo"),
      ...cities("Matanzas", "Cárdenas"),
      ...cities("Artemisa", "Artemisa"),
      ...cities("Isla de la Juventud", "Nueva Gerona"),
    ],
  },
  homePool: { seniors: 90, youth: 45 },
  abroad: { seniors: 20, youth: 3, destinations: weighted("US:6 ES:3 MX:2 DO:2 GT:1 HN:1 SV:1 PR:1 CR:1") },
});

const CW = homeNation("CONCACAF", {
  code: "CW",
  name: "Curaçao",
  capital: "Willemstad",
  latitude: 12.1,
  languages: languages("pap:6 nl:4"),
  reputation: { national: 52, league: 18 },
  physique: { height: 181 },
  names: { given: sources("papiamento=3 faker:nl=1"), family: sources("papiamento=3 faker:nl=1") },
  nationality: {
    multipleRate: 0.4,
    tripleRate: 0.06,
    bornAbroadRate: 0.4,
    diasporaPull: 0.5,
    links: [...links("dutchDiaspora", "NL:12 AW:3 SR:2"), ...links("americas", "VE:3 CO:2 DO:1"), ...links("caribbean", "JM:0.5")],
    // Curaçaoans are Dutch nationals.
    citizenship: { group: "NL", dual: "allowed" },
  },
  cities: {
    major: cities(
      "Curaçao",
      "Willemstad:medium, Barber, Sint Michiel, Soto, Westpunt, Santa Rosa, Tera Kora, Brievengat, Montaña, Seru Fortuna",
    ),
  },
  homePool: { seniors: 30, youth: 36 },
  abroad: {
    seniors: 45,
    youth: 8,
    destinations: weighted("NL:25 BE:2 EN:2 DE:2 US:2 TR:1 CY:1 GR:1 PT:1 SCO:1"),
  },
});

const DM = homeNation("CONCACAF", {
  code: "DM",
  name: "Dominica",
  capital: "Roseau",
  latitude: 15.3,
  languages: languages("en:10"),
  reputation: { national: 20, league: 10 },
  physique: { height: 178 },
  names: {
    given: sources("anglo-caribbean=3 faker:en=0.6 faker:fr=0.4"),
    family: sources("anglo-caribbean=3 faker:fr=0.7 haitian=0.3"),
  },
  nationality: {
    multipleRate: 0.25,
    tripleRate: 0.04,
    bornAbroadRate: 0.2,
    diasporaPull: 0.35,
    links: [...links("commonwealth", "EN:6 CA:2"), ...links("americas", "US:5"), ...links("caribbean", "AG:2 HT:1 GD:0.5")],
    citizenship: allowed,
  },
  cities: {
    major: [
      city("Roseau", "small", "Saint George"),
      ...cities("Saint John", "Portsmouth"),
      ...cities("Saint Andrew", "Marigot, Wesley"),
      ...cities("Saint Patrick", "Berekua, Grand Bay"),
      ...cities("Saint Paul", "Mahaut"),
      ...cities("Saint Joseph", "Saint Joseph"),
      ...cities("Saint David", "Castle Bruce"),
      ...cities("Saint Patrick", "La Plaine"),
    ],
  },
  homePool: { seniors: 30, youth: 36 },
  abroad: { seniors: 10, youth: 3, destinations: weighted("US:4 EN:3 JM:1") },
});

const GD = homeNation("CONCACAF", {
  code: "GD",
  name: "Grenada",
  capital: "St. George's",
  latitude: 12.1,
  languages: languages("en:10"),
  reputation: { national: 30, league: 12 },
  physique: { height: 179 },
  names: { given: sources("anglo-caribbean=4 faker:en=0.6 faker:fr=0.2"), family: sources(ANGLOPHONE) },
  nationality: {
    multipleRate: 0.3,
    tripleRate: 0.05,
    bornAbroadRate: 0.25,
    diasporaPull: 0.4,
    links: [...links("commonwealth", "EN:8 CA:3"), ...links("americas", "US:5"), ...links("caribbean", "TT:4 VC:1")],
    citizenship: allowed,
  },
  cities: {
    major: [
      city("St. George's", "small", "Saint George"),
      ...cities("Saint George", "Grand Anse, Belmont"),
      ...cities("Saint John", "Gouyave"),
      ...cities("Saint Andrew", "Grenville"),
      ...cities("Saint Mark", "Victoria"),
      ...cities("Saint Patrick", "Sauteurs"),
      ...cities("Saint David", "Saint David's"),
      ...cities("Carriacou and Petite Martinique", "Hillsborough"),
    ],
  },
  homePool: { seniors: 30, youth: 36 },
  abroad: { seniors: 15, youth: 4, destinations: weighted("EN:6 US:5 CA:1 JM:1 SCO:1") },
});

const GY = homeNation("CONCACAF", {
  code: "GY",
  name: "Guyana",
  continent: "SA",
  capital: "Georgetown",
  latitude: 6.8,
  languages: languages("en:10"),
  reputation: { national: 36, league: 16 },
  physique: { height: 177 },
  names: {
    given: sources("anglo-caribbean=3 hindustani-caribbean=2 faker:en=1"),
    family: sources("anglo-caribbean=3 hindustani-caribbean=2.5 faker:en=0.5"),
  },
  nationality: {
    multipleRate: 0.3,
    tripleRate: 0.05,
    bornAbroadRate: 0.25,
    diasporaPull: 0.4,
    links: [
      ...links("commonwealth", "EN:7 CA:5"),
      ...links("americas", "US:6 BR:1 VE:1"),
      ...links("caribbean", "TT:3 BB:1 SR:1"),
      ...links("asianDiaspora", "IN:1"),
    ],
    citizenship: allowed,
  },
  cities: {
    major: [
      city("Georgetown", "medium", "Demerara-Mahaica"),
      city("Linden", "small", "Upper Demerara-Berbice"),
      city("New Amsterdam", "small", "East Berbice-Corentyne"),
      ...cities("East Berbice-Corentyne", "Skeldon, Rosignol"),
      ...cities("Pomeroon-Supenaam", "Anna Regina"),
      ...cities("Cuyuni-Mazaruni", "Bartica"),
      ...cities("Upper Takutu-Upper Essequibo", "Lethem"),
      ...cities("Essequibo Islands-West Demerara", "Parika, Vreed en Hoop"),
      ...cities("Demerara-Mahaica", "Diamond, Mahaica"),
    ],
  },
  homePool: { seniors: 40, youth: 36 },
  abroad: { seniors: 15, youth: 4, destinations: weighted("EN:5 US:5 CA:2 SCO:1 JM:1") },
});

const MS = homeNation("CONCACAF", {
  code: "MS",
  name: "Montserrat",
  capital: "Brades",
  latitude: 16.8,
  languages: languages("en:10"),
  reputation: { national: 28, league: 6 },
  physique: { height: 180 },
  names: {
    given: sources("anglo-caribbean=3 faker:en=1.5"),
    family: sources("anglo-caribbean=3 uefa-north/english=1 uefa-north/irish=0.5"),
  },
  // Most of the national team is England-born.
  nationality: {
    multipleRate: 0.5,
    tripleRate: 0.08,
    bornAbroadRate: 0.6,
    diasporaPull: 0.5,
    links: [
      ...links("commonwealth", "EN:12"),
      ...links("britishIrish", "IE:1"),
      ...links("americas", "US:2"),
      ...links("caribbean", "AG:2 JM:1"),
    ],
    citizenship: allowed,
  },
  cities: {
    major: [
      ...cities("Saint Peter", "Brades, Salem, Little Bay, Olveston, Woodlands, Sweeney's"),
      ...cities("Saint John", "St. John's, Cudjoe Head, Davy Hill, Look Out"),
    ],
  },
  homePool: { seniors: 25, youth: 36 },
  abroad: { seniors: 25, youth: 6, destinations: weighted("EN:14 US:1 SCO:1") },
});

const NI = homeNation("CONCACAF", {
  code: "NI",
  name: "Nicaragua",
  capital: "Managua",
  latitude: 12.1,
  languages: languages("es:10"),
  reputation: { national: 42, league: 24 },
  physique: { height: 174 },
  names: { given: sources("central-american=3 faker:es=2"), family: sources("nicaraguan=3 faker:es=1.5") },
  nationality: {
    multipleRate: 0.18,
    tripleRate: 0.02,
    bornAbroadRate: 0.08,
    diasporaPull: 0.4,
    links: [...links("americas", "CR:6 US:5 HN:2 SV:1 PA:1 MX:1"), ...links("mediterranean", "ES:2")],
    // The 2025 constitutional reform ends Nicaraguan nationality on acquiring another.
    citizenship: restricted,
  },
  cities: {
    major: [
      city("Managua", "large", "Managua", 2),
      city("León", "medium", "León"),
      city("Masaya", "medium", "Masaya"),
      city("Matagalpa", "small", "Matagalpa"),
      city("Chinandega", "small", "Chinandega"),
      city("Estelí", "small", "Estelí"),
      city("Granada", "small", "Granada"),
      city("Jinotega", "small", "Jinotega"),
      ...cities("Región Autónoma de la Costa Caribe Sur", "Bluefields, Nueva Guinea"),
      ...cities("Región Autónoma de la Costa Caribe Norte", "Bilwi"),
      ...cities("Chontales", "Juigalpa"),
      ...cities("Rivas", "Rivas"),
      ...cities("Nueva Segovia", "Ocotal"),
      ...cities("Carazo", "Diriamba, Jinotepe"),
      ...cities("Río San Juan", "San Carlos"),
      ...cities("Boaco", "Boaco"),
      ...cities("Madriz", "Somoto"),
      ...cities("Managua", "Tipitapa"),
    ],
  },
  homePool: { seniors: 80, youth: 45 },
  abroad: { seniors: 15, youth: 3, destinations: weighted("CR:4 US:3 HN:2 SV:2 GT:2 ES:1 MX:1") },
});

const KN = homeNation("CONCACAF", {
  code: "KN",
  name: "Saint Kitts and Nevis",
  capital: "Basseterre",
  latitude: 17.3,
  languages: languages("en:10"),
  reputation: { national: 30, league: 10 },
  physique: { height: 180 },
  names: { given: sources(ANGLOPHONE), family: sources(ANGLOPHONE) },
  nationality: {
    multipleRate: 0.35,
    tripleRate: 0.06,
    bornAbroadRate: 0.3,
    diasporaPull: 0.45,
    links: [...links("commonwealth", "EN:10 CA:2"), ...links("americas", "US:5"), ...links("caribbean", "AG:2 AI:1 VI:1")],
    citizenship: allowed,
  },
  cities: {
    major: [
      ...cities("Saint Kitts", "Basseterre:small, Sandy Point Town, Cayon, Dieppe Bay Town, Old Road Town, Tabernacle, Molineux"),
      ...cities("Nevis", "Charlestown, Gingerland, Newcastle"),
    ],
  },
  homePool: { seniors: 30, youth: 36 },
  abroad: { seniors: 18, youth: 4, destinations: weighted("EN:8 US:4 JM:1 SCO:1") },
});

const LC = homeNation("CONCACAF", {
  code: "LC",
  name: "Saint Lucia",
  capital: "Castries",
  latitude: 14.0,
  languages: languages("en:10"),
  reputation: { national: 30, league: 12 },
  physique: { height: 178 },
  names: {
    given: sources("anglo-caribbean=3 faker:en=0.5 faker:fr=0.5"),
    family: sources("anglo-caribbean=3 faker:fr=0.8"),
  },
  nationality: {
    multipleRate: 0.25,
    tripleRate: 0.04,
    bornAbroadRate: 0.2,
    diasporaPull: 0.35,
    links: [...links("commonwealth", "EN:6 CA:2"), ...links("americas", "US:4"), ...links("caribbean", "BB:2 TT:1 GY:1")],
    citizenship: allowed,
  },
  cities: {
    major: [
      city("Castries", "small", "Castries"),
      ...cities("Castries", "Babonneau, Bexon"),
      ...cities("Vieux Fort", "Vieux Fort"),
      ...cities("Gros Islet", "Gros Islet"),
      ...cities("Soufrière", "Soufrière"),
      ...cities("Micoud", "Micoud"),
      ...cities("Dennery", "Dennery"),
      ...cities("Laborie", "Laborie"),
      ...cities("Choiseul", "Choiseul"),
      ...cities("Anse la Raye", "Anse La Raye, Canaries"),
    ],
  },
  homePool: { seniors: 30, youth: 36 },
  abroad: { seniors: 12, youth: 3, destinations: weighted("US:4 EN:4 CA:1 JM:1") },
});

const VC = homeNation("CONCACAF", {
  code: "VC",
  name: "Saint Vincent and the Grenadines",
  capital: "Kingstown",
  latitude: 13.2,
  languages: languages("en:10"),
  reputation: { national: 30, league: 10 },
  physique: { height: 179 },
  names: { given: sources(ANGLOPHONE), family: sources(ANGLOPHONE) },
  nationality: {
    multipleRate: 0.25,
    tripleRate: 0.04,
    bornAbroadRate: 0.2,
    diasporaPull: 0.35,
    links: [...links("commonwealth", "EN:6 CA:4"), ...links("americas", "US:4"), ...links("caribbean", "TT:3 BB:2 GD:1")],
    citizenship: allowed,
  },
  cities: {
    major: [
      city("Kingstown", "small", "Saint George"),
      ...cities("Saint George", "Calliaqua"),
      ...cities("Charlotte", "Georgetown, Biabou, Colonarie"),
      ...cities("Saint Patrick", "Barrouallie"),
      ...cities("Saint Andrew", "Layou"),
      ...cities("Saint David", "Chateaubelair"),
      ...cities("Grenadines", "Port Elizabeth, Clifton"),
    ],
  },
  homePool: { seniors: 30, youth: 36 },
  abroad: { seniors: 12, youth: 3, destinations: weighted("US:4 EN:3 CA:1 JM:1") },
});

const SR = homeNation("CONCACAF", {
  code: "SR",
  name: "Suriname",
  continent: "SA",
  capital: "Paramaribo",
  latitude: 5.8,
  languages: languages("nl:8 srn:2"),
  reputation: { national: 43, league: 20 },
  physique: { height: 178 },
  names: {
    given: sources("surinamese-creole=2 hindustani-caribbean=1.5 javanese-surinamese=0.6 faker:nl=1"),
    family: sources("surinamese-creole=2 hindustani-caribbean=1.8 javanese-surinamese=0.8 faker:nl=0.5"),
  },
  // Netherlands-born players have represented Suriname since the 2019 eligibility change.
  nationality: {
    multipleRate: 0.45,
    tripleRate: 0.08,
    bornAbroadRate: 0.45,
    diasporaPull: 0.5,
    links: [
      ...links("dutchDiaspora", "NL:14 CW:1 AW:0.5"),
      ...links("americas", "BR:1 GY:1"),
      ...links("asianDiaspora", "IN:1 ID:1"),
    ],
    citizenship: { dual: "partners", partners: ["NL"] },
  },
  cities: {
    major: [
      city("Paramaribo", "medium", "Paramaribo", 2),
      ...cities("Wanica", "Lelydorp:small, Meerzorg, Houttuin"),
      ...cities("Nickerie", "Nieuw Nickerie:small, Wageningen"),
      ...cities("Marowijne", "Moengo, Albina"),
      ...cities("Commewijne", "Nieuw Amsterdam, Mariënburg"),
      ...cities("Saramacca", "Groningen"),
      ...cities("Brokopondo", "Brokopondo, Brownsweg"),
      ...cities("Para", "Onverwacht"),
      ...cities("Coronie", "Totness"),
    ],
  },
  homePool: { seniors: 45, youth: 40 },
  abroad: { seniors: 30, youth: 8, destinations: weighted("NL:20 BE:1 DE:1 EN:1 CY:1 TR:1 US:1") },
});

const TT = homeNation("CONCACAF", {
  code: "TT",
  name: "Trinidad and Tobago",
  capital: "Port of Spain",
  latitude: 10.7,
  languages: languages("en:10"),
  reputation: { national: 47, league: 26 },
  physique: { height: 179 },
  names: {
    given: sources("anglo-caribbean=3 hindustani-caribbean=1 faker:en=1"),
    family: sources("anglo-caribbean=3 hindustani-caribbean=1.2 faker:en=0.6 faker:es=0.2"),
  },
  nationality: {
    multipleRate: 0.25,
    tripleRate: 0.04,
    bornAbroadRate: 0.12,
    diasporaPull: 0.4,
    links: [
      ...links("commonwealth", "EN:8 CA:5 SCO:1"),
      ...links("americas", "US:6 VE:3"),
      ...links("caribbean", "GY:3 GD:2 BB:1 VC:1 JM:1"),
      ...links("asianDiaspora", "IN:1"),
    ],
    citizenship: allowed,
  },
  cities: {
    major: [
      city("Port of Spain", "medium", "Port of Spain", 2),
      city("San Fernando", "medium", "San Fernando", 2),
      city("Chaguanas", "medium", "Chaguanas"),
      city("Arima", "small", "Arima"),
      city("Point Fortin", "small", "Point Fortin"),
      ...cities("Tobago", "Scarborough:small, Roxborough"),
      ...cities("Couva-Tabaquite-Talparo", "Couva"),
      ...cities("Tunapuna-Piarco", "Tunapuna, St. Augustine"),
      ...cities("Sangre Grande", "Sangre Grande"),
      ...cities("Diego Martin", "Diego Martin"),
      ...cities("Princes Town", "Princes Town"),
      ...cities("Siparia", "Siparia"),
      ...cities("Penal-Debe", "Penal"),
      ...cities("San Juan-Laventille", "Laventille, Morvant"),
      ...cities("Mayaro-Rio Claro", "Rio Claro, Mayaro"),
    ],
  },
  homePool: { seniors: 90, youth: 45 },
  abroad: {
    seniors: 35,
    youth: 6,
    destinations: weighted("US:12 EN:3 SCO:1 JM:1 SV:1 GT:1 HN:1 DK:1 NO:1 CA:1"),
  },
});

const TC = homeNation("CONCACAF", {
  code: "TC",
  name: "Turks and Caicos Islands",
  capital: "Cockburn Town",
  latitude: 21.5,
  languages: languages("en:10"),
  reputation: { national: 16, league: 6 },
  physique: { height: 178 },
  names: {
    given: sources("anglo-caribbean=4 faker:en=1 haitian=0.4"),
    family: sources("anglo-caribbean=4 faker:en=1 haitian=0.4"),
  },
  nationality: {
    multipleRate: 0.35,
    tripleRate: 0.05,
    bornAbroadRate: 0.35,
    diasporaPull: 0.3,
    links: [
      ...links("caribbean", "BS:5 HT:5 JM:3 DO:1"),
      ...links("americas", "US:3"),
      ...links("commonwealth", "EN:2 CA:1"),
    ],
    citizenship: allowed,
  },
  cities: {
    major: [
      ...cities("Grand Turk", "Cockburn Town"),
      ...cities("Providenciales", "Providenciales, Five Cays, Blue Hills, The Bight"),
      ...cities("South Caicos", "Cockburn Harbour"),
      ...cities("North Caicos", "Bottle Creek, Kew"),
      ...cities("Middle Caicos", "Bambarra"),
      ...cities("Salt Cay", "Balfour Town"),
    ],
  },
  homePool: { seniors: 25, youth: 36 },
  abroad: { seniors: 15, youth: 3, destinations: weighted("US:6 EN:2 JM:1 DO:1") },
});

const VI = homeNation("CONCACAF", {
  code: "VI",
  name: "U.S. Virgin Islands",
  capital: "Charlotte Amalie",
  latitude: 18.3,
  languages: languages("en:10"),
  reputation: { national: 20, league: 6 },
  physique: { height: 179 },
  names: {
    given: sources("anglo-caribbean=4 faker:en=1 faker:es=0.4"),
    family: sources("anglo-caribbean=4 faker:en=1 puerto-rican=0.5"),
  },
  nationality: {
    multipleRate: 0.3,
    tripleRate: 0.05,
    bornAbroadRate: 0.35,
    diasporaPull: 0.3,
    links: [...links("americas", "US:8 PR:3 DO:1"), ...links("caribbean", "VG:3 KN:2 AG:2 DM:1 LC:1 TT:1")],
    // US citizens.
    citizenship: { group: "US", dual: "allowed" },
  },
  cities: {
    major: [
      ...cities("Saint Thomas", "Charlotte Amalie:small, Tutu, Bovoni"),
      ...cities("Saint Croix", "Christiansted:small, Frederiksted, Kingshill, Sion Farm, Anna's Retreat"),
      ...cities("Saint John", "Cruz Bay, Coral Bay"),
    ],
  },
  homePool: { seniors: 25, youth: 36 },
  abroad: { seniors: 15, youth: 3, destinations: weighted("US:10 PR:2") },
});

// ------------------------------------------------------------------ OFC members without an own league

const FIJIAN = pool(
  "fijian",
  `Jone Josefa Samuela Iliesa Peni Sairusi Tevita Mosese Manasa Laisenia Sakiusa Tomasi Waisale Epeli Kolinio Setareki
   Viliame Semi Apenisa Filipe Isikeli Joeli Lote Maciu Mikaele Osea Pita Rusiate Sitiveni Taniela Timoci Uraia
   Vilimone Watisoni Akuila Alipate Asaeli Beniamino Emosi Inoke Isoa Kitione Lemeki Livai Meli`,
  `Ravulo Nasilasila Naivalu Ravouvou Koroi Tuisova Nabuli Nayacalevu Rokoduru Nacewa Tikoduadua Vakatalesau Dunadamu
   Cama Dakuitoga Delai Drodrolagi Lomani Mataitoga Nakalevu Naqeletia Qoro Radrodro Raiwalui Rokovereni Seru Tabete
   Tagicakibau Talebula Tuilevuka Tuimaba Turaga Vakacegu Vakatawa Vatuvei Veitayaki Vuniwaqa Waqa Yalayalatabua Bola
   Kunatani Matavesi Nadolo Naituyaga Rabuka Tuwai Volavola Botitu Kuruvoli Masi Baleinuku Radrekusa`,
);
const INDO_FIJIAN = pool(
  "indo-fijian",
  `Roy Ravinesh Avinesh Ravi Vijay Sunil Rajesh Anil Rohit Ravindra Shahil Nikhil Praneel Ronil Rakesh Sanjay Suresh
   Dhiren Kamal Pranil Ashneel Krishneel Vinit Sachin Arvind Ashwin Aman Deepak Nitin Salesh Imraan Mohammed Farzan
   Sahil Tito`,
  `Prasad Singh Sharma Kumar Lal Chand Naidu Pillay Reddy Narayan Deo Dutt Ram Krishna Khan Ali Hussein Nand Nath Raj
   Goundar Chandra Maharaj Mudaliar Sami Shankar Datt Prakash Rao Autar Bali Buksh Jokhan Kishore Mahendra Pal Sen`,
);
const SOLOMON = pool(
  "solomon",
  `Benjamin James Raphael Henry Gideon David Stanley Thomas Micah Francis Atkin Nelson Commins Emmanuel Jerry Judd Moses
   Paul Clifford Joses Alwin Barnabas Coleman Dennis Elijah Ezra Ian Jared Jeffery John Joel Leslie Nathan Patrick
   Philip Raymond Samson Silas Timothy Wesley`,
  `Gagame Feni Wale Suri Lamo Fakaia Auba Sade Boso Kaua Kakai Menapi Totori Tutizama Molea Waita Kilifa Harihiru Rota
   Kini Taro Aengari Lui Salini Iro Maetala Sau Fa'arodo Ramo Houkarawa Ifunaoa Lea'alafa Tafoa Leli Omokirio Rara Hou
   Fifi'i Sanga Talasasa Zoleveke Oti Laeta Sale Tome`,
);
const NI_VANUATU = pool(
  "ni-vanuatu",
  `Jean Brian Richard Jonathan Samuel Romain Mitch Cedric Jason Tony Etienne Daniel Kensi Alex Bill Michel Fredy Selwyn
   Azariah Jacky Joel Jimmy Moses Nelson Pierre Roger Sebastien Tom Willie Yoan Andrew Charles Ephraim Bong`,
  `Kaltak Nalo Yau Tasso Bule Kalsakau Tari Kalotang Malas Namatak Vira Sakama Tangis Kaltonga Kalsong Masing Mahit
   Molisa Natapei Salwai Tabi Taleo Tevi Tula Vanva Worek Yaman Nako Iamak Kalo Kilman Kalmet Naupa Nipiko Pakoa
   Regenvanu Saksak Siba Simeon Temar Toara Vatu Lini Sope`,
);
const PAPUAN = pool(
  "papuan",
  `Michael David John Nigel Raymond Emmanuel Albert Steven Paul Thomas Tommy Alwin Felix Gregory Jacob Kolu Kenneth
   Marlon Nathaniel Patrick Peter Ronald Samson Simon Timothy Wilson Abraham Daniel Dennis Gideon Ishmael Joe Kevin
   Lucas Matthew Max Noah Ati Kila Jerry`,
  `Kila Pala Dadi Aka Bua Geno Muri Wara Kaupa Aitsi Komolong Semmy Kapa Kauna Kuman Lohia Maino Namaliu Nape Oala
   Pomat Puka Ravu Siaguru Somare Tamur Tau Tepi Tokam Toua Vagi Waim Yaki Agarobe Aipe Ambai Awali Daure Gamoga Heni
   Igo Kaiap Kapal Kunda Mek Morea Nou Paulus Pokana Raka Sapi`,
);
const TAHITIAN = pool(
  "tahitian",
  `Teva Teariki Marama Moana Henri Raimana Tehei Tamatoa Hiro Heimano Teaonui Sandro Steevy Lorenzo Alvin Roonui Vatea
   Manuarii Heiarii Taumihau Rahiti Tetuanui Mauarii Heimana Tuarii Vaiarii Maui Tamarii Tearii Raiarii Rainui Teiva
   Tavita Terai Ariihau Hotu Keanu Manahau Temaui Tauhiti`,
  `Tehau Vahirua Temarii Labaste Tihoni Taerea Maamaatuaiahutapu Waan Ropati Aitamai Tetauira Tauira Teihotu
   Tehaamoana Tepa Teriitahi Mairai Tchen Wong Hoatua Hapairai Mahai Terorotua Tuiho Tetuanui Tefaatau Roomataaroa
   Temanava Teai Pito Tuheiava Brothers Bennett Salmon Hauata Tetumu Pambrun Richmond Teraiamano Maono Faatau Poroi
   Tapeta Toomaru Teuira Raapoto Tamarii Chan Lucas Tinorua`,
);
const KANAK = pool(
  "kanak",
  `Jean Georges Jacques Christian Willy Alain Patrick Didier Bertrand Emile Joël Cédric Marius Pierre Paul Sylvain
   Raphaël Lionel Yann Richard Brice Jean-Philippe Michel Mathieu Nicolas Julien Olivier Laurent Thierry André Joseph
   Samuel Daniel Éric Sébastien`,
  `Wetewea Hnepeune Goprou Gope Luepack Qaeze Gorohouna Waheo Kaloi Hnamuko Wadriako Poatinda Kecine Trolue
   Xowie Kakue Haocas Tidjite Hnawia Waia Kayara Wanesse Sele Jeno Wahetra Ihage Kaudre Poiwi
   Wahnawe Waiwa Watrone Hnaweo Kutrue Pouroudi`,
);
const COOK_ISLANDS = pool(
  "cook-islands",
  `Tere Tama Teariki Tua Teina Ngatupuna Pita Peter Mata Tupe Mii Tuaine Maara Nooroa Rongo Metua Tangaroa Teokotai
   Tautu Mana Rima Taio Tiaki Tuakana Aukino Tutai Marama Teuira Tapu Vaka`,
  `Maoate Marsters Wigmore Brown Inatio Tuavera Ioane Manarangi Browne Heather Tutakiau Tangimetua Taia Tuara Kea
   Mataio Mateariki Nicholas Puna Rasmussen Short Taripo Tetava Tuakeu Tuiravakai Tumarae Tupa Turua Upu Vakapora
   George Henry Hosking Kaitara Munokoa Numanga Ngatoko Pokino Pureariki Raui Samuela Strickland Tapurau Tatuava
   Tauei Teinaki Tepania Tamarua`,
);

const AS = homeNation("OFC", {
  code: "AS",
  name: "American Samoa",
  capital: "Pago Pago",
  latitude: -14.3,
  languages: languages("sm:6 en:4"),
  reputation: { national: 20, league: 6 },
  physique: { height: 180 },
  names: { given: sources("samoan=4 faker:en=0.5"), family: sources("samoan=4 faker:en=0.3") },
  nationality: {
    multipleRate: 0.35,
    tripleRate: 0.05,
    bornAbroadRate: 0.3,
    diasporaPull: 0.35,
    links: [...links("pacific", "WS:10 NZ:3 AU:2 TO:1"), ...links("americas", "US:8")],
    // US nationals holding US passports.
    citizenship: { group: "US", dual: "allowed" },
  },
  cities: {
    major: [
      ...cities("Eastern District", "Pago Pago, Fagatogo, Aua, Nu'uuli"),
      ...cities("Western District", "Tafuna, Leone, Ili'ili, Vaitogi, Faleniu, Malaeimi"),
      ...cities("Manu'a", "Ofu, Ta'u"),
    ],
  },
  homePool: { seniors: 25, youth: 36 },
  abroad: { seniors: 15, youth: 3, destinations: weighted("US:8 NZ:3 AU:1") },
});

const CK = homeNation("OFC", {
  code: "CK",
  name: "Cook Islands",
  capital: "Avarua",
  latitude: -21.2,
  languages: languages("en:6 rar:4"),
  reputation: { national: 22, league: 8 },
  physique: { height: 180 },
  names: {
    given: sources("cook-islands=3 maori=0.5 faker:en=1"),
    family: sources("cook-islands=3 faker:en=0.5"),
  },
  nationality: {
    multipleRate: 0.4,
    tripleRate: 0.07,
    bornAbroadRate: 0.45,
    diasporaPull: 0.35,
    links: links("pacific", "NZ:10 AU:5 PF:1"),
    // Cook Islanders are New Zealand citizens.
    citizenship: { group: "NZ", dual: "allowed" },
  },
  cities: {
    major: [
      ...cities("Rarotonga", "Avarua, Arorangi, Titikaveka, Ngatangiia, Matavera, Nikao"),
      ...cities("Aitutaki", "Amuri"),
      ...cities("Mangaia", "Oneroa"),
    ],
  },
  homePool: { seniors: 25, youth: 36 },
  abroad: { seniors: 15, youth: 3, destinations: weighted("NZ:10 AU:3") },
});

const FJ = homeNation("OFC", {
  code: "FJ",
  name: "Fiji",
  capital: "Suva",
  latitude: -18.1,
  languages: languages("en:4 fj:4 hi:2"),
  reputation: { national: 37, league: 22 },
  physique: { height: 178 },
  names: {
    given: sources("fijian=3 indo-fijian=1.6 faker:en=0.6"),
    family: sources("fijian=3 indo-fijian=1.8"),
  },
  nationality: {
    multipleRate: 0.2,
    tripleRate: 0.03,
    bornAbroadRate: 0.1,
    diasporaPull: 0.4,
    links: [...links("pacific", "AU:7 NZ:6 TO:1 WS:1"), ...links("asianDiaspora", "IN:3"), ...links("commonwealth", "EN:1")],
    // Dual citizenship since 2009.
    citizenship: allowed,
  },
  cities: {
    major: [
      city("Suva", "medium", "Central", 2),
      city("Lautoka", "small", "Western"),
      city("Nadi", "small", "Western"),
      city("Labasa", "small", "Northern"),
      city("Nausori", "small", "Central"),
      city("Nasinu", "small", "Central"),
      ...cities("Western", "Ba, Sigatoka, Rakiraki, Tavua"),
      ...cities("Central", "Navua, Lami"),
      ...cities("Eastern", "Levuka"),
      ...cities("Northern", "Savusavu"),
    ],
  },
  homePool: { seniors: 80, youth: 45 },
  abroad: { seniors: 20, youth: 4, destinations: weighted("NZ:6 AU:6 IN:2 US:1") },
});

const NC = homeNation("OFC", {
  code: "NC",
  name: "New Caledonia",
  capital: "Nouméa",
  latitude: -22.3,
  languages: languages("fr:10"),
  reputation: { national: 38, league: 16 },
  physique: { height: 177 },
  names: { given: sources("kanak=2.5 faker:fr=1.5"), family: sources("kanak=3 faker:fr=1") },
  nationality: {
    multipleRate: 0.3,
    tripleRate: 0.05,
    bornAbroadRate: 0.15,
    diasporaPull: 0.4,
    links: [...links("pacific", "FR:8 VU:2 WS:0.5"), ...links("asianDiaspora", "VN:0.5 ID:0.5")],
    // French nationals.
    citizenship: { group: "FR", dual: "allowed" },
  },
  cities: {
    major: [
      city("Nouméa", "medium", "Province Sud", 2),
      ...cities("Province Sud", "Dumbéa, Mont-Dore, Païta, Bourail, La Foa, Thio"),
      ...cities("Province Nord", "Koné, Poindimié, Koumac, Houaïlou, Canala"),
      ...cities("Province des Îles Loyauté", "Wé, Tadine"),
    ],
  },
  homePool: { seniors: 40, youth: 36 },
  abroad: { seniors: 20, youth: 4, destinations: weighted("FR:12 NZ:2 AU:1 BE:1") },
});

const PG = homeNation("OFC", {
  code: "PG",
  name: "Papua New Guinea",
  capital: "Port Moresby",
  latitude: -9.4,
  languages: languages("en:5 tpi:5"),
  reputation: { national: 32, league: 14 },
  physique: { height: 171 },
  names: { given: sources("papuan=3 faker:en=1"), family: sources("papuan=3") },
  nationality: {
    multipleRate: 0.1,
    tripleRate: 0.01,
    bornAbroadRate: 0.05,
    diasporaPull: 0.3,
    links: links("pacific", "AU:6 NZ:2 SB:1 FJ:1"),
    // 2016 amendment: dual citizenship only with approved countries.
    citizenship: { dual: "partners", partners: ["AU", "FJ", "DE", "NZ", "WS", "GB", "US", "VU"] },
  },
  cities: {
    major: [
      city("Port Moresby", "medium", "National Capital District", 2),
      city("Lae", "small", "Morobe"),
      ...cities("Western Highlands", "Mount Hagen"),
      ...cities("Madang", "Madang"),
      ...cities("Eastern Highlands", "Goroka"),
      ...cities("East New Britain", "Kokopo"),
      ...cities("East Sepik", "Wewak"),
      ...cities("Bougainville", "Arawa, Buka"),
      ...cities("West New Britain", "Kimbe"),
      ...cities("New Ireland", "Kavieng"),
      ...cities("Milne Bay", "Alotau"),
      ...cities("Oro", "Popondetta"),
      ...cities("Southern Highlands", "Mendi"),
      ...cities("Western", "Daru"),
    ],
  },
  homePool: { seniors: 50, youth: 40 },
  abroad: { seniors: 5, youth: 2, destinations: weighted("AU:3 NZ:1") },
});

const WS = homeNation("OFC", {
  code: "WS",
  name: "Samoa",
  capital: "Apia",
  latitude: -13.8,
  languages: languages("sm:8 en:2"),
  reputation: { national: 25, league: 10 },
  physique: { height: 180 },
  names: { given: sources("samoan=4 faker:en=0.4"), family: sources("samoan=4") },
  nationality: {
    multipleRate: 0.3,
    tripleRate: 0.05,
    bornAbroadRate: 0.3,
    diasporaPull: 0.35,
    links: [
      ...links("pacific", "NZ:10 AU:6 AS:5 TO:1 FJ:0.5"),
      ...links("americas", "US:1"),
      ...links("crossBorder", "DE:0.5"),
    ],
    citizenship: allowed,
  },
  cities: {
    major: [
      city("Apia", "small", "Tuamasaga", 2),
      ...cities("Tuamasaga", "Vaitele, Faleula, Siusega, Afega"),
      ...cities("A'ana", "Leulumoega"),
      ...cities("Aiga-i-le-Tai", "Mulifanua"),
      ...cities("Atua", "Lufilufi, Poutasi"),
      ...cities("Fa'asaleleaga", "Salelologa, Safotu"),
      ...cities("Vaisigano", "Asau, Falealupo"),
    ],
  },
  homePool: { seniors: 30, youth: 36 },
  abroad: { seniors: 15, youth: 3, destinations: weighted("NZ:8 AU:3 US:1") },
});

const SB = homeNation("OFC", {
  code: "SB",
  name: "Solomon Islands",
  capital: "Honiara",
  latitude: -9.4,
  languages: languages("en:5 pis:5"),
  reputation: { national: 37, league: 18 },
  physique: { height: 173 },
  names: { given: sources("solomon=3 faker:en=1"), family: sources("solomon=3") },
  nationality: {
    multipleRate: 0.15,
    tripleRate: 0.02,
    bornAbroadRate: 0.04,
    diasporaPull: 0.3,
    links: links("pacific", "AU:3 NZ:2 PG:2 FJ:1 VU:1"),
    // Dual citizenship since the 2018 Citizenship Act.
    citizenship: allowed,
  },
  cities: {
    major: [
      city("Honiara", "small", "Guadalcanal", 2),
      ...cities("Malaita", "Auki"),
      ...cities("Western", "Gizo, Noro, Munda"),
      ...cities("Central", "Tulagi"),
      ...cities("Isabel", "Buala"),
      ...cities("Makira-Ulawa", "Kirakira"),
      ...cities("Temotu", "Lata"),
      ...cities("Choiseul", "Taro"),
    ],
  },
  homePool: { seniors: 60, youth: 40 },
  abroad: { seniors: 10, youth: 3, destinations: weighted("NZ:4 AU:3") },
});

const PF = homeNation("OFC", {
  code: "PF",
  name: "Tahiti",
  capital: "Papeete",
  latitude: -17.5,
  languages: languages("fr:8 ty:2"),
  reputation: { national: 35, league: 16 },
  physique: { height: 177 },
  names: { given: sources("tahitian=3 faker:fr=1.2"), family: sources("tahitian=3 faker:fr=0.8") },
  nationality: {
    multipleRate: 0.3,
    tripleRate: 0.05,
    bornAbroadRate: 0.12,
    diasporaPull: 0.4,
    links: [...links("pacific", "FR:8 NC:2 NZ:1 CK:1"), ...links("asianDiaspora", "CN:1")],
    // French nationals.
    citizenship: { group: "FR", dual: "allowed" },
  },
  cities: {
    major: [
      city("Papeete", "small", "Îles du Vent", 2),
      ...cities("Îles du Vent", "Faaa, Punaauia, Pirae, Mahina, Paea, Papara, Arue, Taravao, Afareaitu"),
      ...cities("Îles Sous-le-Vent", "Uturoa, Vaitape"),
      ...cities("Îles Marquises", "Taiohae"),
    ],
  },
  homePool: { seniors: 50, youth: 40 },
  abroad: { seniors: 10, youth: 3, destinations: weighted("FR:6 NZ:1") },
});

const TO = homeNation("OFC", {
  code: "TO",
  name: "Tonga",
  capital: "Nuku'alofa",
  latitude: -21.1,
  languages: languages("to:8 en:2"),
  reputation: { national: 22, league: 6 },
  physique: { height: 180 },
  names: { given: sources("tongan=4 faker:en=0.3"), family: sources("tongan=4") },
  nationality: {
    multipleRate: 0.35,
    tripleRate: 0.05,
    bornAbroadRate: 0.35,
    diasporaPull: 0.35,
    links: [...links("pacific", "NZ:10 AU:7 FJ:1 WS:1"), ...links("americas", "US:3")],
    // Dual citizenship since 2007.
    citizenship: allowed,
  },
  cities: {
    major: [
      city("Nuku'alofa", "small", "Tongatapu", 2),
      ...cities("Tongatapu", "Haveluloto, Vaini, Kolonga, Houma, Nukunuku, Mu'a"),
      ...cities("Vava'u", "Neiafu"),
      ...cities("Ha'apai", "Pangai"),
      ...cities("'Eua", "Ohonua"),
    ],
  },
  homePool: { seniors: 25, youth: 36 },
  abroad: { seniors: 15, youth: 3, destinations: weighted("NZ:8 AU:4 US:2") },
});

const VU = homeNation("OFC", {
  code: "VU",
  name: "Vanuatu",
  capital: "Port Vila",
  latitude: -17.7,
  languages: languages("bi:5 en:3 fr:2"),
  reputation: { national: 33, league: 14 },
  physique: { height: 172 },
  names: {
    given: sources("ni-vanuatu=3 faker:fr=0.6 faker:en=0.6"),
    family: sources("ni-vanuatu=3 faker:fr=0.3"),
  },
  nationality: {
    multipleRate: 0.15,
    tripleRate: 0.02,
    bornAbroadRate: 0.05,
    diasporaPull: 0.3,
    links: links("pacific", "NC:4 FR:2 AU:2 NZ:2 FJ:1 SB:1"),
    // Dual citizenship since the 2013 constitutional amendment.
    citizenship: allowed,
  },
  cities: {
    major: [
      city("Port Vila", "small", "Shefa", 2),
      ...cities("Shefa", "Mele, Erakor, Pango"),
      ...cities("Sanma", "Luganville"),
      ...cities("Malampa", "Norsup, Lakatoro"),
      ...cities("Tafea", "Isangel, Lenakel"),
      ...cities("Penama", "Saratamata"),
      ...cities("Torba", "Sola"),
    ],
  },
  homePool: { seniors: 40, youth: 36 },
  abroad: { seniors: 10, youth: 3, destinations: weighted("NZ:3 AU:2 FR:1") },
});

/** Real 2025/26 clubs (modeled tiers plus well-known others) the templates, districts or region names could reproduce. */
const REAL_CLUB_NAMES: Readonly<Record<string, readonly string[]>> = {
  US: list(
    `Atlanta United|Austin FC|Charlotte FC|Chicago Fire|FC Cincinnati|Colorado Rapids|Columbus Crew|D.C. United|FC Dallas|
     Houston Dynamo|Sporting Kansas City|LA Galaxy|Los Angeles Galaxy|Los Angeles FC|Inter Miami|Minnesota United|
     Nashville SC|New England Revolution|New York City FC|New York Red Bulls|New York Cosmos|Orlando City|
     Philadelphia Union|Portland Timbers|Real Salt Lake|San Diego FC|San Jose Earthquakes|Seattle Sounders|St. Louis City|
     Birmingham Legion|Charleston Battery|Colorado Springs Switchbacks|Detroit City|El Paso Locomotive|FC Tulsa|
     Hartford Athletic|Indy Eleven|Las Vegas Lights|Lexington SC|Loudoun United|Louisville City|Miami FC|Monterey Bay FC|
     New Mexico United|North Carolina FC|Oakland Roots|Orange County SC|Phoenix Rising|Pittsburgh Riverhounds|
     Rhode Island FC|Sacramento Republic|San Antonio FC|Tampa Bay Rowdies|AV Alta|Charlotte Independence|
     Chattanooga Red Wolves|Chattanooga FC|Forward Madison|Greenville Triumph|One Knoxville|Portland Hearts of Pine|
     Richmond Kickers|Tormenta FC|Spokane Velocity|Texoma FC|Union Omaha|Westchester SC|FC Naples|Sporting JAX|Brooklyn FC|
     Jacksonville Armada|Memphis 901|Arizona United|Saint Louis FC|Reno 1868|OKC Energy|Austin Bold|Fresno FC|
     Albion San Diego|Minneapolis City|Carolina Core|Rochester Rhinos|Tampa Bay Mutiny|Kansas City Wizards|Dallas Burn|
     Miami Fusion|Chivas USA|San Diego Loyal`,
  ),
  CA: list(
    `Toronto FC|Vancouver Whitecaps|CF Montréal|Montreal Impact|Forge FC|Cavalry FC|Atlético Ottawa|HFX Wanderers|Pacific FC|
     Valour FC|Vancouver FC|York United|FC Edmonton|Ottawa Fury|Inter Toronto|FC Supra du Québec|Burlington SC|
     Vaughan Azzurri|Woodbridge Strikers|Simcoe County Rovers|North Toronto Nitros|Scrosoppi FC|Sigma FC|Unity FC|
     AS Blainville|CS Saint-Laurent|FC Laval|CS Longueuil|AS Laval|CS St-Hubert|Pierrefonds FC|CS Mont-Royal Outremont|
     Victoria Highlanders|TSS Rovers|Calgary Foothills|Edmonton BTB|London City|Hamilton City|Surrey United|Kitchener FC`,
  ),
  MX: list(
    `Club América|Club Atlas|Atlético San Luis|Cruz Azul|Club Deportivo Guadalajara|Deportivo Guadalajara|Chivas|FC Juárez|
     Club León|Mazatlán FC|CF Monterrey|Club Monterrey|Rayados|Club Necaxa|CF Pachuca|Club Pachuca|Club Puebla|Pumas UNAM|
     Querétaro FC|Club Querétaro|Santos Laguna|Club Tijuana|Tigres UANL|Deportivo Toluca|Club Toluca|Toluca FC|
     Alebrijes de Oaxaca|Atlante|Atlético La Paz|Atlético Morelia|Club Atlético Morelia|Cancún FC|Club Celaya|
     Correcaminos UAT|Dorados de Sinaloa|Tampico Madero|Jaiba Brava|Leones Negros|Mineros de Zacatecas|Tapatío|Raya2|
     Tepatitlán FC|Tlaxcala FC|Coyotes de Tlaxcala|Venados FC|Venados de Yucatán|Club Irapuato|Club Deportivo Irapuato|
     Alacranes de Durango|Club Zacatepec|Club Atlético Zacatepec|Cañeros de Zacatepec|Toros Neza|Deportivo Neza|
     Real Zamora|Club Jalisco|Chiapas FC|Jaguares de Chiapas|Lobos BUAP|Monarcas Morelia|Club Morelia|Tiburones Rojos|
     Atlético Mexiquense|Club San Luis|Club Universidad Nacional|Club Atlético Celaya|Atlético Celaya|Deportivo Tepic`,
  ),
  PA: list(
    `Club Atlético Independiente|Atlético Independiente|Plaza Amador|Tauro FC|San Francisco FC|Árabe Unido|
     Deportivo Árabe Unido|Sporting San Miguelito|Alianza FC|Universitario|Herrera FC|UMECIT FC|Veraguas United|
     Costa del Este FC|Atlético Chiriquí|Atlético Veragüense|Chepo FC|Río Abajo FC|Chorrillo FC|Colón River`,
  ),
  CR: list(
    `Liga Deportiva Alajuelense|Alajuelense|Deportivo Saprissa|Saprissa|CS Herediano|Herediano|CS Cartaginés|Cartaginés|
     Municipal Liberia|AD San Carlos|Puntarenas FC|Sporting FC|Municipal Pérez Zeledón|AD Guanacasteca|Santa Ana FC|
     Municipal Grecia|Santos de Guápiles|Limón FC|Belén FC|AD Belén|Municipal Turrialba|Municipal Santa Ana|
     Municipal Puntarenas|AD Carmelita|Jicaral Sercoba|AD Ramonense|AD Palmares|AD Nicoya|CS Uruguay de Coronado|
     AD Santa Bárbara|AD Barrio México|AS Puma Generaleña`,
  ),
  HN: list(
    `CD Olimpia|Olimpia|FC Motagua|Motagua|Real CD España|Real España|CD Marathón|CD Victoria|Olancho FC|Juticalpa FC|
     Lobos UPNFM|Génesis Comayagua|CD Vida|Real Sociedad|CD Platense|Honduras Progreso|CD Choloma|Atlético Choloma|
     Parrillas One|Social Sol|Atlético Pinares|CD Real de Minas|Lone FC|Deportes Savio|Real Maya|Juventud Morazánica`,
  ),
  SV: list(
    `Alianza FC|CD FAS|CD Águila|CD Luis Ángel Firpo|CD Platense|AD Isidro Metapán|Once Deportivo|Once Municipal|
     Municipal Limeño|Fuerte San Francisco|Inter FA|CD Hércules|Atlético Marte|Santa Tecla FC|AD Chalatenango|
     CD Chalatenango|Sonsonate FC|CD Sonsonate|San Salvador FC|Juventud Independiente|Atlético Balboa|Nejapa FC|CD Dragón|
     Jocoro FC|Zacatecoluca FC`,
  ),
  GT: list(
    `Comunicaciones|CSD Comunicaciones|Municipal|CSD Municipal|Antigua GFC|Xelajú MC|Deportivo Mixco|Deportivo Malacateco|
     Deportivo Marquense|Cobán Imperial|CSD Guastatoya|Deportivo Guastatoya|Deportivo Achuapa|Deportivo Mictlán|
     Deportivo Iztapa|Deportivo Sanarate|Deportivo Siquinalá|Deportivo Suchitepéquez|Juventud Retalteca|Heredia Jaguares|
     Deportivo San Pedro|Aurora FC|Deportivo Xinabajul|Deportivo Jalapa|Deportivo Zacapa|Deportivo Coatepeque|
     Deportivo Escuintla|Deportivo Petapa|Sacachispas`,
  ),
  JM: list(
    `Arnett Gardens FC|Cavalier SC|Chapelton Maroons|Dunbeholden FC|Harbour View FC|Humble Lions|Molynes United|
     Montego Bay United|Mount Pleasant FA|Portmore United|Racing United|Tivoli Gardens FC|Treasure Beach FC|Waterhouse FC|
     Vere United|Duhaney Park FC|Constant Spring FC|Boys' Town FC|Seba United|Reno FC|Wadadah FC|Rivoli United|
     Village United|Sporting Central Academy|Jamalco FC|Hazard United|St. George's SC`,
  ),
  HT: list(
    `Violette AC|Racing Club Haïtien|Don Bosco FC|AS Capoise|Baltimore SC|Arcahaie FC|Tempête FC|Real Hope FA|AS Cavaly|
     AS Mirebalais|FICA|Racing FC des Gonaïves|Racing FC Gonaïves|Racing Gonaïves|América des Cayes|Ouanaminthe FC|Juventus des Cayes|Aigle Noir AC|
     Victory SC|Étoile Haïtienne|Cosmopolite|Triomphe de Liancourt|Real du Cap`,
  ),
  DO: list(
    `Cibao FC|Atlético Pantoja|Club Atlético Pantoja|Club Atlético Vega Real|Moca FC|Delfines del Este|Jarabacoa FC|
     Atlántico FC|Universidad O&M|Club Barcelona Atlético|Atlético San Francisco|Salcedo FC|Atlético San Cristóbal|
     Club Atlético San Cristóbal|Bauger FC`,
  ),
  PR: list(
    `Bayamón FC|Metropolitan FA|Criollos de Caguas|Guaynabo Fluminense|GPS Puerto Rico|Don Bosco FC|Academia Quintana|
     Puerto Rico Surf|Puerto Rico Sol|Sevilla Puerto Rico|Puerto Rico Islanders|Puerto Rico Bayamón|Caguas Sporting`,
  ),
  NZ: list(
    `Auckland City|Auckland United|Auckland FC|Wellington Phoenix|Birkenhead United|Eastern Suburbs|Western Springs|
     East Coast Bays|Bay Olympic|Manurewa|Melville United|Hamilton Wanderers|Napier City Rovers|Wellington Olympic|
     Miramar Rangers|Western Suburbs|Waterside Karori|Petone|Wellington United|Christchurch United|Cashmere Technical|
     Coastal Spirit|Nomads United|Ferrymead Bays|Selwyn United|Dunedin City Royals|Dunedin City|Mosgiel|Otago University|
     Tasman United|West Coast Rangers|Central United|Fencibles United|Tauranga City|North Wellington|Stop Out|
     Wairarapa United|Havelock North Wanderers|Palmerston North Marist|Lower Hutt City|Upper Hutt City|Whanganui Athletic|
     Nelson Suburbs|Canterbury United|Southern United|Otago United|Hawke's Bay United|Waikato FC|Team Wellington|
     Onehunga Sports|Papatoetoe|Glenfield Rovers|Takapuna|Hibiscus Coast|Ellerslie|Three Kings United|Bucklands Beach|
     Northern Rovers|Claudelands Rovers|Rotorua City|Cambridge FC|New Plymouth Rangers|Gisborne City|Hastings United|
     Queenstown Rovers|Timaru City`,
  ),
};

export const CONCACAF_OFC: CatalogFileData = {
  file: "concacaf-ofc",
  realClubNames: REAL_CLUB_NAMES,
  nations: [
    US,
    CA,
    MX,
    NZ,
    PA,
    CR,
    HN,
    SV,
    GT,
    JM,
    HT,
    DO,
    PR,
    AI,
    AG,
    AW,
    BS,
    BB,
    BZ,
    BM,
    VG,
    KY,
    CU,
    CW,
    DM,
    GD,
    GY,
    MS,
    NI,
    KN,
    LC,
    VC,
    SR,
    TT,
    TC,
    VI,
    AS,
    CK,
    FJ,
    NC,
    PG,
    WS,
    SB,
    PF,
    TO,
    VU,
  ],
  namePools: [
    AMERICAN,
    AFRICAN_AMERICAN,
    CANADIAN_FRENCH,
    MEXICAN,
    MAORI,
    SAMOAN,
    TONGAN,
    CENTRAL_AMERICAN,
    COSTA_RICAN,
    HONDURAN,
    GUATEMALAN,
    SALVADORAN,
    PANAMANIAN,
    ANGLO_CARIBBEAN,
    HAITIAN,
    DOMINICAN,
    PUERTO_RICAN,
    PAPIAMENTO,
    SURINAMESE_CREOLE,
    HINDUSTANI_CARIBBEAN,
    JAVANESE_SURINAMESE,
    CUBAN,
    NICARAGUAN,
    FIJIAN,
    INDO_FIJIAN,
    SOLOMON,
    NI_VANUATU,
    PAPUAN,
    TAHITIAN,
    KANAK,
    COOK_ISLANDS,
  ],
};
