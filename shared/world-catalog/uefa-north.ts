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

// Owner: catalog author "uefa-north" — EN SCO WAL NIR IE IS FO NO SE DK FI EE LV LT (validate.ts CATALOG_ASSIGNMENT).
// Real 2025/26 structures and names without sponsors; clubs are generated. Money is GBP.

const list = (names: string) =>
  names.split("|").map((name) => name.trim()).filter(Boolean);
const pool = (name: string, given: string, family: string): NamePool => ({
  id: `uefa-north/${name}`,
  ...(given.trim() ? { given: list(given) } : {}),
  ...(family.trim() ? { family: list(family) } : {}),
});
/** "english=0.7 faker:da=0.3": bare names are pools of this file. */
const sources = (spec: string): WeightedNameSource[] =>
  spec.trim().split(/\s+/).map((entry) => {
    const [name, weight] = entry.split("=");
    const source = (name.includes(":") ? name : `pool:uefa-north/${name}`) as WeightedNameSource["source"];
    return { source, weight: Number(weight) };
  });
/** "IE:10 JM:8" */
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

// ------------------------------------------------------------------ name pools

const ENGLISH = pool(
  "english",
  "Aaron|Adam|Adrian|Aidan|Alan|Albie|Alex|Alexander|Alfie|Alfred|Andre|Andrew|Andy|Anthony|Archie|Arlo|Arthur|Ashley|Ashton|Austin|Barney|Barry|Ben|Benjamin|Bertie|Billy|Blake|Bobby|Bradley|Brandon|Brendan|Brooklyn|Bryan|Caleb|Callum|Calvin|Cameron|Carl|Charles|Charlie|Chris|Christian|Christopher|Cody|Cole|Colin|Connor|Corey|Craig|Curtis|Dale|Dan|Daniel|Danny|Darius|Darnell|Darren|David|Dean|Declan|Demarai|Dennis|Derek|Dexter|Dion|Dominic|Duncan|Dwight|Dylan|Eddie|Edward|Eli|Elijah|Elliot|Elliott|Ellis|Emile|Emmanuel|Eric|Ethan|Ezra|Felix|Finley|Finn|Frankie|Freddie|Frederick|Gabriel|Gareth|Gary|George|Glen|Gordon|Graham|Greg|Harley|Harrison|Harry|Harvey|Hayden|Henry|Hugo|Ian|Isaac|Isaiah|Jack|Jacob|Jaden|Jadon|Jake|Jamal|James|Jamie|Jarell|Jarrod|Jason|Jay|Jayden|Jermaine|Jerome|Jesse|Jimmy|Joe|Joel|Joey|John|Jonah|Jonathan|Jonny|Jordan|Joseph|Josh|Joshua|Jude|Jules|Justin|Kai|Kaine|Kane|Karl|Keith|Kelvin|Kenny|Kevin|Kian|Kieran|Kobe|Kurt|Kyle|Lee|Leo|Leon|Levi|Lewis|Liam|Lloyd|Logan|Louie|Louis|Luca|Lucas|Luke|Malachi|Malcolm|Marcus|Mark|Marley|Martin|Mason|Matt|Matthew|Max|Michael|Miles|Mitchell|Morgan|Myles|Nathan|Nathaniel|Neil|Nicholas|Nick|Noah|Noel|Oakley|Oliver|Ollie|Omari|Oscar|Owen|Paul|Peter|Phil|Philip|Reece|Reggie|Reuben|Rhys|Ricky|Rico|Riley|Rio|Robbie|Robert|Rohan|Ronnie|Rory|Ross|Ryan|Sam|Samuel|Scott|Sean|Sebastian|Shane|Shaun|Simon|Sonny|Spencer|Stanley|Stephen|Steve|Steven|Stuart|Taylor|Teddy|Terry|Theo|Thomas|Toby|Tom|Tommy|Tony|Travis|Trent|Tristan|Troy|Tyler|Tyreke|Tyrese|Tyrone|Warren|Wayne|Wes|Wesley|Will|William|Zach|Zachary|Zak|Zane",
  "Abbott|Adams|Allen|Allsop|Anderson|Andrews|Appleby|Archer|Armstrong|Arnold|Ashby|Ashworth|Atkins|Atkinson|Austin|Bailey|Baker|Ball|Banks|Barber|Barker|Barlow|Barnes|Barnett|Barrett|Barton|Bates|Baxter|Beckett|Bell|Bennett|Berry|Bird|Bishop|Blackburn|Blake|Bolton|Bond|Booth|Bowen|Bowler|Boyd|Bradley|Bradshaw|Brady|Bray|Brennan|Brewer|Briggs|Bright|Brooks|Brown|Bryant|Buckley|Bull|Burgess|Burke|Burns|Burrows|Burton|Butcher|Butler|Byrne|Caldwell|Campbell|Carr|Carroll|Carter|Cartwright|Chadwick|Chambers|Chandler|Chapman|Charlton|Clark|Clarke|Clayton|Clements|Coates|Cole|Coleman|Collier|Collins|Connolly|Cook|Cooke|Cooper|Cox|Crawford|Cross|Crossley|Cunningham|Curtis|Dale|Dalton|Daniels|Davey|Davidson|Davies|Davis|Dawson|Day|Dean|Dennis|Dixon|Dobson|Dodd|Douglas|Doyle|Drake|Duffy|Duncan|Dyer|Eaton|Edwards|Elliott|Ellis|Evans|Farmer|Farrell|Fenton|Field|Fielding|Finch|Fisher|Fleming|Fletcher|Flynn|Ford|Forster|Foster|Fowler|Fox|Francis|Franklin|Freeman|French|Fuller|Gale|Gardner|Garner|George|Gibbs|Gibson|Gilbert|Giles|Gill|Goddard|Golding|Goodwin|Gordon|Gould|Graham|Grant|Gray|Green|Greenwood|Gregory|Griffin|Griffiths|Hale|Hall|Hamilton|Hammond|Hancock|Hanson|Harding|Hardy|Hargreaves|Harper|Harris|Harrison|Hart|Hartley|Harvey|Hawkins|Hayes|Haynes|Heath|Henderson|Hewitt|Hicks|Hill|Hodgson|Holden|Holland|Holmes|Holt|Hooper|Hope|Horton|Houghton|Howard|Howarth|Howe|Hudson|Hughes|Hunt|Hunter|Hutchinson|Ingram|Jackson|James|Jarvis|Jenkins|Jennings|Johnson|Johnston|Jones|Jordan|Kay|Kelly|Kemp|Kennedy|Kent|Kerr|King|Kirby|Knight|Knowles|Lamb|Lambert|Lane|Law|Lawrence|Lawson|Leach|Lee|Lewis|Lloyd|Long|Lord|Lowe|Lucas|Lynch|Mann|Marsh|Marshall|Martin|Mason|Matthews|May|McCarthy|McDonald|Mellor|Metcalfe|Miles|Miller|Mills|Mitchell|Moore|Morgan|Morris|Morton|Moss|Murphy|Murray|Nash|Naylor|Nelson|Newman|Newton|Nicholls|Nicholson|Norman|Norris|North|O'Brien|O'Connor|O'Neill|Oliver|Osborne|Owen|Page|Palmer|Parker|Parkinson|Parry|Parsons|Payne|Pearce|Pearson|Perkins|Perry|Phillips|Pickering|Pollard|Poole|Porter|Potter|Powell|Pratt|Preston|Price|Quinn|Randall|Read|Reed|Rees|Reeves|Reid|Reynolds|Rhodes|Richards|Richardson|Riley|Roberts|Robertson|Robinson|Robson|Rogers|Rose|Ross|Rowe|Rowley|Russell|Ryan|Sanders|Saunders|Savage|Scott|Sharp|Sharpe|Shaw|Shepherd|Short|Simmons|Simpson|Sims|Skinner|Slater|Smart|Smith|Spencer|Stanley|Steele|Stephens|Stephenson|Stevens|Stevenson|Stewart|Stone|Storey|Sullivan|Summers|Sutton|Swift|Sykes|Tate|Taylor|Thomas|Thompson|Thornton|Todd|Townsend|Tucker|Turner|Tyler|Wade|Walker|Wallace|Walsh|Walters|Walton|Ward|Warner|Warren|Waters|Watson|Watts|Webb|Webster|Welch|Wells|West|Wheeler|Whitaker|White|Whitehead|Whittaker|Wilkins|Wilkinson|Williams|Williamson|Willis|Wilson|Wood|Woods|Woodward|Wright|Wyatt|Yates|Young",
);
const SCOTTISH = pool(
  "scottish",
  "Aaron|Adam|Aidan|Alan|Alasdair|Alastair|Alex|Alexander|Ali|Alistair|Allan|Ally|Andrew|Andy|Angus|Archie|Arran|Arron|Barry|Ben|Billy|Blair|Bobby|Brian|Brodie|Bruce|Calum|Callum|Cameron|Cammy|Charlie|Chris|Christopher|Ciaran|Colin|Connor|Conor|Craig|Dale|Daniel|Danny|Darren|David|Dean|Declan|Derek|Dominic|Dougie|Douglas|Duncan|Dylan|Ethan|Euan|Ewan|Finlay|Finn|Fraser|Gary|Gavin|Gordon|Graeme|Graham|Grant|Greg|Hamish|Harry|Iain|Ian|Innes|Jack|Jackson|Jake|James|Jamie|Jay|John|Jon|Jordan|Josh|Kai|Keir|Keith|Kenneth|Kenny|Kerr|Kevin|Kieran|Kyle|Lachlan|Lee|Lennon|Lewis|Liam|Logan|Lyle|Lyndon|Mark|Martin|Matthew|Max|Michael|Murray|Nathan|Neil|Niall|Nicky|Oliver|Owen|Paul|Peter|Rhys|Ricky|Robbie|Robert|Rory|Ross|Ruaridh|Ryan|Sam|Scott|Sean|Shaun|Stephen|Steven|Stevie|Stuart|Thomas|Tom|Tommy|Tony|Zander",
  "Aitken|Allan|Anderson|Armstrong|Baird|Barr|Beattie|Bell|Black|Boyd|Boyle|Brady|Brown|Bruce|Buchanan|Burns|Cairns|Cameron|Campbell|Christie|Clark|Cochrane|Cooper|Cowan|Craig|Crawford|Cummings|Cunningham|Currie|Davidson|Devlin|Dickson|Docherty|Doig|Donaldson|Donnelly|Douglas|Doyle|Drummond|Duffy|Duncan|Dunlop|Dunn|Durie|Ferguson|Findlay|Fleming|Forbes|Forrest|Fraser|Fulton|Gallacher|Gallagher|Gemmell|Gibson|Gilchrist|Gillespie|Gilmour|Gordon|Graham|Grant|Gray|Hamilton|Hanlon|Hay|Henderson|Hendry|Hogg|Houston|Hughes|Hunter|Hutchison|Inglis|Irvine|Jack|Jamieson|Johnston|Johnstone|Kelly|Kennedy|Kerr|Kidd|Kinnear|Laing|Lamont|Lang|Lawrie|Lennox|Lindsay|Little|Lockhart|Logan|Love|Lyall|MacDonald|MacGregor|MacKay|Mackenzie|MacKinnon|MacLean|MacLeod|MacPherson|Mair|Malcolm|Marshall|Martin|Masterton|McAllister|McArthur|McAulay|McBride|McCall|McCallum|McCann|McCart|McColl|McCulloch|McDermott|McDonald|McFadden|McGhee|McGinn|McGowan|McGrath|McGregor|McIntosh|McIntyre|McKay|McKean|McKenna|McKenzie|McKinlay|McLaren|McLaughlin|McLean|McLeish|McLeod|McManus|McMillan|McNab|McNeil|McPherson|McStay|Middleton|Millar|Miller|Milne|Mitchell|Moffat|Moir|Morrison|Muir|Munro|Murdoch|Murray|Naismith|Neilson|Nicol|Nicolson|Ogilvie|O'Hara|Orr|Paterson|Paton|Pollock|Quinn|Rae|Reid|Rennie|Ritchie|Robb|Robertson|Ross|Russell|Scott|Shand|Shaw|Shearer|Simpson|Sinclair|Skinner|Smith|Steele|Stevenson|Stewart|Strachan|Sutherland|Tait|Taylor|Thomson|Todd|Tulloch|Turnbull|Urquhart|Walker|Wallace|Watson|Watt|Weir|Whyte|Wilkie|Wilson|Wood|Wright|Wylie|Young|Yule",
);
const WELSH = pool(
  "welsh",
  "Aaron|Aled|Alun|Andrew|Aneurin|Arwel|Ben|Bleddyn|Brennan|Bryn|Cai|Caradog|Carwyn|Cerith|Chris|Ciaran|Connor|Cynan|Dafydd|Daniel|David|Deiniol|Dewi|Dion|Dylan|Efan|Einion|Elis|Elliot|Emlyn|Emrys|Emyr|Ethan|Evan|Gareth|Garmon|Gavin|Geraint|Gethin|Glyn|Gruffydd|Gwilym|Gwion|Gwyn|Harri|Harry|Hedd|Huw|Hywel|Iestyn|Ieuan|Ifan|Illtyd|Ioan|Iolo|Islwyn|Iwan|Jac|Jack|Jake|Jamie|Joe|Joel|Jonny|Jordan|Josh|Kai|Kieran|Kyle|Lewis|Liam|Llew|Lloyd|Llyr|Luke|Macsen|Madog|Mark|Math|Matthew|Meilir|Morgan|Nathan|Neil|Osian|Owain|Owen|Peredur|Rhodri|Rhydian|Rhys|Rob|Ryan|Sam|Scott|Siôn|Steffan|Taliesin|Tegid|Tom|Tomos|Trystan|Tudur|Tyler|Wil|Wyn|Ynyr|Zac",
  "Jones|Williams|Davies|Evans|Thomas|Roberts|Hughes|Lewis|Morgan|Griffiths|Edwards|James|Owen|Owens|Price|Jenkins|Phillips|Rees|Parry|Lloyd|Powell|Morris|Harris|Bowen|Pritchard|Watkins|Howells|Rowlands|Vaughan|Pugh|Probert|Prosser|Bevan|Llewellyn|Meredith|Mathias|Nicholas|Pryce|Wynne|Beynon|Cadwallader|Craddock|Gittins|Gough|Humphreys|Ellis|John|Maddox|Richards|Rosser|Walters|Gruffydd|Hopkins|Griffith|Hopkin|Cadogan|Dando|Eynon|Floyd|Gwynne|Harry|Howell|Jarman|Jeffreys|Laugharne|Lougher|Mathews|Meyrick|Parfitt|Penry|Preece|Prothero|Pryse|Rhys|Skyrme|Tanner|Trahearne|Tudor|Voyle|Wogan|Wynn|Yorath|Bowden|Daniel|Emanuel|Gethin|Jenkin|Madoc|Mostyn|Stradling|Herbert|Harries|Havard|Protheroe|Rhydderch|Colley|Kemble|Lawrence|Luke|Nash|Perrott|Picton",
);

// ------------------------------------------------------------------ England

const EN_REGIONS: Record<string, string> = {
  L: "London",
  SE: "South East",
  SW: "South West",
  EE: "East of England",
  WM: "West Midlands",
  EM: "East Midlands",
  Y: "Yorkshire and the Humber",
  NW: "North West",
  NE: "North East",
};

const ENGLAND: NationSpec = {
  code: "EN",
  iso2: "GB",
  name: "England",
  confederation: "UEFA",
  continent: "EU",
  capital: "London",
  latitude: 52.5,
  languages: [{ code: "en", weight: 1 }],
  reputation: { national: 90, league: 95 },
  euEea: false,
  physique: { height: 181 },
  names: { given: sources("english=1"), family: sources("english=1") },
  nationality: {
    multipleRate: 0.34,
    tripleRate: 0.06,
    bornAbroadRate: 0.06,
    diasporaPull: 0.3,
    links: [
      ...links("britishIrish", "IE:10 SCO:4 WAL:3 NIR:2"),
      ...links("caribbean", "JM:9 TT:2 BB:1.8 GY:1.5 GD:1.2 KN:1 AG:0.9 LC:0.8 MS:0.7 DM:0.6 VC:0.6 BM:0.6"),
      ...links("commonwealth", "NG:8 GH:5.5 SL:2.5 ZW:2.5 ZA:1.5 KE:1.2 UG:1 IN:3.5 PK:3.5 BD:2 CY:1.5 MT:0.6 AU:1.2 CA:1 NZ:0.6"),
      ...links("crossBorder", "CD:2 CI:1.2 CM:1 SO:1.2 ER:0.6 AO:0.6 PL:3 PT:2.5 IT:2 FR:1.5 ES:1 DE:1 GR:0.8 TR:1.2 LT:0.8 RO:1.2 AL:0.8 XK:0.6 IQ:0.6 IR:0.6"),
      ...links("americas", "US:1.2 BR:0.8 CO:0.5"),
      ...links("asianDiaspora", "CN:0.6 HK:0.5 PH:0.6 VN:0.4 MY:0.3"),
    ],
    citizenship: { group: "GB", dual: "allowed" },
  },
  cities: {
    major: cityRows(
      `
London|mega|L|16|Islington,Camden,Hackney,Stratford,Walthamstow,Woolwich,Greenwich,Lewisham,Peckham,Brixton,Clapham,Wandsworth,Hammersmith,Ealing,Hampstead,Holloway,Poplar,Bermondsey,Battersea,Kennington,Paddington,Chiswick,Tooting,Streatham,Deptford,Catford,Eltham,Croydon,Dagenham,Hornchurch,Welling,Enfield
Birmingham|large|WM|3|Small Heath,Erdington,Edgbaston,Handsworth,Sparkhill,Moseley,Kings Heath,Selly Oak,Yardley,Digbeth
Manchester|large|NW|3|Ardwick,Gorton,Moston,Newton Heath,Didsbury,Chorlton,Rusholme,Levenshulme,Hulme,Wythenshawe
Liverpool|large|NW|2|Walton,Toxteth,Kirkdale,West Derby,Wavertree,Garston,Aigburth,Speke
Leeds|large|Y|2|Farsley,Headingley,Beeston,Armley,Horsforth,Pudsey,Garforth
Sheffield|large|Y|2|Hillsborough,Attercliffe,Crookes,Darnall,Heeley,Walkley,Ecclesall
Bristol|large|SW|2|Bedminster,Clifton,Fishponds,Horfield,Kingswood,Southmead,Eastville,Brislington
Newcastle|large|NE|1
Nottingham|large|EM|2|Sneinton,Meadows,Radford,Bulwell,Basford,Lenton,Clifton
Leicester|large|EM|1
Coventry|large|WM|1
Bradford|large|Y|2|Manningham,Idle,Thornton,Eccleshill,Bowling
Hull|large|Y|1
Stoke|large|WM|2|Burslem,Hanley,Tunstall,Longton,Fenton
Wolverhampton|large|WM|1
Plymouth|large|SW|1
Southampton|large|SE|1
Portsmouth|large|SE|1
Derby|large|EM|1
Sunderland|large|NE|1
Middlesbrough|large|NE|1
Brighton|large|SE|1
Reading|medium|SE|1
Norwich|medium|EE|1
Ipswich|medium|EE|1
Milton Keynes|medium|SE|1
Luton|medium|EE|1
Northampton|medium|EM|1
Peterborough|medium|EE|1
Oxford|medium|SE|2|Headington,Cowley,Marston
Cambridge|medium|EE|1
Swindon|medium|SW|1
Preston|medium|NW|1
Bolton|medium|NW|1
Blackpool|medium|NW|1
Bournemouth|medium|SW|1
Huddersfield|medium|Y|1
Southend|medium|EE|1
Salford|medium|NW|1
Warrington|medium|NW|1
Wigan|small|NW|1
Barnsley|small|Y|1
Rotherham|small|Y|1
Doncaster|small|Y|1
Stockport|small|NW|1
Oldham|small|NW|1
Blackburn|small|NW|1
Burnley|small|NW|1
Watford|small|EE|1
Exeter|small|SW|1
Gillingham|small|SE|1
Colchester|small|EE|1
Crawley|small|SE|1
Stevenage|small|EE|1
Lincoln|small|EM|1
Mansfield|small|EM|1
Chesterfield|small|EM|1
Walsall|small|WM|1
Shrewsbury|small|WM|1
Cheltenham|small|SW|1
Crewe|small|NW|1
Carlisle|small|NW|1
York|small|Y|1
Grimsby|small|Y|1
Scunthorpe|small|Y|1
Hartlepool|small|NE|1
Harrogate|small|Y|1
Burton|small|WM|1
Wycombe|small|SE|1
Birkenhead|small|NW|1
Gateshead|small|NE|1
Darlington|small|NE|1
Stockton|small|NE|1
Chester|small|NW|1
Southport|small|NW|1
Rochdale|small|NW|1
Bury|small|NW|1
Barrow|small|NW|1
Aldershot|small|SE|1
Woking|small|SE|1
Eastleigh|small|SE|1
Solihull|small|WM|1
Telford|small|WM|1
Kidderminster|small|WM|1
Hereford|small|WM|1
Worcester|small|WM|1
Nuneaton|small|WM|1
Tamworth|small|WM|1
Kettering|small|EM|1
Scarborough|small|Y|1
Halifax|small|Y|1
Wakefield|small|Y|1
Macclesfield|small|NW|1
Altrincham|small|NW|1
South Shields|small|NE|1
Torquay|small|SW|1
Bath|small|SW|1
Weston-super-Mare|small|SW|1
Gloucester|small|SW|1
Poole|small|SW|1
Maidstone|small|SE|1
Dartford|small|SE|1
Gravesend|small|SE|1
Canterbury|small|SE|1
Ashford|small|SE|1
Hastings|small|SE|1
Eastbourne|small|SE|1
Worthing|small|SE|1
Basingstoke|small|SE|1
Slough|small|SE|1
Maidenhead|small|SE|1
Farnborough|small|SE|1
Aylesbury|small|SE|1
Chelmsford|small|EE|1
Hemel Hempstead|small|EE|1
St Albans|small|EE|1
Bedford|small|EE|1
Loughborough|small|EM|1
Stafford|small|WM|1
Accrington|town|NW|1
Morecambe|town|NW|1
Fleetwood|town|NW|1
Chorley|town|NW|1
Workington|town|NW|1
Northwich|town|NW|1
Radcliffe|town|NW|1
Hyde|town|NW|1
Stalybridge|town|NW|1
Kendal|town|NW|1
Buxton|town|EM|1
Boston|town|EM|1
Alfreton|town|EM|1
Gainsborough|town|EM|1
Brackley|town|EM|1
Worksop|town|EM|1
Hinckley|town|EM|1
Rushden|town|EM|1
Spennymoor|town|NE|1
Blyth|town|NE|1
Consett|town|NE|1
King's Lynn|town|EE|1
Braintree|town|EE|1
Borehamwood|town|EE|1
Bishop's Stortford|town|EE|1
Cheshunt|town|EE|1
Harlow|town|EE|1
Hitchin|town|EE|1
Yeovil|town|SW|1
Truro|town|SW|1
Chippenham|town|SW|1
Weymouth|town|SW|1
Taunton|town|SW|1
Salisbury|town|SW|1
Nailsworth|town|SW|1
Dorking|town|SE|1
Tonbridge|town|SE|1
Horsham|town|SE|1
Folkestone|town|SE|1
Dover|town|SE|1
Chatham|town|SE|1
Banbury|town|SE|1
Marlow|town|SE|1
Winchester|town|SE|1
Havant|town|SE|1
Bognor Regis|town|SE|1
Chichester|town|SE|1
Leamington|town|WM|1
Cannock|town|WM|1
Stourbridge|town|WM|1
Rugby|town|WM|1
Redditch|town|WM|1
Leek|town|WM|1
`,
      EN_REGIONS,
    ),
    extra: {
      admin1: ["ENG"],
      exclude: [
        "Newcastle upon Tyne",
        "Kingston upon Hull",
        "Stoke-on-Trent",
        "Burton upon Trent",
        "Southend-on-Sea",
        "Barrow in Furness",
        "High Wycombe",
        "Stockton-on-Tees",
        "Royal Leamington Spa",
        "Bishops Stortford",
        "City of London",
        "Westminster",
      ],
      max: 700,
    },
  },
  football: {
    leagues: [
      {
        tier: 1,
        name: "Premier League",
        shortName: "Premier League",
        size: 20,
        status: "professional",
        reputation: 95,
        clubs: {
          reputation: span(84, 72),
          giants: { count: 6, top: 94, bottom: 87 },
          capacity: span(74_000, 11_300),
          facilities: span(96, 74),
          academy: span(93, 66),
          wageBill: span(420_000_000, 72_000_000),
          transferBudget: span(200_000_000, 30_000_000),
          foreignShare: 0.66,
          squadSize: [26, 32],
        },
      },
      {
        tier: 2,
        name: "EFL Championship",
        shortName: "Championship",
        size: 24,
        status: "professional",
        reputation: 74,
        clubs: {
          reputation: span(73, 58),
          capacity: span(39_700, 12_500),
          facilities: span(80, 58),
          academy: span(84, 55),
          wageBill: span(95_000_000, 13_000_000),
          transferBudget: span(30_000_000, 800_000),
          foreignShare: 0.45,
          squadSize: [25, 30],
        },
      },
      {
        tier: 3,
        name: "EFL League One",
        shortName: "League One",
        size: 24,
        status: "professional",
        reputation: 60,
        clubs: {
          reputation: span(60, 48),
          capacity: span(33_000, 6_500),
          facilities: span(66, 44),
          academy: span(70, 40),
          wageBill: span(28_000_000, 3_000_000),
          transferBudget: span(8_000_000, 100_000),
          foreignShare: 0.3,
          squadSize: [25, 29],
        },
      },
      {
        tier: 4,
        name: "EFL League Two",
        shortName: "League Two",
        size: 24,
        status: "professional",
        reputation: 52,
        clubs: {
          reputation: span(51, 41),
          capacity: span(30_000, 4_500),
          facilities: span(54, 36),
          academy: span(56, 30),
          wageBill: span(9_500_000, 1_800_000),
          transferBudget: span(2_500_000, 25_000),
          foreignShare: 0.24,
          squadSize: [25, 28],
        },
      },
      {
        tier: 5,
        name: "National League",
        shortName: "National League",
        size: 24,
        status: "professional",
        reputation: 44,
        clubs: {
          reputation: span(44, 34),
          capacity: span(18_000, 3_000),
          facilities: span(46, 28),
          academy: span(42, 22),
          wageBill: span(5_000_000, 700_000),
          transferBudget: span(600_000, 10_000),
          foreignShare: 0.17,
          squadSize: [25, 27],
        },
      },
      {
        // National League North (24) and National League South (24); includes the hosted Welsh club (Merthyr Town).
        tier: 6,
        name: "National League North/South",
        shortName: "NL North/South",
        size: 48,
        status: "semi-professional",
        reputation: 34,
        conferences: ["North", "South"],
        clubs: {
          reputation: span(34, 22),
          capacity: span(7_000, 1_500),
          facilities: span(36, 16),
          academy: span(32, 12),
          wageBill: span(2_300_000, 250_000),
          transferBudget: span(150_000, 5_000),
          foreignShare: 0.12,
          squadSize: [25, 26],
        },
      },
    ],
    movement: [
      {
        upper: 1,
        promoted: 2,
        relegated: 3,
        playoffs: [{ type: "promotion", positions: [3, 6], places: 1, legs: 2, finalLegs: 1, neutralFinal: true }],
      },
      {
        upper: 2,
        promoted: 2,
        relegated: 3,
        playoffs: [{ type: "promotion", positions: [3, 6], places: 1, legs: 2, finalLegs: 1, neutralFinal: true }],
      },
      {
        upper: 3,
        promoted: 3,
        relegated: 4,
        playoffs: [{ type: "promotion", positions: [4, 7], places: 1, legs: 2, finalLegs: 1, neutralFinal: true }],
      },
      {
        upper: 4,
        promoted: 1,
        relegated: 2,
        playoffs: [{ type: "promotion", positions: [2, 7], places: 1, legs: 1, finalLegs: 1, neutralFinal: true }],
      },
      {
        // Each division's champion goes up, plus the winner of each division's 2nd-7th play-off (single legs).
        upper: 5,
        promoted: 2,
        relegated: 4,
        perConference: true,
        playoffs: [{ type: "promotion", positions: [2, 7], places: 2, legs: 1 }],
      },
    ],
    cups: [
      { kind: "national", name: "FA Cup", maxEntrants: 124, seededEntry: true, legs: 1, neutralFinal: true, continental: true },
      { kind: "league", name: "EFL Cup", tiers: [1, 2, 3, 4], seededEntry: true, legs: 1, neutralFinal: true, continental: true },
      { kind: "super", name: "FA Community Shield", participants: ["champion", "cup-winner"], neutralFinal: true, start: "08-09" },
    ],
    youth: {
      U19: {
        divisions: [
          division("U18 Premier League", [1, 1], 10, "North|South"),
          division("U18 Professional Development League", [2, 2], 12, "North|South"),
          division("EFL Youth Alliance", [3, 4], 12, "North West|North East|South West|South East"),
          division("National League U19 Alliance", [5, 6], 16, "North|Midlands|South East|South West"),
        ],
        cup: { name: "FA Youth Cup" },
      },
      // England has no national U17 league: U17 academy fixtures follow the U18 competition structure.
      U17: {
        divisions: [
          division("U17 Premier League", [1, 1], 10, "North|South"),
          division("U17 Professional Development League", [2, 2], 12, "North|South"),
          division("EFL Youth Alliance U17", [3, 4], 12, "North West|North East|South West|South East"),
          division("National League U17 Alliance", [5, 6], 16, "North|Midlands|South East|South West"),
        ],
      },
    },
    reserves: { mode: "none" },
    clubNaming: {
      templates: templates(`
{city} Town|16
{city} City|14
{city} United|16
{city} Rovers|7
{city} Athletic|7
{city} Wanderers|5
{city} Albion|4
{city} County|5
{city} FC|5
AFC {city}|2.5|4,5,6
{city} Borough|3|4,5,6
{city} Harriers|1.5|5,6
{city} Alexandra|0.6
{city} Sports|0.8|6
{city} Corinthian|0.6|6
`),
      founded: { top: [1865, 1905], bottom: [1878, 2012] },
      shortName: "city",
      colors: ["#C8102E", "#034694", "#FFFFFF", "#6CABDD", "#FDB913", "#7A263A", "#1B458F", "#EF0107", "#000000", "#00A650", "#FF8200", "#8B0000"],
    },
    importSources: codes(
      "FR:9 BR:8 IE:7 ES:6 PT:6 NL:5 SCO:5 BE:4 DE:4 AR:4 WAL:3 NIR:2 NG:3 GH:3 DK:3 JM:3 US:3 SN:2.5 NO:2 SE:2 CI:2 CO:2 UY:2 IT:2 CH:2 HR:2 PL:2 JP:2 AU:2 MA:2 CM:1.5 ML:1.5 CA:1.5 EC:1.5 CD:1.5 AT:1 RS:1 UA:1 CZ:1 TR:1 GR:1 KR:1 DZ:1 IS:0.8 HU:0.8 EG:0.8 PY:0.8 CL:0.8 MX:0.8 ZW:0.8 FI:0.6 SK:0.6 BA:0.6 AL:0.6 XK:0.6 NZ:0.6 VE:0.6 GE:0.6 CV:0.6 SI:0.5 IL:0.5 TN:0.5 CR:0.5 UZ:0.5 IR:0.5 GW:0.5 AO:0.5",
    ),
    coefficients: { association: [24.357, 21.0, 23.0, 17.375, 29.464], season2025: 28.68 },
  },
};

// ------------------------------------------------------------------ Wales

const WALES: NationSpec = {
  code: "WAL",
  iso2: "GB",
  name: "Wales",
  confederation: "UEFA",
  continent: "EU",
  capital: "Cardiff",
  latitude: 52.1,
  languages: [
    { code: "en", weight: 0.8 },
    { code: "cy", weight: 0.2 },
  ],
  reputation: { national: 68, league: 30 },
  euEea: false,
  physique: { height: 180 },
  names: { given: sources("welsh=0.62 english=0.38"), family: sources("welsh=0.72 english=0.28") },
  nationality: {
    multipleRate: 0.32,
    tripleRate: 0.05,
    bornAbroadRate: 0.12,
    diasporaPull: 0.5,
    links: [
      ...links("britishIrish", "EN:12 IE:3 SCO:1.5 NIR:0.5"),
      ...links("commonwealth", "JM:1.2 NG:1 GH:0.5 SL:0.6 ZW:0.5 IN:0.8 PK:0.8 BD:1 ZA:0.4 AU:0.4"),
      ...links("crossBorder", "SO:1 YE:0.6 PL:1.5 IT:1.2 PT:0.6 CD:0.6 ES:0.3"),
      ...links("americas", "US:0.4 AR:0.3"),
      ...links("asianDiaspora", "CN:0.4"),
    ],
    citizenship: { group: "GB", dual: "allowed" },
  },
  cities: {
    major: cityRows(`
Cardiff|large|Cardiff|2|Cyncoed,Ely,Canton,Llanishen,Splott,Grangetown,Llandaff,Roath
Swansea|large|Swansea|1|Sketty,Morriston,Townhill
Newport|medium|Newport|1|Caerleon,Lliswerry
Wrexham|medium|Wrexham|1|Gresford
Barry|small|Vale of Glamorgan|1
Bridgend|small|Bridgend|1
Llanelli|small|Carmarthenshire|1
Neath|small|Neath Port Talbot|1
Merthyr Tydfil|small|Merthyr Tydfil|1
Port Talbot|small|Neath Port Talbot|1
Cwmbran|small|Torfaen|1
Caerphilly|small|Caerphilly|1
Pontypridd|small|Rhondda Cynon Taf|1
Rhyl|small|Denbighshire|1
Bangor|small|Gwynedd|1
Colwyn Bay|small|Conwy|1
Aberdare|town|Rhondda Cynon Taf|1
Connah's Quay|town|Flintshire|1
Flint|town|Flintshire|1
Mold|town|Flintshire|1
Buckley|town|Flintshire|1
Holywell|town|Flintshire|1
Prestatyn|town|Denbighshire|1
Denbigh|town|Denbighshire|1
Llandudno|town|Conwy|1
Caernarfon|town|Gwynedd|1
Porthmadog|town|Gwynedd|1
Pwllheli|town|Gwynedd|1
Bala|town|Gwynedd|1
Holyhead|town|Anglesey|1
Llangefni|town|Anglesey|1
Aberystwyth|town|Ceredigion|1
Cardigan|town|Ceredigion|1
Carmarthen|town|Carmarthenshire|1
Ammanford|town|Carmarthenshire|1
Haverfordwest|town|Pembrokeshire|1
Milford Haven|town|Pembrokeshire|1
Pembroke Dock|town|Pembrokeshire|1
Newtown|town|Powys|1
Welshpool|town|Powys|1
Llandrindod Wells|town|Powys|1
Brecon|town|Powys|1
Abergavenny|town|Monmouthshire|1
Monmouth|town|Monmouthshire|1
Chepstow|town|Monmouthshire|1
Ebbw Vale|town|Blaenau Gwent|1
Tredegar|town|Blaenau Gwent|1
Pontypool|town|Torfaen|1
Penarth|town|Vale of Glamorgan|1
Maesteg|town|Bridgend|1
Porthcawl|town|Bridgend|1
Briton Ferry|town|Neath Port Talbot|1
Gorseinon|town|Swansea|1
Treorchy|town|Rhondda Cynon Taf|1
Llangollen|town|Denbighshire|1
Ruthin|town|Denbighshire|1
Conwy|town|Conwy|1
Abergele|town|Conwy|1
Dolgellau|town|Gwynedd|1
Machynlleth|town|Powys|1
Llanidloes|town|Powys|1
Tenby|town|Pembrokeshire|1
Fishguard|town|Pembrokeshire|1
Lampeter|town|Ceredigion|1
Llandeilo|town|Carmarthenshire|1
Blackwood|town|Caerphilly|1
Caldicot|town|Monmouthshire|1
`),
    extra: { admin1: ["WLS"], max: 250 },
  },
  football: {
    leagues: [
      {
        tier: 1,
        name: "Cymru Premier",
        shortName: "Cymru Premier",
        size: 12,
        status: "semi-professional",
        reputation: 30,
        split: {
          groups: [
            { name: "Championship Conference", positions: [1, 6], roundRobins: 2, points: "full" },
            { name: "Play-off Conference", positions: [7, 12], roundRobins: 2, points: "full" },
          ],
        },
        clubs: {
          reputation: span(37, 26),
          giants: { count: 1, top: 46, bottom: 46 },
          capacity: span(4_000, 1_000),
          facilities: span(46, 20),
          academy: span(44, 18),
          wageBill: span(2_400_000, 220_000),
          transferBudget: span(150_000, 5_000),
          foreignShare: 0.22,
          squadSize: [25, 27],
        },
      },
    ],
    movement: [],
    cups: [
      { kind: "national", name: "Welsh Cup", legs: 1, neutralFinal: true, continental: true },
      { kind: "league", name: "Welsh League Cup", legs: 1, neutralFinal: true },
    ],
    youth: {
      U19: { divisions: [division("Welsh Premier Academy League U19", [1, 1])], cup: { name: "FAW Youth Cup" } },
      U17: { divisions: [division("Welsh Premier Academy League U17", [1, 1])] },
    },
    reserves: { mode: "none" },
    clubNaming: {
      templates: templates(`
{city} Town|10
{city} United|6
{city} City|3
{city} County|2.5
{city} Athletic|3
{city} Rovers|2
{city} Celtic|1.2
{city} Nomads|0.8
{city} FC|3
`),
      regional: [
        {
          regions: ["Gwynedd", "Anglesey", "Ceredigion", "Carmarthenshire", "Conwy"],
          templates: templates(`
CPD {city}|5
{city} Town|4
{city} United|1.5
`),
        },
      ],
      founded: { top: [1876, 1990], bottom: [1876, 1990] },
      shortName: "city",
      colors: ["#C8102E", "#00843D", "#FFFFFF", "#000000", "#1B458F", "#FDB913", "#6CABDD"],
    },
    importSources: codes("EN:10 IE:1.5 SCO:1 NIR:0.8 NG:0.3 JM:0.3 US:0.3 FR:0.3 ES:0.3"),
    coefficients: { association: [1.5, 1.5, 1.166, 0.625, 2.0], season2025: 0.333 },
  },
  hostedAbroad: [
    {
      host: "EN",
      tiers: [2, 2, 3, 4, 6],
      cities: ["Swansea", "Wrexham", "Cardiff", "Newport", "Merthyr Tydfil"],
      cups: "host",
      continental: "host",
      youth: "host",
      registration: "host",
    },
  ],
};

// ------------------------------------------------------------------ Scotland

const SCOTLAND: NationSpec = {
  code: "SCO",
  iso2: "GB",
  name: "Scotland",
  confederation: "UEFA",
  continent: "EU",
  capital: "Edinburgh",
  latitude: 56.5,
  languages: [{ code: "en", weight: 1 }],
  reputation: { national: 70, league: 64 },
  euEea: false,
  physique: { height: 180 },
  names: { given: sources("scottish=0.85 english=0.15"), family: sources("scottish=0.85 english=0.15") },
  nationality: {
    multipleRate: 0.3,
    tripleRate: 0.05,
    bornAbroadRate: 0.06,
    diasporaPull: 0.45,
    links: [
      ...links("britishIrish", "EN:9 IE:6 NIR:3 WAL:0.8"),
      ...links("crossBorder", "PL:4 IT:2.5 LT:0.8 LV:0.5 RO:0.6 DE:0.6 FR:0.5 ES:0.4 PT:0.4 SO:0.4 SY:0.4 CD:0.3"),
      ...links("commonwealth", "PK:3 IN:1.5 BD:0.6 NG:1.2 GH:0.8 ZW:0.8 ZA:0.8 KE:0.4 CA:1 AU:1 NZ:0.6 JM:0.6"),
      ...links("americas", "US:0.8"),
      ...links("asianDiaspora", "CN:0.8 HK:0.4"),
    ],
    citizenship: { group: "GB", dual: "allowed" },
  },
  cities: {
    major: cityRows(`
Glasgow|large|Glasgow|3|Parkhead,Govan,Maryhill,Govanhill,Springburn,Shettleston,Dennistoun,Bridgeton,Gorbals,Pollokshields
Edinburgh|large|Lothian|2|Leith,Gorgie,Portobello,Corstorphine,Morningside,Granton
Aberdeen|medium|Aberdeenshire|1|Torry,Bucksburn,Dyce
Dundee|medium|Tayside|2|Lochee,Broughty Ferry,Stobswell
Paisley|small|Renfrewshire|1
Kilmarnock|small|Ayrshire|1
Motherwell|small|Lanarkshire|1
Falkirk|small|Forth Valley|1
Livingston|small|Lothian|1
Dunfermline|small|Fife|1
Perth|small|Tayside|1
Inverness|small|Highlands|1
Ayr|small|Ayrshire|1
Kirkcaldy|small|Fife|1
Hamilton|small|Lanarkshire|1
Greenock|small|Renfrewshire|1
Airdrie|small|Lanarkshire|1
Stirling|small|Forth Valley|1
East Kilbride|small|Lanarkshire|1
Cumbernauld|small|Lanarkshire|1
Dumfries|small|Dumfries and Galloway|1
Coatbridge|small|Lanarkshire|1
Glenrothes|small|Fife|1
Irvine|small|Ayrshire|1
Arbroath|town|Tayside|1
Dumbarton|town|Dunbartonshire|1
Clydebank|town|Dunbartonshire|1
Alloa|town|Forth Valley|1
Montrose|town|Tayside|1
Forfar|town|Tayside|1
Brechin|town|Tayside|1
Peterhead|town|Aberdeenshire|1
Elgin|town|Moray|1
Stranraer|town|Dumfries and Galloway|1
Stenhousemuir|town|Forth Valley|1
Annan|town|Dumfries and Galloway|1
Cowdenbeath|town|Fife|1
Kelty|town|Fife|1
Methil|town|Fife|1
Bonnyrigg|town|Lothian|1
Linlithgow|town|Lothian|1
Bathgate|town|Lothian|1
Musselburgh|town|Lothian|1
Penicuik|town|Lothian|1
Galashiels|town|Borders|1
Hawick|town|Borders|1
Fort William|town|Highlands|1
Dingwall|town|Highlands|1
Nairn|town|Highlands|1
Wick|town|Highlands|1
Fraserburgh|town|Aberdeenshire|1
Inverurie|town|Aberdeenshire|1
Stonehaven|town|Aberdeenshire|1
Buckie|town|Moray|1
Forres|town|Moray|1
Largs|town|Ayrshire|1
Troon|town|Ayrshire|1
Cumnock|town|Ayrshire|1
Kilwinning|town|Ayrshire|1
Girvan|town|Ayrshire|1
Lanark|town|Lanarkshire|1
Larkhall|town|Lanarkshire|1
Carluke|town|Lanarkshire|1
Wishaw|town|Lanarkshire|1
Bellshill|town|Lanarkshire|1
Rutherglen|town|Lanarkshire|1
Kirkintilloch|town|Dunbartonshire|1
Grangemouth|town|Forth Valley|1
Crieff|town|Tayside|1
Carnoustie|town|Tayside|1
Cupar|town|Fife|1
Leven|town|Fife|1
Haddington|town|Lothian|1
Dunbar|town|Lothian|1
Tranent|town|Lothian|1
Barrhead|town|Renfrewshire|1
Johnstone|town|Renfrewshire|1
Renfrew|town|Renfrewshire|1
Port Glasgow|town|Renfrewshire|1
Helensburgh|town|Dunbartonshire|1
Oban|town|Argyll|1
Dunoon|town|Argyll|1
Kirkwall|town|Orkney|1
Lerwick|town|Shetland|1
Stornoway|town|Western Isles|1
Peebles|town|Borders|1
Kelso|town|Borders|1
Castle Douglas|town|Dumfries and Galloway|1
`),
    extra: { admin1: ["SCT"], max: 250 },
  },
  football: {
    leagues: [
      {
        tier: 1,
        name: "Scottish Premiership",
        shortName: "Premiership",
        size: 12,
        status: "professional",
        reputation: 64,
        roundRobins: 3,
        split: {
          groups: [
            { name: "Top six", positions: [1, 6], roundRobins: 1, points: "full" },
            { name: "Bottom six", positions: [7, 12], roundRobins: 1, points: "full" },
          ],
        },
        clubs: {
          reputation: span(68, 55),
          giants: { count: 2, top: 81, bottom: 78 },
          capacity: span(60_400, 7_900),
          facilities: span(88, 50),
          academy: span(84, 48),
          wageBill: span(78_000_000, 3_200_000),
          transferBudget: span(25_000_000, 120_000),
          foreignShare: 0.48,
          squadSize: [25, 30],
        },
      },
    ],
    movement: [],
    cups: [
      { kind: "national", name: "Scottish Cup", seededEntry: true, legs: 1, neutralFinal: true, continental: true },
      { kind: "league", name: "Scottish League Cup", legs: 1, neutralFinal: true },
    ],
    youth: {
      // Club Academy Scotland runs U18 and U16 Elite leagues for the U19 and U17 age groups.
      U19: { divisions: [division("Club Academy Scotland Elite U18", [1, 1])], cup: { name: "Scottish Youth Cup" } },
      U17: { divisions: [division("Club Academy Scotland Elite U16", [1, 1])] },
    },
    reserves: { mode: "none" },
    clubNaming: {
      templates: templates(`
{city} FC|10
{city} Athletic|6
{city} United|6
{city} City|4
{city} Thistle|4
{city} Rovers|3
{city} Albion|2.5
{city} Academical|1.5
{city} Rangers|1.5
{city} Rose|1
`),
      founded: { top: [1867, 1903], bottom: [1874, 1974] },
      shortName: "city",
      colors: ["#00843D", "#1B458F", "#8B0000", "#FFFFFF", "#000000", "#FDB913", "#FF8200", "#6CABDD", "#7A263A"],
    },
    importSources: codes(
      "EN:12 IE:5 NIR:3 WAL:1.5 AU:2 NL:2 FR:1.5 DK:1.5 NO:1.5 SE:1 JP:2 KR:1 US:1.5 CA:1 PL:1 DE:1 BE:1 ES:1 PT:1 BR:1 NG:1 GH:1 ZW:0.6 SN:0.6 CI:0.6 CM:0.5 CD:0.6 JM:0.6 HR:0.6 GR:0.5 IS:0.5 FI:0.5 NZ:0.5 IT:0.5 SK:0.4",
    ),
    coefficients: { association: [8.5, 7.9, 3.5, 6.4, 9.25], season2025: 5.0 },
  },
};

// ------------------------------------------------------------------ Northern Ireland and Ireland

const ULSTER = pool(
  "ulster",
  "Aaron|Adam|Aidan|Alan|Alex|Andrew|Anthony|Aodhan|Ben|Brandon|Brendan|Callan|Callum|Cameron|Caolan|Carl|Cathal|Charlie|Chris|Christopher|Ciaran|Colin|Conall|Conor|Corey|Cormac|Craig|Daniel|Danny|Darragh|Darren|David|Dean|Declan|Dion|Dylan|Eamon|Eoin|Ethan|Eunan|Gareth|Gary|Gavin|George|Gerard|Glenn|Harry|Hugh|Isaac|Jack|Jake|James|Jamie|Jay|Johnny|Jonny|Jordan|Joseph|Josh|Jude|Kealan|Kevin|Kieran|Kirk|Kyle|Lee|Leon|Liam|Lorcan|Luke|Marcus|Mark|Martin|Mason|Matthew|Michael|Nathan|Neil|Niall|Noel|Odhran|Oisin|Oliver|Owen|Paddy|Patrick|Paul|Peter|Pierce|Rhys|Robbie|Ronan|Ross|Ruairi|Ruben|Ryan|Sam|Scott|Sean|Shane|Shay|Stephen|Steven|Stuart|Terry|Thomas|Tiernan|Tony|Trevor",
  "Adair|Adams|Allen|Anderson|Andrews|Armstrong|Ballantine|Barr|Beattie|Bell|Black|Boyd|Boyle|Bradley|Brady|Brennan|Brown|Burns|Cairns|Caldwell|Callaghan|Campbell|Canning|Carson|Cassidy|Clarke|Coyle|Crawford|Crossan|Cunningham|Curran|Daly|Davidson|Devine|Devlin|Dillon|Doherty|Donaghy|Donnelly|Doran|Duffy|Dunlop|Ervine|Ferguson|Ferris|Finlay|Fleming|Gallagher|Gibson|Gillespie|Gilmore|Gordon|Graham|Gray|Hamill|Hamilton|Hanna|Harkin|Heaney|Hegarty|Henderson|Hughes|Hume|Irvine|Irwin|Jackson|Johnston|Kane|Kearney|Kelly|Kennedy|Kerr|Lafferty|Lavery|Lennon|Lindsay|Logan|Lowry|Lynch|Magee|Magill|Maguire|Mallon|Martin|Maxwell|McAleese|McAlinden|McAllister|McAuley|McBride|McCann|McCartan|McCartney|McCaughey|McClean|McClelland|McCloskey|McConnell|McCormick|McCullough|McDaid|McDermott|McDonald|McDowell|McElroy|McFarland|McGarry|McGinn|McGlinchey|McGovern|McGrath|McGuigan|McIlroy|McKee|McKeown|McKenna|McLaughlin|McMenamin|McMullan|McNair|McNally|McNeill|McQuillan|McShane|McVeigh|Millar|Mitchell|Moore|Morgan|Morrison|Morrow|Mulholland|Mullan|Murphy|Murray|Neill|Nelson|O'Hare|O'Kane|O'Neill|Orr|Patterson|Quinn|Rafferty|Rea|Reid|Robinson|Rooney|Scott|Shields|Simpson|Smith|Stewart|Taylor|Thompson|Toner|Wallace|Walsh|Watson|Weir|White|Whiteside|Wilson|Wright|Young",
);
const IRISH = pool(
  "irish",
  "Aaron|Adam|Aidan|Alan|Andrew|Anthony|Aodhán|Barry|Ben|Brendan|Brian|Callum|Caoimhín|Cathal|Cian|Ciarán|Cillian|Colin|Colm|Conall|Conan|Conor|Cormac|Dáithí|Daire|Daniel|Danny|Dara|Darragh|David|Declan|Derek|Diarmuid|Donal|Donnacha|Dylan|Eamon|Éanna|Emmet|Enda|Eoghan|Eoin|Evan|Fergal|Fiachra|Finn|Fionn|Gary|Gavin|Glen|Graham|Harry|Jack|Jake|James|Jamie|Jason|Joe|Joey|John|Jordan|Josh|Keith|Kevin|Kian|Kieran|Killian|Liam|Lorcan|Luke|Mark|Matt|Michael|Mícheál|Mikey|Neil|Niall|Noel|Odhrán|Oisín|Oliver|Owen|Paddy|Pádraig|Patrick|Paul|Peter|Pierce|Rían|Richie|Robbie|Ronan|Rory|Ross|Ruairí|Ryan|Sam|Seamus|Seán|Sean|Senan|Shane|Shay|Stephen|Tadhg|Thomas|Tiernan|Tom|Tommy|Tony|Troy|Ultan",
  "Murphy|Kelly|O'Sullivan|Walsh|Smith|O'Brien|Byrne|Ryan|O'Connor|O'Neill|O'Reilly|Doyle|McCarthy|Gallagher|O'Doherty|Kennedy|Lynch|Murray|Quinn|Moore|McLoughlin|O'Carroll|Connolly|Daly|O'Connell|Wilson|Dunne|Brennan|Burke|Collins|Campbell|Clarke|Johnston|Hughes|O'Farrell|Fitzgerald|Brown|Martin|Maguire|Nolan|Flynn|Thompson|O'Callaghan|O'Donnell|Duffy|O'Mahony|Boyle|Healy|O'Shea|White|Sweeney|Hayes|Kavanagh|Power|McGrath|Moran|Brady|Stewart|Casey|Foley|Fitzpatrick|O'Leary|McDonnell|McMahon|Donnelly|Regan|Donovan|Burns|Flanagan|Mullan|Barry|Kane|Robinson|Cunningham|Griffin|Kenny|Sheehan|Ward|Whelan|Lyons|Reid|Graham|Higgins|Cullen|Keane|King|Maher|McKenna|Bell|Scott|Hogan|O'Keeffe|Magee|McNamara|McDonald|McDermott|Moloney|O'Rourke|Buckley|O'Dwyer|Egan|Coughlan|Cleary|Hennessy|Horgan|Kearney|Keogh|Mooney|Molloy|Nugent|Phelan|Shanahan|Tierney|Tobin|Twomey|Carey|Coleman|Cronin|Dempsey|Devlin|Dolan|Farrell|Geraghty|Hanley|Hurley|Kiely|Lawlor|McEvoy|McGuinness|Mulligan|Noonan|O'Hara|O'Malley|Redmond|Toner|Coffey|Corcoran|Costello|Cotter|Crowley|Cusack|Delaney|Dillon|Dowling|Doherty|Duggan|Fahy|Finnegan|Fogarty|Gleeson|Hanlon|Harrington|Hartnett|Keating|Kinsella|Leahy|McCann|McGovern|McHugh|McInerney|Meehan|Moynihan|Mulcahy|Mulvihill|Nevin|O'Donoghue|O'Gorman|O'Halloran|O'Riordan|Quigley|Scanlon|Sheridan|Slattery|Treacy|Waldron",
);

const NORTHERN_IRELAND: NationSpec = {
  code: "NIR",
  iso2: "GB",
  name: "Northern Ireland",
  confederation: "UEFA",
  continent: "EU",
  capital: "Belfast",
  latitude: 54.6,
  languages: [
    { code: "en", weight: 0.97 },
    { code: "ga", weight: 0.03 },
  ],
  reputation: { national: 62, league: 33 },
  euEea: false,
  physique: { height: 180 },
  names: { given: sources("ulster=1"), family: sources("ulster=1") },
  nationality: {
    // Everyone born in Northern Ireland may also hold Irish citizenship (Good Friday Agreement).
    multipleRate: 0.46,
    tripleRate: 0.05,
    bornAbroadRate: 0.07,
    diasporaPull: 0.45,
    links: [
      ...links("britishIrish", "IE:12 SCO:4 EN:4 WAL:0.5"),
      ...links("crossBorder", "PL:1.5 LT:0.8 PT:0.6 RO:0.6 SK:0.4 LV:0.3"),
      ...links("asianDiaspora", "PH:0.5 IN:0.5 CN:0.4"),
      ...links("commonwealth", "NG:0.6 ZW:0.3 GH:0.3 CA:0.3"),
      ...links("americas", "US:0.5"),
    ],
    citizenship: { group: "GB", dual: "allowed" },
  },
  cities: {
    major: cityRows(`
Belfast|large|Antrim|4|Ballymacarrett,Sydenham,Ballysillan,Shankill,Ormeau,Andersonstown,Shore Road,Finaghy
Derry|medium|Londonderry|1
Lisburn|small|Antrim|1
Newry|small|Down|1
Bangor|small|Down|1
Newtownabbey|small|Antrim|1
Ballymena|small|Antrim|1
Coleraine|small|Londonderry|1
Portadown|small|Armagh|1
Lurgan|small|Armagh|1
Carrickfergus|small|Antrim|1
Newtownards|small|Down|1
Larne|town|Antrim|1
Dungannon|town|Tyrone|1
Armagh|town|Armagh|1
Omagh|town|Tyrone|1
Enniskillen|town|Fermanagh|1
Antrim|town|Antrim|1
Ballymoney|town|Antrim|1
Limavady|town|Londonderry|1
Cookstown|town|Tyrone|1
Strabane|town|Tyrone|1
Banbridge|town|Down|1
Downpatrick|town|Down|1
Magherafelt|town|Londonderry|1
Holywood|town|Down|1
Ballyclare|town|Antrim|1
Warrenpoint|town|Down|1
Portstewart|town|Londonderry|1
Kilkeel|town|Down|1
Comber|town|Down|1
Ballinamallard|town|Fermanagh|1
Moira|town|Down|1
Tandragee|town|Armagh|1
Crossmaglen|town|Armagh|1
Coalisland|town|Tyrone|1
Donaghadee|town|Down|1
Ballynahinch|town|Down|1
Lisnaskea|town|Fermanagh|1
Maghera|town|Londonderry|1
Newcastle|town|Down|1
Randalstown|town|Antrim|1
`),
    extra: { admin1: ["NIR"], exclude: ["Craigavon", "Londonderry County Borough"], max: 110 },
  },
  football: {
    leagues: [
      {
        tier: 1,
        name: "NIFL Premiership",
        shortName: "Premiership",
        size: 12,
        status: "semi-professional",
        reputation: 33,
        roundRobins: 3,
        split: {
          groups: [
            { name: "Section A", positions: [1, 6], roundRobins: 1, points: "full" },
            { name: "Section B", positions: [7, 12], roundRobins: 1, points: "full" },
          ],
        },
        clubs: {
          reputation: span(43, 29),
          giants: { count: 1, top: 46, bottom: 46 },
          capacity: span(12_000, 1_500),
          facilities: span(48, 22),
          academy: span(46, 22),
          wageBill: span(2_800_000, 300_000),
          transferBudget: span(200_000, 5_000),
          foreignShare: 0.15,
          squadSize: [25, 27],
        },
      },
    ],
    movement: [],
    cups: [
      { kind: "national", name: "Irish Cup", legs: 1, neutralFinal: true, continental: true },
      { kind: "league", name: "Irish League Cup", legs: 1, neutralFinal: true },
    ],
    youth: {
      U19: { divisions: [division("NIFL U18 League", [1, 1])], cup: { name: "Irish FA Youth Cup" } },
      U17: { divisions: [division("NIFL U16 League", [1, 1])] },
    },
    reserves: { mode: "none" },
    clubNaming: {
      templates: templates(`
{city} FC|4
{city} United|6
{city} Town|4
{city} City|3
{city} Rangers|3
{city} Celtic|2
{city} Athletic|2
{city} Rovers|2
{city} Swifts|1.5
{city} Comrades|1
{city} Olympic|0.8
`),
      founded: { top: [1880, 1928], bottom: [1880, 1990] },
      shortName: "city",
      colors: ["#1B458F", "#00843D", "#C8102E", "#FFFFFF", "#000000", "#FDB913", "#6CABDD"],
    },
    importSources: codes("IE:6 EN:5 SCO:3 WAL:0.5 US:0.3 NG:0.3 CA:0.2 PL:0.2"),
    coefficients: { association: [2.833, 1.625, 1.25, 1.125, 1.5], season2025: 1.75 },
  },
  hostedAbroad: [
    { host: "IE", tiers: [1], cities: ["Derry"], cups: "host", continental: "host", youth: "host", registration: "host" },
  ],
};

const IRELAND: NationSpec = {
  code: "IE",
  iso2: "IE",
  name: "Republic of Ireland",
  confederation: "UEFA",
  continent: "EU",
  capital: "Dublin",
  latitude: 53.3,
  languages: [
    { code: "en", weight: 0.96 },
    { code: "ga", weight: 0.04 },
  ],
  reputation: { national: 64, league: 40 },
  euEea: true,
  physique: { height: 180.5 },
  names: { given: sources("irish=1"), family: sources("irish=1") },
  nationality: {
    multipleRate: 0.36,
    tripleRate: 0.06,
    bornAbroadRate: 0.1,
    diasporaPull: 0.55,
    links: [
      ...links("britishIrish", "EN:12 NIR:5 SCO:3.5 WAL:1"),
      ...links("americas", "US:3 CA:0.8 BR:1.2"),
      ...links("commonwealth", "NG:3 ZA:1 ZW:0.6 AU:1.2 NZ:0.4 IN:0.8 PK:0.5"),
      ...links("crossBorder", "PL:5 LT:2 LV:1.2 RO:2 SK:0.6 HU:0.5 CZ:0.4 PT:0.6 ES:0.6 IT:0.8 FR:0.8 DE:0.8 CD:1 CM:0.5 GH:0.6 SO:0.4 UA:0.8 MD:0.4 BG:0.4 HR:0.3"),
      ...links("asianDiaspora", "PH:0.8 CN:0.5"),
    ],
    citizenship: { dual: "allowed" },
  },
  cities: {
    major: cityRows(`
Dublin|large|Leinster|4|Tallaght,Drumcondra,Inchicore,Phibsborough,Ringsend,Finglas,Clondalkin,Ballyfermot,Crumlin,Cabra,Rathmines,Blanchardstown
Cork|large|Munster|2|Ballincollig,Blackpool,Douglas,Mayfield
Limerick|medium|Munster|1
Galway|medium|Connacht|1
Waterford|small|Munster|1
Drogheda|small|Leinster|1
Dundalk|small|Leinster|1
Sligo|small|Connacht|1
Bray|small|Leinster|1
Swords|small|Leinster|1
Navan|small|Leinster|1
Kilkenny|small|Leinster|1
Ennis|small|Munster|1
Carlow|small|Leinster|1
Tralee|small|Munster|1
Athlone|small|Leinster|1
Wexford|small|Leinster|1
Letterkenny|small|Ulster|1
Newbridge|small|Leinster|1
Portlaoise|small|Leinster|1
Mullingar|small|Leinster|1
Naas|small|Leinster|1
Balbriggan|small|Leinster|1
Dún Laoghaire|small|Leinster|1
Longford|town|Leinster|1
Cobh|town|Munster|1
Ballybofey|town|Ulster|1
Greystones|town|Leinster|1
Clonmel|town|Munster|1
Castlebar|town|Connacht|1
Arklow|town|Leinster|1
Tullamore|town|Leinster|1
Killarney|town|Munster|1
Ballina|town|Connacht|1
Dungarvan|town|Munster|1
Monaghan|town|Ulster|1
Cavan|town|Ulster|1
Buncrana|town|Ulster|1
Mallow|town|Munster|1
Thurles|town|Munster|1
Nenagh|town|Munster|1
Roscommon|town|Connacht|1
Tuam|town|Connacht|1
Enniscorthy|town|Leinster|1
Gorey|town|Leinster|1
Maynooth|town|Leinster|1
Celbridge|town|Leinster|1
Shannon|town|Munster|1
Carrick-on-Shannon|town|Connacht|1
Youghal|town|Munster|1
Midleton|town|Munster|1
Kinsale|town|Munster|1
Westport|town|Connacht|1
Birr|town|Leinster|1
Trim|town|Leinster|1
`),
    extra: { max: 200 },
  },
  football: {
    leagues: [
      {
        tier: 1,
        name: "League of Ireland Premier Division",
        shortName: "Premier Division",
        size: 10,
        status: "professional",
        reputation: 40,
        roundRobins: 4,
        clubs: {
          reputation: span(46, 36),
          giants: { count: 1, top: 50, bottom: 50 },
          capacity: span(10_000, 3_000),
          facilities: span(52, 34),
          academy: span(55, 38),
          wageBill: span(4_300_000, 800_000),
          transferBudget: span(400_000, 10_000),
          foreignShare: 0.25,
          squadSize: [25, 28],
        },
      },
    ],
    movement: [],
    cups: [
      { kind: "national", name: "FAI Cup", legs: 1, neutralFinal: true, continental: true },
      { kind: "super", name: "President of Ireland's Cup", participants: ["champion", "cup-winner"] },
    ],
    youth: {
      // The League of Ireland academy leagues are U20 and U17 since 2024.
      U19: { divisions: [division("LOI Academy U20 League", [1, 1])], cup: { name: "FAI Youth Cup" } },
      U17: { divisions: [division("LOI Academy U17 League", [1, 1])] },
    },
    reserves: { mode: "none" },
    clubNaming: {
      templates: templates(`
{city} United|6
{city} Rovers|5
{city} City|4
{city} Town|4
{city} Athletic|3
{city} FC|3
{city} Wanderers|2
{city} Celtic|1.5
{city} Albion|1
{city} Ramblers|1
{city} Harps|0.8
`),
      founded: { top: [1885, 1930], bottom: [1885, 2014] },
      shortName: "city",
      colors: ["#00843D", "#C8102E", "#FFFFFF", "#000000", "#1B458F", "#FDB913", "#6CABDD", "#7A263A"],
    },
    importSources: codes(
      "EN:8 SCO:3 NIR:3 WAL:1 US:0.8 NG:0.5 FR:0.4 NL:0.4 BR:0.4 AU:0.3 CA:0.3 ZA:0.3 JM:0.3 ES:0.3 PL:0.3 GH:0.2 CD:0.2 NZ:0.2 DE:0.2 IS:0.2",
    ),
    coefficients: { association: [1.875, 2.875, 3.375, 1.5, 5.343], season2025: 4.25 },
  },
};

// ------------------------------------------------------------------ Nordic name pools

const ICELANDIC = pool(
  "icelandic",
  "Aron|Einar|Gunnar|Stefán|Björn|Jón|Kristján|Magnús|Birkir|Sigurður|Viktor|Emil|Arnór|Alfreð|Gylfi|Hörður|Jóhann|Kári|Ragnar|Rúnar|Hannes|Ögmundur|Guðmundur|Hólmar|Albert|Andri|Arnar|Atli|Axel|Baldur|Bjarki|Daníel|Davíð|Elías|Ísak|Hákon|Mikael|Sævar|Valgeir|Þórir|Orri|Kristian|Brynjar|Dagur|Egill|Eiður|Finnur|Friðrik|Gísli|Halldór|Hjörtur|Helgi|Hilmar|Ingvar|Jökull|Júlíus|Karl|Kolbeinn|Logi|Már|Óli|Óskar|Páll|Pétur|Róbert|Sindri|Snorri|Steinar|Sveinn|Tómas|Tryggvi|Valur|Ari|Ágúst|Aðalsteinn|Benedikt|Eggert|Ellert|Garðar|Grétar|Haraldur|Hlynur|Högni|Ívar|Kjartan|Nökkvi|Oddur|Ólafur|Þorsteinn|Þórður|Bjarni|Birgir|Haukur|Heimir|Ingi|Jónas|Kristófer|Matthías|Sigurjón|Stígur|Þorri|Úlfur|Viðar|Vilhjálmur|Ævar",
  "Jónsson|Gunnarsson|Einarsson|Stefánsson|Magnússon|Kristjánsson|Arnarsson|Sigurðsson|Björnsson|Guðmundsson|Pálsson|Hauksson|Ólafsson|Sigurjónsson|Halldórsson|Þórsson|Friðriksson|Jóhannsson|Helgason|Ragnarsson|Hallgrímsson|Karlsson|Gíslason|Sveinsson|Þorsteinsson|Birgisson|Ingason|Baldursson|Kristinsson|Árnason|Egilsson|Finnbogason|Traustason|Bjarnason|Guðjónsson|Hermannsson|Hjaltason|Ingólfsson|Jónasson|Kjartansson|Óskarsson|Pétursson|Ríkharðsson|Sævarsson|Tómasson|Valdimarsson|Viðarsson|Þórðarson|Aðalsteinsson|Axelsson|Benediktsson|Daníelsson|Davíðsson|Elíasson|Eiríksson|Gestsson|Grétarsson|Guðnason|Hafsteinsson|Haraldsson|Hannesson|Heimisson|Hilmarsson|Hlynsson|Hreiðarsson|Ísaksson|Jökulsson|Kárason|Konráðsson|Loftsson|Marinósson|Níelsson|Oddsson|Rúnarsson|Sigmundsson|Símonarson|Skúlason|Snorrason|Steinarsson|Sturluson|Sverrisson|Tryggvason|Úlfarsson|Valsson|Vilhjálmsson|Þrastarson|Ægisson|Andrason|Atlason|Bergsson|Bragason|Dagsson|Erlingsson|Garðarsson|Emilsson|Arnórsson|Albertsson|Bjarkason|Hákonarson|Mikaelsson|Orrason|Brynjarsson|Thorarensen|Hafstein|Blöndal|Thors|Möller|Olsen|Hansen",
);
const FAROESE = pool(
  "faroese",
  "Jákup|Rógvi|Hallur|Brandur|Gunnar|Sonni|Heini|Pætur|Súni|Bárður|Tróndur|Símun|Óli|Jóannes|Hanus|Andrias|Árni|Poul|Høgni|Jógvan|Kaj|Klæmint|Magnus|Meinhard|Mikkjal|Ólavur|Petur|Regin|René|Rasmus|Sámal|Sjúrður|Teitur|Tórur|Vagnur|Viljam|Arnbjørn|Atli|Bjarni|Dánjal|Eli|Eirikur|Fróði|Gilli|Gutti|Hans|Heðin|Hjalti|Ísak|Jens|Jón|Jónas|Karl|Leivur|Martin|Niclas|Odmar|Páll|Ragnar|Rúni|Sølvi|Stefan|Sverri|Trygvi|Uni|Vilhelm|Andreas|Benjamin|Daniel|Elias|Jonas",
  "Joensen|Hansen|Jacobsen|Olsen|Petersen|Poulsen|Nielsen|Danielsen|Davidsen|Mortensen|Eliasen|Johannesen|Justinussen|Lamhauge|Vatnhamar|Hentze|Edmundsson|Frederiksberg|Sørensen|Thomsen|Mikkelsen|Nattestad|Bjartalíð|Benjaminsen|Klettskarð|Højsted|Baldvinsson|Dam|Djurhuus|Ellingsgaard|Gregersen|Hammershaimb|Heinesen|Holm|Jakobsen|Johansen|Jensen|Kristiansen|Lervig|Løkin|Magnussen|Midjord|Mouritsen|Næs|Patursson|Rasmussen|Reinert|Samuelsen|Sivertsen|Skaale|Steinhólm|Thorsteinsson|Vestergaard|Weihe|Zachariasen|Andreasen|Árting|Biskopstø|Christiansen|Egilstoft|Gaardbo|Hendriksen|Højgaard|Isaksen|Justesen|Kalsø|Knudsen|Lützen|Michelsen|Niclasen|Rubeksen|Simonsen|Sølvará|Tausen|Toftegaard|Túgvusson|Vilhelmsen|Wardum|Ziska",
);
const NORWEGIAN = pool(
  "norwegian",
  "Erling|Sander|Kristoffer|Mathias|Jonas|Fredrik|Magnus|Håkon|Kasper|Sondre|Eirik|Ola|Morten|Tobias|Markus|Henrik|Vetle|Aksel|Emil|Sivert|Ole|Stian|Leo|Oscar|Johan|Jørgen|Torbjørn|Birger|Brede|Elias|Even|Gustav|Halvor|Isak|Jakob|Jens|Kristian|Lars|Lasse|Mads|Marius|Mats|Mikkel|Niklas|Oliver|Patrick|Petter|Runar|Sebastian|Sigurd|Simen|Steffen|Sturla|Thomas|Tord|Tore|Ulrik|Vegard|Viljar|Aleksander|Andreas|Anders|Bjørn|Daniel|David|Erik|Espen|Fabian|Filip|Hans|Harald|Herman|Ivar|Joakim|Jon|Kjetil|Knut|Kjell|Odin|Olav|Per|Rune|Snorre|Stig|Svein|Trond|Truls|Vidar|Adrian|Eskil|Hauk|Iver|Jostein|Kristen|Lauritz|Martin|Noah|Oskar|Peder|Sindre|Theodor|Torstein|William",
  "Berg|Haugen|Hagen|Bakken|Moen|Dahl|Lie|Solberg|Strand|Lund|Aas|Myhre|Eide|Holm|Nygård|Sæther|Rønning|Brekke|Fjeld|Ruud|Hauge|Tangen|Nordby|Sandvik|Aune|Hovland|Løken|Vik|Aasen|Thorsen|Bjerke|Gundersen|Lindstrøm|Nyland|Ødegård|Tveit|Berge|Fossum|Holmen|Jenssen|Kvamme|Aamodt|Bakke|Birkeland|Bjørnstad|Engen|Fredriksen|Gjerde|Halvorsen|Hansen|Helland|Hoel|Iversen|Jacobsen|Johnsen|Karlsen|Knutsen|Kristiansen|Larsen|Mathisen|Nilsen|Nordahl|Olsen|Pedersen|Rasmussen|Riise|Sandberg|Simonsen|Skogen|Stokke|Svendsen|Syvertsen|Tofte|Torgersen|Ulvestad|Wiik|Westby|Øien|Østby|Andersen|Amundsen|Berntsen|Dalen|Eriksen|Fagerli|Grande|Hammer|Haugland|Hope|Jensen|Kolstad|Lunde|Myklebust|Nesse|Opsahl|Rustad|Sunde|Tollefsen|Vold|Solbakken|Mjelde",
);
const SWEDISH = pool(
  "swedish",
  "Viktor|Emil|Alexander|Anton|Isak|Hugo|Elias|Linus|Jesper|Filip|Gustav|Ludvig|Albin|Oscar|Samuel|Axel|Noah|William|Liam|Melker|Edvin|Arvid|Hampus|Kevin|Robin|Rasmus|Sebastian|Pontus|Joel|Jacob|Johan|Mattias|Andreas|Marcus|Niklas|Oskar|Ola|Mikael|Ture|Vidar|Sixten|Leo|Adam|Olle|Nils|Erik|Karl|Carl|Simon|Oliver|Lucas|Theo|Vincent|Wilmer|Alvin|Casper|Dennis|Emir|Jonatan|Kalle|Love|Malte|Max|Milo|Neo|Otto|Rickard|Sam|Tim|Tobias|Valter|Ville|Elliot|Benjamin|Charlie|Frans|Harry|Josef|Julius|Leon|Loke|August|Hannes|Jonas|Kim",
  "Andersson|Johansson|Karlsson|Nilsson|Eriksson|Larsson|Olsson|Persson|Svensson|Gustafsson|Pettersson|Jonsson|Jansson|Hansson|Bengtsson|Jönsson|Lindberg|Jakobsson|Magnusson|Lindström|Olofsson|Lindqvist|Lindgren|Berg|Axelsson|Bergström|Lundberg|Lind|Lundgren|Lundqvist|Mattsson|Berglund|Fredriksson|Sandberg|Henriksson|Forsberg|Sjöberg|Wallin|Engström|Eklund|Danielsson|Håkansson|Lundin|Björk|Bergman|Gunnarsson|Holm|Wikström|Samuelsson|Isaksson|Fransson|Bergqvist|Nyström|Holmberg|Arvidsson|Löfgren|Söderberg|Nyberg|Blomqvist|Claesson|Nordström|Mårtensson|Lundström|Viklund|Björklund|Eliasson|Pålsson|Berggren|Sandström|Nordin|Ström|Åberg|Hermansson|Ekström|Holmgren|Sundberg|Hedlund|Dahlberg|Hellström|Sjögren|Abrahamsson|Falk|Öberg|Andreasson|Blom|Ek|Månsson|Strand|Åkesson|Göransson|Lindholm|Nordqvist|Hedberg|Sundström|Dahl|Hjalmarsson|Sjöström|Wahlström|Ahlberg|Wennberg|Törnqvist|Rosén|Lööf|Ekdahl|Hedman|Nordgren|Sköld|Borg|Hallberg|Lundh|Karlström|Palm|Wiklund|Åström",
);
const DANISH = pool(
  "danish",
  "Mikkel|Mads|Rasmus|Jonas|Kasper|Nicolai|Christian|Andreas|Frederik|Mathias|Oliver|Lucas|Emil|Magnus|Tobias|Jakob|Anders|Simon|Martin|Thomas|Jesper|Morten|Jeppe|Mikael|Victor|William|Sebastian|Alexander|Philip|Casper|Jens|Kristoffer|Nikolaj|Rune|Søren|Troels|Asger|Anton|Carl|Elias|Hjalte|Johan|Karl|Malthe|Noah|Oscar|Villads|Aske|Bertram|Esben|Gustav|Laurits|Marius|Patrick|Daniel|Jonathan|Kristian|Lasse|Niklas|Peter|Rene|Silas|Storm|Theo|Valdemar|Albert|Benjamin|August|Christoffer|Frej|Sylvester|Tristan",
  "Jensen|Nielsen|Hansen|Pedersen|Andersen|Christensen|Larsen|Sørensen|Rasmussen|Jørgensen|Petersen|Madsen|Kristensen|Olsen|Thomsen|Christiansen|Poulsen|Johansen|Møller|Mortensen|Knudsen|Jakobsen|Mikkelsen|Olesen|Frederiksen|Laursen|Henriksen|Lund|Schmidt|Eriksen|Holm|Kristiansen|Clausen|Simonsen|Svendsen|Andreasen|Iversen|Jeppesen|Mogensen|Jacobsen|Nissen|Lauridsen|Kjær|Jespersen|Mathiasen|Dahl|Bach|Vestergaard|Carlsen|Østergaard|Damgaard|Nørgaard|Kjeldsen|Thygesen|Bruun|Lindberg|Friis|Skov|Winther|Bertelsen|Dam|Due|Hald|Høj|Kirkegaard|Kofoed|Kristoffersen|Lassen|Mølgaard|Nyholm|Overgaard|Pallesen|Riis|Schou|Sommer|Stokholm|Toft|Wind|Bendtsen|Borch|Bøgh|Dalsgaard|Enevoldsen|Gade|Hedegaard|Hvid|Juul|Kragh|Lykke|Munk|Nygaard|Ravn|Skovgaard|Storgaard|Terkelsen|Wulff|Agger|Bang|Brix|Degn|Fog|Holst",
);
const FINNISH = pool(
  "finnish",
  "Teemu|Lukas|Joel|Jere|Juha|Jukka|Mikko|Niko|Onni|Pyry|Rasmus|Santeri|Tommi|Topi|Tuomas|Veeti|Aleksi|Arttu|Eero|Eetu|Elias|Joona|Juho|Kasper|Leo|Matias|Miro|Nikolai|Otto|Paulus|Petteri|Riku|Roni|Sami|Severi|Tatu|Tuomo|Valtteri|Ville|Aapo|Antti|Anssi|Atte|Daniel|Eino|Emil|Jaakko|Janne|Jari|Jarkko|Jesse|Jussi|Kalle|Kimmo|Lassi|Lauri|Markus|Matti|Mika|Mikael|Niklas|Olli|Ossi|Pekka|Perttu|Petri|Sampo|Tapio|Tero|Timo|Toni|Vesa|Viljami|Ilmari|Iiro|Jalmari|Konsta|Luka|Nooa|Oskari|Rauli|Ukko|Aku|Eemeli|Hannu|Heikki|Ismo|Jani|Juuso|Kari|Kristian|Lenni|Marko|Oliver|Patrik|Roope|Sakari|Taneli|Veikko|Aarni|Benjamin|Eelis|Frans|Jimi|Kaapo|Leevi|Mauri|Nuutti|Otso|Rene|Samu|Teppo|Unto|Vili|Väinö",
  "Korhonen|Virtanen|Mäkinen|Nieminen|Mäkelä|Hämäläinen|Laine|Heikkinen|Koskinen|Järvinen|Lehtonen|Lehtinen|Saarinen|Salminen|Heinonen|Niemi|Heikkilä|Kinnunen|Salonen|Turunen|Salo|Laitinen|Tuominen|Rantanen|Karjalainen|Jokinen|Mattila|Savolainen|Lahtinen|Ahonen|Hiltunen|Hirvonen|Hakala|Hakkarainen|Hyvönen|Hänninen|Jääskeläinen|Kallio|Kangas|Kettunen|Koivisto|Kokkonen|Lappalainen|Leinonen|Leppänen|Manninen|Miettinen|Mustonen|Nurmi|Pesonen|Pitkänen|Pulkkinen|Pääkkönen|Räsänen|Seppälä|Sirola|Toivonen|Tuomi|Vainio|Valtonen|Väisänen|Ylönen|Aaltonen|Anttila|Eskelinen|Granlund|Hakanpää|Honkanen|Huttunen|Ikonen|Jalonen|Jaakkola|Kauppinen|Kivelä|Koponen|Kuusela|Lampinen|Lehto|Leskinen|Moilanen|Nurmela|Ojala|Paananen|Peltonen|Rautio|Riihimäki|Ruotsalainen|Tanskanen|Tikkanen|Uronen|Vesterinen|Vuorinen|Harju|Hietanen|Huovinen|Immonen|Juntunen|Kärkkäinen|Laakso|Mäki|Nousiainen|Oksanen|Parviainen|Pelkonen|Rinne|Ruusunen|Suominen|Tolvanen|Vartiainen|Väänänen|Ahola",
);
const FINLAND_SWEDISH = pool(
  "finland-swedish",
  "Mikael|Jonas|Niklas|Anders|Johan|Fredrik|Kristoffer|Sebastian|Oskar|Axel|Casper|Robin|Lucas|Emil|Filip|Albin|Viktor|Linus|Henrik|Tobias|Joakim|Patrik|Rasmus|Otto|Isak",
  "Lindholm|Nyberg|Holmström|Forss|Björklund|Granström|Sjöblom|Lönnroth|Wikström|Lindqvist|Sundqvist|Backman|Grönholm|Eklund|Söderlund|Blomqvist|Österberg|Westerlund|Strandberg|Nylund|Holmberg|Lindström|Enqvist|Häggblom|Sandberg|Stenroos|Lindroos|Nordström|Wallin|Gustafsson|Hellström|Forsman|Björkman|Sjöholm|Åberg",
);

// ------------------------------------------------------------------ Baltic name pools

const ESTONIAN = pool(
  "estonian",
  "Rasmus|Karl|Markus|Martin|Kristjan|Henri|Sander|Oliver|Tanel|Andres|Märten|Mihkel|Rauno|Joonas|Mattias|Siim|Taavi|Kaspar|Robert|Artur|Ragnar|Erik|Kevin|Robin|Karel|Kaarel|Joosep|Jaan|Jaanus|Madis|Mikk|Priit|Peeter|Rein|Tõnis|Urmas|Indrek|Janno|Kert|Lauri|Marek|Margus|Meelis|Oskar|Paul|Raimond|Rene|Risto|Sten|Tarmo|Toomas|Uku|Vahur|Georg|Hugo|Kristofer|Mark|Romet|Silver|Tristan|Aleksander|Ats|Brent|Gert|Hendrik|Jürgen|Kermo|Magnus|Ott|Rando|Tauno",
  "Tamm|Saar|Sepp|Mägi|Kask|Kukk|Rebane|Ilves|Pärn|Koppel|Lepp|Kivi|Kuusk|Karu|Lõhmus|Oja|Raudsepp|Luik|Kalda|Vaher|Mets|Jõgi|Teder|Kangur|Lill|Kütt|Nõmm|Toom|Männik|Paju|Puusepp|Laur|Hein|Aas|Org|Tali|Roots|Vares|Rand|Kull|Kruus|Põld|Tamme|Lepik|Liiv|Allik|Kaasik|Pihlak|Tooming|Kõiv|Unt|Parts|Ots|Laas|Arro|Lätt|Ploom|Vesi|Soosaar|Uibo|Nurk|Kallas|Sild|Kivisild|Aavik|Eller|Hallik|Jürgens|Kaljuste|Kolk|Kuusik|Lauk|Liivak|Mölder|Nurmsalu|Õunapuu|Pikk|Randmaa|Reinsalu|Saks|Sillaste|Tammik|Tõnisson|Uusküla|Vaino|Veski|Viira|Õun|Küttim|Metsaru|Pärtel|Rätsep|Sarapuu|Suits|Tiits|Voolaid",
);
// Russian-speaking Estonians, in the Estonian passport transliteration.
const ESTONIAN_RUSSIAN = pool(
  "estonian-russian",
  "Aleksandr|Sergei|Dmitri|Andrei|Aleksei|Maksim|Nikita|Artjom|Vladislav|Ilja|Jevgeni|Konstantin|Mihhail|Nikolai|Pavel|Roman|Vadim|Vitali|Juri|Igor|Oleg|Denis|Kirill|Daniil|Anton|Ivan|Vladimir|Viktor|Stanislav|Timofei|Gleb|Jegor|Arseni|Matvei|Bogdan|Eduard|Valeri|German|Filipp|Semjon",
  "Ivanov|Smirnov|Kuznetsov|Popov|Vassiljev|Petrov|Sokolov|Mihhailov|Novikov|Fjodorov|Morozov|Volkov|Aleksejev|Lebedev|Semjonov|Jegorov|Pavlov|Kozlov|Stepanov|Nikolajev|Orlov|Andrejev|Makarov|Nikitin|Zahharov|Zaitsev|Solovjov|Borissov|Jakovlev|Grigorjev|Romanov|Vorobjov|Sergejev|Kuzmin|Frolov|Aleksandrov|Dmitrijev|Koroljov|Gussev|Kisseljov|Iljin|Maksimov|Poljakov|Sorokin|Vinogradov|Kovaljov|Belov|Medvedev|Antonov|Tarassov|Žukov|Baranov|Filippov|Komarov|Davõdov|Beljajev|Gerassimov|Bogdanov|Ossipov|Sidorov",
);
const LATVIAN = pool(
  "latvian",
  "Artūrs|Jānis|Kristaps|Mārtiņš|Roberts|Rihards|Toms|Edgars|Andris|Aigars|Dāvis|Emīls|Gustavs|Kārlis|Krišjānis|Lauris|Mareks|Mikus|Oskars|Ralfs|Reinis|Renārs|Rolands|Sandis|Valts|Verners|Viesturs|Ēriks|Gatis|Haralds|Ivars|Juris|Kaspars|Linards|Mārcis|Niks|Pēteris|Raivis|Ričards|Uldis",
  "Bērziņš|Kalniņš|Ozoliņš|Jansons|Ozols|Liepiņš|Krūmiņš|Balodis|Eglītis|Zariņš|Pētersons|Vītols|Kļaviņš|Kārkliņš|Vanags|Lācis|Zeltiņš|Grīnbergs|Kalējs|Siliņš|Jurēvičs|Kazāks|Freimanis|Jaunzems|Ošs|Emsis|Apinis|Birznieks|Briedis|Dambis|Dreimanis|Graudiņš|Jēkabsons|Kalnačs|Krastiņš|Lapiņš|Lūsis|Miezis|Pūce|Rozenbergs|Saulītis|Sproģis|Strautiņš|Stūrmanis|Tomsons|Upītis|Vilciņš|Zālītis|Zvirbulis|Āboliņš",
);
// Russian-speaking Latvians, in the Latvian passport spelling.
const LATVIAN_RUSSIAN = pool(
  "latvian-russian",
  "Aleksandrs|Sergejs|Vladislavs|Dmitrijs|Andrejs|Jevgeņijs|Deniss|Maksims|Ņikita|Artjoms|Kirils|Vadims|Igors|Olegs|Romāns|Viktors|Vitālijs|Antons|Aleksejs|Pāvels|Konstantīns|Mihails|Ivans|Glebs|Daniils|Iļja|Timurs|Eduards|Germans|Stanislavs|Valērijs|Jurijs|Nikolajs|Vladimirs|Bogdans|Arsenijs|Jegors|Matvejs|Timofejs|Filips",
  "Ivanovs|Petrovs|Smirnovs|Kuzņecovs|Popovs|Vasiļjevs|Sokolovs|Mihailovs|Novikovs|Fjodorovs|Morozovs|Volkovs|Aleksejevs|Lebedevs|Semjonovs|Jegorovs|Pavlovs|Kozlovs|Stepanovs|Nikolajevs|Orlovs|Andrejevs|Makarovs|Ņikitins|Zaharovs|Zaicevs|Solovjovs|Borisovs|Jakovļevs|Grigorjevs|Romanovs|Vorobjovs|Sergejevs|Kuzmins|Frolovs|Aleksandrovs|Dmitrijevs|Koroļovs|Gusevs|Kiseļovs|Iļjins|Maksimovs|Poļakovs|Sorokins|Vinogradovs|Kovaļovs|Belovs|Medvedevs|Antonovs|Tarasovs",
);
const LITHUANIAN = pool(
  "lithuanian",
  "Mantas|Lukas|Jonas|Domantas|Paulius|Tomas|Karolis|Dovydas|Matas|Rokas|Arnas|Edvinas|Gvidas|Justas|Vytautas|Artūras|Deividas|Nerijus|Donatas|Marius|Darius|Saulius|Tautvydas|Eimantas|Ignas|Kipras|Titas|Nojus|Emilis|Augustas|Rytis|Linas|Egidijus|Giedrius|Arvydas|Ernestas|Gytis|Vilius|Aurimas|Modestas|Laurynas|Martynas|Mindaugas|Andrius|Simonas|Kęstutis|Gediminas|Ramūnas|Algirdas|Žygimantas|Dominykas|Benas|Joris|Ugnius|Kajus|Herkus|Pijus|Gustas|Aistis|Tadas|Vaidas|Valdas|Viktoras|Julius|Povilas|Robertas|Rolandas|Šarūnas|Tauras|Aleksandras|Kasparas|Motiejus|Jokūbas|Liudas|Danielius",
  "Kazlauskas|Petrauskas|Jankauskas|Stankevičius|Vasiliauskas|Butkus|Žukauskas|Paulauskas|Urbonas|Kavaliauskas|Baltrušaitis|Savickas|Balčiūnas|Navickas|Ramanauskas|Sakalauskas|Mikalauskas|Adomaitis|Kairys|Rimkus|Šimkus|Vaitkus|Norkus|Petraitis|Jonaitis|Žilinskas|Lukoševičius|Bernotas|Dambrauskas|Stonkus|Bagdonas|Grigas|Juknevičius|Kačinskas|Kuzminskas|Lukšys|Matulevičius|Mažeika|Pranckevičius|Rutkauskas|Šileikis|Tamošauskas|Urbanavičius|Valiukas|Venckus|Žemaitis|Juška|Morkūnas|Gudelis|Aleksandravičius|Barauskas|Bružas|Daukša|Eidukas|Gailius|Jasaitis|Karpavičius|Kazakevičius|Klimavičius|Laurinaitis|Mačiulis|Marcinkevičius|Motiejūnas|Noreika|Pocius|Radzevičius|Sinkevičius|Songaila|Tamulis|Užkuraitis|Vaičiūnas|Vitkus|Zabarauskas|Žalys|Ambrazas|Ališauskas|Astrauskas|Bartkus|Baranauskas|Bielskis|Brazauskas|Budrys|Čepulis|Dagys|Daugėla|Dovydaitis|Gaižauskas|Gečas|Gudaitis|Jakubauskas|Janušauskas|Jurgaitis|Kalinauskas|Kalvaitis|Kasparavičius|Kriščiūnas|Kučinskas|Kvedaras|Lapinskas|Masiulis|Mickus|Mockus|Naujokas|Petrulis|Račkauskas|Rimkevičius|Sabaliauskas|Senkus|Stasiulis|Šimonis|Stanionis|Survila|Tamošiūnas|Valančius|Vaškelis|Vilkas|Zabiela|Zaleckis|Žilys|Žukas|Grigaliūnas|Rakauskas",
);

// ------------------------------------------------------------------ Iceland and Faroe Islands

const ICELAND: NationSpec = {
  code: "IS",
  iso2: "IS",
  name: "Iceland",
  confederation: "UEFA",
  continent: "EU",
  capital: "Reykjavík",
  latitude: 64.1,
  languages: [{ code: "is", weight: 1 }],
  reputation: { national: 60, league: 38 },
  euEea: true,
  physique: { height: 183.5 },
  names: { given: sources("icelandic=1"), family: sources("icelandic=1") },
  nationality: {
    multipleRate: 0.22,
    tripleRate: 0.03,
    bornAbroadRate: 0.08,
    diasporaPull: 0.45,
    links: [
      ...links("regional", "DK:3 NO:3 SE:3 FO:1 FI:0.4"),
      ...links("crossBorder", "PL:6 LT:2 LV:1 RO:0.8 UA:0.8 DE:1 EN:1 ES:0.5 IT:0.4 PT:0.4 SY:0.3 IQ:0.3"),
      ...links("americas", "US:1.5 CA:0.6"),
      ...links("asianDiaspora", "PH:1 TH:0.8 VN:0.4"),
    ],
    citizenship: { dual: "allowed" },
  },
  cities: {
    major: cityRows(`
Reykjavík|large|Capital Region|4|Vesturbær,Hlíðar,Fossvogur,Úlfarsárdalur,Árbær,Breiðholt,Grafarvogur,Laugardalur
Kópavogur|medium|Capital Region|1
Hafnarfjörður|medium|Capital Region|2|Vellir
Akureyri|medium|Northeast|2|Glerárþorp
Keflavík|small|Southern Peninsula|1
Garðabær|small|Capital Region|1
Mosfellsbær|small|Capital Region|1
Akranes|small|West|1
Selfoss|small|South|1
Vestmannaeyjar|town|South|1
Ísafjörður|town|Westfjords|1
Njarðvík|town|Southern Peninsula|1
Grindavík|town|Southern Peninsula|1
Seltjarnarnes|town|Capital Region|1
Egilsstaðir|town|East|1
Sauðárkrókur|town|Northwest|1
Húsavík|town|Northeast|1
Borgarnes|town|West|1
Hveragerði|town|South|1
Dalvík|town|Northeast|1
Neskaupstaður|town|East|1
Ólafsvík|town|West|1
Siglufjörður|town|Northwest|1
Þorlákshöfn|town|South|1
Álftanes|town|Capital Region|1
Sandgerði|town|Southern Peninsula|1
Höfn|town|East|1
Stykkishólmur|town|West|1
Reyðarfjörður|town|East|1
Eskifjörður|town|East|1
Hvolsvöllur|town|South|1
`),
    extra: { exclude: ["Reykjanesbær", "Norðurþing"], max: 35 },
  },
  football: {
    leagues: [
      {
        tier: 1,
        name: "Besta deild karla",
        shortName: "Besta deild",
        size: 12,
        status: "semi-professional",
        reputation: 38,
        split: {
          groups: [
            { name: "Efri hluti", positions: [1, 6], roundRobins: 1, points: "full" },
            { name: "Neðri hluti", positions: [7, 12], roundRobins: 1, points: "full" },
          ],
        },
        clubs: {
          reputation: span(44, 32),
          giants: { count: 2, top: 48, bottom: 46 },
          capacity: span(6_500, 1_000),
          facilities: span(55, 32),
          academy: span(58, 36),
          wageBill: span(1_600_000, 300_000),
          transferBudget: span(150_000, 5_000),
          foreignShare: 0.22,
          squadSize: [25, 27],
        },
      },
    ],
    movement: [],
    cups: [
      { kind: "national", name: "Bikarkeppni KSÍ", legs: 1, neutralFinal: true, continental: true },
      { kind: "league", name: "Deildabikarinn", legs: 1 },
      { kind: "super", name: "Meistarakeppni KSÍ", participants: ["champion", "cup-winner"] },
    ],
    youth: {
      // Icelandic age classes: 2. flokkur (U19) and 3. flokkur (U16), the closest to U17.
      U19: { divisions: [division("2. flokkur karla", [1, 1])] },
      U17: { divisions: [division("3. flokkur karla", [1, 1])] },
    },
    reserves: { mode: "none" },
    clubNaming: {
      templates: templates(`
{city}|3
UMF {city}|2
KF {city}|2
ÍB {city}|1
ÍF {city}|1
`),
      founded: { top: [1899, 1950], bottom: [1899, 2010] },
      shortName: "city",
      colors: ["#C8102E", "#1B458F", "#FFFFFF", "#000000", "#00843D", "#FDB913", "#6CABDD"],
    },
    importSources: codes(
      "DK:3 SE:2 NO:2 FO:1.5 EN:1.5 SCO:0.5 US:1 ES:1 PT:0.5 RS:1 BA:0.6 HR:0.6 PL:1 LT:0.5 LV:0.3 NG:0.5 GH:0.4 SN:0.3 CM:0.3 DE:0.5 NL:0.5 BE:0.3 FI:0.3 CA:0.4 JM:0.3",
    ),
    coefficients: { association: [0.625, 1.5, 3.0, 3.833, 4.562], season2025: 3.625 },
  },
};

// No own league in the catalog (directive): Faroese players form a home pool or play abroad.
const FAROE_ISLANDS: NationSpec = {
  code: "FO",
  iso2: "FO",
  name: "Faroe Islands",
  confederation: "UEFA",
  continent: "EU",
  capital: "Tórshavn",
  latitude: 62.0,
  languages: [
    { code: "fo", weight: 0.95 },
    { code: "da", weight: 0.05 },
  ],
  reputation: { national: 42, league: 22 },
  euEea: false,
  physique: { height: 182 },
  names: { given: sources("faroese=1"), family: sources("faroese=0.85 faker:da=0.15") },
  nationality: {
    multipleRate: 0.2,
    tripleRate: 0.03,
    bornAbroadRate: 0.1,
    diasporaPull: 0.4,
    links: [
      ...links("regional", "DK:10 IS:2 NO:2 SE:0.6"),
      ...links("crossBorder", "SCO:0.8 EN:0.4 PL:0.6 RO:0.4 DE:0.3"),
      ...links("asianDiaspora", "PH:1 TH:0.8"),
    ],
    citizenship: { group: "DK", dual: "allowed" },
  },
  cities: {
    major: cityRows(`
Tórshavn|small|Streymoy|1
Klaksvík|town|Norðoyar|1
Hoyvík|town|Streymoy|1
Argir|town|Streymoy|1
Runavík|town|Eysturoy|1
Fuglafjørður|town|Eysturoy|1
Vágur|town|Suðuroy|1
Tvøroyri|town|Suðuroy|1
Sørvágur|town|Vágar|1
Miðvágur|town|Vágar|1
Sandavágur|town|Vágar|1
Vestmanna|town|Streymoy|1
Eiði|town|Eysturoy|1
Saltangará|town|Eysturoy|1
Leirvík|town|Eysturoy|1
Norðragøta|town|Eysturoy|1
Strendur|town|Eysturoy|1
Sandur|town|Sandoy|1
Skopun|town|Sandoy|1
Hvalba|town|Suðuroy|1
Porkeri|town|Suðuroy|1
Viðareiði|town|Norðoyar|1
`),
  },
  homePool: { seniors: 110, youth: 70 },
  abroad: { seniors: 22, youth: 8, destinations: codes("DK:10 NO:5 IS:5 SE:1.5 SCO:1") },
};

// ------------------------------------------------------------------ Norway

const NORWAY: NationSpec = {
  code: "NO",
  iso2: "NO",
  name: "Norway",
  confederation: "UEFA",
  continent: "EU",
  capital: "Oslo",
  latitude: 61.0,
  languages: [{ code: "no", weight: 1 }],
  reputation: { national: 76, league: 60 },
  euEea: true,
  physique: { height: 183.5 },
  names: { given: sources("faker:nb_NO=0.45 norwegian=0.55"), family: sources("faker:nb_NO=0.5 norwegian=0.5") },
  nationality: {
    multipleRate: 0.3,
    tripleRate: 0.05,
    bornAbroadRate: 0.08,
    diasporaPull: 0.35,
    links: [
      ...links("regional", "SE:6 DK:4 IS:1 FI:0.8"),
      ...links("crossBorder", "SO:5 GM:3 NG:2.5 GH:1.5 MA:2.5 ER:1.5 ET:0.8 IQ:1.5 IR:1.2 SY:1 AF:1 TR:1.5 PL:5 LT:2.5 XK:1.5 BA:1.2 RS:0.6 AL:0.5 DE:1.2 UA:1 RU:0.8 CD:0.8 KE:0.5 EN:1.5"),
      ...links("asianDiaspora", "PK:4 PH:1 TH:1 VN:1 LK:0.8 IN:0.6 CN:0.4"),
      ...links("americas", "CL:0.8 US:1"),
    ],
    citizenship: { dual: "allowed" },
  },
  cities: {
    major: cityRows(`
Oslo|large|Oslo|3|Frogner,Grünerløkka,Majorstuen,Tøyen,Sagene,Nordstrand,Holmlia,Furuset,Bjerke,Ullern
Bergen|large|Vestland|2|Fana,Laksevåg,Fyllingsdalen,Loddefjord,Arna
Trondheim|medium|Trøndelag|2|Byåsen,Strinda,Tiller,Lade,Moholt
Stavanger|medium|Rogaland|1
Drammen|medium|Buskerud|1
Fredrikstad|medium|Østfold|1
Kristiansand|medium|Agder|1
Sandnes|small|Rogaland|1
Tromsø|small|Troms|1
Sarpsborg|small|Østfold|1
Skien|small|Telemark|1
Ålesund|small|Møre og Romsdal|1
Sandefjord|small|Vestfold|1
Haugesund|small|Rogaland|1
Tønsberg|small|Vestfold|1
Moss|small|Østfold|1
Porsgrunn|small|Telemark|1
Bodø|small|Nordland|1
Arendal|small|Agder|1
Hamar|small|Innlandet|1
Larvik|small|Vestfold|1
Halden|small|Østfold|1
Lillehammer|small|Innlandet|1
Molde|small|Møre og Romsdal|1
Lillestrøm|small|Akershus|1
Asker|small|Akershus|1
Kristiansund|town|Møre og Romsdal|1
Harstad|town|Troms|1
Gjøvik|town|Innlandet|1
Sandvika|town|Akershus|1
Ski|town|Akershus|1
Jessheim|town|Akershus|1
Kongsberg|town|Buskerud|1
Hønefoss|town|Buskerud|1
Mjøndalen|town|Buskerud|1
Horten|town|Vestfold|1
Egersund|town|Rogaland|1
Bryne|town|Rogaland|1
Leirvik|town|Vestland|1
Førde|town|Vestland|1
Florø|town|Vestland|1
Sogndal|town|Vestland|1
Levanger|town|Trøndelag|1
Steinkjer|town|Trøndelag|1
Stjørdal|town|Trøndelag|1
Namsos|town|Trøndelag|1
Mo i Rana|town|Nordland|1
Narvik|town|Nordland|1
Alta|town|Finnmark|1
Hammerfest|town|Finnmark|1
Kongsvinger|town|Innlandet|1
Elverum|town|Innlandet|1
Raufoss|town|Innlandet|1
Notodden|town|Telemark|1
Grimstad|town|Agder|1
Mandal|town|Agder|1
Flekkefjord|town|Agder|1
Ørsta|town|Møre og Romsdal|1
`),
    extra: { max: 300 },
  },
  football: {
    leagues: [
      {
        tier: 1,
        name: "Eliteserien",
        shortName: "Eliteserien",
        size: 16,
        status: "professional",
        reputation: 60,
        clubs: {
          reputation: span(58, 44),
          giants: { count: 3, top: 66, bottom: 61 },
          capacity: span(21_000, 3_300),
          facilities: span(78, 50),
          academy: span(76, 50),
          wageBill: span(16_000_000, 2_500_000),
          transferBudget: span(6_000_000, 100_000),
          foreignShare: 0.25,
          squadSize: [25, 29],
        },
      },
    ],
    movement: [],
    cups: [{ kind: "national", name: "Norgesmesterskapet", shortName: "NM", legs: 1, neutralFinal: true, continental: true }],
    youth: {
      U19: { divisions: [division("G19 Elite", [1, 1])], cup: { name: "Junior-NM" } },
      U17: { divisions: [division("G17 Elite", [1, 1])] },
    },
    reserves: { mode: "none" },
    clubNaming: {
      templates: templates(`
{city} FK|6
{city} IL|4
{city} SK|3
{city} IF|3
{city} BK|2.5
{city} Fotball|2.5
FK {city}|2
IL {city}|1
SK {city}|1
`),
      founded: { top: [1899, 1920], bottom: [1903, 2003] },
      shortName: "city",
      colors: ["#FDB913", "#C8102E", "#1B458F", "#FFFFFF", "#000000", "#00843D", "#6CABDD"],
    },
    importSources: codes(
      "SE:4 DK:3 IS:2 FI:1 NG:2 GH:2 GM:1.5 SN:1.5 CI:1 ML:0.8 CM:0.6 US:1 BR:1 CO:0.6 AR:0.5 ES:1 PT:0.6 FR:0.8 NL:1 BE:0.5 DE:1 EN:1 SCO:0.4 RS:0.8 BA:0.5 HR:0.5 XK:0.6 AL:0.4 PL:0.8 UA:0.5 LT:0.3 EE:0.3 LV:0.3 KR:0.5 JP:0.5 AU:0.5 CA:0.5 KE:0.4 SO:0.3 MA:0.5",
    ),
    coefficients: { association: [6.5, 7.625, 5.75, 8.0, 11.812], season2025: 8.05 },
  },
};

// ------------------------------------------------------------------ Sweden

const SWEDEN: NationSpec = {
  code: "SE",
  iso2: "SE",
  name: "Sweden",
  confederation: "UEFA",
  continent: "EU",
  capital: "Stockholm",
  latitude: 60.0,
  languages: [{ code: "sv", weight: 1 }],
  reputation: { national: 70, league: 59 },
  euEea: true,
  physique: { height: 183 },
  names: { given: sources("faker:sv=0.5 swedish=0.5"), family: sources("faker:sv=0.45 swedish=0.55") },
  nationality: {
    multipleRate: 0.33,
    tripleRate: 0.06,
    bornAbroadRate: 0.1,
    diasporaPull: 0.35,
    links: [
      ...links("regional", "FI:7 NO:2.5 DK:2 EE:0.6 IS:0.3"),
      ...links("crossBorder", "BA:5 RS:3.5 XK:2.5 MK:1.5 HR:1.5 AL:0.8 ME:0.6 TR:3 IQ:4 SY:3 IR:3 LB:1.5 PS:1 AF:2 SO:3 ER:3 ET:1.5 GM:1.5 NG:1.5 GH:1.5 SL:0.8 CD:0.8 UG:0.8 KE:0.5 PL:3 DE:1.5 HU:0.6 RO:0.8 GR:0.8 IT:0.6 ES:0.4 UA:0.8 RU:0.6 EN:0.8"),
      ...links("americas", "CL:2 BR:0.8 US:0.8 AR:0.4 CO:0.5"),
      ...links("asianDiaspora", "TH:1.5 VN:0.5 CN:0.5 KR:0.5 IN:0.8 PH:0.5"),
    ],
    citizenship: { dual: "allowed" },
  },
  cities: {
    major: cityRows(`
Stockholm|large|Stockholm|4|Södermalm,Kungsholmen,Östermalm,Vasastan,Bromma,Hägersten,Skärholmen,Farsta,Vällingby,Enskede,Spånga,Rinkeby
Göteborg|large|Västra Götaland|4|Hisingen,Majorna,Gamlestaden,Lundby,Frölunda,Angered,Kortedala,Backa,Biskopsgården
Malmö|large|Skåne|2|Limhamn,Rosengård,Husie,Kirseberg,Fosie
Uppsala|medium|Uppsala|1|Gottsunda,Sävja,Luthagen,Svartbäcken,Gränby,Eriksberg
Västerås|medium|Västmanland|1|Råby,Bäckby,Vallby,Önsta,Viksäng
Örebro|medium|Örebro|1|Adolfsberg,Vivalla,Brickebacken,Varberga,Almby,Hovsta
Linköping|medium|Östergötland|1|Ryd,Skäggetorp,Lambohov,Tannefors,Ekholmen
Helsingborg|medium|Skåne|1|Råå,Ödåkra,Drottninghög,Rydebäck,Påarp
Jönköping|medium|Småland|1|Råslätt,Österängen,Tenhult,Bankeryd
Norrköping|medium|Östergötland|1|Hageby,Navestad,Smedby,Eneby,Lindö
Lund|small|Skåne|1|Norra Fäladen,Klostergården,Linero,Dalby
Umeå|small|Västerbotten|1|Ålidhem,Teg,Holmsund,Sävar
Gävle|small|Gävleborg|1|Sätra,Strömsbro,Bomhus,Brynnäs
Borås|small|Västra Götaland|1|Hässleholmen,Sjöbo,Hulta,Byttorp
Södertälje|small|Stockholm|1|Ronna,Hovsjö,Geneta,Järna
Eskilstuna|small|Södermanland|1|Årby,Fröslunda,Skiftinge
Halmstad|small|Halland|1|Vallås,Söndrum,Fyllinge,Oskarström
Växjö|small|Småland|1|Teleborg,Araby,Hovshaga,Sandsbro
Karlstad|small|Värmland|1|Våxnäs,Kronoparken,Skåre,Råtorp
Sundsvall|small|Västernorrland|1|Skönsberg,Nacksta,Kovland
Solna|small|Stockholm|1|Hagalund,Bergshamra
Täby|small|Stockholm|1|Näsby,Gribbylund,Ensta
Östersund|small|Jämtland|1|Torvalla,Lugnvik,Odenskog
Trollhättan|small|Västra Götaland|1|Kronogården,Lextorp,Sylte
Luleå|small|Norrbotten|1|Porsön,Hertsön,Gammelstad
Borlänge|small|Dalarna|1|Tjärna Ängar,Domnarvet,Islingby
Kristianstad|small|Skåne|1|Vilan,Gamlegården,Åhus
Kalmar|small|Småland|1|Oxhagen,Funkabo,Norrliden
Falun|small|Dalarna|1|Slätta,Hälsinggården
Skövde|small|Västra Götaland|1|Käpplunda,Hentorp
Uddevalla|small|Västra Götaland|1|Tureborg,Dalaberg
Karlskrona|small|Blekinge|1|Lyckeby,Rödeby
Skellefteå|small|Västerbotten|1|Anderstorp,Ursviken
Landskrona|town|Skåne|1
Trelleborg|town|Skåne|1
Varberg|town|Halland|1
Falkenberg|town|Halland|1|Skrea,Ullared
Värnamo|town|Småland|1|Bor,Rydaholm
Degerfors|town|Örebro|1|Svartå,Strömtorp
Sandviken|town|Gävleborg|1
Sölvesborg|town|Blekinge|1
Ängelholm|town|Skåne|1
Hässleholm|town|Skåne|1|Tyringe,Sjörup
Motala|town|Östergötland|1|Borensberg,Charlottenborg
Nyköping|town|Södermanland|1|Oppeby,Brandkärr
Enköping|town|Uppsala|1
Visby|town|Gotland|1
Piteå|town|Norrbotten|1
Örnsköldsvik|town|Västernorrland|1
Lidköping|town|Västra Götaland|1
Alingsås|town|Västra Götaland|1
Kungsbacka|town|Halland|1
Ystad|town|Skåne|1
Åtvidaberg|town|Östergötland|1
Oskarshamn|town|Småland|1|Påskallavik,Kristdala
Kiruna|town|Norrbotten|1
Norrtälje|town|Stockholm|1
Katrineholm|town|Södermanland|1
Hudiksvall|town|Gävleborg|1
Arvika|town|Värmland|1
`),
    extra: { max: 300 },
  },
  football: {
    leagues: [
      {
        tier: 1,
        name: "Allsvenskan",
        shortName: "Allsvenskan",
        size: 16,
        status: "professional",
        reputation: 59,
        clubs: {
          reputation: span(58, 45),
          giants: { count: 3, top: 64, bottom: 61 },
          capacity: span(50_000, 4_500),
          facilities: span(80, 52),
          academy: span(78, 52),
          wageBill: span(22_000_000, 2_800_000),
          transferBudget: span(7_000_000, 100_000),
          foreignShare: 0.28,
          squadSize: [25, 29],
        },
      },
      {
        tier: 2,
        name: "Superettan",
        shortName: "Superettan",
        size: 16,
        status: "professional",
        reputation: 48,
        clubs: {
          reputation: span(47, 36),
          capacity: span(15_000, 2_000),
          facilities: span(58, 38),
          academy: span(60, 38),
          wageBill: span(4_000_000, 900_000),
          transferBudget: span(700_000, 20_000),
          foreignShare: 0.18,
          squadSize: [25, 27],
        },
      },
    ],
    movement: [
      {
        upper: 1,
        promoted: 2,
        relegated: 2,
        playoffs: [{ type: "cross-tier", upperPositions: [14], lowerPositions: [3], legs: 2 }],
      },
    ],
    cups: [{ kind: "national", name: "Svenska Cupen", legs: 1, continental: true }],
    youth: {
      U19: { divisions: [division("P19 Allsvenskan", [1, 2], 16, "Norra|Södra")] },
      U17: { divisions: [division("P17 Allsvenskan", [1, 2], 16, "Norra|Södra")] },
    },
    reserves: { mode: "none" },
    clubNaming: {
      templates: templates(`
{city} IF|6
{city} FF|4
{city} BK|4
IFK {city}|3
{city} IK|3
{city} SK|2.5
{city} FC|2
{city} AIK|1.2
FC {city}|1
{city} AIF|1
{city} BoIS|0.8
GIF {city}|0.6
{city} GIF|0.4
{city} Södra IF|0.3
Syrianska {city}|0.15
`),
      founded: { top: [1885, 1925], bottom: [1895, 2005] },
      shortName: "city",
      colors: ["#FDB913", "#1B458F", "#6CABDD", "#000000", "#FFFFFF", "#00843D", "#C8102E"],
    },
    importSources: codes(
      "NG:2 GH:2 GM:2 SN:1.5 CI:1 CM:0.8 ML:0.5 KE:0.6 NO:2 DK:2 FI:2 IS:1.5 EE:0.5 LV:0.3 LT:0.3 BA:1 RS:1 HR:0.8 XK:0.8 MK:0.5 AL:0.5 BR:1.5 AR:0.6 CO:0.8 US:1 CA:0.4 JP:0.6 KR:0.4 AU:0.6 NL:0.8 DE:0.8 EN:0.8 FR:0.6 ES:0.6 PT:0.5 PL:0.6 UA:0.4 SY:0.5 IQ:0.5 IR:0.4 TR:0.6 SO:0.3 ER:0.4 ET:0.3 SL:0.4 ZA:0.3",
    ),
    coefficients: { association: [2.5, 5.125, 6.25, 1.875, 11.375], season2025: 5.0 },
  },
};

// ------------------------------------------------------------------ Denmark

const DENMARK: NationSpec = {
  code: "DK",
  iso2: "DK",
  name: "Denmark",
  confederation: "UEFA",
  continent: "EU",
  capital: "København",
  latitude: 56.0,
  languages: [{ code: "da", weight: 1 }],
  reputation: { national: 80, league: 64 },
  euEea: true,
  physique: { height: 183 },
  names: { given: sources("faker:da=0.5 danish=0.5"), family: sources("faker:da=0.5 danish=0.5") },
  nationality: {
    multipleRate: 0.3,
    tripleRate: 0.05,
    bornAbroadRate: 0.07,
    diasporaPull: 0.3,
    links: [
      ...links("regional", "SE:3 NO:2 FO:1.5 IS:1"),
      ...links("germanRecruitment", "TR:5"),
      ...links("crossBorder", "DE:3 PL:3 BA:3 RS:1.5 XK:1.5 HR:1 MK:0.6 AL:0.4 IQ:2 IR:1.5 LB:2 PS:0.8 SY:1.5 AF:1.5 SO:2.5 ER:0.5 ET:0.4 NG:3 GH:2.5 GM:1 SN:0.6 CD:0.8 UG:0.6 KE:0.4 MA:2 EN:0.8 UA:0.8 RO:1 LT:0.8 BG:0.5 IT:0.5"),
      ...links("asianDiaspora", "PK:2 VN:0.8 TH:1 PH:0.8 LK:0.6 CN:0.4 IN:0.5"),
      ...links("americas", "US:0.6 CL:0.5 BR:0.6"),
    ],
    citizenship: { dual: "allowed" },
  },
  cities: {
    major: cityRows(`
København|large|Hovedstaden|3|Vesterbro,Nørrebro,Østerbro,Amager,Valby,Vanløse,Bispebjerg,Sundby,Nordhavn
Aarhus|medium|Østjylland|2|Viby,Risskov,Brabrand,Højbjerg,Åbyhøj
Odense|medium|Fyn|1|Bolbro,Tarup,Hjallese,Vollsmose,Korup,Bellinge
Aalborg|medium|Nordjylland|1|Hasseris,Gug,Svenstrup,Vestbyen,Vodskov
Esbjerg|small|Sydjylland|1|Sædding,Tjæreborg,Guldager,Hjerting
Randers|small|Østjylland|1|Kristrup,Dronningborg,Romalt,Paderup
Kolding|small|Sydjylland|1|Seest,Bramdrupdam,Sønder Bjert
Horsens|small|Østjylland|1|Stensballe,Torsted
Vejle|small|Sydjylland|1|Bredballe,Nørremarken,Søndermarken
Roskilde|small|Sjælland|1|Himmelev,Svogerslev,Trekroner
Herning|small|Midtjylland|1|Gullestrup,Tjørring,Snejbjerg
Silkeborg|small|Midtjylland|1|Virklund,Gødvad,Funder
Næstved|small|Sjælland|1|Kalbyris,Holme-Olstrup
Fredericia|small|Sydjylland|1|Taulov,Snoghøj
Viborg|small|Midtjylland|1|Overlund,Arnbjerg
Køge|small|Sjælland|1|Ølby,Ejby
Holstebro|small|Midtjylland|1|Tvis,Mejrup
Taastrup|small|Hovedstaden|1|Hedehusene,Sengeløse
Slagelse|small|Vestsjælland|1|Kvislemark,Vårby
Hillerød|small|Nordsjælland|1|Ullerød,Nødebo
Sønderborg|small|Sønderjylland|1|Ulkebøl,Nørre Hav
Svendborg|town|Fyn|1
Hjørring|town|Nordjylland|1
Holbæk|town|Vestsjælland|1
Frederikshavn|town|Nordjylland|1
Nørresundby|town|Nordjylland|1
Ringsted|town|Sjælland|1
Haderslev|town|Sønderjylland|1
Skive|town|Midtjylland|1
Farum|town|Nordsjælland|1
Brøndby|town|Hovedstaden|1
Lyngby|town|Hovedstaden|1
Hvidovre|town|Hovedstaden|1
Glostrup|town|Hovedstaden|1
Helsingør|town|Nordsjælland|1
Ikast|town|Midtjylland|1
Aabenraa|town|Sønderjylland|1
Thisted|town|Nordjylland|1
Nyborg|town|Fyn|1
Middelfart|town|Fyn|1
Nykøbing Falster|town|Lolland-Falster|1
Nakskov|town|Lolland-Falster|1
Rønne|town|Bornholm|1
Grenaa|town|Østjylland|1
Varde|town|Sydjylland|1
Ribe|town|Sydjylland|1
Tønder|town|Sønderjylland|1
Skanderborg|town|Østjylland|1
Hobro|town|Nordjylland|1
Brande|town|Midtjylland|1
Kalundborg|town|Vestsjælland|1
Vordingborg|town|Sjælland|1
`),
    extra: { max: 250 },
  },
  football: {
    leagues: [
      {
        tier: 1,
        name: "Superligaen",
        shortName: "Superliga",
        size: 12,
        status: "professional",
        reputation: 64,
        split: {
          groups: [
            { name: "Mesterskabsspil", positions: [1, 6], roundRobins: 2, points: "full" },
            { name: "Nedrykningsspil", positions: [7, 12], roundRobins: 2, points: "full" },
          ],
        },
        clubs: {
          reputation: span(62, 50),
          giants: { count: 3, top: 70, bottom: 66 },
          capacity: span(38_000, 4_000),
          facilities: span(84, 58),
          academy: span(84, 60),
          wageBill: span(42_000_000, 4_500_000),
          transferBudget: span(15_000_000, 200_000),
          foreignShare: 0.35,
          squadSize: [25, 30],
        },
      },
    ],
    movement: [],
    cups: [{ kind: "national", name: "DBU Pokalen", legs: 1, neutralFinal: true, continental: true }],
    youth: {
      U19: { divisions: [division("U19 Ligaen", [1, 1])] },
      U17: { divisions: [division("U17 Ligaen", [1, 1])] },
    },
    reserves: { mode: "none" },
    clubNaming: {
      templates: templates(`
FC {city}|5
{city} BK|5
{city} IF|4
{city} Boldklub|1.5
{city} FF|1.5
{city} FC|1.2
{city} IK|1
{city} fB|0.8
{city} GF|0.8
BK {city}|0.6
{city} Fodbold|0.6
B {founded} {city}|0.5
FC {region}|0.8
{city} Fremad|0.3
`),
      // Merged regional clubs (FC Midtjylland, FC Nordsjælland) never take the administrative Capital Region's name.
      regional: [
        {
          regions: ["Hovedstaden"],
          templates: templates(`
FC {city}|5
{city} BK|5
{city} IF|4
{city} Boldklub|1.5
{city} FF|1.5
{city} FC|1.2
{city} IK|1
{city} fB|0.8
{city} GF|0.8
BK {city}|0.6
{city} Fodbold|0.6
B {founded} {city}|0.5
{city} Fremad|0.3
`),
        },
      ],
      founded: { top: [1876, 1920], bottom: [1880, 2005] },
      shortName: "city",
      colors: ["#C8102E", "#FFFFFF", "#1B458F", "#FDB913", "#000000", "#00843D", "#6CABDD"],
    },
    importSources: codes(
      "SE:3 NO:3 IS:2 FO:1 FI:1 DE:2 NL:1.5 BE:0.6 EN:1 SCO:0.4 FR:0.8 ES:0.8 PT:0.6 IT:0.5 PL:0.8 HR:0.8 RS:0.8 BA:0.6 SI:0.4 AT:0.5 CH:0.4 UA:0.4 GE:0.4 NG:2 GH:2.5 CI:1 SN:1 ML:0.8 CM:0.6 GM:0.8 ZA:0.5 KE:0.4 BR:1.5 AR:0.6 CO:0.6 UY:0.4 EC:0.4 US:1 CA:0.4 JP:0.8 KR:0.6 AU:0.6 NZ:0.3 IL:0.4 TR:0.5 MA:0.5 IR:0.3",
    ),
    coefficients: { association: [4.125, 7.8, 5.9, 8.5, 7.656], season2025: 12.25 },
  },
};

// ------------------------------------------------------------------ Finland

const FINLAND: NationSpec = {
  code: "FI",
  iso2: "FI",
  name: "Finland",
  confederation: "UEFA",
  continent: "EU",
  capital: "Helsinki",
  latitude: 62.0,
  languages: [
    { code: "fi", weight: 0.9 },
    { code: "sv", weight: 0.1 },
  ],
  reputation: { national: 58, league: 45 },
  euEea: true,
  physique: { height: 182 },
  names: {
    given: sources("faker:fi=0.3 finnish=0.6 finland-swedish=0.1"),
    family: sources("faker:fi=0.3 finnish=0.6 finland-swedish=0.1"),
  },
  nationality: {
    multipleRate: 0.24,
    tripleRate: 0.04,
    bornAbroadRate: 0.06,
    diasporaPull: 0.35,
    links: [
      ...links("regional", "SE:6 EE:5 NO:0.6 DK:0.5"),
      ...links("crossBorder", "RU:5 UA:1 XK:2 AL:1 MK:0.8 BA:0.8 TR:1 IQ:1.5 IR:1 AF:1 SO:3 ET:0.6 NG:1 SL:1 GH:0.8 GM:0.5 CD:0.6 KE:0.5 PL:0.6 DE:0.8 EN:0.8"),
      ...links("americas", "US:0.8"),
      ...links("asianDiaspora", "CN:0.6 VN:0.8 TH:0.8 IN:0.4"),
    ],
    citizenship: { dual: "allowed" },
  },
  cities: {
    major: cityRows(`
Helsinki|large|Uusimaa|3|Kallio,Töölö,Kumpula,Pasila,Vuosaari,Malmi,Itäkeskus,Munkkiniemi,Käpylä
Espoo|medium|Uusimaa|1
Tampere|medium|Pirkanmaa|2|Hervanta,Kaleva,Tesoma
Vantaa|medium|Uusimaa|1
Oulu|medium|North Ostrobothnia|1
Turku|medium|Southwest Finland|2|Kupittaa,Runosmäki,Hirvensalo
Jyväskylä|small|Central Finland|1
Lahti|small|Päijät-Häme|1
Kuopio|small|North Savo|1
Pori|small|Satakunta|1
Joensuu|small|North Karelia|1
Lappeenranta|small|South Karelia|1
Hämeenlinna|small|Kanta-Häme|1
Vaasa|small|Ostrobothnia|1
Seinäjoki|small|South Ostrobothnia|1
Rovaniemi|small|Lapland|1
Mikkeli|small|South Savo|1
Kotka|small|Kymenlaakso|1
Salo|small|Southwest Finland|1
Porvoo|small|Uusimaa|1
Kouvola|small|Kymenlaakso|1
Kokkola|town|Central Ostrobothnia|1
Hyvinkää|town|Uusimaa|1
Järvenpää|town|Uusimaa|1
Rauma|town|Satakunta|1
Kajaani|town|Kainuu|1
Kerava|town|Uusimaa|1
Savonlinna|town|South Savo|1
Tornio|town|Lapland|1
Valkeakoski|town|Pirkanmaa|1
Jakobstad|town|Ostrobothnia|1
Mariehamn|town|Åland|1
Ekenäs|town|Uusimaa|1
Raahe|town|North Ostrobothnia|1
Iisalmi|town|North Savo|1
Varkaus|town|North Savo|1
Kemi|town|Lapland|1
Forssa|town|Kanta-Häme|1
Riihimäki|town|Kanta-Häme|1
Heinola|town|Päijät-Häme|1
Imatra|town|South Karelia|1
Kuusamo|town|North Ostrobothnia|1
Uusikaupunki|town|Southwest Finland|1
Lohja|town|Uusimaa|1
Tuusula|town|Uusimaa|1
Nokia|town|Pirkanmaa|1
Ylivieska|town|North Ostrobothnia|1
Närpes|town|Ostrobothnia|1
`),
    extra: { exclude: ["Pietarsaari", "Maarianhamina", "Tammisaari"], max: 300 },
  },
  football: {
    leagues: [
      {
        tier: 1,
        name: "Veikkausliiga",
        shortName: "Veikkausliiga",
        size: 12,
        status: "professional",
        reputation: 45,
        split: {
          groups: [
            { name: "Ylempi jatkosarja", positions: [1, 6], roundRobins: 1, points: "full" },
            { name: "Alempi jatkosarja", positions: [7, 12], roundRobins: 1, points: "full" },
          ],
        },
        clubs: {
          reputation: span(48, 36),
          giants: { count: 2, top: 54, bottom: 52 },
          capacity: span(10_700, 1_650),
          facilities: span(62, 38),
          academy: span(62, 40),
          wageBill: span(5_000_000, 700_000),
          transferBudget: span(1_000_000, 20_000),
          foreignShare: 0.3,
          squadSize: [25, 27],
        },
      },
    ],
    movement: [],
    cups: [
      { kind: "national", name: "Suomen Cup", legs: 1, neutralFinal: true, continental: true },
      { kind: "league", name: "Liigacup", legs: 1 },
    ],
    youth: {
      U19: { divisions: [division("A-nuorten SM-sarja", [1, 1])] },
      U17: { divisions: [division("B-nuorten SM-sarja", [1, 1])] },
    },
    reserves: { mode: "none" },
    clubNaming: {
      templates: templates(`
FC {city}|6
AC {city}|1.5
{city} United|1.5
{city} City|0.8
`),
      regional: [
        {
          regions: ["Åland", "Ostrobothnia"],
          templates: templates(`
IFK {city}|4
{city} IF|2
IF {city}|1
`),
        },
      ],
      founded: { top: [1907, 1935], bottom: [1919, 2007] },
      shortName: "city",
      colors: ["#1B458F", "#FFFFFF", "#C8102E", "#FDB913", "#000000", "#00843D", "#6CABDD"],
    },
    importSources: codes(
      "SE:2 EE:1.5 NO:0.6 DK:0.6 IS:0.3 RU:0.5 UA:0.4 NG:1.5 GH:1.5 CM:0.8 CI:0.8 SN:0.8 GM:0.6 KE:0.4 BR:1.5 CO:0.6 AR:0.4 US:0.8 JM:0.5 EN:0.8 SCO:0.3 IE:0.4 NL:0.6 DE:0.5 ES:0.8 PT:0.5 FR:0.5 BA:0.4 RS:0.4 XK:0.4 AL:0.3 JP:0.8 KR:0.3 AU:0.4",
    ),
    coefficients: { association: [1.375, 3.75, 2.625, 1.75, 2.25], season2025: 3.625 },
  },
};

// ------------------------------------------------------------------ Baltic states

const ESTONIA: NationSpec = {
  code: "EE",
  iso2: "EE",
  name: "Estonia",
  confederation: "UEFA",
  continent: "EU",
  capital: "Tallinn",
  latitude: 58.7,
  languages: [
    { code: "et", weight: 0.72 },
    { code: "ru", weight: 0.28 },
  ],
  reputation: { national: 44, league: 34 },
  euEea: true,
  physique: { height: 183 },
  names: { given: sources("estonian=0.8 estonian-russian=0.2"), family: sources("estonian=0.8 estonian-russian=0.2") },
  nationality: {
    // The Citizenship Act prohibits dual citizenship for adults; only one nationality is recorded.
    multipleRate: 0.24,
    tripleRate: 0.03,
    bornAbroadRate: 0.04,
    diasporaPull: 0.3,
    links: [
      ...links("postSoviet", "RU:8 UA:2.5 BY:1.2 LV:1 LT:0.4"),
      ...links("regional", "FI:4 SE:0.8"),
      ...links("crossBorder", "DE:0.5 PL:0.3 EN:0.3"),
    ],
    citizenship: { dual: "restricted" },
  },
  cities: {
    major: cityRows(`
Tallinn|large|Harju|4|Nõmme,Lasnamäe,Mustamäe,Kristiine,Pirita,Kalamaja,Haabersti,Kopli,Kesklinn,Õismäe
Tartu|medium|Tartu|2|Annelinn,Tammelinn,Karlova,Supilinn
Narva|small|Ida-Viru|1
Pärnu|small|Pärnu|1
Kohtla-Järve|small|Ida-Viru|1
Viljandi|small|Viljandi|1
Maardu|town|Harju|1
Rakvere|town|Lääne-Viru|1
Kuressaare|town|Saare|1
Sillamäe|town|Ida-Viru|1
Võru|town|Võru|1
Valga|town|Valga|1
Jõhvi|town|Ida-Viru|1
Haapsalu|town|Lääne|1
Keila|town|Harju|1
Paide|town|Järva|1
Viimsi|town|Harju|1
Saue|town|Harju|1
Laagri|town|Harju|1
Elva|town|Tartu|1
Põlva|town|Põlva|1
Jõgeva|town|Jõgeva|1
Rapla|town|Rapla|1
Tapa|town|Lääne-Viru|1
Türi|town|Järva|1
Otepää|town|Valga|1
Kärdla|town|Hiiu|1
Paldiski|town|Harju|1
Kiviõli|town|Ida-Viru|1
Põltsamaa|town|Jõgeva|1
`),
    extra: { exclude: ["Lasnamäe", "Mustamäe", "Kesklinn", "Haabersti", "Kristiine", "Põhja-Tallinn", "Pirita", "Nõmme"], max: 120 },
  },
  football: {
    leagues: [
      {
        tier: 1,
        name: "Meistriliiga",
        shortName: "Meistriliiga",
        size: 10,
        status: "semi-professional",
        reputation: 34,
        roundRobins: 4,
        clubs: {
          reputation: span(38, 27),
          giants: { count: 2, top: 45, bottom: 43 },
          capacity: span(9_700, 800),
          facilities: span(55, 25),
          academy: span(55, 28),
          wageBill: span(2_600_000, 250_000),
          transferBudget: span(200_000, 5_000),
          foreignShare: 0.22,
          squadSize: [25, 27],
        },
      },
    ],
    movement: [],
    cups: [
      { kind: "national", name: "Eesti Karikas", legs: 1, neutralFinal: true, continental: true },
      { kind: "super", name: "Eesti Superkarikas", participants: ["champion", "cup-winner"] },
    ],
    youth: {
      U19: { divisions: [division("Noorte Meistriliiga", [1, 1])] },
      U17: { divisions: [division("U17 Eliitliiga", [1, 1])] },
    },
    reserves: { mode: "none" },
    clubNaming: {
      templates: templates(`
FC {city}|4
JK {city}|3
{city} JK|2
{city} Linnameeskond|1
SK {city}|1
`),
      founded: { top: [1990, 1999], bottom: [1979, 2012] },
      shortName: "city",
      colors: ["#1B458F", "#00843D", "#FFFFFF", "#000000", "#C8102E", "#FDB913"],
    },
    importSources: codes(
      "RU:1 UA:1.5 BY:0.6 LV:1 LT:0.6 FI:1 SE:0.3 NG:1 GH:0.8 SN:0.6 CI:0.5 CM:0.5 BR:0.8 CO:0.3 ES:0.5 PT:0.3 JP:0.8 KR:0.3 US:0.3 GE:0.4 KZ:0.2 MD:0.3 RS:0.3",
    ),
    coefficients: { association: [1.375, 3.666, 1.166, 0.125, 1.625], season2025: 1.625 },
  },
};

// Latvia (Citizenship Law 2013): dual citizenship only with EU, EFTA and NATO members, Australia, Brazil and New Zealand.
const LATVIA_DUAL_PARTNERS = list(
  "AT|BE|BG|HR|CY|CZ|DK|EE|FI|FR|DE|GR|HU|IE|IT|LT|LU|MT|NL|PL|PT|RO|SK|SI|ES|SE|IS|LI|NO|CH|GB|US|CA|TR|AL|ME|MK|AU|BR|NZ",
);

const LATVIA: NationSpec = {
  code: "LV",
  iso2: "LV",
  name: "Latvia",
  confederation: "UEFA",
  continent: "EU",
  capital: "Rīga",
  latitude: 56.9,
  languages: [
    { code: "lv", weight: 0.7 },
    { code: "ru", weight: 0.3 },
  ],
  reputation: { national: 40, league: 36 },
  euEea: true,
  physique: { height: 183.5 },
  names: {
    given: sources("faker:lv=0.5 latvian=0.28 latvian-russian=0.22"),
    family: sources("faker:lv=0.5 latvian=0.28 latvian-russian=0.22"),
  },
  nationality: {
    multipleRate: 0.27,
    tripleRate: 0.03,
    bornAbroadRate: 0.05,
    diasporaPull: 0.3,
    links: [
      ...links("postSoviet", "RU:8 BY:2 UA:3 LT:1.5 EE:1"),
      ...links("crossBorder", "PL:1.5 DE:0.6 SE:0.4 EN:1 IE:1 NO:0.4"),
      ...links("americas", "US:0.4"),
    ],
    citizenship: { dual: "partners", partners: LATVIA_DUAL_PARTNERS },
  },
  cities: {
    major: cityRows(`
Rīga|large|Rīga|5|Imanta,Pļavnieki,Purvciems,Ķengarags,Sarkandaugava,Čiekurkalns,Ziepniekkalns,Mežaparks,Āgenskalns,Torņakalns,Bolderāja,Teika
Daugavpils|medium|Latgale|1
Liepāja|small|Kurzeme|1
Jelgava|small|Zemgale|1
Jūrmala|small|Rīga|1
Ventspils|small|Kurzeme|1
Rēzekne|town|Latgale|1
Valmiera|town|Vidzeme|1
Jēkabpils|town|Zemgale|1
Ogre|town|Vidzeme|1
Tukums|town|Kurzeme|1
Salaspils|town|Rīga|1
Cēsis|town|Vidzeme|1
Kuldīga|town|Kurzeme|1
Olaine|town|Rīga|1
Saldus|town|Kurzeme|1
Talsi|town|Kurzeme|1
Dobele|town|Zemgale|1
Sigulda|town|Vidzeme|1
Ķekava|town|Rīga|1
Grobiņa|town|Kurzeme|1
Bauska|town|Zemgale|1
Krāslava|town|Latgale|1
Ludza|town|Latgale|1
Madona|town|Vidzeme|1
Gulbene|town|Vidzeme|1
Smiltene|town|Vidzeme|1
Aizkraukle|town|Vidzeme|1
Limbaži|town|Vidzeme|1
Preiļi|town|Latgale|1
Balvi|town|Latgale|1
Alūksne|town|Vidzeme|1
`),
    extra: { max: 120 },
  },
  football: {
    leagues: [
      {
        tier: 1,
        name: "Virslīga",
        shortName: "Virslīga",
        size: 10,
        status: "semi-professional",
        reputation: 36,
        roundRobins: 4,
        clubs: {
          reputation: span(40, 27),
          giants: { count: 2, top: 47, bottom: 45 },
          capacity: span(8_000, 800),
          facilities: span(56, 26),
          academy: span(52, 26),
          wageBill: span(3_500_000, 250_000),
          transferBudget: span(300_000, 5_000),
          foreignShare: 0.35,
          squadSize: [25, 27],
        },
      },
    ],
    movement: [],
    cups: [{ kind: "national", name: "Latvijas kauss", legs: 1, neutralFinal: true, continental: true }],
    youth: {
      U19: { divisions: [division("Latvijas jaunatnes čempionāts U19", [1, 1])] },
      U17: { divisions: [division("Latvijas jaunatnes čempionāts U17", [1, 1])] },
    },
    reserves: { mode: "none" },
    clubNaming: {
      templates: templates(`
FK {city}|5
FC {city}|2
SK {city}|1.5
{city} FK|1
BFC {city}|0.8
FS {city}|0.7
`),
      founded: { top: [1991, 2016], bottom: [1967, 2020] },
      shortName: "city",
      colors: ["#8B0000", "#FFFFFF", "#1B458F", "#FDB913", "#000000", "#00843D"],
    },
    importSources: codes(
      "UA:1.5 RU:0.8 BY:0.8 LT:1 EE:0.8 GE:0.6 KZ:0.2 BR:1.5 NG:1.5 GH:1 CI:0.8 SN:0.8 CM:0.6 ML:0.4 JP:1 KR:0.4 ES:0.6 PT:0.5 FR:0.4 RS:0.5 HR:0.3 BA:0.3 MD:0.3 CO:0.5 AR:0.3 US:0.3",
    ),
    coefficients: { association: [1.375, 2.625, 2.75, 1.625, 3.875], season2025: 2.0 },
  },
};

const LITHUANIA: NationSpec = {
  code: "LT",
  iso2: "LT",
  name: "Lithuania",
  confederation: "UEFA",
  continent: "EU",
  capital: "Vilnius",
  latitude: 55.2,
  languages: [
    { code: "lt", weight: 0.88 },
    { code: "ru", weight: 0.07 },
    { code: "pl", weight: 0.05 },
  ],
  reputation: { national: 42, league: 35 },
  euEea: true,
  physique: { height: 184 },
  names: { given: sources("lithuanian=1"), family: sources("lithuanian=1") },
  nationality: {
    // Dual citizenship is only permitted in exceptional cases (Law on Citizenship); only one nationality is recorded.
    multipleRate: 0.2,
    tripleRate: 0.03,
    bornAbroadRate: 0.07,
    diasporaPull: 0.35,
    links: [
      ...links("crossBorder", "PL:4 EN:1.5 IE:1.5 NO:0.8 DE:0.6 SE:0.4 ES:0.4"),
      ...links("postSoviet", "RU:3.5 BY:2 UA:1.5 LV:1 EE:0.3"),
      ...links("americas", "US:0.8"),
    ],
    citizenship: { dual: "restricted" },
  },
  cities: {
    major: cityRows(`
Vilnius|large|Vilnius|3|Antakalnis,Žirmūnai,Šnipiškės,Naujamiestis,Fabijoniškės,Karoliniškės,Lazdynai,Pašilaičiai
Kaunas|medium|Kaunas|2|Šilainiai,Dainava,Aleksotas,Žaliakalnis,Petrašiūnai
Klaipėda|medium|Klaipėda|1
Šiauliai|small|Šiauliai|1
Panevėžys|small|Panevėžys|1
Alytus|small|Alytus|1
Marijampolė|small|Marijampolė|1
Mažeikiai|town|Telšiai|1
Jonava|town|Kaunas|1
Utena|town|Utena|1
Kėdainiai|town|Kaunas|1
Telšiai|town|Telšiai|1
Tauragė|town|Tauragė|1
Ukmergė|town|Vilnius|1
Visaginas|town|Utena|1
Palanga|town|Klaipėda|1
Plungė|town|Telšiai|1
Kretinga|town|Klaipėda|1
Šilutė|town|Klaipėda|1
Radviliškis|town|Šiauliai|1
Gargždai|town|Klaipėda|1
Druskininkai|town|Alytus|1
Rokiškis|town|Panevėžys|1
Biržai|town|Panevėžys|1
Elektrėnai|town|Vilnius|1
Jurbarkas|town|Tauragė|1
Garliava|town|Kaunas|1
Vilkaviškis|town|Marijampolė|1
Raseiniai|town|Kaunas|1
Anykščiai|town|Utena|1
Trakai|town|Vilnius|1
Kelmė|town|Šiauliai|1
`),
    extra: { max: 120 },
  },
  football: {
    leagues: [
      {
        tier: 1,
        name: "A lyga",
        shortName: "A lyga",
        size: 10,
        status: "semi-professional",
        reputation: 35,
        roundRobins: 4,
        clubs: {
          reputation: span(38, 27),
          giants: { count: 1, top: 46, bottom: 46 },
          capacity: span(6_000, 800),
          facilities: span(55, 26),
          academy: span(52, 26),
          wageBill: span(3_000_000, 250_000),
          transferBudget: span(250_000, 5_000),
          foreignShare: 0.3,
          squadSize: [25, 27],
        },
      },
    ],
    movement: [],
    cups: [
      { kind: "national", name: "LFF taurė", legs: 1, neutralFinal: true, continental: true },
      { kind: "super", name: "LFF Supertaurė", participants: ["champion", "cup-winner"] },
    ],
    youth: {
      U19: { divisions: [division("LFF U19 lyga", [1, 1])] },
      U17: { divisions: [division("LFF U17 lyga", [1, 1])] },
    },
    reserves: { mode: "none" },
    clubNaming: {
      templates: templates(`
FK {city}|6
FC {city}|1.5
FA {city}|0.6
SK {city}|0.6
`),
      founded: { top: [1947, 2005], bottom: [1960, 2019] },
      shortName: "city",
      colors: ["#00843D", "#FDB913", "#C8102E", "#FFFFFF", "#1B458F", "#000000"],
    },
    importSources: codes(
      "UA:1.5 BY:1 RU:0.6 LV:1 EE:0.5 PL:0.5 GE:0.5 BR:1.2 NG:1 GH:0.8 SN:0.8 CI:0.6 CM:0.5 JP:0.6 ES:0.6 PT:0.5 FR:0.4 RS:0.5 HR:0.3 MD:0.3 CO:0.4 US:0.3 KZ:0.2 AR:0.3",
    ),
    coefficients: { association: [1.625, 1.75, 2.375, 1.125, 1.375], season2025: 1.125 },
  },
};

export const UEFA_NORTH: CatalogFileData = {
  file: "uefa-north",
  nations: [
    ENGLAND,
    WALES,
    SCOTLAND,
    NORTHERN_IRELAND,
    IRELAND,
    ICELAND,
    FAROE_ISLANDS,
    NORWAY,
    SWEDEN,
    DENMARK,
    FINLAND,
    ESTONIA,
    LATVIA,
    LITHUANIA,
  ],
  namePools: [
    ENGLISH,
    SCOTTISH,
    WELSH,
    ULSTER,
    IRISH,
    ICELANDIC,
    FAROESE,
    NORWEGIAN,
    SWEDISH,
    DANISH,
    FINNISH,
    FINLAND_SWEDISH,
    ESTONIAN,
    ESTONIAN_RUSSIAN,
    LATVIAN,
    LATVIAN_RUSSIAN,
    LITHUANIAN,
  ],
};

/**
 * Real club names (2025/26 modeled tiers plus well-known others) that generated clubs must not reproduce (decision 5).
 * Compare case- and diacritic-insensitively, treating a leading "AFC "/"FC " and a trailing " FC"/" AFC" as optional.
 * TODO(Lead-core): wire into the generator's name retry, ideally as ClubNamingSpec.reserved.
 */
export const UEFA_NORTH_REAL_CLUB_NAMES: Readonly<Record<string, readonly string[]>> = {
  EN: list(
    "Sheffield FC|Coventry United|Coventry Sphinx|Leeds City|Newcastle Town|Newcastle Benfield|Newcastle Blue Star|Bristol Manor Farm|Liverpool Ramblers|Manchester Central|London Tigers|AFC Totton|Aveley|Hednesford Town|Arsenal|Aston Villa|Bournemouth|Brentford|Brighton & Hove Albion|Brighton Albion|Burnley|Chelsea|Crystal Palace|Everton|Fulham|Leeds United|Liverpool|Manchester City|Manchester United|Newcastle United|Nottingham Forest|Sunderland|Tottenham Hotspur|West Ham United|Wolverhampton Wanderers|Birmingham City|Blackburn Rovers|Bristol City|Charlton Athletic|Coventry City|Derby County|Hull City|Ipswich Town|Leicester City|Middlesbrough|Millwall|Norwich City|Oxford United|Portsmouth|Preston North End|Queens Park Rangers|Sheffield United|Sheffield Wednesday|Southampton|Stoke City|Watford|West Bromwich Albion|Wimbledon|Barnsley|Blackpool|Bolton Wanderers|Bradford City|Burton Albion|Doncaster Rovers|Exeter City|Huddersfield Town|Leyton Orient|Lincoln City|Luton Town|Mansfield Town|Northampton Town|Peterborough United|Plymouth Argyle|Port Vale|Reading|Rotherham United|Stevenage|Stockport County|Wigan Athletic|Wycombe Wanderers|Accrington Stanley|Barnet|Barrow|Bristol Rovers|Bromley|Cambridge United|Cheltenham Town|Chesterfield|Colchester United|Crawley Town|Crewe Alexandra|Fleetwood Town|Gillingham|Grimsby Town|Harrogate Town|Milton Keynes Dons|Notts County|Oldham Athletic|Salford City|Shrewsbury Town|Swindon Town|Tranmere Rovers|Walsall|Aldershot Town|Altrincham|Boreham Wood|Boston United|Brackley Town|Braintree Town|Carlisle United|Eastleigh|Halifax Town|Forest Green Rovers|Gateshead|Hartlepool United|Morecambe|Rochdale|Scunthorpe United|Solihull Moors|Southend United|Sutton United|Tamworth|Truro City|Wealdstone|Woking|Yeovil Town|York City|Fylde|Alfreton Town|Bedford Town|Buxton|Chester|Chorley|Curzon Ashton|Darlington|Hereford|Kidderminster Harriers|King's Lynn Town|Leamington|Macclesfield|Macclesfield Town|Marine|Oxford City|Peterborough Sports|Radcliffe|Scarborough Athletic|South Shields|Southport|Spennymoor Town|Telford United|Worksop Town|Bath City|Chelmsford City|Chesham United|Chippenham Town|Dagenham & Redbridge|Dorking Wanderers|Eastbourne Borough|Ebbsfleet United|Enfield Town|Farnborough|Hampton & Richmond Borough|Hemel Hempstead Town|Hornchurch|Horsham|Maidenhead United|Maidstone United|Salisbury|Slough Town|Tonbridge Angels|Torquay United|Weston-super-Mare|Worthing|Welling United|Dover Athletic|Weymouth|Havant & Waterlooville|St Albans City|Dartford|Chatham Town|Bury|Stafford Rangers|Nuneaton Borough|Kettering Town|Rushden & Diamonds|Stalybridge Celtic|Hyde United|Northwich Victoria|Witton Albion|Workington|Blyth Spartans|Gainsborough Trinity|Worcester City|Gloucester City|Cheshunt|Hitchin Town|Banbury United|Stourbridge|Rugby Town|Redditch United|Leek Town|Marlow|Winchester City|Bognor Regis Town|Chichester City|Harlow Town|Kendal Town|Consett|Canterbury City|Ashford United|Folkestone Invicta|Hastings United|Basingstoke Town|Poole Town|Aylesbury United|Taunton Town|Farsley Celtic|Guiseley|Stockton Town|Warrington Town|Bishop's Stortford|Newcastle Town|Cambridge City|Hinckley|Loughborough Dynamo|Stafford Town|Tooting & Mitcham United|Dulwich Hamlet|Kingstonian|Hendon|Harrow Borough|Croydon|Walthamstow|Clapton|Barking|Leyton|Woolwich Arsenal|Newton Heath",
  ),
  SCO: list(
    "Glasgow Rangers|Rangers FC|Glasgow Celtic|Celtic Glasgow|Glasgow City|FC Edinburgh|Edinburgh City|Edinburgh United|Edinburgh University|Glasgow University|Aberdeen University|Glasgow Academical|Edinburgh Academical|Glasgow Perthshire|Dundee North End|Dundee Violet|Inverness Thistle|Inverness Caledonian|Aberdeen|Celtic|Dundee|Dundee United|Falkirk|Heart of Midlothian|Hibernian|Kilmarnock|Livingston|Motherwell|Rangers|St Mirren|Airdrieonians|Arbroath|Ayr United|Dunfermline Athletic|Greenock Morton|Partick Thistle|Queen's Park|Raith Rovers|Ross County|St Johnstone|Alloa Athletic|Cove Rangers|East Fife|Hamilton Academical|Inverness Caledonian Thistle|Kelty Hearts|Montrose|Peterhead|Queen of the South|Stenhousemuir|Annan Athletic|Clyde|Dumbarton|East Kilbride|Edinburgh City|Elgin City|Forfar Athletic|Spartans|Stirling Albion|Stranraer|Albion Rovers|Berwick Rangers|Brechin City|Cowdenbeath|Gretna|Clydebank|Bonnyrigg Rose|Linlithgow Rose|Fraserburgh|Buckie Thistle|Brora Rangers|Formartine United|Huntly|Forres Mechanics|Nairn County|Cumbernauld Colts|Broxburn Athletic|Musselburgh Athletic|Penicuik Athletic|Irvine Meadow|Kilwinning Rangers|Largs Thistle|Auchinleck Talbot|Pollok|Darvel|Leith Athletic|Third Lanark|Dunbar United|Wishaw|Bellshill Athletic|Inverurie Loco Works|Stonehaven|Girvan|Cumnock Juniors",
  ),
  WAL: list(
    "The New Saints|Connah's Quay Nomads|Penybont|Bala Town|Caernarfon Town|Barry Town United|Barry Town|Cardiff Metropolitan University|Haverfordwest County|Flint Town United|Colwyn Bay|Llanelli Town|Briton Ferry Llansawel|Aberystwyth Town|Newtown|Cefn Druids|Airbus UK Broughton|Bangor City|Bangor 1876|Rhyl|Carmarthen Town|Port Talbot Town|Prestatyn Town|Merthyr Town|Pontypridd United|Swansea City|Cardiff City|Wrexham|Newport County|Llandudno|Holywell Town|Ammanford|Cwmbran Town|Cwmbran Celtic|Afan Lido|Taff's Well|Trefelin|Goytre United|Denbigh Town|Ruthin Town|Mold Alexandra|Buckley Town|Porthmadog|Caerau Ely|Llanidloes Town|Guilsfield|Holyhead Hotspur|Llangefni Town|Conwy Borough|Penrhyncoch|Abergavenny Town|Monmouth Town|Chepstow Town|Pontypool Town|Penarth Town|Pembroke Borough|Milford United|Cardigan Town|Lampeter Town|Welshpool Town|Newport YMCA|Swansea University|Maesteg Park|Ton Pentre|Aberdare Town|Llangollen Town|Gresford Athletic",
  ),
  NIR: list(
    "Linfield|Glentoran|Cliftonville|Crusaders|Larne|Coleraine|Ballymena United|Glenavon|Portadown|Dungannon Swifts|Carrick Rangers|Bangor|Loughgall|Newry City|Warrenpoint Town|Institute|Ards|Harland & Wolff Welders|Dundela|Ballinamallard United|Annagh United|Knockbreda|Limavady United|Armagh City|Ballyclare Comrades|Queen's University|Derry City|Belfast Celtic|Lisburn Distillery|Ballymoney United|Newington|Moyola Park|Tobermore United|Banbridge Town|Lurgan Celtic|Lurgan United|Dollingstown|Enniskillen Rangers|Omagh Town|Strabane Athletic|Portstewart|Kilkeel Athletic|Newcastle|Lisburn Rangers|Donegal Celtic|Brantwood|Crumlin Star|Glebe Rangers|Downpatrick|Cookstown Olympic",
  ),
  IE: list(
    "Shamrock Rovers|Shelbourne|St Patrick's Athletic|Bohemians|Derry City|Drogheda United|Galway United|Sligo Rovers|Waterford|Cork City|Dundalk|Athlone Town|Bray Wanderers|Cobh Ramblers|Finn Harps|Kerry|Longford Town|Treaty United|Wexford|UCD|Limerick|Monaghan United|Kildare County|Dublin City|Kilkenny City|Home Farm|St Francis|Cabinteely|Mervue United|Salthill Devon|Waterford United|Sporting Fingal|Limerick City|Cork Hibernians|Cork Celtic|Cork Athletic|Drumcondra|Transport|Tralee Dynamos|Mullingar Athletic|Letterkenny Rovers|Castlebar Celtic|Westport United|Ennis Town|Greystones United|Swords Celtic|Tuam Celtic|Ballina Town|Arklow Town|Newbridge Town|Maynooth Town|Birr Town|Trim Celtic|Carlow",
  ),
  IS: list(
    "Víkingur|Breiðablik|Valur|Stjarnan|KR|FH|ÍA|Fram|KA|Þór|Vestri|ÍBV|Afturelding|Keflavík|Grindavík|Selfoss|Njarðvík|Fylkir|Fjölnir|Leiknir|Þróttur|Haukar|Grótta|HK|ÍR|Víkingur Ólafsvík|Völsungur|Dalvík/Reynir|Ægir|Magni|Höttur|Tindastóll|KFA|Kári|Víðir|Reynir Sandgerði|Hamar|Sindri|UMF Selfoss|UMF Grindavík|UMF Njarðvík|UMF Afturelding|Keflavík ÍF|ÍB Vestmannaeyja|ÍB Keflavík|KF Fjallabyggð|UMF Tindastóll",
  ),
  NO: list(
    "Molde FK|Rosenborg BK|SK Brann|Viking FK|FK Bodø/Glimt|Tromsø IL|Lillestrøm SK|Vålerenga Fotball|Strømsgodset IF|Sarpsborg 08 FF|Fredrikstad FK|Sandefjord Fotball|Kristiansund BK|FK Haugesund|Odds BK|Stabæk Fotball|Aalesunds FK|Hamarkameratene|Bryne FK|KFUM Oslo|IK Start|Mjøndalen IF|Sogndal Fotball|Ranheim Fotball|Raufoss IL|Kongsvinger IL|Åsane Fotball|Egersunds IK|FC Lyn Oslo|Moss FK|Levanger FK|Skeid Fotball|IL Hødd|Tromsdalen UIL|Florø SK|Kjelsås Fotball|Notodden FK|FK Jerv|Alta IF|Arendal Fotball|Grorud IL|Strømmen IF|Sandnes Ulf|Nest-Sotra|Stjørdals-Blink|Hønefoss BK|Bærum SK|Asker Fotball|Brattvåg IL|Follo FK|Lørenskog IF|Eidsvold Turn|Nardo FK|Frigg Oslo FK|Ullern IF|Fana IL|Byåsen IL|Tiller IL|Strindheim IL",
  ),
  SE: list(
    "Malmö FF|IFK Göteborg|IFK Norrköping|Kalmar FF|Västerås SK|Örebro SK|Umeå FC|Degerfors IF|Sandvikens IF|Östersunds FK|IFK Värnamo|Norrby IF|Hammarby IF|Djurgårdens IF|AIK|BK Häcken|IF Elfsborg|GAIS|Örgryte IS|IK Sirius|Halmstads BK|Helsingborgs IF|Trelleborgs FF|Falkenbergs FF|Varbergs BoIS|Landskrona BoIS|GIF Sundsvall|Utsiktens BK|IK Oddevold|IK Brage|Gefle IF|Jönköpings Södra IF|Mjällby AIF|IF Brommapojkarna|Östers IF|Åtvidabergs FF|Syrianska FC|Assyriska FF|Dalkurd FF|AFC Eskilstuna|IFK Eskilstuna|Skövde AIK|Ljungskile SK|Qviding FIF|Enköpings SK|IFK Luleå|IFK Uddevalla|IFK Malmö|IFK Hässleholm|IFK Kristianstad|IFK Timrå|Motala AIF|Karlstad BK|Västerås IK|Linköpings FC|Linköping City|Nyköpings BIS|Piteå IF|Lunds BK|Ängelholms FF|Kristianstads FF|Täby FK|Södertälje FK|Alingsås IF|Lidköpings FK|FC Trollhättan|Falu FK|Kungsbacka IF|Ystads IF|Oskarshamns AIK|Hudiksvalls FF|Karlskrona AIF|FC Rosengård|Carlstad United|Hässleholms IF|Torslanda IK|Vasalunds IF|Enskede IK|Husqvarna FF|Gamla Upsala SK|IF Vesta|Upsala IF|Skiljebo SK|Rynninge IK|Karlslunds IF|BK Forward|IK Tord|IK Sleipner|IK Frej|Morön BK|Lindsdals IF|Bergnäsets AIK|Frösö IF|Nättraby GoIF|Sölvesborgs GoIF|IS Halmia|Friska Viljor FC|Syrianska Kerburan|Assyriska BK|Brynäs IF|Sandvikens AIK|Kungsbacka BI|Holmsunds IK|Åhus IF|Lyckeby GoIF|Råslätts SK|Gottsunda IK|IFK Umeå|Umeå IK|Tenhults IF|Bankeryds SK|Dalby GIF|Linero IF",
  ),
  DK: list(
    "FC København|Brøndby IF|Aarhus GF|Odense BK|Aalborg BK|Randers FC|Vejle BK|Viborg FF|Silkeborg IF|Lyngby BK|Esbjerg fB|Hobro IK|AC Horsens|FC Nordsjælland|FC Midtjylland|SønderjyskE|FC Fredericia|Hvidovre IF|Kolding IF|HB Køge|Næstved BK|B.93|Akademisk Boldklub|Hillerød Fodbold|FC Roskilde|FC Helsingør|Fremad Amager|Vendsyssel FF|Skive IK|Nykøbing FC|Thisted FC|Holbæk B&I|Middelfart Boldklub|FC Fyn|Kolding FC|Brønshøj BK|Boldklubben Frem|Køge BK|Herfølge BK|FC Vestsjælland|Slagelse B&I|Frederiksberg Boldklub|Glostrup FK|Taastrup FC|Nørresundby FB|Brabrand IF|Viby IF|Haderslev FK|Varde IF|Svendborg fB|Aarhus Fremad|Ikast FS|Herning Fremad|Avarta|Ishøj IF|Holstebro BK|Hjørring IF|Frederikshavn fI|Dalum IF|Vejgaard B|Jerne IF|Vorup FB|Erritsø GIF|Aalborg Freja|Randers Freja|KFUM Roskilde|Odense KFUM|AB Tårnby|Fremad Valby|Fremad Amager|Nørrebro United|Kjøbenhavns Boldklub|BK Skjold|Tarup-Paarup IF|Hasseris IF|Spættrup IF|Tjæreborg IF|Kristrup BK|Seest IF|Stensballe IK|Bredballe IF|Himmelev-Veddelev BK|Gullestrup IF|Virklund IF|Taulov IF|Overlund GIF|Ølby IF|Tvis IF|Hedehusene IK|Vanløse IF|Valby BK|Amager FF|Østerbro IF|Frederiksberg IF|Sundby BK|Aarhus FF|Brabrand IF|Viby IF|Højbjerg IF|Risskov IF",
  ),
  FI: list(
    "HJK|KuPS|FC Inter Turku|FC Honka|Ilves|FC Ilves|SJK|FC Haka|VPS|IFK Mariehamn|AC Oulu|FC Oulu|FF Jaro|KTP|FC KTP|FC Lahti|RoPS|JJK|TPS|MyPa|FC Jazz|IF Gnistan|Ekenäs IF|PK-35|SalPa|KPV|TPV|FC Espoo|FC Hämeenlinna|FC Kuusankoski|FC Vaasa|FC Kiffen|Tampere United|IFK Vasa|FC Kajaani|AC Kajaani|Klubi 04|HIFK|KäPa",
  ),
  EE: list(
    "FC Flora|FCI Levadia|Nõmme Kalju|Paide Linnameeskond|JK Narva Trans|FC Kuressaare|Tartu JK Tammeka|Harju JK Laagri|Pärnu JK Vaprus|Tallinna Kalev|Viljandi JK Tulevik|FC Elva|Viimsi JK|Tartu JK Welco|Maardu Linnameeskond|Pärnu Linnameeskond|Rakvere JK Tarvas|Kohtla-Järve JK Järve|Tallinna FC Legion|Keila JK|Tartu FC Santos|FC Tallinn|Nõmme United|Tallinna FC Infonet|JK Sillamäe Kalev|FC TVMK|Saue JK|Tabasalu JK|Põlva FC Serviti|FC Otepää",
  ),
  LV: list(
    "FK RFS|Riga FC|FK Auda|FK Liepāja|Valmiera FC|BFC Daugavpils|FS Metta|FK Tukums 2000|Grobiņas SC|FK Jelgava|FK Ventspils|Skonto FC|FK Jūrmala|FK Spartaks Jūrmala|FC Daugava|FK Daugava Rīga|FK Liepājas Metalurgs|JDFS Alberts|SK Super Nova|FK Dinamo Rīga|FK Ogre|Rīgas FS",
  ),
  LT: list(
    "FK Žalgiris|FK Kauno Žalgiris|FC Hegelmann|FK Sūduva|FK Panevėžys|FK Banga|FK Riteriai|FK Dainava|FA Šiauliai|FK Šiauliai|FK Jonava|FK Atlantas|FK Ekranas|FK Utenis|FK Tauras|FK Nevėžis|FK Mažeikiai|FK Kruoja|FK Palanga|FK Minija|FK Babrungas|FK Alytus|FK Klaipėda|FK Vilnius|FK Trakai|FK Stumbras|FBK Kaunas|FK Kaunas|FK Vėtra|FK Inkaras|FK Džiugas|FK Granitas|FK Lietava",
  ),
};
