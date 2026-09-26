import type {
  CatalogFileData,
  CitySize,
  CitySpec,
  ClubNameTemplate,
  DomesticFootballSpec,
  HeritageLink,
  MigrationContext,
  NamePool,
  NationSpec,
  Span,
  WeightedCode,
  WeightedNameSource,
  YouthDivisionSpec,
} from "./types.ts";

// Owner: catalog author "uefa-west B" — FR IT GR CY SM MT, merged into UEFA_WEST (uefa-west.ts).
// Real 2025/26 structures and names without sponsors; clubs are generated. Money is GBP.

const list = (names: string) =>
  names.split("|").map((name) => name.trim()).filter(Boolean);
const pool = (name: string, given: string, family: string): NamePool => ({
  id: `uefa-west/${name}`,
  ...(given.trim() ? { given: list(given) } : {}),
  ...(family.trim() ? { family: list(family) } : {}),
});
/** "greek=0.7 faker:it=0.3": bare names are pools of uefa-west. */
const sources = (spec: string): WeightedNameSource[] =>
  spec.trim().split(/\s+/).map((entry) => {
    const [name, weight] = entry.split("=");
    const source = (name.includes(":") ? name : `pool:uefa-west/${name}`) as WeightedNameSource["source"];
    return { source, weight: Number(weight) };
  });
/** "DZ:10 MA:9" */
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

// ------------------------------------------------------------------ France

const FR_REGIONS: Record<string, string> = {
  IDF: "Île-de-France",
  PACA: "Provence-Alpes-Côte d'Azur",
  ARA: "Auvergne-Rhône-Alpes",
  OCC: "Occitanie",
  NAQ: "Nouvelle-Aquitaine",
  HDF: "Hauts-de-France",
  GE: "Grand Est",
  PDL: "Pays de la Loire",
  BRE: "Bretagne",
  NOR: "Normandie",
  BFC: "Bourgogne-Franche-Comté",
  CVL: "Centre-Val de Loire",
  COR: "Corse",
};

const FR_CITIES = cityRows(
  `
Paris|mega|IDF|5|Belleville,Montmartre,Ménilmontant,Batignolles,Auteuil,Passy,Grenelle,Vaugirard,Bercy
Marseille|mega|PACA|3|Endoume,La Joliette,Sainte-Marthe,Saint-Henri,Mazargues,Saint-Barnabé
Lyon|large|ARA|3|Croix-Rousse,Gerland,Vaise,Monplaisir,Fourvière
Toulouse|large|OCC|2|Minimes,Saint-Cyprien,Rangueil,Purpan
Nice|large|PACA|2|Cimiez,Saint-Roch,Riquier
Nantes|large|PDL|2|Chantenay,Doulon,Malakoff
Montpellier|large|OCC|2|Celleneuve,Antigone
Strasbourg|large|GE|2|Neudorf,Koenigshoffen,Robertsau
Bordeaux|large|NAQ|2|Bastide,Caudéran,Chartrons
Lille|large|HDF|2|Fives,Wazemmes,Moulins
Rennes|large|BRE|2|Cleunay,Maurepas
Reims|medium|GE
Saint-Étienne|medium|ARA
Toulon|medium|PACA
Le Havre|medium|NOR
Grenoble|medium|ARA
Dijon|medium|BFC
Angers|medium|PDL
Nîmes|medium|OCC
Villeurbanne|medium|ARA
Clermont-Ferrand|medium|ARA
Le Mans|medium|PDL
Aix-en-Provence|medium|PACA
Brest|medium|BRE
Tours|medium|CVL
Amiens|medium|HDF
Limoges|medium|NAQ
Metz|medium|GE
Besançon|medium|BFC
Perpignan|medium|OCC
Orléans|medium|CVL
Rouen|medium|NOR
Caen|medium|NOR
Nancy|medium|GE
Mulhouse|medium|GE
Boulogne-Billancourt|medium|IDF
Saint-Denis|medium|IDF
Argenteuil|medium|IDF
Montreuil|medium|IDF
Versailles|small|IDF
Créteil|small|IDF
Nanterre|small|IDF
Poitiers|small|NAQ
Pau|small|NAQ
La Rochelle|small|NAQ
Annecy|small|ARA
Avignon|small|PACA
Béziers|small|OCC
Lorient|small|BRE
Valenciennes|small|HDF
Troyes|small|GE
Niort|small|NAQ
Bastia|small|COR
Ajaccio|small|COR
Laval|small|PDL
Auxerre|small|BFC
Châteauroux|small|CVL
Chambéry|small|ARA
Cholet|small|PDL
Quimper|small|BRE
Vannes|small|BRE
Saint-Brieuc|small|BRE
Dunkerque|small|HDF
Boulogne-sur-Mer|small|HDF
Calais|small|HDF
Beauvais|small|HDF
Colmar|small|GE
Montbéliard|small|BFC
Bourg-en-Bresse|small|ARA
Valence|small|ARA
Angoulême|small|NAQ
Bayonne|small|NAQ
Cannes|small|PACA
Bourges|small|CVL
Cherbourg|small|NOR
Arles|town|PACA
Martigues|town|PACA
Istres|town|PACA
Fréjus|town|PACA
Sète|town|OCC
Rodez|town|OCC
Albi|town|OCC
Tarbes|town|OCC
Guingamp|town|BRE
Concarneau|town|BRE
Épinal|town|GE
Sedan|town|GE
Chartres|town|CVL
Blois|town|CVL
Évreux|town|NOR
Le Puy-en-Velay|town|ARA
Villefranche-sur-Saône|town|ARA
Thonon-les-Bains|town|ARA
Gueugnon|town|BFC
`,
  FR_REGIONS,
);

const FR_FOOTBALL: DomesticFootballSpec = {
  leagues: [
    {
      tier: 1,
      name: "Ligue 1",
      shortName: "Ligue 1",
      size: 18,
      status: "professional",
      reputation: 84,
      clubs: {
        reputation: span(80, 62),
        giants: { count: 1, top: 91, bottom: 89 },
        capacity: span(67_000, 15_000),
        facilities: span(95, 62),
        academy: span(95, 64),
        wageBill: span(560_000_000, 15_000_000),
        transferBudget: span(150_000_000, 1_500_000),
        foreignShare: 0.5,
        squadSize: [25, 30],
      },
    },
    {
      tier: 2,
      name: "Ligue 2",
      shortName: "Ligue 2",
      size: 18,
      status: "professional",
      reputation: 66,
      clubs: {
        reputation: span(61, 48),
        capacity: span(42_000, 6_000),
        facilities: span(78, 45),
        academy: span(82, 45),
        wageBill: span(22_000_000, 3_000_000),
        transferBudget: span(6_000_000, 150_000),
        foreignShare: 0.28,
        squadSize: [25, 30],
      },
    },
    {
      // The professional Ligue 3 replaced the Championnat National in 2026/27 (18 clubs, 34 rounds); tiers 4+ are not modeled.
      tier: 3,
      name: "Ligue 3",
      shortName: "Ligue 3",
      size: 18,
      status: "professional",
      reputation: 50,
      clubs: {
        reputation: span(47, 36),
        capacity: span(20_000, 2_500),
        facilities: span(58, 30),
        academy: span(64, 32),
        wageBill: span(4_500_000, 700_000),
        transferBudget: span(400_000, 10_000),
        foreignShare: 0.14,
        squadSize: [25, 30],
      },
    },
  ],
  movement: [
    // Ligue 2 3rd–5th play off; the winner meets Ligue 1's 16th over two legs (barrage).
    {
      upper: 1,
      promoted: 2,
      relegated: 2,
      playoffs: [{ type: "cross-tier", upperPositions: [16], lowerPositions: [3, 4, 5], legs: 1, finalLegs: 2 }],
    },
    {
      upper: 2,
      promoted: 2,
      relegated: 2,
      playoffs: [{ type: "cross-tier", upperPositions: [16], lowerPositions: [3], legs: 2 }],
    },
  ],
  cups: [
    { kind: "national", name: "Coupe de France", seededEntry: true, legs: 1, neutralFinal: true, continental: true },
    { kind: "super", name: "Trophée des Champions", participants: ["champion", "cup-winner"], neutralFinal: true, start: "01-04" },
  ],
  youth: {
    U19: {
      divisions: [division("Championnat National U19", [1, 3], 14, "Groupe A|Groupe B|Groupe C|Groupe D")],
      cup: { name: "Coupe Gambardella" },
    },
    U17: {
      divisions: [division("Championnat National U17", [1, 3], 14, "Groupe A|Groupe B|Groupe C|Groupe D")],
    },
  },
  // Reserve sides play National 3 (tier 5) and below, outside the modeled pyramid.
  reserves: { mode: "none" },
  clubNaming: {
    templates: templates(`
FC {city}|16
AS {city}|12
US {city}|10
{city} FC|8
SC {city}|6
RC {city}|5
Olympique {city}|4
ES {city}|3
AC {city}|3
AJ {city}|2.5
{city} Foot|3
CS {city}|2
SO {city}|1.5|2,3
Racing {city}|1
Stade {city}|1.5
En Avant {city}|0.5
`),
    regional: [
      {
        regions: ["Corse"],
        templates: templates(`
SC {city}|6
AC {city}|5
GFC {city}|2
FC {city}|3
`),
      },
    ],
    founded: { top: [1872, 1970], bottom: [1897, 2015] },
    shortName: "city",
    avoid: list(`
RC Paris|Racing Paris|Racing Club de Paris|Racing Club de France|Racing CF|Olympique de Paris|Olympique Paris|Stade Français|
Stade Reims|Stade Rennes|Stade Brest|Stade Laval|Stade Lavallois|Stade Caen|Stade Malherbe Caen|Stade Toulouse|Stade Toulousain|
Stade Bordelais|Stade Bordeaux|Stade Poitevin|Stade Poitiers|Stade Briochin|Stade Saint-Brieuc|Stade Beaucairois|Stade Quimpérois|
Stade Quimper|Stade Marseillais|Racing Lens|Racing Club de Lens|Racing Club de Strasbourg|Racing Besançon|RC Besançon|RC Roubaix|
Racing Roubaix|RC Épernay|RC Grasse|RC Toulon|Racing Toulon|Olympique Nice|Olympique de Nice|Nice|Montpellier|Strasbourg|Lens|
Reims|Rennes|Olympique Alès|Olympique Saint-Quentin|Nîmes Olympique|Olympique Nîmes|AS Nancy|AS Nancy-Lorraine|AS Cannes|
AS Béziers|AS Beauvais|AS Poissy|AS Vitré|AS Lyon-Duchère|FC Lyon|US Orléans|US Créteil|US Boulogne|US Concarneau|US Quevilly|
US Dunkerque|USL Dunkerque|US Chauny|US Avranches|US Marseille Endoume|SO Cholet|SO Châtellerault|SO Romorantin|CS Sedan|
En Avant Guingamp|EA Guingamp|US Valenciennes|ES Wasquehal|
Paris Saint-Germain|Paris FC|Red Star|Olympique de Marseille|Olympique Marseille|Olympique Lyonnais|Olympique Lyon|AS Monaco|
Lille OSC|OGC Nice|RC Lens|Stade Rennais|Stade de Reims|Stade Brestois|RC Strasbourg|Racing Strasbourg|FC Nantes|
Toulouse FC|FC Toulouse|Montpellier HSC|FC Lorient|FC Metz|Angers SCO|AJ Auxerre|Le Havre AC|AC Le Havre|
AS Saint-Étienne|Girondins de Bordeaux|FC Bordeaux|SC Bastia|AC Ajaccio|GFC Ajaccio|Gazélec Ajaccio|SM Caen|ES Troyes AC|
Troyes AC|Amiens SC|Grenoble Foot|Grenoble Foot 38|Clermont Foot|Clermont Foot 63|Pau FC|Rodez AF|Le Mans FC|US Boulogne|
USL Dunkerque|Dunkerque|Stade Lavallois|Laval|FC Annecy|En Avant Guingamp|Guingamp|AS Nancy Lorraine|AS Nancy|
FC Sochaux-Montbéliard|FC Sochaux|FC Martigues|FC Rouen|US Orléans|US Concarneau|US Créteil|US Quevilly-Rouen|
FC Versailles|FC Villefranche|FC Fleury 91|Nîmes Olympique|Olympique Nîmes|Valenciennes FC|Dijon FCO|FC Dijon|
LB Châteauroux|Chamois Niortais|Tours FC|FC Tours|Stade Briochin|CS Sedan Ardennes|CS Sedan|AS Cannes|AS Béziers|
FC Sète|FC Istres|FC Mulhouse|FC Chambly|Aubagne FC|Le Puy Foot|Bourges Foot|Blois Foot|FC Gueugnon|
Thonon Évian|Évian Thonon Gaillard|SC Toulon|Sporting Toulon|RC Grasse|US Avranches|FC Chartres|Paris 13 Atletico|
Stade Français|Racing Club de France|AS Lyon-Duchère|FC Lyon|SO Cholet|SO Romorantin|FC Bastia-Borgo|FC Nantes Atlantique|
US Colomiers|FC Rennes|Stade Toulousain|AS Poissy|US Lusitanos Saint-Maur|Racing Besançon|AS Beauvais|FC Limoges|
`),
    colors: ["#004170", "#DA291C", "#FFFFFF", "#009BDB", "#E6A817", "#000000", "#1B5E20", "#6A1B9A", "#E30613", "#003DA5"],
  },
  importSources: codes(
    "SN:6 CI:5 BR:5 ML:4 CM:4 MA:4 DZ:4 PT:4 BE:3 CD:3 GN:3 ES:2 BF:2 GH:2 NG:2 AR:2 US:2 CG:1.2 NL:1.5 CH:1.5 EN:1.5 JP:1.5 TN:1.5 GA:1 TG:1 BJ:1 GM:1 GW:1 HT:1 CV:1 CO:1 GE:1 DE:1 IT:1 DK:1 SE:1 NO:1 KR:1 AO:0.8 UY:0.8 EC:0.8 RS:0.8 HR:0.8 UA:0.8 MG:0.6 KM:0.6 CA:0.6 PY:0.5 AL:0.5 XK:0.5 AT:0.5 PL:0.5 TR:0.5 IE:0.4 AU:0.4 CZ:0.4 GR:0.4 ZM:0.4 RO:0.3 MX:0.3 IL:0.3",
  ),
  // UEFA association season points 2020/21 … 2024/25 (UEFA 2025 country ranking).
  coefficients: { association: [7.916, 18.416, 12.583, 16.25, 17.928], season2025: 18.321 },
};

const FRANCE: NationSpec = {
  code: "FR",
  iso2: "FR",
  name: "France",
  confederation: "UEFA",
  continent: "EU",
  capital: "Paris",
  latitude: 46.6,
  languages: [{ code: "fr", weight: 1 }],
  reputation: { national: 93, league: 84 },
  euEea: true,
  physique: { height: 182 },
  names: { given: sources("faker:fr=1"), family: sources("faker:fr=0.8 faker:fr_CH=0.2") },
  nationality: {
    multipleRate: 0.38,
    tripleRate: 0.08,
    bornAbroadRate: 0.05,
    diasporaPull: 0.4,
    links: [
      ...links("frenchAfrica", "DZ:10 MA:9 SN:6 TN:5 ML:5 CI:5 CM:4 CD:4 GN:3 CG:2 BF:1.5 BJ:1 TG:1 GA:0.8 KM:0.8 MG:0.8 MR:0.6 CF:0.4"),
      ...links("caribbean", "HT:2"),
      ...links("lusophone", "PT:7 CV:1.2 AO:0.8 GW:0.6"),
      ...links("crossBorder", "IT:3 ES:2 BE:1 DE:0.6 CH:0.5 PL:0.8 TR:1.5 RS:0.4 AM:0.6 VN:0.5"),
    ],
    citizenship: { dual: "allowed" },
  },
  cities: { major: FR_CITIES },
  football: FR_FOOTBALL,
};

// ------------------------------------------------------------------ Italy

const IT_CITIES = cityRows(`
Roma|mega|Lazio|5|Trastevere,Testaccio,Prati,Ostiense,Monteverde,Tuscolano,Garbatella,Flaminio
Milano|mega|Lombardia|4|Isola,Navigli,Lambrate,Baggio,Niguarda,Bovisa,Sesto San Giovanni
Napoli|large|Campania|3|Fuorigrotta,Vomero,Posillipo,Secondigliano,Bagnoli
Torino|large|Piemonte|3|Lingotto,Mirafiori,San Salvario,Barriera di Milano
Palermo|large|Sicilia|2|Mondello,Brancaccio
Genova|large|Liguria|2|Sampierdarena,Sestri Ponente,Nervi,Cornigliano
Bologna|large|Emilia-Romagna|2|Borgo Panigale,San Donato
Firenze|large|Toscana|2|Rifredi,Campo di Marte,Novoli
Bari|medium|Puglia|2|Japigia,Carbonara,Poggiofranco,Palese,Santo Spirito,Torre a Mare
Catania|medium|Sicilia|2|Librino,Ognina,Picanello,Nesima
Venezia|medium|Veneto|2|Mestre,Lido,Marghera,Favaro Veneto
Verona|medium|Veneto|2|Borgo Trento,San Zeno,Borgo Roma,Golosine
Messina|medium|Sicilia|2|Gazzi,Giostra,Camaro,Contesse
Padova|medium|Veneto|2|Arcella,Brusegana,Voltabarozzo,Mortise
Trieste|medium|Friuli-Venezia Giulia|2|Servola,Opicina,Roiano,Barcola
Brescia|medium|Lombardia|2|Mompiano,Sanpolino,Chiesanuova,Folzano
Parma|medium|Emilia-Romagna|2|Oltretorrente,San Leonardo,Montanara,San Lazzaro Parmense
Taranto|medium|Puglia|2|Talsano,Paolo VI,Tamburi,Lama
Prato|medium|Toscana|2|Galciana,Iolo,Mezzana,Tavola
Modena|medium|Emilia-Romagna|2|Buon Pastore,Crocetta,Sacca,Madonnina
Reggio Calabria|medium|Calabria|2|Gallico,Pellaro,Catona,Archi
Reggio Emilia|medium|Emilia-Romagna|2|Rivalta,Canali,Ospizio,Mancasale
Perugia|medium|Umbria|2|Ponte San Giovanni,San Sisto,Ponte Felcino,Castel del Piano
Livorno|medium|Toscana|2|Ardenza,Antignano,Salviano,Shangai
Cagliari|medium|Sardegna|2|Pirri,Is Mirrionis,Sant'Avendrace,Monte Urpinu
Foggia|medium|Puglia|2|Borgo Incoronata,Candelaro,Macchia Gialla
Rimini|medium|Emilia-Romagna|2|Viserba,Miramare,Rivabella,Torre Pedrera
Salerno|medium|Campania|2|Pastena,Mercatello,Fratte,Torrione
Ferrara|medium|Emilia-Romagna|2|Pontelagoscuro,Porotto,Quacchio,Cona
Monza|medium|Lombardia|2|San Fruttuoso,Triante,Cederna,Sant'Albino
Bergamo|medium|Lombardia|2|Longuelo,Redona,Colognola,Boccaleone
Pescara|medium|Abruzzo|2|Rancitelli,Porta Nuova,Zanni,Fontanelle
Vicenza|medium|Veneto|2|Anconetta,Laghetto,San Pio X,Bertesina
Latina|medium|Lazio|2|Borgo Piave,Latina Scalo,Borgo Sabotino,Borgo Podgora
Novara|medium|Piemonte|2|Sant'Agabio,Veveri,Pernate,Olengo
Piacenza|medium|Emilia-Romagna|2|Farnesiana,Besurica,Mucinasso
Ancona|medium|Marche|2|Torrette,Collemarino,Tavernelle,Pietralacroce
Udine|medium|Friuli-Venezia Giulia|2|Paderno,Cussignacco,Chiavris,Godia
Trento|medium|Trentino-Alto Adige|2|Gardolo,Povo,Mattarello,Ravina
Bolzano|small|Trentino-Alto Adige|1|Gries,Oltrisarco
Lecce|small|Puglia|1|Frigole,San Cataldo
Como|small|Lombardia|1|Camerlata,Albate,Rebbio
Pisa|small|Toscana|1|Marina di Pisa,Putignano Pisano
Cremona|small|Lombardia|1|Cavatigozzi,Picenengo
Sassuolo|small|Emilia-Romagna
Empoli|small|Toscana
La Spezia|small|Liguria
Catanzaro|small|Calabria
Cosenza|small|Calabria
Crotone|small|Calabria|1|Papanice,Capocolonna
Frosinone|small|Lazio
Cesena|small|Emilia-Romagna|1|San Vittore,Ponte Abbadesse
Terni|small|Umbria|1|Borgo Rivo,Piediluco
Avellino|small|Campania|1|Picarelli,Bellizzi Irpino
Benevento|small|Campania
Caserta|small|Campania
Siracusa|small|Sicilia
Trapani|small|Sicilia
Sassari|small|Sardegna|1|Li Punti,Ottava
Olbia|small|Sardegna|1|Pittulongu,Berchiddeddu
Arezzo|small|Toscana|1|Olmo,Indicatore
Siena|small|Toscana|1|Taverne d'Arbia,Isola d'Arbia
Lucca|small|Toscana|1|Sant'Anna,San Concordio
Pistoia|small|Toscana|1|Bottegone,Candeglia
Grosseto|small|Toscana|1|Marina di Grosseto,Roselle
Carrara|small|Toscana|1|Avenza,Marina di Carrara
Alessandria|small|Piemonte|1|Spinetta Marengo,Cristo
Asti|small|Piemonte
Vercelli|small|Piemonte
Cuneo|small|Piemonte
Mantova|small|Lombardia|1|Lunetta,Borgo Angeli
Lecco|small|Lombardia|1|Pescarenico,Acquate
Varese|small|Lombardia|1|Masnago,Biumo,Bizzozero
Pavia|small|Lombardia|1|Mirabello,Borgo Ticino
Busto Arsizio|small|Lombardia
Ravenna|small|Emilia-Romagna|1|Marina di Ravenna,Classe,Sant'Alberto
Forlì|small|Emilia-Romagna|1|Ronco,Vecchiazzano
Pesaro|small|Marche|1|Villa Fastiggi,Soria
Ascoli Piceno|small|Marche
San Benedetto del Tronto|small|Marche
Teramo|small|Abruzzo
L'Aquila|small|Abruzzo
Potenza|small|Basilicata
Matera|small|Basilicata
Campobasso|small|Molise
Brindisi|small|Puglia
Andria|small|Puglia
Barletta|small|Puglia
Cerignola|town|Puglia
Monopoli|town|Puglia
Altamura|town|Puglia
Castellammare di Stabia|small|Campania
Torre del Greco|small|Campania
Giugliano in Campania|small|Campania
Sorrento|town|Campania
Gubbio|town|Umbria
Cittadella|town|Veneto
Chiavari|town|Liguria
Savona|small|Liguria
Aosta|town|Valle d'Aosta
Rovigo|small|Veneto
Treviso|small|Veneto
Pordenone|small|Friuli-Venezia Giulia
Lumezzane|town|Lombardia
Pontedera|town|Toscana
Fermo|town|Marche
Rieti|town|Lazio
Viterbo|small|Lazio
Nocera Inferiore|town|Campania
Acireale|town|Sicilia
Agrigento|small|Sicilia
Vibo Valentia|town|Calabria
`);

const IT_FOOTBALL: DomesticFootballSpec = {
  leagues: [
    {
      tier: 1,
      name: "Serie A",
      shortName: "Serie A",
      size: 20,
      status: "professional",
      reputation: 88,
      clubs: {
        reputation: span(82, 62),
        giants: { count: 4, top: 89, bottom: 85 },
        capacity: span(75_800, 12_000),
        facilities: span(90, 58),
        academy: span(88, 55),
        wageBill: span(230_000_000, 18_000_000),
        transferBudget: span(90_000_000, 2_000_000),
        foreignShare: 0.62,
        squadSize: [25, 30],
      },
    },
    {
      tier: 2,
      name: "Serie B",
      shortName: "Serie B",
      size: 20,
      status: "professional",
      reputation: 64,
      clubs: {
        reputation: span(62, 48),
        capacity: span(58_000, 5_000),
        facilities: span(72, 42),
        academy: span(74, 42),
        wageBill: span(22_000_000, 3_500_000),
        transferBudget: span(6_000_000, 100_000),
        foreignShare: 0.3,
        squadSize: [25, 30],
      },
    },
    {
      // Real Serie C: 60 clubs in Girone A/B/C of 20 (38 matchdays); merged to 3 × 16 under the 48-team cap.
      tier: 3,
      name: "Serie C",
      shortName: "Serie C",
      size: 48,
      status: "professional",
      reputation: 46,
      conferences: ["Girone A", "Girone B", "Girone C"],
      bTeams: 3,
      clubs: {
        reputation: span(50, 34),
        capacity: span(37_000, 1_500),
        facilities: span(55, 28),
        academy: span(58, 28),
        wageBill: span(7_000_000, 900_000),
        transferBudget: span(700_000, 10_000),
        foreignShare: 0.12,
        squadSize: [25, 30],
      },
    },
  ],
  movement: [
    { upper: 1, promoted: 2, relegated: 3, playoffs: [{ type: "promotion", positions: [3, 8], places: 1, legs: 2, finalLegs: 2 }] },
    // Group winners go up; the real 4th place (28-team Serie C play-off) and the Serie B play-out don't split evenly.
    { upper: 2, promoted: 3, relegated: 3, perConference: true },
  ],
  cups: [
    { kind: "national", name: "Coppa Italia", tiers: [1, 2, 3], maxEntrants: 44, seededEntry: true, legs: 1, neutralFinal: true, continental: true },
    { kind: "league", name: "Coppa Italia Serie C", tiers: [3], legs: 1, finalLegs: 2 },
    { kind: "super", name: "Supercoppa Italiana", participants: ["champion", "runner-up", "cup-winner", "cup-runner-up"], neutralFinal: true, start: "12-18" },
  ],
  youth: {
    U19: {
      divisions: [
        division("Campionato Primavera 1", [1, 1], 10, "Girone A|Girone B"),
        division("Campionato Primavera 2", [2, 2], 10, "Girone A|Girone B"),
        division("Campionato Primavera 3", [3, 3], 16, "Girone A|Girone B|Girone C"),
      ],
      cup: { name: "Coppa Italia Primavera" },
    },
    U17: {
      divisions: [
        division("Under-17 Serie A e B", [1, 2], 14, "Girone A|Girone B|Girone C"),
        division("Under-17 Serie C", [3, 3], 16, "Girone A|Girone B|Girone C"),
      ],
    },
  },
  // Serie C U23 second teams in 2025/26: Juventus Next Gen, Atalanta U23, Inter U23.
  reserves: {
    mode: "pyramid",
    nameTemplate: "{club} U23",
    eligibility: { parentTiers: [1], minReputation: 80, maxTeams: 3 },
    pyramid: { highestTier: 2, minGapBelowParent: 1, maxPerTier: 3 },
    ageRule: { maxAge: 23, overage: 4 },
    squad: [22, 28],
  },
  clubNaming: {
    templates: templates(`
{city} Calcio|12
US {city}|10
AC {city}|8
AS {city}|6
{city} FC|4
FC {city}|4
SS {city}|4
{city} {founded}|3
{city} Calcio {founded}|2
Calcio {city}|1.5
ASD {city}|2|3
SSD {city}|2|3
Polisportiva {city}|0.5|3
Città di {city}|1.5
Virtus {city}|0.6
Atletico {city}|0.4
Pro {city}|0.4
Audace {city}|0.3
Sporting {city}|0.3
Real {city}|0.3
Union {city}|0.3
`),
    founded: { top: [1893, 1930], bottom: [1905, 2012] },
    shortName: "city",
    avoid: list(`
AC Milano|Milano|Inter Milano|Internazionale Milano|AS Bari|SSC Bari|FC Bari 1908|Bari|AC Firenze|Firenze|Genova|Genova 1893|
SS Napoli|AS Napoli|AC Napoli|Napoli Calcio|Calcio Napoli|Napoli Soccer|US Palermo|US Città di Palermo|Palermo Calcio|SSD Palermo|
Palermo|Virtus Roma|Virtus Bologna|Virtus Verona|Virtus Entella|Pro Vercelli|Pro Sesto|Pro Piacenza|Pro Patria|AS Livorno|Livorno|
AC Perugia|Perugia Calcio|AC Pisa|Pisa Calcio|Pisa SC|Pisa|AC Siena|Robur Siena|AC Reggiana|Reggiana|AC Cesena|Cesena FC|AC Mantova|
Mantova Calcio|Mantova|AC Prato|AC Ancona|US Ancona|AC Venezia|Venezia|Parma AC|AC Parma|AS Varese|Varese Calcio|AS Lucchese|
AS Cittadella|AS Gubbio|US Cremonese|US Salernitana|US Catanzaro|US Foggia|Calcio Foggia|US Avellino|US Triestina|US Alessandria|
US Pistoiese|US Massese|SS Arezzo|SS Juve Stabia|SS Monopoli|SS Teramo|SS Campobasso|Calcio Catania|Catania Calcio|Catania|
Calcio Padova|Padova|Calcio Como|Como Calcio|Calcio Lecco|Brescia Calcio|Brescia|Spezia Calcio|La Spezia Calcio|La Spezia|Frosinone Calcio|Benevento Calcio|
Pescara Calcio|Modena FC|Modena Calcio|Modena|Vicenza Calcio|LR Vicenza|Piacenza Calcio|Novara Calcio|Cosenza Calcio|Reggina Calcio|
ACR Messina|FC Messina|Taranto FC|AS Taranto|Trapani Calcio|Rimini Calcio|Rimini FC|Ravenna Calcio|Ravenna FC|Latina Calcio|
Potenza Calcio|Matera Calcio|Siracusa Calcio|L'Aquila Calcio|Pordenone Calcio|Treviso FBC|FC Treviso|AC Trento|Ascoli Calcio|
Carrarese Calcio|Ternana Calcio|FC Crotone|Cagliari|Empoli|Monza|Lecce|Cremonese|Frosinone|Spezia|Cittadella|Catanzaro|
Juventus|Inter|Internazionale|AC Milan|Milan|AS Roma|Roma|SS Lazio|Lazio|SSC Napoli|Napoli|Atalanta|ACF Fiorentina|Fiorentina|
Bologna FC|Bologna 1909|Torino FC|Torino Calcio|Genoa CFC|Genoa|UC Sampdoria|Sampdoria|Udinese Calcio|Udinese|Cagliari Calcio|
Hellas Verona|Verona|Parma Calcio|Parma Calcio 1913|US Lecce|Como 1907|Empoli FC|Venezia FC|AC Monza|US Sassuolo|Sassuolo Calcio|
Pisa SC|AC Pisa|US Cremonese|Palermo FC|SSC Bari|Bari 1908|Spezia Calcio|Modena FC|Brescia Calcio|US Salernitana|US Catanzaro|
Frosinone Calcio|Cosenza Calcio|FC Crotone|AC Reggiana|Reggiana|AC Cesena|Cesena FC|AC Perugia|Perugia Calcio|Ternana Calcio|
US Triestina|Triestina|Calcio Padova|Padova Calcio|LR Vicenza|Vicenza Calcio|Virtus Entella|Virtus Verona|Virtus Francavilla|
Pro Vercelli|Pro Patria|Pro Sesto|FC Südtirol|Carrarese Calcio|SS Juve Stabia|US Avellino|Benevento Calcio|Casertana FC|
Catania FC|Calcio Catania|Calcio Foggia|US Ancona|US Livorno|AS Livorno|SS Arezzo|AC Siena|Piacenza Calcio|Novara FC|
US Alessandria|Mantova 1911|Calcio Lecco|Lecco 1912|UC AlbinoLeffe|AC Trento|Rimini FC|Ravenna FC|SPAL|Delfino Pescara|
Pescara Calcio|Taranto FC|SS Monopoli|Potenza Calcio|Latina Calcio|Trapani 1905|ACR Messina|Reggina 1914|AS Cittadella|
Chievo Verona|Varese Calcio|FC Lumezzane|Lucchese|US Pontedera|AS Gubbio|Ascoli Calcio|Audace Cerignola|US Grosseto|
Pistoiese|Olbia Calcio|Torres|Sambenedettese|Vis Pesaro|Fermana|Savoia|Nocerina|Giugliano Calcio|Sorrento Calcio|Siracusa Calcio|
Calcio Padova|Treviso FC|Pordenone Calcio|Arzignano Valchiampo|Feralpisalò|Pergolettese|Casarano|Team Altamura|
Città di Varese|Città di Brindisi|Città di Campobasso|Città di Messina|Città di Acireale|Città di Fasano|Città di Foligno|
Città di Gela|Città di Sant'Agata|Città di Ciampino|Città di Anagni|Città di Pontedera|Città di Castello|Città di Isernia|
Atletico Catania|Atletico Roma|Atletico Ascoli|Real Vicenza|Union Brescia|Union Clodiense|Union Feltre|Pro Roma|Pro Gorizia|
Pro Livorno|Virtus Bergamo|Virtus Lanciano|Trastevere Calcio|Ostiamare|Sestri Levante|Sampierdarenese|Alcione Milano|AC Mestre|
`),
    colors: ["#000000", "#FFFFFF", "#0068A8", "#8E1F2F", "#87CEEB", "#6A0DAD", "#FFD700", "#00843D", "#E30613", "#1E2A5A"],
  },
  importSources: codes(
    "AR:5 BR:5 FR:4 NG:3 SN:3 ES:3 PT:2.5 NL:2.5 BE:2.5 DE:2 HR:2.5 RS:2 AL:2.5 RO:2 MA:2 CI:2 GH:2 DK:2 SE:1.5 NO:1.5 PL:2 UY:2 CO:1.5 CH:1.5 AT:1 CZ:1 SK:1 SI:1 GR:1 GM:1.2 ML:1 CM:1 GN:0.8 TR:1 US:1.2 EN:1 SCO:0.4 UA:0.8 GE:0.8 XK:0.8 ME:0.8 MK:0.6 BA:0.6 HU:0.6 VE:0.6 PY:0.6 CL:0.5 EC:0.5 MX:0.4 TN:0.6 DZ:0.6 EG:0.3 CD:0.6 BF:0.5 KE:0.3 AU:0.4 CA:0.5 JP:0.5 KR:0.4 IS:0.3 FI:0.4 IE:0.3 LT:0.3 BG:0.4 MD:0.3 LU:0.2 SM:0.2 MT:0.2",
  ),
  // UEFA association season points 2020/21 … 2024/25 (UEFA 2025 country ranking).
  coefficients: { association: [16.285, 15.714, 22.357, 21.0, 21.875], season2025: 19.0 },
};

const ITALY: NationSpec = {
  code: "IT",
  iso2: "IT",
  name: "Italy",
  confederation: "UEFA",
  continent: "EU",
  capital: "Roma",
  latitude: 42.8,
  languages: [{ code: "it", weight: 1 }],
  reputation: { national: 86, league: 88 },
  euEea: true,
  physique: { height: 182 },
  names: { given: sources("faker:it=1"), family: sources("faker:it=1") },
  nationality: {
    multipleRate: 0.24,
    tripleRate: 0.04,
    bornAbroadRate: 0.07,
    diasporaPull: 0.3,
    links: [
      ...links("americas", "AR:8 BR:7 UY:2.5 VE:1 US:1 CA:0.6 AU:0.6"),
      ...links("mediterranean", "AL:7 MA:5 TN:3 EG:1.5"),
      ...links("crossBorder", "RO:6 CH:2 FR:2 DE:2 BE:1 UA:1 MD:0.8 HR:0.6 SM:0.3"),
      ...links("frenchAfrica", "SN:3 CI:1.5"),
      ...links("commonwealth", "NG:3 GH:2.5"),
    ],
    citizenship: { dual: "allowed" },
  },
  cities: { major: IT_CITIES },
  football: IT_FOOTBALL,
};

// ------------------------------------------------------------------ Greece

const GREEK = pool(
  "greek",
  "Giorgos|Dimitris|Kostas|Nikos|Giannis|Christos|Panagiotis|Vasilis|Thanasis|Michalis|Stelios|Stavros|Manolis|Antonis|Alexandros|Apostolos|Anastasios|Andreas|Angelos|Aris|Charalampos|Christoforos|Dionysis|Efthymios|Evangelos|Fotis|Grigoris|Ilias|Ioannis|Iraklis|Kyriakos|Lazaros|Leonidas|Marios|Minas|Nektarios|Odysseas|Pavlos|Periklis|Petros|Prodromos|Savvas|Sokratis|Spyros|Stathis|Stefanos|Sotiris|Thodoris|Theofanis|Thomas|Timotheos|Tasos|Vangelis|Zisis|Zacharias|Lefteris|Makis|Nikolas|Achilleas|Filippos|Konstantinos|Emmanouil|Athanasios|Georgios|Panos|Rafail|Vaios|Anestis|Orestis|Loukas|Markos|Kleanthis|Tryfon|Vyron|Nestoras|Paraskevas|Serafeim|Chrysovalantis",
  "Papadopoulos|Papadakis|Papageorgiou|Georgiou|Oikonomou|Nikolaou|Dimitriou|Konstantinou|Ioannou|Vasileiou|Karagiannis|Pappas|Makris|Alexiou|Anagnostou|Antoniou|Athanasiou|Christodoulou|Christou|Fotopoulos|Galanis|Giannakopoulos|Giannopoulos|Kariotis|Katsaros|Kontos|Kostopoulos|Kyriakou|Lambropoulos|Manolas|Michailidis|Nikolaidis|Pantelidis|Papanikolaou|Pavlidis|Petrakis|Samaras|Sotiriou|Stamatopoulos|Theodoridis|Tzavellas|Zervas|Zografos|Karagounis|Seitaridis|Dellas|Masouras|Retsos|Kourbelis|Mantalos|Christopoulos|Kalogeropoulos|Tsiolis|Kotsiras|Hatzidiakos|Chatzigiovanis|Pelkas|Limnios|Douvikas|Ioannidis|Kyriakopoulos|Pasalidis|Chalkiadakis|Stavropoulos|Vlachos|Kapetanios|Andreadis|Anastasiadis|Karras|Sarris|Tsoukalas|Voulgaris|Xanthopoulos|Kouris|Lagos|Moraitis|Panagiotou|Raftopoulos|Rigas|Spanos|Tsakiris|Venetis|Koutsoukos|Mylonas|Nikolopoulos|Papaioannou|Paraskevopoulos|Kalaitzidis|Lykogiannis|Tzimas|Siovas|Kanellopoulos|Theodorou|Triantafyllou|Charalampidis|Dimopoulos|Efthymiou|Gkekas|Kapsalis|Kousoulos|Lazaridis|Mavridis|Papazoglou|Stergiou|Tsaousis|Vergos",
);

const GR_CITIES = cityRows(`
Athina|mega|Attiki|4|Kallithea,Peristeri,Egaleo,Ilioupoli,Nea Smyrni,Marousi,Glyfada,Chalandri,Ano Liosia,Kypseli
Peiraias|large|Attiki|2|Kaminia,Neo Faliro,Korydallos
Thessaloniki|large|Kentriki Makedonia|3|Toumba,Kalamaria,Charilaou,Evosmos,Stavroupoli
Patra|medium|Dytiki Ellada
Irakleio|medium|Kriti
Larisa|medium|Thessalia
Volos|medium|Thessalia
Ioannina|medium|Ipeiros
Chania|small|Kriti
Kavala|small|Anatoliki Makedonia kai Thraki
Serres|small|Kentriki Makedonia
Kalamata|small|Peloponnisos
Tripoli|small|Peloponnisos
Agrinio|small|Dytiki Ellada
Lamia|small|Sterea Ellada
Rodos|small|Notio Aigaio
Xanthi|small|Anatoliki Makedonia kai Thraki
Komotini|small|Anatoliki Makedonia kai Thraki
Drama|small|Anatoliki Makedonia kai Thraki
Alexandroupoli|small|Anatoliki Makedonia kai Thraki
Veroia|small|Kentriki Makedonia
Katerini|small|Kentriki Makedonia
Karditsa|small|Thessalia
Trikala|small|Thessalia
Kozani|small|Dytiki Makedonia
Kerkyra|small|Ionia Nisia
Chalkida|small|Sterea Ellada
Livadeia|town|Sterea Ellada
Rethymno|town|Kriti
Giannitsa|town|Kentriki Makedonia
Kilkis|town|Kentriki Makedonia
Nafplio|town|Peloponnisos
Korinthos|town|Peloponnisos
Pyrgos|town|Dytiki Ellada
Arta|town|Ipeiros
Preveza|town|Ipeiros
Florina|town|Dytiki Makedonia
Kastoria|town|Dytiki Makedonia
Elefsina|town|Attiki
Megara|town|Attiki
`);

const GR_FOOTBALL: DomesticFootballSpec = {
  leagues: [
    {
      tier: 1,
      name: "Super League",
      shortName: "Super League",
      size: 14,
      status: "professional",
      reputation: 62,
      split: {
        groups: [
          { name: "Championship play-offs", positions: [1, 4], roundRobins: 2, points: "full" },
          { name: "Europe play-offs", positions: [5, 8], roundRobins: 2, points: "full" },
          { name: "Relegation play-outs", positions: [9, 14], roundRobins: 1, points: "full" },
        ],
      },
      clubs: {
        reputation: span(64, 46),
        giants: { count: 4, top: 76, bottom: 72 },
        capacity: span(33_000, 3_000),
        facilities: span(82, 38),
        academy: span(74, 38),
        wageBill: span(45_000_000, 2_000_000),
        transferBudget: span(20_000_000, 50_000),
        foreignShare: 0.6,
        squadSize: [25, 30],
      },
    },
    {
      // Real Super League 2: regional North and South groups; B-teams of the big clubs play here.
      tier: 2,
      name: "Super League 2",
      shortName: "Super League 2",
      size: 20,
      status: "semi-professional",
      reputation: 40,
      conferences: ["North", "South"],
      bTeams: 3,
      clubs: {
        reputation: span(44, 30),
        capacity: span(22_000, 1_500),
        facilities: span(50, 22),
        academy: span(55, 22),
        wageBill: span(2_500_000, 250_000),
        transferBudget: span(150_000, 5_000),
        foreignShare: 0.25,
        squadSize: [25, 30],
      },
    },
  ],
  movement: [{ upper: 1, promoted: 2, relegated: 2, perConference: true }],
  cups: [
    { kind: "national", name: "Greek Cup", seededEntry: true, legs: 1, neutralFinal: true, continental: true },
    // Revived in 2025/26: one match in January (Olympiacos 3–0 OFI, Pankritio Stadium, 3 January 2026).
    { kind: "super", name: "Greek Super Cup", participants: ["champion", "cup-winner"], neutralFinal: true, start: "01-03" },
  ],
  youth: {
    U19: {
      divisions: [division("Super League K19", [1, 1], 14), division("Super League 2 K19", [2, 2], 10, "North|South")],
    },
    U17: {
      divisions: [division("Super League K17", [1, 1], 14), division("Super League 2 K17", [2, 2], 10, "North|South")],
    },
  },
  reserves: {
    mode: "pyramid",
    nameTemplate: "{club} B",
    eligibility: { parentTiers: [1], minReputation: 70, maxTeams: 3 },
    pyramid: { highestTier: 2, minGapBelowParent: 1, maxPerTier: 3 },
    squad: [22, 30],
  },
  clubNaming: {
    templates: templates(`
AO {city}|10
AE {city}|8
AS {city}|6
PAS {city}|4
Ethnikos {city}|3
Olympiakos {city}|3
Apollon {city}|3
Asteras {city}|3
Iraklis {city}|2
Doxa {city}|2
Niki {city}|2
Anagennisi {city}|2
Aris {city}|2
Atromitos {city}|1.5
Keravnos {city}|1.5|2
Thyella {city}|1|2
Aetos {city}|1|2
`),
    founded: { top: [1908, 1967], bottom: [1920, 2012] },
    shortName: "city",
    avoid: list(`
Olympiacos|Olympiakos Peiraias|Olympiakos Piraeus|Panathinaikos|AEK Athens|AEK|PAOK|Aris Thessaloniki|Asteras Tripolis|
Atromitos Athinon|Atromitos Athens|OFI|OFI Kritis|Panetolikos|Levadiakos|AE Kifisia|Volos NFC|Panserraikos|AEL|AE Larisa|
AEL Larisa|PAS Giannina|PAS Lamia|Athens Kallithea|Apollon Smyrnis|Apollon Pontou|Iraklis Thessaloniki|Ergotelis|Panachaiki|
Panionios|Ionikos|Egaleo|Ethnikos Piraeus|Doxa Drama|AO Kavala|Niki Volou|Niki Volos|Olympiakos Volou|Olympiakos Volos|
Anagennisi Karditsa|AO Chania|Chania|Kalamata|Makedonikos|Kampaniakos|Proodeftiki|Ilioupoli|Marko|Diagoras|AO Xanthi|
Xanthi|Veria|PAE Veria|Trikala|AO Trikala|Iraklis Larisa|Ethnikos Asteras|Panelefsiniakos|Kerkyra|AO Kerkyra|Apollon Larisa|
`),
    colors: ["#E30613", "#006633", "#FFD700", "#000000", "#FFFFFF", "#003DA5", "#8B0000", "#87CEEB"],
  },
  importSources: codes(
    "BR:3 AR:3 PT:3 ES:3 FR:2 RS:2 AL:2 HR:1.5 CY:1.5 NG:1.5 PL:1.5 NL:1.2 DE:1.2 IT:1.2 SE:1 NO:1 CI:1 SN:1 GH:1 MA:1 BE:1 UY:1 CO:1 CM:1 GE:1 BA:0.8 ME:0.8 EN:0.8 MK:0.6 BG:0.6 RO:0.6 UA:0.6 SK:0.6 CZ:0.6 DK:0.6 US:0.6 GN:0.6 CD:0.6 DZ:0.6 AT:0.5 CH:0.5 VE:0.5 PY:0.5 IL:0.5 XK:0.5 ML:0.5 HU:0.4 FI:0.4 IS:0.4 AU:0.4 CR:0.4 EC:0.4 CL:0.4 SI:0.4 GM:0.4 BF:0.4 CV:0.4 GW:0.4 IE:0.3 TR:0.3 LT:0.3 LV:0.3 TG:0.3 BJ:0.3 AO:0.3 ZM:0.3",
  ),
  // UEFA association season points 2020/21 … 2024/25 (UEFA 2025 country ranking; 2023/24 includes Olympiacos's UECL title).
  coefficients: { association: [5.1, 8.0, 2.125, 11.4, 12.687], season2025: 14.2 },
};

const GREECE: NationSpec = {
  code: "GR",
  iso2: "GR",
  name: "Greece",
  confederation: "UEFA",
  continent: "EU",
  capital: "Athina",
  latitude: 39.1,
  languages: [{ code: "el", weight: 1 }],
  reputation: { national: 72, league: 62 },
  euEea: true,
  physique: { height: 182 },
  names: { given: sources("greek=1"), family: sources("greek=1") },
  nationality: {
    multipleRate: 0.2,
    tripleRate: 0.03,
    bornAbroadRate: 0.08,
    diasporaPull: 0.4,
    links: [
      ...links("regional", "AL:9 CY:8 BG:1 RO:0.8"),
      ...links("postSoviet", "GE:4 RU:1 UA:1 KZ:0.8 AM:0.6"),
      ...links("germanRecruitment", "DE:6"),
      ...links("commonwealth", "AU:3"),
      ...links("americas", "US:3 CA:1"),
    ],
    citizenship: { dual: "allowed" },
  },
  cities: { major: GR_CITIES },
  football: GR_FOOTBALL,
};

// ------------------------------------------------------------------ Cyprus

const CYPRUS: NationSpec = {
  code: "CY",
  iso2: "CY",
  name: "Cyprus",
  confederation: "UEFA",
  continent: "AS",
  capital: "Lefkosia",
  latitude: 35.1,
  languages: [{ code: "el", weight: 0.95 }, { code: "tr", weight: 0.05 }],
  reputation: { national: 45, league: 50 },
  euEea: true,
  physique: { height: 180 },
  names: { given: sources("greek=1"), family: sources("greek=1") },
  nationality: {
    multipleRate: 0.22,
    tripleRate: 0.03,
    bornAbroadRate: 0.1,
    diasporaPull: 0.35,
    links: [
      ...links("regional", "GR:10 GE:1 BG:0.8 RO:0.6 AM:0.4 LB:0.4"),
      ...links("commonwealth", "EN:6 AU:1.5 ZA:0.5"),
      ...links("postSoviet", "RU:0.8 UA:0.5"),
    ],
    citizenship: { dual: "allowed" },
  },
  cities: {
    major: cityRows(`
Lefkosia|large|Lefkosia|4|Strovolos,Lakatamia,Aglantzia,Engomi,Latsia
Lemesos|large|Lemesos|3|Agios Athanasios,Ypsonas,Kato Polemidia
Larnaka|medium|Larnaka|2|Aradippou,Livadia
Pafos|medium|Pafos|2|Chlorakas,Geroskipou
Paralimni|town|Ammochostos
Deryneia|town|Ammochostos
Sotira|town|Ammochostos
Dali|town|Lefkosia
Peyia|town|Pafos
Polis Chrysochous|town|Pafos
Kiti|town|Larnaka
Xylofagou|town|Larnaka
Athienou|town|Larnaka
`),
  },
  football: {
    leagues: [
      {
        tier: 1,
        name: "Cypriot First Division",
        shortName: "First Division",
        size: 14,
        status: "professional",
        reputation: 50,
        split: {
          groups: [
            { name: "Championship round", positions: [1, 6], roundRobins: 2, points: "full" },
            { name: "Relegation round", positions: [7, 14], roundRobins: 1, points: "full" },
          ],
        },
        clubs: {
          reputation: span(56, 36),
          giants: { count: 3, top: 64, bottom: 60 },
          capacity: span(22_800, 1_500),
          facilities: span(70, 30),
          academy: span(55, 25),
          wageBill: span(18_000_000, 1_200_000),
          transferBudget: span(6_000_000, 20_000),
          foreignShare: 0.72,
          squadSize: [25, 30],
        },
      },
    ],
    movement: [],
    cups: [
      { kind: "national", name: "Cypriot Cup", legs: 1, neutralFinal: true, continental: true },
      { kind: "super", name: "Cypriot Super Cup", participants: ["champion", "cup-winner"], neutralFinal: true },
    ],
    youth: {
      U19: { divisions: [division("Cyprus U19 League", [1, 1], 14)] },
      U17: { divisions: [division("Cyprus U17 League", [1, 1], 14)] },
    },
    reserves: { mode: "none" },
    clubNaming: {
      templates: templates(`
AE {city}|8
Ethnikos {city}|4
Enosis {city}|4
AS {city}|3
Olympiakos {city}|3
Apollon {city}|3
Omonia {city}|3
{city} FC|3
Digenis {city}|2
Doxa {city}|2
Anorthosis {city}|2
Aris {city}|1.5
Onisilos {city}|1
`),
      founded: { top: [1926, 1948], bottom: [1930, 2014] },
      shortName: "city",
      avoid: list(`
APOEL|Omonia|Omonia Nicosia|Omonia Lefkosias|Olympiakos Nicosia|Olympiakos Lefkosias|Apollon Limassol|Apollon Lemesou|
AEL Limassol|AEL Lemesou|Aris Limassol|Aris Lemesou|AEK Larnaca|AEK Larnakas|Anorthosis Famagusta|Anorthosis Ammochostou|
Nea Salamis|Pafos FC|AEP Paphos|Ethnikos Achna|Enosis Neon Paralimni|Doxa Katokopias|Digenis Morphou|Karmiotissa|
Omonia Aradippou|Krasava ENY Ypsonas|Akritas Chlorakas|APOP Kinyras|Alki Larnaca|Ermis Aradippou|Olympias Lakatamias|
Othellos Athienou|Onisilos Sotira|Anagennisi Deryneia|Omonia 29M|MEAP Nisou|Achyronas Liopetriou|ASIL Lysi|PAEEK|
`),
      colors: ["#FFD700", "#006633", "#003DA5", "#E30613", "#FFFFFF", "#000000"],
    },
    importSources: codes(
      "PT:5 BR:4 GR:6 ES:4 FR:3 AR:2 NG:2 SE:1.5 NO:1.5 PL:1.5 RS:1.5 HR:1.2 NL:1.5 BE:1 DE:1 IT:1 SN:1 CI:1 GH:1 CM:1 CV:1 GW:1 BG:1 RO:1 GE:1.2 UA:0.8 LT:0.6 LV:0.5 SK:0.6 CZ:0.6 SI:0.6 ME:0.6 MK:0.6 AL:0.6 BA:0.6 IS:0.4 EN:1 IE:0.4 CO:0.6 UY:0.6 VE:0.5 CD:0.5 GN:0.5 ML:0.5 MA:0.5 DZ:0.5 TN:0.4 IL:0.6 AM:0.4",
    ),
    // UEFA association season points 2020/21 … 2024/25 (UEFA 2025 country ranking).
    coefficients: { association: [4.0, 4.125, 5.1, 3.75, 10.562], season2025: 12.156 },
  },
};

// ------------------------------------------------------------------ San Marino

const SAMMARINESE = pool(
  "sammarinese",
  "",
  "Gasperoni|Guidi|Gatti|Casadei|Stefanelli|Zonzini|Valentini|Selva|Muccioli|Bollini|Belluzzi|Giardi|Tomassoni|Mularoni|Righi|Ceccoli|Bonini|Berardi|Simoncini|Vitaioli|Benedettini|Bacciocchi|Cevoli|Venerucci|Golinucci|Battistini|Crescentini|Cervellini|Francini|Zafferani|Lonfernini|Ugolini|Pasolini|Terenzi|Gualtieri|Rossi|Canti|Morri|Rinaldi|Fabbri",
);

const SAN_MARINO: NationSpec = {
  code: "SM",
  iso2: "SM",
  name: "San Marino",
  confederation: "UEFA",
  continent: "EU",
  capital: "Città di San Marino",
  latitude: 43.9,
  languages: [{ code: "it", weight: 1 }],
  reputation: { national: 8, league: 12 },
  euEea: false,
  physique: { height: 180 },
  names: { given: sources("faker:it=1"), family: sources("faker:it=0.7 sammarinese=0.3") },
  nationality: {
    multipleRate: 0.3,
    tripleRate: 0.02,
    bornAbroadRate: 0.25,
    diasporaPull: 0.6,
    links: [...links("crossBorder", "IT:10 FR:0.5"), ...links("americas", "AR:1 US:0.5")],
    citizenship: { dual: "allowed" },
  },
  cities: {
    major: cityRows(`
Serravalle|town|Serravalle|5|Dogana,Falciano,Cà Ragni,Rovereta
Borgo Maggiore|town|Borgo Maggiore|2|Cailungo,Ventoso
Città di San Marino|town|San Marino|2|Murata,Santa Mustiola
Domagnano|town|Domagnano|2|Torraccia
Fiorentino|town|Fiorentino|1
Acquaviva|town|Acquaviva|1
Faetano|town|Faetano|1
Chiesanuova|town|Chiesanuova|1
Montegiardino|town|Montegiardino|1
`),
  },
  football: {
    leagues: [
      {
        // Real format: one table of 16, then play-offs for the title.
        tier: 1,
        name: "Campionato Sammarinese",
        shortName: "Campionato",
        size: 16,
        status: "amateur",
        reputation: 12,
        championship: { positions: [1, 4], legs: 1, finalLegs: 1, neutralFinal: true },
        clubs: {
          reputation: span(24, 12),
          capacity: span(7_000, 300),
          facilities: span(30, 12),
          academy: span(25, 10),
          wageBill: span(250_000, 20_000),
          transferBudget: span(10_000, 1_000),
          foreignShare: 0.35,
          squadSize: [25, 28],
        },
      },
    ],
    movement: [],
    cups: [
      { kind: "national", name: "Coppa Titano", legs: 1, neutralFinal: true, continental: true },
      { kind: "super", name: "Supercoppa Sammarinese", participants: ["champion", "cup-winner"], neutralFinal: true },
    ],
    youth: {
      U19: { divisions: [division("Campionato Juniores", [1, 1], 16)] },
      U17: { divisions: [division("Campionato Allievi", [1, 1], 16)] },
    },
    reserves: { mode: "none" },
    clubNaming: {
      templates: templates(`
SS {city}|6
SP {city}|5
AC {city}|4
FC {city}|4
SC {city}|3
{city} Calcio|2
`),
      founded: { top: [1949, 1975], bottom: [1960, 2010] },
      shortName: "city",
      avoid: list(`
SS Folgore Falciano|SP Tre Fiori|SP Tre Penne|SS Virtus|SS Murata|SS Cosmos|AC Libertas|SC Faetano|FC Domagnano|SS Pennarossa|
SP Cailungo|AC Juvenes/Dogana|Juvenes Dogana|SS Fiorentino|FC Fiorentino|SP La Fiorita|SS San Giovanni|FC Chiesanuova|AC Virtus|
San Marino Calcio|Victor San Marino|
`),
      colors: ["#5EB6E4", "#FFFFFF", "#000000", "#E30613", "#FFD700"],
    },
    importSources: codes("IT:20 AR:0.5 AL:0.4 RO:0.3 MA:0.2"),
    // UEFA association season points 2020/21 … 2024/25 (UEFA 2025 country ranking).
    coefficients: { association: [0.5, 0.166, 0.833, 0.333, 0.666], season2025: 0.833 },
  },
};

// ------------------------------------------------------------------ Malta

const MALTESE = pool(
  "maltese",
  "Matthew|Luke|Joseph|Daniel|Mark|Ryan|Andrew|Karl|Shaun|Michael|Paul|Nathan|Jean|Kurt|Clayton|Zach|Jurgen|Steve|Nicholas|Alexander|Teddy|Enrico|Jake|Juan|Yannick|Kemar|Brandon|Cain|Dunstan|Gianluca|Jodi|Kyle|Luca|Miguel|Neil|Roderick|Samuel|Terence|Trent|Zachary|Aidan|Carl|Dale|Emanuel|Gabriel|Isaac|James|Jonathan|Julian|Keith|Liam|Marcus|Myles|Owen|Rowen|Sean|Thomas|Timothy|Nigel|Jeremy",
  "Borg|Camilleri|Vella|Farrugia|Zammit|Galea|Micallef|Azzopardi|Attard|Spiteri|Abela|Cassar|Grech|Mifsud|Pace|Caruana|Debono|Muscat|Agius|Bonello|Fenech|Mizzi|Sammut|Schembri|Zerafa|Cutajar|Bugeja|Busuttil|Calleja|Cini|Cachia|Ellul|Formosa|Gatt|Gauci|Refalo|Saliba|Tabone|Xuereb|Zahra|Aquilina|Apap|Axisa|Bartolo|Bezzina|Bonnici|Brincat|Buhagiar|Buttigieg|Camenzuli|Chetcuti|Ciantar|Cilia|Degabriele|Delia|Dimech|Falzon|Frendo|Gafa|Gera|Magri|Mallia|Mamo|Mangion|Mercieca|Pisani|Portelli|Psaila|Sciberras|Scicluna|Sultana|Tanti|Vassallo|Zarb|Baldacchino|Balzan|Bajada|Bondin|Briffa|Calafato|Carabott|Cardona|Casha|Cauchi|Coleiro|Curmi|Darmanin|Demicoli|Desira|Dingli|Ebejer|Fsadni|Galdes|Grixti|Hili|Montebello|Mugliette|Pulis|Rapa|Sant|Stivala|Tonna|Xerri",
);

const MALTA: NationSpec = {
  code: "MT",
  iso2: "MT",
  name: "Malta",
  confederation: "UEFA",
  continent: "EU",
  capital: "Valletta",
  latitude: 35.9,
  languages: [{ code: "mt", weight: 0.9 }, { code: "en", weight: 0.1 }],
  reputation: { national: 18, league: 24 },
  euEea: true,
  physique: { height: 179 },
  names: { given: sources("maltese=1"), family: sources("maltese=1") },
  nationality: {
    multipleRate: 0.2,
    tripleRate: 0.02,
    bornAbroadRate: 0.08,
    diasporaPull: 0.5,
    links: [...links("commonwealth", "EN:6 AU:5 CA:1"), ...links("mediterranean", "IT:4 LY:0.5 TN:0.4")],
    citizenship: { dual: "allowed" },
  },
  cities: {
    major: cityRows(`
Birkirkara|town|Central|2
Qormi|town|Southern Harbour|1
Mosta|town|Northern|1
Żabbar|town|Southern Harbour|1
Sliema|town|Northern Harbour|1
Valletta|town|Southern Harbour|1
Floriana|town|Southern Harbour|1
Ħamrun|town|Northern Harbour|1
Paola|town|Southern Harbour|1
Marsaxlokk|town|South Eastern|1
Żebbuġ|town|Western|1
Gżira|town|Northern Harbour|1
Naxxar|town|Northern|1
Balzan|town|Central|1
Rabat|town|Western|1
Victoria|town|Gozo|1
Fgura|town|Southern Harbour|1
Żejtun|town|South Eastern|1
`),
  },
  football: {
    leagues: [
      {
        tier: 1,
        name: "Maltese Premier League",
        shortName: "Premier League",
        size: 12,
        status: "semi-professional",
        reputation: 24,
        split: {
          groups: [
            { name: "Championship pool", positions: [1, 6], roundRobins: 1, points: "full" },
            { name: "Relegation pool", positions: [7, 12], roundRobins: 1, points: "full" },
          ],
        },
        clubs: {
          reputation: span(34, 20),
          capacity: span(16_000, 800),
          facilities: span(40, 18),
          academy: span(36, 16),
          wageBill: span(3_000_000, 250_000),
          transferBudget: span(250_000, 5_000),
          foreignShare: 0.45,
          squadSize: [25, 28],
        },
      },
    ],
    movement: [],
    cups: [
      { kind: "national", name: "FA Trophy", legs: 1, neutralFinal: true, continental: true },
      { kind: "super", name: "Maltese Super Cup", participants: ["champion", "cup-winner"], neutralFinal: true },
    ],
    youth: {
      U19: { divisions: [division("Malta U19 League", [1, 1], 12)] },
      U17: { divisions: [division("Malta U17 League", [1, 1], 12)] },
    },
    reserves: { mode: "none" },
    clubNaming: {
      templates: templates(`
{city} FC|10
{city} United|4
{city} Athletic|3
{city} Rangers|3
{city} Hibernians|1.5
{city} Wanderers|1.5
{city} City|1.5
{city} Spartans|1
St. {city}|0.5
`),
      founded: { top: [1885, 1950], bottom: [1900, 2005] },
      shortName: "city",
      avoid: list(`
Ħamrun Spartans|Hamrun Spartans|Valletta FC|Floriana FC|Birkirkara FC|Hibernians|Sliema Wanderers|Gżira United|Gzira United|
Marsaxlokk FC|Żabbar St. Patrick|Mosta FC|Balzan FC|Naxxar Lions|Żebbuġ Rangers|Zebbug Rangers|Tarxien Rainbows|Qormi FC|
Sirens FC|Pietà Hotspurs|Mellieħa SC|Senglea Athletic|Żejtun Corinthians|Fgura United|Gudja United|Santa Lucia FC|Paola Hibernians|
Rabat Ajax|Victoria Hotspurs|St. Andrews|Swieqi United|Lija Athletic|Msida St. Joseph|
`),
      colors: ["#E30613", "#FFFFFF", "#006633", "#003DA5", "#FFD700", "#000000"],
    },
    importSources: codes(
      "BR:5 IT:4 AR:2 RS:2 EN:2 NG:2 ES:1.5 PT:1.5 CO:1.2 FR:1 GH:1 SN:1 CI:1 ME:1 MK:0.8 HR:0.8 BA:0.6 AL:0.6 BG:0.6 RO:0.6 UA:0.5 GE:0.5 VE:0.6 UY:0.5 AU:0.5 LY:0.4 TN:0.4",
    ),
    // UEFA association season points 2020/21 … 2024/25 (UEFA 2025 country ranking).
    coefficients: { association: [1.5, 1.875, 2.625, 1.5, 1.0], season2025: 2.0 },
  },
};

export const UEFA_WEST_B: Pick<CatalogFileData, "nations" | "namePools" | "realClubNames"> = {
  nations: [FRANCE, ITALY, GREECE, CYPRUS, SAN_MARINO, MALTA],
  namePools: [GREEK, SAMMARINESE, MALTESE],
};
