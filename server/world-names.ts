import { allLocales } from "@faker-js/faker";
import { createRequire } from "node:module";
import type seedrandom from "seedrandom";
import type { Country, PlayerProfile } from "../shared/types.ts";

type NamingCountry = Pick<Country, "code" | "language" | "region" | "name">;
type NamePool = { given: string[]; family: string[]; familyFirst?: boolean };
type LocaleKey = keyof typeof allLocales;
const pool = (
  given: string,
  family: string,
  familyFirst = false,
): NamePool => ({
  given: given.split("|"),
  family: family.split("|"),
  familyFirst,
});

const countryLocales: Record<string, LocaleKey[]> = {
  ES: ["es"],
  IT: ["it"],
  NL: ["nl"],
  DK: ["da"],
  SE: ["sv"],
  RU: ["ru"],
  JP: ["ja"],
  KR: ["ko"],
  EN: ["en_GB"],
  SCO: ["en_GB"],
  WAL: ["cy"],
  NIR: ["en_IE"],
  IE: ["en_IE"],
  US: ["en_US", "es_MX"],
  CA: ["en_CA", "fr_CA"],
  AU: ["en_AU"],
  NZ: ["en_AU"],
  PT: ["pt_PT"],
  BR: ["pt_BR"],
  AO: ["pt_PT"],
  MZ: ["pt_PT"],
  CV: ["pt_PT"],
  ST: ["pt_PT"],
  GW: ["pt_PT", "fr_SN"],
  TL: ["pt_PT", "id_ID"],
  FR: ["fr", "fr", "fr_SN", "ar"],
  BE: ["nl_BE", "fr_BE"],
  CH: ["de_CH", "fr_CH", "it"],
  LU: ["fr_LU", "de", "pt_PT"],
  AT: ["de_AT"],
  DE: ["de", "de", "tr"],
  SN: ["fr_SN"],
  GM: ["fr_SN"],
  GN: ["fr_SN"],
  ML: ["fr_SN"],
  BF: ["fr_SN"],
  CI: ["fr_SN"],
  NG: ["en_NG", "yo_NG"],
  GH: ["en_GH"],
  ZA: ["zu_ZA", "en_ZA", "af_ZA"],
  MX: ["es_MX"],
  AR: ["es"],
  CL: ["es"],
  CO: ["es"],
  PE: ["es"],
  UY: ["es"],
  PY: ["es"],
  EC: ["es"],
  BO: ["es"],
  IN: ["en_IN", "ta_IN"],
  BD: ["bn_BD"],
  PK: ["ur"],
  NP: ["ne"],
  MV: ["dv"],
  CN: ["zh_CN"],
  TW: ["zh_TW"],
  HK: ["zh_TW", "en_HK"],
  MO: ["zh_TW"],
  SG: ["zh_CN", "en_IN", "id_ID"],
  MY: ["id_ID", "zh_CN", "ta_IN"],
  BN: ["id_ID"],
  ID: ["id_ID"],
  TH: ["th"],
  VN: ["vi"],
  AM: ["hy"],
  GE: ["ka_GE"],
  AZ: ["az"],
  UZ: ["uz_UZ_latin"],
  MD: ["ro_MD"],
  RS: ["sr_RS_latin"],
  ME: ["sr_RS_latin"],
  BA: ["hr", "sr_RS_latin"],
  IL: ["he", "ar"],
  PS: ["ar"],
  IR: ["fa"],
  AF: ["fa"],
};

const languageLocales: Record<string, LocaleKey> = {
  en: "en_GB",
  es: "es",
  pt: "pt_PT",
  fr: "fr",
  de: "de",
  it: "it",
  nl: "nl",
  ar: "ar",
  ja: "ja",
  ko: "ko",
  zh: "zh_CN",
  ru: "ru",
  uk: "uk",
  pl: "pl",
  cs: "cs_CZ",
  sk: "sk",
  hr: "hr",
  sr: "sr_RS_latin",
  ro: "ro",
  hu: "hu",
  el: "el",
  tr: "tr",
  az: "az",
  hy: "hy",
  ka: "ka_GE",
  mk: "mk",
  lv: "lv",
  no: "nb_NO",
  nb: "nb_NO",
  nn: "nb_NO",
  da: "da",
  sv: "sv",
  fi: "fi",
  cy: "cy",
  ga: "en_IE",
  fa: "fa",
  he: "he",
  ur: "ur",
  hi: "en_IN",
  bn: "bn_BD",
  ta: "ta_IN",
  ne: "ne",
  dv: "dv",
  id: "id_ID",
  ms: "id_ID",
  th: "th",
  vi: "vi",
  uz: "uz_UZ_latin",
  af: "af_ZA",
  zu: "zu_ZA",
  yo: "yo_NG",
};

const custom: Record<string, NamePool> = {
  MA: pool(
    "Youssef|Ayoub|Amine|Hamza|Ilyas|Ismail|Anas|Oussama|Bilal|Nabil|Mehdi|Soufiane|Walid|Yassine|Reda|Adil",
    "Bennani|El Amrani|Idrissi|Ait Lahcen|Berrada|Benali|Alaoui|El Mansouri|Lahlou|Belhaj|Haddou|Bouziane|Amrani|Zerouali|Bouzid|Lamrani",
  ),
  DZ: pool(
    "Youcef|Mehdi|Riyad|Sofiane|Hichem|Rayan|Amine|Islam|Farid|Nabil|Zakaria|Redouane",
    "Benali|Belaid|Boudjemaa|Mansouri|Boukhalfa|Ait Ali|Mebarki|Saidi|Belkacem|Bouaziz|Hamidi|Meziane",
  ),
  TN: pool(
    "Yassine|Anis|Wajdi|Hamza|Firas|Aymen|Alaa|Bilel|Nader|Maher|Taha|Oussama",
    "Ben Salah|Trabelsi|Jabari|Mansouri|Ayari|Gharbi|Jaziri|Ben Youssef|Haddadi|Bouzid|Dridi|Messaoudi",
  ),
  EG: pool(
    "Omar|Ahmed|Mahmoud|Mostafa|Youssef|Karim|Ibrahim|Hossam|Tarek|Amr|Mohamed|Hassan",
    "Hassan|Ibrahim|Mahmoud|El Sayed|Fathy|Abdelrahman|Gamal|Farouk|Mansour|Abdallah|Nasser|Hamdy",
  ),
  KE: pool(
    "Brian|David|Kevin|Victor|Dennis|John|Michael|Peter|Daniel|Joseph|Allan|Felix",
    "Otieno|Ochieng|Wanjala|Kamau|Mwangi|Kiptoo|Kiprotich|Mutua|Njoroge|Omondi|Wafula|Odhiambo",
  ),
  TZ: pool(
    "Juma|Hassan|John|Kelvin|Baraka|Salum|Ibrahim|Simon|David|Ramadhan|Emmanuel|Peter",
    "Msuya|Mushi|Komba|Mwakalinga|Massawe|Mollel|Mboya|Kimaro|Mwakyembe|Nyoni|Mtega|Shomari",
  ),
  UG: pool(
    "Moses|Allan|Denis|Joseph|Brian|Isaac|Paul|Patrick|Emmanuel|Geoffrey|Robert|David",
    "Okello|Kato|Mugisha|Ssekabira|Walusimbi|Ssentongo|Otim|Waiswa|Kizito|Lubega|Ssemakula|Mugerwa",
  ),
  ET: pool(
    "Dawit|Abel|Samuel|Yared|Bereket|Fitsum|Henok|Natnael|Solomon|Yonas|Biniam|Elias",
    "Bekele|Tesfaye|Tadesse|Alemu|Desta|Gebre|Haile|Mulugeta|Worku|Getachew|Mekonnen|Assefa",
  ),
  ER: pool(
    "Biniam|Henok|Natnael|Dawit|Yonatan|Yonas|Filmon|Robel|Bereket|Meron|Daniel|Abel",
    "Ghebre|Tesfai|Tekle|Asmerom|Haile|Kidane|Berhane|Gebremariam|Weldemichael|Habte|Abraha|Tewelde",
  ),
  SO: pool(
    "Ahmed|Abdi|Mohamed|Hassan|Yusuf|Ali|Omar|Abdullahi|Ibrahim|Farah|Ismail|Mahad",
    "Hassan|Ali|Abdi|Warsame|Mohamud|Farah|Jama|Adan|Yusuf|Osman|Nur|Isse",
  ),
  RW: pool(
    "Jean Claude|Eric|Emmanuel|Patrick|Olivier|Samuel|Jean Paul|Fabrice|Thierry|Didier",
    "Mugisha|Niyonzima|Nsabimana|Habimana|Ndayishimiye|Hakizimana|Uwizeye|Iradukunda|Bizimana|Mugiraneza",
  ),
  BI: pool(
    "Jean|Eric|Fabrice|Cedric|Pierre|Patrick|Emmanuel|Thierry|David|Olivier",
    "Ndayishimiye|Niyonzima|Ndikumana|Ndayizeye|Bukuru|Niyongabo|Nshimirimana|Nahimana|Iradukunda|Nsabimana",
  ),
  CM: pool(
    "Jean|Christian|Patrick|Serge|Fabrice|Eric|Joseph|Stephane|Didier|Alain|Samuel|Frank",
    "Mbarga|Nsame|Ngom|Abanda|Moukoko|Essomba|Mbia|Njoya|Tchamba|Mbala|Onana|Nguewa",
  ),
  CD: pool(
    "Jonathan|Dieumerci|Christian|Tresor|Fiston|Cedric|Patrick|Samuel|Chadrack|Jean|Merveille|Junior",
    "Mbala|Mbuyi|Kabeya|Ilunga|Kasongo|Mputu|Kabasele|Mwamba|Ngoma|Lukusa|Tshibanda|Kanku",
  ),
  MG: pool(
    "Andry|Faneva|Lalaina|Toky|Mamy|Njiva|Hasina|Tiana|Rado|Lova",
    "Rakoto|Rakotondrabe|Rasolonirina|Ranaivo|Rabe|Randrianarivelo|Rasolofonirina|Rakotomalala|Raveloson|Ramanantsoa",
  ),
  ZM: pool(
    "Kennedy|Emmanuel|Joseph|Kelvin|Brian|Patrick|Lameck|Moses|Christopher|Collins|Evans|Andrew",
    "Banda|Phiri|Mwansa|Mulenga|Chanda|Chisala|Tembo|Bwalya|Mumba|Lungu|Sinkala|Chongo",
  ),
  ZW: pool(
    "Tinashe|Tendai|Tatenda|Kudakwashe|Tawanda|Takudzwa|Farai|Simbarashe|Blessing|Prince|Brian|Tanaka",
    "Moyo|Ndlovu|Sibanda|Dube|Muzenda|Chikore|Mugabe|Mupfumi|Ncube|Mpofu|Chirume|Zhou",
  ),
  BW: pool(
    "Kabelo|Thabo|Mpho|Thato|Kgomotso|Tebogo|Tumelo|Keabetswe|Lesego|Karabo",
    "Molefe|Mokgosi|Modise|Motsumi|Mogorosi|Kgosi|Mokgothu|Ramosweu|Gabotshwene|Ramotswa",
  ),
  AL: pool(
    "Ardit|Arben|Luan|Erion|Besnik|Ilir|Dritan|Altin|Endri|Gent|Arlind|Faton",
    "Hoxha|Dervishi|Kola|Basha|Shehu|Gashi|Krasniqi|Leka|Rama|Deda|Berisha|Shala",
  ),
  LT: pool(
    "Mantas|Lukas|Jonas|Domantas|Paulius|Tomas|Karolis|Dovydas|Matas|Rokas|Arnas|Edvinas",
    "Kazlauskas|Petrauskas|Jankauskas|Stankevicius|Vasiliauskas|Butkus|Zukauskas|Paulauskas|Urbonas|Kavaliauskas|Balciunas|Savickas",
  ),
  EE: pool(
    "Rasmus|Karl|Markus|Martin|Kristjan|Henri|Sander|Oliver|Tanel|Andres|Marten|Mihkel",
    "Tamm|Saar|Sepp|Magi|Kask|Kukk|Rebane|Ilves|Pold|Kivi|Koppel|Lepp",
  ),
  IS: pool(
    "Aron|Einar|Gunnar|Stefan|Bjorn|Jon|Kristjan|Magnus|Birkir|Sigurdur|Viktor|Emil",
    "Jonsson|Gunnarsson|Einarsson|Stefansson|Magnusson|Kristjansson|Arnarsson|Sigurdsson|Bjornsson|Gudmundsson|Palsson|Hauksson",
  ),
  FO: pool(
    "Jakup|Elias|Jonas|Hogni|Petur|Andrias|Runi|Gunnar|Magnus|Rogi",
    "Joensen|Hansen|Olsen|Petersen|Jakobsen|Eliasen|Mortensen|Danielsen|Davidsen|Johannesen",
  ),
  SI: pool(
    "Luka|Jan|Miha|Nejc|Rok|Zan|Anze|Aljaz|Matej|Jure|Blaz|David",
    "Novak|Horvat|Kovac|Krajnc|Zupan|Potocnik|Kranjc|Vidmar|Kos|Mlakar|Golob|Zupancic",
  ),
  BG: pool(
    "Ivan|Georgi|Dimitar|Petar|Nikolay|Stefan|Martin|Aleksandar|Vasil|Todor|Hristo|Stoyan",
    "Ivanov|Georgiev|Dimitrov|Petrov|Nikolov|Stoyanov|Todorov|Vasilev|Kolev|Hristov|Marinov|Dimitriev",
  ),
  MT: pool(
    "Matthew|Luke|Joseph|Daniel|Mark|Ryan|Andrew|Karl|Shaun|Michael|Paul|Nathan",
    "Borg|Camilleri|Vella|Farrugia|Zammit|Galea|Micallef|Azzopardi|Attard|Spiteri|Abela|Cassar",
  ),
  KZ: pool(
    "Alikhan|Nursultan|Dias|Arman|Timur|Aslan|Daniyar|Aibek|Azamat|Sanzhar|Ruslan|Yerlan",
    "Akhmetov|Suleimenov|Omarov|Iskakov|Nurgaliyev|Sadykov|Abishev|Zhumabayev|Tulegenov|Karimov|Ibrayev|Seitov",
  ),
  KG: pool(
    "Azamat|Nurlan|Bekzat|Erkin|Adilet|Mirlan|Ulan|Bakyt|Temirlan|Kubat",
    "Asanov|Osmonov|Abdykadyrov|Isakov|Sadykov|Bekmuratov|Abdullaev|Turgunbaev|Akmatov|Sultanov",
  ),
  TJ: pool(
    "Rustam|Farhod|Daler|Behruz|Iskandar|Firdavs|Said|Mehrubon|Umed|Jamshed",
    "Rahmonov|Karimov|Saidov|Nazarov|Sharipov|Rasulov|Ismoilov|Yusupov|Davlatov|Juraev",
  ),
  TM: pool(
    "Serdar|Merdan|Myrat|Azat|Didar|Arslan|Atamyrat|Dovlet|Batyr|Ruslan",
    "Gurbanov|Orazov|Atayev|Berdiyew|Geldiyew|Saparov|Amanov|Annayev|Myradow|Nazarov",
  ),
  MN: pool(
    "Batbayar|Temuulen|Munkhbat|Enkhbayar|Bilguun|Tuguldur|Erdenebat|Ganbold|Batsaikhan|Anand",
    "Dorj|Bat|Enkh|Gantulga|Munkh|Bold|Tseren|Otgon|Erdene|Baatar",
    true,
  ),
  KH: pool(
    "Sokha|Dara|Rithy|Vannak|Sopheak|Piseth|Visal|Borey|Sovann|Ratanak",
    "Sok|Chan|Chea|Heng|Seng|Lim|Kim|Chhim|Khem|Keo",
    true,
  ),
  LA: pool(
    "Khampheng|Bounmy|Souk|Vannasone|Phouthone|Anousone|Sengdao|Bounthavy|Soukaphone|Vilay",
    "Phommasane|Souvannavong|Keovongsa|Xayavong|Sengsavanh|Phanthavong|Vongphachanh|Inthavong|Khamphoumy|Sisavath",
  ),
  MM: pool(
    "Aung|Min|Kyaw|Zaw|Htet|Thet|Nay|Sai|Ye|Ko",
    "Thu|Htun|Win|Aung|Moe|Lwin|Lin|Naing|Oo|Soe",
  ),
  PH: pool(
    "Miguel|Joshua|Gabriel|Paolo|Rafael|Carlo|Luis|John|Marco|Angelo|Adrian|Jose",
    "Santos|Reyes|Cruz|Garcia|Ramos|Mendoza|Torres|Aquino|Villanueva|Dela Cruz|Navarro|Fernandez",
  ),
  LK: pool(
    "Kasun|Nuwan|Dinesh|Lahiru|Ruwan|Chamara|Isuru|Tharindu|Dilshan|Asanka",
    "Perera|Fernando|Silva|Jayasinghe|Rajapaksa|Gunawardena|Karunaratne|Wijesinghe|Bandara|Senanayake",
  ),
  BT: pool(
    "Tenzin|Karma|Pema|Sonam|Dorji|Tshering|Jigme|Sangay|Ugyen|Wangchuk",
    "Dorji|Wangchuk|Tobgay|Norbu|Wangdi|Gyeltshen|Tshering|Namgyal|Rinchen|Thinley",
  ),
  FJ: pool(
    "Jone|Josefa|Samuela|Iliesa|Peni|Sairusi|Tevita|Mosese|Manasa|Laisenia",
    "Ratu|Nasilasila|Naivalu|Ravouvou|Koroi|Tuisova|Nabuli|Nayacalevu|Rokoduru|Nacewa",
  ),
  WS: pool(
    "Tavita|Ioane|Sione|Tui|Leka|Afa|Isaia|Siaosi|Pita|Mika",
    "Tuiloma|Leota|Faumuina|Faletau|Tupuola|Toelupe|Mataia|Aiono|Lemalu|Tagaloa",
  ),
  TO: pool(
    "Sione|Tevita|Salesi|Viliami|Meleki|Siaosi|Lopeti|Pita|Taniela|Samuela",
    "Tupou|Taufua|Fifita|Kaufusi|Latu|Vea|Fusitu'a|Faletau|Havili|Fekitoa",
  ),
  PG: pool(
    "Michael|David|John|Nigel|Raymond|Emmanuel|Albert|Steven|Paul|Thomas",
    "Kila|Pala|Dadi|Aka|Bua|Geno|Muri|Wara|Kaupa|Aitsi",
  ),
  SB: pool(
    "Benjamin|James|Raphael|Henry|Gideon|David|Stanley|Thomas|Micah|Francis",
    "Gagame|Feni|Wale|Suri|Lamo|Fakaia|Auba|Sade|Boso|Kaua",
  ),
  VU: pool(
    "Jean|Brian|Richard|Jonathan|Samuel|Romain|Mitch|Cedric|Jason|Tony",
    "Kaltak|Nalo|Yau|Tasso|Bong|Bule|Kalsakau|Tari|Kalotang|Malas",
  ),
  PF: pool(
    "Teva|Teariki|Marama|Taina|Moana|Henri|Raimana|Tehei|Tamatoa|Hiro",
    "Tehau|Vahirua|Temarii|Labaste|Tihoni|Taerea|Maamaatuaiahutapu|Waan|Ropati|Aitamai",
  ),
};
const aliases: Record<string, string> = {
  DJ: "SO",
  SS: "UG",
  CG: "CD",
  GA: "CM",
  GQ: "CM",
  CF: "CM",
  TD: "CM",
  BJ: "NG",
  TG: "GH",
  NE: "SN",
  SL: "GH",
  LR: "GH",
  MW: "ZM",
  NA: "ZA",
  LS: "BW",
  SZ: "ZA",
  KM: "TZ",
  YT: "TZ",
  MU: "LK",
  RE: "MG",
  SC: "MU",
  XK: "AL",
  BY: "RU",
  AS: "WS",
  NU: "TO",
  TK: "WS",
  CK: "PF",
  NC: "VU",
  WF: "WS",
  FM: "PG",
  MH: "PG",
  PW: "PG",
  NR: "PG",
  KI: "TO",
  TV: "TO",
  GU: "PH",
  MP: "PH",
  GL: "DK",
  AX: "SE",
  AD: "ES",
  MC: "FR",
  SM: "IT",
  VA: "IT",
};

function localePool(locale: LocaleKey): NamePool | undefined {
  const person = allLocales[locale].person;
  const given = person?.first_name?.male ?? person?.first_name?.generic;
  const family = person?.last_name?.male ?? person?.last_name?.generic;
  return given?.length && family?.length
    ? {
        given,
        family,
        familyFirst: ["ko", "zh_CN", "zh_TW", "vi", "hu"].includes(locale),
      }
    : undefined;
}

export function namingPools(country: NamingCountry): {
  pools: NamePool[];
  source: string;
} {
  const code = aliases[country.code] ?? country.code;
  if (custom[code]) return { pools: [custom[code]], source: `country:${code}` };
  const locales = countryLocales[code] ?? [
    languageLocales[country.language] ??
      (code === "RU"
        ? "ru"
        : code === "DK"
          ? "da"
          : code === "SE"
            ? "sv"
            : "en_GB"),
  ];
  const pools = locales
    .map(
      (locale) =>
        localePool(locale) ??
        localePool(languageLocales[locale.split("_")[0]] ?? "en_GB"),
    )
    .filter((entry): entry is NamePool => Boolean(entry));
  return {
    pools: pools.length ? pools : [localePool("en")!],
    source: locales.join(","),
  };
}

export function culturalPersonName(
  random: seedrandom.PRNG,
  country: NamingCountry,
): string {
  const firstRoll = random();
  const secondRoll = random();
  const { pools } = namingPools(country);
  const weighted = firstRoll * pools.length;
  const selected = pools[Math.floor(weighted)];
  const given =
    selected.given[Math.floor((weighted % 1) * selected.given.length)];
  const family =
    selected.family[Math.floor(secondRoll * selected.family.length)];
  return selected.familyFirst ? `${family} ${given}` : `${given} ${family}`;
}

const places: Record<string, string> = {
  EN: "Birmingham|Manchester|Liverpool|Leeds|Sheffield|Bristol|Newcastle|Nottingham|Leicester|Southampton|Portsmouth|Derby|Coventry|Sunderland|Wolverhampton|Brighton|Plymouth|Reading|Blackpool|Preston|Bradford|Huddersfield|Oxford|Cambridge|York|Exeter|Ipswich|Norwich|Bolton|Burnley|Watford|Luton|Middlesbrough|Blackburn|Carlisle|Stockport|Chesterfield|Lincoln|Wrexham|Northampton|Walsall|Mansfield|Crewe|Doncaster|Barnsley|Rotherham|Tranmere|Salford|Gillingham|Cheltenham|Shrewsbury|Crawley|Swindon|Grimsby|Scunthorpe|Aldershot|Chester|Hereford|Worcester|Bath",
  PT: "Lisboa|Porto|Braga|Faro|Coimbra|Aveiro|Setubal|Evora|Viseu|Leiria|Lagos|Funchal|Guimaraes|Chaves|Beja|Portimao|Vila Real|Braganca|Viana do Castelo|Castelo Branco|Santarem|Guarda|Portalegre|Barcelos|Fafe|Vizela|Amarante|Felgueiras|Penafiel|Matosinhos|Maia|Gondomar|Espinho|Ovar|Agueda|Oliveira de Azemeis|Torres Vedras|Caldas da Rainha|Almada|Seixal|Barreiro|Loures|Sintra|Cascais|Tavira|Olhao|Loule|Silves|Ponta Delgada|Angra do Heroismo|Covilha|Fundao|Tomar|Abrantes|Pombal|Marinha Grande|Elvas|Estremoz|Serpa|Moura",
  LU: "Luxembourg|Esch-sur-Alzette|Differdange|Dudelange|Ettelbruck|Diekirch|Wiltz|Rumelange|Grevenmacher|Remich|Echternach|Mersch|Petange|Rodange|Strassen|Hesperange|Mondorf|Rosport|Niederkorn|Kayl",
  SCO: "Glasgow|Edinburgh|Aberdeen|Dundee|Perth|Inverness|Stirling|Paisley|Motherwell|Kilmarnock|Ayr|Falkirk|Dunfermline|Kirkcaldy|Hamilton|Livingston|Dumfries|Elgin|Montrose|Arbroath",
  WAL: "Cardiff|Swansea|Newport|Wrexham|Bangor|Caernarfon|Aberystwyth|Carmarthen|Llanelli|Barry|Pontypridd|Haverfordwest|Bala|Newtown|Flint|Colwyn Bay",
  NIR: "Belfast|Derry|Lisburn|Newry|Armagh|Bangor|Ballymena|Coleraine|Larne|Portadown|Dungannon|Enniskillen|Carrickfergus|Ballymoney",
  IE: "Dublin|Cork|Galway|Limerick|Waterford|Dundalk|Sligo|Drogheda|Bray|Athlone|Wexford|Cobh|Tralee|Kilkenny|Letterkenny|Longford",
  KR: "Seoul|Busan|Incheon|Daegu|Daejeon|Gwangju|Ulsan|Suwon|Jeonju|Pohang|Seongnam|Changwon|Gangneung|Jeju|Cheonan|Anyang",
  CN: "Beijing|Shanghai|Guangzhou|Chengdu|Shenzhen|Wuhan|Tianjin|Chongqing|Nanjing|Hangzhou|Qingdao|Dalian|Jinan|Xi'an|Zhengzhou|Kunming",
  IN: "Kolkata|Mumbai|Delhi|Chennai|Bengaluru|Hyderabad|Kochi|Guwahati|Imphal|Shillong|Aizawl|Pune|Goa|Bhubaneswar|Srinagar|Kozhikode",
  NG: "Lagos|Kano|Abuja|Ibadan|Enugu|Aba|Port Harcourt|Jos|Kaduna|Benin City|Uyo|Owerri|Ilorin|Akure|Maiduguri|Bauchi",
  GH: "Accra|Kumasi|Tamale|Tema|Cape Coast|Sekondi|Takoradi|Sunyani|Koforidua|Obuasi|Ho|Wa|Bolgatanga|Tarkwa",
  ZA: "Johannesburg|Cape Town|Durban|Pretoria|Soweto|Gqeberha|Bloemfontein|Polokwane|Mbombela|Rustenburg|Kimberley|Pietermaritzburg|East London|Stellenbosch",
  MA: "Casablanca|Rabat|Fes|Marrakesh|Tangier|Agadir|Meknes|Oujda|Tetouan|Kenitra|Safi|El Jadida|Berkane|Nador",
  DZ: "Algiers|Oran|Constantine|Annaba|Setif|Blida|Tizi Ouzou|Bejaia|Batna|Biskra|Tlemcen|Chlef|Mostaganem|Sidi Bel Abbes",
  EG: "Cairo|Alexandria|Giza|Port Said|Suez|Ismailia|Mansoura|Tanta|Aswan|Luxor|Faiyum|Zagazig|Assiut|Damietta",
  TN: "Tunis|Sfax|Sousse|Bizerte|Kairouan|Gabes|Gafsa|Monastir|Nabeul|Kasserine|Beja|Zarzis",
  TR: "Istanbul|Ankara|Izmir|Bursa|Antalya|Konya|Adana|Trabzon|Samsun|Gaziantep|Kayseri|Eskisehir|Diyarbakir|Mersin|Denizli|Sivas",
  PL: "Warszawa|Krakow|Lodz|Wroclaw|Poznan|Gdansk|Szczecin|Lublin|Bydgoszcz|Katowice|Bialystok|Gdynia|Torun|Kielce|Rzeszow|Opole",
  RU: "Moskva|Sankt Petersburg|Kazan|Samara|Nizhny Novgorod|Rostov|Krasnodar|Voronezh|Ufa|Perm|Volgograd|Saratov|Novosibirsk|Yekaterinburg",
  UA: "Kyiv|Lviv|Kharkiv|Odesa|Dnipro|Poltava|Vinnytsia|Cherkasy|Rivne|Lutsk|Ternopil|Uzhhorod|Zhytomyr|Ivano-Frankivsk",
  AT: "Wien|Graz|Linz|Salzburg|Innsbruck|Klagenfurt|Villach|Wels|Sankt Polten|Dornbirn|Wiener Neustadt|Steyr",
  CH: "Zurich|Basel|Bern|Geneve|Lausanne|Lugano|Luzern|Sankt Gallen|Winterthur|Thun|Sion|Neuchatel|Fribourg|Schaffhausen",
  DK: "Kobenhavn|Aarhus|Odense|Aalborg|Esbjerg|Randers|Horsens|Vejle|Silkeborg|Herning|Viborg|Roskilde",
  NO: "Oslo|Bergen|Trondheim|Stavanger|Drammen|Kristiansand|Tromso|Bodo|Fredrikstad|Molde|Alesund|Haugesund|Skien|Sandefjord",
  SE: "Stockholm|Goteborg|Malmo|Uppsala|Vasteras|Orebro|Linkoping|Helsingborg|Jonkoping|Norrkoping|Lund|Umea|Gavle|Boras",
  FI: "Helsinki|Tampere|Turku|Oulu|Espoo|Vantaa|Lahti|Kuopio|Vaasa|Jyvaskyla|Pori|Rovaniemi",
  CZ: "Praha|Brno|Ostrava|Plzen|Liberec|Olomouc|Zlin|Pardubice|Hradec Kralove|Teplice|Jihlava|Opava",
  GR: "Athina|Thessaloniki|Patra|Iraklio|Larisa|Volos|Ioannina|Kavala|Chania|Serres|Kalamata|Agrinio",
  HR: "Zagreb|Split|Rijeka|Osijek|Zadar|Pula|Varazdin|Sibenik|Karlovac|Sisak|Koprivnica|Vinkovci",
  RS: "Beograd|Novi Sad|Nis|Kragujevac|Subotica|Zrenjanin|Pancevo|Cacak|Kraljevo|Leskovac|Uzice|Sabac",
  RO: "Bucuresti|Cluj|Timisoara|Iasi|Constanta|Craiova|Brasov|Galati|Ploiesti|Oradea|Sibiu|Arad",
  MX: "Ciudad de Mexico|Guadalajara|Monterrey|Puebla|Toluca|Leon|Tijuana|Queretaro|Merida|San Luis Potosi|Morelia|Veracruz|Pachuca|Aguascalientes|Torreon|Oaxaca",
  CO: "Bogota|Medellin|Cali|Barranquilla|Cartagena|Bucaramanga|Pereira|Manizales|Ibague|Santa Marta|Tunja|Pasto|Neiva|Cucuta",
  CL: "Santiago|Valparaiso|Concepcion|La Serena|Antofagasta|Temuco|Rancagua|Talca|Iquique|Chillan|Puerto Montt|Copiapo",
  UY: "Montevideo|Salto|Paysandu|Maldonado|Rivera|Tacuarembo|Mercedes|Durazno|Florida|Colonia|Rocha|Melo",
  PE: "Lima|Arequipa|Trujillo|Chiclayo|Piura|Cusco|Huancayo|Iquitos|Tacna|Puno|Cajamarca|Sullana",
  EC: "Quito|Guayaquil|Cuenca|Ambato|Manta|Portoviejo|Loja|Machala|Riobamba|Ibarra|Esmeraldas|Latacunga",
  PY: "Asuncion|Ciudad del Este|Encarnacion|Luque|San Lorenzo|Lambare|Capiata|Caaguazu|Villarrica|Pilar",
  AU: "Sydney|Melbourne|Brisbane|Perth|Adelaide|Canberra|Newcastle|Wollongong|Geelong|Hobart|Darwin|Gold Coast|Cairns|Ballarat",
  CA: "Toronto|Montreal|Vancouver|Calgary|Edmonton|Ottawa|Winnipeg|Quebec|Hamilton|Halifax|Victoria|Saskatoon|Regina|Kelowna",
  NZ: "Auckland|Wellington|Christchurch|Hamilton|Dunedin|Tauranga|Napier|Nelson|Palmerston North|Rotorua|Invercargill|New Plymouth",
};

const clubForms: Record<string, string[]> = {
  en: [
    "{city} Athletic",
    "{city} City",
    "{city} United",
    "{city} Rovers",
    "{city} Town",
    "{city} FC",
    "{city} Albion",
    "{city} Wanderers",
  ],
  es: [
    "CD {city}",
    "{city} CF",
    "UD {city}",
    "Atletico {city}",
    "Deportivo {city}",
    "{city} FC",
    "Union {city}",
    "AD {city}",
  ],
  pt: [
    "FC {city}",
    "SC {city}",
    "GD {city}",
    "CD {city}",
    "Uniao de {city}",
    "Atletico de {city}",
    "Academico de {city}",
    "{city} Clube",
  ],
  de: [
    "FC {city}",
    "SV {city}",
    "VfB {city}",
    "SC {city}",
    "TSV {city}",
    "VfL {city}",
    "Eintracht {city}",
    "FSV {city}",
  ],
  fr: [
    "AS {city}",
    "{city} FC",
    "US {city}",
    "Stade {city}",
    "ES {city}",
    "Olympique {city}",
    "RC {city}",
    "CS {city}",
  ],
  it: [
    "AC {city}",
    "US {city}",
    "{city} Calcio",
    "AS {city}",
    "{city} FC",
    "SS {city}",
    "Sporting {city}",
    "Polisportiva {city}",
  ],
  nl: [
    "FC {city}",
    "SC {city}",
    "VV {city}",
    "SV {city}",
    "RKVV {city}",
    "AVV {city}",
    "{city} Sport",
    "VVV {city}",
  ],
  ar: [
    "Al Wahda {city}",
    "Al Amal {city}",
    "Al Ahli {city}",
    "Al Shabab {city}",
    "{city} SC",
    "Ittihad {city}",
    "Al Nasr {city}",
    "Al Hilal {city}",
  ],
  tr: [
    "{city}spor",
    "{city} FK",
    "{city} Belediyespor",
    "{city} SK",
    "Yeni {city}",
    "{city} Genclik",
    "{city} Demirspor",
    "{city} Idmanyurdu",
  ],
  pl: [
    "KS {city}",
    "MKS {city}",
    "GKS {city}",
    "LKS {city}",
    "{city} FC",
    "Unia {city}",
    "Stal {city}",
    "Polonia {city}",
  ],
  hr: [
    "NK {city}",
    "HNK {city}",
    "FK {city}",
    "{city} Sport",
    "Radnik {city}",
    "Mladost {city}",
    "Lokomotiva {city}",
    "Jedinstvo {city}",
  ],
  ro: [
    "CS {city}",
    "FC {city}",
    "ACS {city}",
    "CSM {city}",
    "Unirea {city}",
    "Olimpia {city}",
    "Sporting {city}",
    "Progresul {city}",
  ],
  sv: [
    "{city} IF",
    "{city} IK",
    "{city} FF",
    "IFK {city}",
    "{city} BK",
    "{city} SK",
    "FC {city}",
    "{city} AIK",
  ],
  no: [
    "{city} FK",
    "{city} IL",
    "{city} SK",
    "{city} IF",
    "{city} BK",
    "FK {city}",
    "IL {city}",
    "SK {city}",
  ],
};

const geographicCities = new Map<string, Set<string>>();
for (const city of createRequire(import.meta.url)("cities.json") as {
  name: string;
  country: string;
}[]) {
  if (!city.name || city.name.length > 40) continue;
  const countryCities = geographicCities.get(city.country) ?? new Set<string>();
  if (countryCities.size < 240) countryCities.add(city.name);
  geographicCities.set(city.country, countryCities);
}
const cityCache = new Map<string, string[]>();

export function clubIdentity(
  country: NamingCountry,
  index: number,
  preferredCities?: string[],
) {
  const cacheKey = `${country.code}:${preferredCities?.join("|") ?? ""}`;
  let cities = cityCache.get(cacheKey);
  if (!cities) {
    const preferred = places[country.code]?.split("|") ??
      preferredCities ?? [country.region || country.name];
    cities = [
      ...new Set([...preferred, ...(geographicCities.get(country.code) ?? [])]),
    ];
    cityCache.set(cacheKey, cities);
  }
  const city = cities[index % cities.length];
  const language =
    country.code === "LU"
      ? "fr"
      : country.code === "BR"
        ? "pt"
        : country.code === "RS"
          ? "hr"
          : country.language;
  const templates = clubForms[language] ?? [
    "FC {city}",
    "{city} SC",
    "AC {city}",
    "{city} FC",
    "SC {city}",
    "{city} AC",
    "Sporting {city}",
    "{city} Club",
  ];
  const template =
    templates[
      (Math.floor(index / cities.length) + (index % cities.length)) %
        templates.length
    ];
  const cycle = Math.floor(index / (cities.length * templates.length));
  const name = `${template.replace("{city}", city)}${cycle ? ` ${1880 + cycle}` : ""}`;
  return { city, name, shortName: city.slice(0, 3).toUpperCase() };
}

const familyLinks: Record<string, string[]> = {
  EN: ["IE", "SCO", "WAL", "JM", "NG", "GH", "IN", "PK", "FR", "PT"],
  SCO: ["EN", "IE", "WAL", "PL"],
  WAL: ["EN", "IE", "SCO"],
  NIR: ["IE", "SCO", "EN"],
  IE: ["EN", "SCO", "NIR", "PL", "NG"],
  FR: ["DZ", "MA", "SN", "ML", "CM", "CI", "PT", "IT", "BE", "GP", "MQ", "CD"],
  DE: ["TR", "PL", "IT", "HR", "BA", "RS", "GH", "AT"],
  PT: ["CV", "AO", "GW", "BR", "MZ", "ST", "FR"],
  BR: ["PT", "IT", "ES", "JP", "DE"],
  NL: ["SR", "CW", "MA", "TR", "ID", "BE"],
  BE: ["MA", "CD", "TR", "IT", "FR", "NL"],
  ES: ["MA", "AR", "CO", "EC", "GQ", "UY", "PT", "FR"],
  IT: ["AR", "BR", "AL", "RO", "GH", "FR"],
  LU: ["PT", "FR", "DE", "BE", "IT", "CV"],
  CH: ["IT", "DE", "FR", "PT", "AL", "RS", "BA"],
  AT: ["DE", "HR", "RS", "TR", "BA"],
  SE: ["FI", "BA", "RS", "SO", "NO", "DK"],
  NO: ["SE", "DK", "SO", "PK", "GH"],
  DK: ["TR", "DE", "SE", "SO"],
  FI: ["SE", "EE", "RU", "SO"],
  PL: ["UA", "DE", "BY", "LT"],
  CZ: ["SK", "UA", "VN", "PL"],
  SK: ["CZ", "HU", "UA"],
  HR: ["BA", "DE", "AT", "SI"],
  RS: ["BA", "ME", "DE", "AT"],
  AL: ["IT", "GR", "DE", "CH"],
  GR: ["AL", "CY", "GE", "DE"],
  CY: ["GR", "EN"],
  RO: ["MD", "HU", "IT", "ES"],
  HU: ["RO", "SK", "RS", "DE"],
  AR: ["IT", "ES", "UY", "PY", "BO"],
  UY: ["AR", "ES", "IT", "BR"],
  CL: ["PE", "AR", "ES", "HR"],
  CO: ["VE", "EC", "ES"],
  PE: ["ES", "JP", "EC", "BO"],
  EC: ["CO", "PE", "ES"],
  PY: ["AR", "BR", "ES"],
  US: ["MX", "CA", "EN", "DE", "JM", "HT", "NG", "GH", "CO", "PH"],
  CA: ["FR", "EN", "JM", "HT", "PT", "IT", "NG", "IN", "PH"],
  AU: ["EN", "NZ", "IT", "GR", "HR", "RS", "IE", "LB"],
  NZ: ["EN", "AU", "WS", "TO", "FJ"],
  MA: ["FR", "ES", "NL", "BE"],
  DZ: ["FR", "TN"],
  TN: ["FR", "IT", "DZ"],
  SN: ["FR", "ML", "GM", "GN"],
  ML: ["FR", "SN", "CI"],
  NG: ["EN", "GH", "US", "CM"],
  GH: ["EN", "DE", "NL", "NG", "CI"],
  CM: ["FR", "NG", "CD"],
  CI: ["FR", "BF", "ML", "GH"],
  CD: ["BE", "FR", "CG", "AO"],
  CV: ["PT", "FR", "NL", "SN"],
  AO: ["PT", "CD", "CV"],
  GW: ["PT", "SN", "CV"],
  MZ: ["PT", "ZA", "ZW"],
  ZA: ["ZW", "MZ", "BW", "LS", "EN"],
  TR: ["DE", "NL", "BG", "AT"],
  JP: ["BR", "US", "PH", "KR"],
  KR: ["US", "JP", "CN"],
  CN: ["TW", "HK", "SG"],
  PH: ["US", "ES", "JP", "AU"],
  ID: ["NL", "MY", "CN"],
  MY: ["ID", "CN", "IN", "SG"],
  SG: ["MY", "CN", "IN", "ID"],
  IN: ["EN", "PK", "BD", "NP"],
  PK: ["EN", "IN", "AF"],
  BD: ["EN", "IN"],
  IL: ["RU", "FR", "US", "UA"],
};
const multipleNationalityCountries = new Set(
  "EN SCO WAL NIR IE FR DE PT BR NL BE ES IT LU CH AT SE NO DK FI PL CZ SK HR RS BA AL GR CY RO HU AR UY CL CO PE EC PY BO VE US CA AU NZ MA DZ TN SN ML NG GH CM CI CD CG CV AO GW MZ ZA ZW TR PH PK BD IL MX JM HT SR CW GP MQ RE".split(
    " ",
  ),
);

export function playerBackground(
  random: seedrandom.PRNG,
  country: Country,
  countries: Country[],
): Partial<PlayerProfile["identity"]> {
  const byCode = new Map(countries.map((entry) => [entry.code, entry]));
  const links = (familyLinks[country.code] ?? [])
    .map((code) => byCode.get(code))
    .filter(
      (entry): entry is Country => Boolean(entry) && entry!.id !== country.id,
    );
  const roll = random();
  const origins = [country];
  if (roll < 0.34 && links.length)
    origins.push(links[Math.floor(random() * links.length)]);
  if (roll < 0.075 && links.length > 1) {
    const thirdChoices = links.filter(
      (entry) => !origins.some((origin) => origin.id === entry.id),
    );
    origins.push(thirdChoices[Math.floor(random() * thirdChoices.length)]);
  }
  const percentages =
    origins.length === 3
      ? [50, 25, 25]
      : origins.length === 2
        ? [50, 50]
        : [100];
  const heritage = origins.map((entry, index) => ({
    country: entry.name,
    percentage: percentages[index],
  }));
  const maternal = origins[1] ?? country;
  const paternal = origins[2] ?? country;
  const nationalities: NonNullable<PlayerProfile["identity"]["nationalities"]> =
    [
      {
        countryId: country.id,
        code: country.code,
        country: country.name,
        basis: "birth",
      },
    ];
  if (multipleNationalityCountries.has(country.code)) {
    for (const origin of origins.slice(1))
      if (multipleNationalityCountries.has(origin.code))
        nationalities.push({
          countryId: origin.id,
          code: origin.code,
          country: origin.name,
          basis: "parent",
        });
  }
  const languages = [{ language: country.language, fluency: 5 }];
  for (const origin of origins.slice(1))
    if (!languages.some((entry) => entry.language === origin.language))
      languages.push({
        language: origin.language,
        fluency: 2 + Math.floor(random() * 3),
      });
  const birthplace = `${country.region}, ${country.name}`;
  return {
    heritage,
    nationalities,
    languages,
    birthCountryId: country.id,
    birthplace,
    region: country.region,
    familyOrigins: { maternal: maternal.name, paternal: paternal.name },
    nameOriginCountryId:
      origins.length > 1 && random() < 0.65 ? maternal.id : country.id,
    internationalCountryId: country.id,
    biography: [
      `Born and raised in ${birthplace}.`,
      origins.length === 1
        ? `Both sides of the family have roots in ${country.name}.`
        : `The maternal side of the family has roots in ${maternal.name}; the paternal side has roots in ${paternal.name}.`,
      nationalities.length > 1
        ? `Holds ${nationalities.map((entry) => entry.country).join(", ")} nationalities through birth and family ties.`
        : `Registered internationally for ${country.name}. Family heritage does not automatically grant another nationality.`,
    ],
  };
}
