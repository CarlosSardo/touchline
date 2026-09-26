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
import { UEFA_WEST_B } from "./uefa-west-b.ts";

// Owner: catalog author "uefa-west" — ES PT FR IT GR CY AD SM MT GI (validate.ts CATALOG_ASSIGNMENT).
// Real 2025/26 structures and names without sponsors; clubs are generated. Money is GBP.

const list = (names: string) =>
  names.split("|").map((name) => name.trim()).filter(Boolean);
const pool = (name: string, given: string, family: string): NamePool => ({
  id: `uefa-west/${name}`,
  ...(given.trim() ? { given: list(given) } : {}),
  ...(family.trim() ? { family: list(family) } : {}),
});
/** "portuguese=0.8 faker:pt_PT=0.2": bare names are pools of this file. */
const sources = (spec: string): WeightedNameSource[] =>
  spec.trim().split(/\s+/).map((entry) => {
    const [name, weight] = entry.split("=");
    const source = (name.includes(":") ? name : `pool:uefa-west/${name}`) as WeightedNameSource["source"];
    return { source, weight: Number(weight) };
  });
/** "BR:10 CV:8" */
const codes = (spec: string): WeightedCode[] =>
  spec.trim().split(/\s+/).map((entry) => {
    const [code, weight] = entry.split(":");
    return { code, weight: Number(weight) };
  });
const links = (context: MigrationContext, spec: string): HeritageLink[] =>
  codes(spec).map((entry) => ({ ...entry, context }));
const span = (top: number, bottom: number): Span => ({ top, bottom });
/** One city per line: "name|size|region|maxClubs|district,district". */
function cityRows(rows: string): CitySpec[] {
  return rows.trim().split("\n").map((row) => {
    const [name, size, region, max, districts] = row.split("|").map((field) => field.trim());
    return {
      name,
      size: size as CitySize,
      region,
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

// ------------------------------------------------------------------ Portugal

const PORTUGUESE = pool(
  "portuguese",
  "Abel|Adriano|Afonso|Albano|Alberto|Alexandre|Álvaro|Amadeu|André|Ângelo|Anselmo|António|Armando|Artur|Belmiro|Bernardo|Bruno|Carlos|César|Cláudio|Cristiano|Custódio|Daniel|David|Dinis|Diogo|Domingos|Duarte|Edgar|Eduardo|Emanuel|Ernesto|Fábio|Fernando|Filipe|Flávio|Francisco|Frederico|Gabriel|Gaspar|Gil|Gilberto|Gonçalo|Guilherme|Gustavo|Hélder|Henrique|Hernâni|Horácio|Hugo|Humberto|Igor|Ivo|Jaime|João|Joaquim|Jorge|José|Júlio|Leandro|Leonardo|Lourenço|Lucas|Luís|Manuel|Marco|Márcio|Mário|Martim|Mateus|Mauro|Miguel|Moisés|Nélson|Norberto|Nuno|Orlando|Óscar|Otávio|Paulo|Pedro|Rafael|Raul|Renato|Ricardo|Roberto|Rodrigo|Rogério|Rolando|Romeu|Rúben|Rui|Salvador|Samuel|Sandro|Santiago|Sebastião|Sérgio|Silvestre|Simão|Telmo|Tiago|Tomás|Tomé|Valter|Vasco|Vicente|Vítor|Xavier|Jordão|Kevin|Wilson|Dário|Fausto|Gervásio",
  "Silva|Santos|Ferreira|Pereira|Oliveira|Costa|Rodrigues|Martins|Jesus|Sousa|Fernandes|Gonçalves|Gomes|Lopes|Marques|Alves|Almeida|Ribeiro|Pinto|Carvalho|Teixeira|Moreira|Correia|Mendes|Nunes|Soares|Vieira|Monteiro|Cardoso|Rocha|Raposo|Neves|Coelho|Cruz|Cunha|Pires|Ramos|Reis|Simões|Antunes|Matos|Fonseca|Machado|Araújo|Barbosa|Tavares|Lourenço|Castro|Figueiredo|Azevedo|Freitas|Henriques|Magalhães|Batista|Brito|Campos|Carneiro|Duarte|Esteves|Faria|Guerreiro|Leal|Lima|Loureiro|Macedo|Madeira|Maia|Morais|Mota|Nogueira|Pacheco|Paiva|Pinheiro|Quaresma|Queirós|Rebelo|Sá|Salgado|Sampaio|Seabra|Sequeira|Serrano|Valente|Vasconcelos|Vaz|Veloso|Vidal|Abreu|Amaral|Amorim|Andrade|Aguiar|Barros|Bastos|Bento|Borges|Branco|Brandão|Caldeira|Calado|Couto|Dias|Domingues|Estrela|Falcão|Feliciano|Frade|Franco|Gaspar|Godinho|Horta|Jardim|Lacerda|Leite|Lemos|Lobo|Louro|Luz|Mesquita|Miranda|Moura|Nascimento|Pedrosa|Peixoto|Pestana|Portela|Prata|Rosário|Sardinha|Semedo|Serra|Soeiro|Torres|Trindade|Varela|Ventura|Xavier|Galvão|Garrido|Cabral|Vilela|Sobral|Resende|Sarmento|Barroso|Meireles|Coutinho",
);

/** "do"/"da" before city names with an article ({of} club-name token); other cities take "de". */
const PT_PREPOSITION: Record<string, string> = {
  Porto: "do", Funchal: "do", Barreiro: "do", Seixal: "do", Montijo: "do",
  Amadora: "da", Maia: "da", Covilhã: "da", Guarda: "da", "Póvoa de Varzim": "da", "Figueira da Foz": "da",
  "Marinha Grande": "da",
};

const PORTUGAL: NationSpec = {
  code: "PT",
  iso2: "PT",
  name: "Portugal",
  confederation: "UEFA",
  continent: "EU",
  capital: "Lisboa",
  latitude: 39.5,
  languages: [{ code: "pt", weight: 1 }],
  reputation: { national: 88, league: 80 },
  euEea: true,
  physique: { height: 180 },
  names: {
    given: sources("portuguese=0.8 faker:pt_PT=0.2"),
    family: sources("portuguese=0.8 faker:pt_PT=0.2"),
    secondFamilyRate: 0.2,
    mononymRate: 0.07,
  },
  nationality: {
    multipleRate: 0.3,
    tripleRate: 0.06,
    bornAbroadRate: 0.09,
    diasporaPull: 0.55,
    links: [
      ...links("lusophone", "CV:10 AO:9 BR:8 GW:6 MZ:3 ST:3 ZA:1"),
      ...links("crossBorder", "FR:6 CH:3 LU:3 ES:2 DE:1.5 EN:1.2 UA:1 RO:0.8 MD:0.5"),
      ...links("americas", "VE:1.5 US:0.5 CA:0.5"),
    ],
    citizenship: { dual: "allowed" },
  },
  cities: {
    // Regions are the NUTS II regions (youth series are regional: Norte, Centro, Sul, islands).
    major: cityRows(`
Lisboa|mega|Lisboa|5|Ajuda,Alcântara,Areeiro,Arroios,Campo de Ourique,Campolide,Carnide,Lumiar,Marvila,Olivais,Parque das Nações,Penha de França
Porto|large|Norte|3|Campanhã,Paranhos,Ramalde,Foz do Douro,Bonfim,Lordelo do Ouro,Aldoar
Vila Nova de Gaia|large|Norte|2|Canidelo,Oliveira do Douro,Avintes,Valadares
Braga|large|Norte|2|Maximinos,São Victor,Lamaçães,Gualtar
Amadora|medium|Lisboa|1
Coimbra|medium|Centro|2|Eiras,Olivais,São Martinho do Bispo
Funchal|medium|Madeira|2|São Martinho,Santo António,Monte
Setúbal|medium|Lisboa|1
Almada|medium|Lisboa|1
Guimarães|medium|Norte|2|Azurém,Creixomil,Urgezes
Sintra|medium|Lisboa|1
Loures|medium|Lisboa|1
Matosinhos|medium|Norte|1
Odivelas|medium|Lisboa|1
Seixal|medium|Lisboa|1
Cascais|medium|Lisboa|2|Parede,Carcavelos,Alcabideche
Oeiras|medium|Lisboa|1
Maia|medium|Norte|1
Gondomar|medium|Norte|1
Barreiro|medium|Lisboa|1
Vila Franca de Xira|medium|Lisboa|1
Aveiro|medium|Centro|1
Viseu|medium|Centro|1
Leiria|medium|Centro|1
Faro|medium|Algarve|1
Ponta Delgada|medium|Açores|1
Póvoa de Varzim|small|Norte|1
Vila do Conde|small|Norte|1
Vila Nova de Famalicão|small|Norte|1
Barcelos|small|Norte|1
Viana do Castelo|small|Norte|1
Santo Tirso|small|Norte|1
Penafiel|small|Norte|1
Felgueiras|small|Norte|1
Paredes|small|Norte|1
Chaves|small|Norte|1
Bragança|small|Norte|1
Vila Real|small|Norte|1
Santa Maria da Feira|small|Norte|1
Oliveira de Azeméis|small|Norte|1
Figueira da Foz|small|Centro|1
Castelo Branco|small|Centro|1
Covilhã|small|Centro|1
Guarda|small|Centro|1
Torres Vedras|small|Centro|1
Caldas da Rainha|small|Centro|1
Santarém|small|Centro|1
Évora|small|Alentejo|1
Beja|small|Alentejo|1
Portimão|small|Algarve|1
Loulé|small|Algarve|1
Mafra|small|Lisboa|1
Montijo|small|Lisboa|1
Paços de Ferreira|town|Norte|1
Vizela|town|Norte|1
São João da Madeira|town|Norte|1
Espinho|town|Norte|1
Fafe|town|Norte|1
Tondela|town|Centro|1
Marinha Grande|town|Centro|1
Alcobaça|town|Centro|1
Torres Novas|town|Centro|1
Abrantes|town|Centro|1
Portalegre|town|Alentejo|1
Elvas|town|Alentejo|1
Olhão|town|Algarve|1
Lagos|town|Algarve|1
Tavira|town|Algarve|1
Machico|town|Madeira|1
Câmara de Lobos|town|Madeira|1
Angra do Heroísmo|town|Açores|1
`).map((city) => (PT_PREPOSITION[city.name] ? { ...city, preposition: PT_PREPOSITION[city.name] } : city)),
  },
  football: {
    leagues: [
      {
        tier: 1,
        name: "Liga Portugal",
        shortName: "Liga Portugal",
        size: 18,
        status: "professional",
        reputation: 78,
        clubs: {
          reputation: span(76, 57),
          giants: { count: 3, top: 86, bottom: 83 },
          capacity: span(64_600, 4_500),
          facilities: span(93, 50),
          academy: span(93, 48),
          wageBill: span(95_000_000, 3_000_000),
          transferBudget: span(60_000_000, 150_000),
          foreignShare: 0.62,
          squadSize: [26, 30],
        },
      },
      {
        tier: 2,
        name: "Liga Portugal 2",
        shortName: "Liga 2",
        size: 18,
        status: "professional",
        reputation: 57,
        bTeams: 3,
        clubs: {
          reputation: span(57, 43),
          capacity: span(16_000, 2_000),
          facilities: span(62, 36),
          academy: span(64, 34),
          wageBill: span(6_000_000, 700_000),
          transferBudget: span(1_500_000, 20_000),
          foreignShare: 0.45,
          squadSize: [25, 29],
        },
      },
      {
        // Real: Série A (north) and Série B (south) of 10, then an 8-team promotion phase and relegation phases.
        tier: 3,
        name: "Liga 3",
        shortName: "Liga 3",
        size: 20,
        status: "semi-professional",
        reputation: 42,
        bTeams: 1,
        clubs: {
          reputation: span(45, 33),
          capacity: span(20_000, 1_000),
          facilities: span(46, 26),
          academy: span(50, 26),
          wageBill: span(1_600_000, 200_000),
          transferBudget: span(150_000, 0),
          foreignShare: 0.28,
          squadSize: [25, 27],
        },
      },
    ],
    movement: [
      { upper: 1, promoted: 2, relegated: 2, playoffs: [{ type: "cross-tier", upperPositions: [16], lowerPositions: [3], legs: 2 }] },
      { upper: 2, promoted: 2, relegated: 2, playoffs: [{ type: "cross-tier", upperPositions: [16], lowerPositions: [3], legs: 2 }] },
    ],
    cups: [
      // Semi-finals are two-legged in reality; the final is at the Jamor.
      { kind: "national", name: "Taça de Portugal", seededEntry: true, legs: 1, neutralFinal: true, continental: true },
      // Liga Portugal clubs only since 2024/25; Final Four at a neutral venue.
      { kind: "league", name: "Taça da Liga", tiers: [1], legs: 1, neutralFinal: true },
      { kind: "super", name: "Supertaça Cândido de Oliveira", shortName: "Supertaça", participants: ["champion", "cup-winner"], neutralFinal: true, start: "07-31" },
    ],
    youth: {
      U19: {
        divisions: [
          division("Campeonato Nacional de Juniores A", [1, 1], 9, "Série Norte|Série Sul"),
          division("Campeonato Nacional de Juniores A 2.ª Divisão", [2, 3], 12, "Série Norte|Série Centro|Série Sul"),
        ],
      },
      U17: {
        divisions: [
          division("Campeonato Nacional de Juniores B", [1, 1], 9, "Série Norte|Série Sul"),
          division("Campeonato Nacional de Juniores B 2.ª Divisão", [2, 3], 12, "Série Norte|Série Centro|Série Sul"),
        ],
      },
    },
    reserves: {
      mode: "pyramid",
      nameTemplate: "{club} B",
      // Benfica, Porto and Sporting B in Liga 2; Braga B in Liga 3 (2025/26).
      eligibility: { parentTiers: [1], minReputation: 72, maxTeams: 4 },
      pyramid: { highestTier: 2, minGapBelowParent: 1, maxPerTier: 3 },
      ageRule: { maxAge: 23, overage: 3 },
      squad: [22, 30],
    },
    clubNaming: {
      templates: templates(`
SC {city}|14
FC {city}|14
GD {city}|9
CD {city}|9
{city} SC|5
{city} FC|5
UD {city}|4
AD {city}|4
União {of} {city}|3
Sporting {of} {city}|2
Académico {of} {city}|1.5
Atlético {of} {city}|1.5
Clube Desportivo {of} {city}|1|2,3
Grupo Desportivo {of} {city}|1|2,3
`),
      founded: { top: [1893, 1925], bottom: [1908, 2012] },
      shortName: "city",
      avoid: list(
        "Sporting de Lisboa|Sporting Lisboa|Sporting Clube de Portugal|Sporting CP|Sporting de Portugal|Académico do Porto|Académico FC|Académica de Coimbra|Académico de Coimbra|União de Coimbra|Académico de Viseu|União de Leiria|União da Madeira|União de Tomar|União de Lamas|União de Santarém|Atlético Clube de Portugal|Atlético CP|Sporting da Covilhã|Sporting de Covilhã|Sporting de Pombal|Sporting de Faro|Sporting de Olhão|Sporting de Viana do Castelo|Sporting de Mirandela|Sporting da Marinha Grande|Sporting de Salgueiros|Salgueiros|SC Farense|Farense|SC Olhanense|Olhanense|Sporting de Espinho|FC Porto|SC Braga|Sporting de Braga|Vitória de Guimarães|Vitória de Setúbal|Vitória SC|Vitória FC|GD Chaves|CD Tondela|CD Mafra|CD Santa Clara|CD Montijo|FC Famalicão|FC Vizela|FC Penafiel|FC Paços de Ferreira|FC Felgueiras|FC Arouca|FC Alverca|FC Maia|FC Amarante|SC Espinho|Sporting de Espinho|SC Covilhã|Sporting de Covilhã|Sporting da Covilhã|SC Vila Real|GD Bragança|GD Estoril|Estoril Praia|AD Fafe|UD Leiria|União de Leiria|União de Santarém|União de Coimbra|União de Tomar|União da Madeira|Académico de Viseu|Académico de Coimbra|Académica de Coimbra|Estrela da Amadora|Leixões SC|Varzim SC|Atlético de Portugal|SC Beira-Mar|FC Barreirense|SC Olhanense|SC Farense|CD Nacional|CS Marítimo|Moreirense FC|Rio Ave FC|Gil Vicente FC|Casa Pia AC|Boavista FC|SL Benfica|Sporting CP|Belenenses",
      ),
      colors: ["#E30613", "#00428C", "#00805A", "#FFFFFF", "#000000", "#C8102E", "#FFD100", "#1E3A8A", "#7B1E1E", "#006B3F"],
    },
    importSources: codes(
      "BR:22 CV:3 AO:3 GW:2 MZ:1 ST:0.5 ES:3 FR:3 AR:3 UY:3 CO:3 VE:1.5 PY:1 EC:1 CL:0.8 PE:0.5 MX:1 US:1 CA:0.8 CR:0.5 NG:2 GH:2 CI:1.5 SN:1.5 CM:1.5 CD:1 GN:1 ML:1 MA:1 DZ:0.5 TN:0.5 JP:2 KR:0.5 IR:0.5 AU:0.5 NL:1 BE:1 SE:1 DK:1 NO:1 UA:1 RS:1 HR:1 GE:1 PL:1 IT:1 DE:1 EN:0.8 CH:0.5",
    ),
    // UEFA association season points 2020/21..2024/25 (UEFA 2025 country ranking).
    coefficients: { association: [9.6, 12.916, 12.5, 11.0, 16.25], season2025: 20.5 },
  },
};

// ------------------------------------------------------------------ Spain

const SPANISH = pool(
  "spanish",
  "Álvaro|Pablo|Sergio|Adrián|Javier|Iván|Rubén|Raúl|Marcos|Hugo|Mario|Diego|Alejandro|Carlos|Daniel|David|Jorge|Óscar|Víctor|Fernando|Gonzalo|Ignacio|Jesús|Juan|Luis|Manuel|Miguel|Rodrigo|Samuel|Saúl|Borja|Francisco|Rafael|Antonio|José|Alberto|Andrés|Ángel|Enrique|Eduardo|Gabriel|Guillermo|Héctor|Jaime|Joaquín|Julián|Lucas|Martín|Mateo|Nicolás|Pedro|Ricardo|Roberto|Santiago|Tomás|Vicente|Alonso|Bruno|Dani|Fran|Rafa|Nacho|Álex|Toni|Juanmi|Chema|Iñigo|Aarón|Marco|Izan|Asensio|Cristian|Unai|Aleix",
  "García|Fernández|González|Rodríguez|López|Martínez|Sánchez|Pérez|Gómez|Martín|Jiménez|Hernández|Ruiz|Díaz|Moreno|Muñoz|Álvarez|Romero|Gutiérrez|Alonso|Navarro|Torres|Domínguez|Ramos|Vázquez|Gil|Serrano|Ramírez|Molina|Blanco|Suárez|Morales|Ortega|Delgado|Castro|Ortiz|Rubio|Marín|Sanz|Núñez|Iglesias|Medina|Garrido|Cortés|Castillo|Santos|Lozano|Guerrero|Cano|Prieto|Méndez|Cruz|Calvo|Gallego|Herrera|Márquez|León|Peña|Flores|Cabrera|Campos|Vega|Fuentes|Carrasco|Díez|Caballero|Reyes|Nieto|Aguilar|Pascual|Santana|Herrero|Montero|Lorenzo|Hidalgo|Giménez|Ibáñez|Durán|Benítez|Mora|Vicente|Vargas|Arias|Carmona|Crespo|Román|Pastor|Soto|Sáez|Velasco|Moya|Parra|Esteban|Bravo|Gallardo|Pardo|Merino|Franco|Espinosa|Izquierdo|Lara|Rivas|Rivera|Casado|Arroyo|Redondo|Camacho|Vera|Luque|Galán|Montes|Ríos|Sierra|Carrillo|Soriano|Mendoza|Robles|Bernal|Salas|Quintana|Barrios|Pozo|Toledo|Mateo|Cuesta|Rico|Heredia|Aranda|Padilla|Mesa|Valero|Beltrán|Ávila|Ponce|Maldonado|Cordero|Bermúdez|Carvajal|Villalba|Cuenca|Jurado",
);
const CATALAN = pool(
  "catalan",
  "Jordi|Pau|Marc|Oriol|Arnau|Pol|Joan|Josep|Xavi|Sergi|Gerard|Albert|Jaume|Lluís|Ferran|Miquel|Martí|Roger|Guillem|Eric|Aleix|Adrià|Bernat|Nil|Biel|Quim|Jan|Dídac|Enric|Carles|Ramon|Pere|Isaac|Genís|Bru|Àlex|Xavier|Llorenç|Jofre|Roc",
  "Puig|Vidal|Soler|Ferrer|Font|Roca|Serra|Vila|Pujol|Costa|Riera|Sala|Batlle|Casals|Coll|Mas|Prat|Bosch|Camps|Farré|Figueras|Garriga|Grau|Llorens|Mir|Montserrat|Oliva|Planas|Pons|Rovira|Sabaté|Tarrés|Torra|Vendrell|Bonet|Busquets|Puyol|Bartra|Solé|Valls|Marsal|Masip|Canals|Guardiola|Cucurella|Pedrosa|Capdevila|Xicola|Ribas|Balcells",
);
const BASQUE = pool(
  "basque",
  "Iker|Aitor|Unai|Asier|Mikel|Ander|Gorka|Iñaki|Jon|Xabier|Ibai|Oier|Julen|Urko|Eneko|Beñat|Aritz|Iñigo|Oihan|Peru|Markel|Ekaitz|Gaizka|Aimar|Imanol|Josu|Koldo|Endika|Ager|Ion|Unax|Harkaitz|Aingeru|Iban|Eñaut|Andoni",
  "Etxeberria|Agirre|Garmendia|Zubizarreta|Aranburu|Larrañaga|Goikoetxea|Arrizabalaga|Olaizola|Iturralde|Mendizabal|Urrutia|Ibarra|Elizondo|Zabala|Uriarte|Bengoetxea|Arana|Lasa|Oiarzabal|Aldekoa|Berasategi|Zubeldia|Arteta|Susaeta|Gurrutxaga|Olabe|Esnal|Ugarte|Egiluz|Iraola|Lekue|Mendia|Larrea|Etxebarria|Ansotegi|Aranzabal|Gorostidi|Imaz|Irureta|Jauregi|Lizarazu|Mugika|Narbaiza|Otxoa|Sagarna|Urkiza|Zarraga|Zuloaga|Azpilikueta",
);
const GALICIAN = pool(
  "galician",
  "Iago|Brais|Xoán|Anxo|Uxío|Martiño|Xurxo|Roi|Breixo|Antón|Xosé|Iván|Borja|Lois|Fiz|Tomé|Bieito|Alexandre|Denís|Xabier|Adrián|Diego|Pablo|Hugo",
  "Otero|Rey|Varela|Pazos|Souto|Lema|Seoane|Carballo|Veiga|Bouzas|Freire|Barreiro|Lamas|Pereiro|Sanmartín|Mosquera|Couto|Loureiro|Nogueira|Outeiral|Piñeiro|Rodas|Bouzón|Cancela|Cortizo|Dopazo|Eiras|Fariña|Gándara|Losada|Mariño|Novo|Oubiña|Queiruga|Regueiro|Seijas|Toimil|Vilar|Vilanova|Abal|Carreira|Rial|Castro|Vázquez",
);

const SPAIN: NationSpec = {
  code: "ES",
  iso2: "ES",
  name: "Spain",
  confederation: "UEFA",
  continent: "EU",
  capital: "Madrid",
  latitude: 40.4,
  languages: [{ code: "es", weight: 0.8 }, { code: "ca", weight: 0.1 }, { code: "gl", weight: 0.05 }, { code: "eu", weight: 0.05 }],
  reputation: { national: 93, league: 91 },
  euEea: true,
  physique: { height: 180 },
  names: {
    given: sources("faker:es=0.45 spanish=0.43 catalan=0.05 basque=0.035 galician=0.035"),
    family: sources("faker:es=0.45 spanish=0.43 catalan=0.05 basque=0.035 galician=0.035"),
    secondFamilyRate: 0.1,
    mononymRate: 0.06,
    // Birthplace regions (about 16% Catalan, 6% Basque/Navarrese, 6% Galician and 13% Valencian/Balearic).
    regional: [
      { regions: ["Cataluña"], given: sources("catalan=0.5 spanish=0.25 faker:es=0.25"), family: sources("catalan=0.45 spanish=0.3 faker:es=0.25") },
      { regions: ["País Vasco", "Comunidad Foral de Navarra"], given: sources("basque=0.4 spanish=0.3 faker:es=0.3"), family: sources("basque=0.35 spanish=0.35 faker:es=0.3") },
      { regions: ["Galicia"], given: sources("galician=0.3 spanish=0.35 faker:es=0.35"), family: sources("galician=0.45 spanish=0.3 faker:es=0.25") },
      { regions: ["Comunidad Valenciana", "Illes Balears"], given: sources("catalan=0.25 spanish=0.4 faker:es=0.35"), family: sources("catalan=0.35 spanish=0.35 faker:es=0.3") },
    ],
  },
  nationality: {
    multipleRate: 0.26,
    tripleRate: 0.04,
    bornAbroadRate: 0.1,
    diasporaPull: 0.5,
    links: [
      ...links("mediterranean", "MA:10 GQ:2 DZ:1"),
      ...links("americas", "AR:7 CO:6 EC:6 DO:5 VE:4 UY:3 BR:3 PE:2 PY:1.5 BO:1.5 CU:1 MX:1 CL:1 HN:0.5"),
      ...links("regional", "GH:2 NG:2 SN:2 GN:1.5 GW:1.5 GM:1 CM:1 CI:1 ML:1"),
      ...links("crossBorder", "FR:5 PT:3 RO:3 DE:1 EN:1 CH:1 AD:1 BE:0.5 NL:0.5"),
    ],
    // Nationals by origin keep a birth-acquired second nationality; naturalization renunciation is not modeled.
    citizenship: { dual: "allowed" },
  },
  cities: {
    // Regions are the autonomous communities (Segunda/Primera Federación groups and youth groups are regional).
    major: cityRows(`
Madrid|mega|Comunidad de Madrid|8|Carabanchel,Usera,Tetuán,Hortaleza,Moratalaz,Villaverde,Latina,Fuencarral,Aluche,Vicálvaro,Canillejas,Barajas,Chamberí
Barcelona|mega|Cataluña|5|Gràcia,Les Corts,Sarrià,Poblenou,Nou Barris,Sant Gervasi,La Sagrera,Horta,Sant Martí,Guinardó
Valencia|large|Comunidad Valenciana|3|Benimaclet,Campanar,Ruzafa,Patraix,El Cabanyal,Benicalap
Sevilla|large|Andalucía|3|Triana,Macarena,Los Remedios,Bellavista,Pino Montano,Cerro del Águila
Zaragoza|large|Aragón|2|Delicias,Las Fuentes,Torrero,Actur
Málaga|large|Andalucía|2|Huelin,El Palo,Churriana,Teatinos
Murcia|medium|Región de Murcia|2
Palma|medium|Illes Balears|2
Las Palmas de Gran Canaria|medium|Canarias|2
Bilbao|medium|País Vasco|2|Deusto,Santutxu,Indautxu,Begoña,Basurto
Alicante|medium|Comunidad Valenciana|2
Valladolid|medium|Castilla y León|2
Vigo|medium|Galicia|2
Gijón|medium|Principado de Asturias|2
A Coruña|medium|Galicia|2
Córdoba|medium|Andalucía|1
L'Hospitalet de Llobregat|medium|Cataluña|1
Vitoria-Gasteiz|medium|País Vasco|1
Granada|medium|Andalucía|1
Elche|medium|Comunidad Valenciana|1
Oviedo|medium|Principado de Asturias|1
Badalona|medium|Cataluña|1
Cartagena|medium|Región de Murcia|1
Terrassa|medium|Cataluña|1
Jerez de la Frontera|medium|Andalucía|1
Sabadell|medium|Cataluña|1
Móstoles|medium|Comunidad de Madrid|1
Santa Cruz de Tenerife|medium|Canarias|1
Pamplona|medium|Comunidad Foral de Navarra|1
Almería|medium|Andalucía|1
Alcalá de Henares|medium|Comunidad de Madrid|1
Fuenlabrada|medium|Comunidad de Madrid|1
Leganés|medium|Comunidad de Madrid|1
Getafe|medium|Comunidad de Madrid|1
Donostia|medium|País Vasco|1
Burgos|medium|Castilla y León|1
Santander|medium|Cantabria|1
Castellón|medium|Comunidad Valenciana|1
Albacete|medium|Castilla-La Mancha|1
Alcorcón|medium|Comunidad de Madrid|1
Logroño|medium|La Rioja|1
Badajoz|medium|Extremadura|1
Salamanca|medium|Castilla y León|1
Huelva|medium|Andalucía|1
Marbella|small|Andalucía|1
Lleida|small|Cataluña|1
Tarragona|small|Cataluña|1
León|small|Castilla y León|1
Cádiz|small|Andalucía|1
Jaén|small|Andalucía|1
Ourense|small|Galicia|1
Girona|small|Cataluña|1
Lugo|small|Galicia|1
Cáceres|small|Extremadura|1
Algeciras|small|Andalucía|1
Santiago de Compostela|small|Galicia|1
Talavera de la Reina|small|Castilla-La Mancha|1
Guadalajara|small|Castilla-La Mancha|1
Toledo|small|Castilla-La Mancha|1
Ciudad Real|small|Castilla-La Mancha|1
Ponferrada|small|Castilla y León|1
Pontevedra|small|Galicia|1
Ferrol|small|Galicia|1
Zamora|small|Castilla y León|1
Palencia|small|Castilla y León|1
Segovia|small|Castilla y León|1
Huesca|small|Aragón|1
Teruel|small|Aragón|1
Soria|small|Castilla y León|1
Mérida|small|Extremadura|1
Linares|small|Andalucía|1
Motril|small|Andalucía|1
Antequera|small|Andalucía|1
Lorca|small|Región de Murcia|1
Orihuela|small|Comunidad Valenciana|1
Benidorm|small|Comunidad Valenciana|1
Torrevieja|small|Comunidad Valenciana|1
Gandia|small|Comunidad Valenciana|1
Alcoi|small|Comunidad Valenciana|1
Irun|small|País Vasco|1
Getxo|small|País Vasco|1
Barakaldo|small|País Vasco|1
Tudela|small|Comunidad Foral de Navarra|1
Avilés|small|Principado de Asturias|1
Torrelavega|small|Cantabria|1
Mataró|small|Cataluña|1
Reus|small|Cataluña|1
Manresa|small|Cataluña|1
Eivissa|small|Illes Balears|1
Manacor|town|Illes Balears|1
Ceuta|small|Ceuta|1
Melilla|small|Melilla|1
Arrecife|small|Canarias|1
Majadahonda|small|Comunidad de Madrid|1
Torrejón de Ardoz|small|Comunidad de Madrid|1
Pozuelo de Alarcón|small|Comunidad de Madrid|1
Écija|town|Andalucía|1
Lucena|town|Andalucía|1
Don Benito|town|Extremadura|1
Puertollano|town|Castilla-La Mancha|1
Eibar|town|País Vasco|1
Calahorra|town|La Rioja|1
Olot|town|Cataluña|1
`),
  },
  football: {
    leagues: [
      {
        tier: 1,
        name: "LaLiga",
        shortName: "LaLiga",
        size: 20,
        status: "professional",
        reputation: 92,
        clubs: {
          reputation: span(80, 66),
          giants: { count: 3, top: 95, bottom: 88 },
          capacity: span(83_000, 11_500),
          facilities: span(97, 62),
          academy: span(96, 60),
          wageBill: span(400_000_000, 22_000_000),
          transferBudget: span(150_000_000, 1_500_000),
          foreignShare: 0.4,
          squadSize: [25, 30],
        },
      },
      {
        tier: 2,
        name: "Segunda División",
        shortName: "Segunda",
        size: 22,
        status: "professional",
        reputation: 72,
        bTeams: 1,
        clubs: {
          reputation: span(66, 52),
          capacity: span(32_000, 4_000),
          facilities: span(76, 50),
          academy: span(78, 46),
          wageBill: span(20_000_000, 3_500_000),
          transferBudget: span(4_000_000, 50_000),
          foreignShare: 0.22,
          squadSize: [25, 29],
        },
      },
      {
        // Real: two regional groups of 20.
        tier: 3,
        name: "Primera Federación",
        shortName: "1ª RFEF",
        size: 40,
        status: "semi-professional",
        reputation: 55,
        conferences: ["Grupo 1", "Grupo 2"],
        bTeams: 6,
        clubs: {
          reputation: span(52, 40),
          capacity: span(26_000, 1_500),
          facilities: span(60, 34),
          academy: span(62, 34),
          wageBill: span(4_500_000, 500_000),
          transferBudget: span(300_000, 0),
          foreignShare: 0.12,
          squadSize: [25, 27],
        },
      },
      {
        // Real: five regional groups of 18 (90 clubs), merged into two conferences of 22.
        tier: 4,
        name: "Segunda Federación",
        shortName: "2ª RFEF",
        size: 44,
        status: "semi-professional",
        reputation: 42,
        conferences: ["Norte", "Sur"],
        bTeams: 8,
        clubs: {
          reputation: span(40, 28),
          capacity: span(12_000, 500),
          facilities: span(44, 20),
          academy: span(48, 20),
          wageBill: span(1_200_000, 120_000),
          transferBudget: span(60_000, 0),
          foreignShare: 0.08,
          squadSize: [25, 26],
        },
      },
    ],
    movement: [
      { upper: 1, promoted: 2, relegated: 3, playoffs: [{ type: "promotion", positions: [3, 6], places: 1, legs: 2, finalLegs: 2 }] },
      // Group champions up; 2nd-5th of each group play off (real pairings cross the groups).
      { upper: 2, promoted: 2, relegated: 4, perConference: true, playoffs: [{ type: "promotion", positions: [2, 5], places: 2, legs: 2 }] },
      // Real: bottom five of each group down; five champions plus five play-off winners (2nd-5th) up.
      { upper: 3, promoted: 6, relegated: 10, perConference: true, playoffs: [{ type: "promotion", positions: [4, 7], places: 4, legs: 2 }] },
    ],
    cups: [
      // Semi-finals are two-legged in reality; filiales cannot enter.
      { kind: "national", name: "Copa del Rey", seededEntry: true, legs: 1, neutralFinal: true, continental: true },
      { kind: "super", name: "Supercopa de España", shortName: "Supercopa", participants: ["champion", "runner-up", "cup-winner", "cup-runner-up"], legs: 1, neutralFinal: true, start: "01-07" },
    ],
    youth: {
      U19: {
        divisions: [
          division("División de Honor Juvenil", [1, 3], 16, "Grupo I|Grupo II|Grupo III|Grupo IV|Grupo V|Grupo VI|Grupo VII"),
          division("Liga Nacional Juvenil", [4, 4], 12, "Grupo I|Grupo II|Grupo III"),
        ],
        cup: { name: "Copa del Rey Juvenil" },
      },
      // No national U17 league: cadete divisions are run by the regional federations.
      U17: {
        divisions: [
          division("División de Honor Cadete", [1, 3], 16, "Grupo I|Grupo II|Grupo III|Grupo IV|Grupo V|Grupo VI|Grupo VII"),
          division("Primera División Cadete", [4, 4], 12, "Grupo I|Grupo II|Grupo III"),
        ],
      },
    },
    reserves: {
      mode: "pyramid",
      // Registered as "{club} B"; nicknames (Castilla, Atlètic, Mestalla, Fabril, Sanse) are not generated.
      nameTemplate: "{club} B",
      eligibility: { parentTiers: [1, 2], minReputation: 50, maxTeams: 16 },
      pyramid: { highestTier: 2, minGapBelowParent: 1, maxPerTier: 8 },
      ageRule: { maxAge: 23, overage: 4 },
      squad: [22, 30],
    },
    clubNaming: {
      templates: templates(`
CD {city}|12
UD {city}|10
{city} CF|10
SD {city}|7
CF {city}|6
Atlético {city}|5
Deportivo {city}|4
AD {city}|4
{city} FC|3
Real {city}|3|1,2,3
Racing {city}|2
Sporting {city}|1.5
Club Deportivo {city}|2|3,4
Unión Deportiva {city}|1.5|3,4
`),
      regional: [
        {
          regions: ["Cataluña"],
          templates: templates(`
CE {city}|12
UE {city}|8
CF {city}|6
FC {city}|6
{city} CF|4
Club Esportiu {city}|1|3,4
`),
        },
        {
          regions: ["País Vasco", "Comunidad Foral de Navarra"],
          templates: templates(`
SD {city}|10
CD {city}|8
{city} KE|3
UD {city}|3
{city} CF|3
Club Deportivo {city}|1|3,4
`),
        },
      ],
      founded: { top: [1889, 1930], bottom: [1905, 2015] },
      shortName: "city",
      avoid: list(
        "Club Deportivo A Coruña|Deportivo A Coruña|Deportivo La Coruña|Deportivo de La Coruña|RC Deportivo de La Coruña|Real Madrid|FC Barcelona|Atlético Madrid|Atlético de Madrid|Sevilla FC|Real Betis|Valencia CF|Villarreal CF|Real Sociedad|Athletic Club|CA Osasuna|Getafe CF|Rayo Vallecano|RCD Mallorca|RCD Espanyol|Deportivo Alavés|Girona FC|Celta de Vigo|Elche CF|Levante UD|Real Oviedo|UD Las Palmas|Cádiz CF|Granada CF|UD Almería|Real Valladolid|Málaga CF|Córdoba CF|CD Leganés|SD Eibar|Burgos CF|Racing Santander|Racing de Santander|Sporting Gijón|Sporting de Gijón|Albacete Balompié|CD Castellón|Real Zaragoza|SD Huesca|Deportivo A Coruña|Deportivo de La Coruña|CD Tenerife|FC Cartagena|Real Murcia|Hércules CF|CD Lugo|Cultural Leonesa|AD Ceuta|UD Ibiza|UD Eivissa|CD Ibiza|Real Unión|Pontevedra CF|Racing Ferrol|Racing de Ferrol|CE Sabadell|Terrassa FC|Gimnàstic de Tarragona|CF Reus|UE Olot|CE Manresa|CF Badalona|CE L'Hospitalet|CE Mataró|UE Lleida|Lleida Esportiu|AD Alcorcón|CF Fuenlabrada|CD Móstoles|RSD Alcalá|CF Talavera|CD Guadalajara|CD Toledo|UD Salamanca|Zamora CF|CF Palencia|CD Badajoz|AD Mérida|Linares Deportivo|Real Jaén|Recreativo de Huelva|Algeciras CF|Marbella FC|CD Antequera|Orihuela CF|CF Gandía|Benidorm CF|CD Lorca|Lorca FC|CD Calahorra|Barakaldo CF|CD Vitoria|Real Avilés|UD Melilla|CD Manacor|Real Burgos|SD Compostela|UD Ourense|CD Ourense|CD Teruel|CD Don Benito|CD Lucena|Motril CF|AD Torrejón|CF Pozuelo|Rayo Majadahonda|Gimnástica Segoviana|Gimnástica de Torrelavega|Real Balompédica Linense|CD Alcoyano|CD Eldense",
      ),
      colors: ["#FFFFFF", "#A50044", "#004D98", "#CB3524", "#00954C", "#FDB913", "#0067B1", "#E30613", "#000000", "#6F263D", "#1B4F9C", "#7AC143"],
    },
    importSources: codes(
      "AR:6 BR:6 FR:6 UY:4 PT:4 CO:3 MA:3 VE:2 EC:2 MX:2 PY:1.5 CL:1.5 NL:2 DE:2 BE:2 EN:2 IT:2 NG:2 GH:2 SN:2 CI:1.5 CM:1.5 GN:1 ML:1 GQ:1 DZ:1 JP:1.5 KR:1 US:1.5 GE:1 HR:1.5 RS:1.5 UA:1 PL:1 SE:1 DK:1 NO:1 CH:1 AT:1 TR:1 DO:1 HN:0.5 CR:0.5 PE:0.5 CD:0.5 CV:0.5 GW:0.5 AO:0.5",
    ),
    // UEFA association season points 2020/21..2024/25 (UEFA 2025 country ranking).
    coefficients: { association: [19.5, 18.428, 16.571, 16.062, 23.892], season2025: 22.093 },
  },
};

// ------------------------------------------------------------------ Andorra

const ANDORRA: NationSpec = {
  code: "AD",
  iso2: "AD",
  name: "Andorra",
  confederation: "UEFA",
  continent: "EU",
  capital: "Andorra la Vella",
  latitude: 42.5,
  languages: [{ code: "ca", weight: 0.6 }, { code: "es", weight: 0.25 }, { code: "pt", weight: 0.1 }, { code: "fr", weight: 0.05 }],
  reputation: { national: 12, league: 10 },
  euEea: false,
  physique: { height: 178 },
  names: {
    given: sources("catalan=0.45 spanish=0.3 portuguese=0.15 faker:fr=0.1"),
    family: sources("catalan=0.45 spanish=0.3 portuguese=0.15 faker:fr=0.1"),
    secondFamilyRate: 0.1,
  },
  nationality: {
    multipleRate: 0.3,
    tripleRate: 0.05,
    bornAbroadRate: 0.35,
    diasporaPull: 0.35,
    links: links("crossBorder", "ES:10 PT:6 FR:5"),
    // Andorran nationality law does not allow a second nationality.
    citizenship: { dual: "restricted" },
  },
  cities: {
    major: cityRows(`
Andorra la Vella|small|Andorra la Vella|3
Escaldes-Engordany|small|Escaldes-Engordany|3
Encamp|town|Encamp|2
Sant Julià de Lòria|town|Sant Julià de Lòria|2
La Massana|town|La Massana|1
Ordino|town|Ordino|1
Canillo|town|Canillo|1
`),
  },
  football: {
    leagues: [
      {
        tier: 1,
        name: "Primera Divisió",
        shortName: "Primera Divisió",
        size: 10,
        status: "semi-professional",
        reputation: 12,
        roundRobins: 3,
        clubs: {
          reputation: span(22, 10),
          capacity: span(3_300, 500),
          facilities: span(26, 12),
          academy: span(24, 10),
          wageBill: span(900_000, 60_000),
          transferBudget: span(40_000, 0),
          foreignShare: 0.55,
          squadSize: [25, 26],
        },
      },
    ],
    movement: [],
    cups: [
      { kind: "national", name: "Copa Constitució", legs: 1, neutralFinal: true, continental: true },
      { kind: "super", name: "Supercopa d'Andorra", participants: ["champion", "cup-winner"], neutralFinal: true, start: "08-25" },
    ],
    // Descriptive names: Andorran academies play mostly in Catalan federation youth leagues.
    youth: {
      U19: { divisions: [division("Lliga Juvenil d'Andorra", [1, 1], 10)] },
      U17: { divisions: [division("Lliga Cadet d'Andorra", [1, 1], 10)] },
    },
    // Reserve sides play in the unmodeled Segona Divisió.
    reserves: { mode: "none" },
    clubNaming: {
      templates: templates(`
FC {city}|8
UE {city}|8
CE {city}|5
CF {city}|3
Atlètic {city}|3
Inter {city}|1.5
`),
      founded: { top: [1970, 2000], bottom: [1980, 2015] },
      shortName: "city",
      avoid: list(
        "FC Andorra|FC Santa Coloma|UE Santa Coloma|Inter Club d'Escaldes|Inter d'Escaldes|UE Engordany|FC Ordino|UE Sant Julià|UE Sant Julià de Lòria|FC Encamp|Atlètic Club d'Escaldes|Atlètic Escaldes|CE Carroi|FC Pas de la Casa|CF Esperança d'Andorra|Penya Encarnada d'Andorra|UE Extremenya|CE Jenlai",
      ),
      colors: ["#0018A8", "#FEDF00", "#D0103A", "#FFFFFF", "#000000", "#008000"],
    },
    importSources: codes("ES:10 PT:5 FR:3 AR:2 BR:2 UY:1 VE:1 MA:1 CO:1 SN:0.5"),
    // UEFA association season points 2020/21..2024/25 (UEFA 2025 country ranking).
    coefficients: { association: [0.666, 1.5, 0.666, 1.666, 1.0], season2025: 2.0 },
  },
  // FC Andorra, promoted to Segunda División for 2025/26.
  hostedAbroad: [
    {
      host: "ES",
      tiers: [2],
      cities: ["Andorra la Vella"],
      cups: "host",
      continental: "host",
      youth: "host",
      registration: "host",
    },
  ],
};

// ---------------------------------------------------------------- Gibraltar

// Common local given names and old Genoese, Maltese, Sephardic and Spanish family lines, not the national-team roster.
const GIBRALTARIAN = pool(
  "gibraltarian",
  "Francis|Nathan|Luke|Samuel|Matthew|Thomas|Stephen|Paul|Richard|Oliver|Harry|Alexander|Gabriel|Adrian|Leon|Marcus|Martin|Victor|Lewis|Owen|Joel|Ivan|Mario|Manuel|Antonio|Luis|Isaac|Elliot|Callum|Tyler|Kevin|Neil|Ian|Colin|Philip|George|Edward|Conor|Leo|Jacob|Moses|Solomon",
  "Chipolina|Casciaro|Olivero|Valarino|Torrilla|Britto|Bosio|Sacarello|Robba|Bado|Cassar|Benady|Borge|Buhagiar|Caruana|Danino|Figueras|Ferrary|Imossi|Linares|Montegriffo|Netto|Soiza|Stagnetto|Teuma|Triay|Vinet|Zammitt|Isola|Xiberras|Balban|Canepa|Cortes|Bruzon|Rocca|Parody|Rugeroni|Baglietto|Pitto|Pisarello|Ramagge|Galliano|Durante|Anahory|Serruya|Abudarham|Bensadon|Attias|Benzaquen|Azopardi|Mifsud|Farrugia|Grech|Vella|Bonello|Sciacaluga|Porral|Victory|Feetham|Payas|Lavarello|Dalmedo|Recagno|Viagas|Origo|Poggio|Dellipiani|Bossino",
);

const GIBRALTAR: NationSpec = {
  code: "GI",
  iso2: "GI",
  name: "Gibraltar",
  confederation: "UEFA",
  continent: "EU",
  capital: "Gibraltar",
  latitude: 36.1,
  languages: [{ code: "en", weight: 0.8 }, { code: "es", weight: 0.2 }],
  reputation: { national: 8, league: 6 },
  euEea: false,
  physique: { height: 179 },
  names: {
    given: sources("gibraltarian=0.4 faker:en=0.35 spanish=0.25"),
    family: sources("gibraltarian=0.4 faker:en=0.35 spanish=0.25"),
    // British, Genoese, Spanish, Maltese and Sephardic lines mix freely.
    mixRate: 0.5,
  },
  nationality: {
    multipleRate: 0.3,
    tripleRate: 0.06,
    bornAbroadRate: 0.3,
    diasporaPull: 0.4,
    links: [...links("crossBorder", "ES:10"), ...links("britishIrish", "EN:8"), ...links("mediterranean", "MA:4 MT:2 IT:1.5 PT:1.5")],
    // Gibraltarians are British citizens.
    citizenship: { group: "GB", dual: "allowed" },
  },
  cities: {
    major: cityRows(`
Gibraltar|small|Gibraltar|10|Westside,South District,Town Area,Catalan Bay,Laguna,Upper Town,North Front,Rosia,Sandpits,Alameda
`),
  },
  football: {
    leagues: [
      {
        // Format approximated: 2025/26 split details not modeled.
        tier: 1,
        name: "Gibraltar Football League",
        shortName: "GFL",
        size: 10,
        status: "semi-professional",
        reputation: 7,
        roundRobins: 3,
        clubs: {
          reputation: span(26, 6),
          capacity: span(2_300, 300),
          facilities: span(28, 10),
          academy: span(22, 8),
          wageBill: span(1_200_000, 40_000),
          transferBudget: span(50_000, 0),
          foreignShare: 0.6,
          squadSize: [25, 26],
        },
      },
    ],
    movement: [],
    cups: [
      { kind: "national", name: "Rock Cup", legs: 1, neutralFinal: true, continental: true },
      { kind: "super", name: "Pepe Reyes Cup", participants: ["champion", "cup-winner"], neutralFinal: true, start: "08-20" },
    ],
    // Descriptive names (Fact Checker to verify).
    youth: {
      U19: { divisions: [division("Gibraltar U19 League", [1, 1], 10)] },
      U17: { divisions: [division("Gibraltar U17 League", [1, 1], 10)] },
    },
    // Reserve sides play in the unmodeled Intermediate League.
    reserves: { mode: "none" },
    clubNaming: {
      templates: templates(`
{city} FC|8
{city} United|6
FC {city}|4
{city} Athletic|3
{city} Rovers|2
`),
      founded: { top: [1912, 1976], bottom: [1960, 2018] },
      shortName: "city",
      avoid: list(
        "Lincoln Red Imps|Europa FC|Europa Point|St Joseph's|Glacis United|Lions Gibraltar|Gibraltar Lions|Manchester 62|Mons Calpe|College 1975|Magpies|Hound Dogs|Gibraltar United|Gibraltar Phoenix|Lynx FC|Bruno's Magpies",
      ),
      colors: ["#DA000C", "#FFFFFF", "#000000", "#0033A0", "#FFD100", "#006B3F"],
    },
    importSources: codes("ES:10 EN:4 MA:2 PT:1 AR:1 IT:1 FR:0.5 SCO:0.5 IE:0.5 NG:0.5"),
    // UEFA association season points 2020/21..2024/25 (UEFA 2025 country ranking).
    coefficients: { association: [1.666, 1.25, 0.875, 0.166, 1.5], season2025: 3.333 },
  },
};

export const UEFA_WEST: CatalogFileData = {
  file: "uefa-west",
  nations: [PORTUGAL, SPAIN, ANDORRA, GIBRALTAR, ...UEFA_WEST_B.nations],
  namePools: [PORTUGUESE, SPANISH, CATALAN, BASQUE, GALICIAN, GIBRALTARIAN, ...UEFA_WEST_B.namePools],
};
