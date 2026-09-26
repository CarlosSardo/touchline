import { describe, expect, it } from "vitest";
import { WORLD_CATALOG, catalogLookup, clubNameKey } from "./index.ts";
import { REAL_PERSON_NAMES, isRealPersonName, realPersonNameKey } from "./real-names.ts";
import type { NamePool } from "./types.ts";

const lookup = catalogLookup(WORLD_CATALOG);
const pools: NamePool[] = WORLD_CATALOG.files.flatMap((file) => file.namePools);
const listed = Object.values(REAL_PERSON_NAMES).flat();

function mulberry32(seed: number) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let value = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    value = (value + Math.imul(value ^ (value >>> 7), 61 | value)) ^ value;
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

/** Listed people a pool can name on its own: given and family name from the same pool, in either order. */
function producible(pool: NamePool): string[] {
  const given = new Set((pool.given ?? []).map(realPersonNameKey));
  const family = new Set((pool.family ?? []).map(realPersonNameKey));
  return listed.filter((name) => {
    const words = realPersonNameKey(name).split(" ");
    for (let cut = 1; cut < words.length; cut++) {
      const head = words.slice(0, cut).join(" ");
      const tail = words.slice(cut).join(" ");
      if ((given.has(head) && family.has(tail)) || (family.has(head) && given.has(tail))) return true;
    }
    return false;
  });
}

describe("real person names", () => {
  it("match regardless of case, accents, name order and an added second family name", () => {
    expect(isRealPersonName("Clarence Seedorf")).toBe(true);
    expect(isRealPersonName("CLARENCE seedorf")).toBe(true);
    expect(isRealPersonName("Dick Ukeiwe")).toBe(true);
    expect(isRealPersonName("Heung-min Son")).toBe(true);
    expect(isRealPersonName("Son Heung-min")).toBe(true);
    expect(isRealPersonName("Sergio Ramos García")).toBe(true);
    expect(isRealPersonName("Clarence Pinas")).toBe(false);
  });

  it("are keyed by catalog nation codes", () => {
    for (const code of Object.keys(REAL_PERSON_NAMES))
      expect(code === "*" || lookup.nationByCode(code) !== undefined, code).toBe(true);
    expect(listed.every((name) => realPersonNameKey(name).length >= 3)).toBe(true);
  });

  it("cannot be drawn from the pools Rai found built from real rosters", () => {
    for (const id of ["concacaf-ofc/surinamese-creole", "concacaf-ofc/papiamento", "concacaf-ofc/kanak"])
      expect(producible(lookup.namePool(id)!), id).toEqual([]);
  });

  it("stay rare in every pool, so re-rolling a real name converges and never returns one", () => {
    const random = mulberry32(7);
    const heavy: string[] = [];
    for (const pool of pools) {
      if (!pool.given?.length || !pool.family?.length) continue;
      let hits = 0;
      for (let draw = 0; draw < 400; draw++) {
        let name = "";
        for (let attempt = 0; attempt < 20 && (!name || isRealPersonName(name)); attempt++) {
          if (name) hits++;
          name = `${pool.given[Math.floor(random() * pool.given.length)]} ${pool.family[Math.floor(random() * pool.family.length)]}`;
        }
        expect(isRealPersonName(name), `${pool.id}: ${name}`).toBe(false);
      }
      if (hits > 8) heavy.push(`${pool.id}: ${hits}/400`);
    }
    expect(heavy).toEqual([]);
  });
});

const RAI_FOUND: Record<string, string[]> = {
  EN: ["Sheffield FC", "Coventry United"],
  SCO: ["Glasgow Rangers"],
  PT: ["Sporting de Lisboa"],
  FR: ["RC Paris", "Racing Paris", "Stade Reims"],
  IT: ["AS Bari", "AC Milano"],
};
const FILLER = new Set(["de", "da", "do", "das", "dos", "di", "del", "della", "du", "des", "la", "le", "el", "the", "of"]);
/** Near-copy key: connectors dropped and a final "o" trimmed (AC Milano ~ AC Milan, Stade Reims ~ Stade de Reims). */
const looseKey = (key: string) =>
  key.split(" ").filter((word) => !FILLER.has(word)).map((word) => (word.length >= 5 ? word.replace(/o$/, "") : word)).join(" ");

describe("club name templates", () => {
  it("avoid the real clubs Rai found", () => {
    for (const [code, names] of Object.entries(RAI_FOUND))
      for (const name of names) expect(lookup.avoidedClubNames(code).has(clubNameKey(name)), `${code} ${name}`).toBe(true);
  });

  it("never yield a near-copy of an avoided real club for any major city or district", () => {
    const copies: string[] = [];
    for (const nation of lookup.allNations()) {
      const naming = nation.football?.clubNaming;
      if (!naming) continue;
      const avoided = lookup.avoidedClubNames(nation.code);
      const loose = new Set([...avoided].map(looseKey));
      for (const city of nation.cities.major) {
        const templates = naming.regional?.find((rule) => rule.regions.includes(city.region))?.templates ?? naming.templates;
        for (const place of [city.name, ...(city.districts ?? [])])
          for (const { pattern } of templates) {
            if (/\{founded2?\}/.test(pattern) || (pattern.includes("{demonym}") && !city.demonym)) continue;
            if (pattern.includes("{cityAdj}") && (!city.adjective || place !== city.name)) continue;
            const name = pattern
              .replace("{city}", place)
              .replace("{region}", city.region)
              .replace("{demonym}", city.demonym ?? "")
              .replace("{cityAdj}", city.adjective ?? "")
              .replace("{of}", (place === city.name && city.preposition) || "de")
              .replace(/\s+/g, " ")
              .trim();
            const key = clubNameKey(name);
            if (!avoided.has(key) && loose.has(looseKey(key))) copies.push(`${nation.code}: ${name}`);
          }
      }
    }
    expect([...new Set(copies)]).toEqual([]);
  });

  it("use Nigeria's Crusaders only in the Christian-majority south", () => {
    const naming = lookup.requireNation("NG").football!.clubNaming;
    const south = ["Rivers", "Edo", "Abia", "Anambra", "Enugu", "Delta", "Akwa Ibom", "Imo", "Cross River", "Bayelsa", "Ebonyi"];
    expect(naming.templates.some((template) => template.pattern.includes("Crusaders"))).toBe(false);
    for (const rule of naming.regional ?? [])
      if (rule.templates.some((template) => template.pattern.includes("Crusaders")))
        expect(rule.regions.filter((region) => !south.includes(region))).toEqual([]);
  });
});
