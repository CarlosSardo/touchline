import type {
  CatalogFileData,
  CitySize,
  CitySpec,
  ClubNameTemplate,
  HeritageLink,
  MigrationContext,
  NamePool,
  NationSpec,
  Span,
  WeightedCode,
  WeightedNameSource,
  YouthDivisionSpec,
} from "./types.ts";
import { UEFA_CENTRAL_B } from "./uefa-central-b.ts";

// Owner: catalog author "uefa-central" — DE NL BE LU CH LI AT PL CZ SK HU SI HR (validate.ts CATALOG_ASSIGNMENT).
// Real 2025/26 structures and names without sponsors; clubs are generated. Money is GBP.

const list = (names: string) =>
  names.split("|").map((name) => name.trim()).filter(Boolean);
const pool = (name: string, given: string, family: string): NamePool => ({
  id: `uefa-central/${name}`,
  ...(given.trim() ? { given: list(given) } : {}),
  ...(family.trim() ? { family: list(family) } : {}),
});
/** "german=0.7 faker:de=0.3": bare names are pools of this file. */
const sources = (spec: string): WeightedNameSource[] =>
  spec.trim().split(/\s+/).map((entry) => {
    const [name, weight] = entry.split("=");
    const source = (name.includes(":") ? name : `pool:uefa-central/${name}`) as WeightedNameSource["source"];
    return { source, weight: Number(weight) };
  });
/** "TR:10 PL:8" */
const codes = (spec: string): WeightedCode[] =>
  spec.trim().split(/\s+/).map((entry) => {
    const [code, weight] = entry.split(":");
    return { code, weight: Number(weight) };
  });
const links = (context: MigrationContext, spec: string): HeritageLink[] =>
  codes(spec).map((entry) => ({ ...entry, context }));
const span = (top: number, bottom: number): Span => ({ top, bottom });
/** One city per line: "name|size|region|maxClubs|district,district". */
function cityRows(rows: string, regions: Record<string, string> = {}): CitySpec[] {
  return rows.trim().split("\n").map((row) => {
    const [name, size, region, max, districts] = row.split("|").map((field) => field.trim());
    return {
      name,
      size: size as CitySize,
      region: regions[region] ?? region,
      ...(max ? { maxClubs: Number(max) } : {}),
      ...(districts ? { districts: districts.split(",").map((district) => district.trim()) } : {}),
    };
  });
}
/** One template per line: "pattern|weight|tier,tier". */
function templates(rows: string): ClubNameTemplate[] {
  return rows.trim().split("\n").map((row) => {
    const [pattern, weight, tiers] = row.split("|").map((field) => field.trim());
    return { pattern, weight: Number(weight), ...(tiers ? { tiers: tiers.split(",").map(Number) } : {}) };
  });
}
const division = (
  name: string,
  parentTiers: [number, number],
  groupSize?: number,
  groupNames?: string,
): YouthDivisionSpec => ({
  name,
  parentTiers,
  ...(groupSize ? { groupSize } : {}),
  ...(groupNames ? { groupNames: list(groupNames) } : {}),
});

// ------------------------------------------------------------------ Germany

const DE_REGIONS: Record<string, string> = {
  BW: "Baden-Württemberg",
  BY: "Bayern",
  BE: "Berlin",
  BB: "Brandenburg",
  HB: "Bremen",
  HH: "Hamburg",
  HE: "Hessen",
  MV: "Mecklenburg-Vorpommern",
  NI: "Niedersachsen",
  NW: "Nordrhein-Westfalen",
  RP: "Rheinland-Pfalz",
  SL: "Saarland",
  SN: "Sachsen",
  ST: "Sachsen-Anhalt",
  SH: "Schleswig-Holstein",
  TH: "Thüringen",
};

const GERMANY: NationSpec = {
  code: "DE",
  iso2: "DE",
  name: "Germany",
  confederation: "UEFA",
  continent: "EU",
  capital: "Berlin",
  latitude: 51.2,
  languages: [{ code: "de", weight: 1 }],
  reputation: { national: 87, league: 91 },
  euEea: true,
  physique: { height: 183 },
  names: { given: sources("faker:de=1"), family: sources("faker:de=1") },
  nationality: {
    multipleRate: 0.3,
    tripleRate: 0.05,
    bornAbroadRate: 0.05,
    diasporaPull: 0.35,
    links: [
      ...links("germanRecruitment", "TR:14 IT:5 GR:3 ES:1.5 PT:2 MA:1.5 TN:1"),
      ...links("yugoslav", "HR:5 BA:4.5 RS:4 XK:4 MK:1.5 SI:0.5 ME:0.5"),
      ...links("crossBorder", "PL:7 AT:2 NL:1.5 FR:1.5 CZ:0.8 CH:0.6 DK:0.4 AL:1.5 RO:2 HU:0.8"),
      ...links("postSoviet", "RU:2.5 KZ:2 UA:1.5"),
      ...links("regional", "GH:3 NG:2.5 CM:2 CD:1.2 TG:1 SN:0.8 CI:0.8 GN:0.6 AO:0.5"),
      ...links("arabWorld", "SY:1.5 IQ:1 LB:1"),
      ...links("asianDiaspora", "AF:0.8 VN:0.6 IR:0.8"),
      ...links("americas", "US:1.5 BR:1"),
    ],
    citizenship: { dual: "allowed" },
  },
  cities: {
    major: cityRows(
      `
Berlin|mega|BE|4|Charlottenburg,Köpenick,Spandau,Neukölln,Tempelhof,Lichtenberg,Pankow,Steglitz,Wedding,Reinickendorf,Zehlendorf,Friedrichshain
Hamburg|large|HH|3|Altona,St. Pauli,Barmbek,Eimsbüttel,Harburg,Bergedorf,Wandsbek
München|large|BY|3|Schwabing,Giesing,Pasing,Sendling,Haidhausen,Bogenhausen
Köln|large|NW|3|Ehrenfeld,Deutz,Mülheim,Porz,Nippes,Kalk,Lindenthal
Frankfurt|large|HE|2|Sachsenhausen,Bornheim,Höchst,Fechenheim,Rödelheim
Stuttgart|large|BW|2|Degerloch,Cannstatt,Feuerbach,Zuffenhausen,Vaihingen
Düsseldorf|large|NW|2|Benrath,Bilk,Gerresheim,Oberkassel,Rath
Leipzig|large|SN|2|Probstheida,Connewitz,Lindenau,Leutzsch,Grünau
Dortmund|large|NW|2|Hörde,Eving,Brackel,Aplerbeck,Huckarde
Essen|large|NW|2|Bergeborbeck,Rüttenscheid,Steele,Kray,Altenessen
Bremen|large|HB|2|Vegesack,Findorff,Walle,Hemelingen
Dresden|large|SN|2|Neustadt,Striesen,Loschwitz,Pieschen
Hannover|large|NI|2|Linden,List,Döhren,Ricklingen
Nürnberg|large|BY|1
Duisburg|medium|NW|2|Meiderich,Hamborn,Rheinhausen,Homberg
Bochum|medium|NW|1
Wuppertal|medium|NW|1
Bielefeld|medium|NW|1
Bonn|medium|NW|1
Münster|medium|NW|1
Mannheim|medium|BW|1
Karlsruhe|medium|BW|1
Augsburg|medium|BY|1
Wiesbaden|medium|HE|1
Mönchengladbach|medium|NW|1
Gelsenkirchen|medium|NW|1
Aachen|medium|NW|1
Braunschweig|medium|NI|1
Kiel|medium|SH|1
Chemnitz|medium|SN|1
Halle|medium|ST|1
Magdeburg|medium|ST|1
Freiburg|medium|BW|1
Krefeld|medium|NW|1
Mainz|medium|RP|1
Lübeck|medium|SH|1
Erfurt|medium|TH|1
Oberhausen|medium|NW|1
Rostock|medium|MV|1
Kassel|medium|HE|1
Saarbrücken|medium|SL|1
Potsdam|small|BB|1
Oldenburg|small|NI|1
Osnabrück|small|NI|1
Darmstadt|small|HE|1
Regensburg|small|BY|1
Ingolstadt|small|BY|1
Würzburg|small|BY|1
Wolfsburg|small|NI|1
Ulm|small|BW|1
Heilbronn|small|BW|1
Offenbach|small|HE|1
Paderborn|small|NW|1
Göttingen|small|NI|1
Cottbus|small|BB|1
Jena|small|TH|1
Kaiserslautern|small|RP|1
Fürth|small|BY|1
Trier|small|RP|1
Koblenz|small|RP|1
Zwickau|small|SN|1
Siegen|small|NW|1
Hildesheim|small|NI|1
Schweinfurt|town|BY|1
Heidenheim|town|BW|1
Sandhausen|town|BW|1
Elversberg|town|SL|1
Verl|town|NW|1
Aue|town|SN|1
Meppen|town|NI|1
Lotte|town|NW|1
Burghausen|town|BY|1
Aalen|town|BW|1
Garbsen|town|NI|1
Unterhaching|town|BY|1
Rödinghausen|town|NW|1
`,
      DE_REGIONS,
    ),
  },
  football: {
    leagues: [
      {
        tier: 1,
        name: "Bundesliga",
        shortName: "Bundesliga",
        size: 18,
        status: "professional",
        reputation: 91,
        clubs: {
          reputation: span(85, 68),
          giants: { count: 2, top: 95, bottom: 88 },
          capacity: span(81_000, 15_000),
          facilities: span(95, 72),
          academy: span(92, 68),
          wageBill: span(300_000_000, 20_000_000),
          transferBudget: span(100_000_000, 3_000_000),
          foreignShare: 0.55,
          squadSize: [26, 32],
        },
      },
      {
        tier: 2,
        name: "2. Bundesliga",
        shortName: "2. Bundesliga",
        size: 18,
        status: "professional",
        reputation: 73,
        clubs: {
          reputation: span(71, 55),
          capacity: span(62_000, 10_000),
          facilities: span(78, 55),
          academy: span(80, 55),
          wageBill: span(40_000_000, 6_000_000),
          transferBudget: span(8_000_000, 300_000),
          foreignShare: 0.35,
          squadSize: [25, 30],
        },
      },
      {
        tier: 3,
        name: "3. Liga",
        shortName: "3. Liga",
        size: 20,
        status: "professional",
        reputation: 58,
        bTeams: 2,
        clubs: {
          reputation: span(56, 43),
          capacity: span(32_000, 3_500),
          facilities: span(62, 42),
          academy: span(64, 42),
          wageBill: span(8_000_000, 1_800_000),
          transferBudget: span(800_000, 20_000),
          foreignShare: 0.2,
          squadSize: [25, 30],
        },
      },
    ],
    movement: [
      {
        upper: 1,
        promoted: 2,
        relegated: 2,
        playoffs: [{ type: "cross-tier", upperPositions: [16], lowerPositions: [3], legs: 2 }],
      },
      {
        upper: 2,
        promoted: 2,
        relegated: 2,
        playoffs: [{ type: "cross-tier", upperPositions: [16], lowerPositions: [3], legs: 2 }],
      },
    ],
    cups: [
      // Real: 64 teams (Bundesliga, 2. Bundesliga, top four of the 3. Liga and regional cup winners); reserve sides excluded.
      { kind: "national", name: "DFB-Pokal", legs: 1, neutralFinal: true, continental: true },
      { kind: "super", name: "DFL-Supercup", participants: ["champion", "cup-winner"], legs: 1, start: "08-16" },
    ],
    youth: {
      U19: {
        divisions: [division("DFB-Nachwuchsliga U19", [1, 3], 8, "Gruppe A|Gruppe B|Gruppe C|Gruppe D|Gruppe E|Gruppe F|Gruppe G")],
        cup: { name: "DFB-Pokal der Junioren" },
      },
      U17: {
        divisions: [division("DFB-Nachwuchsliga U17", [1, 3], 8, "Gruppe A|Gruppe B|Gruppe C|Gruppe D|Gruppe E|Gruppe F|Gruppe G")],
      },
    },
    reserves: {
      mode: "pyramid",
      nameTemplate: "{club} II",
      eligibility: { parentTiers: [1, 2], minReputation: 66, maxTeams: 2 },
      pyramid: { highestTier: 3, minGapBelowParent: 1, maxPerTier: 2 },
      ageRule: { maxAge: 23, overage: 3 },
      squad: [22, 28],
    },
    clubNaming: {
      templates: templates(`
1. FC {city}|9
FC {city}|6
SV {city}|8
VfB {city}|5
VfL {city}|5
TSV {city}|5
SpVgg {city}|3
SC {city}|3
FSV {city}|2
SSV {city}|2
Borussia {city}|3
Eintracht {city}|3
Fortuna {city}|2.5
Rot-Weiß {city}|2
Preußen {city}|1
Viktoria {city}|1.5
Alemannia {city}|0.8
Arminia {city}|0.8
Germania {city}|0.6
Wacker {city}|1
Kickers {city}|1
Sportfreunde {city}|1|2,3
TuS {city}|1.5|3
SG {city}|1|3
SV {city} {founded2}|3
1. FSV {city} {founded2}|1.5
{city} {founded2}|1.5
FC {city} {founded2}|1.5
`),
      regional: [
        {
          regions: ["Sachsen", "Sachsen-Anhalt", "Thüringen", "Brandenburg", "Mecklenburg-Vorpommern", "Berlin"],
          templates: templates(`
Dynamo {city}|2
1. FC Lokomotive {city}|1
FC Energie {city}|1
Chemie {city}|1
FC Rot-Weiß {city}|1
Stahl {city}|1
Motor {city}|1
FC Union {city}|1
`),
        },
        { regions: ["Mecklenburg-Vorpommern", "Schleswig-Holstein", "Bremen", "Hamburg"], templates: templates("FC Hansa {city}|2\nHolstein {city}|1") },
      ],
      founded: { top: [1887, 1966], bottom: [1893, 2005] },
      shortName: "city",
      avoid: list(
        "FC Bayern München|Borussia Dortmund|Borussia Mönchengladbach|Eintracht Frankfurt|VfB Stuttgart|VfL Wolfsburg|VfL Bochum|SC Freiburg|FC Augsburg|1. FC Köln|1. FC Union Berlin|FC Union Berlin|Union Berlin|Hertha BSC|Dynamo Berlin|BFC Dynamo|FC St. Pauli|Hamburger SV|SV Werder Bremen|1. FSV Mainz 05|FSV Mainz 05|1. FC Heidenheim|1. FC Heidenheim 1846|Holstein Kiel|FC Schalke 04|Hannover 96|Fortuna Düsseldorf|Fortuna Köln|Viktoria Köln|Viktoria Berlin|Arminia Bielefeld|Eintracht Braunschweig|Preußen Münster|Alemannia Aachen|Rot-Weiss Essen|Rot-Weiß Essen|Rot-Weiß Oberhausen|Rot-Weiß Erfurt|FC Rot-Weiß Erfurt|Dynamo Dresden|1. FC Nürnberg|1. FC Kaiserslautern|1. FC Magdeburg|1. FC Saarbrücken|1. FC Schweinfurt|1. FC Schweinfurt 05|SC Paderborn|SC Paderborn 07|SC Verl|SV Sandhausen|SV Elversberg|SV Meppen|SV Rödinghausen|SV Darmstadt 98|SV Wehen Wiesbaden|SV Waldhof Mannheim|VfL Osnabrück|VfB Lübeck|VfB Oldenburg|SpVgg Unterhaching|SpVgg Fürth|Wacker Burghausen|Sportfreunde Lotte|Sportfreunde Siegen|FSV Zwickau|FSV Frankfurt|FC Ingolstadt 04|SSV Ulm|SSV Ulm 1846|Kickers Offenbach|Kickers Würzburg|Stuttgarter Kickers|Eintracht Trier|TuS Koblenz|FC Hansa Rostock|Hansa Rostock|FC Energie Cottbus|Energie Cottbus|1. FC Lokomotive Leipzig|Lokomotive Leipzig|Chemie Leipzig|Göttingen 05|Altona 93|TSV 1860 München|Bayer Leverkusen|RB Leipzig",
      ),
      colors: ["#DC052D", "#FDE100", "#E32221", "#005CA9", "#1D9053", "#FFFFFF", "#000000", "#E1000F", "#004F9F", "#65B32E", "#0A3F86", "#8B0000"],
    },
    importSources: codes(
      "AT:7 FR:6 NL:5 CH:5 DK:5 JP:5 HR:4 US:4 BE:3 PL:3 SE:3 NO:3 ES:3 CZ:3 HU:3 TR:3 BR:3 PT:2 SK:2 SI:2 BA:2 RS:2 KR:2 GH:2 CI:2 MA:2 EN:2 GR:1.5 IT:1.5 CM:1.5 SN:1.5 NG:1.5 GN:1.5 ML:1.5 UA:1.5 GE:1.5 XK:1.5 CA:1.5 DZ:1 TN:1 CD:1 IS:1 FI:1 AU:1 AR:1 CO:1 EC:1 AL:1 MK:0.8 BF:0.8 LU:0.5 IL:0.5 IE:0.5 SCO:0.5 UY:0.5",
    ),
    coefficients: { association: [15.214, 16.214, 17.125, 19.357, 18.421], season2025: 21.785 },
  },
};

// -------------------------------------------------------------- Netherlands

const DUTCH = pool(
  "dutch",
  "Daan|Sem|Lucas|Levi|Finn|Milan|Jesse|Thijs|Bram|Luuk|Ruben|Stijn|Tim|Lars|Jens|Sven|Jasper|Niels|Koen|Wout|Teun|Mees|Gijs|Sam|Thomas|Max|Tom|Joey|Kevin|Dennis|Jordy|Rick|Mike|Jeroen|Bart|Joost|Maarten|Wesley|Davy|Quinten|Justin|Jurriën|Micky|Ryan|Jayden|Julian|Siem|Olivier|Pepijn|Hidde|Joep|Floris|Ties|Guus|Mats|Tygo|Owen|Dex|Ralf|Matthijs|Cody|Jurgen|Noah|Bas|Rens|Jelle|Robin|Nick|Jan|Pieter|Sander|Youri|Calvin|Kenneth|Wouter|Mark|Arjen|Rafael|Stefan|Bryan|Donny|Myron|Kees|Jort",
  "de Jong|Jansen|de Vries|van den Berg|van Dijk|Bakker|Visser|Smit|Meijer|de Boer|Mulder|de Groot|Bos|Vos|Peters|Hendriks|van Leeuwen|Dekker|Brouwer|de Wit|Dijkstra|Smits|de Graaf|van der Meer|van der Linden|Kok|Jacobs|de Haan|Vermeulen|van den Heuvel|van der Veen|van den Broek|de Bruijn|de Bruin|van der Heijden|Schouten|van Beek|Willems|van Vliet|van de Ven|Hoekstra|Maas|Verhoeven|Koster|van Dam|van der Wal|Prins|Blom|Huisman|Peeters|de Lange|Kuipers|van Wijk|Post|Kuiper|Veenstra|Kramer|van den Brink|Scholten|Timmermans|Wouters|Klaassen|Postma|Hoogland|Bosman|Boersma|van Bergen|Verbeek|Brinkman|Koopman|Wolters|van der Laan|Groen|Veltman|Timmer|Lang|Martens|Hartman|Verhagen|Hermans|Janssen|van Rijn|Mertens|Claassen|Hoek|de Kok|Molenaar|Verschuren|Aarts|Kuijpers|Evers|Rutten|Gerritsen|Lammers|Franken|Kersten|Hofman|Nijland|Wijnands|Kroon|Snijders|Visscher|Zwart",
);

const NL_REGIONS: Record<string, string> = {
  NH: "Noord-Holland",
  ZH: "Zuid-Holland",
  UT: "Utrecht",
  NB: "Noord-Brabant",
  GE: "Gelderland",
  OV: "Overijssel",
  GR: "Groningen",
  FR: "Friesland",
  DR: "Drenthe",
  FL: "Flevoland",
  LB: "Limburg",
  ZE: "Zeeland",
};

const NL_CITIES = cityRows(
  `
Amsterdam|large|NH|3|Noord,Osdorp,Slotervaart,Buitenveldert,Watergraafsmeer,Oost,Zuidoost
Rotterdam|large|ZH|3|Kralingen,Charlois,Delfshaven,Crooswijk,Hillegersberg,Overschie,IJsselmonde
Den Haag|large|ZH|2|Scheveningen,Laak,Loosduinen,Escamp,Ypenburg
Utrecht|large|UT|2|Zuilen,Overvecht,Leidsche Rijn,Lunetten
Eindhoven|medium|NB|2|Woensel,Strijp,Gestel,Stratum
Groningen|medium|GR|1
Tilburg|medium|NB|1
Almere|medium|FL|1
Breda|medium|NB|1
Nijmegen|medium|GE|1
Apeldoorn|medium|GE|1
Haarlem|medium|NH|1
Arnhem|medium|GE|1
Enschede|medium|OV|1
Amersfoort|medium|UT|1
Zwolle|medium|OV|1
's-Hertogenbosch|medium|NB|1
Leiden|medium|ZH|1
Maastricht|medium|LB|1
Dordrecht|medium|ZH|1
Zoetermeer|medium|ZH|1
Zaandam|small|NH|1
Alkmaar|small|NH|1
Deventer|small|OV|1
Delft|small|ZH|1
Venlo|small|LB|1
Leeuwarden|small|FR|1
Emmen|small|DR|1
Sittard|small|LB|1
Helmond|small|NB|1
Oss|small|NB|1
Hengelo|small|OV|1
Hoorn|small|NH|1
Gouda|small|ZH|1
Roosendaal|small|NB|1
Bergen op Zoom|small|NB|1
Middelburg|small|ZE|1
Vlissingen|small|ZE|1
Assen|small|DR|1
Lelystad|small|FL|1
Ede|small|GE|1
Heerlen|small|LB|1
Hilversum|small|NH|1
Schiedam|small|ZH|1
Heerenveen|town|FR|1
Kerkrade|town|LB|1
Waalwijk|town|NB|1
Velsen|town|NH|1
Volendam|town|NH|1
Doetinchem|town|GE|1
Almelo|town|OV|1
Katwijk|town|ZH|1
Veendam|town|GR|1
Harderwijk|town|GE|1
Uden|town|NB|1
Kampen|town|OV|1
`,
  NL_REGIONS,
);

const NETHERLANDS: NationSpec = {
  code: "NL",
  iso2: "NL",
  name: "Netherlands",
  confederation: "UEFA",
  continent: "EU",
  capital: "Amsterdam",
  latitude: 52.1,
  languages: [{ code: "nl", weight: 1 }],
  reputation: { national: 86, league: 79 },
  euEea: true,
  physique: { height: 184 },
  names: { given: sources("dutch=0.65 faker:nl=0.35"), family: sources("dutch=0.65 faker:nl=0.35") },
  nationality: {
    multipleRate: 0.33,
    tripleRate: 0.06,
    bornAbroadRate: 0.05,
    diasporaPull: 0.45,
    links: [
      ...links("dutchDiaspora", "SR:10 CW:4 AW:1.2 ID:2.5"),
      ...links("germanRecruitment", "MA:10 TR:6 ES:0.8 IT:0.6 PT:0.6"),
      ...links("crossBorder", "BE:3 DE:2.5 PL:1.5 FR:0.8 EN:0.6"),
      ...links("lusophone", "CV:2 AO:0.6"),
      ...links("regional", "GH:2 NG:1.5 CD:0.6 SO:0.4 ER:0.3"),
      ...links("yugoslav", "BA:1 RS:0.6 HR:0.6 XK:0.6"),
      ...links("arabWorld", "IQ:0.6 SY:0.6 EG:0.4"),
      ...links("asianDiaspora", "AF:0.5 CN:0.4 VN:0.3"),
      ...links("americas", "US:0.6 BR:0.6 DO:0.4"),
    ],
    // Dual nationality from birth and the option procedure need no renunciation.
    citizenship: { dual: "allowed" },
  },
  cities: { major: NL_CITIES },
  football: {
    leagues: [
      {
        tier: 1,
        name: "Eredivisie",
        shortName: "Eredivisie",
        size: 18,
        status: "professional",
        reputation: 79,
        clubs: {
          reputation: span(76, 57),
          giants: { count: 3, top: 86, bottom: 79 },
          capacity: span(55_000, 4_500),
          facilities: span(88, 58),
          academy: span(92, 62),
          wageBill: span(80_000_000, 4_500_000),
          transferBudget: span(30_000_000, 250_000),
          foreignShare: 0.45,
          squadSize: [25, 30],
        },
      },
      {
        tier: 2,
        name: "Eerste Divisie",
        shortName: "Eerste Divisie",
        size: 20,
        status: "professional",
        reputation: 56,
        bTeams: 4,
        clubs: {
          reputation: span(58, 40),
          capacity: span(26_000, 2_500),
          facilities: span(64, 38),
          academy: span(70, 42),
          wageBill: span(9_000_000, 1_200_000),
          transferBudget: span(600_000, 10_000),
          foreignShare: 0.25,
          squadSize: [25, 30],
        },
      },
    ],
    movement: [
      {
        upper: 1,
        promoted: 2,
        relegated: 2,
        playoffs: [{ type: "cross-tier", upperPositions: [16], lowerPositions: [3, 4, 5, 6, 7, 8], legs: 2 }],
      },
    ],
    cups: [
      { kind: "national", name: "KNVB Beker", legs: 1, neutralFinal: true, continental: true },
      { kind: "super", name: "Johan Cruijff Schaal", participants: ["champion", "cup-winner"], legs: 1, start: "08-03" },
    ],
    youth: {
      U19: { divisions: [division("O19 Eredivisie", [1, 1], 9, "Poule A|Poule B"), division("O19 Divisie 1", [2, 2], 16)] },
      U17: { divisions: [division("O17 Eredivisie", [1, 1], 9, "Poule A|Poule B"), division("O17 Divisie 1", [2, 2], 16)] },
    },
    reserves: {
      mode: "pyramid",
      nameTemplate: "Jong {club}",
      eligibility: { parentTiers: [1], minReputation: 72, maxTeams: 4 },
      pyramid: { highestTier: 2, minGapBelowParent: 1, maxPerTier: 4 },
      ageRule: { maxAge: 21, overage: 3 },
      squad: [22, 28],
    },
    clubNaming: {
      templates: templates(`
FC {city}|10
SC {city}|5
SV {city}|3
VV {city}|3|2
{city} City FC|1
Sparta {city}|1.2
Fortuna {city}|1
Excelsior {city}|1
Quick {city}|0.8
Be Quick {city}|0.5
Go Ahead {city}|0.4
VV {city} '{founded2}|0.8|2
`),
      regional: [
        { regions: ["Noord-Brabant", "Limburg"], templates: templates("FC {city}|6\nRKSV {city}|1.5\nRKC {city}|0.8\nFortuna {city}|1") },
        { regions: ["Friesland"], templates: templates("sc {city}|3\nFC {city}|4\nVV {city}|2") },
        { regions: ["Groningen", "Drenthe"], templates: templates("FC {city}|5\nSC {city}|2\nVV {city}|2") },
      ],
      founded: { top: [1888, 1954], bottom: [1898, 2001] },
      shortName: "city",
      avoid: list(
        "AFC Ajax|Ajax|PSV|PSV Eindhoven|Feyenoord|AZ|AZ Alkmaar|FC Twente|FC Utrecht|FC Groningen|SC Heerenveen|NEC|NEC Nijmegen|Vitesse|Go Ahead Eagles|Sparta Rotterdam|Excelsior|Excelsior Rotterdam|Heracles Almelo|PEC Zwolle|FC Zwolle|Fortuna Sittard|NAC Breda|Willem II|RKC Waalwijk|Almere City FC|Almere City|Telstar|SC Telstar|FC Volendam|SC Cambuur|Cambuur|ADO Den Haag|De Graafschap|Roda JC|Roda JC Kerkrade|VVV-Venlo|MVV Maastricht|MVV|FC Den Bosch|FC Dordrecht|FC Eindhoven|FC Emmen|TOP Oss|FC Oss|Helmond Sport|HFC Haarlem|RBC Roosendaal|AGOVV|FC Omniworld|SC Veendam|BV Veendam|Quick Boys|VV Katwijk|Rijnsburgse Boys|SV Spakenburg|IJsselmeervogels|Kozakken Boys|GVVV|HHC Hardenberg|SVV Scheveningen|De Treffers|Excelsior Maassluis|Achilles '29|Be Quick 1887|Quick '20|VV Noordwijk|ASWH|FC Lisse|Sparta Nijkerk|Jong Ajax|Jong PSV|Jong AZ|Jong FC Utrecht|FC Wageningen|Fortuna '54|Blauw-Wit Amsterdam|DWS|FC Amsterdam|Holland Sport|Xerxes|DHC Delft|Hermes DVS|Stormvogels Telstar|SC Genemuiden|VV DOVO|HVV|HBS|VUC|Sportclub Enschede|FC Den Haag",
      ),
      colors: ["#D2122E", "#FFFFFF", "#ED1C24", "#000000", "#FF6600", "#003DA5", "#E30613", "#FFD700", "#006400", "#1E3A8A", "#8B0000", "#F7A600"],
    },
    importSources: codes(
      "BE:8 DE:5 DK:4 NO:4 SE:4 JP:3 US:3 MA:3 GH:2.5 NG:2.5 BR:2.5 CI:2 SN:2 CW:2 SR:1.5 ES:2 PT:1.5 FR:2 IT:1 EN:1.5 IE:1.5 SCO:1 IS:1.5 FI:1.5 PL:2 CZ:1.5 SK:1 HR:1.5 RS:1.5 GR:1.5 TR:1.5 CH:1 AT:1 MX:1 AR:1 UY:0.8 CO:0.8 KR:1 AU:1 CA:1 ID:1 CV:1 GN:0.8 CM:1 ML:0.8 BF:0.6",
    ),
    coefficients: { association: [9.2, 19.2, 13.5, 10.0, 15.25], season2025: 9.979 },
  },
};

// ------------------------------------------------------------ Liechtenstein

const LIECHTENSTEINER = pool(
  "liechtenstein",
  "Noah|Leon|Luca|Elias|Jonas|Nico|Fabio|Marco|Sandro|Simon|David|Daniel|Lukas|Andreas|Martin|Thomas|Michael|Patrick|Peter|Matthias|Philipp|Florian|Benjamin|Dominik|Raphael|Samuel|Livio|Aron|Yanick|Nicolas|Mario|Franz|Josef|Manuel|Kevin|Pascal|Marcel|Robin|Ramon|Timo|Julian|Fabian|Janik|Severin|Remo|Mathias|Tobias|Jan|Niklas|Maximilian|Felix|Emil|Liam|Mattia|Gian|Alexander|Christoph|Sebastian|Jens|Aaron",
  "Büchel|Frick|Marxer|Wohlwend|Beck|Hasler|Kind|Ospelt|Batliner|Vogt|Kaiser|Meier|Oehri|Schädler|Sprenger|Negele|Nägele|Kranz|Matt|Eberle|Gassner|Risch|Wolfinger|Heeb|Hilti|Walser|Wille|Brunhart|Quaderer|Bühler|Konrad|Ritter|Jehle|Kieber|Näscher|Biedermann|Frommelt|Lampert|Senti|Schurte|Zech|Gstöhl|Kaufmann|Nigg|Rheinberger|Sele|Wanger|Hoop|Foser|Bargetze|Hemmerle|Hanselmann|Göppel|Malin|Brändle|Hofer|Allgäuer|Hermann|Tschirky",
);

const LIECHTENSTEIN: NationSpec = {
  code: "LI",
  iso2: "LI",
  name: "Liechtenstein",
  confederation: "UEFA",
  continent: "EU",
  capital: "Vaduz",
  latitude: 47.1,
  languages: [{ code: "de", weight: 1 }],
  reputation: { national: 13, league: 20 },
  euEea: true,
  physique: { height: 180 },
  names: {
    given: sources("liechtenstein=0.6 faker:de_CH=0.25 faker:de_AT=0.15"),
    family: sources("liechtenstein=0.6 faker:de_CH=0.25 faker:de_AT=0.15"),
  },
  nationality: {
    multipleRate: 0.25,
    tripleRate: 0.04,
    bornAbroadRate: 0.2,
    diasporaPull: 0.25,
    links: [
      ...links("crossBorder", "CH:10 AT:8 DE:4 IT:2"),
      ...links("germanRecruitment", "PT:1.5 TR:1.5 ES:0.8"),
      ...links("yugoslav", "XK:1 HR:0.8 BA:0.8 RS:0.6 MK:0.4"),
    ],
    // Naturalisation requires giving up the previous citizenship.
    citizenship: { dual: "restricted" },
  },
  cities: {
    major: cityRows(`
Vaduz|small|Oberland|1
Schaan|small|Oberland|1
Triesen|town|Oberland|1
Balzers|town|Oberland|1
Triesenberg|town|Oberland|1
Eschen|town|Unterland|1
Mauren|town|Unterland|1
Ruggell|town|Unterland|1
Gamprin|town|Unterland|1
Schellenberg|town|Unterland|1
Planken|town|Oberland|1
`),
  },
  football: {
    leagues: [],
    movement: [],
    // A single modelled club wins by walkover and takes the Conference League place.
    cups: [{ kind: "national", name: "Liechtensteiner Cup", legs: 1, continental: true }],
    youth: { U19: { divisions: [] }, U17: { divisions: [] } },
    reserves: { mode: "none" },
    clubNaming: {
      templates: templates(`
FC {city}|6
USV {city}|2
SC {city}|1.5
FC {city} {founded2}|1.5
SV {city}|1
`),
      founded: { top: [1925, 1946], bottom: [1930, 1975] },
      shortName: "city",
      avoid: list("FC Vaduz|USV Eschen/Mauren|FC Balzers|FC Schaan|FC Triesen|FC Triesenberg|FC Ruggell"),
      colors: ["#E30613", "#FFFFFF", "#002B7F", "#FFD100"],
    },
    importSources: codes("CH:10 AT:6 DE:5 IT:2.5 PT:2 XK:1.5 AL:1.5 HR:1.5 RS:1 BA:1 ES:1 FR:1 TR:1 BR:1 SI:0.5"),
    // Vaduz is the only entrant, so association points equal its results.
    coefficients: { association: [0.5, 0, 6.5, 0.5, 0.5], season2025: 1.0 },
  },
  hostedAbroad: [
    // FC Vaduz won the 2025/26 Challenge League and plays the 2026/27 Super League.
    { host: "CH", tiers: [1], cities: ["Vaduz"], cups: "home", continental: "home", youth: "host", registration: "host" },
  ],
  homePool: { seniors: 60, youth: 45 },
  abroad: { seniors: 12, youth: 8, destinations: codes("CH:10 AT:6 DE:2 IT:0.5") },
};

// -------------------------------------------------------------- Switzerland

const CH_REGIONS: Record<string, string> = {
  ZH: "Zürich",
  BE: "Bern",
  LU: "Luzern",
  SZ: "Schwyz",
  ZG: "Zug",
  FR: "Fribourg",
  SO: "Solothurn",
  BS: "Basel-Stadt",
  SH: "Schaffhausen",
  SG: "St. Gallen",
  GR: "Graubünden",
  AG: "Aargau",
  TG: "Thurgau",
  TI: "Ticino",
  VD: "Vaud",
  VS: "Valais",
  NE: "Neuchâtel",
  GE: "Genève",
  JU: "Jura",
};

// Modern Swiss-German names; faker's de_CH given names skew to older generations.
const SWISS = pool(
  "swiss",
  "Luca|Noah|Nico|Fabian|Silvan|Remo|Dario|Janis|Levin|Joel|Yannick|Loris|Gian|Andri|Linus|Nils|Timo|Fabio|Ramon|Pascal|Sven|Mauro|Lukas|Jonas|Samuel|Elias|Simon|Flavio|Nicola|Andrin|Severin|Cyrill|Dominic|Mischa|Livio|Leandro|Alessandro|Kilian|Lars|Marco|Michel|Raphael|Robin|Sandro|Roman|Manuel|Kevin|Yanick|Cédric|Mattia|Gianluca|Marvin|Jan|Silvio|Tobias|Adrian|Basil|Benjamin|Dominik|Philipp|Patrick|Florian|Gion|Sascha|Renato|Nando|Colin|Reto|Stefan|Michael",
  "Müller|Meier|Schmid|Keller|Weber|Huber|Schneider|Meyer|Steiner|Fischer|Gerber|Brunner|Baumann|Frei|Zimmermann|Moser|Widmer|Wyss|Graf|Roth|Kälin|Bachmann|Suter|Lüthi|Zürcher|Zbinden|Frey|Studer|Aebischer|Stocker|Ammann|Egli|Hofer|Imhof|Kuhn|Marti|Sutter|Tanner|Vogel|Wenger|Wüthrich|Zaugg|Hess|Kunz|Lehmann|Schär|Sommer|Bühler|Hürlimann|Rüegg|Schürch|Kaufmann|Zahnd|Fässler|Gisler|Odermatt|Christen|Aregger|Bürki|Brügger|Zuber|Burkhalter|Schwegler|Hunziker|Gasser|Siegrist|Stalder|Leuenberger|Rohner|Nussbaumer|Rüfenacht|Schönenberger|Hediger|Schläpfer|Knüsel|Kobel|Ruch|Iseli|Käser|Rindlisbacher|Aeschlimann|Oberholzer|Bärtschi|Zehnder|Grüter|Jäggi|Sieber|Mathys|Rothenbühler|Wittwer",
);

const SWITZERLAND: NationSpec = {
  code: "CH",
  iso2: "CH",
  name: "Switzerland",
  confederation: "UEFA",
  continent: "EU",
  capital: "Bern",
  latitude: 46.8,
  languages: [
    { code: "de", weight: 0.62 },
    { code: "fr", weight: 0.26 },
    { code: "it", weight: 0.12 },
  ],
  reputation: { national: 80, league: 63 },
  euEea: false,
  physique: { height: 180 },
  names: {
    given: sources("swiss=0.3 faker:de_CH=0.32 faker:fr_CH=0.26 faker:it=0.12"),
    family: sources("swiss=0.3 faker:de_CH=0.32 faker:fr_CH=0.26 faker:it=0.12"),
    // Language regions by canton of birth; Fribourg and Valais are bilingual with French majorities.
    regional: [
      {
        regions: ["Zürich", "Bern", "Luzern", "Schwyz", "Zug", "Solothurn", "Basel-Stadt", "Schaffhausen", "St. Gallen", "Graubünden", "Aargau", "Thurgau"],
        given: sources("swiss=0.46 faker:de_CH=0.44 faker:it=0.06 faker:fr_CH=0.04"),
        family: sources("swiss=0.46 faker:de_CH=0.44 faker:it=0.06 faker:fr_CH=0.04"),
      },
      {
        regions: ["Genève", "Vaud", "Neuchâtel", "Jura"],
        given: sources("faker:fr_CH=0.86 faker:it=0.06 swiss=0.04 faker:de_CH=0.04"),
        family: sources("faker:fr_CH=0.86 faker:it=0.06 swiss=0.04 faker:de_CH=0.04"),
      },
      {
        regions: ["Fribourg", "Valais"],
        given: sources("faker:fr_CH=0.7 swiss=0.12 faker:de_CH=0.12 faker:it=0.06"),
        family: sources("faker:fr_CH=0.7 swiss=0.12 faker:de_CH=0.12 faker:it=0.06"),
      },
      {
        regions: ["Ticino"],
        given: sources("faker:it=0.86 swiss=0.07 faker:de_CH=0.07"),
        family: sources("faker:it=0.86 swiss=0.07 faker:de_CH=0.07"),
      },
    ],
  },
  nationality: {
    multipleRate: 0.35,
    tripleRate: 0.07,
    bornAbroadRate: 0.05,
    diasporaPull: 0.5,
    links: [
      ...links("germanRecruitment", "IT:7 PT:7 ES:3 TR:3"),
      ...links("yugoslav", "XK:8 MK:4 RS:4 HR:3 BA:3 ME:0.8"),
      ...links("crossBorder", "DE:6 FR:5 AT:1.5 LI:0.3"),
      ...links("mediterranean", "AL:3 TN:0.6 MA:0.6 GR:0.4"),
      ...links("frenchAfrica", "CM:1.5 CD:1.5 CI:1 SN:1 GN:0.6"),
      ...links("lusophone", "CV:1 AO:1 BR:1"),
      ...links("regional", "ER:0.8 NG:0.6 GH:0.6 SO:0.4"),
      ...links("asianDiaspora", "LK:0.5"),
      ...links("arabWorld", "SY:0.4 IQ:0.3"),
    ],
    citizenship: { dual: "allowed" },
  },
  cities: {
    major: cityRows(
      `
Zürich|large|ZH|3|Altstetten,Oerlikon,Wiedikon,Höngg,Seebach,Wollishofen,Schwamendingen,Aussersihl
Genève|large|GE|2|Servette,Plainpalais,Eaux-Vives,Champel,Pâquis,Petit-Saconnex
Basel|large|BS|2|Kleinbasel,St. Johann,Gundeldingen,Breite,Kleinhüningen
Lausanne|medium|VD|2|Ouchy,Malley,Pontaise,Sallaz
Bern|medium|BE|2|Bümpliz,Breitenrain,Wankdorf,Länggasse,Bethlehem
Winterthur|medium|ZH|1
Luzern|medium|LU|1
St. Gallen|medium|SG|1
Lugano|medium|TI|1
Biel/Bienne|medium|BE|1
Thun|small|BE|1
Köniz|small|BE|1
La Chaux-de-Fonds|small|NE|1
Fribourg|small|FR|1
Schaffhausen|small|SH|1
Chur|small|GR|1
Vernier|small|GE|1
Uster|small|ZH|1
Sion|small|VS|1
Neuchâtel|small|NE|1
Lancy|small|GE|1
Yverdon-les-Bains|small|VD|1
Zug|small|ZG|1
Emmen|small|LU|1
Kriens|small|LU|1
Rapperswil-Jona|small|SG|1
Frauenfeld|small|TG|1
Bellinzona|small|TI|1
Aarau|small|AG|1
Wil|town|SG|1
Baden|town|AG|1
Wettingen|town|AG|1
Locarno|town|TI|1
Chiasso|town|TI|1
Mendrisio|town|TI|1
Carouge|town|GE|1
Nyon|town|VD|1
Montreux|town|VD|1
Bulle|town|FR|1
Solothurn|town|SO|1
Grenchen|town|SO|1
Delémont|town|JU|1
Martigny|town|VS|1
Monthey|town|VS|1
Kreuzlingen|town|TG|1
Baar|town|ZG|1
Schwyz|town|SZ|1
Wohlen|town|AG|1
`,
      CH_REGIONS,
    ),
  },
  football: {
    leagues: [
      {
        tier: 1,
        name: "Super League",
        shortName: "Super League",
        size: 12,
        status: "professional",
        reputation: 63,
        roundRobins: 3,
        split: {
          groups: [
            { name: "Championship Group", positions: [1, 6], roundRobins: 1, points: "full" },
            { name: "Relegation Group", positions: [7, 12], roundRobins: 1, points: "full" },
          ],
        },
        clubs: {
          reputation: span(66, 52),
          giants: { count: 2, top: 74, bottom: 68 },
          capacity: span(38_000, 6_000),
          facilities: span(82, 55),
          academy: span(88, 60),
          wageBill: span(38_000_000, 6_000_000),
          transferBudget: span(10_000_000, 150_000),
          foreignShare: 0.4,
          squadSize: [25, 30],
        },
      },
      {
        tier: 2,
        name: "Challenge League",
        shortName: "Challenge League",
        size: 10,
        status: "professional",
        reputation: 49,
        roundRobins: 4,
        clubs: {
          reputation: span(51, 38),
          capacity: span(12_000, 1_500),
          facilities: span(55, 32),
          academy: span(62, 35),
          wageBill: span(4_500_000, 1_000_000),
          transferBudget: span(250_000, 5_000),
          foreignShare: 0.3,
          squadSize: [25, 30],
        },
      },
    ],
    movement: [
      {
        upper: 1,
        promoted: 1,
        relegated: 1,
        playoffs: [{ type: "cross-tier", upperPositions: [11], lowerPositions: [2], legs: 2 }],
      },
    ],
    cups: [{ kind: "national", name: "Swiss Cup", legs: 1, neutralFinal: true, continental: true }],
    youth: {
      U19: { divisions: [division("U-18 Elite", [1, 2], 11, "Gruppe 1|Gruppe 2")] },
      U17: { divisions: [division("U-16 Elite", [1, 2], 11, "Gruppe 1|Gruppe 2")] },
    },
    // U-21 sides play in the Promotion League, below the modelled tiers.
    reserves: { mode: "none" },
    clubNaming: {
      templates: templates(`
FC {city}|10
SC {city}|2
BSC {city}|0.6
SV {city}|0.6
FC Concordia {city}|0.4
FC Blue Stars {city}|0.3
FC Red Star {city}|0.3
`),
      regional: [
        {
          regions: ["Genève", "Vaud", "Neuchâtel", "Jura", "Fribourg", "Valais"],
          templates: templates(`
FC {city}|6
{city}-Sport FC|2
FC {city}-Sport|1.5
Étoile {city}|1
Stade {city}|1
US {city}|1
CS {city}|0.8
`),
        },
        { regions: ["Ticino"], templates: templates("FC {city}|5\nAC {city}|3\nAS {city}|1\nUS {city}|1") },
      ],
      founded: { top: [1879, 1933], bottom: [1890, 2000] },
      shortName: "city",
      avoid: list(
        "FC Basel|FC Basel 1893|BSC Young Boys|Young Boys|FC Zürich|Grasshopper Club Zürich|Grasshoppers|Servette FC|Servette|FC Lugano|FC Luzern|FC St. Gallen|FC St. Gallen 1879|FC Sion|FC Lausanne-Sport|Lausanne-Sport|FC Winterthur|FC Thun|FC Aarau|FC Wil|FC Wil 1900|AC Bellinzona|Étoile Carouge FC|Étoile Carouge|Neuchâtel Xamax|Neuchâtel Xamax FCS|FC Rapperswil-Jona|FC Stade Lausanne-Ouchy|Stade Lausanne-Ouchy|FC Stade Nyonnais|Stade Nyonnais|Yverdon-Sport FC|Yverdon Sport|FC Schaffhausen|FC Chiasso|FC Vaduz|SC Kriens|FC Kriens|FC Baden|FC Wohlen|FC Biel-Bienne|FC Biel|FC La Chaux-de-Fonds|FC Locarno|FC Grenchen|FC Solothurn|FC Wettingen|FC Chur|FC Chur 97|SC Brühl|FC Köniz|FC Bulle|FC Monthey|FC Martigny-Sports|SC Cham|FC Breitenrain|FC Münsingen|FC Tuggen|FC Red Star Zürich|FC Blue Stars Zürich|SC YF Juventus|Young Fellows Juventus|BSC Old Boys|FC Concordia Basel|FC Nordstern Basel|FC Zug 94|FC Fribourg|FC Mendrisio|SR Delémont|FC Delémont|FC Uster|FC Kreuzlingen|FC Frauenfeld|FC Bern|FC Thun Berner Oberland|US Montreux|Montreux-Sports|FC Montreux-Sports|Lancy FC|FC Vernier|CS Chênois|Urania Genève Sport|FC Emmenbrücke|FC Baar|FC Schwyz",
      ),
      colors: ["#E30613", "#FFFFFF", "#FFD700", "#000000", "#003DA5", "#1E90FF", "#8B0000", "#006400", "#7B1E3B", "#F58220"],
    },
    importSources: codes(
      "FR:6 DE:4 IT:3 PT:3 ES:2 AT:2 XK:2 AL:2 RS:1.5 HR:1.5 BA:1 MK:1 CM:1.5 SN:1.5 CI:1.5 GN:1 ML:1 NG:1 GH:1 CD:1 BR:2 AR:1 CO:1 JP:1 KR:0.8 DK:1 SE:1 NO:0.8 BE:1 NL:1 CZ:0.8 HU:0.6 SI:0.6 GR:0.6 TR:1 MA:1 DZ:0.8 TN:0.6 US:1 CA:0.6 EN:0.6 IE:0.4 LI:0.5",
    ),
    coefficients: { association: [5.125, 7.75, 8.5, 5.2, 7.05], season2025: 6.2 },
  },
};

// ------------------------------------------------------------------ Austria

const AT_REGIONS: Record<string, string> = {
  W: "Wien",
  NO: "Niederösterreich",
  OO: "Oberösterreich",
  ST: "Steiermark",
  T: "Tirol",
  K: "Kärnten",
  S: "Salzburg",
  V: "Vorarlberg",
  B: "Burgenland",
};
// "Grazer AK", "Kapfenberger SV", "Wiener Sport-Club".
const AT_DEMONYMS: Record<string, string> = {
  Wien: "Wiener",
  Graz: "Grazer",
  Linz: "Linzer",
  Salzburg: "Salzburger",
  Innsbruck: "Innsbrucker",
  Klagenfurt: "Klagenfurter",
  Villach: "Villacher",
  Wels: "Welser",
  "St. Pölten": "St. Pöltner",
  Dornbirn: "Dornbirner",
  Steyr: "Steyrer",
  Bregenz: "Bregenzer",
  Feldkirch: "Feldkircher",
  Kapfenberg: "Kapfenberger",
  Leoben: "Leobener",
  Wolfsberg: "Wolfsberger",
  Lustenau: "Lustenauer",
  Kufstein: "Kufsteiner",
};

// faker's de_AT reuses the German lists; this pool carries Austrian usage.
const AUSTRIAN = pool(
  "austrian",
  "Lukas|Tobias|David|Florian|Simon|Jakob|Maximilian|Fabian|Julian|Sebastian|Elias|Felix|Leon|Paul|Jonas|Moritz|Raphael|Alexander|Matthias|Stefan|Michael|Dominik|Philipp|Christoph|Manuel|Andreas|Markus|Martin|Thomas|Daniel|Patrick|Marcel|Kevin|Marco|Konrad|Valentin|Nico|Luca|Noah|Benjamin|Samuel|Jan|Niklas|Johannes|Clemens|Lorenz|Christian|Xaver|Ferdinand|Leopold|Anton|Emil|Oliver|Adrian|Kilian|Mario|Marko|Nikolas|Sandro|Roman|Leo|Theo|Jonathan|Timo|Dario|Gernot|Hannes|Severin|Bernhard|Georg",
  "Gruber|Huber|Bauer|Wagner|Müller|Pichler|Steiner|Moser|Mayer|Hofer|Leitner|Berger|Fuchs|Eder|Fischer|Schmid|Winkler|Weber|Schwarz|Maier|Schneider|Reiter|Mayr|Schmidt|Wimmer|Egger|Brunner|Lang|Baumgartner|Auer|Binder|Lechner|Wolf|Wallner|Aigner|Ebner|Koller|Lehner|Haas|Schuster|Holzer|Wieser|Strasser|Hofmann|Kaiser|Hackl|Unger|Pölzl|Kogler|Haider|Brandstätter|Riegler|Grabner|Lindner|Pirker|Url|Hödl|Riedl|Steinbauer|Haslinger|Mühlbacher|Kerschbaumer|Rainer|Fellner|Wurzer|Eichinger|Hauser|Zauner|Wiesinger|Langer|Hochreiter|Reisinger|Prinz|Buchegger|Pfeifer|Födinger|Gratzer|Horvath|Novak|Nemeth|Tomasek|Pavlik|Swoboda|Dvorak|Wurm|Hartl|Ortner|Zach|Rauch|Hager|Pfeiffer|Kofler|Unterberger|Gschwandtner|Obermair|Ziegler",
);

const AUSTRIA: NationSpec = {
  code: "AT",
  iso2: "AT",
  name: "Austria",
  confederation: "UEFA",
  continent: "EU",
  capital: "Wien",
  latitude: 47.5,
  languages: [{ code: "de", weight: 1 }],
  reputation: { national: 78, league: 65 },
  euEea: true,
  physique: { height: 181 },
  names: { given: sources("austrian=0.55 faker:de_AT=0.45"), family: sources("austrian=0.55 faker:de_AT=0.45") },
  nationality: {
    multipleRate: 0.3,
    tripleRate: 0.05,
    bornAbroadRate: 0.06,
    diasporaPull: 0.35,
    links: [
      ...links("yugoslav", "BA:8 RS:8 HR:6 XK:2 MK:1.5 SI:1 ME:0.6"),
      ...links("germanRecruitment", "TR:9"),
      ...links("crossBorder", "DE:8 HU:3 RO:2.5 CZ:2 SK:2 PL:1.5 IT:1.5 CH:1 BG:0.8"),
      ...links("postSoviet", "RU:0.8 UA:0.8 GE:0.5"),
      ...links("regional", "NG:1.2 GH:0.8 CM:0.6 EG:0.5"),
      ...links("arabWorld", "SY:1 IQ:0.6"),
      ...links("asianDiaspora", "AF:1 IR:0.5 PH:0.4"),
    ],
    // Naturalisation requires renunciation; dual citizenship only from birth or by permit.
    citizenship: { dual: "restricted" },
  },
  cities: {
    major: cityRows(
      `
Wien|large|W|3|Hütteldorf,Favoriten,Floridsdorf,Hernals,Döbling,Simmering,Ottakring,Donaustadt,Meidling,Leopoldstadt
Graz|medium|ST|2|Liebenau,Gösting,Andritz,Eggenberg,Puntigam
Linz|medium|OO|2|Urfahr,Ebelsberg,Kleinmünchen,Pichling
Salzburg|medium|S|2|Maxglan,Lehen,Liefering,Gnigl
Innsbruck|medium|T|1
Klagenfurt|medium|K|1
Villach|small|K|1
Wels|small|OO|1
St. Pölten|small|NO|1
Dornbirn|small|V|1
Wiener Neustadt|small|NO|1
Steyr|small|OO|1
Feldkirch|small|V|1
Bregenz|small|V|1
Leoben|town|ST|1
Kapfenberg|town|ST|1
Wolfsberg|town|K|1
Hartberg|town|ST|1
Altach|town|V|1
Lustenau|town|V|1
Ried im Innkreis|town|OO|1
Mödling|town|NO|1
Wattens|town|T|1
Mattersburg|town|B|1
Amstetten|town|NO|1
Horn|town|NO|1
Leonding|town|OO|1
Traun|town|OO|1
Baden|town|NO|1
Krems an der Donau|town|NO|1
Bruck an der Mur|town|ST|1
Lienz|town|T|1
Hohenems|town|V|1
Pasching|town|OO|1
Grödig|town|S|1
Kufstein|town|T|1
Spittal an der Drau|town|K|1
Eisenstadt|town|B|1
Gleisdorf|town|ST|1
Schwaz|town|T|1
`,
      AT_REGIONS,
    ).map((city) => (AT_DEMONYMS[city.name] ? { ...city, demonym: AT_DEMONYMS[city.name] } : city)),
  },
  football: {
    leagues: [
      {
        tier: 1,
        name: "Bundesliga",
        shortName: "Bundesliga",
        size: 12,
        status: "professional",
        reputation: 65,
        roundRobins: 2,
        // From 2026/27 the regular-season points carry over in full (halved 2018/19–2025/26).
        split: {
          groups: [
            { name: "Meistergruppe", positions: [1, 6], roundRobins: 2, points: "full" },
            { name: "Qualifikationsgruppe", positions: [7, 12], roundRobins: 2, points: "full" },
          ],
        },
        clubs: {
          reputation: span(66, 50),
          giants: { count: 2, top: 78, bottom: 70 },
          capacity: span(30_000, 5_000),
          facilities: span(85, 55),
          academy: span(90, 58),
          wageBill: span(55_000_000, 4_000_000),
          transferBudget: span(20_000_000, 100_000),
          foreignShare: 0.4,
          squadSize: [25, 30],
        },
      },
    ],
    movement: [],
    cups: [{ kind: "national", name: "ÖFB-Cup", legs: 1, neutralFinal: true, continental: true }],
    youth: {
      U19: { divisions: [division("ÖFB-Jugendliga U18", [1, 1], 12)] },
      U17: { divisions: [division("ÖFB-Jugendliga U16", [1, 1], 12)] },
    },
    // Second teams play in the 2. Liga and the Regionalligen, which are not modelled.
    reserves: { mode: "none" },
    clubNaming: {
      templates: templates(`
SV {city}|8
SK {city}|6
FC {city}|6
SC {city}|5
Union {city}|2
FK {city}|1.5
ASK {city}|1.5
TSV {city}|1.5
Austria {city}|1.2
Wacker {city}|1
ATSV {city}|0.8
Blau-Weiß {city}|0.8
USV {city}|0.6
Admira {city}|0.6
{demonym} SV|2
{demonym} SC|1.5
{demonym} AK|1
{demonym} AC|1
`),
      founded: { top: [1894, 1953], bottom: [1905, 2012] },
      shortName: "city",
      avoid: list(
        "FC Red Bull Salzburg|Red Bull Salzburg|SK Rapid Wien|Rapid Wien|FK Austria Wien|Austria Wien|SK Sturm Graz|Sturm Graz|LASK|Linzer ASK|Grazer AK|GAK|SK Austria Klagenfurt|Austria Klagenfurt|SV Ried|SV Josko Ried|WSG Tirol|WSG Wattens|TSV Hartberg|SCR Altach|SC Rheindorf Altach|Wolfsberger AC|FC Blau-Weiß Linz|Blau-Weiß Linz|FC Admira Wacker|FC Admira Wacker Mödling|Admira Wacker|SKN St. Pölten|FC Wacker Innsbruck|Wacker Innsbruck|SC Austria Lustenau|Austria Lustenau|FC Lustenau|FC Dornbirn|FC Dornbirn 1913|SV Mattersburg|SC Wiener Neustadt|First Vienna FC|Wiener Sport-Club|Wiener Sportclub|Floridsdorfer AC|SV Horn|SKU Amstetten|FC Liefering|Kapfenberger SV|DSV Leoben|SV Lafnitz|FC Juniors OÖ|SV Stripfing|SK Vorwärts Steyr|Vorwärts Steyr|SV Grödig|FC Pasching|ASKÖ Pasching|SC Bregenz|SW Bregenz|FC Hard|Villacher SV|SV Spittal|SV Wörgl|FC Kufstein|SK Bischofshofen|Union Gurten|SV Leobendorf|SC Neusiedl|SV Austria Salzburg|Austria Salzburg|FC Hertha Wels|WSC Hertha Wels|Welser SC|ASK Voitsberg|SC Weiz|FC Gleisdorf|SC Schwaz|FC Kärnten|VSE St. Pölten|Innsbrucker AC|Linzer SK|Salzburger AK|Salzburger AK 1914|Klagenfurter AC|Wiener AC|Wiener AF|Wiener Neustädter SC|SV Wienerberg|SC Eisenstadt|Grazer SC|Leobener SV|Steyrer SK|SV Ried im Innkreis|Admira Mödling",
      ),
      colors: ["#ED1C24", "#FFFFFF", "#00913A", "#6B2C91", "#000000", "#E30613", "#0055A4", "#FFD700", "#8B0000", "#1D1D1B"],
    },
    importSources: codes(
      "DE:8 HR:4 BA:3 RS:3 SI:3 HU:3 CZ:2.5 SK:2.5 CH:2 IT:1.5 FR:1.5 ES:1.5 PT:1 NL:1 BE:1 DK:1.5 SE:1 NO:1 PL:1.5 RO:1 BG:0.6 GR:0.6 TR:2 XK:1.5 AL:1 MK:1 GE:1.5 UA:1.5 BR:2.5 AR:1 CO:1 JP:2 KR:1.5 US:1 CA:0.6 NG:2 GH:1.5 CI:1.5 ML:1.5 SN:1.5 CM:1 BF:1 GN:1 ZM:1 CD:0.8 MA:0.8 IL:0.8 IS:0.5 FI:0.5 AU:0.8 LI:0.3",
    ),
    coefficients: { association: [6.7, 10.4, 4.9, 4.8, 9.65], season2025: 4.1 },
  },
};

export const UEFA_CENTRAL: CatalogFileData = {
  file: "uefa-central",
  nations: [GERMANY, NETHERLANDS, LIECHTENSTEIN, SWITZERLAND, AUSTRIA, ...UEFA_CENTRAL_B.nations],
  namePools: [DUTCH, LIECHTENSTEINER, SWISS, AUSTRIAN, ...UEFA_CENTRAL_B.namePools],
  ...(UEFA_CENTRAL_B.realClubNames ? { realClubNames: { ...UEFA_CENTRAL_B.realClubNames } } : {}),
};
