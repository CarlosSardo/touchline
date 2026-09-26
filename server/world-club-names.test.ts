import { describe, expect, it } from "vitest";
import { planWorld } from "./world.ts";
import { clubCoreKey, worldCatalog } from "../shared/world-catalog/index.ts";

const lookup = worldCatalog();

describe("real club names (pure)", () => {
  it("share one identity core across club-type words, numbers and word endings", () => {
    const variants = [
      ["Roma Calcio", "AS Roma"],
      ["CD Valencia", "Valencia CF"],
      ["CD Paços de Ferreira", "FC Paços de Ferreira"],
      ["SV Utrecht", "FC Utrecht"],
      ["1. FC Stuttgart", "VfB Stuttgart"],
      ["Birmingham Town", "Birmingham City"],
      ["Real Coruña", "Deportivo de La Coruña"],
      ["Trabzon FK", "Trabzonspor"],
      ["Helsingborg FF", "Helsingborgs IF"],
      ["AC Milano 1899", "AC Milan"],
    ];
    for (const [generated, real] of variants) expect(clubCoreKey(generated), generated).toBe(clubCoreKey(real));
    for (const [generated, real] of [["Valencia Benimaclet", "Valencia CF"], ["Juventud Granada", "Granada CF"], ["Stoke Harriers", "Stoke City"]])
      expect(clubCoreKey(generated), generated).not.toBe(clubCoreKey(real));
    expect(clubCoreKey("Athletic Club")).toBe("athletic club");
    for (const [code, name] of [["IT", "Roma Calcio"], ["ES", "CD Valencia"], ["PT", "CD Paços de Ferreira"], ["NL", "SV Utrecht"], ["DE", "1. FC Stuttgart"]])
      expect(lookup.copiesRealClub(code, name), `${code} ${name}`).toBe(true);
  });

  it("are never copied by the full world, and blocked cities keep a realistic name", () => {
    const plan = planWorld({ structureOnly: true });
    const names = plan.clubs.map((club) => ({ code: club.code, name: String(club.row.name), club }));
    expect(names.filter(({ code, name }) => lookup.copiesRealClub(code, name)).map(({ code, name }) => `${code}: ${name}`)).toEqual([]);
    // The last resort pads a name with its region and a year ("Granada Andalucía 1929"); identity words and towns come first.
    const padded = names.filter(({ club, name }) => club.region !== club.row.city && /\d$/.test(name) && name.replace(/ \d+$/, "").endsWith(` ${club.region}`));
    expect(padded.map(({ code, name }) => `${code}: ${name}`)).toEqual([]);
  });
});
