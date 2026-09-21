import express, {
  type Request,
  type Response,
  type NextFunction,
} from "express";
import { resolve } from "node:path";
import { createReadStream, existsSync } from "node:fs";
import { rm } from "node:fs/promises";
import { pipeline } from "node:stream/promises";
import { z } from "zod";
import { Store } from "./db.ts";
import {
  affiliateDesk,
  affiliateInterest,
  assistantDesk,
  configureAssistant,
  processAssistant,
  requestAffiliate,
} from "./club-support.ts";
import { Saves } from "./saves.ts";
import * as query from "./queries.ts";
import { advance } from "./simulation.ts";
import { assessPlayerInterest, submitMinorApplication } from "./recruitment.ts";
import { mediaFeed } from "./media.ts";
import {
  competitionFavorites,
  favoriteCompetition,
  notificationFeed,
} from "./notifications.ts";
import { resolveUnexpectedEvent, unexpectedEvents } from "./events.ts";
import {
  assignScout,
  clubOf,
  closeNegotiation,
  createPartnership,
  counterIncomingOffer,
  declareInterest,
  enquire,
  exerciseOption,
  exerciseBuyBack,
  experience,
  GameError,
  ledger,
  mediaResponse,
  mentorPlayer,
  negotiate,
  negotiationStep,
  news,
  playerOf,
  promoteYouth,
  movePlayerSquad,
  recallLoan,
  requireOwnPlayer,
  settingsOf,
  squadRole,
  staffAction,
  stateOf,
  transferTermsSchema,
  weeklyWages,
} from "./systems.ts";
import {
  addDays,
  clamp,
  daysBetween,
  LOAN_TYPES,
  PARTNERSHIP_TYPES,
  POSITIONS,
  SETTING_DEFINITIONS,
  TRAINING_TYPES,
} from "../shared/rules.ts";
import type { Club, Negotiation, PlayerProfile } from "../shared/types.ts";
import type { Health, HealthDetails } from "../shared/api.ts";

const idSchema = z.coerce.number().int().positive();
const saveFileSchema = z
  .string()
  .regex(
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.touchline\.gz$/i,
    "Choose a valid portable save slot.",
  );
const loopbackHosts = new Set(["127.0.0.1", "localhost", "::1", "[::1]"]);
const principalSchema = z.object({
  auth_typ: z.literal("aad"),
  claims: z
    .array(
      z.object({
        typ: z.string().max(256),
        val: z.string().max(4096),
      }),
    )
    .max(256),
});

export function readApiConfiguration(
  environment: NodeJS.ProcessEnv = process.env,
) {
  const hosted = Boolean(environment.CONTAINER_APP_NAME?.trim());
  const host = environment.API_HOST ?? (hosted ? "0.0.0.0" : "127.0.0.1");
  const port = Number(environment.PORT ?? environment.API_PORT ?? 3001);
  const requireAuth = environment.REQUIRE_AUTH === "true";
  const ownerObjectId = (environment.OWNER_OBJECT_ID ?? "").toLowerCase();
  const tenantId = (environment.AZURE_TENANT_ID ?? "").toLowerCase();
  const invitedObjectIds = (environment.ALLOWED_USER_OBJECT_IDS ?? "")
    .split(",")
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean);
  const appOrigin = environment.APP_ORIGIN;
  const identifier =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (invitedObjectIds.length > 100 || invitedObjectIds.some((value) => !identifier.test(value)))
    throw new Error("ALLOWED_USER_OBJECT_IDS must contain at most 100 comma-separated Entra object UUIDs.");
  const allowedUserObjectIds = new Set([ownerObjectId, ...invitedObjectIds]);
  if (!host || host.trim() !== host)
    throw new Error("API_HOST must be a hostname or IP address.");
  if (!Number.isInteger(port) || port < 1 || port > 65535)
    throw new Error("PORT or API_PORT must be between 1 and 65535.");
  if (
    environment.REQUIRE_AUTH !== undefined &&
    !["true", "false"].includes(environment.REQUIRE_AUTH)
  )
    throw new Error("REQUIRE_AUTH must be true or false.");
  if ((hosted || !loopbackHosts.has(host)) && !requireAuth)
    throw new Error(
      "Public API binding requires explicit REQUIRE_AUTH=true and hosted authentication.",
    );
  if (
    requireAuth &&
    (!hosted || !identifier.test(ownerObjectId) || !identifier.test(tenantId))
  )
    throw new Error(
      "Hosted authentication requires CONTAINER_APP_NAME, OWNER_OBJECT_ID and AZURE_TENANT_ID.",
    );
  if (requireAuth && !appOrigin)
    throw new Error(
      "Hosted authentication requires APP_ORIGIN as an exact HTTPS origin.",
    );
  if (appOrigin) {
    let origin: URL;
    try {
      origin = new URL(appOrigin);
    } catch {
      throw new Error("APP_ORIGIN must be a valid origin.");
    }
    if (
      origin.origin !== appOrigin ||
      (requireAuth
        ? origin.protocol !== "https:"
        : !["http:", "https:"].includes(origin.protocol) ||
          !loopbackHosts.has(origin.hostname))
    )
      throw new Error(
        "APP_ORIGIN must be an exact HTTPS hosted origin or a local loopback development origin.",
      );
  }
  return {
    host,
    port,
    hosted,
    requireAuth,
    ownerObjectId,
    allowedUserObjectIds,
    tenantId,
    appOrigin,
  };
}

const positive = z.number().finite().min(0);
const roleSchema = z.enum([
  "Captain",
  "Key player",
  "Regular starter",
  "Squad player",
  "Fringe player",
  "Prospect",
]);
const loanTerms = z.object({
  playingTime: z.number().min(0).max(100),
  position: z.enum(POSITIONS),
  role: roleSchema,
  developmentPlan: z.enum(TRAINING_TYPES),
  recall: z.boolean(),
  injuryRecall: z.boolean(),
  salarySplit: z.number().min(0).max(100),
  fee: positive,
  bonus: positive.max(100_000_000),
  mandatoryMinutes: z.number().int().min(0).max(6000),
  tacticalFit: z.number().min(0).max(100),
  managerTrust: z.number().min(0).max(100),
  relationship: z.number().min(0).max(100),
  optionFee: positive.max(1_000_000_000),
  sellOn: z.number().min(0).max(100),
  duration: z.number().int().min(30).max(730),
  obligationCondition: z.enum([
    "Unconditional",
    "Minutes played",
    "Avoid relegation",
  ]),
});

export async function updateSettings(store: Store, input: unknown) {
  const values = z
    .record(z.string(), z.union([z.string(), z.boolean(), z.number()]))
    .parse(input);
  const settings = await settingsOf(store);
  for (const [key, value] of Object.entries(values)) {
    if (key === "cloudSync" || key === "saveCompression") continue;
    const definition = SETTING_DEFINITIONS.find(
      (setting) => setting.id === key,
    );
    if (!definition) throw new GameError(`Unknown setting: ${key}`);
    if (definition.disabled && value !== definition.default)
      throw new GameError("This setting is unavailable.");
    if (definition.type === "toggle" && typeof value !== "boolean")
      throw new GameError(`Invalid value for ${definition.label}.`);
    if (
      definition.type === "select" &&
      !definition.options?.includes(String(value))
    )
      throw new GameError(`Invalid value for ${definition.label}.`);
    if (
      definition.type === "color" &&
      (typeof value !== "string" || !/^#[0-9a-f]{6}$/i.test(value))
    )
      throw new GameError("Choose a valid six-digit accent color.");
    if (
      definition.type === "range" &&
      (typeof value !== "number" ||
        !Number.isFinite(value) ||
        value < definition.min! ||
        value > definition.max!)
    )
      throw new GameError(`Invalid value for ${definition.label}.`);
    settings[key] = value;
  }
  await store.setMeta("settings", settings);
  if (values.directorBackground) {
    const state = await stateOf(store);
    state.director.background = String(values.directorBackground);
    await store.setMeta("state", state);
  }
  return settings;
}

export async function dispatchAction(
  store: Store,
  input: unknown,
): Promise<unknown> {
  const body = z.object({ type: z.string() }).passthrough().parse(input);
  const state = await stateOf(store);
  if (state.gameOver && body.type !== "career")
    throw new GameError(
      "Your tenure has ended. Accept another role in Career settings.",
    );
  switch (body.type) {
    case "minor-application": {
      const data = z
        .object({
          playerId: idSchema,
          safeguards: z.object({
            football: z.boolean(),
            education: z.boolean(),
            care: z.boolean(),
            mentor: z.boolean(),
            parentalConsent: z.boolean(),
          }),
        })
        .parse(body);
      const result = await submitMinorApplication(
        store,
        data.playerId,
        data.safeguards,
      );
      if (result.error) throw new GameError(result.error);
      return result;
    }
    case "assistant-duties":
      return configureAssistant(store, body);
    case "assistant-run":
      return processAssistant(store, true);
    case "affiliate-request":
      return requestAffiliate(store, body);
    case "event-response": {
      const { id, choiceId } = z
        .object({ id: idSchema, choiceId: z.string().max(40) })
        .parse(body);
      return resolveUnexpectedEvent(store, id, choiceId);
    }
    case "career": {
      const data = z
        .object({
          name: z.string().trim().min(2).max(50),
          background: z.string(),
          clubId: idSchema.optional(),
        })
        .parse(body);
      const choices = SETTING_DEFINITIONS.find(
        (setting) => setting.id === "directorBackground",
      )!.options!;
      if (!choices.includes(data.background))
        throw new GameError("Choose a director background.");
      if (data.clubId && data.clubId !== state.clubId) {
        if (state.started && !state.gameOver)
          throw new GameError("You already hold a club position.");
        const club = await clubOf(store, data.clubId);
        if (club.type !== "club") throw new GameError("Choose a senior club.");
        if (state.gameOver && club.reputation > state.director.reputation + 25)
          throw new GameError(
            "This club is not offering you the position at your current reputation.",
          );
        state.clubId = club.id;
        state.gameOver = false;
      }
      state.director.name = data.name;
      state.director.background = data.background;
      if (!state.started) {
        const skill = {
          "Former scout": "scouting",
          "Former player": "leadership",
          Negotiator: "negotiations",
          "Finance executive": "finance",
          "Academy director": "development",
        }[data.background]!;
        state.director.skills = {
          scouting: 0,
          negotiations: 0,
          development: 0,
          finance: 0,
          leadership: 0,
          [skill]: 2,
        };
      }
      state.started = true;
      await store.setMeta("state", state);
      await store.setMeta("settings", {
        ...(await settingsOf(store)),
        directorBackground: data.background,
      });
      await news(
        store,
        "Club",
        "A new chapter begins",
        `${state.director.name} takes charge of the sporting project at ${(await clubOf(store)).name}.`,
        "success",
        "office",
      );
      return { message: "Your sporting project begins." };
    }
    case "shortlist": {
      const data = z
        .object({ playerId: idSchema, active: z.boolean() })
        .parse(body);
      await playerOf(store, data.playerId);
      await store.run(
        "UPDATE players SET shortlisted = ? WHERE id = ?",
        data.active ? 1 : 0,
        data.playerId,
      );
      return {
        message: data.active
          ? "Added to your shortlist."
          : "Removed from your shortlist.",
      };
    }
    case "scout":
      return assignScout(
        store,
        z
          .object({
            staffId: idSchema,
            playerId: idSchema.optional(),
            countryId: idSchema.optional(),
            position: z.enum(POSITIONS).optional(),
            maxAge: z.number().int().min(14).max(45),
            budget: positive,
          })
          .parse(body),
      );
    case "enquiry": {
      const data = z
        .object({
          playerId: idSchema,
          dealType: z.enum([
            "Permanent transfer",
            "Contract renewal",
            "Youth approach",
            "Future transfer",
            ...LOAN_TYPES,
          ]),
          destinationId: idSchema.optional(),
          guardianConsent: z.boolean().default(false),
        })
        .parse(body);
      return enquire(
        store,
        data.playerId,
        data.dealType,
        data.destinationId,
        data.guardianConsent,
      );
    }
    case "offer": {
      const data = z
        .object({
          id: idSchema,
          fee: positive.max(1_000_000_000),
          wage: positive.max(10_000_000),
          years: z.number().int().min(1).max(5),
          role: roleSchema,
          promises: z
            .array(
              z.enum([
                "First-team minutes",
                "Captaincy",
                "Youth pathway",
                "European football",
                "Facilities investment",
              ]),
            )
            .max(5),
          terms: loanTerms.optional(),
          signingBonus: positive.max(100_000_000).optional(),
          transferTerms: transferTermsSchema.optional(),
        })
        .parse(body);
      return negotiate(store, data.id, data);
    }
    case "buy-back": {
      const { id } = z.object({ id: idSchema }).parse(body);
      return exerciseBuyBack(store, id);
    }
    case "counter-transfer": {
      const data = z
        .object({
          id: idSchema,
          fee: positive.max(1_000_000_000),
          transferTerms: transferTermsSchema,
        })
        .parse(body);
      return counterIncomingOffer(store, data.id, data.fee, data.transferTerms);
    }
    case "negotiation": {
      const data = z
        .object({
          id: idSchema,
          action: z.enum([
            "declare",
            "withdraw",
            "accept",
            "reject",
            "formalize",
            "sign",
            "revise",
          ]),
        })
        .parse(body);
      const negotiation = await store.get<Negotiation>(
        "SELECT * FROM negotiations WHERE id = ?",
        data.id,
      );
      if (
        !negotiation ||
        ![negotiation.buying_club_id, negotiation.selling_club_id].includes(
          state.clubId,
        )
      )
        throw new GameError("This negotiation is not yours.");
      if (
        ["Completed", "Rejected", "Expired", "Withdrawn", "Hijacked"].includes(
          negotiation.stage,
        )
      )
        throw new GameError("This negotiation has already closed.");
      if (data.action === "declare") {
        await declareInterest(store, data.id);
        return { message: "Your interest is now public." };
      }
      if (
        data.action === "formalize" ||
        data.action === "sign" ||
        data.action === "revise" ||
        data.action === "accept"
      )
        return negotiationStep(store, data.id, data.action);
      await closeNegotiation(
        store,
        negotiation,
        data.action === "reject" ? "Rejected" : "Withdrawn",
        "The director ended these negotiations.",
      );
      return { message: "Negotiations have ended." };
    }
    case "loan-recall": {
      const data = z
        .object({ id: idSchema, injury: z.boolean().default(false) })
        .parse(body);
      await recallLoan(store, data.id, data.injury);
      return { message: "The player has returned to the parent club." };
    }
    case "loan-option":
      await exerciseOption(store, idSchema.parse(body.id));
      return { message: "The purchase option has been exercised." };
    case "partnership": {
      const data = z
        .object({
          clubId: idSchema,
          partnershipType: z.enum(PARTNERSHIP_TYPES),
        })
        .parse(body);
      await createPartnership(store, data.clubId, data.partnershipType);
      return { message: "Partnership agreed." };
    }
    case "role": {
      const data = z
        .object({ playerId: idSchema, role: roleSchema })
        .parse(body);
      await squadRole(store, data.playerId, data.role);
      return { message: "Squad role updated." };
    }
    case "availability": {
      const data = z
        .object({ playerId: idSchema, listed: z.boolean(), loan: z.boolean() })
        .parse(body);
      await requireOwnPlayer(store, data.playerId);
      await store.run(
        "UPDATE players SET listed = ?, available_loan = ? WHERE id = ?",
        data.listed ? 1 : 0,
        data.loan ? 1 : 0,
        data.playerId,
      );
      return { message: "Transfer and loan availability updated." };
    }
    case "training": {
      const data = z
        .object({
          playerId: idSchema,
          focus: z.enum(TRAINING_TYPES),
          intensity: z.number().int().min(0).max(100),
          position: z.enum(POSITIONS).optional(),
        })
        .parse(body);
      const player = await requireOwnPlayer(store, data.playerId);
      if (player.parent_club_id)
        throw new GameError(
          "The receiving club controls daily training during a loan.",
        );
      await store.run(
        "UPDATE players SET training = ?, intensity = ? WHERE id = ?",
        data.focus,
        data.intensity,
        data.playerId,
      );
      if (data.position) {
        const profile = JSON.parse(player.profile) as PlayerProfile;
        profile.development.positionTarget = data.position;
        profile.development.positionWeeks = 0;
        await store.run(
          "UPDATE players SET profile = ? WHERE id = ?",
          JSON.stringify(profile),
          data.playerId,
        );
      }
      return { message: "Individual development plan updated." };
    }
    case "training-plan": {
      const data = z
        .object({
          focus: z.enum(TRAINING_TYPES),
          intensity: z.number().int().min(0).max(100),
          youthFocus: z.enum(TRAINING_TYPES),
        })
        .parse(body);
      await store.run(
        "MERGE INTO training_plans WITH (HOLDLOCK) AS target USING (VALUES (?, ?, ?, ?)) AS source(club_id, focus, intensity, youth_focus) ON target.club_id = source.club_id WHEN MATCHED THEN UPDATE SET focus = source.focus, intensity = source.intensity, youth_focus = source.youth_focus WHEN NOT MATCHED THEN INSERT (club_id, focus, intensity, youth_focus) VALUES (source.club_id, source.focus, source.intensity, source.youth_focus);",
        state.clubId,
        data.focus,
        data.intensity,
        data.youthFocus,
      );
      return { message: "Club training programme updated." };
    }
    case "set-pieces": {
      const data = z
        .object({
          routine: z.enum([
            "Near post",
            "Far post",
            "Short corner",
            "Edge of box",
          ]),
          target: z.enum(["Centre-back", "Striker", "Midfielder"]),
          risk: z.number().int().min(0).max(100),
        })
        .parse(body);
      await store.run(
        "MERGE INTO set_pieces WITH (HOLDLOCK) AS destination USING (VALUES (?, ?, ?, ?)) AS source(club_id, routine, target, risk) ON destination.club_id = source.club_id WHEN MATCHED THEN UPDATE SET routine = source.routine, target = source.target, risk = source.risk WHEN NOT MATCHED THEN INSERT (club_id, routine, target, risk) VALUES (source.club_id, source.routine, source.target, source.risk);",
        state.clubId,
        data.routine,
        data.target,
        data.risk,
      );
      return { message: "Set-piece design shared with the coaching staff." };
    }
    case "squad-move": {
      const input = z
        .object({
          playerId: idSchema,
          clubId: idSchema,
          ageGroup: z.enum(["Senior", "U19", "U17"]),
        })
        .parse(body);
      return movePlayerSquad(
        store,
        input.playerId,
        input.clubId,
        input.ageGroup,
      );
    }
    case "promote":
      await promoteYouth(store, idSchema.parse(body.playerId));
      return { message: "Player promoted to the senior squad." };
    case "mentor": {
      const data = z
        .object({ playerId: idSchema, mentorId: idSchema })
        .parse(body);
      await mentorPlayer(store, data.playerId, data.mentorId);
      return { message: "Mentorship pairing confirmed." };
    }
    case "wellbeing": {
      const player = await requireOwnPlayer(
        store,
        idSchema.parse(body.playerId),
      );
      const profile = JSON.parse(player.profile) as PlayerProfile;
      if (
        profile.development.lastSupport &&
        daysBetween(profile.development.lastSupport, state.date) < 7
      )
        throw new GameError(
          "The wellbeing team is already supporting this player this week.",
        );
      if ((await clubOf(store)).balance < 5000)
        throw new GameError("Insufficient funds for the support programme.");
      await ledger(store, state.clubId, -5000, "Player wellbeing", player.name);
      profile.mentalHealth.anxiety = clamp(
        profile.mentalHealth.anxiety - 10,
        0,
        100,
      );
      profile.mentalHealth.burnout = clamp(
        profile.mentalHealth.burnout - 6,
        0,
        100,
      );
      profile.development.lastSupport = state.date;
      await store.run(
        "UPDATE players SET morale = CASE WHEN morale + 5 > 99 THEN 99 ELSE morale + 5 END, profile = ? WHERE id = ?",
        JSON.stringify(profile),
        player.id,
      );
      return { message: "Confidential support has been arranged." };
    }
    case "staff": {
      const data = z
        .object({
          id: idSchema,
          action: z.enum(["hire", "release", "mediate", "develop"]),
        })
        .parse(body);
      return staffAction(store, data.id, data.action);
    }
    case "media":
      await mediaResponse(
        store,
        z
          .enum(["measured", "ambitious", "protect", "challenge"])
          .parse(body.approach),
      );
      return { message: "Your statement has been released." };
    case "board": {
      const approach = z
        .enum(["youth", "back-manager", "budget", "recovery"])
        .parse(body.approach);
      const last = await store.get<{ value: string }>(
        "SELECT [value] FROM meta WHERE [key] = 'lastBoardMeeting'",
      );
      if (last && daysBetween(JSON.parse(last.value), state.date) < 7)
        throw new GameError("The board will meet with you again next week.");
      const club = await clubOf(store);
      let response = "";
      if (approach === "budget") {
        if (
          club.board_confidence < 60 ||
          club.balance < club.transfer_budget * 1.3
        )
          throw new GameError(
            "The board will not release more funds with the current confidence and cash position.",
          );
        const allocation = Math.min(
          10_000_000,
          Math.max(0, club.balance - club.transfer_budget) * 0.2,
        );
        await store.run(
          "UPDATE clubs SET transfer_budget = transfer_budget + ?, board_pressure = CASE WHEN board_pressure + 7 > 100 THEN 100 ELSE board_pressure + 7 END, expectations = CASE WHEN expectations - 1 < 1 THEN 1 ELSE expectations - 1 END WHERE id = ?",
          allocation,
          club.id,
        );
        response =
          "The board has increased your transfer allocation. Expectations and scrutiny have risen too.";
      } else if (approach === "back-manager") {
        await store.run(
          "UPDATE clubs SET manager_trust = CASE WHEN manager_trust + 8 > 99 THEN 99 ELSE manager_trust + 8 END, board_confidence = CASE WHEN board_confidence - 2 < 0 THEN 0 ELSE board_confidence - 2 END, chemistry = CASE WHEN chemistry + 3 > 99 THEN 99 ELSE chemistry + 3 END WHERE id = ?",
          club.id,
        );
        response =
          "The manager welcomes your backing. The board expects that trust to be repaid in results.";
      } else {
        await store.run(
          "UPDATE clubs SET board_confidence = CASE WHEN board_confidence + 4 > 99 THEN 99 ELSE board_confidence + 4 END, board_pressure = CASE WHEN board_pressure - 4 < 0 THEN 0 ELSE board_pressure - 4 END WHERE id = ?",
          club.id,
        );
        await store.setMeta("boardPlan", {
          approach,
          date: state.date,
          due: addDays(state.date, 35),
          confidence: club.board_confidence,
          youthMinutes: (await store.get<{ total: number }>(
            "SELECT coalesce(sum(minutes),0) AS total FROM players WHERE club_id = ? AND age < 21",
            club.id,
          ))!.total,
          crisis: club.crisis,
        });
        response =
          approach === "youth"
            ? "The academy pathway has been approved. The board will review youth minutes in five weeks."
            : "Your recovery plan has bought time. The board will review the crisis level in five weeks.";
      }
      await store.setMeta("lastBoardMeeting", state.date);
      await news(
        store,
        "Board",
        "Board meeting concluded",
        response,
        "important",
        "board",
      );
      await experience(store, 5);
      return { message: response };
    }
    case "investment": {
      const kind = z.enum(["academy", "facilities"]).parse(body.kind);
      const club = await clubOf(store);
      const cost = Math.round(
        (1_000_000 + club[kind] * 25_000) *
          (1 - state.director.skills.finance * 0.035),
      );
      if (club[kind] >= 99)
        throw new GameError("This facility is already at its maximum level.");
      if (club.balance < cost || club.transfer_budget < cost)
        throw new GameError("The investment exceeds available funds.");
      await ledger(
        store,
        club.id,
        -cost,
        "Infrastructure",
        kind === "academy"
          ? "Academy improvement"
          : "Training facility improvement",
      );
      await store.run(
        `UPDATE clubs SET ${kind} = CASE WHEN ${kind} + 3 > 99 THEN 99 ELSE ${kind} + 3 END, transfer_budget = transfer_budget - ? WHERE id = ?`,
        cost,
        club.id,
      );
      return { message: "The infrastructure investment is complete." };
    }
    case "budget": {
      const amount = z
        .number()
        .int()
        .min(-100_000_000)
        .max(100_000_000)
        .parse(body.amount);
      const club = await clubOf(store);
      const wages = await weeklyWages(store, club.id);
      if (
        club.transfer_budget - amount < 0 ||
        club.wage_budget + amount / 52 < wages
      )
        throw new GameError(
          "The revised budgets must cover current wages and keep the transfer allocation non-negative.",
        );
      await store.run(
        "UPDATE clubs SET transfer_budget = transfer_budget - ?, wage_budget = wage_budget + ? WHERE id = ?",
        amount,
        amount / 52,
        club.id,
      );
      return { message: "Transfer and wage budgets rebalanced." };
    }
    case "skill": {
      const skill = z
        .enum([
          "scouting",
          "negotiations",
          "development",
          "finance",
          "leadership",
        ])
        .parse(body.skill);
      const settings = await settingsOf(store);
      if (settings.skillTreeMode === "disabled")
        throw new GameError("Director skills are disabled in settings.");
      if (state.director.skillPoints <= 0)
        throw new GameError("You have no unspent skill points.");
      if (state.director.skills[skill] >= 5)
        throw new GameError("This skill is fully developed.");
      if (
        settings.skillTreeMode === "specialist" &&
        state.director.skills[skill] >= 2 &&
        state.director.experience < state.director.skills[skill] * 100
      )
        throw new GameError(
          "More career experience is required for the next specialist level.",
        );
      state.director.skillPoints--;
      state.director.skills[skill]++;
      await store.setMeta("state", state);
      return { message: "Director skill developed." };
    }
    case "read-news": {
      const id = body.id === undefined ? undefined : idSchema.parse(body.id);
      if (id) await store.run("UPDATE news SET [read] = 1 WHERE id = ?", id);
      else await store.run("UPDATE news SET [read] = 1");
      return { message: "Inbox updated." };
    }
    default:
      throw new GameError("Unknown game action.");
  }
}

export function createApp(store: Store) {
  const configuration = readApiConfiguration();
  const app = express();
  const saves = new Saves(store);
  let busy = false;
  let readers = 0;
  let finishReads: (() => void) | undefined;
  app.disable("x-powered-by");
  app.set("trust proxy", false);
  app.use((request, response, next) => {
    response.setHeader("X-Content-Type-Options", "nosniff");
    response.setHeader("Referrer-Policy", "no-referrer");
    response.setHeader("X-Frame-Options", "DENY");
    response.setHeader(
      "Permissions-Policy",
      "camera=(), microphone=(), geolocation=()",
    );
    response.setHeader(
      "Content-Security-Policy",
      "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'none'; form-action 'self'",
    );
    if (configuration.hosted)
      response.setHeader("Strict-Transport-Security", "max-age=31536000");
    if (request.path.startsWith("/api"))
      response.setHeader("Cache-Control", "no-store");
    next();
  });
  app.get("/api/health", (_request, response) =>
    response.json({ status: "ok" } satisfies Health),
  );
  app.use("/api", (request, response, next) => {
    if (configuration.requireAuth) {
      const encoded = request.headers["x-ms-client-principal"];
      if (
        typeof encoded !== "string" ||
        encoded.length > 65536 ||
        !/^[A-Za-z0-9+/]+={0,2}$/.test(encoded)
      )
        return response.status(401).json({ error: "Authentication required." });
      try {
        const principal = principalSchema.parse(
          JSON.parse(Buffer.from(encoded, "base64").toString("utf8")),
        );
        const tenants = principal.claims.filter((claim) =>
          [
            "tid",
            "http://schemas.microsoft.com/identity/claims/tenantid",
          ].includes(claim.typ),
        );
        const owners = principal.claims.filter((claim) =>
          [
            "oid",
            "http://schemas.microsoft.com/identity/claims/objectidentifier",
          ].includes(claim.typ),
        );
        const objectId = owners[0]?.val.toLowerCase();
        if (
          !tenants.length ||
          !objectId ||
          !tenants.every((claim) => claim.val.toLowerCase() === configuration.tenantId) ||
          !owners.every((claim) => claim.val.toLowerCase() === objectId) ||
          !configuration.allowedUserObjectIds.has(objectId)
        )
          return response
            .status(403)
            .json({ error: "This account is not authorized." });
      } catch {
        return response.status(401).json({ error: "Authentication required." });
      }
    } else {
      if (
        !["127.0.0.1", "::1", "::ffff:127.0.0.1"].includes(
          request.socket.remoteAddress ?? "",
        )
      )
        return response.status(403).json({ error: "Local access only." });
      try {
        const host = new URL(`http://${request.headers.host ?? ""}`);
        if (!loopbackHosts.has(host.hostname))
          return response.status(403).json({ error: "Local access only." });
      } catch {
        return response.status(403).json({ error: "Invalid request host." });
      }
    }
    const suppliedOrigin = request.headers.origin;
    if (suppliedOrigin) {
      try {
        const origin = new URL(suppliedOrigin);
        const allowed = configuration.appOrigin
          ? suppliedOrigin === configuration.appOrigin
          : origin.origin === suppliedOrigin &&
            ["http:", "https:"].includes(origin.protocol) &&
            loopbackHosts.has(origin.hostname);
        if (!allowed)
          return response
            .status(403)
            .json({ error: "Request origin is not allowed." });
      } catch {
        return response.status(403).json({ error: "Invalid request origin." });
      }
    } else if (
      request.headers["sec-fetch-site"] === "cross-site" ||
      (configuration.requireAuth &&
        !["GET", "HEAD", "OPTIONS"].includes(request.method))
    ) {
      return response
        .status(403)
        .json({ error: "A same-origin request is required." });
    }
    next();
  });
  app.use(express.json({ limit: "128kb" }));
  const conflict = (response: Response) =>
    response.status(409).json({
      error:
        "The game is saving or advancing. Please wait for that operation to finish.",
    });
  const read =
    (handler: (request: Request) => unknown | Promise<unknown>) =>
    async (request: Request, response: Response, next: NextFunction) => {
      if (busy) return conflict(response);
      readers++;
      try {
        const result = await store.transaction(async () => handler(request));
        response.json(result);
      } catch (error) {
        next(error);
      } finally {
        readers--;
        if (readers === 0) {
          finishReads?.();
          finishReads = undefined;
        }
      }
    };
  const mutation =
    (
      handler: (
        request: Request,
        response: Response,
      ) => unknown | Promise<unknown>,
    ) =>
    async (request: Request, response: Response, next: NextFunction) => {
      if (busy) return conflict(response);
      busy = true;
      try {
        if (readers > 0)
          await new Promise<void>((resolveReads) => {
            finishReads = resolveReads;
          });
        if (response.destroyed) return;
        await handler(request, response);
      } catch (error) {
        next(error);
      } finally {
        busy = false;
      }
    };
  app.get(
    "/api/health/details",
    read(
      async () =>
        ({
          status: "ok",
          database: "SQL Server",
          databaseName: store.database,
          schema: store.schemaName,
          hosted: configuration.hosted,
          testCareer: store.testMode,
          date: (await stateOf(store)).date,
        }) satisfies HealthDetails,
    ),
  );
  app.get(
    "/api/bootstrap",
    read(() => query.bootstrap(store)),
  );
  app.get(
    "/api/dashboard",
    read(() => query.dashboard(store)),
  );
  app.get(
    "/api/players",
    read((request) => query.players(store, request.query)),
  );
  app.get(
    "/api/players/:id",
    read((request) =>
      query.playerDetail(store, idSchema.parse(request.params.id)),
    ),
  );
  app.get(
    "/api/players/:id/interest",
    read(async (request) => {
      const player = await playerOf(store, idSchema.parse(request.params.id));
      const input = z
        .object({
          negotiationId: idSchema.optional(),
          wage: z.coerce.number().finite().min(0).max(10000000).optional(),
          role: roleSchema.optional(),
          years: z.coerce.number().int().min(1).max(5).optional(),
          promises: z.string().max(400).optional(),
        })
        .parse(request.query);
      const negotiation = input.negotiationId
        ? await store.get<Negotiation>(
            "SELECT * FROM negotiations WHERE id = ?",
            input.negotiationId,
          )
        : undefined;
      if (
        input.negotiationId &&
        (!negotiation ||
          negotiation.player_id !== player.id ||
          ![negotiation.buying_club_id, negotiation.selling_club_id].includes(
            (await stateOf(store)).clubId,
          ))
      )
        throw new GameError("This negotiation is not yours.");
      const data = negotiation ? JSON.parse(negotiation.data) : undefined;
      const loan = !!negotiation && LOAN_TYPES.includes(negotiation.type);
      let promises = data?.promises;
      if (input.promises) {
        let decoded: unknown;
        try {
          decoded = JSON.parse(input.promises);
        } catch {
          throw new GameError("Invalid contract promises.");
        }
        promises = z
          .array(
            z.enum([
              "First-team minutes",
              "Captaincy",
              "Youth pathway",
              "European football",
              "Facilities investment",
            ]),
          )
          .max(5)
          .parse(decoded);
      }
      return assessPlayerInterest(
        store,
        player,
        await clubOf(store, negotiation?.buying_club_id),
        {
          loan,
          role: loan ? data?.terms.role : input.role,
          wage: input.wage,
          years: input.years,
          promises,
          playingTime: loan ? data?.terms.playingTime : undefined,
          tension: negotiation?.tension,
        },
      );
    }),
  );
  app.get(
    "/api/players/:id/career",
    read((request) =>
      query.playerCareer(
        store,
        idSchema.parse(request.params.id),
        request.query,
      ),
    ),
  );
  app.get(
    "/api/squad",
    read((request) => query.squad(store, request.query)),
  );
  app.get(
    "/api/scouting",
    read(() => query.scouting(store)),
  );
  app.get(
    "/api/transfers",
    read(() => query.transfers(store)),
  );
  app.get(
    "/api/loans",
    read(() => query.loans(store)),
  );
  app.get(
    "/api/staff",
    read(() => query.staff(store)),
  );
  app.get(
    "/api/training",
    read(() => query.training(store)),
  );
  app.get(
    "/api/academy",
    read(() => query.academy(store)),
  );
  app.get(
    "/api/assistant",
    read(() => assistantDesk(store)),
  );
  app.get(
    "/api/affiliates",
    read(() => affiliateDesk(store)),
  );
  app.get(
    "/api/affiliates/:id/interest",
    read((request) =>
      affiliateInterest(
        store,
        idSchema.parse(request.params.id),
        z
          .enum(PARTNERSHIP_TYPES as [string, ...string[]])
          .parse(request.query.type),
      ),
    ),
  );
  app.get(
    "/api/events",
    read(() => unexpectedEvents(store)),
  );
  app.get(
    "/api/finances",
    read(() => query.finances(store)),
  );
  app.get(
    "/api/media",
    read((request) => mediaFeed(store, request.query)),
  );
  app.get(
    "/api/news",
    read((request) => notificationFeed(store, request.query)),
  );
  app.get(
    "/api/competitions/favorites",
    read(() => competitionFavorites(store)),
  );
  app.put(
    "/api/competitions/:id/favorite",
    mutation(async (request, response) =>
      response.json(
        await store.transaction(() =>
          favoriteCompetition(
            store,
            idSchema.parse(request.params.id),
            request.body,
          ),
        ),
      ),
    ),
  );
  app.get(
    "/api/clubs",
    read(async (request) => {
      const filter = z
        .object({
          q: z.string().max(100).default(""),
          country: idSchema.optional(),
          limit: z.coerce.number().int().min(1).max(500).default(60),
        })
        .parse(request.query);
      return store.all<Club>(
        `SELECT clubs.*, countries.name AS country_name, countries.code AS country_code FROM clubs JOIN countries ON countries.id = clubs.country_id WHERE clubs.type = 'club' AND clubs.name LIKE ? ${filter.country ? "AND country_id = ?" : ""} ORDER BY clubs.reputation DESC, clubs.id OFFSET 0 ROWS FETCH NEXT ? ROWS ONLY`,
        `%${filter.q}%`,
        ...(filter.country ? [filter.country] : []),
        filter.limit,
      );
    }),
  );
  app.get(
    "/api/world/clubs",
    read((request) => query.worldClubs(store, request.query)),
  );
  app.get(
    "/api/world/audit",
    read(() => query.worldAudit(store)),
  );
  app.post(
    "/api/world/expand",
    mutation(async (_request, response) =>
      response.json(await store.transaction(() => saves.expandWorld())),
    ),
  );
  app.get(
    "/api/clubs/:id",
    read((request) =>
      query.clubDetail(store, idSchema.parse(request.params.id)),
    ),
  );
  app.get(
    "/api/leagues",
    read(async (request) => {
      const filter = z
        .object({
          q: z.string().max(100).default(""),
          country: idSchema.optional(),
          confederation: z.string().max(20).optional(),
          kind: z
            .enum(["league", "cup", "continental", "international", "youth"])
            .optional(),
          age: z.string().max(10).optional(),
          favorites: z.enum(["0", "1"]).optional(),
          page: z.coerce.number().int().min(1).max(100000).default(1),
          limit: z.coerce.number().int().min(1).max(3000).default(200),
        })
        .parse(request.query);
      const where = ["leagues.name LIKE ?"];
      const params: (string | number)[] = [`%${filter.q}%`];
      if (filter.country) {
        where.push("leagues.country_id = ?");
        params.push(filter.country);
      }
      if (filter.confederation) {
        where.push("leagues.confederation = ?");
        params.push(filter.confederation);
      }
      if (filter.kind) {
        where.push("leagues.kind = ?");
        params.push(filter.kind);
      }
      if (filter.age) {
        where.push("leagues.age_group = ?");
        params.push(filter.age);
      }
      if (filter.favorites === "1")
        where.push(
          "EXISTS(SELECT 1 FROM competition_favorites WHERE league_id = leagues.id)",
        );
      return store.all(
        `SELECT leagues.*, countries.name AS country_name FROM leagues LEFT JOIN countries ON countries.id = leagues.country_id WHERE ${where.join(" AND ")} ORDER BY leagues.reputation DESC, leagues.name, leagues.id OFFSET ? ROWS FETCH NEXT ? ROWS ONLY`,
        ...params,
        (filter.page - 1) * filter.limit,
        filter.limit,
      );
    }),
  );
  app.get(
    "/api/leagues/:id",
    read((request) =>
      query.competition(store, idSchema.parse(request.params.id)),
    ),
  );
  app.get(
    "/api/matches",
    read((request) =>
      query.matches(
        store,
        z
          .object({
            club: idSchema.optional(),
            league: idSchema.optional(),
            age: z.string().optional(),
            status: z.enum(["played", "scheduled"]).optional(),
          })
          .parse(request.query),
      ),
    ),
  );
  app.get(
    "/api/matches/:id",
    read((request) =>
      query.matchDetail(store, idSchema.parse(request.params.id)),
    ),
  );
  app.post(
    "/api/action",
    mutation(async (request, response) => {
      const result = await store.transaction(() =>
        dispatchAction(store, request.body),
      );
      response.json(result ?? { message: "Done." });
    }),
  );
  app.patch(
    "/api/settings",
    mutation(async (request, response) =>
      response.json(
        await store.transaction(() => updateSettings(store, request.body)),
      ),
    ),
  );
  app.post(
    "/api/advance",
    mutation(async (request, response) => {
      const { days } = z
        .object({ days: z.number().int().min(1).max(28) })
        .parse(request.body);
      const started = performance.now();
      const result = await store.transaction(async () => {
        const initial = await stateOf(store);
        const progress = {
          from: initial.date,
          date: initial.date,
          days: 0,
          matches: 0,
          seconds: 0,
        };
        for (let step = 0; step < days; step++) {
          const day = await advance(store, 1);
          progress.days += day.days;
          progress.matches += day.matches;
          progress.date = day.date;
          const settings = await settingsOf(store);
          const state = await stateOf(store);
          const elapsed = daysBetween(state.lastAutosave, state.date);
          if (
            settings.autosave === "daily" ||
            (settings.autosave === "weekly" && elapsed >= 7) ||
            (settings.autosave === "monthly" && elapsed >= 28)
          )
            await saves.create("Career", true);
          if (state.gameOver) break;
        }
        return progress;
      });
      result.seconds = Math.round((performance.now() - started) / 10) / 100;
      response.json(result);
    }),
  );
  app.get(
    "/api/saves",
    read(() => saves.list()),
  );
  app.delete(
    "/api/careers",
    mutation(async (request, response) => {
      const { file } = z.object({ file: saveFileSchema }).parse(request.body);
      response.json(await saves.deleteCareer(file));
    }),
  );
  app.post(
    "/api/careers",
    mutation(async (request, response) => {
      const input = z
        .object({
          name: z.string().trim().min(2).max(50),
          careerName: z
            .string()
            .trim()
            .min(2)
            .max(60)
            .regex(/[a-zA-Z0-9]/),
          background: z.string().max(40),
          clubId: idSchema,
          seed: z.string().min(1).max(100).default(`touchline-${Date.now()}`),
        })
        .parse(request.body);
      response.json(await store.transaction(() => saves.startCareer(input)));
    }),
  );
  app.post(
    "/api/careers/load",
    mutation(async (request, response) => {
      const { file } = z.object({ file: saveFileSchema }).parse(request.body);
      const archived = await store.transaction(async () => {
        if (!(await saves.list()).some((slot) => slot.file === file))
          throw new GameError("Save slot not found.");
        const state = await stateOf(store);
        const snapshot = await saves.create(
          `${state.careerName ?? state.director.name} before load`,
        );
        await saves.restore(file);
        return snapshot;
      });
      response.json({ message: "Career loaded.", archived: archived.file });
    }),
  );
  app.post(
    "/api/saves",
    mutation(async (request, response) =>
      response.json(
        await saves.create(
          z.object({ name: z.string().min(1).max(60) }).parse(request.body)
            .name,
        ),
      ),
    ),
  );
  app.post(
    "/api/saves/restore",
    mutation(async (request, response) => {
      await saves.restore(
        z.object({ file: saveFileSchema }).parse(request.body).file,
      );
      response.json({ message: "Career restored." });
    }),
  );
  app.get(
    "/api/saves/export",
    mutation(async (_request, response) => {
      const result = await saves.export();
      try {
        response.attachment(result.name);
        response.type("application/gzip");
        await pipeline(createReadStream(result.file), response);
      } finally {
        await rm(result.file, { force: true });
      }
    }),
  );
  app.post(
    "/api/saves/import",
    mutation(async (request, response) => {
      if (!request.is(["application/octet-stream", "application/gzip"]))
        throw new GameError("Upload a portable .touchline.gz save file.");
      await saves.import(request);
      response.json({ message: "Portable save imported." });
    }),
  );
  app.use("/api", (_request, response) =>
    response.status(404).json({ error: "API route not found." }),
  );
  const dist = resolve("dist");
  if (existsSync(resolve(dist, "index.html"))) {
    app.use(express.static(dist));
    app.get("/{*path}", (request, response) =>
      request.path.startsWith("/api/")
        ? response.status(404).json({ error: "API route not found." })
        : response.sendFile(resolve(dist, "index.html")),
    );
  }
  app.use(
    (
      error: unknown,
      _request: Request,
      response: Response,
      _next: NextFunction,
    ) => {
      if (response.headersSent) return response.destroy();
      if (error instanceof z.ZodError)
        return response.status(400).json({
          error: error.issues
            .map(
              (issue) =>
                `${issue.path.join(".") || "Request"}: ${issue.message}`,
            )
            .join("; "),
        });
      if (
        error instanceof GameError &&
        error.status >= 400 &&
        error.status < 500
      )
        return response.status(error.status).json({ error: error.message });
      if (error && typeof error === "object" && "type" in error) {
        if (error.type === "entity.too.large")
          return response
            .status(413)
            .json({ error: "Request body is too large." });
        if (error.type === "entity.parse.failed")
          return response
            .status(400)
            .json({ error: "Invalid JSON request body." });
        if (
          error.type === "encoding.unsupported" ||
          error.type === "charset.unsupported"
        )
          return response
            .status(415)
            .json({ error: "Unsupported request encoding." });
      }
      console.error("Touchline: an API request failed.");
      return response.status(500).json({
        error: "An unexpected server error occurred.",
      });
    },
  );
  return app;
}
