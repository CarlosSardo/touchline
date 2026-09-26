// Real people whose full names generated players and staff must never carry (Rai review of PR #7).
// Keys: nation code, or "*" for people not tied to one catalog nation. Pure data: no server imports.
const list = (names: string) =>
  names.split("|").map((name) => name.trim()).filter(Boolean);

export const REAL_PERSON_NAMES: Readonly<Record<string, readonly string[]>> = {
  "*": list(`Gianni Infantino|Sepp Blatter|Aleksander Čeferin|João Havelange|Jules Rimet|Pierluigi Collina|Howard Webb|
    Mark Clattenburg|Michael Oliver|Anthony Taylor|Clément Turpin|Szymon Marciniak|Daniele Orsato|Felix Brych|Björn Kuipers`),
  EN: list(`Harry Kane|Jude Bellingham|Bukayo Saka|Phil Foden|Declan Rice|Cole Palmer|Jordan Pickford|John Stones|Kyle Walker|
    Kieran Trippier|Trent Alexander-Arnold|Marcus Rashford|Raheem Sterling|Jack Grealish|Mason Mount|Jordan Henderson|
    Harry Maguire|Luke Shaw|Aaron Ramsdale|Ollie Watkins|Ivan Toney|Conor Gallagher|Kobbie Mainoo|Anthony Gordon|
    Eberechi Eze|Marc Guéhi|Ezri Konsa|Jarrod Bowen|Dominic Solanke|Morgan Rogers|Wayne Rooney|David Beckham|
    Steven Gerrard|Frank Lampard|Paul Scholes|Gary Neville|Phil Neville|Rio Ferdinand|John Terry|Ashley Cole|Michael Owen|
    Alan Shearer|Gary Lineker|Paul Gascoigne|Bobby Moore|Bobby Charlton|Jack Charlton|Geoff Hurst|Gordon Banks|
    Peter Shilton|Kevin Keegan|Bryan Robson|Stuart Pearce|Tony Adams|David Seaman|Sol Campbell|Jamie Carragher|
    Emile Heskey|Peter Crouch|Jermain Defoe|Theo Walcott|Joe Hart|Jamie Vardy|Danny Welbeck|Glenn Hoddle|Chris Waddle|
    Teddy Sheringham|Andy Cole|Ian Wright|Les Ferdinand|Robbie Fowler|Matt Le Tissier|Michael Carrick|Ledley King|
    Jack Wilshere|Gareth Southgate|Lee Carsley|Roy Hodgson|Sam Allardyce|Eddie Howe|Graham Potter|Sean Dyche|
    Harry Redknapp|Bobby Robson|Alf Ramsey|Brian Clough|Terry Venables|Leah Williamson|Lucy Bronze|Alessia Russo|
    Chloe Kelly|Mary Earps|Beth Mead|Millie Bright|Ella Toone|Lauren James|Keir Starmer|Rishi Sunak|Boris Johnson`),
  SCO: list(`Andy Robertson|Scott McTominay|John McGinn|Kieran Tierney|Billy Gilmour|Che Adams|Lyndon Dykes|Callum McGregor|
    Angus Gunn|Craig Gordon|Grant Hanley|Jack Hendry|Ryan Christie|Stuart Armstrong|Lewis Ferguson|Kenny Dalglish|
    Denis Law|Graeme Souness|Ally McCoist|Jim Baxter|Billy Bremner|Gordon Strachan|Steve Clarke|Craig Brown|
    Walter Smith|Jock Stein|Matt Busby|Bill Shankly|Alex Ferguson|Darren Fletcher|Barry Ferguson|Paul Lambert|
    Kenny Miller|James McFadden|Scott Brown|Steven Naismith|Charlie Adam|David Moyes|John Swinney`),
  WAL: list(`Gareth Bale|Aaron Ramsey|Ryan Giggs|Ian Rush|John Charles|Mark Hughes|Neville Southall|Craig Bellamy|Joe Allen|
    Ben Davies|Daniel James|Brennan Johnson|Harry Wilson|Kieffer Moore|Ethan Ampadu|Danny Ward|Wayne Hennessey|
    Chris Gunter|Neco Williams|Joe Rodon|David Brooks|Rob Page|Gary Speed|Dean Saunders|John Toshack|Robbie Savage|
    Ashley Williams|Hal Robson-Kanu|Jordan James`),
  NIR: list(`George Best|Pat Jennings|Norman Whiteside|Danny Blanchflower|Martin O'Neill|Michael O'Neill|Steven Davis|
    Kyle Lafferty|Jonny Evans|Corry Evans|Aaron Hughes|David Healy|Gerry Armstrong|Conor Bradley|Stuart Dallas|
    Josh Magennis|Brendan Rodgers|Neil Lennon|Kieran McKenna|Bailey Peacock-Farrell`),
  IE: list(`Roy Keane|Robbie Keane|Paul McGrath|Damien Duff|Shay Given|John Aldridge|Niall Quinn|Liam Brady|Packie Bonner|
    Denis Irwin|Kevin Kilbane|Richard Dunne|Seamus Coleman|Caoimhín Kelleher|Evan Ferguson|Nathan Collins|Matt Doherty|
    Mick McCarthy|Stephen Kenny|John O'Shea|Kevin Doyle|Shane Long|Aiden McGeady|James McClean|Jeff Hendrick|
    Josh Cullen|Chiedozie Ogbene|Troy Parrott|Gavin Bazunu|Katie McCabe`),
  PT: list(`Cristiano Ronaldo|Bruno Fernandes|Bernardo Silva|Rúben Dias|João Cancelo|João Félix|Rafael Leão|Diogo Jota|
    Rui Patrício|Diogo Costa|João Neves|Nuno Mendes|Gonçalo Ramos|Rúben Neves|William Carvalho|João Palhinha|
    Danilo Pereira|Nélson Semedo|Diogo Dalot|Pedro Neto|Francisco Conceição|Gonçalo Inácio|António Silva|Luís Figo|
    Rui Costa|Ricardo Quaresma|Paulo Futre|Simão Sabrosa|Ricardo Carvalho|Paulo Ferreira|Fernando Couto|Vítor Baía|
    Nuno Gomes|Hélder Postiga|Tiago Mendes|Raul Meireles|Fábio Coentrão|Bruno Alves|José Mourinho|Fernando Santos|
    Rúben Amorim|André Villas-Boas|Jorge Jesus|Sérgio Conceição|Paulo Fonseca|Nuno Espírito Santo|Leonardo Jardim|
    Carlos Queiroz|Marco Silva|Abel Ferreira|Vítor Pereira|Pedro Martins|Luís Castro|Bruno Lage|Jorge Mendes|
    Pinto da Costa|Luís Filipe Vieira|Marcelo Rebelo de Sousa|António Costa|Luís Montenegro|Eusébio|Deco|Pepe|Nani|
    Pauleta|Maniche|Costinha|Vitinha|Otávio`),
  ES: list(`Lamine Yamal|Pedri|Gavi|Rodri|Dani Olmo|Nico Williams|Iñaki Williams|Álvaro Morata|Unai Simón|Dani Carvajal|
    Aymeric Laporte|Robin Le Normand|Marc Cucurella|Fabián Ruiz|Mikel Merino|Mikel Oyarzabal|Ferran Torres|
    Martín Zubimendi|Pau Cubarsí|Alejandro Grimaldo|Álex Baena|Iker Casillas|Sergio Ramos|Carles Puyol|Gerard Piqué|
    Xavi Hernández|Andrés Iniesta|Sergio Busquets|Xabi Alonso|David Silva|David Villa|Fernando Torres|Raúl González|
    Fernando Hierro|Cesc Fàbregas|Jordi Alba|Juan Mata|Santi Cazorla|Marco Asensio|Jesús Navas|Álvaro Arbeloa|
    Joan Capdevila|Carlos Marchena|Víctor Valdés|Pepe Reina|David de Gea|Kepa Arrizabalaga|Emilio Butragueño|
    Andoni Zubizarreta|Luis Enrique|Pep Guardiola|Josep Guardiola|Vicente del Bosque|Luis Aragonés|Luis de la Fuente|
    Julen Lopetegui|Unai Emery|Mikel Arteta|Rafael Benítez|Quique Setién|Andoni Iraola|Imanol Alguacil|
    Ernesto Valverde|José Bordalás|Javier Clemente|Florentino Pérez|Joan Laporta|Luis Rubiales|Pedro Sánchez|
    Rafael Nadal|Carlos Alcaraz|Fernando Alonso|Alexia Putellas|Aitana Bonmatí|Jennifer Hermoso|Thiago Alcântara|
    Joaquín Sánchez|Míchel Salgado|Fernando Morientes|Gaizka Mendieta|Álvaro Negredo|Roberto Soldado|Nacho Fernández|
    Lucas Vázquez|Dani Parejo|Iago Aspas|Sergi Roberto|Ansu Fati|Ander Herrera|Pablo Sarabia|Yeremy Pino|Dean Huijsen|
    Fermín López|Alejandro Balde|Pau Torres|Eric García|Diego Costa|Isco|Koke|Joselu|Míchel`),
  FR: list(`Kylian Mbappé|Antoine Griezmann|Ousmane Dembélé|Olivier Giroud|Hugo Lloris|Mike Maignan|Raphaël Varane|
    Jules Koundé|Dayot Upamecano|William Saliba|Ibrahima Konaté|Theo Hernández|Lucas Hernández|Benjamin Pavard|
    N'Golo Kanté|Aurélien Tchouaméni|Eduardo Camavinga|Adrien Rabiot|Paul Pogba|Karim Benzema|Kingsley Coman|
    Marcus Thuram|Randal Kolo Muani|Bradley Barcola|Michael Olise|Warren Zaïre-Emery|Désiré Doué|Rayan Cherki|
    Youssouf Fofana|Manu Koné|Lilian Thuram|Zinedine Zidane|Thierry Henry|Michel Platini|Didier Deschamps|Laurent Blanc|
    Marcel Desailly|Patrick Vieira|Robert Pires|Emmanuel Petit|Fabien Barthez|Bixente Lizarazu|Christian Karembeu|
    Youri Djorkaeff|David Trezeguet|Franck Ribéry|Claude Makélélé|Nicolas Anelka|Sylvain Wiltord|Just Fontaine|
    Raymond Kopa|Jean-Pierre Papin|Éric Cantona|Éric Abidal|William Gallas|Louis Saha|Florent Malouda|Samir Nasri|
    Hatem Ben Arfa|Blaise Matuidi|Moussa Sissoko|Dimitri Payet|Steve Mandanda|Alphonse Areola|Presnel Kimpembe|
    Nabil Fekir|Kurt Zouma|Jean-Philippe Mateta|Arsène Wenger|Aimé Jacquet|Raymond Domenech|Gérard Houllier|
    Claude Puel|Rudi Garcia|Christophe Galtier|Hervé Renard|Claude Le Roy|Luis Fernandez|Emmanuel Macron|
    Nicolas Sarkozy|François Hollande|Wendie Renard|Eugénie Le Sommer|Kadidiatou Diani|Marie-Antoinette Katoto`),
  IT: list(`Gianluigi Buffon|Gianluigi Donnarumma|Francesco Totti|Alessandro Del Piero|Paolo Maldini|Franco Baresi|
    Fabio Cannavaro|Andrea Pirlo|Roberto Baggio|Christian Vieri|Filippo Inzaghi|Simone Inzaghi|Gennaro Gattuso|
    Daniele De Rossi|Alessandro Nesta|Giorgio Chiellini|Leonardo Bonucci|Marco Verratti|Ciro Immobile|Lorenzo Insigne|
    Federico Chiesa|Nicolò Barella|Alessandro Bastoni|Riccardo Calafiori|Federico Dimarco|Giovanni Di Lorenzo|
    Sandro Tonali|Davide Frattesi|Mateo Retegui|Gianluca Scamacca|Moise Kean|Giacomo Raspadori|Lorenzo Pellegrini|
    Bryan Cristante|Manuel Locatelli|Guglielmo Vicario|Alex Meret|Luca Toni|Alberto Gilardino|Antonio Di Natale|
    Mario Balotelli|Andrea Belotti|Dino Zoff|Gigi Riva|Paolo Rossi|Giuseppe Meazza|Sandro Mazzola|Gianni Rivera|
    Giacinto Facchetti|Marco Tardelli|Bruno Conti|Salvatore Schillaci|Gianluca Vialli|Roberto Mancini|Walter Zenga|
    Giuseppe Bergomi|Carlo Ancelotti|Marcello Lippi|Arrigo Sacchi|Fabio Capello|Antonio Conte|Massimiliano Allegri|
    Luciano Spalletti|Claudio Ranieri|Stefano Pioli|Gian Piero Gasperini|Maurizio Sarri|Gian Piero Ventura|
    Cesare Prandelli|Giovanni Trapattoni|Enzo Bearzot|Vittorio Pozzo|Roberto De Zerbi|Vincenzo Montella|Thiago Motta|
    Silvio Berlusconi|Giorgia Meloni|Sergio Mattarella|Andrea Agnelli|Aurelio De Laurentiis|Christian Panucci|
    Alessandro Costacurta|Marco Materazzi|Gianluca Zambrotta|Mauro Camoranesi|Simone Perrotta|Andrea Barzagli|
    Angelo Peruzzi|Francesco Toldo|Demetrio Albertini|Dino Baggio|Giuseppe Signori|Gianfranco Zola|Enrico Chiesa|
    Antonio Cassano|Stephan El Shaarawy|Graziano Pellè|Domenico Berardi|Matteo Politano|Andrea Cambiaso|Destiny Udogie|
    Samuele Ricci|Jorginho`),
  DE: list(`Manuel Neuer|Thomas Müller|Joshua Kimmich|Toni Kroos|İlkay Gündoğan|Jamal Musiala|Florian Wirtz|Kai Havertz|
    Leroy Sané|Serge Gnabry|Antonio Rüdiger|Niklas Süle|Jonathan Tah|Marc-André ter Stegen|Leon Goretzka|Robert Andrich|
    Niclas Füllkrug|Deniz Undav|David Raum|Maximilian Mittelstädt|Nico Schlotterbeck|Pascal Groß|Karim Adeyemi|
    Timo Werner|Mario Götze|Marco Reus|Mats Hummels|Jérôme Boateng|Mesut Özil|Sami Khedira|Bastian Schweinsteiger|
    Philipp Lahm|Per Mertesacker|Lukas Podolski|Miroslav Klose|Michael Ballack|Oliver Kahn|Jens Lehmann|
    Jürgen Klinsmann|Lothar Matthäus|Rudi Völler|Andreas Brehme|Franz Beckenbauer|Gerd Müller|Sepp Maier|Paul Breitner|
    Karl-Heinz Rummenigge|Uwe Seeler|Günter Netzer|Berti Vogts|Matthias Sammer|Oliver Bierhoff|Jürgen Kohler|
    Thomas Häßler|Joachim Löw|Hansi Flick|Julian Nagelsmann|Jürgen Klopp|Thomas Tuchel|Ralf Rangnick|Jupp Heynckes|
    Ottmar Hitzfeld|Felix Magath|Otto Rehhagel|Helmut Schön|Sepp Herberger|Uli Hoeneß|Hans-Joachim Watzke|Olaf Scholz|
    Angela Merkel|Friedrich Merz|Alexandra Popp|Lena Oberdorf|Giulia Gwinn|Birgit Prinz|Martina Voss-Tecklenburg`),
  NL: list(`Virgil van Dijk|Frenkie de Jong|Memphis Depay|Cody Gakpo|Xavi Simons|Matthijs de Ligt|Denzel Dumfries|
    Nathan Aké|Stefan de Vrij|Georginio Wijnaldum|Donyell Malen|Wout Weghorst|Tijjani Reijnders|Ryan Gravenberch|
    Jeremie Frimpong|Micky van de Ven|Bart Verbruggen|Joey Veerman|Teun Koopmeiners|Steven Bergwijn|Justin Kluivert|
    Patrick Kluivert|Clarence Seedorf|Edgar Davids|Frank Rijkaard|Ruud Gullit|Marco van Basten|Johan Cruyff|
    Johan Neeskens|Ruud Krol|Dennis Bergkamp|Frank de Boer|Ronald de Boer|Jaap Stam|Edwin van der Sar|Phillip Cocu|
    Marc Overmars|Arjen Robben|Robin van Persie|Wesley Sneijder|Rafael van der Vaart|Dirk Kuyt|Mark van Bommel|
    Nigel de Jong|Giovanni van Bronckhorst|Ruud van Nistelrooy|Roy Makaay|Jimmy Floyd Hasselbaink|Jimmy Hasselbaink|
    Pierre van Hooijdonk|Klaas-Jan Huntelaar|Daley Blind|Danny Blind|Quincy Promes|Luuk de Jong|Ronald Koeman|
    Erwin Koeman|Louis van Gaal|Guus Hiddink|Dick Advocaat|Bert van Marwijk|Rinus Michels|Arne Slot|Erik ten Hag|
    Peter Bosz|Mark Rutte|Dick Schoof|Vivianne Miedema|Lieke Martens|Sarina Wiegman|Winston Bogarde|Aron Winter|
    Stanley Menzo|Gerald Vanenburg|Henk Fraser|Regi Blinker|Romeo Castelen|Urby Emanuelson|Ryan Babel|Eljero Elia|
    Royston Drenthe|Leroy Fer|Luciano Narsingh|Ian Maatsen|Jurriën Timber|Quinten Timber|Brian Brobbey|Lutsharel Geertruida`),
  BE: list(`Kevin De Bruyne|Romelu Lukaku|Eden Hazard|Thibaut Courtois|Jan Vertonghen|Toby Alderweireld|Vincent Kompany|
    Axel Witsel|Dries Mertens|Yannick Carrasco|Youri Tielemans|Leandro Trossard|Jérémy Doku|Amadou Onana|Lois Openda|
    Charles De Ketelaere|Arthur Theate|Timothy Castagne|Koen Casteels|Marouane Fellaini|Moussa Dembélé|Thomas Vermaelen|
    Enzo Scifo|Jan Ceulemans|Jean-Marie Pfaff|Paul Van Himst|Marc Wilmots|Roberto Martínez|Domenico Tedesco|Rudi Garcia`),
  CH: list(`Granit Xhaka|Xherdan Shaqiri|Yann Sommer|Manuel Akanji|Ricardo Rodríguez|Breel Embolo|Remo Freuler|Fabian Schär|
    Nico Elvedi|Denis Zakaria|Dan Ndoye|Gregor Kobel|Stephan Lichtsteiner|Alexander Frei|Stéphane Chapuisat|
    Ottmar Hitzfeld|Murat Yakin|Vladimir Petković|Köbi Kuhn`),
  AT: list(`David Alaba|Marko Arnautović|Marcel Sabitzer|Konrad Laimer|Christoph Baumgartner|Nicolas Seiwald|Kevin Danso|
    Michael Gregoritsch|Xaver Schlager|Patrick Pentz|Stefan Posch|Toni Polster|Hans Krankl|Herbert Prohaska|
    Andreas Herzog|Ralf Rangnick|Franco Foda|Marcel Koller`),
  DK: list(`Christian Eriksen|Kasper Schmeichel|Peter Schmeichel|Simon Kjær|Pierre-Emile Højbjerg|Rasmus Højlund|
    Andreas Christensen|Joachim Andersen|Thomas Delaney|Mikkel Damsgaard|Kasper Dolberg|Yussuf Poulsen|Martin Braithwaite|
    Michael Laudrup|Brian Laudrup|Allan Simonsen|Morten Olsen|Jon Dahl Tomasson|Nicklas Bendtner|Daniel Agger|Kasper Hjulmand|
    Brian Riemer|Mette Frederiksen|Pernille Harder`),
  SE: list(`Zlatan Ibrahimović|Alexander Isak|Viktor Gyökeres|Dejan Kulusevski|Victor Lindelöf|Emil Forsberg|Robin Olsen|
    Sebastian Larsson|Henrik Larsson|Fredrik Ljungberg|Kim Källström|Olof Mellberg|Tomas Brolin|Martin Dahlin|
    Gunnar Nordahl|Nils Liedholm|Sven-Göran Eriksson|Janne Andersson|Jon Dahl Tomasson|Lars Lagerbäck|Magdalena Eriksson`),
  NO: list(`Erling Haaland|Martin Ødegaard|Alexander Sørloth|Sander Berge|Ole Gunnar Solskjær|John Arne Riise|Tore André Flo|
    John Carew|Steffen Iversen|Ståle Solbakken|Egil Olsen|Kristian Thorstvedt|Ada Hegerberg|Caroline Graham Hansen`),
  FI: list(`Teemu Pukki|Lukáš Hrádecký|Jari Litmanen|Sami Hyypiä|Mikael Forssell|Glen Kamara|Joel Pohjanpalo|Markku Kanerva`),
  IS: list(`Gylfi Sigurðsson|Aron Gunnarsson|Albert Guðmundsson|Hákon Arnar Haraldsson|Eiður Guðjohnsen|Heimir Hallgrímsson|
    Lars Lagerbäck|Hannes Halldórsson|Jóhann Berg Guðmundsson|Alfreð Finnbogason|Ragnar Sigurðsson`),
  FO: list(`Gunnar Nielsen|Rógvi Baldvinsson|Klæmint Olsen|Hallur Hansson`),
  EE: list(`Mart Poom|Ragnar Klavan|Konstantin Vassiljev|Karol Mets|Henri Anier`),
  LV: list(`Māris Verpakovskis|Aleksandrs Starkovs|Vitālijs Astafjevs|Artjoms Rudņevs`),
  LT: list(`Edgaras Jankauskas|Tomas Danilevičius|Arminas Narbekovas|Fedor Černych`),
  PL: list(`Robert Lewandowski|Wojciech Szczęsny|Piotr Zieliński|Jakub Błaszczykowski|Łukasz Piszczek|Kamil Glik|
    Grzegorz Krychowiak|Arkadiusz Milik|Krzysztof Piątek|Jan Bednarek|Jakub Kiwior|Nicola Zalewski|Sebastian Szymański|
    Zbigniew Boniek|Grzegorz Lato|Kazimierz Deyna|Jerzy Dudek|Włodzimierz Lubański|Andrzej Szarmach|Kazimierz Górski|
    Adam Nawałka|Michał Probierz|Jerzy Brzęczek|Czesław Michniewicz|Fernando Santos|Andrzej Duda|Donald Tusk`),
  CZ: list(`Pavel Nedvěd|Petr Čech|Tomáš Rosický|Karel Poborský|Jan Koller|Milan Baroš|Vladimír Šmicer|Patrik Schick|
    Tomáš Souček|Vladimír Coufal|Adam Hložek|Antonín Panenka|Josef Masopust|Ivan Hašek|Karel Brückner`),
  SK: list(`Marek Hamšík|Milan Škriniar|Martin Škrtel|Stanislav Lobotka|Ondrej Duda|Róbert Mak|Martin Dúbravka|
    Juraj Kucka|Peter Dubovský|Francesco Calzona|Vladimír Weiss`),
  HU: list(`Dominik Szoboszlai|Péter Gulácsi|Willi Orbán|Roland Sallai|Barnabás Varga|Milos Kerkez|Ádám Szalai|
    Balázs Dzsudzsák|Ferenc Puskás|Sándor Kocsis|Flórián Albert|Nándor Hidegkuti|Gyula Grosics|Lajos Détári|
    Marco Rossi|Viktor Orbán`),
  SI: list(`Jan Oblak|Josip Iličić|Benjamin Šeško|Samir Handanović|Zlatko Zahović|Jasmin Kurtić|Matjaž Kek|Srečko Katanec`),
  HR: list(`Luka Modrić|Ivan Rakitić|Mateo Kovačić|Ivan Perišić|Joško Gvardiol|Marcelo Brozović|Dejan Lovren|Mario Mandžukić|
    Andrej Kramarić|Dominik Livaković|Josip Stanišić|Lovro Majer|Davor Šuker|Zvonimir Boban|Robert Prosinečki|
    Slaven Bilić|Igor Štimac|Dario Šimić|Robert Jarni|Zlatko Dalić|Niko Kovač|Robert Kovač|Darijo Srna|Vedran Ćorluka`),
  LU: list(`Leandro Barreiro|Gerson Rodrigues|Danel Sinani|Anthony Moris|Luc Holtz|Jeff Strasser`),
  LI: list(`Mario Frick|Peter Jehle|Martin Stocklasa`),
  TR: list(`Hakan Çalhanoğlu|Arda Güler|Kenan Yıldız|Kerem Aktürkoğlu|Ferdi Kadıoğlu|Merih Demiral|Çağlar Söyüncü|
    Cengiz Ünder|Orkun Kökçü|Barış Alper Yılmaz|Mert Günok|Uğurcan Çakır|İsmail Yüksek|Hakan Şükür|Rüştü Reçber|
    Emre Belözoğlu|Arda Turan|Nihat Kahveci|Tuncay Şanlı|Tugay Kerimoğlu|Hamit Altıntop|Burak Yılmaz|Alpay Özalan|
    Bülent Korkmaz|Fatih Terim|Şenol Güneş|Mustafa Denizli|Vincenzo Montella|Recep Tayyip Erdoğan`),
  RU: list(`Igor Akinfeev|Aleksandr Golovin|Artem Dzyuba|Denis Cheryshev|Andrey Arshavin|Roman Pavlyuchenko|Lev Yashin|
    Oleg Blokhin|Valeri Karpin|Aleksandr Mostovoi|Stanislav Cherchesov|Guus Hiddink|Valery Karpin|Vladimir Putin`),
  UA: list(`Andriy Shevchenko|Oleksandr Zinchenko|Mykhailo Mudryk|Artem Dovbyk|Andriy Lunin|Anatoliy Trubin|Illia Zabarnyi|
    Viktor Tsyhankov|Roman Yaremchuk|Taras Stepanenko|Andriy Yarmolenko|Yevhen Konoplyanka|Anatoliy Tymoshchuk|
    Serhiy Rebrov|Oleh Blokhin|Valeriy Lobanovskyi|Volodymyr Zelensky|Vitali Klitschko`),
  RS: list(`Dušan Vlahović|Aleksandar Mitrović|Sergej Milinković-Savić|Dušan Tadić|Filip Kostić|Nemanja Matić|
    Vanja Milinković-Savić|Strahinja Pavlović|Nemanja Vidić|Branislav Ivanović|Dejan Stanković|Siniša Mihajlović|
    Dragan Stojković|Savo Milošević|Predrag Mijatović|Vladimir Jugović|Dragan Džajić|Aleksandar Kolarov|
    Radomir Antić|Aleksandar Vučić|Novak Djokovic`),
  RO: list(`Gheorghe Hagi|Ianis Hagi|Gheorghe Popescu|Dan Petrescu|Adrian Mutu|Cristian Chivu|Florin Răducioiu|Ilie Dumitrescu|
    Marius Lăcătuș|Victor Pițurcă|Nicolae Stanciu|Radu Drăgușin|Răzvan Marin|Dennis Man|Edward Iordănescu|Anghel Iordănescu|
    Mircea Lucescu|Florin Niță|Gigi Becali`),
  BG: list(`Hristo Stoichkov|Dimitar Berbatov|Krasimir Balakov|Yordan Letchkov|Emil Kostadinov|Lyuboslav Penev|Stiliyan Petrov|
    Martin Petrov|Borislav Mihaylov|Ilian Iliev|Kiril Despodov`),
  BA: list(`Edin Džeko|Miralem Pjanić|Sead Kolašinac|Asmir Begović|Ermedin Demirović|Vedad Ibišević|Safet Sušić|
    Hasan Salihamidžić|Zvjezdan Misimović|Senad Lulić|Faruk Hadžibegić|Sergej Barbarez`),
  ME: list(`Stevan Jovetić|Mirko Vučinić|Dejan Savićević|Predrag Mijatović|Stefan Savić|Milutin Osmajić|Nikola Vukčević`),
  AL: list(`Armando Broja|Kristjan Asllani|Thomas Strakosha|Elseid Hysaj|Berat Djimsiti|Lorik Cana|Erjon Bogdani|Sylvinho`),
  MK: list(`Goran Pandev|Eljif Elmas|Enis Bardhi|Ezgjan Alioski|Darko Pančev|Igor Angelovski|Blagoja Milevski`),
  XK: list(`Vedat Muriqi|Milot Rashica|Amir Rrahmani|Edon Zhegrova|Arijanet Muric|Franco Foda`),
  GE: list(`Khvicha Kvaratskhelia|Giorgi Mamardashvili|Georges Mikautadze|Giorgi Kochorashvili|Otar Kiteishvili|
    Kakha Kaladze|Shota Arveladze|Giorgi Kinkladze|Temuri Ketsbaia|Willy Sagnol`),
  AM: list(`Henrikh Mkhitaryan|Yura Movsisyan|Varazdat Haroyan|Tigran Barseghyan`),
  AZ: list(`Emin Mahmudov|Ramil Sheydayev|Mahir Emreli|Gurban Gurbanov`),
  KZ: list(`Baktiyar Zaynutdinov|Islambek Kuat|Abat Aymbetov|Yuri Logvinenko|Magomed Adiyev`),
  BY: list(`Alexander Hleb|Maksim Romaschenko|Valyantsin Byalkevich|Sergei Kornilenko|Aleksandr Lukashenko`),
  MD: list(`Serghei Cleşcenco|Radu Rebeja|Alexandru Epureanu|Serghei Clescenco`),
  IL: list(`Yossi Benayoun|Eran Zahavi|Manor Solomon|Mohammad Abu Fani|Tal Ben Haim|Eyal Berkovic|Haim Revivo|Avi Nimni|
    Dudu Aouate|Ronny Rosenthal|Mordechai Spiegler|Avram Grant|Benjamin Netanyahu`),
  GR: list(`Theodoros Zagorakis|Angelos Charisteas|Giorgos Karagounis|Kostas Katsouranis|Traianos Dellas|
    Konstantinos Mavropanos|Kostas Tsimikas|Giorgos Masouras|Vangelis Pavlidis|Anastasios Bakasetas|Fotis Kouvelas|
    Otto Rehhagel|Ivan Jovanović|Vasilis Hatzipanagis|Kyriakos Mitsotakis|Giannis Antetokounmpo`),
  CY: list(`Michalis Konstantinou|Constantinos Charalambidis|Ioannis Okkas|Grigoris Kastanos|Pieros Sotiriou`),
  MT: list(`Michael Mifsud|Andrè Schembri|Teddy Teuma|Carmel Busuttil|Robert Abela`),
  SM: list(`Andy Selva|Aldo Simoncini|Massimo Bonini|Nicola Nanni`),
  AD: list(`Ildefons Lima|Marc Vales|Koldo Álvarez|Óscar Sonejee`),
  GI: list(`Lee Casciaro|Roy Chipolina|Liam Walker|Joseph Chipolina|Fabian Picardo`),
  BR: list(`Pelé|Neymar|Neymar Júnior|Ronaldinho|Ronaldo Nazário|Kaká|Rivaldo|Romário|Zico|Garrincha|Cafu|Roberto Carlos|
    Vinícius Júnior|Rodrygo|Raphinha|Endrick|Casemiro|Richarlison|Alisson Becker|Ederson Moraes|Marquinhos|
    Thiago Silva|Dani Alves|Gabriel Jesus|Gabriel Martinelli|Gabriel Magalhães|Lucas Paquetá|Bruno Guimarães|
    Éder Militão|Antony|Philippe Coutinho|Roberto Firmino|Fabinho|Bebeto|Robinho|Adriano|Juninho Pernambucano|
    Juninho Paulista|Sócrates|Falcão|Tostão|Jairzinho|Rivelino|Carlos Alberto Torres|Didi|Vavá|Taffarel|Dunga|Lúcio|
    Juan Silveira|Gilberto Silva|Emerson Leão|Luiz Felipe Scolari|Carlos Alberto Parreira|Tite|Dorival Júnior|
    Fernando Diniz|Mário Zagallo|Telê Santana|Abel Ferreira|Carlo Ancelotti|Marta|Formiga|Luiz Inácio Lula da Silva|
    Jair Bolsonaro|Ayrton Senna|Oscar dos Santos|Willian Borges|Hulk|Fred|Douglas Costa|Alex Sandro|Danilo Luiz|
    Savinho|Estêvão|João Pedro|Igor Thiago|Matheus Cunha`),
  AR: list(`Lionel Messi|Diego Maradona|Diego Armando Maradona|Ángel Di María|Sergio Agüero|Lautaro Martínez|Julián Álvarez|
    Emiliano Martínez|Rodrigo De Paul|Enzo Fernández|Alexis Mac Allister|Cristian Romero|Nicolás Otamendi|
    Lisandro Martínez|Nahuel Molina|Nicolás Tagliafico|Leandro Paredes|Giovani Lo Celso|Paulo Dybala|Alejandro Garnacho|
    Gabriel Batistuta|Hernán Crespo|Juan Román Riquelme|Javier Zanetti|Javier Mascherano|Carlos Tevez|Gonzalo Higuaín|
    Pablo Aimar|Juan Sebastián Verón|Diego Simeone|Mario Kempes|Daniel Passarella|Alfredo Di Stéfano|Jorge Valdano|
    Claudio Caniggia|Gabriel Heinze|Walter Samuel|Roberto Ayala|Esteban Cambiasso|Fernando Redondo|Ariel Ortega|
    Lionel Scaloni|Marcelo Bielsa|Mauricio Pochettino|Jorge Sampaoli|Gerardo Martino|César Luis Menotti|Carlos Bilardo|
    Alejandro Sabella|José Pékerman|Marcelo Gallardo|Ricardo Gareca|Claudio Tapia|Javier Milei|Franco Mastantuono|
    Valentín Carboni|Thiago Almada|Nicolás González|Exequiel Palacios|Giuliano Simeone`),
  UY: list(`Luis Suárez|Edinson Cavani|Diego Forlán|Federico Valverde|Darwin Núñez|Ronald Araújo|José María Giménez|
    Diego Godín|Fernando Muslera|Rodrigo Bentancur|Manuel Ugarte|Giorgian de Arrascaeta|Facundo Pellistri|
    Maximiliano Araújo|Enzo Francescoli|Álvaro Recoba|Obdulio Varela|Alcides Ghiggia|Juan Alberto Schiaffino|
    Paolo Montero|Diego Lugano|Óscar Tabárez|Marcelo Bielsa|Gustavo Poyet|Yamandú Orsi`),
  CO: list(`James Rodríguez|Radamel Falcao|Luis Díaz|Juan Cuadrado|David Ospina|Davinson Sánchez|Yerry Mina|Jhon Arias|
    Richard Ríos|Jhon Durán|Jefferson Lerma|Daniel Muñoz|Carlos Valderrama|René Higuita|Faustino Asprilla|
    Freddy Rincón|Andrés Escobar|Iván Córdoba|Mario Yepes|Juan Pablo Ángel|Néstor Lorenzo|José Pékerman|Francisco Maturana|
    Gustavo Petro`),
  VE: list(`Salomón Rondón|Yangel Herrera|Tomás Rincón|Jefferson Savarino|Yeferson Soteldo|Juan Arango|Fernando Batista|
    Rafael Dudamel|César Farías|Nicolás Maduro`),
  EC: list(`Moisés Caicedo|Enner Valencia|Piero Hincapié|Pervis Estupiñán|Willian Pacho|Kendry Páez|Antonio Valencia|
    Álex Aguinaga|Agustín Delgado|Iván Hurtado|Ulises de la Cruz|Felipe Caicedo|Sebastián Beccacece|Daniel Noboa`),
  PE: list(`Paolo Guerrero|Jefferson Farfán|Claudio Pizarro|André Carrillo|Pedro Gallese|Renato Tapia|Gianluca Lapadula|
    Teófilo Cubillas|Nolberto Solano|Juan Reynoso|Ricardo Gareca|Jorge Fossati`),
  BO: list(`Marco Etcheverry|Erwin Sánchez|Marcelo Martins|Carlos Lampe|Luis Cristaldo|Óscar Villegas|Evo Morales`),
  PY: list(`José Luis Chilavert|Roque Santa Cruz|Óscar Cardozo|Carlos Gamarra|Celso Ayala|Miguel Almirón|Julio Enciso|
    Gustavo Gómez|Antonio Sanabria|Justo Villar|Salvador Cabañas|Gustavo Alfaro|Santiago Peña`),
  CL: list(`Alexis Sánchez|Arturo Vidal|Claudio Bravo|Gary Medel|Charles Aránguiz|Eduardo Vargas|Mauricio Isla|
    Marcelo Salas|Iván Zamorano|Elías Figueroa|Carlos Caszely|Jorge Sampaoli|Manuel Pellegrini|Ricardo Gareca|
    Gabriel Boric`),
  US: list(`Christian Pulisic|Weston McKennie|Tyler Adams|Gio Reyna|Timothy Weah|Sergiño Dest|Antonee Robinson|
    Matt Turner|Folarin Balogun|Ricardo Pepi|Yunus Musah|Tim Ream|Chris Richards|Landon Donovan|Clint Dempsey|
    Michael Bradley|Tim Howard|Brad Friedel|Kasey Keller|Alexi Lalas|Brian McBride|DaMarcus Beasley|Jozy Altidore|
    Cobi Jones|Claudio Reyna|Bruce Arena|Bob Bradley|Jürgen Klinsmann|Gregg Berhalter|Mauricio Pochettino|
    Megan Rapinoe|Alex Morgan|Abby Wambach|Mia Hamm|Carli Lloyd|Donald Trump|Joe Biden`),
  CA: list(`Alphonso Davies|Jonathan David|Cyle Larin|Tajon Buchanan|Stephen Eustáquio|Ismaël Koné|Milan Borjan|
    Atiba Hutchinson|Dwayne De Rosario|Julian de Guzman|Tomasz Radzinski|Jesse Marsch|John Herdman|Christine Sinclair|
    Justin Trudeau|Mark Carney`),
  MX: list(`Hirving Lozano|Raúl Jiménez|Edson Álvarez|Guillermo Ochoa|Santiago Giménez|Johan Vásquez|César Montes|
    Luis Chávez|Andrés Guardado|Héctor Herrera|Javier Hernández|Chicharito|Rafael Márquez|Hugo Sánchez|Cuauhtémoc Blanco|
    Jared Borgetti|Jorge Campos|Carlos Vela|Giovani dos Santos|Oswaldo Sánchez|Pável Pardo|Javier Aguirre|
    Miguel Herrera|Juan Carlos Osorio|Gerardo Martino|Ricardo La Volpe|Claudia Sheinbaum`),
  CR: list(`Keylor Navas|Bryan Ruiz|Joel Campbell|Celso Borges|Paulo Wanchope|Walter Centeno|Francisco Calvo|Óscar Ramírez|
    Jorge Luis Pinto|Gustavo Matosas`),
  PA: list(`Román Torres|Blas Pérez|Luis Tejada|Jaime Penedo|Aníbal Godoy|Adalberto Carrasquilla|Thomas Christiansen|
    Hernán Darío Gómez`),
  HN: list(`David Suazo|Carlos Pavón|Wilson Palacios|Maynor Figueroa|Alberth Elis|Romell Quioto|Amado Guevara|Reinaldo Rueda`),
  SV: list(`Jorge "Mágico" González|Jorge González|Nayib Bukele|Eriq Zavaleta|Alex Roldán`),
  GT: list(`Carlos Ruiz|Dwight Pezzarossi|Rubio Rubín|Luis Fernando Tena`),
  JM: list(`Leon Bailey|Michail Antonio|Ricardo Gardner|Theo Whitmore|Walter Boyd|Deon Burton|Andre Blake|Steve McClaren|
    Usain Bolt`),
  HT: list(`Emmanuel Sanon|Frantzdy Pierrot|Duckens Nazon|Johny Placide|Derrick Etienne`),
  DO: list(`Mariano Díaz|Heinz Barmettler|Edarlyn Reyes`),
  PR: list(`Héctor Ramos|Jeremy de León|Roberto Clemente|Jenniffer González-Colón|Pedro Albizu Campos`),
  TT: list(`Dwight Yorke|Russell Latapy|Shaka Hislop|Stern John|Kenwyne Jones|Leo Beenhakker|Brian Lara`),
  SR: list(`Sheraldo Becker|Tjaronn Chery|Kenneth Paal|Delano Burgzorg|Ryan Donk|Kelvin Leerdam|Virgil Misidjan|
    Shaquille Pinas|Myenty Abena|Gleofilo Vlijter|Richonell Margaret|Stefano Seedorf|Chedric Seedorf|Jurgen Seedorf|
    Radinio Balker|Djevencio van der Kust|Anfernee Dijksteel|Dhoraso Moreo Klas|Regillio Simons|Diego Biseswar|
    Joel Piroe|Jaden Montnor|Etienne Amoksi|Gyrano Kerk|Nigel Hasselbaink|Florian Jozefzoon|Dean Gorré|Stanley Menzo|
    Humphrey Mijnals|Desi Bouterse|Chan Santokhi|Ronnie Brunswijk|Ronald Venetiaan|Jennifer Geerlings-Simons|
    Johan Adolf Pengel|Jules Wijdenbosch|Henck Arron|Johan Ferrier|Jules Sedney`),
  CW: list(`Leandro Bacuna|Juninho Bacuna|Cuco Martina|Eloy Room|Rangelo Janga|Kenji Gorré|Tahith Chong|Jürgen Locadia|
    Gervane Kastaneer|Juriën Gaari|Sherel Floranus|Armando Obispo|Livano Comenencia|Jearl Margaritha|Brandley Kuwas|
    Kevin Felida|Godfried Roemeratoe|Tyrick Bodak|Jeremy Antonisse|Shurandy Sambo|Deveron Fonville|Jurich Carolina|
    Joshua Brenet|Darryl Lachman|Vurnon Anita|Churandy Martina|Jonathan Schoop|Andruw Jones|Kenley Jansen|
    Jean-Julien Rojer|Dick Advocaat|Patrick Kluivert|Gilmar Pisas|Eugene Rhuggenaath`),
  AW: list(`Betico Croes|Nelson Oduber|Mike Eman|Henny Eman|Evelyn Wever-Croes|Xander Bogaerts|Denzel Dumfries`),
  NC: list(`Christian Karembeu|Paul Neaoutyine|Dick Ukeiwé|Jean-Marie Tjibaou|Emmanuel Tjibaou|Roch Wamytan|
    Djubelly Wéa|Emmanuel Kasarhérou|Louis Mapou|Alcide Ponga|Philippe Gomès|Sonia Backès|Georges Gope-Fenepej|
    Bertrand Kaï|Roy Kayara|Jekob Jeno|Kiam Wanesse|Joël Wakanumuné|Cédric Sansot|Rocky Nyikeine|Emile Béaruné|
    César Zeoula|Jacques Gope-Iwate|Pierre Wajoka|Yohann Mercier|Antoine Kombouaré|Jacques Zimako|
    Jean-Philippe Saïko|Brice Dahité|Wassissi Hnalaine|Éloi Machoro|Yeiwéné Yeiwéné|Alphonse Dianou|Nidoish Naisseline|
    Rock Pidjot|Raphaël Pidjot|Jacques Lafleur`),
  NZ: list(`Chris Wood|Winston Reid|Ryan Nelsen|Wynton Rufer|Ricki Herbert|Danny Hay|Darren Bazeley|Marco Rojas|
    Liberato Cacace|Matt Garbett|Joe Bell|Christopher Luxon|Jacinda Ardern`),
  FJ: list(`Roy Krishna|Esala Masi|Sitiveni Rabuka`),
  PF: list(`Marama Vahirua|Pascal Vahirua|Teaonui Tehau|Moetai Brotherson`),
  PG: list(`David Muta|Raymond Gunemba|James Marape`),
  SB: list(`Commins Menapi|Benjamin Totori|Micah Lea'alafa|Jeremiah Manele`),
  VU: list(`Brian Kaltak|Jean Kaltack|Bong Kalo`),
  TO: list(`Timote Moleni|Unaloto Feao`),
  WS: list(`Desmond Fa'aiuaso|Fiamē Naomi Mataʻafa`),
  MA: list(`Achraf Hakimi|Hakim Ziyech|Yassine Bounou|Sofyan Amrabat|Youssef En-Nesyri|Noussair Mazraoui|Romain Saïss|
    Nayef Aguerd|Azzedine Ounahi|Brahim Díaz|Bilal El Khannouss|Abde Ezzalzouli|Eliesse Ben Seghir|Mustapha Hadji|
    Noureddine Naybet|Badou Zaki|Aziz Bouderbala|Marouane Chamakh|Mehdi Benatia|Younès Belhanda|Walid Regragui|
    Hervé Renard|Vahid Halilhodžić|Fouzi Lekjaa`),
  EG: list(`Mohamed Salah|Omar Marmoush|Mohamed Elneny|Trézéguet|Mahmoud Hassan|Mostafa Mohamed|Mohamed Abdelmonem|
    Mohamed El Shenawy|Mohamed Aboutrika|Ahmed Hassan|Hossam Hassan|Essam El Hadary|Wael Gomaa|Amr Zaki|Mido|
    Ahmed Hossam|Hassan Shehata|Rui Vitória|Abdel Fattah el-Sisi`),
  NG: list(`Victor Osimhen|Ademola Lookman|Alex Iwobi|Wilfred Ndidi|Samuel Chukwueze|Kelechi Iheanacho|Victor Boniface|
    William Troost-Ekong|Calvin Bassey|Ola Aina|Stanley Nwabali|Moses Simon|Jay-Jay Okocha|Nwankwo Kanu|Rashidi Yekini|
    Daniel Amokachi|Sunday Oliseh|Finidi George|Emmanuel Amunike|Taribo West|Celestine Babayaro|Victor Ikpeba|
    John Obi Mikel|Obafemi Martins|Yakubu Aiyegbeni|Joseph Yobo|Vincent Enyeama|Ahmed Musa|Odion Ighalo|Stephen Keshi|
    Clemens Westerhof|Gernot Rohr|José Peseiro|Asisat Oshoala|Bola Tinubu|Muhammadu Buhari`),
  SN: list(`Sadio Mané|Kalidou Koulibaly|Édouard Mendy|Idrissa Gueye|Ismaïla Sarr|Nicolas Jackson|Pape Matar Sarr|
    Iliman Ndiaye|Habib Diallo|Boulaye Dia|Cheikhou Kouyaté|Pape Bouba Diop|El Hadji Diouf|Henri Camara|Khalilou Fadiga|
    Salif Diao|Tony Sylva|Aliou Cissé|Bruno Metsu|Pape Thiaw|Macky Sall|Bassirou Diomaye Faye|Ousmane Sonko`),
  DZ: list(`Riyad Mahrez|Ismaël Bennacer|Islam Slimani|Saïd Benrahma|Aïssa Mandi|Rayan Aït-Nouri|Amine Gouiri|
    Houssem Aouar|Ramy Bensebaini|Sofiane Feghouli|Yacine Brahimi|Rabah Madjer|Lakhdar Belloumi|Rafik Djebbour|
    Djamel Belmadi|Vladimir Petković|Abdelmadjid Tebboune`),
  TN: list(`Wahbi Khazri|Youssef Msakni|Ellyes Skhiri|Hannibal Mejbri|Aïssa Laïdouni|Montassar Talbi|Ali Maâloul|
    Radhi Jaïdi|Karim Haggui|Tarak Dhiab|Jalel Kadri|Kaïs Saïed`),
  CI: list(`Didier Drogba|Yaya Touré|Kolo Touré|Salomon Kalou|Gervinho|Wilfried Zaha|Franck Kessié|Sébastien Haller|
    Simon Adingra|Nicolas Pépé|Serge Aurier|Odilon Kossounou|Evan Ndicka|Seko Fofana|Ibrahim Sangaré|Amad Diallo|
    Emmanuel Eboué|Didier Zokora|Arouna Koné|Boubacar Barry|Emerse Faé|Laurent Pokou|Alassane Ouattara`),
  CM: list(`Samuel Eto'o|Roger Milla|André Onana|Vincent Aboubakar|Bryan Mbeumo|Eric Maxim Choupo-Moting|
    Carlos Baleba|Frank Anguissa|André-Frank Zambo Anguissa|Rigobert Song|Alexandre Song|Patrick Mboma|Geremi|
    Marc-Vivien Foé|Lauren Etame Mayer|Joël Matip|Thomas N'Kono|Joseph-Antoine Bell|Stéphane Mbia|Benjamin Moukandjo|
    Marc Brys|Paul Biya`),
  GH: list(`Mohammed Kudus|Thomas Partey|Jordan Ayew|André Ayew|Abedi Pelé|Inaki Williams|Antoine Semenyo|Kamaldeen Sulemana|
    Tariq Lamptey|Alexander Djiku|Mohammed Salisu|Asamoah Gyan|Michael Essien|Sulley Muntari|Stephen Appiah|
    Kevin-Prince Boateng|John Mensah|Samuel Kuffour|Anthony Baffoe|Tony Yeboah|Otto Addo|Chris Hughton|Milovan Rajevac|
    John Mahama|Nana Akufo-Addo`),
  CD: list(`Chancel Mbemba|Cédric Bakambu|Yoane Wissa|Arthur Masuaku|Aaron Wan-Bissaka|Gaël Kakuta|Dieumerci Mbokani|
    Trésor Mputu|Shabani Nonda|Lomana LuaLua|Sébastien Desabre|Félix Tshisekedi`),
  ZA: list(`Benni McCarthy|Lucas Radebe|Steven Pienaar|Siphiwe Tshabalala|Doctor Khumalo|Shaun Bartlett|Mark Fish|
    Percy Tau|Ronwen Williams|Teboho Mokoena|Themba Zwane|Lyle Foster|Hugo Broos|Pitso Mosimane|Cyril Ramaphosa|
    Nelson Mandela|Jacob Zuma`),
  CV: list(`Ryan Mendes|Garry Rodrigues|Jamiro Monteiro|Bebé|Vozinha|Pedro Leitão Brito|Bubista|Logan Costa|
    Kenny Rocha Santos|Dylan Tavares|Lisandro Semedo|Sidny Lopes Cabral|Deroy Duarte|Willy Semedo|Steven Moreira|
    Jeffry Fortes|Wagner Pina|Patrick Andrade|Laros Duarte|Dailon Livramento|Kevin Pina|Roberto Lopes|Amílcar Cabral|
    José Maria Neves|Ulisses Correia e Silva|Pedro Pires|Cesaria Évora`),
  AO: list(`Akwá|Fabrice Alcebíades Maieco|Gelson Dala|Mabululu|Zito Luvumbo|Flávio Amado|Pedro Gonçalves|João Lourenço`),
  MZ: list(`Eusébio da Silva Ferreira|Mário Coluna|Dominguês|Geny Catamo|Reinildo Mandava|Chiquinho Conde|Daniel Chapo`),
  ML: list(`Seydou Keita|Frédéric Kanouté|Mahamadou Diarra|Yves Bissouma|Amadou Haidara|Moussa Djenepo|Salif Keïta|
    Djibril Sidibé|Assimi Goïta`),
  CG: list(`Thievy Bifouma|Christopher Samba|Denis Sassou Nguesso`),
  GA: list(`Pierre-Emerick Aubameyang|Denis Bouanga|Mario Lemina|Daniel Cousin|Didier Ovono`),
  GN: list(`Serhou Guirassy|Naby Keïta|Amadou Diawara|François Kamano|Pascal Feindouno|Titi Camara|Kaba Diawara`),
  BF: list(`Bertrand Traoré|Edmond Tapsoba|Issoufou Dayo|Jonathan Pitroipa|Aristide Bancé|Moumouni Dagano|Ibrahim Traoré`),
  ZM: list(`Kalusha Bwalya|Christopher Katongo|Rainford Kalaba|Patson Daka|Fashion Sakala|Enock Mwepu|Hervé Renard|
    Hakainde Hichilema`),
  ZW: list(`Peter Ndlovu|Benjani Mwaruwari|Bruce Grobbelaar|Marvelous Nakamba|Khama Billiat|Knowledge Musona|
    Emmerson Mnangagwa`),
  KE: list(`Victor Wanyama|Michael Olunga|McDonald Mariga|Dennis Oliech|Engin Firat|William Ruto`),
  UG: list(`Denis Onyango|Farouk Miya|Emmanuel Okwi|Yoweri Museveni`),
  TZ: list(`Mbwana Samatta|Simon Msuva|Samia Suluhu Hassan`),
  ET: list(`Saladin Said|Getaneh Kebede|Abiy Ahmed`),
  GM: list(`Musa Barrow|Ebrima Colley|Yankuba Minteh|Adama Barrow`),
  GW: list(`Mama Baldé|Frédéric Mendy|Umaro Sissoco Embaló`),
  GQ: list(`Emilio Nsue|Iban Salvador|Pedro Obiang|Teodoro Obiang`),
  BJ: list(`Stéphane Sessègnon|Steve Mounié|Gernot Rohr|Patrice Talon`),
  TG: list(`Emmanuel Adebayor|Faure Gnassingbé`),
  LR: list(`George Weah|Timothy Weah|Joseph Boakai`),
  SL: list(`Mohamed Kallon|Julius Maada Bio`),
  MR: list(`Aboubakar Kamara|Mohamed Ould Ghazouani`),
  NA: list(`Peter Shalulile|Collin Benjamin|Netumbo Nandi-Ndaitwah`),
  MG: list(`Faneva Andriatsima|Andry Rajoelina`),
  RW: list(`Paul Kagame`),
  SD: list(`Haitham Mustafa`),
  LY: list(`Muammar Gaddafi|Al-Saadi Gaddafi`),
  JP: list(`Hidetoshi Nakata|Shunsuke Nakamura|Keisuke Honda|Shinji Kagawa|Yuto Nagatomo|Maya Yoshida|Takefusa Kubo|
    Kaoru Mitoma|Wataru Endo|Takumi Minamino|Daichi Kamada|Ritsu Doan|Junya Ito|Ayase Ueda|Takehiro Tomiyasu|
    Hiroki Ito|Ko Itakura|Zion Suzuki|Shuichi Gonda|Kazuyoshi Miura|Yasuhito Endo|Shinji Okazaki|Makoto Hasebe|
    Eiji Kawashima|Atsuto Uchida|Hajime Moriyasu|Takeshi Okada|Akira Nishino|Philippe Troussier|Homare Sawa|
    Shigeru Ishiba|Shohei Ohtani`),
  KR: list(`Son Heung-min|Park Ji-sung|Kim Min-jae|Lee Kang-in|Hwang Hee-chan|Hwang In-beom|Cho Gue-sung|Jo Hyeon-woo|
    Kim Seung-gyu|Lee Jae-sung|Cha Bum-kun|Hong Myung-bo|Ahn Jung-hwan|Lee Young-pyo|Park Chu-young|Ki Sung-yueng|
    Lee Chung-yong|Seol Ki-hyeon|Hwang Sun-hong|Kim Nam-il|Yoo Sang-chul|Lee Dong-gook|Choi Kang-hee|Shin Tae-yong|
    Paulo Bento|Jürgen Klinsmann|Guus Hiddink|Lee Jae-myung|Yoon Suk-yeol`),
  AU: list(`Tim Cahill|Harry Kewell|Mark Viduka|Mark Schwarzer|Mile Jedinak|Lucas Neill|Brett Emerton|Mark Bresciano|
    Aaron Mooy|Mathew Ryan|Mat Ryan|Jackson Irvine|Harry Souttar|Craig Goodwin|Martin Boyle|Mitchell Duke|Ajdin Hrustic|
    Riley McGree|Nestory Irankunda|Ange Postecoglou|Graham Arnold|Tony Popovic|Frank Farina|Sam Kerr|Anthony Albanese`),
  SA: list(`Salem Al-Dawsari|Saleh Al-Shehri|Mohammed Al-Owais|Firas Al-Buraikan|Sami Al-Jaber|Majed Abdullah|
    Yasser Al-Qahtani|Mohamed Al-Deayea|Saeed Al-Owairan|Nawaf Al-Temyat|Hervé Renard|Roberto Mancini|
    Mohammed bin Salman`),
  IR: list(`Mehdi Taremi|Sardar Azmoun|Alireza Jahanbakhsh|Alireza Beiranvand|Ali Daei|Ali Karimi|Karim Bagheri|
    Mehdi Mahdavikia|Javad Nekounam|Andranik Teymourian|Carlos Queiroz|Amir Ghalenoei|Masoud Pezeshkian`),
  QA: list(`Akram Afif|Almoez Ali|Hassan Al-Haydos|Saad Al-Sheeb|Boualem Khoukhi|Félix Sánchez|Tintín Márquez|
    Nasser Al-Khelaïfi|Tamim bin Hamad Al Thani`),
  UZ: list(`Eldor Shomurodov|Abbosbek Fayzullaev|Abdukodir Khusanov|Jaloliddin Masharipov|Server Djeparov|
    Maksim Shatskikh|Timur Kapadze|Srečko Katanec|Shavkat Mirziyoyev|Islam Karimov|Islom Karimov|Otabek Shukurov|
    Oston Urunov|Khojimat Erkinov|Husniddin Aliqulov|Khojiakbar Alijonov|Ibrokhimkhalil Yuldoshev|Igor Sergeev|
    Egor Krimets|Jamshid Iskanderov|Rustam Ashurmatov|Utkir Yusupov|Azizbek Turgunboev|Odil Ahmedov|Sherzod Nasrullaev`),
  IQ: list(`Younis Mahmoud|Nashat Akram|Ali Adnan|Aymen Hussein|Hussein Saeed|Jesús Casas`),
  AE: list(`Omar Abdulrahman|Ali Mabkhout|Ahmed Khalil|Adnan Al-Talyani|Paulo Bento`),
  CN: list(`Wu Lei|Zhang Linpeng|Wu Xi|Yan Junling|Zheng Zhi|Sun Jihai|Fan Zhiyi|Hao Haidong|Li Tie|Shao Jiayi|
    Li Yi|Zhang Yuning|Wei Shihao|Marcello Lippi|Branko Ivanković|Xi Jinping`),
  VN: list(`Nguyễn Quang Hải|Nguyễn Công Phượng|Lê Công Vinh|Đặng Văn Lâm|Quế Ngọc Hải|Nguyễn Tiến Linh|
    Park Hang-seo|Kim Sang-sik|Philippe Troussier|Tô Lâm`),
  TH: list(`Chanathip Songkrasin|Teerasil Dangda|Kiatisuk Senamuang|Theerathon Bunmathan|Supachok Sarachat|
    Kawin Thamsatchanan|Masatada Ishii|Paetongtarn Shinawatra`),
  IN: list(`Sunil Chhetri|Bhaichung Bhutia|Gurpreet Singh Sandhu|Sandesh Jhingan|IM Vijayan|Igor Štimac|Stephen Constantine|
    Narendra Modi|Sachin Tendulkar|Virat Kohli`),
  ID: list(`Bambang Pamungkas|Egy Maulana Vikri|Asnawi Mangkualam|Jay Idzes|Thom Haye|Marselino Ferdinan|Shin Tae-yong|
    Patrick Kluivert|Erick Thohir|Prabowo Subianto`),
  MY: list(`Mokhtar Dahari|Safee Sali|Kim Swee Lim|Kim Pan-gon|Anwar Ibrahim`),
  SG: list(`Fandi Ahmad|Aleksandar Đurić|Ikhsan Fandi|Hariss Harun|Lawrence Wong`),
  PH: list(`Phil Younghusband|James Younghusband|Neil Etheridge|Ferdinand Marcos Jr.`),
  JO: list(`Musa Al-Taamari|Yazan Al-Naimat|Hussein Ammouta|Jamal Sellami`),
  BH: list(`A'ala Hubail|Dragan Talajić`),
  KW: list(`Bader Al-Mutawa|Jasem Yaqoub`),
  OM: list(`Ali Al-Habsi|Amad Al-Hosni`),
  LB: list(`Hassan Maatouk|Roda Antar`),
  SY: list(`Omar Al Somah|Omar Kharbin|Firas Al-Khatib|Bashar al-Assad|Ahmed al-Sharaa`),
  PS: list(`Oday Dabbagh|Mahmoud Abbas`),
  KP: list(`Jong Tae-se|Han Kwang-song|Pak Kwang-ryong|Jong Il-gwan|Ri Myong-guk|An Yong-hak|Pak Nam-chol|Mun In-guk|
    Hong Yong-jo|Kim Kyong-il|Pak Chol-jin|Ri Kwang-chon|Cha Jong-hyok|Nam Song-chol|Ji Yun-nam|Kim Yong-jun|
    Kim Jong-un|Kim Il-sung|Kim Jong-il`),
  HK: list(`Chan Siu-ki|Michael Luk|Jørn Andersen|John Lee Ka-chiu`),
  TW: list(`Chen Po-liang|Lai Ching-te`),
  KG: list(`Vitalij Lux|Sadyr Japarov`),
  TJ: list(`Manuchekhr Dzhalilov|Petar Šegrt|Emomali Rahmon`),
  PK: list(`Kaleemullah Khan|Shehbaz Sharif|Imran Khan`),
  BD: list(`Jamal Bhuyan|Hamza Choudhury|Muhammad Yunus`),
  MM: list(`Aung Thu|Min Aung Hlaing|Aung San Suu Kyi`),
  NP: list(`Kiran Chemjong|Anjan Bista`),
  LK: list(`Kasun Jayasuriya|Sanath Jayasuriya`),
  MV: list(`Ali Ashfaq|Mohamed Muizzu`),
  KH: list(`Chan Vathanaka|Hun Manet|Hun Sen`),
  LA: list(`Soukaphone Vongchiengkham`),
  MN: list(`Tsedenbal Norjmoo`),
  AF: list(`Faysal Shayesteh|Zohib Islam Amiri`),
  YE: list(`Ala Al-Sasi`),
  TM: list(`Serdar Berdimuhamedow|Gurbanguly Berdimuhamedow`),
  BN: list(`Faiq Bolkiah|Hassanal Bolkiah`),
  TL: list(`Mário Donizete|Xanana Gusmão|José Ramos-Horta`),
  GU: list(`Jason Cunliffe|Ryan Guy`),
  MO: list(`Leong Ka Hang`),
  BT: list(`Chencho Gyeltshen`),
};

const FOLDED: Record<string, string> = { ø: "o", æ: "ae", œ: "oe", ß: "ss", ı: "i", đ: "d", ł: "l", þ: "th", ð: "d", ħ: "h" };
/** Comparison key for person names: case, diacritics, hyphens and punctuation ignored. */
export function realPersonNameKey(name: string): string {
  return name
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[øæœßıđłþðħ]/g, (letter) => FOLDED[letter])
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

/** The listed name in given-family order and both family-first rotations ("Son Heung-min" = "Heung-min Son"). */
function orders(name: string): string[] {
  const words = realPersonNameKey(name).split(" ");
  if (words.length < 2) return [words.join(" ")];
  return [words, [...words.slice(1), words[0]], [words.at(-1)!, ...words.slice(0, -1)]].map((order) => order.join(" "));
}

let keys: ReadonlySet<string> | undefined;
/** True when a generated full name is a listed real person's, in either name order or with a second family name added. */
export function isRealPersonName(name: string): boolean {
  keys ??= new Set(Object.values(REAL_PERSON_NAMES).flat().flatMap(orders));
  const words = realPersonNameKey(name).split(" ");
  return keys.has(words.join(" ")) || (words.length > 2 && keys.has(words.slice(0, -1).join(" ")));
}
