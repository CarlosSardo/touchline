import type { Store } from "./db.ts";
import { clubPolicySnapshot, sellerSquadFloor } from "./club-policy.ts";
import { affiliateLoanEndDate, AFFILIATE_LOAN_MIN_STRENGTH, AFFILIATE_SQUAD_CAP } from "./affiliates.ts";
import { starterAffiliateEligible, STARTER_PARTNER_MAX_TIER } from "./club-support.ts";
import { inAdministration, type LifeClub } from "./club-life-context.ts";
import { clubRegistration } from "./registration.ts";
import { activeEmbargoes } from "./sanctions.ts";
import { ownershipSnapshot } from "./ownership.ts";
import { worldNewsBatch, type WorldNewsInput } from "./world-news.ts";
import { clubOf, defaultLoanTerms, playerOf, settingsOf, startLoanSpell } from "./systems.ts";
import { weightedIndex } from "./people.ts";
import { nationByCode } from "../shared/world-catalog/index.ts";
import { addDays, affiliationWillingness, clamp, daysBetween, money, transferWindow } from "../shared/rules.ts";
import type { Club, GameState } from "../shared/types.ts";

export const AFFILIATE_LIFE = {
  /** Partnerships a club wants by reputation. */
  target: (reputation: number) => (reputation >= 75 ? 3 : reputation >= 60 ? 2 : 1),
  /** Weekly chance a club short of its target looks for a partner. */
  seekChance: 0.04,
  /** Partner clubs already in this many agreements are not approached. */
  partnerMaxNetwork: 2,
  reviewDays: 365,
  /** A review ends agreements weaker than this. */
  endStrength: 30,
  /** Chance an agreement that produced no loan at all in a year is not renewed. */
  idleEnd: 0.25,
  loanAges: [17, 21] as const,
  loansPerParent: 1,
  loansPerPass: 25,
  activeLoansPerPair: 3,
  partnerSeniorCap: 28,
} as const;

/** Share of a development loanee's wage the affiliate pays. */
const AFFILIATE_SALARY_SPLIT = 40;
/** Sort weight of a sister-club pathway among affiliate pairs (agreements run 30-85). */
const SISTER_PATHWAY_STRENGTH = 80;
/** Partnership types whose stronger club places development loans with the weaker one. */
const LOAN_TYPES = new Set(["Feeder club", "Development club", "Foreign adaptation club", "Friendly club"]);
/** Associations where a foreign youngster needs a work permit (GBE) a development loan cannot assume. */
const WORK_PERMIT_ASSOCIATIONS = new Set(["EN", "SCO", "WAL", "NIR"]);

interface PartnershipRow {
  id: number;
  club_id: number;
  partner_id: number;
  type: string;
  strength: number;
  data: string;
}

interface PartnershipData {
  since?: string;
  annualFee?: number;
  origin?: string;
  nextReview?: string;
  lastReview?: string;
  reviews?: { date: string; loans: number; score: number | null; growth: number | null; strength: number }[];
  [key: string]: unknown;
}

const association = (club: LifeClub) => clubRegistration(club.code, club.data).association;
const asClub = (club: LifeClub) => ({ ...club, type: "club", data: JSON.stringify(club.data) }) as unknown as Club;

/**
 * Weekly: AI first teams seek, review and end affiliate partnerships, and (in transfer windows) place development
 * loans with their affiliates. The user's club and its agreements stay under the director's control.
 */
export async function affiliateLifecycle(store: Store, state: GameState, random: () => number, clubs: readonly LifeClub[]) {
  const partnerships = await store.all<PartnershipRow>("SELECT id,club_id,partner_id,type,strength,data FROM partnerships ORDER BY id");
  const byId = new Map(clubs.map((club) => [club.id, club]));
  const items: WorldNewsInput[] = [];
  const fees: { payer: number; payee: number; amount: number }[] = [];
  const reviewed = await reviewPartnerships(store, state, random, partnerships, byId, items, fees);
  const formed = await seekPartnerships(store, state, random, clubs, partnerships, items, fees);
  await postFees(store, state, fees);
  const loans = transferWindow(state.date) ? await developmentLoans(store, state, partnerships, byId, items) : 0;
  await worldNewsBatch(store, items);
  return { formed, ended: reviewed.ended, renewed: reviewed.renewed, loans };
}

async function seekPartnerships(
  store: Store,
  state: GameState,
  random: () => number,
  clubs: readonly LifeClub[],
  partnerships: PartnershipRow[],
  items: WorldNewsInput[],
  fees: { payer: number; payee: number; amount: number }[],
) {
  const network = new Map<number, number>();
  const linked = new Set<string>();
  for (const link of partnerships) {
    network.set(link.club_id, (network.get(link.club_id) ?? 0) + 1);
    network.set(link.partner_id, (network.get(link.partner_id) ?? 0) + 1);
    linked.add(`${link.club_id}:${link.partner_id}`).add(`${link.partner_id}:${link.club_id}`);
  }
  const byAssociation = new Map<string, LifeClub[]>();
  for (const club of clubs) byAssociation.set(association(club), [...(byAssociation.get(association(club)) ?? []), club]);
  const balances = new Map(clubs.map((club) => [club.id, club.balance]));
  const rows: (string | number)[][] = [];
  for (const club of clubs) {
    if (club.user || !club.league_id || inAdministration(club) || !starterAffiliateEligible(club)) continue;
    if ((network.get(club.id) ?? 0) >= AFFILIATE_LIFE.target(club.reputation) || random() >= AFFILIATE_LIFE.seekChance) continue;
    const youth = club.philosophy === "Develop and sell" || club.culture === "Development" || club.data.dofPolicy === "youth";
    const abroad = club.tier === 1 && club.reputation >= 65 && random() < 0.3;
    const purpose = abroad ? (random() < 0.5 ? "Foreign adaptation club" : "Scouting club") : youth ? "Development club" : "Feeder club";
    let pool: LifeClub[];
    if (abroad) {
      const links = (nationByCode(club.code)?.nationality.links ?? []).filter((link) => link.code !== club.code && byAssociation.has(link.code));
      if (!links.length) continue;
      const code = links[weightedIndex(links.map((link) => link.weight), random())].code;
      pool = (byAssociation.get(code) ?? []).filter((entry) => entry.tier <= 2);
    } else
      pool = (byAssociation.get(association(club)) ?? []).filter(
        (entry) => entry.tier <= STARTER_PARTNER_MAX_TIER && entry.league_id !== club.league_id && entry.reputation < club.reputation,
      );
    const target = club.reputation - (purpose === "Feeder club" ? 12 : abroad ? 10 : 8);
    const candidates = pool
      .filter(
        (entry) =>
          entry.id !== club.id &&
          !entry.user &&
          !inAdministration(entry) &&
          !linked.has(`${club.id}:${entry.id}`) &&
          (network.get(entry.id) ?? 0) <= AFFILIATE_LIFE.partnerMaxNetwork,
      )
      .sort((a, b) => Math.abs(a.reputation - target) - Math.abs(b.reputation - target) || a.id - b.id)
      .slice(0, 5);
    for (const partner of candidates) {
      const consent = affiliationWillingness(asClub(club), asClub(partner), purpose, network.get(partner.id) ?? 0);
      const balance = balances.get(club.id)!;
      if (!consent.willing || balance < consent.annualFee * 2 || balance - consent.annualFee < club.revenue * 0.1) continue;
      rows.push([
        club.id,
        partner.id,
        purpose,
        clamp(55 + (club.reputation - partner.reputation) / 3, 30, 85),
        JSON.stringify({
          since: state.date,
          annualFee: consent.annualFee,
          loansCompleted: 0,
          affiliate: true,
          origin: "ai",
          nextReview: addDays(state.date, AFFILIATE_LIFE.reviewDays),
          mutualConsent: { clubId: partner.id, score: consent.score, date: state.date, type: purpose },
        }),
      ]);
      fees.push({ payer: club.id, payee: partner.id, amount: consent.annualFee });
      balances.set(club.id, balance - consent.annualFee);
      network.set(club.id, (network.get(club.id) ?? 0) + 1);
      network.set(partner.id, (network.get(partner.id) ?? 0) + 1);
      linked.add(`${club.id}:${partner.id}`).add(`${partner.id}:${club.id}`);
      items.push({
        kind: "affiliate",
        date: state.date,
        clubIds: [club.id, partner.id],
        title: `${club.name} agree a ${purpose.toLowerCase()} partnership with ${partner.name}`,
        body: `${partner.name} become ${club.name}'s ${purpose.toLowerCase()} for an annual fee of ${money(consent.annualFee)}. ${consent.benefits}`,
        data: { purpose },
      });
      break;
    }
  }
  if (rows.length) {
    const inserted = await store.all<PartnershipRow>(
      "INSERT INTO partnerships(club_id,partner_id,type,strength,data) SELECT * FROM unnest(?::integer[],?::integer[],?::text[],?::double precision[],?::text[]) ON CONFLICT (club_id,partner_id) DO NOTHING RETURNING id,club_id,partner_id,type,strength,data",
      ...[0, 1, 2, 3, 4].map((column) => rows.map((row) => row[column])),
    );
    partnerships.push(...inserted);
  }
  return rows.length;
}

async function reviewPartnerships(
  store: Store,
  state: GameState,
  random: () => number,
  partnerships: PartnershipRow[],
  byId: ReadonlyMap<number, LifeClub>,
  items: WorldNewsInput[],
  fees: { payer: number; payee: number; amount: number }[],
) {
  const due = partnerships.flatMap((link) => {
    const club = byId.get(link.club_id);
    const partner = byId.get(link.partner_id);
    if (!club || !partner || club.user || partner.user) return [];
    const data = JSON.parse(link.data) as PartnershipData;
    if (data.origin === "board") return [];
    // Agreements from before reviews existed are spread over eight weeks after their first anniversary.
    const next = data.nextReview ?? addDays(data.since ?? state.date, AFFILIATE_LIFE.reviewDays + (link.id % 56));
    return next <= state.date ? [{ link, data, club, partner }] : [];
  });
  if (!due.length) return { ended: 0, renewed: 0 };
  const outcomes = new Map(
    (
      await store.all<{ id: number; loans: number; score: number | null; growth: number | null }>(
        `SELECT pair.id, count(loans.id) AS loans, avg(loans.score) AS score,
           avg(players.ability - (loans.data::jsonb ->> 'startingAbility')::double precision) AS growth
         FROM unnest(?::integer[],?::integer[],?::integer[],?::text[]) AS pair(id,club_id,partner_id,since)
         LEFT JOIN loans ON loans.start_date >= pair.since AND loans.parent_id IN (pair.club_id,pair.partner_id)
           AND loans.destination_id IN (pair.club_id,pair.partner_id) AND loans.parent_id <> loans.destination_id
         LEFT JOIN players ON players.id = loans.player_id
         GROUP BY pair.id`,
        due.map((entry) => entry.link.id),
        due.map((entry) => entry.link.club_id),
        due.map((entry) => entry.link.partner_id),
        due.map((entry) => entry.data.lastReview ?? entry.data.since ?? addDays(state.date, -AFFILIATE_LIFE.reviewDays)),
      )
    ).map((row) => [row.id, row]),
  );
  const ended: PartnershipRow[] = [];
  const renewed: { id: number; strength: number; data: string }[] = [];
  for (const { link, data, club, partner } of due) {
    const outcome = outcomes.get(link.id) ?? { loans: 0, score: null, growth: null };
    const change = outcome.loans
      ? clamp(((outcome.score ?? 50) - 50) / 5 + (outcome.growth ?? 0), -10, 10)
      : -10;
    const strength = clamp(link.strength + change, 0, 100);
    const [parent, junior] = club.reputation >= partner.reputation ? [club, partner] : [partner, club];
    const fee = data.annualFee ?? 0;
    const reason =
      strength < AFFILIATE_LIFE.endStrength
        ? "The relationship has not delivered enough for either club."
        : club.league_id !== null && club.league_id === partner.league_id
          ? "The clubs now compete in the same division."
          : inAdministration(club) || club.balance < fee
            ? `${club.name} can no longer fund the agreement.`
            : link.type === "Feeder club" && junior.reputation >= parent.reputation - 2
              ? `${junior.name} have outgrown their role as a feeder club.`
              : !outcome.loans && random() < AFFILIATE_LIFE.idleEnd
                ? "Not a single player moved between the clubs last season."
                : null;
    const review = { date: state.date, loans: outcome.loans, score: outcome.score, growth: outcome.growth, strength };
    if (reason) {
      ended.push(link);
      items.push({
        kind: "affiliate",
        date: state.date,
        clubIds: [club.id, partner.id],
        title: `${club.name} end their partnership with ${partner.name}`,
        body: `${reason} The ${link.type.toLowerCase()} agreement ends after ${Math.max(1, Math.round(daysBetween(data.since ?? state.date, state.date) / 365))} season(s).`,
        data: { purpose: link.type, ...review },
      });
      continue;
    }
    if (fee) fees.push({ payer: club.id, payee: partner.id, amount: fee });
    renewed.push({
      id: link.id,
      strength,
      data: JSON.stringify({
        ...data,
        lastReview: state.date,
        nextReview: addDays(state.date, AFFILIATE_LIFE.reviewDays),
        reviews: [...(data.reviews ?? []), review].slice(-3),
      }),
    });
  }
  if (ended.length) {
    await store.run("DELETE FROM partnerships WHERE id = ANY(?::integer[])", ended.map((link) => link.id));
    await store.run(
      "INSERT INTO history(season,entity_type,entity_id,date,data) SELECT ?::integer,'partnership',ended.club_id,?::text,ended.data FROM unnest(?::integer[],?::text[]) AS ended(club_id,data)",
      state.season,
      state.date,
      ended.map((link) => link.club_id),
      ended.map((link) => JSON.stringify({ event: "ended", partnerId: link.partner_id, type: link.type, strength: link.strength })),
    );
    const gone = new Set(ended.map((link) => link.id));
    partnerships.splice(0, partnerships.length, ...partnerships.filter((link) => !gone.has(link.id)));
  }
  if (renewed.length)
    await store.run(
      "UPDATE partnerships AS target SET strength = changes.strength, data = changes.data FROM unnest(?::integer[],?::double precision[],?::text[]) AS changes(id,strength,data) WHERE target.id = changes.id",
      renewed.map((entry) => entry.id),
      renewed.map((entry) => entry.strength),
      renewed.map((entry) => entry.data),
    );
  return { ended: ended.length, renewed: renewed.length };
}

/** Partnership fees: cash moves at once; the payer's operating costs and the payee's revenue count toward FFP. */
async function postFees(store: Store, state: GameState, fees: readonly { payer: number; payee: number; amount: number }[]) {
  const deltas = new Map<number, { cash: number; revenue: number; operating: number }>();
  const entry = (id: number) => deltas.get(id) ?? deltas.set(id, { cash: 0, revenue: 0, operating: 0 }).get(id)!;
  for (const fee of fees) {
    if (fee.amount <= 0) continue;
    entry(fee.payer).cash -= fee.amount;
    entry(fee.payer).operating += fee.amount;
    entry(fee.payee).cash += fee.amount;
    entry(fee.payee).revenue += fee.amount;
  }
  if (!deltas.size) return;
  const ids = [...deltas.keys()];
  const values = [...deltas.values()];
  await store.run(
    "UPDATE clubs AS target SET balance = target.balance + changes.cash, income = target.income + changes.revenue, spending = target.spending + changes.operating FROM unnest(?::integer[],?::double precision[],?::double precision[],?::double precision[]) AS changes(id,cash,revenue,operating) WHERE target.id = changes.id",
    ids,
    values.map((value) => value.cash),
    values.map((value) => value.revenue),
    values.map((value) => value.operating),
  );
  await store.run(
    `INSERT INTO financial_periods (club_id, season, revenue, operating)
     SELECT changes.id, ?::integer, changes.revenue, changes.operating
     FROM unnest(?::integer[],?::double precision[],?::double precision[]) AS changes(id,revenue,operating)
     ON CONFLICT (club_id, season) DO UPDATE SET revenue = financial_periods.revenue + EXCLUDED.revenue,
       operating = financial_periods.operating + EXCLUDED.operating`,
    state.season,
    ids,
    values.map((value) => value.revenue),
    values.map((value) => value.operating),
  );
}

/**
 * In transfer windows: young players a parent club cannot give first-team football (outside its best 18 or clearly
 * below its level) who would play at the affiliate go there on a development loan through the regular loan machinery
 * (loan record, registration move, wage split); multi-club groups do the same with their weaker sister clubs.
 * Cross-border placements need an adult player and no work permit; an embargoed club receives none.
 */
async function developmentLoans(
  store: Store,
  state: GameState,
  partnerships: readonly PartnershipRow[],
  byId: ReadonlyMap<number, LifeClub>,
  items: WorldNewsInput[],
) {
  // A club under a registration embargo (sanction or administration) cannot register a loanee.
  const embargoes = await activeEmbargoes(store, state.date);
  const pairs = partnerships.flatMap((link) => {
    const a = byId.get(link.club_id);
    const b = byId.get(link.partner_id);
    if (!a || !b || a.user || b.user || !LOAN_TYPES.has(link.type) || link.strength < AFFILIATE_LOAN_MIN_STRENGTH) return [];
    const [parent, partner] = a.reputation >= b.reputation ? [a, b] : [b, a];
    return embargoes.has(partner.id) ? [] : [{ parent, partner, strength: link.strength, sister: false }];
  });
  // Multi-club groups use their weaker first teams as a development pathway, with or without an affiliate agreement.
  const paired = new Set(pairs.map((pair) => `${pair.parent.id}:${pair.partner.id}`));
  const ownership = await ownershipSnapshot(store);
  for (const info of ownership.values()) {
    const parent = byId.get(info.clubId);
    if (!parent || parent.user || info.groupId === null || info.blindTrust) continue;
    for (const sisterId of info.groupClubIds) {
      const partner = byId.get(sisterId);
      if (!partner || partner.user || partner.reputation >= parent.reputation || ownership.get(sisterId)?.blindTrust) continue;
      if (embargoes.has(partner.id) || paired.has(`${parent.id}:${partner.id}`)) continue;
      pairs.push({ parent, partner, strength: SISTER_PATHWAY_STRENGTH, sister: true });
    }
  }
  if (!pairs.length) return 0;
  const clubIds = [...new Set(pairs.flatMap((pair) => [pair.parent.id, pair.partner.id]))];
  const squads = new Map<number, number[]>();
  for (const row of await store.all<{ club_id: number; ability: number }>(
    "SELECT playing_club_id AS club_id,ability FROM players WHERE playing_club_id = ANY(?::integer[]) AND age_group = 'Senior' AND role <> 'Retired' ORDER BY playing_club_id,ability DESC",
    clubIds,
  ))
    squads.set(row.club_id, [...(squads.get(row.club_id) ?? []), row.ability]);
  const active = new Map(
    (
      await store.all<{ parent_id: number; destination_id: number; total: number }>(
        "SELECT parent_id,destination_id,count(*) AS total FROM loans WHERE status = 'active' AND parent_id = ANY(?::integer[]) GROUP BY parent_id,destination_id",
        [...new Set(pairs.map((pair) => pair.parent.id))],
      )
    ).map((row) => [`${row.parent_id}:${row.destination_id}`, row.total]),
  );
  const loanEnd = affiliateLoanEndDate(state.date, "season");
  const candidates = await store.all<{ id: number; club_id: number; ability: number; potential: number; age: number }>(
    `SELECT id,club_id,ability,potential,age FROM players
     WHERE club_id = ANY(?::integer[]) AND parent_club_id IS NULL AND squad_club_id IS NULL AND age_group = 'Senior'
       AND age BETWEEN ? AND ? AND role <> 'Retired' AND listed = 0 AND injury_until IS NULL AND contract_end > ?
       AND potential >= ability + 5
       AND NOT EXISTS (SELECT 1 FROM negotiations WHERE negotiations.player_id = players.id
         AND negotiations.stage NOT IN ('Completed','Rejected','Withdrawn','Expired','Hijacked'))
     ORDER BY club_id,potential DESC,id`,
    [...new Set(pairs.map((pair) => pair.parent.id))],
    AFFILIATE_LIFE.loanAges[0],
    AFFILIATE_LIFE.loanAges[1],
    loanEnd,
  );
  const byParent = new Map<number, typeof candidates>();
  for (const player of candidates) byParent.set(player.club_id, [...(byParent.get(player.club_id) ?? []), player]);
  const level = (clubId: number) => squads.get(clubId)?.[10] ?? 0;
  const policies = await clubPolicySnapshot(store, state.date);
  const ffp = (await settingsOf(store)).ffp !== false;
  const placed = new Set<number>();
  const sent = new Map<number, number>();
  let total = 0;
  for (const { parent, partner, sister } of pairs.sort((a, b) => b.strength - a.strength || a.parent.id - b.parent.id)) {
    if (total >= AFFILIATE_LIFE.loansPerPass) break;
    const parentSquad = squads.get(parent.id) ?? [];
    const partnerSquad = squads.get(partner.id) ?? [];
    const key = `${parent.id}:${partner.id}`;
    const crossBorder = association(parent) !== association(partner);
    if (crossBorder && WORK_PERMIT_ASSOCIATIONS.has(association(partner))) continue;
    for (const candidate of byParent.get(parent.id) ?? []) {
      if ((sent.get(parent.id) ?? 0) >= AFFILIATE_LIFE.loansPerParent || (active.get(key) ?? 0) >= AFFILIATE_LIFE.activeLoansPerPair) break;
      if (partnerSquad.length >= Math.min(AFFILIATE_LIFE.partnerSeniorCap, AFFILIATE_SQUAD_CAP)) break;
      // As in the world market: in the winter window the parent keeps its first-team minimum.
      if (parentSquad.length - (sent.get(parent.id) ?? 0) <= sellerSquadFloor(state.date)) break;
      if (placed.has(candidate.id) || (crossBorder && candidate.age < 18)) continue;
      const rank = parentSquad.indexOf(candidate.ability);
      const surplus = rank >= 18 || candidate.ability < level(parent.id) - 4;
      if (!surplus || candidate.ability < level(partner.id) - 6) continue;
      const player = await playerOf(store, candidate.id);
      // The borrower's share of the wage must fit its FFP headroom, as for any signing.
      const policy = policies.get(partner.id);
      const addedWage = (player.wage * AFFILIATE_SALARY_SPLIT) / 100;
      if (ffp && policy && addedWage * 52 > policy.ffpHeadroom) continue;
      if (policy) {
        policy.ffpHeadroom -= addedWage * 52;
        policy.wageRoom -= addedWage;
        policy.weeklyWages += addedWage;
      }
      const borrower = await clubOf(store, partner.id);
      await startLoanSpell(store, {
        player,
        parentId: parent.id,
        borrower,
        type: "Development loan",
        startDate: state.date,
        endDate: loanEnd,
        terms: { ...defaultLoanTerms(player, borrower), fee: 0, salarySplit: AFFILIATE_SALARY_SPLIT, duration: daysBetween(state.date, loanEnd) },
        reason: { code: "development-pathway", text: `Development loan to ${sister ? "sister club" : "affiliate"} ${partner.name}` },
      });
      placed.add(candidate.id);
      partnerSquad.push(candidate.ability);
      sent.set(parent.id, (sent.get(parent.id) ?? 0) + 1);
      active.set(key, (active.get(key) ?? 0) + 1);
      total++;
      if (candidate.potential >= 75)
        items.push({
          kind: "loan",
          date: state.date,
          clubIds: [parent.id, partner.id],
          title: `${parent.name} send ${player.name} to ${sister ? "sister club" : "affiliate"} ${partner.name}`,
          body: `The ${player.age}-year-old ${player.position} joins ${partner.name} on a development loan until ${loanEnd} for regular first-team football.`,
          data: { playerId: player.id, playerName: player.name },
        });
    }
  }
  return total;
}
