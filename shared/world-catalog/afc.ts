import type {
  CatalogFileData,
  CitizenshipRule,
  CitySize,
  CitySpec,
  ClubNameTemplate,
  Continent,
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

// Owner: catalog author "afc" — all 46 AFC FIFA members, 15 with leagues (validate.ts CATALOG_ASSIGNMENT).
// 2025/26 structures, money in GBP. Each AFC league is its single top tier (the directive's counts), so there is
// no movement and no B-team: second and reserve teams play below the modeled tier.
// Coefficient seeds keep the official AFC club-ranking order (2021..2025, oldest first), scaled to UEFA-like points.

/** Names are "|"-separated when any of them contains a space, otherwise whitespace-separated. */
const list = (text: string) =>
  (text.includes("|") ? text.split("|") : text.split(/\s+/))
    .map((entry) => entry.trim())
    .filter(Boolean);
const pool = (name: string, given: string, family: string): NamePool => ({
  id: `afc/${name}`,
  ...(given.trim() ? { given: list(given) } : {}),
  ...(family.trim() ? { family: list(family) } : {}),
});
const src = (name: string, weight = 1): WeightedNameSource => ({ source: `pool:afc/${name}`, weight });
const faker = (locale: FakerNameLocale, weight = 1): WeightedNameSource => ({
  source: `faker:${locale}`,
  weight,
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
/** "{city} FC:2; {city} SC:1" → weighted club-name templates (patterns never contain ":"). */
const templates = (spec: string): ClubNameTemplate[] =>
  spec
    .split(";")
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((entry) => {
      const at = entry.lastIndexOf(":");
      return { pattern: entry.slice(0, at).trim(), weight: Number(entry.slice(at + 1)) };
    });
const division = (name: string, groupSize?: number, groupNames?: string): YouthDivisionSpec => ({
  name,
  parentTiers: [1, 1],
  ...(groupSize ? { groupSize } : {}),
  ...(groupNames ? { groupNames: groupNames.split("|") } : {}),
});
const youth = (
  u19: YouthDivisionSpec,
  u17: YouthDivisionSpec,
  cups: { u19?: string; u17?: string } = {},
): YouthSpec => ({
  U19: { divisions: [u19], ...(cups.u19 ? { cup: { name: cups.u19 } } : {}) },
  U17: { divisions: [u17], ...(cups.u17 ? { cup: { name: cups.u17 } } : {}) },
});
/** One modeled tier: no movement, reserve teams below the modeled pyramid. */
const singleTier = (
  league: LeagueTierSpec,
  rest: Omit<DomesticFootballSpec, "leagues" | "movement" | "reserves">,
): DomesticFootballSpec => ({ leagues: [league], movement: [], reserves: { mode: "none" }, ...rest });
/** AFC member without an own league: home-based pool plus players at foreign clubs. */
const homeNation = (
  spec: Omit<NationSpec, "iso2" | "confederation" | "continent" | "euEea" | "football" | "hostedAbroad"> & {
    continent?: Continent;
  },
): NationSpec => ({ iso2: spec.code, confederation: "AFC", continent: "AS", euEea: false, ...spec });

// ------------------------------------------------------------------ name pools (romanized, Latin script only)

const JAPANESE = pool(
  "japanese",
  `Kaoru Takefusa Wataru Ritsu Daichi Junya Hiroki Takumi Kyogo Ayase Daizen Koki Ko Yuto Shuto Hidemasa Reo
   Kento Yuki Takehiro Maya Shogo Genki Gaku Shinji Keisuke Makoto Yasuhito Yoshinori Atsuto Yuya Sho Kosuke
   Ryota Tatsuya Kazuki Naoki Takuma Yosuke Kengo Yuma Taisei Kaito Haruto Sota Riku Yamato Ren Hinata Minato
   Asahi Kanata Soma Hayato Keita Kenta Shota Daiki Tsubasa Takashi Tomoya Masaya Kohei Hiroto Yusuke Ryo Jun
   Kei Tomoki Kosei Yudai Shunsuke Hotaka Ryosuke Yuta Kazuya Toshiya Takuya Masato Keiya Seiya Mao Ibuki Shu
   Kotaro Shintaro Rikuto Haruki Yuji Akira Satoshi Hideki Kazuma Taichi Ryunosuke Kaishu Kyosuke Towa Kota
   Daigo Shion Rui Yota Takeshi Tetsuya Hikaru Naomichi Yoshiaki Koji Taiga Ryuji Shunki Sosuke Itsuki Yugo
   Hiroshi Masaki Toru Kenji Takahiro Tomohiro Takeru Kakeru Hibiki Arata Shunya`,
  `Sato Suzuki Takahashi Tanaka Watanabe Ito Yamamoto Nakamura Kobayashi Kato Yoshida Yamada Sasaki Yamaguchi
   Matsumoto Inoue Kimura Hayashi Shimizu Yamazaki Mori Abe Ikeda Hashimoto Yamashita Ishikawa Nakajima Maeda
   Fujita Ogawa Goto Okada Hasegawa Murakami Kondo Ishii Saito Sakamoto Endo Aoki Fujii Nishimura Fukuda Ota
   Miura Fujiwara Okamoto Matsuda Nakagawa Nakano Harada Ono Tamura Takeuchi Kaneko Wada Nakayama Ishida Ueda
   Morita Hara Shibata Sakai Kudo Yokoyama Miyazaki Miyamoto Uchida Takagi Ando Taniguchi Ohno Maruyama Imai
   Takada Fujimoto Takeda Murata Ueno Sugiyama Masuda Sugawara Hirano Otsuka Chiba Kubo Matsui Iwasaki
   Sakurai Kinoshita Noguchi Matsuo Kikuchi Nomura Arai Sano Oishi Mitoma Minamino Doan Kamada Itakura
   Tomiyasu Nagatomo Honda Kagawa Okazaki Hasebe Nakata Kawashima Gonda Osako Haraguchi Machino Asano Hatate
   Furuhashi Ideguchi Kitagawa Hashioka Takai Mochizuki Sekine Hosoya Miyoshi Hayakawa Kawabe Tanabe
   Nishikawa Shiogai Ogihara Yamane Ohashi Kawamura Tsuchiya Miyashita Nagai Shimada Hirose Okubo Nishida
   Kurata`,
);
const KOREAN_TOP = pool("korean-top", "", "Kim Lee Park");
const KOREAN_COMMON = pool(
  "korean-common",
  "",
  "Choi Jung Kang Cho Yoon Jang Lim Han Oh Seo Shin Kwon Hwang Ahn Song Jeon Hong",
);
const KOREAN = pool(
  "korean",
  `Heung-min Min-jae Kang-in Hee-chan Jae-sung Woo-yeong In-beom Seung-ho Gue-sung Hyeon-gyu Young-gwon Jin-su
   Seung-gyu Hyun-woo Tae-hwan Ji-sung Chu-young Chung-yong Sung-yueng Bo-kyung Dong-gook Jung-woo Jae-won
   Min-kyu Jun-ho Seung-woo Yong-woo Tae-hyeon Hyun-jun Jun-hong Ji-soo Sang-ho Moon-hwan Joo-sung Chang-hoon
   Keon-hee Jin-gyu Seung-won Young-woo Dong-jin Hyun-seok Seol-young Sang-bin Min-woo Jae-ik Chan-hee
   Young-jae Kyung-won Tae-uk Do-hyun Ji-hun Si-woo Ho-jun Jae-hyun Hyun-jin Sung-jin Jae-min Dong-hyun
   Jun-young Seung-min Ji-hwan Jun-seo Woo-jin Sung-hoon Seok-hyun Kyu-hyun Jong-min Ki-hyuk Gyu-min
   Jung-hoon Tae-yang Hae-sung Byung-jun Chan-woo Sung-min Yoon-ho Jae-hoon Myung-jae Hyeong-jin Dae-won
   In-soo Kyung-rok Il-lok Won-sang Jae-suk Ho-young Sang-woo Dong-won`,
  `Yoo Ko Moon Yang Son Bae Baek Heo Nam Shim Noh Ha Kwak Sung Cha Joo Woo Koo Min Ryu Na Jin Ji Eom Byun Chae
   Won Cheon Bang Kong Hyun Ham Yeo Choo Do So Seok Seon Sul Ma Gil Yeon Wi Pyo Myung Ki Ban Ra Wang Geum Ok
   Yook In Maeng Je Mo Tak Guk Yeom Bong Kyung Sa Bu Hwangbo Namgung Jegal Seonwoo Dokgo Tae Pi Gong Eun Yong
   Gam Il Dong Seol Beom Jeong Yun Rhee Gu Jo Yu Gwak`,
);
// DPRK romanization (Ri, Pak, Choe, Jong...).
const KOREAN_DPRK = pool(
  "korean-dprk",
  `Il-gwan Kwang-song Kwang-ryong Myong-guk Kuk-chol Yu-song Hyok-chol Ju-song Chol-hyok Kum-il Jin-hyok
   Song-hyok Kwang-hyok Un-chol Nam-chol Yong-jik Tae-se Yong-hak Chol-jin Kyong-il Hyon-jin Il-bong Jong-hyok
   Song-chol Chung-song Kuk-jin Myong-il Pom-hyok Yong-il Kwang-min Chol-min Won-jin Hyon-il Son-hyok Ryong-jo
   Kang-guk`,
  `Kim Ri Pak Choe Jong Kang Jang Han Yun Rim O Sin Hwang An Song Jon Hong Ryu Mun Ro Ju Kye Pyon Jo Cha Ryang
   Sim Son Ho Pae Paek Chon Kwon Kil Yang Chae Ok Kwak Um Sok Myong Ha`,
);
const CHINESE_TOP = pool("chinese-top", "", "Wang Li Zhang Liu Chen");
const CHINESE_COMMON = pool(
  "chinese-common",
  "",
  `Yang Zhao Huang Zhou Wu Xu Sun Hu Zhu Gao Lin He Guo Ma Luo Liang Song Zheng Xie Han Tang Feng Yu Dong Xiao
   Cheng Cao Yuan Deng Fu Shen Zeng Peng Su Lu Jiang Cai Jia Ding Wei`,
);
const CHINESE = pool(
  "chinese",
  `Lei Xi Wei Hao Jun Tao Peng Bin Chao Xin Yang Long Jie Liang Ming Qiang Hui Kai Rui Bo Fan Zhiyuan Haoran
   Yuhang Zihao Junjie Yifan Jiahao Tianyi Shuai Haijian Wenjun Xizhe Yuning Chenjie Pengfei Xuepeng Dalei
   Junling Linpeng Shihao Guangtai Shenglong Shangyuan Shaocong Dinghao Binbin Dianzuo Zhengyu Yongyong Yudong
   Jiaqi Weijun Zhenao Mingyang Shengjie Haofeng Jingxiang Chenglin Hanwen Zeyu Yiming Tengfei Wenzheng Yuxuan
   Zixuan Junhao Zhixuan Ruiqi Hongbo Xiaolong Zhen Gang Yong Jian Feng Qi Hang Zhe Haoyu Zhiwei Yanbo Kun
   Tian Bowen Kaiwen Siyuan Yijie Jiajun Zhuoyi Hongliang Wenhao Jinhao Chengdong Hongjie Yutao Weihao
   Liangming Xiaotian Ziming Yuchen Shenchao Jiaxuan`,
  `Xue Ye Yan Pan Du Dai Xia Zhong Tian Ren Fan Fang Shi Yao Tan Liao Zou Xiong Jin Hao Kong Bai Cui Kang Mao
   Qiu Qin Gu Hou Shao Meng Long Wan Duan Lei Qian Yin Yi Chang Qiao Lai Gong Wen Ai Nie Mu Xing Pei Jiao Ge
   Hua Kuang Tong Rao Ou Mi Chu Zhuang Yue`,
);
// Wade–Giles style used in Chinese Taipei.
const TAIWANESE = pool(
  "taiwanese",
  `Chih-hao Wei-lun Chun-yu Po-han Tzu-hsuan Chia-hao Po-liang Yen-shu Hao-wei Chien-ming Kuan-yu Chun-chieh
   Tsung-han Yu-cheng Chih-wei Chen-yu Wen-chieh Chia-wei Tzu-yang Yu-hsiang Shih-chieh Kai-wen Jen-hao
   Cheng-en Chun-hung Hsin-yu Yao-tsung Tsung-yu Ming-che Kuo-hua Chih-chieh Wei-chen Yung-chen Po-yu
   Chih-yuan Yi-hsiang`,
  `Chen Lin Huang Chang Li Wang Wu Liu Tsai Yang Hsu Cheng Hsieh Hung Kuo Chiu Tseng Liao Lai Chou Yeh Su
   Chuang Lu Chiang Ho Lo Kao Hsiao Pan Chien Tu Chung Fang Peng Tai Wei Fan Hou Shih Yu Chan Kang Yen Kuan
   Tsao Chu Tien Sung Tang`,
);
// Hong Kong and Macau (Cantonese romanization).
const CANTONESE = pool(
  "cantonese",
  `Chun Lok|Ka Ho|Chun Hei|Wai Kit|Ho Yin|Tsz Chun|Ka Wai|Man Kit|Kin Wai|Siu Kwan|Ming Him|Kwok Wai|Ho Lam|
   Ka Chun|Wing Kit|Tsz Ho|Chi Hang|Ka Hang|Chon Kit|Pak Hei|Hiu Fung|Yiu Wai|Kam Fai|Chun Wai|Wai Lun|
   Sze Chit|Lok Yin|Hoi Man|Kwan Ho|Yat Long|Ho Nam|Shing Chi|King Fung|Tin Yau|Chung Yin|Tsz Kin|Wing Yan|
   Cheuk Hin|Chi Fung|Ka Lok`,
  `Chan Wong Leung Cheung Lau Lee Ng Cheng Lam Yeung Ho Tsang Chow Tang Lai Kwok Mak Yip Tse Fung Poon Chu Lo
   Yuen Kwan Siu Tam So Choi Au Chung Luk Man Sun Tong Hui Ko Kong Ma Yu Law Tsui Wu Pang Leong Sio Iao Lei`,
);
const PERSIAN = pool(
  "persian",
  `Ali Mehdi Reza Mohammad Hossein Saeid Sardar Alireza Sadegh Ehsan Omid Milad Morteza Ramin Majid Karim
   Masoud Vahid Hamid Ahmad Amir Arash Babak Behnam Farshid Hadi Javad Kaveh Mehran Mohsen Payam Pejman
   Rouzbeh Saman Shahab Siavash Soroush Yasin Allahyar Aria Mahdi Jalal Shoja Hojjat Kamal Mehrdad Masih
   Mohammadreza Amirhossein Mohammadhossein Abolfazl Aref Hamed Iman Nima Pouria Sajjad Shahriar Taha Yousef
   Danial Rasoul Mojtaba Mostafa Hassan Naser Akbar Farhad Ghasem Hamidreza Jafar Kiarash Mehrshad
   Mohammadmehdi Parsa Peyman Rahman Rouhollah Salar Sasan Sina Sobhan Younes Shahin Bijan Dariush Ebrahim
   Esmaeil Heydar Ilia Kian Matin Navid Pedram Ramtin Saber Yaghoub Amin Arman Hesam Keyvan`,
  `Rezaei Ahmadi Mohammadi Hosseini Karimi Moradi Hashemi Rahimi Jafari Ghasemi Kazemi Sadeghi Mousavi Taremi
   Azmoun Jahanbakhsh Beiranvand Ezatolahi Pouraliganji Hajsafi Gholizadeh Mohebi Noorollahi Ghoddos Kanaani
   Cheshmi Shojaei Ansarifard Dejagah Moharrami Rezaeian Khalilzadeh Mahini Amiri Torabi Sayyadmanesh Ghafouri
   Asadi Shekari Esmaeili Mehdikhani Norouzi Habibi Bagheri Soltani Heidari Nazari Asgari Akbari Shahbazi
   Khodadadi Zarei Salehi Najafi Jalali Yazdani Tehrani Shirazi Kermani Mirzaei Safari Ebrahimi Abbasi
   Alizadeh Taghavi Farahani Ghorbani Faraji Hamidi Rahmani Nikpour Shokri Bahrami Daei Mahdavi Daryani
   Firouzi Motahari Lotfi Pakdel Rostami Samadi Shariati Vahdat Yousefi Zandi Ansari Babaei Chegini Darabi
   Esfandiari Fazeli Gorji Haghighi Jamshidi Kamali Lashgari Maleki Nasiri Omidi Parvizi Rajabi Sharifi
   Tavakoli Valizadeh Zamani Hosseinzadeh Aghaei Nejati Moghaddam Karbalaei Mazandarani Rashidi Sepehri
   Hatami Mokhtari Nemati Pourmohammadi Sadri Ranjbar Beigi Kiani Golzari Hosseinpour Amini Abedini
   Shahsavari Bahmani Nabavi Kordi Azizi Hashemzadeh Talebzadeh Asgarzadeh`,
);
const AFGHAN = pool(
  "afghan",
  `Farid Jamshed Fardin Omid Behrouz Nader Sohrab Jawad Gul Sher Naseem Rahmat Naveed Zahir Hamid Shah Faysal
   Farshad Zubayr Sharif Amredin Noor Balal Norlla Mustafa Obaidullah Masih Ahmad Zelfy Haroon Wahid
   Ahmadullah Rafiullah Samiullah Shafiqullah Hashmatullah Rashid Khalid Qais Idris Tamim Wali Yama Omran`,
  `Rahimi Ahmadi Azizi Haidari Naderi Karimi Habibi Sultani Shinwari Zadran Wardak Momand Popalzai Durrani
   Barakzai Noorzai Amiri Nazari Hashimi Sharifi Hotak Stanikzai Safi Mangal Achakzai Alokozai Kakar Niazi
   Samadi Jalali Faizi Qaderi Rahmani Nawabi Sadat Hakimi Najem Shayesteh Popalzay Arezou Noori Akbari
   Mohammadi Siddiqi Yousufzai Wahidi Ghafoori Nazary Mukhammad`,
);
const TAJIK = pool(
  "tajik",
  `Rustam Farhod Daler Behruz Iskandar Firdavs Said Mehrubon Umed Jamshed Manuchehr Parvizdzhon Alisher
   Shahrom Ehson Amirbek Rahmatsho Zoir Nuriddin Sheriddin Komron Sodiq Vahdat Shervoni Alijon Muhammadjon
   Dilshod Akhtam Hasan Khurshed Siyovush Davron Nozim Amadoni`,
  `Rahmonov Karimov Saidov Nazarov Sharipov Rasulov Ismoilov Yusupov Davlatov Juraev Kamolov Dzhalilov
   Umarbaev Soirov Panjshanbe Nabiev Safarov Mirzoev Aliev Khoshimov Barotov Ergashev Tursunov Sultonov
   Boboev Ashurmamadov Hanonov Sodikov Mahmudov Sharifov Ganiev Rakhimov Zokirov Aminov Mirsaidov Olimov
   Qurbonov Negmatov Kholov Davronov Mamadjonov Shodiev Zarifov Qodirov`,
);
const TURKMEN = pool(
  "turkmen",
  `Serdar Merdan Myrat Azat Didar Arslan Atamyrat Dovlet Batyr Ruslan Ahmet Guvanch Mekan Wahyt Resul
   Shamyrat Elman Abdy Begench Maksat Yhlas Dayanch Nazar Arzuvgeldi Shirmammet Rovshen Kakajan Ovez Toyly
   Gurban Hojamuhammet Mammet Bayram Parahat Selim`,
  `Gurbanov Orazov Atayev Berdiyew Geldiyew Saparov Amanov Annayev Myradow Nazarov Hojayev Karayev Ovezov
   Durdyyev Charyyev Babayev Rejepov Hudayberdiyev Mammedov Annagulyyev Orazgeldiyev Kulyyev Hojamuradov
   Muhammedov Yusupov Gochmyradov Garayev Bayramov Allaberdiyev Esenov Ataniyazov Jumayev Seyitmyradov
   Hudaygulyyev Nurmyradov Ashyrov Rozyyev Bekmyradov Toylyyev Hallyyev Pirmyradov`,
);
const KYRGYZ = pool(
  "kyrgyz",
  `Azamat Nurlan Bekzat Erkin Adilet Mirlan Ulan Bakyt Temirlan Kubat Aibek Almaz Arslan Bektur Ernist
   Gulzhigit Kairat Kanat Maksat Nursultan Omurbek Ruslan Sanjar Talant Tilek Valery Vitaly Edgar Farhat
   Bakhtiyar Eldiyar Beknaz Tursunali Odiljon Magamed Aziz`,
  `Asanov|Osmonov|Abdykadyrov|Isakov|Sadykov|Bekmuratov|Abdullaev|Turgunbaev|Akmatov|Sultanov|Kichin|
   Musabekov|Alykulov|Duyshobekov|Kozubaev|Baymatov|Israilov|Uzakov|Mamatov|Batyrkanov|Almazbekov|
   Zarypbekov|Rustamov|Abdurakhmanov|Uzdenov|Bernhardt|Merk|Brauzman|Kasymov|Shamshiev|Zhumabaev|Mambetov|
   Toktogulov|Tashiev|Beishenaliev|Chynybekov|Kurmanbekov|Sydykov|Ismailov|Zhyrgalbek uulu|Talaibek uulu|
   Almazbek uulu|Kanybek uulu`,
);
// Modern spellings of Uzbek footballers, alongside faker uz_UZ_latin.
const UZBEK = pool(
  "uzbek",
  `Eldor Abbosbek Jaloliddin Otabek Oston Jamshid Khojimat Azizbek Husniddin Abdukodir Dostonbek Sherzod
   Khojiakbar Rustam Odil Server Ikromjon Igor Utkir Farrukh Ulugbek Bobur Sardor Jasur Nodirbek Shakhzod
   Akmal Asilbek Diyor Ibrokhimkhalil Behruz Umid Alibek Mukhammadali Islom Temur Oybek Sanjar Vladimir Egor`,
  `Shomurodov Fayzullaev Khusanov Masharipov Shukurov Urunov Iskanderov Sergeev Yusupov Ahmedov Alijonov
   Nasrullaev Ashurmatov Khamrobekov Tursunov Abdikholikov Ergashev Sayfiev Hamdamov Nematov Erkinov
   Rakhmonaliev Norchaev Mozgovoy Djeparov Denisov Haydarov Ganiev Bikmaev Kapadze Karimov Rakhimov Sidikov
   Tukhtasinov Aliqulov Yuldoshev Esanov Abduraimov Makhmudov Mirzaev Jiyanov Krimets Filiposyan`,
);
const GULF = pool(
  "gulf",
  `Mohammed Abdullah Abdulrahman Abdulaziz Ali Ahmed Salem Saleh Khalid Faisal Fahad Nawaf Nasser Saud Sultan
   Hamad Hamdan Rashid Majid Mansour Yousef Omar Hassan Hussain Ibrahim Ismail Jassim Khalifa Mubarak Obaid
   Saeed Talal Turki Waleed Yasser Ayman Bader Bandar Firas Ghanem Hamza Hattan Haitham Jaber Mishal Meshari
   Mutlaq Naif Rakan Riyadh Sami Sattam Thamer Ziyad Zayed Abdulmajeed Abdulelah Abdulkareem Abdullatif
   Abdulwahab Muhannad Musab Muath Osama Rayan Salman Saqr Tariq Yazeed Humaid Harib Khamis Juma Mahmoud
   Mustafa Anas Akram Assim Marwan Saif Nayef Hazza Jamal Adel Fawaz Hamoud Abdulhadi Eid Muteb Almoez`,
  "",
);
// Family names found across the Gulf states.
const KHALEEJI = pool(
  "khaleeji",
  "",
  `Al-Hammadi Al-Mansoori Al-Kaabi Al-Marri Al-Hajri Al-Dosari Al-Naimi Al-Ali Al-Hashmi Al-Balushi Al-Ajmi
   Al-Mutawa Al-Shamsi Al-Nuaimi Al-Khaldi Al-Mahmoud Al-Ansari Al-Hosani Al-Saadi Al-Jabri Al-Amiri
   Al-Rumaithi Al-Zaabi Al-Sulaiti Al-Kuwari Al-Obaidly Al-Haddad Al-Awadhi Al-Khayat Al-Fardan Al-Ghanim
   Al-Kandari Al-Enezi Al-Fadhli Al-Hamad Al-Rashed Al-Muhairi Al-Mulla Al-Sayed Al-Harbi Al-Mehairi
   Al-Marzouqi Al-Qubaisi Al-Ketbi Al-Dhaheri`,
);
const SAUDI = pool(
  "saudi",
  "",
  `Al-Dawsari Al-Shahrani Al-Qahtani Al-Otaibi Al-Ghamdi Al-Zahrani Al-Harbi Al-Mutairi Al-Anazi Al-Shammari
   Al-Subaie Al-Malki Al-Amri Al-Asmari Al-Shehri Al-Juhani Al-Omari Al-Faraj Al-Bulaihi Al-Tambakti Al-Owais
   Al-Yami Al-Ghannam Kanno Al-Buraikan Al-Hamdan Al-Najei Bahebri Al-Abed Al-Muwallad Hawsawi Al-Khaibari
   Al-Aqidi Al-Rubaie Al-Obaid Madu Asiri Al-Shamrani Al-Sahafi Abdulhamid Al-Ghareeb Al-Shalhoub Al-Jassim
   Al-Mogahwi Al-Breik Al-Harthi Al-Sulaiheem Fallatah Hazazi Barnawi Al-Muaiouf Al-Bishi Al-Rashidi
   Al-Hazmi Al-Majrashi Al-Khathran Al-Mehyani Sharahili Al-Ruwaili Al-Balawi Al-Qarni Al-Tuwaijri Al-Sulami
   Al-Jahdali Al-Sharif Al-Hajji Al-Nemer Al-Oufi Al-Khulaif Al-Muqren Al-Saqri Al-Dhuwayhi`,
);
const QATARI = pool(
  "qatari",
  "",
  `Al-Haydos Al-Rawi Al-Sulaiti Al-Kuwari Al-Marri Al-Hajri Al-Naimi Al-Mohannadi Al-Yazidi Al-Khater
   Al-Mannai Al-Emadi Al-Ahrak Hatem Madibo Afif Boudiaf Khoukhi Muntari Salman Barsham Al-Brake Al-Kaabi
   Al-Obaidly Al-Harami Al-Mahmoud Al-Ansari Al-Ghanim Al-Misnad Al-Attiyah Al-Kubaisi Al-Khulaifi Al-Sada
   Al-Mawlawi Al-Jaber Al-Buainain Al-Shahwani Al-Hitmi Al-Suwaidi Al-Abdulla Abdurisag Gaber Al-Amin
   Al-Shamari Al-Mesaifri Al-Dosari Al-Oun Al-Malki Al-Sharshani Al-Jaidah Al-Fayyad Al-Kathiri Al-Houti
   Al-Qahtani Al-Mulla Fadlalla Waad Mendes Moktar Al-Aaeldin Al-Hashmi Al-Rumaihi`,
);
const EMIRATI = pool(
  "emirati",
  "",
  `Al-Mansoori Al-Hammadi Al-Shamsi Al-Kaabi Al-Nuaimi Al-Dhaheri Al-Ameri Al-Ketbi Al-Mazrouei Al-Suwaidi
   Al-Falasi Al-Mehairi Al-Blooshi Al-Qubaisi Al-Mheiri Al-Zaabi Al-Hosani Al-Naqbi Al-Shehhi Al-Tunaiji
   Al-Hashmi Al-Marzouqi Al-Muhairi Al-Rumaithi Al-Ali Al-Yahyaee Al-Junaibi Mabkhout Abdulrahman Al-Ahbabi
   Al-Menhali Al-Kathiri Al-Hajeri Al-Jneibi Al-Khouri Al-Shaiba Al-Jasmi Al-Ghafli Al-Awani Al-Baloushi
   Al-Raisi Al-Saadi Al-Hajri Al-Tamimi Al-Mehrezi Al-Darmaki Al-Hammoudi Al-Rashdi Al-Zeyoudi Al-Attas
   Al-Shehi Al-Qassab Al-Amri Al-Hammami Canedo Lima Tagliabue Pimenta Esmaeel Juma`,
);
const KUWAITI = pool(
  "kuwaiti",
  "",
  `Al-Enezi Al-Mutairi Al-Ajmi Al-Rashidi Al-Harbi Al-Dhafiri Al-Shemmari Al-Kandari Al-Hajeri Al-Fadhli
   Al-Azmi Al-Hamad Al-Khaldi Al-Otaibi Al-Buloushi Al-Eidan Al-Qallaf Behbehani Dashti Ashkanani Al-Najjar
   Al-Mesaileem Al-Dawood Al-Ghareeb Al-Awadhi Marafie Al-Bahar Al-Saqer Al-Roumi Al-Mutawa Hayat Al-Rushaidan
   Al-Duwaisan Al-Sharhan Al-Mubaraki Al-Salem Al-Hadad Al-Fahad Al-Shammari Al-Musallam Al-Tayyar Al-Kharafi
   Al-Mekaimi Al-Hashash Al-Dhefeeri`,
);
const BAHRAINI = pool(
  "bahraini",
  "",
  `Al-Romaihi Al-Hardan Madan Al-Shamsan Al-Asfoor Marhoon Al-Aradi Haram Al-Malki Makki Al-Dosari
   Al-Buainain Al-Mahmeed Abduljabbar Al-Khatib Al-Hayki Ghuloom Jaafar Al-Aswad Al-Ansari Kameel Al-Zayani
   Al-Sayed Hubail Sanad Al-Musawi Al-Jamri Al-Mudaifa Salmeen Al-Hashimi Baqer Bushaqar Al-Qaseer Mirza
   Al-Khayyat Al-Humaidan Yousef Isa Faisal Al-Hawaj Al-Shaikh Abdulwahab`,
);
const OMANI = pool(
  "omani",
  "",
  `Al-Hosni Al-Siyabi Al-Mukhaini Al-Harthi Al-Ghassani Al-Rawahi Al-Saadi Al-Habsi Al-Muqbali Al-Shukaili
   Al-Balushi Al-Maqbali Al-Hajri Al-Yahyaei Al-Aghbari Al-Khaldi Al-Jabri Al-Mahrazi Al-Farsi Al-Kalbani
   Al-Mandhar Al-Ajmi Al-Qasmi Al-Rushaidi Al-Hinai Al-Busaidi Al-Wahaibi Al-Kharusi Al-Riyami Al-Amri
   Al-Mamari Al-Ghailani Al-Maskari Al-Sinani Al-Naabi Al-Obaidani Al-Shidhani Al-Mashaikhi Al-Abri
   Al-Nabhani Al-Zadjali Al-Lawati Al-Mawali Al-Salmi Al-Alawi`,
);
const YEMENI = pool(
  "yemeni",
  "",
  `Al-Sarori Al-Dahi Al-Wasabi Al-Khatri Mudhish Al-Sunaini Al-Maqtari Al-Dhubhani Al-Aghbari Al-Mahdi
   Ba-Wazir Ba-Salama Al-Haddad Al-Hadrami Al-Eryani Al-Zubairi Al-Qadhi Shamsan Mokbel Al-Sakkaf Al-Attas
   Al-Kaf Bamatraf Barakat Al-Shaibani Al-Yafei Al-Mansoob Al-Sharabi Al-Hamdani Al-Akwaa Al-Ansi Al-Nahari
   Al-Selwi Al-Himyari Al-Kathiri Al-Junaid Al-Hubaishi Al-Sabri Al-Absi Al-Adeni Al-Ghurabi Bawazeer
   Al-Mikhlafi Al-Omari`,
);
const IRAQI = pool(
  "iraqi",
  `Mohanad Aymen Ali Hussein Ahmed Amjad Bashar Humam Safaa Jalal Zidane Ibrahim Alaa Karrar Mustafa Abbas
   Haider Hassan Yasser Saad Younis Nashat Hammadi Muntadher Montader Amir Osama Frans Justin Merchas Aimar
   Zaid Saif Ammar Mohammed Hamid Kadhim Ayad Rasan Waleed Wisam Qusay Samer Salam Ziad Jassim Emad Firas
   Ridha Sajjad Hayder Abdulqadir Abdulkarim Youssef Hussam Luay Raad Nabil Amin Ahmad Akam Sherif Ameer
   Hasan Muhannad Fahad`,
  `Al-Hamadi Al-Ammari Hussein Jassim Kadhim Kareem Abdul-Amir Al-Obaidi Al-Dulaimi Al-Jubouri Al-Tamimi
   Al-Shammari Al-Saadi Al-Rubaie Al-Zubaidi Al-Ani Al-Hashimi Al-Mousawi Al-Husseini Al-Hakim Al-Maliki
   Al-Samarrai Al-Basri Al-Mosuli Al-Najafi Al-Karbalai Al-Khafaji Al-Fatlawi Al-Lami Al-Asadi Al-Mayahi
   Al-Saedi Al-Badri Faez Khalaf Mahmoud Rasan Sulaka Putros Meram Iqbal Natiq Shaker Tariq Adnan Rashid
   Mohsen Jabbar Hameed Abdulridha Ghazi Sabah Mizher Fadhil Hadi Radhi Mahdi Salih Nasser Farhan Juma
   Kamil Majeed Abdulzahra Hassoun Attiya Obeid Zamel Aziz Hamoudi Sabri Jaafar Latif Talib Nouri Zaidan
   Shalal Hilal Mansour Maan Muhsin Rahim Qasim Aboud Allawi Hanoon Farhoud Jawad Salman Sharif Swadi Yaseen
   Al-Kaabi Al-Ogaili Al-Garawi`,
);
const KURDISH = pool(
  "kurdish",
  `Rebin Dilshad Bawar Goran Karzan Hawre Shwan Sherko Hemin Rawand Zana Hunar Ari Azad Aram Soran Ranj Hardi
   Sarkawt Bakhtiyar Kamaran Serwan Dler Hozan Lawand Peshraw Rezhwan Shaho Barzan Alan`,
  `Doski Zebari Hawrami Barwari Mizuri Jaf Herki Surchi Khoshnaw Pishdari Balisani Sindi Goyi Amedi Zakhoyi
   Kirkuki Shingali Garmiyani Kakayi Mamand Nerway Bradosti Rekani Shirwani Sharafkandi Qaradaghi Hamawandi
   Sherwani Dizayee Baban`,
);
const LEVANT = pool(
  "levant",
  `Mohammad Ahmad Omar Yazan Mahmoud Mousa Hamza Ali Hassan Khaled Saleh Anas Baha Odai Ihsan Nizar Rajaei
   Yousef Ibrahim Feras Samer Nour Fadi Rami Tarek Wassim Ziad Karim Hadi Hussein Bassel Fayez Jihad Majed
   Nader Walid Yehia Abdallah Munther Shadi Mohannad Zaid Laith Rateb Alaa Saeed Amer Jamal Maher Ammar
   Moayad Musab Tamer Wael Ayman Sameh Hazem Suhaib Oday Aias Mouhammad Bilal Qusai`,
  "",
);
// Christian given names of Lebanon; the family names cover all communities.
const LEBANESE = pool(
  "lebanese",
  `Georges Elias Charbel Michel Antoine Robert Maroun Nicolas Pierre Joseph Tony Rabih Joan Felix Alexander
   Soony Hilal Roy Karl Ralph Rony Walid`,
  `Haidar|Matar|Melki|El-Helwe|Saad|Atwi|Maatouk|Haddad|Khoury|Nasser|Hamdan|Kassem|Chaaban|Hammoud|Zein|
   Oumari|Ghandour|Aoun|Saab|Tannous|Karam|Hayek|Frem|Rizk|Nakhle|Abi Nader|Abou Chacra|Bazzi|Sleiman|
   Charafeddine|Jaber|Moussa|Hijazi|Kanaan|Chahine|Daher|Jradi|Kharma|Awada|Faour|Dakik|Mehanna|Bitar|
   Dagher|Salameh|Kdouh`,
);
const JORDANIAN = pool(
  "jordanian",
  "",
  `Al-Taamari|Al-Naimat|Olwan|Al-Mardi|Al-Rashdan|Abu Hashish|Al-Arab|Haddad|Abu Laila|Al-Dmeiri|
   Bani Attiah|Nasib|Al-Rawabdeh|Al-Ajalin|Al-Zu'bi|Bani Yaseen|Al-Shboul|Al-Bashtawi|Obeidat|Al-Momani|
   Khasawneh|Smadi|Al-Hourani|Al-Majali|Al-Tarawneh|Al-Faiz|Al-Adwan|Al-Hiyari|Bataineh|Al-Khatib|
   Abu Zema|Abu Amara|Deeb|Shelbaieh|Al-Saify|Al-Sheikh|Dardour|Al-Qaisi|Mansour|Al-Rawashdeh|Abu Taha|
   Al-Ajarmeh|Samir|Al-Masri`,
);
const SYRIAN = pool(
  "syrian",
  "",
  `Al-Somah Kharbin Al-Mawas Midani Mardikian Jenyat Al-Masri Al-Halabi Al-Shami Al-Hamwi Al-Homsi Hallak
   Kabbani Qassab Othman Darwish Al-Salem Kharboutli Sabbag Hesar Ousou Ramadan Aosman Al-Aswad Al-Dali
   Al-Hussein Daaboul Al-Kurdi Al-Najjar Jabban Al-Khoury Al-Ahmad Barakat Hammoud Sultan Al-Rifai Idlibi
   Deiri Al-Jasim Hamdan Ismail Al-Agha Shikh Dib Mir Kaddour Al-Hamoud`,
);
const PALESTINIAN = pool(
  "palestinian",
  "",
  `Dabbagh|Abu Ali|Jaber|Barakat|Kharoub|Qunbar|Saadeh|Al-Jundi|Shaheen|Abu Warda|Ashour|Hamdan|Nasser|Awad|
   Barghouti|Abu Shanab|Zaqout|Tamburrini|Cantillana|Jadue|Islame|Kassis|Abu Farha|Mesleh|Zughayer|
   Al-Batsh|Hamed|Khatib|Qawasmeh|Tamimi|Jabari|Natsheh|Sharabati|Aweidah|Najjar|Masri|Abu Hilal|Nofal|
   Suleiman|Abu Libdeh|Salah|Shehadeh|Abu Nahiyeh|Kharouf`,
);
const INDONESIAN = pool(
  "indonesian",
  `Muhammad Rizky Dimas Egy Andik Bayu Arhan Fajar Hendra Witan Marselino Asnawi Ernando Pratama Evan Yakob
   Ricky Saddil Hokky Yance Beckham Fachruddin Irfan Stefano Boaz Titus Ilham Febri Zulfiandi Rachmat Bambang
   Kurniawan Ponaryo Firman Budi Hansamu Gavin Adam Alfeandra Arkhan Dony Terens Ramadhan Kadek Wahyu Yabes
   Syahrian Andre Rifad Aji Septian Rian Rizal Rendy Ikhsan Kevin Nadeo Bagas Bagus Rafli Ridho Dendy
   Ferdinand Sandi Ahmad Agung Arif Aditya Rafi Haikal Dewangga Komang Made Wayan Ketut Putu Nyoman Yanto
   Eko Joko Slamet Heru Teguh Rudi Hari Imam Riko Dedi Zaenal Otavio`,
  `Pratama Saputra Ramadhan Hidayat Nugroho Setiawan Kurniawan Wibowo Firmansyah Maulana Syahputra
   Simanjuntak Nainggolan Sitorus Siregar Hutapea Pardede Situmorang Sayuri Kambuaya Wanggai Kareth Rumbewas
   Mote Sulaeman Ferdinan Mangkualam Febrianto Aryanto Drajad Caraka Putra Bachdim Lilipaly Klok Pattynama
   Ramdani Nurdin Hakim Arifin Gunawan Santoso Susanto Prasetyo Wijaya Hermawan Rahman Hasibuan Lubis
   Nasution Harahap Tampubolon Manurung Sinaga Sihombing Pasaribu Panjaitan Simatupang Tanjung Batubara
   Daulay Rangkuti Pohan Siagian Silalahi Pangaribuan Marpaung Hutagalung Tambunan Purba Sembiring Ginting
   Tarigan Sitepu Bonai Kogoya Wenda Yoku Rumkorem Pahabol Solossa Waromi Mandowen Wopari Kaisiepo
   Pattiasina Leatemia Tuanakotta Wattimena Pattinama Hitipeuw Sahetapy Ririhena Pelupessy Tupamahu Sondakh
   Pangemanan Mandagi Lumanauw Rumengan Wowor Kaunang Sanjaya Hartono Suryadi Sutanto Wahyudi Purnomo
   Sukardi Irawan Syahrial Anwar Siswanto`,
);
const FILIPINO = pool(
  "filipino",
  `Miguel Joshua Gabriel Paolo Rafael Carlo Luis John Marco Angelo Adrian Jose Jarvey Santiago Pocholo Amani
   Christian Manny Kevin Mike Stephan Patrick Sandro Martin Neil James Phil Jeremiah Jovin Ian Mark Jason
   Ryan Ronald Emmanuel Jericho Kenneth Kyle Dylan Jefferson Paul Oliver Quincy Javier Bienvenido Randy
   Arnel Anton Joaquin Enrique Ramon Rodrigo Diego Mateo Nathaniel Jerome Harvey Jhon Kurt Justine Earl
   Lance Vince Carl Aaron Rico Chris Eric Julian Simen Daniel`,
  `Santos|Reyes|Cruz|Garcia|Ramos|Mendoza|Torres|Aquino|Villanueva|Dela Cruz|Navarro|Fernandez|Gonzales|
   Bautista|Castillo|Rivera|Flores|Ocampo|Soriano|Pascual|Mercado|Aguilar|Dizon|Manalo|Salazar|Domingo|
   De Guzman|Del Rosario|Castro|Lopez|Perez|Rodriguez|Sarmiento|Tolentino|Valdez|Gomez|Villareal|Marquez|
   Lim|Tan|Sy|Uy|Go|Chua|Ong|Tabinas|Aguinaldo|Gayoso|Rublico|Bugas|Marañon|Ingreso|Bedic|Sanchez|Morales|
   Jimenez|Espinosa|Padilla|Salvador|Macaraeg|Mangubat|Dimaculangan|Pangilinan|Enriquez|Lacson|Galang|
   Tiongson|Buenaventura|Concepcion|Evangelista|Francisco|Ignacio|Javier|Legaspi|Lorenzo|Manuel|
   Natividad|Robles|Samonte|Umali|Velasco|Yap|Zamora|Alcantara|Basilio|Cabrera|Dalisay|Esguerra|Felipe|
   Guevarra|Hernandez|Isidro|Jacinto|Katigbak|Lagman|Mallari|Nepomuceno|Ortega|Panganiban|Quizon|Sison|
   Tamayo|Ventura|Abad|Delos Santos|San Jose`,
);
const THAI = pool(
  "thai",
  `Chanathip Teerasil Theerathon Supachok Suphanat Ekanit Bordin Sarach Pansa Kritsada Tanaboon Weerathep
   Sasalak Channarong Worachit Peeradon Pokklaw Kawin Siwarak Chatchai Patiwat Jakkaphan Nattawut Thitipan
   Airfan Jaroensak Adisak Kroekrit Narubadin Picha Poramet Chalermsak Kittipong Suphan Wattana Suriya
   Nopphon Sompong Chakkit Supasak Anon Ekkachai Chananan Chakrit Saringkan Apiwat Sarawut Sumanya Kanokpon
   Thanawat Korawich Saharat Thirawut Worawut Kasidech Rungrath Adul Pakorn Chayawat Chaiyawat Siwakorn
   Wanchai Seksan Jakkit Kittisak Pathompon Sittichok Bukkoree Pongrawit Chatmongkol Nakin Yotsakorn
   Songchai Chanin Weerawut Ittipol Anusak Suchanon Soponwit Settawut`,
  `Songkrasin Dangda Bunmathan Sarachat Mueanta Panya Phala Yooyen Hemviboon Kaman Kesarat Pomphan
   Haiprakhon Promsrikaew Kanitsribampen Chamratsamee Anan Thamsatchanan Tedsungnoen Budprom Khammai
   Kaewprom Sombatyotha Puangchan Doloh Wonggorn Kraisorn Thaweekarn Weerawatnodom Autra Arjvirai Aukkee
   Phuthawchueak Thongsong Playnum Singmui Lakhonphon Soleb Laptrakul Sarapee Amornlerdsak Sumrei Pombuppha
   Chunuonsee Rawanprakone Promsupa Ngaolamhin Masuk Purisai Buspakom Suengchitthawon Tasa Sontisawat
   Sraunson Suksum Wettayawong Poomchantuek Muensaman Prempak Srinawong Buran Jakkuprasat Jarunongkran
   Ratree Wachpirom Hochin Charoenrattanapirom Kannoo Lemdee Jantawong Rueangthanarot Wisetchat Burapha
   Thongcham Kayem Poolsap Jaiphet Malison Rakyart Wongsai Srisuk Boonmee Saetang Saelim Kaewta Thongdee
   Phromsuwan Meesuk Sombat Sukjai Rattanakul Chaiyasit Jaidee Kongkaew Wongsakul Inpan Phanthong Ketkaew
   Nakprasert Pongsiri Wattanasuk Yodprasit Kaewkham Mahawong Charoensuk Chanthawong Siriwat Suksawat
   Thongsuk Saengchan Phromma Inthasorn`,
);
// Vietnamese family names weighted by real frequency: Nguyễn alone is about 38%.
const VIETNAMESE_NGUYEN = pool("vietnamese-nguyen", "", "Nguyễn");
const VIETNAMESE_COMMON = pool(
  "vietnamese-common",
  "",
  "Trần Lê Phạm Hoàng Huỳnh Phan Vũ Võ Đặng Bùi Đỗ Hồ Ngô Dương",
);
const VIETNAMESE = pool(
  "vietnamese",
  "",
  `Lý Đinh Lâm Mai Trịnh Đoàn Lương Lưu Cao Chu Tạ Văn Tô Hà Quách Thái Kiều Khúc Kim Châu Triệu Vương Mạc
   Phùng Tăng Tống Thân Lại Lục Hứa Tôn Doãn Âu Diệp Giáp Hàn Khổng Khương La Mạch Nghiêm Ninh Nông Ông Phí
   Quan Sầm Thạch Thiều Trương Từ Ung Vi Viên Đàm Đào Đồng Lò Lã Kha Bạch Bế Cù Cung Đường Hầu Hồng Lạc Lăng
   Lộc Mã Mẫn Quế Nhâm Phó Sử Thi Trang Yên Chế Chung Đậu Khuất Nhữ Bành Tiêu Nhan Thiệu Cấn Đái Mông Phương Ôn`,
);
const LAO = pool(
  "lao",
  `Khampheng Bounmy Souk Vannasone Phouthone Anousone Sengdao Bounthavy Soukaphone Vilay Phithack Lathasay
   Khonesavanh Sayasone Bounphachan Phoutthasay Kydavone Somxay Souksavanh Phonsack Khamla Bounpheng Sisouk
   Viengkham Thongsavath Chanthalay Vongsa Ketsada Sackda Sitthideth Chony Damoth Phoutthavong Anantaza
   Kittisak`,
  `Phommasane Souvannavong Keovongsa Xayavong Sengsavanh Phanthavong Vongphachanh Inthavong Khamphoumy
   Sisavath Vongchiengkham Sayavutthi Souvannasangso Phimmasone Chanthavong Keokhamsay Phommachanh Sayasith
   Wenpaserth Sisoukda Vongkhamxao Douangmaity Phetvongsa Rattanavong Soulivong Thammavong Keomany Xaysomphou
   Siharath Philavong Bounyavong Chanthaphone Somsanith Manivong Vilaysack Phothisane Sengphachanh Khounvilay
   Latsavong Siphongphan Sihavong`,
);
const KHMER = pool(
  "khmer",
  `Vathanaka Sokpheng Mony Udom Sokha Dara Rithy Vannak Sopheak Piseth Visal Borey Sovann Ratanak Soksan
   Chanthea Chanpolin Samoeun Senghong Sareth Sophal Vireak Kimhuy Sambath Kakada Seyha Rotha Phearith
   Sothea Bunthoeun Vuthy Lyheng Rady Sovannarith`,
  `Sok Chan Chea Heng Seng Lim Kim Chhim Khem Keo Prak Sun Chhun Hok Ly Mao Nhim Ouk Pen Pich Roeun Sam Sar
   Sim So Soeung Tep Thach Touch Um Uy Van Yim Yos Kong Long Meas Nuon Phan Prum Reth Sin`,
);
// Burmese names have no inherited family name; the "family" side holds the later name components.
const BURMESE = pool(
  "burmese",
  `Aung Hein Maung Kyaw Zaw Win Hlaing Lwin Than Myat Nanda Kaung Sithu Thet Nay Sai Ye Ko Min Htet Pyae Soe
   Zin Wai Thiha Naing Phone Kyi Suan Maw Lin Hmue Zwe Yan Myo`,
  `Thu|Htet Aung|Maung Lwin|Ko Ko|Min Tun|Naing Tun|Bo Bo|Moe Aung|Paing|Kaung Khant|Zaw Oo|Lin Htet|
   Win Tun|Thu Aung|Min Khant|Myo Win|Htay Aung|Kyaw Zin|Nyein Chan|Tun Win|Soe Moe Kyaw|Pyae Sone|Sithu|
   Thiha|Zayar Naing|Aung Kyaw|Kyaw Htwe|Lwin Oo|Myat Thu|Yan Naing Oo|Hein Zeyar|Zin Min|Oo|Htwe|Tin|
   Naing|Phyo|Linn|Wai Yan|Aung Zaw|Min Thu|Kyaw Kyaw`,
);
// The "family" side holds the patronymic, written first.
const MONGOLIAN = pool(
  "mongolian",
  `Batbayar Temuulen Munkhbat Enkhbayar Bilguun Tuguldur Erdenebat Ganbold Batsaikhan Anand Tsend-Ayush
   Otgonbayar Nyam-Osor Oyunbaatar Gal-Erdene Naranbold Tsedenbal Khurelbaatar Baljinnyam Ariunbold Ganzorig
   Tumurbaatar Munkh-Erdene Bat-Orgil Ulziibayar Narmandakh Orgilbold Enkhtaivan Batkhuyag Sodbileg Gankhuyag`,
  `Dorj Bat Enkh Gantulga Munkh Bold Tseren Otgon Erdene Baatar Batbold Ganbaatar Purevdorj Tsogt Byambaa
   Ochir Davaa Norov Lkhagva Sukh Batjargal Tumur Jargal Choijil Namsrai Gombo Sodnom Damdin Luvsan
   Tserendorj Yondon Dashnyam Altangerel Erdenebileg Batmunkh Khishig Uuganbayar Delger Nyamdorj Ganzorig
   Bayar`,
);
// Malay footballers are known by given name and father's name (without "bin").
const MALAY = pool(
  "malay",
  `Ahmad Muhammad Azlan Hafiz Syafiq Firdaus Amir Faizal Safawi Arif Faisal Akhyar Syamer Sharul Azam Harith
   Mukhairi Hariss Safuwan Shahdan Ikhsan Baihakki Adam Irfan Hami Zulfahmi Shawal Faris Izwan Nazrul Hassan
   Azim Faiq Hakim Haziq Aiman Afiq Aidil Amri Norshahrul Khairul Shukor Zaquan Fadhli Nazmi Danial Hadi
   Luqman Ridzuan Zikri Syahmi Najmuddin Akmal Fakhrul Azri Hazwan Asraf Farhan Shahrel Nazirul Irwan Rozaimi`,
  `Rasid Aiman Halim Ahmad Rashid Azmi Haiqal Ajmal Nazeem Harun Baharudin Sulaiman Fandi Khaizan Swandi
   Syahin Arifin Anuar Ramli Mahbud Nazari Sunny Abdullah Hassan Ibrahim Ismail Yusof Osman Rahman Zainal
   Kamal Ramlan Rosli Othman Hamid Shukor Aziz Salleh Kassim Musa Jaafar Yaacob Hashim Latif Mansor Ghani
   Hussin Jamil Samad Omar Talib Wahab Zakaria Razak Nasir Johari Ali Hamzah Idris Yahya Zulkifli`,
);
// Malaysian and Singaporean Chinese footballers usually go by an English given name.
const STRAIT_CHINESE = pool(
  "strait-chinese",
  `Gabriel Daniel Jordan Glenn Joshua Dominic Brendan Darren Quentin Kenneth Jonathan Marcus Ryan Kevin Adrian
   Jason Nicholas Benjamin Elijah Ethan Lucas Aaron Travis Kelvin Alvin Calvin Desmond Eugene Gary Wilson
   Wesley Terence`,
  `Tan Lim Lee Ng Ong Wong Goh Chua Chan Koh Teo Ang Yeo Tay Ho Low Toh Sim Chong Chia Seah Heng Foo Lau Quak
   Kweh Loh Yap Chin Liew Lai Soh Tee Khoo Leong Cheah Chew Kok Mok Ooi Tham Neo`,
);
const TAMIL = pool(
  "tamil",
  `Arun Suresh Dinesh Kumar Ravi Vijay Prakash Ganesh Karthik Senthil Saravanan Anumanthan Kannan Mathan
   Rajesh Ramesh Selvam Arul Sivakumar Pradeep Tharshan Kogileswaran Shivan Sathish Harish Naveen Vignesh
   Manoj Kishore Balaji Surendran Prabhu Muthu Deepan Tamilarasan Rajkumar`,
  `Murugan Raman Subramaniam Rajendran Selvam Kumar Pillai Nair Ganesan Muthu Krishnan Balakrishnan
   Ravichandran Sivakumar Nadarajah Kandasamy Arumugam Perumal Rajan Mani Sundram Maniam Pandian Chandran
   Govindasamy Veerasamy Ramasamy Letchumanan Thangavelu Sinnathamby Raju Velu Supramaniam Kanagaraj
   Jeganathan Sathasivam Ponnusamy Palanisamy Sivapalan Tharmalingam Selvarajah Balasubramaniam`,
);
// India's football regions; the Indian name config lists these in the same order on both sides.
const HINDI = pool(
  "hindi",
  `Arjun Rohit Vivek Amit Nikhil Ravi Rahul Manish Anirudh Ashish Deepak Aakash Ankit Sahil Vikram Ajay
   Rakesh Ashutosh Rajat Mohit Gaurav Varun Kunal Prateek Harsh Yash Ishan Rohan Aniket Nishu Akash Sumit`,
  `Sharma Gupta Verma Joshi Yadav Mishra Tiwari Saxena Kumar Chauhan Rawat Negi Bisht Thakur Pandey Dubey
   Chaturvedi Srivastava Agarwal Rathore Tomar Pandita Kaul Raina Dhar Rana Bhatt Semwal Nautiyal Chand`,
);
const BENGALI = pool(
  "bengali",
  `Sujan Subrata Sourav Abhijit Debjit Souvik Prabir Anirban Pritam Arindam Subhasish Prosenjit Sayan Tanmoy
   Suvam Joydeep Ranjit Bikash Sayantan Arijit Dibyendu Pintu Supratim Snehasish Rakesh Tirthankar
   Shubhankar Sandip`,
  `Das Roy Sarkar Chatterjee Banerjee Biswas Ghosh Dutta Bose Mukherjee Chakraborty Sen Mondal Pal Saha Kotal
   Bhattacharya Majumdar Nandi Sinha Mitra Guha Hazra Naskar Halder Paul Jana Maity Kundu Samanta`,
);
const MALAYALI = pool(
  "malayali",
  `Sahal Rahul Ashique Jithin Anas Vineeth Nihal Vibin Sachin Ajith Sreekuttan Jobby Prasanth Lukman Emil
   Muhammed Rabeeh Akhil Sanju Sujith Vishnu Aneesh Rinoy Jeffrin Shibin Aimen Azhar Salah`,
  `Samad Kuruniyan Benny Varghese Joseph Thomas Mathew Kurian Nair Menon Pillai Raj Babu Rahman Jose Antony
   Chacko Philip George Unnikrishnan Vasudevan Nambiar Ullas Aimen Azhar Sathyan`,
);
const GOAN = pool(
  "goan",
  `Brandon Glan Lenny Clifford Romeo Mandar Seriton Jovel Savio Denzil Jonathan Flan Myron Aaren Leander
   Ronald Stendly Luis Jason Nestor Carlton Clive Agnelo Brendon Joaquim Cajetan Francis Mark`,
  `Fernandes Gomes D'Souza Rodrigues Colaco Pereira Dias Coutinho Monteiro Furtado Martins Almeida Vaz
   Mascarenhas Menezes Barreto Cardozo Silveira Noronha Rebello Pinto Lobo Afonso Rao Desai Dessai`,
);
// Manipur, Mizoram, Meghalaya, Sikkim and the Gorkha community.
const NORTHEAST_INDIA = pool(
  "northeast-india",
  `Jeakson Lalengmawia Lallianzuala Lalthathanga Lalrinliana Lalremsanga Lalrinzuala Lalchungnunga Suresh
   Nongdamba Amarjit Bipin Thoiba Milan Lalruatthara Jerry Zohmingliana Vanlalzuidika Isak Malsawmzuala
   Chinglensana Boris Komal Anirudh Sunil Samuel Wanlambok Phrangki Rynsai Kynsai Ricky Lalmuanpuia
   Lalhmangaihsanga`,
  `Singh Thounaojam Wangjam Naorem Chhangte Khawlhring Hnamte Ralte Pachuau Sailo Colney Zote Tochhawng
   Ningthoujam Sorokhaibam Laishram Konsham Meetei Lyngdoh Syiemlieh Marbaniang Buam Nongrum Thapa Chhetri
   Rai Thatal Lepcha Bhutia Tamang Gurung Renthlei Khiangte Hmar`,
);
const PUNJABI = pool(
  "punjabi",
  `Gurpreet Harjit Manpreet Jaspreet Baljit Amarjit Gurjit Navdeep Sandesh Prabhsukhan Anmol Harmanjot
   Sukhwinder Inderjit Parminder Kulwinder Jagroop Gursimrat Amrinder Ravneet`,
  "Singh Sandhu Gill Dhillon Bajwa Sidhu Brar Grewal Jhingan Khabra Sangha Aulakh Bhullar Chahal Dhaliwal Randhawa",
);
const INDIAN_MUSLIM = pool(
  "indian-muslim",
  "Aamir Faisal Imran Irfan Arif Yusuf Salim Rashid Mehtab Zahid Mohammed Anwar Rahim Asif Shahid Sameer Taj",
  "Khan Ali Siddiqui Ansari Shaikh Qureshi Hussain Ahmed Hossain Rizvi Mirza Pathan Sheikh Farooqui",
);
const BANGLADESHI = pool(
  "bangladeshi",
  `Mohammad Jamal Topu Sohel Rakib Saad Fahim Tariqul Morsalin Rahmat Yeasin Manik Mitul Rabiul Sumon Shakil
   Emon Zahid Masuk Mehedi Riyadul Anisur Bishwanath Rahim Faysal Hamza Jewel Mamunul Sufil Rimon Foysal
   Ashraful Tutul Monayem Kawsar Mojibur Shekh`,
  `Hossain Rahman Islam Ahmed Uddin Barman Khan Miah Chowdhury Sarkar Bhuyan Hasan Ali Karim Molla Sheikh
   Talukder Mridha Akand Bhuiyan Haque Alam Kabir Mahmud Rana Mia Sikder Munshi Faruk Kazi Pramanik Biswas
   Das Roy Shikder Sohag Morsalin Hridoy Tipu Babu`,
);
const NEPALI = pool(
  "nepali",
  `Anjan Rohit Bimal Kiran Sujal Ayush Manish Sunil Tej Bharat Nawayug Rabin Laken Arik Sanjog Dinesh Anil
   Sagar Suraj Pujan Abhishek Hemant Santosh Ananta Bishal Rajan`,
  `Bista Chaudhary Shrestha Rai Limbu Gurung Tamang Thapa Magar Chhetri Lama Pun Rawal Budha Oli Khatri Karki
   Bhandari Tharu Yadav Mahato Shahi Bohara Dhami Joshi Pant Bhatta Sunar Kami Pariyar Maharjan Basnet`,
);
const PAKISTANI = pool(
  "pakistani",
  `Muhammad Ali Hassan Usman Bilal Hamza Faisal Imran Kaleem Saddam Zahid Mansoor Ahsan Adnan Rahis Otis
   Easah Harun Etzaz Abdullah Shayak Umair Waleed Yasir Zeeshan Kamran Tanveer Rizwan Shahid Junaid Naveed
   Asad Ammar Sohail Fahad Taimoor Waqas Arsalan Haris Hasnain Mohsin Alamgir Adil`,
  `Khan Ahmed Ali Hussain Iqbal Malik Butt Chaudhry Qureshi Sheikh Raza Shah Mirza Abbasi Akhtar Aslam Baig
   Bhatti Dar Gondal Hashmi Javed Jutt Kayani Mughal Nabi Rana Rehman Siddiqui Suleman Tariq Warraich Yousaf
   Zaidi Afridi Yousafzai Durrani Khattak Marwat Niazi Wazir Kakar Baloch Mengal Rind Soomro Memon Jatoi
   Ghazi Hamid`,
);
const SINHALA = pool(
  "sinhala",
  `Kasun Nuwan Dinesh Lahiru Ruwan Chamara Isuru Tharindu Dilshan Asanka Kavindu Sujan Charitha Dilip
   Chathura Dasun Sahan Nadeeka Pasindu Ravindu Supun Thisara Upul Buddhika Janaka Sameera Heshan Madushan
   Ashan Rukshan`,
  `Perera Fernando Silva Jayasinghe Rajapaksa Gunawardena Karunaratne Wijesinghe Bandara Senanayake
   Rathnayake Peiris Dissanayake Herath Jayawardena Kumara Liyanage Mendis Ranasinghe Samarasinghe
   Wickramasinghe Abeysekera Gamage Hettiarachchi Jayasuriya Kulasekara Munasinghe Nanayakkara Pathirana
   Ratnayake Senaratne Weerasinghe Amarasinghe Ekanayake Gunasekara Jayaratne Madushanka Rodrigo Wijeratne
   Galappaththi`,
);
const LANKA_MOOR = pool(
  "lanka-moor",
  "Mohamed Waseem Aakib Rizwan Imran Nazeer Fazal Rifkhan Safran Ashfaq Rilwan Nuwaz",
  "Razeek Aakib Rahuman Marikar Cassim Lebbe Hameed Faiz Nazeer Rizvi Ismail Farook",
);
// Maldivian names are two personal names; the second is used like a family name.
const MALDIVIAN = pool(
  "maldivian",
  `Ali Ahmed Mohamed Ibrahim Hassan Hussain Ismail Abdulla Hamza Naiz Asadhulla Ashad Akram Ilham Nizam
   Samdhooh Imran Mahudhee Shafiu Samooh Umair Hisan Ahusan Zayyan Haisham Assad Faisal Ashfaq Rilwan Fasir
   Shaheem Nashid`,
  `Nashid Umair Faisal Arif Fasir Rasheed Shareef Didi Manik Moosa Saeed Waheed Ibrahim Hassan Rilwan
   Latheef Naseer Zahir Hameed Adam Solih Riyaz Anees Mujthaba Shiham Azim Nizam Easa Haleem Jaleel Mahir
   Nafiz Thoriq Zuhair Hilmy Fayaz Niyaz Mahudhee Shifan Naail`,
);
// Bhutanese names are two personal names without an inherited family name.
const BHUTANESE = pool(
  "bhutanese",
  `Tenzin Karma Pema Sonam Dorji Tshering Jigme Sangay Ugyen Wangchuk Chencho Kinley Kezang Nima Dawa Chimi
   Tandin Phurba Lobzang Yeshey Samdrup Sherub Norbu Rinchen Thinley Penjor Jamyang Nidup Tashi Pelden`,
  `Dorji Wangchuk Tobgay Norbu Wangdi Gyeltshen Tshering Namgyal Rinchen Thinley Penjor Jamtsho Tenzin
   Lhendup Dendup Tashi Phuntsho Chophel Zangpo Yeshey Kinley Nidup Nima Pelden Dhendup Gyem Samdrup Tobden
   Sherub Sonam Pema Ugyen Kezang Jigme Karma Sangay Dawa Chimi Tandin Phurba Lobzang Letho`,
);
const TIMORESE = pool(
  "timorese",
  `Domingos Agostinho Natalino Nicolau Martinho Eusebio Joao Jose Adelino Filomeno Mouzinho Paulo Gali Rufino
   Anizio Silverio Frangcyatma Jhon Olagar Feliciano Henrique Ervino Nelson Zenivio Moises Armindo Elias
   Cristovao Celestino Juvinal`,
  `Soares|da Costa|Gusmao|Guterres|Sarmento|Amaral|Ximenes|da Silva|Fernandes|de Jesus|Pereira|dos Santos|
   Belo|Freitas|Araujo|Tilman|Mendonça|Lopes|Martins|Alves|Carvalho|Correia|Pinto|Barreto|Cabral|Sequeira|
   Quintas|Ramos|Tavares|Monteiro`,
);
const CHAMORRO = pool(
  "chamorro",
  `Jose Juan Vicente Antonio Francisco Joaquin John Michael Jason Ryan Travis Justin Nate Brandon Kyle Marcus
   Mark Christopher Daniel Joshua Matthew David James Robert Anthony Eric Kevin Jonathan Tyler Dylan Jordan
   Isaiah Elijah Jericho Raymond Juanito`,
  `Cruz|Duenas|Taitano|Gumataotao|Terlaje|Sablan|Aguon|Chargualaf|Quinata|Leon Guerrero|San Nicolas|
   Mendiola|Pangelinan|Camacho|Borja|Santos|Perez|Blas|Flores|Salas|Quitugua|Tenorio|Reyes|Manibusan|
   Babauta|Castro|Garrido|Muna|Rosario|Unpingco|Lujan|Fejeran|Mesa|Tainatongo|Topasna|Palacios|Materne|
   Concepcion|Artero|Aflague|Benavente|Calvo|San Agustin|Mafnas`,
);
// Anglo-Celtic Australia; migrant-heritage surnames are a separate, lighter pool.
const AUSTRALIAN = pool(
  "australian",
  "",
  `Smith Jones Williams Brown Wilson Taylor Johnson White Martin Anderson Thompson Thomas Walker Harris Ryan
   Robinson Kelly King Davis Wright Evans Roberts Green Hall Wood Jackson Clarke Lewis James Phillips Mitchell
   Turner Campbell Morris Hughes Edwards O'Brien Murphy Kennedy Scott Young Allen Baker Cook Bell Morgan
   Cooper Ward Watson Carter Stewart Harrison Collins Hill Parker Moore Shaw Graham Murray Reid Hunter Fraser
   Grant Wallace Duncan Gibson Russell Burke Byrne Sullivan Quinn Doyle Walsh Lynch McDonald McKenzie
   Robertson Hamilton Irvine Bailey Bennett Cunningham Chapman Ellis Fletcher Gordon Hayes Holmes Jenkins
   Knight Lawrence Marshall Mason Nicholson Palmer Pearce Porter Price Richards Rogers Simpson Spencer Stevens
   Sutton Thornton Wade Webb Wells West Wheeler Williamson Wilkinson Woods Boyle Brennan Brady Casey Connolly
   Dunn Fitzgerald Hogan Keane Maguire Nolan O'Connor O'Neill Power Kerr Leckie Rowles Souttar Metcalfe
   McGree Goodwin Maclaren Taggart Geria Elder Trewin Duke Miller`,
);
const AUSTRALIAN_MIGRANT = pool(
  "australian-migrant",
  "",
  `Rossi Romano Esposito Russo Marino Bruno Ferrara Colombo Rizzo Circati Volpato Zullo Italiano Vidmar Juric
   Kovacevic Grgic Popovic Vukovic Bozanic Degenek Stojanovic Jovanovic Spirovski Trajkovski Nikolovski Borg
   Camilleri Vella Grech Zammit Gauci Khoury Haddad Saad Kuol Mabil Deng Garang Makuei Yengi Toure Nguyen Tran
   Chen Wang Singh Patel Velupillay Behich Bos Irankunda Papadopoulos Georgiou Dimitriou Karanikas Theoharous
   Stamatelopoulos Kostopoulos`,
);

// ------------------------------------------------------------------ Japan

const JP: NationSpec = {
  code: "JP",
  iso2: "JP",
  name: "Japan",
  confederation: "AFC",
  continent: "AS",
  capital: "Tokyo",
  latitude: 35.7,
  languages: languages("ja:1"),
  reputation: { national: 80, league: 70 },
  euEea: false,
  physique: { height: 177 },
  names: { given: [src("japanese")], family: [src("japanese")], order: "given-family" },
  nationality: {
    // Mixed-heritage players (Nikkei Brazilians, Japanese-Americans, Nigerian/Ghanaian fathers) are a small share.
    multipleRate: 0.05,
    tripleRate: 0.004,
    bornAbroadRate: 0.03,
    diasporaPull: 0.6,
    links: [
      ...links("asianDiaspora", "BR:8 PE:2 US:6 PH:4 KR:3 CN:2"),
      ...links("regional", "NG:3 GH:3 NL:1 FR:1 EN:1 DE:1"),
      ...links("pacific", "AU:1"),
    ],
    // Dual nationals must choose one nationality by 22.
    citizenship: restricted,
  },
  cities: {
    major: [
      city("Tokyo", "mega", "Tokyo", 3, "Setagaya|Hachioji|Machida|Chofu|Edogawa|Nerima"),
      city("Yokohama", "mega", "Kanagawa", 2, "Kohoku|Totsuka|Aoba"),
      city("Osaka", "mega", "Osaka", 2, "Suita|Sakai|Higashiosaka"),
      city("Nagoya", "large", "Aichi", 1),
      city("Sapporo", "large", "Hokkaido", 1),
      city("Fukuoka", "large", "Fukuoka", 1),
      city("Kobe", "large", "Hyogo", 1),
      city("Kawasaki", "large", "Kanagawa", 1),
      city("Kyoto", "large", "Kyoto", 1),
      city("Saitama", "large", "Saitama", 2, "Omiya|Urawa"),
      city("Hiroshima", "large", "Hiroshima", 1),
      city("Sendai", "large", "Miyagi", 1),
      city("Chiba", "large", "Chiba", 1),
      city("Kitakyushu", "large", "Fukuoka", 1),
      city("Niigata", "medium", "Niigata", 1),
      city("Hamamatsu", "medium", "Shizuoka", 1),
      city("Shizuoka", "medium", "Shizuoka", 1),
      city("Okayama", "medium", "Okayama", 1),
      city("Kumamoto", "medium", "Kumamoto", 1),
      city("Kagoshima", "medium", "Kagoshima", 1),
      city("Kanazawa", "medium", "Ishikawa", 1),
      city("Nagasaki", "medium", "Nagasaki", 1),
      city("Oita", "medium", "Oita", 1),
      city("Matsuyama", "medium", "Ehime", 1),
      city("Utsunomiya", "medium", "Tochigi", 1),
      city("Kashiwa", "medium", "Chiba", 1),
      city("Gifu", "medium", "Gifu", 1),
      city("Toyota", "medium", "Aichi", 1),
      city("Takamatsu", "medium", "Kagawa", 1),
      city("Tokushima", "medium", "Tokushima", 1),
      city("Kofu", "medium", "Yamanashi", 1),
      city("Hiratsuka", "medium", "Kanagawa", 1),
      city("Mito", "medium", "Ibaraki", 1),
      city("Nagano", "medium", "Nagano", 1),
      city("Toyama", "medium", "Toyama", 1),
      city("Akita", "medium", "Akita", 1),
      city("Yamagata", "medium", "Yamagata", 1),
      city("Morioka", "medium", "Iwate", 1),
      city("Naha", "medium", "Okinawa", 1),
      city("Miyazaki", "medium", "Miyazaki", 1),
      city("Kochi", "medium", "Kochi", 1),
      city("Nara", "medium", "Nara", 1),
      city("Matsumoto", "small", "Nagano"),
      city("Iwata", "small", "Shizuoka"),
      city("Tosu", "town", "Saga"),
      city("Kashima", "town", "Ibaraki"),
    ],
  },
  football: singleTier(
    {
      tier: 1,
      name: "J1 League",
      shortName: "J1",
      size: 20,
      status: "professional",
      reputation: 70,
      clubs: {
        reputation: { top: 69, bottom: 57 },
        giants: { count: 3, top: 73, bottom: 71 },
        capacity: { top: 60_000, bottom: 15_000 },
        facilities: { top: 80, bottom: 62 },
        academy: { top: 82, bottom: 62 },
        wageBill: { top: 26_000_000, bottom: 6_500_000 },
        transferBudget: { top: 6_000_000, bottom: 400_000 },
        foreignShare: 0.17,
        squadSize: [28, 34],
      },
    },
    {
      cups: [
        { kind: "national", name: "Emperor's Cup", seededEntry: true, legs: 1, neutralFinal: true, continental: true },
        // YBC Levain Cup without the sponsor.
        { kind: "league", name: "J.League Cup", legs: 2, finalLegs: 1, neutralFinal: true },
        { kind: "super", name: "Japanese Super Cup", participants: ["champion", "cup-winner"], neutralFinal: true, start: "08-01" },
      ],
      youth: youth(
        division("Prince Takamado U-18 Premier League", 10, "East|West"),
        division("Prince League", 10, "Kanto|Kansai"),
        { u19: "Japan Club Youth Championship (U-18)" },
      ),
      // City plus an invented Romance-language nickname, the J.League convention (no real nicknames).
      clubNaming: {
        templates: templates(
          `{city} FC:2; {city} SC:1; {city} Aquilone:1; {city} Soleado:1; {city} Libellula:1; {city} Gabbiano:1;
           {city} Cicogna:1; {city} Vientos:1; {city} Ardore:1; {city} Onda:1; {city} Fiamma:1; {city} Stellato:1;
           {city} Orizzonte:1; {city} Corsaro:1; {city} Tempesta:1; {city} Brillante:1; {city} Vivace:1;
           {city} Rondine:1; {city} Delfino:1; {city} Cometa:1`,
        ),
        founded: { top: [1920, 1996], bottom: [1930, 2005] },
        colors: ["#C8102E", "#003DA5", "#FFD100", "#00843D", "#F58220", "#5F259F", "#000000", "#8FC3E8", "#E4007F"],
      },
      importSources: weighted("BR:12 KR:5 AU:2 TH:2 ES:1 PL:1 RS:1 NL:1 PT:1 US:1 SE:1 NG:1 GH:1 CO:1 AR:1 DE:1"),
      coefficients: { association: [15, 16, 15.5, 16.5, 16] },
    },
  ),
  abroad: {
    seniors: 110,
    youth: 10,
    destinations: weighted(
      "DE:16 BE:14 NL:8 EN:8 FR:7 PT:8 SCO:6 ES:4 IT:3 DK:3 AT:3 SE:2 NO:2 PL:2 CH:2 TR:2 GR:1 US:4 TH:4 AU:3 KR:1",
    ),
  },
};

// ------------------------------------------------------------------ Australia

const AU: NationSpec = {
  code: "AU",
  iso2: "AU",
  name: "Australia",
  confederation: "AFC",
  continent: "OC",
  capital: "Canberra",
  latitude: -35.3,
  languages: languages("en:10 it:0.4 el:0.4 ar:0.4 zh:0.4 vi:0.3"),
  reputation: { national: 75, league: 58 },
  euEea: false,
  physique: { height: 181 },
  names: { given: [faker("en_AU")], family: [src("australian", 3), src("australian-migrant", 1)] },
  nationality: {
    multipleRate: 0.4,
    tripleRate: 0.08,
    bornAbroadRate: 0.12,
    diasporaPull: 0.55,
    links: [
      ...links("commonwealth", "EN:10 SCO:3 KE:1 ZA:1 IN:1"),
      ...links("britishIrish", "IE:4"),
      ...links("pacific", "NZ:7 FJ:1 WS:1"),
      ...links("mediterranean", "IT:6 GR:6 MT:2 LB:3 TR:1"),
      ...links("yugoslav", "HR:5 RS:3 MK:3 BA:1"),
      ...links("dutchDiaspora", "NL:2"),
      ...links("regional", "SS:3"),
      ...links("americas", "CL:1 UY:1"),
      ...links("asianDiaspora", "VN:1 PH:1 CN:1 JP:1"),
    ],
    citizenship: allowed,
  },
  cities: {
    major: [
      city("Sydney", "mega", "New South Wales", 2, "Parramatta|Campbelltown|Penrith|Blacktown|Sutherland|Liverpool"),
      city("Melbourne", "mega", "Victoria", 2, "Dandenong|Frankston|Footscray|Box Hill|Werribee|Heidelberg"),
      city("Brisbane", "large", "Queensland", 1, "Ipswich|Redcliffe|Logan"),
      city("Perth", "large", "Western Australia", 1, "Fremantle|Joondalup"),
      city("Adelaide", "large", "South Australia", 1, "Port Adelaide|Salisbury"),
      city("Gold Coast", "medium", "Queensland", 1),
      city("Newcastle", "medium", "New South Wales", 1),
      city("Canberra", "medium", "Australian Capital Territory", 1),
      city("Sunshine Coast", "medium", "Queensland", 1),
      city("Wollongong", "medium", "New South Wales", 1),
      city("Geelong", "medium", "Victoria", 1),
      city("Hobart", "medium", "Tasmania", 1),
      city("Townsville", "small", "Queensland"),
      city("Cairns", "small", "Queensland"),
      city("Gosford", "small", "New South Wales"),
      city("Darwin", "small", "Northern Territory"),
      city("Toowoomba", "small", "Queensland"),
      city("Ballarat", "small", "Victoria"),
      city("Bendigo", "small", "Victoria"),
      city("Launceston", "small", "Tasmania"),
      city("Albury", "small", "New South Wales"),
      city("Mackay", "small", "Queensland"),
      city("Rockhampton", "small", "Queensland"),
      city("Bunbury", "small", "Western Australia"),
      city("Wagga Wagga", "small", "New South Wales"),
      city("Mildura", "town", "Victoria"),
      city("Shepparton", "town", "Victoria"),
      city("Orange", "town", "New South Wales"),
      city("Dubbo", "town", "New South Wales"),
      city("Port Macquarie", "town", "New South Wales"),
      city("Coffs Harbour", "town", "New South Wales"),
      city("Tamworth", "town", "New South Wales"),
      city("Lismore", "town", "New South Wales"),
      city("Bundaberg", "town", "Queensland"),
      city("Mount Gambier", "town", "South Australia"),
      city("Whyalla", "town", "South Australia"),
      city("Kalgoorlie", "town", "Western Australia"),
      city("Geraldton", "town", "Western Australia"),
      city("Alice Springs", "town", "Northern Territory"),
      city("Warrnambool", "town", "Victoria"),
      city("Devonport", "town", "Tasmania"),
      city("Burnie", "town", "Tasmania"),
    ],
  },
  football: singleTier(
    {
      tier: 1,
      // 2025/26: 12 clubs incl. New Zealand's Wellington and Auckland (hosted, see concacaf-ofc NZ); Western United sat out.
      name: "A-League Men",
      shortName: "A-League",
      size: 12,
      status: "professional",
      reputation: 58,
      closed: true,
      // Top-six Finals Series; the regular-season Premiers take the league access place.
      championship: { positions: [1, 6], legs: 2, finalLegs: 1 },
      clubs: {
        reputation: { top: 60, bottom: 51 },
        giants: { count: 2, top: 64, bottom: 62 },
        capacity: { top: 42_000, bottom: 12_000 },
        facilities: { top: 70, bottom: 52 },
        academy: { top: 66, bottom: 48 },
        // Salary cap about A$2.6m plus marquee and scholarship players outside it.
        wageBill: { top: 4_200_000, bottom: 1_700_000 },
        transferBudget: { top: 900_000, bottom: 50_000 },
        foreignShare: 0.2,
        squadSize: [25, 28],
      },
    },
    {
      cups: [{ kind: "national", name: "Australia Cup", seededEntry: true, legs: 1, continental: true }],
      // Academies play in the state National Premier Leagues youth competitions.
      youth: youth(division("National Premier Leagues U18"), division("National Premier Leagues U16")),
      clubNaming: {
        templates: templates(
          `{city} FC:1; {city} City:1; {city} United:1; {city} Olympic:1; {city} Athletic:1; {city} Rovers:1;
           {city} Comets:1; {city} Thunder:1; {city} Kestrels:1; {city} Tide:1; {city} Surge:1; {city} Stingrays:1;
           {city} Pelicans:1; {city} Falcons:1`,
        ),
        founded: { top: [1957, 2012], bottom: [1970, 2019] },
        colors: ["#0055A5", "#FFD200", "#E4002B", "#00843D", "#6CACE4", "#542E91", "#F47920", "#000000"],
      },
      importSources: weighted("EN:3 BR:3 ES:3 JP:3 SCO:2 NL:2 KR:2 NZ:2 PT:1 FR:1 GR:1 IT:1 DE:1 SE:1 IE:1 CR:1 CO:1 AR:1 US:1"),
      coefficients: { association: [7.5, 8, 7.5, 7.5, 7] },
    },
  ),
  abroad: {
    seniors: 60,
    youth: 12,
    destinations: weighted(
      "SCO:8 EN:10 DK:4 NL:2 BE:2 DE:3 JP:5 KR:2 US:3 IT:1 PT:1 TR:1 SE:1 NO:1 IN:3 TH:2 SA:1 AE:1 QA:1 GR:1 CH:1 AT:1",
    ),
  },
};

// ------------------------------------------------------------------ Saudi Arabia

const SA: NationSpec = {
  code: "SA",
  iso2: "SA",
  name: "Saudi Arabia",
  confederation: "AFC",
  continent: "AS",
  capital: "Riyadh",
  latitude: 24.7,
  languages: languages("ar:1"),
  reputation: { national: 64, league: 72 },
  euEea: false,
  physique: { height: 176 },
  names: { given: [src("gulf")], family: [src("saudi", 7), src("khaleeji", 3)] },
  nationality: {
    multipleRate: 0.06,
    tripleRate: 0.004,
    bornAbroadRate: 0.03,
    diasporaPull: 0.8,
    links: [
      ...links("regional", "YE:4 KW:1 BH:1 AE:1 QA:1 IQ:1 NG:1 TD:1"),
      ...links("arabWorld", "EG:3 SD:2 SY:2 JO:2 PS:1 SO:1"),
      ...links("asianDiaspora", "ID:1"),
    ],
    // A second nationality needs government permission and is rarely granted.
    citizenship: restricted,
  },
  cities: {
    major: [
      city("Riyadh", "mega", "Riyadh", 4, "Olaya|Malaz|Suwaidi|Naseem|Shifa|Rawdah"),
      city("Jeddah", "mega", "Makkah", 2, "Balad|Safa|Aziziyah|Hamra|Nuzha"),
      city("Mecca", "large", "Makkah", 1),
      city("Medina", "large", "Madinah", 1),
      city("Dammam", "large", "Eastern Province", 1),
      city("Hofuf", "large", "Eastern Province", 1),
      city("Taif", "medium", "Makkah", 1),
      city("Tabuk", "medium", "Tabuk", 1),
      city("Buraidah", "medium", "Qassim", 1),
      city("Khamis Mushait", "medium", "Asir", 1),
      city("Khobar", "medium", "Eastern Province", 1),
      city("Ha'il", "medium", "Ha'il", 1),
      city("Najran", "medium", "Najran", 1),
      city("Jubail", "medium", "Eastern Province", 1),
      city("Abha", "medium", "Asir", 1),
      city("Hafar Al-Batin", "medium", "Eastern Province", 1),
      city("Yanbu", "medium", "Madinah", 1),
      city("Qatif", "medium", "Eastern Province", 1),
      city("Kharj", "medium", "Riyadh", 1),
      city("Jazan", "small", "Jazan", 1),
      city("Unaizah", "small", "Qassim", 1),
      city("Sakaka", "small", "Al-Jawf", 1),
      city("Arar", "small", "Northern Borders", 1),
      city("Ar Rass", "small", "Qassim", 1),
      city("Dhahran", "small", "Eastern Province", 1),
      city("Bisha", "small", "Asir", 1),
      city("Baha", "small", "Al-Bahah", 1),
      city("Qurayyat", "small", "Al-Jawf", 1),
      city("Majmaah", "town", "Riyadh"),
      city("Zulfi", "town", "Riyadh"),
      city("Duba", "town", "Tabuk"),
      city("Al Ula", "town", "Madinah"),
    ],
  },
  football: singleTier(
    {
      tier: 1,
      name: "Saudi Pro League",
      shortName: "SPL",
      size: 18,
      status: "professional",
      reputation: 72,
      clubs: {
        reputation: { top: 70, bottom: 54 },
        // The four PIF-owned giants spend at the level of Europe's top leagues.
        giants: { count: 4, top: 84, bottom: 79 },
        capacity: { top: 62_000, bottom: 6_000 },
        facilities: { top: 82, bottom: 50 },
        academy: { top: 66, bottom: 42 },
        wageBill: { top: 200_000_000, bottom: 9_000_000 },
        transferBudget: { top: 120_000_000, bottom: 2_000_000 },
        // Ten foreign players per squad.
        foreignShare: 0.38,
        squadSize: [28, 32],
      },
    },
    {
      cups: [
        { kind: "national", name: "King's Cup", seededEntry: true, legs: 1, neutralFinal: true, continental: true },
        {
          kind: "super",
          name: "Saudi Super Cup",
          participants: ["champion", "runner-up", "cup-winner", "cup-runner-up"],
          neutralFinal: true,
          start: "08-19",
        },
      ],
      youth: youth(division("Saudi U-19 Premier League", 9, "A|B"), division("Saudi U-17 Premier League", 9, "A|B")),
      // Most Saudi clubs are "Al-" plus a virtue or emblem; the city distinguishes the fictional clubs.
      clubNaming: {
        templates: templates(
          `Al-{city}:1; {city} Club:1; Al-Majd {city}:1; Al-Amal {city}:1; Al-Fursan {city}:1; Al-Suqoor {city}:1;
           Al-Tadamon {city}:1; Al-Wefaq {city}:1; Al-Fajr {city}:1; Al-Rayah {city}:1; Al-Istiqlal {city}:1;
           Al-Shoaa {city}:1`,
        ),
        founded: { top: [1927, 1976], bottom: [1940, 1995] },
        colors: ["#0055A4", "#FFD700", "#000000", "#006C35", "#C8102E", "#7A1F3D", "#F58220"],
      },
      importSources: weighted(
        "BR:10 PT:4 FR:4 ES:3 AR:3 CO:3 MA:3 NG:2 SN:2 DZ:2 CI:2 CM:2 TN:2 NL:2 GH:1 EN:1 BE:1 IT:1 HR:1 RS:1 CD:1 KR:1 UY:1 DE:1 SY:1 UZ:1 EG:1",
      ),
      coefficients: { association: [14.5, 15, 16, 17.5, 18] },
    },
  ),
  abroad: { seniors: 4, youth: 3, destinations: weighted("BE:2 FR:1 PT:1 ES:1") },
};

// ------------------------------------------------------------------ Korea Republic

const KR: NationSpec = {
  code: "KR",
  iso2: "KR",
  name: "Korea Republic",
  confederation: "AFC",
  continent: "AS",
  capital: "Seoul",
  latitude: 37.6,
  languages: languages("ko:1"),
  reputation: { national: 77, league: 66 },
  euEea: false,
  physique: { height: 180 },
  names: {
    given: [src("korean")],
    family: [src("korean-top", 45), src("korean-common", 35), src("korean", 20)],
    order: "family-given",
  },
  nationality: {
    multipleRate: 0.04,
    tripleRate: 0.002,
    bornAbroadRate: 0.02,
    diasporaPull: 0.55,
    links: [
      ...links("asianDiaspora", "US:8 JP:3 CN:3 CA:2 AU:2 VN:1 NZ:1 BR:1"),
      // Korean miners and nurses recruited by West Germany in the 1960s-70s.
      ...links("germanRecruitment", "DE:3"),
      ...links("postSoviet", "UZ:1 RU:1"),
    ],
    // Birthright dual nationals may keep both after pledging not to use the foreign one in Korea.
    citizenship: partners("US CA DE AU NZ GB FR BR"),
  },
  cities: {
    major: [
      city("Seoul", "mega", "Seoul", 2, "Mapo|Gangnam|Guro|Songpa|Jungnang|Nowon"),
      city("Busan", "large", "Busan", 1, "Haeundae|Gijang"),
      city("Incheon", "large", "Incheon", 1),
      city("Daegu", "large", "Daegu", 1),
      city("Daejeon", "large", "Daejeon", 1),
      city("Gwangju", "large", "Gwangju", 1),
      city("Suwon", "large", "Gyeonggi", 2, "Paldal|Yeongtong"),
      city("Ulsan", "large", "Ulsan", 1),
      city("Changwon", "medium", "South Gyeongsang", 1),
      city("Goyang", "medium", "Gyeonggi", 1),
      city("Yongin", "medium", "Gyeonggi", 1),
      city("Seongnam", "medium", "Gyeonggi", 1),
      city("Cheongju", "medium", "North Chungcheong", 1),
      city("Bucheon", "medium", "Gyeonggi", 1),
      city("Jeonju", "medium", "North Jeolla", 1),
      city("Cheonan", "medium", "South Chungcheong", 1),
      city("Ansan", "medium", "Gyeonggi", 1),
      city("Anyang", "medium", "Gyeonggi", 1),
      city("Pohang", "medium", "North Gyeongsang", 1),
      city("Gimhae", "medium", "South Gyeongsang", 1),
      city("Jeju", "medium", "Jeju", 1),
      city("Gimpo", "medium", "Gyeonggi", 1),
      city("Hwaseong", "medium", "Gyeonggi", 1),
      city("Gumi", "medium", "North Gyeongsang", 1),
      city("Paju", "medium", "Gyeonggi", 1),
      city("Asan", "small", "South Chungcheong"),
      city("Gangneung", "small", "Gangwon"),
      city("Chuncheon", "small", "Gangwon"),
      city("Wonju", "small", "Gangwon"),
      city("Gimcheon", "small", "North Gyeongsang"),
      city("Gwangyang", "small", "South Jeolla"),
      city("Suncheon", "small", "South Jeolla"),
      city("Mokpo", "small", "South Jeolla"),
      city("Geoje", "small", "South Gyeongsang"),
      city("Yangju", "small", "Gyeonggi"),
      city("Tongyeong", "town", "South Gyeongsang"),
    ],
  },
  football: singleTier(
    {
      tier: 1,
      name: "K League 1",
      shortName: "K League 1",
      size: 12,
      status: "professional",
      reputation: 66,
      // 33 rounds, then the table splits into Final A and Final B for five more rounds.
      roundRobins: 3,
      split: {
        groups: [
          { name: "Final A", positions: [1, 6], roundRobins: 1, points: "full" },
          { name: "Final B", positions: [7, 12], roundRobins: 1, points: "full" },
        ],
      },
      clubs: {
        reputation: { top: 64, bottom: 55 },
        giants: { count: 2, top: 69, bottom: 67 },
        capacity: { top: 66_000, bottom: 11_000 },
        facilities: { top: 74, bottom: 56 },
        academy: { top: 76, bottom: 56 },
        wageBill: { top: 12_000_000, bottom: 3_000_000 },
        transferBudget: { top: 3_000_000, bottom: 200_000 },
        foreignShare: 0.18,
        squadSize: [28, 36],
      },
    },
    {
      cups: [{ kind: "national", name: "Korea Cup", seededEntry: true, legs: 1, neutralFinal: true, continental: true }],
      youth: youth(division("K League Junior U18"), division("K League Junior U17"), {
        u19: "K League Youth Championship U18",
        u17: "K League Youth Championship U17",
      }),
      // Citizen clubs and English nicknames, the K League conventions.
      clubNaming: {
        templates: templates(
          `{city} FC:1; {city} Citizen:2; {city} United:1; {city} Seagulls:1; {city} Cranes:1; {city} Falcons:1;
           {city} Mariners:1; {city} Chargers:1; {city} Phoenix:1; {city} Magpies:1; {city} Hawks:1;
           {city} Mustangs:1; {city} Pegasus:1; {city} Warriors:1`,
        ),
        founded: { top: [1973, 2012], bottom: [1983, 2020] },
        colors: ["#0E4D92", "#C8102E", "#FFD100", "#00843D", "#F58220", "#000000", "#87CEEB"],
      },
      importSources: weighted("BR:12 AU:3 JP:3 ME:2 RS:2 CO:1 PT:1 ES:1 UZ:1 HR:1 NL:1 US:1 SE:1 AR:1 UY:1 GH:1 NG:1 AL:1 MK:1"),
      coefficients: { association: [15.5, 14.5, 13.5, 13, 12.5] },
    },
  ),
  abroad: {
    seniors: 30,
    youth: 6,
    destinations: weighted("DE:5 EN:3 FR:2 ES:1 SCO:2 BE:2 PT:1 TR:1 AT:1 DK:1 JP:8 CN:3 US:3 SA:1 QA:1 AE:1"),
  },
};

// ------------------------------------------------------------------ Iran

const IR: NationSpec = {
  code: "IR",
  iso2: "IR",
  name: "Iran",
  confederation: "AFC",
  continent: "AS",
  capital: "Tehran",
  latitude: 35.7,
  languages: languages("fa:8 az:2 ku:1 ar:1"),
  reputation: { national: 78, league: 60 },
  euEea: false,
  physique: { height: 182 },
  names: { given: [src("persian")], family: [src("persian")] },
  nationality: {
    multipleRate: 0.06,
    tripleRate: 0.005,
    bornAbroadRate: 0.02,
    diasporaPull: 0.7,
    links: [
      ...links("asianDiaspora", "SE:3 DE:3 US:3 NL:2 CA:2 AT:1 EN:1 DK:1 NO:1 FR:1"),
      ...links("regional", "AF:3 IQ:2 AZ:2 TR:1 AE:1"),
    ],
    // Iran does not recognise another nationality held by its citizens.
    citizenship: restricted,
  },
  cities: {
    major: [
      city("Tehran", "mega", "Tehran", 4, "Narmak|Tajrish|Ekbatan|Tehranpars|Shahrak-e Gharb|Pirouzi"),
      city("Mashhad", "large", "Razavi Khorasan", 2),
      city("Isfahan", "large", "Isfahan", 2),
      city("Karaj", "large", "Alborz", 1),
      city("Shiraz", "large", "Fars", 1),
      city("Tabriz", "large", "East Azerbaijan", 2),
      city("Qom", "large", "Qom", 1),
      city("Ahvaz", "large", "Khuzestan", 2),
      city("Kermanshah", "medium", "Kermanshah", 1),
      city("Urmia", "medium", "West Azerbaijan", 1),
      city("Rasht", "medium", "Gilan", 1),
      city("Zahedan", "medium", "Sistan and Baluchestan", 1),
      city("Hamadan", "medium", "Hamadan", 1),
      city("Kerman", "medium", "Kerman", 1),
      city("Yazd", "medium", "Yazd", 1),
      city("Ardabil", "medium", "Ardabil", 1),
      city("Bandar Abbas", "medium", "Hormozgan", 1),
      city("Arak", "medium", "Markazi", 1),
      city("Zanjan", "medium", "Zanjan", 1),
      city("Sanandaj", "medium", "Kurdistan", 1),
      city("Qazvin", "medium", "Qazvin", 1),
      city("Khorramabad", "medium", "Lorestan", 1),
      city("Gorgan", "medium", "Golestan", 1),
      city("Sari", "medium", "Mazandaran", 1),
      city("Bushehr", "small", "Bushehr"),
      city("Abadan", "small", "Khuzestan"),
      city("Sirjan", "small", "Kerman"),
      city("Rafsanjan", "small", "Kerman"),
      city("Bandar Anzali", "small", "Gilan"),
      city("Masjed Soleyman", "small", "Khuzestan"),
      city("Qaem Shahr", "small", "Mazandaran"),
      city("Babol", "small", "Mazandaran"),
      city("Kashan", "small", "Isfahan"),
      city("Dezful", "small", "Khuzestan"),
      city("Najafabad", "small", "Isfahan"),
      city("Birjand", "small", "South Khorasan"),
      city("Bojnurd", "small", "North Khorasan"),
      city("Shahrekord", "small", "Chaharmahal and Bakhtiari"),
      city("Yasuj", "small", "Kohgiluyeh and Boyer-Ahmad"),
      city("Ilam", "small", "Ilam"),
      city("Semnan", "small", "Semnan"),
      city("Ardakan", "town", "Yazd"),
      city("Mobarakeh", "town", "Isfahan"),
    ],
  },
  football: singleTier(
    {
      tier: 1,
      name: "Persian Gulf Pro League",
      shortName: "Pro League",
      size: 16,
      status: "professional",
      reputation: 60,
      clubs: {
        reputation: { top: 61, bottom: 49 },
        giants: { count: 2, top: 67, bottom: 65 },
        capacity: { top: 78_000, bottom: 8_000 },
        facilities: { top: 58, bottom: 40 },
        academy: { top: 62, bottom: 45 },
        wageBill: { top: 9_000_000, bottom: 1_500_000 },
        transferBudget: { top: 2_000_000, bottom: 100_000 },
        // Few foreign signings under sanctions and quota rules.
        foreignShare: 0.1,
        squadSize: [26, 32],
      },
    },
    {
      cups: [
        { kind: "national", name: "Hazfi Cup", seededEntry: true, legs: 1, continental: true },
        { kind: "super", name: "Iranian Super Cup", participants: ["champion", "cup-winner"] },
      ],
      youth: youth(division("Iran Youth Premier League"), division("Iran Juniors Premier League")),
      // Municipal, industrial and sponsor names in front of the city.
      clubNaming: {
        templates: templates(
          `Shahrdari {city}:2; Payam {city}:1; Mehr {city}:1; Naft {city}:1; Sanat {city}:1; Ettehad {city}:1;
           Omid {city}:1; Shahin {city}:1; Pas {city}:1; Setareh {city}:1; Azadi {city}:1; {city} FC:1`,
        ),
        founded: { top: [1945, 2012], bottom: [1965, 2020] },
        colors: ["#E30613", "#0033A0", "#FFD100", "#00843D", "#000000", "#F58220"],
      },
      importSources: weighted(
        "BR:3 RS:2 UZ:2 IQ:2 HR:1 TJ:1 AF:1 GE:1 AM:1 CO:1 ES:1 PT:1 NG:1 GH:1 CM:1 SN:1 MK:1 BA:1 SY:1 ME:1 TR:1 DZ:1",
      ),
      coefficients: { association: [12.5, 11.5, 10.5, 9.5, 9] },
    },
  ),
  abroad: {
    seniors: 30,
    youth: 4,
    destinations: weighted("QA:6 AE:3 GR:2 PT:2 NL:2 RU:3 TR:2 BE:1 IQ:2 AT:1 DE:1 SE:1 DK:1 CY:1 BG:1 IT:1"),
  },
};

// ------------------------------------------------------------------ Qatar

const QA: NationSpec = {
  code: "QA",
  iso2: "QA",
  name: "Qatar",
  confederation: "AFC",
  continent: "AS",
  capital: "Doha",
  latitude: 25.3,
  languages: languages("ar:9 en:1"),
  reputation: { national: 66, league: 62 },
  euEea: false,
  physique: { height: 176 },
  names: { given: [src("gulf")], family: [src("qatari", 6), src("khaleeji", 4)] },
  nationality: {
    // Naturalised players and families of Sudanese, Egyptian, Yemeni, Iraqi and Algerian origin.
    multipleRate: 0.12,
    tripleRate: 0.01,
    bornAbroadRate: 0.1,
    diasporaPull: 0.8,
    links: [
      ...links("arabWorld", "SD:3 EG:3 YE:2 IQ:2 DZ:2 SY:1 JO:1 PS:1 TN:1"),
      ...links("regional", "SA:2 SO:2 BH:1 IR:1"),
      ...links("gulfLabour", "GH:2 SN:1"),
      ...links("lusophone", "PT:1 CV:1 BR:1"),
      ...links("frenchAfrica", "FR:1"),
    ],
    // No dual nationality: naturalised players give up their first passport.
    citizenship: restricted,
  },
  cities: {
    major: [
      city("Doha", "large", "Doha", 8, "Thumama|Mansoura|Maamoura|Nuaija|Hitmi|Muraikh|Abu Hamour|Mirqab|Dafna|Aziziya"),
      city("Al Rayyan", "medium", "Al Rayyan", 2, "Muaither|Baaya|Luaib"),
      city("Al Wakrah", "medium", "Al Wakrah", 1),
      city("Al Khor", "small", "Al Khor", 1),
      city("Umm Salal", "small", "Umm Salal", 1),
      city("Lusail", "small", "Al Daayen", 1),
      city("Al Shahaniya", "town", "Al Shahaniya", 1),
      city("Madinat ash Shamal", "town", "Al Shamal", 1),
      city("Mesaieed", "town", "Al Wakrah", 1),
      city("Dukhan", "town", "Al Shahaniya", 1),
    ],
  },
  football: singleTier(
    {
      tier: 1,
      name: "Qatar Stars League",
      shortName: "QSL",
      size: 12,
      status: "professional",
      reputation: 62,
      clubs: {
        reputation: { top: 62, bottom: 51 },
        giants: { count: 2, top: 70, bottom: 67 },
        capacity: { top: 45_000, bottom: 5_000 },
        facilities: { top: 86, bottom: 66 },
        academy: { top: 80, bottom: 55 },
        wageBill: { top: 40_000_000, bottom: 6_000_000 },
        transferBudget: { top: 15_000_000, bottom: 500_000 },
        foreignShare: 0.25,
        squadSize: [26, 30],
      },
    },
    {
      cups: [
        { kind: "national", name: "Emir Cup", seededEntry: true, legs: 1, neutralFinal: true, continental: true },
        // Formerly the Crown Prince Cup, contested by the league's top four.
        { kind: "league", name: "Qatar Cup", maxEntrants: 4, legs: 1, neutralFinal: true },
      ],
      youth: youth(division("Qatar U-19 League"), division("Qatar U-17 League")),
      clubNaming: {
        templates: templates("{city} SC:3; {city} Club:2; {city} FC:1"),
        founded: { top: [1950, 2009], bottom: [1960, 2005] },
        colors: ["#8A1538", "#FFFFFF", "#000000", "#FFD100", "#0055A4", "#E30613"],
      },
      importSources: weighted(
        "BR:6 DZ:3 MA:3 TN:2 EG:2 SN:2 GH:2 CI:2 FR:2 ES:2 PT:2 NL:1 AR:1 CO:1 NG:1 IR:1 KR:1 JP:1 IQ:1 SY:1 JO:1 OM:1",
      ),
      coefficients: { association: [12, 11.5, 12.5, 12, 12.5] },
    },
  ),
  // Aspire loans to European partner clubs.
  abroad: { seniors: 2, youth: 3, destinations: weighted("BE:1 ES:1") },
};

// ------------------------------------------------------------------ Uzbekistan

const UZ: NationSpec = {
  code: "UZ",
  iso2: "UZ",
  name: "Uzbekistan",
  confederation: "AFC",
  continent: "AS",
  capital: "Tashkent",
  latitude: 41.3,
  languages: languages("uz:8 ru:2"),
  reputation: { national: 65, league: 54 },
  euEea: false,
  physique: { height: 180 },
  names: {
    given: [faker("uz_UZ_latin", 2), src("uzbek", 2)],
    family: [faker("uz_UZ_latin", 2), src("uzbek", 2)],
  },
  nationality: {
    multipleRate: 0.1,
    tripleRate: 0.01,
    bornAbroadRate: 0.03,
    diasporaPull: 0.6,
    links: [...links("postSoviet", "RU:5 KZ:3 TJ:3 KG:2 KR:2 TM:1 UA:1"), ...links("regional", "TR:1 AF:1")],
    // Uzbekistan does not recognise dual citizenship.
    citizenship: restricted,
  },
  cities: {
    major: [
      city("Tashkent", "mega", "Tashkent", 4, "Chilonzor|Yunusobod|Mirzo Ulugbek|Yakkasaroy|Sergeli|Olmazor"),
      city("Samarkand", "medium", "Samarkand", 1),
      city("Namangan", "medium", "Namangan", 1),
      city("Andijan", "medium", "Andijan", 1),
      city("Bukhara", "medium", "Bukhara", 1),
      city("Nukus", "medium", "Karakalpakstan", 1),
      city("Fergana", "medium", "Fergana", 1),
      city("Qarshi", "medium", "Qashqadaryo", 1),
      city("Kokand", "medium", "Fergana", 1),
      city("Margilan", "small", "Fergana", 1),
      city("Termez", "small", "Surxondaryo", 1),
      city("Jizzakh", "small", "Jizzakh", 1),
      city("Urgench", "small", "Xorazm", 1),
      city("Navoiy", "small", "Navoiy", 1),
      city("Almalyk", "small", "Tashkent Region", 1),
      city("Chirchiq", "small", "Tashkent Region", 1),
      city("Angren", "small", "Tashkent Region", 1),
      city("Guliston", "small", "Sirdaryo", 1),
      city("Bekabad", "town", "Tashkent Region", 1),
      city("Zarafshan", "town", "Navoiy", 1),
      city("Shahrisabz", "town", "Qashqadaryo", 1),
      city("Denov", "town", "Surxondaryo", 1),
      city("Khiva", "town", "Xorazm", 1),
    ],
  },
  football: singleTier(
    {
      tier: 1,
      name: "Uzbekistan Super League",
      shortName: "Super League",
      size: 16,
      status: "professional",
      reputation: 54,
      clubs: {
        reputation: { top: 55, bottom: 44 },
        giants: { count: 2, top: 60, bottom: 58 },
        capacity: { top: 34_000, bottom: 5_000 },
        facilities: { top: 60, bottom: 40 },
        academy: { top: 64, bottom: 44 },
        wageBill: { top: 5_500_000, bottom: 600_000 },
        transferBudget: { top: 1_500_000, bottom: 50_000 },
        foreignShare: 0.15,
        squadSize: [26, 30],
      },
    },
    {
      cups: [
        { kind: "national", name: "Uzbekistan Cup", seededEntry: true, legs: 1, neutralFinal: true, continental: true },
        { kind: "super", name: "Uzbekistan Super Cup", participants: ["champion", "cup-winner"], neutralFinal: true },
      ],
      youth: youth(division("Uzbekistan U-19 League"), division("Uzbekistan U-17 League")),
      // Soviet-era sports-society names alongside plain town names.
      clubNaming: {
        templates: templates(
          `FK {city}:2; {city}:1; Lokomotiv {city}:1; Dinamo {city}:1; Metallurg {city}:1; Neftchi {city}:1;
           Energetik {city}:1; Traktor {city}:1; Spartak {city}:1; Paxtachi {city}:1`,
        ),
        founded: { top: [1945, 2008], bottom: [1960, 2021] },
        colors: ["#0B6E4F", "#FFD100", "#1C3F95", "#E30613", "#FFFFFF", "#000000"],
      },
      importSources: weighted("RS:2 BR:2 NG:2 TJ:2 RU:2 ME:1 GH:1 CM:1 SN:1 CI:1 KG:1 KZ:1 UA:1 BY:1 GE:1 HR:1 BA:1 IR:1 MK:1 TM:1"),
      coefficients: { association: [7, 7.5, 8, 8, 8.5] },
    },
  ),
  abroad: {
    seniors: 25,
    youth: 4,
    destinations: weighted("RU:5 KZ:3 EN:1 TR:2 FR:1 IT:1 SA:1 AE:2 QA:1 IR:2 KR:1 CN:1 BY:1 PT:1"),
  },
};

// ------------------------------------------------------------------ Iraq

const IQ: NationSpec = {
  code: "IQ",
  iso2: "IQ",
  name: "Iraq",
  confederation: "AFC",
  continent: "AS",
  capital: "Baghdad",
  latitude: 33.3,
  languages: languages("ar:8 ku:2"),
  reputation: { national: 65, league: 50 },
  euEea: false,
  physique: { height: 179 },
  // Arab and Kurdish names; the two sides list the same pools in the same order.
  names: { given: [src("iraqi", 8), src("kurdish", 2)], family: [src("iraqi", 8), src("kurdish", 2)] },
  nationality: {
    multipleRate: 0.15,
    tripleRate: 0.015,
    bornAbroadRate: 0.06,
    diasporaPull: 0.75,
    links: [
      ...links("asianDiaspora", "SE:5 DK:2 NO:2 FI:1 NL:3 DE:3 EN:3 US:2 AU:2 CA:1 AT:1"),
      ...links("arabWorld", "SY:2 JO:2 LB:1 EG:1"),
      ...links("regional", "IR:3 TR:1"),
    ],
    // Multiple nationality is allowed since 2006.
    citizenship: allowed,
  },
  cities: {
    major: [
      city("Baghdad", "mega", "Baghdad", 6, "Rusafa|Kadhimiya|Adhamiya|Mansour|Sadr City|Zayouna|Dora|Karrada"),
      city("Basra", "large", "Basra", 2, "Zubair|Abu Al-Khaseeb"),
      city("Mosul", "large", "Nineveh", 1),
      city("Erbil", "large", "Erbil", 1),
      city("Sulaymaniyah", "medium", "Sulaymaniyah", 1),
      city("Kirkuk", "medium", "Kirkuk", 1),
      city("Najaf", "medium", "Najaf", 1),
      city("Karbala", "medium", "Karbala", 1),
      city("Nasiriyah", "medium", "Dhi Qar", 1),
      city("Amarah", "medium", "Maysan", 1),
      city("Diwaniyah", "medium", "Al-Qadisiyah", 1),
      city("Kut", "medium", "Wasit", 1),
      city("Hillah", "medium", "Babil", 1),
      city("Ramadi", "medium", "Anbar", 1),
      city("Fallujah", "medium", "Anbar", 1),
      city("Duhok", "medium", "Duhok", 1),
      city("Samarra", "small", "Saladin", 1),
      city("Baqubah", "small", "Diyala", 1),
      city("Zakho", "small", "Duhok", 1),
      city("Samawah", "small", "Muthanna", 1),
      city("Tikrit", "small", "Saladin", 1),
      city("Kufa", "small", "Najaf", 1),
      city("Halabja", "town", "Halabja", 1),
      city("Soran", "town", "Erbil", 1),
    ],
  },
  football: singleTier(
    {
      tier: 1,
      name: "Iraq Stars League",
      shortName: "Stars League",
      size: 20,
      status: "professional",
      reputation: 50,
      clubs: {
        reputation: { top: 52, bottom: 41 },
        giants: { count: 4, top: 58, bottom: 55 },
        capacity: { top: 60_000, bottom: 5_000 },
        facilities: { top: 50, bottom: 32 },
        academy: { top: 52, bottom: 35 },
        wageBill: { top: 6_000_000, bottom: 700_000 },
        transferBudget: { top: 1_500_000, bottom: 50_000 },
        foreignShare: 0.14,
        squadSize: [26, 30],
      },
    },
    {
      cups: [
        { kind: "national", name: "Iraq FA Cup", seededEntry: true, legs: 1, neutralFinal: true, continental: true },
        { kind: "super", name: "Iraqi Super Cup", participants: ["champion", "cup-winner"], neutralFinal: true },
      ],
      youth: youth(
        division("Iraqi U-19 League", 10, "North|South"),
        division("Iraqi U-17 League", 10, "North|South"),
      ),
      clubNaming: {
        templates: templates("{city} SC:3; Al-{city}:2; {city} FC:1; Naft {city}:1; Shabab {city}:1"),
        founded: { top: [1931, 1990], bottom: [1950, 2012] },
        colors: ["#00843D", "#FFFFFF", "#000000", "#C8102E", "#0055A4", "#FFD100"],
      },
      importSources: weighted("SY:4 JO:3 BR:3 NG:2 GH:2 LB:2 IR:2 CM:1 CI:1 SN:1 MA:1 TN:1 EG:1 PS:1 YE:1 UZ:1 OM:1 BH:1 CO:1"),
      coefficients: { association: [6, 6.5, 6.5, 7, 7.5] },
    },
  ),
  abroad: {
    seniors: 20,
    youth: 4,
    destinations: weighted("SE:4 DK:1 NO:1 NL:1 EN:2 AT:1 US:1 QA:2 SA:1 AE:1 IR:1 TR:1 KR:1 AU:1"),
  },
};

// ------------------------------------------------------------------ United Arab Emirates

const AE: NationSpec = {
  code: "AE",
  iso2: "AE",
  name: "United Arab Emirates",
  confederation: "AFC",
  continent: "AS",
  capital: "Abu Dhabi",
  latitude: 24.5,
  languages: languages("ar:8 en:2"),
  reputation: { national: 62, league: 62 },
  euEea: false,
  physique: { height: 175 },
  names: { given: [src("gulf")], family: [src("emirati", 6), src("khaleeji", 4)] },
  nationality: {
    multipleRate: 0.1,
    tripleRate: 0.008,
    bornAbroadRate: 0.06,
    diasporaPull: 0.8,
    links: [
      ...links("regional", "SA:2 OM:2 YE:2 IR:2 BH:1 QA:1 SO:1"),
      ...links("arabWorld", "SD:1 EG:1"),
      ...links("gulfLabour", "PK:1"),
      // South Americans naturalised in 2021-24.
      ...links("americas", "BR:2 AR:1"),
    ],
    citizenship: restricted,
  },
  cities: {
    major: [
      city("Dubai", "mega", "Dubai", 4, "Deira|Jumeirah|Al Barsha|Mirdif|Al Qusais|Karama"),
      city("Abu Dhabi", "large", "Abu Dhabi", 3, "Khalifa City|Mussafah|Al Bateen|Mohammed Bin Zayed City"),
      city("Sharjah", "large", "Sharjah", 2, "Al Qasimia|Al Majaz"),
      city("Al Ain", "medium", "Abu Dhabi", 1),
      city("Ajman", "medium", "Ajman", 1),
      city("Ras Al Khaimah", "medium", "Ras Al Khaimah", 1),
      city("Fujairah", "small", "Fujairah", 1),
      city("Baniyas", "small", "Abu Dhabi", 1),
      city("Umm Al Quwain", "town", "Umm Al Quwain", 1),
      city("Khor Fakkan", "town", "Sharjah", 1),
      city("Kalba", "town", "Sharjah", 1),
      city("Dibba", "town", "Fujairah", 1),
      city("Madinat Zayed", "town", "Abu Dhabi", 1),
      city("Hatta", "town", "Dubai", 1),
      city("Dhaid", "town", "Sharjah", 1),
    ],
  },
  football: singleTier(
    {
      tier: 1,
      name: "UAE Pro League",
      shortName: "Pro League",
      size: 14,
      status: "professional",
      reputation: 62,
      clubs: {
        reputation: { top: 62, bottom: 51 },
        giants: { count: 3, top: 68, bottom: 65 },
        capacity: { top: 43_000, bottom: 5_000 },
        facilities: { top: 84, bottom: 60 },
        academy: { top: 68, bottom: 50 },
        wageBill: { top: 32_000_000, bottom: 5_000_000 },
        transferBudget: { top: 15_000_000, bottom: 500_000 },
        // Foreign players plus resident and UAE-born foreign categories.
        foreignShare: 0.3,
        squadSize: [26, 30],
      },
    },
    {
      cups: [
        { kind: "national", name: "UAE President's Cup", seededEntry: true, legs: 1, neutralFinal: true, continental: true },
        { kind: "league", name: "UAE League Cup", legs: 2, finalLegs: 1 },
        { kind: "super", name: "UAE Super Cup", participants: ["champion", "cup-winner"], neutralFinal: true },
      ],
      youth: youth(division("UAE U-19 League"), division("UAE U-17 League")),
      clubNaming: {
        templates: templates(
          "{city} Club:2; {city} FC:2; Ittihad {city}:1; Nahdat {city}:1; Shabab {city}:1; Fursan {city}:1; Majd {city}:1",
        ),
        founded: { top: [1945, 1981], bottom: [1965, 1995] },
        colors: ["#6D2077", "#FFFFFF", "#E30613", "#FFD100", "#000000", "#0055A4", "#00843D"],
      },
      importSources: weighted(
        "BR:8 MA:3 DZ:2 TN:1 EG:2 SN:2 NG:2 GH:2 CI:1 CM:1 AR:2 CO:2 UY:1 VE:1 PT:2 ES:2 FR:2 NL:1 RS:1 IR:2 UZ:2 JO:1 SY:1 IQ:1 OM:1 KR:1",
      ),
      coefficients: { association: [10, 10.5, 11.5, 13, 11.5] },
    },
  ),
  abroad: { seniors: 2, youth: 2, destinations: weighted("SA:1 QA:1 PT:1") },
};

// ------------------------------------------------------------------ China PR

const CN: NationSpec = {
  code: "CN",
  iso2: "CN",
  name: "China PR",
  confederation: "AFC",
  continent: "AS",
  capital: "Beijing",
  latitude: 39.9,
  languages: languages("zh:1"),
  reputation: { national: 54, league: 60 },
  euEea: false,
  physique: { height: 180 },
  names: {
    given: [src("chinese")],
    family: [src("chinese-top", 32), src("chinese-common", 43), src("chinese", 25)],
    order: "family-given",
  },
  nationality: {
    multipleRate: 0.03,
    tripleRate: 0.002,
    bornAbroadRate: 0.01,
    diasporaPull: 0.45,
    links: [
      ...links("asianDiaspora", "HK:3 TW:2 MO:1 SG:2 MY:2 US:3 CA:1 AU:1 KR:1"),
      // Naturalised Brazilian and English-born players.
      ...links("regional", "BR:2 EN:1"),
    ],
    // Acquiring another nationality ends Chinese nationality.
    citizenship: restricted,
  },
  cities: {
    major: [
      city("Shanghai", "mega", "Shanghai", 2, "Pudong|Minhang|Baoshan|Songjiang|Jiading|Xuhui"),
      city("Beijing", "mega", "Beijing", 2, "Chaoyang|Haidian|Fengtai|Tongzhou|Changping"),
      city("Chongqing", "mega", "Chongqing", 1),
      city("Guangzhou", "mega", "Guangdong", 2, "Tianhe|Panyu|Baiyun|Huadu"),
      city("Shenzhen", "mega", "Guangdong", 1, "Futian|Nanshan|Longgang"),
      city("Chengdu", "mega", "Sichuan", 1, "Wenjiang|Shuangliu"),
      city("Tianjin", "mega", "Tianjin", 1, "Binhai|Wuqing"),
      city("Wuhan", "mega", "Hubei", 1, "Hankou|Wuchang"),
      city("Xi'an", "large", "Shaanxi", 1),
      city("Hangzhou", "large", "Zhejiang", 1),
      city("Nanjing", "large", "Jiangsu", 1),
      city("Qingdao", "large", "Shandong", 2, "Huangdao|Laoshan|Jimo"),
      city("Jinan", "large", "Shandong", 1),
      city("Dalian", "large", "Liaoning", 1),
      city("Shenyang", "large", "Liaoning", 1),
      city("Zhengzhou", "large", "Henan", 1),
      city("Changsha", "large", "Hunan", 1),
      city("Kunming", "large", "Yunnan", 1),
      city("Harbin", "large", "Heilongjiang", 1),
      city("Changchun", "large", "Jilin", 1),
      city("Suzhou", "large", "Jiangsu", 1),
      city("Xiamen", "large", "Fujian", 1),
      city("Shijiazhuang", "large", "Hebei", 1),
      city("Nanning", "large", "Guangxi", 1),
      city("Hefei", "large", "Anhui", 1),
      city("Nanchang", "large", "Jiangxi", 1),
      city("Taiyuan", "large", "Shanxi", 1),
      city("Guiyang", "large", "Guizhou", 1),
      city("Urumqi", "large", "Xinjiang", 1),
      city("Fuzhou", "large", "Fujian", 1),
      city("Ningbo", "large", "Zhejiang", 1),
      city("Foshan", "large", "Guangdong", 1),
      city("Dongguan", "large", "Guangdong", 1),
      city("Lanzhou", "large", "Gansu", 1),
      city("Wuxi", "medium", "Jiangsu", 1),
      city("Meizhou", "medium", "Guangdong", 1),
      city("Haikou", "medium", "Hainan", 1),
      city("Hohhot", "medium", "Inner Mongolia", 1),
      city("Tangshan", "medium", "Hebei", 1),
      city("Weifang", "medium", "Shandong", 1),
      city("Zibo", "medium", "Shandong", 1),
      city("Luoyang", "medium", "Henan", 1),
      city("Nantong", "medium", "Jiangsu", 1),
      city("Shaoxing", "medium", "Zhejiang", 1),
      city("Wenzhou", "medium", "Zhejiang", 1),
      city("Jinhua", "medium", "Zhejiang", 1),
      city("Zhuhai", "medium", "Guangdong", 1),
      city("Shantou", "medium", "Guangdong", 1),
      city("Baoding", "medium", "Hebei", 1),
      city("Xining", "medium", "Qinghai", 1),
      city("Yinchuan", "medium", "Ningxia", 1),
      city("Yanji", "small", "Jilin", 1),
      city("Dali", "small", "Yunnan"),
      city("Lhasa", "small", "Tibet"),
    ],
  },
  football: singleTier(
    {
      tier: 1,
      name: "Chinese Super League",
      shortName: "CSL",
      size: 16,
      status: "professional",
      reputation: 60,
      clubs: {
        reputation: { top: 61, bottom: 49 },
        giants: { count: 2, top: 66, bottom: 64 },
        capacity: { top: 68_000, bottom: 15_000 },
        facilities: { top: 72, bottom: 52 },
        academy: { top: 64, bottom: 46 },
        // Salary caps since 2021 keep payrolls far below the 2016-19 peak.
        wageBill: { top: 30_000_000, bottom: 4_000_000 },
        transferBudget: { top: 6_000_000, bottom: 200_000 },
        foreignShare: 0.17,
        squadSize: [27, 32],
      },
    },
    {
      cups: [
        { kind: "national", name: "Chinese FA Cup", seededEntry: true, legs: 1, continental: true },
        { kind: "super", name: "Chinese FA Super Cup", participants: ["champion", "cup-winner"] },
      ],
      youth: youth(
        division("China Youth Football League U19", 8, "North|South"),
        division("China Youth Football League U17", 8, "North|South"),
      ),
      // City or province plus a neutral pinyin nickname (corporate names are banned since 2021).
      clubNaming: {
        templates: templates(
          `{city} Longwei:1; {city} Feiyun:1; {city} Jinying:1; {city} Tiema:1; {city} Hongxing:1; {city} Chenguang:1;
           {city} Fenghuang:1; {city} Tianma:1; {city} Zhanlong:1; {city} Haiyan:1; {city} Leiting:1; {city} Yinhe:1;
           {region} Fenghuang:1; {region} Tianma:1; {region} Leiting:1; {city} FC:1`,
        ),
        founded: { top: [1951, 2018], bottom: [1990, 2022] },
        colors: ["#E30613", "#003DA5", "#FFD100", "#00843D", "#F58220", "#000000", "#6CACE4"],
      },
      importSources: weighted(
        "BR:12 PT:2 ES:2 RS:2 NG:2 CO:2 KR:3 HR:1 BA:1 ME:1 CM:1 CI:1 GH:1 SN:1 CD:1 AR:1 UY:1 VE:1 JP:1 AU:1 NL:1 FR:1 GE:1 MK:1 SI:1",
      ),
      coefficients: { association: [7, 4, 6.5, 8.5, 9] },
    },
  ),
  abroad: { seniors: 4, youth: 6, destinations: weighted("PT:2 JP:1 ES:1 DE:1") },
};

// ------------------------------------------------------------------ Vietnam

const VN: NationSpec = {
  code: "VN",
  iso2: "VN",
  name: "Vietnam",
  confederation: "AFC",
  continent: "AS",
  capital: "Hanoi",
  latitude: 21,
  languages: languages("vi:1"),
  reputation: { national: 49, league: 48 },
  euEea: false,
  physique: { height: 172 },
  names: {
    given: [faker("vi")],
    family: [src("vietnamese-nguyen", 35), src("vietnamese-common", 50), src("vietnamese", 15)],
    order: "family-given",
  },
  nationality: {
    multipleRate: 0.05,
    tripleRate: 0.003,
    bornAbroadRate: 0.02,
    diasporaPull: 0.5,
    links: [
      ...links("asianDiaspora", "FR:3 US:3 CZ:2 RU:2 DE:2 PL:1 AU:2 CA:1 NO:1 KR:2 CN:1 LA:1 KH:1 TH:1"),
      // Naturalised Brazilians.
      ...links("americas", "BR:1"),
    ],
    // Single nationality, with exceptions for overseas Vietnamese and approved naturalisations.
    citizenship: partners("FR US CZ RU DE PL AU CA NO BR"),
  },
  cities: {
    major: [
      city("Hanoi", "mega", "Hanoi", 3, "Cau Giay|Long Bien|Dong Da|Hoang Mai|Ha Dong"),
      city("Ho Chi Minh City", "mega", "Ho Chi Minh City", 2, "Thu Duc|Binh Thanh|Go Vap|Tan Binh"),
      city("Haiphong", "large", "Haiphong", 1),
      city("Da Nang", "large", "Da Nang", 1),
      city("Can Tho", "large", "Can Tho", 1),
      city("Bien Hoa", "medium", "Dong Nai", 1),
      city("Thu Dau Mot", "medium", "Binh Duong", 1),
      city("Nha Trang", "medium", "Khanh Hoa", 1),
      city("Hue", "medium", "Hue", 1),
      city("Vinh", "medium", "Nghe An", 1),
      city("Thanh Hoa", "medium", "Thanh Hoa", 1),
      city("Nam Dinh", "medium", "Nam Dinh", 1),
      city("Buon Ma Thuot", "medium", "Dak Lak", 1),
      city("Pleiku", "medium", "Gia Lai", 1),
      city("Quy Nhon", "medium", "Binh Dinh", 1),
      city("Vung Tau", "medium", "Ba Ria-Vung Tau", 1),
      city("Hai Duong", "medium", "Hai Duong", 1),
      city("Thai Nguyen", "medium", "Thai Nguyen", 1),
      city("Ha Long", "medium", "Quang Ninh", 1),
      city("Long Xuyen", "medium", "An Giang", 1),
      city("Ha Tinh", "small", "Ha Tinh", 1),
      city("Ninh Binh", "small", "Ninh Binh", 1),
      city("Viet Tri", "small", "Phu Tho", 1),
      city("Bac Ninh", "small", "Bac Ninh", 1),
      city("Cao Lanh", "small", "Dong Thap", 1),
      city("Da Lat", "small", "Lam Dong", 1),
      city("Quang Ngai", "small", "Quang Ngai", 1),
      city("Tam Ky", "small", "Quang Nam", 1),
      city("Phan Thiet", "small", "Binh Thuan", 1),
      city("Tay Ninh", "small", "Tay Ninh", 1),
      city("Rach Gia", "small", "Kien Giang", 1),
      city("My Tho", "small", "Tien Giang", 1),
      city("Ca Mau", "small", "Ca Mau", 1),
    ],
  },
  football: singleTier(
    {
      tier: 1,
      name: "V.League 1",
      shortName: "V.League 1",
      size: 14,
      status: "professional",
      reputation: 48,
      clubs: {
        reputation: { top: 51, bottom: 41 },
        giants: { count: 2, top: 55, bottom: 54 },
        capacity: { top: 40_000, bottom: 10_000 },
        facilities: { top: 52, bottom: 34 },
        academy: { top: 62, bottom: 40 },
        wageBill: { top: 4_500_000, bottom: 900_000 },
        transferBudget: { top: 1_200_000, bottom: 50_000 },
        foreignShare: 0.12,
        squadSize: [26, 32],
      },
    },
    {
      cups: [
        { kind: "national", name: "Vietnamese National Cup", seededEntry: true, legs: 1, continental: true },
        { kind: "super", name: "Vietnamese Super Cup", participants: ["champion", "cup-winner"] },
      ],
      youth: youth(
        division("Vietnamese National U-19 Championship", 8, "North|South"),
        division("Vietnamese National U-17 Championship", 8, "North|South"),
      ),
      clubNaming: {
        templates: templates(
          "{city} FC:1; CLB {city}:1; {region} FC:1; Sao Vàng {city}:1; Hoàng Long {city}:1; Phương Nam {city}:1",
        ),
        founded: { top: [1952, 2008], bottom: [1970, 2023] },
        colors: ["#DA251D", "#FFCD00", "#0055A4", "#00843D", "#FFFFFF", "#F58220", "#6D2077"],
      },
      importSources: weighted("BR:8 NG:2 JP:2 KR:2 CM:1 GH:1 CI:1 SN:1 RS:1 ES:1 AR:1 CO:1 AU:1 HR:1 ME:1"),
      coefficients: { association: [4.5, 5, 5.5, 5, 4.5] },
    },
  ),
  abroad: { seniors: 3, youth: 3, destinations: weighted("JP:1 KR:1 TH:1 FR:1") },
};

// ------------------------------------------------------------------ Thailand

const TH: NationSpec = {
  code: "TH",
  iso2: "TH",
  name: "Thailand",
  confederation: "AFC",
  continent: "AS",
  capital: "Bangkok",
  latitude: 13.8,
  languages: languages("th:1"),
  reputation: { national: 52, league: 54 },
  euEea: false,
  physique: { height: 172 },
  names: { given: [src("thai")], family: [src("thai")] },
  nationality: {
    // Thai-European players are prominent in the national team but a small share of the league.
    multipleRate: 0.08,
    tripleRate: 0.004,
    bornAbroadRate: 0.03,
    diasporaPull: 0.55,
    links: [
      ...links("asianDiaspora", "SE:2 DK:1 NO:1 DE:1 CH:1 FR:1 EN:2 US:2 AU:1 JP:1 NL:1 BE:1"),
      ...links("regional", "LA:2 KH:1 MM:1 MY:1"),
    ],
    citizenship: allowed,
  },
  cities: {
    major: [
      city("Bangkok", "mega", "Bangkok", 4, "Bang Kapi|Lat Krabang|Nong Chok|Min Buri|Thon Buri|Bang Khen"),
      city("Nonthaburi", "large", "Nonthaburi", 1),
      city("Pathum Thani", "medium", "Pathum Thani", 1),
      city("Samut Prakan", "medium", "Samut Prakan", 1),
      city("Chiang Mai", "medium", "Chiang Mai", 1),
      city("Nakhon Ratchasima", "medium", "Nakhon Ratchasima", 1),
      city("Khon Kaen", "medium", "Khon Kaen", 1),
      city("Udon Thani", "medium", "Udon Thani", 1),
      city("Chonburi", "medium", "Chonburi", 1),
      city("Pattaya", "medium", "Chonburi", 1),
      city("Hat Yai", "medium", "Songkhla", 1),
      city("Ubon Ratchathani", "medium", "Ubon Ratchathani", 1),
      city("Buriram", "small", "Buriram", 1),
      city("Rayong", "small", "Rayong", 1),
      city("Ratchaburi", "small", "Ratchaburi", 1),
      city("Chiang Rai", "small", "Chiang Rai", 1),
      city("Nakhon Si Thammarat", "small", "Nakhon Si Thammarat", 1),
      city("Surat Thani", "small", "Surat Thani", 1),
      city("Phitsanulok", "small", "Phitsanulok", 1),
      city("Nakhon Sawan", "small", "Nakhon Sawan", 1),
      city("Lampang", "small", "Lampang", 1),
      city("Kanchanaburi", "small", "Kanchanaburi", 1),
      city("Ayutthaya", "small", "Phra Nakhon Si Ayutthaya", 1),
      city("Suphan Buri", "small", "Suphan Buri", 1),
      city("Nakhon Pathom", "small", "Nakhon Pathom", 1),
      city("Samut Sakhon", "small", "Samut Sakhon", 1),
      city("Phuket", "small", "Phuket", 1),
      city("Si Racha", "small", "Chonburi", 1),
      city("Yala", "small", "Yala", 1),
      city("Pattani", "small", "Pattani", 1),
      city("Lamphun", "town", "Lamphun", 1),
      city("Sukhothai", "town", "Sukhothai", 1),
      city("Uthai Thani", "town", "Uthai Thani", 1),
      city("Prachuap Khiri Khan", "town", "Prachuap Khiri Khan", 1),
      city("Nong Bua Lamphu", "town", "Nong Bua Lamphu", 1),
      city("Sisaket", "town", "Sisaket", 1),
      city("Chainat", "town", "Chainat", 1),
      city("Trat", "town", "Trat", 1),
      city("Nan", "town", "Nan", 1),
      city("Narathiwat", "town", "Narathiwat", 1),
    ],
  },
  football: singleTier(
    {
      tier: 1,
      name: "Thai League 1",
      shortName: "T1",
      size: 16,
      status: "professional",
      reputation: 54,
      clubs: {
        reputation: { top: 56, bottom: 45 },
        giants: { count: 2, top: 62, bottom: 59 },
        capacity: { top: 32_600, bottom: 5_000 },
        facilities: { top: 64, bottom: 42 },
        academy: { top: 56, bottom: 38 },
        wageBill: { top: 11_000_000, bottom: 1_200_000 },
        transferBudget: { top: 3_000_000, bottom: 100_000 },
        foreignShare: 0.24,
        squadSize: [26, 32],
      },
    },
    {
      cups: [
        { kind: "national", name: "Thai FA Cup", seededEntry: true, legs: 1, neutralFinal: true, continental: true },
        { kind: "league", name: "Thai League Cup", legs: 1, neutralFinal: true },
        {
          kind: "super",
          name: "Thailand Champions Cup",
          participants: ["champion", "cup-winner"],
          neutralFinal: true,
          start: "08-02",
        },
      ],
      youth: youth(division("Thailand Youth League U19"), division("Thailand Youth League U17")),
      // Province name plus an English suffix, the Thai League convention.
      clubNaming: {
        templates: templates(
          `{city} FC:1; {city} City:1; {city} Athletic:1; {city} Rangers:1; {city} Stallions:1; {city} Tigers:1;
           {city} Eagles:1; {city} Phoenix:1; {city} Dragons:1; {city} Kings:1`,
        ),
        founded: { top: [1967, 2012], bottom: [1995, 2022] },
        colors: ["#0033A0", "#E30613", "#FFD100", "#00843D", "#F58220", "#6D2077", "#000000"],
      },
      importSources: weighted(
        "BR:8 JP:5 KR:4 ES:2 PT:2 RS:2 MM:2 ME:1 NG:1 CM:1 CI:1 SN:1 GH:1 AU:1 PH:1 LA:1 KH:1 VN:1 ID:1 MY:1 SG:1 CO:1 AR:1 UZ:1 NL:1 FR:1",
      ),
      coefficients: { association: [8, 8.5, 8.5, 8, 8.5] },
    },
  ),
  abroad: { seniors: 12, youth: 3, destinations: weighted("JP:6 BE:1 AU:1 SE:1 DK:1 KR:1 PT:1") },
};

// ------------------------------------------------------------------ India

const IN_NAMES = [
  src("northeast-india", 26),
  src("bengali", 16),
  src("malayali", 16),
  src("punjabi", 10),
  src("goan", 8),
  src("hindi", 10),
  src("indian-muslim", 8),
  src("tamil", 6),
];
const IN: NationSpec = {
  code: "IN",
  iso2: "IN",
  name: "India",
  confederation: "AFC",
  continent: "AS",
  capital: "New Delhi",
  latitude: 28.6,
  languages: languages("hi:5 en:3 bn:2 ml:2 ta:1 pa:1 kn:1 te:1 mni:1"),
  reputation: { national: 43, league: 46 },
  euEea: false,
  physique: { height: 174 },
  // Football regions (Northeast, Bengal, Kerala, Punjab, Goa...); both sides list the same pools in the same order.
  names: { given: IN_NAMES, family: IN_NAMES },
  nationality: {
    multipleRate: 0.03,
    tripleRate: 0.002,
    bornAbroadRate: 0.01,
    diasporaPull: 0.3,
    links: [
      ...links("regional", "NP:3 BD:2 BT:1"),
      ...links("commonwealth", "EN:3 CA:2 AU:1"),
      ...links("asianDiaspora", "US:2"),
      ...links("lusophone", "PT:1"),
    ],
    // No dual citizenship; Overseas Citizens of India cannot play for India.
    citizenship: restricted,
  },
  cities: {
    // Kolkata leads: the heart of Indian club football.
    major: [
      city("Kolkata", "mega", "West Bengal", 3, "Salt Lake|Howrah|Barasat|Behala|Dum Dum"),
      city("Mumbai", "mega", "Maharashtra", 1, "Andheri|Thane|Navi Mumbai|Bandra"),
      city("Delhi", "mega", "Delhi", 1, "Dwarka|Rohini|Saket|Karol Bagh"),
      city("Bengaluru", "mega", "Karnataka", 1),
      city("Chennai", "mega", "Tamil Nadu", 1),
      city("Hyderabad", "mega", "Telangana", 1),
      city("Pune", "large", "Maharashtra", 1),
      city("Ahmedabad", "large", "Gujarat", 1),
      city("Jaipur", "large", "Rajasthan", 1),
      city("Lucknow", "large", "Uttar Pradesh", 1),
      city("Ludhiana", "large", "Punjab", 1),
      city("Srinagar", "large", "Jammu and Kashmir", 1),
      city("Nagpur", "large", "Maharashtra", 1),
      city("Coimbatore", "large", "Tamil Nadu", 1),
      city("Bhopal", "large", "Madhya Pradesh", 1),
      city("Indore", "large", "Madhya Pradesh", 1),
      city("Patna", "large", "Bihar", 1),
      city("Varanasi", "medium", "Uttar Pradesh", 1),
      city("Kochi", "medium", "Kerala", 1),
      city("Thiruvananthapuram", "medium", "Kerala", 1),
      city("Kozhikode", "medium", "Kerala", 1),
      city("Thrissur", "medium", "Kerala", 1),
      city("Guwahati", "medium", "Assam", 1),
      city("Jamshedpur", "medium", "Jharkhand", 1),
      city("Bhubaneswar", "medium", "Odisha", 1),
      city("Imphal", "medium", "Manipur", 1),
      city("Shillong", "medium", "Meghalaya", 1),
      city("Jalandhar", "medium", "Punjab", 1),
      city("Siliguri", "medium", "West Bengal", 1),
      city("Durgapur", "medium", "West Bengal", 1),
      city("Cuttack", "medium", "Odisha", 1),
      city("Chandigarh", "medium", "Chandigarh", 1),
      city("Ranchi", "medium", "Jharkhand", 1),
      city("Dehradun", "medium", "Uttarakhand", 1),
      city("Aizawl", "small", "Mizoram", 1),
      city("Margao", "small", "Goa", 1),
      city("Panaji", "small", "Goa", 1),
      city("Vasco da Gama", "small", "Goa", 1),
      city("Malappuram", "small", "Kerala", 1),
      city("Kannur", "small", "Kerala", 1),
      city("Mohali", "small", "Punjab", 1),
      city("Gangtok", "small", "Sikkim", 1),
      city("Kohima", "town", "Nagaland", 1),
      city("Mapusa", "town", "Goa", 1),
    ],
  },
  football: singleTier(
    {
      tier: 1,
      name: "Indian Super League",
      shortName: "ISL",
      size: 14,
      status: "professional",
      reputation: 46,
      // Top six play off; the League Winners' Shield (regular season) takes the league access place.
      championship: { positions: [1, 6], legs: 2, finalLegs: 1 },
      clubs: {
        reputation: { top: 48, bottom: 38 },
        giants: { count: 2, top: 53, bottom: 51 },
        capacity: { top: 68_000, bottom: 8_000 },
        facilities: { top: 56, bottom: 38 },
        academy: { top: 52, bottom: 35 },
        wageBill: { top: 4_000_000, bottom: 1_200_000 },
        transferBudget: { top: 800_000, bottom: 20_000 },
        foreignShare: 0.2,
        squadSize: [27, 35],
      },
    },
    {
      cups: [
        { kind: "national", name: "AIFF Super Cup", seededEntry: true, legs: 1, continental: true },
        // The historic Durand Cup opens the season in late July.
        { kind: "league", name: "Durand Cup", legs: 1, start: "07-25" },
      ],
      youth: youth(division("Reliance Foundation Development League"), division("AIFF U-17 Youth League")),
      clubNaming: {
        templates: templates(
          `{city} FC:1; {city} United:1; {region} FC:1; Sporting {city}:1; {city} Athletic:1; {region} Titans:1;
           {city} Strikers:1; {region} Warriors:1; {city} City:1`,
        ),
        founded: { top: [1889, 2020], bottom: [1950, 2023] },
        colors: ["#FF6600", "#003DA5", "#FFD100", "#8B0000", "#00843D", "#000000", "#6CACE4"],
      },
      importSources: weighted(
        "ES:4 AU:3 BR:2 GR:2 EN:1 SCO:1 IE:1 HR:1 RS:1 ME:1 BA:1 PT:1 FR:1 AR:1 UY:1 CO:1 NG:1 GH:1 SN:1 JP:1 UZ:1 IR:1 AF:1 NP:1 BT:1 MA:1",
      ),
      coefficients: { association: [4, 4.5, 4, 3.5, 3] },
    },
  ),
  abroad: { seniors: 2, youth: 2, destinations: weighted("SCO:1 US:1 AU:1") },
};

// ------------------------------------------------------------------ Indonesia

const ID: NationSpec = {
  code: "ID",
  iso2: "ID",
  name: "Indonesia",
  confederation: "AFC",
  continent: "AS",
  capital: "Jakarta",
  latitude: -6.2,
  languages: languages("id:8 jv:2"),
  reputation: { national: 48, league: 47 },
  euEea: false,
  physique: { height: 170 },
  names: { given: [src("indonesian", 4), faker("id_ID", 1)], family: [src("indonesian", 4), faker("id_ID", 1)] },
  nationality: {
    multipleRate: 0.06,
    tripleRate: 0.005,
    bornAbroadRate: 0.03,
    diasporaPull: 0.65,
    links: [
      ...links("dutchDiaspora", "NL:8 SR:1 BE:1"),
      ...links("asianDiaspora", "MY:2 CN:1 AU:1 US:1 TL:1"),
      // Naturalised players from Brazil, Nigeria, Uruguay, Spain, Italy and England.
      ...links("regional", "BR:1 NG:1 UY:1 ES:1 IT:1 EN:1"),
    ],
    // No dual citizenship for adults: heritage players give up their Dutch passport.
    citizenship: restricted,
  },
  cities: {
    major: [
      city("Jakarta", "mega", "Jakarta", 2, "Kemayoran|Cilandak|Cengkareng|Tanjung Priok|Kebayoran|Cakung"),
      city("Surabaya", "large", "East Java", 1),
      city("Bandung", "large", "West Java", 1),
      city("Medan", "large", "North Sumatra", 1),
      city("Bekasi", "large", "West Java", 1),
      city("Tangerang", "large", "Banten", 2),
      city("Depok", "large", "West Java", 1),
      city("Semarang", "large", "Central Java", 1),
      city("Palembang", "large", "South Sumatra", 1),
      city("Makassar", "large", "South Sulawesi", 1),
      city("Bogor", "medium", "West Java", 1),
      city("Batam", "medium", "Riau Islands", 1),
      city("Pekanbaru", "medium", "Riau", 1),
      city("Bandar Lampung", "medium", "Lampung", 1),
      city("Padang", "medium", "West Sumatra", 1),
      city("Malang", "medium", "East Java", 1),
      city("Denpasar", "medium", "Bali", 1),
      city("Samarinda", "medium", "East Kalimantan", 1),
      city("Banjarmasin", "medium", "South Kalimantan", 1),
      city("Balikpapan", "medium", "East Kalimantan", 1),
      city("Yogyakarta", "medium", "Yogyakarta", 1),
      city("Surakarta", "medium", "Central Java", 1),
      city("Pontianak", "medium", "West Kalimantan", 1),
      city("Manado", "medium", "North Sulawesi", 1),
      city("Jambi", "medium", "Jambi", 1),
      city("Serang", "medium", "Banten", 1),
      city("Sleman", "medium", "Yogyakarta", 1),
      city("Sidoarjo", "medium", "East Java", 1),
      city("Tasikmalaya", "medium", "West Java", 1),
      city("Cirebon", "small", "West Java", 1),
      city("Kediri", "small", "East Java", 1),
      city("Gresik", "small", "East Java", 1),
      city("Jayapura", "small", "Papua", 1),
      city("Kupang", "small", "East Nusa Tenggara", 1),
      city("Mataram", "small", "West Nusa Tenggara", 1),
      city("Ambon", "small", "Maluku", 1),
      city("Ternate", "small", "North Maluku", 1),
      city("Jepara", "small", "Central Java", 1),
      city("Pamekasan", "small", "East Java", 1),
      city("Lamongan", "small", "East Java", 1),
      city("Kudus", "small", "Central Java", 1),
      city("Banda Aceh", "small", "Aceh", 1),
      city("Palu", "small", "Central Sulawesi", 1),
      city("Biak", "town", "Papua", 1),
    ],
  },
  football: singleTier(
    {
      tier: 1,
      // Liga 1 was renamed Super League for 2025/26.
      name: "Super League",
      shortName: "Super League",
      size: 18,
      status: "professional",
      reputation: 47,
      clubs: {
        reputation: { top: 48, bottom: 38 },
        giants: { count: 3, top: 53, bottom: 50 },
        capacity: { top: 77_000, bottom: 10_000 },
        facilities: { top: 50, bottom: 30 },
        academy: { top: 46, bottom: 30 },
        wageBill: { top: 5_000_000, bottom: 800_000 },
        transferBudget: { top: 1_000_000, bottom: 20_000 },
        // Up to eleven foreign players registered in 2025/26.
        foreignShare: 0.3,
        squadSize: [25, 30],
      },
    },
    {
      cups: [
        // No national cup: the Piala Indonesia has been dormant since 2019.
        { kind: "league", name: "Piala Presiden", maxEntrants: 8, legs: 1, neutralFinal: true, start: "07-06" },
      ],
      youth: youth(
        division("Elite Pro Academy U-18", 9, "Group A|Group B"),
        division("Elite Pro Academy U-16", 9, "Group A|Group B"),
      ),
      // "PS" (Persatuan Sepakbola) plus the town, the Perserikatan tradition.
      clubNaming: {
        templates: templates("PS {city}:3; {city} United:2; {city} FC:1; Putra {city}:1; {city} Putra:1; Mitra {city}:1"),
        founded: { top: [1915, 2021], bottom: [1950, 2023] },
        colors: ["#0033A0", "#E30613", "#FF6600", "#00843D", "#FFD100", "#000000", "#6CACE4"],
      },
      importSources: weighted(
        "BR:6 NL:3 ES:3 AR:2 PT:2 JP:2 KR:2 CO:1 UY:1 AU:1 NG:1 CM:1 GH:1 SN:1 CI:1 RS:1 ME:1 HR:1 BA:1 FR:1 BE:1 TH:1 MY:1 PH:1 SG:1 TL:1 IR:1 UZ:1",
      ),
      coefficients: { association: [3, 3.5, 3.5, 4, 4.5] },
    },
  ),
  abroad: {
    seniors: 18,
    youth: 6,
    destinations: weighted("NL:6 IT:2 DE:1 FR:1 EN:2 BE:2 US:1 JP:1 TH:2 SK:1 KR:1 AU:1"),
  },
};

// ------------------------------------------------------------------ Philippines

const PH: NationSpec = {
  code: "PH",
  iso2: "PH",
  name: "Philippines",
  confederation: "AFC",
  continent: "AS",
  capital: "Manila",
  latitude: 14.6,
  languages: languages("tl:6 en:3 ceb:1"),
  reputation: { national: 41, league: 32 },
  euEea: false,
  physique: { height: 174 },
  names: { given: [src("filipino")], family: [src("filipino")] },
  nationality: {
    // Filipino-American, Filipino-European and Filipino-Japanese families; the Azkals rely on them.
    multipleRate: 0.3,
    tripleRate: 0.04,
    bornAbroadRate: 0.15,
    diasporaPull: 0.6,
    links: [
      ...links("asianDiaspora", "US:8 JP:2 AU:2 CA:2 KR:1 GU:1"),
      ...links("mediterranean", "ES:3 IT:1"),
      ...links("crossBorder", "DE:3 CH:1 DK:1 NO:1 SE:1 NL:1"),
      ...links("commonwealth", "EN:2"),
    ],
    citizenship: allowed,
  },
  cities: {
    major: [
      city("Manila", "mega", "Metro Manila", 2, "Makati|Pasig|Mandaluyong|Paranaque|Marikina|Las Pinas"),
      city("Quezon City", "large", "Metro Manila", 1),
      city("Davao City", "large", "Davao", 1),
      city("Taguig", "medium", "Metro Manila", 1),
      city("Cebu City", "medium", "Central Visayas", 1),
      city("Zamboanga City", "medium", "Zamboanga Peninsula", 1),
      city("Antipolo", "medium", "Calabarzon", 1),
      city("Cagayan de Oro", "medium", "Northern Mindanao", 1),
      city("Iloilo City", "medium", "Western Visayas", 1),
      city("Bacolod", "medium", "Western Visayas", 1),
      city("General Santos", "medium", "Soccsksargen", 1),
      city("Calamba", "medium", "Calabarzon", 1),
      city("Biñan", "medium", "Calabarzon", 1),
      city("Lapu-Lapu", "medium", "Central Visayas", 1),
      city("Angeles", "medium", "Central Luzon", 1),
      city("Imus", "medium", "Calabarzon", 1),
      city("Batangas City", "medium", "Calabarzon", 1),
      city("Baguio", "small", "Cordillera", 1),
      city("Iligan", "small", "Northern Mindanao", 1),
      city("Tacloban", "small", "Eastern Visayas", 1),
      city("Butuan", "small", "Caraga", 1),
      city("Olongapo", "small", "Central Luzon", 1),
      city("Dumaguete", "small", "Central Visayas", 1),
      city("Tagum", "small", "Davao", 1),
      city("Puerto Princesa", "small", "Mimaropa", 1),
      city("Legazpi", "small", "Bicol", 1),
      city("Naga", "small", "Bicol", 1),
      city("San Fernando", "small", "Central Luzon", 1),
      city("Carmona", "town", "Calabarzon", 1),
    ],
  },
  football: singleTier(
    {
      tier: 1,
      name: "Philippines Football League",
      shortName: "PFL",
      size: 12,
      status: "semi-professional",
      reputation: 32,
      clubs: {
        reputation: { top: 38, bottom: 26 },
        giants: { count: 2, top: 42, bottom: 40 },
        capacity: { top: 12_000, bottom: 1_000 },
        facilities: { top: 36, bottom: 20 },
        academy: { top: 36, bottom: 22 },
        wageBill: { top: 900_000, bottom: 60_000 },
        transferBudget: { top: 100_000, bottom: 0 },
        foreignShare: 0.25,
        squadSize: [25, 28],
      },
    },
    {
      cups: [{ kind: "national", name: "Copa Paulino Alcantara", legs: 1, continental: true }],
      youth: youth(division("PFF U-19 National Championship"), division("PFF U-17 National Championship")),
      clubNaming: {
        templates: templates(
          `{city} FC:2; {city} United:1; Sporting {city}:1; {city} Athletic:1; {city} Mariners:1; {city} Eagles:1;
           {city} Dynamo:1; {city} Cobras:1`,
        ),
        founded: { top: [1991, 2021], bottom: [2000, 2023] },
        colors: ["#0038A8", "#CE1126", "#FCD116", "#000000", "#00843D", "#FFFFFF"],
      },
      importSources: weighted("JP:3 KR:3 ES:3 BR:2 US:2 EN:1 NG:1 GH:1 CM:1 CI:1 SN:1 AU:1 IR:1 TL:1 ID:1"),
      coefficients: { association: [2.5, 2.5, 3, 3, 3.5] },
    },
  ),
  abroad: {
    seniors: 20,
    youth: 5,
    destinations: weighted("TH:5 DE:2 DK:1 NO:1 SE:1 EN:1 ES:1 JP:2 KR:1 AU:1 US:2 CH:1 IT:1"),
  },
};

// ------------------------------------------------------------------ home-pool nations (no own league)

const AF = homeNation({
  code: "AF",
  name: "Afghanistan",
  capital: "Kabul",
  latitude: 34.5,
  languages: languages("ps:5 fa:5"),
  reputation: { national: 36, league: 22 },
  physique: { height: 177 },
  names: { given: [src("afghan", 3), src("persian", 1)], family: [src("afghan")] },
  nationality: {
    // The national team relies on the diaspora in Germany, the Netherlands and Scandinavia.
    multipleRate: 0.3,
    tripleRate: 0.04,
    bornAbroadRate: 0.3,
    diasporaPull: 0.6,
    links: [
      ...links("regional", "IR:5 PK:4 TJ:1 UZ:1 IN:1"),
      ...links("asianDiaspora", "DE:4 NL:3 SE:2 NO:2 DK:2 EN:2 US:2 AU:2"),
    ],
    citizenship: allowed,
  },
  cities: {
    major: [
      city("Kabul", "mega", "Kabul"),
      city("Kandahar", "large", "Kandahar"),
      city("Herat", "large", "Herat"),
      city("Mazar-i-Sharif", "large", "Balkh"),
      city("Jalalabad", "medium", "Nangarhar"),
      city("Kunduz", "medium", "Kunduz"),
      city("Ghazni", "small", "Ghazni"),
      city("Khost", "small", "Khost"),
      city("Lashkar Gah", "small", "Helmand"),
      city("Taloqan", "small", "Takhar"),
      city("Pul-e Khumri", "small", "Baghlan"),
      city("Bamyan", "town", "Bamyan"),
    ],
  },
  homePool: { seniors: 45, youth: 40 },
  abroad: { seniors: 22, youth: 6, destinations: weighted("DE:4 NL:3 SE:2 NO:2 DK:1 EN:1 AU:2 US:2 IN:2 IR:2 UZ:1") },
});

const BH = homeNation({
  code: "BH",
  name: "Bahrain",
  capital: "Manama",
  latitude: 26.2,
  languages: languages("ar:1"),
  reputation: { national: 58, league: 44 },
  physique: { height: 176 },
  names: { given: [src("gulf")], family: [src("bahraini", 6), src("khaleeji", 4)] },
  nationality: {
    multipleRate: 0.08,
    tripleRate: 0.005,
    bornAbroadRate: 0.05,
    diasporaPull: 0.8,
    links: [
      ...links("regional", "SA:2 IR:2 KW:1 QA:1 AE:1 IQ:1"),
      ...links("arabWorld", "SY:1 EG:1 JO:1"),
      // Naturalised African players.
      ...links("gulfLabour", "NG:1 KE:1"),
    ],
    citizenship: restricted,
  },
  cities: {
    major: [
      city("Manama", "large", "Capital"),
      city("Muharraq", "medium", "Muharraq"),
      city("Riffa", "medium", "Southern"),
      city("Hamad Town", "medium", "Northern"),
      city("Isa Town", "small", "Southern"),
      city("Sitra", "small", "Capital"),
      city("Budaiya", "small", "Northern"),
      city("A'ali", "small", "Northern"),
      city("Jidhafs", "small", "Capital"),
      city("Zallaq", "town", "Southern"),
    ],
  },
  homePool: { seniors: 70, youth: 45 },
  abroad: { seniors: 10, youth: 2, destinations: weighted("IQ:3 QA:2 SA:2 AE:1") },
});

const BD = homeNation({
  code: "BD",
  name: "Bangladesh",
  capital: "Dhaka",
  latitude: 23.8,
  languages: languages("bn:1"),
  reputation: { national: 28, league: 30 },
  physique: { height: 170 },
  names: { given: [src("bangladeshi")], family: [src("bangladeshi")] },
  nationality: {
    multipleRate: 0.06,
    tripleRate: 0.004,
    bornAbroadRate: 0.05,
    diasporaPull: 0.5,
    links: [
      ...links("regional", "IN:4"),
      ...links("commonwealth", "EN:4 CA:1 AU:1"),
      ...links("asianDiaspora", "US:2 IT:1 DK:1 FI:1"),
    ],
    // Dual citizenship for people of Bangladeshi origin in most countries outside South Asia.
    citizenship: partners("GB US CA AU NZ IT FR DE SE DK FI NO NL BE IE ES PT JP KR"),
  },
  cities: {
    major: [
      city("Dhaka", "mega", "Dhaka"),
      city("Chittagong", "large", "Chittagong"),
      city("Gazipur", "large", "Dhaka"),
      city("Khulna", "medium", "Khulna"),
      city("Rajshahi", "medium", "Rajshahi"),
      city("Sylhet", "medium", "Sylhet"),
      city("Narayanganj", "medium", "Dhaka"),
      city("Comilla", "medium", "Chittagong"),
      city("Rangpur", "medium", "Rangpur"),
      city("Mymensingh", "medium", "Mymensingh"),
      city("Barisal", "medium", "Barisal"),
      city("Bogra", "small", "Rajshahi"),
      city("Jessore", "small", "Khulna"),
      city("Cox's Bazar", "small", "Chittagong"),
    ],
  },
  homePool: { seniors: 70, youth: 45 },
  abroad: { seniors: 5, youth: 2, destinations: weighted("EN:2 IN:1 IT:1 FI:1") },
});

const BT = homeNation({
  code: "BT",
  name: "Bhutan",
  capital: "Thimphu",
  latitude: 27.5,
  languages: languages("dz:1"),
  reputation: { national: 29, league: 18 },
  physique: { height: 170 },
  names: { given: [src("bhutanese")], family: [src("bhutanese")] },
  nationality: {
    multipleRate: 0.03,
    tripleRate: 0,
    bornAbroadRate: 0.02,
    diasporaPull: 0.6,
    links: links("regional", "IN:2 NP:2 CN:1"),
    citizenship: restricted,
  },
  cities: {
    major: [
      city("Thimphu", "small", "Thimphu"),
      city("Phuntsholing", "small", "Chukha"),
      city("Paro", "town", "Paro"),
      city("Gelephu", "town", "Sarpang"),
      city("Samdrup Jongkhar", "town", "Samdrup Jongkhar"),
      city("Wangdue Phodrang", "town", "Wangdue Phodrang"),
      city("Punakha", "town", "Punakha"),
      city("Trashigang", "town", "Trashigang"),
      city("Jakar", "town", "Bumthang"),
      city("Mongar", "town", "Mongar"),
    ],
  },
  homePool: { seniors: 38, youth: 36 },
  abroad: { seniors: 2, youth: 0, destinations: weighted("IN:2") },
});

const BN = homeNation({
  code: "BN",
  name: "Brunei Darussalam",
  capital: "Bandar Seri Begawan",
  latitude: 4.9,
  languages: languages("ms:9 en:1"),
  reputation: { national: 26, league: 20 },
  physique: { height: 170 },
  names: { given: [src("malay")], family: [src("malay")] },
  nationality: {
    multipleRate: 0.05,
    tripleRate: 0.002,
    bornAbroadRate: 0.05,
    diasporaPull: 0.7,
    links: [...links("regional", "MY:5 SG:1 ID:1 PH:1"), ...links("asianDiaspora", "CN:1")],
    citizenship: restricted,
  },
  cities: {
    major: [
      city("Bandar Seri Begawan", "small", "Brunei-Muara"),
      city("Kuala Belait", "town", "Belait"),
      city("Seria", "town", "Belait"),
      city("Tutong", "town", "Tutong"),
      city("Muara", "town", "Brunei-Muara"),
      city("Bangar", "town", "Temburong"),
    ],
  },
  // DPMM play in Singapore's league, which the catalog does not model.
  homePool: { seniors: 40, youth: 36 },
});

const KH = homeNation({
  code: "KH",
  name: "Cambodia",
  capital: "Phnom Penh",
  latitude: 11.6,
  languages: languages("km:1"),
  reputation: { national: 30, league: 32 },
  physique: { height: 169 },
  names: { given: [src("khmer")], family: [src("khmer")], order: "family-given" },
  nationality: {
    multipleRate: 0.08,
    tripleRate: 0.005,
    bornAbroadRate: 0.04,
    diasporaPull: 0.6,
    links: [...links("regional", "TH:2 VN:2"), ...links("asianDiaspora", "FR:2 US:2 AU:1 CN:1 JP:1 KR:1")],
    citizenship: allowed,
  },
  cities: {
    major: [
      city("Phnom Penh", "large", "Phnom Penh"),
      city("Siem Reap", "medium", "Siem Reap"),
      city("Battambang", "medium", "Battambang"),
      city("Sihanoukville", "small", "Preah Sihanouk"),
      city("Kampong Cham", "small", "Kampong Cham"),
      city("Poipet", "small", "Banteay Meanchey"),
      city("Ta Khmau", "small", "Kandal"),
      city("Kampot", "town", "Kampot"),
      city("Kep", "town", "Kep"),
      city("Kratie", "town", "Kratie"),
      city("Svay Rieng", "town", "Svay Rieng"),
      city("Takeo", "town", "Takeo"),
    ],
  },
  homePool: { seniors: 65, youth: 40 },
  abroad: { seniors: 3, youth: 1, destinations: weighted("TH:2 JP:1") },
});

const TW = homeNation({
  code: "TW",
  name: "Chinese Taipei",
  capital: "Taipei",
  latitude: 25,
  languages: languages("zh:1"),
  reputation: { national: 33, league: 26 },
  physique: { height: 175 },
  names: { given: [src("taiwanese")], family: [src("taiwanese")], order: "family-given" },
  nationality: {
    multipleRate: 0.1,
    tripleRate: 0.008,
    bornAbroadRate: 0.05,
    diasporaPull: 0.5,
    links: [
      ...links("asianDiaspora", "US:3 CA:2 JP:2 CN:2 KR:1 HK:1 AU:1 PH:1"),
      ...links("commonwealth", "EN:1"),
    ],
    citizenship: allowed,
  },
  cities: {
    major: [
      city("New Taipei", "large", "New Taipei"),
      city("Taichung", "large", "Taichung"),
      city("Kaohsiung", "large", "Kaohsiung"),
      city("Taipei", "large", "Taipei"),
      city("Taoyuan", "large", "Taoyuan"),
      city("Tainan", "large", "Tainan"),
      city("Hsinchu", "medium", "Hsinchu"),
      city("Keelung", "medium", "Keelung"),
      city("Chiayi", "small", "Chiayi"),
      city("Changhua", "small", "Changhua"),
      city("Pingtung", "small", "Pingtung"),
      city("Hualien", "small", "Hualien"),
      city("Yilan", "small", "Yilan"),
      city("Taitung", "small", "Taitung"),
    ],
  },
  homePool: { seniors: 50, youth: 38 },
  abroad: { seniors: 5, youth: 2, destinations: weighted("JP:1 TH:1 EN:1 SCO:1 CN:1") },
});

const GU = homeNation({
  code: "GU",
  name: "Guam",
  continent: "OC",
  capital: "Hagatna",
  latitude: 13.5,
  languages: languages("en:6 ch:3 tl:1"),
  reputation: { national: 21, league: 14 },
  physique: { height: 176 },
  names: { given: [src("chamorro")], family: [src("chamorro")] },
  nationality: {
    multipleRate: 0.35,
    tripleRate: 0.06,
    bornAbroadRate: 0.25,
    diasporaPull: 0.4,
    links: [...links("pacific", "US:8 AU:1"), ...links("asianDiaspora", "PH:5 JP:2 KR:2 CN:1")],
    // Guamanians are US citizens.
    citizenship: { group: "US", dual: "allowed" },
  },
  cities: {
    major: [
      city("Dededo", "town", "Dededo"),
      city("Yigo", "town", "Yigo"),
      city("Tamuning", "town", "Tamuning"),
      city("Mangilao", "town", "Mangilao"),
      city("Barrigada", "town", "Barrigada"),
      city("Hagatna", "town", "Hagatna"),
      city("Santa Rita", "town", "Santa Rita"),
      city("Agat", "town", "Agat"),
      city("Talofofo", "town", "Talofofo"),
      city("Yona", "town", "Yona"),
    ],
  },
  homePool: { seniors: 30, youth: 36 },
  // Mostly US college and lower-league players.
  abroad: { seniors: 10, youth: 2, destinations: weighted("US:8 PH:2") },
});

const HK = homeNation({
  code: "HK",
  name: "Hong Kong",
  capital: "Hong Kong",
  latitude: 22.3,
  languages: languages("zh:8 en:2"),
  reputation: { national: 39, league: 34 },
  physique: { height: 174 },
  names: { given: [src("cantonese")], family: [src("cantonese")], order: "family-given" },
  nationality: {
    // Multi-ethnic squads: mainland, British, Brazilian, Nigerian and South Asian families.
    multipleRate: 0.2,
    tripleRate: 0.03,
    bornAbroadRate: 0.12,
    diasporaPull: 0.5,
    links: [
      ...links("regional", "CN:6 MO:1 NG:1"),
      ...links("commonwealth", "EN:3 CA:2 AU:2 NP:1 PK:1 IN:1"),
      ...links("asianDiaspora", "JP:1 KR:1 PH:1 US:1"),
      ...links("americas", "BR:2"),
      ...links("crossBorder", "DE:1 ES:1"),
    ],
    // Players need Chinese nationality (HKSAR passport); PRC law recognises no second nationality.
    citizenship: { group: "CN", dual: "restricted" },
  },
  cities: {
    major: [
      city("Kowloon", "large", "Kowloon"),
      city("Sha Tin", "medium", "New Territories"),
      city("Tuen Mun", "medium", "New Territories"),
      city("Yuen Long", "medium", "New Territories"),
      city("Tsuen Wan", "medium", "New Territories"),
      city("Tai Po", "medium", "New Territories"),
      city("Kwai Chung", "medium", "New Territories"),
      city("Tseung Kwan O", "medium", "New Territories"),
      city("Mong Kok", "medium", "Kowloon"),
      city("Sham Shui Po", "medium", "Kowloon"),
      city("Wan Chai", "medium", "Hong Kong Island"),
      city("Aberdeen", "small", "Hong Kong Island"),
      city("Causeway Bay", "small", "Hong Kong Island"),
      city("Tung Chung", "small", "New Territories"),
      city("Sheung Shui", "small", "New Territories"),
    ],
  },
  homePool: { seniors: 60, youth: 40 },
  abroad: { seniors: 4, youth: 1, destinations: weighted("CN:2 TH:1 AU:1") },
});

const JO = homeNation({
  code: "JO",
  name: "Jordan",
  capital: "Amman",
  latitude: 31.9,
  languages: languages("ar:1"),
  reputation: { national: 63, league: 45 },
  physique: { height: 178 },
  names: { given: [src("levant")], family: [src("jordanian")] },
  nationality: {
    // About half of Jordanians have Palestinian roots.
    multipleRate: 0.3,
    tripleRate: 0.03,
    bornAbroadRate: 0.08,
    diasporaPull: 0.7,
    links: [
      ...links("arabWorld", "PS:6 SY:3 IQ:2 EG:1 SA:1 LB:1 KW:1"),
      ...links("asianDiaspora", "US:1 DE:1"),
    ],
    citizenship: allowed,
  },
  cities: {
    major: [
      city("Amman", "large", "Amman"),
      city("Zarqa", "large", "Zarqa"),
      city("Irbid", "large", "Irbid"),
      city("Russeifa", "medium", "Zarqa"),
      city("Aqaba", "medium", "Aqaba"),
      city("Salt", "medium", "Balqa"),
      city("Madaba", "medium", "Madaba"),
      city("Mafraq", "small", "Mafraq"),
      city("Jerash", "small", "Jerash"),
      city("Ramtha", "small", "Irbid"),
      city("Karak", "small", "Karak"),
      city("Ma'an", "small", "Ma'an"),
      city("Tafilah", "town", "Tafilah"),
      city("Ajloun", "town", "Ajloun"),
    ],
  },
  homePool: { seniors: 110, youth: 60 },
  abroad: { seniors: 20, youth: 4, destinations: weighted("IQ:5 QA:4 SA:2 AE:2 KR:1 FR:1 EG:1") },
});

const KP = homeNation({
  code: "KP",
  name: "Korea DPR",
  capital: "Pyongyang",
  latitude: 39,
  languages: languages("ko:1"),
  reputation: { national: 49, league: 38 },
  physique: { height: 175 },
  names: { given: [src("korean-dprk")], family: [src("korean-dprk")], order: "family-given" },
  nationality: {
    multipleRate: 0.03,
    tripleRate: 0,
    // Zainichi Koreans born in Japan.
    bornAbroadRate: 0.03,
    diasporaPull: 0.4,
    links: links("asianDiaspora", "JP:3 CN:2 RU:1"),
    citizenship: restricted,
  },
  cities: {
    major: [
      city("Pyongyang", "large", "Pyongyang"),
      city("Hamhung", "medium", "South Hamgyong"),
      city("Chongjin", "medium", "North Hamgyong"),
      city("Nampo", "medium", "South Pyongan"),
      city("Wonsan", "medium", "Kangwon"),
      city("Sinuiju", "medium", "North Pyongan"),
      city("Kaesong", "small", "North Hwanghae"),
      city("Sariwon", "small", "North Hwanghae"),
      city("Haeju", "small", "South Hwanghae"),
      city("Kanggye", "small", "Chagang"),
      city("Hyesan", "small", "Ryanggang"),
      city("Anju", "small", "South Pyongan"),
    ],
  },
  homePool: { seniors: 90, youth: 50 },
  abroad: { seniors: 4, youth: 0, destinations: weighted("JP:3 KR:1") },
});

const KW = homeNation({
  code: "KW",
  name: "Kuwait",
  capital: "Kuwait City",
  latitude: 29.4,
  languages: languages("ar:1"),
  reputation: { national: 43, league: 44 },
  physique: { height: 177 },
  names: { given: [src("gulf")], family: [src("kuwaiti", 6), src("khaleeji", 4)] },
  nationality: {
    multipleRate: 0.08,
    tripleRate: 0.005,
    bornAbroadRate: 0.04,
    diasporaPull: 0.8,
    links: [...links("regional", "SA:2 IQ:2 IR:2 BH:1"), ...links("arabWorld", "EG:1 SY:1 JO:1 PS:1 LB:1")],
    citizenship: restricted,
  },
  cities: {
    major: [
      city("Kuwait City", "large", "Capital"),
      city("Hawalli", "medium", "Hawalli"),
      city("Salmiya", "medium", "Hawalli"),
      city("Jahra", "medium", "Jahra"),
      city("Farwaniya", "medium", "Farwaniya"),
      city("Ahmadi", "medium", "Ahmadi"),
      city("Fahaheel", "small", "Ahmadi"),
      city("Sabah Al-Salem", "small", "Mubarak Al-Kabeer"),
      city("Mangaf", "small", "Ahmadi"),
      city("Kaifan", "small", "Capital"),
    ],
  },
  homePool: { seniors: 80, youth: 45 },
  abroad: { seniors: 4, youth: 1, destinations: weighted("QA:1 SA:1 AE:1 IQ:1") },
});

const KG = homeNation({
  code: "KG",
  name: "Kyrgyz Republic",
  capital: "Bishkek",
  latitude: 42.9,
  languages: languages("ky:6 ru:4"),
  reputation: { national: 51, league: 36 },
  physique: { height: 178 },
  names: { given: [src("kyrgyz")], family: [src("kyrgyz")] },
  nationality: {
    // Russian and German-Kyrgyz families, plus naturalised players.
    multipleRate: 0.15,
    tripleRate: 0.02,
    bornAbroadRate: 0.05,
    diasporaPull: 0.5,
    links: [...links("postSoviet", "RU:6 KZ:3 UZ:3 TJ:2 DE:2 UA:1 KR:1"), ...links("regional", "TR:1 GH:1")],
    // Dual citizenship only with Russia (bilateral treaty).
    citizenship: partners("RU"),
  },
  cities: {
    major: [
      city("Bishkek", "large", "Chuy"),
      city("Osh", "medium", "Osh"),
      city("Jalal-Abad", "medium", "Jalal-Abad"),
      city("Karakol", "small", "Issyk-Kul"),
      city("Tokmok", "small", "Chuy"),
      city("Uzgen", "small", "Osh"),
      city("Kara-Balta", "small", "Chuy"),
      city("Naryn", "small", "Naryn"),
      city("Talas", "small", "Talas"),
      city("Batken", "town", "Batken"),
      city("Balykchy", "town", "Issyk-Kul"),
      city("Kant", "town", "Chuy"),
    ],
  },
  homePool: { seniors: 60, youth: 40 },
  abroad: { seniors: 14, youth: 3, destinations: weighted("KZ:5 RU:3 UZ:2 BY:1 IN:1") },
});

const LA = homeNation({
  code: "LA",
  name: "Laos",
  capital: "Vientiane",
  latitude: 18,
  languages: languages("lo:1"),
  reputation: { national: 28, league: 24 },
  physique: { height: 168 },
  names: { given: [src("lao")], family: [src("lao")] },
  nationality: {
    multipleRate: 0.06,
    tripleRate: 0.003,
    bornAbroadRate: 0.03,
    diasporaPull: 0.6,
    links: [...links("regional", "TH:3 VN:2"), ...links("asianDiaspora", "CN:1 FR:1 US:1")],
    citizenship: restricted,
  },
  cities: {
    major: [
      city("Vientiane", "medium", "Vientiane Prefecture"),
      city("Savannakhet", "small", "Savannakhet"),
      city("Pakse", "small", "Champasak"),
      city("Luang Prabang", "small", "Luang Prabang"),
      city("Thakhek", "town", "Khammouane"),
      city("Xam Neua", "town", "Houaphanh"),
      city("Phonsavan", "town", "Xiangkhouang"),
      city("Muang Xay", "town", "Oudomxay"),
      city("Vang Vieng", "town", "Vientiane Province"),
      city("Luang Namtha", "town", "Luang Namtha"),
    ],
  },
  homePool: { seniors: 45, youth: 36 },
  abroad: { seniors: 2, youth: 1, destinations: weighted("TH:2") },
});

const LB = homeNation({
  code: "LB",
  name: "Lebanon",
  capital: "Beirut",
  latitude: 33.9,
  languages: languages("ar:8 fr:2"),
  reputation: { national: 49, league: 36 },
  physique: { height: 178 },
  names: { given: [src("levant", 6), src("lebanese", 4)], family: [src("lebanese")] },
  nationality: {
    // A large diaspora in Australia, Sweden, Germany, the Americas and West Africa.
    multipleRate: 0.3,
    tripleRate: 0.05,
    bornAbroadRate: 0.15,
    diasporaPull: 0.6,
    links: [
      ...links("asianDiaspora", "AU:3 SE:3 DE:3 US:2 CA:2 FR:2 DK:1 EN:1"),
      ...links("americas", "BR:2 MX:1 AR:1"),
      ...links("arabWorld", "SY:2 PS:1"),
      ...links("frenchAfrica", "CI:1 SN:1"),
    ],
    citizenship: allowed,
  },
  cities: {
    major: [
      city("Beirut", "large", "Beirut"),
      city("Tripoli", "medium", "North"),
      city("Sidon", "medium", "South"),
      city("Jounieh", "medium", "Keserwan-Jbeil"),
      city("Zahle", "small", "Beqaa"),
      city("Tyre", "small", "South"),
      city("Nabatieh", "small", "Nabatieh"),
      city("Byblos", "small", "Keserwan-Jbeil"),
      city("Baalbek", "small", "Baalbek-Hermel"),
      city("Aley", "town", "Mount Lebanon"),
      city("Batroun", "town", "North"),
      city("Chtaura", "town", "Beqaa"),
    ],
  },
  homePool: { seniors: 70, youth: 45 },
  abroad: { seniors: 14, youth: 3, destinations: weighted("IQ:3 SA:1 QA:1 SE:2 DE:2 AU:2 US:1") },
});

const MO = homeNation({
  code: "MO",
  name: "Macau",
  capital: "Macau",
  latitude: 22.2,
  languages: languages("zh:8 pt:2"),
  reputation: { national: 22, league: 18 },
  physique: { height: 174 },
  names: { given: [src("cantonese")], family: [src("cantonese")], order: "family-given" },
  nationality: {
    multipleRate: 0.12,
    tripleRate: 0.01,
    bornAbroadRate: 0.08,
    diasporaPull: 0.4,
    links: [...links("regional", "CN:5 HK:3"), ...links("lusophone", "PT:2 BR:1"), ...links("asianDiaspora", "PH:1")],
    citizenship: { group: "CN", dual: "restricted" },
  },
  cities: {
    major: [
      city("Macau", "medium", "Macau Peninsula"),
      city("Taipa", "small", "Islands"),
      city("Coloane", "town", "Islands"),
      city("Cotai", "town", "Islands"),
    ],
  },
  homePool: { seniors: 40, youth: 36 },
});

const MY = homeNation({
  code: "MY",
  name: "Malaysia",
  capital: "Kuala Lumpur",
  latitude: 3.1,
  languages: languages("ms:6 en:2 zh:1 ta:1"),
  reputation: { national: 44, league: 48 },
  physique: { height: 172 },
  // Malay, Chinese and Indian Malaysians; both sides list the same pools in the same order.
  names: {
    given: [src("malay", 6), src("strait-chinese", 2.5), src("tamil", 1.5)],
    family: [src("malay", 6), src("strait-chinese", 2.5), src("tamil", 1.5)],
  },
  nationality: {
    multipleRate: 0.1,
    tripleRate: 0.008,
    bornAbroadRate: 0.04,
    diasporaPull: 0.6,
    links: [
      ...links("asianDiaspora", "ID:3 SG:3 CN:2 IN:2 AU:1"),
      // Naturalised and heritage players from South America and Europe.
      ...links("americas", "BR:2 AR:1"),
      ...links("crossBorder", "ES:1 NL:1 BE:1"),
    ],
    citizenship: restricted,
  },
  cities: {
    major: [
      city("Kuala Lumpur", "large", "Kuala Lumpur"),
      city("Johor Bahru", "large", "Johor"),
      city("Petaling Jaya", "medium", "Selangor"),
      city("Shah Alam", "medium", "Selangor"),
      city("Klang", "medium", "Selangor"),
      city("George Town", "medium", "Penang"),
      city("Ipoh", "medium", "Perak"),
      city("Kuching", "medium", "Sarawak"),
      city("Kota Kinabalu", "medium", "Sabah"),
      city("Seremban", "medium", "Negeri Sembilan"),
      city("Kuantan", "medium", "Pahang"),
      city("Melaka", "medium", "Melaka"),
      city("Alor Setar", "small", "Kedah"),
      city("Kota Bharu", "small", "Kelantan"),
      city("Kuala Terengganu", "small", "Terengganu"),
      city("Miri", "small", "Sarawak"),
      city("Sandakan", "small", "Sabah"),
      city("Kangar", "town", "Perlis"),
      city("Putrajaya", "town", "Putrajaya"),
    ],
  },
  // The Malaysia Super League (Johor Darul Ta'zim) is not modeled, so its players form the home pool.
  homePool: { seniors: 120, youth: 60 },
  abroad: { seniors: 4, youth: 2, destinations: weighted("TH:2 JP:1 AU:1") },
});

const MV = homeNation({
  code: "MV",
  name: "Maldives",
  capital: "Malé",
  latitude: 4.2,
  languages: languages("dv:1"),
  reputation: { national: 35, league: 26 },
  physique: { height: 171 },
  names: { given: [src("maldivian")], family: [src("maldivian")] },
  nationality: {
    multipleRate: 0.05,
    tripleRate: 0.002,
    bornAbroadRate: 0.04,
    diasporaPull: 0.7,
    links: links("regional", "IN:2 LK:2"),
    citizenship: allowed,
  },
  cities: {
    major: [
      city("Malé", "small", "Malé"),
      city("Hulhumalé", "town", "Malé"),
      city("Addu City", "town", "Addu"),
      city("Fuvahmulah", "town", "Fuvahmulah"),
      city("Kulhudhuffushi", "town", "Haa Dhaalu"),
      city("Thinadhoo", "town", "Gaafu Dhaalu"),
      city("Naifaru", "town", "Lhaviyani"),
    ],
  },
  homePool: { seniors: 40, youth: 36 },
  abroad: { seniors: 2, youth: 0, destinations: weighted("IN:1 TH:1") },
});

const MN = homeNation({
  code: "MN",
  name: "Mongolia",
  capital: "Ulaanbaatar",
  latitude: 47.9,
  languages: languages("mn:1"),
  reputation: { national: 28, league: 22 },
  physique: { height: 176 },
  names: { given: [src("mongolian")], family: [src("mongolian")], order: "family-given" },
  nationality: {
    multipleRate: 0.05,
    tripleRate: 0.003,
    bornAbroadRate: 0.03,
    diasporaPull: 0.6,
    links: [...links("regional", "CN:2 RU:2 KZ:1"), ...links("asianDiaspora", "KR:2 JP:1")],
    citizenship: restricted,
  },
  cities: {
    major: [
      city("Ulaanbaatar", "large", "Ulaanbaatar"),
      city("Erdenet", "small", "Orkhon"),
      city("Darkhan", "small", "Darkhan-Uul"),
      city("Choibalsan", "town", "Dornod"),
      city("Khovd", "town", "Khovd"),
      city("Ölgii", "town", "Bayan-Ölgii"),
      city("Mörön", "town", "Khövsgöl"),
      city("Bayankhongor", "town", "Bayankhongor"),
      city("Arvaikheer", "town", "Övörkhangai"),
      city("Sainshand", "town", "Dornogovi"),
    ],
  },
  homePool: { seniors: 45, youth: 36 },
  abroad: { seniors: 2, youth: 1, destinations: weighted("KR:1 JP:1") },
});

const MM = homeNation({
  code: "MM",
  name: "Myanmar",
  capital: "Naypyidaw",
  latitude: 19.8,
  languages: languages("my:1"),
  reputation: { national: 35, league: 32 },
  physique: { height: 170 },
  names: { given: [src("burmese")], family: [src("burmese")] },
  nationality: {
    multipleRate: 0.05,
    tripleRate: 0.003,
    bornAbroadRate: 0.02,
    diasporaPull: 0.6,
    links: links("regional", "TH:2 CN:2 IN:2"),
    citizenship: restricted,
  },
  cities: {
    major: [
      city("Yangon", "mega", "Yangon"),
      city("Mandalay", "large", "Mandalay"),
      city("Naypyidaw", "medium", "Naypyidaw"),
      city("Mawlamyine", "medium", "Mon"),
      city("Bago", "medium", "Bago"),
      city("Pathein", "small", "Ayeyarwady"),
      city("Taunggyi", "small", "Shan"),
      city("Monywa", "small", "Sagaing"),
      city("Myitkyina", "small", "Kachin"),
      city("Sittwe", "small", "Rakhine"),
      city("Magway", "small", "Magway"),
      city("Lashio", "small", "Shan"),
      city("Hpa-an", "small", "Kayin"),
      city("Meiktila", "small", "Mandalay"),
    ],
  },
  homePool: { seniors: 70, youth: 40 },
  abroad: { seniors: 5, youth: 2, destinations: weighted("TH:3 VN:1 ID:1") },
});

const NP = homeNation({
  code: "NP",
  name: "Nepal",
  capital: "Kathmandu",
  latitude: 27.7,
  languages: languages("ne:1"),
  reputation: { national: 31, league: 24 },
  physique: { height: 170 },
  names: { given: [src("nepali"), faker("en_NP")], family: [src("nepali"), faker("en_NP")] },
  nationality: {
    multipleRate: 0.08,
    tripleRate: 0.004,
    bornAbroadRate: 0.05,
    diasporaPull: 0.6,
    links: [
      ...links("regional", "IN:5 BT:1"),
      // Gurkha families in Britain and Hong Kong.
      ...links("commonwealth", "EN:1 HK:1 AU:1"),
      ...links("asianDiaspora", "US:1 KR:1"),
    ],
    citizenship: restricted,
  },
  cities: {
    major: [
      city("Kathmandu", "large", "Bagmati"),
      city("Pokhara", "medium", "Gandaki"),
      city("Lalitpur", "medium", "Bagmati"),
      city("Bharatpur", "medium", "Bagmati"),
      city("Biratnagar", "medium", "Koshi"),
      city("Birgunj", "medium", "Madhesh"),
      city("Dharan", "small", "Koshi"),
      city("Butwal", "small", "Lumbini"),
      city("Bhaktapur", "small", "Bagmati"),
      city("Hetauda", "small", "Bagmati"),
      city("Janakpur", "small", "Madhesh"),
      city("Nepalgunj", "small", "Lumbini"),
      city("Dhangadhi", "small", "Sudurpashchim"),
      city("Itahari", "small", "Koshi"),
    ],
  },
  homePool: { seniors: 55, youth: 38 },
  abroad: { seniors: 4, youth: 1, destinations: weighted("IN:3 TH:1") },
});

const OM = homeNation({
  code: "OM",
  name: "Oman",
  capital: "Muscat",
  latitude: 23.6,
  languages: languages("ar:1"),
  reputation: { national: 58, league: 42 },
  physique: { height: 175 },
  names: { given: [src("gulf")], family: [src("omani", 7), src("khaleeji", 3)] },
  nationality: {
    multipleRate: 0.1,
    tripleRate: 0.006,
    bornAbroadRate: 0.04,
    diasporaPull: 0.8,
    links: [
      // Omani families from Zanzibar and Baloch families from Gwadar.
      ...links("regional", "TZ:3 AE:2 YE:2 PK:2 SA:1 IR:1 KE:1 BH:1 QA:1"),
      ...links("arabWorld", "EG:1"),
    ],
    citizenship: restricted,
  },
  cities: {
    major: [
      city("Muscat", "large", "Muscat"),
      city("Seeb", "medium", "Muscat"),
      city("Salalah", "medium", "Dhofar"),
      city("Sohar", "medium", "Al Batinah North"),
      city("Nizwa", "small", "Ad Dakhiliyah"),
      city("Sur", "small", "Ash Sharqiyah South"),
      city("Ibri", "small", "Ad Dhahirah"),
      city("Rustaq", "small", "Al Batinah South"),
      city("Buraimi", "small", "Al Buraimi"),
      city("Saham", "small", "Al Batinah North"),
      city("Barka", "small", "Al Batinah South"),
      city("Ibra", "town", "Ash Sharqiyah North"),
      city("Khasab", "town", "Musandam"),
    ],
  },
  homePool: { seniors: 90, youth: 50 },
  abroad: { seniors: 8, youth: 1, destinations: weighted("QA:3 AE:2 SA:1 IQ:1") },
});

const PK = homeNation({
  code: "PK",
  name: "Pakistan",
  capital: "Islamabad",
  latitude: 33.7,
  languages: languages("ur:5 pa:3 ps:1 en:1"),
  reputation: { national: 23, league: 16 },
  physique: { height: 174 },
  names: { given: [src("pakistani")], family: [src("pakistani")] },
  nationality: {
    // British-Pakistani and Scandinavian-Pakistani players fill much of the national team.
    multipleRate: 0.12,
    tripleRate: 0.008,
    bornAbroadRate: 0.08,
    diasporaPull: 0.45,
    links: [
      ...links("commonwealth", "EN:5 SCO:1 CA:1 AU:1"),
      ...links("asianDiaspora", "NO:2 DK:2 US:1 SE:1"),
      ...links("regional", "AF:3 IN:2 IR:1"),
    ],
    // Dual nationality only with the countries that have an agreement with Pakistan.
    citizenship: partners("GB AU BE CA DK EG FI FR DE IS IE IT JO NL NZ NO SE CH US"),
  },
  cities: {
    major: [
      city("Karachi", "mega", "Sindh"),
      city("Lahore", "mega", "Punjab"),
      city("Faisalabad", "large", "Punjab"),
      city("Rawalpindi", "large", "Punjab"),
      city("Gujranwala", "large", "Punjab"),
      city("Peshawar", "large", "Khyber Pakhtunkhwa"),
      city("Multan", "large", "Punjab"),
      city("Hyderabad", "large", "Sindh"),
      city("Islamabad", "large", "Islamabad"),
      city("Quetta", "large", "Balochistan"),
      city("Sialkot", "medium", "Punjab"),
      city("Sargodha", "medium", "Punjab"),
      city("Bahawalpur", "medium", "Punjab"),
      city("Sukkur", "medium", "Sindh"),
      city("Larkana", "medium", "Sindh"),
      city("Mardan", "medium", "Khyber Pakhtunkhwa"),
      city("Abbottabad", "small", "Khyber Pakhtunkhwa"),
      city("Gwadar", "small", "Balochistan"),
      city("Chaman", "small", "Balochistan"),
    ],
  },
  homePool: { seniors: 35, youth: 36 },
  abroad: { seniors: 12, youth: 3, destinations: weighted("EN:4 NO:2 DK:2 SE:1 US:1 AU:1 SCO:1") },
});

const PS = homeNation({
  code: "PS",
  name: "Palestine",
  capital: "Ramallah",
  latitude: 31.9,
  languages: languages("ar:1"),
  reputation: { national: 52, league: 30 },
  physique: { height: 177 },
  names: { given: [src("levant")], family: [src("palestinian")] },
  nationality: {
    // Refugee and diaspora families across the Arab world, Chile and Europe.
    multipleRate: 0.3,
    tripleRate: 0.04,
    bornAbroadRate: 0.2,
    diasporaPull: 0.6,
    links: [
      ...links("arabWorld", "JO:6 SY:2 LB:2 EG:2 KW:1 SA:1"),
      ...links("americas", "CL:3 HN:1 SV:1 BR:1"),
      ...links("asianDiaspora", "SE:2 DE:2 DK:1 US:2"),
      ...links("regional", "IL:2"),
    ],
    citizenship: allowed,
  },
  cities: {
    major: [
      city("Gaza", "large", "Gaza Strip"),
      city("Hebron", "medium", "West Bank"),
      city("Nablus", "medium", "West Bank"),
      city("Khan Yunis", "medium", "Gaza Strip"),
      city("Jabalia", "medium", "Gaza Strip"),
      city("Rafah", "medium", "Gaza Strip"),
      city("Ramallah", "small", "West Bank"),
      city("Jenin", "small", "West Bank"),
      city("Tulkarm", "small", "West Bank"),
      city("Bethlehem", "small", "West Bank"),
      city("Qalqilya", "small", "West Bank"),
      city("Deir al-Balah", "small", "Gaza Strip"),
      city("Al-Bireh", "small", "West Bank"),
      city("Jericho", "town", "West Bank"),
      city("Beit Sahour", "town", "West Bank"),
    ],
  },
  homePool: { seniors: 60, youth: 40 },
  abroad: { seniors: 22, youth: 4, destinations: weighted("CL:5 IQ:4 QA:2 SA:2 AE:1 EG:2 SE:2 DK:1 DE:1") },
});

const SG = homeNation({
  code: "SG",
  name: "Singapore",
  capital: "Singapore",
  latitude: 1.35,
  languages: languages("en:4 ms:3 zh:2 ta:1"),
  reputation: { national: 36, league: 36 },
  physique: { height: 172 },
  // Malay, Chinese and Indian Singaporeans; both sides list the same pools in the same order.
  names: {
    given: [src("malay", 4), src("strait-chinese", 4), src("tamil", 1.5)],
    family: [src("malay", 4), src("strait-chinese", 4), src("tamil", 1.5)],
  },
  nationality: {
    multipleRate: 0.12,
    tripleRate: 0.01,
    bornAbroadRate: 0.06,
    diasporaPull: 0.5,
    links: [
      ...links("regional", "MY:6 ID:2"),
      ...links("asianDiaspora", "CN:3 IN:2 JP:1 KR:1 AU:1 PH:1 TH:1"),
      ...links("commonwealth", "EN:1 ZA:1"),
      ...links("dutchDiaspora", "NL:1"),
    ],
    citizenship: restricted,
  },
  cities: {
    // Planning areas of the city-state.
    major: [
      city("Tampines", "medium", "East Region"),
      city("Jurong West", "medium", "West Region"),
      city("Woodlands", "medium", "North Region"),
      city("Bedok", "medium", "East Region"),
      city("Sengkang", "medium", "North-East Region"),
      city("Hougang", "medium", "North-East Region"),
      city("Yishun", "medium", "North Region"),
      city("Ang Mo Kio", "medium", "North-East Region"),
      city("Choa Chu Kang", "medium", "West Region"),
      city("Bukit Batok", "medium", "West Region"),
      city("Toa Payoh", "small", "Central Region"),
      city("Geylang", "small", "Central Region"),
      city("Queenstown", "small", "Central Region"),
      city("Kallang", "small", "Central Region"),
      city("Pasir Ris", "small", "East Region"),
      city("Serangoon", "small", "North-East Region"),
      city("Bishan", "small", "Central Region"),
      city("Clementi", "small", "West Region"),
    ],
  },
  // The Singapore Premier League is not modeled, so its players form the home pool.
  homePool: { seniors: 60, youth: 40 },
  abroad: { seniors: 4, youth: 2, destinations: weighted("TH:2 ID:1 JP:1") },
});

const LK = homeNation({
  code: "LK",
  name: "Sri Lanka",
  capital: "Colombo",
  latitude: 6.9,
  languages: languages("si:7 ta:3"),
  reputation: { national: 24, league: 18 },
  physique: { height: 170 },
  // Sinhalese, Tamil and Moor names; both sides list the same pools in the same order.
  names: {
    given: [src("sinhala", 7), src("tamil", 2), src("lanka-moor", 1)],
    family: [src("sinhala", 7), src("tamil", 2), src("lanka-moor", 1)],
  },
  nationality: {
    // Recent squads draw heavily on the British and Australian diaspora.
    multipleRate: 0.18,
    tripleRate: 0.02,
    bornAbroadRate: 0.12,
    diasporaPull: 0.5,
    links: [
      ...links("commonwealth", "EN:3 AU:3 CA:1"),
      ...links("regional", "IN:2 MV:1"),
      // Burgher families of Dutch descent.
      ...links("dutchDiaspora", "NL:1"),
      ...links("asianDiaspora", "NO:1 IT:1 SE:1 DE:1"),
    ],
    citizenship: allowed,
  },
  cities: {
    major: [
      city("Colombo", "large", "Western"),
      city("Dehiwala-Mount Lavinia", "medium", "Western"),
      city("Moratuwa", "medium", "Western"),
      city("Negombo", "medium", "Western"),
      city("Kandy", "medium", "Central"),
      city("Jaffna", "small", "Northern"),
      city("Galle", "small", "Southern"),
      city("Kurunegala", "small", "North Western"),
      city("Batticaloa", "small", "Eastern"),
      city("Trincomalee", "small", "Eastern"),
      city("Kalmunai", "small", "Eastern"),
      city("Anuradhapura", "small", "North Central"),
      city("Ratnapura", "small", "Sabaragamuwa"),
      city("Matara", "small", "Southern"),
      city("Badulla", "town", "Uva"),
    ],
  },
  homePool: { seniors: 35, youth: 36 },
  abroad: { seniors: 10, youth: 2, destinations: weighted("EN:3 AU:3 NL:1 NO:1 SE:1 IN:1") },
});

const SY = homeNation({
  code: "SY",
  name: "Syria",
  capital: "Damascus",
  latitude: 33.5,
  languages: languages("ar:9 ku:1"),
  reputation: { national: 55, league: 36 },
  physique: { height: 179 },
  names: { given: [src("levant")], family: [src("syrian")] },
  nationality: {
    multipleRate: 0.25,
    tripleRate: 0.03,
    bornAbroadRate: 0.15,
    diasporaPull: 0.6,
    links: [
      ...links("asianDiaspora", "SE:3 DE:3 NL:1 DK:1 US:1"),
      ...links("arabWorld", "LB:2 JO:2 IQ:1 SA:1 PS:1"),
      ...links("regional", "TR:2 AM:1"),
      ...links("americas", "CL:2 AR:1 BR:1"),
    ],
    citizenship: allowed,
  },
  cities: {
    major: [
      city("Aleppo", "large", "Aleppo"),
      city("Damascus", "large", "Damascus"),
      city("Homs", "large", "Homs"),
      city("Latakia", "medium", "Latakia"),
      city("Hama", "medium", "Hama"),
      city("Deir ez-Zor", "medium", "Deir ez-Zor"),
      city("Raqqa", "medium", "Raqqa"),
      city("Al-Hasakah", "small", "Al-Hasakah"),
      city("Qamishli", "small", "Al-Hasakah"),
      city("Tartus", "small", "Tartus"),
      city("Idlib", "small", "Idlib"),
      city("Daraa", "small", "Daraa"),
      city("As-Suwayda", "small", "As-Suwayda"),
      city("Jableh", "small", "Latakia"),
      city("Manbij", "small", "Aleppo"),
    ],
  },
  homePool: { seniors: 90, youth: 50 },
  abroad: { seniors: 30, youth: 5, destinations: weighted("IQ:8 SA:2 QA:2 AE:2 SE:2 DE:2 NL:1 CL:2 TR:1 EG:1 IN:1") },
});

const TJ = homeNation({
  code: "TJ",
  name: "Tajikistan",
  capital: "Dushanbe",
  latitude: 38.6,
  languages: languages("tg:7 ru:2 uz:1"),
  reputation: { national: 51, league: 40 },
  physique: { height: 178 },
  names: { given: [src("tajik", 3), src("persian", 1)], family: [src("tajik")] },
  nationality: {
    multipleRate: 0.12,
    tripleRate: 0.01,
    bornAbroadRate: 0.04,
    diasporaPull: 0.6,
    links: [...links("postSoviet", "RU:5 UZ:3 KG:1 KZ:1"), ...links("regional", "AF:2 IR:1")],
    // Dual citizenship only with Russia (bilateral treaty).
    citizenship: partners("RU"),
  },
  cities: {
    major: [
      city("Dushanbe", "large", "Dushanbe"),
      city("Khujand", "medium", "Sughd"),
      city("Bokhtar", "small", "Khatlon"),
      city("Kulob", "small", "Khatlon"),
      city("Istaravshan", "small", "Sughd"),
      city("Vahdat", "small", "Districts of Republican Subordination"),
      city("Tursunzoda", "small", "Districts of Republican Subordination"),
      city("Isfara", "small", "Sughd"),
      city("Panjakent", "small", "Sughd"),
      city("Hisor", "town", "Districts of Republican Subordination"),
      city("Khorugh", "town", "Gorno-Badakhshan"),
    ],
  },
  homePool: { seniors: 70, youth: 40 },
  abroad: { seniors: 10, youth: 2, destinations: weighted("KZ:3 UZ:2 RU:2 IR:1 IN:1 IQ:1") },
});

const TL = homeNation({
  code: "TL",
  name: "Timor-Leste",
  capital: "Dili",
  latitude: -8.6,
  languages: languages("tet:6 pt:3 id:1"),
  reputation: { national: 24, league: 18 },
  physique: { height: 168 },
  names: {
    given: [src("timorese", 3), faker("pt_PT", 2)],
    family: [src("timorese", 3), faker("pt_PT", 1)],
  },
  nationality: {
    multipleRate: 0.2,
    tripleRate: 0.02,
    bornAbroadRate: 0.05,
    diasporaPull: 0.6,
    links: [...links("regional", "ID:4"), ...links("lusophone", "PT:3 BR:1"), ...links("asianDiaspora", "AU:2")],
    citizenship: allowed,
  },
  cities: {
    major: [
      city("Dili", "medium", "Dili"),
      city("Baucau", "town", "Baucau"),
      city("Maliana", "town", "Bobonaro"),
      city("Suai", "town", "Cova Lima"),
      city("Lospalos", "town", "Lautém"),
      city("Same", "town", "Manufahi"),
      city("Viqueque", "town", "Viqueque"),
      city("Aileu", "town", "Aileu"),
      city("Ermera", "town", "Ermera"),
      city("Liquiçá", "town", "Liquiçá"),
      city("Manatuto", "town", "Manatuto"),
      city("Pante Macassar", "town", "Oecusse"),
    ],
  },
  homePool: { seniors: 38, youth: 36 },
  abroad: { seniors: 3, youth: 1, destinations: weighted("ID:2 TH:1 PT:1") },
});

const TM = homeNation({
  code: "TM",
  name: "Turkmenistan",
  capital: "Ashgabat",
  latitude: 37.9,
  languages: languages("tk:8 ru:2"),
  reputation: { national: 41, league: 34 },
  physique: { height: 178 },
  names: { given: [src("turkmen")], family: [src("turkmen")] },
  nationality: {
    multipleRate: 0.08,
    tripleRate: 0.005,
    bornAbroadRate: 0.03,
    diasporaPull: 0.6,
    links: [...links("postSoviet", "RU:4 UZ:2 KZ:1 UA:1"), ...links("regional", "IR:2 TR:2 AF:1")],
    citizenship: restricted,
  },
  cities: {
    major: [
      city("Ashgabat", "large", "Ashgabat"),
      city("Turkmenabat", "medium", "Lebap"),
      city("Dashoguz", "medium", "Dashoguz"),
      city("Mary", "medium", "Mary"),
      city("Balkanabat", "small", "Balkan"),
      city("Bayramaly", "small", "Mary"),
      city("Turkmenbashi", "small", "Balkan"),
      city("Tejen", "small", "Ahal"),
      city("Abadan", "small", "Ahal"),
      city("Serdar", "town", "Balkan"),
      city("Magdanly", "town", "Lebap"),
    ],
  },
  homePool: { seniors: 60, youth: 40 },
  abroad: { seniors: 6, youth: 1, destinations: weighted("KZ:2 UZ:1 BY:1 RU:1 IR:1") },
});

const YE = homeNation({
  code: "YE",
  name: "Yemen",
  capital: "Sana'a",
  latitude: 15.4,
  languages: languages("ar:1"),
  reputation: { national: 38, league: 25 },
  physique: { height: 173 },
  names: { given: [src("gulf")], family: [src("yemeni", 8), src("khaleeji", 2)] },
  nationality: {
    multipleRate: 0.1,
    tripleRate: 0.006,
    bornAbroadRate: 0.06,
    diasporaPull: 0.7,
    links: [
      ...links("regional", "SA:5 SO:2 OM:1 AE:1"),
      ...links("arabWorld", "EG:1"),
      // Yemeni communities in the US, Britain and the Hadrami diaspora in South and Southeast Asia.
      ...links("asianDiaspora", "US:2 EN:1 IN:1 ID:1"),
    ],
    citizenship: allowed,
  },
  cities: {
    major: [
      city("Sana'a", "large", "Amanat al-Asimah"),
      city("Aden", "large", "Aden"),
      city("Taiz", "medium", "Taiz"),
      city("Hodeidah", "medium", "Al Hudaydah"),
      city("Ibb", "medium", "Ibb"),
      city("Mukalla", "medium", "Hadramaut"),
      city("Dhamar", "small", "Dhamar"),
      city("Seiyun", "small", "Hadramaut"),
      city("Marib", "small", "Marib"),
      city("Hajjah", "small", "Hajjah"),
      city("Amran", "small", "Amran"),
      city("Sa'dah", "small", "Saada"),
      city("Zinjibar", "town", "Abyan"),
      city("Al Bayda", "town", "Al Bayda"),
    ],
  },
  homePool: { seniors: 60, youth: 40 },
  abroad: { seniors: 12, youth: 3, destinations: weighted("IQ:4 SA:3 QA:1 EG:1 AE:1") },
});

/** Real clubs (2025/26 modeled tiers plus well-known others) the templates could reproduce; the generator avoids them. */
const REAL_CLUB_NAMES: Readonly<Record<string, readonly string[]>> = {
  JP: list(
    `Kashima Antlers|Kashiwa Reysol|Urawa Red Diamonds|Kawasaki Frontale|Yokohama F. Marinos|Yokohama FC|FC Tokyo|
     Tokyo Verdy|FC Machida Zelvia|Machida Zelvia|Shonan Bellmare|Albirex Niigata|Shimizu S-Pulse|Júbilo Iwata|
     Nagoya Grampus|Kyoto Sanga|Gamba Osaka|Cerezo Osaka|Vissel Kobe|Fagiano Okayama|Sanfrecce Hiroshima|Avispa Fukuoka|
     Sagan Tosu|Consadole Sapporo|Hokkaido Consadole Sapporo|Vegalta Sendai|Montedio Yamagata|Blaublitz Akita|
     Mito HollyHock|Tochigi SC|Tochigi City|Tochigi City FC|Omiya Ardija|RB Omiya Ardija|JEF United Chiba|
     Ventforet Kofu|Iwaki FC|Thespa Gunma|Kataller Toyama|Zweigen Kanazawa|Matsumoto Yamaga|AC Nagano Parceiro|
     Azul Claro Numazu|Fujieda MYFC|FC Gifu|FC Imabari|Ehime FC|Tokushima Vortis|Kamatamare Sanuki|Kochi United|
     Kochi United SC|Renofa Yamaguchi|Gainare Tottori|Roasso Kumamoto|V-Varen Nagasaki|Oita Trinita|Giravanz Kitakyushu|
     Tegevajaro Miyazaki|Kagoshima United|FC Ryukyu|Fukushima United|Iwate Grulla Morioka|Vanraure Hachinohe|
     YSCC Yokohama|SC Sagamihara|Nara Club|FC Osaka|FC Kariya|FC Tiamo Hirakata|FC Maruyasu Okazaki|Reilac Shiga|
     Criacao Shinjuku|Veertien Mie|Honda FC|Sony Sendai|Briobecca Urayasu|Okinawa SV|Tokyo Musashino United|
     ReinMeer Aomori|Verspah Oita|Atletico Suzuka|Yokohama Flügels`,
  ),
  AU: list(
    `Adelaide United|Brisbane Roar|Central Coast Mariners|Macarthur FC|Melbourne City|Melbourne Victory|Newcastle Jets|
     Perth Glory|Sydney FC|Western Sydney Wanderers|Western United|Gold Coast United|North Queensland Fury|
     South Melbourne|Sydney Olympic|Marconi Stallions|APIA Leichhardt|Wollongong Wolves|Heidelberg United|Preston Lions|
     Avondale FC|Green Gully|Oakleigh Cannons|Brisbane City|Gold Coast Knights|Moreton City Excelsior|Lions FC|
     Adelaide City|Campbelltown City|Floreat Athena|Perth SC|Glenorchy Knights|South Hobart|Canberra Croatia|
     Canberra Olympic|Canberra United|Canberra City|Blacktown City|Sydney United 58|Sydney United|Rockdale Ilinden|
     Manly United|Sutherland Sharks|St George City|Hume City|Dandenong City|Port Melbourne|Bentleigh Greens|
     Altona Magic|Melbourne Knights|Olympic FC|Peninsula Power|Brisbane Strikers|Adelaide Comets|Adelaide Olympic|
     West Adelaide|North Eastern MetroStars|Perth RedStar|Armadale SC|Newcastle Olympic|Edgeworth Eagles|
     Broadmeadow Magic|Lambton Jaffas|Hobart Zebras|Devonport City|Launceston City|Darwin Olympic`,
  ),
  SA: list(
    `Al-Hilal|Al-Nassr|Al-Ittihad|Al-Ahli|Al-Shabab|Al-Ettifaq|Al-Taawoun|Al-Fateh|Al-Khaleej|Al-Fayha|Al-Riyadh|
     Al-Qadsiah|Al-Kholood|Al-Okhdood|Al-Hazem|Al-Najma|Damac|NEOM|NEOM SC|Al-Raed|Al-Wehda|Abha|Abha Club|Al-Orobah|
     Al-Jabalain|Al-Faisaly|Al-Batin|Al-Jubail|Al-Adalah|Al-Arabi|Al-Ain|Al-Bukiryah|Al-Diriyah|Al-Safa|Jeddah|
     Jeddah Club|Al-Zulfi|Ohod|Al-Kawkab|Al-Qaisumah|Al-Tai|Al-Nahda|Al-Shoulla|Al-Nojoom|Al-Ansar|Hajer|Al-Sahel|
     Al-Jeel|Al-Draih|Al-Washm|Al-Ula|AlUla|Al-Anwar|Al-Taraji|Al-Mujazzal|Al-Hada|Al-Entesar|Al-Rawdhah|Al-Thoqbah|
     Al-Nairyah|Al-Akhdoud|Al-Qadisiyah|Al-Ittifaq`,
  ),
  KR: list(
    `Ulsan HD|Ulsan Hyundai|Jeonbuk Hyundai Motors|Pohang Steelers|FC Seoul|Suwon FC|Suwon Samsung Bluewings|Daegu FC|
     Gangwon FC|Gwangju FC|Jeju SK|Jeju United|Daejeon Hana Citizen|Daejeon Citizen|Gimcheon Sangmu|Incheon United|
     FC Anyang|Seongnam FC|Busan IPark|Jeonnam Dragons|Bucheon FC 1995|Bucheon FC|Chungnam Asan|Seoul E-Land|
     Gyeongnam FC|Ansan Greeners|Cheonan City|Chungbuk Cheongju|Hwaseong FC|Gimpo FC|Paju Frontier|Yongin FC|Gimhae FC|
     Siheung Citizen|Gyeongju KHNP|Changwon FC|Pocheon Citizen|Yangpyeong FC|Ulsan Citizen|Gangneung Citizen|
     Busan Transportation Corporation|Daejeon Korail|Mokpo FC|Chuncheon FC|Pyeongchang United|Dangjin Citizen|
     Geoje Citizen|Jinju Citizen|Seoul Nowon United|Seoul Jungnang|Yeoju FC|Namyangju FC|Gimhae City|Goyang Citizen|
     Pyeongtaek Citizen|Chuncheon Citizen|Sejong SA|Seoul United|Yangju Citizen|Paju Citizen|
     Cheongju FC|Asan Mugunghwa|Sangju Sangmu|Gwangju Sangmu`,
  ),
  IR: list(
    `Persepolis|Esteghlal|Sepahan|Tractor|Tractor Sazi|Foolad|Foolad Khuzestan|Gol Gohar|Gol Gohar Sirjan|Zob Ahan|
     Zob Ahan Esfahan|Malavan|Malavan Bandar Anzali|Mes Rafsanjan|Aluminium Arak|Chadormalou|Chadormalou Ardakan|
     Esteghlal Khuzestan|Havadar|Kheybar Khorramabad|Shams Azar Qazvin|Paykan|Sanat Naft|Sanat Naft Abadan|
     Nassaji Mazandaran|Naft Masjed Soleyman|Fajr Sepasi|Saipa|Pars Jonoubi Jam|Mes Kerman|Esteghlal Mollasani|
     Damash Gilan|Naft Tehran|Rah Ahan|Padideh|Shahr Khodro|Machine Sazi|Siah Jamegan|Sepidrood Rasht|Baadraan Tehran|
     Mes Shahr-e Babak|Naft Abadan|Esteghlal Ahvaz|Saba Qom|Paykan Tehran|Fajr Sepasi Shiraz|Shahin Bushehr`,
  ),
  QA: list(
    `Al-Sadd|Al-Duhail|Al-Rayyan|Al-Gharafa|Al-Arabi|Al-Wakrah|Al-Khor|Qatar SC|Umm Salal|Al-Shamal|Al-Ahli|
     Al-Shahania|Al-Sailiya|Al-Markhiya|Muaither|Mesaimeer|Al-Mesaimeer|Lusail|Al-Kharaitiyat|Al-Bidda|Al-Waab|
     Al-Khor SC|Umm Salal SC|Al-Wakrah SC|Al-Rayyan SC|Lekhwiya|El Jaish|Al-Muaither|Al-Shahaniya`,
  ),
  UZ: list(
    `Pakhtakor|Pakhtakor Tashkent|Nasaf|Nasaf Qarshi|Navbahor|Navbahor Namangan|AGMK|OKMK|Olmaliq|Neftchi Fergana|
     Neftchi Farg'ona|Bunyodkor|Sogdiana|Sogdiana Jizzakh|Surkhon|Surkhon Termez|Andijan|Andijon|Qizilqum|
     Qizilqum Zarafshon|Lokomotiv Tashkent|Dinamo Samarqand|Dinamo Samarkand|Buxoro|Bukhara|Metallurg Bekabad|
     Mash'al Mubarek|Mashal|Turon|Turon Yaypan|Xorazm|Khorazm Urganch|Kokand 1912|Qo'qon 1912|Shortan Guzar|
     Olympic Tashkent|Olimpik Tashkent|Aral Nukus|Dustlik|Traktor Tashkent|Zomin|Bunyodkor Tashkent`,
  ),
  IQ: list(
    `Al-Shorta|Al-Quwa Al-Jawiya|Al-Zawraa|Al-Talaba|Erbil|Erbil SC|Duhok|Duhok SC|Zakho|Zakho SC|Naft Al-Basra|
     Naft Basra|Naft Maysan|Al-Naft|Al-Karma|Al-Najaf|Al-Karkh|Al-Kahrabaa|Al-Minaa|Al-Hudood|Al-Diwaniya|Al-Qasim|
     Al-Mosul|Karbala|Karbalaa|Al-Samawa|Al-Nasiriya|Al-Kut|Al-Hilla|Amanat Baghdad|Al-Sinaa|Newroz|Sulaymaniya|
     Kirkuk|Al-Ramadi|Al-Fallujah|Samarra|Naft Al-Wasat|Al-Bahri|Masafi Al-Wasat|Diyala|Al-Jolan|Al-Hussein|
     Al-Kufa|Babil|Al-Sulaikh`,
  ),
  AE: list(
    `Al-Ain|Shabab Al-Ahli|Al-Wahda|Al-Jazira|Sharjah|Al-Nasr|Al-Wasl|Baniyas|Ajman|Khor Fakkan|Kalba|Ittihad Kalba|
     Al-Bataeh|Al-Dhafra|Dibba|Dibba Al-Fujairah|Al-Fujairah|Fujairah|Emirates Club|Al-Urooba|Hatta|Al-Hamriyah|
     Masfout|Dibba Al-Hisn|Al-Arabi|Al-Taawon|Gulf United|City FC|Al-Dhaid|Al-Khaleej|Al-Ahli Dubai|Al-Shabab Dubai|
     Dubai Club|Al-Jazira Al-Hamra|Al-Rams|Al-Ittihad Kalba|Masafi|Al-Thaid`,
  ),
  CN: list(
    `Shanghai Port|Shanghai SIPG|Shanghai Shenhua|Chengdu Rongcheng|Beijing Guoan|Shandong Taishan|Shandong Luneng|
     Tianjin Jinmen Tiger|Tianjin Teda|Zhejiang FC|Zhejiang Professional|Wuhan Three Towns|Henan FC|Henan Songshan Longmen|
     Qingdao West Coast|Qingdao Hainiu|Changchun Yatai|Shenzhen Peng City|Meizhou Hakka|Cangzhou Mighty Lions|
     Dalian Yingbo|Yunnan Yukun|Chongqing Tonglianglong|Liaoning Tieren|Shijiazhuang Gongfu|Nantong Zhiyun|Guangzhou FC|
     Guangzhou Evergrande|Guangzhou City|Guangzhou R&F|Shenzhen FC|Shenzhen Juniors|Dalian Pro|Dalian Yifang|Dalian Shide|
     Wuhan FC|Wuhan Zall|Hebei FC|Hebei China Fortune|Jiangsu FC|Jiangsu Suning|Chongqing Lifan|Chongqing Liangjiang|
     Shanghai Shenxin|Nanjing City|Suzhou Dongwu|Guangxi Pingguo Haliao|Qingdao Red Lions|Heilongjiang Ice City|
     Shaanxi Union|Dalian Kun City|Dongguan United|Jiangxi Lushan|Hunan Billows|Yanbian Longding|Yanbian Funde|
     Shanghai Jiading Huilong|Beijing BIT|Beijing Renhe|Guizhou Hengfeng|Tianjin Tianhai|Inner Mongolia Zhongyou|
     Sichuan Jiuniu|Xi'an Chongde Ronghai|Shaanxi Chang'an Athletic|Yunnan Lijiang`,
  ),
  VN: list(
    `Hà Nội|Hà Nội FC|Công An Hà Nội|Thể Công-Viettel|Viettel|Nam Định|Thép Xanh Nam Định|Hải Phòng|Thanh Hóa|
     Đông Á Thanh Hóa|Becamex Bình Dương|Bình Dương|Becamex TP.HCM|Hoàng Anh Gia Lai|SHB Đà Nẵng|Đà Nẵng|
     Sông Lam Nghệ An|Hồng Lĩnh Hà Tĩnh|Hà Tĩnh|Quảng Nam|Topenland Bình Định|Bình Định|Quy Nhơn Bình Định|Khánh Hòa|
     TP Hồ Chí Minh|Ho Chi Minh City|PVF-CAND|Ninh Bình|Đồng Tháp|Long An|Cần Thơ|Phù Đổng|Bà Rịa-Vũng Tàu|Huế|
     Đắk Lắk|Bình Phước|Hòa Bình|Than Quảng Ninh|Quảng Ninh|Sài Gòn|Trường Tươi Bình Phước|Đồng Nai|An Giang|Tây Ninh`,
  ),
  TH: list(
    `Buriram United|Bangkok United|BG Pathum United|Port FC|Muangthong United|Chiangrai United|Chiang Rai United|
     Ratchaburi|Ratchaburi FC|Chonburi|Chonburi FC|Sukhothai|Sukhothai FC|Nakhon Ratchasima|Nakhon Ratchasima FC|
     Uthai Thani|Uthai Thani FC|Khon Kaen United|Lamphun Warriors|Nongbua Pitchaya|Prachuap|PT Prachuap|Rayong|Rayong FC|
     Nakhon Pathom United|Police Tero|Kanchanaburi Power|Ayutthaya United|Chiangmai FC|Chiang Mai FC|Chiang Mai United|
     Trat|Trat FC|Suphanburi|Suphanburi FC|Lampang|Lampang FC|Samut Prakan City|Sisaket United|Songkhla|Nakhon Si United|
     Customs United|Pattaya United|Phrae United|Udon Thani|Udon Thani FC|Kasetsart|Bangkok FC|Navy FC|Air Force United|
     Army United|Krabi|Krabi FC|Phuket Andaman|Rajpracha|Chainat Hornbill|Angthong|Nan FC|Yasothon|Mahasarakham|
     Surin City|Roi Et United|Chanthaburi|Prachinburi United|Samut Sakhon City|Nakhon Nayok|Sakon Nakhon|Nong Khai|
     Loei City|Phitsanulok|Phetchabun|Pattani|Narathiwat|Yala City|Satun United|Trang|Khon Kaen|Sisaket|Songkhla United|
     Bangkok Glass|Osotspa|TOT|Kalasin|Nakhon Sawan|Phichit|Uttaradit|Chachoengsao|Samut Songkhram|Saraburi`,
  ),
  IN: list(
    `Mohun Bagan|Mohun Bagan Super Giant|East Bengal|Kerala Blasters|Bengaluru FC|Bengaluru|FC Goa|Mumbai City|
     Chennaiyin|Hyderabad FC|Jamshedpur FC|Jamshedpur|NorthEast United|Odisha FC|Punjab FC|Mohammedan|Mohammedan SC|
     Delhi FC|Gokulam Kerala|Real Kashmir|Churchill Brothers|Sreenidi Deccan|Inter Kashi|Rajasthan United|Namdhari|
     Shillong Lajong|Aizawl|Aizawl FC|NEROCA|TRAU|Dempo|Sporting Clube de Goa|Salgaocar|Mumbai FC|Pune FC|Pune City|
     Bharat FC|Kenkre|Diamond Harbour|Chanmari|Sporting Club Delhi|Bengaluru United|Delhi Dynamos|Chennai City|
     Minerva Punjab|Mumbai Kenkre|Kerala United|ATK|ATK Mohun Bagan|Bhawanipore|Mumbai`,
  ),
  ID: list(
    `Persib|Persib Bandung|Persija|Persija Jakarta|Persebaya|Persebaya Surabaya|Arema|PSM Makassar|Bali United|
     Borneo FC|Dewa United|Madura United|PSIS Semarang|PSS Sleman|Barito Putera|PS Barito Putera|Persis Solo|
     Persik Kediri|Persita Tangerang|PSBS Biak|Semen Padang|Malut United|Bhayangkara|PSIM Yogyakarta|Persijap Jepara|
     Sriwijaya|PSMS Medan|PSPS Pekanbaru|PSPS Riau|Mitra Kukar|Putra Samarinda|Pusamania Borneo|Persipura Jayapura|
     Deltras Sidoarjo|Gresik United|Sulut United|Kalteng Putra|Nusantara United|Bekasi City|Adhyaksa|Persiraja|
     Persela Lamongan|PSKC Cimahi|Sada Sumut|Garudayaksa|Persikota|Persikabo|PS TNI|Persiba Balikpapan|Persekat Tegal|
     Persipa Pati|Persiku Kudus|PSCS Cilacap|Persewar Waropen|Persibo Bojonegoro|Persedikab Kediri|PSPS|
     Persibat Batang|RANS Nusantara|Persis|PSIS|PSS|PSIM`,
  ),
  PH: list(
    `Kaya|Kaya FC|Kaya FC-Iloilo|Stallion Laguna|Dynamic Herb Cebu|Manila Digger|One Taguig|Philippine Army|
     Mendiola FC 1991|Davao Aguilas|Loyola|Loyola Meralco Sparks|Ceres-Negros|United City|Maharlika Manila|
     Maharlika Taguig|Tuloy|Azkals Development Team|Manila Montet|Aguilas-UMak|Global Cebu|Global Makati|Green Archers United|
     Philippine Air Force|Philippine Navy|Pachanga Diliman|Laos FC|Kaya Iloilo`,
  ),
};

// ------------------------------------------------------------------ export

export const AFC: CatalogFileData = {
  file: "afc",
  realClubNames: REAL_CLUB_NAMES,
  nations: [
    JP, AU, SA, KR, IR, QA, UZ, IQ, AE, CN, VN, TH, IN, ID, PH,
    AF, BH, BD, BT, BN, KH, TW, GU, HK, JO, KP, KW, KG, LA, LB, MO,
    MY, MV, MN, MM, NP, OM, PK, PS, SG, LK, SY, TJ, TL, TM, YE,
  ],
  namePools: [
    JAPANESE,
    KOREAN_TOP,
    KOREAN_COMMON,
    KOREAN,
    KOREAN_DPRK,
    CHINESE_TOP,
    CHINESE_COMMON,
    CHINESE,
    TAIWANESE,
    CANTONESE,
    PERSIAN,
    AFGHAN,
    TAJIK,
    TURKMEN,
    KYRGYZ,
    UZBEK,
    GULF,
    KHALEEJI,
    SAUDI,
    QATARI,
    EMIRATI,
    KUWAITI,
    BAHRAINI,
    OMANI,
    YEMENI,
    IRAQI,
    KURDISH,
    LEVANT,
    LEBANESE,
    JORDANIAN,
    SYRIAN,
    PALESTINIAN,
    INDONESIAN,
    FILIPINO,
    THAI,
    VIETNAMESE_NGUYEN,
    VIETNAMESE_COMMON,
    VIETNAMESE,
    LAO,
    KHMER,
    BURMESE,
    MONGOLIAN,
    MALAY,
    STRAIT_CHINESE,
    TAMIL,
    HINDI,
    BENGALI,
    MALAYALI,
    GOAN,
    NORTHEAST_INDIA,
    PUNJABI,
    INDIAN_MUSLIM,
    BANGLADESHI,
    NEPALI,
    PAKISTANI,
    SINHALA,
    LANKA_MOOR,
    MALDIVIAN,
    BHUTANESE,
    TIMORESE,
    CHAMORRO,
    AUSTRALIAN,
    AUSTRALIAN_MIGRANT,
  ],
};
