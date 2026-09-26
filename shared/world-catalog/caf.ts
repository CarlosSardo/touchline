import type {
  CatalogFileData,
  CitizenshipRule,
  CitySize,
  CitySpec,
  ClubNameTemplate,
  DomesticFootballSpec,
  FakerNameLocale,
  HeritageLink,
  LeagueTierSpec,
  MigrationContext,
  NamePool,
  NationSpec,
  WeightedCode,
  WeightedLanguage,
  WeightedNameSource,
  YouthDivisionSpec,
  YouthSpec,
} from "./types.ts";

// Owner: catalog author "caf" — all 54 CAF members, 19 with leagues (validate.ts CATALOG_ASSIGNMENT).
// 2025/26 structures, money in GBP. Only NG and CD model two tiers; every other league nation is a single tier
// (no movement). No CAF nation has B-teams: reserve and U23 sides play outside the modeled pyramid.
// Coefficient seeds keep the order of the official CAF 5-year ranking (2021..2025, oldest first), scaled.
// North African pools are romanized (French-style transliteration as used on passports and team sheets).

/** Names are "|"-separated when any of them contains a space, otherwise whitespace-separated. */
const list = (text: string) =>
  (text.includes("|") ? text.split("|") : text.split(/\s+/))
    .map((entry) => entry.trim())
    .filter(Boolean);
const pool = (name: string, given: string, family: string): NamePool => ({
  id: `caf/${name}`,
  ...(given.trim() ? { given: list(given) } : {}),
  ...(family.trim() ? { family: list(family) } : {}),
});
const src = (name: string, weight = 1): WeightedNameSource => ({ source: `pool:caf/${name}`, weight });
const faker = (locale: FakerNameLocale, weight = 1): WeightedNameSource => ({
  source: `faker:${locale}`,
  weight,
});
/** "FR:12 BE:6" → weighted nation codes. */
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
const restricted: CitizenshipRule = { dual: "restricted" };
const allowed: CitizenshipRule = { dual: "allowed" };
const partners = (codes: string): CitizenshipRule => ({ dual: "partners", partners: list(codes) });
/** Districts are "|"-separated because some contain spaces. */
const city = (
  name: string,
  size: CitySize,
  region: string,
  maxClubs?: number,
  districts?: string,
): CitySpec => ({
  name,
  size,
  region,
  ...(maxClubs ? { maxClubs } : {}),
  ...(districts ? { districts: districts.split("|") } : {}),
});
/** "{city} FC:2; Stade {city}:1" → weighted club-name templates (patterns never contain ":"). */
const templates = (spec: string): ClubNameTemplate[] =>
  spec
    .split(";")
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((entry) => {
      const at = entry.lastIndexOf(":");
      return { pattern: entry.slice(0, at).trim(), weight: Number(entry.slice(at + 1)) };
    });
const division = (
  name: string,
  parentTiers: [number, number] = [1, 1],
  groupSize?: number,
  groupNames?: string,
): YouthDivisionSpec => ({
  name,
  parentTiers,
  ...(groupSize ? { groupSize } : {}),
  ...(groupNames ? { groupNames: groupNames.split("|") } : {}),
});
const youth = (
  u19: YouthDivisionSpec[],
  u17: YouthDivisionSpec[],
  cups: { u19?: string; u17?: string } = {},
): YouthSpec => ({
  U19: { divisions: u19, ...(cups.u19 ? { cup: { name: cups.u19 } } : {}) },
  U17: { divisions: u17, ...(cups.u17 ? { cup: { name: cups.u17 } } : {}) },
});
/** Single-tier nation: one U19 and one U17 division with the same group layout. */
const youthSingle = (
  u19: string,
  u17: string,
  groupSize?: number,
  groupNames?: string,
  cups: { u19?: string; u17?: string } = {},
): YouthSpec =>
  youth([division(u19, [1, 1], groupSize, groupNames)], [division(u17, [1, 1], groupSize, groupNames)], cups);
/** One modeled tier: no movement, reserve teams below the modeled pyramid. */
const singleTier = (
  league: LeagueTierSpec,
  rest: Omit<DomesticFootballSpec, "leagues" | "movement" | "reserves">,
): DomesticFootballSpec => ({ leagues: [league], movement: [], reserves: { mode: "none" }, ...rest });
/** CAF member without an own league: home-based pool plus players at foreign clubs. */
const homeNation = (
  spec: Omit<NationSpec, "iso2" | "confederation" | "continent" | "euEea" | "football" | "hostedAbroad">,
): NationSpec => ({ iso2: spec.code, confederation: "CAF", continent: "AF", euEea: false, ...spec });

// ------------------------------------------------------------------ name pools (romanized, Latin script only)

const MOROCCAN = pool(
  "moroccan",
  `Youssef Achraf Hakim Sofyan Azzedine Bilal Wissam Ilias Abdessamad Brahim Munir Ayoub Amine Hamza Ismail Anas
   Oussama Nabil Mehdi Soufiane Walid Yassine Reda Adil Zakaria Abderrazak Abdelilah Abdelkarim Abdellatif Abdelhak
   Abdelaziz Abderrahim Abdelmajid Jawad Hicham Tarik Omar Othmane Mohamed Mouad Marouane Nordin Yunes Chadi Selim
   Amir Yahya Houssam Driss Rachid Mustapha Khalid Karim Aziz Hassan Said Salaheddine Badr Imad Ibrahim Issam Jamal
   Kamal Larbi Mounir Mourad Nourdine Rayane Redouane Samir Taha Tawfik Younes Zouhair Abdelhamid Faycal Hatim Anouar
   Wail Saad Aymane Mohcine Hamid Bouchaib Abdelfattah Ilyas Mohammed Oualid Ayman Yasser Zaid Najib Jaouad
   Abdeljalil Saber Chakib Adnane Abdelmounaim Ismael Adam`,
  `Bennani|El Amrani|Idrissi|Ait Lahcen|Berrada|Benali|Alaoui|El Mansouri|Lahlou|Belhaj|Haddou|Bouziane|Amrani|
   Zerouali|Bouzid|Lamrani|El Idrissi|Benjelloun|Tazi|El Fassi|Kettani|Sqalli|Chraibi|Bensouda|Guessous|Lazrak|
   Benkirane|El Ouazzani|Chakir|Chafik|El Haddad|Bakkali|El Khattabi|Riffi|Boukhari|Naciri|Filali|Sebti|Zniber|
   Alami|Hajji|El Hajjaji|Moussaoui|Ouahbi|El Ghazi|Benzakour|Tahiri|El Yazidi|Rahmouni|Belkadi|Boussaid|Kabbaj|
   Laraki|Bouhlal|El Bouanani|Haddadi|Ennaji|Bennis|El Morabit|Boukhriss|Chakla|Daoudi|El Maadani|El Karti|
   Zaroury|Sabiri|Hadraoui|Jabrane|El Kajoui|Tagnaouti|Bouhra|El Motie|Nahiri|Hilali|Dari|Benoun|Harkass|Hafidi|
   Belammari|Fettouhi|Sabir|Badri|Lamlioui|Fouzair|Rahimi|El Barkaoui|Bencharki|Zemraoui|El Hachimi|Bourkadi|
   El Harrak|El Allaoui|Bouabid|Benchekroun|Chergui|Soussi|Marrakchi|Doukkali|Slaoui|Meknassi|Fassi Fihri|
   Boutaleb|Aberkane|Azzouzi|El Hamdaoui|El Bakkali|Bourass|Kaddouri|El Asri|Bouazza|Chahid|El Kasmi|Jebbari|
   Rhaimi|Mokhtari|Bahja|El Ouardi|Naji`,
);
// Amazigh (Chleuh, Riffian, Tamazight and Kabyle) names, shared by MA, DZ and LY.
const AMAZIGH = pool(
  "amazigh",
  `Massinissa Yuba Idir Amayas Aksil Anir Ghiles Koceila Aksel Juba Lounes Amokrane Arezki Mouloud Ferhat Hocine
   Mohand Slimane Yanis Mokrane Madjid Tahar Rabah Belaid Lahcen Lhoussaine Mbarek Hammou Moha Amnay Anzar Aghilas
   Amastan Bassou Assou Mimoun Abdeslam Ouali Aissa Akli Ameziane Salah`,
  `Ait Ahmed|Ait Benali|Ait Bouhou|Ait Moussa|Ait Taleb|Ait Ali|Ait Said|Ait Hammou|Ait Idir|Ait Mouhoub|Ait Kaci|
   Ait Yahia|Ait Oufella|Oubella|Oulhaj|Ouhadi|Amghar|Amzil|Bouhali|Aboulfath|Assoufi|Oukhattou|Ouchen|Oudra|
   Ourahou|Oukidja|Ouali|Amellal|Meziane|Aouchiche|Hamouche|Ighil|Amrouche|Oubaha|Oumlil|Outaleb|Akhrif|Afellah|
   Boukhalfa|Iguider|Ouazzani|Ait Nouri|Belkacem|Mokrani|Haddadou|Idirene|Tamazouzt|Ouarab|Laaziz|Ounas`,
);
const EGYPTIAN = pool(
  "egyptian",
  `Omar Ahmed Mahmoud Mostafa Youssef Karim Ibrahim Hossam Tarek Amr Mohamed Hassan Ali Khaled Walid Hazem Hany
   Ayman Ashraf Sherif Emad Essam Hamdy Magdy Samir Sayed Taher Tamer Wael Yasser Ziad Abdallah Abdelrahman Akram
   Alaa Amir Anwar Bassem Fady Fathy Gamal Hamza Haytham Hesham Hussein Islam Kamal Marwan Medhat Mohanad Mohsen Nabil
   Nasser Osama Ramadan Ramy Reda Saad Saber Salah Shady Shawky Tawfik Yehia Zakaria Seif Adham Moamen Kareem Mahdy
   Abdelaziz Adel Atef Emam Fawzy Galal Ghanem Hamed Hatem Helmy Hosny Mazen Moataz Mounir Nader Nour Radwan Sabry
   Samy Shehab Sobhi Yassin Zein`,
  `Hassan|Ibrahim|Mahmoud|El Sayed|Fathy|Abdelrahman|Gamal|Farouk|Mansour|Abdallah|Nasser|Hamdy|Abdelaziz|
   Abdelhamid|Abdelmoneim|Abdelghani|Abdelwahab|Abou Zeid|Abou Ali|Ashour|Attia|Badawy|Bakr|Fawzy|Fouad|Galal|
   Ghoneim|Hafez|Hegazy|Hosny|Kamal|Khalil|Lotfy|Mahrous|Metwally|Mohsen|Morsy|Mostafa|Mounir|Nabil|Ramadan|Ragab|
   Rizk|Saad|Sabry|Salem|Saleh|Shaaban|Shehata|Soliman|Tawfik|Wahba|Youssef|Zaki|Zidan|Zakaria|El Masry|El Gohary|
   El Naggar|El Shahat|El Sheikh|Emam|Fekry|Hamed|Hamouda|Hendawy|Hussein|Kandil|Mekky|Magdy|Osman|Radwan|Rabie|
   Refaat|Samy|Sharaf|Shoukry|Taha|Tarek|Yehia|Zaher|Adel|Anwar|Atef|Ezzat|Fahmy|Farag|Gaber|Gad|Hanafy|Helmy|
   Ismail|Kotb|Maher|Mamdouh|Marei|Nour|Rashad|Sadek|Sedky|Shawky|Wagdy|Yassin|Zein|El Garhy|Abdel Ghaffar|
   Abdel Kader|El Tabei|Salah|Omar|Ali|Mohamed|Ahmed|Khaled|Darwish|Dessouky|Eid|El Badry|El Beltagy|El Deeb|
   El Far|El Hadidy|El Kholy|El Maghraby|El Nahas|El Said|El Sherbiny|El Shazly|Ghazal|Haggag|Kassem|Lashin|
   Mazloum|Negm|Sallam|Seoudi|Tolba`,
);
const ANGLOPHONE = pool(
  "anglophone",
  `Emmanuel Samuel Daniel Joseph David John Peter Isaac Moses Godfrey Collins Brian Kelvin Prince Blessing Gift Victor
   Michael Paul Stephen Richard Francis Anthony Charles Christopher Dennis Eric Felix Frank George Godwin Henry James
   Jonathan Joshua Justice Kingsley Lawrence Martin Nicholas Patrick Philip Raphael Robert Simon Solomon Sunday Thomas
   Timothy William Abraham Benjamin Bright Caleb Clement Cyril Desmond Ebenezer Edmund Elijah Enoch Ezekiel Festus
   Gabriel Gideon Harrison Innocent Jacob Jerome Kenneth Lucky Matthew Nathaniel Obed Oliver Precious Reuben Stanley
   Success Theophilus Wisdom Alex Andrew Evans Ernest Fred Goodness Hope Jerry Joel Lloyd Marvin Nelson Ronald Terry`,
  "",
);
const YORUBA = pool(
  "yoruba",
  `Oluwaseun Olamide Babatunde Olumide Adebayo Tunde Olufemi Adekunle Ayodele Damilola Oluwatobi Tobi Segun Kayode
   Kehinde Taiwo Femi Gbenga Wale Yinka Seun Tosin Ayomide Abiodun Abayomi Akinwale Bolaji Dapo Deji Dele Kunle
   Lanre Niyi Rotimi Sola Tayo Wasiu Ademola Adewale Afolabi Akin Ayo Bayo Dotun Ibukun Jide Kolawole Mayowa Muyiwa
   Oladele Olawale Opeyemi Temitope Tomiwa Idowu Kazeem Babajide Oluwafemi Olalekan Oladapo Adeniyi Adedayo Sodiq
   Rasheed Ismaila Lukman Waheed Akeem Rilwan Saheed Taofeek Kamoru Fatai Monsuru`,
  `Adeyemi Akinola Ogunleye Adebisi Afolayan Oladipo Adeleke Ojo Adewale Akinyemi Alade Aluko Ayeni Bamidele Fashola
   Fagbemi Ilori Kolade Lawal Makinde Ogunbanjo Ogundipe Oyelaran Oyewole Oyinlola Oladele Olatunji Olaniyan Oluwole
   Omotayo Onifade Osho Popoola Sanni Shittu Sowemimo Adegoke Ajayi Akande Alabi Aremu Balogun Durojaiye Fadipe
   Idowu Ige Jegede Kareem Ladipo Odunlami Ogunbiyi Olagunju Olajide Omoniyi Onasanya Oyebanjo Salako Adeniyi
   Adesanya Afolabi Babatunde Adekunle Ogundele Olowookere Oyedele Akinwumi Adesina Fasasi Okunola Aina Ajibola
   Ayinde Oyeniyi Adebayo Oyelowo Ogunsanya Adelabu Akintola`,
);
const IGBO = pool(
  "igbo",
  `Chinedu Chukwudi Ifeanyi Emeka Obinna Nnamdi Uche Chidi Chibuike Chijioke Chimezie Chinonso Chisom Chukwuemeka
   Ebuka Ejike Ekene Ikechukwu Kelechi Nonso Obiora Okechukwu Onyekachi Somtochukwu Tochukwu Uchenna Udoka Ugochukwu
   Kenechukwu Ndubuisi Nnaemeka Obumneme Chidozie Chiedozie Azubuike Chigozie Ikenna Izuchukwu Onyeka Ebube
   Kosisochukwu Munachi Chukwuma Dozie Chima Tobechukwu Ifechukwu Chukwunonso`,
  `Okafor Okeke Nwosu Eze Nwankwo Obi Ibe Onyema Okonkwo Nwachukwu Okoro Nwafor Ugwu Onuoha Chukwu Nnaji Ogbu Okoye
   Anyanwu Ezeh Ike Iwu Mbah Nnadi Nwadike Nwaneri Nwogu Obiefuna Odo Ogbonna Onwuka Osuji Uzoma Uzor Agu Ani Asogwa
   Chukwuma Egwu Ekwueme Ezenwa Iheanacho Mbanefo Nwaeze Nweke Obiora Odum Ofoegbu Okolie Onah Onyeama Orji Ude
   Ugochukwu Umeh Ekeh Nwokoro Anozie Chima Ezeji Nwoye Obasi Okpara Onyekwere Ukwu Nwakaeme Emenike Onyenwe
   Nwabueze Ekwunife`,
);
const HAUSA = pool(
  "hausa",
  `Sani Ibrahim Abubakar Musa Usman Bashir Aminu Kabiru Abdullahi Ahmed Aliyu Auwal Bello Dahiru Garba Habibu Haruna
   Idris Isah Jamilu Lawal Mahmud Muhammad Mustapha Nasiru Rabiu Sadiq Salisu Shehu Sulaiman Umar Yahaya Yakubu Yusuf
   Zakari Abba Anas Gambo Hamza Ismail Kabir Mansur Nura Sagir Tijjani Umaru Zubairu`,
  `Bello Garba Abdullahi Danjuma Umar Yusuf Lawal Suleiman Abubakar Adamu Aliyu Bala Dauda Gambo Hassan Ibrahim Idris
   Isa Jibrin Kabiru Mohammed Musa Nuhu Sani Shehu Tanko Usman Yakubu Yahaya Zakari Babangida Maikudi Mairiga Mustapha
   Rabiu Salihu Sule Tukur Waziri Dikko Gumel Kurfi Madaki Dambatta Galadima Magaji Ringim Kazaure`,
);
// Edo, Ijaw, Urhobo, Itsekiri, Efik and Ibibio names of the Niger Delta and the south-south.
const NIGER_DELTA = pool(
  "niger-delta",
  `Osagie Osaze Efosa Ehis Oghenekaro Ovie Oghenetega Ejiro Efe Ebiowei Tamuno Ebi Preye Timi Tari Iniobong Aniekan
   Ubong Idongesit Mfon Nsikak Imoh Osas Ikponmwosa Eseosa Nosa Uyi Tonye Soala Boma Ekpeyong Enoabasi Ufot`,
  `Omoregie Idahosa Igbinoba Ighalo Ogbeide Obaseki Akpan Etim Ekpo Udoh Bassey Effiong Okon Inyang Umoh Essien
   Ukpong Eyo Asuquo Ita Ekanem Harry Fubara Briggs Amakiri Omokaro Agbroko Oboh Okpako Ovwigho Osayande Iyamu Aigbe
   Ehiogie Edosomwan Uwaifo Ebohon Akpobi Emuakpor Onoriode Erhahon Dikio Alagoa Ekong Udofia`,
);
const ALGERIAN = pool(
  "algerian",
  `Youcef Mehdi Riyad Sofiane Hichem Rayan Amine Islam Farid Nabil Zakaria Redouane Ismaël Aïssa Baghdad Djamel
   Rachid Karim Abdelkader Mohamed Ahmed Nadir Nassim Walid Yacine Adlène Ramy Houssem Hamza Ilyes Rafik Mourad Salim
   Mustapha Abderrahmane Abdelmoumen Adem Anis Badreddine Bilal Chemseddine Fares Faouzi Fethi Houari Ibrahim Idriss
   Khaled Lakhdar Lotfi Mokhtar Nacer Noureddine Oussama Raouf Réda Saïd Samir Tarek Yassine Zinedine Ali Bachir
   Boualem Chakib Hakim Kamel Lyes Merouane Moussa Okacha Ryad Seif Abdelhak Aymen Abdelraouf Hocine Youba Rezki
   Abdennour Brahim Chouaïb Zoubir Aimen Nazim`,
  `Benali|Belaid|Boudjemaa|Mansouri|Boukhalfa|Ait Ali|Mebarki|Saidi|Belkacem|Bouaziz|Hamidi|Meziane|Benabdallah|
   Benaissa|Benamar|Bendjelloul|Benkhelifa|Benmansour|Bensalem|Bensaid|Benyahia|Benzerga|Bouchama|Bouguerra|
   Boukerche|Boulahia|Brahimi|Chaouchi|Cherif|Derradji|Hadjadj|Hamdani|Haddad|Kaddour|Khelifi|Messaoudi|Mesloub|
   Meftah|Mokhtari|Rahmani|Saadane|Sahraoui|Soudani|Tahrat|Zitouni|Bouzidi|Belhadj|Belarbi|Bendebka|Chergui|
   Dahmani|Draoui|Meddah|Mehdaoui|Touati|Yousfi|Zaoui|Hamel|Benmoussa|Bekkouche|Chaib|Kherroubi|Madani|Laouar|
   Guenaoui|Kebaili|Khacef|Ouadah|Saidani|Tedjini|Zerrouki|Ziani|Benhamida|Boukhelifa|Aouadi|Bensaha|Guettal|
   Hamroun|Lamouchi|Rebiai|Sebbar|Tebbal|Zemmouri|Benlamri|Bekhouche|Djellit|Ferhani|Mezouar|Harbi|Laribi|
   Medjani|Ouled Ali|Saadi|Yahiaoui|Zeffane|Boudebouz|Belkhir|Hadji|Lahmar|Nadji|Guerrouche|Abid|Kheddache|
   Benchaira|Oukil`,
);
const TUNISIAN = pool(
  "tunisian",
  `Yassine Anis Wajdi Hamza Firas Aymen Alaa Bilel Nader Maher Taha Oussama Wahbi Seifeddine Ellyes Montassar Hazem
   Ghailene Fakhreddine Ferjani Naim Saad Youssef Mehdi Iheb Karim Khalil Marouane Mortadha Nidhal Omar Rafik Ramzi
   Riadh Sami Sabri Salem Skander Tarek Wassim Yahia Zied Ahmed Amine Anouar Chiheb Chokri Fedi Fares Farouk Hichem
   Houssem Ilyes Issam Jawhar Kais Lassaad Moez Mourad Nabil Radhi Raed Seif Slim Sofiane Walid Wael Achref Adem Ali
   Aziz Bassem Bechir Hatem Helmi Kamel Lotfi Majdi Mohamed Nour Rami Saber Tarak Zoubeir Ghassen Khaled Mootez
   Oussema Yosri`,
  `Ben Salah|Trabelsi|Jabari|Mansouri|Ayari|Gharbi|Jaziri|Ben Youssef|Haddadi|Bouzid|Dridi|Messaoudi|Ben Amor|
   Ben Hassen|Ben Mustapha|Ben Saïd|Ben Slimane|Ben Khalifa|Ben Amara|Ben Hamouda|Ben Mohamed|Ben Nasr|Ben Rejeb|
   Ben Taher|Ben Yahia|Bouguerra|Chaalali|Chebbi|Chikhaoui|Dahmen|Dhaouadi|Ferjani|Ghandri|Guesmi|Hammami|Harzi|
   Hmani|Jemal|Jlassi|Kechrida|Khenissi|Mathlouthi|Meriah|Mejbri|Nafti|Oueslati|Rafia|Riahi|Saidi|Sassi|Slimane|
   Srarfi|Talbi|Toujani|Zouaghi|Abdi|Ajmi|Arfaoui|Ayadi|Baccouche|Bedoui|Belaid|Bouaziz|Boughanmi|Chaabani|
   Chouchane|Dhiab|Ferchichi|Gabsi|Ghali|Hamdi|Hannachi|Hosni|Jebali|Jendoubi|Jouini|Karoui|Kchouk|Klai|Lahmar|
   Louati|Mabrouk|Mahjoub|Marzouki|Methnani|Mhiri|Mzoughi|Nasri|Ouertani|Rezgui|Romdhane|Sahli|Selmi|Sghaier|
   Souissi|Tlili|Yahyaoui|Zaier|Zarrouk|Zitouni|Kraiem|Charfi|Sfaxi|Fourati|Kallel|Ellouze|Masmoudi|Triki|Jarraya|
   Hachicha|Chaabane|Gasmi|Hammouda`,
);
// Wolof, Serer, Lebou and Diola names of Senegal.
const SENEGALESE = pool(
  "senegalese",
  `Pape Modou Cheikh Serigne Babacar Ousseynou Lamine Saliou Demba Samba Alioune Assane Ibou Mouhamed Makhtar Mbaye
   Moustapha Aliou Baye Birame Djibril Elimane Fallou Gorgui Ismaila Khadim Malick Mame Massamba Matar Momar Moussa
   Omar Pathé Sada Sidy Souleymane Talla Thierno Youssou Ndiaga Ablaye Abdou Alassane Amath Bara Bouna Chérif Dame
   Diégane Djiby Fodé Habib Idrissa Mouhamadou Kalidou Ibrahima Libasse Mamour Mansour Moctar Nfally Ansou Sadio Bacary`,
  `Ndiaye Diop Fall Sarr Gueye Seck Faye Diouf Sow Ba Diallo Sy Mbaye Ndour Thiam Cissé Dieng Kane Samb Ndoye Niang
   Wade Diagne Mendy Diatta Sané Badji Coly Sagna Manga Sonko Diédhiou Goudiaby Tendeng Bassène Gomis Sambou Diémé
   Faty Touré Kandé Lo Mboup Ndao Ngom Sène Thiaw Tine Dione Diome Diaw Mbengue Ly Kouyaté Camara Cissokho Sakho
   Baldé Diakhaté Dramé Ndione Pouye Wagué Kébé Mbodj Sall Gassama Ciss Niasse Dia Senghor Seye Tall`,
);
// Given names shared across Muslim West Africa (Mande, Fula, Wolof, Songhai, Hausa and Dioula areas).
const WEST_AFRICAN = pool(
  "west-african",
  `Mamadou Moussa Ibrahima Abdoulaye Amadou Ousmane Boubacar Souleymane Seydou Adama Bakary Lamine Cheick Sekou Aliou
   Alassane Idrissa Issa Ismaila Lassana Mahamadou Modibo Oumar Salif Sadio Samba Siaka Yaya Youssouf Fousseni Kalifa
   Karamoko Mamady Mory Naby Sidiki Tidiane Yacouba Zoumana Abdourahmane Amara Babacar Birama Demba Djibril Fodé
   Habib Hamidou Ibrahim Khalifa Mahamane Makan Moctar Moriba Nfaly Ousseynou Sambou Seydina Soumaïla Tiémoko Mamoudou
   Abou Aboubacar Hamed Ladji Bourama Drissa Mohamed Alhassane Daouda Ismaël Kader Lacina Mahamoud Oumarou Sidy
   Brahima Dramane Tahirou Inza Kassoum Nouhoum Sory Thierno Alpha Ansoumane Arouna Boubou Cheikh Diakaridia Madou
   Moustapha Nouhou Sanoussi`,
  "",
);
const FULA = pool(
  "fula",
  `Thierno Alpha Oury Saliou Amadou Boubacar Ousmane Abdoulaye Mouctar Ibrahima Sadou Hamidou Mamadou Souleymane
   Tidiane Aliou Bademba Mamoudou Sékou Yaya Kalidou Harouna Samba Abdoul Djibril`,
  `Diallo Bah Barry Sow Baldé Ka Kane Sy Ly Tall Wane Dia Anne Diao Sidibé Sangaré Dicko Diakité Jallow Baldeh Djalo
   Embaló Seydi Bocoum Niane Deh Pam Sall Wone Kandé Thiam Diaw Tamboura Cissé Hama Kané Boiro Bari Sadio`,
);
const MANDE = pool(
  "mande",
  `Mamadou Moussa Seydou Adama Bakary Lassana Sekou Modibo Mahamadou Souleymane Ibrahima Abdoulaye Oumar Boubacar
   Siaka Lamine Mamady Sidiki Karamoko Yacouba Fousseni Kalifa Drissa Bourama Lacina Zoumana Tiémoko Nouhoum Kassoum
   Sory Mory Ansoumane Naby Moriba Makan Fodé Djibril Salif Cheick Aliou Issa Idrissa Youssouf Yaya Soumaïla Daouda
   Brahima Dramane Inza Ladji Sidy Madou Mamoudou Arouna Tahirou Abou`,
  `Traoré Keïta Coulibaly Diarra Konaté Camara Cissé Touré Kouyaté Sissoko Doumbia Dembélé Koné Diabaté Sanogo
   Fofana Bamba Kanté Sidibé Sylla Soumaré Doucouré Diakité Konaré Samaké Dao Diawara Diaby Fané Magassa Kamissoko
   Kouma Niakaté Sacko Sangaré Tounkara Guindo Togo Maïga Cissoko Dansoko Dianka Djiré Kanouté Konta Macalou
   Samassékou Sinayoko Tangara Tamboura Yattara Bagayoko Diakhaby Dramé Fadiga Gakou Kébé Koita Marega Niambélé
   Ouattara Bakayoko Diomandé Doumbouya Kourouma Condé Kaba Mara Soumaoro Sissako`,
);
// Christian given names of francophone West and Central Africa.
const FRANCOPHONE = pool(
  "francophone",
  `Jean Christian Patrick Serge Fabrice Eric Joseph Stéphane Didier Alain Samuel Franck Arnaud Cédric Yannick Hervé
   Olivier Pierre Paul Jacques Aristide Armel Blaise Brice Charles Christophe Clément Cyrille Désiré Emmanuel
   Ferdinand Florent Gaël Geoffroy Georges Gérard Gilles Guy Henri Jérémie Jonathan Junior Landry Laurent Léandre
   Lionel Marcel Martial Maxime Michel Nicolas Parfait Pascal Prince Rodrigue Romaric Salomon Sébastien Sylvain
   Thierry Ulrich Valentin Vincent Wilfried Yves Aimé Bienvenu Christ Fiacre Hilaire Jules Kévin Loïc Mathieu Noël
   Raoul Roland Steve Sylvère Venance Wilson`,
  "",
);
// Akan (Baoulé, Agni, Abron), Kru (Bété, Dida, Wê) and Senufo names of Côte d'Ivoire.
const IVORIAN = pool(
  "ivorian",
  `Kouadio Kouamé Koffi Kouassi Konan Yao N'Guessan Kouakou N'Dri Brou Kanga Aka Amani Kacou Assi Ehui Kablan Amon
   Adou Ebrin Anoh Kassi Kobenan Allou Tanoh Séri Zoro Gnagne Guéi Soro Yéo Tuo Silué`,
  `Kouamé Kouassi Yao Koffi N'Dri N'Guessan Konan Kouadio Aka Akpa Amani Ahoussou Allou Assamoi Assi Boka Brou Ehui
   Kacou Kanga Kassi Kobenan Kouao Kouakou Kra N'Goran N'Zi Niamké Tanoh Yapi Yobouet Aké Akaffou Aboa Assalé
   Bohoussou Boni Kablan Kadjo Kakou Koua N'Cho N'Da Gnahoré Zokou Gohou Guéhi Bailly Zoro Séri Gnagne Dago Zadi
   Kipré Tiéné Zahui Blé Oulaï Gueu Tia Yohou Tapé Soro Silué Yéo Tuo Sékongo Ouattara Diomandé Gbamin Djédjé
   Digbeu Gnépo Lohoré Gbéhi Doh Goré`,
);
// Beti, Bassa, Duala, Bamiléké, Bamoun, anglophone Grassfields and northern names of Cameroon.
const CAMEROONIAN = pool(
  "cameroonian",
  "",
  `Mbarga Nsame Ngom Abanda Moukoko Essomba Mbia Njoya Tchamba Mbala Onana Nguewa Abega Ateba Atangana Ayissi
   Bekono Belinga Ebanga Ekambi Ekotto Elanga Eyenga Fai Fokou Fotso Kamga Kameni Kana Kenfack Kom Makoun Mandjeck
   Mbe Mbida Mbuh Mengue Nana Ndip Ndjeng Ndongo Ngadeu Ngamaleu Ngando Ngassa Ngono Nguemo Njitap Njoh Nkoulou
   Nkufo Nlend Noah Ntep Nyom Obam Olinga Ondoa Onguéné Owona Tabi Tagne Tchakounté Tchatchoua Toko Wome Zambo Zoa
   Eboa Ekongolo Elong Epassy Etame Kingue Moukandjo Ngue Nkodo Tchami Idrissou Hamadou Oumarou Adamou Moumi
   Mohamadou Tawamba Neyou Nouhou Tchouangue Ngwem Ewane Mvondo Manga Fomba Tchinda Djeugoué Tchuente Fondjo
   Nkwain Tamfu Awa Achu Ndifor Ngwa Tanyi`,
);
// Fang, Bulu and Ntumu names shared by Gabon, Equatorial Guinea and southern Cameroon.
const FANG = pool(
  "fang",
  "",
  `Nguema Mba Ondo Obiang Ebang Ndong Nsue Esono Engonga Ebana Nchama Mangue Owono Oyono Mengue Nze Edu Abeso Asumu
   Mitogo Ela Edjang Mbomio Eyama Nsang Nfumu Bindang Oyana Nvono Obono Sima Ekomo Essono Mintsa Allogo
   Biyoghe Mebale Minko Mve Nkoghe Obame Ossa Zue`,
);
// Given names used in both Congos (Lingala, Kikongo and Swahili usage alongside French names).
const CONGOLESE = pool(
  "congolese",
  `Dieumerci Fiston Chadrack Merveille Glody Exaucé Gloire Héritier Magloire Nathan Joël Trésor Bienvenu Djo Arsène
   Masudi Bahati Amani Dido Rémy Ange Chancel Beni Nathanaël Gradi Jackson Yoane Bolingo Mechak Destin`,
  "",
);
// Kikongo and Lingala names of western DR Congo and the Republic of the Congo.
const KONGO = pool(
  "kongo",
  "",
  `Mabiala Mouanda Nkouka Ngoma Massamba Makosso Bissila Kibouka Nsimba Nzuzi Matondo Luzolo Mavinga Mpasi Kiala
   Makiadi Lutete Mfumu Kinkela Mbuta Nzinga Lukau Mafuta Mvemba Nlandu Ndombasi Makanda Nsiala Tuzolana Ngimbi
   Menga Loemba Bouanga Mabika Nkounkou Samba Moukila Mampouya Malonga Mboungou Makita Nganga Kimbembe Ntinou
   Lusadisu Mbenza`,
);
// Luba, Songye and Katangese names of Kasaï and Katanga.
const LUBA = pool(
  "luba",
  "",
  `Mbuyi Kabeya Ilunga Kasongo Mputu Kabasele Mwamba Lukusa Tshibanda Kanku Kalala Kabamba Mukendi Tshibangu Kalonji
   Mulumba Kabongo Ngoy Banza Kitenge Mbayo Tshiani Kazadi Mutombo Kalombo Numbi Mukanya Kyungu Ngandu Tshimanga
   Mukuna Nkulu Kabwe Mulamba Mpoyi Kanda Kayembe Muteba Kanyinda Kabangu Mwepu Tshilumba Kasanda Kamulete Mulongo
   Kapend Lubaya Kalenga`,
);
// Mongo and Ngala names of Équateur, and the Nande, Shi and Swahili names of the Kivus and Maniema.
const CONGO_EAST = pool(
  "congo-east",
  "",
  `Bokila Ekanga Bokungu Botaka Lokwa Likonza Elia Lokondo Bongonda Lomalisa Bolenge Bokanga Ndinga Mungongo
   Kakule Kambale Kasereka Muhindo Paluku Mumbere Kahindo Byamungu Bahati Amani Bisimwa Cirhuza Mushagalusa Balume
   Mwanza Kalume Salumu Ramazani Shabani Assani Omari Selemani Kitambala Mayele Bofenda Ilongo Boeli Mpia Lokuli`,
);
// Zulu, Xhosa, Swati and Ndebele names (South Africa, Eswatini).
const NGUNI = pool(
  "nguni",
  `Sipho Themba Bongani Sibusiso Thulani Lwandile Siyabonga Mthokozisi Mandla Sifiso Njabulo Nkosinathi Mzwakhe Luvuyo
   Lwazi Ayanda Xolani Andile Khanyisa Lindani Bheki Bhekani Dumisani Mfundo Mlungisi Musa Nhlanhla Sandile Sanele
   Sbonelo Senzo Simphiwe Siphesihle Siyanda Thabani Thando Thembinkosi Vuyo Zakhele Zola Zweli Khaya Lunga Lutho
   Mondli Mxolisi Nkululeko Phumlani Sakhile Sizwe Velile Wandile Athenkosi Bonga Lonwabo Masixole Mihlali
   Sinethemba Lukhanyo Aphiwe Luyolo Mpumelelo Nkanyiso`,
  `Dlamini Ndlovu Nkosi Mkhize Mthembu Zulu Khumalo Ngcobo Shabalala Mahlangu Mabaso Ntuli Cele Zungu Mthethwa Gumede
   Mazibuko Buthelezi Hadebe Sithole Ngubane Majola Mnguni Mbatha Msimang Zwane Nxumalo Ndaba Mdlalose Mtshali Qwabe
   Mabuza Makhanya Mhlongo Myeni Mlambo Nzimande Magwaza Hlongwane Luthuli Madlala Maphumulo Masondo Mchunu
   Mkhwanazi Mnisi Mpanza Msomi Mthimkhulu Ngema Nyawose Sibiya Xulu Zondi Biyela Gcaba Mathe Mkhabela Mabena
   Masilela Skosana Mabandla Ngcukana Somdaka Matyila Nombembe Ngxongo Mgcina Bokwe Nyathi Dyantyi Makalima
   Ntshangase Ngobese Khoza Zikalala Gasa Shezi Mbele Tshabangu`,
);
// Sotho and Tswana names (South Africa, Botswana, Lesotho).
const SOTHO_TSWANA = pool(
  "sotho-tswana",
  `Thabo Thabang Teboho Mokete Mpho Tumelo Lebohang Kabelo Rethabile Tshepo Karabo Kgomotso Tebogo Keabetswe Lesego
   Thato Kagiso Lehlohonolo Katlego Neo Oratile Onkabetse Kamohelo Motheo Mothusi Ofentse Omphile Pule Sello
   Thapelo Tiisetso Tlou Tshiamo Otsile Gaolatlhe Goitseone Kgosi Lesedi Molefi Mosa Relebohile Tokelo`,
  `Mokoena Molefe Mofokeng Mokhethi Mothea Mabote Mokhesi Ntsane Seema Rasebotsa Molefi Motaung Moloi Tau Letsoalo
   Mashaba Modise Mogale Mokwena Mokone Molapo Moletsane Monyane Morake Mosimane Mphahlele Nkoana Pule Seleka Serame
   Setshedi Thebe Tlou Tshabalala Moroka Mokgosi Motsumi Mogorosi Kgosi Mokgothu Ramosweu Gabotshwene Ramotswa
   Masilo Mathibela Mokgatle Moeketsi Mohale Mohapi Makhele Mosala Nthethe Lebesa Rapoo Sebogodi Tlhapi Motlhabane
   Mogapi Ditlhokwe Ngele Radebe Sekgota Mokubung Morena Motsamai`,
);
// Tsonga, Venda and Pedi family names of Limpopo and Mpumalanga.
const TSONGA_VENDA = pool(
  "tsonga-venda",
  "",
  `Baloyi Chauke Mabunda Maluleke Mathebula Ngobeni Hlungwani Rikhotso Mabasa Nkuna Novela Mavhunga Netshitenzhe
   Ramabulana Mudau Ravele Munyai Sebola Maake Ledwaba Kekana Maponya Mothiba Moloto Shiburi Makhubela Mahlaule
   Nkwinika Masingi Makamu Tshikalange Nemakonde Mashamba Mulaudzi Maluleka Ngwenya Hlongwani Mkansi`,
);
// Cape Coloured, Cape Malay and Afrikaans family names (South Africa, Namibia).
const CAPE = pool(
  "cape",
  "",
  `Isaacs|Jacobs|Adams|Hendricks|Petersen|Arendse|Abrahams|Booysen|Cloete|Daniels|February|Fortuin|Julies|Josephs|
   Kleinbooi|Lottering|Plaatjies|Samuels|September|Solomons|Titus|Williams|Van Wyk|Davids|Moos|Ebrahim|Salie|Parker|
   Jansen|Europa|Hartzenberg|Klaasen|Links|Diergaardt|Hanse|Beukes|Nels|April|Marthinus|Pietersen|Gelderblom|Lakay|
   Erasmus|Botha|Coetzee|Pienaar|Du Plessis|Van der Merwe|Steyn|Kruger|Van Rooyen|Swartz|Meyer|Joubert`,
);
// Akan (Asante, Fante, Akuapem, Bono) names of Ghana.
const AKAN = pool(
  "akan",
  `Kwame Kofi Kwesi Kwaku Yaw Kojo Kwabena Kwadwo Kwasi Kobina Ekow Fiifi Ebo Kweku Nana Kwamena Kwaw Kodwo Atta
   Akwasi Akwesi Kwakye Kwadjo Paa`,
  `Mensah Owusu Asante Boateng Osei Agyeman Adjei Appiah Amoah Ansah Asamoah Antwi Acheampong Addo Adomako Agyei
   Amankwah Ampofo Anane Anning Aboagye Afriyie Agyemang Ameyaw Amponsah Annan Arthur Asare Ofori Opoku Oppong
   Sarpong Wiredu Yeboah Nkansah Nyarko Kyei Frimpong Gyamfi Gyan Kusi Kwarteng Manu Marfo Nsiah Obeng Ocran Danso
   Donkor Duah Dwamena Essien Fosu Baffoe Bonsu Darko Akomea Amankwaa Asiedu Atta Awuah Badu Bekoe Boakye Dankwa
   Fofie Gyasi Kumi Kyeremeh Mintah Nketiah Nti Obiri Ofosu Oduro Okyere Oteng Owiredu Peprah Poku Safo Sakyi Takyi
   Tuffour Twumasi Wiafe Yiadom Boadu`,
);
// Ewe and Kabye names of south-east Ghana and Togo.
const EWE = pool(
  "ewe",
  `Selorm Edem Elikem Mawuli Koku Senyo Komla Delali Kodjo Komlan Kossi Kokou Dodzi Mawuena Sena Setor Yao Kafui
   Worlasi Eyram Nutifafa Selom Kwami Etornam Seyram Elorm Essozimna Kokouvi`,
  `Agbeko Dzakpa Kpodo Adzaho Gakpo Amegashie Dogbe Agbo Lawson Amouzou Adzo Akakpo Agbeti Dossou Agbenyega Agbemava
   Ahiable Ameku Anku Atsu Avevor Awuku Bansah Dzamesi Fiadzigbe Gbadago Gbeho Kpeglo Kudjoe Kuwornu Seshie Tay
   Tsikata Tsatsu Wornoo Zigah Agbenou Kombaté Tchalla Tchédré Bodjona Agboh Amewou Ekue Tomety Kpodar Sokpoli
   Djagba Womé Ayéva`,
);
// Dagomba, Mamprusi, Gonja and other names of northern Ghana (largely Muslim).
const DAGBANI = pool(
  "dagbani",
  `Abdul Ibrahim Sulemana Mubarak Issah Hassan Mohammed Hamza Alhassan Rashid Fatawu Kassim Mumuni Iddrisu Yakubu
   Zakaria Abdulai Seidu Salifu Majeed Sadiq Tahiru Wahab Awal Nuhu Inusah Osman Abdul-Rahman`,
  `Alhassan Yakubu Fuseini Iddrisu Abubakari Seidu Salifu Dramani Mumuni Sulley Baba Inusah Issifu Abdulai Zakaria
   Mahama Nuhu Adamu Awal Kassim Wahab Rashid Sadiq Tahiru Fatawu Mohammed Majeed Sualihu Karim Musah Issahaku
   Sumaila Yussif Adam Mahamadu Tanko Amadu Gariba Sulemana`,
);
// Ga and Adangbe family names of the Accra plains.
const GA_ADANGBE = pool(
  "ga",
  "",
  `Quaye Quartey Laryea Lamptey Nortey Tetteh Odoi Addy Ashong Kotey Sackey Armah Aryee Lartey Okine Ankrah Tagoe
   Ashie Adotey Allotey Bortey Clottey Odametey Oblitey Sowah Tackie Nikoi Commey Dodoo Kwei Narh Ayitey Ofoe`,
);
// Given names of Lusophone Africa (Angola, Mozambique, Cape Verde, Guinea-Bissau, São Tomé).
const LUSOPHONE = pool(
  "lusophone",
  `João José Manuel Mateus Paulo Pedro António Francisco Hélder Sérgio Domingos Filipe Carlos Nuno Dário Gilson Jorge
   Luís Jovane Nelson Elton Elvis Armando Elias Edson Alberto Celso Ernesto Isac Joaquim Adilson Jair Gilmar Valter
   Edmilson Agostinho Aníbal Arlindo Bruno Custódio Delfim Djalma Emerson Evandro Fábio Fernando Gelson Geraldo Hugo
   Ivan Jaime Júlio Kelson Leonel Lúcio Márcio Mário Miguel Osvaldo Rafael Ricardo Rui Silvino Stélvio Tiago Vladimir
   Wilson Anderson Hernâni Ivanildo Jacinto Laurindo Marcelino Nilton Rolando Zidane Cláudio Dany Adérito Benvindo
   Eliseu Estêvão Feliciano Inácio Jerson Manucho Ramiro Sidnei`,
  "",
);
const CABOVERDEAN = pool(
  "caboverdean",
  `Garry Ryan Kenny Dylan Jamiro Lisandro Logan Sidny Deroy Willy Kevin Steven Jeffry Roberto Wagner Patrick Laros
   Dailon Telmo Hélio Yannick Admilson Anilton Nilson Gerson Sidney Kelvin Nuno Jeferson`,
  `Monteiro|Pina|Fortes|Semedo|Varela|Lopes|Tavares|Gomes|Correia|Barros|Rocha|Fernandes|Andrade|Borges|Brito|Cabral|
   Cardoso|Delgado|Duarte|Évora|Furtado|Graça|Leite|Lima|Livramento|Medina|Mendes|Moreira|Neves|Oliveira|Pereira|
   Ramos|Rodrigues|Santos|Silva|Soares|Sousa|Spencer|Teixeira|Vaz|Vieira|Almeida|Alves|Baptista|Carvalho|Costa|
   Freire|Fonseca|Gonçalves|Martins|Nascimento|Sanches|Da Luz|Dos Santos|Da Veiga|Mascarenhas|Querido|Rosário`,
);
// Kimbundu, Umbundu and Kikongo names of Angola alongside Portuguese ones.
const ANGOLAN = pool(
  "angolan",
  "",
  `Ndala|Kiala|Quissanga|Zola|Mavungo|Manuel|António|Domingos|Neto|Mateus|da Costa|Baptista|Mabululu|Mbala|Kalunga|
   Muanza|Sapalo|Cassule|Chindumbo|Chipenda|Chissola|Kumbela|Luvumbo|Massunguna|Muanha|Ngola|Paciência|Quintas|
   Sebastião|Tchipa|Wandi|Cabungula|Capita|Cangonga|Cristóvão|Dala|Epalanga|Gaspar|Jamba|Kapango|Kassoma|Mayamba|
   Mingas|Moniz|Mussungo|Paulino|Sayovo|Zau|Bento|Custódio|Ferreira|Gonçalves|Lopes|Matias|Miranda|Pedro|Santana|
   Tomás|Vieira|Chimuco|Kaluanda|Ngunza|Tchicaia`,
);
// Changana, Ronga, Makhuwa and Sena names of Mozambique alongside Portuguese ones.
const MOZAMBICAN = pool(
  "mozambican",
  "",
  `Mabunda Machava Mucavele Matsinhe Cossa Langa Nhantumbo Matusse Sitoe Bila Cumbe Dimande Guambe Macamo Macuácua
   Mafumo Magaia Manhiça Manjate Massingue Matavele Mazive Muchanga Mulhovo Muianga Munguambe Nhaca Nhamuave Novela
   Sambo Simango Tembe Tivane Ubisse Uamusse Zandamela Chivambo Macuvele Cuna Cumbane Mungoi Mahumane Muthemba
   Mandlate Massango Timane Chirindza Nhambirre Ussene Assane Momade Issufo Amade Pereira Santos Fernandes Gomes
   Costa Catamo Mondlane Mabote`,
);
// Balanta, Papel, Manjaco, Mandinka and Fula names of Guinea-Bissau.
const BISSAU_GUINEAN = pool(
  "bissau-guinean",
  "",
  `Mendes|Gomes|Correia|Vieira|Dju|Sanca|Cassamá|da Silva|Djaló|Sané|Camará|Embaló|Có|Nanque|Candé|Mané|Indjai|Sambú|
   Nhaga|Biaguê|Lopes|Monteiro|Pereira|Sá|Té|Ié|Nhanca|Turé|Seidi|Baldé|Djassi|Cabi|Quadé|Nanco|Jaquité|Dabó|Sanhá|
   Bacar|Fati|Injai|Cá|Na Bangna|Nhaté|Intchasso|Uandim`,
);
// Spanish given names used in Equatorial Guinea.
const EQUATOGUINEAN = pool(
  "equatoguinean",
  `Emilio Basilio Federico Teodoro José Esteban Juan Pablo Santiago Rubén Carlos Iván Javier Pedro Luis Miguel Ángel
   Salvador Benjamín Ramón Rafael Sergio Álex Saúl Jesús Francisco Antonio Raúl Andrés Tomás Marcelino Ireneo
   Diosdado Gustavo Fernando Alberto Manuel Crispín Florentino Josete Eloy Leandro Lorenzo Narciso Pascual Plácido
   Ricardo Simeón Vicente Óscar`,
  "",
);
// Bubi (Bioko), Ndowe (coast) and Annobonese family names of Equatorial Guinea.
const BUBI = pool(
  "bubi",
  "",
  `Bolekia Riloha Siale Bohopo Echuaca Bitá Boricó Balboa Coco Akapo Ebuka Bokesa Kombe Mbela Epam Bueriberi Belope
   Ribalda Sipoto Bojeyo Ikaka Ebongo Epota Boleko Riochí`,
);
// Shona names of Zimbabwe, including the English virtue names typical of the country.
const SHONA = pool(
  "shona",
  `Tinashe Tendai Tatenda Kudakwashe Tawanda Takudzwa Farai Simbarashe Blessing Tanaka Tafadzwa Tapiwa Tonderai
   Tichaona Munyaradzi Nyasha Panashe Takunda Anesu Kuda Tinotenda Tafara Ngonidzashe Knowledge Talent Marvelous Never
   Givemore Lovemore Pardon Admire Brighton Clever Denver Last Obey Washington Wellington Welcome Terrence Petros`,
  `Moyo Muzenda Chikore Mupfumi Chirume Zhou Chiweshe Mapfumo Mudzuri Chinyama Mutasa Chigumba Chimombe Gumbo Hove
   Makoni Mandaza Marufu Mashingaidze Matambanadzo Mhlanga Mupariwa Musona Mutizwa Nyamayaro Nyandoro Nyatanga
   Rusike Tembo Kadewere Katsande Madzongwe Mahachi Mangwiro Marange Marimo Mawaya Mhako Pfumbidzai Shumba Takwara
   Makaza Chivaviro Munetsi Chakanyuka Chikomo Chimedza Chinembiri Chitima Dzingai Gore Gwaze Hwata Jera Kanengoni
   Kativhu Machingura Madanhire Mafaro Magaya Mahere Majoni Makumbe Mandiwanza Maposa Matanda Matare Mazhindu Mhere
   Mubaiwa Munyoro Murehwa Musariri Mutandwa Muzondo Mvura Nyamadzawo Tapera Zinyemba`,
);
// Ndebele and Kalanga family names of Matabeleland.
const NDEBELE = pool(
  "ndebele",
  `Thabani Sibusiso Bhekinkosi Mthokozisi Mduduzi Thulani Bongani Mandla Nkosana Sipho Themba Mehluli Lindani
   Mthulisi Bukhosi Qhubani Sithembiso Ntando Khumbulani Nqobizitha`,
  `Ndlovu Ncube Moyo Sibanda Dube Mpofu Nkomo Khumalo Masuku Nyoni Tshuma Mlilo Sithole Mathe Nyathi Gumede Mahlangu
   Mguni Mkandla Mabhena Maseko Bhebhe Ngwenya Mlotshwa Hlabangana Ndebele Dlodlo Mangena Ngulube Lunga`,
);
// Mbochi, Teke, Kouyou and Vili names of the Republic of the Congo.
const CONGO_NORTH = pool(
  "congo-north",
  "",
  `Ibara Itoua Obambi Okemba Oniangué Mafouta Dzon Ntsiba Ngakosso Elenga Ossibi Ondongo Moukassa Okoko Ngatsé Ebara
   Obami Ondzé Mboulou Ikonga Mouyabi Opou Andzouana Ngoubou Ebina Ngandziami Okiemy Mbon Ossebi
   Gandzadi Ikoubé Moubandje Ganvoula Ngokobi Loubaki Mampassi Bahamboula Ngoulou Ndinga Ossété Ngouamba Tchicaya
   Poaty Mavoungou Makaya Moussavou Bouiti Tati Dembi Mpika Nguié Oko Ngakala Oyandza Ngoyi Kiminou Moukouyou Ekouya
   Ngolo Ossonga`,
);
// Amhara, Oromo, Tigrayan, Sidama and Somali-region names; family names are fathers' names.
const ETHIOPIAN = pool(
  "ethiopian",
  `Dawit Abel Samuel Yared Bereket Fitsum Henok Natnael Solomon Yonas Biniam Elias Getaneh Shimelis Gatoch Surafel
   Amanuel Abubeker Adane Addisu Alemayehu Asrat Aschalew Behailu Birhanu Daniel Ermias Eyob Frezer Girma Habtamu
   Haileyesus Kaleab Kebede Kidus Mesfin Mesud Minyahil Mulualem Mujib Nahom Oumed Robel Salhadin Sintayehu Tafesse
   Tekle Tewodros Tsegaye Wondwossen Yohannes Yibeltal Yisehak Zerihun Abdulkerim Anteneh Ashenafi Beka Chernet
   Desalegn Dagim Endale Fikadu Gizachew Hailu Ibrahim Kiros Leul Melkamu Mintesnot Musa Naod Sisay Tariku Wubshet
   Yeabsira`,
  `Bekele Tesfaye Tadesse Alemu Desta Gebre Haile Mulugeta Worku Getachew Mekonnen Assefa Abebe Abera Admasu
   Alemayehu Asfaw Ayele Belay Berhanu Dagne Demissie Derese Fikre Gebremariam Gebremeskel Gebreyes Girma
   Hailemariam Kassa Kebede Legesse Mamo Mengistu Negash Seyoum Shiferaw Tefera Tekle Tilahun Wolde Woldemariam Yilma
   Zewde Abate Asrat Bayu Birru Chala Dinku Eshetu Feyisa Gemechu Gudeta Jemal Kedir Lemma Megersa Mohammed Mulatu
   Negasa Regassa Seifu Sileshi Tolosa Tsegaye Wakjira Yimer Adugna Amare Aregawi Ashagre Bogale Degefa Dereje
   Endalew Fantahun Gashaw Getnet Habte Kahsay Kifle Lakew Mersha Nigussie Shumete Tamrat Teshome Wondimu Yeshitila
   Zerihun Abdulkadir Hussien Umer Nasir Sultan Awol Omod Ojulu Obang`,
);
// Fon, Goun, Yoruba-Nago and Bariba names of Benin.
const BENINESE = pool(
  "beninese",
  `Romuald Steve Rodrigue Cédric Marcel Pascal Mathieu Ulrich Rachid Moussa Ismaïl Youssouf Abdou Arouna Sanni
   Mahougnon Sèna Codjo Kossi Dossou Sèdjro Mèhoumè Gbènagnon Jodel Olatoundji Djiman Rodolphe Désiré Wassiou`,
  `Soglo Hounkpatin Adjovi Dossou Houngbo Sossou Ahouansou Agonlin Bello Yarou Sanni Djamal Gounou Boko Djaouga
   Abdoulaye Amoussou Assogba Gbaguidi Glèlè Hounsou Houessou Hountondji Kpadonou Lokossou Sagbo Tossou Zinsou
   Zossou Gandonou Akplogan Adjahossou Dagnon Dah Dossa Tchibozo Houndjo Kiki Bio Sabi Orou Kora Bani Worou Chabi
   Imorou Adéoti Olou Fagbohoun`,
);
// Mossi, Bobo, Gurunsi and Dagara names of Burkina Faso.
const MOSSI = pool(
  "mossi",
  `Wendyam Wendpanga Rasmané Boukary Salifou Hamado Adama Issouf Lassina Abdoul-Razack Ousséni Souleymane Harouna
   Moumouni Bertrand Aristide Hervé Blati Cyrille Steeve Dramane Saïdou Alassane`,
  `Ouédraogo Sawadogo Kaboré Zongo Traoré Sanou Sankara Nikiéma Compaoré Konaté Bationo Tapsoba Yaméogo Ilboudo
   Kiemtoré Ouattara Zoungrana Zerbo Zida Bado Belem Bamogo Dabiré Somé Kambou Palm Dianda Koanda Nana Ouoba Simporé
   Tiendrébéogo Kouanda Nacanabo Ouangraoua Rouamba Soré Tamboura Yonli Zangré Kologo Guira Sangaré Bayala Dayo
   Kaboret Kagambèga Pitroipa Toé`,
);
// Sango, Gbaya, Banda and Yakoma names of the Central African Republic.
const CENTRAL_AFRICAN = pool(
  "central-african",
  "",
  `Kondogbia Ketevoama Mabide Koyanbounou Ngakoutou Gbabia Yamissi Ndobe Goua Guebari Mandé Gbako Zemboro Yakité
   Kotto Moganga Doté Sabe Nambona Pounganzi Toko Mapouka Bakassa Kossi Ngaïdé Dénamganaï Zokoué Kogbeto Ngoma
   Yangué Gbokapi Namsenei Ngbokota Feïgoudozoui Kette Mbokani Sanzé Yangombé Wagué Sombo Bodo Ngouandi Tokomon
   Dimanche Mbaïkoua`,
);
// Chadian Arabic and Sara names.
const CHADIAN = pool(
  "chadian",
  `Mahamat Abakar Moussa Ahmat Hassan Issa Oumar Ali Nodjitoloum Ngar Marius Ezechiel Casimir Mbaidoum Haroun
   Nambatingue Brahim Saleh Adoum Abdelkerim Youssouf Djibrine Khamis Hissein Ibrahim Idriss Mahamoud Nassour Rodrigue
   Leger`,
  `Saleh Abdoulaye Youssouf Brahim Hassane Adoum Djibrine Khamis Ngarlem Ngarassal Djidingar Mbaigon Nassour Madji
   Togou Ngarndiguim Mahamat Ahmat Abakar Oumar Issa Haroun Hissein Mbaïdoum Ngaradoum Nodjigoto Djimtoloum Doumbé
   Mbaïhoudou Ngaba Allamine Hamid Moukhtar Zakaria Kosseyal Ngakinar Beyem Tadjadine Kaïgama Allahissem
   Ngarmbaye Dillah Mandjita Toko`,
);
const COMORIAN = pool(
  "comorian",
  `Ali Said Ahmed Mohamed Youssouf Ibrahim Hassan Salim Abdallah Fahad Faïz Nadjim Chaker Rafidine Djamal Mouhtar
   Kassim Ahmada Abdou Ismaël Soilihi Nassim Houssein Ibroihim Chamsidine Mourtadhoi Zaïd Myziane Iyad Rayan`,
  `M'Changama Djae Abdallah Madi Bacar Mroudjae Ali Said Mze Ahamada Youssouf Abdou Soilihi Toibibou Ahmed Mohamed
   Attoumani Chanfi Hamidou Maoulida Mmadi Moussa Oussene Saandi Ibouroi Mbaé Selemani Djoumoi Houmadi Hachim
   Ben Nabouhane Boina Mogni Salim Kari Mlanao Dhoiharou Bourhane Anfane Chihab`,
);
// Somali names (Somalia, Djibouti, Somali Ethiopia and Kenya).
const SOMALI = pool(
  "somali",
  `Ahmed Abdi Mohamed Hassan Yusuf Ali Omar Abdullahi Ibrahim Farah Ismail Mahad Abdirahman Abdikarim Abdirashid
   Abdiaziz Abdiqani Bashir Deeq Faisal Guled Hamza Hussein Idris Liban Mahamud Mukhtar Mustafe Nuur Osman Said
   Sharmarke Yasin Zakariye Khalid Sakariye Anwar Abdisalam Ayanle Daahir`,
  `Hassan Ali Abdi Warsame Mohamud Farah Jama Adan Yusuf Osman Nur Isse Abdullahi Ahmed Aden Awale Barre Dahir Duale
   Egal Elmi Gedi Guled Haji Hersi Hirsi Ibrahim Ismail Jibril Kahin Mohamed Muse Noor Omar Qasim Robleh Samatar
   Shire Sheikh Wardhere Yasin Abdirahman Dirie Galaal Geele Houmed Dini`,
);
// Tigrinya, Tigre and Bilen names of Eritrea (father's name as family name).
const ERITREAN = pool(
  "eritrean",
  `Biniam Henok Natnael Dawit Yonatan Yonas Filmon Robel Bereket Meron Daniel Abel Amanuel Mikael Samuel Tesfalem
   Aron Ermias Senay Yohannes Kibrom Habtom Awet Mehari Semere Tomas Kidane Efrem Merhawi Luel Nahom Simon Teklit
   Yosief Abraham`,
  `Ghebre Tesfai Tekle Asmerom Haile Kidane Berhane Gebremariam Weldemichael Habte Abraha Tewelde Ghebremedhin
   Tesfamariam Andemariam Mehari Mebrahtu Negash Okbamichael Russom Teklehaimanot Woldu Yemane Zeray Araya Bahta
   Desta Estifanos Fessehaye Ghirmay Haregot Isaak Kahsay Mengisteab Naizghi Sebhatu Tsegai Weldegiorgis Zerezghi
   Afewerki Bereket Goitom Hailemichael`,
);
const SWAZI = pool(
  "swazi",
  `Sibusiso Musa Bongani Thulani Mlungisi Sifiso Sabelo Nkosingiphile Mzwandile Sandile Felix Tony Mthunzi Wandile
   Sanele Siboniso Lindokuhle Banele Phiwayinkhosi Mcolisi`,
  `Dlamini Mkhonta Maseko Nxumalo Gamedze Hlophe Simelane Shongwe Mavimbela Ginindza Magagula Mamba Masilela Mdluli
   Mkhabela Motsa Msibi Ndzimandze Ngcamphalala Nhlengethwa Nkambule Sihlongonyane Tsabedze Vilakati Kunene
   Matsebula Mngometulu Sukati Thwala Dladla Fakudze Lukhele Manana Hlatshwayo Zwane`,
);
// Punu, Myene, Nzebi, Téké and other non-Fang names of Gabon.
const GABONESE = pool(
  "gabonese",
  "",
  `Moussavou Mouele Mouyabi Moundounga Mboumba Mayila Nzigou Bouanga Poko Madinda Ecuele Manga Nzamba Mouandza
   Boussougou Mbina Ngoma Kanga Mouity Ndoumbou Ibouanga Lembet Mounguengui Bisseck Mbadinga Nzé Ovono Dibanga
   Moukagni Malonga Mbouma Mabicka Ndjiké Oyane Tchen`,
);
// Mandinka, Wolof, Fula, Jola and Serahule names of The Gambia.
const GAMBIAN = pool(
  "gambian",
  `Lamin Ebrima Bakary Musa Ousman Alieu Modou Bubacarr Yusupha Omar Sulayman Momodou Kebba Sheriff Assan Muhammed
   Saikou Ablie Seedy Sainey Abdoulie Yankuba Ansu Alagie Dawda Foday Haruna Jerreh Kajally Malick Mustapha Nfamara
   Ousainou Samba Tijan Buba`,
  `Jallow Sowe Ceesay Sanyang Sanneh Darboe Bojang Touray Colley Bah Njie Jobe Camara Fatty Manneh Badjie Jatta Jarju
   Janneh Kinteh Sillah Drammeh Saidy Sonko Gaye Faal Mbye Secka Joof Kujabi Minteh Marong Sabally Hydara Conteh
   Sarr Jawo Kanteh Keita Jammeh Barrow Tamba Dampha Krubally Bittaye`,
);
// Susu family names of coastal Guinea.
const SUSU = pool(
  "susu",
  "",
  `Soumah Sylla Bangoura Yansané Sankhon Youla Kalissa Sampil Kaba Bangaly Soumaoro Fofana Touré Camara Kourouma
   Doumbouya Conté Sakho Kanté Cissé Tounkara Diaby Sow`,
);
// Luo, Luhya, Kikuyu, Kalenjin, Kamba and coastal names of Kenya.
const KENYAN = pool(
  "kenyan",
  "",
  `Otieno Ochieng Wanjala Kamau Mwangi Kiptoo Kiprotich Mutua Njoroge Omondi Wafula Odhiambo Onyango Owino Okoth Ouma
   Oduor Wanyama Wekesa Simiyu Barasa Makokha Nyongesa Kariuki Kimani Githinji Wainaina Maina Macharia Kiprono
   Cheruiyot Rotich Kiplagat Kosgei Langat Mutiso Musyoka Mwendwa Nzioka Kilonzo Mbugua Ngugi Waweru Kinyanjui Omollo
   Obiero Okumu Were Wandera Abdalla Hamisi Salim Ochola Oketch Juma Masinde Opiyo Ogada Kibet Korir`,
);
// Kpelle, Bassa, Kru, Gio, Mano, Vai and Americo-Liberian names.
const LIBERIAN = pool(
  "liberian",
  `Kollie Varney Sekou Boye Prince Emmanuel Anthony Joseph Samuel Isaac Kpah Sam Sampson Divine Mark Terrence Kelvin
   Allen Marvin Sylvanus Garrison Jeremiah Aloysius Momo Varmah Ansu Alvin Mohammed Christopher`,
  `Kpoto Kollie Kromah Kamara Yarkpawolo Gbotoe Kouyateh Flomo Doe Jallah Toe Sherman Cooper Dennis Tarpeh Gbala
   Zayzay Sackor Kiazolu Kpadeh Zinnah Sumo Massaquoi Nimely Wesseh Tweh Dolo Gono Nyanti Gbanjah Mulbah Kerkula
   Freeman Karnley Sayeh Kpan Brown Johnson Roberts Clarke Harris Paye Saydee Barh Gbessay Tokpa Gbeme Dahn`,
);
const LIBYAN = pool(
  "libyan",
  `Mohamed Ahmed Ali Omar Abdallah Muftah Salem Khaled Moatasem Anis Faisal Mohannad Hamdou Ezzeddin Yousef Tarek
   Nouri Saleh Abdulrahman Moayad Sanad Motasem Osama Fadel Hussein Ibrahim Abdelaziz Subhi Ramadan Bashir Ayman
   Rabea Sami Walid Nader Mahmoud`,
  `El Masli|Elhouni|Al Trbi|Benali|Al Ghanodi|Zaid|Saadi|Al Tarhouni|Makhlouf|Belhaj|Al Mahdi|Bennour|Elgadi|
   Al Warfalli|Al Obeidi|Shaladi|Zubya|Al Sharif|Krayem|Tabouni|Busaadia|Elfalah|Al Mismari|Badi|Al Maghrebi|
   Ghadban|Abughalia|Al Senussi|Belgasem|Hammuda|Elmhdi|Aboud|Al Ferjani|Esnani|Mughrabi|Ben Ghazi|Al Zawi|Dayab|
   Al Hamrouni|Ghanem|Kashbour|Al Rashidi|Faraj|Bouker|Al Tawerghi`,
);
const MALAGASY = pool(
  "malagasy",
  `Andry Faneva Lalaina Toky Mamy Njiva Hasina Tiana Rado Lova Rija Tojo Hery Zo Fetra Nomena Mahefa Solofo Tsiry
   Tahina Rindra Nantenaina Fanilo Haja Heriniaina Tsiory Ando Ibrahim Anicet Romario`,
  `Rakoto Rakotondrabe Rasolonirina Ranaivo Rabe Randrianarivelo Rasolofonirina Rakotomalala Raveloson Ramanantsoa
   Andriamanantena Andrianarimanana Andriamasinoro Rabemananjara Rafanomezantsoa Rajaonarison Rakotoarisoa
   Rakotonirina Rakotozafy Ralaivao Ramaroson Randriamampianina Randrianasolo Rasamoelina Rasoanaivo Ratsimbazafy
   Razafindrakoto Razafimahatratra Andriantsoa Rabenja Rahajason Rakotomanga Ramiandrisoa Randrianarisoa
   Rasoloarison Ratovoson Razafy Andrianantenaina Rakotondrazaka Ravelomanantsoa Voavy Razafindrabe`,
);
// Chewa, Tumbuka, Yao and Lomwe names of Malawi.
const MALAWIAN = pool(
  "malawian",
  `Chisomo Gift Chimwemwe Limbani Kondwani Chikondi Lameck Yamikani Mphatso Tawonga Blessings Dalitso Madalitso
   Chiyembekezo Pemphero Thokozani Zikani Wongani Mayamiko Chifundo Khuda Robin Micium Schumacher Righteous`,
  `Banda Phiri Mhone Msiska Mbewe Munthali Chirwa Nkhoma Chiumia Kamwendo Mwale Kumwenda Nyirenda Mhango Gondwe Kayira
   Mkandawire Msowoya Mzembe Ngwira Nyasulu Chavula Chipeta Chisale Jere Kalua Kanyenda Katsonga Luhanga Mwase
   Nyondo Tembo Zgambo Chirambo Chikoti Maliro Chinula Kaponda Mphande Mwenifumbo Mwakasungula Chimango Kamanga
   Makwinja`,
);
// Hassaniya (Moor), Halpulaar, Soninke and Wolof names of Mauritania.
const MAURITANIAN = pool(
  "mauritanian",
  `Mohamed Ahmed Sidi Cheikh Abdallahi Ahmedou Aboubakrine Moulaye Oumar Ely Brahim Yahya Isselmou Khalil Bakary
   Hamza Idrissa Souleymane Aly Salem Moctar Abdoul Hemeya Mamadou Nouh Taghi Sid'Ahmed Khassa Beyatt Oumarou`,
  `Ould Mohamed|Ould Ahmed|Ould Sidi|Ould Cheikh|Ould Brahim|Ould Abdallahi|Ould Bah|Ould Salem|Ould Ely|
   Ould Moctar|Ould Taleb|Ould Hamady|Ould Mahmoud|Ould Yahya|Ould Boubacar|Ould Mohamed Lemine|Ould Dellahi|
   Ould Abeid|Diagana|Camara|Soumaré|Touré|Dramé|Diarra|Sakho|Ba|Sy|Kane|Ly|Dia|Wane|Abeid|Bessam|Moctar|Dellahi|
   Yali|Beyatt|Coulibaly|Niang|Tandia|Gandega`,
);
// Creole, Indo-Mauritian and Sino-Mauritian names of Mauritius.
const MAURITIAN = pool(
  "mauritian",
  `Ravin Vikash Sunil Rajesh Ajay Kishan Dev Ashwin Jean Kevin Jonathan Fabrice Christopher Stéphane Bruno Cédric
   Mohamed Shahid Feroz Imran Yusuf Rashid Salim Irfan Jeremy Ryan Kersley Gurty Adrien Andy Ashley Vishal Nitesh
   Anand Faizal Nabil`,
  `Ramgoolam Jugnauth Seegobin Ramsamy Boodhoo Ramdanee Appadoo Beeharry Dookhee Naboth Lalanne Cotte Gaspard Pierre
   Ravina L'Enclume Cassam Joomun Hossen Peerun Goolam Issop Bholah Alladeen Perrine Jolicoeur Noël Duval Justin
   Marie Castel Legentil Casimir Ramdin Seetaram Jhurry Luchoomun Rughoobur Calambé Bru Aristide Lai Leung Kong`,
);
// Oshiwambo, Herero, Damara/Nama and Zambezi (Caprivi) names of Namibia.
const NAMIBIAN = pool(
  "namibian",
  `Petrus Paulus Johannes Absalom Eliphas Tangeni Pandu Simon Riaan Johan Willem Hendrik Collin Brian Jeremy Deon
   Ronald Benson Peter Prins Ananias Immanuel Elmo Charles Muna`,
  `Shikongo Amutenya Nangolo Shilongo Haimbili Uushona Tjipueja Katjizeu Iipinge Hamunyela Kambonde Nekundi Haufiku
   Ashipala Kaimbi Nghifikwa Tjiueza Kavetuna Kaputu Hengari Tjikuzu Muinjo Gaseb Hoaeb Nanuseb Gariseb Hoebeb Mubita
   Sitali Sililo Lutombi Mafwila Shalulile Amukwaya Nghipondoka Hotto Katua Keendjele Kamatuka Tjiveze`,
);
// Zarma-Songhai, Hausa, Kanuri and Tuareg names of Niger.
const NIGERIEN = pool(
  "nigerien",
  `Moussa Issa Abdou Ibrahim Amadou Oumarou Hassane Boubacar Souleymane Harouna Moumouni Seyni Issoufou Hamidou
   Mahamadou Idrissa Daouda Yacouba Kader Zakari Salissou Sabo`,
  `Issoufou Hamani Garba Moussa Mahamadou Amadou Soumana Oumarou Adamou Seyni Idrissa Mounkaila Hassane Abdou Djibo
   Maïga Zakari Sidikou Harouna Bako Souley Boubacar Illiassou Yacouba Ousmane Alhassane Salou Tahirou Chaibou
   Moumouni Hima Boureima Sanda Danjouma Karimou Kané Mamane Noma Sabo Wankoye`,
);
// Kinyarwanda and Kirundi family names (Rwanda, Burundi).
const GREAT_LAKES = pool(
  "great-lakes",
  "",
  `Mugisha Niyonzima Nsabimana Habimana Ndayishimiye Hakizimana Uwizeye Iradukunda Bizimana Mugiraneza Ndikumana
   Ndayizeye Bukuru Niyongabo Nshimirimana Nahimana Rukundo Manzi Mutsinzi Nshuti Sibomana Tuyisenge Twizerimana
   Uwimana Muhire Mukunzi Niyibizi Bayisenge Hategekimana Munyakazi Ndagijimana Nzeyimana Rwatubyaye Sekamana
   Usengimana Byiringiro Imanishimwe Kwizera Mugunga Nizeyimana Nsengiyumva Ruboneka Tuyishime Bigirimana Butoyi
   Irambona Mbazumutima Ndarusanze Ndayisaba Nduwimana Ngendakumana Nimubona Nzigamasabo Sinzinkayo`,
);
const SANTOMEAN = pool(
  "santomean",
  "",
  `Viegas|Vera Cruz|Nascimento|Espírito Santo|Carvalho|Borges|Ramos|Lima|Neves|Santos|Bragança|Costa|Dias|Fernandes|
   Graça|Menezes|Pinto|Quaresma|Sacramento|Salvaterra|Sousa|Tavares|Vaz|Afonso|Aguiar|Bandeira|Barros|Boa Morte|
   Ceita|Cravid|Daio|Lopes|Loureiro|Mendes|Pontes|Tiny|Trindade|Pires|Assunção|Bonfim`,
);
// Seychellois Creole names.
const SEYCHELLOIS = pool(
  "seychellois",
  `Jean Elijah Kevin Brandon Dylan Gavin Ralph Don Nigel Fabrice Colin Rodney Jude Alex Karl Stan Warren Glenny Hansel
   Leroy Terence Neil Bernard Philip Roddy Yannick Jovani Achille Denis Garry Keith`,
  `Hoareau Vidot Payet Gonthier Labrosse Louange Ernesta Rose Cesar Sinon Adrienne Albert Barbe Belle Bibi Bistoquet
   Cadeau Confait Dine Esparon Fanchette Freminot Isaac Labiche Laporte Lesperance Loizeau Marie Michel Moustache
   Nourrice Pillay Pool Quatre Rath Rosalie Servina Souffe Toussaint Vel Volcere Monthy`,
);
// Temne, Mende, Limba, Fula and Krio names of Sierra Leone.
const SIERRA_LEONEAN = pool(
  "sierra-leonean",
  "",
  `Kamara Sesay Bangura Koroma Conteh Turay Kallon Kargbo Cole Davies Williams Roberts Johnson Caulker Mansaray
   Fofanah Jalloh Bah Kanu Tarawallie Sillah Kabia Tucker Macauley Wilson Thomas Samura Dumbuya Yillah Lahai Gbondo
   Momoh Kpaka Sheriff Kuyateh Lansana Swaray Fornah Kondeh Marrah Bockarie Musa Vandi Senesie Fullah Sannoh Deen`,
);
// Dinka, Nuer, Bari, Zande and Shilluk names of South Sudan.
const SOUTH_SUDANESE = pool(
  "south-sudanese",
  `Deng Bol Dut Garang Kuol Lual Ajak Nyok Gatluak Gatwech Gatdet Gatkuoth Gatbel Gatmai Manyang Makuei Mabior Majok
   Malual Chol Ayuel Madut Thon Aguer Wani Lado Loku Tombe Juma Kenyi Modi Taban`,
  `Deng Bol Akol Dut Garang Kuol Lual Mabior Gatluak Gatwech Gatdet Gatkuoth Gatbel Gatmai Gatpan Gatjang Majok Makuei
   Manyang Malual Chol Thon Ayuel Madut Aguer Wani Lado Loku Tombe Kenyi Modi Taban Jada Lomoro Lemi Ladu Lam Koang
   Tut Nyuon Awer Mayen Ngor Arop`,
);
const SUDANESE = pool(
  "sudanese",
  `Mohamed Ahmed Omar Abdelrahman Mustafa Osman Hassan Hussein Salah Mazin Walieldin Ramadan Faisal Mohanad Ammar
   Bakri Sadam Yasir Musab Amir Abuaagla Altahir Ibrahim Khalid Hamza Nazar Tayeb Elsadig Muawia Mujahid Abdelaziz
   Hamid Bashir Awad Sharaf`,
  `Abdalla Ahmed Babiker Eltayeb Elamin Hamid Ibrahim Idris Ismail Khalil Mahgoub Mirghani Musa Nour Osman Saeed
   Salih Suleiman Taha Yousif Adam Elhadi Elnour Elsheikh Hassan Mustafa Omer Abdelgadir Bakheit Elfatih Gasim Khidir
   Mahmoud Siddig Tambal Wagdi Ali Hamad Fadlallah Yagoub Zakaria Elrasheed Karshoum Eltahir Abdelmoneim`,
);
// Swahili and Tanzanian mainland names (Chagga, Haya, Nyakyusa, Sukuma...).
const SWAHILI = pool(
  "swahili",
  `Juma Hassan John Kelvin Baraka Salum Ibrahim Simon David Ramadhani Emmanuel Peter Athumani Bakari Feisal Himid Iddi
   Mudathir Mzamiru Shomari Yahya Nassor Haji Omary Selemani Mussa Rashidi Hamisi Khamis Faraji Makame Mohamedi
   Abdulrazak Dickson Erasto Kassim Yusuph Clement`,
  `Msuya Mushi Komba Mwakalinga Massawe Mollel Mboya Kimaro Mwakyembe Nyoni Mtega Shomari Kapombe Mkude Mwamnyeto
   Mhilu Makame Kaseke Magige Salum Mohamed Juma Hamisi Rashid Kessy Msolla Lema Swai Tarimo Kiwelu Minja Urassa
   Mrema Mwaipopo Kasanga Chande Seif Abeid Kibwana Mzize Nondo Mapunda Kitwana Mwinyi Ngassa Shabani Ally`,
);
// Baganda, Basoga, Acholi, Langi and Banyankole names of Uganda.
const UGANDAN = pool(
  "ugandan",
  `Farouk Muzamiru Shafik Hassan Ronald Allan Denis Isaac Moses Brian Joseph Patrick Geoffrey Emmanuel Robert Milton`,
  `Okello Kato Mugisha Ssekabira Walusimbi Ssentongo Otim Waiswa Kizito Lubega Ssemakula Mugerwa Ochan Aucho
   Byaruhanga Kasozi Kateregga Kyambadde Lwasa Magembe Mukasa Mutyaba Nsubuga Ochaya Odongo Ojok Okot Onen Oryem
   Sekajja Semwanga Ssebagala Ssekiganda Ssenyonga Ssewankambo Tumusiime Twinomugisha Wasswa Watambala Alionzi
   Bakaki Kabugo Kagimu Katende Kigozi Kiwanuka Lukwago Mayanja Musoke Ndugwa Obua Ssempijja Tumwine Opio Ogwang`,
);
// Bemba, Nyanja, Tonga and Lozi names of Zambia.
const ZAMBIAN = pool(
  "zambian",
  `Kennedy Lameck Kelvin Enock Kings Mwila Chanda Mwape Chaswe Kabaso Tandi Kalengo Chisamba Golden Aaron Prince`,
  `Banda Phiri Mwansa Mulenga Chanda Chisala Tembo Bwalya Mumba Lungu Sinkala Chongo Mwale Kasonde Musonda Mutale
   Sakala Daka Mbewe Nkhoma Kalaba Katongo Mayuka Sunzu Kangwa Kabwe Chilufya Chileshe Chola Chimfwembe Kasanda
   Katebe Mbao Mweemba Mweene Mukuka Mwila Nyirenda Sichone Siame Sikazwe Simataa Zulu Mpundu Nsama Mubanga Chibwe
   Kalumba Munsaka Hamoonga Mudenda Chabala`,
);

// ------------------------------------------------------------------ Morocco

const MA: NationSpec = {
  code: "MA",
  iso2: "MA",
  name: "Morocco",
  confederation: "CAF",
  continent: "AF",
  capital: "Rabat",
  latitude: 34,
  languages: languages("ar:6 zgh:2 fr:2"),
  reputation: { national: 82, league: 58 },
  euEea: false,
  physique: { height: 179 },
  names: {
    given: [src("moroccan", 5), src("amazigh", 1)],
    family: [src("moroccan", 5), src("amazigh", 2)],
  },
  nationality: {
    // The most diaspora-shaped national team in football: Europe-born dual nationals from FR, BE, NL, ES and IT.
    multipleRate: 0.34,
    tripleRate: 0.03,
    bornAbroadRate: 0.22,
    diasporaPull: 0.8,
    links: [
      ...links("frenchAfrica", "FR:12 ES:9 NL:9 BE:8 IT:5"),
      ...links("crossBorder", "DE:3"),
      ...links("americas", "CA:2 US:1"),
    ],
    // Moroccan nationality is kept for life; dual nationality is accepted.
    citizenship: allowed,
  },
  cities: {
    major: [
      city("Casablanca", "mega", "Casablanca-Settat", 4, "Aïn Sebaâ|Hay Mohammadi|Derb Sultan|Maârif|Ben M'Sick|Sidi Moumen|Aïn Chock"),
      city("Rabat", "large", "Rabat-Salé-Kénitra", 2, "Agdal|Hay Riad|Akkari"),
      city("Fès", "large", "Fès-Meknès", 2, "Zouagha|Saïss|Fès Jdid"),
      city("Marrakech", "large", "Marrakech-Safi", 2, "Guéliz|Daoudiate|Mhamid"),
      city("Tanger", "large", "Tanger-Tétouan-Al Hoceïma", 2, "Beni Makada|Charf|Mghogha"),
      city("Agadir", "large", "Souss-Massa", 2, "Tikiouine|Bensergao|Talborjt"),
      city("Salé", "large", "Rabat-Salé-Kénitra", 1),
      city("Meknès", "large", "Fès-Meknès", 1),
      city("Oujda", "large", "Oriental", 1),
      city("Kénitra", "large", "Rabat-Salé-Kénitra", 1),
      city("Tétouan", "large", "Tanger-Tétouan-Al Hoceïma", 1),
      city("Témara", "medium", "Rabat-Salé-Kénitra", 1),
      city("Safi", "medium", "Marrakech-Safi", 1),
      city("Mohammédia", "medium", "Casablanca-Settat", 1),
      city("El Jadida", "medium", "Casablanca-Settat", 1),
      city("Khouribga", "medium", "Béni Mellal-Khénifra", 1),
      city("Béni Mellal", "medium", "Béni Mellal-Khénifra", 1),
      city("Nador", "medium", "Oriental", 1),
      city("Taza", "medium", "Fès-Meknès", 1),
      city("Settat", "medium", "Casablanca-Settat", 1),
      city("Berrechid", "medium", "Casablanca-Settat", 1),
      city("Khémisset", "small", "Rabat-Salé-Kénitra"),
      city("Inezgane", "small", "Souss-Massa"),
      city("Ksar El Kébir", "small", "Tanger-Tétouan-Al Hoceïma"),
      city("Larache", "small", "Tanger-Tétouan-Al Hoceïma"),
      city("Guelmim", "small", "Guelmim-Oued Noun"),
      city("Berkane", "small", "Oriental"),
      city("Taourirt", "small", "Oriental"),
      city("Errachidia", "small", "Drâa-Tafilalet"),
      city("Ouarzazate", "small", "Drâa-Tafilalet"),
      city("Tiznit", "small", "Souss-Massa"),
      city("Taroudant", "small", "Souss-Massa"),
      city("Essaouira", "small", "Marrakech-Safi"),
      city("Al Hoceïma", "small", "Tanger-Tétouan-Al Hoceïma"),
      city("Khénifra", "small", "Béni Mellal-Khénifra"),
      city("Sidi Kacem", "small", "Rabat-Salé-Kénitra"),
      city("Oued Zem", "town", "Béni Mellal-Khénifra"),
      city("Youssoufia", "town", "Marrakech-Safi"),
      city("Benslimane", "town", "Casablanca-Settat"),
      city("Zemamra", "town", "Casablanca-Settat"),
      city("Tiflet", "town", "Rabat-Salé-Kénitra"),
      city("Azrou", "town", "Fès-Meknès"),
      city("Sefrou", "town", "Fès-Meknès"),
      city("Fquih Ben Salah", "town", "Béni Mellal-Khénifra"),
      city("Ben Guerir", "town", "Marrakech-Safi"),
      city("Guercif", "town", "Oriental"),
    ],
  },
  football: singleTier(
    {
      tier: 1,
      // Botola Pro Inwi without the sponsor.
      name: "Botola Pro",
      shortName: "Botola",
      size: 16,
      status: "professional",
      reputation: 58,
      clubs: {
        reputation: { top: 64, bottom: 47 },
        giants: { count: 3, top: 74, bottom: 69 },
        capacity: { top: 67_000, bottom: 5_000 },
        facilities: { top: 80, bottom: 48 },
        academy: { top: 82, bottom: 48 },
        wageBill: { top: 11_000_000, bottom: 800_000 },
        transferBudget: { top: 5_000_000, bottom: 30_000 },
        foreignShare: 0.15,
        squadSize: [27, 32],
      },
    },
    {
      cups: [
        { kind: "national", name: "Coupe du Trône", seededEntry: true, legs: 1, neutralFinal: true, continental: true },
      ],
      youth: youthSingle("Championnat National U19", "Championnat National U17", 8, "Nord|Sud"),
      clubNaming: {
        templates: templates(
          `Chabab {city}:3; Ittihad {city}:3; Olympique {city}:2; Renaissance {city}:2; Raja {city}:1; Wydad {city}:1;
           Moghreb {city}:1; Kawkab {city}:1; Mouloudia {city}:1; Difaâ {city}:1; Najm {city}:1; Hilal {city}:1;
           Nahdat {city}:1; Wifaq {city}:1; Amal {city}:1; Racing {city}:1; Stade {city}:1; Jeunesse {city}:1;
           Rapide {city}:1; Fath {city}:1; Union {city}:1`,
        ),
        founded: { top: [1917, 1983], bottom: [1935, 2012] },
        avoid: list(
          `Raja Casablanca|Raja Club Athletic|Wydad Casablanca|Wydad Athletic Club|AS FAR|FAR Rabat|FUS Rabat|
           Fath Union Sport|RS Berkane|Renaissance Berkane|Maghreb Fès|MAS Fès|Wydad Fès|Hassania Agadir|Ittihad Tanger|
           Moghreb Tétouan|Olympique Safi|Olympic Safi|Difaâ El Jadida|Difaa Hassani El Jadidi|Kawkab Marrakech|
           Mouloudia Oujda|Chabab Mohammédia|Renaissance Zemamra|Union Touarga|Olympique Khouribga|Jeunesse Soualem|
           Stade Marocain|Rapide Oued Zem|Youssoufia Berrechid|Chabab Rif Al Hoceïma|Racing Casablanca|
           Tihad Casablanca|Rachad Bernoussi|Ittihad Khémisset|Kénitra AC|Wydad Témara|Chabab Ben Guerir|
           Olympique Dcheira|Najm Anza|Amal Tiznit|Raja Béni Mellal|Raja Agadir|Union Sidi Kacem|
           Chabab Atlas Khénifra|Hilal Nador|Mouloudia Dakhla|Najah Souss|Widad Serghini|Club Omnisports de Meknès|
           Union Yaacoub El Mansour|Majd Casablanca|Hassania Benslimane|Chabab Houara|Olympique Youssoufia|
           Amal Belksiri|Hilal Tarrast|Union Aït Melloul`,
        ),
        colors: ["#C1272D", "#006233", "#000000", "#FFFFFF", "#F7941D", "#FFD100", "#1D4E9E", "#6D2077", "#00A3E0"],
      },
      importSources: weighted(
        "SN:8 CI:6 ML:6 CD:5 BF:4 CM:4 GN:4 NG:3 GH:3 CG:3 GA:2 NE:2 BJ:2 TG:2 MR:2 LY:2 TN:2 BR:2 CO:1 FR:1",
      ),
      coefficients: { association: [17, 17.5, 18.5, 19, 19.5] },
    },
  ),
  abroad: {
    seniors: 130,
    youth: 24,
    destinations: weighted(
      "FR:16 ES:12 BE:10 NL:10 SA:8 QA:6 TR:6 IT:5 AE:5 PT:4 DE:4 EN:3 GR:2 CH:2 US:2 EG:2",
    ),
  },
};

// ------------------------------------------------------------------ Egypt

const EG: NationSpec = {
  code: "EG",
  iso2: "EG",
  name: "Egypt",
  confederation: "CAF",
  continent: "AF",
  capital: "Cairo",
  latitude: 30,
  languages: languages("ar:1"),
  reputation: { national: 74, league: 60 },
  euEea: false,
  physique: { height: 179 },
  // Egyptian naming: given name plus the father's name, so family names are often given names.
  names: { given: [src("egyptian")], family: [src("egyptian")] },
  nationality: {
    // Mostly home-grown; small groups born in the Gulf, the UK, the US or Europe, and Sudanese/Palestinian roots.
    multipleRate: 0.15,
    tripleRate: 0.01,
    bornAbroadRate: 0.07,
    diasporaPull: 0.55,
    links: [
      ...links("arabWorld", "SA:3 SD:2 PS:2 AE:1 LY:1 JO:1"),
      ...links("commonwealth", "EN:3 US:3 CA:1"),
      ...links("mediterranean", "IT:2 FR:2 GR:1 DE:1"),
    ],
    // Dual nationality is permitted with Interior Ministry approval.
    citizenship: allowed,
  },
  cities: {
    major: [
      city("Cairo", "mega", "Cairo", 7, "Nasr City|Heliopolis|Maadi|Shubra|Helwan|Abbassia|Ain Shams|El Marg|Mokattam"),
      city("Alexandria", "mega", "Alexandria", 4, "Moharram Bey|Sidi Gaber|Montaza|Agami|Borg El Arab"),
      city("Giza", "mega", "Giza", 3, "Dokki|Imbaba|Haram|6th of October"),
      city("Shubra El Kheima", "large", "Qalyubia", 1),
      city("Port Said", "large", "Port Said", 1),
      city("Suez", "large", "Suez", 1),
      city("Mansoura", "large", "Dakahlia", 1),
      city("El Mahalla El Kubra", "large", "Gharbia", 1),
      city("Tanta", "large", "Gharbia", 1),
      city("Ismailia", "large", "Ismailia", 1),
      city("Zagazig", "large", "Sharqia", 1),
      city("Asyut", "large", "Asyut", 1),
      city("Faiyum", "large", "Faiyum", 1),
      city("Damanhur", "large", "Beheira", 1),
      city("Minya", "large", "Minya", 1),
      city("Beni Suef", "medium", "Beni Suef", 1),
      city("Sohag", "medium", "Sohag", 1),
      city("Qena", "medium", "Qena", 1),
      city("Aswan", "medium", "Aswan", 1),
      city("Luxor", "medium", "Luxor", 1),
      city("Damietta", "medium", "Damietta", 1),
      city("Kafr El Sheikh", "medium", "Kafr El Sheikh", 1),
      city("Shibin El Kom", "medium", "Monufia", 1),
      city("Banha", "medium", "Qalyubia", 1),
      city("Hurghada", "medium", "Red Sea", 1),
      city("10th of Ramadan", "medium", "Sharqia", 1),
      city("Kafr El Dawwar", "medium", "Beheira", 1),
      city("Arish", "medium", "North Sinai", 1),
      city("Marsa Matruh", "small", "Matruh"),
      city("El Obour", "small", "Qalyubia"),
      city("Sadat City", "small", "Monufia"),
      city("Mallawi", "small", "Minya"),
      city("Desouk", "small", "Kafr El Sheikh"),
      city("Bilbeis", "small", "Sharqia"),
      city("Sharm El Sheikh", "small", "South Sinai"),
      city("El Gouna", "town", "Red Sea"),
    ],
  },
  football: singleTier(
    {
      tier: 1,
      // 2025/26: 21 clubs play one round-robin, then the top 7 (double) and bottom 14 (single) play on in groups.
      name: "Egyptian Premier League",
      shortName: "EPL",
      size: 21,
      roundRobins: 1,
      split: {
        groups: [
          { name: "Championship Group", positions: [1, 7], roundRobins: 2, points: "full" },
          { name: "Relegation Group", positions: [8, 21], roundRobins: 1, points: "full" },
        ],
      },
      status: "professional",
      reputation: 60,
      clubs: {
        reputation: { top: 65, bottom: 44 },
        giants: { count: 3, top: 77, bottom: 71 },
        capacity: { top: 75_000, bottom: 5_000 },
        facilities: { top: 80, bottom: 45 },
        academy: { top: 80, bottom: 45 },
        wageBill: { top: 22_000_000, bottom: 700_000 },
        transferBudget: { top: 12_000_000, bottom: 50_000 },
        foreignShare: 0.12,
        squadSize: [28, 32],
      },
    },
    {
      cups: [
        { kind: "national", name: "Egypt Cup", seededEntry: true, legs: 1, neutralFinal: true, continental: true },
        { kind: "league", name: "Egyptian League Cup", legs: 1, neutralFinal: true },
        {
          kind: "super",
          name: "Egyptian Super Cup",
          participants: ["champion", "runner-up", "cup-winner", "league-cup-winner"],
          neutralFinal: true,
          start: "10-20",
        },
      ],
      youth: youthSingle("Egyptian Youth League U-19", "Egyptian Youth League U-17", 11, "Group A|Group B"),
      // Arabic "Al/El" forms, town sporting clubs and the company clubs that dominate the league.
      clubNaming: {
        templates: templates(
          `{city} SC:3; Al Ittihad {city}:2; Ghazl {city}:1; Baladeyet {city}:1; Nogoom {city}:1; Shabab {city}:1;
           El Nasr {city}:1; El Sekka {city}:1; Petrol {city}:1; Kahraba {city}:1; Asmant {city}:1; Montakhab {city}:1;
           {city} Petroleum:1; {city} Contractors:1; {city} Fertilizers:1; Telecom {city}:1; Al Hilal {city}:1`,
        ),
        founded: { top: [1907, 2012], bottom: [1920, 2020] },
        avoid: list(
          `Al Ahly|Zamalek|Pyramids|Al Masry|Ismaily|Al Ittihad Alexandria|Ittihad Alexandria|Smouha|ENPPI|Petrojet|
           Arab Contractors|El Mokawloon|Tala'ea El Gaish|Haras El Hodoud|El Dakhleya|National Bank of Egypt|
           Ceramica Cleopatra|Pharco|Ghazl El Mahalla|Modern Sport|ZED|Wadi Degla|El Gouna|Kahraba Ismailia|Aswan|
           Misr Lel Makkasa|Tanta|El Sharkia|Beni Suef|Mansoura|El Mansoura|Baladeyet El Mahalla|Petrol Asyut|
           La Viena|Abou Qir Fertilizers|El Raja|Tersana|El Qanah|Suez|Montakhab Suez|Ghazl Suez|Asmant Suez|Nogoom|
           Olympic Club|Sporting Alexandria|El Sekka El Hadid|Al Nasr|El Entag El Harby|Telecom Egypt|Dikernis|
           Kafr El Sheikh|El Minya|Minya|Damanhour|Damanhur|Sohag|Faiyum|Port Fouad|Asyut Petroleum|Al Hilal Marsa Matruh`,
        ),
        colors: ["#E30613", "#FFFFFF", "#000000", "#00843D", "#1E3A8A", "#FFD100", "#6CACE4", "#7A263A"],
      },
      importSources: weighted(
        "MA:5 TN:5 GH:4 NG:3 ML:3 BF:3 CD:3 CI:3 PS:3 GN:2 CM:2 SN:2 KE:2 UG:2 ZA:2 LY:2 SD:2 JO:1 AO:1 BR:1",
      ),
      coefficients: { association: [18, 19, 18.5, 19.5, 20] },
    },
  ),
  abroad: {
    seniors: 32,
    youth: 6,
    destinations: weighted("SA:8 AE:4 QA:3 EN:2 FR:2 BE:2 DE:2 TR:2 PT:1 NL:1 ES:1 GR:1 US:1"),
  },
};

// ------------------------------------------------------------------ Nigeria

const NG: NationSpec = {
  code: "NG",
  iso2: "NG",
  name: "Nigeria",
  confederation: "CAF",
  continent: "AF",
  capital: "Abuja",
  latitude: 9.1,
  languages: languages("en:6 ha:3 yo:3 ig:3"),
  reputation: { national: 74, league: 40 },
  euEea: false,
  physique: { height: 181 },
  names: {
    given: [src("anglophone", 4), src("yoruba", 3), src("igbo", 3), src("hausa", 3), src("niger-delta", 1)],
    family: [src("yoruba", 4), src("igbo", 4), src("hausa", 3), src("niger-delta", 2)],
  },
  nationality: {
    // London-, Dublin-, US- and Italy-born players of Nigerian parents (a large part of the Super Eagles).
    multipleRate: 0.28,
    tripleRate: 0.03,
    bornAbroadRate: 0.14,
    diasporaPull: 0.6,
    links: [
      ...links("commonwealth", "EN:12 US:7 CA:3 IE:3"),
      ...links("regional", "GH:6 CM:3 BJ:3 NE:2"),
      ...links("mediterranean", "IT:3 ES:1"),
      ...links("crossBorder", "DE:2"),
    ],
    // Citizens by birth keep Nigerian nationality alongside another.
    citizenship: allowed,
  },
  cities: {
    major: [
      city("Lagos", "mega", "Lagos", 5, "Surulere|Ikeja|Ikorodu|Lekki|Agege|Ajegunle|Yaba"),
      city("Kano", "mega", "Kano", 3, "Fagge|Nassarawa|Kumbotso"),
      city("Ibadan", "mega", "Oyo", 3, "Bodija|Mokola|Challenge"),
      city("Abuja", "large", "FCT", 2, "Garki|Wuse|Gwagwalada"),
      city("Port Harcourt", "large", "Rivers", 2, "Diobu|Borokiri|Rumuokoro"),
      city("Benin City", "large", "Edo", 2, "Uselu|Ikpoba Hill"),
      city("Kaduna", "large", "Kaduna", 2, "Kawo|Tudun Wada"),
      city("Aba", "large", "Abia", 1),
      city("Onitsha", "large", "Anambra", 1),
      city("Enugu", "large", "Enugu", 1),
      city("Jos", "large", "Plateau", 1),
      city("Ilorin", "large", "Kwara", 1),
      city("Maiduguri", "large", "Borno", 1),
      city("Zaria", "large", "Kaduna", 1),
      city("Warri", "medium", "Delta", 1),
      city("Uyo", "medium", "Akwa Ibom", 1),
      city("Owerri", "medium", "Imo", 1),
      city("Abeokuta", "medium", "Ogun", 1),
      city("Akure", "medium", "Ondo", 1),
      city("Calabar", "medium", "Cross River", 1),
      city("Sokoto", "medium", "Sokoto", 1),
      city("Bauchi", "medium", "Bauchi", 1),
      city("Katsina", "medium", "Katsina", 1),
      city("Osogbo", "medium", "Osun", 1),
      city("Ado-Ekiti", "medium", "Ekiti", 1),
      city("Makurdi", "medium", "Benue", 1),
      city("Minna", "medium", "Niger", 1),
      city("Gombe", "medium", "Gombe", 1),
      city("Yola", "medium", "Adamawa", 1),
      city("Ogbomosho", "medium", "Oyo", 1),
      city("Ile-Ife", "medium", "Osun", 1),
      city("Lafia", "small", "Nasarawa"),
      city("Lokoja", "small", "Kogi"),
      city("Asaba", "small", "Delta"),
      city("Umuahia", "small", "Abia"),
      city("Awka", "small", "Anambra"),
      city("Sagamu", "small", "Ogun"),
      city("Ijebu-Ode", "small", "Ogun"),
      city("Ilesa", "small", "Osun"),
      city("Nnewi", "small", "Anambra"),
      city("Nsukka", "small", "Enugu"),
      city("Jalingo", "small", "Taraba"),
      city("Damaturu", "small", "Yobe"),
      city("Birnin Kebbi", "small", "Kebbi"),
      city("Gusau", "small", "Zamfara"),
      city("Dutse", "small", "Jigawa"),
      city("Yenagoa", "small", "Bayelsa"),
      city("Eket", "small", "Akwa Ibom"),
      city("Ikot Ekpene", "small", "Akwa Ibom"),
      city("Sapele", "small", "Delta"),
      city("Ughelli", "small", "Delta"),
      city("Ondo", "small", "Ondo"),
      city("Offa", "small", "Kwara"),
      city("Abakaliki", "small", "Ebonyi"),
      city("Bida", "small", "Niger"),
      city("Ikenne", "town", "Ogun"),
      city("Keffi", "town", "Nasarawa"),
      city("Kafanchan", "town", "Kaduna"),
      city("Okigwe", "town", "Imo"),
      city("Gboko", "town", "Benue"),
    ],
  },
  football: {
    leagues: [
      {
        tier: 1,
        name: "Nigeria Premier Football League",
        shortName: "NPFL",
        size: 20,
        status: "professional",
        reputation: 40,
        clubs: {
          reputation: { top: 58, bottom: 40 },
          capacity: { top: 38_000, bottom: 3_000 },
          facilities: { top: 45, bottom: 22 },
          academy: { top: 56, bottom: 30 },
          wageBill: { top: 900_000, bottom: 150_000 },
          transferBudget: { top: 150_000, bottom: 0 },
          foreignShare: 0.03,
          squadSize: [28, 32],
        },
      },
      {
        tier: 2,
        // Real NNL: four regional groups (North A/B, South A/B) and a Super Eight that promotes four; merged into
        // two conferences of 12.
        name: "Nigeria National League",
        shortName: "NNL",
        size: 24,
        conferences: ["Northern Conference", "Southern Conference"],
        status: "semi-professional",
        reputation: 28,
        clubs: {
          reputation: { top: 38, bottom: 24 },
          capacity: { top: 15_000, bottom: 1_500 },
          facilities: { top: 30, bottom: 12 },
          academy: { top: 42, bottom: 20 },
          wageBill: { top: 250_000, bottom: 30_000 },
          transferBudget: { top: 20_000, bottom: 0 },
          foreignShare: 0.01,
          squadSize: [25, 30],
        },
      },
    ],
    // Two per NNL conference go up (the real Super Eight promotes four).
    movement: [{ upper: 1, promoted: 4, relegated: 4, perConference: true }],
    cups: [
      { kind: "national", name: "President Federation Cup", seededEntry: true, legs: 1, neutralFinal: true, continental: true },
    ],
    youth: youth(
      [division("NPFL Youth League", [1, 1], 10, "Northern|Southern"), division("NNL Youth League", [2, 2], 12, "Northern|Southern")],
      [division("NPFL U-17 League", [1, 1], 10, "Northern|Southern"), division("NNL U-17 League", [2, 2], 12, "Northern|Southern")],
    ),
    reserves: { mode: "none" },
    // City names with the Nigerian nicknames (United, Stars, Rangers, Pillars, Warriors, Tornadoes...).
    clubNaming: {
      templates: templates(
        `{city} United:3; {city} Stars:3; {city} City:2; {city} Rangers:2; {city} Warriors:2; {city} Tornadoes:1;
         {city} Pillars:1; {city} Sharks:1; {city} Wolves:1; {city} Lions:1; {city} Leopards:1; {city} Royals:1;
         {city} Rovers:1; {city} Crusaders:1; {city} Strikers:1; {region} United:1; {region} Stars:1`,
      ),
      founded: { top: [1945, 2015], bottom: [1960, 2022] },
      avoid: list(
        `Enyimba|Rangers International|Enugu Rangers|Kano Pillars|Rivers United|Shooting Stars|Remo Stars|Plateau United|
         Kwara United|Akwa United|Katsina United|Nasarawa United|Niger Tornadoes|Lobi Stars|Sunshine Stars|
         Bendel Insurance|Abia Warriors|Heartland|Bayelsa United|El-Kanemi Warriors|Wikki Tourists|Gombe United|
         Sporting Lagos|Ikorodu City|Doma United|Kun Khalifat|Warri Wolves|Kada City|Barau|Nembe City|Ocean Boys|
         Dolphins|Sharks|Port Harcourt Sharks|Gateway United|Mighty Jets|Julius Berger|Kogi United|Ekiti United|
         Osun United|Adamawa United|Sokoto United|Kebbi United|Zamfara United|Delta Force|Yobe Desert Stars|
         Jigawa Golden Stars|Taraba|Crown|Beyond Limits|Ranchers Bees|Kaduna United|Calabar Rovers|Stationery Stores|
         Iwuanyanwu Nationale|Leventis United|Abiola Babes|Racca Rovers|BCC Lions|First Bank|Kwara Stars|Lagos United|
         Enugu United|Abuja United|Kano United|Ibadan United|Benin United|Owerri United|Aba United`,
      ),
      colors: ["#008751", "#FFFFFF", "#E30613", "#FFD100", "#1C39BB", "#000000", "#F58220", "#6CACE4"],
    },
    importSources: weighted("GH:4 CM:3 BJ:3 NE:2 TG:2 CI:1 CD:1 LR:1 ML:1 BF:1"),
    coefficients: { association: [6, 5, 5.5, 6.5, 6] },
  },
  abroad: {
    seniors: 220,
    youth: 30,
    destinations: weighted(
      `TR:10 BE:8 PT:7 FR:6 EN:6 IT:5 ES:4 DE:4 GR:4 CY:4 SA:4 US:4 NL:3 SE:3 NO:3 DK:3 RU:3 AE:3 MA:3 ZA:3 AT:2 CH:2
       QA:2 EG:2 TN:2 IN:2 FI:2 MT:2 LV:1 LT:1 RO:1 BG:1`,
    ),
  },
};

// ------------------------------------------------------------------ Senegal

const SN: NationSpec = {
  code: "SN",
  iso2: "SN",
  name: "Senegal",
  confederation: "CAF",
  continent: "AF",
  capital: "Dakar",
  latitude: 14.7,
  languages: languages("fr:4 wo:6 ff:1"),
  reputation: { national: 80, league: 38 },
  euEea: false,
  physique: { height: 183 },
  names: {
    given: [src("senegalese", 4), faker("fr_SN", 3), src("fula", 2), src("mande", 1)],
    family: [src("senegalese", 5), faker("fr_SN", 3), src("fula", 2), src("mande", 1)],
  },
  nationality: {
    // France-born Senegalese (and Italy/Spain-born) are a large part of the Lions de la Teranga.
    multipleRate: 0.3,
    tripleRate: 0.03,
    bornAbroadRate: 0.16,
    diasporaPull: 0.7,
    links: [
      ...links("frenchAfrica", "FR:12 IT:5 ES:4 BE:2"),
      ...links("regional", "GM:6 ML:5 GN:5 MR:3 CV:2 GW:2"),
      ...links("americas", "US:1"),
    ],
    citizenship: allowed,
  },
  cities: {
    major: [
      city("Dakar", "mega", "Dakar", 4, "Médina|Grand Yoff|Parcelles Assainies|Yoff|Colobane|Fass|Hann|Liberté"),
      city("Pikine", "large", "Dakar", 2, "Thiaroye|Keur Massar"),
      city("Guédiawaye", "large", "Dakar", 1),
      city("Touba", "large", "Diourbel", 1),
      city("Thiès", "large", "Thiès", 2, "Nguinth|Randoulène"),
      city("Rufisque", "medium", "Dakar", 1),
      city("Kaolack", "medium", "Kaolack", 1),
      city("Mbour", "medium", "Thiès", 1),
      city("Saint-Louis", "medium", "Saint-Louis", 1),
      city("Ziguinchor", "medium", "Ziguinchor", 1),
      city("Diourbel", "medium", "Diourbel", 1),
      city("Louga", "small", "Louga"),
      city("Tambacounda", "small", "Tambacounda"),
      city("Kolda", "small", "Kolda"),
      city("Richard-Toll", "small", "Saint-Louis"),
      city("Mbacké", "small", "Diourbel"),
      city("Tivaouane", "small", "Thiès"),
      city("Joal-Fadiouth", "town", "Thiès"),
      city("Fatick", "town", "Fatick"),
      city("Kaffrine", "town", "Kaffrine"),
      city("Kédougou", "town", "Kédougou"),
      city("Sédhiou", "town", "Sédhiou"),
      city("Matam", "town", "Matam"),
      city("Bignona", "town", "Ziguinchor"),
      city("Dagana", "town", "Saint-Louis"),
      city("Linguère", "town", "Louga"),
      city("Nioro du Rip", "town", "Kaolack"),
      city("Diamniadio", "town", "Dakar"),
      city("Bargny", "town", "Dakar"),
      city("Mboro", "town", "Thiès"),
      city("Kébémer", "town", "Louga"),
    ],
  },
  football: singleTier(
    {
      tier: 1,
      name: "Ligue 1",
      shortName: "L1",
      size: 16,
      status: "professional",
      reputation: 38,
      clubs: {
        reputation: { top: 52, bottom: 36 },
        capacity: { top: 50_000, bottom: 2_000 },
        facilities: { top: 55, bottom: 25 },
        // Génération Foot, Diambars and Dakar Sacré-Cœur are elite academies.
        academy: { top: 78, bottom: 35 },
        wageBill: { top: 600_000, bottom: 150_000 },
        transferBudget: { top: 300_000, bottom: 0 },
        foreignShare: 0.04,
        squadSize: [26, 30],
      },
    },
    {
      cups: [
        { kind: "national", name: "Coupe du Sénégal", seededEntry: true, legs: 1, neutralFinal: true, continental: true },
        { kind: "league", name: "Coupe de la Ligue", legs: 1, neutralFinal: true },
        { kind: "super", name: "Trophée des Champions", participants: ["champion", "cup-winner"], neutralFinal: true },
      ],
      youth: youthSingle("Championnat National U19", "Championnat National U17", 8, "Poule A|Poule B"),
      clubNaming: {
        templates: templates(
          `ASC {city}:3; AS {city}:2; US {city}:2; {city} FC:2; Stade de {city}:1; Olympique de {city}:1;
           Étoile de {city}:1; Jeunesse de {city}:1; Espoir de {city}:1; CS {city}:1; {city} Académie:1; Jaraaf {city}:1`,
        ),
        founded: { top: [1929, 2010], bottom: [1950, 2018] },
        avoid: list(
          `ASC Jaraaf|Jaraaf|Casa Sports|US Gorée|Génération Foot|Teungueth|Dakar Sacré-Cœur|Diambars|Guédiawaye|
           AS Pikine|Stade de Mbour|Jamono Fatick|Wallydaan|AJEL Rufisque|Sonacos|US Ouakam|Niarry Tally|
           Mbour Petite-Côte|ASC Linguère|Linguère|AS Douanes|Olympique de Ngor|US Rail|ASC HLM|Port Autonome|
           Jeanne d'Arc|Espoirs de Guédiawaye|ASC Thiès|AS Saloum|Ndiambour|ASC Ndiambour|Renaissance de Dakar|
           ASC Diaraf|SUNEOR|Keur Madior`,
        ),
        colors: ["#00853F", "#FDEF42", "#E31B23", "#FFFFFF", "#000000", "#1F4E9E", "#F58220"],
      },
      importSources: weighted("GM:4 GN:4 ML:3 GW:3 MR:2 CI:1 BF:1 CV:1"),
      coefficients: { association: [2.5, 3, 3.5, 4, 5] },
    },
  ),
  abroad: {
    seniors: 200,
    youth: 30,
    destinations: weighted(
      "FR:22 BE:7 IT:6 ES:6 TR:6 PT:5 EN:4 SA:4 DE:3 NO:3 CH:3 QA:3 MA:3 SE:2 DK:2 AT:2 NL:2 AE:2 US:2 GR:2 CY:2 TN:1 DZ:1",
    ),
  },
};

// ------------------------------------------------------------------ Algeria

const DZ: NationSpec = {
  code: "DZ",
  iso2: "DZ",
  name: "Algeria",
  confederation: "CAF",
  continent: "AF",
  capital: "Alger",
  latitude: 36.8,
  languages: languages("ar:6 fr:3 kab:2"),
  reputation: { national: 74, league: 55 },
  euEea: false,
  physique: { height: 180 },
  names: {
    given: [src("algerian", 5), src("amazigh", 2)],
    family: [src("algerian", 5), src("amazigh", 2)],
  },
  nationality: {
    // France-born binationals regularly make up more than half of the national squad.
    multipleRate: 0.36,
    tripleRate: 0.03,
    bornAbroadRate: 0.25,
    diasporaPull: 0.75,
    links: [
      ...links("frenchAfrica", "FR:14 BE:2 CH:1"),
      ...links("arabWorld", "TN:3 MA:1"),
      ...links("crossBorder", "ES:1 DE:1"),
      ...links("americas", "CA:2"),
    ],
    citizenship: allowed,
  },
  cities: {
    major: [
      city("Alger", "mega", "Alger", 4, "Bab Ezzouar|Dar El Beïda|Chéraga|Birkhadem|Bouzaréah|Baraki|Rouïba|Draria"),
      city("Oran", "mega", "Oran", 3, "Es Sénia|Bir El Djir|Sidi El Houari"),
      city("Constantine", "large", "Constantine", 2, "El Khroub|Ali Mendjeli"),
      city("Annaba", "large", "Annaba", 2, "El Bouni|Sidi Amar"),
      city("Blida", "large", "Blida", 2, "Ouled Yaïch|Beni Mered"),
      city("Batna", "large", "Batna", 2),
      city("Sétif", "large", "Sétif", 2, "Aïn Arnat"),
      city("Djelfa", "large", "Djelfa", 1),
      city("Sidi Bel Abbès", "large", "Sidi Bel Abbès", 1),
      city("Biskra", "large", "Biskra", 1),
      city("Tébessa", "large", "Tébessa", 1),
      city("Béjaïa", "large", "Béjaïa", 2),
      city("Tlemcen", "large", "Tlemcen", 1),
      city("Tiaret", "medium", "Tiaret", 1),
      city("Béchar", "medium", "Béchar", 1),
      city("Tizi Ouzou", "medium", "Tizi Ouzou", 1),
      city("Chlef", "medium", "Chlef", 1),
      city("Skikda", "medium", "Skikda", 1),
      city("Mostaganem", "medium", "Mostaganem", 1),
      city("Bordj Bou Arréridj", "medium", "Bordj Bou Arréridj", 1),
      city("El Eulma", "medium", "Sétif", 1),
      city("Médéa", "medium", "Médéa", 1),
      city("El Oued", "medium", "El Oued", 1),
      city("Ouargla", "medium", "Ouargla", 1),
      city("Mascara", "medium", "Mascara", 1),
      city("Relizane", "medium", "Relizane", 1),
      city("Khenchela", "medium", "Khenchela", 1),
      city("Souk Ahras", "medium", "Souk Ahras", 1),
      city("Guelma", "medium", "Guelma", 1),
      city("Jijel", "medium", "Jijel", 1),
      city("M'Sila", "medium", "M'Sila", 1),
      city("Saïda", "medium", "Saïda", 1),
      city("Laghouat", "medium", "Laghouat", 1),
      city("Ghardaïa", "medium", "Ghardaïa", 1),
      city("Aïn Témouchent", "small", "Aïn Témouchent"),
      city("Akbou", "small", "Béjaïa"),
      city("El Bayadh", "small", "El Bayadh"),
      city("Chelghoum Laïd", "small", "Mila"),
      city("Mila", "small", "Mila"),
      city("Bou Saâda", "small", "M'Sila"),
      city("Tamanrasset", "small", "Tamanrasset"),
      city("Adrar", "small", "Adrar"),
      city("Aïn M'lila", "small", "Oum El Bouaghi"),
      city("Tipaza", "small", "Tipaza"),
      city("Boumerdès", "small", "Boumerdès"),
      city("Bouira", "small", "Bouira"),
      city("Khemis Miliana", "small", "Aïn Defla"),
      city("Magra", "town", "M'Sila"),
      city("Tissemsilt", "town", "Tissemsilt"),
      city("Naâma", "town", "Naâma"),
    ],
  },
  football: singleTier(
    {
      tier: 1,
      name: "Ligue Professionnelle 1",
      shortName: "Ligue 1",
      size: 16,
      status: "professional",
      reputation: 55,
      clubs: {
        reputation: { top: 63, bottom: 46 },
        giants: { count: 3, top: 70, bottom: 66 },
        capacity: { top: 64_000, bottom: 5_000 },
        facilities: { top: 70, bottom: 40 },
        academy: { top: 72, bottom: 42 },
        // State-company owners (Sonatrach, Madar, Serport...) fund the big Algiers clubs.
        wageBill: { top: 7_000_000, bottom: 800_000 },
        transferBudget: { top: 2_000_000, bottom: 20_000 },
        foreignShare: 0.06,
        squadSize: [27, 32],
      },
    },
    {
      cups: [
        { kind: "national", name: "Coupe d'Algérie", seededEntry: true, legs: 1, neutralFinal: true, continental: true },
        { kind: "super", name: "Supercoupe d'Algérie", participants: ["champion", "cup-winner"], neutralFinal: true },
      ],
      youth: youthSingle("Championnat National U19", "Championnat National U17", 8, "Centre-Est|Centre-Ouest"),
      // Algerian clubs carry initials of their full French names (MC, USM, CR, JS, ES, CS...).
      clubNaming: {
        templates: templates(
          `MC {city}:3; USM {city}:3; CR {city}:2; JS {city}:2; ES {city}:2; CS {city}:2; RC {city}:2; NA {city}:1;
           MO {city}:1; WA {city}:1; US {city}:1; ASM {city}:1; JSM {city}:1; IRB {city}:1; Olympique {city}:1;
           CA {city}:1; AS {city}:1`,
        ),
        founded: { top: [1898, 2000], bottom: [1920, 2015] },
        avoid: list(
          `MC Alger|USM Alger|CR Belouizdad|JS Kabylie|ES Sétif|CS Constantine|MC Oran|ASM Oran|USM Annaba|JSM Béjaïa|
           MO Béjaïa|USM Blida|WA Tlemcen|MC El Eulma|CA Batna|MSP Batna|US Biskra|JS Saoura|NC Magra|ASO Chlef|
           Paradou AC|USM Khenchela|MC El Bayadh|Olympique Akbou|ES Mostaganem|ES Ben Aknoun|RC Arbaâ|CR Témouchent|
           JSM Tiaret|US Souf|HB Chelghoum Laïd|RC Kouba|NA Hussein Dey|USM El Harrach|Hydra AC|RC Relizane|
           SA Mohammadia|MC Saïda|USM Bel Abbès|JSM Skikda|AS Aïn M'lila|CA Bordj Bou Arréridj|US Chaouia|
           Olympique Médéa|ES Guelma|WA Boufarik|OM Arzew|JS Bordj Ménaïel|MO Constantine|USM Sétif|IRB El Hadjar|
           AS Khroub|CRB Aïn Fakroun|NRB Teleghma|USM Oran|SCM Oran|ES Tiaret|JSM Chéraga|MC Mekhadma|IRB Ouargla`,
        ),
        colors: ["#006233", "#D21034", "#FFFFFF", "#000000", "#FFD100", "#003DA5", "#8B0000", "#00A651"],
      },
      importSources: weighted("TN:3 LY:2 ML:2 CM:2 BF:2 CI:2 NE:2 GH:1 MR:1 SN:1 CD:1 GN:1"),
      coefficients: { association: [12, 10, 13, 12.5, 13] },
    },
  ),
  abroad: {
    seniors: 110,
    youth: 20,
    destinations: weighted("FR:30 SA:8 QA:6 AE:5 TR:5 BE:4 TN:4 CH:3 ES:3 PT:3 IT:3 DE:3 EN:3 NL:2 EG:1 GR:1 US:1"),
  },
};

// ------------------------------------------------------------------ Tunisia

const TN: NationSpec = {
  code: "TN",
  iso2: "TN",
  name: "Tunisia",
  confederation: "CAF",
  continent: "AF",
  capital: "Tunis",
  latitude: 36.8,
  languages: languages("ar:6 fr:3"),
  reputation: { national: 68, league: 54 },
  euEea: false,
  physique: { height: 180 },
  names: { given: [src("tunisian")], family: [src("tunisian")] },
  nationality: {
    // France-, Germany-, Scandinavia- and Italy-born players of Tunisian parents.
    multipleRate: 0.26,
    tripleRate: 0.02,
    bornAbroadRate: 0.16,
    diasporaPull: 0.65,
    links: [
      ...links("frenchAfrica", "FR:12 BE:2"),
      ...links("mediterranean", "IT:6"),
      ...links("crossBorder", "DE:5 CH:1 NL:1 SE:1 DK:1"),
      ...links("arabWorld", "DZ:2 LY:2"),
    ],
    citizenship: allowed,
  },
  cities: {
    major: [
      city("Tunis", "mega", "Tunis", 4, "El Menzah|El Omrane|Ettadhamen|Ezzahrouni|Sidi Hassine|El Kabaria"),
      city("Sfax", "large", "Sfax", 3, "Sakiet Ezzit|Sakiet Eddaier|El Aïn"),
      city("Sousse", "large", "Sousse", 2, "Khezama|Sahloul"),
      city("Kairouan", "large", "Kairouan", 1),
      city("Bizerte", "medium", "Bizerte", 1),
      city("Gabès", "medium", "Gabès", 1),
      city("Ariana", "medium", "Ariana", 1),
      city("Gafsa", "medium", "Gafsa", 1),
      city("Monastir", "medium", "Monastir", 1),
      city("Ben Arous", "medium", "Ben Arous", 1),
      city("Kasserine", "medium", "Kasserine", 1),
      city("Médenine", "medium", "Médenine", 1),
      city("Nabeul", "medium", "Nabeul", 1),
      city("Béja", "medium", "Béja", 1),
      city("Jendouba", "small", "Jendouba"),
      city("Le Kef", "small", "Le Kef"),
      city("Mahdia", "small", "Mahdia"),
      city("Sidi Bouzid", "small", "Sidi Bouzid"),
      city("Tataouine", "small", "Tataouine"),
      city("Tozeur", "small", "Tozeur"),
      city("Zarzis", "small", "Médenine"),
      city("Hammam-Lif", "small", "Ben Arous"),
      city("La Marsa", "small", "Tunis"),
      city("Le Bardo", "small", "Tunis"),
      city("Msaken", "small", "Sousse"),
      city("Hammam Sousse", "small", "Sousse"),
      city("Métlaoui", "small", "Gafsa"),
      city("Ksar Hellal", "small", "Monastir"),
      city("Moknine", "small", "Monastir"),
      city("Hammamet", "small", "Nabeul"),
      city("Menzel Bourguiba", "small", "Bizerte"),
      city("Houmt Souk", "small", "Médenine"),
      city("Ben Guerdane", "small", "Médenine"),
      city("Manouba", "small", "Manouba"),
      city("Siliana", "town", "Siliana"),
      city("Zaghouan", "town", "Zaghouan"),
      city("Kébili", "town", "Kébili"),
      city("Kalâa Kebira", "town", "Sousse"),
      city("Jemmal", "town", "Monastir"),
      city("Soliman", "town", "Nabeul"),
      city("Korba", "town", "Nabeul"),
      city("Redeyef", "town", "Gafsa"),
      city("Tebourba", "town", "Manouba"),
    ],
  },
  football: singleTier(
    {
      tier: 1,
      name: "Ligue Professionnelle 1",
      shortName: "Ligue 1",
      size: 16,
      status: "professional",
      reputation: 54,
      clubs: {
        reputation: { top: 62, bottom: 43 },
        giants: { count: 2, top: 72, bottom: 68 },
        capacity: { top: 60_000, bottom: 3_000 },
        facilities: { top: 72, bottom: 40 },
        academy: { top: 76, bottom: 42 },
        wageBill: { top: 9_000_000, bottom: 400_000 },
        transferBudget: { top: 3_000_000, bottom: 20_000 },
        foreignShare: 0.1,
        squadSize: [27, 32],
      },
    },
    {
      cups: [
        { kind: "national", name: "Coupe de Tunisie", seededEntry: true, legs: 1, neutralFinal: true, continental: true },
        { kind: "super", name: "Supercoupe de Tunisie", participants: ["champion", "cup-winner"], neutralFinal: true },
      ],
      youth: youthSingle("Championnat National Juniors", "Championnat National Cadets", 8, "Nord|Sud"),
      clubNaming: {
        templates: templates(
          `AS {city}:3; ES {city}:3; CS {city}:2; US {city}:2; Stade {city}:2; Olympique {city}:2; JS {city}:1;
           EO {city}:1; CO {city}:1; Avenir Sportif de {city}:1; Étoile Sportive de {city}:1; Croissant Sportif de {city}:1;
           Espoir Sportif de {city}:1`,
        ),
        founded: { top: [1919, 1990], bottom: [1925, 2010] },
        avoid: list(
          `Espérance de Tunis|Espérance Sportive de Tunis|Étoile du Sahel|Étoile Sportive du Sahel|Club Africain|
           CS Sfaxien|Club Sportif Sfaxien|US Monastir|US Monastirienne|Stade Tunisien|US Ben Guerdane|CA Bizertin|
           Olympique de Béja|OB Béja|AS Soliman|EGS Gafsa|JS Omrane|Stade Gabèsien|AS Gabès|ES Métlaoui|US Tataouine|
           CS Hammam-Lif|ES Zarzis|AS Marsa|JS Kairouan|JS Kairouanaise|EO Sidi Bouzid|Stade Sportif Sfaxien|
           CO Médenine|ES Hammam Sousse|Espoir Sportif de Hammam Sousse|AS Kasserine|Olympique du Kef|AS Djerba|
           AS Ariana|CS Korba|ES Béni Khalled|Stade Nabeulien|CS Msaken|Croissant Sportif de M'saken|AS Rejiche|
           EO Goulette et Kram|AS Kerkennah|Océano Club de Kerkennah|ES Jerba|Stade Africain Menzel Bourguiba|
           JS Kalâa|AS Mahdia|ES Radès|CS Chebba`,
        ),
        colors: ["#E70013", "#FFFFFF", "#FFD100", "#000000", "#00843D", "#1E3A8A", "#7A263A"],
      },
      importSources: weighted("DZ:3 LY:3 CI:3 NG:2 ML:2 CM:2 SN:2 BF:2 GH:2 NE:1 GN:1 MR:1 CD:1 BR:1"),
      coefficients: { association: [15, 14, 12, 11.5, 11] },
    },
  ),
  abroad: {
    seniors: 80,
    youth: 12,
    destinations: weighted("FR:18 SA:10 QA:6 AE:5 DE:5 TR:4 BE:3 IT:3 EG:3 CH:2 SE:2 DK:2 DZ:2 PT:2 NL:1 ES:1 EN:1 GR:1"),
  },
};

// ------------------------------------------------------------------ Côte d'Ivoire

const CI: NationSpec = {
  code: "CI",
  iso2: "CI",
  name: "Côte d'Ivoire",
  confederation: "CAF",
  continent: "AF",
  capital: "Yamoussoukro",
  latitude: 6.8,
  languages: languages("fr:6 dyu:2 bci:2"),
  reputation: { national: 78, league: 42 },
  euEea: false,
  physique: { height: 181 },
  names: {
    given: [src("francophone", 4), src("ivorian", 3), src("mande", 3)],
    family: [src("ivorian", 5), src("mande", 3)],
  },
  nationality: {
    multipleRate: 0.3,
    tripleRate: 0.03,
    bornAbroadRate: 0.14,
    diasporaPull: 0.65,
    links: [
      ...links("frenchAfrica", "FR:11 BE:1"),
      ...links("regional", "BF:8 ML:6 GH:4 GN:3 LR:2"),
      ...links("crossBorder", "IT:2 ES:1 CH:1"),
      ...links("commonwealth", "EN:2"),
    ],
    citizenship: allowed,
  },
  cities: {
    major: [
      city("Abidjan", "mega", "Abidjan", 6, "Cocody|Yopougon|Treichville|Adjamé|Abobo|Marcory|Koumassi|Port-Bouët|Plateau|Attécoubé"),
      city("Bouaké", "large", "Gbêkê", 2),
      city("San-Pédro", "large", "San-Pédro", 2),
      city("Daloa", "large", "Haut-Sassandra", 1),
      city("Yamoussoukro", "large", "Yamoussoukro", 1),
      city("Korhogo", "large", "Poro", 1),
      city("Man", "medium", "Tonkpi", 1),
      city("Gagnoa", "medium", "Gôh", 1),
      city("Divo", "medium", "Lôh-Djiboua", 1),
      city("Abengourou", "medium", "Indénié-Djuablin", 1),
      city("Soubré", "medium", "Nawa", 1),
      city("Anyama", "medium", "Abidjan", 1),
      city("Séguéla", "small", "Worodougou"),
      city("Odienné", "small", "Kabadougou"),
      city("Bondoukou", "small", "Gontougo"),
      city("Agboville", "small", "Agnéby-Tiassa"),
      city("Grand-Bassam", "small", "Sud-Comoé"),
      city("Dabou", "small", "Grands-Ponts"),
      city("Aboisso", "small", "Sud-Comoé"),
      city("Dimbokro", "small", "N'Zi"),
      city("Issia", "small", "Haut-Sassandra"),
      city("Sinfra", "small", "Marahoué"),
      city("Bouaflé", "small", "Marahoué"),
      city("Katiola", "small", "Hambol"),
      city("Ferkessédougou", "small", "Tchologo"),
      city("Duékoué", "small", "Guémon"),
      city("Guiglo", "small", "Cavally"),
      city("Adzopé", "small", "La Mé"),
      city("Bingerville", "small", "Abidjan"),
      city("Danané", "small", "Tonkpi"),
      city("Toumodi", "town", "Bélier"),
      city("Sassandra", "town", "Gbôklé"),
      city("Tiassalé", "town", "Agnéby-Tiassa"),
      city("Lakota", "town", "Lôh-Djiboua"),
      city("Méagui", "town", "Nawa"),
      city("Boundiali", "town", "Bagoué"),
    ],
  },
  football: singleTier(
    {
      tier: 1,
      name: "Ligue 1",
      shortName: "Ligue 1",
      size: 16,
      status: "professional",
      reputation: 42,
      clubs: {
        reputation: { top: 54, bottom: 36 },
        giants: { count: 1, top: 63, bottom: 61 },
        capacity: { top: 60_000, bottom: 3_000 },
        facilities: { top: 62, bottom: 25 },
        // The ASEC academy model (Académie MimoSifcom) set the standard for West African youth development.
        academy: { top: 80, bottom: 35 },
        wageBill: { top: 1_500_000, bottom: 120_000 },
        transferBudget: { top: 400_000, bottom: 0 },
        foreignShare: 0.08,
        squadSize: [26, 30],
      },
    },
    {
      cups: [
        { kind: "national", name: "Coupe de Côte d'Ivoire", seededEntry: true, legs: 1, neutralFinal: true, continental: true },
        {
          kind: "super",
          name: "Super Coupe Félix Houphouët-Boigny",
          participants: ["champion", "cup-winner"],
          neutralFinal: true,
        },
      ],
      youth: youthSingle("Championnat National Juniors", "Championnat National Cadets", 8, "Poule A|Poule B"),
      clubNaming: {
        templates: templates(
          `AS {city}:3; FC {city}:2; Stade de {city}:2; Sporting Club de {city}:1; Racing Club de {city}:1;
           Stella Club de {city}:1; Jeunesse Club de {city}:1; ES {city}:1; USC {city}:1; CO {city}:1;
           Africa Sports de {city}:1; ASEC {city}:1; {city} FC:1; Réveil Club de {city}:1; Espoir de {city}:1`,
        ),
        founded: { top: [1936, 2012], bottom: [1950, 2018] },
        avoid: list(
          `ASEC Mimosas|Africa Sports|Africa Sports d'Abidjan|Stade d'Abidjan|SOA|SO Armée|SC Gagnoa|
           Sporting Club de Gagnoa|Sporting Gagnoa|FC San-Pédro|San-Pédro|Racing Club d'Abidjan|AFAD Djékanou|
           Séwé Sport|LYS Sassandra|ES Bafing|Mouna|Bouaké|Zoman|ISCA|USC Bassam|CO Korhogo|AS Denguélé|
           Stella Club d'Adjamé|Stella Club|JC Abidjan|Jeunesse Club d'Abidjan|AS Indénié|ASC Ouragahio|Moossou|
           EFYM|AS Tanda|Williamsville Athletic Club|Williamsville AC|Hiré|AS Athlétic Adjamé|Réveil Club de Daloa|
           Réveil Daloa|ASI d'Abengourou|Entente Sportive de Bingerville|Sporting Club de Man|AS Soubré|Espoir de Man`,
        ),
        colors: ["#F77F00", "#009E60", "#FFFFFF", "#FFD100", "#E30613", "#000000", "#1D4E9E"],
      },
      importSources: weighted("BF:5 ML:4 GN:3 GH:2 LR:2 NE:1 TG:1 BJ:1 CM:1 SN:1 NG:1"),
      coefficients: { association: [5.5, 6, 7, 7.5, 8] },
    },
  ),
  abroad: {
    seniors: 210,
    youth: 28,
    destinations: weighted(
      `FR:24 BE:8 TR:8 PT:6 IT:6 MA:6 ES:5 SA:5 DE:4 EN:4 CH:4 TN:4 GR:3 CY:3 QA:3 AE:3 AT:2 NL:2 DK:2 NO:2 SE:2
       RO:2 DZ:2 EG:2 US:2 RS:1 ZA:1 CN:1 KR:1`,
    ),
  },
};

// ------------------------------------------------------------------ Cameroon

const CM: NationSpec = {
  code: "CM",
  iso2: "CM",
  name: "Cameroon",
  confederation: "CAF",
  continent: "AF",
  capital: "Yaoundé",
  latitude: 3.9,
  languages: languages("fr:6 en:3"),
  reputation: { national: 70, league: 40 },
  euEea: false,
  physique: { height: 181 },
  names: {
    given: [src("francophone", 5), src("anglophone", 2), src("west-african", 2)],
    family: [src("cameroonian", 6), src("fang", 1)],
  },
  nationality: {
    multipleRate: 0.25,
    tripleRate: 0.03,
    bornAbroadRate: 0.13,
    diasporaPull: 0.55,
    links: [
      ...links("frenchAfrica", "FR:10 BE:2"),
      ...links("crossBorder", "DE:3 CH:2"),
      ...links("commonwealth", "EN:3 US:2"),
      ...links("regional", "NG:5 GA:3 CD:2 GQ:2 TD:2 CF:1"),
    ],
    // The 1968 nationality code does not recognise dual nationality (reform under debate in 2025).
    citizenship: restricted,
  },
  cities: {
    major: [
      city("Douala", "mega", "Littoral", 5, "Akwa|Bonabéri|New Bell|Deïdo|Bonanjo|Makepe|Bépanda|Ndokoti"),
      city("Yaoundé", "mega", "Centre", 5, "Mvog-Ada|Biyem-Assi|Mokolo|Nkolbisson|Essos|Emana|Mimboman"),
      city("Garoua", "large", "Nord", 2),
      city("Bamenda", "large", "Nord-Ouest", 2),
      city("Bafoussam", "large", "Ouest", 2),
      city("Maroua", "large", "Extrême-Nord", 2),
      city("Ngaoundéré", "large", "Adamaoua", 1),
      city("Bertoua", "medium", "Est", 1),
      city("Kumba", "medium", "Sud-Ouest", 1),
      city("Nkongsamba", "medium", "Littoral", 1),
      city("Buea", "medium", "Sud-Ouest", 1),
      city("Limbe", "medium", "Sud-Ouest", 1),
      city("Edéa", "medium", "Littoral", 1),
      city("Kribi", "medium", "Sud", 1),
      city("Ebolowa", "medium", "Sud", 1),
      city("Dschang", "medium", "Ouest", 1),
      city("Foumban", "medium", "Ouest", 1),
      city("Loum", "small", "Littoral"),
      city("Mbouda", "small", "Ouest"),
      city("Bafang", "small", "Ouest"),
      city("Bangangté", "small", "Ouest"),
      city("Mbalmayo", "small", "Centre"),
      city("Sangmélima", "small", "Sud"),
      city("Kousséri", "small", "Extrême-Nord"),
      city("Guider", "small", "Nord"),
      city("Meiganga", "small", "Adamaoua"),
      city("Batouri", "small", "Est"),
      city("Tiko", "small", "Sud-Ouest"),
      city("Kumbo", "small", "Nord-Ouest"),
      city("Obala", "town", "Centre"),
      city("Mfou", "town", "Centre"),
      city("Wum", "town", "Nord-Ouest"),
      city("Yagoua", "town", "Extrême-Nord"),
      city("Bafia", "town", "Centre"),
      city("Abong-Mbang", "town", "Est"),
      city("Mbanga", "town", "Littoral"),
      city("Ndop", "town", "Nord-Ouest"),
    ],
  },
  football: singleTier(
    {
      tier: 1,
      name: "Elite One",
      shortName: "Elite One",
      size: 18,
      status: "professional",
      reputation: 40,
      clubs: {
        reputation: { top: 52, bottom: 34 },
        giants: { count: 1, top: 58, bottom: 56 },
        capacity: { top: 60_000, bottom: 2_000 },
        facilities: { top: 45, bottom: 18 },
        academy: { top: 62, bottom: 28 },
        wageBill: { top: 500_000, bottom: 60_000 },
        transferBudget: { top: 100_000, bottom: 0 },
        foreignShare: 0.03,
        squadSize: [26, 30],
      },
    },
    {
      cups: [
        { kind: "national", name: "Coupe du Cameroun", seededEntry: true, legs: 1, neutralFinal: true, continental: true },
        { kind: "super", name: "Super Coupe Roger Milla", participants: ["champion", "cup-winner"], neutralFinal: true },
      ],
      youth: youthSingle("Championnat National U19", "Championnat National U17", 9, "Poule A|Poule B"),
      clubNaming: {
        templates: templates(
          `Union Sportive de {city}:2; Racing Club de {city}:2; {city} FC:2; Canon de {city}:1; Tonnerre de {city}:1;
           Dynamo de {city}:1; Panthère de {city}:1; Aigle de {city}:1; Unisport de {city}:1; Colombe de {city}:1;
           Espoir de {city}:1; Fauve de {city}:1; Renard de {city}:1; Lion de {city}:1; Stade de {city}:1`,
        ),
        regional: [
          {
            // Anglophone Grassfields and coast: English club names.
            regions: ["Nord-Ouest", "Sud-Ouest"],
            templates: templates(`{city} United:2; {city} FC:2; {city} Stars:1; Young Stars {city}:1; {city} Victoria:1; {city} Strikers:1`),
          },
        ],
        founded: { top: [1930, 2012], bottom: [1945, 2020] },
        avoid: list(
          `Coton Sport|Coton Sport de Garoua|Canon Yaoundé|Canon Sportif de Yaoundé|Tonnerre Yaoundé|Tonnerre Kalara Club|
           Union Douala|Union Sportive de Douala|Dynamo Douala|Dynamo de Douala|Les Astres|Fovu Club|Racing Bafoussam|
           Racing Club de Bafoussam|Bamboutos|Colombe Sportive|Colombe de Sangmélima|PWD Bamenda|PWD Kumba|YOSA|
           Young Sport Academy|Aigle Royal de Dschang|Aigle Royal|Stade Renard|Victoria United|Gazelle FA|AS Fortuna|
           Avion Academy|Djiko|Unisport Bafang|Unisport de Bafang|Panthère du Ndé|Panthère de Bangangté|Eding Sport|
           APEJES|Léopards de Douala|Oryx Douala|Diamant Yaoundé|Sable Batié|Mount Cameroon|Fauve Azur|Caïman Douala|
           Espérance Guider|Kumbo Strikers|Renaissance Ngoumou|Yong Sports Academy|Tiko United|Buea United|Limbe FC`,
        ),
        colors: ["#007A5E", "#CE1126", "#FCD116", "#FFFFFF", "#000000", "#1F4E9E", "#6D2077"],
      },
      importSources: weighted("CF:3 TD:3 GQ:2 GA:2 NG:2 CG:2 CD:1 CI:1 BF:1 NE:1"),
      coefficients: { association: [4.5, 5, 4, 4.5, 5] },
    },
  ),
  abroad: {
    seniors: 170,
    youth: 22,
    destinations: weighted(
      `FR:18 TR:8 BE:6 PT:6 DE:5 CH:4 ES:4 EN:4 SA:4 MA:4 IT:3 GR:3 CY:3 RU:3 TN:3 RO:2 QA:2 AE:2 DZ:2 EG:2 ZA:2 GQ:2
       US:2 UA:1 KR:1 CN:1 IN:1 ID:1 TH:1 VN:1 HU:1 BG:1`,
    ),
  },
};

// ------------------------------------------------------------------ DR Congo

const CD: NationSpec = {
  code: "CD",
  iso2: "CD",
  name: "DR Congo",
  confederation: "CAF",
  continent: "AF",
  capital: "Kinshasa",
  latitude: -4.3,
  languages: languages("fr:3 ln:4 sw:3 kg:1 lu:1"),
  reputation: { national: 68, league: 44 },
  euEea: false,
  physique: { height: 180 },
  names: {
    given: [src("francophone", 5), src("congolese", 3)],
    family: [src("kongo", 3), src("luba", 3), src("congo-east", 3)],
  },
  nationality: {
    // Belgium- and France-born Léopards (and some England-born) are common.
    multipleRate: 0.28,
    tripleRate: 0.03,
    bornAbroadRate: 0.14,
    diasporaPull: 0.6,
    links: [
      ...links("frenchAfrica", "BE:10 FR:8"),
      ...links("regional", "CG:6 AO:5 ZM:2 RW:1 UG:1"),
      ...links("commonwealth", "EN:2"),
      ...links("crossBorder", "DE:1 CH:1"),
    ],
    // Article 10 of the constitution: Congolese nationality is "one and exclusive".
    citizenship: restricted,
  },
  cities: {
    major: [
      city("Kinshasa", "mega", "Kinshasa", 6, "Gombe|Limete|Kintambo|Matete|Ngaliema|Masina|Lemba|Kalamu|Bandalungwa|Kasa-Vubu|Barumbu"),
      city("Lubumbashi", "mega", "Haut-Katanga", 4, "Kenya|Katuba|Kampemba|Ruashi"),
      city("Mbuji-Mayi", "large", "Kasaï-Oriental", 2),
      city("Kananga", "large", "Kasaï-Central", 2),
      city("Kisangani", "large", "Tshopo", 2),
      city("Bukavu", "large", "Sud-Kivu", 2),
      city("Goma", "large", "Nord-Kivu", 2),
      city("Kolwezi", "large", "Lualaba", 2),
      city("Tshikapa", "large", "Kasaï", 1),
      city("Likasi", "medium", "Haut-Katanga", 2),
      city("Mbandaka", "medium", "Équateur", 1),
      city("Kikwit", "medium", "Kwilu", 1),
      city("Matadi", "medium", "Kongo-Central", 1),
      city("Uvira", "medium", "Sud-Kivu", 1),
      city("Butembo", "medium", "Nord-Kivu", 1),
      city("Kindu", "medium", "Maniema", 1),
      city("Kalemie", "medium", "Tanganyika", 1),
      city("Boma", "medium", "Kongo-Central", 1),
      city("Bunia", "medium", "Ituri", 1),
      city("Mwene-Ditu", "medium", "Lomami", 1),
      city("Beni", "medium", "Nord-Kivu", 1),
      city("Isiro", "small", "Haut-Uele"),
      city("Gemena", "small", "Sud-Ubangi"),
      city("Kabinda", "small", "Lomami"),
      city("Kamina", "small", "Haut-Lomami"),
      city("Bandundu", "small", "Kwilu"),
      city("Kipushi", "small", "Haut-Katanga"),
      city("Lisala", "small", "Mongala"),
      city("Gbadolite", "small", "Nord-Ubangi"),
      city("Lodja", "small", "Sankuru"),
      city("Mbanza-Ngungu", "small", "Kongo-Central"),
      city("Muanda", "small", "Kongo-Central"),
      city("Kenge", "small", "Kwango"),
      city("Kasumbalesa", "town", "Haut-Katanga"),
      city("Inongo", "town", "Mai-Ndombe"),
      city("Tshela", "town", "Kongo-Central"),
      city("Buta", "town", "Bas-Uele"),
      city("Kasongo", "town", "Maniema"),
      city("Idiofa", "town", "Kwilu"),
      city("Ilebo", "town", "Kasaï"),
    ],
  },
  football: {
    leagues: [
      {
        tier: 1,
        // Real Linafoot: two regional groups, then an eight-club title play-off mini-league.
        name: "Linafoot Ligue 1",
        shortName: "Linafoot",
        size: 20,
        conferences: ["Groupe Ouest", "Groupe Est"],
        championship: {
          positions: [1, 4],
          perConference: true,
          format: "round-robin",
          roundRobins: 2,
          legs: 1,
        },
        status: "professional",
        reputation: 44,
        clubs: {
          reputation: { top: 58, bottom: 38 },
          giants: { count: 2, top: 70, bottom: 64 },
          capacity: { top: 80_000, bottom: 3_000 },
          facilities: { top: 70, bottom: 18 },
          academy: { top: 70, bottom: 28 },
          wageBill: { top: 6_000_000, bottom: 100_000 },
          transferBudget: { top: 1_500_000, bottom: 0 },
          foreignShare: 0.1,
          squadSize: [28, 32],
        },
      },
      {
        tier: 2,
        // Real Ligue 2: regional zones whose leaders go up; merged into a western and an eastern conference.
        name: "Linafoot Ligue 2",
        shortName: "Ligue 2",
        size: 24,
        conferences: ["Zone Ouest", "Zone Est"],
        status: "semi-professional",
        reputation: 30,
        clubs: {
          reputation: { top: 36, bottom: 20 },
          capacity: { top: 20_000, bottom: 1_000 },
          facilities: { top: 25, bottom: 10 },
          academy: { top: 36, bottom: 15 },
          wageBill: { top: 150_000, bottom: 20_000 },
          transferBudget: { top: 10_000, bottom: 0 },
          foreignShare: 0.02,
          squadSize: [25, 30],
        },
      },
    ],
    movement: [{ upper: 1, promoted: 4, relegated: 4, perConference: true }],
    cups: [
      { kind: "national", name: "Coupe du Congo", seededEntry: true, legs: 1, neutralFinal: true, continental: true },
      { kind: "super", name: "Super Coupe du Congo", participants: ["champion", "cup-winner"], neutralFinal: true },
    ],
    youth: youth(
      [division("Championnat National U19", [1, 2], 12, "Zone Nord-Ouest|Zone Nord-Est|Zone Sud-Ouest|Zone Sud-Est")],
      [division("Championnat National U17", [1, 2], 12, "Zone Nord-Ouest|Zone Nord-Est|Zone Sud-Ouest|Zone Sud-Est")],
    ),
    reserves: { mode: "none" },
    clubNaming: {
      templates: templates(
        `AS {city}:3; FC {city}:3; CS {city}:2; TP {city}:1; DC {city}:1; AC {city}:1; OC {city}:1; SM {city}:1;
         US {city}:1; JS {city}:1; Étoile de {city}:1; Renaissance de {city}:1; Daring Club {city}:1; {city} Sport:1;
         Racing Club de {city}:1`,
      ),
      founded: { top: [1919, 2012], bottom: [1935, 2020] },
      avoid: list(
        `TP Mazembe|Mazembe|AS Vita Club|Vita Club|DC Motema Pembe|Daring Club Motema Pembe|Motema Pembe|
         FC Saint-Éloi Lupopo|Saint-Éloi Lupopo|Lupopo|AS Maniema Union|Maniema Union|FC Renaissance du Congo|
         Renaissance du Congo|FC Lubumbashi Sport|Lubumbashi Sport|CS Don Bosco|Don Bosco|SM Sanga Balende|Sanga Balende|
         AS Dauphins Noirs|Dauphins Noirs|OC Bukavu Dawa|Bukavu Dawa|FC Tanganyika|JS Groupe Bazano|Groupe Bazano|
         AC Rangers|FC Les Aigles du Congo|Les Aigles du Congo|AS Simba|US Tshinkunku|Tshinkunku|FC Blessing|AS Nyuki|
         Nord Sport|Étoile du Kivu|Kuya Sport|AS Kabasha|US Panda|FC MK|FC Céleste|AF Anges Verts|Anges Verts|
         OC Muungano|Muungano|AS Veti Club|Veti Club|AS New Soger|New Soger|Elima|AS Kalamu|AS Bantous|Bazano|
         FC Kiyika|AS Mikishi|OC Kipushi|AS Rojolu|FC Kabasha|Virunga`,
      ),
      colors: ["#007FFF", "#CE1021", "#F7D618", "#FFFFFF", "#000000", "#00843D", "#6D2077"],
    },
    importSources: weighted("ZM:4 CG:3 CI:3 BF:2 GH:2 CM:2 TZ:2 UG:2 RW:2 BI:2 AO:2 NG:1 ML:1 ZW:1"),
    coefficients: { association: [8, 8.5, 7.5, 6.5, 7] },
  },
  abroad: {
    seniors: 120,
    youth: 16,
    destinations: weighted(
      "BE:14 FR:12 TR:6 ZA:6 MA:5 PT:4 EN:4 AO:4 DE:3 IT:3 CH:3 SA:3 TN:3 EG:3 NL:2 ES:2 GR:2 CY:2 QA:2 AE:2 DZ:2 CG:2 RS:1 US:1",
    ),
  },
};

// ------------------------------------------------------------------ South Africa

const ZA: NationSpec = {
  code: "ZA",
  iso2: "ZA",
  name: "South Africa",
  confederation: "CAF",
  continent: "AF",
  capital: "Pretoria",
  latitude: -25.7,
  languages: languages("en:3 zu:4 xh:3 af:2 st:2 tn:2 ts:1"),
  reputation: { national: 65, league: 58 },
  euEea: false,
  physique: { height: 177 },
  names: {
    given: [src("anglophone", 4), src("nguni", 3), src("sotho-tswana", 2), faker("zu_ZA", 2), faker("af_ZA", 1)],
    family: [src("nguni", 4), src("sotho-tswana", 3), src("tsonga-venda", 2), src("cape", 2), faker("zu_ZA", 2), faker("af_ZA", 1)],
  },
  nationality: {
    // Children of Zimbabwean, Mozambican and Basotho migrants, plus a small UK/Dutch-heritage group.
    multipleRate: 0.18,
    tripleRate: 0.015,
    bornAbroadRate: 0.05,
    diasporaPull: 0.5,
    links: [
      ...links("regional", "ZW:8 MZ:6 LS:5 BW:3 SZ:3 NA:2 MW:2 CD:2"),
      ...links("commonwealth", "EN:4 AU:1"),
      ...links("dutchDiaspora", "NL:2"),
      ...links("lusophone", "PT:1"),
    ],
    // Automatic loss on acquiring another nationality was struck down in 2025; dual nationality is accepted.
    citizenship: allowed,
  },
  cities: {
    major: [
      city("Johannesburg", "mega", "Gauteng", 5, "Soweto|Alexandra|Randburg|Sandton|Roodepoort|Lenasia|Diepkloof"),
      city("Cape Town", "mega", "Western Cape", 4, "Mitchells Plain|Khayelitsha|Athlone|Gugulethu|Bellville|Parow"),
      city("Durban", "mega", "KwaZulu-Natal", 3, "Umlazi|KwaMashu|Chatsworth|Phoenix"),
      city("Pretoria", "large", "Gauteng", 3, "Atteridgeville|Soshanguve|Centurion|Hammanskraal"),
      city("Gqeberha", "large", "Eastern Cape", 2, "Motherwell|New Brighton"),
      city("Bloemfontein", "large", "Free State", 2, "Mangaung|Botshabelo"),
      city("Polokwane", "large", "Limpopo", 2, "Seshego|Mankweng"),
      city("Pietermaritzburg", "large", "KwaZulu-Natal", 2, "Edendale|Imbali"),
      city("East London", "large", "Eastern Cape", 1),
      city("Germiston", "large", "Gauteng", 1),
      city("Tembisa", "large", "Gauteng", 1),
      city("Mbombela", "medium", "Mpumalanga", 2, "KaNyamazane"),
      city("Rustenburg", "medium", "North West", 1),
      city("Kimberley", "medium", "Northern Cape", 1),
      city("Stellenbosch", "medium", "Western Cape", 1),
      city("Richards Bay", "medium", "KwaZulu-Natal", 1),
      city("Welkom", "medium", "Free State", 1),
      city("Potchefstroom", "medium", "North West", 1),
      city("Mahikeng", "medium", "North West", 1),
      city("Mthatha", "medium", "Eastern Cape", 1),
      city("Vanderbijlpark", "medium", "Gauteng", 1),
      city("Klerksdorp", "medium", "North West", 1),
      city("eMalahleni", "medium", "Mpumalanga", 1),
      city("George", "medium", "Western Cape", 1),
      city("Newcastle", "medium", "KwaZulu-Natal", 1),
      city("Paarl", "medium", "Western Cape", 1),
      city("Thohoyandou", "small", "Limpopo"),
      city("Tzaneen", "small", "Limpopo"),
      city("Upington", "small", "Northern Cape"),
      city("Ladysmith", "small", "KwaZulu-Natal"),
      city("Vryheid", "small", "KwaZulu-Natal"),
      city("Komani", "small", "Eastern Cape"),
      city("Makhanda", "small", "Eastern Cape"),
      city("Worcester", "small", "Western Cape"),
      city("Sasolburg", "small", "Free State"),
      city("Bethlehem", "small", "Free State"),
      city("Secunda", "small", "Mpumalanga"),
      city("Middelburg", "small", "Mpumalanga"),
      city("Phalaborwa", "small", "Limpopo"),
      city("Giyani", "small", "Limpopo"),
      city("Brits", "small", "North West"),
      city("Mossel Bay", "small", "Western Cape"),
      city("Knysna", "town", "Western Cape"),
    ],
  },
  football: singleTier(
    {
      tier: 1,
      // Betway Premiership without the sponsor.
      name: "Premiership",
      shortName: "PSL",
      size: 16,
      status: "professional",
      reputation: 58,
      clubs: {
        reputation: { top: 62, bottom: 47 },
        giants: { count: 3, top: 76, bottom: 69 },
        capacity: { top: 94_000, bottom: 6_000 },
        facilities: { top: 82, bottom: 52 },
        academy: { top: 80, bottom: 48 },
        wageBill: { top: 17_000_000, bottom: 1_500_000 },
        transferBudget: { top: 4_000_000, bottom: 30_000 },
        foreignShare: 0.18,
        squadSize: [28, 32],
      },
    },
    {
      // South African cups have only ever carried sponsor names; the PSL's official names are used.
      cups: [
        { kind: "national", name: "Nedbank Cup", seededEntry: true, legs: 1, neutralFinal: true, continental: true },
        // Last season's top eight; two-legged semi-finals.
        { kind: "league", name: "MTN 8", maxEntrants: 8, legs: 2, finalLegs: 1, neutralFinal: true, start: "08-01" },
      ],
      youth: youthSingle("PSL Youth League U-19", "PSL Youth League U-17", 8, "Inland|Coastal"),
      clubNaming: {
        templates: templates(
          `{city} City:3; {city} United:3; {city} Stars:2; {city} Rovers:1; {city} Arrows:1; {city} Celtic:1;
           {city} Leopards:1; {city} Tigers:1; {city} Rangers:1; {city} Wanderers:1; {city} Dynamos:1; Royal {city}:1;
           {city} Spurs:1; {city} Eagles:1; {city} Lions:1; {region} United:1`,
        ),
        founded: { top: [1937, 2020], bottom: [1960, 2022] },
        avoid: list(
          `Mamelodi Sundowns|Sundowns|Orlando Pirates|Pirates|Kaizer Chiefs|Chiefs|AmaZulu|Golden Arrows|
           Lamontville Golden Arrows|Stellenbosch|Cape Town City|Cape Town Spurs|Sekhukhune United|TS Galaxy|
           Polokwane City|Richards Bay|Magesi|Marumo Gallants|Chippa United|Durban City|Siwelele|Orbit College|
           Moroka Swallows|Swallows|Bloemfontein Celtic|Black Leopards|Maritzburg United|Jomo Cosmos|Bush Bucks|
           Hellenic|Wits|Bidvest Wits|SuperSport United|Free State Stars|Platinum Stars|Mpumalanga Black Aces|Black Aces|
           Ajax Cape Town|Santos|Vasco da Gama|Baroka|Tshakhuma Tsha Madzivhandila|Uthongathi|Hungry Lions|JDR Stars|
           Casric Stars|Pretoria Callies|University of Pretoria|Venda Football Academy|Upington City|Milford|Royal AM|
           Thanda Royal Zulu|Durban Stars|Pretoria City|Johannesburg City|Soweto United|Gauteng United|Limpopo United|
           Durban United|Umlazi United|Cape Town United|Welkom Stars|Mangaung United|Dynamos`,
        ),
        colors: ["#FFB612", "#007A4D", "#000000", "#FFFFFF", "#DE3831", "#002395", "#6CACE4", "#FFD100"],
      },
      importSources: weighted("ZW:6 MZ:4 ZM:4 CD:3 NA:3 BW:3 LS:2 SZ:2 MW:2 GH:2 NG:2 CO:2 AR:1 BR:1 UG:1 TZ:1 KE:1 CI:1 ML:1"),
      coefficients: { association: [13, 12, 11, 13.5, 15] },
    },
  ),
  abroad: {
    seniors: 45,
    youth: 8,
    destinations: weighted("US:5 EN:3 BE:3 PT:3 SCO:2 FR:2 NL:2 TR:2 GR:2 CY:2 SA:2 DE:1 AE:1 DK:1 SE:1 NO:1"),
  },
};

// ------------------------------------------------------------------ Ghana

const GH: NationSpec = {
  code: "GH",
  iso2: "GH",
  name: "Ghana",
  confederation: "CAF",
  continent: "AF",
  capital: "Accra",
  latitude: 5.6,
  languages: languages("en:6 ak:4 ee:2 gaa:1 dag:1"),
  reputation: { national: 68, league: 42 },
  euEea: false,
  physique: { height: 179 },
  names: {
    given: [src("anglophone", 4), src("akan", 4), src("dagbani", 2), src("ewe", 1)],
    family: [src("akan", 5), src("ewe", 2), src("dagbani", 2), src("ga", 2)],
  },
  nationality: {
    // London-, Germany-, Netherlands-, Italy- and Spain-born players of Ghanaian parents.
    multipleRate: 0.28,
    tripleRate: 0.03,
    bornAbroadRate: 0.14,
    diasporaPull: 0.55,
    links: [
      ...links("commonwealth", "EN:10 US:5 CA:2"),
      ...links("crossBorder", "DE:6 NL:5 IT:3 ES:2 BE:1"),
      ...links("regional", "NG:4 CI:4 TG:4 BF:2"),
    ],
    citizenship: allowed,
  },
  cities: {
    major: [
      city("Accra", "mega", "Greater Accra", 5, "Osu|Nima|Madina|Adabraka|Teshie|Nungua|Dansoman|Kaneshie|Mamprobi|Chorkor"),
      city("Kumasi", "mega", "Ashanti", 4, "Asokwa|Bantama|Suame|Manhyia|Adum|Tafo"),
      city("Tamale", "large", "Northern", 2),
      city("Tema", "large", "Greater Accra", 2),
      city("Sekondi-Takoradi", "large", "Western", 2),
      city("Kasoa", "medium", "Central", 1),
      city("Ashaiman", "medium", "Greater Accra", 1),
      city("Cape Coast", "medium", "Central", 1),
      city("Sunyani", "medium", "Bono", 1),
      city("Obuasi", "medium", "Ashanti", 1),
      city("Koforidua", "medium", "Eastern", 1),
      city("Ho", "medium", "Volta", 1),
      city("Techiman", "medium", "Bono East", 1),
      city("Wa", "medium", "Upper West", 1),
      city("Bolgatanga", "medium", "Upper East", 1),
      city("Tarkwa", "small", "Western"),
      city("Nkawkaw", "small", "Eastern"),
      city("Winneba", "small", "Central"),
      city("Dunkwa-on-Offin", "small", "Central"),
      city("Berekum", "small", "Bono"),
      city("Nsawam", "small", "Eastern"),
      city("Konongo", "small", "Ashanti"),
      city("Hohoe", "small", "Volta"),
      city("Aflao", "small", "Volta"),
      city("Yendi", "small", "Northern"),
      city("Bawku", "small", "Upper East"),
      city("Kintampo", "small", "Bono East"),
      city("Akim Oda", "small", "Eastern"),
      city("Agona Swedru", "small", "Central"),
      city("Mampong", "small", "Ashanti"),
      city("Ejura", "small", "Ashanti"),
      city("Prestea", "town", "Western"),
      city("Bibiani", "town", "Western North"),
      city("Sefwi Wiawso", "town", "Western North"),
      city("Dambai", "town", "Oti"),
      city("Nalerigu", "town", "North East"),
      city("Damongo", "town", "Savannah"),
      city("Goaso", "town", "Ahafo"),
      city("Bechem", "town", "Ahafo"),
      city("Dormaa Ahenkro", "town", "Bono"),
      city("Nkoranza", "town", "Bono East"),
    ],
  },
  football: singleTier(
    {
      tier: 1,
      name: "Ghana Premier League",
      shortName: "GPL",
      size: 18,
      status: "professional",
      reputation: 42,
      clubs: {
        reputation: { top: 52, bottom: 36 },
        giants: { count: 2, top: 58, bottom: 56 },
        capacity: { top: 40_000, bottom: 2_000 },
        facilities: { top: 48, bottom: 20 },
        academy: { top: 72, bottom: 32 },
        wageBill: { top: 700_000, bottom: 80_000 },
        transferBudget: { top: 150_000, bottom: 0 },
        foreignShare: 0.04,
        squadSize: [26, 30],
      },
    },
    {
      cups: [
        // MTN FA Cup without the sponsor.
        { kind: "national", name: "Ghanaian FA Cup", seededEntry: true, legs: 1, neutralFinal: true, continental: true },
        { kind: "super", name: "Ghana Super Cup", participants: ["champion", "cup-winner"], neutralFinal: true },
      ],
      youth: youthSingle("GFA Youth League U-19", "GFA Colts League U-17", 9, "Northern Zone|Southern Zone"),
      // Town names plus English nicknames, including Ghana's habit of borrowing European club names.
      clubNaming: {
        templates: templates(
          `{city} United:3; {city} Stars:2; {city} FC:2; {city} City:1; {city} Olympics:1; {city} Sharks:1;
           {city} Warriors:1; {city} Royals:1; {city} All Stars:1; {city} Gold Stars:1; {city} Kotoko:1;
           {city} Chelsea:1; {city} Arsenal:1; {city} Youth:1; {city} Heroes:1; {city} Mighty Eagles:1`,
        ),
        founded: { top: [1911, 2016], bottom: [1940, 2022] },
        avoid: list(
          `Asante Kotoko|Kumasi Asante Kotoko|Kumasi Kotoko|Hearts of Oak|Accra Hearts of Oak|Medeama|Aduana Stars|
           Berekum Chelsea|Bechem United|Dreams|Legon Cities|Great Olympics|Accra Great Olympics|Nations|Samartex|
           Bibiani Gold Stars|Heart of Lions|Karela United|Vision|Basake Holy Stars|Young Apostles|Hohoe United|
           Eleven Wonders|Real Tamale United|Ashanti Gold|Liberty Professionals|Inter Allies|King Faisal|Tema Youth|
           Techiman City|Berekum Arsenal|Sekondi Hasaacas|Hasaacas|Wa All Stars|Elmina Sharks|Accra Lions|Ebusua Dwarfs|
           Okwahu United|Steadfast|Kotoku Royals|Nzema Kotoko|Unistar Academy|Skyy|Tamale City|Accra City|Tema United|
           Kumasi United|Sunyani United|Obuasi Gold Stars|Cape Coast United|Koforidua United|Tamale Utrecht|
           Mighty Jets|Swedru All Blacks|Kumasi Cornerstones|Cornerstones|Great Mariners|Tema Sharks`,
        ),
        colors: ["#CE1126", "#FCD116", "#006B3F", "#000000", "#FFFFFF", "#1D4E9E", "#7A263A"],
      },
      importSources: weighted("NG:3 CI:3 TG:3 BF:3 LR:2 BJ:1 CM:1 SL:1 NE:1"),
      coefficients: { association: [5, 4, 3.5, 3, 3.5] },
    },
  ),
  abroad: {
    seniors: 230,
    youth: 32,
    destinations: weighted(
      `TR:10 US:8 EN:6 BE:6 IT:6 PT:6 FR:5 ES:5 SA:5 DE:4 DK:4 NL:3 GR:3 CY:3 SE:3 NO:3 CH:3 RS:3 QA:3 AE:3 EG:3
       MA:3 FI:2 AT:2 RO:2 RU:2 TN:2 ZA:2 IN:2 SK:2 CZ:2 MT:2 UA:1 DZ:1 CA:1 CN:1 KR:1 JP:1 TH:1 VN:1 HU:1 SI:1 HR:1
       LT:1 LV:1`,
    ),
  },
};

// ------------------------------------------------------------------ Cape Verde

const CV: NationSpec = {
  code: "CV",
  iso2: "CV",
  name: "Cape Verde",
  confederation: "CAF",
  continent: "AF",
  capital: "Praia",
  latitude: 14.9,
  languages: languages("pt:4 kea:6"),
  reputation: { national: 62, league: 28 },
  euEea: false,
  physique: { height: 180 },
  names: {
    given: [src("lusophone", 5), src("caboverdean", 3)],
    family: [src("caboverdean", 6), faker("pt_PT", 2)],
    secondFamilyRate: 0.25,
    mononymRate: 0.2,
  },
  nationality: {
    // More Cape Verdeans live abroad than on the islands; the Blue Sharks are largely diaspora-born.
    multipleRate: 0.45,
    tripleRate: 0.08,
    bornAbroadRate: 0.4,
    diasporaPull: 0.75,
    links: [
      ...links("lusophone", "PT:12 AO:1 ST:1 GW:1 BR:1"),
      ...links("dutchDiaspora", "NL:6"),
      ...links("frenchAfrica", "FR:4"),
      ...links("crossBorder", "LU:3 IT:1 ES:1 CH:1"),
      ...links("americas", "US:4"),
      ...links("regional", "SN:1"),
    ],
    citizenship: allowed,
  },
  cities: {
    major: [
      city("Praia", "large", "Santiago", 3, "Achada Santo António|Várzea|Fazenda|Palmarejo|Tira Chapéu"),
      city("Mindelo", "medium", "São Vicente", 3, "Monte Sossego|Ribeira Bote|Fonte Filipe|Chã de Alecrim"),
      city("Santa Maria", "small", "Sal"),
      city("Espargos", "small", "Sal"),
      city("Assomada", "small", "Santiago"),
      city("Pedra Badejo", "small", "Santiago"),
      city("Tarrafal", "small", "Santiago"),
      city("Porto Novo", "small", "Santo Antão"),
      city("Ribeira Grande", "small", "Santo Antão"),
      city("São Filipe", "small", "Fogo"),
      city("São Domingos", "town", "Santiago"),
      city("Ponta do Sol", "town", "Santo Antão"),
      city("Mosteiros", "town", "Fogo"),
      city("Sal Rei", "town", "Boa Vista"),
      city("Vila do Maio", "town", "Maio"),
      city("Nova Sintra", "town", "Brava"),
      city("Ribeira Brava", "town", "São Nicolau"),
      city("Tarrafal de São Nicolau", "town", "São Nicolau"),
      city("Calheta de São Miguel", "town", "Santiago"),
      city("Cidade Velha", "town", "Santiago"),
      city("Pombas", "town", "Santo Antão"),
    ],
  },
  football: singleTier(
    {
      tier: 1,
      // Island leagues feed the national championship: two groups of six, then a four-club title mini-league.
      name: "Campeonato Nacional",
      shortName: "Nacional",
      size: 12,
      conferences: ["Grupo A", "Grupo B"],
      championship: {
        positions: [1, 2],
        perConference: true,
        format: "round-robin",
        roundRobins: 2,
        legs: 1,
      },
      status: "semi-professional",
      reputation: 28,
      clubs: {
        reputation: { top: 34, bottom: 22 },
        capacity: { top: 15_000, bottom: 1_000 },
        facilities: { top: 30, bottom: 12 },
        academy: { top: 38, bottom: 18 },
        wageBill: { top: 120_000, bottom: 15_000 },
        transferBudget: { top: 20_000, bottom: 0 },
        foreignShare: 0.03,
        squadSize: [25, 28],
      },
    },
    {
      cups: [
        { kind: "national", name: "Taça de Cabo Verde", legs: 1, neutralFinal: true, continental: true },
      ],
      youth: youthSingle("Campeonato Nacional de Juniores", "Campeonato Nacional de Juvenis", 8, "Barlavento|Sotavento"),
      clubNaming: {
        templates: templates(
          `Académica de {city}:2; Sporting de {city}:2; Desportivo de {city}:2; União de {city}:1; Juventude de {city}:1;
           Estrela de {city}:1; Atlético de {city}:1; Benfica de {city}:1; GD {city}:1; {city} FC:1; Grémio {city}:1`,
        ),
        founded: { top: [1919, 1990], bottom: [1930, 2010] },
        avoid: list(
          `Sporting Clube da Praia|Sporting da Praia|CD Travadores|Travadores|Académica da Praia|Boavista da Praia|
           Mindelense|CS Mindelense|Derby|FC Derby|Batuque|Académica do Mindelo|Salamansa|Castilho|Académico do Aeroporto|
           Sal Rei|Sporting da Brava|Vulcânicos|Académica do Fogo|Paulense|Rosariense|Solpontense|Ultramarina|
           Scorpion Vermelho|Varandinha|Os Garridos|Onze Unidos|Juventude do Sal|Benfica da Praia|Desportivo da Praia|
           Académica do Sal|Académica do Porto Novo|Sporting do Porto Novo|Benfica do Mindelo|Estrela dos Amadores`,
        ),
        colors: ["#003893", "#CF2027", "#F7D116", "#FFFFFF", "#000000", "#00843D"],
      },
      importSources: weighted("GW:3 SN:2 ST:1 AO:1 BR:1 PT:1"),
      coefficients: { association: [1.5, 1.5, 2, 2, 2.5] },
    },
  ),
  abroad: {
    seniors: 90,
    youth: 12,
    destinations: weighted(
      "PT:30 NL:6 FR:4 LU:4 ES:3 CY:3 US:3 BE:2 GR:2 TR:2 RO:2 BG:2 AO:2 IE:1 IT:1 DE:1 SA:1 QA:1 IS:1 SE:1 NO:1",
    ),
  },
};

// ------------------------------------------------------------------ Angola

const AO: NationSpec = {
  code: "AO",
  iso2: "AO",
  name: "Angola",
  confederation: "CAF",
  continent: "AF",
  capital: "Luanda",
  latitude: -8.8,
  languages: languages("pt:6 umb:2 kmb:2 kg:1"),
  reputation: { national: 56, league: 45 },
  euEea: false,
  physique: { height: 178 },
  names: {
    given: [src("lusophone", 6), src("congolese", 1)],
    family: [src("angolan", 6), src("kongo", 1), faker("pt_PT", 1)],
    secondFamilyRate: 0.2,
    mononymRate: 0.15,
  },
  nationality: {
    // Portugal-born Palancas Negras and Angolan-Congolese families.
    multipleRate: 0.24,
    tripleRate: 0.02,
    bornAbroadRate: 0.1,
    diasporaPull: 0.55,
    links: [
      ...links("lusophone", "PT:10 BR:4 CV:2 ST:1"),
      ...links("regional", "CD:4 NA:2 ZA:1"),
      ...links("frenchAfrica", "FR:1"),
    ],
    // The 2016 nationality law allows dual nationality.
    citizenship: allowed,
  },
  cities: {
    major: [
      city("Luanda", "mega", "Luanda", 6, "Cazenga|Viana|Rangel|Maianga|Sambizanga|Cacuaco|Kilamba Kiaxi|Talatona|Ingombota"),
      city("Huambo", "large", "Huambo", 2),
      city("Lubango", "large", "Huíla", 2),
      city("Benguela", "large", "Benguela", 2),
      city("Lobito", "large", "Benguela", 2),
      city("Cabinda", "large", "Cabinda", 2),
      city("Malanje", "medium", "Malanje", 1),
      city("Saurimo", "medium", "Lunda Sul", 1),
      city("Uíge", "medium", "Uíge", 1),
      city("Kuito", "medium", "Bié", 1),
      city("Namibe", "medium", "Namibe", 1),
      city("Soyo", "medium", "Zaire", 1),
      city("Sumbe", "medium", "Cuanza Sul", 1),
      city("Luena", "medium", "Moxico", 1),
      city("Dundo", "small", "Lunda Norte"),
      city("Menongue", "small", "Cuando Cubango"),
      city("Ondjiva", "small", "Cunene"),
      city("N'dalatando", "small", "Cuanza Norte"),
      city("Caxito", "small", "Bengo"),
      city("Mbanza Kongo", "small", "Zaire"),
      city("Lucapa", "small", "Lunda Norte"),
      city("Catumbela", "small", "Benguela"),
      city("Caála", "small", "Huambo"),
      city("Gabela", "town", "Cuanza Sul"),
      city("Porto Amboim", "town", "Cuanza Sul"),
      city("Tômbua", "town", "Namibe"),
      city("Negage", "town", "Uíge"),
    ],
  },
  football: singleTier(
    {
      tier: 1,
      name: "Girabola",
      shortName: "Girabola",
      size: 16,
      status: "professional",
      reputation: 45,
      clubs: {
        reputation: { top: 54, bottom: 36 },
        giants: { count: 2, top: 64, bottom: 60 },
        capacity: { top: 48_000, bottom: 2_000 },
        facilities: { top: 60, bottom: 25 },
        academy: { top: 58, bottom: 28 },
        wageBill: { top: 4_000_000, bottom: 150_000 },
        transferBudget: { top: 800_000, bottom: 0 },
        foreignShare: 0.12,
        squadSize: [27, 32],
      },
    },
    {
      cups: [
        { kind: "national", name: "Taça de Angola", seededEntry: true, legs: 1, neutralFinal: true, continental: true },
        { kind: "super", name: "Supertaça de Angola", participants: ["champion", "cup-winner"], neutralFinal: true },
      ],
      youth: youthSingle("Campeonato Nacional de Juniores", "Campeonato Nacional de Juvenis", 8, "Série A|Série B"),
      // Portuguese forms plus the company and institution clubs (oil, army, police, railways).
      clubNaming: {
        templates: templates(
          `Atlético de {city}:2; Desportivo de {city}:2; Sporting de {city}:2; Académica de {city}:2; Recreativo de {city}:2;
           Ferroviário de {city}:2; Petro de {city}:1; Progresso de {city}:1; Benfica de {city}:1; GD {city}:1;
           Estrela de {city}:1; Juventude de {city}:1; União de {city}:1; {city} FC:1; Inter de {city}:1; Santos de {city}:1`,
        ),
        founded: { top: [1920, 2010], bottom: [1940, 2020] },
        avoid: list(
          `Petro de Luanda|Petro Atlético|Atlético Petróleos de Luanda|Primeiro de Agosto|1º de Agosto|Interclube|
           Sagrada Esperança|Kabuscorp|Progresso do Sambizanga|Desportivo da Huíla|Recreativo do Libolo|Bravos do Maquis|
           Wiliete|Académica do Lobito|Académica Petróleos do Lobito|Santa Rita de Cássia|Sporting de Cabinda|
           Recreativo da Caála|Ferroviário do Huambo|Petro do Huambo|Primeiro de Maio|Atlético Sport Aviação|ASA|
           Benfica de Luanda|Kuando Kubango|Luanda City|Jackson Garcia|Desportivo do Bengo|Isaac de Benguela|
           Sporting de Benguela|Benfica do Lubango|Desportivo da Lunda Sul|Académica do Soyo|Sporting de Luanda|
           Ferroviário de Luanda|Petro de Benguela|Atlético do Namibe|Recreativo do Uíge|Progresso da Lunda Sul`,
        ),
        colors: ["#CC092F", "#000000", "#FFCB00", "#FFFFFF", "#005BAC", "#00843D"],
      },
      importSources: weighted("CD:5 BR:4 CG:2 CM:2 NG:2 PT:2 GH:1 CI:1 ML:1 ZM:1 NA:1 CV:1 MZ:1 ST:1 GW:1"),
      coefficients: { association: [7, 8, 8.5, 9, 9.5] },
    },
  ),
  abroad: {
    seniors: 55,
    youth: 10,
    destinations: weighted("PT:22 FR:2 BE:2 ES:2 CY:2 TR:2 ZA:2 GR:1 SA:1 AE:1 EG:1 MA:1 BR:1 US:1 CD:1 IT:1"),
  },
};

// ------------------------------------------------------------------ Mozambique

const MZ: NationSpec = {
  code: "MZ",
  iso2: "MZ",
  name: "Mozambique",
  confederation: "CAF",
  continent: "AF",
  capital: "Maputo",
  latitude: -25.97,
  languages: languages("pt:6 vmw:2 ts:2 seh:1"),
  reputation: { national: 50, league: 35 },
  euEea: false,
  physique: { height: 176 },
  names: {
    given: [src("lusophone", 6), src("anglophone", 1)],
    family: [src("mozambican", 6), src("tsonga-venda", 1), faker("pt_PT", 1)],
    mononymRate: 0.12,
  },
  nationality: {
    multipleRate: 0.18,
    tripleRate: 0.015,
    bornAbroadRate: 0.06,
    diasporaPull: 0.5,
    links: [
      ...links("lusophone", "PT:8 BR:2"),
      ...links("regional", "ZA:8 ZW:3 MW:2 SZ:1 TZ:1"),
    ],
    citizenship: allowed,
  },
  cities: {
    major: [
      city("Maputo", "large", "Maputo City", 4, "Mafalala|Chamanculo|Polana|Xipamanine|Alto Maé|Malhangalene|Aeroporto"),
      city("Matola", "large", "Maputo Province", 2, "Machava|Liberdade"),
      city("Beira", "large", "Sofala", 2),
      city("Nampula", "large", "Nampula", 2),
      city("Chimoio", "medium", "Manica", 1),
      city("Quelimane", "medium", "Zambézia", 1),
      city("Tete", "medium", "Tete", 1),
      city("Nacala", "medium", "Nampula", 1),
      city("Lichinga", "medium", "Niassa", 1),
      city("Pemba", "medium", "Cabo Delgado", 1),
      city("Xai-Xai", "medium", "Gaza", 1),
      city("Inhambane", "small", "Inhambane"),
      city("Maxixe", "small", "Inhambane"),
      city("Gurué", "small", "Zambézia"),
      city("Mocuba", "small", "Zambézia"),
      city("Cuamba", "small", "Niassa"),
      city("Montepuez", "small", "Cabo Delgado"),
      city("Dondo", "small", "Sofala"),
      city("Chókwè", "small", "Gaza"),
      city("Moatize", "small", "Tete"),
      city("Angoche", "small", "Nampula"),
      city("Manica", "town", "Manica"),
      city("Chibuto", "town", "Gaza"),
      city("Vilankulo", "town", "Inhambane"),
      city("Ressano Garcia", "town", "Maputo Province"),
      city("Songo", "town", "Tete"),
      city("Marracuene", "town", "Maputo Province"),
      city("Boane", "town", "Maputo Province"),
    ],
  },
  football: singleTier(
    {
      tier: 1,
      // Played in the calendar year in reality; modeled in the shared July-June season (decision 10).
      name: "Moçambola",
      shortName: "Moçambola",
      size: 14,
      status: "professional",
      reputation: 35,
      clubs: {
        reputation: { top: 44, bottom: 30 },
        capacity: { top: 42_000, bottom: 2_000 },
        facilities: { top: 40, bottom: 15 },
        academy: { top: 45, bottom: 20 },
        wageBill: { top: 500_000, bottom: 60_000 },
        transferBudget: { top: 60_000, bottom: 0 },
        foreignShare: 0.06,
        squadSize: [25, 30],
      },
    },
    {
      cups: [
        { kind: "national", name: "Taça de Moçambique", seededEntry: true, legs: 1, neutralFinal: true, continental: true },
        { kind: "super", name: "Supertaça de Moçambique", participants: ["champion", "cup-winner"], neutralFinal: true },
      ],
      youth: youthSingle("Campeonato Nacional de Juniores", "Campeonato Nacional de Juvenis", 8, "Zona Sul|Zona Centro-Norte"),
      clubNaming: {
        templates: templates(
          `Ferroviário de {city}:3; Desportivo de {city}:2; GD {city}:2; CD {city}:1; Estrela de {city}:1;
           Liga Desportiva de {city}:1; Clube de {city}:1; União Desportiva de {city}:1; Atlético de {city}:1; {city} FC:1;
           Académica de {city}:1; Sporting de {city}:1; Têxtil de {city}:1; Mineiro de {city}:1`,
        ),
        founded: { top: [1920, 2012], bottom: [1940, 2020] },
        avoid: list(
          `Ferroviário de Maputo|Ferroviário da Beira|Ferroviário de Nampula|Ferroviário de Nacala|Ferroviário de Lichinga|
           Ferroviário de Quelimane|Ferroviário de Pemba|Ferroviário de Inhambane|Ferroviário de Gaza|Costa do Sol|
           Black Bulls|Liga Desportiva de Maputo|Liga Muçulmana|UD Songo|União Desportiva do Songo|Desportivo de Maputo|
           Maxaquene|Textáfrica|Textáfrica do Chimoio|Chingale|Matchedje|Incomáti|Baía de Pemba|Clube de Chibuto|
           Vilankulo|ENH de Vilankulo|Desportivo de Nacala|Estrela Vermelha|Académica de Maputo|Sporting da Beira|
           Ferroviário de Tete|Desportivo de Quelimane`,
        ),
        colors: ["#D21034", "#007168", "#FCE100", "#000000", "#FFFFFF", "#1D4E9E"],
      },
      importSources: weighted("ZW:3 MW:3 ZA:2 TZ:2 ZM:2 AO:1 BR:1 CD:1 NG:1 CM:1"),
      coefficients: { association: [2, 2, 2.5, 2.5, 3] },
    },
  ),
  abroad: {
    seniors: 35,
    youth: 6,
    destinations: weighted("PT:14 ZA:10 AO:2 TR:1 CY:1 GR:1 FR:1 BE:1 SA:1 US:1"),
  },
};

// ------------------------------------------------------------------ Guinea-Bissau

const GW: NationSpec = {
  code: "GW",
  iso2: "GW",
  name: "Guinea-Bissau",
  confederation: "CAF",
  continent: "AF",
  capital: "Bissau",
  latitude: 11.9,
  languages: languages("pt:3 pov:6 ff:1"),
  reputation: { national: 50, league: 20 },
  euEea: false,
  physique: { height: 180 },
  names: {
    given: [src("lusophone", 4), src("fula", 2), src("mande", 1)],
    family: [src("bissau-guinean", 5), src("fula", 2), src("mande", 1)],
    mononymRate: 0.15,
  },
  nationality: {
    // Portugal-born and Portugal-raised players make up much of the Djurtus squad.
    multipleRate: 0.4,
    tripleRate: 0.05,
    bornAbroadRate: 0.3,
    diasporaPull: 0.6,
    links: [
      ...links("lusophone", "PT:12 CV:2"),
      ...links("regional", "SN:5 GN:3 GM:1"),
      ...links("frenchAfrica", "FR:2"),
      ...links("crossBorder", "ES:1"),
    ],
    citizenship: allowed,
  },
  cities: {
    major: [
      city("Bissau", "large", "Bissau", 5, "Bairro Militar|Cupelon|Bandim|Pefine|Belém|Antula|Mindará"),
      city("Bafatá", "small", "Bafatá"),
      city("Gabú", "small", "Gabú"),
      city("Canchungo", "small", "Cacheu"),
      city("Bissorã", "small", "Oio"),
      city("Bolama", "town", "Bolama"),
      city("Cacheu", "town", "Cacheu"),
      city("Farim", "town", "Oio"),
      city("Quinhámel", "town", "Biombo"),
      city("Mansoa", "town", "Oio"),
      city("Buba", "town", "Quinara"),
      city("Catió", "town", "Tombali"),
      city("Bubaque", "town", "Bolama"),
      city("São Domingos", "town", "Cacheu"),
      city("Bula", "town", "Cacheu"),
      city("Fulacunda", "town", "Quinara"),
      city("Pirada", "town", "Gabú"),
      city("Contuboel", "town", "Bafatá"),
    ],
  },
  football: singleTier(
    {
      tier: 1,
      name: "Campeonato Nacional da Guiné-Bissau",
      shortName: "Campeonato Nacional",
      size: 14,
      status: "amateur",
      reputation: 20,
      clubs: {
        reputation: { top: 28, bottom: 16 },
        capacity: { top: 20_000, bottom: 500 },
        facilities: { top: 20, bottom: 8 },
        academy: { top: 30, bottom: 12 },
        wageBill: { top: 60_000, bottom: 10_000 },
        transferBudget: { top: 5_000, bottom: 0 },
        foreignShare: 0.02,
        squadSize: [25, 28],
      },
    },
    {
      cups: [
        { kind: "national", name: "Taça Nacional da Guiné-Bissau", legs: 1, neutralFinal: true, continental: true },
      ],
      youth: youthSingle("Campeonato Nacional de Juniores", "Campeonato Nacional de Juvenis", 14),
      clubNaming: {
        templates: templates(
          `Sporting de {city}:2; Benfica de {city}:2; FC {city}:2; Desportivo de {city}:1; Atlético de {city}:1;
           Estrela de {city}:1; União de {city}:1; Juventude de {city}:1; Tigres de {city}:1; Flamengo de {city}:1;
           Os Leões de {city}:1; GD {city}:1`,
        ),
        founded: { top: [1936, 2005], bottom: [1950, 2015] },
        avoid: list(
          `Sporting Clube de Bissau|Sporting de Bissau|Benfica de Bissau|Sport Bissau e Benfica|UDIB|
           União Desportiva Internacional de Bissau|Estrela Negra de Bissau|Os Balantas|FC Canchungo|FC Cantchungo|
           Atlético de Bissorã|Nuno Tristão|Lagartos|Mavegro|Tigres de Fronteira|Portos de Bissau|Flamengo de Pefine|
           Sporting de Bafatá|FC Porto de Bissau|Desportivo de Gabú|Cuntum|Benfica de Bafatá|FC Sonaco|Tchico Té`,
        ),
        colors: ["#CE1126", "#FCD116", "#009E49", "#000000", "#FFFFFF", "#1D4E9E"],
      },
      importSources: weighted("SN:3 GN:3 CV:1 GM:1"),
      coefficients: { association: [1, 1, 1.5, 1.5, 1.5] },
    },
  ),
  abroad: {
    seniors: 80,
    youth: 10,
    destinations: weighted("PT:34 FR:4 ES:4 SN:2 CY:2 GR:1 RO:1 TR:1 BE:1 IT:1 CV:1 MA:1 US:1"),
  },
};

// ------------------------------------------------------------------ Equatorial Guinea

const GQ: NationSpec = {
  code: "GQ",
  iso2: "GQ",
  name: "Equatorial Guinea",
  confederation: "CAF",
  continent: "AF",
  capital: "Malabo",
  latitude: 3.75,
  languages: languages("es:6 fan:4 fr:1 pt:1"),
  reputation: { national: 54, league: 26 },
  euEea: false,
  physique: { height: 178 },
  names: {
    given: [src("equatoguinean", 5), faker("es", 1), src("francophone", 1)],
    family: [src("fang", 6), src("bubi", 2), faker("es", 1)],
    secondFamilyRate: 0.3,
  },
  nationality: {
    // Spain-born players of Equatoguinean parents are a large part of the Nzalang Nacional.
    multipleRate: 0.3,
    tripleRate: 0.03,
    bornAbroadRate: 0.2,
    diasporaPull: 0.6,
    links: [
      ...links("mediterranean", "ES:10"),
      ...links("regional", "CM:5 GA:3 NG:2 ST:1"),
      ...links("frenchAfrica", "FR:1"),
    ],
    // Dual nationality is only recognised with Spain (bilateral treaty; Spanish Civil Code art. 24).
    citizenship: partners("ES"),
  },
  cities: {
    major: [
      city("Malabo", "large", "Bioko Norte", 4, "Ela Nguema|Campo Yaundé|Los Ángeles|Sampaka|Banapá"),
      city("Bata", "large", "Litoral", 4, "Ncolombong|Comandachina|Nkoantoma|Ekuku"),
      city("Ebebiyín", "small", "Kié-Ntem"),
      city("Mongomo", "small", "Wele-Nzas"),
      city("Añisok", "small", "Wele-Nzas"),
      city("Luba", "small", "Bioko Sur"),
      city("Evinayong", "small", "Centro Sur"),
      city("Aconibe", "town", "Wele-Nzas"),
      city("Mbini", "town", "Litoral"),
      city("Nsork", "town", "Wele-Nzas"),
      city("Mikomeseng", "town", "Kié-Ntem"),
      city("Niefang", "town", "Centro Sur"),
      city("Riaba", "town", "Bioko Sur"),
      city("Baney", "town", "Bioko Norte"),
      city("Rebola", "town", "Bioko Norte"),
      city("Cogo", "town", "Litoral"),
      city("San Antonio de Palé", "town", "Annobón"),
      city("Ciudad de la Paz", "town", "Djibloho"),
      city("Acurenam", "town", "Centro Sur"),
      city("Moka", "town", "Bioko Sur"),
    ],
  },
  football: singleTier(
    {
      tier: 1,
      // Real: an island (Bioko) and a mainland group, then a final round; modeled as one national table.
      name: "Liga Nacional de Fútbol",
      shortName: "Liga Nacional",
      size: 14,
      status: "semi-professional",
      reputation: 26,
      clubs: {
        reputation: { top: 36, bottom: 24 },
        capacity: { top: 35_000, bottom: 1_000 },
        facilities: { top: 38, bottom: 14 },
        academy: { top: 32, bottom: 15 },
        wageBill: { top: 400_000, bottom: 40_000 },
        transferBudget: { top: 60_000, bottom: 0 },
        foreignShare: 0.15,
        squadSize: [25, 28],
      },
    },
    {
      cups: [
        { kind: "national", name: "Copa del Presidente de la República", legs: 1, neutralFinal: true, continental: true },
      ],
      youth: youthSingle("Liga Nacional Juvenil", "Liga Nacional Cadete", 8, "Norte|Sur"),
      clubNaming: {
        templates: templates(
          `Deportivo {city}:3; CD {city}:2; Atlético {city}:2; {city} FC:2; Racing de {city}:1; Real {city}:1;
           Unión {city}:1; Estrellas de {city}:1; Leones de {city}:1; Juventud {city}:1; Renacimiento de {city}:1;
           AD {city}:1; Inter {city}:1`,
        ),
        founded: { top: [1960, 2015], bottom: [1970, 2020] },
        avoid: list(
          `Cano Sport Academy|Cano Sport|Deportivo Mongomo|Futuro Kings|Akonangui|Leones Vegetarianos|The Panthers|
           Atlético Semu|Deportivo Unidad|Racing de Micomeseng|Sony Elá Nguema|Atlético Malabo|CD Elá Nguema|Real Castel|
           Renacimiento|15 de Agosto|Unión Vesper|Dragón|Deportivo Evinayong|Atlético Ebebiyín|San Pablo de Mikomeseng|
           Estrellas de Ebebiyín|Deportivo Ebebiyín|Leones de Bata`,
        ),
        colors: ["#3E9A00", "#E32118", "#0073CE", "#FFFFFF", "#000000", "#FFD100"],
      },
      importSources: weighted("CM:6 GA:3 NG:2 ST:1 CG:1 CI:1 ES:1"),
      coefficients: { association: [1.5, 1.5, 1.5, 2, 2] },
    },
  ),
  abroad: {
    seniors: 40,
    youth: 6,
    destinations: weighted("ES:20 PT:2 FR:1 CM:1 GR:1 CY:1 TR:1 MA:1"),
  },
};

// ------------------------------------------------------------------ Zimbabwe

const ZW: NationSpec = {
  code: "ZW",
  iso2: "ZW",
  name: "Zimbabwe",
  confederation: "CAF",
  continent: "AF",
  capital: "Harare",
  latitude: -17.8,
  languages: languages("en:3 sn:6 nd:3"),
  reputation: { national: 50, league: 38 },
  euEea: false,
  physique: { height: 177 },
  names: {
    given: [src("anglophone", 4), src("shona", 4), src("ndebele", 1)],
    family: [src("shona", 6), src("ndebele", 3)],
  },
  nationality: {
    // England-born players of Zimbabwean parents and South Africa-born Zimbabweans.
    multipleRate: 0.22,
    tripleRate: 0.02,
    bornAbroadRate: 0.1,
    diasporaPull: 0.45,
    links: [
      ...links("commonwealth", "EN:8 SCO:1 AU:1"),
      ...links("regional", "ZA:10 ZM:4 MZ:3 MW:2 BW:1"),
    ],
    // The 2013 constitution lets citizens by birth hold another nationality.
    citizenship: allowed,
  },
  cities: {
    major: [
      city("Harare", "mega", "Harare", 5, "Mbare|Highfield|Glen Norah|Mabvuku|Borrowdale|Budiriro|Warren Park|Kuwadzana"),
      city("Bulawayo", "large", "Bulawayo", 4, "Makokoba|Mpopoma|Luveve|Njube|Pumula|Entumbane"),
      city("Chitungwiza", "large", "Harare", 2, "Seke|Zengeza"),
      city("Mutare", "medium", "Manicaland", 2, "Sakubva|Dangamvura"),
      city("Gweru", "medium", "Midlands", 2, "Mkoba|Senga"),
      city("Kwekwe", "medium", "Midlands", 1),
      city("Kadoma", "medium", "Mashonaland West", 1),
      city("Masvingo", "medium", "Masvingo", 1),
      city("Chinhoyi", "medium", "Mashonaland West", 1),
      city("Epworth", "small", "Harare"),
      city("Marondera", "small", "Mashonaland East"),
      city("Norton", "small", "Mashonaland West"),
      city("Bindura", "small", "Mashonaland Central"),
      city("Zvishavane", "small", "Midlands"),
      city("Victoria Falls", "small", "Matabeleland North"),
      city("Beitbridge", "small", "Matabeleland South"),
      city("Kariba", "small", "Mashonaland West"),
      city("Chegutu", "small", "Mashonaland West"),
      city("Redcliff", "small", "Midlands"),
      city("Rusape", "small", "Manicaland"),
      city("Chiredzi", "small", "Masvingo"),
      city("Gwanda", "small", "Matabeleland South"),
      city("Ruwa", "small", "Mashonaland East"),
      city("Shurugwi", "town", "Midlands"),
      city("Triangle", "town", "Masvingo"),
      city("Plumtree", "town", "Matabeleland South"),
      city("Karoi", "town", "Mashonaland West"),
      city("Mashava", "town", "Masvingo"),
      city("Ngezi", "town", "Mashonaland West"),
      city("Chipinge", "town", "Manicaland"),
      city("Mvurwi", "town", "Mashonaland Central"),
      city("Gokwe", "town", "Midlands"),
      city("Lupane", "town", "Matabeleland North"),
    ],
  },
  football: singleTier(
    {
      tier: 1,
      // Castle Lager PSL without the sponsor; a calendar-year league modeled in the July-June season.
      name: "Premier Soccer League",
      shortName: "PSL",
      size: 18,
      status: "professional",
      reputation: 38,
      clubs: {
        reputation: { top: 46, bottom: 32 },
        capacity: { top: 60_000, bottom: 2_000 },
        facilities: { top: 35, bottom: 14 },
        academy: { top: 50, bottom: 25 },
        wageBill: { top: 500_000, bottom: 70_000 },
        transferBudget: { top: 50_000, bottom: 0 },
        foreignShare: 0.04,
        squadSize: [26, 30],
      },
    },
    {
      cups: [
        // The ZIFA cup has only carried sponsor names; its current official name is used.
        { kind: "national", name: "Chibuku Super Cup", seededEntry: true, legs: 1, neutralFinal: true, continental: true },
      ],
      youth: youthSingle("PSL Juniors League U-19", "PSL Juniors League U-17", 9, "Northern Region|Southern Region"),
      // Town names with English nicknames plus the mining, energy and sugar company clubs.
      clubNaming: {
        templates: templates(
          `{city} United:3; {city} City:2; {city} Rovers:1; {city} Stars:1; {city} Bullets:1; {city} Strikers:1;
           {city} Pirates:1; {city} Chiefs:1; {city} Warriors:1; {city} Eagles:1; {city} Platinum:1; {city} Colliery:1;
           {city} Mine:1; {city} Diamonds:1; {city} Minerals:1; {city} Sugar:1; {city} Power:1`,
        ),
        founded: { top: [1926, 2018], bottom: [1950, 2022] },
        avoid: list(
          `Dynamos|Highlanders|CAPS United|FC Platinum|Platinum|Ngezi Platinum Stars|Manica Diamonds|Chicken Inn|
           Bulawayo Chiefs|Herentals|Simba Bhora|TelOne|Yadah Stars|Yadah|GreenFuel|Triangle United|Hwange Colliery|
           Hwange|ZPC Kariba|Black Rhinos|Cranborne Bullets|Sheasham|Arenel Movers|Bikita Minerals|Chegutu Pirates|
           Kwekwe United|Tenax|Bulawayo City|Harare City|Mutare City Rovers|Border Strikers|Scottland|MWOS|Hardrock|
           Golden Eagles|Motor Action|Buffaloes|Black Mambas|ZRP|Gweru United|Chitungwiza United|Masvingo United|
           Shabanie Mine|Zvishavane Mine|Mutare United|Kadoma United|Chinhoyi United|Bulawayo United|Harare United`,
        ),
        colors: ["#006400", "#FFD200", "#D40000", "#000000", "#FFFFFF", "#1D4E9E", "#6CACE4"],
      },
      importSources: weighted("ZM:4 MW:3 MZ:2 CD:1 NG:1 GH:1 ZA:1 CM:1"),
      coefficients: { association: [1, 1.5, 2, 1.5, 2] },
    },
  ),
  abroad: {
    seniors: 60,
    youth: 10,
    destinations: weighted("ZA:20 EN:4 SCO:2 BE:2 TR:2 US:2 PT:1 FR:1 CY:1 GR:1 SA:1"),
  },
};

// ------------------------------------------------------------------ Congo

const CG: NationSpec = {
  code: "CG",
  iso2: "CG",
  name: "Congo",
  confederation: "CAF",
  continent: "AF",
  capital: "Brazzaville",
  latitude: -4.3,
  languages: languages("fr:5 ln:3 kg:2"),
  reputation: { national: 48, league: 34 },
  euEea: false,
  physique: { height: 180 },
  names: {
    given: [src("francophone", 5), src("congolese", 3)],
    family: [src("kongo", 5), src("congo-north", 4)],
  },
  nationality: {
    // France-born Diables Rouges and cross-river DR Congo families.
    multipleRate: 0.28,
    tripleRate: 0.03,
    bornAbroadRate: 0.14,
    diasporaPull: 0.55,
    links: [
      ...links("frenchAfrica", "FR:10 BE:1"),
      ...links("regional", "CD:8 GA:3 AO:1 CM:1 CF:1"),
    ],
    citizenship: allowed,
  },
  cities: {
    major: [
      city("Brazzaville", "large", "Brazzaville", 5, "Poto-Poto|Bacongo|Makélékélé|Moungali|Ouenzé|Talangaï|Mfilou|Djiri"),
      city("Pointe-Noire", "large", "Pointe-Noire", 4, "Tié-Tié|Loandjili|Mvou-Mvou|Lumumba|Ngoyo"),
      city("Dolisie", "medium", "Niari", 1),
      city("Nkayi", "small", "Bouenza"),
      city("Owando", "small", "Cuvette"),
      city("Ouesso", "small", "Sangha"),
      city("Madingou", "small", "Bouenza"),
      city("Impfondo", "small", "Likouala"),
      city("Sibiti", "small", "Lékoumou"),
      city("Oyo", "small", "Cuvette"),
      city("Mossendjo", "small", "Niari"),
      city("Kinkala", "town", "Pool"),
      city("Gamboma", "town", "Plateaux"),
      city("Djambala", "town", "Plateaux"),
      city("Ewo", "town", "Cuvette-Ouest"),
      city("Makoua", "town", "Cuvette"),
      city("Loutété", "town", "Bouenza"),
      city("Mouyondzi", "town", "Bouenza"),
      city("Mindouli", "town", "Pool"),
      city("Boko", "town", "Pool"),
      city("Pokola", "town", "Sangha"),
      city("Kintélé", "town", "Pool"),
    ],
  },
  football: singleTier(
    {
      tier: 1,
      name: "Ligue 1",
      shortName: "Ligue 1",
      size: 14,
      status: "professional",
      reputation: 34,
      clubs: {
        reputation: { top: 42, bottom: 28 },
        capacity: { top: 33_000, bottom: 1_500 },
        facilities: { top: 38, bottom: 14 },
        academy: { top: 42, bottom: 18 },
        wageBill: { top: 500_000, bottom: 40_000 },
        transferBudget: { top: 50_000, bottom: 0 },
        foreignShare: 0.08,
        squadSize: [25, 30],
      },
    },
    {
      cups: [
        { kind: "national", name: "Coupe du Congo", seededEntry: true, legs: 1, neutralFinal: true, continental: true },
        { kind: "super", name: "Supercoupe du Congo", participants: ["champion", "cup-winner"], neutralFinal: true },
      ],
      youth: youthSingle("Championnat National U19", "Championnat National U17", 8, "Poule Nord|Poule Sud"),
      clubNaming: {
        templates: templates(
          `AS {city}:3; FC {city}:2; JS {city}:2; Étoile de {city}:1; Inter Club de {city}:1; AC {city}:1;
           Racing Club de {city}:1; CS {city}:1; Olympique de {city}:1; Diables de {city}:1; Renaissance de {city}:1;
           Patronage de {city}:1; {city} Sport:1; Munisport de {city}:1`,
        ),
        founded: { top: [1932, 2012], bottom: [1950, 2020] },
        avoid: list(
          `AS Otohô|Otohô|Diables Noirs|CARA Brazzaville|CARA|Étoile du Congo|Inter Club|AC Léopards|Léopards de Dolisie|
           Patronage Sainte-Anne|V.Club Mokanda|Vita Club Mokanda|JS Talangaï|FC Kondzo|AS Kondzo|AS Cheminots|
           Nico-Nicoyé|BNG|Racing Club de Brazzaville|La Mancha|Tongo|Saint-Michel de Ouenzé|AS Juk|Munisport|
           AS Ponténégrine|AS Police|Jeunesse Sportive de Talangaï|FC Nathaly's|AS Pointe-Noire|AS Brazzaville`,
        ),
        colors: ["#009543", "#FBDE4A", "#DC241F", "#000000", "#FFFFFF", "#1D4E9E"],
      },
      importSources: weighted("CD:6 CM:2 CI:1 GA:1 CF:1 ML:1 BF:1"),
      coefficients: { association: [3, 2.5, 2.5, 3, 3] },
    },
  ),
  abroad: {
    seniors: 60,
    youth: 10,
    destinations: weighted("FR:22 BE:3 PT:3 MA:3 TR:2 CY:2 TN:2 DZ:2 CD:2 GR:1 SA:1 AE:1 CH:1 DE:1 US:1 GQ:1"),
  },
};

// ------------------------------------------------------------------ Ethiopia

const ET: NationSpec = {
  code: "ET",
  iso2: "ET",
  name: "Ethiopia",
  confederation: "CAF",
  continent: "AF",
  capital: "Addis Ababa",
  latitude: 9,
  languages: languages("am:6 om:4 ti:2 so:1"),
  reputation: { national: 40, league: 34 },
  euEea: false,
  physique: { height: 174 },
  // Ethiopian naming: given name plus the father's given name.
  names: { given: [src("ethiopian")], family: [src("ethiopian")] },
  nationality: {
    multipleRate: 0.08,
    tripleRate: 0.005,
    bornAbroadRate: 0.03,
    diasporaPull: 0.35,
    links: [
      ...links("regional", "ER:4 SO:1 SD:1 KE:1"),
      ...links("commonwealth", "US:3 EN:1 CA:1"),
      ...links("crossBorder", "SE:1 DE:1"),
    ],
    // Dual nationality is not recognised (diaspora members hold a Yellow Card residence status instead).
    citizenship: restricted,
  },
  cities: {
    major: [
      city("Addis Ababa", "mega", "Addis Ababa", 6, "Bole|Arada|Kirkos|Yeka|Gulele|Kolfe|Lideta|Akaki|Nifas Silk"),
      city("Dire Dawa", "large", "Dire Dawa", 2),
      city("Mekelle", "large", "Tigray", 2),
      city("Adama", "large", "Oromia", 2),
      city("Hawassa", "large", "Sidama", 2),
      city("Bahir Dar", "large", "Amhara", 2),
      city("Gondar", "large", "Amhara", 1),
      city("Dessie", "medium", "Amhara", 1),
      city("Jimma", "medium", "Oromia", 1),
      city("Jijiga", "medium", "Somali", 1),
      city("Shashamane", "medium", "Oromia", 1),
      city("Bishoftu", "medium", "Oromia", 1),
      city("Sodo", "medium", "South Ethiopia", 1),
      city("Arba Minch", "medium", "South Ethiopia", 1),
      city("Hosaena", "medium", "Central Ethiopia", 1),
      city("Harar", "medium", "Harari", 1),
      city("Dilla", "medium", "South Ethiopia", 1),
      city("Nekemte", "medium", "Oromia", 1),
      city("Debre Birhan", "medium", "Amhara", 1),
      city("Asella", "medium", "Oromia", 1),
      city("Burayu", "medium", "Oromia", 1),
      city("Adigrat", "small", "Tigray"),
      city("Debre Markos", "small", "Amhara"),
      city("Kombolcha", "small", "Amhara"),
      city("Wolkite", "small", "Central Ethiopia"),
      city("Gambela", "small", "Gambela"),
      city("Assosa", "small", "Benishangul-Gumuz"),
      city("Sebeta", "small", "Oromia"),
      city("Weldiya", "small", "Amhara"),
      city("Axum", "small", "Tigray"),
      city("Shire", "small", "Tigray"),
      city("Adwa", "small", "Tigray"),
      city("Ambo", "small", "Oromia"),
      city("Semera", "town", "Afar"),
      city("Durame", "town", "Central Ethiopia"),
      city("Butajira", "town", "Central Ethiopia"),
      city("Metu", "town", "Oromia"),
      city("Gode", "town", "Somali"),
      city("Negele Borana", "town", "Oromia"),
    ],
  },
  football: singleTier(
    {
      tier: 1,
      name: "Ethiopian Premier League",
      shortName: "EPL",
      size: 18,
      status: "professional",
      reputation: 34,
      clubs: {
        reputation: { top: 46, bottom: 32 },
        capacity: { top: 60_000, bottom: 5_000 },
        facilities: { top: 38, bottom: 16 },
        academy: { top: 40, bottom: 18 },
        // A league salary cap keeps wages flat; Ethiopian clubs pay better than most of East Africa.
        wageBill: { top: 700_000, bottom: 150_000 },
        transferBudget: { top: 50_000, bottom: 0 },
        foreignShare: 0.05,
        squadSize: [26, 30],
      },
    },
    {
      cups: [
        { kind: "national", name: "Ethiopian Cup", seededEntry: true, legs: 1, neutralFinal: true, continental: true },
        { kind: "super", name: "Ethiopian Super Cup", participants: ["champion", "cup-winner"], neutralFinal: true },
      ],
      youth: youthSingle("Ethiopian U-20 Premier League", "Ethiopian U-17 Premier League", 9, "North|South"),
      // Municipal ("Kenema", "Ketema" = city) clubs, regional coffee and police clubs, and institution sides.
      clubNaming: {
        templates: templates(
          `{city} Kenema:3; {city} Ketema:3; {city} City:2; {city} Sport Club:1; {region} Bunna:1; {region} Police:1;
           {city} University:1; {city} Mechal:1; {city} Electric:1; {city} Abay:1`,
        ),
        founded: { top: [1935, 2015], bottom: [1950, 2020] },
        avoid: list(
          `Saint George|Kidus Giorgis|Ethiopian Coffee|Ethiopia Bunna|Fasil Kenema|Bahir Dar Kenema|Mekelle 70 Enderta|
           Mekelle Kenema|Hawassa City|Hawassa Kenema|Hawassa Ketema|Sidama Coffee|Sidama Bunna|Wolaitta Dicha|Adama City|
           Adama Ketema|Dire Dawa City|Dire Dawa Ketema|Dire Dawa Kenema|Ethio Electric|Defence Force|Mekelakeya|
           Commercial Bank of Ethiopia|Nigd Bank|Shashemene City|Shashemene Ketema|Arba Minch City|Arba Minch Ketema|
           Hadiya Hossana|Wolkite City|Wolkite Ketema|Jimma Aba Jifar|Jimma Aba Buna|Dessie City|Dessie Ketema|
           Addis Ababa City|Addis Ababa Ketema|Legetafo Legedadi|Sebeta City|Sebeta Ketema|Welwalo Adigrat University|
           Oromia Police|Amhara Police|Ethiopian Insurance|Ethiopia Medhin|Mechal|Harar City|Gondar Kenema|
           Debub Police|Kolfe Keranio|Mekelle University|Adama Kenema`,
        ),
        colors: ["#078930", "#FCDD09", "#DA121A", "#000000", "#FFFFFF", "#0F47AF", "#7A263A"],
      },
      importSources: weighted("NG:2 GH:2 UG:2 KE:1 CM:1 ER:1 SS:1 TZ:1 BI:1 RW:1"),
      coefficients: { association: [2, 2.5, 2, 2, 2.5] },
    },
  ),
  abroad: {
    seniors: 10,
    youth: 2,
    destinations: weighted("US:3 SE:2 NO:1 DE:1 EG:1 SA:1"),
  },
};

// ------------------------------------------------------------------ home-pool nations (no own league)
// Home pools size the real domestic player base; `abroad` places the professionals at foreign clubs, including the
// real intra-African routes (Sahel players in Côte d'Ivoire and North Africa, Southern Africans in South Africa).

const BJ = homeNation({
  code: "BJ",
  name: "Benin",
  capital: "Porto-Novo",
  latitude: 6.5,
  languages: languages("fr:5 fon:3 yo:2"),
  reputation: { national: 56, league: 30 },
  physique: { height: 180 },
  names: {
    given: [src("francophone", 3), src("beninese", 3), src("west-african", 1)],
    family: [src("beninese", 5), src("yoruba", 1)],
  },
  nationality: {
    // France-born Écureuils and Nigerian/Togolese cross-border families.
    multipleRate: 0.3,
    tripleRate: 0.03,
    bornAbroadRate: 0.18,
    diasporaPull: 0.6,
    links: [...links("frenchAfrica", "FR:10 BE:1"), ...links("regional", "NG:5 TG:4 NE:2 BF:1 GH:1")],
    citizenship: allowed,
  },
  cities: {
    major: [
      city("Cotonou", "large", "Littoral"),
      city("Porto-Novo", "medium", "Ouémé"),
      city("Abomey-Calavi", "large", "Atlantique"),
      city("Parakou", "medium", "Borgou"),
      city("Djougou", "medium", "Donga"),
      city("Bohicon", "medium", "Zou"),
      city("Abomey", "small", "Zou"),
      city("Natitingou", "small", "Atacora"),
      city("Lokossa", "small", "Mono"),
      city("Ouidah", "small", "Atlantique"),
      city("Kandi", "small", "Alibori"),
      city("Savalou", "small", "Collines"),
    ],
  },
  homePool: { seniors: 50, youth: 40 },
  abroad: { seniors: 70, youth: 10, destinations: weighted("FR:10 BE:2 MA:2 TN:2 CI:2 NG:1 TR:1 PT:1 CH:1 DZ:1 SA:1") },
});

const BW = homeNation({
  code: "BW",
  name: "Botswana",
  capital: "Gaborone",
  latitude: -24.7,
  languages: languages("en:3 tn:7"),
  reputation: { national: 38, league: 28 },
  physique: { height: 177 },
  names: { given: [src("anglophone", 3), src("sotho-tswana", 4)], family: [src("sotho-tswana")] },
  nationality: {
    multipleRate: 0.08,
    tripleRate: 0.005,
    bornAbroadRate: 0.04,
    diasporaPull: 0.4,
    links: [...links("regional", "ZA:6 ZW:3 NA:2 ZM:1"), ...links("commonwealth", "EN:1")],
    // Citizens holding another nationality must renounce one by age 21.
    citizenship: restricted,
  },
  cities: {
    major: [
      city("Gaborone", "large", "South-East"),
      city("Francistown", "medium", "North-East"),
      city("Molepolole", "medium", "Kweneng"),
      city("Maun", "small", "North-West"),
      city("Mogoditshane", "small", "Kweneng"),
      city("Serowe", "small", "Central"),
      city("Selebi-Phikwe", "small", "Central"),
      city("Kanye", "small", "Southern"),
      city("Mahalapye", "small", "Central"),
      city("Palapye", "small", "Central"),
      city("Lobatse", "small", "South-East"),
      city("Jwaneng", "town", "Southern"),
    ],
  },
  homePool: { seniors: 60, youth: 40 },
  abroad: { seniors: 12, youth: 2, destinations: weighted("ZA:8 ZW:1 US:1") },
});

const BF = homeNation({
  code: "BF",
  name: "Burkina Faso",
  capital: "Ouagadougou",
  latitude: 12.4,
  languages: languages("fr:4 mos:5 dyu:2 ff:1"),
  reputation: { national: 66, league: 32 },
  physique: { height: 180 },
  names: {
    given: [src("west-african", 3), src("francophone", 2), src("mossi", 2)],
    family: [src("mossi", 5), src("mande", 2), src("fula", 1)],
  },
  nationality: {
    multipleRate: 0.25,
    tripleRate: 0.02,
    bornAbroadRate: 0.1,
    diasporaPull: 0.55,
    // Millions of Burkinabè live in Côte d'Ivoire.
    links: [...links("frenchAfrica", "FR:8 BE:1"), ...links("regional", "CI:10 ML:5 GH:4 NE:2 TG:1")],
    citizenship: allowed,
  },
  cities: {
    major: [
      city("Ouagadougou", "mega", "Centre"),
      city("Bobo-Dioulasso", "large", "Hauts-Bassins"),
      city("Koudougou", "medium", "Centre-Ouest"),
      city("Banfora", "medium", "Cascades"),
      city("Ouahigouya", "medium", "Nord"),
      city("Kaya", "medium", "Centre-Nord"),
      city("Tenkodogo", "small", "Centre-Est"),
      city("Fada N'Gourma", "small", "Est"),
      city("Dédougou", "small", "Boucle du Mouhoun"),
      city("Dori", "small", "Sahel"),
      city("Gaoua", "small", "Sud-Ouest"),
      city("Houndé", "town", "Hauts-Bassins"),
    ],
  },
  homePool: { seniors: 60, youth: 50 },
  abroad: {
    seniors: 110,
    youth: 15,
    destinations: weighted("CI:10 FR:10 BE:4 MA:4 TN:3 DZ:3 EG:2 PT:2 TR:2 SA:2 CH:1 DE:1 ZA:1 CM:1 SN:1"),
  },
});

const BI = homeNation({
  code: "BI",
  name: "Burundi",
  capital: "Gitega",
  latitude: -3.4,
  languages: languages("rn:6 fr:3 sw:1"),
  reputation: { national: 42, league: 26 },
  physique: { height: 176 },
  names: { given: [src("francophone", 4), src("anglophone", 1)], family: [src("great-lakes")] },
  nationality: {
    multipleRate: 0.2,
    tripleRate: 0.02,
    bornAbroadRate: 0.08,
    diasporaPull: 0.5,
    links: [...links("frenchAfrica", "BE:6 FR:2"), ...links("regional", "RW:5 CD:4 TZ:4 UG:1")],
    // Dual nationality has been allowed since the 2000 nationality code.
    citizenship: allowed,
  },
  cities: {
    major: [
      city("Bujumbura", "large", "Bujumbura Mairie"),
      city("Gitega", "medium", "Gitega"),
      city("Ngozi", "small", "Ngozi"),
      city("Rumonge", "small", "Rumonge"),
      city("Muyinga", "small", "Muyinga"),
      city("Kayanza", "small", "Kayanza"),
      city("Kirundo", "small", "Kirundo"),
      city("Makamba", "small", "Makamba"),
      city("Rutana", "town", "Rutana"),
      city("Bururi", "town", "Bururi"),
    ],
  },
  homePool: { seniors: 45, youth: 40 },
  abroad: { seniors: 25, youth: 4, destinations: weighted("CD:3 BE:3 ZA:2 FR:1 EG:1 ET:1 TN:1 SA:1") },
});

const CF = homeNation({
  code: "CF",
  name: "Central African Republic",
  capital: "Bangui",
  latitude: 4.4,
  languages: languages("fr:3 sg:7"),
  reputation: { national: 42, league: 24 },
  physique: { height: 180 },
  names: { given: [src("francophone", 5), src("west-african", 1)], family: [src("central-african")] },
  nationality: {
    // France-born players form much of the Fauves du Bas-Oubangui.
    multipleRate: 0.35,
    tripleRate: 0.04,
    bornAbroadRate: 0.2,
    diasporaPull: 0.6,
    links: [...links("frenchAfrica", "FR:10 BE:1"), ...links("regional", "CM:4 CD:3 TD:2 CG:2")],
    citizenship: allowed,
  },
  cities: {
    major: [
      city("Bangui", "large", "Bangui"),
      city("Bimbo", "medium", "Ombella-M'Poko"),
      city("Berbérati", "small", "Mambéré-Kadéï"),
      city("Carnot", "small", "Mambéré-Kadéï"),
      city("Bambari", "small", "Ouaka"),
      city("Bouar", "small", "Nana-Mambéré"),
      city("Bossangoa", "small", "Ouham"),
      city("Bria", "small", "Haute-Kotto"),
      city("Bangassou", "town", "Mbomou"),
      city("Nola", "town", "Sangha-Mbaéré"),
    ],
  },
  homePool: { seniors: 40, youth: 36 },
  abroad: { seniors: 35, youth: 5, destinations: weighted("FR:14 BE:2 CD:2 CM:2 CG:1 MA:1 PT:1 TR:1 GR:1") },
});

const TD = homeNation({
  code: "TD",
  name: "Chad",
  capital: "N'Djamena",
  latitude: 12.1,
  languages: languages("fr:4 ar:5"),
  reputation: { national: 30, league: 20 },
  physique: { height: 180 },
  names: { given: [src("chadian", 4), src("francophone", 2)], family: [src("chadian")] },
  nationality: {
    multipleRate: 0.18,
    tripleRate: 0.02,
    bornAbroadRate: 0.1,
    diasporaPull: 0.45,
    links: [...links("frenchAfrica", "FR:8"), ...links("regional", "CM:5 SD:3 NG:2 CF:2 NE:1 LY:1")],
    // Chadian law does not recognise dual nationality.
    citizenship: restricted,
  },
  cities: {
    major: [
      city("N'Djamena", "large", "N'Djamena"),
      city("Moundou", "medium", "Logone Occidental"),
      city("Abéché", "medium", "Ouaddaï"),
      city("Sarh", "medium", "Moyen-Chari"),
      city("Kélo", "small", "Tandjilé"),
      city("Koumra", "small", "Mandoul"),
      city("Pala", "small", "Mayo-Kebbi Ouest"),
      city("Am Timan", "small", "Salamat"),
      city("Mongo", "small", "Guéra"),
      city("Doba", "small", "Logone Oriental"),
      city("Ati", "town", "Batha"),
    ],
  },
  homePool: { seniors: 40, youth: 36 },
  abroad: { seniors: 25, youth: 4, destinations: weighted("FR:8 CM:4 MA:2 DZ:2 CD:1 TN:1 EG:1 BE:1 SA:1") },
});

const KM = homeNation({
  code: "KM",
  name: "Comoros",
  capital: "Moroni",
  latitude: -11.7,
  languages: languages("fr:3 zdj:5 ar:2"),
  reputation: { national: 50, league: 18 },
  physique: { height: 178 },
  names: { given: [src("comorian", 5), src("francophone", 1)], family: [src("comorian")] },
  nationality: {
    // Marseille and the Paris region are home to a Comorian community as large as Moroni's; the Cœlacanthes are
    // mostly France-born.
    multipleRate: 0.55,
    tripleRate: 0.06,
    bornAbroadRate: 0.45,
    diasporaPull: 0.75,
    links: [...links("frenchAfrica", "FR:14"), ...links("regional", "MG:3 TZ:2")],
    citizenship: allowed,
  },
  cities: {
    major: [
      city("Moroni", "medium", "Grande Comore"),
      city("Mutsamudu", "small", "Anjouan"),
      city("Fomboni", "small", "Mohéli"),
      city("Domoni", "small", "Anjouan"),
      city("Sima", "town", "Anjouan"),
      city("Mitsamiouli", "town", "Grande Comore"),
      city("Foumbouni", "town", "Grande Comore"),
      city("Mbéni", "town", "Grande Comore"),
    ],
  },
  homePool: { seniors: 30, youth: 36 },
  abroad: { seniors: 45, youth: 8, destinations: weighted("FR:20 BE:1 MA:1 GR:1 CY:1 US:1") },
});

const DJ = homeNation({
  code: "DJ",
  name: "Djibouti",
  capital: "Djibouti",
  latitude: 11.6,
  languages: languages("fr:3 so:5 aa:3 ar:2"),
  reputation: { national: 20, league: 16 },
  physique: { height: 175 },
  names: { given: [src("somali", 5), src("francophone", 1)], family: [src("somali")] },
  nationality: {
    multipleRate: 0.15,
    tripleRate: 0.01,
    bornAbroadRate: 0.05,
    diasporaPull: 0.4,
    links: [...links("regional", "SO:5 ET:5 ER:1"), ...links("arabWorld", "YE:2"), ...links("frenchAfrica", "FR:3")],
    citizenship: allowed,
  },
  cities: {
    major: [
      city("Djibouti", "large", "Djibouti"),
      city("Ali Sabieh", "small", "Ali Sabieh"),
      city("Dikhil", "small", "Dikhil"),
      city("Tadjourah", "small", "Tadjourah"),
      city("Obock", "town", "Obock"),
      city("Arta", "town", "Arta"),
    ],
  },
  homePool: { seniors: 30, youth: 36 },
  abroad: { seniors: 10, youth: 2, destinations: weighted("ET:3 FR:2 EG:1 SA:1") },
});

const ER = homeNation({
  code: "ER",
  name: "Eritrea",
  capital: "Asmara",
  latitude: 15.3,
  languages: languages("ti:6 ar:2 en:2"),
  reputation: { national: 20, league: 18 },
  physique: { height: 175 },
  names: { given: [src("eritrean")], family: [src("eritrean")] },
  nationality: {
    // A large diaspora in Scandinavia, Germany, Italy, the UK and the US that rarely plays for Eritrea.
    multipleRate: 0.15,
    tripleRate: 0.01,
    bornAbroadRate: 0.08,
    diasporaPull: 0.3,
    links: [
      ...links("regional", "ET:5 SD:3"),
      ...links("crossBorder", "SE:2 NO:2 DE:2 NL:1 CH:1"),
      ...links("mediterranean", "IT:2"),
      ...links("commonwealth", "EN:2 US:2"),
    ],
    citizenship: allowed,
  },
  cities: {
    major: [
      city("Asmara", "large", "Maekel"),
      city("Keren", "medium", "Anseba"),
      city("Massawa", "small", "Northern Red Sea"),
      city("Mendefera", "small", "Debub"),
      city("Barentu", "small", "Gash-Barka"),
      city("Dekemhare", "small", "Debub"),
      city("Adi Keyh", "town", "Debub"),
      city("Assab", "town", "Southern Red Sea"),
      city("Teseney", "town", "Gash-Barka"),
    ],
  },
  homePool: { seniors: 35, youth: 36 },
  abroad: { seniors: 10, youth: 2, destinations: weighted("ET:2 SE:2 NO:1 DE:1 NL:1 US:1 EN:1") },
});

const SZ = homeNation({
  code: "SZ",
  name: "Eswatini",
  capital: "Mbabane",
  latitude: -26.3,
  languages: languages("en:3 ss:7"),
  reputation: { national: 32, league: 22 },
  physique: { height: 176 },
  names: { given: [src("anglophone", 3), src("swazi", 3), src("nguni", 1)], family: [src("swazi", 5), src("nguni", 1)] },
  nationality: {
    multipleRate: 0.15,
    tripleRate: 0.01,
    bornAbroadRate: 0.08,
    diasporaPull: 0.45,
    links: links("regional", "ZA:10 MZ:3"),
    citizenship: allowed,
  },
  cities: {
    major: [
      city("Manzini", "medium", "Manzini"),
      city("Mbabane", "medium", "Hhohho"),
      city("Lobamba", "small", "Hhohho"),
      city("Siteki", "small", "Lubombo"),
      city("Nhlangano", "small", "Shiselweni"),
      city("Piggs Peak", "small", "Hhohho"),
      city("Matsapha", "small", "Manzini"),
      city("Big Bend", "town", "Lubombo"),
      city("Simunye", "town", "Lubombo"),
      city("Mhlume", "town", "Lubombo"),
    ],
  },
  homePool: { seniors: 40, youth: 36 },
  abroad: { seniors: 12, youth: 2, destinations: weighted("ZA:10 MZ:1 US:1") },
});

const GA = homeNation({
  code: "GA",
  name: "Gabon",
  capital: "Libreville",
  latitude: 0.4,
  languages: languages("fr:7 fan:3"),
  reputation: { national: 58, league: 30 },
  physique: { height: 180 },
  names: { given: [src("francophone")], family: [src("gabonese", 4), src("fang", 4)] },
  nationality: {
    multipleRate: 0.35,
    tripleRate: 0.04,
    bornAbroadRate: 0.2,
    diasporaPull: 0.6,
    links: [...links("frenchAfrica", "FR:10"), ...links("regional", "CM:4 CG:4 GQ:3 BJ:1")],
    citizenship: allowed,
  },
  cities: {
    major: [
      city("Libreville", "large", "Estuaire"),
      city("Port-Gentil", "medium", "Ogooué-Maritime"),
      city("Franceville", "medium", "Haut-Ogooué"),
      city("Owendo", "medium", "Estuaire"),
      city("Oyem", "small", "Woleu-Ntem"),
      city("Moanda", "small", "Haut-Ogooué"),
      city("Mouila", "small", "Ngounié"),
      city("Lambaréné", "small", "Moyen-Ogooué"),
      city("Tchibanga", "small", "Nyanga"),
      city("Koulamoutou", "small", "Ogooué-Lolo"),
      city("Makokou", "town", "Ogooué-Ivindo"),
      city("Bitam", "town", "Woleu-Ntem"),
    ],
  },
  homePool: { seniors: 50, youth: 40 },
  abroad: {
    seniors: 70,
    youth: 10,
    destinations: weighted("FR:16 MA:3 BE:2 PT:2 TN:2 DZ:2 SA:2 TR:2 ES:2 CD:1 CG:1 QA:1 EN:1 GR:1 CY:1 US:1 GQ:1"),
  },
});

const GM = homeNation({
  code: "GM",
  name: "Gambia",
  capital: "Banjul",
  latitude: 13.45,
  languages: languages("en:3 mnk:4 wo:3 ff:2"),
  reputation: { national: 54, league: 26 },
  physique: { height: 181 },
  names: {
    given: [src("gambian", 4), src("west-african", 2), src("anglophone", 1)],
    family: [src("gambian", 5), src("fula", 1), src("mande", 1)],
  },
  nationality: {
    // Players raised in Senegal, the UK, Sweden and Spain.
    multipleRate: 0.3,
    tripleRate: 0.03,
    bornAbroadRate: 0.14,
    diasporaPull: 0.55,
    links: [
      ...links("regional", "SN:12 GN:3"),
      ...links("commonwealth", "EN:5 US:1"),
      ...links("crossBorder", "SE:3 ES:3 DE:1 NO:1"),
    ],
    citizenship: allowed,
  },
  cities: {
    major: [
      city("Serekunda", "large", "Kanifing"),
      city("Brikama", "medium", "West Coast"),
      city("Banjul", "medium", "Banjul"),
      city("Bakau", "medium", "Kanifing"),
      city("Farafenni", "small", "North Bank"),
      city("Lamin", "small", "West Coast"),
      city("Sukuta", "small", "West Coast"),
      city("Basse Santa Su", "small", "Upper River"),
      city("Soma", "town", "Lower River"),
      city("Gunjur", "town", "West Coast"),
      city("Janjanbureh", "town", "Central River"),
    ],
  },
  homePool: { seniors: 40, youth: 40 },
  abroad: {
    seniors: 60,
    youth: 8,
    destinations: weighted("ES:5 IT:5 SN:4 SE:4 BE:3 FR:3 NO:2 DE:2 EN:2 PT:2 TR:2 US:2 DK:1 AT:1 MA:1 TN:1"),
  },
});

const GN = homeNation({
  code: "GN",
  name: "Guinea",
  capital: "Conakry",
  latitude: 9.5,
  languages: languages("fr:4 ff:4 sus:3 emk:2"),
  reputation: { national: 64, league: 34 },
  physique: { height: 181 },
  names: {
    given: [src("fula", 3), src("mande", 3), src("west-african", 2)],
    family: [src("fula", 3), src("mande", 3), src("susu", 2)],
  },
  nationality: {
    // France-, Spain- and Germany-born Syli Nationale players.
    multipleRate: 0.35,
    tripleRate: 0.04,
    bornAbroadRate: 0.18,
    diasporaPull: 0.65,
    links: [
      ...links("frenchAfrica", "FR:10 BE:1"),
      ...links("regional", "SN:5 SL:3 CI:3 ML:3 GW:2"),
      ...links("crossBorder", "ES:2 DE:1"),
      ...links("americas", "US:1"),
    ],
    citizenship: allowed,
  },
  cities: {
    major: [
      city("Conakry", "mega", "Conakry"),
      city("Nzérékoré", "medium", "Nzérékoré"),
      city("Kankan", "medium", "Kankan"),
      city("Kindia", "medium", "Kindia"),
      city("Labé", "medium", "Labé"),
      city("Kamsar", "small", "Boké"),
      city("Boké", "small", "Boké"),
      city("Mamou", "small", "Mamou"),
      city("Siguiri", "small", "Kankan"),
      city("Kissidougou", "small", "Faranah"),
      city("Guéckédou", "small", "Nzérékoré"),
      city("Faranah", "small", "Faranah"),
      city("Coyah", "small", "Kindia"),
      city("Dubréka", "town", "Kindia"),
    ],
  },
  homePool: { seniors: 60, youth: 50 },
  abroad: {
    seniors: 110,
    youth: 15,
    destinations: weighted("FR:16 BE:4 MA:4 ES:3 PT:3 TR:3 TN:3 DZ:3 CI:3 DE:2 IT:2 EG:2 SA:2 SN:1 CH:1 AT:1 GR:1 CY:1 US:1"),
  },
});

const KE = homeNation({
  code: "KE",
  name: "Kenya",
  capital: "Nairobi",
  latitude: -1.3,
  languages: languages("sw:5 en:5"),
  reputation: { national: 50, league: 36 },
  physique: { height: 177 },
  names: { given: [src("anglophone")], family: [src("kenyan")] },
  nationality: {
    multipleRate: 0.15,
    tripleRate: 0.01,
    bornAbroadRate: 0.06,
    diasporaPull: 0.4,
    links: [
      ...links("regional", "UG:5 TZ:5 SO:2"),
      ...links("commonwealth", "EN:4 US:3"),
      ...links("crossBorder", "SE:1"),
    ],
    // The 2010 constitution allows dual citizenship.
    citizenship: allowed,
  },
  cities: {
    major: [
      city("Nairobi", "mega", "Nairobi"),
      city("Mombasa", "large", "Mombasa"),
      city("Kisumu", "medium", "Kisumu"),
      city("Nakuru", "medium", "Nakuru"),
      city("Eldoret", "medium", "Uasin Gishu"),
      city("Thika", "medium", "Kiambu"),
      city("Machakos", "small", "Machakos"),
      city("Kakamega", "small", "Kakamega"),
      city("Nyeri", "small", "Nyeri"),
      city("Kisii", "small", "Kisii"),
      city("Kericho", "small", "Kericho"),
      city("Malindi", "small", "Kilifi"),
      city("Bungoma", "small", "Bungoma"),
      city("Kitale", "small", "Trans-Nzoia"),
      city("Garissa", "small", "Garissa"),
      city("Naivasha", "small", "Nakuru"),
    ],
  },
  homePool: { seniors: 90, youth: 60 },
  abroad: { seniors: 35, youth: 6, destinations: weighted("US:4 SE:3 ZA:2 DK:1 NO:1 ET:1 EG:1 SA:1 BE:1 EN:1 FI:1 IN:1") },
});

const LS = homeNation({
  code: "LS",
  name: "Lesotho",
  capital: "Maseru",
  latitude: -29.3,
  languages: languages("st:7 en:3"),
  reputation: { national: 34, league: 22 },
  physique: { height: 175 },
  names: { given: [src("anglophone", 2), src("sotho-tswana", 5)], family: [src("sotho-tswana")] },
  nationality: {
    multipleRate: 0.08,
    tripleRate: 0.005,
    bornAbroadRate: 0.05,
    diasporaPull: 0.4,
    links: links("regional", "ZA:10"),
    // Adults must give up one nationality under the 1971 Citizenship Order.
    citizenship: restricted,
  },
  cities: {
    major: [
      city("Maseru", "medium", "Maseru"),
      city("Teyateyaneng", "small", "Berea"),
      city("Mafeteng", "small", "Mafeteng"),
      city("Hlotse", "small", "Leribe"),
      city("Mohale's Hoek", "small", "Mohale's Hoek"),
      city("Maputsoe", "small", "Leribe"),
      city("Qacha's Nek", "town", "Qacha's Nek"),
      city("Quthing", "town", "Quthing"),
      city("Butha-Buthe", "town", "Butha-Buthe"),
      city("Mokhotlong", "town", "Mokhotlong"),
    ],
  },
  homePool: { seniors: 40, youth: 36 },
  abroad: { seniors: 15, youth: 2, destinations: weighted("ZA:10") },
});

const LR = homeNation({
  code: "LR",
  name: "Liberia",
  capital: "Monrovia",
  latitude: 6.3,
  languages: languages("en:8 kpe:2"),
  reputation: { national: 40, league: 24 },
  physique: { height: 179 },
  names: {
    given: [src("anglophone", 4), src("liberian", 3)],
    family: [src("liberian", 5), src("mande", 1)],
  },
  nationality: {
    // US-born and US-raised Liberians.
    multipleRate: 0.25,
    tripleRate: 0.02,
    bornAbroadRate: 0.12,
    diasporaPull: 0.5,
    links: [
      ...links("americas", "US:8"),
      ...links("regional", "SL:4 GN:3 CI:3 GH:1"),
      ...links("commonwealth", "EN:2"),
    ],
    // Natural-born Liberians may hold another nationality since 2022.
    citizenship: allowed,
  },
  cities: {
    major: [
      city("Monrovia", "large", "Montserrado"),
      city("Gbarnga", "small", "Bong"),
      city("Buchanan", "small", "Grand Bassa"),
      city("Ganta", "small", "Nimba"),
      city("Kakata", "small", "Margibi"),
      city("Paynesville", "medium", "Montserrado"),
      city("Voinjama", "town", "Lofa"),
      city("Zwedru", "town", "Grand Gedeh"),
      city("Harper", "town", "Maryland"),
      city("Robertsport", "town", "Grand Cape Mount"),
    ],
  },
  homePool: { seniors: 50, youth: 40 },
  abroad: { seniors: 35, youth: 5, destinations: weighted("US:6 CI:3 ID:2 SE:1 FI:1 IN:1 TH:1 VN:1 SA:1 EG:1 TN:1 MA:1 GH:1") },
});

const LY = homeNation({
  code: "LY",
  name: "Libya",
  capital: "Tripoli",
  latitude: 32.9,
  languages: languages("ar:8 ber:1"),
  reputation: { national: 54, league: 44 },
  physique: { height: 179 },
  names: { given: [src("libyan", 5), src("amazigh", 1)], family: [src("libyan", 5), src("amazigh", 1)] },
  nationality: {
    multipleRate: 0.08,
    tripleRate: 0.01,
    bornAbroadRate: 0.04,
    diasporaPull: 0.4,
    links: [...links("arabWorld", "EG:3 TN:3 DZ:1"), ...links("mediterranean", "IT:1"), ...links("commonwealth", "EN:1")],
    // Holding another nationality requires state approval and is rarely granted.
    citizenship: restricted,
  },
  cities: {
    major: [
      city("Tripoli", "mega", "Tripoli"),
      city("Benghazi", "large", "Benghazi"),
      city("Misrata", "large", "Misrata"),
      city("Zawiya", "medium", "Zawiya"),
      city("Bayda", "medium", "Jabal al Akhdar"),
      city("Zliten", "medium", "Murqub"),
      city("Ajdabiya", "medium", "Al Wahat"),
      city("Tobruk", "medium", "Butnan"),
      city("Sabha", "medium", "Sabha"),
      city("Sirte", "small", "Sirte"),
      city("Khoms", "small", "Murqub"),
      city("Derna", "small", "Derna"),
      city("Gharyan", "small", "Jabal al Gharbi"),
      city("Zuwara", "small", "Nuqat al Khams"),
    ],
  },
  // The Libyan Premier League is one of Africa's better-funded leagues (Al Ahli Tripoli, Al Ittihad, Al Ahli Benghazi).
  homePool: { seniors: 100, youth: 60 },
  abroad: { seniors: 20, youth: 4, destinations: weighted("TN:4 EG:3 SA:2 MA:2 PT:1 FR:1 IT:1 QA:1 AE:1") },
});

const MG = homeNation({
  code: "MG",
  name: "Madagascar",
  capital: "Antananarivo",
  latitude: -18.9,
  languages: languages("mg:6 fr:4"),
  reputation: { national: 48, league: 28 },
  physique: { height: 175 },
  names: { given: [src("malagasy", 4), src("francophone", 2)], family: [src("malagasy")] },
  nationality: {
    // Many Baréa players are France-born.
    multipleRate: 0.3,
    tripleRate: 0.03,
    bornAbroadRate: 0.18,
    diasporaPull: 0.55,
    links: [...links("frenchAfrica", "FR:12"), ...links("regional", "KM:2 MU:1")],
    citizenship: allowed,
  },
  cities: {
    major: [
      city("Antananarivo", "large", "Analamanga"),
      city("Toamasina", "medium", "Atsinanana"),
      city("Antsirabe", "medium", "Vakinankaratra"),
      city("Fianarantsoa", "medium", "Haute Matsiatra"),
      city("Mahajanga", "medium", "Boeny"),
      city("Toliara", "medium", "Atsimo-Andrefana"),
      city("Antsiranana", "small", "Diana"),
      city("Ambovombe", "small", "Androy"),
      city("Morondava", "small", "Menabe"),
      city("Ambatondrazaka", "small", "Alaotra-Mangoro"),
      city("Sambava", "small", "Sava"),
      city("Manakara", "town", "Fitovinany"),
    ],
  },
  homePool: { seniors: 50, youth: 40 },
  abroad: { seniors: 30, youth: 5, destinations: weighted("FR:18 BE:2 MA:1 TN:1 ZA:1 PT:1 CH:1") },
});

const MW = homeNation({
  code: "MW",
  name: "Malawi",
  capital: "Lilongwe",
  latitude: -14,
  languages: languages("ny:6 en:4"),
  reputation: { national: 40, league: 28 },
  physique: { height: 176 },
  names: { given: [src("anglophone", 4), src("malawian", 3)], family: [src("malawian")] },
  nationality: {
    multipleRate: 0.15,
    tripleRate: 0.01,
    bornAbroadRate: 0.06,
    diasporaPull: 0.4,
    links: [...links("regional", "ZA:4 ZM:4 MZ:3 ZW:2 TZ:1"), ...links("commonwealth", "EN:3")],
    // Dual citizenship has been allowed since the 2019 Citizenship (Amendment) Act.
    citizenship: allowed,
  },
  cities: {
    major: [
      city("Lilongwe", "large", "Central"),
      city("Blantyre", "large", "Southern"),
      city("Mzuzu", "medium", "Northern"),
      city("Zomba", "medium", "Southern"),
      city("Kasungu", "small", "Central"),
      city("Mangochi", "small", "Southern"),
      city("Karonga", "small", "Northern"),
      city("Salima", "small", "Central"),
      city("Nkhotakota", "small", "Central"),
      city("Liwonde", "small", "Southern"),
      city("Dedza", "town", "Central"),
      city("Mulanje", "town", "Southern"),
    ],
  },
  homePool: { seniors: 60, youth: 40 },
  abroad: { seniors: 20, youth: 4, destinations: weighted("ZA:8 MZ:2 ZW:1 US:1") },
});

const ML = homeNation({
  code: "ML",
  name: "Mali",
  capital: "Bamako",
  latitude: 12.6,
  languages: languages("fr:3 bm:6 ff:1"),
  reputation: { national: 72, league: 36 },
  physique: { height: 182 },
  names: {
    given: [src("mande", 5), src("fula", 2), src("west-african", 1)],
    family: [src("mande", 6), src("fula", 2)],
  },
  nationality: {
    // A large French-born contingent plus Malian families across West Africa.
    multipleRate: 0.35,
    tripleRate: 0.04,
    bornAbroadRate: 0.18,
    diasporaPull: 0.65,
    links: [
      ...links("frenchAfrica", "FR:12 BE:1"),
      ...links("regional", "CI:6 SN:5 BF:3 GN:2 MR:1"),
      ...links("crossBorder", "ES:2 IT:1"),
    ],
    citizenship: allowed,
  },
  cities: {
    major: [
      city("Bamako", "mega", "Bamako"),
      city("Sikasso", "medium", "Sikasso"),
      city("Kalaban Coro", "medium", "Koulikoro"),
      city("Ségou", "medium", "Ségou"),
      city("Mopti", "medium", "Mopti"),
      city("Koutiala", "medium", "Sikasso"),
      city("Kayes", "medium", "Kayes"),
      city("Kati", "small", "Koulikoro"),
      city("Gao", "small", "Gao"),
      city("San", "small", "Ségou"),
      city("Bougouni", "small", "Sikasso"),
      city("Koulikoro", "small", "Koulikoro"),
      city("Tombouctou", "small", "Tombouctou"),
      city("Kita", "small", "Kayes"),
      city("Nioro du Sahel", "town", "Kayes"),
    ],
  },
  homePool: { seniors: 60, youth: 50 },
  abroad: {
    seniors: 160,
    youth: 20,
    destinations: weighted(
      `FR:24 BE:6 TR:6 MA:6 CI:6 ES:5 PT:5 TN:5 IT:4 SA:4 DE:3 QA:3 AE:3 DZ:3 EG:3 EN:3 AT:2 CH:2 GR:2 CY:2 US:2 RS:1
       ZA:1 SN:1 NL:1 DK:1 SE:1 NO:1`,
    ),
  },
});

const MR = homeNation({
  code: "MR",
  name: "Mauritania",
  capital: "Nouakchott",
  latitude: 18.1,
  languages: languages("ar:6 fr:2 ff:1 snk:1"),
  reputation: { national: 50, league: 28 },
  physique: { height: 180 },
  names: { given: [src("mauritanian", 5), src("fula", 1)], family: [src("mauritanian", 5), src("fula", 1)] },
  nationality: {
    multipleRate: 0.2,
    tripleRate: 0.02,
    bornAbroadRate: 0.1,
    diasporaPull: 0.5,
    links: [
      ...links("frenchAfrica", "FR:6"),
      ...links("regional", "SN:6 ML:3"),
      ...links("arabWorld", "MA:2"),
      ...links("crossBorder", "ES:2"),
    ],
    // Dual nationality has been possible with authorisation since the 2010 nationality law reform.
    citizenship: allowed,
  },
  cities: {
    major: [
      city("Nouakchott", "large", "Nouakchott"),
      city("Nouadhibou", "medium", "Dakhlet Nouadhibou"),
      city("Kiffa", "small", "Assaba"),
      city("Kaédi", "small", "Gorgol"),
      city("Rosso", "small", "Trarza"),
      city("Zouérat", "small", "Tiris Zemmour"),
      city("Néma", "small", "Hodh Ech Chargui"),
      city("Atar", "small", "Adrar"),
      city("Sélibaby", "town", "Guidimaka"),
      city("Aleg", "town", "Brakna"),
    ],
  },
  homePool: { seniors: 50, youth: 40 },
  abroad: { seniors: 30, youth: 5, destinations: weighted("FR:6 MA:3 TN:2 DZ:2 ES:2 SA:1 BE:1 PT:1 TR:1") },
});

const MU = homeNation({
  code: "MU",
  name: "Mauritius",
  capital: "Port Louis",
  latitude: -20.2,
  languages: languages("mfe:6 en:2 fr:2"),
  reputation: { national: 22, league: 18 },
  physique: { height: 175 },
  names: { given: [src("mauritian")], family: [src("mauritian")] },
  nationality: {
    multipleRate: 0.2,
    tripleRate: 0.02,
    bornAbroadRate: 0.1,
    diasporaPull: 0.45,
    links: [
      ...links("frenchAfrica", "FR:4"),
      ...links("commonwealth", "EN:4 AU:2"),
      ...links("regional", "MG:2 SC:1"),
      ...links("asianDiaspora", "IN:3"),
    ],
    citizenship: allowed,
  },
  cities: {
    major: [
      city("Port Louis", "medium", "Port Louis"),
      city("Vacoas-Phoenix", "medium", "Plaines Wilhems"),
      city("Beau Bassin-Rose Hill", "medium", "Plaines Wilhems"),
      city("Curepipe", "medium", "Plaines Wilhems"),
      city("Quatre Bornes", "medium", "Plaines Wilhems"),
      city("Triolet", "small", "Pamplemousses"),
      city("Goodlands", "small", "Rivière du Rempart"),
      city("Centre de Flacq", "small", "Flacq"),
      city("Mahébourg", "small", "Grand Port"),
      city("Port Mathurin", "town", "Rodrigues"),
    ],
  },
  homePool: { seniors: 35, youth: 36 },
  abroad: { seniors: 8, youth: 2, destinations: weighted("FR:2 ZA:1 EN:1") },
});

const NA = homeNation({
  code: "NA",
  name: "Namibia",
  capital: "Windhoek",
  latitude: -22.6,
  languages: languages("en:3 ng:4 af:2 hz:1"),
  reputation: { national: 46, league: 28 },
  physique: { height: 178 },
  names: { given: [src("anglophone", 3), src("namibian", 4)], family: [src("namibian", 5), src("cape", 1)] },
  nationality: {
    multipleRate: 0.18,
    tripleRate: 0.02,
    bornAbroadRate: 0.08,
    diasporaPull: 0.4,
    links: [
      ...links("regional", "ZA:8 AO:3 BW:2 ZM:1"),
      ...links("crossBorder", "DE:3"),
      ...links("commonwealth", "EN:1"),
    ],
    // Citizens by birth cannot lose Namibian citizenship.
    citizenship: allowed,
  },
  cities: {
    major: [
      city("Windhoek", "large", "Khomas"),
      city("Rundu", "medium", "Kavango East"),
      city("Walvis Bay", "medium", "Erongo"),
      city("Oshakati", "medium", "Oshana"),
      city("Swakopmund", "small", "Erongo"),
      city("Katima Mulilo", "small", "Zambezi"),
      city("Ondangwa", "small", "Oshana"),
      city("Rehoboth", "small", "Hardap"),
      city("Otjiwarongo", "small", "Otjozondjupa"),
      city("Keetmanshoop", "small", "ǁKaras"),
      city("Tsumeb", "town", "Oshikoto"),
      city("Gobabis", "town", "Omaheke"),
    ],
  },
  homePool: { seniors: 60, youth: 40 },
  abroad: { seniors: 25, youth: 4, destinations: weighted("ZA:10 DE:1 US:1 ZW:1") },
});

const NE = homeNation({
  code: "NE",
  name: "Niger",
  capital: "Niamey",
  latitude: 13.5,
  languages: languages("fr:3 ha:5 dje:2"),
  reputation: { national: 46, league: 28 },
  physique: { height: 180 },
  names: {
    given: [src("west-african", 4), src("hausa", 3), src("nigerien", 1)],
    family: [src("nigerien", 5), src("hausa", 2)],
  },
  nationality: {
    multipleRate: 0.15,
    tripleRate: 0.01,
    bornAbroadRate: 0.06,
    diasporaPull: 0.45,
    links: [...links("frenchAfrica", "FR:5"), ...links("regional", "NG:5 ML:3 BF:2 BJ:2 TD:1 CI:1")],
    citizenship: allowed,
  },
  cities: {
    major: [
      city("Niamey", "large", "Niamey"),
      city("Zinder", "medium", "Zinder"),
      city("Maradi", "medium", "Maradi"),
      city("Agadez", "medium", "Agadez"),
      city("Tahoua", "medium", "Tahoua"),
      city("Dosso", "small", "Dosso"),
      city("Arlit", "small", "Agadez"),
      city("Birni N'Konni", "small", "Tahoua"),
      city("Tessaoua", "small", "Maradi"),
      city("Diffa", "small", "Diffa"),
      city("Tillabéri", "town", "Tillabéri"),
    ],
  },
  homePool: { seniors: 50, youth: 40 },
  abroad: { seniors: 30, youth: 5, destinations: weighted("FR:5 MA:3 TN:3 DZ:3 CI:2 BE:1 EG:1 SA:1 TR:1 PT:1") },
});

const RW = homeNation({
  code: "RW",
  name: "Rwanda",
  capital: "Kigali",
  latitude: -1.95,
  languages: languages("rw:7 en:2 fr:1"),
  reputation: { national: 42, league: 32 },
  physique: { height: 176 },
  names: { given: [src("francophone", 3), src("anglophone", 3)], family: [src("great-lakes")] },
  nationality: {
    multipleRate: 0.18,
    tripleRate: 0.02,
    bornAbroadRate: 0.08,
    diasporaPull: 0.45,
    links: [
      ...links("regional", "UG:4 CD:4 BI:3 TZ:2 KE:1"),
      ...links("frenchAfrica", "BE:3 FR:2"),
      ...links("commonwealth", "EN:1"),
    ],
    citizenship: allowed,
  },
  cities: {
    major: [
      city("Kigali", "large", "Kigali"),
      city("Musanze", "small", "Northern"),
      city("Huye", "small", "Southern"),
      city("Rubavu", "small", "Western"),
      city("Muhanga", "small", "Southern"),
      city("Rusizi", "small", "Western"),
      city("Nyagatare", "small", "Eastern"),
      city("Rwamagana", "small", "Eastern"),
      city("Nyanza", "town", "Southern"),
      city("Kayonza", "town", "Eastern"),
    ],
  },
  homePool: { seniors: 60, youth: 40 },
  abroad: { seniors: 20, youth: 4, destinations: weighted("BE:2 FR:1 ZA:1 EG:1 US:1 SE:1 CD:1") },
});

const ST = homeNation({
  code: "ST",
  name: "São Tomé and Príncipe",
  capital: "São Tomé",
  latitude: 0.3,
  languages: languages("pt:8"),
  reputation: { national: 22, league: 16 },
  physique: { height: 177 },
  names: { given: [src("lusophone")], family: [src("santomean")], mononymRate: 0.15 },
  nationality: {
    // Portugal-born and Portugal-based players.
    multipleRate: 0.4,
    tripleRate: 0.05,
    bornAbroadRate: 0.3,
    diasporaPull: 0.6,
    links: [...links("lusophone", "PT:12 AO:3 CV:2"), ...links("regional", "GQ:1 GA:1")],
    citizenship: allowed,
  },
  cities: {
    major: [
      city("São Tomé", "medium", "Água Grande"),
      city("Trindade", "small", "Mé-Zóchi"),
      city("Neves", "small", "Lembá"),
      city("Santana", "small", "Cantagalo"),
      city("Guadalupe", "town", "Lobata"),
      city("Santo Amaro", "town", "Lobata"),
      city("São João dos Angolares", "town", "Caué"),
      city("Santo António", "town", "Príncipe"),
    ],
  },
  homePool: { seniors: 25, youth: 36 },
  abroad: { seniors: 25, youth: 4, destinations: weighted("PT:14 AO:3 CV:1 GQ:1 FR:1") },
});

const SC = homeNation({
  code: "SC",
  name: "Seychelles",
  capital: "Victoria",
  latitude: -4.6,
  languages: languages("crs:6 en:2 fr:2"),
  reputation: { national: 16, league: 14 },
  physique: { height: 176 },
  names: { given: [src("seychellois", 4), src("anglophone", 1)], family: [src("seychellois")] },
  nationality: {
    multipleRate: 0.2,
    tripleRate: 0.02,
    bornAbroadRate: 0.1,
    diasporaPull: 0.4,
    links: [
      ...links("commonwealth", "EN:4 AU:1"),
      ...links("frenchAfrica", "FR:3"),
      ...links("regional", "MU:2"),
      ...links("asianDiaspora", "IN:1"),
    ],
    citizenship: allowed,
  },
  cities: {
    major: [
      city("Victoria", "small", "Mahé"),
      city("Anse Boileau", "town", "Mahé"),
      city("Beau Vallon", "town", "Mahé"),
      city("Anse Royale", "town", "Mahé"),
      city("Takamaka", "town", "Mahé"),
      city("Baie Sainte Anne", "town", "Praslin"),
      city("La Passe", "town", "La Digue"),
    ],
  },
  homePool: { seniors: 30, youth: 36 },
  abroad: { seniors: 10, youth: 2, destinations: weighted("ZA:1 FR:1 EN:1") },
});

const SL = homeNation({
  code: "SL",
  name: "Sierra Leone",
  capital: "Freetown",
  latitude: 8.5,
  languages: languages("en:4 kri:4 men:1 tem:1"),
  reputation: { national: 44, league: 26 },
  physique: { height: 180 },
  names: { given: [src("anglophone", 3), src("west-african", 2)], family: [src("sierra-leonean")] },
  nationality: {
    // London-born Leone Stars and families across the Mano River countries.
    multipleRate: 0.3,
    tripleRate: 0.03,
    bornAbroadRate: 0.16,
    diasporaPull: 0.55,
    links: [...links("commonwealth", "EN:10 US:3"), ...links("regional", "GN:4 LR:3 GH:1 GM:1")],
    citizenship: allowed,
  },
  cities: {
    major: [
      city("Freetown", "large", "Western Area"),
      city("Bo", "medium", "Southern"),
      city("Kenema", "medium", "Eastern"),
      city("Makeni", "medium", "Northern"),
      city("Koidu", "medium", "Eastern"),
      city("Lunsar", "small", "North West"),
      city("Port Loko", "small", "North West"),
      city("Waterloo", "small", "Western Area"),
      city("Kabala", "small", "North East"),
      city("Magburaka", "small", "North East"),
      city("Kailahun", "town", "Eastern"),
      city("Bonthe", "town", "Southern"),
    ],
  },
  homePool: { seniors: 50, youth: 40 },
  abroad: {
    seniors: 45,
    youth: 6,
    destinations: weighted("EN:3 SE:3 US:3 NO:2 FI:2 TR:2 CY:2 PT:2 BE:2 FR:2 IT:2 IN:2 GR:1 ES:1 SA:1 EG:1 TN:1 MA:1"),
  },
});

const SO = homeNation({
  code: "SO",
  name: "Somalia",
  capital: "Mogadishu",
  latitude: 2,
  languages: languages("so:8 ar:2"),
  reputation: { national: 16, league: 16 },
  physique: { height: 175 },
  names: { given: [src("somali")], family: [src("somali")] },
  nationality: {
    // A large diaspora in Scandinavia, the Netherlands, the UK and North America.
    multipleRate: 0.3,
    tripleRate: 0.03,
    bornAbroadRate: 0.22,
    diasporaPull: 0.35,
    links: [
      ...links("regional", "KE:4 DJ:4 ET:3"),
      ...links("crossBorder", "SE:5 NO:4 NL:3 FI:2 DK:1 DE:1"),
      ...links("commonwealth", "EN:6 US:3 CA:2"),
    ],
    citizenship: allowed,
  },
  cities: {
    major: [
      city("Mogadishu", "mega", "Banaadir"),
      city("Hargeisa", "large", "Maroodi Jeex"),
      city("Bosaso", "medium", "Bari"),
      city("Kismayo", "medium", "Lower Juba"),
      city("Baidoa", "medium", "Bay"),
      city("Galkayo", "medium", "Mudug"),
      city("Beledweyne", "small", "Hiiraan"),
      city("Garowe", "small", "Nugal"),
      city("Berbera", "small", "Sahil"),
      city("Burao", "medium", "Togdheer"),
      city("Jowhar", "small", "Middle Shabelle"),
      city("Marka", "small", "Lower Shabelle"),
    ],
  },
  homePool: { seniors: 30, youth: 36 },
  abroad: { seniors: 15, youth: 3, destinations: weighted("SE:3 NO:2 NL:2 FI:2 EN:2 US:2 DK:1 DE:1 ET:1 EG:1 SA:1") },
});

const SS = homeNation({
  code: "SS",
  name: "South Sudan",
  capital: "Juba",
  latitude: 4.85,
  languages: languages("en:5 din:3 nus:2"),
  reputation: { national: 30, league: 18 },
  physique: { height: 184, heightSd: 7.5 },
  names: { given: [src("south-sudanese", 4), src("anglophone", 3)], family: [src("south-sudanese")] },
  nationality: {
    // Players raised in Australia, the US, Canada, Uganda and Kenya after the civil wars.
    multipleRate: 0.35,
    tripleRate: 0.04,
    bornAbroadRate: 0.3,
    diasporaPull: 0.55,
    links: [
      ...links("regional", "UG:6 KE:5 SD:4 ET:2"),
      ...links("pacific", "AU:6"),
      ...links("americas", "US:3 CA:2"),
      ...links("commonwealth", "EN:2"),
    ],
    citizenship: allowed,
  },
  cities: {
    major: [
      city("Juba", "large", "Central Equatoria"),
      city("Wau", "medium", "Western Bahr el Ghazal"),
      city("Malakal", "medium", "Upper Nile"),
      city("Yei", "small", "Central Equatoria"),
      city("Aweil", "small", "Northern Bahr el Ghazal"),
      city("Bor", "small", "Jonglei"),
      city("Rumbek", "small", "Lakes"),
      city("Yambio", "small", "Western Equatoria"),
      city("Torit", "small", "Eastern Equatoria"),
      city("Bentiu", "small", "Unity"),
      city("Kuajok", "town", "Warrap"),
    ],
  },
  homePool: { seniors: 35, youth: 36 },
  abroad: { seniors: 20, youth: 4, destinations: weighted("AU:6 US:3 CA:2 ZA:1 EG:1 EN:1 SE:1 ET:1") },
});

const SD = homeNation({
  code: "SD",
  name: "Sudan",
  capital: "Khartoum",
  latitude: 15.6,
  languages: languages("ar:9 en:1"),
  reputation: { national: 50, league: 36 },
  physique: { height: 179 },
  names: { given: [src("sudanese")], family: [src("sudanese")] },
  nationality: {
    // Egyptian, Saudi and Gulf-born Sudanese, and cross-border families with South Sudan.
    multipleRate: 0.15,
    tripleRate: 0.01,
    bornAbroadRate: 0.08,
    diasporaPull: 0.45,
    links: [
      ...links("arabWorld", "EG:4 SA:3 AE:1 QA:1"),
      ...links("regional", "SS:3 ET:1 TD:1"),
      ...links("commonwealth", "EN:1 US:1"),
    ],
    citizenship: allowed,
  },
  cities: {
    major: [
      city("Omdurman", "mega", "Khartoum"),
      city("Khartoum", "mega", "Khartoum"),
      city("Khartoum North", "large", "Khartoum"),
      city("Port Sudan", "large", "Red Sea"),
      city("Nyala", "large", "South Darfur"),
      city("Kassala", "medium", "Kassala"),
      city("El Obeid", "medium", "North Kordofan"),
      city("Wad Madani", "medium", "Al Jazirah"),
      city("Kosti", "medium", "White Nile"),
      city("Gedaref", "medium", "Al Qadarif"),
      city("Atbara", "small", "River Nile"),
      city("El Fasher", "medium", "North Darfur"),
      city("Dongola", "small", "Northern"),
      city("Sennar", "small", "Sennar"),
    ],
  },
  // Al Hilal and Al Merrikh are among Africa's biggest clubs; the league was disrupted by the 2023 war.
  homePool: { seniors: 90, youth: 50 },
  abroad: { seniors: 15, youth: 3, destinations: weighted("EG:3 SA:3 QA:1 AE:1 TN:1 MA:1") },
});

const TZ = homeNation({
  code: "TZ",
  name: "Tanzania",
  capital: "Dodoma",
  latitude: -6.2,
  languages: languages("sw:7 en:3"),
  reputation: { national: 50, league: 42 },
  physique: { height: 176 },
  names: { given: [src("swahili", 4), src("anglophone", 3)], family: [src("swahili")] },
  nationality: {
    multipleRate: 0.08,
    tripleRate: 0.01,
    bornAbroadRate: 0.03,
    diasporaPull: 0.4,
    links: [
      ...links("regional", "KE:3 UG:2 CD:2 BI:2 RW:1 MZ:1"),
      ...links("arabWorld", "OM:1"),
      ...links("commonwealth", "EN:1"),
    ],
    // Tanzania does not permit dual citizenship.
    citizenship: restricted,
  },
  cities: {
    major: [
      city("Dar es Salaam", "mega", "Dar es Salaam"),
      city("Mwanza", "large", "Mwanza"),
      city("Arusha", "medium", "Arusha"),
      city("Dodoma", "medium", "Dodoma"),
      city("Mbeya", "medium", "Mbeya"),
      city("Morogoro", "medium", "Morogoro"),
      city("Tanga", "medium", "Tanga"),
      city("Zanzibar City", "medium", "Zanzibar"),
      city("Kigoma", "small", "Kigoma"),
      city("Moshi", "small", "Kilimanjaro"),
      city("Tabora", "small", "Tabora"),
      city("Songea", "small", "Ruvuma"),
      city("Musoma", "small", "Mara"),
      city("Shinyanga", "small", "Shinyanga"),
      city("Iringa", "small", "Iringa"),
      city("Bukoba", "small", "Kagera"),
    ],
  },
  // Simba and Young Africans make the NBC Premier League one of East Africa's strongest.
  homePool: { seniors: 110, youth: 60 },
  abroad: { seniors: 25, youth: 4, destinations: weighted("ZA:3 BE:2 TR:1 US:1 EG:1 MA:1 SE:1 DK:1") },
});

const TG = homeNation({
  code: "TG",
  name: "Togo",
  capital: "Lomé",
  latitude: 6.1,
  languages: languages("fr:4 ee:4 kbp:2"),
  reputation: { national: 52, league: 30 },
  physique: { height: 180 },
  names: {
    given: [src("francophone", 3), src("ewe", 4), src("west-african", 1)],
    family: [src("ewe")],
  },
  nationality: {
    multipleRate: 0.3,
    tripleRate: 0.03,
    bornAbroadRate: 0.16,
    diasporaPull: 0.55,
    links: [
      ...links("frenchAfrica", "FR:10 BE:1"),
      ...links("regional", "GH:6 BJ:4 BF:1 NG:1"),
      ...links("crossBorder", "DE:2"),
    ],
    citizenship: allowed,
  },
  cities: {
    major: [
      city("Lomé", "large", "Maritime"),
      city("Sokodé", "medium", "Centrale"),
      city("Kara", "medium", "Kara"),
      city("Kpalimé", "small", "Plateaux"),
      city("Atakpamé", "small", "Plateaux"),
      city("Dapaong", "small", "Savanes"),
      city("Tsévié", "small", "Maritime"),
      city("Aného", "small", "Maritime"),
      city("Bassar", "small", "Kara"),
      city("Mango", "town", "Savanes"),
    ],
  },
  homePool: { seniors: 50, youth: 40 },
  abroad: {
    seniors: 60,
    youth: 8,
    destinations: weighted("FR:10 BE:2 PT:2 DE:2 TR:2 CI:2 MA:2 TN:2 DZ:1 SA:1 GR:1 CY:1 US:1 ES:1"),
  },
});

const UG = homeNation({
  code: "UG",
  name: "Uganda",
  capital: "Kampala",
  latitude: 0.35,
  languages: languages("en:5 lg:3 sw:2"),
  reputation: { national: 54, league: 36 },
  physique: { height: 177 },
  names: { given: [src("anglophone", 5), src("ugandan", 2)], family: [src("ugandan")] },
  nationality: {
    multipleRate: 0.15,
    tripleRate: 0.01,
    bornAbroadRate: 0.06,
    diasporaPull: 0.45,
    links: [...links("regional", "KE:4 RW:3 TZ:2 SS:2 CD:2"), ...links("commonwealth", "EN:5 US:1")],
    // Dual citizenship has been allowed since the 2005 constitutional amendment.
    citizenship: allowed,
  },
  cities: {
    major: [
      city("Kampala", "mega", "Central"),
      city("Nansana", "medium", "Central"),
      city("Kira", "medium", "Central"),
      city("Gulu", "medium", "Northern"),
      city("Mbarara", "medium", "Western"),
      city("Jinja", "medium", "Eastern"),
      city("Masaka", "small", "Central"),
      city("Mbale", "small", "Eastern"),
      city("Lira", "small", "Northern"),
      city("Arua", "small", "Northern"),
      city("Entebbe", "small", "Central"),
      city("Fort Portal", "small", "Western"),
      city("Soroti", "small", "Eastern"),
      city("Hoima", "small", "Western"),
    ],
  },
  homePool: { seniors: 90, youth: 60 },
  abroad: { seniors: 35, youth: 6, destinations: weighted("ZA:4 EG:3 US:3 SE:2 ET:1 TN:1 SA:1 NO:1 DK:1 EN:1 TR:1 BE:1 CD:1") },
});

const ZM = homeNation({
  code: "ZM",
  name: "Zambia",
  capital: "Lusaka",
  latitude: -15.4,
  languages: languages("en:5 bem:3 ny:2"),
  reputation: { national: 58, league: 38 },
  physique: { height: 177 },
  names: { given: [src("anglophone", 5), src("zambian", 2)], family: [src("zambian")] },
  nationality: {
    multipleRate: 0.15,
    tripleRate: 0.01,
    bornAbroadRate: 0.06,
    diasporaPull: 0.4,
    links: [...links("regional", "ZA:5 ZW:4 MW:3 CD:3 TZ:1"), ...links("commonwealth", "EN:3")],
    // Dual citizenship has been allowed since the 2016 constitutional amendment.
    citizenship: allowed,
  },
  cities: {
    major: [
      city("Lusaka", "mega", "Lusaka"),
      city("Kitwe", "large", "Copperbelt"),
      city("Ndola", "large", "Copperbelt"),
      city("Kabwe", "medium", "Central"),
      city("Chingola", "medium", "Copperbelt"),
      city("Mufulira", "medium", "Copperbelt"),
      city("Livingstone", "medium", "Southern"),
      city("Luanshya", "medium", "Copperbelt"),
      city("Kasama", "small", "Northern"),
      city("Chipata", "small", "Eastern"),
      city("Kalulushi", "small", "Copperbelt"),
      city("Mansa", "small", "Luapula"),
      city("Solwezi", "small", "North-Western"),
      city("Mongu", "small", "Western"),
      city("Choma", "small", "Southern"),
    ],
  },
  // The Zambia Super League (Zesco, Power Dynamos, Nkana, ZANACO...) is a major regional exporter.
  homePool: { seniors: 100, youth: 60 },
  abroad: {
    seniors: 60,
    youth: 8,
    destinations: weighted("ZA:10 CD:3 EG:3 MA:3 TN:2 AT:2 TR:2 US:2 FR:1 BE:1 SE:1 EN:1 SA:1 QA:1 IN:1 ZW:1"),
  },
});

export const CAF: CatalogFileData = {
  file: "caf",
  nations: [
    MA, EG, NG, SN, DZ, TN, CI, CM, CD, ZA, GH, CV, AO, MZ, GW, GQ, ZW, CG, ET,
    BJ, BW, BF, BI, CF, TD, KM, DJ, ER, SZ, GA, GM, GN, KE, LS, LR, LY, MG,
    MW, ML, MR, MU, NA, NE, RW, ST, SC, SL, SO, SS, SD, TZ, TG, UG, ZM,
  ],
  namePools: [
    MOROCCAN,
    AMAZIGH,
    EGYPTIAN,
    ANGLOPHONE,
    YORUBA,
    IGBO,
    HAUSA,
    NIGER_DELTA,
    ALGERIAN,
    TUNISIAN,
    SENEGALESE,
    WEST_AFRICAN,
    FULA,
    MANDE,
    FRANCOPHONE,
    IVORIAN,
    CAMEROONIAN,
    FANG,
    CONGOLESE,
    KONGO,
    LUBA,
    CONGO_EAST,
    NGUNI,
    SOTHO_TSWANA,
    TSONGA_VENDA,
    CAPE,
    AKAN,
    EWE,
    DAGBANI,
    GA_ADANGBE,
    LUSOPHONE,
    CABOVERDEAN,
    ANGOLAN,
    MOZAMBICAN,
    BISSAU_GUINEAN,
    EQUATOGUINEAN,
    BUBI,
    SHONA,
    NDEBELE,
    CONGO_NORTH,
    ETHIOPIAN,
    BENINESE,
    MOSSI,
    CENTRAL_AFRICAN,
    CHADIAN,
    COMORIAN,
    SOMALI,
    ERITREAN,
    SWAZI,
    GABONESE,
    GAMBIAN,
    SUSU,
    KENYAN,
    LIBERIAN,
    LIBYAN,
    MALAGASY,
    MALAWIAN,
    MAURITANIAN,
    MAURITIAN,
    NAMIBIAN,
    NIGERIEN,
    GREAT_LAKES,
    SANTOMEAN,
    SEYCHELLOIS,
    SIERRA_LEONEAN,
    SOUTH_SUDANESE,
    SUDANESE,
    SWAHILI,
    UGANDAN,
    ZAMBIAN,
  ],
};
