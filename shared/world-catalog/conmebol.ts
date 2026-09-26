import type {
  CatalogFileData,
  CitizenshipRule,
  CitySize,
  CitySpec,
  ClubNameTemplate,
  FakerNameLocale,
  HeritageLink,
  MigrationContext,
  NamePool,
  NationSpec,
  WeightedCode,
  WeightedNameSource,
  YouthDivisionSpec,
} from "./types.ts";

// Owner: catalog author "conmebol" — AR BR CO UY EC PY CL PE VE BO (validate.ts CATALOG_ASSIGNMENT).
// 2025/26 structures on one July–June season (decision 10): no Apertura/Clausura, no calendar-year seasons and no
// state championships. Money in GBP. Coefficient seeds keep CONMEBOL's ranking order (2021..2025, oldest first).

/** Whitespace-separated names; "_" stands for a space inside a compound name ("João_Pedro"). */
const list = (text: string) =>
  text
    .split(/\s+/)
    .filter(Boolean)
    .map((entry) => entry.replace(/_/g, " "));
const pool = (name: string, given: string, family: string): NamePool => ({
  id: `conmebol/${name}`,
  ...(given.trim() ? { given: list(given) } : {}),
  ...(family.trim() ? { family: list(family) } : {}),
});
/** "brazilian=6 faker:it=0.3 uefa-west/spanish=1": bare names are this file's pools. */
const sources = (spec: string): WeightedNameSource[] =>
  spec
    .trim()
    .split(/\s+/)
    .map((entry) => {
      const at = entry.lastIndexOf("=");
      const name = entry.slice(0, at);
      const weight = Number(entry.slice(at + 1));
      if (name.startsWith("faker:")) return { source: name as `faker:${FakerNameLocale}`, weight };
      return { source: `pool:${name.includes("/") ? name : `conmebol/${name}`}`, weight };
    });
/** "IT:8 ES:3" → weighted nation codes. */
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
const allowed: CitizenshipRule = { dual: "allowed" };
/** "Name:size:maxClubs" entries separated by ","; size defaults to town; "|" separates districts after "=". */
const cities = (region: string, spec: string): CitySpec[] =>
  spec
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((entry) => {
      const [head, districts] = entry.split("=");
      const [name, size = "town", maxClubs] = head.split(":").map((part) => part.trim());
      return {
        name,
        size: size as CitySize,
        region,
        ...(maxClubs ? { maxClubs: Number(maxClubs) } : {}),
        ...(districts ? { districts: districts.split("|").map((part) => part.trim()) } : {}),
      };
    });
/** "{city} FC:2; Sport {city}:1" → weighted club-name templates (patterns never contain ":"). */
const templates = (spec: string, tiers?: number[]): ClubNameTemplate[] =>
  spec
    .split(";")
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((entry) => {
      const at = entry.lastIndexOf(":");
      return {
        pattern: entry.slice(0, at).trim(),
        weight: Number(entry.slice(at + 1)),
        ...(tiers ? { tiers } : {}),
      };
    });
const division = (
  name: string,
  parentTiers: [number, number],
  groupSize?: number,
  groupNames?: string,
): YouthDivisionSpec => ({
  name,
  parentTiers,
  ...(groupSize ? { groupSize } : {}),
  ...(groupNames ? { groupNames: groupNames.split("|") } : {}),
});

// ------------------------------------------------------------------ name pools (romanized, Latin script only)

const BRAZILIAN = pool(
  "brazilian",
  `Adriano Alan Alex Alexandre Alisson Allan Anderson André Antônio Arthur Artur Augusto Bernardo Breno Bruno Caio
   Carlos Cauã Cauê Cleiton Cristian Daniel Danilo Davi David Denílson Diego Diogo Douglas Dudu Edson Eduardo Elias
   Emerson Enzo Erick Éverton Ewerton Fabiano Fábio Fabrício Felipe Fernando Filipe Flávio Gabriel Gérson Gilberto
   Giovanni Guilherme Gustavo Heitor Henrique Hugo Igor Ítalo Jadson Jean Jefferson Jhonatan Jonathan João Jorge José
   Júlio Juninho Kaio Kaique Kauã Kayky Kevin Lázaro Leandro Léo Leonardo Lucas Luan Luciano Luiz Luís Marcelo Marcos
   Marlon Matheus Mateus Maurício Maycon Michael Miguel Murilo Natan Nathan Neto Nicolas Otávio Pablo Patrick Paulinho
   Paulo Pedro Pedrinho Rafael Rafinha Raphael Raul Reinaldo Renan Renato Ricardo Richard Roberto Robson Rodrigo
   Rogério Ronald Rony Ruan Rubens Samuel Sávio Sérgio Talles Thales Thiago Tiago Tomás Vagner Vanderson Vinícius
   Vitinho Vitor Victor Wagner Wallace Welington Wellington Wendel Wesley Weverton Willian William Yago Yan Yuri
   Ademir Adílson Aírton Alysson Alef Anselmo Cleber Claudinho Cristiano Dênis Éder Edinho Edmílson Elton Emanuel Eric
   Ezequiel Fagner Fernandinho Geovane Guga Iago Jair Jairo Janderson Jeferson Joel Jonas Juan Juliano Júnior Kleber
   Lincoln Lorran Luca Madson Maicon Marcinho Mário Messias Moisés Nilson Nino Osvaldo Pietro Railan Ramon Renê
   Reginaldo Ricardinho Ronaldo Rômulo Sidnei Silas Tadeu Thiaguinho Tomé Uendel Valdir Wanderson Washington Weslley
   Wilson Zeca João_Pedro João_Victor João_Paulo João_Lucas João_Gabriel Pedro_Henrique Pedro_Augusto Paulo_Henrique
   Luiz_Felipe Luiz_Gustavo Luiz_Henrique Luiz_Otávio Marcos_Vinícius Carlos_Eduardo Carlos_Henrique José_Eduardo
   Vitor_Hugo Victor_Hugo Matheus_Henrique Gabriel_Henrique Antônio_Carlos`,
  `Silva Santos Oliveira Souza Sousa Rodrigues Ferreira Alves Pereira Lima Gomes Costa Ribeiro Martins Carvalho Almeida
   Lopes Soares Fernandes Vieira Barbosa Rocha Dias Nascimento Andrade Moreira Nunes Marques Machado Mendes Freitas
   Cardoso Ramos Gonçalves Santana Teixeira Araújo Moura Correia Pinto Cavalcanti Cavalcante Monteiro Moraes Morais
   Batista Campos Castro Miranda Duarte Farias Borges Reis Fonseca Pires Rezende Resende Macedo Aguiar Azevedo Bezerra
   Brito Cunha Siqueira Tavares Xavier Queiroz Pacheco Sales Medeiros Menezes Leite Leal Viana Vasconcelos Brandão
   Coelho Diniz Figueiredo Guimarães Lacerda Magalhães Maia Matos Mattos Mesquita Neves Novaes Paiva Peixoto Porto
   Prado Rangel Sampaio Sena Serra Toledo Valente Vaz Veloso Camargo Bueno Franco Garcia Nogueira Pimentel Ávila Barros
   Bastos Bittencourt Braga Caldeira Carneiro Cordeiro Cruz Damasceno Esteves Evangelista Falcão Feitosa Fontes Frota
   Galvão Goulart Lins Lobo Loureiro Lourenço Maciel Malta Mariano Meireles Melo Mello Mota Nóbrega Paixão Pedrosa
   Queiroga Rios Sá Sabino Salgado Seixas Severino Silveira Tenório Torres Uchôa Vargas Ventura Vidal Vilela Assis
   Amaral Antunes Aragão Arruda Barreto Belo Bernardes Cabral Calado Câmara Canuto Coutinho Dantas Domingues Dutra
   Espíndola Fagundes Faria Fialho Freire Furtado Gama Godoy Gouveia Jardim Lemos Leitão Lustosa Magno Mendonça Muniz
   Nery Paes Pontes Quintão Rabelo Rolim Simões Sobral Tomaz Trindade Valadares Chaves Fraga Conceição Jesus Anjos
   dos_Santos da_Silva de_Oliveira de_Souza de_Jesus da_Costa dos_Reis Zanetti Rossi Ferrari Bianchi Romano Colombo
   Marchetti Rinaldi Tozzi Bortolotti Zanella Gazzola Pasqualini Casagrande Cechinel Fontana Girardi Lorenzetti
   Pellegrini Tonetto Zanatta Schmidt Müller Weber Klein Schneider Becker Hoffmann Krüger Zimmermann Schulz Kunz Stein
   Haddad Salomão Abdalla Nassar Maluf Cury`,
);
// Argentina and Uruguay: Spanish and Italian roots, some Basque, Galician, German, Croatian and Levantine.
const RIOPLATENSE = pool(
  "rioplatense",
  `Juan Juan_Manuel Juan_Pablo Juan_Cruz Juan_Ignacio Juan_Martín Juan_José Juan_Carlos Juan_Bautista Santiago Matías
   Mateo Nicolás Lucas Lautaro Thiago Tomás Franco Facundo Federico Gonzalo Agustín Ezequiel Emiliano Enzo Alexis
   Alejandro Leandro Leonardo Lisandro Rodrigo Julián Julio Joaquín Ignacio Ramiro Maximiliano Marcos Mauro Nahuel
   Nehuén Valentín Bautista Benjamín Brian Braian Cristian Kevin Walter Sergio Diego Darío Damián Gastón Germán Gabriel
   Guido Hernán Iván Javier Jonathan Jonatan Jorge Lucio Luciano Marcelo Martín Milton Nazareno Pablo Patricio Pedro
   Renzo Ricardo Rubén Sebastián Tobías Valentino Carlos Claudio Esteban Fabricio Fernando Francisco Gerónimo Jerónimo
   Gianluca Giuliano Leonel Lorenzo Luca Máximo Mariano Miguel Nelson Norberto Octavio Óscar Rafael Ramón Roberto
   Rolando Santino Emanuel Elías Axel Alan Ángel Aníbal Ariel Adrián Andrés Augusto Bruno Camilo Ciro Dante Dylan
   Eduardo Enrique Ernesto Fausto Felipe Gustavo Héctor Hugo Ian Joel Mario Mauricio Rodolfo Salvador Silvio Simón
   Tiziano Uriel Vicente Yamil Alfredo Alberto Aldo Fabián Gerardo Horacio Marco Néstor Osvaldo Raúl Víctor Luis
   Jesús José Gianfranco Lucas_Ezequiel Juan_Sebastián Luis_Miguel Marcos_Andrés Kevin_Nahuel`,
  `González Rodríguez Gómez Fernández López Díaz Martínez Pérez García Sánchez Romero Sosa Álvarez Torres Ruiz Ramírez
   Flores Acosta Benítez Medina Suárez Herrera Aguirre Pereyra Gutiérrez Giménez Molina Silva Castro Rojas Ortiz Núñez
   Luna Juárez Cabrera Ríos Ferreyra Godoy Morales Domínguez Moreno Peralta Vega Carrizo Quiroga Castillo Ledesma Muñoz
   Ojeda Ponce Vera Vázquez Villalba Cardozo Navarro Ramos Arias Coronel Córdoba Figueroa Correa Cáceres Vargas
   Maldonado Mansilla Farías Rivero Paz Miranda Roldán Méndez Lucero Cruz Hernández Aguilar Ávila Blanco Bustos Campos
   Chávez Duarte Escobar Franco Gallardo Guzmán Ibáñez Lagos Leiva Maidana Mendoza Montenegro Moyano Olivera Palacios
   Paredes Quintana Rivas Robledo Salazar Salinas Soria Toledo Valdez Zárate Zalazar Bravo Agüero Barrios Bazán Brizuela
   Carabajal Ceballos Frías Galván Lescano Montiel Monzón Nieva Oviedo Pacheco Pizarro Quinteros Sotelo Tapia Villegas
   Ferrari Rossi Russo Bianchi Romano Colombo Ricci Marino Greco Bruno Gallo Conti De_Luca Costa Giordano Mancini Rizzo
   Lombardi Moretti Barbieri Fontana Santoro Mariani Rinaldi Caruso Ferrara Galli Martini Leone Longo Gentile Martinelli
   Vitale Lombardo Serra Coppola De_Santis D'Angelo Marchetti Parisi Villa Conte Ferraro Ferri Fabbri Bianco Marini
   Grasso Valentini Messina Sala Gatti Pellegrini Palumbo Farina Rizzi Monti Cattaneo Morelli Amato Silvestri Mazza
   Testa Grassi Pellegrino Carbone Giuliani Benedetti Barone Caputo Montanari Guerra Palmieri Bernardi Martino Fiore
   De_Rosa Ferretti Bellini Basile Riva Donati Vitali Battaglia Sartori Neri Costantini Milani Pagano Ruggiero D'Amico
   Orlando Negri Spinelli Tagliaferri Pastore Piccolo Barreiro Otero Varela Castelli Lorenzo Iglesias Vidal Rey Pazos
   Echeverría Etcheverry Goñi Urquiza Aramburu Iturbe Larrea Olaechea Zubizarreta Irigoyen Arregui Garmendia Uriarte
   Aguerre Olano Ezcurra Mendizábal Schmidt Müller Weber Wagner Fischer Hoffmann Kovacevic Petrovic Juric Dukic
   Simunovic Haddad Nasif Chaher Yunes Jalil Saadi Kaplan Szpilman Nowak Kowalski`,
);
// Uruguay: Rioplatense base with its own classics (Washington, Darwin) and Canarian, Galician and Basque surnames.
const URUGUAYAN = pool(
  "uruguayan",
  `Washington Darwin Mathías Brahian Cristhian Christian Álvaro Guillermo Obdulio Gustavo Fabián Richard Ronald Wilson
   Nelson Hebert Jorge_Daniel Juan_Ángel Carlos_Andrés Diego_Martín Nicolás_Andrés Santiago_Mathías Maximiliano
   Agustín Facundo Rodrigo Federico Sebastián Emiliano Gastón Joaquín Ignacio Franco Bruno Felipe Luciano Leonardo
   Mauro Matías Santiago Nicolás Martín Gonzalo Diego Pablo Marcelo Juan_Manuel Juan_Ignacio Thiago Bautista Salvador
   Camilo Andrés Ramiro Horacio Walter Sergio`,
  `Techera Píriz De_los_Santos Da_Silva Olivera Viera Cardozo Machado Pereira Silveira Barrios Bentancor Varela Lemos
   Sequeira Vidal Núñez Laborda Larrañaga Echeverría Irigoyen Arrieta Aguerre Etchegoyen Zabaleta Arambarri Lasarte
   Cabrera Morales Moreira Marichal Mendiola Ferreira Correa Suárez Castro Silva Fernández Sosa Pintos Umpiérrez Denis
   Gómez Araújo Brun Carballo Curbelo Duarte Espino Estévez Fleitas Lamas Luzardo Mederos Ocampo Perdomo Ramos Rivero
   Rocha Saravia Sienra Trindade Urruti Vázquez Zubiría Rodríguez González Martínez Pérez García López Méndez Álvarez
   Acosta Nogueira Casavieja Borba Fagúndez Leites Muniz Rosas Tejera`,
);
// Colombia: Spanish, paisa (Antioquian) and Afro-Colombian Pacific/Caribbean surnames; Colombian-style given names.
const COLOMBIAN = pool(
  "colombian",
  `Juan_David Juan_Camilo Juan_Fernando Juan_Sebastián Juan_Esteban Juan_Pablo Juan_Carlos Juan_Manuel Juan_José
   Juan_Guillermo Luis_Fernando Luis_Carlos Luis_Alberto Luis_Miguel Luis_Javier Carlos_Andrés Carlos_Alberto
   Carlos_Mario Jorge_Luis José_Luis Jhon Jhon_Fredy Jhon_Jairo Jhon_Édison Andrés Andrés_Felipe Andrés_Mateo Daniel
   Santiago Sebastián Camilo Mateo Samuel Miguel_Ángel Cristian Brayan Kevin Duván Jáder Wílmar Harold Stiven Estiven
   Yeison Jeison Deiver Neyder Frank Yulián Yairo Johan Johan_Stiven Yerson Yimmi Jarlan Jefferson Óscar Édison Edwin
   Edwar Fredy Freddy Jhonatan Jonathan Jairo Iván Alexis Alexander Anderson Andrey Arley Aldair Álvaro Bernardo César
   Cristhian Dairon Darwin Diego Duvier Éder Eduar Edier Élkin Emerson Esteban Fabián Faber Felipe Fernando Francisco
   Gerson Giovanni Gustavo Héctor Hernán Humberto Jaime Jair Jean_Carlos Jerson Jhojan Jhonier Jorge José Julián Leider
   Leonardo Luis Manuel Marlon Mauricio Nelson Nicolás Omar Orlando Pedro Rafael Ricardo Robinson Rodrigo Rubén Sergio
   Tomás Víctor Wálter Wilson Wílder Yeferson Déiber Elvis Geisson Weimar Yeimar Yeiner Eliser Déyner Steven Kener
   Nilson Teófilo Pablo Álex`,
  `Rodríguez Gómez González Martínez García López Hernández Sánchez Ramírez Pérez Díaz Muñoz Rojas Moreno Jiménez Vargas
   Torres Castro Suárez Ortiz Gutiérrez Ruiz Álvarez Romero Cárdenas Mosquera Palacios Valencia Murillo Rentería Asprilla
   Córdoba Quiñones Caicedo Arboleda Angulo Cuesta Zapata Montaño Mina Lucumí Hinestroza Perea Chará Borja Ibargüen
   Cuero Balanta Riascos Viveros Obregón Aristizábal Osorio Restrepo Uribe Arango Londoño Echeverri Zuluaga Giraldo Duque
   Correa Henao Cardona Ospina Quintero Ramos Salazar Serna Villa Ocampo Betancur Gil Agudelo Marulanda Toro Sepúlveda
   Calle Bedoya Mejía Montoya Posada Vélez Arias Castaño Alzate Hoyos Jaramillo Holguín Patiño Rincón Valoyes Lloreda
   Hurtado Castillo Carabalí Banguero Garcés Mena Herrera Medina Gaviria Hincapié Tabares Loaiza Orozco Quiceno Úsuga
   Arenas Bermúdez Bonilla Cabezas Cortés Cuadrado Delgado Escobar Estrada Fajardo Flórez Franco Galeano Guerrero
   Guevara Leal Lemos Lozano Mendoza Molina Mora Muriel Navarro Niño Ochoa Otálvaro Pabón Pacheco Parra Peña Pineda Prado
   Quiroz Rengifo Reyes Rivas Robledo Rosero Sáenz Sierra Solano Sosa Tovar Trujillo Urrego Vallejo Vásquez Vega
   Velásquez Vidal Villamil Zambrano Ávila Barrera Benítez Blanco Bravo Burbano Cañas Carrillo Chaverra Cuéllar Durán
   Espinosa Fonseca Gallego Granados Guarín Herazo Ibarra Lasso Lerma Machado Maturana Meneses Moncada Montenegro Moya
   Narváez Ordóñez Orjuela Padilla Palomino Pardo Pertuz Polo Puerta Quintana Rosales Salcedo Santamaría Sinisterra
   Tapias Tejada Urbano Valdés Varela Vivas Yepes`,
);
// Venezuela: Spanish-Venezuelan base with Portuguese, Italian and Canarian surnames and characteristic given names.
const VENEZUELAN = pool(
  "venezuelan",
  `Yangel Yeferson Josef Jhonder Wilker Eduard Rómulo Kervin Keiber Yerson Yordan Jesús José Luis Miguel Ángel Carlos
   Juan Rafael Ronald Samuel Andrés Anthony Brayan Cristian David Edson Eric Fernando Gabriel Héctor Jan Jefferson Jorge
   Leonardo Manuel Mikel Oswaldo Pedro Richard Robert Yonathan Adalberto Alejandro Alexander Álex Antonio Arquímedes
   Asdrúbal Darwin Diego Edgar Eliécer Enmanuel Freddy Gustavo Heber Homero Jhon Jhonny Johan Jonás Josué Kelvin Leo
   Luis_Ángel Luis_Manuel José_Manuel Juan_Pablo José_Andrés Marcel Maikel Nelson Néstor Omar Orlando Óscar Reinaldo
   Renny Ricardo Roberto Rolando Ronny Santiago Sergio Tomás Víctor Wílmer Williams Yohan Daniel Jean_Carlos Aníbal`,
  `Rondón Herrera Rincón Aramburu Osorio Villanueva Cádiz Mago Guerra Farías Marín Velásquez Bello Blanco Acosta Figuera
   Lucena Colmenares Brito Chirinos Parra Contreras Silva Gomes Fernandes De_Freitas Rodrigues Da_Silva Ferreira Pestana
   Gouveia Teixeira Sousa Russo Bianchi Ferrari Romano Esposito Colombo Caruso Di_Giacomo Hernández González Rodríguez
   Pérez García Martínez López Díaz Sánchez Ramírez Rivas Mendoza Navarro Moreno Castillo Vargas Suárez Álvarez Romero
   Torres Flores Rojas Medina Escalona Carrasquel Aponte Pacheco Quintero Zambrano Villarroel Salazar Gil Linares Montilla
   Graterol Peña Alvarado Arteaga Briceño Bermúdez Delgado Durán Carrillo Camacho Cordero Correa Chacón Márquez Mora
   Uzcátegui Urdaneta Rangel Sequera Tovar Valera Zerpa Yánez Sojo Lugo Istúriz Guevara Añez Barrios Bastidas Zapata
   Oropeza Ochoa Pineda Querales Ramos Lara Fermín Ledezma Meléndez Mujica Nieves Obando Ortega Pimentel Rivero Sosa
   Terán Villegas`,
);
// Ecuador: Afro-Ecuadorian (Esmeraldas, Chota), coastal mestizo and highland Kichwa surnames.
const ECUADORIAN = pool(
  "ecuadorian",
  `Byron Moisés Piero Jordy Gonzalo Ángel Kevin Anthony Joao Joel Jhon Romario Washington Wellington Segundo Luis Carlos
   Édison Jackson Brayan Darwin Dixon Fidel Gabriel Jordan Juan_Carlos Kenny Marlon Nilson Óscar Renato Richard Robert
   Sebastián Walter Wilson Xavier Alan Alex Alexander Allen Andrés Ángelo Antonio Bryan Cristian Christian Dany Diego
   Eduardo Elvis Erick Felipe Félix Fernando Franklin Freddy Geovanny Giovanny Gustavo Holger Iván Jaime Janner Jean
   Jefferson Jeremy Jhonny John Jonathan Jorge José José_Luis Josué Juan Julio Junior Kléber Leonardo Lucas
   Luis_Fernando Manuel Mario Marco Mauricio Michael Miller Nelson Nicolás Omar Pablo Pedro Ramón Raúl Reinaldo Ricardo
   Roberto Rodrigo Rolando Ronaldo Rubén Samuel Santiago Sergio Steven Ulises Víctor William Wilmer Yordan`,
  `Caicedo Estupiñán Preciado Quiñónez Valencia Arboleda Corozo Angulo Bolaños Cortez Hurtado Mina Méndez Plata Hincapié
   Ayoví Borja Delgado Castillo Cagua Minda Chalá Lara Espinoza Rodríguez Ramírez Paredes Reasco Palacios Nazareno
   Ordóñez Sornoza Mercado Montaño Batioja Tenorio Congo Obando Anangonó Cevallos Ibarra Vera Zambrano Alcívar Mera
   Intriago Vélez Moreira Bravo Loor Macías Cedeño Chávez Guerrero Pinargote Andrade Villacís Játiva Orejuela Quishpe
   Guamán Tipán Chicaiza Morales Mendoza Torres Ortiz Salazar Rivera Suárez Vásquez Castro Cabezas Rosero Medina Pazmiño
   Pozo Montenegro Benítez Burbano Calderón Carrera Cisneros Coronel Cruz Díaz Enríquez Erazo Espín Flores Gavilanes
   Herrera Holguín Jaramillo Jácome León Lozada Maldonado Meza Molina Moncayo Narváez Noboa Ochoa Oña Peñafiel Proaño
   Quintero Recalde Reyes Romero Ruiz Sánchez Segovia Solórzano Tapia Toapanta Ulloa Vaca Valarezo Valdivieso Velasco
   Villacrés Yépez Zurita Arroyo Cuero Mosquera Ayala Cheme Hernández Gómez García López Martínez Pérez González`,
);
// Peru: coastal and Andean mestizo, Afro-Peruvian, Italian-, Chinese- and Japanese-Peruvian surnames.
const PERUVIAN = pool(
  "peruvian",
  `Renato Christian Christofer Luis Carlos Alexander André Aldair Piero Wilder Édison Kevin Oliver Jean Jesús
   Miguel Marcos Roberto Rodrigo Sergio Alex Anderson Bryan Diego Erick Franco Gianluca Joao Jorge José Juan Nilson
   Paolo Raúl Ronaldo Yordy Hernán Iván Walter Wílmer Pedro Martín Gustavo Óscar Jhonny Jair Jersson Adrián Alonso Andy
   Ángel Antony Arón Brian Bruno Ciro Daniel Darío Edgar Eduardo Elías Emilio Esteban Fernando Flavio Gabriel Gonzalo
   Hugo Jaime Jefferson Joel Jonathan Josué Julio Leonardo Luis_Alberto José_Carlos Juan_Carlos Juan_Pablo Manuel Marco
   Mauricio Nelson Nicolás Omar Orlando Paulo Rafael Ramón Ricardo Rubén Santiago Sebastián Tomás Víctor Waldir Horacio
   Aldo Ademar Alfredo Christopher Jhon Kenji`,
  `Flores Sánchez Rodríguez García Rojas Vásquez Ramírez Chávez Torres Mendoza Díaz Castillo Gonzales Pérez Ruiz Cruz
   Espinoza Gutiérrez Ramos Vargas Castro Reyes Salazar Palacios Cueva Advíncula Zambrano Tapia Calle Carrillo Aquino
   Ascues Bazán Benavente Cartagena Cáceres Chumpitaz Corzo Cuba Delgado Dulanto Fernández Grimaldo Hurtado Iberico Lora
   Loyola Montes Morales Olivares Ormeño Peña Polo Quevedo Riveros Rivera Sotil Tello Ugarte Valera Velarde Villamarín
   Zapata Aguirre Alarcón Alva Arakaki Bautista Burga Cabrera Calderón Campos Cárdenas Chang Chiang Cornejo Dávila
   Figueroa Gallardo Herrera Higa Huerta León Lozano Luna Medina Montoya Muñoz Oshiro Paredes Pinto Príncipe Quiroz
   Rengifo Rosales Saavedra Salas Silva Solís Tamashiro Távara Toledo Valdivia Vega Villanueva Wong Yamashiro Zegarra
   Arce Ávila Benites Bocanegra Cano Carrasco Castañeda Cotrina Dextre Egúsquiza Falcón Garay Granda Guevara Ibáñez Jara
   Lévano Linares Llontop Mejía Neyra Ortega Pajuelo Portocarrero Guadalupe Soto Barco Revoredo Bertolotto Bassino
   Rizzo Ferrari Chiappe Balbi`,
);
// Bolivia: highland and lowland (camba) Spanish surnames, some Croatian and Arab-Bolivian families.
const BOLIVIAN = pool(
  "bolivian",
  `Marcelo Carlos Diego Luis Juan_Carlos Ramiro Rodrigo Erwin Henry Leonardo Moisés Boris Danny Jairo Ronald Roberto
   Pablo Miguel Víctor Wálter Álex Bruno Carmelo Cristian Darwin Fernando Gabriel Hugo Jesús José Óscar Ramón Raúl Rudy
   Sebastián Vladimir Jeyson Alan Robson Lucas Enzo Álvaro Adrián Alejandro Andrés Ángel Antonio Armando Benjamín
   Braian Brayan César Daniel David Eduardo Edson Efraín Élder Enrique Ernesto Esteban Federico Franz Freddy Gilbert
   Gonzalo Gustavo Héctor Iván Jaime Javier Jhonny Joel Jorge Josué Julio Leonel Limbert Luis_Fernando Marco Mario
   Martín Mauricio Nelson Omar Orlando Pedro Rafael Renato Ricardo Rubén Samuel Santiago Sergio Teodoro Wilson Wilmer
   Yimmy Ervin Gualberto Jhon Lucio Rolando Ronny`,
  `Gutiérrez Rodríguez Vargas García Fernández López Rojas Pérez Arce Justiniano Suárez Saucedo Chávez Vaca Añez Melgar
   Moreno Montaño Ribera Roca Paz Villarroel Zeballos Terceros Cuéllar Algarañaz Arteaga Banegas Bejarano Camacho
   Castedo Cortez Egüez Haquín Hurtado Jiménez Leigue Limpias Lora Menacho Núñez Parada Peña Rivero Salvatierra Soliz
   Tórrez Ugarte Viscarra Zenteno Mendoza Quiroga Rocha Sandoval Siles Veizaga Cruz Ortiz Aguilar Ávila Flores Sánchez
   Torres Morales Ramírez Salazar Medina Méndez Guzmán Rivera Romero Aguirre Alcócer Aliaga Antelo Arandia Ardaya Barba
   Barrientos Bravo Calvimontes Candia Carrasco Céspedes Coimbra Durán Eguino Escalante Espinoza Fuentes Galarza
   Gonzales Heredia Iriarte Lijerón Loza Lozada Mercado Mojica Montero Mostajo Ortuño Osinaga Pinto Prado Quintana Rea
   Revollo Rueda Sejas Serrano Taborga Urquidi Valverde Vásquez Velasco Vidaurre Zambrana Zurita Marinkovic Kuljis
   Matkovic Yapur Dabdoub Nacif`,
);
// Quechua and Aymara surnames (Peru, Bolivia, highland Ecuador and northern Chile).
const ANDEAN = pool(
  "andean",
  "",
  `Quispe Mamani Condori Huamán Choque Ticona Apaza Huanca Yupanqui Chambi Coaquira Cusi Pari Poma Puma Tito Vilca Villca
   Huarachi Cutipa Machaca Mayta Pomacahua Sullca Taype Ccahuana Huaranga Inca Nina Pacco Paucar Tacuri Yauri Anccasi
   Huillca Colque Alanoca Callisaya Chura Copa Limachi Quisbert Laura Achata Aruquipa Ccori Chalco Challco Chipana
   Choquehuanca Chuquimia Condo Guarachi Huallpa Huaylla Llanque Maquera Marca Pillco Quenta Sirpa Tancara Ticlla Tupa
   Uturunco Yapura Ccopa Huisa Tintaya Quelca`,
);
// Paraguay: Spanish colonial and Guaraní-influenced naming (Ruiz Díaz, Villasanti, Morínigo), some Italian and German.
const PARAGUAYAN = pool(
  "paraguayan",
  `Óscar Derlis Miguel Carlos Julio Richard Blas Celso Gustavo Hernán Aldo Braian Alan Ángel Antonio Arnaldo Cristian
   Cecilio Darío Diego Edgar Ever Fabián Fernando Gastón Gilberto Héctor Iván Jorge José Juan Julio_César Justo Lorenzo
   Lucas Luis Marcelo Marcos Mathías Nelson Néstor Orlando Ramón Robert Roberto Roque Rubén Salvador Santiago Sergio
   Víctor Wilson Rodney Ronaldo Junior Adam Andrés Braulio Crispín Hugo Leonardo Osvaldo Pablo Raúl Teodoro Alejandro
   Alexis Basilio Bruno Claudio Cristhian David Diosnel Enrique Epifanio Estanislao Eusebio Fidencio Florentino
   Francisco Gerardo Guido Ismael Jesús Joel Jonathan Jorge_Luis Juan_Carlos Juan_Manuel Julián Leonel Librado
   Luis_Carlos Marcial Mario Matías Mauricio Miguel_Ángel Nicolás Pedro Rafael Rodrigo Rolando Silvio Tomás Wálter
   Aníbal`,
  `Benítez González Martínez Giménez Jiménez Ortiz Villalba Cáceres Ayala Duarte Franco Báez Riveros Ramírez Rojas
   Sanabria Acosta Aquino Arce Alonso Samudio Cabañas Cardozo Paredes Romero Salcedo Santander Valdez Vera Zárate Almirón
   Alderete Amarilla Balbuena Bareiro Bobadilla Brítez Caballero Candia Colmán Cubas Da_Silva Escobar Espínola Florentín
   Galeano Gamarra Garay Insaurralde Irala Jara Lezcano López Maciel Medina Mendieta Morínigo Ocampo Orué Ovelar Ozuna
   Portillo Quintana Ruiz_Díaz Recalde Ríos Sosa Talavera Torres Vargas Velázquez Villasanti Zaracho Aranda Barrios
   Cantero Coronel Delvalle Enciso Fretes Genes Godoy Invernizzi Leguizamón Mereles Noguera Ojeda Otazú Peralta Rolón
   Sandoval Servín Sotelo Villagra Troche Ibarrola Montiel Figueredo Chamorro Achucarro Arévalo Areco Esquivel
   Fernández Rodríguez Pérez Gómez García Díaz Núñez Aguilera Argüello Benegas Cabrera Centurión Domínguez Estigarribia
   Ferreira Flecha Gaona Ledesma Meza Molinas Oviedo Páez Pereira Ramos Riquelme Rivas Saldívar Segovia Silva Toledo
   Torales Vázquez Vega Zelaya`,
);
// Chile: Spanish and Basque-Castilian surnames plus Mapuche, Croatian, Palestinian and German-Chilean families.
const CHILEAN = pool(
  "chilean",
  `Arturo Claudio Gary Mauricio Eduardo Charles Jean Marcelo Gonzalo Felipe Diego Sebastián Matías Benjamín Vicente
   Joaquín Cristóbal Nicolás Ignacio Francisco Maximiliano Tomás Bastián Byron Esteban Luciano Marcos Paulo Pablo Rodrigo
   Iván Jorge Juan_Pablo Juan_Carlos Juan_Ignacio José_Luis Luis Carlos Fernando Fabián Álvaro Alejandro Andrés Ángelo
   Antonio Bruno Camilo César Christopher Cristián Daniel Darío David Dylan Eric Erick Franco Guillermo Gustavo Héctor
   Hugo Jaime Javier Jonathan Julio Lucas Leonardo Manuel Mario Martín Miguel Óscar Patricio Raúl Ricardo Roberto Rubén
   Sergio Simón Víctor Waldo Yerko Agustín Alonso Amaro Baltazar Clemente Damián Emiliano Gaspar Julián Mateo Renato
   Santiago Thomas Valentín Brayan Kevin Mauro Reinaldo Humberto Nelson Hernán Gerardo Alex Alexis`,
  `González Muñoz Rojas Díaz Pérez Soto Contreras Silva Martínez Sepúlveda Morales Rodríguez López Fuentes Hernández
   Torres Araya Flores Espinoza Valenzuela Castillo Tapia Reyes Gutiérrez Castro Pizarro Álvarez Vásquez Sánchez
   Fernández Ramírez Carrasco Gómez Cortés Herrera Núñez Jara Vergara Rivera Figueroa Riquelme García Miranda Bravo Vera
   Molina Vega Campos Sandoval Orellana Cárdenas Olivares Alarcón Gallardo Ortiz Garrido Salazar Guzmán Henríquez
   Saavedra Navarro Aguilera Parra Romero Aravena Vidal Medel Isla Pinares Fuenzalida Paredes Salas Sierra Valdés Mena
   Maldonado Leiva Ibarra Toro Palma Poblete Cifuentes Orrego Opazo Troncoso Villagra Huenchumilla Catrileo Painemal
   Millapán Cayupán Huaiquil Ñancupil Lincoleo Quilapán Antilef Huenchuleo Llanquileo Vukovic Rakovic Mimica Jaksic
   Zlatar Skoknic Hasbún Abufom Said Chahuán Awad Abumohor Kramer Hermosilla Acevedo Aedo Barraza Becerra Cabello
   Carmona Carvajal Cerda Delgado Donoso Escobar Farías Godoy Gaete Inostroza Lagos Lara Leal Lillo Lobos Mardones Meza
   Montecinos Moya Oyarzún Peña Quezada Retamal Rebolledo Salinas San_Martín Sotomayor Ulloa Urrutia Vargas Venegas
   Yáñez Zúñiga`,
);

// ------------------------------------------------------------------ Brazil

const BR: NationSpec = {
  code: "BR",
  iso2: "BR",
  name: "Brazil",
  confederation: "CONMEBOL",
  continent: "SA",
  capital: "Brasília",
  latitude: -15.8,
  languages: [{ code: "pt", weight: 10 }],
  reputation: { national: 88, league: 77 },
  euEea: false,
  physique: { height: 179 },
  names: {
    given: sources("brazilian=10"),
    family: sources("brazilian=10"),
    secondFamilyRate: 0.2,
    mononymRate: 0.35,
  },
  nationality: {
    // Italian and Portuguese passports by descent are common; since 2023 (EC 131) Brazilians keep their nationality.
    multipleRate: 0.24,
    tripleRate: 0.03,
    bornAbroadRate: 0.02,
    diasporaPull: 0.8,
    links: [
      ...links("lusophone", "PT:10 AO:1 CV:0.5"),
      ...links("mediterranean", "IT:8 ES:3 DE:2"),
      ...links("asianDiaspora", "JP:3 LB:1.5"),
      ...links("americas", "PY:1 AR:1 UY:0.6 US:0.8"),
    ],
    citizenship: allowed,
  },
  cities: {
    // Every state and the Federal District. Ambiguous in cities.json (first match may be another state): Campinas,
    // Campo Grande, Santa Maria, Cascavel, Palmas, Novo Horizonte.
    major: [
      ...cities(
        "São Paulo",
        `São Paulo:mega:5=Mooca|Tatuapé|Penha|Santana|Lapa|Pinheiros|Itaquera|Vila Mariana|Santo Amaro|Butantã|Pirituba,
         Campinas:large, Santos:medium, Ribeirão Preto:medium, Sorocaba:medium, São José dos Campos:medium,
         Santo André:medium, São Bernardo do Campo:medium, Guarulhos:medium, Osasco:medium, São José do Rio Preto:medium,
         Mirassol:small, Bragança Paulista:small, Novo Horizonte, Araraquara:small, Piracicaba:small, Bauru:small,
         Jundiaí:small, Itu:small, Mogi Mirim, Presidente Prudente:small, Marília:small, Franca:small, Limeira:small,
         Americana:small, Rio Claro:small, São Caetano do Sul:small, Barueri:small, Taubaté:small, Votuporanga`,
      ),
      ...cities(
        "Rio de Janeiro",
        `Rio de Janeiro:mega:5=Tijuca|Méier|Jacarepaguá|Irajá|Realengo|Ilha do Governador|Vila Isabel|Grajaú|Barra da Tijuca,
         Niterói:medium, Volta Redonda:small, Campos dos Goytacazes:small, Nova Iguaçu:medium, Duque de Caxias:medium,
         São Gonçalo:medium, Petrópolis:small, Macaé:small, Resende:small, Nova Friburgo:small, Cabo Frio:small`,
      ),
      ...cities(
        "Minas Gerais",
        `Belo Horizonte:large, Uberlândia:medium, Juiz de Fora:medium, Contagem:medium, Betim:small, Montes Claros:small,
         Ipatinga:small, Uberaba:small, Governador Valadares:small, Varginha, Poços de Caldas:small, Sete Lagoas:small,
         Divinópolis:small, Patos de Minas:small, Pouso Alegre:small, São João del Rei, Tombos`,
      ),
      ...cities("Rio Grande do Sul", `Porto Alegre:large, Caxias do Sul:medium, Pelotas:medium, Santa Maria:small,
         Passo Fundo:small, Novo Hamburgo:small, Erechim, Bagé, Santa Cruz do Sul:small, Rio Grande:small, Ijuí`),
      ...cities("Paraná", `Curitiba:large, Londrina:medium, Maringá:medium, Ponta Grossa:medium, Cascavel:small,
         Foz do Iguaçu:small, Paranaguá:small, Apucarana`),
      ...cities("Santa Catarina", `Florianópolis:medium, Joinville:medium, Blumenau:small, Chapecó:small,
         Criciúma:small, Itajaí:small, Brusque:small, Tubarão, Lages:small, Jaraguá do Sul:small`),
      ...cities("Bahia", `Salvador:large, Feira de Santana:medium, Vitória da Conquista:small, Juazeiro:small,
         Ilhéus:small, Itabuna:small`),
      ...cities("Pernambuco", `Recife:large, Jaboatão dos Guararapes:medium, Olinda:small, Caruaru:small,
         Petrolina:small, Camaragibe:small, Serra Talhada`),
      ...cities("Ceará", "Fortaleza:large, Juazeiro do Norte:small, Sobral:small, Crato"),
      ...cities("Goiás", "Goiânia:large, Anápolis:medium, Aparecida de Goiânia:medium, Rio Verde:small, Itumbiara, Catalão"),
      ...cities("Pará", "Belém:large, Ananindeua:medium, Santarém:small, Marabá:small, Castanhal"),
      ...cities("Distrito Federal", "Brasília:large, Gama:small"),
      ...cities("Amazonas", "Manaus:large"),
      ...cities("Alagoas", "Maceió:medium, Arapiraca:small"),
      ...cities("Rio Grande do Norte", "Natal:medium, Mossoró:small"),
      ...cities("Paraíba", "João Pessoa:medium, Campina Grande:small, Sousa, Patos"),
      ...cities("Sergipe", "Aracaju:medium, Lagarto"),
      ...cities("Maranhão", "São Luís:medium, Imperatriz:small"),
      ...cities("Piauí", "Teresina:medium, Parnaíba:small, Picos, Altos"),
      ...cities("Mato Grosso", "Cuiabá:medium, Várzea Grande:small, Rondonópolis:small, Sinop:small"),
      ...cities("Mato Grosso do Sul", "Campo Grande:medium, Dourados:small"),
      ...cities("Espírito Santo", "Vitória:medium, Vila Velha:medium, Serra:small, Cariacica:small, Linhares"),
      ...cities("Tocantins", "Palmas:small, Araguaína:small"),
      ...cities("Rondônia", "Porto Velho:medium"),
      ...cities("Acre", "Rio Branco:small"),
      ...cities("Amapá", "Macapá:small"),
      { name: "Boa Vista", size: "small", region: "Roraima", admin1: "25" },
    ],
  },
  football: {
    leagues: [
      {
        tier: 1,
        name: "Campeonato Brasileiro Série A",
        shortName: "Série A",
        size: 20,
        status: "professional",
        reputation: 77,
        clubs: {
          reputation: { top: 72, bottom: 60 },
          // Flamengo, Palmeiras, Botafogo, Corinthians, São Paulo, Atlético-MG: the richest clubs in South America.
          giants: { count: 6, top: 81, bottom: 74 },
          capacity: { top: 78_000, bottom: 15_000 },
          facilities: { top: 84, bottom: 62 },
          academy: { top: 88, bottom: 66 },
          // Flamengo's 2025 payroll is about R$680m; Mirassol and Juventude spend about R$40–50m.
          wageBill: { top: 95_000_000, bottom: 6_000_000 },
          transferBudget: { top: 45_000_000, bottom: 800_000 },
          foreignShare: 0.22,
          squadSize: [28, 34],
        },
      },
      {
        tier: 2,
        name: "Campeonato Brasileiro Série B",
        shortName: "Série B",
        size: 20,
        status: "professional",
        reputation: 58,
        clubs: {
          reputation: { top: 60, bottom: 49 },
          // Relegated heavyweights (Athletico-PR, Coritiba, Sport-style clubs).
          giants: { count: 2, top: 65, bottom: 62 },
          capacity: { top: 42_000, bottom: 6_000 },
          facilities: { top: 70, bottom: 46 },
          academy: { top: 74, bottom: 50 },
          wageBill: { top: 16_000_000, bottom: 1_400_000 },
          transferBudget: { top: 4_000_000, bottom: 30_000 },
          foreignShare: 0.1,
          squadSize: [27, 33],
        },
      },
      {
        tier: 3,
        // Real format: one round-robin, then two groups of four for the four promotion places.
        name: "Campeonato Brasileiro Série C",
        shortName: "Série C",
        size: 20,
        status: "professional",
        reputation: 45,
        clubs: {
          reputation: { top: 50, bottom: 40 },
          capacity: { top: 30_000, bottom: 3_000 },
          facilities: { top: 52, bottom: 34 },
          academy: { top: 56, bottom: 38 },
          wageBill: { top: 2_600_000, bottom: 350_000 },
          transferBudget: { top: 300_000, bottom: 0 },
          foreignShare: 0.04,
          squadSize: [25, 30],
        },
      },
    ],
    movement: [
      { upper: 1, promoted: 4, relegated: 4 },
      // Série C's second phase (top eight, four promoted) as a two-legged play-off.
      { upper: 2, promoted: 0, relegated: 4, playoffs: [{ type: "promotion", positions: [1, 8], places: 4, legs: 2 }] },
    ],
    cups: [
      // Libertadores clubs join in the round of 16; the winner takes a Libertadores group-stage place.
      { kind: "national", name: "Copa do Brasil", seededEntry: true, legs: 2, finalLegs: 2, continental: true },
      { kind: "super", name: "Supercopa do Brasil", participants: ["champion", "cup-winner"], legs: 1, neutralFinal: true },
    ],
    youth: {
      // Série B and C academies play the state U-20/U-17 championships in reality; merged into one division each.
      U19: {
        divisions: [division("Brasileirão Sub-20", [1, 1], 10, "Grupo A|Grupo B"), division("Estaduais Sub-20", [2, 3], 14)],
        cup: { name: "Copa do Brasil Sub-20" },
      },
      U17: {
        divisions: [division("Brasileirão Sub-17", [1, 1], 10, "Grupo A|Grupo B"), division("Estaduais Sub-17", [2, 3], 14)],
        cup: { name: "Copa do Brasil Sub-17" },
      },
    },
    // Aspirantes and "time B" sides play state competitions only, never the national series.
    reserves: { mode: "none" },
    clubNaming: {
      templates: [
        ...templates(
          `{city} FC:3; EC {city}:2.5; {city} EC:2; SC {city}:1.2; CA {city}:1; AA {city}:1; SE {city}:0.8;
           Grêmio {city}:0.8; Atlético {city}:0.7; América {city}:0.4; União {city}:0.5; AD {city}:0.5`,
        ),
        ...templates("Operário {city}:0.3; Ferroviário {city}:0.3; XV de {city}:0.3; Sport {city}:0.3", [2, 3]),
      ],
      founded: { top: [1895, 1931], bottom: [1905, 2016] },
      colors: ["#000000", "#FFFFFF", "#E30613", "#006437", "#0033A0", "#FFD200", "#7A0019", "#00A859", "#1B3F8B"],
    },
    importSources: weighted(
      `AR:10 UY:8 CO:7 PY:5 EC:4 CL:3 VE:3 PE:2 BO:1 PT:2 ES:1 IT:1 NL:0.6 FR:0.5 AO:0.5 MX:0.3 US:0.3`,
    ),
    coefficients: { association: [18.4, 19.6, 18.9, 20.1, 19.3] },
  },
  abroad: {
    seniors: 160,
    youth: 30,
    destinations: weighted(
      `PT:20 ES:6 IT:7 EN:6 FR:5 DE:4 NL:3 BE:3 TR:4 GR:2 CH:2 UA:2 RU:3 SA:6 AE:3 QA:3 JP:6 KR:3 CN:2 US:5 MX:2`,
    ),
  },
};

// ------------------------------------------------------------------ Argentina

const AR: NationSpec = {
  code: "AR",
  iso2: "AR",
  name: "Argentina",
  confederation: "CONMEBOL",
  continent: "SA",
  capital: "Buenos Aires",
  latitude: -34.6,
  languages: [{ code: "es", weight: 10 }],
  reputation: { national: 92, league: 71 },
  euEea: false,
  physique: { height: 178 },
  names: {
    given: sources("rioplatense=10"),
    family: sources("rioplatense=10 faker:it=0.8"),
    secondFamilyRate: 0.04,
  },
  nationality: {
    // Italian and Spanish passports by descent are widespread; Argentina never withdraws its own nationality.
    multipleRate: 0.32,
    tripleRate: 0.04,
    bornAbroadRate: 0.03,
    diasporaPull: 0.75,
    links: [
      ...links("mediterranean", "IT:10 ES:9"),
      ...links("americas", "PY:5 UY:4 BO:4 CL:2 PE:1 BR:1 US:0.5"),
      ...links("crossBorder", "DE:0.8 PL:0.4"),
      ...links("yugoslav", "HR:0.6"),
      ...links("arabWorld", "LB:0.8 SY:0.5"),
    ],
    citizenship: allowed,
  },
  cities: {
    // Ambiguous in cities.json (first match is another province): Avellaneda (Santa Fe), Maipú (Buenos Aires).
    major: [
      ...cities(
        "Ciudad de Buenos Aires",
        `Buenos Aires:mega:10=Núñez|Boedo|Parque Patricios|La Paternal|Flores|Villa Crespo|Floresta|Caballito|Mataderos|
         Palermo|Villa Urquiza|Saavedra|Villa Devoto|Villa Lugano|Pompeya|Balvanera|Villa del Parque|Recoleta|Constitución`,
      ),
      ...cities(
        "Buenos Aires",
        `Avellaneda:medium:3=Sarandí|Dock Sud|Gerli, Lanús:medium, Lomas de Zamora:medium:3=Llavallol|Turdera|Villa Centenario,
         Quilmes:medium, La Plata:large:3=City Bell|Los Hornos|Tolosa|Villa Elisa, Mar del Plata:large, Bahía Blanca:medium,
         Morón:medium=Castelar|Haedo, Tigre:medium, San Isidro:medium, Olivos:small, Merlo:medium, Moreno:medium,
         José C. Paz:small, San Justo:medium, Isidro Casanova:small, Caseros:small, Ezeiza:small, Adrogué:small,
         Berazategui:small, Pilar:small, Belén de Escobar:small, Zárate:small, Campana:small, Luján:small, Junín:small,
         Pergamino:small, San Nicolás de los Arroyos:small, Tandil:small, Olavarría:small, Azul, Necochea, Chivilcoy,
         Carlos Casares, San Carlos de Bolívar, Trenque Lauquen, Chascomús, Tres Arroyos`,
      ),
      // Missing from cities.json.
      { name: "Florencio Varela", size: "medium", region: "Buenos Aires", lat: -34.81, lng: -58.28 },
      ...cities(
        "Córdoba",
        `Córdoba:large:4=Alta Córdoba|Barrio Jardín|Alberdi|General Paz|Nueva Córdoba, Río Cuarto:medium, Villa María:small,
         San Francisco:small, Villa Carlos Paz:small, Alta Gracia`,
      ),
      ...cities(
        "Santa Fe",
        `Rosario:large:4=Arroyito|Fisherton|Echesortu|Parque Independencia, Santa Fe:medium:3, Rafaela:small,
         Venado Tuerto:small, Reconquista:small, Esperanza, Villa Constitución, Casilda`,
      ),
      ...cities("Mendoza", "Mendoza:large:2, Godoy Cruz:medium, Maipú:small, San Rafael:small, Luján de Cuyo"),
      ...cities("Tucumán", "San Miguel de Tucumán:large:3, Yerba Buena:small"),
      ...cities("Salta", "Salta:medium:3, San Ramón de la Nueva Orán:small, Tartagal"),
      ...cities("Jujuy", "San Salvador de Jujuy:medium, Palpalá"),
      ...cities("Santiago del Estero", "Santiago del Estero:medium:3, La Banda:small"),
      ...cities("Chaco", "Resistencia:medium, Presidencia Roque Sáenz Peña:small"),
      ...cities("Corrientes", "Corrientes:medium, Goya:small"),
      ...cities("Misiones", "Posadas:medium, Oberá:small, Eldorado"),
      ...cities("Entre Ríos", "Paraná:medium, Concordia:small, Gualeguaychú:small, Concepción del Uruguay:small"),
      ...cities("Formosa", "Formosa:small"),
      ...cities("San Juan", "San Juan:medium"),
      ...cities("San Luis", "San Luis:small"),
      ...cities("La Rioja", "La Rioja:small"),
      ...cities("Catamarca", "Catamarca:small"),
      ...cities("La Pampa", "General Pico:small"),
      ...cities("Neuquén", "Neuquén:medium"),
      ...cities("Río Negro", "Cipolletti:small, General Roca:small, San Carlos de Bariloche:small, Viedma"),
      ...cities("Chubut", "Comodoro Rivadavia:small, Puerto Madryn:small, Trelew:small"),
      ...cities("Santa Cruz", "Río Gallegos:small, Caleta Olivia"),
      ...cities("Tierra del Fuego", "Ushuaia:small, Río Grande"),
    ],
  },
  football: {
    leagues: [
      {
        tier: 1,
        // Real 2025: Apertura and Clausura, each two zones of 15 plus a knockout. One season here (decision 10):
        // two round-robins inside each zone, then the top eight per zone play off for the title.
        name: "Liga Profesional de Fútbol",
        shortName: "Liga Profesional",
        size: 30,
        status: "professional",
        reputation: 71,
        conferences: ["Zona A", "Zona B"],
        championship: { positions: [1, 8], perConference: true, legs: 1, finalLegs: 1, neutralFinal: true },
        clubs: {
          reputation: { top: 70, bottom: 56 },
          // River Plate and Boca Juniors.
          giants: { count: 2, top: 80, bottom: 78 },
          capacity: { top: 85_000, bottom: 3_500 },
          facilities: { top: 80, bottom: 52 },
          academy: { top: 88, bottom: 62 },
          wageBill: { top: 50_000_000, bottom: 2_000_000 },
          transferBudget: { top: 15_000_000, bottom: 150_000 },
          foreignShare: 0.12,
          squadSize: [28, 34],
        },
      },
      {
        tier: 2,
        // Two zones of 18, two round-robins inside each zone (34 matchdays, as in 2025).
        name: "Primera Nacional",
        shortName: "Primera Nacional",
        size: 36,
        status: "professional",
        reputation: 50,
        conferences: ["Zona A", "Zona B"],
        // The zone winners play a one-off final at a neutral venue for the title and the first promotion place.
        championship: { positions: [1, 1], perConference: true, legs: 1, neutralFinal: true },
        clubs: {
          reputation: { top: 56, bottom: 42 },
          // Colón, San Martín de Tucumán-sized clubs.
          giants: { count: 2, top: 60, bottom: 57 },
          capacity: { top: 40_000, bottom: 2_500 },
          facilities: { top: 56, bottom: 32 },
          academy: { top: 66, bottom: 40 },
          wageBill: { top: 3_000_000, bottom: 500_000 },
          transferBudget: { top: 400_000, bottom: 0 },
          foreignShare: 0.05,
          squadSize: [26, 32],
        },
      },
    ],
    movement: [
      // Real: the zone winners meet in a final for the first place; the loser joins places 2–8 of each zone in the
      // 15-team "Reducido" for the second. Modeled as the final winner plus a play-off of the next 15 overall.
      {
        upper: 1,
        promoted: 1,
        relegated: 2,
        championPromoted: true,
        playoffs: [{ type: "promotion", positions: [2, 16], places: 1, legs: 1, finalLegs: 2 }],
      },
    ],
    cups: [
      // 64 clubs: all Liga Profesional clubs plus the best lower-division clubs; single matches at neutral venues.
      { kind: "national", name: "Copa Argentina", maxEntrants: 64, legs: 1, neutralFinal: true, continental: true },
      { kind: "super", name: "Supercopa Argentina", participants: ["champion", "cup-winner"], legs: 1, neutralFinal: true },
    ],
    youth: {
      // AFA juveniles: Cuarta División (U-20) and Sexta División (U-17) for top-flight academies.
      U19: {
        divisions: [
          division("Cuarta División", [1, 1], 15, "Zona A|Zona B"),
          division("Primera Nacional Sub-20", [2, 2], 12),
        ],
      },
      U17: {
        divisions: [
          division("Sexta División", [1, 1], 15, "Zona A|Zona B"),
          division("Primera Nacional Sub-17", [2, 2], 12),
        ],
      },
    },
    // Torneo de Reserva: every Liga Profesional club's reserve side (U-21 plus a few overage players).
    reserves: {
      mode: "reserve-league",
      nameTemplate: "{club} Reserva",
      eligibility: { parentTiers: [1], minReputation: 1, maxTeams: 30 },
      reserveLeague: {
        name: "Torneo de Reserva",
        shortName: "Reserva",
        roundRobins: 2,
        conferences: ["Zona A", "Zona B"],
        reputation: 36,
      },
      ageRule: { maxAge: 21, overage: 3 },
      squad: [22, 30],
    },
    clubNaming: {
      templates: [
        ...templates(
          `Club Atlético {city}:3; Deportivo {city}:1.5; Club Social y Deportivo {city}:1.2; Sportivo {city}:1;
           Atlético {city}:1; Independiente de {city}:0.8; Estudiantes de {city}:0.6; Unión de {city}:0.6;
           Racing de {city}:0.5; Talleres de {city}:0.5; Gimnasia y Esgrima de {city}:0.5; Defensores de {city}:0.5;
           Argentino de {city}:0.5; Central {city}:0.3`,
        ),
        ...templates(
          `Sarmiento de {city}:0.3; San Martín de {city}:0.3; Huracán de {city}:0.3; Tiro Federal de {city}:0.2;
           Juventud Unida de {city}:0.2; Club Sportivo {city}:0.3`,
          [2],
        ),
      ],
      founded: { top: [1887, 1935], bottom: [1890, 2012] },
      colors: ["#6CACE4", "#FFFFFF", "#003087", "#FFD100", "#D50032", "#000000", "#006847", "#7B2C3B", "#F47B20"],
    },
    importSources: weighted("PY:9 UY:8 CO:7 CL:5 EC:3 VE:3 BO:2 PE:2 BR:2 MX:0.5 ES:0.5 IT:0.5 US:0.3"),
    coefficients: { association: [14.1, 13.8, 14.6, 13.2, 14.0] },
  },
  abroad: {
    seniors: 140,
    youth: 30,
    destinations: weighted(
      `ES:10 IT:10 PT:5 FR:3 EN:4 DE:2 BE:2 NL:1 GR:4 TR:3 CY:2 CH:1 MX:10 US:8 BR:6 CL:4 EC:2 PY:2 UY:2 CO:1 SA:2`,
    ),
  },
};

// ------------------------------------------------------------------ Uruguay

const UY: NationSpec = {
  code: "UY",
  iso2: "UY",
  name: "Uruguay",
  confederation: "CONMEBOL",
  continent: "SA",
  capital: "Montevideo",
  latitude: -34.9,
  languages: [{ code: "es", weight: 10 }],
  reputation: { national: 82, league: 57 },
  euEea: false,
  physique: { height: 180 },
  names: {
    given: sources("rioplatense=5 uruguayan=5"),
    family: sources("rioplatense=5 uruguayan=5"),
    secondFamilyRate: 0.05,
  },
  nationality: {
    // Spanish and Italian passports by descent; Uruguayan nationality cannot be lost.
    multipleRate: 0.28,
    tripleRate: 0.03,
    bornAbroadRate: 0.02,
    diasporaPull: 0.75,
    links: [...links("mediterranean", "ES:7 IT:6"), ...links("americas", "AR:10 BR:6 PY:0.5 US:0.5")],
    citizenship: allowed,
  },
  cities: {
    major: [
      ...cities(
        "Montevideo",
        `Montevideo:mega:12=Pocitos|La Teja|Malvín|Carrasco|Prado|Sayago|Maroñas|Punta Carretas|Belvedere|Capurro|Cordón|
         Piedras Blancas|La Blanqueada|Tres Cruces|Jacinto Vera|Nuevo París|Casabó|Punta Gorda|Parque Batlle|Brazo Oriental`,
      ),
      ...cities("Canelones", "Las Piedras:small, Canelones:small, Pando:small, Santa Lucía"),
      ...cities("Maldonado", "Maldonado:small, San Carlos, Punta del Este"),
      ...cities("Colonia", "Colonia del Sacramento:small, Nueva Helvecia, Carmelo"),
      ...cities("Salto", "Salto:small"),
      ...cities("Paysandú", "Paysandú:small"),
      ...cities("Rivera", "Rivera:small"),
      ...cities("Tacuarembó", "Tacuarembó:small"),
      ...cities("Soriano", "Mercedes:small, Dolores"),
      ...cities("Cerro Largo", "Melo:small"),
      ...cities("San José", "San José de Mayo:small"),
      ...cities("Lavalleja", "Minas:small"),
      ...cities("Artigas", "Artigas:small"),
      ...cities("Durazno", "Durazno"),
      ...cities("Florida", "Florida"),
      ...cities("Rocha", "Rocha"),
      ...cities("Treinta y Tres", "Treinta y Tres"),
      ...cities("Río Negro", "Fray Bentos, Young"),
      ...cities("Flores", "Trinidad"),
    ],
  },
  football: {
    leagues: [
      {
        tier: 1,
        // Real 2025: Apertura, Intermedio and Clausura plus the annual table. One season here: two round-robins, the
        // Intermedio as the league cup, and the real title play-off (semi-final, then a final against the leader).
        name: "Liga AUF Uruguaya",
        shortName: "Primera División",
        size: 16,
        status: "professional",
        reputation: 57,
        championship: { positions: [1, 3], legs: 1, finalLegs: 2 },
        clubs: {
          reputation: { top: 60, bottom: 48 },
          // Peñarol and Nacional.
          giants: { count: 2, top: 70, bottom: 68 },
          capacity: { top: 40_000, bottom: 2_500 },
          facilities: { top: 70, bottom: 38 },
          academy: { top: 84, bottom: 58 },
          wageBill: { top: 12_000_000, bottom: 700_000 },
          transferBudget: { top: 3_000_000, bottom: 20_000 },
          foreignShare: 0.12,
          squadSize: [26, 32],
        },
      },
      {
        tier: 2,
        name: "Segunda División Profesional",
        shortName: "Segunda División",
        size: 14,
        status: "professional",
        reputation: 38,
        clubs: {
          reputation: { top: 46, bottom: 36 },
          capacity: { top: 12_000, bottom: 1_500 },
          facilities: { top: 42, bottom: 26 },
          academy: { top: 62, bottom: 42 },
          wageBill: { top: 700_000, bottom: 150_000 },
          transferBudget: { top: 50_000, bottom: 0 },
          foreignShare: 0.05,
          squadSize: [25, 30],
        },
      },
    ],
    movement: [
      // Three relegated (the real rule uses a two-season average); champion and runner-up up, 3rd–6th play off.
      {
        upper: 1,
        promoted: 2,
        relegated: 3,
        playoffs: [{ type: "promotion", positions: [3, 6], places: 1, legs: 2 }],
      },
    ],
    cups: [
      { kind: "national", name: "Copa AUF Uruguay", shortName: "Copa AUF", legs: 1 },
      { kind: "league", name: "Torneo Intermedio", shortName: "Intermedio", tiers: [1], legs: 1 },
      { kind: "super", name: "Supercopa Uruguaya", participants: ["champion", "league-cup-winner"], legs: 1, neutralFinal: true },
    ],
    youth: {
      U19: { divisions: [division("Formativas Sub-19 A", [1, 1], 16), division("Formativas Sub-19 B", [2, 2], 14)] },
      U17: { divisions: [division("Formativas Sub-17 A", [1, 1], 16), division("Formativas Sub-17 B", [2, 2], 14)] },
    },
    // The Tercera División (reserves) is not modeled.
    reserves: { mode: "none" },
    clubNaming: {
      templates: templates(
        `Club Atlético {city}:3; {city} FC:1.5; Deportivo {city}:1.2; Club Sportivo {city}:0.8;
         Club Social y Deportivo {city}:0.8; Central {city}:0.3; Racing Club de {city}:0.3; {city} Wanderers:0.3;
         {city} Juniors:0.3; Club Oriental de {city}:0.3; Unión de {city}:0.3`,
      ),
      founded: { top: [1891, 2007], bottom: [1900, 2015] },
      colors: ["#6CACE4", "#FFFFFF", "#FFD100", "#000000", "#D50032", "#003087", "#7A0019", "#006847"],
    },
    importSources: weighted("AR:10 CO:4 PY:4 BR:3 VE:2 CL:1 EC:1 PE:1 BO:0.5 US:0.3"),
    coefficients: { association: [7.9, 8.6, 7.2, 8.9, 8.1] },
  },
  abroad: {
    seniors: 110,
    youth: 20,
    destinations: weighted("AR:12 BR:8 ES:8 IT:7 MX:6 US:4 PT:3 EN:2 FR:1 GR:1 TR:1 SA:1 CL:3 PY:2 EC:2 CO:1"),
  },
};

// ------------------------------------------------------------------ Colombia

const CO: NationSpec = {
  code: "CO",
  iso2: "CO",
  name: "Colombia",
  confederation: "CONMEBOL",
  continent: "SA",
  capital: "Bogotá",
  latitude: 4.7,
  languages: [{ code: "es", weight: 10 }],
  reputation: { national: 81, league: 58 },
  euEea: false,
  physique: { height: 177 },
  names: { given: sources("colombian=10"), family: sources("colombian=10"), secondFamilyRate: 0.15 },
  nationality: {
    // Dual nationality allowed since the 1991 Constitution; Spanish and US passports are the common second ones.
    multipleRate: 0.22,
    tripleRate: 0.02,
    bornAbroadRate: 0.03,
    diasporaPull: 0.7,
    links: [...links("americas", "VE:10 EC:6 US:4 PA:1 PE:1"), ...links("mediterranean", "ES:6 IT:1")],
    citizenship: allowed,
  },
  cities: {
    major: [
      ...cities("Distrito Capital", "Bogotá:mega:6=Chapinero|Suba|Usaquén|Kennedy|Engativá|Fontibón|Teusaquillo|Bosa"),
      ...cities("Antioquia", "Medellín:large, Bello:medium, Envigado:small, Itagüí:small, Rionegro:small, Apartadó:small"),
      ...cities("Valle del Cauca", "Cali:large, Palmira:small, Tuluá:small, Buenaventura:small, Cartago:small"),
      ...cities("Atlántico", "Barranquilla:large, Soledad:medium"),
      ...cities("Bolívar", "Cartagena:large"),
      ...cities("Santander", "Bucaramanga:medium, Floridablanca:small, Piedecuesta:small, Barrancabermeja:small"),
      ...cities("Cundinamarca", "Soacha:medium, Zipaquirá:small, Fusagasugá:small, Chía:small"),
      ...cities("Risaralda", "Pereira:medium"),
      ...cities("Caldas", "Manizales:medium"),
      ...cities("Tolima", "Ibagué:medium"),
      ...cities("Magdalena", "Santa Marta:medium"),
      ...cities("Boyacá", "Tunja:small, Sogamoso:small, Duitama:small"),
      ...cities("Nariño", "Pasto:medium"),
      ...cities("Huila", "Neiva:medium"),
      ...cities("Norte de Santander", "Cúcuta:medium"),
      ...cities("Córdoba", "Montería:medium"),
      ...cities("Meta", "Villavicencio:medium"),
      ...cities("Cesar", "Valledupar:medium"),
      { name: "Armenia", size: "medium", region: "Quindío", admin1: "23" },
      ...cities("Cauca", "Popayán:small"),
      ...cities("Sucre", "Sincelejo:small"),
      ...cities("La Guajira", "Riohacha:small"),
      ...cities("Chocó", "Quibdó:small"),
      ...cities("Casanare", "Yopal:small"),
    ],
  },
  football: {
    leagues: [
      {
        tier: 1,
        // Real 2025: Apertura and Finalización (19 rounds, two groups of four, two-legged final) and a promedio
        // relegation table. One season here: two round-robins, then the top eight play off for the title.
        name: "Categoría Primera A",
        shortName: "Primera A",
        size: 20,
        status: "professional",
        reputation: 58,
        championship: { positions: [1, 8], legs: 2, finalLegs: 2 },
        clubs: {
          reputation: { top: 60, bottom: 47 },
          // Atlético Nacional, Millonarios, América de Cali, Junior.
          giants: { count: 4, top: 68, bottom: 64 },
          capacity: { top: 46_000, bottom: 5_000 },
          facilities: { top: 72, bottom: 42 },
          academy: { top: 80, bottom: 55 },
          wageBill: { top: 15_000_000, bottom: 900_000 },
          transferBudget: { top: 3_000_000, bottom: 20_000 },
          foreignShare: 0.08,
          squadSize: [26, 32],
        },
      },
      {
        tier: 2,
        // Real 2025: two tournaments of 15 rounds with semi-final groups and an annual final.
        name: "Categoría Primera B",
        shortName: "Primera B",
        size: 16,
        status: "professional",
        reputation: 42,
        clubs: {
          reputation: { top: 48, bottom: 38 },
          capacity: { top: 40_000, bottom: 2_000 },
          facilities: { top: 46, bottom: 28 },
          academy: { top: 60, bottom: 40 },
          wageBill: { top: 900_000, bottom: 200_000 },
          transferBudget: { top: 60_000, bottom: 0 },
          foreignShare: 0.03,
          squadSize: [25, 30],
        },
      },
    ],
    movement: [
      {
        upper: 1,
        promoted: 1,
        relegated: 2,
        playoffs: [{ type: "promotion", positions: [2, 9], places: 1, legs: 2 }],
      },
    ],
    cups: [
      // Primera A and B clubs; Libertadores/Sudamericana entrants join late. The winner takes a Libertadores place.
      { kind: "national", name: "Copa Colombia", seededEntry: true, legs: 2, finalLegs: 2, continental: true },
      // Real: the two league champions of the year; one season here, so champion v title-final runner-up.
      { kind: "super", name: "Superliga de Colombia", shortName: "Superliga", participants: ["champion", "runner-up"], legs: 2 },
    ],
    youth: {
      U19: { divisions: [division("Torneo Nacional Sub-20", [1, 2], 12)] },
      U17: { divisions: [division("Torneo Nacional Sub-17", [1, 2], 12)] },
    },
    reserves: { mode: "none" },
    clubNaming: {
      templates: templates(
        `Deportivo {city}:2; Atlético {city}:2; {city} FC:1.5; Club Deportivo {city}:1; Real {city}:1;
         Independiente {city}:0.8; Unión {city}:0.8; Alianza {city}:0.4; Internacional de {city}:0.3; Leones de {city}:0.3`,
      ),
      regional: [
        {
          regions: list(
            `Antioquia Tolima Huila Quindío Caldas Boyacá Santander Cesar Meta Magdalena Córdoba Nariño Cauca Sucre Chocó
             Casanare Cundinamarca Risaralda Atlántico Bolívar`,
          ),
          templates: templates("Deportes {region}:0.5; Atlético {region}:0.4; Unión {region}:0.3; Real {region}:0.3; Once {region}:0.15"),
        },
      ],
      founded: { top: [1912, 2012], bottom: [1950, 2019] },
      colors: ["#009A44", "#FFFFFF", "#003DA5", "#D50032", "#FFD100", "#000000", "#E35205", "#7A0019"],
    },
    importSources: weighted("VE:6 AR:5 UY:3 EC:3 PY:2 PA:2 BR:1 PE:1 CL:1 BO:0.5 HN:0.5 CR:0.5"),
    coefficients: { association: [9.1, 8.4, 9.0, 8.8, 9.3] },
  },
  abroad: {
    seniors: 120,
    youth: 20,
    destinations: weighted(
      `MX:10 AR:8 US:8 BR:6 ES:4 PT:4 IT:3 EN:2 FR:2 BE:2 NL:1 TR:2 GR:1 CH:1 CL:4 EC:4 PE:2 PY:2 UY:2 BO:1 VE:1 SA:2 QA:1`,
    ),
  },
};

// ------------------------------------------------------------------ Venezuela

const VE: NationSpec = {
  code: "VE",
  iso2: "VE",
  name: "Venezuela",
  confederation: "CONMEBOL",
  continent: "SA",
  capital: "Caracas",
  latitude: 10.5,
  languages: [{ code: "es", weight: 10 }],
  reputation: { national: 66, league: 43 },
  euEea: false,
  physique: { height: 177 },
  names: {
    given: sources("venezuelan=7 colombian=3"),
    family: sources("venezuelan=7 colombian=3"),
    secondFamilyRate: 0.1,
  },
  nationality: {
    // Spanish, Italian and Portuguese descent (Canarian, Madeiran and Italian post-war migration); dual allowed.
    multipleRate: 0.25,
    tripleRate: 0.03,
    bornAbroadRate: 0.04,
    diasporaPull: 0.6,
    links: [
      ...links("americas", "CO:10 US:2 CL:1 PE:1 AR:0.5 EC:0.5"),
      ...links("mediterranean", "ES:7 IT:5"),
      ...links("lusophone", "PT:5"),
      ...links("arabWorld", "LB:1 SY:1"),
    ],
    citizenship: allowed,
  },
  cities: {
    major: [
      ...cities(
        "Distrito Capital",
        "Caracas:mega:4=Chacao|El Hatillo|Baruta|La Candelaria|Catia|El Valle|Antímano|El Paraíso|Caricuao|Altamira",
      ),
      ...cities("Zulia", "Maracaibo:large, Cabimas:small"),
      ...cities("Carabobo", "Valencia:large, Puerto Cabello:small"),
      ...cities("Lara", "Barquisimeto:large"),
      ...cities("Aragua", "Maracay:large"),
      ...cities("Bolívar", "Ciudad Guayana:large, Ciudad Bolívar:medium"),
      ...cities("Anzoátegui", "Barcelona:medium, Puerto La Cruz:medium"),
      ...cities("Monagas", "Maturín:medium"),
      ...cities("Mérida", "Mérida:medium, El Vigía:small"),
      ...cities("Táchira", "San Cristóbal:medium"),
      ...cities("Sucre", "Cumaná:medium, Carúpano:small"),
      ...cities("Barinas", "Barinas:medium"),
      ...cities("Portuguesa", "Guanare:small, Acarigua:small"),
      ...cities("Miranda", "Los Teques:small, Guarenas:small"),
      ...cities("Falcón", "Coro:small, Punto Fijo:small"),
      ...cities("Yaracuy", "San Felipe:small"),
      ...cities("Trujillo", "Valera:small, Trujillo"),
      ...cities("Apure", "San Fernando de Apure:small"),
      ...cities("Guárico", "San Juan de los Morros:small"),
      ...cities("La Guaira", "La Guaira:small"),
      ...cities("Nueva Esparta", "Porlamar:small"),
      ...cities("Delta Amacuro", "Tucupita"),
      ...cities("Amazonas", "Puerto Ayacucho"),
    ],
  },
  football: {
    leagues: [
      {
        tier: 1,
        // Real 2025: Apertura and Clausura (13 rounds each, play-off groups, final). One season: two round-robins,
        // then the top eight play off for the title.
        name: "Liga FUTVE",
        shortName: "Liga FUTVE",
        size: 14,
        status: "professional",
        reputation: 43,
        championship: { positions: [1, 8], legs: 2, finalLegs: 2 },
        clubs: {
          reputation: { top: 48, bottom: 38 },
          // Deportivo Táchira and Caracas FC.
          giants: { count: 2, top: 52, bottom: 50 },
          capacity: { top: 38_000, bottom: 3_000 },
          facilities: { top: 50, bottom: 28 },
          academy: { top: 64, bottom: 40 },
          wageBill: { top: 2_500_000, bottom: 300_000 },
          transferBudget: { top: 200_000, bottom: 0 },
          foreignShare: 0.1,
          squadSize: [25, 30],
        },
      },
    ],
    movement: [],
    // No national cup: the Copa Venezuela has not been held regularly since 2019.
    cups: [],
    youth: {
      U19: { divisions: [division("Liga FUTVE Junior", [1, 1], 14)] },
      U17: { divisions: [division("Torneo Nacional Sub-17", [1, 1], 14)] },
    },
    reserves: { mode: "none" },
    clubNaming: {
      templates: templates(
        `Deportivo {city}:2; {city} FC:2; Atlético {city}:1; Club Deportivo {city}:0.6; Unión {city}:0.6;
         Estudiantes de {city}:0.4; Academia {city}:0.4; Inter de {city}:0.4; Real {city}:0.4; Llaneros de {city}:0.2;
         Mineros de {city}:0.2`,
      ),
      founded: { top: [1950, 2021], bottom: [1950, 2021] },
      colors: ["#7A0019", "#FFD100", "#000000", "#FFFFFF", "#D50032", "#003DA5", "#009A44"],
    },
    importSources: weighted("CO:10 AR:4 UY:2 BR:2 PE:1 EC:1 PA:1 CR:0.5 CL:0.5"),
    coefficients: { association: [2.7, 2.9, 3.0, 3.2, 2.9] },
  },
  abroad: {
    seniors: 90,
    youth: 15,
    destinations: weighted("US:8 CO:6 ES:6 AR:5 CL:4 MX:4 EC:3 PE:3 PT:3 BO:2 PY:2 BR:2 IT:2 GR:1 CY:1 TR:1 UY:1 CR:1 PA:1"),
  },
};

// ------------------------------------------------------------------ Ecuador

const EC: NationSpec = {
  code: "EC",
  iso2: "EC",
  name: "Ecuador",
  confederation: "CONMEBOL",
  continent: "SA",
  capital: "Quito",
  latitude: -0.2,
  languages: [
    { code: "es", weight: 10 },
    { code: "qu", weight: 0.3 },
  ],
  reputation: { national: 77, league: 58 },
  euEea: false,
  physique: { height: 176 },
  names: { given: sources("ecuadorian=10"), family: sources("ecuadorian=10"), secondFamilyRate: 0.12 },
  nationality: {
    // Dual nationality allowed (2008 Constitution); Spanish and Italian passports from the 2000s emigration.
    multipleRate: 0.22,
    tripleRate: 0.02,
    bornAbroadRate: 0.04,
    diasporaPull: 0.6,
    links: [...links("mediterranean", "ES:8 IT:3"), ...links("americas", "CO:8 PE:6 US:4 VE:1 AR:0.5")],
    citizenship: allowed,
  },
  cities: {
    major: [
      ...cities("Guayas", "Guayaquil:large:4, Milagro:small"),
      // Missing from cities.json.
      { name: "Durán", size: "medium", region: "Guayas", lat: -2.17, lng: -79.83 },
      ...cities("Pichincha", "Quito:large:5=Conocoto|Chillogallo|Carcelén|La Magdalena|Calderón|Tumbaco, Sangolquí:small"),
      ...cities("Azuay", "Cuenca:medium, Gualaceo"),
      ...cities("Tungurahua", "Ambato:medium:3"),
      ...cities("Manabí", "Manta:medium, Portoviejo:medium, Chone:small"),
      ...cities("El Oro", "Machala:medium"),
      ...cities("Loja", "Loja:small"),
      ...cities("Chimborazo", "Riobamba:small"),
      ...cities("Imbabura", "Ibarra:small, Otavalo"),
      ...cities("Esmeraldas", "Esmeraldas:small"),
      ...cities("Cotopaxi", "Latacunga:small"),
      ...cities("Santo Domingo de los Tsáchilas", "Santo Domingo de los Colorados:small"),
      ...cities("Los Ríos", "Quevedo:small, Babahoyo:small"),
      ...cities("Santa Elena", "Salinas, La Libertad"),
      ...cities("Carchi", "Tulcán"),
      ...cities("Cañar", "Azogues"),
    ],
  },
  football: {
    leagues: [
      {
        tier: 1,
        // Real 2025: a 30-round first stage, then the top six play a final hexagonal; the rest play on for
        // continental places and survival.
        name: "LigaPro Serie A",
        shortName: "Serie A",
        size: 16,
        status: "professional",
        reputation: 58,
        split: {
          groups: [
            { name: "Hexagonal final", positions: [1, 6], roundRobins: 2, points: "full" },
            { name: "Fase de permanencia", positions: [7, 16], roundRobins: 1, points: "full" },
          ],
        },
        clubs: {
          reputation: { top: 58, bottom: 46 },
          // LDU Quito, Independiente del Valle, Barcelona, Emelec.
          giants: { count: 4, top: 68, bottom: 63 },
          capacity: { top: 57_000, bottom: 5_000 },
          facilities: { top: 80, bottom: 40 },
          academy: { top: 86, bottom: 50 },
          wageBill: { top: 12_000_000, bottom: 800_000 },
          transferBudget: { top: 3_000_000, bottom: 20_000 },
          foreignShare: 0.12,
          squadSize: [26, 32],
        },
      },
      {
        tier: 2,
        name: "LigaPro Serie B",
        shortName: "Serie B",
        size: 10,
        status: "professional",
        reputation: 40,
        roundRobins: 4,
        clubs: {
          reputation: { top: 46, bottom: 36 },
          capacity: { top: 20_000, bottom: 3_000 },
          facilities: { top: 44, bottom: 28 },
          academy: { top: 58, bottom: 40 },
          wageBill: { top: 900_000, bottom: 200_000 },
          transferBudget: { top: 50_000, bottom: 0 },
          foreignShare: 0.05,
          squadSize: [25, 30],
        },
      },
    ],
    movement: [{ upper: 1, promoted: 2, relegated: 2 }],
    cups: [
      { kind: "national", name: "Copa Ecuador", legs: 2, finalLegs: 1, neutralFinal: true, continental: true },
      { kind: "super", name: "Supercopa Ecuador", participants: ["champion", "cup-winner"], legs: 1, neutralFinal: true },
    ],
    youth: {
      U19: { divisions: [division("Formativas Sub-19", [1, 2], 13)] },
      U17: { divisions: [division("Formativas Sub-17", [1, 2], 13)] },
    },
    reserves: { mode: "none" },
    clubNaming: {
      templates: templates(
        `Club Deportivo {city}:2; {city} SC:1.2; {city} FC:1.2; Deportivo {city}:1.2; Liga Deportiva {city}:1;
         Sociedad Deportiva {city}:1; Club Social y Deportivo {city}:0.6; Centro Deportivo {city}:0.5; Atlético {city}:0.5;
         Independiente {city}:0.4; Juventud {city}:0.3; Club Sport {city}:0.3`,
      ),
      founded: { top: [1925, 2017], bottom: [1925, 2020] },
      colors: ["#FFD100", "#003DA5", "#D50032", "#FFFFFF", "#000000", "#009A44", "#7A0019"],
    },
    importSources: weighted("AR:6 CO:6 UY:4 PY:3 VE:2 BR:2 PE:1 CL:1 US:0.5 PA:0.5"),
    coefficients: { association: [10.2, 11.6, 11.0, 10.4, 10.9] },
  },
  abroad: {
    seniors: 70,
    youth: 15,
    destinations: weighted("US:6 MX:6 BR:4 AR:4 ES:3 EN:2 PT:2 IT:1 BE:1 NL:1 DE:1 RU:1 SA:1 QA:1 CO:2 PE:2 CL:1 PY:1 UY:1"),
  },
};

// ------------------------------------------------------------------ Peru

const PE: NationSpec = {
  code: "PE",
  iso2: "PE",
  name: "Peru",
  confederation: "CONMEBOL",
  continent: "SA",
  capital: "Lima",
  latitude: -12.0,
  languages: [
    { code: "es", weight: 10 },
    { code: "qu", weight: 1 },
    { code: "ay", weight: 0.2 },
  ],
  reputation: { national: 68, league: 50 },
  euEea: false,
  physique: { height: 174 },
  names: { given: sources("peruvian=10"), family: sources("peruvian=7 andean=3"), secondFamilyRate: 0.12 },
  nationality: {
    // Dual nationality allowed; Italian-, Japanese- and Spanish-descended families and a large diaspora.
    multipleRate: 0.2,
    tripleRate: 0.02,
    bornAbroadRate: 0.03,
    diasporaPull: 0.55,
    links: [
      ...links("mediterranean", "ES:8 IT:3"),
      ...links("americas", "AR:5 EC:5 BO:5 CL:4 US:4 VE:1 CO:1"),
      ...links("asianDiaspora", "JP:3 CN:2"),
    ],
    citizenship: allowed,
  },
  cities: {
    // Cusco resolves to San Martín in cities.json (first match), not the Cusco region.
    major: [
      ...cities(
        "Lima",
        `Lima:mega:6=Miraflores|Surco|La Victoria|Rímac|San Martín de Porres|Comas|Villa El Salvador|San Juan de Lurigancho|
         Ate|Chorrillos|Barranco|Pueblo Libre|Jesús María|Breña|Los Olivos, Huaral:small`,
      ),
      ...cities("Callao", "Callao:medium"),
      ...cities("Arequipa", "Arequipa:large"),
      ...cities("La Libertad", "Trujillo:large"),
      ...cities("Lambayeque", "Chiclayo:medium"),
      ...cities("Piura", "Piura:medium, Sullana:small, Talara:small"),
      { name: "Cusco", size: "medium", region: "Cusco", admin1: "08" },
      ...cities("Junín", "Huancayo:medium, Tarma:small"),
      ...cities("Loreto", "Iquitos:medium"),
      ...cities("Puno", "Juliaca:medium, Puno:small"),
      ...cities("Tacna", "Tacna:small"),
      ...cities("Cajamarca", "Cajamarca:small, Jaén:small, Cutervo"),
      ...cities("Áncash", "Chimbote:medium, Huaraz:small"),
      ...cities("Ica", "Ica:small, Chincha Alta:small"),
      ...cities("Ucayali", "Pucallpa:small"),
      ...cities("Huánuco", "Huánuco:small"),
      ...cities("Ayacucho", "Ayacucho:small"),
      ...cities("San Martín", "Tarapoto:small, Moyobamba"),
      ...cities("Tumbes", "Tumbes:small"),
      ...cities("Apurímac", "Andahuaylas, Abancay"),
      ...cities("Madre de Dios", "Puerto Maldonado"),
      ...cities("Moquegua", "Moquegua"),
      ...cities("Pasco", "Cerro de Pasco"),
    ],
  },
  football: {
    leagues: [
      {
        tier: 1,
        // Real 2025: Apertura and Clausura (17 rounds each) and a title final between their winners. One season: two
        // round-robins, then a two-legged final between the top two.
        name: "Liga 1",
        shortName: "Liga 1",
        size: 18,
        status: "professional",
        reputation: 50,
        championship: { positions: [1, 2], legs: 2, finalLegs: 2 },
        clubs: {
          reputation: { top: 54, bottom: 42 },
          // Universitario, Alianza Lima, Sporting Cristal.
          giants: { count: 3, top: 62, bottom: 58 },
          capacity: { top: 80_000, bottom: 5_000 },
          facilities: { top: 62, bottom: 34 },
          academy: { top: 72, bottom: 42 },
          wageBill: { top: 9_000_000, bottom: 500_000 },
          transferBudget: { top: 1_500_000, bottom: 0 },
          foreignShare: 0.15,
          squadSize: [25, 32],
        },
      },
    ],
    movement: [],
    // No national cup: Peru has had none since the 2021 Copa Bicentenario.
    cups: [],
    youth: {
      U19: { divisions: [division("Torneo de Promoción y Reserva", [1, 1], 9)] },
      U17: { divisions: [division("Copa Generación Sub-17", [1, 1], 9)] },
    },
    reserves: { mode: "none" },
    clubNaming: {
      templates: templates(
        `Sport {city}:1.5; Deportivo {city}:1.5; Atlético {city}:1.2; {city} FC:1.2; Unión {city}:1;
         Club Deportivo {city}:0.8; Alianza {city}:0.6; Asociación Deportiva {city}:0.6; Juventud {city}:0.5;
         Cultural {city}:0.5; Academia Deportiva {city}:0.4; Sporting {city}:0.4; Defensor {city}:0.4`,
      ),
      founded: { top: [1901, 2012], bottom: [1901, 2012] },
      colors: ["#D50032", "#FFFFFF", "#002D72", "#6CACE4", "#FFD100", "#000000", "#009A44"],
    },
    importSources: weighted("AR:10 UY:5 CO:5 VE:3 PY:2 EC:2 BR:1 CL:1 BO:1 PA:0.5 US:0.3 ES:0.3"),
    coefficients: { association: [4.2, 3.8, 3.4, 3.9, 3.5] },
  },
  abroad: {
    seniors: 40,
    youth: 8,
    destinations: weighted("US:5 MX:4 AR:3 CL:3 BR:2 IT:2 ES:2 EC:2 BO:2 PT:1 NL:1 CO:1 PY:1 GR:1 TR:1"),
  },
};

// ------------------------------------------------------------------ Bolivia

const BO: NationSpec = {
  code: "BO",
  iso2: "BO",
  name: "Bolivia",
  confederation: "CONMEBOL",
  continent: "SA",
  // Constitutional capital; the seat of government is La Paz.
  capital: "Sucre",
  latitude: -16.5,
  languages: [
    { code: "es", weight: 10 },
    { code: "qu", weight: 1.5 },
    { code: "ay", weight: 1 },
  ],
  reputation: { national: 58, league: 44 },
  euEea: false,
  physique: { height: 173 },
  names: { given: sources("bolivian=10"), family: sources("bolivian=6 andean=4"), secondFamilyRate: 0.15 },
  nationality: {
    // Dual nationality allowed (2009 Constitution); large diaspora in Argentina, Spain and Brazil.
    multipleRate: 0.2,
    tripleRate: 0.01,
    bornAbroadRate: 0.04,
    diasporaPull: 0.5,
    links: [
      ...links("americas", "AR:9 PE:5 CL:4 BR:3 PY:2 US:1"),
      ...links("mediterranean", "ES:5 IT:1"),
      ...links("yugoslav", "HR:0.5"),
    ],
    citizenship: allowed,
  },
  cities: {
    major: [
      ...cities("La Paz", "La Paz:large:4=Miraflores|Sopocachi|Obrajes|Achumani"),
      // Missing from cities.json.
      { name: "El Alto", size: "large", region: "La Paz", lat: -16.5, lng: -68.19 },
      ...cities(
        "Santa Cruz",
        "Santa Cruz de la Sierra:large:4, Montero:small, Warnes:small, Camiri, Puerto Suárez, San Ignacio de Velasco",
      ),
      ...cities("Cochabamba", "Cochabamba:large, Quillacollo:small, Sacaba:small, Vinto, Punata"),
      ...cities("Chuquisaca", "Sucre:medium"),
      ...cities("Oruro", "Oruro:medium, Llallagua"),
      ...cities("Tarija", "Tarija:medium, Yacuiba:small, Villamontes"),
      ...cities("Potosí", "Potosí:medium, Villazón, Tupiza"),
      ...cities("Beni", "Trinidad:small, Riberalta:small, Guayaramerín"),
      ...cities("Pando", "Cobija:small"),
    ],
  },
  football: {
    leagues: [
      {
        tier: 1,
        name: "División Profesional",
        shortName: "División Profesional",
        size: 16,
        status: "professional",
        reputation: 44,
        clubs: {
          reputation: { top: 48, bottom: 37 },
          // Bolívar and The Strongest.
          giants: { count: 2, top: 56, bottom: 53 },
          capacity: { top: 42_000, bottom: 3_000 },
          facilities: { top: 56, bottom: 28 },
          academy: { top: 62, bottom: 36 },
          wageBill: { top: 5_000_000, bottom: 250_000 },
          transferBudget: { top: 600_000, bottom: 0 },
          foreignShare: 0.15,
          squadSize: [25, 30],
        },
      },
    ],
    movement: [],
    // No national cup: Bolivia has no regular one.
    cups: [],
    youth: {
      U19: { divisions: [division("Campeonato Nacional Sub-20", [1, 1], 16)] },
      U17: { divisions: [division("Campeonato Nacional Sub-17", [1, 1], 16)] },
    },
    reserves: { mode: "none" },
    clubNaming: {
      templates: templates(
        `Club Deportivo {city}:2; Club Atlético {city}:1.5; Real {city}:1.5; {city} FC:1; Deportivo {city}:1;
         Universitario de {city}:0.6; Independiente {city}:0.6; Nacional {city}:0.5; Unión {city}:0.6; Atlético {city}:0.6;
         Club Social y Deportivo {city}:0.4`,
      ),
      founded: { top: [1908, 2019], bottom: [1908, 2019] },
      colors: ["#009A44", "#FFD100", "#D50032", "#003DA5", "#6CACE4", "#000000", "#FFFFFF"],
    },
    importSources: weighted("AR:8 CO:4 BR:4 UY:3 PY:3 VE:2 PE:2 EC:1 CL:1 ES:0.5"),
    coefficients: { association: [3.6, 3.1, 3.3, 2.8, 3.0] },
  },
  abroad: {
    seniors: 25,
    youth: 5,
    destinations: weighted("AR:4 BR:3 CL:2 US:2 ES:2 PE:1 PY:1 PT:1 MX:1 PL:0.5"),
  },
};

// ------------------------------------------------------------------ Paraguay

const PY: NationSpec = {
  code: "PY",
  iso2: "PY",
  name: "Paraguay",
  confederation: "CONMEBOL",
  continent: "SA",
  capital: "Asunción",
  latitude: -25.3,
  languages: [
    { code: "es", weight: 6 },
    { code: "gn", weight: 5 },
  ],
  reputation: { national: 74, league: 55 },
  euEea: false,
  physique: { height: 178 },
  names: { given: sources("paraguayan=10"), family: sources("paraguayan=10"), secondFamilyRate: 0.08 },
  nationality: {
    // Natural-born Paraguayans keep their nationality; many players are Argentine-born or hold Spanish passports.
    multipleRate: 0.22,
    tripleRate: 0.02,
    bornAbroadRate: 0.06,
    diasporaPull: 0.6,
    links: [
      ...links("americas", "AR:10 BR:6 UY:1 BO:0.5 US:0.5"),
      ...links("mediterranean", "ES:6 IT:3"),
      ...links("crossBorder", "DE:0.5"),
    ],
    citizenship: allowed,
  },
  cities: {
    // Luque (Sportivo Luqueño, General Díaz) is missing from cities.json and carries coordinates.
    major: [
      ...cities(
        "Asunción",
        "Asunción:large:5=Sajonia|Barrio Obrero|Villa Morra|San Vicente|Las Mercedes|Pinozá|Loma Pytã|Zeballos Cué",
      ),
      { name: "Luque", size: "medium", region: "Central", lat: -25.27, lng: -57.49 },
      ...cities(
        "Central",
        `San Lorenzo:medium, Lambaré:medium, Fernando de la Mora:medium, Capiatá:medium, Limpio:small, Ñemby:small,
         Mariano Roque Alonso:small, Itauguá:small, Villa Elisa:small, Itá:small, Areguá`,
      ),
      ...cities("Alto Paraná", "Ciudad del Este:large, Presidente Franco:small"),
      ...cities("Itapúa", "Encarnación:medium"),
      ...cities("Caaguazú", "Caaguazú:small, Coronel Oviedo:small"),
      ...cities("Guairá", "Villarrica:small"),
      ...cities("Ñeembucú", "Pilar:small"),
      ...cities("Amambay", "Pedro Juan Caballero:small"),
      ...cities("Concepción", "Concepción:small"),
      ...cities("Cordillera", "Caacupé:small"),
      ...cities("Paraguarí", "Carapeguá"),
    ],
  },
  football: {
    leagues: [
      {
        tier: 1,
        // Real 2025: Apertura and Clausura of 22 rounds each; four round-robins keep the 44-match season.
        name: "División de Honor",
        shortName: "Primera División",
        size: 12,
        status: "professional",
        reputation: 55,
        roundRobins: 4,
        clubs: {
          reputation: { top: 56, bottom: 45 },
          // Olimpia, Cerro Porteño, Libertad.
          giants: { count: 3, top: 66, bottom: 62 },
          capacity: { top: 45_000, bottom: 4_000 },
          facilities: { top: 70, bottom: 36 },
          academy: { top: 80, bottom: 50 },
          wageBill: { top: 12_000_000, bottom: 600_000 },
          transferBudget: { top: 3_000_000, bottom: 10_000 },
          foreignShare: 0.12,
          squadSize: [26, 32],
        },
      },
    ],
    movement: [],
    cups: [
      { kind: "national", name: "Copa Paraguay", legs: 1, continental: true },
      { kind: "super", name: "Supercopa Paraguay", participants: ["champion", "cup-winner"], legs: 1, neutralFinal: true },
    ],
    youth: {
      U19: { divisions: [division("Formativas Sub-19", [1, 1], 12)] },
      U17: { divisions: [division("Formativas Sub-17", [1, 1], 12)] },
    },
    // The APF Torneo de Reserva is not modeled.
    reserves: { mode: "none" },
    clubNaming: {
      templates: templates(
        `Club Sportivo {city}:2; Club Atlético {city}:1.5; Deportivo {city}:1.5; {city} FC:1; Club Deportivo {city}:1;
         Club {city}:0.8; Sportivo {city}:0.8; Unión {city}:0.5; Independiente {city}:0.4`,
      ),
      founded: { top: [1902, 2020], bottom: [1902, 2020] },
      colors: ["#D50032", "#FFFFFF", "#003DA5", "#000000", "#FFD100", "#009A44", "#6CACE4"],
    },
    importSources: weighted("AR:10 UY:4 BR:4 CO:3 VE:2 BO:1 PE:1 CL:1 EC:1"),
    coefficients: { association: [8.3, 7.4, 7.8, 7.0, 7.6] },
  },
  abroad: {
    seniors: 110,
    youth: 20,
    destinations: weighted(
      "AR:14 BR:8 MX:6 US:5 CL:4 ES:4 EC:3 BO:3 UY:3 PE:2 IT:2 PT:2 CO:1 EN:1 FR:1 BE:1 TR:1 GR:1 SA:1",
    ),
  },
};

// ------------------------------------------------------------------ Chile

const CL: NationSpec = {
  code: "CL",
  iso2: "CL",
  name: "Chile",
  confederation: "CONMEBOL",
  continent: "SA",
  capital: "Santiago",
  latitude: -33.4,
  languages: [{ code: "es", weight: 10 }],
  reputation: { national: 70, league: 54 },
  euEea: false,
  physique: { height: 176 },
  names: { given: sources("chilean=10"), family: sources("chilean=9.5 andean=0.5"), secondFamilyRate: 0.12 },
  nationality: {
    // Dual nationality allowed since 2005; Spanish, Italian, Croatian and Palestinian descent, exile-born diaspora.
    multipleRate: 0.22,
    tripleRate: 0.02,
    bornAbroadRate: 0.03,
    diasporaPull: 0.6,
    links: [
      ...links("americas", "AR:7 PE:6 BO:3 VE:2 US:1 CO:1 EC:0.5"),
      ...links("mediterranean", "ES:6 IT:2"),
      ...links("yugoslav", "HR:3"),
      ...links("arabWorld", "PS:1.5 LB:0.5"),
      ...links("crossBorder", "DE:1.5"),
    ],
    citizenship: allowed,
  },
  cities: {
    major: [
      ...cities(
        "Región Metropolitana",
        `Santiago:mega:6=Ñuñoa|La Florida|Las Condes|Providencia|Pudahuel|Quilicura|Renca|Peñalolén|Vitacura|La Reina|
         Cerrillos|Conchalí|El Bosque|Quinta Normal|Huechuraba|Estación Central|Lo Prado, Puente Alto:medium,
         Maipú:medium, San Bernardo:small, Melipilla:small`,
      ),
      ...cities(
        "Valparaíso",
        `Valparaíso:medium, Viña del Mar:medium, Quillota:small, San Antonio:small, La Calera:small, San Felipe:small,
         Los Andes:small, Villa Alemana:small, Limache`,
      ),
      ...cities("Biobío", "Concepción:large, Talcahuano:small, Los Ángeles:small, Lota"),
      ...cities("Ñuble", "Chillán:small"),
      ...cities("Coquimbo", "La Serena:medium, Coquimbo:medium, Ovalle:small"),
      ...cities("Antofagasta", "Antofagasta:medium, Calama:small"),
      ...cities("Araucanía", "Temuco:medium"),
      ...cities("O'Higgins", "Rancagua:medium, Rengo"),
      ...cities("Maule", "Talca:medium, Curicó:small, Linares:small"),
      ...cities("Tarapacá", "Iquique:small"),
      ...cities("Arica y Parinacota", "Arica:small"),
      ...cities("Los Lagos", "Puerto Montt:small, Osorno:small, Castro"),
      ...cities("Atacama", "Copiapó:small, Vallenar"),
      ...cities("Los Ríos", "Valdivia:small"),
      ...cities("Magallanes", "Punta Arenas:small"),
      ...cities("Aysén", "Coyhaique"),
    ],
  },
  football: {
    leagues: [
      {
        tier: 1,
        // A single 30-round tournament since 2018, as in 2025.
        name: "Liga de Primera",
        shortName: "Primera División",
        size: 16,
        status: "professional",
        reputation: 54,
        clubs: {
          reputation: { top: 55, bottom: 44 },
          // Colo-Colo, Universidad de Chile, Universidad Católica.
          giants: { count: 3, top: 64, bottom: 60 },
          capacity: { top: 47_000, bottom: 4_000 },
          facilities: { top: 72, bottom: 40 },
          academy: { top: 76, bottom: 48 },
          wageBill: { top: 15_000_000, bottom: 1_200_000 },
          transferBudget: { top: 3_000_000, bottom: 20_000 },
          foreignShare: 0.18,
          squadSize: [26, 32],
        },
      },
    ],
    movement: [],
    cups: [
      { kind: "national", name: "Copa Chile", seededEntry: true, legs: 2, finalLegs: 1, neutralFinal: true, continental: true },
      { kind: "super", name: "Supercopa de Chile", participants: ["champion", "cup-winner"], legs: 1, neutralFinal: true },
    ],
    youth: {
      U19: { divisions: [division("Fútbol Joven Sub-18", [1, 1], 16)] },
      U17: { divisions: [division("Fútbol Joven Sub-16", [1, 1], 16)] },
    },
    reserves: { mode: "none" },
    clubNaming: {
      templates: templates(
        `Deportes {city}:3; Club Deportivo {city}:1.5; {city} Unido:1; Unión {city}:1; Club Social y Deportivo {city}:0.6;
         Provincial {city}:0.5; Deportivo {city}:0.5; Municipal {city}:0.4; Atlético {city}:0.4; {city} FC:0.4`,
      ),
      founded: { top: [1892, 2012], bottom: [1892, 2012] },
      colors: ["#D50032", "#FFFFFF", "#003DA5", "#000000", "#FFD100", "#009A44", "#6CACE4", "#7A0019"],
    },
    importSources: weighted("AR:12 UY:4 CO:4 VE:3 PY:3 BR:1 PE:1 EC:1 BO:0.5 ES:0.5"),
    coefficients: { association: [6.4, 6.0, 5.6, 5.9, 5.4] },
  },
  abroad: {
    seniors: 60,
    youth: 10,
    destinations: weighted("MX:6 AR:5 US:4 ES:4 BR:3 IT:2 PT:2 EC:2 PE:2 BO:1 PY:1 CO:1 GR:1 CY:1 SA:1 NL:0.5 BE:0.5 TR:0.5"),
  },
};

/** Real clubs the templates could reproduce ("|"-separated; matching ignores FC/SC/AC affixes and diacritics). */
const real = (text: string) =>
  text
    .split("|")
    .map((entry) => entry.trim())
    .filter(Boolean);
const REAL_CLUB_NAMES: Readonly<Record<string, readonly string[]>> = {
  BR: real(
    `Flamengo|Fluminense|Botafogo|Vasco da Gama|Palmeiras|Corinthians|São Paulo|Santos|Grêmio|Internacional|
     Atlético Mineiro|Cruzeiro|América Mineiro|Bahia|EC Bahia|Vitória|EC Vitória|Sport Recife|Náutico|Santa Cruz|Ceará|
     Fortaleza|Fortaleza EC|Athletico Paranaense|Coritiba|Paraná Clube|Goiás|Atlético Goianiense|Vila Nova|Chapecoense|
     Avaí|Figueirense|Criciúma|Criciúma EC|Joinville|Joinville EC|Juventude|Caxias|Red Bull Bragantino|Bragantino|
     Mirassol|Novorizontino|Grêmio Novorizontino|Ponte Preta|Guarani|Ituano|Botafogo-SP|Ferroviária|Portuguesa|Juventus|
     Remo|Paysandu|Tuna Luso|CRB|CSA|ABC|América de Natal|América Natal|Botafogo-PB|Treze|Campinense|Confiança|Sergipe|
     Itabaiana|Sampaio Corrêa|Moto Club|River|Altos|Cuiabá|Cuiabá EC|Mixto|Operário Ferroviário|Operário Ponta Grossa|
     Operário Várzea Grande|Operário Campo Grande|Londrina|Londrina EC|Maringá|Grêmio Maringá|Cascavel|Foz do Iguaçu|
     Brusque|Marcílio Dias|Metropolitano|CA Tubarão|Tombense|Athletic Club|Uberlândia|Uberlândia EC|Uberaba|Ipatinga|
     Betim|Pouso Alegre|Caldense|Villa Nova|Tupi|Democrata|Anápolis|Grêmio Anápolis|Goiânia|Goiânia EC|Aparecidense|
     Itumbiara|Itumbiara EC|Rio Verde|EC Rio Verde|Sinop|Dourados|Luverdense|Volta Redonda|Resende|Nova Iguaçu|
     Duque de Caxias|Macaé|Madureira|Bangu|Americano|Goytacaz|São Gonçalo|São Gonçalo EC|Boavista|Serra|Linhares|
     Desportiva Ferroviária|Rio Branco|Porto Velho|Porto Velho EC|Palmas|Araguaína|Boa Vista|Santana|Santana EC|Ypiranga|
     EC Pelotas|Pelotas|Brasil de Pelotas|EC Passo Fundo|Passo Fundo|EC Novo Hamburgo|Novo Hamburgo|São José|Rio Grande|
     Grêmio Porto Alegre|Grêmio Barueri|Grêmio Osasco|Grêmio Bagé|Grêmio Prudente|Presidente Prudente|Marília|Mogi Mirim|
     Mogi Mirim EC|Rio Claro|Taubaté|EC Taubaté|Santo André|EC Santo André|São Caetano|AD São Caetano|São Bernardo|
     AD Guarulhos|Osasco|Rio Preto|XV de Piracicaba|Atlético Sorocaba|CA Sorocaba|São Bento|Comercial|Noroeste|Paulista|
     Oeste|Ferroviário Fortaleza|Floresta|Icasa|Guarany de Sobral|Juazeirense|Jacuipense|Retrô|Sousa|Nacional|Amazonas|
     Manaus|Gama|SE Gama|Brasiliense|Capital|União Rondonópolis|América Belo Horizonte|América Rio de Janeiro|
     América Recife|Atlético Acreano|Galvez|Trem|EC Pinheiros|Pinheiros|Campo Grande|Sport Belém|Recife`,
  ),
  AR: real(
    `Boca Juniors|River Plate|Racing Club|Independiente|San Lorenzo|Huracán|Vélez Sarsfield|Argentinos Juniors|Lanús|
     Club Atlético Lanús|Banfield|Platense|Tigre|Club Atlético Tigre|Barracas Central|Deportivo Riestra|
     Defensa y Justicia|Estudiantes de La Plata|Gimnasia y Esgrima de La Plata|Sarmiento de Junín|Aldosivi|
     Newell's Old Boys|Rosario Central|Talleres de Córdoba|Belgrano|Club Atlético Belgrano|Instituto|Unión de Santa Fe|
     Colón|Godoy Cruz|Independiente Rivadavia|San Martín de San Juan|Central Córdoba|Atlético Tucumán|
     San Martín de Tucumán|Gimnasia y Esgrima de Mendoza|Quilmes|Chacarita Juniors|Ferro Carril Oeste|Almirante Brown|
     Atlanta|All Boys|Estudiantes de Buenos Aires|Estudiantes de Caseros|Deportivo Morón|Nueva Chicago|Temperley|
     Los Andes|San Telmo|Tristán Suárez|Deportivo Madryn|Chaco For Ever|Güemes|Mitre|Agropecuario|Alvarado|
     Racing de Córdoba|Talleres de Remedios de Escalada|Defensores de Belgrano|Deportivo Maipú|Gimnasia y Tiro|
     Central Norte|Colegiales|Patronato|Almagro|San Miguel|Arsenal de Sarandí|Arsenal|Ciudad de Bolívar|Midland|
     Atlético Rafaela|Club Atlético Rafaela|Brown de Adrogué|Club Atlético Brown|Olimpo|Villa Mitre|Deportivo Merlo|
     Argentino de Merlo|Argentino de Rosario|Argentino de Quilmes|Villa Dálmine|Defensores Unidos|Douglas Haig|
     Santamarina|Independiente de Tandil|Racing de Olavarría|Racing de Trelew|Estudiantes de Río Cuarto|
     Estudiantes de San Luis|Juventud Unida Universitario|Juventud Unida de Gualeguaychú|Gimnasia y Esgrima de Jujuy|
     Gimnasia y Esgrima de Concepción del Uruguay|Gimnasia y Esgrima de Chivilcoy|Gimnasia y Esgrima de Buenos Aires|
     Independiente de Neuquén|Independiente de Chivilcoy|Independiente de Avellaneda|Unión de Mar del Plata|
     Sarmiento de Resistencia|San Martín de Mendoza|San Martín de Formosa|Huracán de Tres Arroyos|
     Huracán de Comodoro Rivadavia|Huracán de Corrientes|Tiro Federal de Bahía Blanca|Tiro Federal de Rosario|
     Atlético Paraná|Club Atlético Paraná|Club Atlético San Isidro|Deportivo Roca|Cipolletti|Club Cipolletti|
     Boca Unidos|Crucero del Norte|Guaraní Antonio Franco|Sportivo Desamparados|Juventud Antoniana|Sportivo Belgrano|
     Sportivo Barracas|Deportivo Español|Deportivo Laferrere|Real Pilar|Club Luján|Racing Club de Avellaneda|
     Sportivo Las Parejas|Comisión de Actividades Infantiles|Club Social y Deportivo Madryn|Racing de Avellaneda|
     Estudiantes de Paraná|Estudiantes de Bahía Blanca|Juventud Unida de San Luis|Club Atlético Quilmes|
     Gimnasia y Esgrima de Rosario|Gimnasia y Esgrima de Comodoro Rivadavia|Argentino de Mendoza|Sarmiento de La Banda`,
  ),
  UY: real(
    `Peñarol|Nacional|Club Nacional de Football|Defensor Sporting|Danubio|Liverpool|Montevideo Wanderers|
     Racing Club de Montevideo|River Plate|Club Atlético River Plate|Cerro|Club Atlético Cerro|Progreso|
     Club Atlético Progreso|Fénix|Club Atlético Fénix|Boston River|Juventud|Juventud de Las Piedras|Plaza Colonia|
     Deportivo Maldonado|Cerro Largo|Montevideo City Torque|Miramar Misiones|Rampla Juniors|Rentistas|
     Club Atlético Rentistas|Cerrito|Club Sportivo Cerrito|Villa Española|Central Español|Club Oriental de La Paz|
     Tacuarembó|Rocha|Salto|Paysandú|Durazno|Uruguay Montevideo|Sud América|Bella Vista|Albion|Colón|Huracán Buceo|
     Basáñez|Canadian|Club Atlético Atenas|Deportivo Colonia|La Luz|Villa Teresa|Potencia|Club Atlético Pocitos|
     Club Atlético Malvín|Malvín|Club Atlético Maldonado|Frontera Rivera|Deportivo Montevideo|Club Atlético Montevideo`,
  ),
  CO: real(
    `Atlético Nacional|Nacional|Millonarios|Independiente Santa Fe|Santa Fe|América de Cali|Deportivo Cali|Junior|
     Atlético Junior|Independiente Medellín|Deportivo Independiente Medellín|Medellín|Once Caldas|Deportes Tolima|
     Tolima|Deportivo Pereira|Deportivo Pasto|Atlético Bucaramanga|Atlético Huila|Huila|Envigado|Itagüí|
     Águilas Doradas|Deportivo Rionegro|Rionegro Águilas|Alianza Petrolera|Alianza Valledupar|Alianza|Boyacá Chicó|
     Patriotas Boyacá|Jaguares de Córdoba|La Equidad|Internacional de Bogotá|Internacional de Palmira|Fortaleza CEIF|
     Llaneros|Unión Magdalena|Deportes Quindío|Quindío|Cúcuta Deportivo|Cúcuta|Real Cartagena|Real Santander|
     Real Cundinamarca|Real San Andrés|Barranquilla|Bogotá|Valledupar|Tigres|Leones|Leones de Itagüí|Cortuluá|
     Deportivo Tuluá|Orsomarso|Atlético Fútbol Club|Boca Juniors de Cali|Universitario Popayán|Deportes Palmira|
     Club Deportivo Cali|Atlético Nacional de Medellín|Deportivo Bogotá|Atlético Cali`,
  ),
  VE: real(
    `Caracas|Deportivo Táchira|Deportivo La Guaira|Deportivo Lara|Deportivo Anzoátegui|Portuguesa|Carabobo|Monagas|
     Zulia|Aragua|Estudiantes de Mérida|Academia Puerto Cabello|Llaneros de Guanare|Mineros de Guayana|
     Atlético El Vigía|Inter de Barinas|Real Frontera|Deportivo Rayo Zuliano|Rayo Zuliano|Hermanos Colmenárez|Angostura|
     Metropolitanos|Universidad Central|Trujillanos|Atlético Venezuela|Zamora|Deportivo Petare|Real Esppor|
     Anzoátegui|Unión Atlético Maracaibo|Unión Maracaibo|Titanes|Yaracuyanos|Lala|Deportivo Maracaibo|Mérida|
     Estudiantes de Caracas|Deportivo Valencia|Valencia|Atlético Maracaibo|Unión Lara|Deportivo Barinas|Barinas|
     Mineros de Ciudad Guayana`,
  ),
  EC: real(
    `La Libertad|Barcelona|Barcelona Sporting Club|Emelec|Club Sport Emelec|Liga Deportiva Universitaria|LDU Quito|Liga de Quito|
     Liga Deportiva Quito|Liga Deportiva Loja|Liga de Loja|Liga Deportiva Portoviejo|Liga de Portoviejo|
     Liga Deportiva Cuenca|Independiente del Valle|Aucas|Sociedad Deportiva Aucas|Sociedad Deportiva Quito|
     Deportivo Quito|Deportivo Cuenca|Club Deportivo Cuenca|Deportivo Azogues|El Nacional|Universidad Católica|
     Macará|Técnico Universitario|Mushuc Runa|Delfín|Orense|Manta|Guayaquil City|Guayaquil|Cumbayá|Libertad|
     Imbabura|Gualaceo|Chacaritas|América de Quito|9 de Octubre|Vargas Torres|Olmedo|Centro Deportivo Olmedo|
     Club Social y Deportivo Macará|Milagro|Esmeraldas Petrolero|Deportivo Santo Domingo|Club Deportivo Quevedo|
     Deportivo Quevedo|Club Deportivo Ambato|Club Deportivo Riobamba|Club Deportivo Loja|Club Deportivo Manta|
     Deportivo Manta|Independiente Quito|Juventud Quito|Club Sport Guayaquil|Norte América|Rocafuerte|Everest|
     Club Deportivo Quito|Club Deportivo Azogues`,
  ),
  PE: real(
    `Universitario|Universitario de Deportes|Alianza Lima|Sporting Cristal|Melgar|Cienciano|Sport Huancayo|
     Atlético Grau|Alianza Atlético|ADT|Asociación Deportiva Tarma|Cusco|Deportivo Garcilaso|Sport Boys|UTC|Los Chankas|
     Comerciantes Unidos|Juan Pablo II College|Unión Comercio|Carlos A. Mannucci|Ayacucho|Binacional|Alianza Universidad|
     Alianza Huánuco|Deportivo Municipal|Academia Cantolao|Cantolao|Cultural Santa Rosa|Unión Huaral|Coronel Bolognesi|
     Atlético Torino|Atlético Chalaco|Sport Rosario|Defensor Lima|Juventud Bellavista|Colegio Nacional Iquitos|
     Deportivo Binacional|Sport Chavelines|Deportivo Llacuabamba|Alianza Lima|Sport Áncash|Unión Minas|
     Deportivo Coopsol|Sport Loreto|Juventud La Palma|Deportivo Hualgayoc|Atlético Trujillo|Deportivo Trujillo|
     Sport Piura|Atlético Piura|Deportivo Piura|Sport Callao|Deportivo Callao|Atlético Callao|Unión Tumbes`,
  ),
  BO: real(
    `Bolívar|Club Bolívar|The Strongest|Always Ready|Jorge Wilstermann|Wilstermann|Aurora|Club Aurora|San José|
     Club San José|Oriente Petrolero|Blooming|Club Blooming|Real Santa Cruz|Real Potosí|Nacional Potosí|Guabirá|
     Independiente Petrolero|Universitario de Vinto|Universitario de Sucre|Universitario de Pando|Real Tomayapo|
     Royal Pari|Club Atlético Palmaflor|Palmaflor|Real Oruro|Totora Real Oruro|Club Destroyers|Destroyers|
     Club Atlético Ciclón|Ciclón|Club Deportivo Guabirá|Real Tarija|Club Tarija|Atlético Tarija|Unión Tarija|
     Deportivo Tarija|Club Deportivo Oruro|Club Deportivo Cobija|Real Cochabamba|Real La Paz|Universitario de La Paz|
     Club Atlético La Paz|Nacional Sucre|Real Sucre|Club Deportivo Sucre|Atlético Sucre|GV San José|ABB|Enrique Happ|
     Universitario de Cochabamba|La Paz`,
  ),
  PY: real(
    `Olimpia|Club Olimpia|Cerro Porteño|Libertad|Club Libertad|Guaraní|Club Guaraní|Nacional|Club Nacional|
     Sportivo Luqueño|Club Sportivo Luqueño|Sportivo Ameliano|Sportivo Trinidense|Tacuary|General Caballero|
     2 de Mayo|Recoleta|Sportivo San Lorenzo|Club Sportivo San Lorenzo|General Díaz|Rubio Ñu|River Plate|
     Sportivo Carapeguá|Club Sportivo Carapeguá|3 de Febrero|Deportivo Capiatá|Club Deportivo Capiatá|
     Fernando de la Mora|Club Fernando de la Mora|Resistencia|12 de Octubre|Deportivo Santaní|Independiente|
     Sol de América|Colegiales|Presidente Hayes|Guaireña|Club Guaireña|Atlético Tembetary|Sportivo Iteño|
     Martín Ledesma|Club Atlético Colegiales|Deportivo Recoleta|Encarnación|Club Encarnación|Deportivo Encarnación|
     Atlético Juventud|Pastoreo|Cristóbal Colón|Deportivo Caaguazú|Club Deportivo Caaguazú|Sportivo Obrero|
     Villarrica|Club Villarrica|Deportivo Pilar|Club Pilar|Concepción|Club Concepción|Deportivo Concepción|
     Deportivo Limpio|Sportivo Limpeño|Club Ciudad del Este|Deportivo Ciudad del Este|Atlético Ciudad del Este`,
  ),
  CL: real(
    `Colo-Colo|Universidad de Chile|Universidad Católica|Unión Española|Audax Italiano|Palestino|Cobreloa|Cobresal|
     Huachipato|O'Higgins|Ñublense|Coquimbo Unido|Unión La Calera|Everton|Everton de Viña del Mar|Santiago Wanderers|
     Magallanes|Deportes Iquique|Deportes Antofagasta|Deportes Temuco|Deportes La Serena|Deportes Concepción|
     Universidad de Concepción|Deportes Puerto Montt|Deportes Copiapó|Deportes Valdivia|Deportes Melipilla|
     Deportes Santa Cruz|Deportes Limache|Deportes Linares|Deportes Rengo|Deportes Vallenar|Deportes Ovalle|
     Deportes Recoleta|Deportes Osorno|Provincial Osorno|Provincial Ovalle|Curicó Unido|San Luis de Quillota|
     San Antonio Unido|Rangers|Rangers de Talca|Unión San Felipe|Trasandino|Lota Schwager|Naval|Fernández Vial|
     San Marcos de Arica|Santiago Morning|Barnechea|Deportes Colchagua|General Velásquez|Lautaro de Buin|
     Deportes Puente Alto|Deportes Maipú|Deportes Talcahuano|Deportes Arica|Deportes Calama|Deportes Chillán|
     Deportes Rancagua|Deportes Talca|Deportes Curicó|Deportes Quillota|Deportes San Antonio|Deportes Los Andes|
     Deportes San Felipe|Deportes Valparaíso|Deportes Viña del Mar|Deportes Coquimbo|Deportes Los Ángeles|
     Deportes Punta Arenas|Deportes Castro|Deportes Coyhaique|Deportes Quilpué|Deportes Villa Alemana|Deportes Lota|
     Deportes San Bernardo|Deportes Santiago|Deportes La Calera|Deportes Iberia|Iberia|
     Municipal Puente Alto|Municipal Santiago|Provincial Talagante|Provincial Curicó|Iquique|Antofagasta|Temuco|
     Deportes Magallanes|Unión Temuco|Deportes Ñuñoa|Deportes La Florida|Deportes Pudahuel|Deportes Renca`,
  ),
};

export const CONMEBOL: CatalogFileData = {
  file: "conmebol",
  realClubNames: REAL_CLUB_NAMES,
  nations: [AR, BR, CO, UY, EC, PY, CL, PE, VE, BO],
  namePools: [
    BRAZILIAN,
    RIOPLATENSE,
    URUGUAYAN,
    COLOMBIAN,
    VENEZUELAN,
    ECUADORIAN,
    PERUVIAN,
    BOLIVIAN,
    ANDEAN,
    PARAGUAYAN,
    CHILEAN,
  ],
};
