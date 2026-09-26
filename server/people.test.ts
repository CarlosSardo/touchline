import { describe, expect, it } from "vitest";
import seedrandom from "seedrandom";
import {
  birthDateForAge,
  createIdentity,
  createPlayer,
  describeIdentity,
  nationPlaces,
  peopleContext,
  personName,
  type PeopleContext,
} from "./people.ts";
import { catalogLookup, worldCatalog } from "../shared/world-catalog/index.ts";
import { isRealPersonName } from "../shared/world-catalog/real-names.ts";
import type {
  NamePool,
  NationSpec,
  WorldCatalog,
} from "../shared/world-catalog/index.ts";
import { START_DATE, ageOn } from "../shared/rules.ts";
import type { Country, PlayerProfile } from "../shared/types.ts";

const LATIN = /^[\p{Script=Latin}\p{M}'’ʻ .-]+$/u;
const SN_FAMILY = ["Diop", "Ndiaye", "Sow", "Fall", "Gueye", "Sarr", "Faye", "Mbaye", "Cissé", "Diallo"];
const pools: NamePool[] = [
  {
    id: "caf/test-wolof",
    given: ["Moussa", "Cheikh", "Ibrahima", "Mamadou", "Pape", "Abdou", "Lamine", "Ismaïla"],
    family: SN_FAMILY,
  },
  {
    id: "caf/test-maghreb",
    given: ["Yacine", "Riyad", "Islam", "Youcef", "Nabil", "Aïssa"],
    family: ["Benali", "Mahrez", "Slimani", "Bensebaini", "Brahimi", "Feghouli"],
  },
  {
    id: "afc/test-japanese",
    given: ["Haruto", "Sota", "Yuto", "Ren", "Kaito", "Takumi"],
    family: ["Sato", "Suzuki", "Takahashi", "Tanaka", "Watanabe", "Ito"],
  },
  // Non-Latin entries must never be drawn.
  { id: "uefa-east/test-mixed", given: ["Иван", "Ivan", "Pyotr"], family: ["Петров", "Petrov", "Ivanov"] },
];

function nation(code: string, name: string, extra: Partial<NationSpec> = {}): NationSpec {
  return {
    code,
    iso2: code.length === 2 ? code : "GB",
    name,
    confederation: "UEFA",
    continent: "EU",
    capital: `${name} City`,
    latitude: 45,
    languages: [{ code: "en", weight: 1 }],
    reputation: { national: 60, league: 50 },
    euEea: false,
    names: {
      given: [{ source: "faker:en", weight: 1 }],
      family: [{ source: "faker:en", weight: 1 }],
    },
    nationality: {
      multipleRate: 0,
      tripleRate: 0,
      bornAbroadRate: 0,
      diasporaPull: 0.3,
      links: [],
      citizenship: { dual: "allowed" },
    },
    cities: {
      major: [
        { name: `${name} City`, size: "mega", region: "Capital" },
        { name: `${name} Harbour`, size: "medium", region: "Coast" },
      ],
    },
    ...extra,
  };
}

const NATIONS: NationSpec[] = [
  nation("FR", "France", {
    languages: [{ code: "fr", weight: 1 }],
    reputation: { national: 90, league: 80 },
    euEea: true,
    names: {
      given: [{ source: "faker:fr", weight: 1 }],
      family: [{ source: "faker:fr", weight: 1 }],
    },
    nationality: {
      multipleRate: 0.3,
      tripleRate: 0.08,
      bornAbroadRate: 0.1,
      diasporaPull: 0.4,
      links: [
        { code: "SN", weight: 3, context: "frenchAfrica" },
        { code: "DZ", weight: 2, context: "frenchAfrica" },
        { code: "PT", weight: 1, context: "lusophone" },
      ],
      citizenship: { dual: "allowed" },
    },
  }),
  nation("SN", "Senegal", {
    confederation: "CAF",
    continent: "AF",
    languages: [{ code: "fr", weight: 2 }, { code: "wo", weight: 1 }],
    reputation: { national: 78, league: 40 },
    names: {
      given: [{ source: "pool:caf/test-wolof", weight: 1 }],
      family: [{ source: "pool:caf/test-wolof", weight: 1 }],
    },
    nationality: {
      multipleRate: 0.1,
      tripleRate: 0,
      bornAbroadRate: 0.2,
      diasporaPull: 0.9,
      links: [{ code: "FR", weight: 1, context: "frenchAfrica" }],
      citizenship: { dual: "allowed" },
    },
  }),
  nation("DZ", "Algeria", {
    confederation: "CAF",
    continent: "AF",
    languages: [{ code: "ar", weight: 2 }, { code: "fr", weight: 1 }],
    reputation: { national: 72, league: 45 },
    names: {
      given: [{ source: "pool:caf/test-maghreb", weight: 1 }],
      family: [{ source: "pool:caf/test-maghreb", weight: 1 }],
    },
    nationality: {
      multipleRate: 0.1,
      tripleRate: 0,
      bornAbroadRate: 0.1,
      diasporaPull: 0.8,
      links: [{ code: "FR", weight: 1, context: "frenchAfrica" }],
      citizenship: { dual: "allowed" },
    },
  }),
  nation("PT", "Portugal", {
    languages: [{ code: "pt", weight: 1 }],
    reputation: { national: 85, league: 75 },
    euEea: true,
    names: {
      given: [{ source: "faker:pt_PT", weight: 1 }],
      family: [{ source: "faker:pt_PT", weight: 1 }],
      secondFamilyRate: 0.4,
    },
  }),
  nation("EN", "England", {
    nationality: {
      multipleRate: 0.3,
      tripleRate: 0,
      bornAbroadRate: 0,
      diasporaPull: 0.3,
      links: [
        { code: "SCO", weight: 1, context: "britishIrish" },
        { code: "IE", weight: 1, context: "britishIrish" },
      ],
      citizenship: { group: "GB", dual: "allowed" },
    },
  }),
  nation("SCO", "Scotland", {
    nationality: {
      multipleRate: 0,
      tripleRate: 0,
      bornAbroadRate: 0,
      diasporaPull: 0.3,
      links: [],
      citizenship: { group: "GB", dual: "allowed" },
    },
  }),
  nation("IE", "Republic of Ireland", { euEea: true }),
  nation("JP", "Japan", {
    confederation: "AFC",
    continent: "AS",
    languages: [{ code: "ja", weight: 1 }],
    names: {
      given: [{ source: "pool:afc/test-japanese", weight: 1 }],
      family: [{ source: "pool:afc/test-japanese", weight: 1 }],
      order: "family-given",
    },
    nationality: {
      multipleRate: 0.3,
      tripleRate: 0,
      bornAbroadRate: 0,
      diasporaPull: 0.2,
      links: [{ code: "BR", weight: 1, context: "americas" }],
      citizenship: { dual: "restricted" },
    },
  }),
  nation("BR", "Brazil", {
    confederation: "CONMEBOL",
    continent: "SA",
    languages: [{ code: "pt", weight: 1 }],
    names: {
      given: [{ source: "faker:pt_BR", weight: 1 }],
      family: [{ source: "faker:pt_BR", weight: 1 }],
      mononymRate: 0.2,
    },
  }),
  nation("RU", "Russia", {
    names: {
      given: [{ source: "pool:uefa-east/test-mixed", weight: 1 }],
      family: [{ source: "pool:uefa-east/test-mixed", weight: 1 }],
    },
  }),
  // Two-culture nations: paired lists (MY), different weights (SG) and a melting pot (US).
  nation("MY", "Malaysia", {
    names: {
      given: [{ source: "pool:caf/test-wolof", weight: 0.6 }, { source: "pool:caf/test-maghreb", weight: 0.4 }],
      family: [{ source: "pool:caf/test-wolof", weight: 0.6 }, { source: "pool:caf/test-maghreb", weight: 0.4 }],
    },
  }),
  nation("SG", "Singapore", {
    names: {
      given: [{ source: "pool:caf/test-wolof", weight: 0.5 }, { source: "pool:caf/test-maghreb", weight: 0.5 }],
      family: [{ source: "pool:caf/test-wolof", weight: 0.8 }, { source: "pool:caf/test-maghreb", weight: 0.2 }],
    },
  }),
  nation("US", "United States", {
    names: {
      given: [{ source: "pool:caf/test-wolof", weight: 0.5 }, { source: "pool:caf/test-maghreb", weight: 0.5 }],
      family: [{ source: "pool:caf/test-wolof", weight: 0.8 }, { source: "pool:caf/test-maghreb", weight: 0.2 }],
      mixRate: 1,
    },
  }),
];
const CATALOG: WorldCatalog = {
  files: [{ file: "uefa-west", nations: NATIONS, namePools: pools }],
  continental: { competitions: [], access: [], coefficientConfederations: [] },
};
const lookup = catalogLookup(CATALOG);
const countries: Country[] = NATIONS.map((entry, index) => ({
  id: index + 1,
  code: entry.code,
  name: entry.name,
  continent: entry.continent,
  confederation: entry.confederation,
  reputation: entry.reputation.league,
  language: entry.languages[0].code,
  region: entry.capital,
}));
const people: PeopleContext = peopleContext(countries, lookup);
const code = (id: number | undefined) => countries.find((country) => country.id === id)?.code;

function identities(seed: string, count: number, representCode: string, contextCode = representCode, allowSwitch = false) {
  const random = seedrandom(seed);
  return Array.from({ length: count }, () =>
    createIdentity(random, people, {
      representCode,
      contextCode,
      birthDate: birthDateForAge(random, 24, START_DATE),
      date: START_DATE,
      position: "CM",
      allowSwitch,
      ability: 55,
    }),
  );
}

describe("people API", () => {
  it("draws the name culture from a family root: French players with Senegalese roots can carry Senegalese names", () => {
    let senegaleseNames = 0;
    for (const person of identities("heritage", 3000, "FR")) {
      const origin = code(person.identity.nameOriginCountryId);
      const roots = person.identity.heritage.map((entry) => entry.country);
      expect(roots).toContain(countries.find((country) => country.code === origin)!.name);
      expect(person.identity.heritage.reduce((total, entry) => total + entry.percentage, 0)).toBe(100);
      if (origin !== "SN") continue;
      senegaleseNames++;
      expect(SN_FAMILY).toContain(person.name.split(" ").at(-1));
    }
    // About 30% have a second root, half of them Senegalese, and half of those take that family name.
    expect(senegaleseNames).toBeGreaterThan(90);
    expect(senegaleseNames).toBeLessThan(450);
  });

  it("gives dual nationality at about multipleRate times the share of links that permit it", () => {
    const dualRate = (nationCode: string) => {
      const group = identities(`dual:${nationCode}`, 4000, nationCode);
      return group.filter((person) => (person.identity.nationalities?.length ?? 0) >= 2).length / group.length;
    };
    expect(dualRate("FR")).toBeCloseTo(0.3, 1);
    expect(Math.abs(dualRate("FR") - 0.3)).toBeLessThan(0.035);
    // Scottish roots share the GB citizenship group with England: only the Irish link adds a passport.
    expect(Math.abs(dualRate("EN") - 0.15)).toBeLessThan(0.03);
    // Japan does not allow dual nationality.
    expect(dualRate("JP")).toBe(0);
    for (const person of identities("groups", 2000, "EN")) {
      const held = (person.identity.nationalities ?? []).map((entry) => entry.code);
      expect(held.filter((entry) => entry === "EN" || entry === "SCO")).toHaveLength(1);
      expect(new Set(held).size).toBe(held.length);
    }
  });

  it("keeps nationalities consistent with the background of diaspora players", () => {
    const group = identities("diaspora", 1500, "SN", "FR");
    for (const person of group) {
      expect(code(person.countryId)).toBe("SN");
      expect(person.identity.heritage.map((entry) => entry.country)).toContain("Senegal");
      expect(person.identity.nationalities?.map((entry) => entry.code)).toContain("SN");
      expect(person.identity.languages.some((entry) => entry.language === "fr" && entry.fluency === 5)).toBe(true);
    }
    const raisedFrench = group.filter((person) => person.identity.nationalities?.some((entry) => entry.code === "FR"));
    expect(raisedFrench.length / group.length).toBeGreaterThan(0.6);
    expect(group.filter((person) => code(person.identity.birthCountryId) === "FR").length / group.length).toBeGreaterThan(0.75);
  });

  it("lets dual nationals choose a heritage nation for international football", () => {
    const group = identities("switch", 3000, "FR", "FR", true);
    const switched = group.filter((person) => code(person.countryId) !== "FR");
    expect(switched.length).toBeGreaterThan(30);
    for (const person of switched)
      expect(person.identity.nationalities?.map((entry) => entry.countryId)).toContain(person.countryId);
    expect(identities("no-switch", 1000, "FR").every((person) => code(person.countryId) === "FR")).toBe(true);
  });

  it("only produces Latin-script names, honouring name order, second family names and mononyms", () => {
    const random = seedrandom("latin");
    for (const entry of NATIONS)
      for (let index = 0; index < 400; index++) {
        const name = personName(random, entry.code, { catalog: lookup });
        expect(name, entry.code).toMatch(LATIN);
      }
    const japanese = personName(seedrandom("order"), "JP", { catalog: lookup });
    expect(["Sato", "Suzuki", "Takahashi", "Tanaka", "Watanabe", "Ito"]).toContain(japanese.split(" ")[0]);
    const brazilian = Array.from({ length: 400 }, () => personName(random, "BR", { catalog: lookup }));
    expect(brazilian.some((name) => !name.includes(" "))).toBe(true);
    const portuguese = Array.from({ length: 400 }, () => personName(random, "PT", { catalog: lookup }));
    expect(portuguese.some((name) => name.split(" ").length >= 3)).toBe(true);
    for (const person of identities("birthplaces", 500, "FR"))
      expect(person.identity.birthplace).toMatch(/^[\p{Script=Latin}\p{M}\d'’ʻ .,()/-]+$/u);
  });

  it("is deterministic for a seed", () => {
    const first = identities("same-seed", 50, "FR");
    const second = identities("same-seed", 50, "FR");
    expect(second).toEqual(first);
    const row = (seed: string) =>
      createPlayer(seedrandom(seed), people, {
        club: { id: 7, country_id: 1, reputation: 70, academy: 60, balance: 1_000_000, philosophy: "Win now", type: "club" },
        representCode: "FR",
        contextCode: "FR",
        ageGroup: "Senior",
        position: "ST",
        birthDate: "2001-03-04",
        date: START_DATE,
        ability: 70,
        potential: 78,
        leagueReputation: 75,
        contract: "professional",
      });
    expect(row("player")).toEqual(row("player"));
    expect(row("player")).not.toEqual(row("other"));
  });

  it("derives bodies from the growth model and biographies on read", () => {
    const random = seedrandom("bodies");
    for (let index = 0; index < 200; index++) {
      const birthDate = birthDateForAge(random, 15 + (index % 20), START_DATE);
      expect(ageOn(birthDate, START_DATE)).toBe(15 + (index % 20));
      const person = createIdentity(random, people, {
        representCode: "FR",
        contextCode: "FR",
        birthDate,
        date: START_DATE,
        position: index % 2 ? "GK" : "LW",
      });
      const { height, weight, growth } = person.identity;
      expect(person.identity.biography).toBeUndefined();
      expect(growth).toBeDefined();
      expect(height).toBeLessThanOrEqual(Math.ceil(growth!.adultHeight));
      expect(height).toBeGreaterThan(140);
      expect(weight).toBeGreaterThan(35);
      const biography = describeIdentity(person.identity, people);
      expect(biography.length).toBeGreaterThanOrEqual(3);
      expect(biography[0]).toContain(person.identity.birthplace!);
    }
  });

  it("creates home-based and club player rows with sensible contracts and wages", () => {
    const random = seedrandom("rows");
    const pool = createPlayer(random, people, {
      club: null,
      representCode: "SN",
      contextCode: "SN",
      ageGroup: "U19",
      position: "GK",
      birthDate: birthDateForAge(random, 17, START_DATE),
      date: START_DATE,
      ability: 45,
      potential: 70,
      leagueReputation: 40,
      contract: "pool",
    });
    const profile = JSON.parse(String(pool.profile)) as PlayerProfile;
    expect(pool).toMatchObject({ club_id: null, wage: 0, role: "Home-based", age_group: "U19", country_id: 2 });
    expect(profile.homeBased).toEqual({ countryId: 2, since: START_DATE });
    const club = { id: 3, country_id: 1, reputation: 80, academy: 75, balance: 5_000_000, philosophy: "Win now", type: "club" as const };
    const professional = createPlayer(random, people, {
      club,
      representCode: "FR",
      contextCode: "FR",
      ageGroup: "Senior",
      position: "CM",
      birthDate: birthDateForAge(random, 26, START_DATE),
      date: START_DATE,
      ability: 80,
      potential: 82,
      leagueReputation: 80,
      contract: "professional",
      wageScale: 2,
    });
    const amateur = createPlayer(random, people, {
      club,
      representCode: "FR",
      contextCode: "FR",
      ageGroup: "U17",
      position: "CB",
      birthDate: birthDateForAge(random, 15, START_DATE),
      date: START_DATE,
      ability: 40,
      potential: 70,
      leagueReputation: 80,
      contract: "amateur",
    });
    expect(Number(professional.wage)).toBeGreaterThan(20_000);
    expect(Number(amateur.wage)).toBeLessThan(100);
    expect((JSON.parse(String(amateur.profile)) as PlayerProfile).contract?.status).toBe("amateur");
    for (const row of [pool, professional, amateur]) {
      expect(Number(row.value)).toBeGreaterThanOrEqual(100);
      expect(Number.isFinite(Number(row.value))).toBe(true);
      expect(String(row.name)).toMatch(LATIN);
    }
  });

  it("keeps given and family names in one culture while preserving both weightings", () => {
    const wolofGiven = new Set(pools[0].given);
    const wolofFamily = new Set(pools[0].family);
    const sample = (nationCode: string) => {
      const random = seedrandom(`culture:${nationCode}`);
      const names = Array.from({ length: 4000 }, () => personName(random, nationCode, { catalog: lookup }).split(" "));
      const share = (test: (parts: string[]) => boolean) => names.filter(test).length / names.length;
      return {
        consistent: share(([first, last]) => wolofGiven.has(first) === wolofFamily.has(last)),
        wolofGiven: share(([first]) => wolofGiven.has(first)),
        wolofFamily: share(([, last]) => wolofFamily.has(last)),
      };
    };
    // Paired lists never mix cultures.
    expect(sample("MY").consistent).toBe(1);
    // Unequal weights: both marginals hold and cultures agree as often as they can (0.5 + 0.2).
    const singapore = sample("SG");
    expect(Math.abs(singapore.wolofGiven - 0.5)).toBeLessThan(0.03);
    expect(Math.abs(singapore.wolofFamily - 0.8)).toBeLessThan(0.03);
    expect(Math.abs(singapore.consistent - 0.7)).toBeLessThan(0.03);
    // mixRate 1 draws the family culture independently: 0.5 × 0.8 + 0.5 × 0.2.
    const melting = sample("US");
    expect(Math.abs(melting.wolofFamily - 0.8)).toBeLessThan(0.03);
    expect(Math.abs(melting.consistent - 0.5)).toBeLessThan(0.03);
  });

  it("lets British players switch home nation by heritage, not by a second passport", () => {
    const group = identities("home-nations", 4000, "EN", "EN", true);
    const scottish = group.filter((person) => code(person.countryId) === "SCO");
    expect(scottish.length).toBeGreaterThan(15);
    for (const person of scottish) {
      expect(person.identity.heritage.map((entry) => entry.country)).toContain("Scotland");
      expect(person.identity.nationalities?.map((entry) => entry.code)).not.toContain("SCO");
    }
    expect(identities("home-nations", 500, "EN").every((person) => code(person.countryId) === "EN")).toBe(true);
  });

  it("names diaspora returnees in the culture of the nation they represent", () => {
    const wolofGiven = new Set(pools[0].given);
    const group = identities("returnees", 2000, "SN", "FR");
    for (const person of group) {
      expect(code(person.identity.nameOriginCountryId)).toBe("SN");
      expect(SN_FAMILY).toContain(person.name.split(" ").at(-1));
    }
    // Given names come from the country of upbringing 20% of the time, 40% with a French parent.
    const french = group.filter((person) => !wolofGiven.has(person.name.split(" ")[0])).length / group.length;
    expect(french).toBeGreaterThan(0.2);
    expect(french).toBeLessThan(0.38);
  });
});

describe("nationPlaces", () => {
  const lookup = worldCatalog();
  const find = (code: string, name: string) =>
    nationPlaces(lookup, code).curated.find((place) => place.name === name);

  it.skipIf(!lookup.nationByCode("US") || !lookup.nationByCode("AR"))(
    "resolves shared city names to the right state or province",
    () => {
      // admin1 pins Portland to Oregon; Maipú resolves near the other Mendoza cities without one.
      expect(find("US", "Portland")?.lng).toBeLessThan(-120);
      expect(find("AR", "Maipú")?.lng).toBeLessThan(-66);
      for (const nation of lookup.allNations())
        nation.cities.major.forEach((city, index) => {
          if (city.admin1 || city.lat !== undefined)
            expect(nationPlaces(lookup, nation.code).curated[index].lat, city.name).toBeDefined();
        });
    },
  );
});

describe("regional name cultures", () => {
  const lookup = worldCatalog();

  it.skipIf(!lookup.nationByCode("ES")?.names.regional)("draws names from the birthplace region's lists", () => {
    const catalan = new Set(lookup.namePool("uefa-west/catalan")?.family ?? []);
    const share = (region?: string) => {
      const random = seedrandom(`regional:${region ?? "national"}`);
      const families = Array.from({ length: 2000 }, () =>
        personName(random, "ES", { catalog: lookup, ...(region ? { region } : {}) }).split(" ").slice(1),
      );
      return families.filter((parts) => parts.some((part) => catalan.has(part))).length / families.length;
    };
    expect(share("Cataluña")).toBeGreaterThan(0.35);
    expect(share("Madrid")).toBeLessThan(0.15);
    expect(share()).toBeLessThan(0.15);
  });

  it("redraws a name that matches a listed real person", () => {
    // Spanish, Portuguese and Uruguayan pools yield a listed name about 2-4 times per 1,000 draws before the redraw.
    const random = seedrandom("real-person-names");
    for (const code of ["ES", "PT", "UY"].filter((entry) => lookup.nationByCode(entry)))
      for (let index = 0; index < 3000; index++) {
        const name = personName(random, code, { catalog: lookup });
        expect(isRealPersonName(name), `${code}: ${name}`).toBe(false);
      }
  });
});
