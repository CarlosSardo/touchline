import { describe, expect, it } from "vitest";
import { planWorld, type PlanClub } from "./world.ts";
import { clubCoreKey, worldCatalog } from "../shared/world-catalog/index.ts";

const lookup = worldCatalog();

describe("real club names (pure)", () => {
  it("share one identity across legal forms, numbers, spellings and word endings, but not across distinctive words", () => {
    const variants = [
      ["Roma Calcio", "AS Roma"],
      ["CD Valencia", "Valencia CF"],
      ["CD Paços de Ferreira", "FC Paços de Ferreira"],
      ["SV Utrecht", "FC Utrecht"],
      ["1. FC Stuttgart", "VfB Stuttgart"],
      ["Birmingham City FC", "Birmingham City"],
      ["City of Birmingham", "Birmingham City"],
      ["Athletic Madrid", "Atlético de Madrid"],
      ["Trabzon FK", "Trabzonspor"],
      ["Helsingborg FF", "Helsingborgs IF"],
      ["Göteborg BoIS", "IFK Göteborg"],
      ["AC Milano 1899", "AC Milan"],
    ];
    for (const [generated, real] of variants) expect(clubCoreKey(generated), generated).toBe(clubCoreKey(real));
    const distinct = [
      ["Birmingham Town", "Birmingham City"],
      ["Leeds Rovers", "Leeds United"],
      ["Valencia Athletic", "Valencia CF"],
      ["Valencia Benimaclet", "Valencia CF"],
      ["Juventud Granada", "Granada CF"],
      ["Stoke Harriers", "Stoke City"],
      ["Eintracht Stuttgart", "Stuttgarter Kickers"],
    ];
    for (const [generated, real] of distinct) expect(clubCoreKey(generated), generated).not.toBe(clubCoreKey(real));
    expect(clubCoreKey("Athletic Club")).toBe("athletic");
  });

  it("block a real club's identity, its demonym and spelled-out forms, and bare places a real club is known by", () => {
    const copies = [
      ["IT", "Roma Calcio"],
      ["ES", "CD Valencia"],
      ["ES", "Real Mallorca"],
      ["ES", "Real Coruña"],
      ["PT", "CD Paços de Ferreira"],
      ["PT", "Sporting Braga"],
      ["NL", "SV Utrecht"],
      ["DE", "1. FC Stuttgart"],
      ["DE", "Kickers Stuttgart"],
      ["EN", "Birmingham City FC"],
      ["EN", "Birmingham FC"],
      ["EN", "Hove Albion"],
      ["EN", "Preston FC", "Preston"],
      // Legal form only: BoIS.
      ["SE", "Göteborg BoIS"],
      ["SE", "Helsingborg BoIS"],
      // The real club goes by the city adjective (Salernitana, Cremonese, Reggina, Sambenedettese).
      ["IT", "Salerno Calcio"],
      ["IT", "SS Cremona"],
      ["IT", "US Reggio Calabria"],
      ["IT", "SS San Benedetto del Tronto"],
      // A district in place of the city keeps the real club's identity word.
      ["AT", "Austria Favoriten"],
      ["DE", "Fortuna Benrath"],
      ["BE", "Standard Rocourt"],
      ["SE", "Syrianska Södertälje"],
      ["SE", "Syrianska Ronna"],
    ];
    for (const [code, name, place] of copies) expect(lookup.copiesRealClub(code, name, place), `${code} ${name}`).toBe(true);
    const fictional = [
      ["EN", "Birmingham Town"],
      ["EN", "Leeds Rovers"],
      ["EN", "Stoke Wanderers"],
      ["EN", "Bexley FC", "Bexley"],
      ["ES", "Racing Valencia"],
      ["DE", "Eintracht Stuttgart"],
      ["DE", "Eintracht Benrath"],
      ["SE", "Syrianska Kiruna"],
    ];
    for (const [code, name, place] of fictional) expect(lookup.copiesRealClub(code, name, place), `${code} ${name}`).toBe(false);
  });

  it("are never copied by the full world, and blocked cities keep a realistic name", () => {
    const plan = planWorld({ structureOnly: true });
    const names = plan.clubs.map((club) => ({ code: club.code, name: String(club.row.name), club }));
    const copies = names.filter(({ code, name, club }) => lookup.copiesRealClub(code, name, String(club.row.city)));
    expect(copies.map(({ code, name }) => `${code}: ${name}`)).toEqual([]);
    // The last resort pads a name with its region and a year ("Granada Andalucía 1929"); identity words and towns come first.
    const padded = names.filter(({ club, name }) => club.region !== club.row.city && /\d$/.test(name) && name.replace(/ \d+$/, "").endsWith(` ${club.region}`));
    expect(padded.map(({ code, name }) => `${code}: ${name}`)).toEqual([]);
  });
});

/** The distinctive part of a club name ("town", "athletic"); "" for a bare place with legal forms (CD Valencia). */
function nameForm(club: PlanClub) {
  const city = lookup.requireNation(club.code).cities.major.find((entry) => entry.name === club.row.city);
  const words = clubCoreKey(String(club.row.name)).split(" ");
  for (const place of [String(club.row.city), ...(city?.districts ?? [])]) {
    const placeWords = clubCoreKey(place).split(" ");
    if (placeWords.every((word) => words.includes(word))) return words.filter((word) => !placeWords.includes(word)).join(" ");
  }
  return words.join(" ");
}

// Nations whose real clubs mostly carry one distinctive word: Club Atlético in the River Plate and the Caribbean, Andorra's few parishes.
const DOMINANT: Record<string, string> = { AR: "athletic", UY: "athletic", DO: "athletic", PR: "athletic", AD: "athletic" };

describe("club name forms (pure)", () => {
  const plan = planWorld({ structureOnly: true });
  const forms = new Map<string, Map<string, number>>();
  for (const club of plan.clubs.filter((entry) => entry.type === "club")) {
    const counts = forms.get(club.code) ?? new Map<string, number>();
    const form = nameForm(club);
    counts.set(form, (counts.get(form) ?? 0) + 1);
    forms.set(club.code, counts);
  }

  it("give England its usual suffixes and keep Alexandra and Harriers rare", () => {
    const england = forms.get("EN")!;
    const total = [...england.values()].reduce((sum, count) => sum + count, 0);
    for (const form of ["town", "united", "city", "rover", "athletic", "wanderer", "albion", "county", "borough"])
      expect(england.get(form) ?? 0, form).toBeGreaterThanOrEqual(3);
    for (const form of ["alexandra", "harrier"]) expect(england.get(form) ?? 0, form).toBeLessThanOrEqual(3);
    expect(Math.max(...england.values()) / total).toBeLessThanOrEqual(0.25);
  });

  it("let no distinctive form dominate a nation unless its real clubs do", () => {
    const heavy: string[] = [];
    for (const [code, counts] of forms) {
      const total = [...counts.values()].reduce((sum, count) => sum + count, 0);
      if (total < 10) continue;
      for (const [form, count] of counts)
        if (form && form !== DOMINANT[code] && count > Math.max(4, Math.ceil(0.35 * total))) heavy.push(`${code}: ${form} ${count}/${total}`);
    }
    expect(heavy).toEqual([]);
  });
});
