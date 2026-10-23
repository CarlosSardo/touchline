import seedrandom from "seedrandom";
import { personName } from "./people.ts";
import { addDays, clamp } from "../shared/rules.ts";

export const OWNER_TYPES = ["local", "billionaire", "state", "private_equity", "members"] as const;
export type OwnerType = (typeof OWNER_TYPES)[number];
type Rng = seedrandom.PRNG;

/** Member control rules: outside investors may not take majority voting control (Germany's 50+1, Sweden/Norway's 51%). */
export const MEMBER_CONTROL: Readonly<Record<string, "50+1" | "51%">> = { DE: "50+1", SE: "51%", NO: "51%" };
/** An owner with this stake has decisive influence over a club (UEFA's multi-club test), so it controls it. */
export const CONTROL_STAKE = 0.4;

export interface PlanClub {
  id: number;
  name: string;
  city: string;
  code: string;
  countryName: string;
  language: string;
  tier: number | null;
  reputation: number;
  founded: number | null;
  key: string;
}

export interface PlanCountry {
  id: number;
  code: string;
  name: string;
  capital: string;
}

export interface OwnerSeed {
  id: number;
  name: string;
  type: OwnerType;
  country_id: number | null;
  wealth: number;
  ambition: number;
  patience: number;
  data: Record<string, unknown>;
}

export interface OwnershipSeed {
  club_id: number;
  owner_id: number;
  stake: number;
  since: string;
  member_owned: boolean;
  president: string | null;
  next_election: string | null;
  data: Record<string, unknown>;
}

interface GroupSlot {
  code: string;
  tier: number;
  /** Rank band within the country's tier (0 = strongest club, 1 = weakest). */
  band: [number, number];
  stake?: number;
}

export interface GroupSpec {
  key: string;
  name: string;
  type: Exclude<OwnerType, "members" | "local">;
  home: string;
  wealth: number;
  ambition: number;
  patience: number;
  /** Chance the group structures a blind trust before the UEFA deadline when two clubs are in contention. */
  blindTrust: number;
  slots: GroupSlot[];
}

/** Fictional multi-club groups modelled on real structures (state-backed network, drinks brand, US private equity...). */
export const GROUPS: readonly GroupSpec[] = [
  {
    key: "crescent",
    name: "Crescent Global Football",
    type: "state",
    home: "AE",
    wealth: 900e9,
    ambition: 95,
    patience: 75,
    blindTrust: 0.95,
    slots: [
      { code: "EN", tier: 1, band: [0, 0.3] },
      { code: "ES", tier: 1, band: [0.3, 0.7], stake: 0.5 },
      { code: "US", tier: 1, band: [0, 0.6] },
      { code: "AU", tier: 1, band: [0, 0.6] },
      { code: "JP", tier: 1, band: [0.2, 0.8] },
      { code: "FR", tier: 2, band: [0, 0.5] },
      { code: "BE", tier: 1, band: [0.3, 0.8] },
      { code: "UY", tier: 1, band: [0.2, 0.8] },
      { code: "IN", tier: 1, band: [0, 0.6] },
      { code: "BR", tier: 2, band: [0, 0.5] },
      { code: "IT", tier: 2, band: [0, 0.5] },
      { code: "CN", tier: 1, band: [0.3, 0.8] },
    ],
  },
  {
    key: "volt",
    name: "Volt Energy Football",
    type: "billionaire",
    home: "AT",
    wealth: 25e9,
    ambition: 85,
    patience: 60,
    blindTrust: 0.8,
    slots: [
      { code: "AT", tier: 1, band: [0, 0.25] },
      { code: "US", tier: 1, band: [0.2, 0.7] },
      { code: "BR", tier: 1, band: [0.3, 0.8] },
      { code: "JP", tier: 2, band: [0, 0.5] },
      { code: "FR", tier: 2, band: [0.2, 0.8] },
    ],
  },
  {
    key: "harbor",
    name: "Harbor Point Capital",
    type: "private_equity",
    home: "US",
    wealth: 40e9,
    ambition: 60,
    patience: 45,
    blindTrust: 0.6,
    slots: [
      { code: "EN", tier: 1, band: [0.3, 0.8] },
      { code: "FR", tier: 1, band: [0.2, 0.6] },
      { code: "PT", tier: 1, band: [0.25, 0.7] },
      { code: "BE", tier: 1, band: [0.2, 0.6] },
      { code: "IT", tier: 1, band: [0.4, 0.9] },
      { code: "ES", tier: 2, band: [0, 0.5] },
    ],
  },
  {
    key: "eaglecrest",
    name: "Eagle Crest Holdings",
    type: "billionaire",
    home: "US",
    wealth: 3e9,
    ambition: 75,
    patience: 35,
    blindTrust: 0.3,
    slots: [
      { code: "EN", tier: 1, band: [0.5, 1], stake: 0.45 },
      { code: "FR", tier: 1, band: [0, 0.3] },
      { code: "BR", tier: 1, band: [0, 0.4] },
      { code: "BE", tier: 1, band: [0.3, 0.8] },
    ],
  },
  {
    key: "lionheart",
    name: "Lionheart Sports Partners",
    type: "private_equity",
    home: "US",
    wealth: 60e9,
    ambition: 70,
    patience: 50,
    blindTrust: 0.7,
    slots: [
      { code: "IT", tier: 1, band: [0, 0.3] },
      { code: "FR", tier: 1, band: [0.4, 0.9] },
      { code: "EN", tier: 2, band: [0, 0.6] },
    ],
  },
  {
    key: "altamira",
    name: "Grupo Altamira",
    type: "billionaire",
    home: "MX",
    wealth: 6e9,
    ambition: 65,
    patience: 55,
    blindTrust: 0.5,
    slots: [
      { code: "MX", tier: 1, band: [0, 0.5] },
      { code: "MX", tier: 1, band: [0.3, 0.9] },
      { code: "ES", tier: 2, band: [0.3, 0.9] },
      { code: "UY", tier: 1, band: [0.5, 1] },
    ],
  },
  {
    key: "pacificstar",
    name: "Pacific Star Sports",
    type: "billionaire",
    home: "CN",
    wealth: 12e9,
    ambition: 70,
    patience: 40,
    blindTrust: 0.4,
    slots: [
      { code: "CN", tier: 1, band: [0, 0.4] },
      { code: "ES", tier: 1, band: [0.5, 1] },
      { code: "EN", tier: 2, band: [0.3, 0.9] },
      { code: "NL", tier: 1, band: [0.4, 0.9] },
    ],
  },
  {
    key: "gulfsif",
    name: "Gulf Sports Investment Fund",
    type: "state",
    home: "SA",
    wealth: 700e9,
    ambition: 92,
    patience: 70,
    blindTrust: 0.9,
    slots: [
      { code: "SA", tier: 1, band: [0, 0.25], stake: 0.75 },
      { code: "SA", tier: 1, band: [0, 0.25], stake: 0.75 },
      { code: "SA", tier: 1, band: [0, 0.35], stake: 0.75 },
      { code: "SA", tier: 1, band: [0, 0.35], stake: 0.75 },
      { code: "EN", tier: 1, band: [0.2, 0.6], stake: 0.85 },
    ],
  },
];

/** Governments, regions or state companies own many clubs here (municipal, army, energy-company clubs). */
const STATE_HEAVY: Readonly<Record<string, number>> = {
  RU: 0.5, BY: 0.6, KZ: 0.6, UZ: 0.6, IR: 0.7, IQ: 0.6, QA: 0.9, AE: 0.9, SA: 0.85, DZ: 0.5, EG: 0.3, CN: 0.2,
};
/** Home of the state funds that buy clubs abroad, and the capital their holding is named after. */
export const GULF_CAPITALS: Readonly<Record<string, string>> = { QA: "Doha", AE: "Abu Dhabi", SA: "Riyadh" };
const GULF = Object.keys(GULF_CAPITALS);
/** Typical presidential term at member-owned clubs (years). */
const TERM_YEARS: Readonly<Record<string, number>> = { ES: 4, PT: 4, DE: 4, AR: 4, BR: 3, TR: 3, SE: 2, NO: 2, UY: 3, PY: 3 };
export const termYears = (code: string) => TERM_YEARS[code] ?? 4;

const NO_MEMBERS = new Set(["IT", "MX", "US", "CA", "JP", "CN", "KR", "AU", "SA", "QA", "AE", "IN", "ID", "TH", "VN", "PH", "UZ", "IQ", "IR", "RU", "CY", "GR"]);

/** Chance a club is owned by its members (rank 0 = strongest club of its country's tier). */
export function memberShare(code: string, tier: number | null, rank: number): number {
  const level = tier ?? 9;
  if (MEMBER_CONTROL[code]) return 1;
  if (NO_MEMBERS.has(code)) return 0;
  switch (code) {
    case "ES":
      return level === 1 ? (rank < 2 ? 1 : rank < 6 ? 0.25 : 0.05) : level === 2 ? 0.04 : 0.5;
    case "PT":
      return level === 1 ? (rank < 3 ? 1 : 0.15) : level === 2 ? 0.2 : 0.6;
    case "AR":
      return 1;
    case "UY":
    case "PY":
      return 0.85;
    case "BR":
      return level === 1 ? 0.5 : 0.7;
    case "TR":
      return level === 1 ? (rank < 3 ? 1 : 0.2) : 0.3;
    case "EG":
      return level === 1 && rank < 2 ? 1 : 0.3;
    case "EN":
    case "WAL":
    case "NIR":
      return level <= 4 ? 0.01 : 0.08;
    case "SCO":
      return 0.15;
    case "FR":
      return level <= 2 ? 0 : 0.6;
    case "NL":
    case "BE":
      return level === 1 ? 0.1 : 0.4;
    default:
      return level === 1 ? 0.15 : level === 2 ? 0.3 : 0.5;
  }
}

function weighted<Value extends string>(rng: Rng, weights: Partial<Record<Value, number>>): Value {
  const entries = Object.entries(weights) as [Value, number][];
  let roll = rng() * entries.reduce((total, [, weight]) => total + weight, 0);
  for (const [value, weight] of entries) {
    roll -= weight;
    if (roll <= 0) return value;
  }
  return entries.at(-1)![0];
}

/** Ownership type of a club not owned by its members or a group. */
export function privateOwnerType(code: string, tier: number | null, reputation: number, rng: Rng): OwnerType {
  if (rng() < (STATE_HEAVY[code] ?? 0)) return "state";
  const level = tier ?? 9;
  if (level === 1)
    return weighted<OwnerType>(
      rng,
      reputation >= 72
        ? { billionaire: 0.45, private_equity: 0.25, state: 0.07, local: 0.23 }
        : { billionaire: 0.25, private_equity: 0.2, local: 0.55 },
    );
  if (level === 2) return weighted<OwnerType>(rng, { billionaire: 0.15, private_equity: 0.15, local: 0.7 });
  if (level === 3) return weighted<OwnerType>(rng, { billionaire: 0.06, private_equity: 0.05, local: 0.89 });
  return "local";
}

const between = (rng: Rng, low: number, high: number) => low + (high - low) * rng();
const int = (rng: Rng, low: number, high: number) => Math.round(between(rng, low, high));

/** Wealth (GBP), ambition and patience (0-100) of a new owner of a club with this reputation. */
export function ownerProfile(type: OwnerType, reputation: number, rng: Rng, options: { global?: boolean } = {}) {
  const rep = clamp(reputation, 1, 99) / 100;
  switch (type) {
    case "local":
      return {
        // About £4-40M behind a small club, £0.9-9B behind a giant.
        wealth: Math.round(2e6 * 1.07 ** (rep * 100) * Math.exp(rng() * 2.3)),
        ambition: int(rng, 25 + rep * 20, 60 + rep * 20),
        patience: int(rng, 40, 85),
      };
    case "billionaire":
      return { wealth: Math.round(1e9 * Math.exp(rng() * 3.4)), ambition: int(rng, 50, 95), patience: int(rng, 20, 70) };
    case "state":
      return options.global
        ? { wealth: Math.round(between(rng, 1e11, 9e11)), ambition: int(rng, 75, 99), patience: int(rng, 55, 85) }
        : { wealth: Math.round(between(rng, 2e9, 2e10)), ambition: int(rng, 40, 75), patience: int(rng, 50, 85) };
    case "private_equity":
      return { wealth: Math.round(between(rng, 2e9, 5e10)), ambition: int(rng, 40, 75), patience: int(rng, 25, 60) };
    case "members":
      return { wealth: 0, ambition: int(rng, 35 + rep * 25, 60 + rep * 25), patience: int(rng, 45, 85) };
  }
}

const COMPANY_SUFFIXES = ["Holdings", "Group", "Construction", "Logistics", "Properties", "Motors", "Energy", "Foods"];
const FUND_WORDS = ["Ironbridge", "Northgate", "Bluewater", "Granite Peak", "Silverline", "Oakmont", "Harborview", "Keystone", "Stonebridge", "Cedar Point", "Highmoor", "Redcliff", "Westbury", "Lakeshore"];
const FUND_SUFFIXES = ["Capital", "Partners", "Sports Capital", "Investment Partners"];

export function membersName(club: Pick<PlanClub, "name" | "language">) {
  switch (club.language) {
    case "es":
      return `Socios de ${club.name}`;
    case "pt":
      return `Sócios de ${club.name}`;
    case "de":
      return `Mitglieder ${club.name}`;
    default:
      return `${club.name} members' association`;
  }
}

/** A fictional owner name for a new owner of `type` buying in `code` (names never repeat within `used`). */
export function ownerName(
  type: OwnerType,
  input: { code: string; city: string; capital: string; foreignCode?: string },
  rng: Rng,
  used: Set<string>,
): string {
  const surname = (code: string) => personName(rng, code).split(" ").at(-1)!;
  const draw = () => {
    switch (type) {
      case "local":
        return rng() < 0.5 ? `${surname(input.code)} family` : `${input.city} ${COMPANY_SUFFIXES[Math.floor(rng() * COMPANY_SUFFIXES.length)]}`;
      case "billionaire":
        return personName(rng, input.foreignCode ?? input.code);
      case "state":
        return `${input.capital} Sports Holdings`;
      case "private_equity":
        return `${FUND_WORDS[Math.floor(rng() * FUND_WORDS.length)]} ${FUND_SUFFIXES[Math.floor(rng() * FUND_SUFFIXES.length)]}`;
      case "members":
        return `${input.city} supporters' trust`;
    }
  };
  let name = draw();
  for (let attempt = 0; used.has(name) && attempt < 6; attempt++) name = draw();
  for (let suffix = 2; used.has(name); suffix++) if (!used.has(`${name} ${suffix}`)) name = `${name} ${suffix}`;
  used.add(name);
  return name;
}

/** Debt a leveraged buyout left on a club: a share of a reputation-based club value (about £1M at 30, £200M at 90). */
const acquisitionDebt = (reputation: number, share: number) => Math.round(2e5 * 1.08 ** clamp(reputation, 1, 99) * share);

const BILLIONAIRE_ORIGINS = ["US", "EN", "RU", "SA", "AE", "CN", "IN", "BR", "FR", "IT", "DE", "TR", "QA", "MX", "ID"];

export interface PlannedOwnership {
  owners: OwnerSeed[];
  ownership: OwnershipSeed[];
}

/**
 * Deterministic owners for every first team from the world seed: members-owned clubs by country tradition,
 * the fictional multi-club groups, then a private owner per remaining club.
 */
export function planOwnership(seed: string, clubs: readonly PlanClub[], countries: readonly PlanCountry[], date: string): PlannedOwnership {
  const countryOf = new Map(countries.map((country) => [country.code, country]));
  const ranks = new Map<number, number>();
  const byTier = new Map<string, PlanClub[]>();
  for (const club of clubs) {
    const key = `${club.code}:${club.tier ?? 9}`;
    byTier.set(key, [...(byTier.get(key) ?? []), club]);
  }
  for (const list of byTier.values()) {
    list.sort((left, right) => right.reputation - left.reputation || left.id - right.id);
    list.forEach((club, index) => ranks.set(club.id, index));
  }
  const clubRng = (club: PlanClub) => seedrandom(`${seed}:ownership:v1:${club.key}`);
  const owners: OwnerSeed[] = [];
  const ownership: OwnershipSeed[] = [];
  const used = new Set<string>();
  const addOwner = (owner: Omit<OwnerSeed, "id">) => {
    const row = { ...owner, id: owners.length + 1 };
    owners.push(row);
    return row;
  };
  const yearsAgo = (rng: Rng, low: number, high: number) => addDays(date, -Math.round(between(rng, low, high) * 365));
  const members = new Set<number>();
  for (const club of clubs) if (clubRng(club)() < memberShare(club.code, club.tier, ranks.get(club.id)!)) members.add(club.id);
  // German works teams (majority held by a company since before 1999) are the realistic exemption to 50+1.
  const exempt = new Set(
    clubs
      .filter((club) => club.code === "DE" && (club.tier ?? 9) <= 2)
      .map((club) => ({ club, roll: clubRng(club)() }))
      .filter((entry) => entry.roll > 0.8)
      .sort((left, right) => right.roll - left.roll)
      .slice(0, 2)
      .map((entry) => entry.club.id),
  );
  for (const id of exempt) members.delete(id);
  const assigned = new Set<number>();
  const groupRng = seedrandom(`${seed}:ownership:v1:groups`);
  for (const group of GROUPS) {
    const picks: { club: PlanClub; stake: number }[] = [];
    for (const slot of group.slots) {
      const list = (byTier.get(`${slot.code}:${slot.tier}`) ?? []).filter(
        (club) => !members.has(club.id) && !exempt.has(club.id) && !assigned.has(club.id),
      );
      const all = byTier.get(`${slot.code}:${slot.tier}`) ?? [];
      const inBand = list.filter((club) => {
        const share = all.length > 1 ? ranks.get(club.id)! / (all.length - 1) : 0;
        return share >= slot.band[0] && share <= slot.band[1];
      });
      const roll = groupRng();
      const pool = inBand.length ? inBand : list;
      if (!pool.length) continue;
      const club = pool[Math.floor(roll * pool.length)];
      assigned.add(club.id);
      picks.push({ club, stake: slot.stake ?? 1 });
    }
    if (!picks.length) continue;
    used.add(group.name);
    const owner = addOwner({
      name: group.name,
      type: group.type,
      country_id: countryOf.get(group.home)?.id ?? null,
      wealth: group.wealth,
      ambition: group.ambition,
      patience: group.patience,
      data: { group: group.key, blindTrust: group.blindTrust, ...(group.type === "private_equity" ? { holdYears: 7 } : {}) },
    });
    for (const { club, stake } of picks)
      ownership.push({
        club_id: club.id,
        owner_id: owner.id,
        stake,
        since: yearsAgo(groupRng, 1, 12),
        member_owned: false,
        president: null,
        next_election: null,
        data: group.type === "private_equity" ? { debt: acquisitionDebt(club.reputation, 0.25) } : {},
      });
  }
  for (const club of clubs) {
    if (assigned.has(club.id)) continue;
    const rng = clubRng(club);
    rng();
    const country = countryOf.get(club.code);
    const capital = country?.capital ?? club.city;
    if (members.has(club.id)) {
      const profile = ownerProfile("members", club.reputation, rng);
      const owner = addOwner({
        name: membersName(club),
        type: "members",
        country_id: country?.id ?? null,
        ...profile,
        data: { members: Math.round(500 + 150_000 * (clamp(club.reputation, 1, 99) / 100) ** 3 * between(rng, 0.6, 1.4)) },
      });
      const term = termYears(club.code);
      const control = MEMBER_CONTROL[club.code];
      const investor =
        control && (club.tier ?? 9) <= 2 && rng() < 0.35
          ? addOwner({
              name: ownerName("local", { code: club.code, city: club.city, capital }, rng, used),
              type: "local",
              country_id: country?.id ?? null,
              ...ownerProfile("local", club.reputation, rng),
              data: { investor: true },
            })
          : null;
      const investorStake = investor ? Math.round(between(rng, 0.1, 0.49) * 100) / 100 : 0;
      ownership.push({
        club_id: club.id,
        owner_id: owner.id,
        stake: Math.round((1 - investorStake) * 100) / 100,
        since: club.founded ? `${club.founded}-01-01` : yearsAgo(rng, 20, 80),
        member_owned: true,
        president: personName(rng, club.code),
        next_election: addDays(date, 30 + Math.floor(rng() * term * 365)),
        data: {
          termYears: term,
          presidentSince: yearsAgo(rng, 0.5, term),
          ...(control ? { rule: control } : {}),
          ...(investor ? { investors: [{ ownerId: investor.id, name: investor.name, stake: investorStake }] } : {}),
        },
      });
      continue;
    }
    const type = exempt.has(club.id) ? "local" : privateOwnerType(club.code, club.tier, club.reputation, rng);
    const gulf = type === "state" && !STATE_HEAVY[club.code];
    const foreign = type === "billionaire" && rng() < 0.45 ? BILLIONAIRE_ORIGINS[Math.floor(rng() * BILLIONAIRE_ORIGINS.length)] : undefined;
    const home = gulf ? GULF[Math.floor(rng() * GULF.length)] : (foreign ?? club.code);
    const name = exempt.has(club.id)
      ? `${club.city} Werke AG`
      : ownerName(type, { code: club.code, city: club.city, capital: gulf ? GULF_CAPITALS[home] : capital, foreignCode: foreign }, rng, used);
    const profile = ownerProfile(type, club.reputation, rng, { global: gulf });
    const owner = addOwner({
      name,
      type,
      country_id: countryOf.get(home)?.id ?? null,
      ...profile,
      data: type === "private_equity" ? { holdYears: int(rng, 4, 7) } : {},
    });
    ownership.push({
      club_id: club.id,
      owner_id: owner.id,
      stake: type === "local" && rng() < 0.3 ? Math.round(between(rng, 0.51, 0.9) * 100) / 100 : 1,
      since: yearsAgo(rng, 0.5, type === "local" ? 30 : 12),
      member_owned: false,
      president: null,
      next_election: null,
      data: {
        ...(exempt.has(club.id) ? { exemption: "Works team: majority held by its parent company since before 1999 (50+1 exemption)" } : {}),
        ...(type === "private_equity" ? { debt: acquisitionDebt(club.reputation, between(rng, 0.15, 0.4)) } : {}),
      },
    });
  }
  return { owners, ownership };
}
