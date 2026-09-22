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
  FR: ["fr"],
  BE: ["nl_BE", "fr_BE"],
  CH: ["de_CH", "fr_CH", "it"],
  LU: ["fr_LU", "de"],
  AT: ["de_AT"],
  DE: ["de"],
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

const custom: Record<string, NamePool | NamePool[]> = {
  AO: pool(
    "Joao|Manuel|Jose|Mateus|Paulo|Pedro|Antonio|Francisco|Helder|Sergio|Domingos|Filipe",
    "Ndala|Kiala|Quissanga|Zola|Mavungo|Manuel|Antonio|Domingos|Neto|Mateus|da Costa|Baptista",
  ),
  CV: pool(
    "Joao|Jose|Carlos|Nuno|Dario|Gilson|Jorge|Luis|Jovane|Nelson|Elton|Elvis",
    "Monteiro|Pina|Fortes|Semedo|Varela|Lopes|Tavares|Gomes|Correia|Barros|Rocha|Fernandes",
  ),
  MZ: pool(
    "Armando|Elias|Edson|Manuel|Joao|Luis|Alberto|Celso|Ernesto|Domingos|Isac|Joaquim",
    "Machel|Mondlane|Chissano|Mabunda|Machava|Mucavele|Matsinhe|Cossa|Langa|Nhantumbo|Matusse|Sitoe",
  ),
  GW: [
    pool(
      "Mamadou|Bacari|Alfa|Bubacar|Saliu|Aliu|Malam|Sana",
      "Balde|Djalo|Sane|Camara|Sowe|Mane|Dabo|Samba",
    ),
    pool(
      "Joao|Jose|Carlos|Toni|Jorge|Nelson|Francisco|Domingos",
      "Mendes|Gomes|Correia|Vieira|Dju|Sanca|Cassama|Da Silva",
    ),
  ],
  ST: pool(
    "Adilson|Jair|Jose|Luis|Joao|Celso|Nuno|Gilmar|Valter|Edmilson",
    "Viegas|Vera Cruz|Nascimento|Espirito Santo|Carvalho|Borges|Ramos|Lima|Neves|Santos",
  ),
  TL: pool(
    "Domingos|Agostinho|Natalino|Nicolau|Martinho|Eusebio|Joao|Jose|Adelino|Filomeno",
    "Soares|da Costa|Gusmao|Guterres|Sarmento|Amaral|Ximenes|da Silva|Fernandes|de Jesus",
  ),
  NG: [
    pool(
      "Oluwaseun|Olamide|Babatunde|Olumide|Adebayo|Tunde|Olufemi|Adekunle",
      "Adeyemi|Akinola|Ogunleye|Adebisi|Afolayan|Oladipo|Adeleke|Ojo",
    ),
    pool(
      "Chinedu|Chukwudi|Ifeanyi|Emeka|Obinna|Nnamdi|Uche|Chidi",
      "Okafor|Okeke|Nwosu|Eze|Nwankwo|Obi|Ibe|Onyema",
    ),
    pool(
      "Sani|Ibrahim|Abubakar|Musa|Usman|Bashir|Aminu|Kabiru",
      "Bello|Garba|Abdullahi|Danjuma|Umar|Yusuf|Lawal|Suleiman",
    ),
  ],
  GH: [
    pool(
      "Kwame|Kofi|Kwesi|Kwaku|Yaw|Kojo|Kwabena|Kwadwo",
      "Mensah|Owusu|Asante|Boateng|Osei|Agyeman|Adjei|Appiah",
    ),
    pool(
      "Selorm|Edem|Elikem|Mawuli|Koku|Senyo|Komla|Delali",
      "Agbeko|Dzakpa|Kpodo|Adzaho|Gakpo|Tetteh|Amegashie|Dogbe",
    ),
    pool(
      "Abdul|Ibrahim|Sulemana|Mubarak|Issah|Hassan|Mohammed|Hamza",
      "Alhassan|Yakubu|Fuseini|Iddrisu|Abubakari|Seidu|Salifu|Dramani",
    ),
  ],
  GM: pool(
    "Lamin|Ebrima|Bakary|Musa|Ousman|Alieu|Modou|Bubacarr|Yusupha|Pa",
    "Jallow|Sowe|Ceesay|Sanyang|Sanneh|Darboe|Bojang|Touray|Colley|Bah",
  ),
  SN: pool(
    "Mamadou|Ibrahima|Abdoulaye|Cheikh|Moussa|Ousmane|Babacar|Pape|Lamine|Modou|Saliou|Demba",
    "Ndiaye|Diop|Fall|Sarr|Gueye|Seck|Faye|Diouf|Sow|Ba|Diallo|Sy",
  ),
  GN: pool(
    "Mamadou|Ibrahima|Amadou|Ousmane|Moussa|Abdoulaye|Sekou|Lamine|Boubacar|Fode",
    "Diallo|Bah|Barry|Sow|Camara|Conte|Keita|Kourouma|Conde|Cisse",
  ),
  ML: pool(
    "Mamadou|Moussa|Amadou|Seydou|Adama|Ibrahima|Ousmane|Boubacar|Lassana|Bakary",
    "Traore|Coulibaly|Keita|Diarra|Dembele|Sissoko|Toure|Kone|Sidibe|Doumbia",
  ),
  BF: pool(
    "Issa|Adama|Moussa|Abdou|Lassina|Salif|Bakary|Boureima|Issouf|Ousmane",
    "Ouedraogo|Sawadogo|Kabore|Zongo|Traore|Sanou|Sankara|Nikiema|Compaore|Konate",
  ),
  CI: [
    pool(
      "Kouadio|Kouame|Koffi|Kouassi|Konan|Yao|N'Guessan|Kouakou",
      "Kouame|Kouassi|Yao|Koffi|N'Dri|N'Guessan|Konan|Kouadio",
    ),
    pool(
      "Moussa|Adama|Lassina|Ibrahim|Seydou|Bakary|Mamadou|Ismael",
      "Kone|Toure|Ouattara|Coulibaly|Diarra|Traore|Diomande|Bamba",
    ),
    pool(
      "Jean|Serge|Franck|Didier|Christian|Eric|Patrick|Emmanuel",
      "Kouassi|N'Dri|Gnahore|Zokou|Gohou|Kouame|Guehi|Bailly",
    ),
  ],
  NE: pool(
    "Moussa|Issa|Abdou|Ibrahim|Amadou|Oumarou|Hassane|Boubacar|Souleymane|Harouna",
    "Issoufou|Hamani|Garba|Moussa|Mahamadou|Diori|Amadou|Soumana|Oumarou|Adamou",
  ),
  BJ: [
    pool(
      "Romuald|Steve|Rodrigue|Cedric|Marcel|Pascal|Mathieu|Ulrich",
      "Soglo|Hounkpatin|Adjovi|Dossou|Houngbo|Sossou|Ahouansou|Agonlin",
    ),
    pool(
      "Rachid|Moussa|Ismail|Youssouf|Abdou|Ibrahim|Arouna|Sanni",
      "Bello|Yarou|Sanni|Djamal|Gounou|Boko|Djaouga|Abdoulaye",
    ),
  ],
  TG: pool(
    "Kodjo|Komlan|Komla|Kossi|Koffi|Kokou|Yao|Edem|Selom|Dodzi",
    "Agbo|Lawson|Amouzou|Gakpo|Adzo|Akakpo|Agbeti|Dossou|Kpodo|Dogbe",
  ),
  SL: [
    pool(
      "Mohamed|Alhassan|Ibrahim|Sorie|Alusine|Abu|Osman|Saidu",
      "Kamara|Sesay|Bangura|Koroma|Conteh|Turay|Kallon|Kargbo",
    ),
    pool(
      "John|David|Christian|Joseph|Samuel|Daniel|George|Edward",
      "Cole|Davies|Williams|Roberts|Johnson|Kamara|Kallon|Caulker",
    ),
  ],
  LR: pool(
    "Kollie|Varney|Sekou|Boye|Prince|Emmanuel|Anthony|Joseph|Samuel|Isaac",
    "Kpoto|Kollie|Kromah|Kamara|Yarkpawolo|Gbotoe|Kouyateh|Flomo|Doe|Jallah",
  ),
  CG: pool(
    "Jean|Giscard|Davy|Gloire|Fabrice|Prince|Christ|Cedric|Junior|Exauce",
    "Mabiala|Mouanda|Nkouka|Ngoma|Ondongo|Massamba|Moutou|Makosso|Bissila|Kibouka",
  ),
  GA: pool(
    "Brice|Franck|Didier|Fabrice|Pierre|Jean|Cedric|Guelor|Steeve|Axel",
    "Nguema|Mba|Ondo|Obiang|Ebang|Moussavou|Mouele|Mouyabi|Moundounga|Ndong",
  ),
  GQ: pool(
    "Emilio|Basilio|Federico|Teodoro|Jose|Esteban|Juan|Pablo|Santiago|Ruben",
    "Nsue|Nchama|Obiang|Ondo|Mba|Esono|Nguema|Ndong|Engonga|Ebana",
  ),
  CF: pool(
    "Geoffrey|Landry|Amos|Hilaire|Wilfried|Cedric|Blaise|Jean|Christian|Vianney",
    "Kondogbia|Ketevoama|Mabide|Koyanbounou|Ngakoutou|Gbabia|Yamissi|Ndobe|Goua|Guebari",
  ),
  TD: [
    pool(
      "Mahamat|Abakar|Moussa|Ahmat|Hassan|Issa|Oumar|Ali",
      "Saleh|Abdoulaye|Youssouf|Brahim|Hassane|Adoum|Djibrine|Khamis",
    ),
    pool(
      "Nodjitoloum|Ngar|Marius|Ezechiel|Casimir|Mbaidoum|Haroun|Nambatingue",
      "Ngarlem|Ngarassal|Djidingar|Mbaigon|Nassour|Madji|Togou|Ngarndiguim",
    ),
  ],
  SS: [
    pool("Deng|Bol|Dut|Garang|Kuol|Lual|Ajak|Nyok", "Deng|Bol|Akol|Dut|Garang|Kuol|Lual|Mabior"),
    pool("Gatluak|Gatwech|Gatdet|Gatkuoth|Gatbel|Gatmai|Peter|John", "Gatluak|Gatwech|Gatdet|Gatkuoth|Gatbel|Gatmai|Gatpan|Gatjang"),
  ],
  KM: pool(
    "Ali|Said|Ahmed|Mohamed|Youssouf|Ibrahim|Hassan|Salim|Abdallah|Fahad",
    "M'Changama|Djae|Abdallah|Madi|Bacar|Mroudjae|Ali|Said|Mze|Ahamada",
  ),
  MU: [
    pool(
      "Ravin|Vikash|Sunil|Rajesh|Ajay|Kishan|Dev|Ashwin",
      "Ramgoolam|Jugnauth|Seegobin|Ramsamy|Boodhoo|Ramdanee|Appadoo|Beeharry",
    ),
    pool(
      "Jean|Kevin|Jonathan|Fabrice|Christopher|Stephane|Bruno|Cedric",
      "Dookhee|Naboth|Lalanne|Cotte|Gaspard|Pierre|Ravina|L'Enclume",
    ),
    pool(
      "Mohamed|Shahid|Feroz|Imran|Yusuf|Rashid|Salim|Irfan",
      "Cassam|Joomun|Hossen|Peerun|Goolam|Issop|Bholah|Alladeen",
    ),
  ],
  SC: pool(
    "Jean|Elijah|Kevin|Brandon|Dylan|Gavin|Ralph|Don|Nigel|Fabrice",
    "Hoareau|Vidot|Payet|Gonthier|Labrosse|Louange|Ernesta|Rose|Cesar|Sinon",
  ),
  NA: [
    pool(
      "Petrus|Paulus|Johannes|Absalom|Eliphas|Tangeni|Pandu|Simon",
      "Shikongo|Amutenya|Nangolo|Shilongo|Haimbili|Uushona|Tjipueja|Katjizeu",
    ),
    pool(
      "Riaan|Johan|Willem|Hendrik|Petrus|Collin|Brian|Jeremy",
      "Cloete|Isaacs|Jacobs|Nels|Beukes|Diergaardt|Hanse|Links",
    ),
  ],
  LS: pool(
    "Thabo|Thabang|Teboho|Mokete|Mpho|Tumelo|Lebohang|Kabelo|Rethabile|Ts'epo",
    "Mokoena|Molefe|Mokhethi|Mofokeng|Rasebotsa|Mothea|Mabote|Mokhesi|Ntsane|Seema",
  ),
  SZ: pool(
    "Sibusiso|Musa|Bongani|Thulani|Mlungisi|Sifiso|Sabelo|Nkosingiphile|Mzwandile|Sandile",
    "Dlamini|Mkhonta|Maseko|Nxumalo|Gamedze|Hlophe|Simelane|Shongwe|Mavimbela|Ginindza",
  ),
  MW: pool(
    "Chisomo|Gift|Chimwemwe|Limbani|Kondwani|Chikondi|Lameck|Yamikani|Peter|Stanley",
    "Banda|Phiri|Mhone|Msiska|Mbewe|Munthali|Chirwa|Nkhoma|Chiumia|Kamwendo",
  ),
  IN: [
    pool(
      "Arjun|Rohit|Vivek|Amit|Nikhil|Ravi|Rahul|Manish",
      "Sharma|Gupta|Verma|Joshi|Yadav|Mishra|Tiwari|Saxena",
    ),
    pool(
      "Sujan|Subrata|Sourav|Abhijit|Debjit|Souvik|Prabir|Anirban",
      "Das|Roy|Sarkar|Chatterjee|Banerjee|Biswas|Ghosh|Dutta",
    ),
    pool(
      "Arun|Karthik|Senthil|Saravanan|Prakash|Dinesh|Vijay|Ganesh",
      "Murugan|Raman|Subramanian|Rajendran|Selvam|Balakrishnan|Ganesan|Ravichandran",
    ),
    pool(
      "Gurpreet|Harjit|Manpreet|Jaspreet|Baljit|Amarjit|Gurjit|Navdeep",
      "Singh|Sandhu|Gill|Dhillon|Bajwa|Sidhu|Brar|Grewal",
    ),
    pool(
      "Aamir|Faisal|Imran|Irfan|Arif|Yusuf|Salim|Rashid",
      "Khan|Ali|Siddiqui|Ansari|Shaikh|Qureshi|Hussain|Ahmed",
    ),
  ],
  AF: [
    pool(
      "Farid|Jamshed|Fardin|Omid|Behrouz|Nader|Sohrab|Jawad",
      "Rahimi|Ahmadi|Azizi|Haidari|Naderi|Karimi|Habibi|Sultani",
    ),
    pool(
      "Gul|Sher|Naseem|Rahmat|Naveed|Zahir|Hamid|Shah",
      "Shinwari|Zadran|Wardak|Momand|Popalzai|Durrani|Barakzai|Noorzai",
    ),
  ],
  MY: [
    pool(
      "Ahmad|Muhammad|Azlan|Hafiz|Syafiq|Firdaus|Amir|Faizal",
      "bin Abdullah|bin Hassan|bin Ibrahim|bin Ismail|bin Yusof|bin Osman|bin Rahman|bin Zainal",
    ),
    pool("Wei Ming|Jun Jie|Zhi Hao|Kai Wen|Jia Wei|Zhi Ming", "Tan|Lim|Lee|Wong|Ng|Teoh|Goh|Chong", true),
    pool("Arun|Suresh|Dinesh|Kumar|Ravi|Vijay", "a/l Murugan|a/l Raman|a/l Selvam|a/l Rajan|a/l Kumar|a/l Mani"),
  ],
  SG: [
    pool("Wei Ming|Jun Jie|Zhi Hao|Kai Wen|Jia Wei|Jun Hao", "Tan|Lim|Lee|Wong|Ng|Goh|Chua|Teo", true),
    pool("Ahmad|Muhammad|Hafiz|Syafiq|Firdaus|Amir", "bin Abdullah|bin Hassan|bin Ibrahim|bin Ismail|bin Yusof|bin Osman"),
    pool("Arun|Suresh|Dinesh|Ravi|Vijay|Prakash", "Murugan|Raman|Selvam|Rajendran|Subramanian|Ganesan"),
  ],
  BN: pool(
    "Azim|Hafiz|Faiq|Hakim|Haziq|Aiman|Syafiq|Afiq",
    "bin Abdullah|bin Hassan|bin Ibrahim|bin Ismail|bin Yusof|bin Osman|bin Rahman|bin Zainal",
  ),
  SR: [
    pool("Ramon|Denzel|Giovanni|Kenneth|Delano|Clifton|Marvin|Quincy", "Bergwijn|Pinas|Burgzorg|Hasselbaink|Essed|Pengel|Kappel|Redan"),
    pool("Ravi|Sunil|Rajesh|Vijay|Anil|Ramesh|Ashwin|Dev", "Sewnarain|Ramdin|Baldew|Mungra|Bisoen|Binda|Jagai|Jadnanansing"),
    pool("Willy|Ronny|Soewarto|Benny|Kasan|Soekardi|Slamet|Soejono", "Somohardjo|Sastroredjo|Atmodikoro|Kartokromo|Kromodihardjo|Djojoseparto|Pawiroredjo|Karijodimedjo"),
  ],
  HT: pool(
    "Widner|Wilner|Wilson|Kervens|Fabrice|Frantz|Wesner|Jean|Ricardo|Sony",
    "Pierre|Jean|Louis|Charles|Joseph|Desir|Etienne|Saint Fleur|Jacques|Moise",
  ),
  CW: pool(
    "Jurgen|Leandro|Rangelo|Kenji|Jairo|Gervane|Roshon|Richairo|Darryl|Jerson",
    "Martina|Bacuna|Maria|Martha|Lachman|Isenia|Janga|Zimmerman|Pinedo|Francisca",
  ),
  AW: pool(
    "Denzel|Joshua|Edison|Raymond|Jean|Javier|Rensy|Edgar|Marlon|David",
    "Erasmus|Croes|Wever|Britten|Tromp|Bislip|Oduber|Ridderstap|Geerman|Rasmijn",
  ),
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
  ZW: [
    pool(
      "Tinashe|Tendai|Tatenda|Kudakwashe|Tawanda|Takudzwa|Farai|Simbarashe|Blessing|Tanaka",
      "Moyo|Muzenda|Chikore|Mupfumi|Chirume|Zhou|Chiweshe|Mapfumo|Mudzuri|Chinyama",
    ),
    pool(
      "Thabani|Sibusiso|Bhekinkosi|Mthokozisi|Mduduzi|Thulani|Bongani|Mandla",
      "Ndlovu|Ncube|Moyo|Sibanda|Dube|Mpofu|Nkomo|Khumalo",
    ),
  ],
  BW: pool(
    "Kabelo|Thabo|Mpho|Thato|Kgomotso|Tebogo|Tumelo|Keabetswe|Lesego|Karabo",
    "Molefe|Mokgosi|Modise|Motsumi|Mogorosi|Kgosi|Mokgothu|Ramosweu|Gabotshwene|Ramotswa",
  ),
  AL: pool(
    "Ardit|Arben|Luan|Erion|Besnik|Ilir|Dritan|Altin|Endri|Gent|Arlind|Faton",
    "Hoxha|Dervishi|Kola|Basha|Shehu|Gashi|Krasniqi|Leka|Rama|Deda|Berisha|Shala",
  ),
  BA: [
    pool(
      "Haris|Emir|Adnan|Edin|Mirza|Amar|Anel|Kenan|Nermin|Elvir",
      "Hadzic|Begovic|Hodzic|Halilovic|Dedic|Basic|Sehic|Huseinovic|Mehic|Zukic",
    ),
    pool(
      "Luka|Nikola|Marko|Ivan|Milan|Stefan|Dejan|Dragan|Petar|Mario",
      "Kovacevic|Vukovic|Jovanovic|Markovic|Petrovic|Maric|Knezevic|Tomic|Pavic|Kozic",
    ),
  ],
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
  LK: [
    pool(
      "Kasun|Nuwan|Dinesh|Lahiru|Ruwan|Chamara|Isuru|Tharindu|Dilshan|Asanka",
      "Perera|Fernando|Silva|Jayasinghe|Rajapaksa|Gunawardena|Karunaratne|Wijesinghe|Bandara|Senanayake",
    ),
    pool(
      "Arul|Suresh|Ramesh|Sivakumar|Kannan|Pradeep|Tharshan|Prakash",
      "Subramaniam|Sivapalan|Balasubramaniam|Rajendran|Nadarajah|Tharmalingam|Selvarajah|Kandasamy",
    ),
  ],
  BT: pool(
    "Tenzin|Karma|Pema|Sonam|Dorji|Tshering|Jigme|Sangay|Ugyen|Wangchuk",
    "Dorji|Wangchuk|Tobgay|Norbu|Wangdi|Gyeltshen|Tshering|Namgyal|Rinchen|Thinley",
  ),
  FJ: [
    pool(
      "Jone|Josefa|Samuela|Iliesa|Peni|Sairusi|Tevita|Mosese|Manasa|Laisenia",
      "Ravulo|Nasilasila|Naivalu|Ravouvou|Koroi|Tuisova|Nabuli|Nayacalevu|Rokoduru|Nacewa",
    ),
    pool("Ravi|Vijay|Sunil|Rajesh|Anil|Rohit|Ravindra|Avinesh", "Prasad|Singh|Sharma|Kumar|Lal|Chand|Naidu|Pillay"),
  ],
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
  CK: pool("Tere|Tama|Teariki|Tua|Teina|Ngatupuna|Pita|Peter", "Maoate|Marsters|Wigmore|Brown|Inatio|Tuavera|Ioane|Manarangi"),
  NU: pool("Toke|Dalton|Sione|Himalea|Tavita|Pita|Ioane|John", "Talagi|Tagelagi|Lakatani|Rex|Sikivou|Fakatou|Vui|Pihigia"),
  NC: pool("Jean|Georges|Jacques|Christian|Willy|Alain|Patrick|Didier", "Wamytan|Wetewea|Hnepeune|Goprou|Gope|Luepack|Wakanumune|Qaeze"),
  FM: pool("John|Henry|Mori|Kerson|David|Masao|Yasuo|Joseph", "Nena|Mori|Nakayama|Sigrah|Suka|Christian|Robert|Yamase"),
  MH: pool("Anjua|David|John|Tony|Jurelang|Litokwa|Kessai|Christopher", "Kabua|Note|Zedkaia|DeBrum|Loeak|Kedi|Heine|Paul"),
  PW: pool("Tommy|Surangel|Johnson|Noah|David|Ngiraklang|Kesolei|Francis", "Remengesau|Whipps|Toribiong|Chin|Tmetuchl|Rechebei|Ueki|Salii"),
  NR: pool("Deven|Rennier|Rykers|Marcus|David|Lionel|Keiren|Roland", "Adeang|Aingimea|Scotty|Kun|Harris|Dabwido|Akua|Detenamo"),
  KI: pool("Teburoro|Anote|Taneti|Betero|Teatao|Banuera|Tebutonga|Ioane", "Tong|Maamau|Tito|Tabai|Teannaki|Betero|Kirata|Toakai"),
  TV: pool("Enele|Kausea|Willy|Samuelu|Saufatu|Apisai|Isaia|Ioane", "Sopoaga|Natano|Telavi|Toafa|Salu|Latasi|Teo|Paeniu"),
  GU: pool("Jose|Juan|Vicente|Antonio|Francisco|Joaquin|John|Michael", "Cruz|Duenas|Taitano|Gumataotao|Terlaje|Sablan|Aguon|Chargualaf"),
  MP: pool("Jose|Juan|Vicente|Antonio|Francisco|Joaquin|John|Michael", "Sablan|Apatang|Fitial|Mafnas|Taitano|Camacho|Tenorio|Galide"),
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
        familyFirst: ["ja", "ko", "zh_CN", "zh_TW", "vi", "hu"].includes(locale),
      }
    : undefined;
}

export function namingPools(country: NamingCountry): {
  pools: NamePool[];
  source: string;
} {
  const code = custom[country.code]
    ? country.code
    : (aliases[country.code] ?? country.code);
  const countryPool = custom[code];
  if (countryPool)
    return {
      pools: Array.isArray(countryPool) ? countryPool : [countryPool],
      source: `country:${code}`,
    };
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
  EN: "Birmingham|Manchester|Liverpool|Leeds|Sheffield|Bristol|Newcastle|Nottingham|Leicester|Southampton|Portsmouth|Derby|Coventry|Sunderland|Wolverhampton|Brighton|Plymouth|Reading|Blackpool|Preston|Bradford|Huddersfield|Oxford|Cambridge|York|Exeter|Ipswich|Norwich|Bolton|Burnley|Watford|Luton|Middlesbrough|Blackburn|Carlisle|Stockport|Chesterfield|Lincoln|Northampton|Walsall|Mansfield|Crewe|Doncaster|Barnsley|Rotherham|Tranmere|Salford|Gillingham|Cheltenham|Shrewsbury|Crawley|Swindon|Grimsby|Scunthorpe|Aldershot|Chester|Hereford|Worcester|Bath",
  BR: "Sao Paulo|Rio de Janeiro|Salvador|Belo Horizonte|Fortaleza|Recife|Curitiba|Porto Alegre|Manaus|Belem|Goiania|Natal|Maceio|Florianopolis|Vitoria|Joao Pessoa|Santos|Campinas|Niteroi|Londrina|Pelotas|Joinville|Aracaju|Cuiaba|Teresina|Sao Luis|Sorocaba|Ribeirao Preto|Juiz de Fora|Uberlandia",
  FR: "Paris|Marseille|Lyon|Toulouse|Nice|Nantes|Montpellier|Strasbourg|Bordeaux|Lille|Rennes|Reims|Saint-Etienne|Toulon|Le Havre|Grenoble|Dijon|Angers|Nimes|Aix-en-Provence|Brest|Limoges|Tours|Amiens",
  DE: "Berlin|Hamburg|Munchen|Koln|Frankfurt|Stuttgart|Dusseldorf|Dortmund|Essen|Leipzig|Bremen|Dresden|Hannover|Nurnberg|Duisburg|Bochum|Wuppertal|Bielefeld|Bonn|Munster|Karlsruhe|Mannheim|Augsburg|Freiburg",
  ES: "Madrid|Barcelona|Valencia|Sevilla|Zaragoza|Malaga|Murcia|Palma|Las Palmas|Bilbao|Alicante|Cordoba|Valladolid|Vigo|Gijon|Granada|A Coruna|Vitoria|Elche|Oviedo|Cartagena|Pamplona|Santander|Almeria",
  IT: "Roma|Milano|Napoli|Torino|Palermo|Genova|Bologna|Firenze|Bari|Catania|Venezia|Verona|Messina|Padova|Trieste|Brescia|Parma|Taranto|Prato|Modena|Reggio Calabria|Reggio Emilia|Perugia|Livorno",
  NL: "Amsterdam|Rotterdam|Den Haag|Utrecht|Eindhoven|Groningen|Tilburg|Almere|Breda|Nijmegen|Apeldoorn|Haarlem|Arnhem|Enschede|Amersfoort|Zaanstad|Zwolle|Leiden|Maastricht|Dordrecht|Alkmaar|Deventer|Delft|Venlo",
  JP: "Tokyo|Osaka|Kyoto|Yokohama|Nagoya|Sapporo|Kobe|Fukuoka|Kawasaki|Saitama|Hiroshima|Sendai|Chiba|Niigata|Hamamatsu|Shizuoka|Okayama|Kumamoto|Kanazawa|Nagasaki|Oita|Kagoshima|Mito|Nara",
  AO: "Luanda|Benguela|Huambo|Lubango|Lobito|Malanje|Cabinda|Namibe|Uige|Soyo|Sumbe|Cuito|Menongue|Lucapa",
  CV: "Praia|Mindelo|Santa Maria|Assomada|Pedra Badejo|Porto Novo|Sao Filipe|Sal Rei|Tarrafal|Ribeira Grande|Espargos|Pombas",
  MZ: "Maputo|Matola|Beira|Nampula|Chimoio|Quelimane|Tete|Xai-Xai|Inhambane|Lichinga|Pemba|Nacala",
  GW: "Bissau|Bafata|Gabu|Cacheu|Bissora|Bolama|Canchungo|Farim|Quinhamel|Mansoa|Buba|Catio",
  ST: "Sao Tome|Trindade|Neves|Santana|Guadalupe|Santo Amaro|Santo Antonio|Santa Cruz|Porto Alegre|Ribeira Afonso",
  SN: "Dakar|Thies|Saint-Louis|Kaolack|Ziguinchor|Diourbel|Louga|Tambacounda|Mbour|Rufisque|Kolda|Fatick",
  ML: "Bamako|Sikasso|Mopti|Segou|Kayes|Koutiala|Gao|Tombouctou|Kati|San|Bougouni|Koulikoro",
  BF: "Ouagadougou|Bobo-Dioulasso|Koudougou|Banfora|Ouahigouya|Kaya|Dori|Fada N'Gourma|Tenkodogo|Dedougou",
  CI: "Abidjan|Bouake|Yamoussoukro|Daloa|San Pedro|Korhogo|Man|Gagnoa|Abengourou|Divo|Aboisso|Odienne",
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

const countryClubForms: Record<string, string[]> = {
  PT: clubForms.pt,
  BR: ["EC {city}", "AA {city}", "{city} FC", "SE {city}", "Gremio de {city}", "Atletico de {city}", "Uniao de {city}", "SC {city}"],
  AO: ["Desportivo de {city}", "GD {city}", "FC {city}", "Atletico de {city}", "Uniao de {city}", "Sporting de {city}"],
  MZ: ["Ferroviario de {city}", "Desportivo de {city}", "GD {city}", "CD {city}", "FC {city}", "Liga de {city}"],
  CV: ["Academica de {city}", "GD {city}", "Sporting de {city}", "Uniao de {city}", "FC {city}", "Juventude de {city}"],
  GW: ["Sporting de {city}", "FC {city}", "GD {city}", "Desportivo de {city}", "Uniao de {city}", "CD {city}"],
  ST: ["UD {city}", "GD {city}", "Desportivo de {city}", "FC {city}", "CD {city}", "Sporting de {city}"],
  TL: ["FC {city}", "AS {city}", "{city} FC", "AD {city}"],
  LU: ["FC {city}", "Jeunesse {city}", "US {city}", "Union {city}", "CS {city}", "SC {city}"],
  CH: ["FC {city}", "SC {city}", "AS {city}", "US {city}", "AC {city}", "{city} FC"],
  AT: ["SV {city}", "SC {city}", "FC {city}", "SK {city}", "ASK {city}", "Union {city}"],
  BE: ["KFC {city}", "RFC {city}", "KV {city}", "RUS {city}", "SK {city}", "KSV {city}", "FC {city}", "RSC {city}"],
  RS: ["FK {city}", "OFK {city}", "Radnik {city}", "Jedinstvo {city}", "Mladost {city}", "Buducnost {city}"],
  BA: ["FK {city}", "NK {city}", "OFK {city}", "Radnik {city}", "Mladost {city}", "Jedinstvo {city}"],
  ME: ["FK {city}", "OFK {city}", "Mladost {city}", "Jedinstvo {city}"],
  HR: ["NK {city}", "HNK {city}", "Radnik {city}", "Mladost {city}", "Lokomotiva {city}", "Jedinstvo {city}"],
  SI: ["NK {city}", "ND {city}", "SD {city}", "FC {city}"],
  AL: ["KF {city}", "KS {city}", "FK {city}", "AF {city}"],
  XK: ["KF {city}", "FC {city}", "FK {city}", "AF {city}"],
  MK: ["FK {city}", "GFK {city}", "Mladost {city}", "Lokomotiva {city}"],
  BG: ["FK {city}", "PFC {city}", "Lokomotiv {city}", "Spartak {city}", "Sportist {city}"],
  CZ: ["SK {city}", "FK {city}", "TJ {city}", "FC {city}", "Sokol {city}", "Slovan {city}"],
  SK: ["SK {city}", "FK {city}", "MSK {city}", "TJ {city}", "Slovan {city}"],
  HU: ["{city} SE", "{city} SC", "{city} FC", "{city} TK", "{city} VSE"],
  GR: ["AO {city}", "AS {city}", "{city} FC", "Apollon {city}", "Asteras {city}"],
  CY: ["AS {city}", "AE {city}", "{city} FC", "Apollon {city}"],
  RU: ["FK {city}", "Dinamo {city}", "Lokomotiv {city}", "Spartak {city}", "Torpedo {city}"],
  UA: ["FK {city}", "Dynamo {city}", "Lokomotyv {city}", "Metalurh {city}", "Olimpik {city}"],
  BY: ["FK {city}", "Dinamo {city}", "Lokomotiv {city}", "Torpedo {city}"],
  DK: ["{city} BK", "{city} IF", "FC {city}", "{city} Boldklub", "BK {city}"],
  IS: ["IF {city}", "UMF {city}", "KF {city}", "FC {city}"],
  FO: ["{city} IF", "{city} BK", "FC {city}", "{city} FF"],
  FI: ["{city} JK", "FC {city}", "{city} Palloseura", "{city} United"],
  EE: ["JK {city}", "FC {city}", "SK {city}", "{city} JK"],
  LV: ["FK {city}", "FS {city}", "SK {city}", "{city} FK"],
  LT: ["FK {city}", "FC {city}", "{city} FK", "SK {city}"],
  MT: ["{city} FC", "{city} United", "{city} Athletic", "{city} Rangers"],
  SR: ["SV {city}", "VV {city}", "SC {city}", "Inter {city}", "FC {city}"],
  CW: ["SV {city}", "RKSV {city}", "CRKSV {city}", "Centro {city}", "FC {city}"],
  AW: ["SV {city}", "RC {city}", "FC {city}", "Deportivo {city}", "Union {city}"],
  AR: ["CA {city}", "CD {city}", "{city} FC", "CS {city}", "Union de {city}", "Deportivo {city}"],
  UY: ["CA {city}", "CS {city}", "{city} FC", "Deportivo {city}", "Union de {city}"],
  MA: ["Ittihad {city}", "Chabab {city}", "Raja {city}", "Wydad {city}", "AS {city}", "Union Sportive de {city}"],
  DZ: ["US {city}", "JS {city}", "MC {city}", "CR {city}", "RC {city}", "ES {city}"],
  TN: ["AS {city}", "ES {city}", "CS {city}", "US {city}", "Stade {city}", "Olympique {city}"],
  SN: ["ASC {city}", "AS {city}", "US {city}", "Stade {city}", "{city} FC", "CS {city}"],
  ML: ["AS {city}", "US {city}", "CS {city}", "Stade {city}", "FC {city}"],
  BF: ["AS {city}", "US {city}", "RC {city}", "{city} FC", "Etoile de {city}"],
  CI: ["ASEC {city}", "AS {city}", "SO {city}", "Stade {city}", "FC {city}", "US {city}"],
  GQ: ["Deportivo {city}", "CD {city}", "AD {city}", "{city} FC", "Atletico {city}"],
  NG: ["{city} United", "{city} FC", "{city} Stars", "{city} SC", "Sporting {city}"],
  GH: ["{city} United", "{city} FC", "{city} Stars", "{city} SC", "Real {city}"],
  ZA: ["{city} United", "{city} City", "{city} FC", "{city} Stars", "{city} Rovers"],
  JP: ["{city} FC", "FC {city}", "{city} SC", "{city} United"],
  KR: ["{city} FC", "FC {city}", "{city} Citizen", "{city} United", "{city} SC"],
  KP: ["{city} SC", "{city} FC", "SC {city}", "FC {city}"],
  CN: ["{city} FC", "FC {city}", "{city} SC", "SC {city}"],
  TW: ["{city} FC", "FC {city}", "{city} SC", "SC {city}"],
  HK: ["{city} FC", "{city} SC", "{city} AA", "FC {city}"],
  MO: ["CD {city}", "{city} FC", "SC {city}", "GD {city}"],
  TH: ["{city} United", "{city} FC", "{city} City", "{city} SC"],
  VN: ["CLB {city}", "{city} FC", "FC {city}", "{city} SC"],
  ID: ["Persatuan {city}", "PS {city}", "Perserikatan {city}", "{city} FC"],
  MY: ["{city} FC", "{city} FA", "Kelab {city}", "{city} United"],
  BN: ["{city} FC", "{city} FA", "Kelab {city}", "FC {city}"],
  SG: ["{city} FC", "{city} United", "FC {city}", "{city} SC"],
  IR: ["Shahrdari {city}", "Payam {city}", "Mehr {city}", "{city} FC", "Esteghlal {city}"],
  ET: ["{city} SC", "{city} Ketema", "{city} FC", "SC {city}"],
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
const cityExonyms: Record<string, Record<string, string>> = {
  PT: { lisbon: "Lisboa", oporto: "Porto" },
  DE: { munich: "Munchen", cologne: "Koln", nuremberg: "Nurnberg" },
  AT: { vienna: "Wien" },
  ES: { seville: "Sevilla", saragossa: "Zaragoza" },
  IT: { rome: "Roma", milan: "Milano", naples: "Napoli", florence: "Firenze", venice: "Venezia", turin: "Torino", genoa: "Genova" },
  NL: { "the hague": "Den Haag", "'s-gravenhage": "Den Haag" },
  CH: { geneva: "Geneve" },
  GR: { athens: "Athina" },
};
const cityKey = (name: string) => name.normalize("NFKD").replace(/\p{M}/gu, "").toLowerCase();

function settlementNames(
  country: NamingCountry,
  preferredCities?: string[],
): string[] {
  const cacheKey = `${country.code}:${country.region}:${preferredCities?.join("|") ?? ""}`;
  let cities = cityCache.get(cacheKey);
  if (!cities) {
    const known = [
      ...(places[country.code]?.split("|") ?? []),
      ...(preferredCities ?? []),
      ...(geographicCities.get(country.code) ?? []),
    ];
    const unique = new Map<string, string>();
    for (const name of known) {
      const trimmed = name.trim();
      const local = cityExonyms[country.code]?.[cityKey(trimmed)] ?? trimmed;
      const normalized = cityKey(local);
      if (local && !unique.has(normalized)) unique.set(normalized, local);
    }
    cities = unique.size ? [...unique.values()] : [country.region || country.name];
    cityCache.set(cacheKey, cities);
  }
  return cities;
}

export function clubIdentity(
  country: NamingCountry,
  index: number,
  preferredCities?: string[],
) {
  if (!Number.isSafeInteger(index) || index < 0)
    throw new RangeError("Club index must be a non-negative safe integer.");
  const cities = settlementNames(country, preferredCities);
  const city = cities[index % cities.length];
  const templates = countryClubForms[country.code] ?? clubForms[country.language] ?? [
    "FC {city}",
    "{city} SC",
    "{city} FC",
    "SC {city}",
  ];
  const template =
    templates[
      (Math.floor(index / cities.length) + (index % cities.length)) %
        templates.length
    ];
  const cycle = Math.floor(index / (cities.length * templates.length));
  const name = `${template.replace("{city}", city)}${cycle ? ` (${cycle + 1})` : ""}`;
  return { city, name, shortName: city.slice(0, 3).toUpperCase() };
}

export function localizedLegacyClubName(
  country: NamingCountry,
  name: string,
  city: string,
  variant = 0,
): string {
  const templates = countryClubForms[country.code] ?? clubForms[country.language];
  if (
    !templates ||
    templates.some((template) => template.replace("{city}", city) === name) ||
    !["United", "Athletic", "Olympic", "Sporting"].some((suffix) => name === `${city} ${suffix}`)
  ) return name;
  const template = templates[variant % templates.length];
  const cycle = Math.floor(variant / templates.length);
  return `${template.replace("{city}", city)}${cycle ? ` (${cycle + 1})` : ""}`;
}

export const identityGenerationNotes = {
  scope: "Fictional people only. Country roots are narrative family history, not inferred ethnicity or genetic ancestry, and never determine ability, traits or value.",
  weights: "Family frequencies and corridor weights are game-design choices, not census estimates. The 46% multiple-root / 12% three-root defaults are inclusive; some established diaspora destinations use higher fictional frequencies.",
  eligibility: "Extra nationalities assume citizenship transmitted by a fictional citizen parent, including a dual-citizen parent in three-country families. Heritage, birthplace, language and employment alone are not evidence. Restrictive or unmodeled cases remain heritage-only; exceptional legal routes are not simulated.",
  associations: "Nationalities retain the game's association IDs. Shared British, French, Dutch, Danish, Finnish and New Zealand citizenship groups are not counted as extra passports.",
  naming: "Curated paired pools and Faker locales are illustrative, not exhaustive or population-weighted. Ethiopian, Eritrean, Somali, Mongolian, Tamil and Malay components include parental personal names; they are not universally inherited surnames. Burmese and Bhutanese pools also contain successive personal-name components. Transliteration and name order are simplified.",
  clubs: "Real settlement lists and country conventions seed fictional combinations. Parenthesized numbers only disambiguate exhausted combinations; they are not founding years or reserve-team designations.",
  sources: [
    "https://www.un.org/development/desa/pd/content/international-migrant-stock",
    "https://www.gov.uk/dual-citizenship",
    "https://www.government.nl/topics/dutch-citizenship/dual-citizenship",
  ],
} as const;

const migrationContexts = {
  lusophone: "Portuguese, Brazilian and Lusophone African migration and family connections",
  frenchAfrica: "migration between France, the Maghreb and West or Central Africa",
  germanRecruitment: "post-war labour migration connecting Germany with Turkey, Italy and the Balkans",
  dutchDiaspora: "historical migration connecting the Netherlands, Suriname, the Caribbean and Indonesia",
  britishIrish: "longstanding movement between Britain and Ireland",
  commonwealth: "Commonwealth migration and established overseas family communities",
  crossBorder: "cross-border and labour migration in continental Europe",
  mediterranean: "Mediterranean and transatlantic migration and family connections",
  americas: "migration within the Americas and their established overseas communities",
  pacific: "Pacific migration and New Zealand or Australian family connections",
  regional: "regional migration and cross-border family connections",
  asianDiaspora: "Asian diaspora and regional migration connections",
} as const;

type FamilyLink = {
  code: string;
  weight: number;
  context: keyof typeof migrationContexts;
};

const connections = (
  context: FamilyLink["context"],
  weights: Record<string, number>,
): FamilyLink[] => Object.entries(weights).map(([code, weight]) => ({ code, weight, context }));

const familyLinks: Record<string, FamilyLink[]> = {
  PT: [...connections("lusophone", { BR: 10, CV: 8, AO: 7, GW: 5, MZ: 2, ST: 2 }), ...connections("crossBorder", { FR: 4, CH: 2, LU: 2, ES: 1 })],
  BR: [...connections("lusophone", { PT: 10, AO: 2, CV: 1 }), ...connections("mediterranean", { IT: 7, ES: 3, DE: 2 }), ...connections("asianDiaspora", { JP: 3, LB: 2 })],
  CV: [...connections("lusophone", { PT: 10, AO: 2, ST: 1, GW: 1, BR: 1 }), ...connections("crossBorder", { FR: 4, NL: 4, LU: 2 }), ...connections("americas", { US: 3 }), ...connections("regional", { SN: 2 })],
  AO: [...connections("lusophone", { PT: 10, BR: 4, CV: 2, ST: 1 }), ...connections("regional", { CD: 4, NA: 2 })],
  GW: [...connections("lusophone", { PT: 10, CV: 3, AO: 1 }), ...connections("regional", { SN: 4, GN: 3 })],
  MZ: [...connections("lusophone", { PT: 7, BR: 2 }), ...connections("regional", { ZA: 8, ZW: 4, MW: 2 })],
  ST: connections("lusophone", { PT: 10, AO: 5, CV: 3, BR: 1 }),
  FR: [...connections("frenchAfrica", { DZ: 10, MA: 9, TN: 5, SN: 6, ML: 5, CI: 5, CM: 3, CD: 2, CG: 2, BF: 2, GN: 2 }), ...connections("crossBorder", { PT: 7, IT: 4, BE: 2, ES: 2 }), ...connections("regional", { GP: 1, MQ: 1, RE: 1 })],
  DE: [...connections("germanRecruitment", { TR: 12, IT: 7, HR: 6, BA: 5, RS: 4, XK: 4, GR: 3 }), ...connections("crossBorder", { PL: 8, AT: 3, RO: 3 }), ...connections("commonwealth", { GH: 1 })],
  NL: [...connections("dutchDiaspora", { SR: 10, CW: 7, AW: 3, SX: 2, ID: 4 }), ...connections("regional", { MA: 9, TR: 8, BE: 4, GH: 2 })],
  SR: connections("dutchDiaspora", { NL: 10, CW: 2, GY: 2, IN: 3, ID: 3 }),
  CW: [...connections("dutchDiaspora", { NL: 10, AW: 4, SX: 2, SR: 2 }), ...connections("americas", { VE: 3, CO: 2, DO: 2 })],
  AW: [...connections("dutchDiaspora", { NL: 10, CW: 5, SR: 2 }), ...connections("americas", { VE: 5, CO: 4 })],
  SX: [...connections("dutchDiaspora", { NL: 7, CW: 4, SR: 2 }), ...connections("americas", { HT: 5, DO: 3, JM: 2 })],
  EN: [...connections("britishIrish", { IE: 10, SCO: 3, WAL: 3, NIR: 2 }), ...connections("commonwealth", { JM: 8, NG: 8, GH: 5, IN: 5, PK: 5, BD: 3, TT: 2, BB: 2, KE: 2, ZA: 2 }), ...connections("crossBorder", { PT: 3, PL: 4, FR: 2 })],
  SCO: [...connections("britishIrish", { IE: 9, EN: 8, NIR: 3, WAL: 1 }), ...connections("crossBorder", { PL: 5, IT: 2 }), ...connections("commonwealth", { PK: 3, IN: 2 })],
  WAL: [...connections("britishIrish", { EN: 9, IE: 6, SCO: 2 }), ...connections("commonwealth", { JM: 2, NG: 2, SO: 1 })],
  NIR: [...connections("britishIrish", { IE: 10, SCO: 6, EN: 5 }), ...connections("crossBorder", { PL: 2, LT: 1 })],
  IE: [...connections("britishIrish", { EN: 10, SCO: 5, NIR: 5, WAL: 1 }), ...connections("crossBorder", { PL: 5, RO: 2 }), ...connections("commonwealth", { NG: 3, US: 3, AU: 2 })],
  BE: [...connections("regional", { MA: 9, CD: 8, TR: 5 }), ...connections("crossBorder", { IT: 7, FR: 5, NL: 4, PT: 2 })],
  LU: [...connections("crossBorder", { PT: 12, FR: 9, BE: 7, DE: 7, IT: 5 }), ...connections("lusophone", { CV: 3 })],
  CH: connections("crossBorder", { IT: 10, DE: 8, FR: 7, PT: 8, AL: 6, XK: 6, RS: 5, BA: 4, ES: 3 }),
  AT: [...connections("crossBorder", { DE: 8, HR: 7, RS: 7, BA: 6, HU: 3 }), ...connections("germanRecruitment", { TR: 7 })],
  ES: [...connections("mediterranean", { MA: 9, AR: 6, CO: 6, EC: 5, UY: 3, GQ: 2 }), ...connections("crossBorder", { PT: 5, FR: 4, RO: 4 })],
  IT: [...connections("mediterranean", { AR: 8, BR: 7, AL: 7, TN: 4 }), ...connections("crossBorder", { RO: 7, FR: 4, CH: 3 }), ...connections("regional", { GH: 2, SN: 3 })],
  SE: connections("regional", { FI: 8, BA: 6, RS: 4, SO: 5, NO: 3, DK: 3, IQ: 3 }),
  NO: connections("regional", { SE: 8, DK: 5, SO: 5, PK: 5, GH: 2 }),
  DK: connections("regional", { TR: 7, DE: 6, SE: 4, SO: 4 }),
  FI: connections("regional", { SE: 9, EE: 6, RU: 6, SO: 3 }),
  PL: connections("crossBorder", { UA: 9, DE: 8, BY: 5, LT: 3 }),
  CZ: connections("regional", { SK: 10, UA: 6, VN: 5, PL: 4 }),
  SK: connections("crossBorder", { CZ: 10, HU: 6, UA: 4 }),
  HR: connections("crossBorder", { BA: 10, DE: 8, AT: 5, SI: 4 }),
  RS: connections("crossBorder", { BA: 9, ME: 7, DE: 8, AT: 6, CH: 4 }),
  BA: connections("crossBorder", { HR: 9, RS: 9, DE: 8, AT: 6, CH: 4, SE: 4 }),
  ME: connections("crossBorder", { RS: 9, BA: 5, DE: 3 }),
  AL: connections("crossBorder", { IT: 10, GR: 8, DE: 6, CH: 6 }),
  XK: connections("crossBorder", { AL: 10, DE: 9, CH: 9, AT: 5, SE: 3 }),
  GR: connections("regional", { AL: 9, CY: 8, GE: 4, DE: 6, AU: 3 }),
  CY: connections("regional", { GR: 10, EN: 6 }),
  RO: connections("crossBorder", { MD: 8, HU: 7, IT: 9, ES: 8 }),
  HU: connections("crossBorder", { RO: 9, SK: 7, RS: 5, DE: 6 }),
  AR: [...connections("mediterranean", { IT: 10, ES: 9 }), ...connections("americas", { UY: 6, PY: 7, BO: 6, CL: 3 })],
  UY: [...connections("mediterranean", { ES: 7, IT: 6 }), ...connections("americas", { AR: 10, BR: 7 })],
  CL: [...connections("americas", { PE: 8, AR: 7, BO: 4 }), ...connections("mediterranean", { ES: 6, HR: 4 })],
  CO: connections("americas", { VE: 10, EC: 7, ES: 6, US: 4 }),
  PE: [...connections("americas", { EC: 6, BO: 6, CL: 5 }), ...connections("mediterranean", { ES: 8 }), ...connections("asianDiaspora", { JP: 3 })],
  EC: connections("americas", { CO: 8, PE: 7, ES: 8, US: 4 }),
  PY: connections("americas", { AR: 10, BR: 8, ES: 5 }),
  BO: connections("americas", { AR: 9, PE: 7, CL: 6, ES: 4 }),
  VE: connections("americas", { CO: 10, ES: 7, IT: 5, PT: 5 }),
  MX: connections("americas", { US: 12, GT: 5, ES: 5, CA: 2 }),
  US: [...connections("americas", { MX: 12, CA: 5, JM: 5, HT: 4, CO: 4, SV: 4, DO: 4 }), ...connections("commonwealth", { EN: 4, NG: 4, GH: 3 }), ...connections("asianDiaspora", { PH: 6, IN: 4 }), ...connections("crossBorder", { DE: 4 })],
  CA: [...connections("commonwealth", { EN: 7, JM: 6, NG: 4 }), ...connections("americas", { HT: 6, US: 5 }), ...connections("crossBorder", { FR: 8, PT: 5, IT: 6 }), ...connections("asianDiaspora", { IN: 8, PH: 7 })],
  JM: [...connections("commonwealth", { EN: 12, CA: 8 }), ...connections("americas", { US: 9, TT: 3 })],
  TT: connections("commonwealth", { EN: 10, CA: 6, US: 5, GY: 4, IN: 3 }),
  BB: connections("commonwealth", { EN: 10, CA: 6, US: 4, TT: 3 }),
  HT: connections("americas", { US: 10, CA: 8, FR: 5, DO: 5 }),
  AU: [...connections("commonwealth", { EN: 10, IE: 6 }), ...connections("pacific", { NZ: 10, FJ: 3 }), ...connections("mediterranean", { IT: 8, GR: 7, HR: 5, RS: 4, LB: 4 })],
  NZ: [...connections("pacific", { AU: 10, WS: 8, TO: 7, FJ: 6, CK: 3, NU: 2 }), ...connections("commonwealth", { EN: 10, ZA: 4 })],
  WS: connections("pacific", { NZ: 10, AU: 6, AS: 5 }),
  TO: connections("pacific", { NZ: 10, AU: 7, US: 3 }),
  FJ: connections("pacific", { NZ: 9, AU: 9, TO: 3, WS: 3 }),
  CK: connections("pacific", { NZ: 10, AU: 6, PF: 3 }),
  NU: connections("pacific", { NZ: 10, AU: 5, TO: 3 }),
  MA: connections("frenchAfrica", { FR: 12, ES: 9, NL: 9, BE: 8, IT: 5 }),
  DZ: connections("frenchAfrica", { FR: 14, TN: 4, BE: 3, CA: 3 }),
  TN: connections("frenchAfrica", { FR: 12, IT: 8, DZ: 4, DE: 4 }),
  SN: [...connections("frenchAfrica", { FR: 10, IT: 5, ES: 4 }), ...connections("regional", { ML: 7, GM: 7, GN: 5, CV: 2 })],
  ML: [...connections("frenchAfrica", { FR: 10 }), ...connections("regional", { SN: 8, CI: 8, BF: 5, GN: 3 })],
  BF: [...connections("frenchAfrica", { FR: 5 }), ...connections("regional", { CI: 10, ML: 7, GH: 4, NE: 3 })],
  GN: [...connections("frenchAfrica", { FR: 7 }), ...connections("regional", { SN: 8, SL: 5, CI: 5, GW: 4 })],
  GM: [...connections("regional", { SN: 12, GN: 4 }), ...connections("commonwealth", { EN: 6 }), ...connections("crossBorder", { SE: 3, ES: 3 })],
  NG: [...connections("commonwealth", { EN: 12, US: 7, CA: 4 }), ...connections("regional", { GH: 8, CM: 4, BJ: 3 })],
  GH: [...connections("commonwealth", { EN: 10, US: 5 }), ...connections("regional", { NG: 8, CI: 5, TG: 4 }), ...connections("crossBorder", { DE: 6, NL: 5 })],
  CM: [...connections("frenchAfrica", { FR: 10 }), ...connections("regional", { NG: 6, CD: 4, GA: 3 })],
  CI: [...connections("frenchAfrica", { FR: 10 }), ...connections("regional", { BF: 10, ML: 8, GH: 5, GN: 4 })],
  CD: [...connections("frenchAfrica", { BE: 10, FR: 8 }), ...connections("regional", { CG: 8, AO: 6, ZM: 3 })],
  CG: [...connections("frenchAfrica", { FR: 10 }), ...connections("regional", { CD: 10, GA: 4 })],
  GA: [...connections("frenchAfrica", { FR: 9 }), ...connections("regional", { CM: 7, CG: 7, GQ: 4 })],
  ZA: [...connections("regional", { ZW: 10, MZ: 8, BW: 5, LS: 7, NA: 4 }), ...connections("commonwealth", { EN: 6 })],
  ZW: [...connections("regional", { ZA: 12, ZM: 6, MZ: 5 }), ...connections("commonwealth", { EN: 7 })],
  KE: [...connections("regional", { UG: 8, TZ: 8, SO: 4 }), ...connections("commonwealth", { EN: 7 })],
  SO: connections("regional", { DJ: 8, ET: 6, KE: 6, EN: 6, SE: 5, NO: 4 }),
  TR: connections("germanRecruitment", { DE: 12, NL: 8, AT: 7, BE: 5, BG: 6 }),
  JP: connections("asianDiaspora", { BR: 8, US: 7, PH: 5, KR: 4 }),
  KR: connections("asianDiaspora", { US: 10, JP: 6, CN: 5 }),
  CN: connections("asianDiaspora", { TW: 7, HK: 7, SG: 5, US: 5 }),
  TW: connections("asianDiaspora", { US: 8, CA: 5, CN: 4, JP: 4 }),
  HK: connections("asianDiaspora", { CN: 10, EN: 7, CA: 6 }),
  MO: connections("asianDiaspora", { CN: 10, PT: 5 }),
  PH: connections("asianDiaspora", { US: 12, JP: 6, AU: 5, CA: 6, ES: 2 }),
  ID: connections("asianDiaspora", { NL: 8, MY: 8, CN: 6 }),
  MY: connections("asianDiaspora", { ID: 8, CN: 8, IN: 6, SG: 8 }),
  SG: connections("asianDiaspora", { MY: 10, CN: 8, IN: 6, ID: 6 }),
  IN: connections("asianDiaspora", { EN: 10, CA: 8, US: 8, NP: 4, BD: 3 }),
  PK: connections("asianDiaspora", { EN: 12, CA: 7, US: 6, NO: 4, AF: 5 }),
  BD: connections("asianDiaspora", { EN: 12, IN: 7, US: 6 }),
  IL: connections("regional", { RU: 9, FR: 7, US: 7, UA: 6 }),
};

const sharedCitizenship: Record<string, string> = {
  EN: "GB", SCO: "GB", WAL: "GB", NIR: "GB", GG: "GB", JE: "GB", IM: "GB",
  GP: "FR", MQ: "FR", RE: "FR", GF: "FR", YT: "FR", NC: "FR", PF: "FR", WF: "FR", PM: "FR", BL: "FR", MF: "FR",
  CW: "NL", AW: "NL", SX: "NL", BQ: "NL",
  FO: "DK", GL: "DK", AX: "FI", CK: "NZ", NU: "NZ", TK: "NZ",
  HK: "CN", MO: "CN", PR: "US", GU: "US", MP: "US", VI: "US",
};
const citizenshipGroup = (code: string) => sharedCitizenship[code] ?? code;
const restrictedAutomaticCitizenship = new Set([
  "JP", "KR", "KP", "CN", "IN", "SG", "ID", "MY", "BN", "NP", "BT",
  "SA", "AE", "QA", "KW", "BH", "OM", "SR", "CM", "CD",
]);
const multipleNationalityCountries = new Set(
  "GB IE FR DE PT BR NL BE ES IT LU CH AT SE NO DK FI PL CZ SK HR RS BA AL XK ME GR CY RO HU AR UY CL CO PE EC PY BO VE US CA AU NZ MA DZ TN SN ML BF GN NG GH CI CG CV AO GW MZ ST ZA ZW TR PH PK BD IL MX JM HT TT BB WS TO FJ TW KE SO LB".split(" "),
);
const pakistanDualPartners = new Set(
  "GB AU BE CA DK EG FI FR DE IS IE IT JO NL NZ NO SE CH US".split(" "),
);

function permitsFictionalDualNationality(first: string, second: string): boolean {
  const firstGroup = citizenshipGroup(first);
  const secondGroup = citizenshipGroup(second);
  return firstGroup !== secondGroup &&
    !restrictedAutomaticCitizenship.has(firstGroup) &&
    !restrictedAutomaticCitizenship.has(secondGroup) &&
    multipleNationalityCountries.has(firstGroup) &&
    multipleNationalityCountries.has(secondGroup) &&
    (firstGroup !== "PK" || pakistanDualPartners.has(secondGroup)) &&
    (secondGroup !== "PK" || pakistanDualPartners.has(firstGroup));
}

const familyFrequencies: Record<string, { multiple: number; triple: number }> = {
  PT: { multiple: 0.48, triple: 0.14 },
  FR: { multiple: 0.52, triple: 0.14 },
  DE: { multiple: 0.48, triple: 0.12 },
  NL: { multiple: 0.54, triple: 0.16 },
  LU: { multiple: 0.68, triple: 0.22 },
  CH: { multiple: 0.58, triple: 0.18 },
};

function weightedConnection<Connection extends { weight: number }>(
  random: seedrandom.PRNG,
  choices: Connection[],
): Connection {
  let remaining = random() * choices.reduce((total, entry) => total + entry.weight, 0);
  for (const choice of choices) {
    remaining -= choice.weight;
    if (remaining < 0) return choice;
  }
  return choices[choices.length - 1];
}

export function playerBackground(
  random: seedrandom.PRNG,
  country: Country,
  countries: Country[],
): Partial<PlayerProfile["identity"]> {
  const byCode = new Map(countries.map((entry) => [entry.code, entry]));
  const linkedIds = new Set([country.id]);
  const linkedNames = new Set([country.name]);
  const links = (familyLinks[country.code] ?? [])
    .flatMap((link) => {
      const origin = byCode.get(link.code);
      if (!origin || linkedIds.has(origin.id) || linkedNames.has(origin.name)) return [];
      linkedIds.add(origin.id);
      linkedNames.add(origin.name);
      return [{ ...link, country: origin }];
    });
  const frequencies = familyFrequencies[country.code] ?? { multiple: 0.46, triple: 0.12 };
  const roll = random();
  const origins = [country];
  const familyContexts = new Set<string>();
  if (roll < frequencies.multiple && links.length) {
    const connection = weightedConnection(random, links);
    origins.push(connection.country);
    familyContexts.add(migrationContexts[connection.context]);
  }
  if (roll < frequencies.triple && links.length > 1) {
    const thirdChoices = links.filter(
      (entry) => !origins.some((origin) => origin.id === entry.country.id),
    );
    const connection = weightedConnection(random, thirdChoices);
    origins.push(connection.country);
    familyContexts.add(migrationContexts[connection.context]);
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
  const maternal = origins.slice(1).map((origin) => origin.name).join(" and ") || country.name;
  const paternal = country.name;
  const nationalities: NonNullable<PlayerProfile["identity"]["nationalities"]> =
    [
      {
        countryId: country.id,
        code: country.code,
        country: country.name,
        basis: "parent",
      },
    ];
  for (const origin of origins.slice(1))
    if (nationalities.every((entry) => permitsFictionalDualNationality(entry.code, origin.code)))
      nationalities.push({
        countryId: origin.id,
        code: origin.code,
        country: origin.name,
        basis: "parent",
      });
  const birthCountry = random() < 0.22 && links.length
    ? weightedConnection(random, links).country
    : country;
  const birthCities = settlementNames(birthCountry);
  const birthCity = birthCities[Math.floor(random() * birthCities.length)];
  const languages = [{ language: birthCountry.language, fluency: 5 }];
  for (const origin of origins)
    if (!languages.some((entry) => entry.language === origin.language))
      languages.push({
        language: origin.language,
        fluency: 2 + Math.floor(random() * 3),
      });
  const birthplace = `${birthCity}, ${birthCountry.name}`;
  const nameOrigin = weightedConnection(random, origins.map((origin, index) => ({
    country: origin,
    weight: percentages[index],
  }))).country;
  const familyDescription = origins.length === 1
    ? `Both sides of the fictional family have roots in ${country.name}.`
    : origins.length === 2
      ? `The maternal side has roots in ${maternal}; the paternal side has roots in ${paternal}.`
      : `The paternal side has roots in ${paternal}; the maternal grandparents have roots in ${origins[1].name} and ${origins[2].name}.`;
  const heritageOnly = origins.filter((origin) => !nationalities.some((entry) => entry.countryId === origin.id));
  return {
    heritage,
    nationalities,
    languages,
    birthCountryId: birthCountry.id,
    birthplace,
    region: birthCity,
    familyOrigins: { maternal, paternal },
    nameOriginCountryId: nameOrigin.id,
    internationalCountryId: country.id,
    biography: [
      `Fictional biography: born in ${birthplace}. International representation is recorded separately for ${country.name}.`,
      `${familyDescription}${familyContexts.size ? ` This fictional history draws on ${[...familyContexts].join("; ")}.` : ""} Heritage percentages describe family branches, not genetic ancestry.`,
      `Fictional eligibility assumption: citizenship transmitted by a citizen parent for each recorded nationality (${nationalities.map((entry) => entry.country).join(", ")}). Birthplace, heritage, shared language and club employment do not grant citizenship.${heritageOnly.length ? ` Connections to ${heritageOnly.map((origin) => origin.name).join(", ")} remain heritage only; restrictive, unmodeled or shared citizenship is not counted again.` : ""}`,
    ],
  };
}
