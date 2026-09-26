// People API (world version 4): names, identities, bodies and player rows generated from the curated world catalog.
import { allLocales } from "@faker-js/faker";
import { createRequire } from "node:module";
import type seedrandom from "seedrandom";
import type { Store } from "./db.ts";
import { initialBody } from "./growth.ts";
import {
  worldCatalog,
  type CatalogLookup,
  type CitySize,
  type MigrationContext,
  type NameSource,
  type NationSpec,
} from "../shared/world-catalog/index.ts";
import {
  ATTRIBUTE_GROUPS,
  PERSONALITY_KEYS,
  ageOn,
  clamp,
  valuation,
} from "../shared/rules.ts";
import type { Club, Country, PlayerProfile, Position } from "../shared/types.ts";

export type Rng = seedrandom.PRNG;
export interface PeopleContext {
  countries: Country[];
  byId: Map<number, Country>;
  byCode: Map<string, Country>;
  /** Catalog lookups; the curated world catalog unless a test passes a fixture. */
  catalog?: CatalogLookup;
}

export function peopleContext(
  countries: Country[],
  catalog?: CatalogLookup,
): PeopleContext {
  return {
    countries,
    byId: new Map(countries.map((country) => [country.id, country])),
    byCode: new Map(countries.map((country) => [country.code, country])),
    ...(catalog ? { catalog } : {}),
  };
}

const catalogOf = (people?: PeopleContext) => people?.catalog ?? worldCatalog();
const integer = (random: Rng, min: number, max: number) =>
  Math.floor(random() * (max - min + 1)) + min;
const pick = <Value>(random: Rng, values: readonly Value[]) =>
  values[Math.floor(random() * values.length)];
export function weightedIndex(weights: readonly number[], roll: number): number {
  let remaining = roll * weights.reduce((total, weight) => total + weight, 0);
  for (let index = 0; index < weights.length; index++) {
    remaining -= weights[index];
    if (remaining < 0) return index;
  }
  return weights.length - 1;
}
export const placeKey = (name: string) =>
  name.normalize("NFKD").replace(/\p{M}/gu, "").toLowerCase();

// ---------------------------------------------------------------- names

const LATIN_NAME = /^[\p{Script=Latin}\p{M}'’ʻ .-]+$/u;
type Side = "given" | "family";
interface NameSourceList {
  key: string;
  names: string[];
  weight: number;
}
interface NameCulture {
  given: NameSourceList[];
  givenWeights: number[];
  family: NameSourceList[];
  familyWeights: number[];
  /** Per given source: chance the family name keeps that culture, and the family source keeping it. */
  keep: number[];
  keepFamily: number[];
  /** Family weights left after kept cultures (maximal coupling: both marginals stay exact). */
  residualWeights: number[];
  residualTotal: number;
  mixRate: number;
  familyFirst: boolean;
  secondFamilyRate: number;
  mononymRate: number;
}
const latinNames = (names?: readonly string[] | null) => [
  ...new Set(
    (names ?? [])
      .map((name) => name.trim())
      .filter((name) => name.length <= 40 && LATIN_NAME.test(name)),
  ),
];
const fakerLists = new Map<string, Record<Side, string[]>>();
function fakerNames(locale: string): Record<Side, string[]> {
  let list = fakerLists.get(locale);
  if (!list) {
    const person = allLocales[locale as keyof typeof allLocales]?.person;
    list = {
      given: latinNames(person?.first_name?.male ?? person?.first_name?.generic),
      family: latinNames(person?.last_name?.male ?? person?.last_name?.generic),
    };
    fakerLists.set(locale, list);
  }
  return list;
}
function sourceNames(catalog: CatalogLookup, source: NameSource, side: Side) {
  if (source.startsWith("faker:")) return fakerNames(source.slice(6))[side];
  return latinNames(catalog.namePool(source.slice(5))?.[side]);
}
const cultures = new WeakMap<CatalogLookup, Map<string, NameCulture>>();
function nameCulture(catalog: CatalogLookup, code: string, region?: string): NameCulture {
  let byCode = cultures.get(catalog);
  if (!byCode) cultures.set(catalog, (byCode = new Map()));
  const config = catalog.nationByCode(code)?.names;
  const rule = region ? config?.regional?.find((entry) => entry.regions.includes(region)) : undefined;
  const cacheKey = rule ? `${code}:${region}` : code;
  let culture = byCode.get(cacheKey);
  if (!culture) {
    const side = (key: Side): NameSourceList[] => {
      const sources = (rule?.[key] ?? config?.[key] ?? [])
        .map(({ source, weight }) => ({
          key: source as string,
          names: sourceNames(catalog, source, key),
          weight,
        }))
        .filter((entry) => entry.names.length && entry.weight > 0);
      // Pools of catalog files still being authored fall back to English names instead of failing.
      return sources.length
        ? sources
        : [{ key: "faker:en", names: fakerNames("en")[key], weight: 1 }];
    };
    const given = side("given");
    const family = side("family");
    const shares = (entries: NameSourceList[]) => {
      const total = entries.reduce((sum, entry) => sum + entry.weight, 0);
      const byKey = new Map<string, number>();
      for (const entry of entries)
        byKey.set(entry.key, (byKey.get(entry.key) ?? 0) + entry.weight / total);
      return { total, byKey };
    };
    const givenShares = shares(given);
    const familyShares = shares(family);
    const kept = (key: string) =>
      Math.min(givenShares.byKey.get(key) ?? 0, familyShares.byKey.get(key) ?? 0);
    const residualWeights = family.map((entry) => {
      const share = familyShares.byKey.get(entry.key)!;
      return (entry.weight / familyShares.total) * (1 - kept(entry.key) / share);
    });
    culture = {
      given,
      givenWeights: given.map((entry) => entry.weight),
      family,
      familyWeights: family.map((entry) => entry.weight),
      keep: given.map((entry) => kept(entry.key) / givenShares.byKey.get(entry.key)!),
      keepFamily: given.map((entry) => family.findIndex((other) => other.key === entry.key)),
      residualWeights,
      residualTotal: residualWeights.reduce((sum, weight) => sum + weight, 0),
      mixRate: config?.mixRate ?? 0,
      familyFirst: config?.order === "family-given",
      secondFamilyRate: config?.secondFamilyRate ?? 0,
      mononymRate: config?.mononymRate ?? 0,
    };
    byCode.set(cacheKey, culture);
  }
  return culture;
}
function drawName(
  sources: NameSourceList[],
  weights: number[],
  sourceRoll: number,
  nameRoll: number,
) {
  const { names } = sources[weightedIndex(weights, sourceRoll)];
  return names[Math.floor(nameRoll * names.length)];
}
function familySource(
  culture: NameCulture,
  givenIndex: number,
  rolls: { mix: number; keep: number; source: number },
) {
  if (givenIndex >= 0 && rolls.mix >= culture.mixRate) {
    const keepIndex = culture.keepFamily[givenIndex];
    if (keepIndex >= 0 && rolls.keep < culture.keep[givenIndex]) return keepIndex;
    if (culture.residualTotal > 1e-9)
      return weightedIndex(culture.residualWeights, rolls.source);
  }
  return weightedIndex(culture.familyWeights, rolls.source);
}

/**
 * Name in the culture of nameCode (catalog NameConfig); givenCode optionally supplies the given-name culture
 * (diaspora). Within one culture the family name keeps the given name's source unless NameConfig.mixRate mixes.
 * `region` (birthplace CitySpec.region in the nameCode nation) selects NameConfig.regional lists.
 */
export function personName(
  random: Rng,
  nameCode: string | Pick<Country, "code">,
  options: { givenCode?: string; catalog?: CatalogLookup; region?: string } = {},
): string {
  const catalog = options.catalog ?? worldCatalog();
  const family = nameCulture(
    catalog,
    typeof nameCode === "string" ? nameCode : nameCode.code,
    options.region,
  );
  const given = options.givenCode ? nameCulture(catalog, options.givenCode) : family;
  // A fixed number of draws keeps later random values independent of the name branch taken.
  const rolls = Array.from({ length: 10 }, () => random());
  const givenIndex = weightedIndex(given.givenWeights, rolls[0]);
  const givenNames = given.given[givenIndex].names;
  const first = givenNames[Math.floor(rolls[1] * givenNames.length)];
  if (rolls[6] < family.mononymRate) return first;
  const familyIndex = familySource(family, given === family ? givenIndex : -1, {
    mix: rolls[8],
    keep: rolls[9],
    source: rolls[2],
  });
  const familyNames = family.family[familyIndex].names;
  let last = familyNames[Math.floor(rolls[3] * familyNames.length)];
  if (rolls[4] < family.secondFamilyRate) {
    const second = drawName(family.family, family.familyWeights, rolls[5], rolls[7]);
    if (second !== last) last = `${last} ${second}`;
  }
  return family.familyFirst ? `${last} ${first}` : `${first} ${last}`;
}

// --------------------------------------------------------------- places

export interface Place {
  name: string;
  region: string;
  size: CitySize | "extra";
  lat?: number;
  lng?: number;
}
export interface NationPlaces {
  /** Curated cities, biggest first (catalog order). */
  curated: Place[];
  curatedWeights: number[];
  /** cities.json towns (only when the nation defines cities.extra), in a stable pseudo-random order. */
  extra: Place[];
}
interface GeoEntry {
  name: string;
  lat: string;
  lng: string;
  country: string;
  admin1: string;
}
const LATIN_PLACE = /^[\p{Script=Latin}\p{M}\d'’ʻ .,()/-]+$/u;
const BIRTH_WEIGHT: Record<CitySize, number> = {
  mega: 10,
  large: 5,
  medium: 2.5,
  small: 1.2,
  town: 0.6,
};
let geoIndex: Map<string, GeoEntry[]> | undefined;
function geoEntries(iso2: string): GeoEntry[] {
  if (!geoIndex) {
    geoIndex = new Map();
    for (const entry of createRequire(import.meta.url)("cities.json") as GeoEntry[]) {
      const list = geoIndex.get(entry.country);
      if (list) list.push(entry);
      else geoIndex.set(entry.country, [entry]);
    }
  }
  return geoIndex.get(iso2) ?? [];
}
const stableHash = (value: string) => {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index++)
    hash = Math.imul(hash ^ value.charCodeAt(index), 16777619);
  return hash >>> 0;
};
const placeCache = new WeakMap<CatalogLookup, Map<string, NationPlaces>>();

/** Curated and cities.json settlements of a nation, shared by birthplaces and club homes. */
export function nationPlaces(catalog: CatalogLookup, code: string): NationPlaces {
  let byCode = placeCache.get(catalog);
  if (!byCode) placeCache.set(catalog, (byCode = new Map()));
  let places = byCode.get(code);
  if (places) return places;
  const nation = catalog.nationByCode(code);
  const cities = nation?.cities;
  const admin1 = new Set(cities?.extra?.admin1 ?? []);
  const inCountry = nation ? geoEntries(nation.iso2) : [];
  const geo = inCountry.filter((entry) => !admin1.size || admin1.has(entry.admin1));
  const byName = new Map<string, GeoEntry[]>();
  for (const entry of inCountry) {
    const key = placeKey(entry.name);
    const list = byName.get(key);
    if (list) list.push(entry);
    else byName.set(key, [entry]);
  }
  const major = cities?.major ?? [];
  const hits = major.map((city) =>
    (byName.get(placeKey(city.name)) ?? []).filter((entry) =>
      city.admin1 ? entry.admin1 === city.admin1 : !admin1.size || admin1.has(entry.admin1),
    ),
  );
  // A name shared across provinces resolves to the entry nearest the unambiguous cities of the same region.
  const centres = new Map<string, { lat: number; lng: number; count: number }>();
  major.forEach((city, index) => {
    const list = hits[index];
    const point = city.lat !== undefined && city.lng !== undefined
      ? { lat: city.lat, lng: city.lng }
      : list.length && (city.admin1 || list.every((entry) => entry.admin1 === list[0].admin1))
        ? { lat: Number(list[0].lat), lng: Number(list[0].lng) }
        : undefined;
    if (!point) return;
    const centre = centres.get(city.region) ?? { lat: 0, lng: 0, count: 0 };
    centres.set(city.region, { lat: centre.lat + point.lat, lng: centre.lng + point.lng, count: centre.count + 1 });
  });
  const curated: Place[] = major.map((city, index) => {
    const list = hits[index];
    const centre = centres.get(city.region);
    const distance = (entry: GeoEntry) =>
      centre ? (Number(entry.lat) - centre.lat / centre.count) ** 2 + (Number(entry.lng) - centre.lng / centre.count) ** 2 : 0;
    const located = city.lat !== undefined && city.lng !== undefined
      ? { lat: city.lat, lng: city.lng }
      : list.reduce<GeoEntry | undefined>((best, entry) => (!best || distance(entry) < distance(best) ? entry : best), undefined);
    return {
      name: city.name,
      region: city.region,
      size: city.size,
      ...(located ? { lat: Number(located.lat), lng: Number(located.lng) } : {}),
    };
  });
  const extra: Place[] = [];
  if (cities?.extra) {
    const taken = new Set([
      ...curated.map((city) => placeKey(city.name)),
      ...(cities.extra.exclude ?? []).map(placeKey),
    ]);
    const located = curated.filter((city) => city.lat !== undefined);
    const regionOf = (lat: number, lng: number) => {
      let best = curated[0]?.region ?? nation?.capital ?? "";
      let distance = Number.POSITIVE_INFINITY;
      const scale = Math.cos((lat * Math.PI) / 180);
      for (const city of located) {
        const next = (city.lat! - lat) ** 2 + ((city.lng! - lng) * scale) ** 2;
        if (next < distance) {
          distance = next;
          best = city.region;
        }
      }
      return best;
    };
    const candidates = geo
      .filter((entry) => {
        const name = entry.name.trim();
        const key = placeKey(name);
        if (!name || name.length > 30 || !LATIN_PLACE.test(name) || taken.has(key))
          return false;
        taken.add(key);
        return true;
      })
      .sort(
        (left, right) =>
          stableHash(left.name) - stableHash(right.name) ||
          left.name.localeCompare(right.name),
      )
      .slice(0, cities.extra.max ?? Number.POSITIVE_INFINITY);
    for (const entry of candidates) {
      const lat = Number(entry.lat);
      const lng = Number(entry.lng);
      extra.push({ name: entry.name.trim(), region: regionOf(lat, lng), size: "extra", lat, lng });
    }
  }
  places = {
    curated,
    curatedWeights: curated.map((city) => (city.size === "extra" ? 1 : BIRTH_WEIGHT[city.size])),
    extra,
  };
  byCode.set(code, places);
  return places;
}

function birthPlace(random: Rng, catalog: CatalogLookup, country: Country): Place {
  const places = nationPlaces(catalog, country.code);
  const roll = random();
  const choice = random();
  if (places.extra.length && (roll < 0.35 || !places.curated.length))
    return places.extra[Math.floor(choice * places.extra.length)];
  if (!places.curated.length)
    return { name: country.region || country.name, region: country.region, size: "large" };
  return places.curated[weightedIndex(places.curatedWeights, choice)];
}

// ------------------------------------------------------------- identity

export interface IdentityRequest {
  /** Sporting nationality wanted (players.country_id). */
  representCode: string;
  /** Nation where the person grew up / is generated (club nation or pool nation). */
  contextCode: string;
  birthDate: string;
  date: string;
  position: Position;
  /** May pick another held nationality (catalog diasporaPull, ability); default false. */
  allowSwitch?: boolean;
  /** Force the birth country code. */
  bornIn?: string;
  /** Used with allowSwitch: weaker players choose a heritage nation more often. */
  ability?: number;
}
export interface Identity {
  name: string;
  countryId: number;
  nationality: string;
  identity: PlayerProfile["identity"];
}
type Nationalities = NonNullable<PlayerProfile["identity"]["nationalities"]>;

function requireCountry(people: PeopleContext, code: string) {
  const country = people.byCode.get(code);
  if (!country) throw new Error(`Country ${code} is not part of this world.`);
  return country;
}
function primaryLanguage(spec: NationSpec | undefined, country: Country) {
  return spec?.languages[0]?.code ?? country.language;
}

export function createIdentity(
  random: Rng,
  people: PeopleContext,
  request: IdentityRequest,
): Identity {
  const catalog = catalogOf(people);
  const represent = requireCountry(people, request.representCode);
  const context = people.byCode.get(request.contextCode) ?? represent;
  const representSpec = catalog.nationByCode(represent.code);
  const contextSpec = catalog.nationByCode(context.code);
  const diaspora = context.id !== represent.id;
  const roots: Country[] = [];
  const addLink = (spec: NationSpec | undefined) => {
    const options = (spec?.nationality.links ?? []).filter(
      (link) =>
        people.byCode.has(link.code) &&
        !roots.some((root) => root.code === link.code),
    );
    if (!options.length) return false;
    const link = options[weightedIndex(options.map((entry) => entry.weight), random())];
    roots.push(people.byCode.get(link.code)!);
    return true;
  };
  const roll = random();
  if (diaspora) {
    // Raised abroad: family from the represented nation, sometimes one parent from the nation of upbringing.
    roots.push(represent);
    if (roll < 0.45) roots.push(context);
    else if (roll < 0.45 + (representSpec?.nationality.tripleRate ?? 0))
      addLink(representSpec);
  } else {
    roots.push(context);
    const profile = contextSpec?.nationality;
    if (profile && roll < profile.multipleRate && addLink(contextSpec) && roll < profile.tripleRate)
      addLink(contextSpec);
  }
  const shares = roots.length === 3 ? [50, 25, 25] : roots.length === 2 ? [50, 50] : [100];

  let birth = context;
  const forced = request.bornIn ? people.byCode.get(request.bornIn) : undefined;
  if (forced) birth = forced;
  else if (diaspora) birth = random() < 0.85 ? context : represent;
  else if (random() < (contextSpec?.nationality.bornAbroadRate ?? 0)) {
    const heritage = roots.slice(1);
    const links = (contextSpec?.nationality.links ?? []).filter((link) =>
      people.byCode.has(link.code),
    );
    if (heritage.length) birth = pick(random, heritage);
    else if (links.length)
      birth = people.byCode.get(
        links[weightedIndex(links.map((link) => link.weight), random())].code,
      )!;
  }

  const held: Nationalities = [];
  const hold = (country: Country, basis: "birth" | "parent") => {
    if (held.some((entry) => entry.countryId === country.id)) return;
    if (held.some((entry) => !catalog.permitsDualNationality(entry.code, country.code)))
      return;
    held.push({ countryId: country.id, code: country.code, country: country.name, basis });
  };
  hold(represent, birth.id === represent.id ? "birth" : "parent");
  for (const root of roots) hold(root, root.id === birth.id ? "birth" : "parent");
  // Born and raised abroad: citizenship of the nation of upbringing where dual nationality is allowed.
  if (diaspora && birth.id === context.id) hold(context, "birth");

  let sporting = represent;
  if (request.allowSwitch) {
    const ability = request.ability ?? 60;
    const group = catalog.citizenshipGroup(represent.code);
    // Shared-passport nations (EN/SCO/WAL/NIR) switch by birth or parentage, not by a second passport.
    const options = [
      ...held.slice(1).flatMap((entry) => people.byId.get(entry.countryId) ?? []),
      ...[birth, ...roots].filter(
        (country) => country.id !== represent.id && catalog.citizenshipGroup(country.code) === group,
      ),
    ].filter((country, index, all) => all.findIndex((other) => other.id === country.id) === index);
    for (const other of options) {
      const spec = catalog.nationByCode(other.code);
      if (!spec || catalog.isSuspended(other.code, "national")) continue;
      const gap = (representSpec?.reputation.national ?? 50) - spec.reputation.national;
      const chance =
        spec.nationality.diasporaPull *
        clamp((gap + 25) / 50, 0.05, 1) *
        clamp((92 - ability) / 45, 0.1, 1);
      if (random() < chance) {
        sporting = other;
        break;
      }
    }
  }

  const place = birthPlace(random, catalog, birth);
  // Raised abroad but representing the family's nation: the paternal (home) culture names the player.
  const origin = diaspora ? represent : roots[weightedIndex(shares, random())];
  const mixedFamily = roots.some((root) => root.id === context.id);
  const givenFromUpbringing = diaspora ? (mixedFamily ? 0.4 : 0.2) : 0.5;
  const givenCode =
    origin.id !== context.id && random() < givenFromUpbringing ? context.code : undefined;
  const name = personName(random, origin.code, {
    givenCode,
    catalog,
    ...(origin.id === birth.id ? { region: place.region } : {}),
  });

  const languages: PlayerProfile["identity"]["languages"] = [];
  const speak = (language: string | undefined, fluency: number) => {
    if (!language) return;
    const known = languages.find((entry) => entry.language === language);
    if (known) known.fluency = Math.max(known.fluency, fluency);
    else languages.push({ language, fluency });
  };
  const home = contextSpec?.languages ?? [];
  speak(
    home.length
      ? home[weightedIndex(home.map((entry) => entry.weight), random())].code
      : context.language,
    5,
  );
  if (birth.id !== context.id)
    speak(primaryLanguage(catalog.nationByCode(birth.code), birth), integer(random, 3, 5));
  for (const root of roots)
    if (root.id !== context.id)
      speak(primaryLanguage(catalog.nationByCode(root.code), root), integer(random, 2, 4));

  // Catalog physique is the footballer population of the nation of upbringing (diaspora players included).
  const body = initialBody(random, {
    nationCode: context.code,
    position: request.position,
    birthDate: request.birthDate,
    date: request.date,
  });
  return {
    name,
    countryId: sporting.id,
    nationality: sporting.name,
    identity: {
      heritage: roots.map((root, index) => ({
        country: root.name,
        percentage: shares[index],
      })),
      nationalities: held,
      birthCountryId: birth.id,
      birthplace: `${place.name}, ${birth.name}`,
      familyOrigins: {
        maternal:
          roots.length > 1
            ? roots.slice(1).map((root) => root.name).join(" and ")
            : roots[0].name,
        paternal: roots[0].name,
      },
      nameOriginCountryId: origin.id,
      internationalCountryId: sporting.id,
      languages,
      region: place.region || place.name,
      height: body.height,
      weight: body.weight,
      bodyType: body.bodyType,
      growth: body.growth,
    },
  };
}

const MIGRATION: Record<MigrationContext, string> = {
  lusophone: "Portuguese, Brazilian and Lusophone African migration",
  frenchAfrica: "migration between France, the Maghreb and West or Central Africa",
  germanRecruitment: "post-war labour migration to Germany and its neighbours",
  dutchDiaspora: "migration linking the Netherlands, Suriname, the Caribbean and Indonesia",
  britishIrish: "longstanding movement between Britain and Ireland",
  commonwealth: "Commonwealth migration and overseas family communities",
  crossBorder: "cross-border and labour migration",
  mediterranean: "Mediterranean and transatlantic migration",
  americas: "migration within the Americas",
  caribbean: "Caribbean migration and family connections",
  pacific: "Pacific migration and family connections",
  regional: "regional migration and cross-border family ties",
  asianDiaspora: "Asian diaspora and regional migration",
  gulfLabour: "labour migration to the Gulf states",
  postSoviet: "family ties across the former Soviet Union",
  yugoslav: "family ties across the former Yugoslavia",
  arabWorld: "migration across the Arab world",
};
const languageNames = new Intl.DisplayNames(["en"], { type: "language" });
const languageName = (code: string) => {
  try {
    return languageNames.of(code) ?? code;
  } catch {
    return code;
  }
};
const listed = (items: string[]) =>
  items.length <= 1
    ? (items[0] ?? "")
    : `${items.slice(0, -1).join(", ")} and ${items.at(-1)}`;

/** Biography sentences derived on read (never stored). */
export function describeIdentity(
  identity: PlayerProfile["identity"],
  people: PeopleContext,
): string[] {
  if (identity.biography?.length) return identity.biography;
  const catalog = catalogOf(people);
  const byName = new Map(people.countries.map((country) => [country.name, country]));
  const international = identity.internationalCountryId
    ? people.byId.get(identity.internationalCountryId)?.name
    : undefined;
  const roots = identity.heritage.map((entry) => entry.country);
  const sentences = [
    `Fictional biography: born in ${identity.birthplace ?? identity.region}.${international ? ` Represents ${international} in international football.` : ""}`,
  ];
  if (roots.length <= 1)
    sentences.push(`Both sides of the family have roots in ${roots[0] ?? international ?? "the same nation"}.`);
  else {
    const first = byName.get(roots[0]);
    const links = first ? (catalog.nationByCode(first.code)?.nationality.links ?? []) : [];
    const contexts = [
      ...new Set(
        roots.slice(1).flatMap((root) => {
          const link = links.find((entry) => entry.code === byName.get(root)?.code);
          return link ? [MIGRATION[link.context]] : [];
        }),
      ),
    ];
    sentences.push(
      `The family has roots in ${listed(roots)}${contexts.length ? `, a history shaped by ${listed(contexts)}` : ""}. Heritage percentages describe family branches, not genetic ancestry.`,
    );
  }
  const held = identity.nationalities ?? [];
  if (held.length) {
    const heritageOnly = roots.filter((root) => !held.some((entry) => entry.country === root));
    sentences.push(
      `Holds ${listed(held.map((entry) => entry.country))} citizenship through ${held.every((entry) => entry.basis === "parent") ? "a citizen parent" : "birth and family"}.${heritageOnly.length ? ` Connections to ${listed(heritageOnly)} remain heritage only.` : ""}`,
    );
  }
  if (identity.languages.length)
    sentences.push(
      `Speaks ${listed(identity.languages.map((entry) => `${languageName(entry.language)}${entry.fluency >= 5 ? " (native)" : ""}`))}.`,
    );
  return sentences;
}

// --------------------------------------------------------------- players

export interface PlayerSpec {
  /** null = home-based pool player. */
  club: Pick<
    Club,
    "id" | "country_id" | "reputation" | "academy" | "balance" | "philosophy" | "type"
  > | null;
  representCode: string;
  contextCode: string;
  ageGroup: "Senior" | "U19" | "U17";
  position: Position;
  birthDate: string;
  date: string;
  ability: number;
  potential: number;
  leagueReputation: number;
  /** Payroll calibration factor, default 1. */
  wageScale?: number;
  /** Weekly professional minimum, default 50; thin club budgets pay less. */
  wageFloor?: number;
  contract: "professional" | "amateur" | "pool";
  role?: string;
  allowSwitch?: boolean;
  /** Force the birth country code (second-generation academy players). */
  bornIn?: string;
  intake?: NonNullable<PlayerProfile["intake"]>;
  familyMove?: PlayerProfile["familyMove"];
}
/** players columns without id. */
export type PlayerRow = Record<string, string | number | null>;

/** Unscaled weekly professional wage (the pre-v4 formula); world generation calibrates it per club. */
export const professionalBaseWage = (ability: number, ageGroup: string) =>
  Math.round(((ability / 100) ** 7 * 190_000 * (ageGroup === "Senior" ? 1 : 0.08)) / 10) *
    10 +
  50;
export const amateurAllowance = (academy: number) => Math.round(10 + academy * 0.35);
/** Weekly professional wage at a club's payroll calibration. */
export const professionalWage = (ability: number, ageGroup: string, scale = 1, floor = 50) =>
  Math.max(floor, Math.round((professionalBaseWage(ability, ageGroup) * scale) / 10) * 10);

const SECONDARY: Record<Position, Position[]> = {
  GK: ["GK"],
  CB: ["DM", "RB", "LB"],
  LB: ["LW", "CB", "RB"],
  RB: ["RW", "CB", "LB"],
  DM: ["CM", "CB"],
  CM: ["DM", "AM"],
  AM: ["CM", "LW", "RW", "ST"],
  LW: ["RW", "AM", "ST", "LB"],
  RW: ["LW", "AM", "ST", "RB"],
  ST: ["AM", "LW", "RW"],
};
const TRAITS = [
  [
    "Cuts inside",
    "Shoots from distance",
    "Dribbles often",
    "Aggressive presser",
    "Big-game player",
    "Lazy trainer",
    "Plays one-twos",
    "Dictates tempo",
    "Arrives late in box",
    "Stays on feet",
  ],
  [
    "Tries killer balls",
    "Leads by example",
    "Runs with ball",
    "Plays safe passes",
    "Likes to beat offside trap",
    "Long throw specialist",
  ],
];

export function createPlayer(
  random: Rng,
  people: PeopleContext,
  spec: PlayerSpec,
): PlayerRow {
  const catalog = catalogOf(people);
  const age = ageOn(spec.birthDate, spec.date);
  const youth = spec.ageGroup !== "Senior";
  const pool = spec.contract === "pool" || !spec.club;
  const created = createIdentity(random, people, {
    representCode: spec.representCode,
    contextCode: spec.contextCode,
    birthDate: spec.birthDate,
    date: spec.date,
    position: spec.position,
    allowSwitch: spec.allowSwitch,
    ability: spec.ability,
    ...(spec.bornIn ? { bornIn: spec.bornIn } : {}),
  });
  const clubCountry = spec.club ? people.byId.get(spec.club.country_id) : undefined;
  if (clubCountry && !created.identity.languages.some((entry) => entry.language === clubCountry.language))
    created.identity.languages.push({ language: clubCountry.language, fluency: integer(random, 1, 3) });
  const attributes = Object.fromEntries(
    Object.entries(ATTRIBUTE_GROUPS).map(([group, keys]) => [
      group,
      Object.fromEntries(
        keys.map((key) => {
          const offset =
            group === "goalkeeper"
              ? spec.position === "GK" ? 5 : -50
              : spec.position === "GK" && group === "technical" ? -22 : 0;
          return [key, Math.round(clamp(spec.ability + integer(random, -17, 14) + offset))];
        }),
      ),
    ]),
  ) as PlayerProfile["attributes"];
  const personality = Object.fromEntries(
    PERSONALITY_KEYS.map((key) => [key, integer(random, 20, 95)]),
  );
  const year = Number(spec.date.slice(0, 4));
  const contractEnd = pool
    ? `${year + 1}-06-30`
    : `${year + (youth || spec.contract === "amateur" ? integer(random, 1, 3) : integer(random, 1, 5))}-06-30`;
  const allowance = amateurAllowance(spec.club?.academy ?? 50);
  const wage = pool
    ? 0
    : spec.contract === "amateur"
      ? allowance
      : professionalWage(spec.ability, spec.ageGroup, spec.wageScale, spec.wageFloor);
  const contract: NonNullable<PlayerProfile["contract"]> = pool
    ? { status: "amateur" }
    : spec.contract === "amateur"
      ? {
          status: "amateur",
          trainingClubId: spec.club!.id,
          trainingStartAge: 12,
          expenseAllowance: allowance,
          futureProfessionalContract: age >= 16 && random() < 0.15,
        }
      : { status: "professional", trainingClubId: spec.club!.id, trainingStartAge: 12 };
  const local = created.countryId === (clubCountry?.id ?? created.countryId);
  const profile: PlayerProfile = {
    contract,
    ...(spec.familyMove ? { familyMove: spec.familyMove } : {}),
    identity: created.identity,
    attributes,
    personality,
    traits: [pick(random, TRAITS[0]), pick(random, TRAITS[1])],
    lifestyle: pick(random, ["disciplined", "nightlife", "family-focused", "luxury-obsessed", "gym-rat"]),
    mentalHealth: {
      confidence: integer(random, 45, 85),
      anxiety: integer(random, 8, 40),
      burnout: integer(random, 2, 22),
      motivation: integer(random, 55, 95),
    },
    careerVision: [
      pick(random, ["Wants a big club", "Wants captaincy", "Wants the national team", "Wants Champions League football"]),
      age < 21 ? "Wants first-team minutes" : "Wants long-term security",
    ],
    baseAbility: spec.ability,
    agent: {
      name: personName(random, spec.contextCode, { catalog }),
      personality: pick(random, ["Pragmatic", "Loyal", "Ambitious", "Combative", "Opportunist"]),
      difficulty: integer(random, 20, 90),
      commission: integer(random, 3, 10),
      frustration: 0,
    },
    development: {
      growthSpurt: false,
      mentorId: null,
      history: [{ date: spec.date, ability: spec.ability, potential: spec.potential }],
    },
    relationships: {
      group: local ? "Local core" : age < 22 ? "Young internationals" : "International core",
      loyalty: personality.loyalty,
      influence: integer(random, 20, 90),
    },
    ...(spec.intake ? { intake: spec.intake } : {}),
    ...(pool
      ? { homeBased: { countryId: people.byCode.get(spec.contextCode)?.id ?? created.countryId, since: spec.date } }
      : {}),
  };
  const form = Math.round((6.2 + random() * 1.3) * 10) / 10;
  const value = valuation(
    {
      ability: spec.ability,
      potential: spec.potential,
      age,
      position: spec.position,
      contract_end: contractEnd,
      form,
      injury_until: null,
    },
    {
      date: spec.date,
      leagueReputation: spec.leagueReputation,
      balance: spec.club?.balance ?? 0,
      philosophy: spec.club?.philosophy ?? "",
      inflation: 4,
      crisis: 0,
      hype: 0,
    },
  ).value;
  const footRoll = random();
  const role = spec.role ?? (pool ? "Home-based" : youth ? "Prospect" : "Squad player");
  return {
    name: created.name,
    nationality: created.nationality,
    country_id: created.countryId,
    club_id: pool ? null : spec.club!.id,
    position: spec.position,
    secondary_position: pick(random, SECONDARY[spec.position]),
    birth_date: spec.birthDate,
    age,
    age_group: spec.ageGroup,
    foot: footRoll < 0.75 ? "Right" : footRoll < 0.96 ? "Left" : "Both",
    ability: spec.ability,
    base_potential: spec.potential,
    potential: spec.potential,
    volatility: youth ? integer(random, 5, 20) : integer(random, 0, 12),
    value: Math.max(100, value),
    wage,
    contract_end: contractEnd,
    morale: integer(random, 60, 87),
    fitness: integer(random, 86, 99),
    form,
    role,
    profile: JSON.stringify(profile),
    knowledge: integer(random, 0, 25),
    available_loan: !youth && !pool && age <= 23 && role === "Squad player" ? 1 : 0,
  };
}

// Mild relative-age effect: early-year births are over-represented in football.
const MONTH_WEIGHTS = [1.25, 1.2, 1.15, 1.1, 1.05, 1, 0.95, 0.9, 0.9, 0.85, 0.8, 0.8];
const pad = (value: number) => String(value).padStart(2, "0");

export function birthDateForAge(random: Rng, age: number, date: string): string {
  const monthDay = `${pad(weightedIndex(MONTH_WEIGHTS, random()) + 1)}-${pad(1 + Math.floor(random() * 28))}`;
  const year = Number(date.slice(0, 4)) - age - (monthDay > date.slice(5, 10) ? 1 : 0);
  return `${year}-${monthDay}`;
}

export async function insertPlayers(
  store: Store,
  rows: Iterable<PlayerRow>,
): Promise<number> {
  let inserted = 0;
  await store.transaction(async () => {
    let nextId = (await store.get<{ id: number }>(
      "SELECT coalesce(max(id),0) AS id FROM players WITH (UPDLOCK,HOLDLOCK)",
    ))!.id;
    let batch: PlayerRow[] = [];
    const flush = async () => {
      if (!batch.length) return;
      await store.bulkInsert("players", batch);
      inserted += batch.length;
      batch = [];
    };
    for (const row of rows) {
      batch.push({ id: ++nextId, ...row });
      if (batch.length === 1000) await flush();
    }
    await flush();
  });
  return inserted;
}
