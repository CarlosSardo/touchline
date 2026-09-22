import { countries as countryData } from "countries-list";
import seedrandom from "seedrandom";
import { describe, expect, it } from "vitest";
import type { Country } from "../shared/types.ts";
import {
  clubIdentity,
  culturalPersonName,
  identityGenerationNotes,
  namingPools,
  playerBackground,
} from "./world-names.ts";

const countries: Country[] = [
  ...Object.entries(countryData)
    .filter(([code]) => code !== "GB")
    .map(([code, entry]) => ({
      code,
      name: entry.name,
      continent: entry.continent,
      language: entry.languages[0] ?? "en",
      region: entry.capital || entry.name,
    })),
  ...Object.entries({ EN: "England", SCO: "Scotland", WAL: "Wales", NIR: "Northern Ireland" })
    .map(([code, name]) => ({ code, name, continent: "EU", language: "en", region: name })),
].map((entry, index) => ({ ...entry, id: index + 1, confederation: "TEST", reputation: 50 }));

function country(code: string): Country {
  const found = countries.find((entry) => entry.code === code);
  if (!found) throw new Error(`Missing test country: ${code}`);
  return found;
}

function backgrounds(code: string, count: number, catalog = countries) {
  return Array.from({ length: count }, (_, index) =>
    playerBackground(seedrandom(`identity:${code}:${index}`), country(code), catalog),
  );
}

describe("cultural person names", () => {
  it("covers every catalog country and preserves the two-draw name contract", () => {
    for (const entry of countries) {
      const actual = seedrandom(`name:${entry.code}`);
      const expected = seedrandom(`name:${entry.code}`);
      expected();
      expected();
      const name = culturalPersonName(actual, entry);
      expect(name, entry.code).toBe(culturalPersonName(seedrandom(`name:${entry.code}`), entry));
      expect(name, entry.code).not.toMatch(/undefined|null/);
      expect(name.trim().length, entry.code).toBeGreaterThan(2);
      expect(actual(), entry.code).toBe(expected());
      expect(namingPools(entry).pools.every((pool) => pool.given.length && pool.family.length), entry.code).toBe(true);
    }
  });

  it.each(["NG", "IN", "CI", "GW", "MY", "SG", "MU", "FJ", "SR", "BA", "ZW", "LK"])(
    "keeps %s given and family names within the same selected cultural pool",
    (code) => {
      const pools = namingPools(country(code)).pools;
      expect(pools.length).toBeGreaterThan(1);
      const seen = new Set<number>();
      for (let index = 0; index < 160; index++) {
        const seed = `coherent:${code}:${index}`;
        const random = seedrandom(seed);
        const weighted = random() * pools.length;
        const selected = pools[Math.floor(weighted)];
        seen.add(Math.floor(weighted));
        const given = selected.given[Math.floor((weighted % 1) * selected.given.length)];
        const family = selected.family[Math.floor(random() * selected.family.length)];
        expect(culturalPersonName(seedrandom(seed), country(code))).toBe(
          selected.familyFirst ? `${family} ${given}` : `${given} ${family}`,
        );
      }
      expect(seen.size).toBe(pools.length);
    },
  );

  it.each([
    ["SN", "Ndiaye"], ["ML", "Traore"], ["BF", "Ouedraogo"], ["GN", "Diallo"],
    ["CI", "N'Dri"], ["GA", "Nguema"], ["CG", "Mabiala"], ["NE", "Issoufou"],
    ["BJ", "Hounkpatin"], ["TG", "Amouzou"], ["GQ", "Nsue"], ["CF", "Mabide"],
  ])("uses local %s family components despite a French official-language fallback", (code, family) => {
    const pools = namingPools({ ...country(code), language: "fr" });
    expect(pools.source).toBe(`country:${code}`);
    expect(pools.pools.flatMap((pool) => pool.family)).toContain(family);
  });

  it("keeps established Portuguese locales and locally grounded Lusophone African names", () => {
    expect(namingPools(country("PT")).source).toBe("pt_PT");
    expect(namingPools(country("BR")).source).toBe("pt_BR");
    expect(namingPools(country("AO")).pools[0].family).toContain("Quissanga");
    expect(namingPools(country("MZ")).pools[0].family).toContain("Mucavele");
    expect(namingPools(country("CV")).pools[0].family).toContain("Semedo");
    expect(namingPools(country("NG")).pools[0].given).toContain("Oluwaseun");
    expect(namingPools(country("NG")).pools[1].given).toContain("Chinedu");
    expect(namingPools(country("NG")).pools[2].family).toContain("Garba");
  });

  it.each(["JP", "KR", "CN", "VN", "HU", "MN", "KH"])(
    "supports family or parental name first for %s",
    (code) => {
      const pools = namingPools(country(code)).pools;
      expect(pools.every((pool) => pool.familyFirst)).toBe(true);
      const name = culturalPersonName(seedrandom(`order:${code}`), country(code));
      expect(pools.some((pool) => pool.family.some((family) => name.startsWith(`${family} `)))).toBe(true);
    },
  );

  it("retains patronymics without constructing them from unrelated English surnames", () => {
    for (let index = 0; index < 30; index++) {
      expect(culturalPersonName(seedrandom(`iceland:${index}`), country("IS"))).toMatch(/son$/);
      expect(culturalPersonName(seedrandom(`brunei:${index}`), country("BN"))).toContain(" bin ");
    }
    expect(namingPools(country("ET")).pools[0].family).toContain("Tesfaye");
    expect(namingPools(country("SO")).pools[0].family).toContain("Warsame");
  });
});

describe("country-aware club identities", () => {
  it("localizes only incompatible legacy suffixes without changing the club's city", async () => {
    const { localizedLegacyClubName } = await import("./world-names.ts");
    expect(localizedLegacyClubName(country("PT"), "Porto United", "Porto")).toBe("FC Porto");
    expect(localizedLegacyClubName(country("PT"), "FC Porto", "Porto")).toBe("FC Porto");
    expect(localizedLegacyClubName(country("PT"), "Custom Club", "Porto")).toBe("Custom Club");
    expect(localizedLegacyClubName(country("EN"), "Manchester United", "Manchester")).toBe("Manchester United");
    expect(localizedLegacyClubName(country("JP"), "Tokyo United", "Tokyo")).toBe("Tokyo United");
    expect(new Set(Array.from({ length: 30 }, (_, index) =>
      localizedLegacyClubName(country("PT"), "Porto United", "Porto", index),
    )).size).toBe(30);
  });

  it("generates unique club names for every catalog country", () => {
    for (const entry of countries) {
      const clubs = Array.from({ length: 200 }, (_, index) => clubIdentity(entry, index));
      expect(new Set(clubs.map((club) => club.name)).size, entry.code).toBe(clubs.length);
      expect(clubs.every((club) => club.city.trim() && club.shortName.trim()), entry.code).toBe(true);
      expect(clubIdentity(entry, 37), entry.code).toEqual(clubs[37]);
    }
  });

  it("uses Portuguese forms, keeps Porto local, and supplies varied real settlements", () => {
    const portugal = { ...country("PT"), language: "en" };
    expect(clubIdentity(portugal, 1)).toMatchObject({ city: "Porto", name: "SC Porto" });
    const clubs = Array.from({ length: 2400 }, (_, index) => clubIdentity(portugal, index));
    expect(new Set(clubs.map((club) => club.name)).size).toBe(clubs.length);
    expect(new Set(clubs.map((club) => club.city)).size).toBeGreaterThan(60);
    for (const club of clubs) {
      expect(club.name).not.toMatch(/\b(United|City|Town|Athletic|Rovers|Wanderers|Albion)\b/);
      expect(club.name).toMatch(/^(FC |SC |GD |CD |Uniao de |Atletico de |Academico de )| Clube(?: \(\d+\))?$/);
      expect(club.city).not.toMatch(/\b(North|South|East|West|Central|Valley)\b/);
    }
  });

  it("uses national conventions where countries share a language", () => {
    expect(clubIdentity(country("BR"), 0).name).toBe("EC Sao Paulo");
    expect(clubIdentity(country("AO"), 0).name).toBe("Desportivo de Luanda");
    expect(clubIdentity(country("MZ"), 0).name).toBe("Ferroviario de Maputo");
    expect(clubIdentity(country("CV"), 0).name).toBe("Academica de Praia");
    const portugueseCities = new Set(Array.from({ length: 1600 }, (_, index) =>
      clubIdentity(country("PT"), index, ["Lisbon", "Oporto"]).city,
    ));
    expect(portugueseCities.has("Lisboa")).toBe(true);
    expect(portugueseCities.has("Porto")).toBe(true);
    expect(portugueseCities.has("Lisbon")).toBe(false);
    expect(portugueseCities.has("Oporto")).toBe(false);
    for (let index = 0; index < 100; index++) {
      expect(clubIdentity(country("RS"), index).name).not.toMatch(/^(NK|HNK) /);
      expect(clubIdentity(country("CH"), index).name).not.toMatch(/^(VfB|VfL|TSV|FSV) /);
    }
  });

  it.each(["EN", "SCO", "NG", "GH", "ZA", "JP", "KR", "TH"])(
    "retains United in the established football naming conventions of %s",
    (code) => {
      expect(Array.from({ length: 40 }, (_, index) => clubIdentity(country(code), index).name)
        .some((name) => /\bUnited\b/.test(name))).toBe(true);
    },
  );

  it("deduplicates settlement spelling, handles sparse countries and very large indexes without invented years", () => {
    const unknown = { ...country("PT"), code: "ZZ", language: "zz", region: "Fallback" };
    const preferred = ["Sao Bento", "Sa\u0303o Bento", " Rio Novo ", "Rio Novo", "", "   "];
    expect(clubIdentity(unknown, 0, preferred).city).toBe("Sao Bento");
    expect(clubIdentity(unknown, 1, preferred).city).toBe("Rio Novo");
    expect(clubIdentity(unknown, 2, preferred).city).toBe("Sao Bento");
    const clubs = Array.from({ length: 2048 }, (_, index) => clubIdentity(unknown, 1_000_000 + index, preferred));
    expect(new Set(clubs.map((club) => club.name)).size).toBe(clubs.length);
    expect(new Set(clubs.map((club) => club.city))).toEqual(new Set(["Sao Bento", "Rio Novo"]));
    expect(clubs.every((club) => /^(FC |SC )| (FC|SC) \(\d+\)$/.test(club.name))).toBe(true);
    expect(clubs.every((club) => / \(\d+\)$/.test(club.name))).toBe(true);
    expect(clubIdentity(unknown, 0).city).toBe("Fallback");
  });

  it.each([-1, 0.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1])("rejects invalid index %s", (index) => {
    expect(() => clubIdentity(country("PT"), index)).toThrow(RangeError);
  });
});

describe("fictional multinational identities", () => {
  it("maintains complete and distinct identity records throughout the country catalog", () => {
    const byId = new Map(countries.map((entry) => [entry.id, entry]));
    for (const entry of countries) {
      for (const identity of backgrounds(entry.code, 8)) {
        expect(identity.heritage!.reduce((total, origin) => total + origin.percentage, 0), entry.code).toBe(100);
        expect(identity.heritage!.every((origin) => origin.percentage > 0 && Number.isInteger(origin.percentage)), entry.code).toBe(true);
        expect(new Set(identity.heritage!.map((origin) => origin.country)).size, entry.code).toBe(identity.heritage!.length);
        expect(identity.nationalities!.length, entry.code).toBeGreaterThanOrEqual(1);
        expect(identity.nationalities!.length, entry.code).toBeLessThanOrEqual(3);
        expect(new Set(identity.nationalities!.map((origin) => origin.countryId)).size, entry.code).toBe(identity.nationalities!.length);
        expect(identity.nationalities![0].countryId, entry.code).toBe(entry.id);
        expect(identity.internationalCountryId, entry.code).toBe(entry.id);
        expect(identity.nationalities!.every((origin) => origin.basis === "parent"), entry.code).toBe(true);
        expect(identity.heritage!.map((origin) => origin.country), entry.code).toContain(byId.get(identity.nameOriginCountryId!)!.name);
        expect(byId.has(identity.birthCountryId!), entry.code).toBe(true);
        expect(identity.biography, entry.code).toHaveLength(3);
        expect(identity.biography![0], entry.code).toContain("Fictional biography");
        expect(identity.biography![2], entry.code).toContain("Fictional eligibility assumption");
        expect(new Set(identity.languages!.map((language) => language.language)).size, entry.code).toBe(identity.languages!.length);
      }
    }
  });

  it("replays deterministically regardless of catalog order or sporting reputation", () => {
    const portugal = country("PT");
    const identity = playerBackground(seedrandom("replay"), portugal, countries);
    expect(playerBackground(seedrandom("replay"), portugal, [...countries].reverse())).toEqual(identity);
    expect(playerBackground(seedrandom("replay"), { ...portugal, reputation: 99 }, countries)).toEqual(identity);
  });

  it("uses intentional dual and triple rates with weighted Lusophone connections, not census claims", () => {
    const sample = backgrounds("PT", 2000);
    const multiple = sample.filter((identity) => identity.nationalities!.length > 1).length / sample.length;
    const triple = sample.filter((identity) => identity.nationalities!.length === 3).length / sample.length;
    expect(multiple).toBeGreaterThan(0.40);
    expect(multiple).toBeLessThan(0.56);
    expect(triple).toBeGreaterThan(0.09);
    expect(triple).toBeLessThan(0.20);
    const allowed = ["PT", "BR", "CV", "AO", "GW", "MZ", "ST", "FR", "CH", "LU", "ES"].map((code) => country(code).name);
    expect(sample.every((identity) => identity.heritage!.every((origin) => allowed.includes(origin.country)))).toBe(true);
    const countOrigin = (code: string) => sample.filter((identity) => identity.heritage!.some((origin) => origin.country === country(code).name)).length;
    expect(countOrigin("BR")).toBeGreaterThan(countOrigin("ST") * 2);
    for (const code of ["BR", "CV", "AO", "GW", "MZ", "ST"])
      expect(countOrigin(code), code).toBeGreaterThan(0);
    expect(identityGenerationNotes.weights).toContain("not census estimates");
    expect(identityGenerationNotes.eligibility).toContain("employment alone");
  });

  it.each([
    ["FR", "DZ"], ["FR", "SN"], ["DE", "TR"], ["DE", "BA"],
    ["NL", "SR"], ["NL", "CW"], ["EN", "JM"], ["EN", "IE"],
    ["CH", "PT"], ["CH", "AL"], ["LU", "PT"], ["LU", "FR"],
    ["AO", "PT"], ["CV", "PT"], ["BR", "PT"],
  ])("models the documented %s/%s family corridor without arbitrary same-language origins", (homeCode, originCode) => {
    const catalog = [country(homeCode), country(originCode)];
    const sample = backgrounds(homeCode, 80, catalog);
    expect(sample.some((identity) => identity.heritage!.some((origin) => origin.country === country(originCode).name))).toBe(true);
    expect(sample.every((identity) => identity.heritage!.every((origin) => catalog.some((entry) => entry.name === origin.country)))).toBe(true);
    expect(sample.some((identity) => identity.biography![1].includes("fictional history draws on"))).toBe(true);
  });

  it("keeps all three family branches in the parent/grandparent story", () => {
    const catalog = [country("PT"), country("CV"), country("AO")];
    const identity = backgrounds("PT", 100, catalog).find((entry) => entry.nationalities!.length === 3)!;
    expect(identity).toBeDefined();
    expect(identity.heritage!.map((origin) => origin.percentage)).toEqual([50, 25, 25]);
    expect(identity.familyOrigins!.paternal).toBe(country("PT").name);
    for (const origin of identity.heritage!.slice(1)) {
      expect(identity.familyOrigins!.maternal).toContain(origin.country);
      expect(identity.biography![1]).toContain(origin.country);
    }
    expect(identity.biography![1]).toContain("maternal grandparents");
  });

  it("records foreign birth separately without awarding birthplace citizenship", () => {
    const sample = backgrounds("PT", 300);
    const bornAbroad = sample.filter((identity) => identity.birthCountryId !== country("PT").id);
    expect(bornAbroad.length).toBeGreaterThan(20);
    expect(bornAbroad.some((identity) => !identity.nationalities!.some((origin) => origin.countryId === identity.birthCountryId))).toBe(true);
    expect(sample.every((identity) => identity.internationalCountryId === country("PT").id)).toBe(true);
    expect(sample.every((identity) => identity.biography![2].includes("club employment do not grant citizenship"))).toBe(true);
  });

  it.each([
    ["EN", "SCO", "WAL", "NIR"], ["NL", "CW", "AW"],
    ["FR", "GP", "MQ", "RE"], ["NZ", "CK", "NU"],
  ])("does not count shared citizenship associations as extra passports: %s", (...codes) => {
    const catalog = codes.map(country);
    const sample = backgrounds(codes[0], 100, catalog);
    expect(sample.every((identity) => identity.nationalities!.length === 1)).toBe(true);
    expect(sample.some((identity) => identity.heritage!.length > 1)).toBe(true);
  });

  it.each(["JP", "KR", "CN", "HK", "MO", "IN", "SG", "ID", "MY", "BN", "QA", "AE", "SA", "KW", "OM", "BH", "SR", "CM", "CD"])(
    "does not automatically add citizenships in restrictive or unmodeled %s cases",
    (code) => expect(backgrounds(code, 60).every((identity) => identity.nationalities!.length === 1)).toBe(true),
  );

  it.each([["BR", "JP"], ["NL", "SR"], ["FR", "CM"], ["FR", "CD"], ["CA", "IN"], ["NL", "ID"]])(
    "retains %s/%s heritage even when extra citizenship is withheld",
    (homeCode, originCode) => {
      const sample = backgrounds(homeCode, 80, [country(homeCode), country(originCode)]);
      expect(sample.some((identity) => identity.heritage!.length === 2)).toBe(true);
      expect(sample.every((identity) => identity.nationalities!.length === 1)).toBe(true);
      expect(sample.filter((identity) => identity.heritage!.length > 1)
        .every((identity) => identity.biography![2].includes("heritage only"))).toBe(true);
    },
  );

  it("never grants a second nationality just because an available country shares a language", () => {
    const portugal = country("PT");
    const unrelated = { ...country("JP"), language: "pt" };
    for (let index = 0; index < 100; index++) {
      const identity = playerBackground(seedrandom(`language:${index}`), portugal, [portugal, unrelated]);
      expect(identity.heritage).toEqual([{ country: portugal.name, percentage: 100 }]);
      expect(identity.nationalities).toHaveLength(1);
      expect(identity.birthCountryId).toBe(portugal.id);
    }
  });

  it("handles a single-country catalog without missing origins or synthetic citizenships", () => {
    const portugal = country("PT");
    for (const identity of backgrounds("PT", 40, [portugal])) {
      expect(identity.heritage).toEqual([{ country: portugal.name, percentage: 100 }]);
      expect(identity.nationalities).toEqual([{ countryId: portugal.id, code: "PT", country: portugal.name, basis: "parent" }]);
      expect(identity.familyOrigins).toEqual({ maternal: portugal.name, paternal: portugal.name });
      expect(identity.nameOriginCountryId).toBe(portugal.id);
    }
  });
});