import seedrandom from "seedrandom";
import { z } from "zod";
import type { Store } from "./db.ts";
import { personName, weightedIndex } from "./people.ts";
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

export async function ensureClubSupport(store: Store) {
  if (!(await store.get("SELECT [key] FROM meta WHERE [key] = 'state'")))
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
      "UPDATE partnerships SET data = JSON_MODIFY(data,'$.since',coalesce(JSON_VALUE(data,'$.established'),?)) WHERE JSON_VALUE(data,'$.origin') = 'initial' AND JSON_VALUE(data,'$.since') IS NULL",
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
      if (linked.has(club.id)) continue;
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
      await store.run(
        "INSERT INTO staff(club_id,name,role,ability,influence,communication,tactical_knowledge,personality,ambition,morale,wage,data) SELECT incoming.club_id,incoming.name,incoming.role,incoming.ability,incoming.influence,incoming.communication,incoming.tactical_knowledge,incoming.personality,incoming.ambition,incoming.morale,incoming.wage,incoming.data FROM OPENJSON(?) WITH (club_id int '$[0]',name nvarchar(256) '$[1]',role nvarchar(80) '$[2]',ability int '$[3]',influence int '$[4]',communication int '$[5]',tactical_knowledge int '$[6]',personality nvarchar(80) '$[7]',ambition int '$[8]',morale float '$[9]',wage float '$[10]',data nvarchar(max) '$[11]') AS incoming WHERE NOT EXISTS (SELECT 1 FROM staff WITH (UPDLOCK,HOLDLOCK) WHERE staff.club_id = incoming.club_id AND staff.role = incoming.role) ORDER BY incoming.club_id",
        JSON.stringify(assistantRows),
      );
    if (supportRows.length)
      await store.run(
        "INSERT INTO club_support(club_id,duties) SELECT incoming.club_id,incoming.duties FROM OPENJSON(?) WITH (club_id int '$[0]',duties nvarchar(max) '$[1]') AS incoming WHERE NOT EXISTS (SELECT 1 FROM club_support WITH (UPDLOCK,HOLDLOCK) WHERE club_support.club_id = incoming.club_id)",
        JSON.stringify(supportRows),
      );
    if (partnershipRows.length)
      await store.run(
        "INSERT INTO partnerships(club_id,partner_id,type,strength,data) SELECT incoming.club_id,incoming.partner_id,incoming.type,incoming.strength,incoming.data FROM OPENJSON(?) WITH (club_id int '$[0]',partner_id int '$[1]',type nvarchar(80) '$[2]',strength float '$[3]',data nvarchar(max) '$[4]') AS incoming WHERE NOT EXISTS (SELECT 1 FROM partnerships WITH (UPDLOCK,HOLDLOCK) WHERE partnerships.club_id = incoming.club_id AND partnerships.partner_id = incoming.partner_id) ORDER BY incoming.club_id",
        JSON.stringify(partnershipRows),
      );
    const settings = await store.meta<Settings>("settings");
    if (settings.unexpectedEvents === undefined)
      await store.setMeta("settings", {
        ...settings,
        unexpectedEvents: "medium",
      });
  });
}

interface SupportClub extends Club {
  code: string;
  nation_reputation: number;
  tier: number;
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
  return closest(domestic.filter((entry) => entry.id !== club.id), club.reputation - 12);
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
    "SELECT TOP (20) requests.*,preferred.name AS preferred_name,partner.name AS partner_name FROM board_affiliate_requests AS requests LEFT JOIN clubs AS preferred ON preferred.id = requests.preferred_club_id LEFT JOIN clubs AS partner ON partner.id = requests.partner_id WHERE requests.club_id = ? ORDER BY requests.id DESC",
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
    "SELECT TOP (1) * FROM board_affiliate_requests WHERE club_id = ? ORDER BY id DESC",
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
        "SELECT TOP (100) clubs.*,(SELECT count(*) FROM partnerships WHERE partnerships.club_id = clubs.id OR partnerships.partner_id = clubs.id) AS affiliate_count FROM clubs WHERE type = 'club' AND id != ? AND reputation <= ? ORDER BY CASE WHEN (CASE WHEN country_id != ? THEN 1 ELSE 0 END) = ? THEN 0 ELSE 1 END,CASE WHEN league_id = ? THEN 1 ELSE 0 END,abs(reputation - ?),id",
        club.id,
        club.reputation + (request.purpose === "Feeder club" ? 12 : 20),
        club.country_id,
        overseas ? 1 : 0,
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
          "UPDATE partnerships SET data = JSON_MODIFY(JSON_MODIFY(JSON_MODIFY(data,'$.affiliate',CAST(1 AS bit)),'$.origin','board'),'$.boardRequestId',CONVERT(int,?)) WHERE club_id = ? AND partner_id = ?",
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
    "SELECT coalesce(sum(TRY_CONVERT(float, JSON_VALUE(data,'$.spending'))),0) AS total FROM history WHERE entity_type = 'assistantReport' AND entity_id = ? AND date BETWEEN ? AND ?",
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
        "SELECT TOP (20) id,date,data FROM history WHERE entity_type = 'assistantReport' AND entity_id = ? ORDER BY date DESC,id DESC",
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
          "SELECT TOP (3) * FROM players WHERE (club_id IS NULL OR club_id NOT IN (SELECT id FROM clubs WHERE id = ? OR parent_id = ?)) AND parent_club_id IS NULL AND role != 'Retired' AND age BETWEEN 18 AND 25 AND value <= ? AND ability BETWEEN ? AND ? ORDER BY shortlisted DESC,(potential - ability) DESC,ability DESC,id",
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
          `SELECT DISTINCT player_id FROM assignments WHERE player_id IN (${targets.map(() => "?").join(",")}) AND (status = 'active' OR start_date >= ?)`,
          ...targets.map((player) => player.id),
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
      "SELECT TOP (1) * FROM players WHERE club_id = ? AND parent_club_id IS NULL AND role != 'Retired' AND contract_end > ? AND contract_end <= ? AND NOT EXISTS (SELECT 1 FROM negotiations WHERE player_id = players.id AND (stage NOT IN ('Completed','Rejected','Expired','Withdrawn','Hijacked') OR created >= ?)) ORDER BY contract_end,ability DESC,id",
      club.id,
      state.date,
      addDays(state.date, 365),
      addDays(state.date, -30),
    );
    if (player) {
      try {
        const enquiry = await enquire(store, player.id, "Contract renewal");
        await negotiationStep(store, enquiry.id, "formalize");
        const result = await negotiate(store, enquiry.id, {
          fee: 0,
          wage: Math.round(enquiry.wage * 1.25),
          years: player.age >= 30 ? 2 : 3,
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
      "UPDATE roster SET training = plans.training FROM players AS roster CROSS APPLY (VALUES (CASE WHEN roster.injury_until > ? THEN 'Injury rehab' WHEN roster.training = 'Position' THEN 'Position' WHEN roster.age < 21 THEN 'Youth development' WHEN roster.fitness < 65 THEN 'Balanced' ELSE 'Role' END)) AS plans(training) WHERE roster.club_id = ? AND roster.role != 'Retired' AND roster.training != plans.training",
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
      "SELECT TOP (5) loans.player_id,players.name,loans.score,loans.pressure FROM loans JOIN players ON players.id = loans.player_id WHERE loans.parent_id = ? AND loans.status = 'active' AND (loans.score < 50 OR loans.pressure > 60) ORDER BY loans.pressure DESC,loans.id",
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
