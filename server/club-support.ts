import seedrandom from "seedrandom";
import { z } from "zod";
import type { Store } from "./db.ts";
import {
  CAREER_RULES,
  personName,
  staffCareerDefaults,
  staffDevelopment,
  staffMorale,
  staffRetirementChance,
  weightedIndex,
} from "./people.ts";
import { nationByCode } from "../shared/world-catalog/index.ts";
import {
  ASSISTANT_DUTIES,
  ASSISTANT_ROLE,
  DEFAULT_ASSISTANT_DUTIES,
  PARTNERSHIP_TYPES,
  addDays,
  affiliationWillingness,
  clamp,
  dateLabel,
  daysBetween,
  type AssistantDuty,
} from "../shared/rules.ts";
import type {
  Club,
  GameState,
  Negotiation,
  NegotiationData,
  Player,
  Settings,
  Staff,
} from "../shared/types.ts";
import type {
  AffiliateData,
  AffiliateLink,
  AffiliateRequest,
  AssistantAction,
  AssistantData,
} from "../shared/api.ts";
import {
  assignScout,
  clubOf,
  createPartnership,
  enquire,
  GameError,
  negotiate,
  negotiationStep,
  news,
  stateOf,
} from "./systems.ts";
import { assessPlayerInterest } from "./recruitment.ts";

export async function ensureClubSupport(store: Store) {
  if (!(await store.get("SELECT key FROM meta WHERE key = 'state'")))
    return;
  // First teams only: B-teams share their parent's staff and are never affiliates of it.
  const clubs = await store.all<SupportClub>(
    "SELECT clubs.*,countries.code,countries.reputation AS nation_reputation,coalesce(leagues.tier,9) AS tier FROM clubs JOIN countries ON countries.id = clubs.country_id LEFT JOIN leagues ON leagues.id = clubs.league_id WHERE clubs.type = 'club' ORDER BY clubs.reputation DESC,clubs.id",
  );
  if (!clubs.length) return;
  const state = await store.meta<GameState>("state");
  const countries = new Map<number, SupportClub[]>();
  const byCode = new Map<string, SupportClub[]>();
  for (const club of clubs) {
    countries.set(club.country_id, [...(countries.get(club.country_id) ?? []), club]);
    byCode.set(club.code, [...(byCode.get(club.code) ?? []), club]);
  }
  await store.transaction(async () => {
    await store.run(
      "UPDATE partnerships SET data = jsonb_set(data::jsonb,'{since}',to_jsonb(coalesce(data::jsonb ->> 'established',?::text)))::text WHERE data::jsonb ->> 'origin' = 'initial' AND data::jsonb ->> 'since' IS NULL",
      state.date,
    );
    const supported = new Set(
      (
        await store.all<{ club_id: number }>("SELECT club_id FROM club_support")
      ).map((entry) => entry.club_id),
    );
    const staffed = new Set(
      (
        await store.all<{ club_id: number }>(
          "SELECT club_id FROM staff WHERE role = ? AND club_id IS NOT NULL",
          ASSISTANT_ROLE,
        )
      ).map((entry) => entry.club_id),
    );
    const linked = new Set(
      (
        await store.all<{ club_id: number; partner_id: number }>(
          "SELECT club_id,partner_id FROM partnerships",
        )
      ).flatMap((entry) => [entry.club_id, entry.partner_id]),
    );
    const assistantRows: (string | number)[][] = [];
    const supportRows: (string | number)[][] = [];
    const partnershipRows: (string | number)[][] = [];
    for (const club of clubs) {
      if (supported.has(club.id)) continue;
      if (!staffed.has(club.id)) {
        const random = seedrandom(`${state.seed}:assistant:${club.id}`);
        const ability = Math.round(
          clamp(club.reputation + random() * 16 - 5, 25, 95),
        );
        assistantRows.push([
          club.id,
          personName(random, club.code),
          ASSISTANT_ROLE,
          ability,
          55,
          Math.round(clamp(ability + 10)),
          ability,
          "Methodical",
          55,
          75,
          Math.round(ability ** 2 * 0.4),
          JSON.stringify({
            bias: "Youth",
            accuracy: ability,
            detail: Math.min(99, ability + 8),
            riskTolerance: 35,
            preferredRegion: club.country_id,
            development: 0,
            contractEnd: `${state.season + 3}-06-30`,
          }),
        ]);
      }
      supportRows.push([club.id, JSON.stringify(DEFAULT_ASSISTANT_DUTIES)]);
      if (linked.has(club.id) || !starterAffiliateEligible(club)) continue;
      const partner = starterPartner(
        club,
        countries.get(club.country_id) ?? [],
        byCode,
        linked,
        seedrandom(`${state.seed}:affiliate:${club.id}`),
      );
      if (partner) {
        partnershipRows.push([
          club.id,
          partner.id,
          club.reputation >= partner.reputation
            ? "Feeder club"
            : "Development club",
          60,
          JSON.stringify({
            annualFee: 0,
            affiliate: true,
            origin: "initial",
            since: state.date,
          }),
        ]);
        linked.add(club.id);
        linked.add(partner.id);
      }
    }
    if (assistantRows.length)
      await store.exec(
        "INSERT INTO staff(club_id,name,role,ability,influence,communication,tactical_knowledge,personality,ambition,morale,wage,data) SELECT incoming.* FROM unnest(?::integer[],?::text[],?::text[],?::double precision[],?::integer[],?::integer[],?::double precision[],?::text[],?::integer[],?::double precision[],?::double precision[],?::text[]) AS incoming(club_id,name,role,ability,influence,communication,tactical_knowledge,personality,ambition,morale,wage,data) WHERE NOT EXISTS (SELECT 1 FROM staff WHERE staff.club_id = incoming.club_id AND staff.role = incoming.role) ORDER BY incoming.club_id",
        ...columnsOf(assistantRows, 12),
      );
    if (supportRows.length)
      await store.exec(
        "INSERT INTO club_support(club_id,duties) SELECT * FROM unnest(?::integer[],?::text[]) ON CONFLICT (club_id) DO NOTHING",
        ...columnsOf(supportRows, 2),
      );
    if (partnershipRows.length)
      await store.exec(
        "INSERT INTO partnerships(club_id,partner_id,type,strength,data) SELECT incoming.* FROM unnest(?::integer[],?::integer[],?::text[],?::double precision[],?::text[]) AS incoming(club_id,partner_id,type,strength,data) ORDER BY incoming.club_id ON CONFLICT (club_id,partner_id) DO NOTHING",
        ...columnsOf(partnershipRows, 5),
      );
    const settings = await store.meta<Settings>("settings");
    if (settings.unexpectedEvents === undefined)
      await store.setMeta("settings", {
        ...settings,
        unexpectedEvents: "medium",
      });
  });
}

/** Column arrays for an `unnest(...)` insert from row tuples. */
function columnsOf(rows: readonly (string | number)[][], width: number) {
  return Array.from({ length: width }, (_, index) => rows.map((row) => row[index]));
}

interface SupportClub extends Club {
  code: string;
  nation_reputation: number;
  tier: number;
}

/** Deepest league tier whose clubs start with a feeder/development partner (amateur clubs lower down do not). */
export const STARTER_AFFILIATE_MAX_TIER = 4;
/** Deepest tier a starter partner may come from. */
export const STARTER_PARTNER_MAX_TIER = 6;

/** Whether a first team starts the world with an affiliate: professional-level tiers, or a big club in a low tier. */
export function starterAffiliateEligible(club: { tier: number; reputation: number }) {
  return club.tier <= STARTER_AFFILIATE_MAX_TIER || club.reputation >= 55;
}

/**
 * Starter affiliate: usually a domestic club about a level below; about a third of leading top-flight clubs
 * instead partner a club in a heritage-linked nation (France–Senegal, Portugal–Brazil, Spain–Argentina...).
 */
function starterPartner(
  club: SupportClub,
  domestic: readonly SupportClub[],
  byCode: ReadonlyMap<string, readonly SupportClub[]>,
  linked: ReadonlySet<number>,
  random: () => number,
) {
  const closest = (list: readonly SupportClub[], target: number) =>
    [...list].sort(
      (left, right) =>
        Number(linked.has(left.id)) - Number(linked.has(right.id)) ||
        Number(left.league_id === club.league_id) - Number(right.league_id === club.league_id) ||
        Math.abs(left.reputation - target) - Math.abs(right.reputation - target) ||
        left.id - right.id,
    )[0];
  if (club.tier === 1 && club.reputation >= 60 && random() < 0.3) {
    const links = (nationByCode(club.code)?.nationality.links ?? []).filter(
      (link) => link.code !== club.code && byCode.has(link.code),
    );
    if (links.length) {
      const code = links[weightedIndex(links.map((link) => link.weight), random())].code;
      const abroad = byCode.get(code)!.filter((entry) => entry.tier <= 2 && !linked.has(entry.id));
      const stronger = (abroad[0]?.nation_reputation ?? 0) > club.nation_reputation;
      const partner = abroad.length ? closest(abroad, club.reputation + (stronger ? 5 : -15)) : undefined;
      if (partner) return partner;
    }
  }
  return closest(
    domestic.filter((entry) => entry.id !== club.id && entry.tier <= STARTER_PARTNER_MAX_TIER),
    club.reputation - 12,
  );
}

export async function clubAffiliates(
  store: Store,
  clubId: number,
): Promise<AffiliateLink[]> {
  return await store.all<AffiliateLink>(
    "SELECT partnerships.id,partnerships.club_id,clubs.id AS partner_id,partnerships.type,partnerships.strength,partnerships.data,clubs.name,clubs.color,clubs.reputation,countries.name AS country_name,leagues.name AS league_name FROM partnerships JOIN clubs ON clubs.id = CASE WHEN partnerships.club_id = ? THEN partnerships.partner_id ELSE partnerships.club_id END JOIN countries ON countries.id = clubs.country_id LEFT JOIN leagues ON leagues.id = clubs.league_id WHERE partnerships.club_id = ? OR partnerships.partner_id = ? ORDER BY partnerships.strength DESC,clubs.name",
    clubId,
    clubId,
    clubId,
  );
}

export async function affiliateDesk(store: Store): Promise<AffiliateData> {
  const state = await stateOf(store);
  const requests = await store.all<AffiliateRequest>(
    "SELECT requests.*,preferred.name AS preferred_name,partner.name AS partner_name FROM board_affiliate_requests AS requests LEFT JOIN clubs AS preferred ON preferred.id = requests.preferred_club_id LEFT JOIN clubs AS partner ON partner.id = requests.partner_id WHERE requests.club_id = ? ORDER BY requests.id DESC LIMIT 20",
    state.clubId,
  );
  return {
    affiliates: await clubAffiliates(store, state.clubId),
    requests,
    nextRequestDate: requests[0]
      ? addDays(requests[0].requested_date, 28)
      : null,
  };
}

export async function affiliateInterest(
  store: Store,
  partnerId: number,
  purpose: string,
  clubId?: number,
) {
  const club = await clubOf(store, clubId);
  const partner = await clubOf(store, partnerId);
  if (!PARTNERSHIP_TYPES.includes(purpose))
    throw new GameError("Choose a valid affiliation type.");
  const network = await clubAffiliates(store, partnerId);
  const result = affiliationWillingness(club, partner, purpose, network.length);
  if (network.some((link) => link.partner_id === club.id))
    return {
      ...result,
      willing: false,
      stance: "Already affiliated",
      reasons: ["These clubs already have an agreement."],
    };
  return result;
}

export async function requestAffiliate(store: Store, input: unknown) {
  const data = z
    .object({
      purpose: z.enum(PARTNERSHIP_TYPES as [string, ...string[]]),
      partnerId: z.number().int().positive().optional(),
    })
    .parse(input);
  const state = await stateOf(store);
  const previous = await store.get<AffiliateRequest>(
    "SELECT * FROM board_affiliate_requests WHERE club_id = ? ORDER BY id DESC LIMIT 1",
    state.clubId,
  );
  if (previous?.status === "pending")
    throw new GameError("The board is already reviewing an affiliate request.");
  if (previous && daysBetween(previous.requested_date, state.date) < 28)
    throw new GameError(
      `The board will consider another affiliate request from ${dateLabel(addDays(previous.requested_date, 28))}.`,
    );
  if (data.partnerId) {
    const partner = await clubOf(store, data.partnerId);
    if (partner.id === state.clubId || partner.type !== "club")
      throw new GameError(
        "Choose another senior club as the proposed affiliate.",
      );
    if (
      (await clubAffiliates(store, state.clubId)).some(
        (link) => link.partner_id === partner.id,
      )
    )
      throw new GameError("This club is already in your affiliate network.");
  }
  const dueDate = addDays(state.date, 3);
  const id = Number(
    (
      await store.run(
        "INSERT INTO board_affiliate_requests(club_id,purpose,preferred_club_id,requested_date,due_date) VALUES (?,?,?,?,?)",
        state.clubId,
        data.purpose,
        data.partnerId ?? null,
        state.date,
        dueDate,
      )
    ).lastInsertRowid,
  );
  await news(
    store,
    "Board",
    "Affiliate request under review",
    `Your ${data.purpose.toLowerCase()} proposal requires both board funding and the other club's consent. A decision is due on ${dateLabel(dueDate)}. No fee has been paid.`,
    "info",
    "board",
    { affiliateRequestId: id },
  );
  return {
    id,
    message: `Affiliate request submitted. Decision due ${dateLabel(dueDate)}.`,
  };
}

export async function processAffiliateRequests(store: Store) {
  const state = await stateOf(store);
  for (const request of await store.all<AffiliateRequest>(
    "SELECT * FROM board_affiliate_requests WHERE status = 'pending' AND due_date <= ? ORDER BY id",
    state.date,
  )) {
    const club = await clubOf(store, request.club_id);
    const existing = await clubAffiliates(store, club.id);
    const overseas = ["Scouting club", "Foreign adaptation club"].includes(
      request.purpose,
    );
    let partner: Club | undefined;
    let consent: ReturnType<typeof affiliationWillingness> | undefined;
    if (request.preferred_club_id) {
      partner = await clubOf(store, request.preferred_club_id);
      consent = await affiliateInterest(
        store,
        partner.id,
        request.purpose,
        club.id,
      );
    } else {
      const candidates = await store.all<Club & { affiliate_count: number }>(
        "SELECT clubs.*,(SELECT count(*) FROM partnerships WHERE partnerships.club_id = clubs.id OR partnerships.partner_id = clubs.id) AS affiliate_count FROM clubs WHERE type = 'club' AND id != ? AND reputation <= ? ORDER BY CASE WHEN (country_id != ?) = ? THEN 0 ELSE 1 END,CASE WHEN league_id = ? THEN 1 ELSE 0 END,abs(reputation - ?),id LIMIT 100",
        club.id,
        club.reputation + (request.purpose === "Feeder club" ? 12 : 20),
        club.country_id,
        overseas,
        club.league_id,
        Math.max(1, club.reputation - 10),
      );
      for (const candidate of candidates) {
        if (existing.some((link) => link.partner_id === candidate.id)) continue;
        const willingness = affiliationWillingness(
          club,
          candidate,
          request.purpose,
          candidate.affiliate_count,
        );
        if (!willingness.willing) continue;
        partner = candidate;
        consent = willingness;
        break;
      }
    }
    let reason = "";
    let approved = false;
    if (club.board_confidence < 35)
      reason =
        "The board wants to see greater stability in the sporting project before expanding its commitments.";
    else if (existing.length >= 8)
      reason =
        "The board believes the existing affiliate network is large enough for the club's current needs.";
    else if (!partner)
      reason =
        "No suitable club was willing to enter this type of relationship at present.";
    else if (!consent?.willing) {
      reason = `${partner.name} declined the ${request.purpose.toLowerCase()} proposal. ${consent?.reasons.join(" ") ?? "Consent was not confirmed."}`;
    } else if (
      club.balance <
      (100000 + Math.round(partner.reputation ** 2 * 60)) * 2
    )
      reason =
        "The proposed agreement would leave too little cash in reserve. The board has declined the additional commitment.";
    else {
      try {
        await createPartnership(store, partner.id, request.purpose, club.id);
        await store.run(
          "UPDATE partnerships SET data = (data::jsonb || jsonb_build_object('affiliate',true,'origin','board','boardRequestId',?::integer))::text WHERE club_id = ? AND partner_id = ?",
          request.id,
          club.id,
          partner.id,
        );
        approved = true;
        reason = `${partner.name} has agreed to become a ${request.purpose.toLowerCase()}. The board has approved the funding and the agreement is active.`;
      } catch (error) {
        if (!(error instanceof GameError)) throw error;
        reason = error.message;
      }
    }
    await store.run(
      "UPDATE board_affiliate_requests SET status = ?, decision_date = ?, reason = ?, partner_id = ? WHERE id = ?",
      approved ? "approved" : "rejected",
      state.date,
      reason,
      approved ? partner!.id : null,
      request.id,
    );
    if (club.id === state.clubId)
      await news(
        store,
        "Board",
        approved ? "Affiliate request approved" : "Affiliate request declined",
        reason,
        approved ? "success" : "warning",
        "board",
        {
          affiliateRequestId: request.id,
          clubId: approved ? partner!.id : undefined,
        },
      );
  }
}

export async function assistantDesk(store: Store): Promise<AssistantData> {
  const state = await stateOf(store);
  const settings = await store.get<{
    duties: string;
    weekly_budget: number;
    last_run: string | null;
  }>("SELECT * FROM club_support WHERE club_id = ?", state.clubId);
  const spentLastWeek = (await store.get<{ total: number }>(
    "SELECT coalesce(sum(CASE WHEN jsonb_typeof(data::jsonb -> 'spending') = 'number' THEN (data::jsonb -> 'spending')::double precision END),0) AS total FROM history WHERE entity_type = 'assistantReport' AND entity_id = ? AND date BETWEEN ? AND ?",
    state.clubId,
    addDays(state.date, -6),
    state.date,
  ))!.total;
  return {
    assistant:
      (await store.get<Staff>(
        "SELECT * FROM staff WHERE club_id = ? AND role = ?",
        state.clubId,
        ASSISTANT_ROLE,
      )) ?? null,
    duties: {
      ...DEFAULT_ASSISTANT_DUTIES,
      ...JSON.parse(settings?.duties ?? "{}"),
    },
    weeklyBudget: settings?.weekly_budget ?? 5000,
    spentLastWeek,
    lastRun: settings?.last_run ?? null,
    reports: (
      await store.all<{ id: number; date: string; data: string }>(
        "SELECT id,date,data FROM history WHERE entity_type = 'assistantReport' AND entity_id = ? ORDER BY date DESC,id DESC LIMIT 20",
        state.clubId,
      )
    ).map((report) => ({
      id: report.id,
      date: report.date,
      ...JSON.parse(report.data),
    })),
  };
}

export async function configureAssistant(store: Store, input: unknown) {
  const data = z
    .object({
      duties: z.record(
        z.enum(
          ASSISTANT_DUTIES.map((duty) => duty.id) as [
            AssistantDuty,
            ...AssistantDuty[],
          ],
        ),
        z.boolean(),
      ),
      weeklyBudget: z.number().finite().min(0).max(100000),
    })
    .parse(input);
  const state = await stateOf(store);
  if (
    !(await store.get(
      "SELECT id FROM staff WHERE club_id = ? AND role = ?",
      state.clubId,
      ASSISTANT_ROLE,
    ))
  )
    throw new GameError(
      "Recruit a sporting director assistant before delegating duties.",
    );
  await store.run(
    "UPDATE club_support SET duties = ?, weekly_budget = ?, last_run = NULL WHERE club_id = ?",
    JSON.stringify(data.duties),
    data.weeklyBudget,
    state.clubId,
  );
  return {
    message:
      "Assistant duties saved. Delegated tasks will be reviewed from the next day.",
  };
}

export async function processAssistant(store: Store, requested = false) {
  const state = await stateOf(store);
  const desk = await assistantDesk(store);
  const assistant = desk.assistant;
  if (!assistant || state.gameOver || !Object.values(desk.duties).some(Boolean))
    return { message: "No assistant duties are active.", performed: false };
  if (
    await store.get(
      "SELECT id FROM history WHERE entity_type = 'assistantReport' AND entity_id = ? AND date = ?",
      state.clubId,
      state.date,
    )
  )
    return {
      message:
        "Your assistant has already reviewed the delegated duties today.",
      performed: false,
    };
  if (!requested && desk.lastRun && daysBetween(desk.lastRun, state.date) < 7)
    return { performed: false };
  const club = await clubOf(store);
  const actions: AssistantAction[] = [];
  let spending = 0;
  const average = (await store.get<{ ability: number }>(
    "SELECT coalesce(avg(ability),50) AS ability FROM players WHERE club_id = ? AND age_group = 'Senior' AND role != 'Retired'",
    club.id,
  ))!.ability;
  const targets =
    desk.duties.shortlist || desk.duties.scouting
      ? await store.all<Player>(
          "SELECT * FROM players WHERE (club_id IS NULL OR club_id NOT IN (SELECT id FROM clubs WHERE id = ? OR parent_id = ?)) AND parent_club_id IS NULL AND role != 'Retired' AND age BETWEEN 18 AND 25 AND value <= ? AND ability BETWEEN ? AND ? ORDER BY shortlisted DESC,(potential - ability) DESC,ability DESC,id LIMIT 3",
          club.id,
          club.id,
          Math.max(0, club.transfer_budget),
          Math.max(1, average - 8),
          Math.min(99, average + 12),
        )
      : [];
  if (desk.duties.shortlist) {
    for (const player of targets.filter((entry) => !entry.shortlisted)) {
      await store.run(
        "UPDATE players SET shortlisted = 1 WHERE id = ?",
        player.id,
      );
      actions.push({
        duty: "shortlist",
        message: `Shortlisted ${player.name}, ${player.age}, ${player.position}, within the current transfer allocation.`,
        playerId: player.id,
        playerName: player.name,
      });
    }
    if (!actions.some((action) => action.duty === "shortlist"))
      actions.push({
        duty: "shortlist",
        message:
          "The shortlist already covers the affordable targets identified this week.",
      });
  }
  if (desk.duties.scouting) {
    const scouts = await store.all<Staff>(
      "SELECT * FROM staff WHERE club_id = ? AND role = 'Scout' AND NOT EXISTS (SELECT 1 FROM assignments WHERE staff_id = staff.id AND status = 'active') ORDER BY ability DESC,id",
      club.id,
    );
    const recentAssignments = targets.length
      ? await store.all<{ player_id: number }>(
          "SELECT DISTINCT player_id FROM assignments WHERE player_id = ANY(?::integer[]) AND (status = 'active' OR start_date >= ?)",
          targets.map((player) => player.id),
          addDays(state.date, -30),
        )
      : [];
    const assignedPlayers = new Set(
      recentAssignments.map((entry) => entry.player_id),
    );
    const unscouted = targets.filter(
      (player) => !assignedPlayers.has(player.id),
    );
    for (const [index, scout] of scouts.slice(0, 2).entries()) {
      const target = unscouted[index];
      if (
        !target ||
        desk.spentLastWeek + spending + 2500 > desk.weeklyBudget ||
        (await clubOf(store)).balance < 2500
      )
        break;
      await assignScout(store, {
        staffId: scout.id,
        playerId: target.id,
        maxAge: 25,
        budget: Math.max(0, club.transfer_budget),
      });
      spending += 2500;
      actions.push({
        duty: "scouting",
        message: `${scout.name} is assessing ${target.name}.`,
        playerId: target.id,
        playerName: target.name,
        cost: 2500,
      });
    }
    if (!actions.some((action) => action.duty === "scouting"))
      actions.push({
        duty: "scouting",
        message:
          "No new scouting trip was booked: targets, scout availability and the remaining weekly allowance were checked.",
      });
  }
  if (desk.duties.contracts) {
    const player = await store.get<Player>(
      "SELECT * FROM players WHERE club_id = ? AND parent_club_id IS NULL AND role != 'Retired' AND contract_end > ? AND contract_end <= ? AND NOT EXISTS (SELECT 1 FROM negotiations WHERE player_id = players.id AND (stage NOT IN ('Completed','Rejected','Expired','Withdrawn','Hijacked') OR created >= ?)) ORDER BY contract_end,ability DESC,id LIMIT 1",
      club.id,
      state.date,
      addDays(state.date, 365),
      addDays(state.date, -30),
    );
    if (player) {
      try {
        const enquiry = await enquire(store, player.id, "Contract renewal");
        const years = player.age >= 30 ? 2 : 3;
        const formal =
          enquiry.stage === "Rejected"
            ? { stage: "Rejected", message: (JSON.parse(enquiry.data) as NegotiationData).log.at(-1)!.message }
            : await negotiationStep(store, enquiry.id, "formalize");
        // The draft offers the wage the player would accept for his current role, when one exists within the cap.
        const result =
          formal.stage === "Rejected"
            ? formal
            : await negotiate(store, enquiry.id, {
                fee: 0,
                wage:
                  (await assessPlayerInterest(store, player, club, { role: player.role, years }))
                    .wageToAgree ?? Math.round(enquiry.wage * 1.25),
                years,
                role: player.role,
                promises: [],
                signingBonus: 0,
              });
        const saved = (await store.get<Negotiation>(
          "SELECT * FROM negotiations WHERE id = ?",
          enquiry.id,
        ))!;
        const data = JSON.parse(saved.data) as NegotiationData;
        data.preparedBy = {
          id: assistant.id,
          name: assistant.name,
          date: state.date,
        };
        await store.run(
          "UPDATE negotiations SET data = ? WHERE id = ?",
          JSON.stringify(data),
          enquiry.id,
        );
        actions.push({
          duty: "contracts",
          message:
            result.stage === "Contract review"
              ? `Prepared ${player.name}'s renewal. The draft still requires your signature.`
              : result.stage === "Rejected"
                ? `Renewal declined. ${result.message}`
                : `${player.name}'s representatives are still considering the renewal terms.`,
          playerId: player.id,
          playerName: player.name,
          negotiationId: enquiry.id,
        });
      } catch (error) {
        if (!(error instanceof GameError)) throw error;
        actions.push({
          duty: "contracts",
          message: `${player.name}: ${error.message}`,
          playerId: player.id,
          playerName: player.name,
        });
      }
    } else
      actions.push({
        duty: "contracts",
        message: "No expiring contract needs a new renewal approach this week.",
      });
  }
  if (desk.duties.training) {
    const { changes: changed } = await store.run(
      "UPDATE players AS roster SET training = plans.training FROM (SELECT id,CASE WHEN injury_until > ? THEN 'Injury rehab' WHEN training = 'Position' THEN 'Position' WHEN age < 21 THEN 'Youth development' WHEN fitness < 65 THEN 'Balanced' ELSE 'Role' END AS training FROM players WHERE club_id = ? AND role != 'Retired') AS plans WHERE roster.id = plans.id AND roster.training != plans.training",
      state.date,
      club.id,
    );
    actions.push({
      duty: "training",
      message: `Updated ${changed} individual development plans; ongoing position training was retained.`,
    });
  }
  if (desk.duties.loans) {
    const concerns = await store.all<{
      player_id: number;
      name: string;
      score: number;
      pressure: number;
    }>(
      "SELECT loans.player_id,players.name,loans.score,loans.pressure FROM loans JOIN players ON players.id = loans.player_id WHERE loans.parent_id = ? AND loans.status = 'active' AND (loans.score < 50 OR loans.pressure > 60) ORDER BY loans.pressure DESC,loans.id LIMIT 5",
      club.id,
    );
    for (const loan of concerns)
      actions.push({
        duty: "loans",
        message: `${loan.name}'s loan needs attention: success ${Math.round(loan.score)}/100, pressure ${Math.round(loan.pressure)}/100. No recall has been made.`,
        playerId: loan.player_id,
        playerName: loan.name,
      });
    if (!concerns.length)
      actions.push({
        duty: "loans",
        message:
          "No active outgoing loan currently crosses the development-concern thresholds.",
      });
  }
  if (desk.duties.briefings) {
    const summary = (await store.get<{
      players: number;
      injuries: number;
      contracts: number;
    }>(
      "SELECT count(*) AS players,coalesce(sum(CASE WHEN injury_until > ? THEN 1 ELSE 0 END),0) AS injuries,coalesce(sum(CASE WHEN contract_end <= ? THEN 1 ELSE 0 END),0) AS contracts FROM players WHERE club_id = ? AND role != 'Retired'",
      state.date,
      addDays(state.date, 365),
      club.id,
    ))!;
    actions.unshift({
      duty: "briefings",
      message: `${summary.players} players at the club; ${summary.injuries} injured; ${summary.contracts} contracts expire within twelve months.`,
    });
  }
  const reportId = Number(
    (
      await store.run(
        "INSERT INTO history(season,entity_type,entity_id,date,data) VALUES (?,'assistantReport',?,?,?)",
        state.season,
        club.id,
        state.date,
        JSON.stringify({
          name: assistant.name,
          staffId: assistant.id,
          spending,
          actions,
        }),
      )
    ).lastInsertRowid,
  );
  await store.run(
    "UPDATE club_support SET last_run = ? WHERE club_id = ?",
    state.date,
    club.id,
  );
  await news(
    store,
    "Assistant",
    `${assistant.name}: delegated work reviewed`,
    actions.map((action) => action.message).join("\n"),
    "info",
    "staff",
    { assistantReportId: reportId },
  );
  return {
    message: `${assistant.name}'s report is ready.`,
    performed: true,
    spending,
    actions,
  };
}

// ------------------------------------------------------------------ staff careers and scouting knowledge

/** Scouting knowledge (players.knowledge) fades without a fresh report: `perPass` every four weeks down to `floor`. */
export const SCOUTING_KNOWLEDGE_DECAY = { perPass: 2, floor: 25, freshDays: 56 } as const;

export function decayedKnowledge(knowledge: number) {
  const rule = SCOUTING_KNOWLEDGE_DECAY;
  return knowledge <= rule.floor ? knowledge : Math.max(rule.floor, knowledge - rule.perPass);
}

interface StaffData {
  birthYear?: number;
  ceiling?: number;
  contractEnd?: string;
  retired?: boolean;
  preferredRegion?: number;
  [key: string]: unknown;
}

type CareerStaff = Staff & { reputation: number; country_id: number; code: string };

export const staffWage = (ability: number) => Math.round(ability ** 2 * 0.4);
export const contractEndFor = (season: number, random: () => number) => {
  const [min, max] = CAREER_RULES.staff.contractYears;
  return `${season + min + Math.floor(random() * (max - min + 1))}-06-30`;
};

/**
 * Daily: staff contract expiries (bounded batch, only in July-August or on a four-week pass day) and, every four
 * weeks, staff development toward a personal ceiling, ageing and decline, morale reverting to a baseline,
 * retirements, and the decay of unrefreshed scouting knowledge. Staff age, ceiling and contract live in `staff.data`.
 */
export async function processStaffCareers(store: Store) {
  const state = await stateOf(store);
  const row = await store.get<{ value: string }>("SELECT value FROM meta WHERE key = 'staffCareers'");
  const last = row ? (JSON.parse(row.value) as { date: string }).date : null;
  const pass = !last || daysBetween(last, state.date) >= 28;
  if (pass) {
    await store.setMeta("staffCareers", { date: state.date });
    await staffPass(store, state);
  }
  if (pass || ["07", "08"].includes(state.date.slice(5, 7))) await staffExpiries(store, state);
}

async function staffPass(store: Store, state: GameState) {
  const rule = CAREER_RULES.staff;
  const year = Number(state.date.slice(0, 4));
  const rows = await store.all<Staff>("SELECT id,club_id,name,role,ability,ambition,personality,morale,data FROM staff ORDER BY id");
  const updates: { id: number; ability: number; morale: number; data: string }[] = [];
  const retiring: Staff[] = [];
  for (const member of rows) {
    const data = JSON.parse(member.data) as StaffData;
    if (data.retired) continue;
    let changed = false;
    if (typeof data.birthYear !== "number" || typeof data.ceiling !== "number") {
      Object.assign(data, staffCareerDefaults(member, year, seedrandom(`${state.seed}:staff-profile:${member.id}`)));
      // Generation gave every club contract the same end date: spread them over the next four summers.
      if (member.club_id !== null && (!data.contractEnd || data.contractEnd === "2029-06-30"))
        data.contractEnd = `${state.season + 1 + (member.id % 4)}-06-30`;
      changed = true;
    }
    if (member.club_id !== null && !data.contractEnd) {
      data.contractEnd = `${state.season + rule.contractYears[0]}-06-30`;
      changed = true;
    }
    const random = seedrandom(`${state.seed}:staff-career:${member.id}:${state.date}`);
    const age = year - data.birthYear!;
    const yearly = staffRetirementChance(age);
    // The user's staff retire at contract expiry (announced in May) unless they reach the hard limit.
    const own = member.club_id === state.clubId;
    if (yearly >= 1 || (!own && random() < yearly / 13)) {
      retiring.push(member);
      continue;
    }
    const ability = staffDevelopment({ ability: member.ability, ceiling: data.ceiling!, age, ambition: member.ambition }, random());
    const morale = staffMorale(member.morale, member.personality);
    if (changed || ability !== member.ability || morale !== member.morale)
      updates.push({ id: member.id, ability, morale, data: JSON.stringify(data) });
  }
  for (let offset = 0; offset < updates.length; offset += 5000) {
    const batch = updates.slice(offset, offset + 5000);
    await store.run(
      "UPDATE staff AS target SET ability = changes.ability, morale = changes.morale, data = changes.data FROM unnest(?::integer[],?::double precision[],?::double precision[],?::text[]) AS changes(id,ability,morale,data) WHERE changes.id = target.id",
      batch.map((update) => update.id),
      batch.map((update) => update.ability),
      batch.map((update) => update.morale),
      batch.map((update) => update.data),
    );
  }
  if (retiring.length) await retireStaff(store, state, retiring);
  const decay = SCOUTING_KNOWLEDGE_DECAY;
  await store.run(
    "UPDATE players SET knowledge = CASE WHEN knowledge - ? < ? THEN ? ELSE knowledge - ? END WHERE knowledge > ? AND (club_id IS NULL OR club_id NOT IN (SELECT id FROM clubs WHERE id = ? OR parent_id = ?)) AND NOT EXISTS (SELECT 1 FROM reports WHERE reports.player_id = players.id AND reports.date >= ?)",
    decay.perPass,
    decay.floor,
    decay.floor,
    decay.perPass,
    decay.floor,
    state.clubId,
    state.clubId,
    addDays(state.date, -decay.freshDays),
  );
}

/**
 * Staff who stop working. A row nobody's report or assignment points to becomes a new free-pool person (so the pool
 * keeps its size and nothing references the retiree); otherwise it stays as a retired, unemployable record. AI clubs
 * fill the vacancy; the user's club is told.
 */
async function retireStaff(store: Store, state: GameState, members: readonly Staff[]) {
  const codes = new Map(
    (await store.all<{ id: number; code: string }>("SELECT id,code FROM countries")).map((country) => [country.id, country.code]),
  );
  const clubs = new Map(
    (
      await store.all<Club>(
        "SELECT * FROM clubs WHERE id = ANY(?::integer[])",
        [...new Set(members.flatMap((member) => (member.club_id === null ? [] : [member.club_id])))],
      )
    ).map((club) => [club.id, club]),
  );
  const year = Number(state.date.slice(0, 4));
  for (const member of members) {
    const data = JSON.parse(member.data) as StaffData;
    const club = member.club_id === null ? undefined : clubs.get(member.club_id);
    await leaveClub(store, member.id);
    const referenced = (await store.get<{ found: number }>(
      "SELECT CASE WHEN EXISTS (SELECT 1 FROM reports WHERE staff_id = ?) OR EXISTS (SELECT 1 FROM assignments WHERE staff_id = ?) THEN 1 ELSE 0 END AS found",
      member.id,
      member.id,
    ))!.found;
    if (referenced)
      await store.run(
        "UPDATE staff SET ability = 1, data = (jsonb_set(data::jsonb,'{retired}','true') - 'contractEnd')::text WHERE id = ?",
        member.id,
      );
    else {
      const random = seedrandom(`${state.seed}:staff-recycle:${member.id}:${state.date}`);
      const code = codes.get(data.preferredRegion ?? club?.country_id ?? -1) ?? "EN";
      const ability = Math.round(clamp(member.ability - 15 + random() * 20, 25, 90));
      const ambition = 25 + Math.floor(random() * 66);
      const career = staffCareerDefaults({ ability, ambition }, year, random);
      const birthYear = year - (30 + Math.floor(random() * 13));
      await store.run(
        "UPDATE staff SET name = ?, ability = ?, ambition = ?, morale = 70, wage = ?, tactical_knowledge = ?, data = ? WHERE id = ?",
        personName(random, code),
        ability,
        ambition,
        Math.round(ability ** 2 * 0.45),
        Math.round(clamp(ability + random() * 30 - 20)),
        JSON.stringify({ ...data, birthYear, ceiling: Math.max(career.ceiling, ability), contractEnd: undefined, development: 0 }),
        member.id,
      );
    }
    if (!club) continue;
    if (club.id === state.clubId)
      await news(
        store,
        "Staff",
        `${member.name} retires`,
        `${member.name} (${member.role}) has retired at ${year - (data.birthYear ?? year - 66)}. The role is vacant; free staff are available on the Staff page.`,
        "important",
        "staff",
      );
    else await replaceStaff(store, state, club, member.role);
  }
}

/** A staff member leaves his club: backroom relationships and the director's active assignments end with him. */
export async function leaveClub(store: Store, staffId: number) {
  await store.run("UPDATE staff SET club_id = NULL WHERE id = ?", staffId);
  await store.run("DELETE FROM relationships WHERE source_type = 'staff' AND (source_id = ? OR target_id = ?)", staffId, staffId);
  await store.run("UPDATE assignments SET status = 'cancelled' WHERE staff_id = ? AND status = 'active'", staffId);
}

/** An AI club fills a vacancy: the best free candidate of the role within its level, or a newly generated one. */
async function replaceStaff(store: Store, state: GameState, club: Pick<Club, "id" | "reputation" | "country_id">, role: string) {
  const random = seedrandom(`${state.seed}:staff-hire:${club.id}:${role}:${state.date}`);
  const candidate = await store.get<Staff>(
    "SELECT * FROM staff WHERE club_id IS NULL AND role = ? AND data::jsonb ->> 'retired' IS NULL AND ability BETWEEN ? AND ? ORDER BY ability DESC,id LIMIT 1",
    role,
    club.reputation - 20,
    club.reputation + 8,
  );
  const contractEnd = contractEndFor(state.season, random);
  if (candidate) {
    await store.run(
      "UPDATE staff SET club_id = ?, morale = 75, wage = ?, data = jsonb_set(data::jsonb,'{contractEnd}',to_jsonb(?::text))::text WHERE id = ? AND club_id IS NULL",
      club.id,
      staffWage(candidate.ability),
      contractEnd,
      candidate.id,
    );
    return;
  }
  const code = (await store.get<{ code: string }>("SELECT code FROM countries WHERE id = ?", club.country_id))?.code ?? "EN";
  const ability = Math.round(clamp(club.reputation - 20 + random() * 32));
  const ambition = 25 + Math.floor(random() * 66);
  const career = staffCareerDefaults({ ability, ambition }, Number(state.date.slice(0, 4)), random);
  await store.run(
    "INSERT INTO staff(club_id,name,role,ability,influence,communication,tactical_knowledge,personality,ambition,morale,wage,data) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)",
    club.id,
    personName(random, code),
    role,
    ability,
    30 + Math.floor(random() * 61),
    40 + Math.floor(random() * 56),
    Math.round(clamp(ability + random() * 37 - 25)),
    ["Collaborative", "Ambitious", "Reserved", "Outspoken", "Methodical"][Math.floor(random() * 5)],
    ambition,
    75,
    staffWage(ability),
    JSON.stringify({
      bias: ["Youth", "Physical", "Technical", "Home nation", "Reputation"][Math.floor(random() * 5)],
      accuracy: Math.round(clamp(ability + random() * 15 - 5)),
      detail: 45 + Math.floor(random() * 51),
      riskTolerance: 20 + Math.floor(random() * 71),
      preferredRegion: club.country_id,
      development: 0,
      ...career,
      contractEnd,
    }),
  );
}

/** Staff contracts past their end date: the user's are extended (or the veteran retires), AI clubs renew or replace. */
async function staffExpiries(store: Store, state: GameState) {
  const rule = CAREER_RULES.staff;
  const due = await store.all<CareerStaff>(
    `SELECT staff.*,clubs.reputation,clubs.country_id,countries.code FROM staff JOIN clubs ON clubs.id = staff.club_id JOIN countries ON countries.id = clubs.country_id CROSS JOIN LATERAL (SELECT staff.data::jsonb ->> 'contractEnd' AS contract_end) AS terms WHERE terms.contract_end < ? ORDER BY terms.contract_end,staff.id LIMIT ${rule.expiryBatch}`,
    state.date,
  );
  const year = Number(state.date.slice(0, 4));
  const retiring: Staff[] = [];
  for (const member of due) {
    const data = JSON.parse(member.data) as StaffData;
    const random = seedrandom(`${state.seed}:staff-contract:${member.id}:${data.contractEnd}`);
    const age = typeof data.birthYear === "number" ? year - data.birthYear : 50;
    const own = member.club_id === state.clubId;
    if (own ? age >= rule.userRetireAt : random() < staffRetirementChance(age)) {
      retiring.push(member);
      continue;
    }
    if (own || random() < rule.renewChance) {
      const contractEnd = own ? `${state.season + 2}-06-30` : contractEndFor(state.season, random);
      const wage = Math.round(member.wage * rule.renewalRaise);
      await store.run("UPDATE staff SET wage = ?, data = jsonb_set(data::jsonb,'{contractEnd}',to_jsonb(?::text))::text WHERE id = ?", wage, contractEnd, member.id);
      if (own)
        await news(
          store,
          "Staff",
          `${member.name}: contract extended`,
          `${member.name} (${member.role}) stays until ${dateLabel(contractEnd)} on a slightly higher wage.`,
          "info",
          "staff",
        );
      continue;
    }
    await leaveClub(store, member.id);
    await store.run("UPDATE staff SET data = (data::jsonb - 'contractEnd')::text WHERE id = ?", member.id);
    await replaceStaff(store, state, { id: member.club_id!, reputation: member.reputation, country_id: member.country_id }, member.role);
  }
  if (retiring.length) await retireStaff(store, state, retiring);
}
