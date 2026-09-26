import type {
  CatalogFileData,
  CitySize,
  CitySpec,
  HeritageLink,
  MigrationContext,
  NamePool,
  NameSource,
  NationSpec,
  WeightedCode,
  WeightedNameSource,
} from "./types.ts";

// Owner: catalog author "uefa-east" — TR UA RU BY MD GE AM AZ KZ RO BG IL RS BA ME XK AL MK (validate.ts CATALOG_ASSIGNMENT).
// Money in GBP. Coefficient seeds are UEFA association season points, oldest first: 2020/21 … 2024/25.

const words = (text: string) => text.trim().split(/\s+/);
const pool = (name: string, given: string, family: string): NamePool => ({
  id: `uefa-east/${name}`,
  ...(given.trim() ? { given: words(given) } : {}),
  ...(family.trim() ? { family: words(family) } : {}),
});
/** "DE:12 NL:6" → weighted nation codes. */
const weighted = (spec: string): WeightedCode[] =>
  words(spec).map((entry) => {
    const [code, weight] = entry.split(":");
    return { code, weight: Number(weight) };
  });
const links = (context: MigrationContext, spec: string): HeritageLink[] =>
  weighted(spec).map((entry) => ({ ...entry, context }));
/** Districts are "|"-separated because many contain spaces. */
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
const src = (source: NameSource, weight: number): WeightedNameSource => ({ source, weight });

// ------------------------------------------------------------------ name pools (romanized, Latin script only)

const TURKISH = pool(
  "turkish",
  `Arda Kerem Emre Burak Mert Oğuz Barış Can Cengiz Ozan Okay Ferdi Salih Semih Kaan Yusuf Berkan Hakan
   Uğurcan Altay Abdülkerim Çağlar Zeki İrfan Kenan Eren Enes Efe Deniz Umut Yunus Doğukan Ahmetcan Mehmet
   Mustafa Ali Ahmet Hüseyin Hasan İbrahim Ömer Murat Serdar Onur Tolga Volkan Gökhan Selçuk Arif Emirhan
   Berk Batuhan Alperen Furkan Taylan Yasin Halil Bertuğ Kerim Eray Göktan Ertuğrul Muhammed Anıl Rıdvan
   Sinan Samet Cenk Caner Tarık Orkun Metehan Egemen Bartuğ Atakan Enis Recep Fatih Serkan Sercan Kağan
   Taha Emir Yiğit Çınar Aras Mete Alp Kutay Oğulcan Utku Tunahan Muhammet İsmail Erdem Eyüp Oğuzhan
   Abdullah Kadir Harun Musa Onurcan Ramazan Yağız Talha Berat Ensar`,
  `Yılmaz Kaya Demir Şahin Çelik Yıldız Yıldırım Öztürk Aydın Özdemir Arslan Doğan Kılıç Aslan Çetin Kara
   Koç Kurt Özkan Şimşek Polat Özcan Korkmaz Çakır Erdoğan Yavuz Can Acar Şen Aktaş Güler Yalçın Güneş
   Bozkurt Bulut Keskin Ünal Turan Gül Özer Işık Kaplan Avcı Sarı Tekin Taş Köse Yüksel Ateş Aksoy Karaca
   Uysal Tok Akın Kahraman Baysal Eren Toprak Güven Akgül Tosun Çiftçi Karakaya Sönmez Başaran Kocaman
   Akbaş Çalışkan Durmaz Ayhan Yazıcı Tufan Karaman Kutlu Sağlam Özbek Kalkan Akyol Duran Ekinci Uçar
   Özyurt Aksu Bayram Topal Erkan Tuncer Akdeniz Gündoğdu Çınar Altıntaş Er Oral Sezer Tekinalp Karadağ`,
);
const RUSSIAN = pool(
  "russian",
  `Aleksandr Aleksei Anatoli Andrei Anton Arseni Artyom Artur Bogdan Boris Daniil Danila David Denis Dmitri
   Eduard Fyodor Gennadi Georgi Gleb Grigori Igor Ilya Ivan Kirill Konstantin Lev Leonid Makar Maksim Mark
   Matvei Mikhail Miroslav Nikita Nikolai Oleg Pavel Platon Pyotr Roman Rodion Rostislav Ruslan Savva Semyon
   Sergei Stanislav Stepan Svyatoslav Tikhon Timofei Timur Vadim Valentin Valeri Vasili Viktor Vitali
   Vladimir Vladislav Vsevolod Vyacheslav Yakov Yan Yaroslav Yegor Yevgeni Yuri Zakhar Arkadi Emil Filipp
   Ignat Nazar Demid Veniamin Yelisei`,
  `Ivanov Smirnov Kuznetsov Popov Vasilyev Petrov Sokolov Mikhailov Novikov Fyodorov Morozov Volkov Alekseyev
   Lebedev Semyonov Yegorov Pavlov Kozlov Stepanov Nikolayev Orlov Andreyev Makarov Nikitin Zakharov Zaitsev
   Solovyov Borisov Yakovlev Grigoryev Romanov Vorobyov Sergeyev Kuzmin Frolov Aleksandrov Dmitriyev Korolyov
   Gusev Kiselyov Ilyin Maksimov Polyakov Sorokin Vinogradov Kovalyov Belov Medvedev Antonov Tarasov Zhukov
   Baranov Filippov Komarov Davydov Belyayev Gerasimov Bogdanov Osipov Sidorov Matveyev Titov Markov Mironov
   Krylov Kulikov Karpov Vlasov Melnikov Denisov Gavrilov Tikhonov Kazakov Afanasyev Danilov Savelyev
   Timofeyev Fomin Chernov Abramov Martynov Yefimov Fedotov Shcherbakov Nazarov Kalinin Isayev Chernyshov
   Bykov Maslov Rodionov Konovalov Lazarev Voronin Klimov Filatov Ponomaryov Golubev Kudryavtsev Prokhorov
   Naumov Potapov Zhuravlyov Ovchinnikov Trofimov Leonov Sobolev Yermakov Kolesnikov Goncharov Yemelyanov
   Nikiforov Grachyov Kotov Grishin Yefremov Arkhipov Gromov Kirillov Malyshev Panov Moiseyev Rumyantsev
   Akimov Kondratyev Biryukov Gorbunov Anisimov Yeremin Tikhomirov Galkin Lukyanov Mikheyev Skvortsov Yudin
   Belousov Nesterov Simonov Prokofyev Kharitonov Knyazev Tsvetkov Levin Mitrofanov Voronov Aksyonov
   Sofronov Maltsev Loginov Gorshkov Savin Krasnov Mayorov Demidov Yeliseyev Rybakov Safonov Plotnikov Demin
   Khokhlov Fadeyev Molchanov Ignatov Litvinov Yershov Ushakov Dementyev Ryabov Mukhin Kalashnikov Leontyev
   Lobanov Kuzin Korneyev Yevdokimov Borodin Platonov Nekrasov Balashov Bobrov Zhdanov Blinov Ignatyev
   Korotkov Muravyov Kryukov Belyakov Bogomolov Drozdov Lavrov Zuyev Petukhov Larin Nikulin Serov Terentyev
   Zotov Ustinov Fokin Samoylov Konstantinov Sakharov Shishkin Samsonov Cherkasov Chistyakov Nosov
   Spiridonov Karasyov Avdeyev Vorontsov Zverev Vladimirov Seleznyov Nechayev Kudryashov Sedov Firsov
   Andrianov Panin Golovin Terekhov Ulyanov Shestakov Ageyev Nikonov Selivanov Bazhenov Gordeyev Kozhevnikov
   Pakhomov Zimin Kostin Shirokov Filimonov Larionov Ovsyannikov Sazonov Suvorov Kornilov Lyubimov Kopylov
   Lukin Tokarev Kuleshov Shilov Bolshakov Pankratov Rodin Shapovalov Pokrovsky Bocharov Nikolsky Markin
   Gorelov Agafonov Yermolayev Zubkov Kupriyanov Trifonov Kruglov Tretyakov Kolosov Rozhkov Artamonov Laptev`,
);
// North Caucasus, Tatar and Bashkir footballers in Russia.
const RUSSIA_MUSLIM = pool(
  "russia-muslim",
  `Magomed Akhmed Ramazan Rasul Shamil Khamzat Islam Murad Arsen Ilyas Ildar Rinat Marat Rustam Aydar Bulat
   Damir Kamil Radik Ilnur Almaz Zaur Aslan Alan Soslan Khasan Adam Abdulla Gadzhi Zelimkhan Umar Eldar Ali
   Musa Salman Tamerlan Dzhabrail Anzor Aslanbek Azamat Batraz Chermen Inal Ruslan Timur Artur Rafael`,
  `Magomedov Gadzhiyev Abdulayev Akhmedov Aliyev Gasanov Ismailov Musayev Omarov Rashidov Salikhov Tagirov
   Kurbanov Gamzatov Nabiyev Yusupov Khasanov Dzhabrailov Umarov Bagayev Tsallagov Kochiyev Bekoyev
   Tedeyev Bazayev Dzhioyev Kaloyev Khubayev Galiullin Khabibullin Fayzullin Mukhametshin Zinnatullin
   Valiyev Gilmutdinov Sharipov Nurmukhametov Khairullin Garipov Safin Akhmetzyanov Ziganshin Sadykov
   Latypov Gainullin Gabdrakhmanov Yakupov Khuzin Magomadov Akhmadov Bisultanov Sadulayev Utsiyev
   Aliskhanov Gazimagomedov Magomedaliyev Gadzhimuradov Abakarov Ibragimov Shamilov Kaziyev Mirzoyev`,
);
const SERBIAN = pool(
  "serbian",
  `Aleksa Aleksandar Aleksej Andrej Andrija Bogdan Bojan Boris Branko Danilo Darko Dejan Dimitrije Dragan
   Dušan Đorđe Filip Goran Igor Ivan Jovan Kosta Lazar Luka Marko Mateja Matija Mihajlo Milan Miloš Milutin
   Mitar Mladen Momčilo Nebojša Nemanja Nenad Nikola Novak Ognjen Pavle Petar Predrag Radomir Radoš Radovan
   Rastko Relja Saša Sava Slobodan Srđan Stefan Strahinja Tadija Uroš Vanja Vasilije Veljko Vladan Vladimir
   Vukašin Vuk Zoran Željko Živko`,
  `Jovanović Petrović Nikolić Marković Đorđević Stojanović Ilić Stanković Pavlović Milošević Popović
   Todorović Đukić Kostić Mitrović Živković Lazić Radovanović Vasić Tadić Savić Lukić Babić Milovanović
   Obradović Ristić Simić Jović Zdravković Stevanović Janković Kovačević Marić Gajić Antić Radosavljević
   Milenković Veljković Filipović Mladenović Nedeljković Branković Ranković Lalić Mijailović Aleksić Ivanović
   Cvetković Stojković Pantić Krstić Jevtić Ivković Bogdanović Spasić Stanojević Gavrilović Milić Rakić
   Tomić Dimitrijević Mihajlović Vujović Jakovljević Nešić Blagojević Arsić Knežević Dragić Stojiljković
   Mirković Radić Mitić Nenadović Todić Perić Maksimović Andrić Đurić Zečević Ćirić Trifunović Stanić`,
);
const BOSNIAK = pool(
  "bosniak",
  `Adnan Admir Adis Aldin Alen Amar Amel Amer Amir Anel Armin Arnel Asim Asmir Belmin Benjamin Bilal Damir
   Dino Dženan Dževad Edin Edis Eldin Elmedin Elvir Emin Emir Enes Ermedin Ermin Ervin Faruk Hamza Haris
   Harun Hasan Husein Ibrahim Irfan Ismar Jasmin Kemal Kenan Kerim Mahir Mehmed Mirza Muhamed Muris Nedim
   Nermin Nihad Omer Rijad Samir Sanel Sead Selim Semir Senad Sulejman Tarik Vedad Zijad Zlatan`,
  `Hadžić Begović Hodžić Halilović Dedić Bašić Šehić Huseinović Mehić Zukić Hasanović Hukić Ibrišimović
   Mujić Omerović Salihović Delić Hajdarević Alić Bešić Čolić Ćosić Dervišević Fazlić Gušić Hamzić Hasić
   Imamović Jahić Karić Kurtović Mahmutović Memić Muratović Mušić Nuhanović Osmanović Pašić Ramić Selimović
   Softić Suljić Tahirović Turković Velić Zahirović Ahmetović Avdić Bajrić Brkić Hajrović Mujkić Husić
   Smajić Škaljić Šabić Ćatić Handžić Kadrić Mešić Mujagić Sarajlić Spahić Vranić Zulić Ademović
   Bajramović Čaušević Durmić Efendić Hrustanović Jašarević Mehmedović Nurković Pehlić Redžić Sejdić Tanović`,
);
// Ukrainian national transliteration (2010 standard).
const UKRAINIAN = pool(
  "ukrainian",
  `Oleksandr Andrii Mykola Serhii Vitalii Dmytro Yurii Oleh Mykhailo Volodymyr Bohdan Taras Yaroslav Ihor
   Artem Denys Maksym Illia Vladyslav Kyrylo Nazar Roman Ruslan Viktor Vasyl Pavlo Petro Ivan Yevhen Anatolii
   Oleksii Stanislav Valerii Vadym Heorhii Hennadii Zakhar Matvii Danylo Rostyslav Sviatoslav Tymofii Ostap
   Orest Marko Borys Leonid Yakiv Arsenii Anton Eduard Yehor Myroslav Liubomyr Vsevolod Semen Fedir Hryhorii
   Klym Lev Nestor Oles Sava Stepan Tymur Valentyn Viacheslav Arkadii Emil Kostiantyn Mykyta Platon Yan`,
  `Shevchenko Kovalenko Bondarenko Tkachenko Kravchenko Oliinyk Shevchuk Koval Polishchuk Bondar Tkachuk Moroz
   Marchenko Lysenko Rudenko Savchenko Petrenko Kovalchuk Klymenko Pavlenko Savchuk Kuzmenko Ponomarenko
   Vasylenko Kravets Levchenko Kharchenko Karpenko Melnyk Boiko Mazur Honcharenko Honchar Symonenko Dmytrenko
   Ivanenko Kozak Kozachenko Lytvynenko Lytvyn Martyniuk Nazarenko Pavliuk Prykhodko Romaniuk Sydorenko
   Tarasenko Tymchenko Vovk Yakovenko Zhuk Hrytsenko Hordiienko Humeniuk Didenko Dovzhenko Fedorenko Hnatiuk
   Havryliuk Holub Horbenko Ilchenko Kachur Kalyniuk Khomenko Kostenko Kotsiuba Kucher Kulyk Kushnir
   Lukianenko Makarenko Maksymenko Matviienko Mykhailenko Nesterenko Onyshchenko Ostapenko Palamarchuk
   Panchenko Pylypenko Pysarenko Radchenko Rybak Semenko Serhiienko Shapoval Skoryk Stepanenko Stetsenko
   Tereshchenko Tsymbal Vakulenko Voloshyn Yurchenko Zakharchenko Zhuravel Antonenko Bilyk Bilous Chornyi
   Chumak Danylenko Demchenko Demchuk Diachenko Fedoruk Hryshchenko Kaminskyi Kovtun Kuzyk Lozynskyi
   Lytovchenko Mykytiuk Naumenko Ostapchuk Pashchenko Protsenko Revenko Soroka Yatsenko Zadorozhnyi Babych
   Bereza Kondratiuk Levytskyi Mykhalchuk Nahornyi Ovcharenko Pavlyshyn Sirenko Taran Hlushchenko Kravchuk
   Ruban Sokolenko Stasiuk Tymoshchuk Vlasenko Voitenko Yaremenko Klymchuk Hnatenko Hrebeniuk Kyrylenko
   Muzyka Pryimak Sheremet Slobodian Tkach`,
);
const BULGARIAN = pool(
  "bulgarian",
  `Aleksandar Andrey Angel Anton Asen Atanas Blagoy Bogdan Borislav Boyan Bozhidar Daniel Denislav Deyan Dilyan
   Dimitar Dobromir Dragomir Emil Filip Galin Genadi Georgi Grigor Hristiyan Hristo Ilian Iliya Ivan Ivaylo
   Kaloyan Kamen Kiril Konstantin Krasimir Lachezar Lyubomir Marin Martin Metodi Milen Miroslav Mladen Momchil
   Nedelcho Nikola Nikolay Ognyan Pavel Petar Plamen Preslav Radoslav Radostin Rayko Rosen Rumen Simeon Spas
   Stanislav Stefan Stoyan Svetoslav Teodor Tihomir Todor Tsvetan Tsvetomir Valentin Valeri Vasil Veselin
   Viktor Vladimir Yavor Yordan Zahari Zdravko Zhivko Borimir Anatoli Evgeni Ventsislav Velizar Rangel Iskren
   Kristiyan Yoan`,
  `Ivanov Georgiev Dimitrov Petrov Nikolov Stoyanov Todorov Vasilev Kolev Hristov Marinov Angelov Atanasov
   Iliev Yordanov Stefanov Mihaylov Popov Kostov Pavlov Krastev Kirilov Aleksandrov Petkov Tsvetkov Yankov
   Genov Zhelyazkov Kovachev Dobrev Stanev Slavov Lazarov Mitev Ganchev Radev Tonchev Hadzhiev Bozhinov
   Kostadinov Nedelchev Nenov Penev Peev Spasov Stamenov Stanchev Tanev Tsonev Valchev Velikov Velichkov
   Zlatanov Zhekov Bonev Borisov Chakarov Dachev Delchev Denev Donchev Draganov Enchev Filipov Gadzhev
   Galabov Gospodinov Grozev Hristozov Kamenov Kolarov Kotev Kuzmanov Lalov Manolov Minchev Mladenov Naydenov
   Nikolaev Ognyanov Parvanov Pashov Popivanov Rusev Sabev Simeonov Stoychev Terziev Tomov Uzunov Vachev
   Vladimirov Yotov Zahariev Zdravkov Bakalov Belchev Boyanov Chavdarov Dimov Dragomirov Gochev Kalchev Kanev
   Kyuchukov Marchev Milanov Mitkov Naumov Raykov Sotirov Stoilov Tenev Trifonov Vanev Yanev Zafirov Ahmedov
   Mehmedov Mustafov Osmanov Aliev Salimov Hyuseinov Karaivanov`,
);
const MONTENEGRIN = pool(
  "montenegrin",
  `Stefan Nikola Marko Luka Milan Filip Vuk Danilo Andrija Balša Stevan Petar Vasilije Nemanja Igor Dejan
   Vladimir Mirko Darko Nebojša Žarko Milutin Mladen Savo Radomir Ognjen Uroš Dušan Aleksa Lazar Jovan Pavle
   Mihailo Božidar Milovan Veselin Ratko Krsto Vukašin Blažo Đorđije Srđan Draško Vido Nikša`,
  `Vuković Radulović Savić Vučinić Marušić Janković Bošković Popović Radonjić Kaluđerović Đurović Vujović Adžić
   Anđelić Bakić Boljević Bulatović Delibašić Dragojević Drinčić Golubović Ivanović Jovović Kasalica Kavarić
   Krstović Lakić Lekić Lopičić Mandić Marković Martinović Milić Mitrović Mugoša Nikolić Otašević Pejović Perović
   Petrović Raičević Rakočević Raspopović Simović Šćekić Tomašević Vešović Vukčević Vujačić Zeković Zverotić
   Šofranac Kovačević Jovetić Bećiraj Đukić Vukotić Radović Knežević Mijušković Stanišić Babović Bojović Brnović
   Ćetković Damjanović Dubljević Đalović Grbović Jeknić Kljajević Lazović Milačić Nišavić Orlandić Pavićević
   Rašović Sekulić Tomović Vujošević`,
);
const MACEDONIAN = pool(
  "macedonian",
  `Aleksandar Andrej Antonio Bojan Blagoja Boban Daniel Darko David Dejan Dimitar Dragan Filip Gjorgji Goran
   Igor Ivan Jovan Kiril Kristijan Marjan Marko Martin Mihail Milan Nikola Ognen Petar Riste Sašo Stefan
   Stojan Toni Vlatko Vladimir Zoran Zlatko Borče Dragi Gorjan Hristijan Ilija Ljupčo Metodija Mite Nenad Pece
   Robert Sergej Slave Tihomir Trajče Trajan Vančo Viktor Zdravko Jani Tome Kire Vasko`,
  `Stojanovski Nikolovski Trajkovski Petrovski Georgievski Dimitrovski Jovanovski Ristovski Angelovski
   Kostovski Mitrevski Stefanovski Popovski Todorovski Ilievski Pavlovski Markovski Spasovski Velkovski
   Janevski Arsovski Atanasovski Blažeski Bogdanovski Bojadžiski Dimovski Donev Gjorgjievski Hristovski
   Ivanovski Jakimovski Kocev Krstevski Lazarevski Manevski Mladenovski Najdovski Naumovski Nestorovski
   Pančevski Pejovski Risteski Sazdovski Sekulovski Simonovski Spirovski Stavrevski Stojkovski Tasevski
   Tomovski Trajanovski Trenevski Velinovski Zdravkovski Avramovski Bardovski Cvetkovski Dojčinovski
   Filipovski Gligorov Grozdanovski Jankulovski Karanfilovski Kitanovski Lozanovski Micevski Mitrov
   Nedelkovski Ognenovski Pandovski Pavlov Petkovski Ristov Serafimovski Siljanovski Taškovski Veljanovski
   Zafirovski Trajkov Stojanov Andonov Bogoevski Gjurovski Kuzmanovski Miloševski`,
);
// Georgian national romanization (2002).
const GEORGIAN = pool(
  "georgian",
  `Giorgi Davit Levan Nika Luka Irakli Zurab Lasha Otar Giga Saba Sandro Beka Nikoloz Tornike Vakhtang Revaz
   Mikheil Aleksandre Temur Gela Tamaz Jaba Guram Shota Kakha Mamuka Zaza Gocha Tengiz Nodar Vladimer Akaki
   Ilia Archil Badri Dato Gia Merab Paata Rati Tato Toko Vato Zviad Anzor Avtandil Bachana Budu Elguja Gaioz
   Givi Jemal Kote Lado Mate Mirian Murtaz Nugzar Omar Pavle Ramaz Roin Soso Tariel Tedo Teimuraz Valeri
   Zakaria Khvicha Guga Gigi Tsotne Demetre Iuri Anri Data Goga Grigol Ioane Kakhaber Koba Lekso Malkhaz
   Nikusha Rezo Shalva Vasil Zaal`,
  `Beridze Kapanadze Gelashvili Maisuradze Giorgadze Lomidze Tsiklauri Bolkvadze Nozadze Mchedlishvili
   Lobjanidze Chakvetadze Davitashvili Kiteishvili Kashia Kochorashvili Lochoshvili Zivzivadze Kvilitaia Zhvania
   Tabatadze Gvilia Kvekveskiri Dvali Kakabadze Tsitaishvili Gugeshashvili Loria Shengelia Abashidze Abuladze
   Babunashvili Bakradze Basilashvili Chikovani Chkheidze Dadiani Dolidze Gabunia Gogiashvili Gogoladze Gogua
   Gurgenidze Iashvili Japaridze Javakhishvili Jgerenaia Kalandadze Kandelaki Kavtaradze Khachidze Kharaishvili
   Khutsishvili Kobakhidze Kurashvili Lortkipanidze Makharadze Meskhi Metreveli Mikadze Modebadze Nadiradze
   Natsvlishvili Nikoladze Nishnianidze Okropiridze Papava Pirtskhalava Rukhadze Sakhokia Shalikashvili
   Sharashidze Shavgulidze Shonia Sichinava Sikharulidze Tchelidze Tetradze Todua Tsereteli Tsomaia Tsulukidze
   Vashakidze Zarandia Zhghenti Arveladze Kinkladze Demetradze Nemsadze Gakhokidze Asatiani Burduli Jamarauli
   Kobiashvili Kvirkvelia Mujiri Odikadze Revishvili Salukvadze Tskhadadze Khizanishvili Kankava Ananidze
   Okriashvili Dvalishvili Gvelesiani Kharebava Kiknadze Mikeladze Papunashvili Sabanadze Tsintsadze Chanturia
   Gegechkori Lekvtadze Meladze Pantsulaia Rekhviashvili Siradze Tevzadze Tkemaladze Ugrekhelidze`,
);
const ARMENIAN = pool(
  "armenian",
  `Aram Armen Arman Artur Ashot Davit Edgar Erik Gevorg Gor Grigor Hayk Hovhannes Karen Levon Mher Narek Norayr
   Tigran Vahagn Vahe Vardan Varazdat Zaven Arsen Andranik Arayik Artak Artyom Armenak Avetik Garegin Gagik
   Hakob Hamlet Harutyun Hovsep Kamo Khoren Mikael Mkhitar Movses Nerses Petros Robert Ruben Samvel Sargis
   Sergey Sevak Suren Tatul Vachagan Vazgen Yervand Zhirayr Vigen Sos Rafik Rafael Taron Aghasi Albert Emil
   Ernest Gurgen Hrant Manvel Mushegh Nver Smbat Vanik Valeri Yura Zhora Hovik Aleksan`,
  `Hovhannisyan Sargsyan Grigoryan Petrosyan Harutyunyan Khachatryan Karapetyan Hakobyan Gevorgyan Avetisyan
   Poghosyan Vardanyan Martirosyan Ghazaryan Mkrtchyan Hayrapetyan Stepanyan Manukyan Ghukasyan Galstyan
   Minasyan Asatryan Arakelyan Mikayelyan Hambardzumyan Davtyan Simonyan Avagyan Baghdasaryan Aghajanyan
   Sahakyan Movsisyan Barseghyan Zakaryan Melkonyan Hovsepyan Arzumanyan Sukiasyan Nazaryan Babayan Kocharyan
   Yeghiazaryan Mnatsakanyan Ohanyan Andreasyan Arshakyan Voskanyan Tadevosyan Muradyan Alaverdyan Kirakosyan
   Abrahamyan Adamyan Aleksanyan Amirkhanyan Antonyan Arustamyan Asryan Atoyan Badalyan Balasanyan Danielyan
   Dallakyan Esayan Galoyan Gasparyan Ghambaryan Hakhverdyan Hovakimyan Karakhanyan Khachikyan Kostanyan
   Madoyan Malkhasyan Margaryan Markosyan Melikyan Mirzoyan Mkhoyan Nersisyan Nikoghosyan Papikyan
   Parsadanyan Safaryan Shahinyan Tamrazyan Tovmasyan Tumanyan Vanyan Vasilyan Yeranosyan Yesayan Zohrabyan
   Ayvazyan Beglaryan Mkhitaryan Abgaryan Chilingaryan Gabrielyan Karamyan Mamikonyan Matevosyan Mehrabyan
   Mesropyan Torosyan Khanamiryan`,
);
const AZERBAIJANI = pool(
  "azerbaijani",
  `Emin Elvin Elnur Ramil Ruslan Rəşad Tural Anar Orxan Kamran Namiq Mahir Vüqar Cavid Nicat Toral Elçin Ceyhun
   Rauf Samir Vüsal Araz Bəhlul Elmir İlkin Fərid Həsən Hüseyn İsmayıl Kənan Murad Nail Nurlan Qismət Rövşən
   Sərxan Tərlan Ülvi Zaur Aqil Azər Bəxtiyar Coşqun Elşən Emil Faiq Firudin Gündüz Heydər Xəyal Kamal Musa
   Mübariz Nadir Nəriman Pərviz Rəsul Səbuhi Şahin Tofiq Vasif Yusif Zəfər Rüstəm Seymur Ayxan`,
  `Məmmədov Əliyev Həsənov Hüseynov Quliyev İsmayılov Abbasov Rzayev Babayev Cəfərov Kərimov Nəsirov Süleymanov
   Abdullayev Əhmədov Bayramov Mustafayev Nəbiyev Orucov Qasımov Rəhimov Salmanov Şükürov Tağıyev Vəliyev
   Zeynalov Allahverdiyev Axundov Bağırov Dadaşov Fərzəliyev Hacıyev Heydərov İbrahimov İsayev Kazımov Mahmudov
   Mehdiyev Mirzəyev Muradov Musayev Namazov Novruzov Paşayev Qurbanov Ramazanov Sadıqov Səfərov Şirinov
   Talıbov Yusifov Zamanov Ağayev Ələkbərov Əsədov Bəşirov Camalov Eyvazov Hümbətov Kərimli Məhərrəmov
   Nağıyev Nəzərov Qənbərov Rüstəmov Sultanov Xəlilov Yaqubov`,
);
const KAZAKH = pool(
  "kazakh",
  `Abat Abylai Adil Aibar Aibol Aidos Aidar Aibek Akhmet Alibek Alikhan Alisher Almas Almat Altynbek Amir Arman
   Arsen Askhat Aslan Asylkhan Azamat Bakhtiyar Batyrkhan Bauyrzhan Beibit Bekzat Berik Birzhan Dastan Daniyar
   Dauren Dias Didar Dinmukhammed Duman Erasyl Ernar Galymzhan Islambek Islam Kairat Kanat Kuanysh Madi Maksat
   Marat Meiram Miras Mukhtar Murat Nurali Nurbol Nurlan Nursultan Olzhas Rakhat Ramazan Rauan Ruslan Rustam
   Sabyr Samat Sanzhar Serik Sultan Sultanbek Talgat Tamerlan Temirlan Timur Ulan Yeldos Yerkebulan Yerlan
   Yerzhan Zhandos Zhanibek Zhasulan Nuraly Abzal Aldiyar Arystan Bekarys Yersultan Chingiz`,
  `Abdrakhmanov Abishev Abilov Akhmetov Alimbetov Amanov Asanov Aubakirov Baimukhamedov Baizhanov Beisebekov
   Beisenov Bekmukhambetov Dosmagambetov Dzhumabayev Ibraimov Iskakov Kassymov Kenzhebekov Kudaibergenov
   Kurmanov Mukhanov Mussin Myrzakhmetov Nurbayev Nurgaliyev Nurmagambetov Omarov Ospanov Sadykov Sagyndykov
   Sarsenbayev Seitov Shaikenov Suleimenov Temirov Tokhtarov Tulegenov Tursynbayev Utebayev Yerlanov Yeskaliyev
   Zhakupov Zhaksylykov Zhumabayev Zhumakhanov Seidakhmetov Orazov Satpayev Zhanturin Akhmediyarov Almukhanov
   Baitursynov Bekov Duisenbayev Imanaliyev Kadyrbekov Kemelbekov Kosherbayev Kuantayev Mamyrov Nurpeisov
   Ongarov Serikbayev Tatishev Toleuov Uzakbayev Yessenov Zhanabayev Karimov Maksutov Rakhimov Sultanbekov
   Abenov Ashimov Dauletov Ermekov Kaliyev Makhambetov Nurlanov Ryskulov Aitbayev Amirov Bakhytov Baimbetov
   Kairbekov Kulzhanov Mukanov Rustemov Sagimbayev Shakenov Tazhibayev Zhunusov Abdikarimov Beketov
   Dzhaksybekov Kalmurzayev Kunanbayev Orynbayev Saparov Tokenov`,
);
// Belarusian passport romanization (Dzmitry, Siarhei, Kazlou).
const BELARUSIAN = pool(
  "belarusian",
  `Aliaksandr Aliaksei Andrei Anton Artsiom Arsen Bahdan Daniil Dzianis Dzmitry Eduard Filip Hleb Ihar Illia
   Ivan Kanstantsin Kiryl Leanid Maksim Mark Mikalai Mikhail Mikita Pavel Piotr Raman Ruslan Siarhei Stanislau
   Timur Uladzimir Uladzislau Vadzim Valery Vasil Viktar Vital Yahor Yauhen Yaraslau Yury Zakhar Aleh Artur
   Matsvei Ryhor Sviataslau Tsimafei Yan Arkadz Barys Henadz Heorhi Klim Leu Makar Miraslau Nazar Rastsislau
   Stsiapan Taras Vsevalad Yakau Zmitser`,
  `Kazlou Ivanou Novik Kavaliou Karnilenka Sivakou Stasevich Yablonski Bahdanovich Belevich Bykau Dragun
   Filipenka Karpovich Kavalenka Kisliak Klimovich Korzun Kuzmich Lisakovich Makarevich Martynovich Matsukevich
   Nekhaichik Pankavets Pashkevich Pauliuchenka Radkevich Rudzik Savitski Shved Sidarenka Sinkevich Skavysh
   Valadzko Volkau Yaskevich Zhukouski Zhuk Amelchanka Antanovich Baranau Barysevich Bialkevich Hurynovich
   Kalinouski Karatkevich Kuzniatsou Lapko Lebedzeu Malinouski Marozau Mikhailau Navitski Palyakou Parkhomenka
   Ramanau Rybak Sakalou Sazonau Staravoitau Tarasevich Vasilyeu Yakimovich Yakubovich Zakharau Zaitsau Hapon
   Murashka Apanasevich Astapovich Bahdanau Charnou Chyzh Dubrouski Kalachou Karpenka Khilkevich Klimenka
   Kukharchyk Lukashevich Luksha Maksimenka Shumski Verabei Yurchanka Zayats`,
);
const HEBREW = pool(
  "hebrew",
  `Omer Itay Eran Yossi Dor Liel Manor Shon Eden Tal Guy Amit Ido Nir Ofir Roy Yonatan Daniel Noam Ariel Oren
   Idan Shay Tomer Yarden Elad Almog Avi Moshe David Yosef Shlomi Assaf Gal Eyal Nadav Ron Barak Eli Maor Ofek
   Omri Ilay Stav Liran Yoav Adi Sagi Ben Hen Dean Lior Or Raz Yuval Shahar Alon Elior Gil Hai Kobi Dan Itamar
   Uri Ziv Amir Tamir Matan Nati Oz Snir Yaniv Rotem`,
  `Cohen Levi Mizrahi Peretz Biton Dahan Avraham Friedman Azulay Malka Katz Yosef David Amar Ohana Hadad Gabay
   Ben-David Shapira Mor Shalom Elbaz Tal Golan Ashkenazi Sasson Vaknin Ben-Shimon Zohar Avitan Buzaglo Turgeman
   Abuksis Revivo Atar Sabag Ben-Ami Haziza Gozlan Zaken Shitrit Ben-Hamo Elkayam Ifergan Weiss Klein Rosenberg
   Goldberg Schwartz Stern Kaplan Lerner Fischer Weinberg Rubin Segal Berger Shemesh Carmeli Barzilay Dayan Ezra
   Harush Kadosh Nahum Pinto Tsur Yaakov Gavish Hazan Kalifa Madmon Saadon Toledano Yehezkel Alon Ben-Haim Twito
   Ben-Harush Asulin Dror Gordon Amsalem`,
);
const ARAB_ISRAELI = pool(
  "arab-israeli",
  `Mohammad Ahmad Mahmoud Ali Hassan Hussein Khaled Omar Yousef Ibrahim Samir Nasser Fadi Rami Tamer Wael Iyad
   Majd Karim Bilal Hamza Anas Muhannad Saleh Ziad Jamal Nidal Firas Wissam Ramzi Sami Jalal Mousa Ayman Basel
   Diaa Adam Amir Hadi Tareq`,
  `Khalaili Ghanayem Suleiman Jaber Kabha Mahajna Masarwa Hamed Asadi Saba Ayoub Haddad Khoury Bishara Daher
   Shibli Zoabi Tarabin Abbas Salameh Qassem Awad Mansour Habib Sakhnini Taha Yassin Hijazi Darawshe Azzam Omari
   Khatib Abu-Siam Gharra Natour Zbeidat Jabarin Kiwan Shalabi`,
);
// Albania, Kosovo and the Albanian communities of North Macedonia, Montenegro and Serbia.
const ALBANIAN = pool(
  "albanian",
  `Ardit Arben Luan Erion Besnik Ilir Dritan Altin Endri Gent Arlind Faton Agon Albert Alban Albion Andi
   Anxhelo Ardian Arjan Armando Armend Arsim Artan Astrit Bajram Bekim Besart Blerim Burim Dardan Dren Driton
   Edon Egzon Elion Elvis Endrit Enea Erald Ergys Ermal Etrit Fatjon Fisnik Flamur Florent Gazmend Genc Geri
   Gjergj Gledis Herolind Ilirjan Indrit Jetmir Kastriot Klajdi Kledi Klevis Leart Ledian Lorik Lirim Marsel
   Mergim Milot Nderim Orges Petrit Qazim Rei Redon Rilind Sabri Shpëtim Skënder Sokol Taulant Valon Vullnet
   Xhevdet Xhelal Ylli Zenel Alfred Aleksandër Ernest Ervis Florian Kristi Kristian Enis Mirlind Ermir Lindon
   Lum Rron Art Dion Leon Leotrim Fitim Hekuran Kreshnik Lavdrim Meriton Rinor Shkëlzen Visar Zamir Arbnor
   Donat Fabjan Lorenc Mikel Nazmi Rexhep Valmir`,
  `Hoxha Dervishi Kola Basha Shehu Gashi Krasniqi Leka Rama Deda Berisha Shala Hasani Kelmendi Morina Bytyqi
   Hyseni Rexhepi Zeqiri Aliu Ahmeti Ademi Asllani Bajrami Balaj Beqiri Bislimi Çela Dema Dibra Doda Duka
   Frashëri Gjoka Gjini Halili Hajdari Hamiti Haxhiu Hoti Ibrahimi Idrizi Isufi Jashari Kastrati Kuqi Lika
   Mehmeti Memeti Muça Mustafa Musliu Nuhiu Osmani Pepa Pllana Prenga Qosja Ramadani Reçi Salihu Selmani
   Shabani Shkodra Sinani Sylejmani Tahiri Toska Topalli Veseli Vata Xhemaili Xhafa Zeneli Bardhi Bejtullahu
   Beqaj Bunjaku Cana Demiri Elezi Fazliu Fejzullahu Gjonaj Gjonbalaj Haliti Imeri Jakupi Kaba Loshaj Lulaj
   Maloku Marku Mema Mulaj Nikaj Paloka Qerimi Sadiku Sejdiu Shatri Shkurti Spahiu Sulejmani Tasholli Uka
   Ukaj Vokshi Ymeri Zeka Zeqaj Abazi Alimi Arifi Avdiu Brahimi Dauti Emini Fetahu Gega Gjergji Hajrizi Hodaj
   Ismaili Jonuzi Kadriu Lleshi Neziri Pajaziti Qehaja Rexha Rustemi Sefa Sokoli Tafa Kryeziu Behrami Dushku
   Lala Kaçaniku Luzha Mazreku Ndreca Sopi Xhaferi Zymberi Kurtaj`,
);

// ------------------------------------------------------------------ Türkiye

const TR: NationSpec = {
  code: "TR",
  iso2: "TR",
  name: "Türkiye",
  confederation: "UEFA",
  continent: "AS",
  capital: "Ankara",
  latitude: 39.9,
  languages: [
    { code: "tr", weight: 0.86 },
    { code: "ku", weight: 0.12 },
    { code: "ar", weight: 0.02 },
  ],
  reputation: { national: 76, league: 75 },
  euEea: false,
  physique: { height: 180 },
  names: {
    given: [src("faker:tr", 0.55), src("pool:uefa-east/turkish", 0.38), src("faker:ku_kmr_latin", 0.07)],
    family: [src("faker:tr", 0.7), src("pool:uefa-east/turkish", 0.3)],
  },
  nationality: {
    multipleRate: 0.24,
    tripleRate: 0.03,
    bornAbroadRate: 0.12,
    diasporaPull: 0.6,
    links: [
      ...links("germanRecruitment", "DE:12 NL:6 AT:5 BE:4 FR:3 CH:3 SE:1 DK:1"),
      ...links("crossBorder", "EN:1"),
      ...links("regional", "BG:3 AZ:3 BA:1 MK:1 GE:1 CY:1"),
    ],
    citizenship: { dual: "allowed" },
  },
  cities: {
    major: [
      city("İstanbul", "mega", "İstanbul", 7, "Kadıköy|Üsküdar|Beyoğlu|Fatih|Sarıyer|Bakırköy|Pendik|Kartal|Maltepe|Esenler|Bağcılar|Zeytinburnu|Beykoz|Ataşehir|Beylikdüzü|Silivri"),
      city("Ankara", "large", "Ankara", 3, "Çankaya|Keçiören|Yenimahalle|Etimesgut|Sincan|Mamak|Polatlı"),
      city("İzmir", "large", "İzmir", 3, "Bornova|Buca|Konak|Bayraklı|Çiğli|Menemen|Torbalı|Karabağlar"),
      city("Bursa", "large", "Bursa", 2, "Nilüfer|Osmangazi|Yıldırım|Gemlik"),
      city("Antalya", "large", "Antalya", 2, "Muratpaşa|Kepez|Konyaaltı"),
      city("Konya", "large", "Konya", 2, "Selçuklu|Meram|Karatay"),
      city("Adana", "large", "Adana", 2, "Seyhan|Çukurova|Yüreğir"),
      city("Gaziantep", "large", "Gaziantep", 2, "Şahinbey|Şehitkamil"),
      city("Kocaeli", "medium", "Kocaeli", 1),
      city("Kayseri", "large", "Kayseri", 2, "Melikgazi|Kocasinan|Talas"),
      city("Samsun", "medium", "Samsun", 1),
      city("Trabzon", "medium", "Trabzon", 2, "Akçaabat|Ortahisar"),
      city("Mersin", "large", "Mersin", 2, "Yenişehir|Mezitli|Toroslar"),
      city("Diyarbakır", "large", "Diyarbakır", 1),
      city("Rize", "small", "Rize"),
      city("Alanya", "small", "Antalya"),
      city("Eskişehir", "medium", "Eskişehir"),
      city("Şanlıurfa", "large", "Şanlıurfa", 1),
      city("Adapazarı", "medium", "Sakarya"),
      city("Denizli", "medium", "Denizli"),
      city("Malatya", "medium", "Malatya"),
      city("Erzurum", "medium", "Erzurum"),
      city("Sivas", "medium", "Sivas"),
      city("Manisa", "medium", "Manisa"),
      city("Balıkesir", "medium", "Balıkesir"),
      city("Antakya", "medium", "Hatay"),
      city("Kahramanmaraş", "medium", "Kahramanmaraş"),
      city("Van", "medium", "Van"),
      city("Aydın", "medium", "Aydın"),
      city("Tekirdağ", "medium", "Tekirdağ"),
      city("Elazığ", "medium", "Elazığ"),
      city("Batman", "medium", "Batman"),
      city("Bodrum", "town", "Muğla"),
      city("Giresun", "small", "Giresun"),
      city("Ordu", "small", "Ordu"),
      city("Bolu", "small", "Bolu"),
      city("Çorum", "small", "Çorum"),
      city("Zonguldak", "small", "Zonguldak"),
      city("Bandırma", "town", "Balıkesir"),
      city("Iğdır", "small", "Iğdır"),
      city("Afyonkarahisar", "small", "Afyonkarahisar"),
      city("Isparta", "small", "Isparta"),
      city("Tokat", "small", "Tokat"),
      city("Amasya", "small", "Amasya"),
      city("Edirne", "small", "Edirne"),
      city("Çanakkale", "small", "Çanakkale"),
      city("Düzce", "small", "Düzce"),
      city("Kastamonu", "small", "Kastamonu"),
      city("Karabük", "small", "Karabük"),
      city("Uşak", "small", "Uşak"),
      city("Kütahya", "small", "Kütahya"),
      city("Adıyaman", "small", "Adıyaman"),
      city("Nazilli", "town", "Aydın"),
      city("İnegöl", "town", "Bursa"),
      city("Tarsus", "small", "Mersin"),
      city("İskenderun", "small", "Hatay"),
      city("Manavgat", "town", "Antalya"),
      city("Fethiye", "town", "Muğla"),
      city("Ereğli", "town", "Zonguldak"),
    ],
    extra: { max: 150 },
  },
  football: {
    leagues: [
      {
        // 2025/26: 18 clubs, double round robin; the bottom three drop to the 1. Lig (not modeled).
        tier: 1,
        name: "Süper Lig",
        shortName: "Süper Lig",
        size: 18,
        status: "professional",
        reputation: 75,
        clubs: {
          giants: { count: 3, top: 82, bottom: 77 },
          reputation: { top: 69, bottom: 55 },
          capacity: { top: 52_000, bottom: 9_000 },
          facilities: { top: 85, bottom: 52 },
          academy: { top: 76, bottom: 45 },
          wageBill: { top: 120_000_000, bottom: 6_500_000 },
          transferBudget: { top: 70_000_000, bottom: 300_000 },
          foreignShare: 0.55,
          squadSize: [26, 31],
        },
      },
    ],
    movement: [],
    cups: [
      { kind: "national", name: "Türkiye Kupası", shortName: "Kupa", seededEntry: true, legs: 1, neutralFinal: true, continental: true },
      // Four-team format since 2025/26: champion, runner-up, cup winner and cup runner-up.
      {
        kind: "super",
        name: "Süper Kupa",
        participants: ["champion", "runner-up", "cup-winner", "cup-runner-up"],
        legs: 1,
        neutralFinal: true,
        start: "01-06",
      },
    ],
    youth: {
      U19: { divisions: [{ name: "U19 Elit A Ligi", parentTiers: [1, 1], groupSize: 10, groupNames: ["A Grubu", "B Grubu"] }] },
      U17: { divisions: [{ name: "U17 Elit A Ligi", parentTiers: [1, 1], groupSize: 10, groupNames: ["A Grubu", "B Grubu"] }] },
    },
    reserves: { mode: "none" },
    clubNaming: {
      templates: [
        { pattern: "{city}spor", weight: 0.16 },
        { pattern: "{city} Belediyespor", weight: 0.14 },
        { pattern: "{city} FK", weight: 0.13 },
        { pattern: "{city} SK", weight: 0.09 },
        { pattern: "{city} İdmanyurdu", weight: 0.09 },
        { pattern: "{city} Demirspor", weight: 0.07 },
        { pattern: "{city} Gençlikspor", weight: 0.07 },
        { pattern: "Yeni {city}spor", weight: 0.06 },
        { pattern: "{city} Gençlerbirliği", weight: 0.05 },
        { pattern: "{city} Sportif", weight: 0.04 },
        { pattern: "{city}spor {founded}", weight: 0.04 },
        { pattern: "{city} Anadolu", weight: 0.03 },
        { pattern: "{city} Gücü", weight: 0.03 },
      ],
      regional: [
        {
          regions: ["İstanbul"],
          templates: [
            { pattern: "{city} SK", weight: 0.3 },
            { pattern: "{city} FK", weight: 0.25 },
            { pattern: "{city} Gençlikspor", weight: 0.2 },
            { pattern: "{city} İdmanyurdu", weight: 0.15 },
            { pattern: "{city} Sportif", weight: 0.1 },
          ],
        },
      ],
      founded: { top: [1903, 1990], bottom: [1920, 2014] },
      colors: ["#E30A17", "#FDB912", "#00205B", "#000000", "#FFFFFF", "#6E1A3E", "#6CACE4", "#0B7A3E", "#F58025", "#2B3990"],
    },
    importSources: weighted(
      "BR:10 FR:5 NG:5 SN:4 NL:4 BE:3 DE:3 PT:3 AR:3 CM:3 CI:3 GH:3 MA:3 BA:2 RS:2 HR:2 PL:2 UY:2 CO:2 NO:2 DK:2 ES:2 EN:2 GE:2 UA:2 DZ:2 CD:1 ML:1 GN:1 EG:1 CV:1 IT:1 CZ:1 SK:1 SE:1 AT:1 CH:1 XK:1 AL:1 MK:1 KR:1 AZ:1 US:1",
    ),
    coefficients: { association: [3.1, 6.7, 11.8, 12.0, 10.3] },
  },
  abroad: { seniors: 25, youth: 10, destinations: weighted("DE:5 NL:3 ES:2 IT:2 BE:2 AT:2 FR:1 EN:1 PT:1 SA:1") },
};

// ------------------------------------------------------------------ Russia

const RU: NationSpec = {
  code: "RU",
  iso2: "RU",
  name: "Russia",
  confederation: "UEFA",
  continent: "EU",
  capital: "Moskva",
  latitude: 55.8,
  languages: [
    { code: "ru", weight: 0.93 },
    { code: "tt", weight: 0.04 },
    { code: "ce", weight: 0.03 },
  ],
  reputation: { national: 72, league: 68 },
  euEea: false,
  suspended: { club: true, national: true, reason: "UEFA and FIFA suspension of Russian clubs and national teams since February 2022" },
  physique: { height: 182 },
  names: {
    given: [src("pool:uefa-east/russian", 0.85), src("pool:uefa-east/russia-muslim", 0.15)],
    family: [src("pool:uefa-east/russian", 0.84), src("pool:uefa-east/russia-muslim", 0.16)],
  },
  nationality: {
    multipleRate: 0.2,
    tripleRate: 0.03,
    bornAbroadRate: 0.08,
    diasporaPull: 0.25,
    links: [
      ...links("postSoviet", "UA:8 BY:5 KZ:4 AM:4 AZ:3 GE:3 UZ:3 MD:2 KG:2 TJ:2 LV:1 EE:1 LT:1"),
      ...links("regional", "IL:2 DE:2 FI:1 RS:1 BG:1 TR:1"),
    ],
    citizenship: { dual: "allowed" },
  },
  cities: {
    major: [
      city("Moskva", "mega", "Moskva", 5, "Tushino|Izmaylovo|Sokolniki|Lefortovo|Presnya|Cheryomushki|Butovo|Maryino|Kuntsevo|Tekstilshchiki|Perovo|Khamovniki|Zelenograd|Strogino|Chertanovo"),
      city("Sankt-Peterburg", "mega", "Sankt-Peterburg", 2, "Kolpino|Vasileostrovsky|Petrogradsky|Kupchino|Pushkin|Krasnoye Selo"),
      city("Krasnodar", "large", "Krasnodar Krai", 2),
      city("Kazan", "large", "Tatarstan", 2),
      city("Rostov-na-Donu", "large", "Rostov Oblast", 2),
      city("Samara", "large", "Samara Oblast", 2),
      city("Nizhny Novgorod", "large", "Nizhny Novgorod Oblast", 2),
      city("Novosibirsk", "large", "Siberia"),
      city("Yekaterinburg", "large", "Urals"),
      city("Chelyabinsk", "large", "Urals"),
      city("Krasnoyarsk", "large", "Siberia"),
      city("Ufa", "large", "Bashkortostan"),
      city("Omsk", "large", "Siberia"),
      city("Voronezh", "large", "Central Russia"),
      city("Perm", "large", "Urals"),
      city("Volgograd", "large", "Volgograd Oblast"),
      city("Grozny", "medium", "Chechnya"),
      city("Makhachkala", "medium", "Dagestan"),
      city("Kaliningrad", "medium", "Kaliningrad Oblast"),
      city("Orenburg", "medium", "Orenburg Oblast"),
      city("Tolyatti", "medium", "Samara Oblast"),
      city("Sochi", "medium", "Krasnodar Krai"),
      city("Saratov", "medium", "Saratov Oblast"),
      city("Tyumen", "medium", "Urals"),
      city("Izhevsk", "medium", "Udmurtia"),
      city("Barnaul", "medium", "Siberia"),
      city("Khabarovsk", "medium", "Far East"),
      city("Vladivostok", "medium", "Far East"),
      city("Irkutsk", "medium", "Siberia"),
      city("Yaroslavl", "medium", "Central Russia"),
      city("Tula", "medium", "Central Russia"),
      city("Ulyanovsk", "medium", "Ulyanovsk Oblast"),
      city("Tomsk", "medium", "Siberia"),
      city("Stavropol", "medium", "Stavropol Krai"),
      city("Penza", "medium", "Penza Oblast"),
      city("Lipetsk", "medium", "Central Russia"),
      city("Kirov", "medium", "Kirov Oblast"),
      city("Cheboksary", "medium", "Chuvashia"),
      city("Bryansk", "medium", "Central Russia"),
      city("Kursk", "medium", "Central Russia"),
      city("Tver", "medium", "Central Russia"),
      city("Belgorod", "medium", "Central Russia"),
      city("Vladikavkaz", "small", "North Ossetia"),
      city("Nalchik", "small", "Kabardino-Balkaria"),
      city("Khimki", "small", "Moscow Oblast"),
      city("Ryazan", "medium", "Central Russia"),
      city("Astrakhan", "medium", "Astrakhan Oblast"),
      city("Kaluga", "small", "Central Russia"),
      city("Smolensk", "small", "Central Russia"),
      city("Arkhangelsk", "small", "Northwest Russia"),
      city("Murmansk", "small", "Northwest Russia"),
      city("Novokuznetsk", "medium", "Siberia"),
      city("Nizhnekamsk", "small", "Tatarstan"),
      city("Pyatigorsk", "small", "Stavropol Krai"),
    ],
    extra: { max: 150 },
  },
  football: {
    leagues: [
      {
        // 2025/26: 16 clubs, double round robin; two relegated and two relegation play-offs with the First League (not modeled).
        tier: 1,
        name: "Russian Premier League",
        shortName: "RPL",
        size: 16,
        status: "professional",
        reputation: 68,
        clubs: {
          giants: { count: 1, top: 78, bottom: 78 },
          reputation: { top: 72, bottom: 52 },
          capacity: { top: 68_000, bottom: 10_000 },
          facilities: { top: 86, bottom: 50 },
          academy: { top: 80, bottom: 46 },
          wageBill: { top: 85_000_000, bottom: 6_000_000 },
          transferBudget: { top: 40_000_000, bottom: 300_000 },
          foreignShare: 0.35,
          squadSize: [25, 30],
        },
      },
    ],
    movement: [],
    cups: [
      // No continental slot while Russian clubs are suspended.
      { kind: "national", name: "Russian Cup", shortName: "Cup", seededEntry: true, legs: 1, neutralFinal: true, continental: false },
      { kind: "super", name: "Russian Super Cup", participants: ["champion", "cup-winner"], legs: 1, neutralFinal: true, start: "07-12" },
    ],
    youth: {
      U19: { divisions: [{ name: "Youth Football League 1", parentTiers: [1, 1] }] },
      U17: { divisions: [{ name: "Youth Football League 2", parentTiers: [1, 1] }] },
    },
    reserves: { mode: "none" },
    clubNaming: {
      templates: [
        { pattern: "FK {city}", weight: 0.26 },
        { pattern: "Dinamo {city}", weight: 0.08 },
        { pattern: "Spartak {city}", weight: 0.07 },
        { pattern: "Lokomotiv {city}", weight: 0.07 },
        { pattern: "Torpedo {city}", weight: 0.07 },
        { pattern: "Metallurg {city}", weight: 0.05 },
        { pattern: "Avangard {city}", weight: 0.04 },
        { pattern: "SKA {city}", weight: 0.04 },
        { pattern: "Neftekhimik {city}", weight: 0.03 },
        { pattern: "Khimik {city}", weight: 0.03 },
        { pattern: "Shinnik {city}", weight: 0.02 },
        { pattern: "Tekstilshchik {city}", weight: 0.02 },
        { pattern: "Salyut {city}", weight: 0.02 },
        { pattern: "Sokol {city}", weight: 0.02 },
        { pattern: "Znamya {city}", weight: 0.02 },
      ],
      regional: [
        {
          regions: ["Moskva"],
          templates: [
            { pattern: "FK {city}", weight: 0.35 },
            { pattern: "Avangard {city}", weight: 0.2 },
            { pattern: "Salyut {city}", weight: 0.15 },
            { pattern: "Sokol {city}", weight: 0.15 },
            { pattern: "Znamya {city}", weight: 0.15 },
          ],
        },
        {
          regions: ["Siberia"],
          templates: [
            { pattern: "FK {city}", weight: 0.4 },
            { pattern: "Yenisey {city}", weight: 0.2 },
            { pattern: "Sibir {city}", weight: 0.2 },
            { pattern: "Irtysh {city}", weight: 0.2 },
          ],
        },
        {
          regions: ["Far East"],
          templates: [
            { pattern: "FK {city}", weight: 0.4 },
            { pattern: "Luch {city}", weight: 0.3 },
            { pattern: "Okean {city}", weight: 0.3 },
          ],
        },
        {
          regions: ["Chechnya", "Dagestan", "North Ossetia", "Kabardino-Balkaria"],
          templates: [
            { pattern: "FK {city}", weight: 0.4 },
            { pattern: "Terek {city}", weight: 0.3 },
            { pattern: "Legion {city}", weight: 0.3 },
          ],
        },
        {
          regions: ["Urals"],
          templates: [
            { pattern: "FK {city}", weight: 0.4 },
            { pattern: "Ural {city}", weight: 0.3 },
            { pattern: "Metallurg {city}", weight: 0.3 },
          ],
        },
      ],
      founded: { top: [1911, 2018], bottom: [1923, 2018] },
      colors: ["#D40000", "#0085CA", "#003399", "#C8102E", "#00843D", "#000000", "#FFD700", "#FFFFFF", "#1E3A8A"],
    },
    importSources: weighted(
      "BR:10 RS:4 BY:5 AM:3 KZ:3 UZ:3 IR:3 CO:3 AR:3 UY:2 GE:2 BA:2 ME:2 TJ:2 NG:2 CM:2 CI:2 SN:2 KG:1 AZ:1 MK:1 SI:1 PY:1 VE:1 PE:1 CR:1 EG:1 MA:1 GH:1 ML:1 BF:1 GN:1 CD:1 CV:1 FR:1 PT:1",
    ),
    coefficients: { association: [4.333, 5.3, 4.333, 4.333, 4.333] },
  },
  abroad: { seniors: 20, youth: 4, destinations: weighted("FR:3 ES:2 GR:2 TR:2 KZ:3 BY:2 CY:2 US:1 IT:1 AM:1 AE:1") },
};

// ------------------------------------------------------------------ Serbia

const RS: NationSpec = {
  code: "RS",
  iso2: "RS",
  name: "Serbia",
  confederation: "UEFA",
  continent: "EU",
  capital: "Beograd",
  latitude: 44.8,
  languages: [
    { code: "sr", weight: 0.92 },
    { code: "hu", weight: 0.04 },
    { code: "bs", weight: 0.02 },
    { code: "ro", weight: 0.01 },
    { code: "sq", weight: 0.01 },
  ],
  reputation: { national: 72, league: 62 },
  euEea: false,
  physique: { height: 184 },
  names: {
    given: [
      src("faker:sr_RS_latin", 0.62),
      src("pool:uefa-east/serbian", 0.3),
      src("pool:uefa-east/bosniak", 0.03),
      src("faker:hu", 0.03),
      src("pool:uefa-east/albanian", 0.02),
    ],
    family: [
      src("faker:sr_RS_latin", 0.8),
      src("pool:uefa-east/serbian", 0.12),
      src("pool:uefa-east/bosniak", 0.03),
      src("faker:hu", 0.03),
      src("pool:uefa-east/albanian", 0.02),
    ],
  },
  nationality: {
    multipleRate: 0.26,
    tripleRate: 0.04,
    bornAbroadRate: 0.12,
    diasporaPull: 0.5,
    links: [
      ...links("yugoslav", "BA:9 ME:7 HR:4 MK:2 SI:1"),
      ...links("germanRecruitment", "DE:7 AT:6 CH:5 FR:2"),
      ...links("crossBorder", "HU:2 SE:2 RO:1 BG:1 SK:1"),
      ...links("americas", "US:1 CA:1"),
      ...links("commonwealth", "AU:1"),
    ],
    citizenship: { dual: "allowed" },
  },
  cities: {
    major: [
      city("Beograd", "mega", "Beograd", 8, "Zemun|Čukarica|Voždovac|Novi Beograd|Rakovica|Zvezdara|Palilula|Vračar|Savski venac|Obrenovac|Lazarevac|Mladenovac|Surčin|Grocka|Sopot|Barajevo"),
      city("Novi Sad", "large", "Vojvodina", 3, "Petrovaradin|Liman|Detelinara|Klisa|Futog"),
      city("Niš", "large", "Južna i Istočna Srbija", 2, "Pantelej|Crveni Krst|Medijana"),
      city("Kragujevac", "medium", "Šumadija i Zapadna Srbija", 2, "Stanovo|Aerodrom"),
      city("Subotica", "medium", "Vojvodina", 2, "Palić|Bajmok"),
      city("Novi Pazar", "medium", "Šumadija i Zapadna Srbija"),
      city("Pančevo", "medium", "Vojvodina"),
      city("Kruševac", "medium", "Šumadija i Zapadna Srbija"),
      city("Zrenjanin", "medium", "Vojvodina"),
      city("Čačak", "medium", "Šumadija i Zapadna Srbija"),
      city("Kraljevo", "medium", "Šumadija i Zapadna Srbija"),
      city("Smederevo", "medium", "Južna i Istočna Srbija"),
      city("Leskovac", "medium", "Južna i Istočna Srbija"),
      city("Valjevo", "medium", "Šumadija i Zapadna Srbija"),
      city("Šabac", "medium", "Šumadija i Zapadna Srbija"),
      city("Užice", "small", "Šumadija i Zapadna Srbija"),
      city("Vranje", "small", "Južna i Istočna Srbija"),
      city("Sombor", "small", "Vojvodina"),
      city("Požarevac", "small", "Južna i Istočna Srbija"),
      city("Pirot", "small", "Južna i Istočna Srbija"),
      city("Zaječar", "small", "Južna i Istočna Srbija"),
      city("Kikinda", "small", "Vojvodina"),
      city("Sremska Mitrovica", "small", "Vojvodina"),
      city("Jagodina", "small", "Šumadija i Zapadna Srbija"),
      city("Vršac", "small", "Vojvodina"),
      city("Bor", "small", "Južna i Istočna Srbija"),
      city("Loznica", "small", "Šumadija i Zapadna Srbija"),
      city("Bačka Topola", "town", "Vojvodina"),
      city("Lučani", "town", "Šumadija i Zapadna Srbija"),
      city("Ivanjica", "town", "Šumadija i Zapadna Srbija"),
      city("Gornji Milanovac", "town", "Šumadija i Zapadna Srbija"),
      city("Surdulica", "town", "Južna i Istočna Srbija"),
      city("Inđija", "town", "Vojvodina"),
      city("Ub", "town", "Beograd"),
      city("Odžaci", "town", "Vojvodina"),
      city("Aranđelovac", "town", "Šumadija i Zapadna Srbija"),
      city("Paraćin", "town", "Šumadija i Zapadna Srbija"),
      city("Prokuplje", "town", "Južna i Istočna Srbija"),
      city("Bečej", "town", "Vojvodina"),
      city("Stara Pazova", "town", "Vojvodina"),
      city("Ruma", "town", "Vojvodina"),
      city("Kula", "town", "Vojvodina"),
      city("Senta", "town", "Vojvodina"),
      city("Požega", "town", "Šumadija i Zapadna Srbija"),
      city("Aleksinac", "town", "Južna i Istočna Srbija"),
      city("Trstenik", "town", "Šumadija i Zapadna Srbija"),
      city("Negotin", "town", "Južna i Istočna Srbija"),
      city("Vrnjačka Banja", "town", "Šumadija i Zapadna Srbija"),
    ],
    extra: { max: 80 },
  },
  football: {
    leagues: [
      {
        // 2025/26: 16 clubs, 30 rounds, then single round robins in a top-eight and a bottom-eight group (points carried over).
        tier: 1,
        name: "Superliga Srbije",
        shortName: "Superliga",
        size: 16,
        status: "professional",
        reputation: 62,
        split: {
          groups: [
            { name: "Plej-of", positions: [1, 8], roundRobins: 1, points: "full" },
            { name: "Plej-aut", positions: [9, 16], roundRobins: 1, points: "full" },
          ],
        },
        clubs: {
          giants: { count: 2, top: 76, bottom: 70 },
          reputation: { top: 62, bottom: 46 },
          capacity: { top: 53_000, bottom: 3_000 },
          facilities: { top: 78, bottom: 40 },
          academy: { top: 84, bottom: 50 },
          wageBill: { top: 28_000_000, bottom: 800_000 },
          transferBudget: { top: 10_000_000, bottom: 30_000 },
          foreignShare: 0.3,
          squadSize: [25, 30],
        },
      },
      {
        // 2025/26: 16 clubs, same 30 + 7 split format; the bottom clubs drop to the four regional Srpska liga groups (not modeled).
        tier: 2,
        name: "Prva liga Srbije",
        shortName: "Prva liga",
        size: 16,
        status: "semi-professional",
        reputation: 45,
        split: {
          groups: [
            { name: "Plej-of", positions: [1, 8], roundRobins: 1, points: "full" },
            { name: "Plej-aut", positions: [9, 16], roundRobins: 1, points: "full" },
          ],
        },
        clubs: {
          reputation: { top: 45, bottom: 32 },
          capacity: { top: 12_000, bottom: 1_500 },
          facilities: { top: 45, bottom: 25 },
          academy: { top: 55, bottom: 30 },
          wageBill: { top: 1_200_000, bottom: 200_000 },
          transferBudget: { top: 150_000, bottom: 5_000 },
          foreignShare: 0.08,
          squadSize: [25, 30],
        },
      },
    ],
    movement: [{ upper: 1, promoted: 2, relegated: 2 }],
    cups: [{ kind: "national", name: "Kup Srbije", shortName: "Kup", seededEntry: true, legs: 1, neutralFinal: true, continental: true }],
    youth: {
      U19: {
        divisions: [
          { name: "Omladinska liga Srbije", parentTiers: [1, 1] },
          { name: "Omladinska liga", parentTiers: [2, 2], groupSize: 8, groupNames: ["Sever", "Jug"] },
        ],
      },
      U17: {
        divisions: [
          { name: "Kadetska liga Srbije", parentTiers: [1, 1] },
          { name: "Kadetska liga", parentTiers: [2, 2], groupSize: 8, groupNames: ["Sever", "Jug"] },
        ],
      },
    },
    reserves: { mode: "none" },
    clubNaming: {
      templates: [
        { pattern: "FK {city}", weight: 0.24 },
        { pattern: "OFK {city}", weight: 0.08 },
        { pattern: "Radnički {city}", weight: 0.09 },
        { pattern: "Mladost {city}", weight: 0.08 },
        { pattern: "Železničar {city}", weight: 0.06 },
        { pattern: "Jedinstvo {city}", weight: 0.06 },
        { pattern: "Sloga {city}", weight: 0.06 },
        { pattern: "Borac {city}", weight: 0.05 },
        { pattern: "Metalac {city}", weight: 0.05 },
        { pattern: "Radnik {city}", weight: 0.05 },
        { pattern: "Sloboda {city}", weight: 0.04 },
        { pattern: "Napredak {city}", weight: 0.03 },
        { pattern: "Proleter {city}", weight: 0.03 },
        { pattern: "Budućnost {city}", weight: 0.03 },
        { pattern: "Dinamo {city}", weight: 0.02 },
        { pattern: "Spartak {city}", weight: 0.02 },
      ],
      regional: [
        {
          regions: ["Beograd"],
          templates: [
            { pattern: "FK {city}", weight: 0.3 },
            { pattern: "Sloga {city}", weight: 0.15 },
            { pattern: "Mladost {city}", weight: 0.15 },
            { pattern: "Jedinstvo {city}", weight: 0.15 },
            { pattern: "Radnik {city}", weight: 0.15 },
            { pattern: "Budućnost {city}", weight: 0.1 },
          ],
        },
        {
          regions: ["Vojvodina"],
          templates: [
            { pattern: "FK {city}", weight: 0.3 },
            { pattern: "Spartak {city}", weight: 0.12 },
            { pattern: "Proleter {city}", weight: 0.12 },
            { pattern: "Hajduk {city}", weight: 0.12 },
            { pattern: "Jedinstvo {city}", weight: 0.12 },
            { pattern: "Mladost {city}", weight: 0.12 },
            { pattern: "Radnički {city}", weight: 0.1 },
          ],
        },
      ],
      founded: { top: [1911, 1952], bottom: [1911, 2005] },
      colors: ["#C8102E", "#FFFFFF", "#000000", "#0038A8", "#7B1C2E", "#007A3D", "#F2C400", "#1B365D"],
    },
    importSources: weighted(
      "ME:5 BA:5 GH:4 NG:3 MK:3 CM:2 CI:2 SN:2 ML:2 GM:2 BR:3 RU:2 JP:1 GE:1 UA:1 BY:1 RO:1 BG:1 HU:1 SK:1 SI:1 HR:1 PT:1 FR:1 GN:1 ZM:1 CO:1",
    ),
    coefficients: { association: [5.5, 9.5, 5.375, 1.4, 3.725] },
  },
  abroad: {
    seniors: 150,
    youth: 20,
    destinations: weighted(
      "DE:8 IT:7 ES:5 EN:5 FR:4 PT:5 NL:3 BE:5 CH:4 AT:5 TR:8 GR:6 RU:6 CY:5 HU:4 PL:5 SI:3 BA:3 ME:2 BG:4 RO:4 SK:3 CZ:3 SE:2 NO:2 DK:2 SA:2 CN:3 KR:2 US:2 KZ:3 BY:2",
    ),
  },
};

// ------------------------------------------------------------------ Ukraine

const EU_EEA_PARTNERS = "AT BE BG HR CY CZ DK EE FI FR DE GR HU IE IT LV LT LU MT NL PL PT RO SK SI ES SE IS LI NO".split(" ");

const UA: NationSpec = {
  code: "UA",
  iso2: "UA",
  name: "Ukraine",
  confederation: "UEFA",
  continent: "EU",
  capital: "Kyiv",
  latitude: 50.45,
  languages: [
    { code: "uk", weight: 0.78 },
    { code: "ru", weight: 0.2 },
    { code: "hu", weight: 0.01 },
    { code: "ro", weight: 0.01 },
  ],
  reputation: { national: 75, league: 62 },
  euEea: false,
  physique: { height: 182 },
  names: {
    given: [src("pool:uefa-east/ukrainian", 0.86), src("pool:uefa-east/russian", 0.14)],
    family: [src("pool:uefa-east/ukrainian", 0.84), src("pool:uefa-east/russian", 0.16)],
  },
  nationality: {
    multipleRate: 0.22,
    tripleRate: 0.03,
    bornAbroadRate: 0.06,
    diasporaPull: 0.5,
    links: [
      ...links("postSoviet", "RU:8 BY:4 MD:2 KZ:1 GE:1 AM:1 AZ:1"),
      ...links("crossBorder", "PL:5 HU:2 CZ:2 DE:2 RO:1 SK:1 IT:1 PT:1 ES:1"),
      ...links("regional", "IL:2"),
      ...links("americas", "US:1 CA:1"),
    ],
    // Multiple citizenship law of January 2025: only with states on the Cabinet's partner list (never Russia).
    citizenship: { dual: "partners", partners: [...EU_EEA_PARTNERS, "CH", "GB", "US", "CA", "AU", "NZ", "JP", "MD"] },
  },
  cities: {
    major: [
      city("Kyiv", "mega", "Kyiv", 4, "Darnytsia|Sviatoshyn|Podil|Pechersk|Solomianka|Holosiiv|Troieshchyna|Vynohradar|Borshchahivka|Teremky"),
      city("Kharkiv", "large", "Kharkivska", 2, "Saltivka|Kholodna Hora|Osnova"),
      city("Odesa", "large", "Odeska", 2, "Peresyp|Moldavanka|Tairove"),
      city("Dnipro", "large", "Dnipropetrovska", 2, "Amur|Samar|Pobeda"),
      city("Lviv", "large", "Lvivska", 2, "Sykhiv|Levandivka|Zaliznychnyi|Vynnyky"),
      city("Donetsk", "large", "Donetska", 1),
      city("Zaporizhzhia", "large", "Zaporizka", 2),
      city("Kryvyi Rih", "large", "Dnipropetrovska", 2),
      city("Zhytomyr", "medium", "Zhytomyrska"),
      city("Oleksandriia", "small", "Kirovohradska"),
      city("Luhansk", "medium", "Luhanska", 1),
      city("Rivne", "medium", "Rivnenska"),
      city("Cherkasy", "medium", "Cherkaska"),
      city("Poltava", "medium", "Poltavska"),
      city("Mykolaiv", "medium", "Mykolaivska"),
      city("Vinnytsia", "medium", "Vinnytska"),
      city("Kherson", "medium", "Khersonska"),
      city("Chernihiv", "medium", "Chernihivska"),
      city("Sumy", "medium", "Sumska"),
      city("Khmelnytskyi", "medium", "Khmelnytska"),
      city("Ivano-Frankivsk", "medium", "Ivano-Frankivska"),
      city("Ternopil", "medium", "Ternopilska"),
      city("Lutsk", "medium", "Volynska"),
      city("Kropyvnytskyi", "medium", "Kirovohradska"),
      city("Chernivtsi", "medium", "Chernivetska"),
      city("Uzhhorod", "small", "Zakarpatska"),
      city("Kamianske", "medium", "Dnipropetrovska"),
      city("Kremenchuk", "medium", "Poltavska"),
      city("Kamianets-Podilskyi", "small", "Khmelnytska"),
      city("Bila Tserkva", "small", "Kyivska"),
      city("Mukachevo", "small", "Zakarpatska"),
      city("Brovary", "small", "Kyivska"),
      city("Irpin", "small", "Kyivska"),
      city("Nikopol", "small", "Dnipropetrovska"),
      city("Pavlohrad", "small", "Dnipropetrovska"),
      city("Bucha", "town", "Kyivska"),
      city("Kolomyia", "town", "Ivano-Frankivska"),
      city("Drohobych", "town", "Lvivska"),
      city("Uman", "town", "Cherkaska"),
      city("Konotop", "town", "Sumska"),
      city("Izmail", "town", "Odeska"),
      city("Kovel", "town", "Volynska"),
      city("Stryi", "town", "Lvivska"),
      city("Kalush", "town", "Ivano-Frankivska"),
      city("Shepetivka", "town", "Khmelnytska"),
      city("Nizhyn", "town", "Chernihivska"),
      city("Chornomorsk", "town", "Odeska"),
      city("Boryspil", "town", "Kyivska"),
    ],
    extra: { max: 120 },
  },
  football: {
    leagues: [
      {
        // 2025/26: 16 clubs, double round robin; two relegated plus two play-offs with the Persha Liha (not modeled).
        tier: 1,
        name: "Ukrainian Premier League",
        shortName: "UPL",
        size: 16,
        status: "professional",
        reputation: 62,
        clubs: {
          giants: { count: 2, top: 74, bottom: 71 },
          reputation: { top: 62, bottom: 47 },
          capacity: { top: 70_000, bottom: 3_000 },
          facilities: { top: 80, bottom: 42 },
          academy: { top: 82, bottom: 48 },
          wageBill: { top: 38_000_000, bottom: 1_200_000 },
          transferBudget: { top: 22_000_000, bottom: 50_000 },
          foreignShare: 0.2,
          squadSize: [25, 30],
        },
      },
    ],
    movement: [],
    cups: [{ kind: "national", name: "Ukrainian Cup", shortName: "Cup", seededEntry: true, legs: 1, neutralFinal: true, continental: true }],
    youth: {
      U19: { divisions: [{ name: "Ukrainian Premier League U19", parentTiers: [1, 1] }] },
      U17: { divisions: [{ name: "DYuFL U17", parentTiers: [1, 1] }] },
    },
    reserves: { mode: "none" },
    clubNaming: {
      templates: [
        { pattern: "FK {city}", weight: 0.32 },
        { pattern: "Metalurh {city}", weight: 0.07 },
        { pattern: "Kolos {city}", weight: 0.07 },
        { pattern: "Nyva {city}", weight: 0.07 },
        { pattern: "Avanhard {city}", weight: 0.06 },
        { pattern: "Lokomotyv {city}", weight: 0.06 },
        { pattern: "Naftovyk {city}", weight: 0.05 },
        { pattern: "Hirnyk {city}", weight: 0.05 },
        { pattern: "Rukh {city}", weight: 0.04 },
        { pattern: "Olimpik {city}", weight: 0.04 },
        { pattern: "MFK {city}", weight: 0.04 },
        { pattern: "Sokil {city}", weight: 0.03 },
        { pattern: "Enerhetyk {city}", weight: 0.03 },
        { pattern: "Khimik {city}", weight: 0.03 },
        { pattern: "Torpedo {city}", weight: 0.03 },
      ],
      regional: [
        {
          regions: ["Kyiv"],
          templates: [
            { pattern: "FK {city}", weight: 0.4 },
            { pattern: "Kolos {city}", weight: 0.15 },
            { pattern: "Avanhard {city}", weight: 0.15 },
            { pattern: "Sokil {city}", weight: 0.15 },
            { pattern: "Nyva {city}", weight: 0.15 },
          ],
        },
        {
          regions: ["Lvivska", "Zakarpatska", "Ivano-Frankivska", "Chernivetska", "Ternopilska", "Volynska"],
          templates: [
            { pattern: "FK {city}", weight: 0.35 },
            { pattern: "Prykarpattia {city}", weight: 0.15 },
            { pattern: "Pokuttia {city}", weight: 0.15 },
            { pattern: "Nyva {city}", weight: 0.15 },
            { pattern: "Rukh {city}", weight: 0.2 },
          ],
        },
        {
          regions: ["Donetska", "Luhanska", "Dnipropetrovska", "Zaporizka", "Kharkivska"],
          templates: [
            { pattern: "FK {city}", weight: 0.3 },
            { pattern: "Hirnyk {city}", weight: 0.2 },
            { pattern: "Metalurh {city}", weight: 0.2 },
            { pattern: "Stal {city}", weight: 0.15 },
            { pattern: "Avanhard {city}", weight: 0.15 },
          ],
        },
        {
          regions: ["Odeska", "Mykolaivska", "Khersonska"],
          templates: [
            { pattern: "FK {city}", weight: 0.35 },
            { pattern: "MFK {city}", weight: 0.25 },
            { pattern: "Krystal {city}", weight: 0.2 },
            { pattern: "Sudnobudivnyk {city}", weight: 0.2 },
          ],
        },
      ],
      founded: { top: [1923, 2021], bottom: [1923, 2021] },
      colors: ["#0057B8", "#FFD700", "#FF6600", "#FFFFFF", "#000000", "#006B3F", "#C8102E", "#1B365D"],
    },
    importSources: weighted(
      "BR:10 GE:3 NG:2 GH:2 CM:2 CI:2 MD:2 SN:1 ML:1 CO:1 AR:1 AM:1 AZ:1 PT:1 ES:1 HR:1 RS:1 SK:1 CZ:1 PL:1 LT:1 IL:1 VE:1",
    ),
    coefficients: { association: [6.8, 4.2, 5.7, 4.1, 3.6] },
  },
  abroad: {
    seniors: 60,
    youth: 12,
    destinations: weighted("PL:5 CZ:4 SK:3 HU:3 TR:3 CY:3 EN:3 ES:3 IT:3 GR:2 DE:2 BE:2 LV:2 MD:2 KZ:2 NL:1 PT:1 LT:1 EE:1 US:1 SA:1 AT:1 RO:1"),
  },
};

// ------------------------------------------------------------------ Romania

const RO: NationSpec = {
  code: "RO",
  iso2: "RO",
  name: "Romania",
  confederation: "UEFA",
  continent: "EU",
  capital: "București",
  latitude: 44.4,
  languages: [
    { code: "ro", weight: 0.91 },
    { code: "hu", weight: 0.08 },
    { code: "de", weight: 0.01 },
  ],
  reputation: { national: 70, league: 58 },
  euEea: true,
  physique: { height: 181 },
  names: {
    given: [src("faker:ro", 0.93), src("faker:hu", 0.07)],
    family: [src("faker:ro", 0.93), src("faker:hu", 0.07)],
  },
  nationality: {
    multipleRate: 0.22,
    tripleRate: 0.03,
    bornAbroadRate: 0.08,
    diasporaPull: 0.55,
    links: [
      ...links("crossBorder", "MD:10 IT:7 ES:6 DE:5 HU:5 FR:3 EN:3 AT:2 BE:2 UA:2 RS:1 BG:1 PT:1"),
      ...links("americas", "US:1"),
      ...links("regional", "IL:1 TR:1"),
    ],
    citizenship: { dual: "allowed" },
  },
  cities: {
    major: [
      city("București", "mega", "București", 4, "Giulești|Ghencea|Colentina|Militari|Berceni|Drumul Taberei|Pantelimon|Titan|Floreasca|Dristor|Rahova|Crângași|Ferentari|Tei"),
      city("Cluj-Napoca", "large", "Cluj", 2, "Gruia|Mănăștur|Mărăști|Gheorgheni"),
      city("Craiova", "large", "Dolj", 2),
      city("Constanța", "large", "Constanța", 2),
      city("Timișoara", "large", "Timiș", 2),
      city("Iași", "large", "Iași", 2),
      city("Brașov", "large", "Brașov", 2),
      city("Galați", "large", "Galați", 2),
      city("Ploiești", "medium", "Prahova", 2),
      city("Oradea", "medium", "Bihor"),
      city("Arad", "medium", "Arad"),
      city("Pitești", "medium", "Argeș"),
      city("Sibiu", "medium", "Sibiu"),
      city("Brăila", "medium", "Brăila"),
      city("Bacău", "medium", "Bacău"),
      city("Târgu Mureș", "medium", "Mureș"),
      city("Baia Mare", "medium", "Maramureș"),
      city("Buzău", "medium", "Buzău"),
      city("Botoșani", "medium", "Botoșani"),
      city("Satu Mare", "medium", "Satu Mare"),
      city("Râmnicu Vâlcea", "medium", "Vâlcea"),
      city("Suceava", "medium", "Suceava"),
      city("Piatra Neamț", "medium", "Neamț"),
      city("Slobozia", "small", "Ialomița"),
      city("Miercurea Ciuc", "small", "Harghita"),
      city("Sfântu Gheorghe", "small", "Covasna"),
      city("Drobeta-Turnu Severin", "small", "Mehedinți"),
      city("Târgu Jiu", "small", "Gorj"),
      city("Focșani", "small", "Vrancea"),
      city("Bistrița", "small", "Bistrița-Năsăud"),
      city("Tulcea", "small", "Tulcea"),
      city("Reșița", "small", "Caraș-Severin"),
      city("Slatina", "small", "Olt"),
      city("Călărași", "small", "Călărași"),
      city("Alba Iulia", "small", "Alba"),
      city("Giurgiu", "small", "Giurgiu"),
      city("Deva", "small", "Hunedoara"),
      city("Hunedoara", "small", "Hunedoara"),
      city("Zalău", "small", "Sălaj"),
      city("Târgoviște", "small", "Dâmbovița"),
      city("Vaslui", "small", "Vaslui"),
      city("Mioveni", "town", "Argeș"),
      city("Voluntari", "town", "Ilfov"),
      city("Medgidia", "town", "Constanța"),
      city("Petroșani", "town", "Hunedoara"),
      city("Mediaș", "town", "Sibiu"),
      city("Turda", "town", "Cluj"),
      city("Roman", "town", "Neamț"),
      city("Câmpina", "town", "Prahova"),
      city("Alexandria", "town", "Teleorman"),
      city("Ovidiu", "town", "Constanța"),
    ],
    extra: { max: 120 },
  },
  football: {
    leagues: [
      {
        // 2025/26: 16 clubs, 30 rounds, then a top-six play-off (double round robin) and a bottom-ten play-out
        // (single round robin), points halved; two relegated and two relegation play-offs with Liga II (not modeled).
        tier: 1,
        name: "Liga I",
        shortName: "Liga I",
        size: 16,
        status: "professional",
        reputation: 58,
        split: {
          groups: [
            { name: "Play-off", positions: [1, 6], roundRobins: 2, points: "halved" },
            { name: "Play-out", positions: [7, 16], roundRobins: 1, points: "halved" },
          ],
        },
        clubs: {
          reputation: { top: 64, bottom: 46 },
          capacity: { top: 55_600, bottom: 4_000 },
          facilities: { top: 64, bottom: 35 },
          academy: { top: 66, bottom: 38 },
          wageBill: { top: 14_000_000, bottom: 1_400_000 },
          transferBudget: { top: 4_000_000, bottom: 50_000 },
          foreignShare: 0.35,
          squadSize: [25, 30],
        },
      },
    ],
    movement: [],
    cups: [
      { kind: "national", name: "Cupa României", shortName: "Cupa", seededEntry: true, legs: 1, neutralFinal: true, continental: true },
      { kind: "super", name: "Supercupa României", participants: ["champion", "cup-winner"], legs: 1, neutralFinal: true, start: "07-12" },
    ],
    youth: {
      U19: { divisions: [{ name: "Liga Elitelor U19", parentTiers: [1, 1] }] },
      U17: { divisions: [{ name: "Liga Elitelor U17", parentTiers: [1, 1] }] },
    },
    reserves: { mode: "none" },
    clubNaming: {
      templates: [
        { pattern: "FC {city}", weight: 0.2 },
        { pattern: "CS {city}", weight: 0.1 },
        { pattern: "CSM {city}", weight: 0.1 },
        { pattern: "ACS {city}", weight: 0.07 },
        { pattern: "Unirea {city}", weight: 0.07 },
        { pattern: "Universitatea {city}", weight: 0.05 },
        { pattern: "Politehnica {city}", weight: 0.05 },
        { pattern: "Metalul {city}", weight: 0.05 },
        { pattern: "Petrolul {city}", weight: 0.04 },
        { pattern: "Gloria {city}", weight: 0.04 },
        { pattern: "Viitorul {city}", weight: 0.04 },
        { pattern: "Olimpia {city}", weight: 0.04 },
        { pattern: "Minerul {city}", weight: 0.04 },
        { pattern: "FC {region}", weight: 0.04 },
        { pattern: "Progresul {city}", weight: 0.03 },
        { pattern: "Știința {city}", weight: 0.03 },
        { pattern: "Victoria {city}", weight: 0.03 },
        { pattern: "Concordia {city}", weight: 0.03 },
        { pattern: "Sportul {city}", weight: 0.03 },
      ],
      regional: [
        {
          regions: ["Harghita", "Covasna"],
          templates: [
            { pattern: "FK {city}", weight: 0.5 },
            { pattern: "AFC {city}", weight: 0.25 },
            { pattern: "CS {city}", weight: 0.25 },
          ],
        },
        {
          regions: ["Constanța", "Galați", "Brăila", "Tulcea", "Călărași", "Giurgiu"],
          templates: [
            { pattern: "FC {city}", weight: 0.3 },
            { pattern: "Dunărea {city}", weight: 0.25 },
            { pattern: "CSM {city}", weight: 0.25 },
            { pattern: "Unirea {city}", weight: 0.2 },
          ],
        },
      ],
      founded: { top: [1904, 2015], bottom: [1904, 2015] },
      colors: ["#FF0000", "#6A0F2E", "#0033A0", "#FFFFFF", "#7C0A02", "#1E90FF", "#FFD700", "#000000", "#006400"],
    },
    importSources: weighted(
      "PT:5 BR:4 MD:4 ES:3 FR:3 RS:3 IT:3 HR:2 BA:2 ME:2 MK:2 AL:2 BG:2 GR:2 NL:2 HU:2 UA:2 GE:2 NG:2 GH:2 CM:2 CI:2 SN:2 XK:1 BE:1 ML:1 GN:1 CV:1 AO:1 CO:1 AR:1 PL:1 SK:1 CZ:1 SI:1 TN:1 DZ:1 MA:1",
    ),
    coefficients: { association: [3.75, 2.25, 6.25, 3.25, 7.75] },
  },
  abroad: {
    seniors: 60,
    youth: 10,
    destinations: weighted("IT:8 TR:5 ES:4 CY:3 HU:3 BG:3 PL:2 GR:2 DE:2 FR:2 BE:2 MD:2 EN:1 NL:1 PT:1 SA:1 US:1 SK:1 AT:1 CH:1 RS:1"),
  },
};

// ------------------------------------------------------------------ Bulgaria

const BG: NationSpec = {
  code: "BG",
  iso2: "BG",
  name: "Bulgaria",
  confederation: "UEFA",
  continent: "EU",
  capital: "Sofia",
  latitude: 42.7,
  languages: [
    { code: "bg", weight: 0.88 },
    { code: "tr", weight: 0.12 },
  ],
  reputation: { national: 60, league: 52 },
  euEea: true,
  physique: { height: 182 },
  names: {
    given: [src("pool:uefa-east/bulgarian", 0.9), src("pool:uefa-east/turkish", 0.1)],
    family: [src("pool:uefa-east/bulgarian", 1)],
  },
  nationality: {
    multipleRate: 0.2,
    tripleRate: 0.02,
    bornAbroadRate: 0.06,
    diasporaPull: 0.5,
    links: [
      ...links("regional", "TR:6 MK:3 GR:3 RO:1 RS:1"),
      ...links("postSoviet", "RU:2 UA:2 MD:1"),
      ...links("crossBorder", "DE:4 ES:3 EN:3 IT:2 FR:1 NL:1 CY:1"),
      ...links("americas", "US:1"),
    ],
    citizenship: { dual: "allowed" },
  },
  cities: {
    major: [
      city("Sofia", "large", "Sofia City", 7, "Lozenets|Mladost|Lyulin|Nadezhda|Druzhba|Krasno Selo|Poduyane|Slatina|Vitosha|Ovcha Kupel|Serdika|Ilinden|Boyana|Dragalevtsi"),
      city("Plovdiv", "large", "Plovdiv", 3, "Trakia|Kamenitsa|Kyuchuk Parizh|Smirnenski"),
      city("Varna", "large", "Varna", 3, "Asparuhovo|Vladislavovo|Chayka|Galata"),
      city("Burgas", "medium", "Burgas", 2),
      city("Ruse", "medium", "Ruse", 2),
      city("Stara Zagora", "medium", "Stara Zagora", 2),
      city("Razgrad", "small", "Razgrad"),
      city("Pleven", "medium", "Pleven"),
      city("Sliven", "medium", "Sliven"),
      city("Dobrich", "medium", "Dobrich"),
      city("Shumen", "medium", "Shumen"),
      city("Pernik", "medium", "Pernik"),
      city("Haskovo", "medium", "Haskovo"),
      city("Kardzhali", "small", "Kardzhali"),
      city("Vratsa", "small", "Vratsa"),
      city("Montana", "small", "Montana"),
      city("Yambol", "small", "Yambol"),
      city("Pazardzhik", "small", "Pazardzhik"),
      city("Blagoevgrad", "small", "Blagoevgrad"),
      city("Veliko Tarnovo", "small", "Veliko Tarnovo"),
      city("Gabrovo", "small", "Gabrovo"),
      city("Vidin", "small", "Vidin"),
      city("Kyustendil", "small", "Kyustendil"),
      city("Lovech", "small", "Lovech"),
      city("Silistra", "small", "Silistra"),
      city("Targovishte", "small", "Targovishte"),
      city("Smolyan", "small", "Smolyan"),
      city("Asenovgrad", "town", "Plovdiv"),
      city("Kazanlak", "town", "Stara Zagora"),
      city("Dimitrovgrad", "town", "Haskovo"),
      city("Dupnitsa", "town", "Kyustendil"),
      city("Gorna Oryahovitsa", "town", "Veliko Tarnovo"),
      city("Petrich", "town", "Blagoevgrad"),
      city("Sandanski", "town", "Blagoevgrad"),
      city("Samokov", "town", "Sofia Province"),
      city("Svoge", "town", "Sofia Province"),
      city("Botevgrad", "town", "Sofia Province"),
      city("Etropole", "town", "Sofia Province"),
      city("Lom", "town", "Montana"),
      city("Karlovo", "town", "Plovdiv"),
      city("Nesebar", "town", "Burgas"),
      city("Pomorie", "town", "Burgas"),
      city("Svishtov", "town", "Veliko Tarnovo"),
      city("Sevlievo", "town", "Gabrovo"),
      city("Radomir", "town", "Pernik"),
      city("Krumovgrad", "town", "Kardzhali"),
    ],
    extra: { max: 60 },
  },
  football: {
    leagues: [
      {
        // 2025/26: 16 clubs, 30 rounds, then a championship group (1–4) and a Conference League group (5–8) as double
        // round robins and a relegation group (9–16) as a single round robin, points carried over. 2025/26 relegated
        // 14th–16th as the league shrinks to 14 for 2026/27; modeled with the regular two down, two up and two play-offs.
        tier: 1,
        name: "Parva liga",
        shortName: "Parva liga",
        size: 16,
        status: "professional",
        reputation: 52,
        split: {
          groups: [
            { name: "Championship group", positions: [1, 4], roundRobins: 2, points: "full" },
            { name: "Conference League group", positions: [5, 8], roundRobins: 2, points: "full" },
            { name: "Relegation group", positions: [9, 16], roundRobins: 1, points: "full" },
          ],
        },
        clubs: {
          giants: { count: 1, top: 66, bottom: 66 },
          reputation: { top: 56, bottom: 40 },
          capacity: { top: 25_000, bottom: 3_000 },
          facilities: { top: 68, bottom: 30 },
          academy: { top: 60, bottom: 32 },
          wageBill: { top: 18_000_000, bottom: 600_000 },
          transferBudget: { top: 4_000_000, bottom: 20_000 },
          foreignShare: 0.4,
          squadSize: [25, 30],
        },
      },
      {
        // 2025/26: one national second level including the reserve sides of two Parva liga clubs.
        tier: 2,
        name: "Vtora liga",
        shortName: "Vtora liga",
        size: 18,
        status: "semi-professional",
        reputation: 34,
        bTeams: 2,
        clubs: {
          reputation: { top: 38, bottom: 25 },
          capacity: { top: 12_000, bottom: 800 },
          facilities: { top: 32, bottom: 15 },
          academy: { top: 40, bottom: 18 },
          wageBill: { top: 550_000, bottom: 60_000 },
          transferBudget: { top: 50_000, bottom: 0 },
          foreignShare: 0.06,
          squadSize: [25, 30],
        },
      },
    ],
    movement: [
      {
        upper: 1,
        promoted: 2,
        relegated: 2,
        playoffs: [{ type: "cross-tier", upperPositions: [13, 14], lowerPositions: [3, 4], legs: 1 }],
      },
    ],
    cups: [
      { kind: "national", name: "Bulgarian Cup", shortName: "Cup", seededEntry: true, legs: 1, neutralFinal: true, continental: true },
      { kind: "super", name: "Bulgarian Supercup", participants: ["champion", "cup-winner"], legs: 1, neutralFinal: true, start: "07-10" },
    ],
    youth: {
      U19: {
        divisions: [
          { name: "Elitna grupa U19", parentTiers: [1, 1] },
          { name: "Zonalna grupa U19", parentTiers: [2, 2], groupSize: 8, groupNames: ["Zapad", "Iztok"] },
        ],
      },
      U17: {
        divisions: [
          { name: "Elitna grupa U17", parentTiers: [1, 1] },
          { name: "Zonalna grupa U17", parentTiers: [2, 2], groupSize: 8, groupNames: ["Zapad", "Iztok"] },
        ],
      },
    },
    reserves: {
      mode: "pyramid",
      nameTemplate: "{club} II",
      eligibility: { parentTiers: [1], minReputation: 50, maxTeams: 2 },
      pyramid: { highestTier: 2, minGapBelowParent: 1, maxPerTier: 2 },
      squad: [22, 28],
    },
    clubNaming: {
      templates: [
        { pattern: "FK {city}", weight: 0.18 },
        { pattern: "PFK {city}", weight: 0.1 },
        { pattern: "Lokomotiv {city}", weight: 0.08 },
        { pattern: "Spartak {city}", weight: 0.06 },
        { pattern: "Botev {city}", weight: 0.05 },
        { pattern: "Minyor {city}", weight: 0.05 },
        { pattern: "Levski {city}", weight: 0.04 },
        { pattern: "Septemvri {city}", weight: 0.04 },
        { pattern: "Sportist {city}", weight: 0.04 },
        { pattern: "Balkan {city}", weight: 0.04 },
        { pattern: "Slavia {city}", weight: 0.03 },
        { pattern: "Chavdar {city}", weight: 0.03 },
        { pattern: "Akademik {city}", weight: 0.03 },
        { pattern: "Yantra {city}", weight: 0.02 },
        { pattern: "Maritsa {city}", weight: 0.02 },
        { pattern: "Neftochimic {city}", weight: 0.02 },
        { pattern: "Svetkavitsa {city}", weight: 0.02 },
      ],
      regional: [
        {
          regions: ["Sofia City"],
          templates: [
            { pattern: "FK {city}", weight: 0.3 },
            { pattern: "Akademik {city}", weight: 0.2 },
            { pattern: "Sportist {city}", weight: 0.2 },
            { pattern: "Balkan {city}", weight: 0.15 },
            { pattern: "Vitosha {city}", weight: 0.15 },
          ],
        },
        {
          regions: ["Varna", "Burgas", "Dobrich"],
          templates: [
            { pattern: "FK {city}", weight: 0.3 },
            { pattern: "Chernomorets {city}", weight: 0.3 },
            { pattern: "Spartak {city}", weight: 0.2 },
            { pattern: "PFK {city}", weight: 0.2 },
          ],
        },
        {
          regions: ["Blagoevgrad"],
          templates: [
            { pattern: "FK {city}", weight: 0.3 },
            { pattern: "Pirin {city}", weight: 0.35 },
            { pattern: "Vihren {city}", weight: 0.2 },
            { pattern: "Belasitsa {city}", weight: 0.15 },
          ],
        },
        {
          regions: ["Smolyan", "Kardzhali"],
          templates: [
            { pattern: "FK {city}", weight: 0.4 },
            { pattern: "Rodopa {city}", weight: 0.4 },
            { pattern: "Arda {city}", weight: 0.2 },
          ],
        },
        {
          regions: ["Ruse", "Vidin", "Silistra"],
          templates: [
            { pattern: "FK {city}", weight: 0.4 },
            { pattern: "Dunav {city}", weight: 0.4 },
            { pattern: "Lokomotiv {city}", weight: 0.2 },
          ],
        },
      ],
      founded: { top: [1912, 2016], bottom: [1919, 2015] },
      colors: ["#0054A6", "#E4002B", "#006B3F", "#FFFFFF", "#000000", "#7A1F3D", "#FFD100", "#1E3A8A"],
    },
    importSources: weighted(
      "BR:5 PT:4 ES:3 FR:3 RS:3 MK:3 NL:2 NG:2 GH:2 CM:2 CI:2 SN:2 CV:2 BA:2 ME:2 HR:2 RO:2 PL:2 UA:2 GE:2 BE:1 ML:1 GN:1 AO:1 GW:1 CO:1 AR:1 SI:1 AL:1 XK:1 GR:1 CZ:1 SK:1 HU:1 AM:1 SE:1 NO:1 IL:1 TR:1 CD:1 MA:1",
    ),
    coefficients: { association: [4.0, 3.375, 4.5, 4.375, 3.625] },
  },
  abroad: { seniors: 25, youth: 5, destinations: weighted("TR:3 CY:3 PL:2 RO:2 GR:2 RU:2 DE:1 IT:1 EN:1 HU:1 CZ:1 KZ:1 NL:1 US:1 SK:1") },
};

// ------------------------------------------------------------------ Bosnia and Herzegovina

const BA: NationSpec = {
  code: "BA",
  iso2: "BA",
  name: "Bosnia and Herzegovina",
  confederation: "UEFA",
  continent: "EU",
  capital: "Sarajevo",
  latitude: 43.86,
  languages: [
    { code: "bs", weight: 0.52 },
    { code: "sr", weight: 0.31 },
    { code: "hr", weight: 0.17 },
  ],
  reputation: { national: 65, league: 45 },
  euEea: false,
  physique: { height: 184 },
  names: {
    given: [
      src("pool:uefa-east/bosniak", 0.48),
      src("faker:sr_RS_latin", 0.2),
      src("pool:uefa-east/serbian", 0.12),
      src("faker:hr", 0.2),
    ],
    family: [
      src("pool:uefa-east/bosniak", 0.5),
      src("faker:sr_RS_latin", 0.24),
      src("pool:uefa-east/serbian", 0.08),
      src("faker:hr", 0.18),
    ],
  },
  nationality: {
    multipleRate: 0.3,
    tripleRate: 0.05,
    bornAbroadRate: 0.2,
    diasporaPull: 0.55,
    links: [
      ...links("yugoslav", "HR:9 RS:9 SI:3 ME:2 MK:1"),
      ...links("germanRecruitment", "DE:8 AT:7 CH:5"),
      ...links("crossBorder", "SE:5 NO:2 DK:2 NL:2"),
      ...links("americas", "US:3"),
      ...links("commonwealth", "AU:1"),
      ...links("regional", "TR:2"),
    ],
    // By law only with agreement states (HR, RS, SE), but children of the large diaspora hold both from birth.
    citizenship: { dual: "allowed" },
  },
  cities: {
    major: [
      city("Sarajevo", "large", "Sarajevo", 3, "Grbavica|Koševo|Otoka|Ilidža|Vogošća|Hadžići|Hrasnica|Alipašino Polje|Dobrinja"),
      city("Banja Luka", "large", "Republika Srpska", 2, "Borik|Lauš|Starčevica"),
      city("Mostar", "medium", "Hercegovina", 2, "Bijeli Brijeg|Vrapčići|Zalik"),
      city("Tuzla", "medium", "Tuzla", 2, "Slavinovići|Kreka"),
      city("Zenica", "medium", "Zenica-Doboj", 2),
      city("Bijeljina", "medium", "Republika Srpska"),
      city("Široki Brijeg", "town", "Zapadna Hercegovina"),
      city("Doboj", "small", "Republika Srpska"),
      city("Prijedor", "small", "Republika Srpska"),
      city("Posušje", "town", "Zapadna Hercegovina"),
      city("Brčko", "small", "Brčko"),
      city("Bihać", "small", "Una-Sana"),
      city("Cazin", "small", "Una-Sana"),
      city("Travnik", "small", "Srednja Bosna"),
      city("Trebinje", "small", "Republika Srpska"),
      city("Gradiška", "small", "Republika Srpska"),
      city("Zvornik", "small", "Republika Srpska"),
      city("Konjic", "town", "Hercegovina"),
      city("Čapljina", "town", "Hercegovina"),
      city("Ljubuški", "town", "Zapadna Hercegovina"),
      city("Livno", "town", "Kanton 10"),
      city("Tomislavgrad", "town", "Kanton 10"),
      city("Visoko", "town", "Zenica-Doboj"),
      city("Kakanj", "town", "Zenica-Doboj"),
      city("Lukavac", "town", "Tuzla"),
      city("Gradačac", "town", "Tuzla"),
      city("Gračanica", "town", "Tuzla"),
      city("Živinice", "town", "Tuzla"),
      city("Srebrenik", "town", "Tuzla"),
      city("Sanski Most", "town", "Una-Sana"),
      city("Velika Kladuša", "town", "Una-Sana"),
      city("Goražde", "town", "Bosansko-podrinjski"),
      city("Foča", "town", "Republika Srpska"),
      city("Višegrad", "town", "Republika Srpska"),
      city("Derventa", "town", "Republika Srpska"),
      city("Modriča", "town", "Republika Srpska"),
      city("Laktaši", "town", "Republika Srpska"),
      city("Olovo", "town", "Zenica-Doboj"),
      city("Vitez", "town", "Srednja Bosna"),
      city("Novi Travnik", "town", "Srednja Bosna"),
      city("Jajce", "town", "Srednja Bosna"),
      city("Bugojno", "town", "Srednja Bosna"),
      city("Orašje", "town", "Posavina"),
      city("Čitluk", "town", "Hercegovina"),
      city("Neum", "town", "Hercegovina"),
    ],
    extra: { max: 50 },
  },
  football: {
    leagues: [
      {
        // 2025/26: cut from 12 to 10 clubs, four round robins; the bottom two drop to the Prva liga FBiH or Prva liga RS (not modeled).
        tier: 1,
        name: "Premijer liga Bosne i Hercegovine",
        shortName: "Premijer liga",
        size: 10,
        status: "professional",
        reputation: 45,
        roundRobins: 4,
        clubs: {
          reputation: { top: 50, bottom: 36 },
          capacity: { top: 34_500, bottom: 3_000 },
          facilities: { top: 52, bottom: 28 },
          academy: { top: 58, bottom: 32 },
          wageBill: { top: 4_500_000, bottom: 500_000 },
          transferBudget: { top: 800_000, bottom: 20_000 },
          foreignShare: 0.22,
          squadSize: [25, 30],
        },
      },
    ],
    movement: [],
    cups: [{ kind: "national", name: "Kup Bosne i Hercegovine", shortName: "Kup BiH", seededEntry: true, legs: 2, finalLegs: 2, continental: true }],
    youth: {
      U19: { divisions: [{ name: "Omladinska liga BiH", parentTiers: [1, 1] }] },
      U17: { divisions: [{ name: "Kadetska liga BiH", parentTiers: [1, 1] }] },
    },
    reserves: { mode: "none" },
    clubNaming: {
      templates: [
        { pattern: "FK {city}", weight: 0.25 },
        { pattern: "NK {city}", weight: 0.12 },
        { pattern: "Sloga {city}", weight: 0.06 },
        { pattern: "Radnik {city}", weight: 0.06 },
        { pattern: "Rudar {city}", weight: 0.06 },
        { pattern: "Mladost {city}", weight: 0.06 },
        { pattern: "Budućnost {city}", weight: 0.04 },
        { pattern: "Jedinstvo {city}", weight: 0.04 },
        { pattern: "Borac {city}", weight: 0.04 },
        { pattern: "Sloboda {city}", weight: 0.04 },
        { pattern: "Čelik {city}", weight: 0.03 },
        { pattern: "Željezničar {city}", weight: 0.03 },
        { pattern: "Drina {city}", weight: 0.03 },
      ],
      regional: [
        {
          regions: ["Zapadna Hercegovina", "Kanton 10", "Posavina"],
          templates: [
            { pattern: "NK {city}", weight: 0.4 },
            { pattern: "HŠK {city}", weight: 0.3 },
            { pattern: "HNK {city}", weight: 0.3 },
          ],
        },
        {
          regions: ["Republika Srpska"],
          templates: [
            { pattern: "FK {city}", weight: 0.3 },
            { pattern: "Borac {city}", weight: 0.1 },
            { pattern: "Rudar {city}", weight: 0.1 },
            { pattern: "Radnik {city}", weight: 0.1 },
            { pattern: "Sloga {city}", weight: 0.1 },
            { pattern: "Drina {city}", weight: 0.1 },
            { pattern: "Kozara {city}", weight: 0.1 },
            { pattern: "Sloboda {city}", weight: 0.1 },
          ],
        },
        {
          regions: ["Sarajevo"],
          templates: [
            { pattern: "NK {city}", weight: 0.3 },
            { pattern: "Mladost {city}", weight: 0.2 },
            { pattern: "Igman {city}", weight: 0.2 },
            { pattern: "Bosna {city}", weight: 0.15 },
            { pattern: "Olimpik {city}", weight: 0.15 },
          ],
        },
      ],
      founded: { top: [1905, 1950], bottom: [1905, 1950] },
      colors: ["#0000CD", "#800020", "#E4002B", "#FFFFFF", "#0033A0", "#000000", "#FFD100"],
    },
    importSources: weighted("HR:5 RS:4 ME:3 SI:2 MK:2 BR:2 NG:2 GH:1 CM:1 CI:1 SN:1 JP:1 AL:1 XK:1 TR:1 AT:1 DE:1 BG:1"),
    coefficients: { association: [2.625, 1.625, 2.0, 2.25, 4.531] },
  },
  abroad: {
    seniors: 60,
    youth: 12,
    destinations: weighted(
      "DE:6 HR:6 AT:5 TR:4 SI:3 IT:3 CH:3 RS:3 SE:3 US:3 EN:2 BE:2 CY:2 ES:1 NL:1 ME:1 DK:1 NO:1 RU:1 KZ:1 GR:1 PL:1 CZ:1 SK:1 HU:1 SA:1",
    ),
  },
};

// ------------------------------------------------------------------ Montenegro

const ME: NationSpec = {
  code: "ME",
  iso2: "ME",
  name: "Montenegro",
  confederation: "UEFA",
  continent: "EU",
  capital: "Podgorica",
  latitude: 42.44,
  languages: [
    { code: "sr", weight: 0.8 },
    { code: "bs", weight: 0.1 },
    { code: "sq", weight: 0.06 },
    { code: "hr", weight: 0.04 },
  ],
  reputation: { national: 63, league: 36 },
  euEea: false,
  physique: { height: 185 },
  names: {
    given: [
      src("pool:uefa-east/montenegrin", 0.5),
      src("faker:sr_RS_latin", 0.3),
      src("pool:uefa-east/bosniak", 0.12),
      src("pool:uefa-east/albanian", 0.08),
    ],
    family: [
      src("pool:uefa-east/montenegrin", 0.55),
      src("faker:sr_RS_latin", 0.25),
      src("pool:uefa-east/bosniak", 0.12),
      src("pool:uefa-east/albanian", 0.08),
    ],
  },
  nationality: {
    multipleRate: 0.22,
    tripleRate: 0.03,
    bornAbroadRate: 0.1,
    diasporaPull: 0.45,
    links: [
      ...links("yugoslav", "RS:10 BA:5 HR:2 SI:1 MK:1"),
      ...links("regional", "AL:3 XK:1 TR:1"),
      ...links("crossBorder", "DE:3 LU:3 AT:1 SE:1"),
      ...links("americas", "US:2"),
    ],
    // Montenegro does not allow dual citizenship without a bilateral agreement.
    citizenship: { dual: "restricted" },
  },
  cities: {
    major: [
      city("Podgorica", "medium", "Glavni grad", 3, "Konik|Zabjelo|Stara Varoš|Tološi|Masline|Donja Gorica"),
      city("Nikšić", "medium", "Središnja regija", 2),
      city("Bar", "small", "Primorska regija", 2),
      city("Herceg Novi", "small", "Primorska regija"),
      city("Pljevlja", "small", "Sjeverna regija"),
      city("Bijelo Polje", "small", "Sjeverna regija"),
      city("Cetinje", "small", "Središnja regija"),
      city("Berane", "small", "Sjeverna regija"),
      city("Budva", "small", "Primorska regija"),
      city("Ulcinj", "small", "Primorska regija"),
      city("Tivat", "small", "Primorska regija"),
      city("Kotor", "small", "Primorska regija"),
      city("Rožaje", "small", "Sjeverna regija"),
      city("Danilovgrad", "town", "Središnja regija"),
      city("Tuzi", "town", "Središnja regija"),
      city("Golubovci", "town", "Glavni grad"),
      city("Petrovac", "town", "Primorska regija"),
      city("Mojkovac", "town", "Sjeverna regija"),
      city("Plav", "town", "Sjeverna regija"),
      city("Kolašin", "town", "Sjeverna regija"),
      city("Andrijevica", "town", "Sjeverna regija"),
      city("Žabljak", "town", "Sjeverna regija"),
      city("Gusinje", "town", "Sjeverna regija"),
      city("Šavnik", "town", "Sjeverna regija"),
      city("Plužine", "town", "Sjeverna regija"),
      city("Igalo", "town", "Primorska regija"),
      city("Sutomore", "town", "Primorska regija"),
      city("Risan", "town", "Primorska regija"),
      city("Spuž", "town", "Središnja regija"),
    ],
  },
  football: {
    leagues: [
      {
        // 2025/26: 10 clubs, four round robins; the last is relegated and 8th/9th play off against the 2. CFL's 2nd/3rd.
        tier: 1,
        name: "Prva crnogorska liga",
        shortName: "1. CFL",
        size: 10,
        status: "professional",
        reputation: 36,
        roundRobins: 4,
        clubs: {
          reputation: { top: 44, bottom: 28 },
          capacity: { top: 11_300, bottom: 1_000 },
          facilities: { top: 45, bottom: 20 },
          academy: { top: 50, bottom: 25 },
          wageBill: { top: 1_200_000, bottom: 100_000 },
          transferBudget: { top: 200_000, bottom: 0 },
          foreignShare: 0.15,
          squadSize: [25, 30],
        },
      },
      {
        // 2025/26: 10 clubs, four round robins; the regional third tiers are not modeled.
        tier: 2,
        name: "Druga crnogorska liga",
        shortName: "2. CFL",
        size: 10,
        status: "semi-professional",
        reputation: 24,
        roundRobins: 4,
        clubs: {
          reputation: { top: 26, bottom: 16 },
          capacity: { top: 5_000, bottom: 400 },
          facilities: { top: 22, bottom: 10 },
          academy: { top: 30, bottom: 12 },
          wageBill: { top: 120_000, bottom: 20_000 },
          transferBudget: { top: 10_000, bottom: 0 },
          foreignShare: 0.05,
          squadSize: [25, 28],
        },
      },
    ],
    movement: [
      {
        upper: 1,
        promoted: 1,
        relegated: 1,
        playoffs: [{ type: "cross-tier", upperPositions: [8, 9], lowerPositions: [2, 3], legs: 2 }],
      },
    ],
    cups: [{ kind: "national", name: "Kup Crne Gore", shortName: "Kup", seededEntry: true, legs: 2, finalLegs: 1, neutralFinal: true, continental: true }],
    youth: {
      U19: {
        divisions: [
          { name: "Prva omladinska liga", parentTiers: [1, 1] },
          { name: "Druga omladinska liga", parentTiers: [2, 2] },
        ],
      },
      U17: {
        divisions: [
          { name: "Prva kadetska liga", parentTiers: [1, 1] },
          { name: "Druga kadetska liga", parentTiers: [2, 2] },
        ],
      },
    },
    reserves: { mode: "none" },
    clubNaming: {
      templates: [
        { pattern: "FK {city}", weight: 0.3 },
        { pattern: "OFK {city}", weight: 0.12 },
        { pattern: "Mladost {city}", weight: 0.08 },
        { pattern: "Jedinstvo {city}", weight: 0.08 },
        { pattern: "Rudar {city}", weight: 0.06 },
        { pattern: "Budućnost {city}", weight: 0.05 },
        { pattern: "Iskra {city}", weight: 0.05 },
        { pattern: "Lovćen {city}", weight: 0.04 },
        { pattern: "Zeta {city}", weight: 0.04 },
        { pattern: "Čelik {city}", weight: 0.04 },
        { pattern: "Arsenal {city}", weight: 0.03 },
      ],
      regional: [
        {
          regions: ["Primorska regija"],
          templates: [
            { pattern: "FK {city}", weight: 0.3 },
            { pattern: "OFK {city}", weight: 0.2 },
            { pattern: "Mornar {city}", weight: 0.2 },
            { pattern: "Primorac {city}", weight: 0.15 },
            { pattern: "Jadran {city}", weight: 0.15 },
          ],
        },
        {
          regions: ["Sjeverna regija"],
          templates: [
            { pattern: "FK {city}", weight: 0.35 },
            { pattern: "Rudar {city}", weight: 0.25 },
            { pattern: "Jedinstvo {city}", weight: 0.2 },
            { pattern: "OFK {city}", weight: 0.2 },
          ],
        },
        {
          regions: ["Glavni grad"],
          templates: [
            { pattern: "OFK {city}", weight: 0.2 },
            { pattern: "Ribnica {city}", weight: 0.25 },
            { pattern: "Iskra {city}", weight: 0.2 },
            { pattern: "Jedinstvo {city}", weight: 0.2 },
            { pattern: "Zeta {city}", weight: 0.15 },
          ],
        },
      ],
      founded: { top: [1913, 2000], bottom: [1920, 2015] },
      colors: ["#0033A0", "#FFFFFF", "#E4002B", "#000000", "#FFD100", "#006B3F", "#800020"],
    },
    importSources: weighted("RS:5 BA:3 MK:1 HR:1 AL:1 XK:1 BR:1 NG:1 GH:1 SN:1 JP:1 UA:1 RU:1"),
    coefficients: { association: [1.625, 0.75, 1.0, 1.333, 2.5] },
  },
  abroad: {
    seniors: 50,
    youth: 8,
    destinations: weighted("RS:10 BA:3 TR:3 IT:3 RU:3 HR:2 SI:2 DE:2 CY:2 GR:2 KZ:2 BG:2 ES:1 FR:1 BE:1 RO:1 HU:1 PL:1 LU:1 US:1 KR:1 CN:1 AL:1"),
  },
};

// ------------------------------------------------------------------ Kosovo

const XK: NationSpec = {
  code: "XK",
  iso2: "XK",
  name: "Kosovo",
  confederation: "UEFA",
  continent: "EU",
  capital: "Prishtina",
  latitude: 42.66,
  languages: [
    { code: "sq", weight: 0.93 },
    { code: "sr", weight: 0.05 },
    { code: "tr", weight: 0.01 },
    { code: "bs", weight: 0.01 },
  ],
  reputation: { national: 62, league: 40 },
  euEea: false,
  physique: { height: 181 },
  names: {
    given: [
      src("pool:uefa-east/albanian", 0.92),
      src("pool:uefa-east/serbian", 0.04),
      src("pool:uefa-east/bosniak", 0.02),
      src("pool:uefa-east/turkish", 0.02),
    ],
    family: [
      src("pool:uefa-east/albanian", 0.92),
      src("faker:sr_RS_latin", 0.04),
      src("pool:uefa-east/bosniak", 0.02),
      src("faker:tr", 0.02),
    ],
  },
  nationality: {
    multipleRate: 0.32,
    tripleRate: 0.05,
    bornAbroadRate: 0.2,
    diasporaPull: 0.6,
    links: [
      ...links("regional", "AL:10 MK:3 TR:2 ME:1"),
      ...links("yugoslav", "RS:2"),
      ...links("germanRecruitment", "DE:9 CH:9 AT:5"),
      ...links("crossBorder", "SE:3 BE:2 NO:2 FI:2 IT:2 EN:2 SI:1 DK:1 NL:1"),
      ...links("americas", "US:1"),
    ],
    citizenship: { dual: "allowed" },
  },
  cities: {
    major: [
      city("Prishtina", "medium", "Prishtina", 2, "Dardania|Ulpiana|Kodra e Diellit|Mati|Lakrishte"),
      city("Prizren", "medium", "Prizren"),
      city("Gjilan", "medium", "Gjilan", 2),
      city("Ferizaj", "medium", "Ferizaj"),
      city("Peja", "medium", "Peja"),
      city("Gjakova", "medium", "Gjakova"),
      city("Mitrovica", "medium", "Mitrovica"),
      city("Suhareka", "small", "Prizren"),
      city("Podujeva", "small", "Prishtina"),
      city("Drenas", "small", "Prishtina"),
      city("Malisheva", "small", "Prizren"),
      city("Vushtrri", "small", "Mitrovica"),
      city("Rahovec", "small", "Gjakova"),
      city("Lipjan", "small", "Prishtina"),
      city("Kamenica", "small", "Gjilan"),
      city("Viti", "small", "Gjilan"),
      city("Deçan", "small", "Peja"),
      city("Istog", "small", "Peja"),
      city("Klina", "small", "Peja"),
      city("Skenderaj", "small", "Mitrovica"),
      city("Dragash", "town", "Prizren"),
      city("Fushë Kosova", "town", "Prishtina"),
      city("Kaçanik", "town", "Ferizaj"),
      city("Shtime", "town", "Ferizaj"),
      city("Obiliq", "town", "Prishtina"),
      city("Hani i Elezit", "town", "Ferizaj"),
      city("Junik", "town", "Gjakova"),
      city("Graçanica", "town", "Prishtina"),
      city("Shtërpca", "town", "Ferizaj"),
      city("Zveçan", "town", "Mitrovica"),
    ],
  },
  football: {
    leagues: [
      {
        // 2025/26: 10 clubs, four round robins; the last is relegated and 8th/9th play relegation play-offs (not modeled).
        tier: 1,
        name: "Superliga e Kosovës",
        shortName: "Superliga",
        size: 10,
        status: "professional",
        reputation: 40,
        roundRobins: 4,
        clubs: {
          reputation: { top: 44, bottom: 30 },
          capacity: { top: 13_500, bottom: 1_500 },
          facilities: { top: 40, bottom: 18 },
          academy: { top: 45, bottom: 22 },
          wageBill: { top: 1_600_000, bottom: 150_000 },
          transferBudget: { top: 200_000, bottom: 0 },
          foreignShare: 0.15,
          squadSize: [25, 30],
        },
      },
    ],
    movement: [],
    cups: [
      { kind: "national", name: "Kupa e Kosovës", shortName: "Kupa", seededEntry: true, legs: 1, neutralFinal: true, continental: true },
      { kind: "super", name: "Superkupa e Kosovës", participants: ["champion", "cup-winner"], legs: 1, neutralFinal: true, start: "08-10" },
    ],
    youth: {
      U19: { divisions: [{ name: "Liga e të Rinjve U19", parentTiers: [1, 1] }] },
      U17: { divisions: [{ name: "Liga e Kadetëve U17", parentTiers: [1, 1] }] },
    },
    reserves: { mode: "none" },
    clubNaming: {
      templates: [
        { pattern: "KF {city}", weight: 0.35 },
        { pattern: "FC {city}", weight: 0.12 },
        { pattern: "KF {city} {founded2}", weight: 0.06 },
        { pattern: "Vëllaznimi {city}", weight: 0.05 },
        { pattern: "Liria {city}", weight: 0.05 },
        { pattern: "Besa {city}", weight: 0.05 },
        { pattern: "Flamurtari {city}", weight: 0.05 },
        { pattern: "Drita {city}", weight: 0.04 },
        { pattern: "Rilindja {city}", weight: 0.04 },
        { pattern: "Kosova {city}", weight: 0.04 },
      ],
      regional: [
        {
          regions: ["Prishtina"],
          templates: [
            { pattern: "Flamurtari {city}", weight: 0.3 },
            { pattern: "Kosova {city}", weight: 0.25 },
            { pattern: "Rilindja {city}", weight: 0.2 },
            { pattern: "Ulpiana {city}", weight: 0.25 },
          ],
        },
        {
          regions: ["Peja", "Gjakova"],
          templates: [
            { pattern: "KF {city}", weight: 0.4 },
            { pattern: "Dukagjini {city}", weight: 0.3 },
            { pattern: "Besa {city}", weight: 0.3 },
          ],
        },
        {
          regions: ["Mitrovica"],
          templates: [
            { pattern: "KF {city}", weight: 0.4 },
            { pattern: "Trepça {city}", weight: 0.3 },
            { pattern: "Minatori {city}", weight: 0.3 },
          ],
        },
      ],
      founded: { top: [1922, 1995], bottom: [1922, 1995] },
      colors: ["#0000CD", "#FFD700", "#FFFFFF", "#E4002B", "#000000", "#006B3F", "#800020"],
    },
    importSources: weighted("AL:5 MK:3 BR:2 NG:2 GH:2 CM:1 CI:1 SN:1 HR:1 BA:1 ME:1 SI:1 TR:1 DE:1 CH:1"),
    coefficients: { association: [1.833, 2.333, 2.875, 3.0, 2.0] },
  },
  abroad: {
    seniors: 40,
    youth: 10,
    destinations: weighted("CH:5 DE:5 AL:5 SE:3 TR:3 NO:2 BE:2 AT:2 FI:2 IT:2 SI:2 DK:1 NL:1 CZ:1 PL:1 HU:1 EN:1 FR:1 ES:1 US:1 SK:1"),
  },
};

// ------------------------------------------------------------------ Albania

const AL: NationSpec = {
  code: "AL",
  iso2: "AL",
  name: "Albania",
  confederation: "UEFA",
  continent: "EU",
  capital: "Tirana",
  latitude: 41.33,
  languages: [
    { code: "sq", weight: 0.98 },
    { code: "el", weight: 0.02 },
  ],
  reputation: { national: 67, league: 42 },
  euEea: false,
  physique: { height: 181 },
  names: {
    given: [src("pool:uefa-east/albanian", 1)],
    family: [src("pool:uefa-east/albanian", 1)],
  },
  nationality: {
    multipleRate: 0.28,
    tripleRate: 0.04,
    bornAbroadRate: 0.15,
    diasporaPull: 0.55,
    links: [
      ...links("mediterranean", "IT:10 GR:9"),
      ...links("regional", "XK:7 MK:5 ME:2 TR:1"),
      ...links("crossBorder", "DE:4 CH:4 EN:3 BE:2 AT:1 FR:1 SE:1"),
      ...links("americas", "US:2"),
    ],
    citizenship: { dual: "allowed" },
  },
  cities: {
    major: [
      city("Tirana", "large", "Tiranë", 3, "Kombinat|Laprakë|Kinostudio|Selitë|Kashar|Farkë|Paskuqan"),
      city("Durrës", "medium", "Durrës", 2),
      city("Shkodër", "medium", "Shkodër"),
      city("Vlorë", "medium", "Vlorë"),
      city("Elbasan", "medium", "Elbasan"),
      city("Fier", "medium", "Fier"),
      city("Korçë", "medium", "Korçë"),
      city("Berat", "small", "Berat"),
      city("Lushnjë", "small", "Fier"),
      city("Kavajë", "small", "Tiranë"),
      city("Pogradec", "small", "Korçë"),
      city("Laç", "small", "Lezhë"),
      city("Gjirokastër", "small", "Gjirokastër"),
      city("Sarandë", "small", "Vlorë"),
      city("Kukës", "small", "Kukës"),
      city("Lezhë", "small", "Lezhë"),
      city("Rrogozhinë", "town", "Tiranë"),
      city("Ballsh", "town", "Fier"),
      city("Patos", "town", "Fier"),
      city("Krujë", "town", "Durrës"),
      city("Peshkopi", "town", "Dibër"),
      city("Kuçovë", "town", "Berat"),
      city("Burrel", "town", "Dibër"),
      city("Tepelenë", "town", "Gjirokastër"),
      city("Përmet", "town", "Gjirokastër"),
      city("Librazhd", "town", "Elbasan"),
      city("Bulqizë", "town", "Dibër"),
      city("Vorë", "town", "Tiranë"),
      city("Shijak", "town", "Durrës"),
      city("Divjakë", "town", "Fier"),
      city("Fushë-Krujë", "town", "Durrës"),
      city("Himarë", "town", "Vlorë"),
      city("Bilisht", "town", "Korçë"),
      city("Ersekë", "town", "Korçë"),
      city("Gramsh", "town", "Elbasan"),
      city("Mamurras", "town", "Lezhë"),
      city("Rrëshen", "town", "Lezhë"),
      city("Delvinë", "town", "Vlorë"),
    ],
    extra: { max: 40 },
  },
  football: {
    leagues: [
      {
        // 2025/26: 10 clubs, four round robins, then one-legged semi-finals and a final among the top four decide
        // the title; the last is relegated and 8th/9th play relegation play-offs (not modeled).
        tier: 1,
        name: "Kategoria Superiore",
        shortName: "Superiore",
        size: 10,
        status: "professional",
        reputation: 42,
        roundRobins: 4,
        championship: { positions: [1, 4], legs: 1, finalLegs: 1, neutralFinal: true },
        clubs: {
          reputation: { top: 46, bottom: 30 },
          capacity: { top: 22_500, bottom: 1_500 },
          facilities: { top: 48, bottom: 20 },
          academy: { top: 48, bottom: 22 },
          wageBill: { top: 2_200_000, bottom: 180_000 },
          transferBudget: { top: 300_000, bottom: 0 },
          foreignShare: 0.3,
          squadSize: [25, 30],
        },
      },
    ],
    movement: [],
    cups: [
      { kind: "national", name: "Kupa e Shqipërisë", shortName: "Kupa", seededEntry: true, legs: 2, finalLegs: 1, neutralFinal: true, continental: true },
      { kind: "super", name: "Superkupa e Shqipërisë", participants: ["champion", "cup-winner"], legs: 1, neutralFinal: true, start: "08-15" },
    ],
    youth: {
      U19: { divisions: [{ name: "Kampionati Kombëtar U19", parentTiers: [1, 1] }] },
      U17: { divisions: [{ name: "Kampionati Kombëtar U17", parentTiers: [1, 1] }] },
    },
    reserves: { mode: "none" },
    clubNaming: {
      templates: [
        { pattern: "KF {city}", weight: 0.2 },
        { pattern: "KS {city}", weight: 0.12 },
        { pattern: "Besa {city}", weight: 0.05 },
        { pattern: "Flamurtari {city}", weight: 0.05 },
        { pattern: "Luftëtari {city}", weight: 0.05 },
        { pattern: "Vllaznia {city}", weight: 0.04 },
        { pattern: "Dinamo {city}", weight: 0.04 },
        { pattern: "Iliria {city}", weight: 0.04 },
        { pattern: "Kastrioti {city}", weight: 0.04 },
        { pattern: "Partizani {city}", weight: 0.03 },
        { pattern: "Adriatiku {city}", weight: 0.03 },
        { pattern: "Sopoti {city}", weight: 0.03 },
        { pattern: "Turbina {city}", weight: 0.03 },
        { pattern: "Erzeni {city}", weight: 0.03 },
        { pattern: "Apolonia {city}", weight: 0.03 },
        { pattern: "Skënderbeu {city}", weight: 0.03 },
        { pattern: "Tomori {city}", weight: 0.03 },
        { pattern: "Shkumbini {city}", weight: 0.03 },
        { pattern: "Butrinti {city}", weight: 0.03 },
        { pattern: "Korabi {city}", weight: 0.03 },
        { pattern: "Teuta {city}", weight: 0.02 },
      ],
      regional: [
        {
          regions: ["Tiranë"],
          templates: [
            { pattern: "KS {city}", weight: 0.3 },
            { pattern: "Besa {city}", weight: 0.25 },
            { pattern: "Iliria {city}", weight: 0.25 },
            { pattern: "Erzeni {city}", weight: 0.2 },
          ],
        },
      ],
      founded: { top: [1909, 2014], bottom: [1909, 2014] },
      colors: ["#E4002B", "#000000", "#FFFFFF", "#0033A0", "#FFD700", "#006B3F", "#800020", "#1E90FF"],
    },
    importSources: weighted("BR:5 XK:3 NG:2 GH:2 CI:2 CM:2 SN:2 MK:2 ME:2 IT:2 ML:1 GN:1 CV:1 HR:1 BA:1 GR:1 AR:1 CO:1 PT:1 FR:1 ES:1 US:1"),
    coefficients: { association: [2.0, 1.625, 0.875, 2.125, 1.25] },
  },
  abroad: {
    seniors: 50,
    youth: 10,
    destinations: weighted("IT:10 GR:4 XK:4 TR:3 CH:3 DE:2 EN:2 CY:2 ES:1 FR:1 BE:1 NL:1 PT:1 CZ:1 PL:1 HR:1 HU:1 RO:1 US:1 SA:1 AT:1"),
  },
};

// ------------------------------------------------------------------ North Macedonia (no own league modeled)

const MK: NationSpec = {
  code: "MK",
  iso2: "MK",
  name: "North Macedonia",
  confederation: "UEFA",
  continent: "EU",
  capital: "Skopje",
  latitude: 42.0,
  languages: [
    { code: "mk", weight: 0.68 },
    { code: "sq", weight: 0.26 },
    { code: "tr", weight: 0.04 },
    { code: "sr", weight: 0.02 },
  ],
  reputation: { national: 66, league: 44 },
  euEea: false,
  physique: { height: 181 },
  names: {
    given: [
      src("pool:uefa-east/macedonian", 0.66),
      src("pool:uefa-east/albanian", 0.26),
      src("pool:uefa-east/turkish", 0.04),
      src("faker:sr_RS_latin", 0.04),
    ],
    family: [
      src("pool:uefa-east/macedonian", 0.66),
      src("pool:uefa-east/albanian", 0.26),
      src("pool:uefa-east/turkish", 0.04),
      src("faker:sr_RS_latin", 0.04),
    ],
  },
  nationality: {
    multipleRate: 0.26,
    tripleRate: 0.04,
    bornAbroadRate: 0.12,
    diasporaPull: 0.45,
    links: [
      ...links("regional", "AL:5 BG:4 XK:3 TR:3 GR:1"),
      ...links("yugoslav", "RS:4 HR:2 SI:1 ME:1 BA:1"),
      ...links("germanRecruitment", "DE:5 CH:5 AT:3"),
      ...links("crossBorder", "IT:2 SE:2 BE:1"),
      ...links("commonwealth", "AU:2"),
      ...links("americas", "US:1"),
    ],
    citizenship: { dual: "allowed" },
  },
  cities: {
    major: [
      city("Skopje", "large", "Skopje", undefined, "Aerodrom|Karpoš|Čair|Gazi Baba|Kisela Voda|Centar|Butel|Šuto Orizari|Gjorče Petrov|Saraj"),
      city("Kumanovo", "medium", "Northeastern"),
      city("Bitola", "medium", "Pelagonia"),
      city("Tetovo", "medium", "Polog"),
      city("Prilep", "medium", "Pelagonia"),
      city("Ohrid", "small", "Southwestern"),
      city("Veles", "small", "Vardar"),
      city("Štip", "small", "Eastern"),
      city("Gostivar", "small", "Polog"),
      city("Strumica", "small", "Southeastern"),
      city("Kavadarci", "small", "Vardar"),
      city("Kočani", "small", "Eastern"),
      city("Kičevo", "small", "Southwestern"),
      city("Struga", "small", "Southwestern"),
      city("Radoviš", "town", "Southeastern"),
      city("Gevgelija", "town", "Southeastern"),
      city("Debar", "town", "Southwestern"),
      city("Kriva Palanka", "town", "Northeastern"),
      city("Sveti Nikole", "town", "Vardar"),
      city("Negotino", "town", "Vardar"),
      city("Delčevo", "town", "Eastern"),
      city("Vinica", "town", "Eastern"),
      city("Resen", "town", "Pelagonia"),
      city("Probištip", "town", "Eastern"),
      city("Berovo", "town", "Eastern"),
      city("Kratovo", "town", "Northeastern"),
      city("Kruševo", "town", "Pelagonia"),
      city("Makedonski Brod", "town", "Southwestern"),
      city("Valandovo", "town", "Southeastern"),
      city("Demir Hisar", "town", "Pelagonia"),
    ],
    extra: { max: 40 },
  },
  // The real Macedonian First League is outside the directive; players are home-based or at clubs abroad.
  homePool: { seniors: 70, youth: 50 },
  abroad: {
    seniors: 35,
    youth: 10,
    destinations: weighted("TR:4 BG:4 HR:3 IT:3 DE:3 SI:2 SCO:2 AL:2 XK:2 RS:2 AT:2 CH:2 CY:2 ES:1 BA:1 SK:1 PL:1 HU:1 GR:1 SE:1 US:1"),
  },
};

// ------------------------------------------------------------------ Georgia

const GE: NationSpec = {
  code: "GE",
  iso2: "GE",
  name: "Georgia",
  confederation: "UEFA",
  continent: "AS",
  capital: "Tbilisi",
  latitude: 41.72,
  languages: [
    { code: "ka", weight: 0.88 },
    { code: "az", weight: 0.06 },
    { code: "hy", weight: 0.04 },
    { code: "ru", weight: 0.02 },
  ],
  reputation: { national: 66, league: 42 },
  euEea: false,
  physique: { height: 181 },
  names: {
    given: [src("pool:uefa-east/georgian", 0.94), src("pool:uefa-east/armenian", 0.03), src("pool:uefa-east/azerbaijani", 0.03)],
    family: [src("pool:uefa-east/georgian", 0.94), src("pool:uefa-east/armenian", 0.03), src("pool:uefa-east/azerbaijani", 0.03)],
  },
  nationality: {
    multipleRate: 0.18,
    tripleRate: 0.02,
    bornAbroadRate: 0.07,
    diasporaPull: 0.5,
    links: [
      ...links("postSoviet", "RU:8 UA:5 AM:4 AZ:4 BY:1 KZ:1"),
      ...links("regional", "TR:4 GR:3 IL:1"),
      ...links("crossBorder", "FR:2 DE:1 ES:1 IT:1"),
      ...links("americas", "US:1"),
    ],
    // Dual citizenship only by presidential grant.
    citizenship: { dual: "restricted" },
  },
  cities: {
    major: [
      city("Tbilisi", "large", "Tbilisi", 4, "Saburtalo|Vake|Gldani|Didube|Isani|Nadzaladevi|Samgori|Krtsanisi|Chughureti|Mtatsminda"),
      city("Batumi", "medium", "Adjara", 2),
      city("Kutaisi", "medium", "Imereti", 2),
      city("Rustavi", "medium", "Kvemo Kartli"),
      city("Gori", "small", "Shida Kartli"),
      city("Zugdidi", "small", "Samegrelo-Zemo Svaneti"),
      city("Poti", "small", "Samegrelo-Zemo Svaneti"),
      city("Telavi", "small", "Kakheti"),
      city("Tskaltubo", "town", "Imereti"),
      city("Kobuleti", "town", "Adjara"),
      city("Khashuri", "town", "Shida Kartli"),
      city("Samtredia", "town", "Imereti"),
      city("Senaki", "town", "Samegrelo-Zemo Svaneti"),
      city("Zestaponi", "town", "Imereti"),
      city("Marneuli", "town", "Kvemo Kartli"),
      city("Ozurgeti", "town", "Guria"),
      city("Sachkhere", "town", "Imereti"),
      city("Bolnisi", "town", "Kvemo Kartli"),
      city("Martvili", "town", "Samegrelo-Zemo Svaneti"),
      city("Akhaltsikhe", "town", "Samtskhe-Javakheti"),
      city("Chiatura", "town", "Imereti"),
      city("Kaspi", "town", "Shida Kartli"),
      city("Gurjaani", "town", "Kakheti"),
      city("Lanchkhuti", "town", "Guria"),
      city("Mtskheta", "town", "Mtskheta-Mtianeti"),
      city("Borjomi", "town", "Samtskhe-Javakheti"),
      city("Ambrolauri", "town", "Racha-Lechkhumi"),
      city("Sagarejo", "town", "Kakheti"),
      city("Tkibuli", "town", "Imereti"),
      city("Akhalkalaki", "town", "Samtskhe-Javakheti"),
    ],
  },
  football: {
    leagues: [
      {
        // 2025: 10 clubs, four round robins (a calendar-year season in reality, played August-May here); the last is
        // relegated and 8th/9th play off against Erovnuli Liga 2 clubs (not modeled).
        tier: 1,
        name: "Erovnuli Liga",
        shortName: "Erovnuli Liga",
        size: 10,
        status: "professional",
        reputation: 42,
        roundRobins: 4,
        clubs: {
          reputation: { top: 48, bottom: 30 },
          capacity: { top: 54_000, bottom: 1_500 },
          facilities: { top: 50, bottom: 22 },
          academy: { top: 60, bottom: 28 },
          wageBill: { top: 2_800_000, bottom: 200_000 },
          transferBudget: { top: 500_000, bottom: 0 },
          foreignShare: 0.2,
          squadSize: [25, 30],
        },
      },
    ],
    movement: [],
    cups: [
      { kind: "national", name: "Georgian Cup", shortName: "Cup", seededEntry: true, legs: 1, neutralFinal: true, continental: true },
      { kind: "super", name: "Georgian Super Cup", participants: ["champion", "cup-winner"], legs: 1, neutralFinal: true, start: "08-01" },
    ],
    youth: {
      U19: { divisions: [{ name: "Georgian Youth League U19", parentTiers: [1, 1] }] },
      U17: { divisions: [{ name: "Georgian Youth League U17", parentTiers: [1, 1] }] },
    },
    reserves: { mode: "none" },
    clubNaming: {
      templates: [
        { pattern: "FC {city}", weight: 0.32 },
        { pattern: "Dinamo {city}", weight: 0.05 },
        { pattern: "Torpedo {city}", weight: 0.06 },
        { pattern: "Lokomotivi {city}", weight: 0.05 },
        { pattern: "Merani {city}", weight: 0.06 },
        { pattern: "Iberia {city}", weight: 0.06 },
        { pattern: "Sioni {city}", weight: 0.05 },
        { pattern: "Kolkheti {city}", weight: 0.05 },
        { pattern: "Spartaki {city}", weight: 0.05 },
        { pattern: "Egrisi {city}", weight: 0.05 },
        { pattern: "Aragvi {city}", weight: 0.05 },
      ],
      regional: [
        {
          regions: ["Tbilisi"],
          templates: [
            { pattern: "Iberia {city}", weight: 0.2 },
            { pattern: "Merani {city}", weight: 0.2 },
            { pattern: "Spartaki {city}", weight: 0.2 },
            { pattern: "Sioni {city}", weight: 0.2 },
            { pattern: "Aragvi {city}", weight: 0.2 },
          ],
        },
      ],
      founded: { top: [1925, 2015], bottom: [1925, 2015] },
      colors: ["#0033A0", "#FFFFFF", "#000000", "#E4002B", "#FFD100", "#006B3F", "#800020"],
    },
    importSources: weighted("UA:3 RU:2 BR:3 NG:2 GH:2 CI:1 CM:2 SN:2 ML:1 BF:1 AM:1 AZ:1 BY:1 FR:1 PT:1 CO:1 JP:1 RS:1 TR:1"),
    coefficients: { association: [1.75, 1.25, 1.125, 1.25, 1.25] },
  },
  abroad: {
    seniors: 45,
    youth: 10,
    destinations: weighted("RU:5 ES:4 TR:4 FR:3 IT:3 GR:3 CY:3 EN:2 DE:2 UA:2 PL:2 CZ:2 SK:2 KZ:2 PT:2 BE:2 HU:1 BY:1 NL:1 AT:1 US:1"),
  },
};

// ------------------------------------------------------------------ Armenia

const AM: NationSpec = {
  code: "AM",
  iso2: "AM",
  name: "Armenia",
  confederation: "UEFA",
  continent: "AS",
  capital: "Yerevan",
  latitude: 40.18,
  languages: [
    { code: "hy", weight: 0.96 },
    { code: "ru", weight: 0.03 },
    { code: "ku", weight: 0.01 },
  ],
  reputation: { national: 56, league: 42 },
  euEea: false,
  physique: { height: 179 },
  names: {
    given: [src("pool:uefa-east/armenian", 0.96), src("pool:uefa-east/russian", 0.04)],
    family: [src("pool:uefa-east/armenian", 1)],
  },
  nationality: {
    multipleRate: 0.28,
    tripleRate: 0.04,
    bornAbroadRate: 0.15,
    diasporaPull: 0.55,
    links: [
      ...links("postSoviet", "RU:10 GE:4 UA:3 BY:1 KZ:1"),
      ...links("crossBorder", "FR:5 BE:1 NL:1 DE:1"),
      ...links("arabWorld", "LB:2 SY:1"),
      ...links("regional", "IR:2 GR:1 CY:1"),
      ...links("americas", "US:5 AR:1 CA:1"),
    ],
    citizenship: { dual: "allowed" },
  },
  cities: {
    major: [
      city(
        "Yerevan",
        "large",
        "Yerevan",
        7,
        "Kentron|Arabkir|Malatia-Sebastia|Shengavit|Erebuni|Nor Nork|Ajapnyak|Avan|Davtashen|Kanaker-Zeytun|Nubarashen|Nork-Marash",
      ),
      city("Gyumri", "medium", "Shirak"),
      city("Vanadzor", "medium", "Lori"),
      city("Kapan", "small", "Syunik"),
      city("Charentsavan", "small", "Kotayk"),
      city("Abovyan", "small", "Kotayk"),
      city("Vagharshapat", "small", "Armavir"),
      city("Hrazdan", "small", "Kotayk"),
      city("Armavir", "town", "Armavir"),
      city("Artashat", "town", "Ararat"),
      city("Goris", "town", "Syunik"),
      city("Ijevan", "town", "Tavush"),
      city("Sevan", "town", "Gegharkunik"),
      city("Gavar", "town", "Gegharkunik"),
      city("Ashtarak", "town", "Aragatsotn"),
      city("Masis", "town", "Ararat"),
      city("Dilijan", "town", "Tavush"),
      city("Sisian", "town", "Syunik"),
      city("Alaverdi", "town", "Lori"),
      city("Stepanavan", "town", "Lori"),
      city("Martuni", "town", "Gegharkunik"),
      city("Vardenis", "town", "Gegharkunik"),
      city("Spitak", "town", "Lori"),
      city("Yeghegnadzor", "town", "Vayots Dzor"),
      city("Meghri", "town", "Syunik"),
      city("Berd", "town", "Tavush"),
      city("Metsamor", "town", "Armavir"),
    ],
    extra: { max: 30 },
  },
  football: {
    leagues: [
      {
        // 2025/26: 10 clubs, three round robins; the last is relegated to the First League (not modeled).
        tier: 1,
        name: "Armenian Premier League",
        shortName: "Premier League",
        size: 10,
        status: "professional",
        reputation: 42,
        roundRobins: 3,
        clubs: {
          reputation: { top: 48, bottom: 30 },
          capacity: { top: 14_400, bottom: 1_000 },
          facilities: { top: 50, bottom: 20 },
          academy: { top: 50, bottom: 22 },
          wageBill: { top: 4_500_000, bottom: 250_000 },
          transferBudget: { top: 400_000, bottom: 0 },
          foreignShare: 0.45,
          squadSize: [25, 30],
        },
      },
    ],
    movement: [],
    cups: [
      { kind: "national", name: "Armenian Cup", shortName: "Cup", seededEntry: true, legs: 2, finalLegs: 1, neutralFinal: true, continental: true },
      { kind: "super", name: "Armenian Supercup", participants: ["champion", "cup-winner"], legs: 1, neutralFinal: true, start: "07-05" },
    ],
    youth: {
      U19: { divisions: [{ name: "Armenian U19 League", parentTiers: [1, 1] }] },
      U17: { divisions: [{ name: "Armenian U17 League", parentTiers: [1, 1] }] },
    },
    reserves: { mode: "none" },
    clubNaming: {
      templates: [
        { pattern: "FC {city}", weight: 0.38 },
        { pattern: "Ararat {city}", weight: 0.06 },
        { pattern: "Kilikia {city}", weight: 0.06 },
        { pattern: "Aragats {city}", weight: 0.06 },
        { pattern: "Masis {city}", weight: 0.06 },
        { pattern: "Zvartnots {city}", weight: 0.05 },
        { pattern: "Nairi {city}", weight: 0.05 },
        { pattern: "Lernayin {city}", weight: 0.05 },
        { pattern: "Mika {city}", weight: 0.04 },
        { pattern: "Spartak {city}", weight: 0.04 },
      ],
      regional: [
        {
          regions: ["Yerevan"],
          templates: [
            { pattern: "Kilikia {city}", weight: 0.25 },
            { pattern: "Zvartnots {city}", weight: 0.2 },
            { pattern: "Nairi {city}", weight: 0.2 },
            { pattern: "Masis {city}", weight: 0.15 },
            { pattern: "Mika {city}", weight: 0.2 },
          ],
        },
      ],
      founded: { top: [1935, 2019], bottom: [1935, 2019] },
      colors: ["#E4002B", "#0033A0", "#F2A900", "#FFFFFF", "#000000", "#006B3F", "#800020"],
    },
    importSources: weighted("RU:4 BR:4 UA:2 NG:2 GH:2 CM:2 CI:2 SN:2 ML:1 CO:2 AR:2 VE:1 PT:1 FR:1 ES:1 GE:1 BY:1 KZ:1 RS:2 ME:1 HR:1 CV:1 JP:1 IR:1"),
    coefficients: { association: [1.375, 1.875, 2.375, 2.25, 4.375] },
  },
  abroad: {
    seniors: 20,
    youth: 4,
    destinations: weighted("RU:6 FR:2 KZ:2 SK:1 US:1 BY:1 GE:1 CY:1 IR:1 ES:1 UA:1 GR:1"),
  },
};

// ------------------------------------------------------------------ Azerbaijan (no own league modeled)

const AZ: NationSpec = {
  code: "AZ",
  iso2: "AZ",
  name: "Azerbaijan",
  confederation: "UEFA",
  continent: "AS",
  capital: "Bakı",
  latitude: 40.41,
  languages: [
    { code: "az", weight: 0.96 },
    { code: "ru", weight: 0.04 },
  ],
  reputation: { national: 52, league: 52 },
  euEea: false,
  physique: { height: 179 },
  names: {
    given: [src("pool:uefa-east/azerbaijani", 0.7), src("faker:az", 0.3)],
    family: [src("pool:uefa-east/azerbaijani", 0.85), src("faker:az", 0.15)],
  },
  nationality: {
    multipleRate: 0.18,
    tripleRate: 0.02,
    bornAbroadRate: 0.08,
    diasporaPull: 0.4,
    links: [
      ...links("postSoviet", "RU:10 UA:3 GE:3 KZ:1 UZ:1 BY:1"),
      ...links("regional", "TR:8 IR:3"),
      ...links("crossBorder", "DE:1"),
    ],
    // Dual citizenship is not recognised; exceptions only by presidential decree.
    citizenship: { dual: "restricted" },
  },
  cities: {
    major: [
      city("Bakı", "mega", "Bakı"),
      city("Gəncə", "medium", "Gəncə-Daşkəsən"),
      city("Sumqayıt", "medium", "Abşeron-Xızı"),
      city("Mingəçevir", "small", "Mərkəzi Aran"),
      city("Lənkəran", "small", "Lənkəran-Astara"),
      city("Şirvan", "small", "Şirvan-Salyan"),
      city("Naxçıvan", "small", "Naxçıvan"),
      city("Şəki", "small", "Şəki-Zaqatala"),
      city("Yevlax", "small", "Mərkəzi Aran"),
      city("Xaçmaz", "town", "Quba-Xaçmaz"),
      city("Quba", "town", "Quba-Xaçmaz"),
      city("Qəbələ", "town", "Şəki-Zaqatala"),
      city("Şamaxı", "town", "Dağlıq Şirvan"),
      city("Zaqatala", "town", "Şəki-Zaqatala"),
      city("Masallı", "town", "Lənkəran-Astara"),
      city("Salyan", "town", "Şirvan-Salyan"),
      city("Göyçay", "town", "Mərkəzi Aran"),
      city("Ağcabədi", "town", "Qarabağ"),
      city("Bərdə", "town", "Qarabağ"),
      city("Qusar", "town", "Quba-Xaçmaz"),
      city("Ağdaş", "town", "Mərkəzi Aran"),
      city("Tovuz", "town", "Qazax-Tovuz"),
      city("Qazax", "town", "Qazax-Tovuz"),
      city("Şəmkir", "town", "Gəncə-Daşkəsən"),
      city("Sabirabad", "town", "Mil-Muğan"),
      city("İmişli", "town", "Mil-Muğan"),
      city("Astara", "town", "Lənkəran-Astara"),
      city("Ağdam", "town", "Qarabağ"),
    ],
  },
  // The real Azerbaijan Premier League is outside the directive; players are home-based or at clubs abroad.
  homePool: { seniors: 90, youth: 60 },
  abroad: { seniors: 8, youth: 2, destinations: weighted("TR:4 RU:2 KZ:1 UA:1 GE:1 DE:1") },
};

// ------------------------------------------------------------------ Kazakhstan

const KZ: NationSpec = {
  code: "KZ",
  iso2: "KZ",
  name: "Kazakhstan",
  confederation: "UEFA",
  continent: "AS",
  capital: "Astana",
  latitude: 51.17,
  languages: [
    { code: "kk", weight: 0.6 },
    { code: "ru", weight: 0.37 },
    { code: "uz", weight: 0.03 },
  ],
  reputation: { national: 54, league: 48 },
  euEea: false,
  physique: { height: 180 },
  names: {
    given: [src("pool:uefa-east/kazakh", 0.72), src("pool:uefa-east/russian", 0.24), src("faker:uz_UZ_latin", 0.04)],
    family: [src("pool:uefa-east/kazakh", 0.72), src("pool:uefa-east/russian", 0.24), src("faker:uz_UZ_latin", 0.04)],
  },
  nationality: {
    multipleRate: 0.2,
    tripleRate: 0.02,
    bornAbroadRate: 0.08,
    diasporaPull: 0.35,
    links: [
      ...links("postSoviet", "RU:12 UZ:4 KG:3 UA:3 TJ:1 BY:1 AZ:1 TM:1"),
      ...links("regional", "DE:3 TR:2 KR:1 CN:1 MN:1"),
    ],
    // The constitution does not recognise dual citizenship.
    citizenship: { dual: "restricted" },
  },
  cities: {
    major: [
      city("Almaty", "large", "Almaty", 2, "Medeu|Bostandyk|Auezov|Alatau|Turksib|Nauryzbay"),
      city("Astana", "large", "Astana", 2, "Yesil|Saryarka|Baikonur|Nura"),
      city("Shymkent", "large", "Shymkent"),
      city("Aktobe", "medium", "Aktobe"),
      city("Karaganda", "medium", "Karaganda"),
      city("Taraz", "medium", "Jambyl"),
      city("Pavlodar", "medium", "Pavlodar"),
      city("Oskemen", "medium", "East Kazakhstan"),
      city("Semey", "medium", "Abai"),
      city("Atyrau", "medium", "Atyrau"),
      city("Kostanay", "medium", "Kostanay"),
      city("Kyzylorda", "medium", "Kyzylorda"),
      city("Oral", "medium", "West Kazakhstan"),
      city("Petropavl", "medium", "North Kazakhstan"),
      city("Aktau", "medium", "Mangystau"),
      city("Turkistan", "small", "Turkistan"),
      city("Kokshetau", "small", "Akmola"),
      city("Taldykorgan", "small", "Zhetysu"),
      city("Temirtau", "small", "Karaganda"),
      city("Ekibastuz", "small", "Pavlodar"),
      city("Zhezkazgan", "small", "Ulytau"),
      city("Rudny", "small", "Kostanay"),
      city("Zhanaozen", "town", "Mangystau"),
      city("Balkhash", "town", "Karaganda"),
      city("Kaskelen", "town", "Almaty Region"),
      city("Konaev", "town", "Almaty Region"),
      city("Stepnogorsk", "town", "Akmola"),
      city("Satbayev", "town", "Ulytau"),
      city("Shchuchinsk", "town", "Akmola"),
      city("Aksu", "town", "Pavlodar"),
      city("Kentau", "town", "Turkistan"),
      city("Ridder", "town", "East Kazakhstan"),
      city("Zhitikara", "town", "Kostanay"),
      city("Aral", "town", "Kyzylorda"),
      city("Saryagash", "town", "Turkistan"),
    ],
    extra: { max: 60 },
  },
  football: {
    leagues: [
      {
        // 2025: 14 clubs, double round robin (a calendar-year season in reality, played August-May here); the last
        // is relegated and 13th plays off against a First League club (not modeled).
        tier: 1,
        name: "Kazakhstan Premier League",
        shortName: "Premier League",
        size: 14,
        status: "professional",
        reputation: 48,
        clubs: {
          reputation: { top: 54, bottom: 36 },
          capacity: { top: 30_000, bottom: 3_500 },
          facilities: { top: 58, bottom: 30 },
          academy: { top: 52, bottom: 26 },
          wageBill: { top: 12_000_000, bottom: 1_000_000 },
          transferBudget: { top: 1_500_000, bottom: 50_000 },
          foreignShare: 0.35,
          squadSize: [25, 31],
        },
      },
    ],
    movement: [],
    cups: [
      { kind: "national", name: "Kazakhstan Cup", shortName: "Cup", seededEntry: true, legs: 2, finalLegs: 1, neutralFinal: true, continental: true },
      { kind: "super", name: "Kazakhstan Super Cup", participants: ["champion", "cup-winner"], legs: 1, neutralFinal: true, start: "07-01" },
    ],
    youth: {
      U19: { divisions: [{ name: "Kazakhstan U19 Championship", parentTiers: [1, 1] }] },
      U17: { divisions: [{ name: "Kazakhstan U17 Championship", parentTiers: [1, 1] }] },
    },
    reserves: { mode: "none" },
    clubNaming: {
      templates: [
        { pattern: "FC {city}", weight: 0.4 },
        { pattern: "Energetik {city}", weight: 0.07 },
        { pattern: "Lokomotiv {city}", weight: 0.07 },
        { pattern: "Spartak {city}", weight: 0.06 },
        { pattern: "Shakhter {city}", weight: 0.05 },
        { pattern: "Tulpar {city}", weight: 0.05 },
        { pattern: "Sunkar {city}", weight: 0.05 },
        { pattern: "Munaishy {city}", weight: 0.04 },
        { pattern: "Metallurg {city}", weight: 0.04 },
        { pattern: "Batyr {city}", weight: 0.04 },
      ],
      regional: [
        {
          regions: ["Astana"],
          templates: [
            { pattern: "Bayterek {city}", weight: 0.3 },
            { pattern: "Yessil {city}", weight: 0.25 },
            { pattern: "Sunkar {city}", weight: 0.2 },
            { pattern: "Tulpar {city}", weight: 0.25 },
          ],
        },
        {
          regions: ["Almaty"],
          templates: [
            { pattern: "Alatau {city}", weight: 0.3 },
            { pattern: "Sunkar {city}", weight: 0.25 },
            { pattern: "Tulpar {city}", weight: 0.25 },
            { pattern: "Spartak {city}", weight: 0.2 },
          ],
        },
      ],
      founded: { top: [1954, 2011], bottom: [1954, 2011] },
      colors: ["#00AFCA", "#FFD700", "#E4002B", "#FFFFFF", "#000000", "#006B3F", "#0033A0"],
    },
    importSources: weighted(
      "RU:5 BR:3 UA:3 BY:3 RS:3 GE:2 UZ:2 KG:1 TJ:1 AM:1 AZ:1 ME:2 BA:2 MK:1 HR:1 SI:1 AL:1 XK:1 NG:2 GH:1 CM:1 CI:1 SN:1 PT:1 ES:1 CO:1 PL:1 KR:1",
    ),
    coefficients: { association: [1.0, 2.875, 1.125, 3.125, 3.0] },
  },
  abroad: { seniors: 10, youth: 2, destinations: weighted("RU:5 BY:1 TR:1 UZ:1 PL:1 CZ:1") },
};

// ------------------------------------------------------------------ Belarus

const BY: NationSpec = {
  code: "BY",
  iso2: "BY",
  name: "Belarus",
  confederation: "UEFA",
  continent: "EU",
  capital: "Minsk",
  latitude: 53.9,
  languages: [
    { code: "ru", weight: 0.7 },
    { code: "be", weight: 0.3 },
  ],
  reputation: { national: 57, league: 45 },
  euEea: false,
  physique: { height: 182 },
  names: {
    given: [src("pool:uefa-east/belarusian", 0.75), src("pool:uefa-east/russian", 0.25)],
    family: [src("pool:uefa-east/belarusian", 0.7), src("pool:uefa-east/russian", 0.25), src("pool:uefa-east/ukrainian", 0.05)],
  },
  nationality: {
    multipleRate: 0.2,
    tripleRate: 0.02,
    bornAbroadRate: 0.06,
    diasporaPull: 0.3,
    links: [
      ...links("postSoviet", "RU:10 UA:6 LT:2 LV:1 KZ:1"),
      ...links("crossBorder", "PL:5 DE:1"),
      ...links("regional", "IL:1"),
    ],
    // Foreign citizenship is not recognised for Belarusian citizens.
    citizenship: { dual: "restricted" },
  },
  cities: {
    major: [
      city("Minsk", "large", "Minsk", 4, "Uruchye|Serebryanka|Kamennaya Gorka|Malinovka|Zelyony Lug|Chizhovka|Shabany|Sukharevo|Frunzensky|Partizansky"),
      city("Gomel", "medium", "Gomel Region", 2),
      city("Mogilev", "medium", "Mogilev Region", 2),
      city("Vitebsk", "medium", "Vitebsk Region", 2),
      city("Grodno", "medium", "Grodno Region", 2),
      city("Brest", "medium", "Brest Region", 2),
      city("Bobruisk", "medium", "Mogilev Region"),
      city("Borisov", "medium", "Minsk Region"),
      city("Baranovichi", "medium", "Brest Region"),
      city("Pinsk", "small", "Brest Region"),
      city("Orsha", "small", "Vitebsk Region"),
      city("Mozyr", "small", "Gomel Region"),
      city("Soligorsk", "small", "Minsk Region"),
      city("Novopolotsk", "small", "Vitebsk Region"),
      city("Lida", "small", "Grodno Region"),
      city("Molodechno", "small", "Minsk Region"),
      city("Polotsk", "small", "Vitebsk Region"),
      city("Zhlobin", "small", "Gomel Region"),
      city("Svetlogorsk", "small", "Gomel Region"),
      city("Rechitsa", "small", "Gomel Region"),
      city("Zhodino", "small", "Minsk Region"),
      city("Slutsk", "small", "Minsk Region"),
      city("Kobrin", "town", "Brest Region"),
      city("Slonim", "town", "Grodno Region"),
      city("Volkovysk", "town", "Grodno Region"),
      city("Kalinkovichi", "town", "Gomel Region"),
      city("Smorgon", "town", "Grodno Region"),
      city("Dzerzhinsk", "town", "Minsk Region"),
      city("Rogachev", "town", "Gomel Region"),
      city("Osipovichi", "town", "Mogilev Region"),
      city("Gorki", "town", "Mogilev Region"),
      city("Luninets", "town", "Brest Region"),
      city("Novogrudok", "town", "Grodno Region"),
      city("Krichev", "town", "Mogilev Region"),
      city("Postavy", "town", "Vitebsk Region"),
      city("Ivatsevichi", "town", "Brest Region"),
    ],
    extra: { max: 50 },
  },
  football: {
    leagues: [
      {
        // 2025: 16 clubs, double round robin (a calendar-year season in reality, played August-May here); the bottom
        // two are relegated and 14th plays off against a First League club (not modeled).
        tier: 1,
        name: "Belarusian Premier League",
        shortName: "Vysheyshaya Liga",
        size: 16,
        status: "professional",
        reputation: 45,
        clubs: {
          reputation: { top: 50, bottom: 32 },
          capacity: { top: 22_000, bottom: 1_500 },
          facilities: { top: 55, bottom: 25 },
          academy: { top: 55, bottom: 25 },
          wageBill: { top: 3_500_000, bottom: 250_000 },
          transferBudget: { top: 400_000, bottom: 0 },
          foreignShare: 0.2,
          squadSize: [25, 30],
        },
      },
    ],
    movement: [],
    cups: [
      { kind: "national", name: "Belarusian Cup", shortName: "Cup", seededEntry: true, legs: 2, finalLegs: 1, neutralFinal: true, continental: true },
      { kind: "super", name: "Belarusian Super Cup", participants: ["champion", "cup-winner"], legs: 1, neutralFinal: true, start: "07-05" },
    ],
    youth: {
      U19: { divisions: [{ name: "Belarusian Youth League U19", parentTiers: [1, 1] }] },
      U17: { divisions: [{ name: "Belarusian Youth League U17", parentTiers: [1, 1] }] },
    },
    reserves: { mode: "none" },
    clubNaming: {
      templates: [
        { pattern: "FK {city}", weight: 0.32 },
        { pattern: "Dinamo {city}", weight: 0.05 },
        { pattern: "Torpedo {city}", weight: 0.07 },
        { pattern: "Lokomotiv {city}", weight: 0.07 },
        { pattern: "Slavia {city}", weight: 0.06 },
        { pattern: "Energetik {city}", weight: 0.06 },
        { pattern: "Khimik {city}", weight: 0.05 },
        { pattern: "Shakhtyor {city}", weight: 0.05 },
        { pattern: "Naftan {city}", weight: 0.03 },
        { pattern: "Dnepr {city}", weight: 0.04 },
        { pattern: "Arsenal {city}", weight: 0.04 },
        { pattern: "Volna {city}", weight: 0.04 },
        { pattern: "Iskra {city}", weight: 0.04 },
      ],
      regional: [
        {
          regions: ["Minsk"],
          templates: [
            { pattern: "Smena {city}", weight: 0.2 },
            { pattern: "Iskra {city}", weight: 0.2 },
            { pattern: "Slavia {city}", weight: 0.2 },
            { pattern: "Traktor {city}", weight: 0.2 },
            { pattern: "Zvezda {city}", weight: 0.2 },
          ],
        },
      ],
      founded: { top: [1927, 2014], bottom: [1927, 2014] },
      colors: ["#0033A0", "#FFD700", "#E4002B", "#FFFFFF", "#000000", "#006B3F", "#F58025", "#1E90FF"],
    },
    importSources: weighted("RU:4 UA:2 BR:3 NG:2 GH:2 CM:2 CI:1 SN:1 ML:1 RS:2 ME:1 BA:1 MK:1 GE:2 AM:1 AZ:1 KZ:1 UZ:1 LT:1 LV:1 MD:1 CO:1"),
    coefficients: { association: [1.5, 0.25, 0.625, 1.75, 1.875] },
  },
  abroad: { seniors: 12, youth: 2, destinations: weighted("RU:8 KZ:2 PL:1 LT:1 AM:1") },
};

// ------------------------------------------------------------------ Moldova

const MD: NationSpec = {
  code: "MD",
  iso2: "MD",
  name: "Moldova",
  confederation: "UEFA",
  continent: "EU",
  capital: "Chișinău",
  latitude: 47.01,
  languages: [
    { code: "ro", weight: 0.8 },
    { code: "ru", weight: 0.15 },
    { code: "uk", weight: 0.03 },
    { code: "bg", weight: 0.02 },
  ],
  reputation: { national: 45, league: 40 },
  euEea: false,
  physique: { height: 180 },
  names: {
    given: [
      src("faker:ro_MD", 0.8),
      src("pool:uefa-east/russian", 0.12),
      src("pool:uefa-east/ukrainian", 0.05),
      src("pool:uefa-east/bulgarian", 0.03),
    ],
    family: [
      src("faker:ro_MD", 0.8),
      src("pool:uefa-east/russian", 0.12),
      src("pool:uefa-east/ukrainian", 0.05),
      src("pool:uefa-east/bulgarian", 0.03),
    ],
  },
  nationality: {
    multipleRate: 0.35,
    tripleRate: 0.04,
    bornAbroadRate: 0.08,
    diasporaPull: 0.35,
    links: [
      ...links("crossBorder", "RO:14 IT:3 ES:1 PT:1 FR:1 DE:1"),
      ...links("postSoviet", "RU:6 UA:6 BY:1 KZ:1"),
      ...links("regional", "BG:2 TR:2 IL:1"),
    ],
    citizenship: { dual: "allowed" },
  },
  cities: {
    major: [
      city("Chișinău", "large", "Chișinău", 4, "Buiucani|Botanica|Ciocana|Râșcani|Centru|Durlești|Codru|Sculeni"),
      city("Tiraspol", "medium", "Stânga Nistrului"),
      city("Bălți", "medium", "Nord"),
      city("Bender", "medium", "Stânga Nistrului"),
      city("Hîncești", "small", "Centru"),
      city("Orhei", "small", "Centru"),
      city("Cahul", "small", "Sud"),
      city("Ungheni", "small", "Centru"),
      city("Soroca", "small", "Nord"),
      city("Comrat", "small", "Găgăuzia"),
      city("Florești", "town", "Nord"),
      city("Strășeni", "town", "Centru"),
      city("Căușeni", "town", "Sud"),
      city("Edineț", "town", "Nord"),
      city("Drochia", "town", "Nord"),
      city("Ialoveni", "town", "Centru"),
      city("Rîbnița", "town", "Stânga Nistrului"),
      city("Dubăsari", "town", "Stânga Nistrului"),
      city("Nisporeni", "town", "Centru"),
      city("Călărași", "town", "Centru"),
      city("Anenii Noi", "town", "Centru"),
      city("Cimișlia", "town", "Sud"),
      city("Ceadîr-Lunga", "town", "Găgăuzia"),
      city("Otaci", "town", "Nord"),
      city("Cantemir", "town", "Sud"),
      city("Leova", "town", "Sud"),
      city("Rezina", "town", "Nord"),
      city("Criuleni", "town", "Centru"),
      city("Taraclia", "town", "Sud"),
      city("Vulcănești", "town", "Găgăuzia"),
      city("Glodeni", "town", "Nord"),
      city("Sîngerei", "town", "Nord"),
    ],
  },
  football: {
    leagues: [
      {
        // 2025/26: 8 clubs, three round robins; the top six then play a double round robin with halved points, while
        // 7th and 8th join the Liga 1 second phase (modeled as a play-out; promotion is not modeled).
        tier: 1,
        name: "Super Liga",
        shortName: "Super Liga",
        size: 8,
        status: "professional",
        reputation: 40,
        roundRobins: 3,
        split: {
          groups: [
            { name: "Faza a II-a", positions: [1, 6], roundRobins: 2, points: "halved" },
            { name: "Play-out", positions: [7, 8], roundRobins: 1, points: "full" },
          ],
        },
        clubs: {
          giants: { count: 1, top: 58, bottom: 58 },
          reputation: { top: 46, bottom: 30 },
          capacity: { top: 13_000, bottom: 1_500 },
          facilities: { top: 45, bottom: 20 },
          academy: { top: 48, bottom: 22 },
          wageBill: { top: 8_000_000, bottom: 150_000 },
          transferBudget: { top: 1_500_000, bottom: 0 },
          foreignShare: 0.3,
          squadSize: [25, 30],
        },
      },
    ],
    movement: [],
    cups: [{ kind: "national", name: "Cupa Moldovei", shortName: "Cupa", seededEntry: true, legs: 1, neutralFinal: true, continental: true }],
    youth: {
      U19: { divisions: [{ name: "Campionatul Național U19", parentTiers: [1, 1] }] },
      U17: { divisions: [{ name: "Campionatul Național U17", parentTiers: [1, 1] }] },
    },
    reserves: { mode: "none" },
    clubNaming: {
      templates: [
        { pattern: "FC {city}", weight: 0.32 },
        { pattern: "CS {city}", weight: 0.1 },
        { pattern: "Speranța {city}", weight: 0.06 },
        { pattern: "Victoria {city}", weight: 0.06 },
        { pattern: "Dacia {city}", weight: 0.05 },
        { pattern: "Codru {city}", weight: 0.06 },
        { pattern: "Sporting {city}", weight: 0.05 },
        { pattern: "Universitatea {city}", weight: 0.04 },
        { pattern: "Nistru {city}", weight: 0.03 },
        { pattern: "Academia {city}", weight: 0.04 },
        { pattern: "Progresul {city}", weight: 0.04 },
      ],
      regional: [
        {
          regions: ["Chișinău"],
          templates: [
            { pattern: "Speranța {city}", weight: 0.2 },
            { pattern: "Codru {city}", weight: 0.2 },
            { pattern: "Universitatea {city}", weight: 0.2 },
            { pattern: "Sporting {city}", weight: 0.2 },
            { pattern: "Academia {city}", weight: 0.2 },
          ],
        },
      ],
      founded: { top: [1947, 2010], bottom: [1947, 2010] },
      colors: ["#FFD700", "#000000", "#006B3F", "#0033A0", "#E4002B", "#FFFFFF"],
    },
    importSources: weighted("BR:4 UA:3 RO:3 RU:2 BY:2 NG:2 GH:2 CM:2 CI:2 SN:2 ML:2 BF:2 CO:2 PT:2 ES:1 RS:1 BA:1 ME:1 MK:1 GE:1 AM:1 IL:1 AO:1 CV:1"),
    coefficients: { association: [1.375, 5.25, 3.75, 2.0, 2.125] },
  },
  abroad: {
    seniors: 20,
    youth: 4,
    destinations: weighted("RO:8 RU:2 KZ:2 BY:1 UA:1 IT:1 BG:1 CY:1 LV:1 HU:1"),
  },
};

// ------------------------------------------------------------------ Israel (no own league modeled)

const IL: NationSpec = {
  code: "IL",
  iso2: "IL",
  name: "Israel",
  confederation: "UEFA",
  continent: "AS",
  capital: "Jerusalem",
  latitude: 31.77,
  languages: [
    { code: "he", weight: 0.78 },
    { code: "ar", weight: 0.2 },
    { code: "ru", weight: 0.02 },
  ],
  reputation: { national: 63, league: 56 },
  euEea: false,
  physique: { height: 180 },
  names: {
    given: [src("pool:uefa-east/hebrew", 0.76), src("pool:uefa-east/arab-israeli", 0.2), src("pool:uefa-east/russian", 0.04)],
    family: [src("pool:uefa-east/hebrew", 0.76), src("pool:uefa-east/arab-israeli", 0.2), src("pool:uefa-east/russian", 0.04)],
  },
  nationality: {
    multipleRate: 0.3,
    tripleRate: 0.05,
    bornAbroadRate: 0.12,
    diasporaPull: 0.55,
    links: [
      ...links("postSoviet", "RU:7 UA:6 BY:2 MD:1 GE:1 AZ:1"),
      ...links("americas", "US:7 AR:3 BR:1"),
      ...links("crossBorder", "FR:6 EN:2 DE:1 BE:1 RO:1 HU:1"),
      ...links("mediterranean", "MA:3 TN:1"),
      ...links("regional", "ET:3"),
      ...links("arabWorld", "JO:1 PS:1"),
    ],
    citizenship: { dual: "allowed" },
  },
  cities: {
    major: [
      city("Jerusalem", "large", "Jerusalem"),
      city("Tel Aviv", "large", "Tel Aviv"),
      city("Haifa", "large", "Haifa"),
      city("Rishon LeZion", "medium", "Central"),
      city("Petah Tikva", "medium", "Central"),
      city("Ashdod", "medium", "Southern"),
      city("Netanya", "medium", "Central"),
      city("Be'er Sheva", "medium", "Southern"),
      city("Holon", "medium", "Tel Aviv"),
      city("Bnei Brak", "medium", "Tel Aviv"),
      city("Ramat Gan", "medium", "Tel Aviv"),
      city("Ashkelon", "medium", "Southern"),
      city("Rehovot", "medium", "Central"),
      city("Bat Yam", "medium", "Tel Aviv"),
      city("Herzliya", "small", "Tel Aviv"),
      city("Kfar Saba", "small", "Central"),
      city("Hadera", "small", "Haifa"),
      city("Modi'in", "small", "Central"),
      city("Nazareth", "small", "Northern"),
      city("Ra'anana", "small", "Central"),
      city("Kiryat Shmona", "town", "Northern"),
      city("Sakhnin", "town", "Northern"),
      city("Umm al-Fahm", "town", "Haifa"),
      city("Tayibe", "town", "Central"),
      city("Nahariya", "town", "Northern"),
      city("Afula", "town", "Northern"),
      city("Eilat", "town", "Southern"),
      city("Kiryat Gat", "town", "Southern"),
      city("Tiberias", "town", "Northern"),
      city("Ramla", "town", "Central"),
      city("Lod", "town", "Central"),
      city("Acre", "town", "Northern"),
      city("Dimona", "town", "Southern"),
      city("Karmiel", "town", "Northern"),
      city("Sderot", "town", "Southern"),
      city("Tamra", "town", "Northern"),
      city("Shefa-'Amr", "town", "Northern"),
      city("Rahat", "town", "Southern"),
      city("Kfar Qasim", "town", "Central"),
      city("Yokneam", "town", "Northern"),
    ],
  },
  // The real Israeli Premier League is outside the directive; players are home-based or at clubs abroad.
  homePool: { seniors: 110, youth: 70 },
  abroad: {
    seniors: 14,
    youth: 4,
    destinations: weighted("CY:3 NL:2 BE:2 HU:2 ES:1 RO:1 PL:1 US:1 DE:1 AT:1 GR:1 EN:1 IT:1"),
  },
};

const realNames = (text: string) =>
  text
    .split("|")
    .map((name) => name.trim())
    .filter(Boolean);

/** Real clubs (2025/26 top tiers plus well-known others) the templates could reproduce; the generator avoids them. */
const REAL_CLUB_NAMES: Readonly<Record<string, readonly string[]>> = {
  TR: realNames(
    `Galatasaray|Fenerbahçe|Beşiktaş|Trabzonspor|Başakşehir|İstanbul Başakşehir|Samsunspor|Göztepe|Eyüpspor|Kasımpaşa|
     Kocaelispor|Konyaspor|Alanyaspor|Antalyaspor|Kayserispor|Gaziantep FK|Gaziantepspor|Rizespor|Çaykur Rizespor|
     Gençlerbirliği|Fatih Karagümrük|Sivasspor|Hatayspor|Adana Demirspor|Bodrumspor|Pendikspor|Iğdır FK|Erzurumspor|
     Erzurumspor FK|Amedspor|Amed SK|Bandırmaspor|Boluspor|Çorum FK|Çorumspor|Erokspor|Esenler Erokspor|İstanbulspor|
     Keçiörengücü|Ankara Keçiörengücü|Manisa FK|Manisaspor|Sakaryaspor|Serik Belediyespor|Sarıyer|Ümraniyespor|Vanspor|
     Van Spor FK|Ankaragücü|MKE Ankaragücü|Bursaspor|Karşıyaka|Altay|Altınordu|Denizlispor|Şanlıurfaspor|Adanaspor|
     Giresunspor|Tuzlaspor|Malatyaspor|Yeni Malatyaspor|Menemen FK|Menemenspor|Muşspor|1461 Trabzon|Batman Petrolspor|
     Kastamonuspor|Karacabey Belediyespor|Arnavutköy Belediyespor|Bucaspor|Bucaspor 1928|Aliağa FK|İnegölspor|
     Ankara Demirspor|Kepezspor|Isparta 32 Spor|Mardin 1969 Spor|Elazığspor|Erbaaspor|Fethiyespor|Nazilli Belediyespor|
     Zonguldak Kömürspor|Hacettepe|Mersin İdmanyurdu|Yeni Mersin İdmanyurdu|Tarsus İdmanyurdu|Eskişehirspor|
     Balıkesirspor|Karabükspor|Kardemir Karabükspor|Akhisarspor|Orduspor|Erciyesspor|Kayseri Erciyesspor|Diyarbakırspor|
     Kartalspor|Zeytinburnuspor|Beykoz|Sivas Belediyespor|Kırşehir Belediyespor|Kahramanmaraşspor|Kırklarelispor|
     Somaspor|Uşakspor|Afyonspor|Afjet Afyonspor|Düzcespor`,
  ),
  RU: realNames(
    `Zenit|Zenit Sankt-Peterburg|Krasnodar|FK Krasnodar|Spartak Moskva|Spartak Moscow|Lokomotiv Moskva|Lokomotiv Moscow|
     CSKA Moskva|CSKA Moscow|Dinamo Moskva|Dynamo Moscow|Rubin Kazan|Krylia Sovetov|Krylia Sovetov Samara|Rostov|
     Akhmat Grozny|Terek Grozny|Baltika Kaliningrad|Akron Tolyatti|Orenburg|Pari Nizhny Novgorod|Nizhny Novgorod|
     Dinamo Makhachkala|Dynamo Makhachkala|Anzhi Makhachkala|Sochi|Fakel Voronezh|Khimki|Rodina Moskva|Torpedo Moskva|
     Torpedo Moscow|Arsenal Tula|Chernomorets Novorossiysk|Yenisey Krasnoyarsk|Ural Yekaterinburg|Shinnik Yaroslavl|
     SKA-Khabarovsk|SKA Khabarovsk|SKA Rostov-na-Donu|KAMAZ|KAMAZ Naberezhnye Chelny|Neftekhimik Nizhnekamsk|
     Alania Vladikavkaz|Spartak Vladikavkaz|Volga Ulyanovsk|Ufa|Tekstilshchik Ivanovo|Rotor Volgograd|Sokol Saratov|
     Chayka Peschanokopskoye|Veles Moskva|Spartak Kostroma|Torpedo Miass|Dinamo Bryansk|Dynamo Bryansk|Leningradets|
     Mashuk-KMV|Kuban Krasnodar|Tyumen|Tom Tomsk|Sibir Novosibirsk|Luch Vladivostok|Dinamo Stavropol|Dinamo Barnaul|
     Dinamo Vladivostok|Dinamo Sankt-Peterburg|Metallurg Lipetsk|Avangard Kursk|Salyut Belgorod|Khimik Dzerzhinsk|
     Metallurg Vyksa|Irtysh Omsk|Spartak Nalchik|Amkar Perm|Zvezda Perm|Tosno|Mordovia Saransk|Torpedo Vladimir|
     Saturn Ramenskoye|Znamya Truda|Volgar Astrakhan|Kuban|Tambov|Enisey|Lokomotiv Nizhny Novgorod`,
  ),
  RS: realNames(
    `Crvena zvezda|Red Star Belgrade|Partizan|Vojvodina|TSC|TSC Bačka Topola|Bačka Topola|Čukarički|Novi Pazar|
     Radnički 1923|Radnički Kragujevac|Radnički Niš|Spartak Subotica|Spartak Ždrepčeva krv|IMT|OFK Beograd|
     Železničar Pančevo|Napredak Kruševac|Javor Ivanjica|Mladost Lučani|Radnik Surdulica|Voždovac|Rad|Borac Čačak|Metalac|
     Metalac Gornji Milanovac|Mačva Šabac|Inđija|Proleter Novi Sad|Kolubara|Jedinstvo Ub|Smederevo|Sloboda Užice|
     Dinamo Vranje|Trayal|Zemun|Grafičar|Loznica|Mladost GAT|Novi Sad|Radnički Beograd|Teleoptik|Obilić|Sinđelić Beograd`,
  ),
  UA: realNames(
    `Dynamo Kyiv|Dinamo Kyiv|Shakhtar Donetsk|Kryvbas|Kryvbas Kryvyi Rih|Polissya Zhytomyr|Oleksandriya|Karpaty Lviv|
     Veres Rivne|Obolon Kyiv|Kolos Kovalivka|Zorya Luhansk|LNZ Cherkasy|Rukh Lviv|Metalist 1925|Metalist 1925 Kharkiv|
     Metalist Kharkiv|Epitsentr Kamianets-Podilskyi|Kudrivka|Poltava|Chornomorets Odesa|Vorskla Poltava|Inhulets|
     Livyi Bereh|Dnipro-1|Dnipro|Desna Chernihiv|Olimpik Donetsk|Mynai|Zirka Kropyvnytskyi|Volyn Lutsk|Arsenal Kyiv|
     Metalurh Zaporizhzhia|Metalurh Donetsk|Nyva Ternopil|Kremin Kremenchuk|Prykarpattia|Bukovyna Chernivtsi|
     Podillya Khmelnytskyi|Chernihiv|Viktoriya Sumy|Tavriya Simferopol|Hirnyk-Sport|Illichivets Mariupol|Mariupol|
     Kharkiv|Lviv|Karpaty|Zorya|Vorskla`,
  ),
  RO: realNames(
    `FCSB|Steaua București|CFR Cluj|Universitatea Craiova|Rapid București|Dinamo București|Universitatea Cluj|
     Farul Constanța|Oțelul Galați|Petrolul Ploiești|UTA Arad|Hermannstadt|Botoșani|Csíkszereda|Metaloglobus București|
     Argeș Pitești|Unirea Slobozia|Sepsi OSK|Gloria Buzău|Politehnica Iași|Poli Iași|Chindia Târgoviște|Voluntari|Mioveni|
     Concordia Chiajna|Corvinul Hunedoara|ASA Târgu Mureș|Viitorul Constanța|Gaz Metan Mediaș|Astra Giurgiu|
     Ceahlăul Piatra Neamț|Politehnica Timișoara|Ripensia Timișoara|Progresul București|Sportul Studențesc|
     Jiul Petroșani|Bihor Oradea|Olimpia Satu Mare|Unirea Urziceni|Afumați|Minaur Baia Mare|Brașov|FC Brașov|
     Dunărea Călărași|Pandurii Târgu Jiu|Universitatea Cluj-Napoca|Oțelul`,
  ),
  BG: realNames(
    `Ludogorets|Ludogorets Razgrad|Levski Sofia|CSKA Sofia|CSKA 1948|Cherno More|Cherno More Varna|Lokomotiv Plovdiv|
     Botev Plovdiv|Arda Kardzhali|Arda|Slavia Sofia|Beroe|Beroe Stara Zagora|Lokomotiv Sofia|Spartak Varna|
     Septemvri Sofia|Dobrudzha Dobrich|Dobrudzha|Botev Vratsa|Montana|Etar|Etar Veliko Tarnovo|Hebar|Hebar Pazardzhik|
     Pirin Blagoevgrad|Krumovgrad|Tsarsko Selo|Minyor Pernik|Litex Lovech|Marek Dupnitsa|Dunav Ruse|Chernomorets Burgas|
     Neftochimic Burgas|Vitosha Bistritsa|Strumska Slava|Belasitsa Petrich|Sozopol|Yantra Gabrovo|Maritsa Plovdiv|
     Spartak Pleven|Lokomotiv Gorna Oryahovitsa|Levski`,
  ),
  BA: realNames(
    `Zrinjski|Zrinjski Mostar|Borac Banja Luka|Sarajevo|FK Sarajevo|Željezničar|Željezničar Sarajevo|Velež|Velež Mostar|
     Sloga Doboj|Široki Brijeg|Radnik Bijeljina|Posušje|Rudar Prijedor|Zvijezda 09|GOŠK Gabela|Igman Konjic|Tuzla City|
     Leotar|Leotar Trebinje|Čelik Zenica|Olimpik|Olimpik Sarajevo|Slavija|Slavija Sarajevo|Travnik|Mladost Doboj Kakanj|
     Krupa|Orašje|Jedinstvo Bihać|Sloboda Tuzla|Borac`,
  ),
  ME: realNames(
    `Budućnost|Budućnost Podgorica|Sutjeska|Sutjeska Nikšić|Dečić|Dečić Tuzi|Mornar|Mornar Bar|Petrovac|Jezero|
     Jezero Plav|Arsenal Tivat|Jedinstvo Bijelo Polje|Mladost Donja Gorica|Bokelj|Bokelj Kotor|Grbalj|Rudar Pljevlja|
     Lovćen|Lovćen Cetinje|Zeta|Zeta Golubovci|Iskra Danilovgrad|Podgorica|FK Podgorica|Titograd|Otrant-Olympic|
     Kom|Berane|Ibar Rožaje`,
  ),
  XK: realNames(
    `Ballkani|Drita|Prishtina|Llapi|Malisheva|Dukagjini|Ferizaj|Gjilani|Suhareka|Drenica|Feronikeli|Trepça '89|Trepça|
     Besa Peja|Liria Prizren|Vëllaznimi|KEK|Istogu|Flamurtari Prishtina|Ulpiana|Rahoveci|Kika|Vushtrria|Onix`,
  ),
  AL: realNames(
    `Egnatia|Partizani|Partizani Tirana|Vllaznia|Vllaznia Shkodër|Tirana|KF Tirana|Dinamo City|Dinamo Tirana|
     AF Elbasani|Elbasani|Teuta|Teuta Durrës|Bylis|Bylis Ballsh|Flamurtari|Flamurtari Vlorë|Vora|Skënderbeu|
     Skënderbeu Korçë|Laçi|Kukësi|Kastrioti|Kastrioti Krujë|Apolonia|Apolonia Fier|Besa Kavajë|Luftëtari|
     Luftëtari Gjirokastër|Korabi|Erzeni|Burreli|Besëlidhja|Pogradeci|Shkumbini|Tomori|Tomori Berat|Oriku|Lushnja`,
  ),
  GE: realNames(
    `Dinamo Tbilisi|Dinamo Batumi|Torpedo Kutaisi|Iberia 1999|Saburtalo|Dila Gori|Dila|Samgurali|Samgurali Tsqaltubo|
     Kolkheti Poti|Kolkheti-1913|Gagra|Spaeri|Telavi|Locomotive Tbilisi|Lokomotivi Tbilisi|Samtredia|Meshakhte|
     Merani Martvili|Shukura Kobuleti|WIT Georgia|Sioni Bolnisi|Chikhura Sachkhere|Metalurgi Rustavi|Rustavi|
     Guria Lanchkhuti|Zestafoni|Merani Tbilisi|Sameba`,
  ),
  AM: realNames(
    `Ararat-Armenia|Ararat Armenia|Pyunik|Noah|Urartu|Ararat Yerevan|Ararat|Alashkert|Shirak|Shirak Gyumri|Van|
     Gandzasar|Gandzasar Kapan|BKMA|BKMA Yerevan|West Armenia|Banants|Mika|Kilikia|Syunik|Lori|Lori Vanadzor|Andranik|
     Ulisses|Impulse|Kotayk|Gyumri`,
  ),
  KZ: realNames(
    `Astana|FC Astana|Kairat|Kairat Almaty|Tobol|Tobol Kostanay|Ordabasy|Aktobe|Yelimay|Yelimay Semey|Spartak Semey|
     Zhenis|Zhenis Astana|Kaisar|Kaisar Kyzylorda|Atyrau|Okzhetpes|Kyzylzhar|Zhetysu|Ulytau|Turan|Shakhter Karagandy|
     Taraz|Irtysh Pavlodar|Akzhayik|Caspiy|Maktaaral|Aksu|Arys|Ekibastuz|Vostok|Kaspiy Aktau|Almaty`,
  ),
  BY: realNames(
    `BATE Borisov|BATE|Dinamo Minsk|Dynamo Minsk|Shakhtyor Soligorsk|Shakhter Soligorsk|Neman Grodno|Neman|
     Torpedo-BelAZ Zhodino|Torpedo Zhodino|Isloch|Isloch Minsk Raion|Slavia Mozyr|Gomel|Dinamo Brest|Dynamo Brest|
     Vitebsk|Minsk|FC Minsk|Naftan Novopolotsk|Naftan|Belshina Bobruisk|Belshina|Smorgon|Arsenal Dzerzhinsk|Slutsk|
     Dnepr Mogilev|Dnyapro Mogilev|Energetik-BGU|Molodechno|ML Vitebsk|Baranovichi|Rukh Brest|Lokomotiv Gomel|Gorodeya|
     Torpedo Minsk|Partizan Minsk|MTZ-RIPO|Dinamo Molodechno`,
  ),
  MD: realNames(
    `Sheriff|Sheriff Tiraspol|Petrocub|Petrocub Hîncești|Zimbru|Zimbru Chișinău|Milsami|Milsami Orhei|Dacia Buiucani|
     Dacia Chișinău|Spartanii|Spartanii Sportul|Florești|Bălți|FC Bălți|Zaria Bălți|Olimpia Bălți|Dinamo-Auto|
     Dinamo-Auto Tiraspol|Sfîntul Gheorghe|Speranța Nisporeni|Codru Lozova|Iskra-Stal|Tiraspol|FC Tiraspol|Nistru Otaci|
     Tighina|Victoria Bardar|Academia Chișinău|Real Succes|Saxan|Speranța Drochia|Sucleia`,
  ),
};

export const UEFA_EAST: CatalogFileData = {
  file: "uefa-east",
  realClubNames: REAL_CLUB_NAMES,
  nations: [TR, RU, RS, UA, RO, BG, BA, ME, XK, AL, MK, GE, AM, AZ, KZ, BY, MD, IL],
  namePools: [
    TURKISH,
    RUSSIAN,
    RUSSIA_MUSLIM,
    SERBIAN,
    BOSNIAK,
    ALBANIAN,
    UKRAINIAN,
    BULGARIAN,
    MONTENEGRIN,
    MACEDONIAN,
    GEORGIAN,
    ARMENIAN,
    AZERBAIJANI,
    KAZAKH,
    BELARUSIAN,
    HEBREW,
    ARAB_ISRAELI,
  ],
};
