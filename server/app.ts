import express, {
  type Request,
  type Response,
  type NextFunction,
} from "express";
import { resolve } from "node:path";
import { existsSync } from "node:fs";
import { z } from "zod";
import { Store } from "./db.ts";
import { Saves } from "./saves.ts";
import * as query from "./queries.ts";
import { advance } from "./simulation.ts";
import {
  assignScout,
  clubOf,
  createPartnership,
  declareInterest,
  enquire,
  exerciseOption,
  experience,
  GameError,
  ledger,
  mediaResponse,
  mentorPlayer,
  negotiate,
  news,
  playerOf,
  promoteYouth,
  recallLoan,
  requireOwnPlayer,
  settingsOf,
  squadRole,
  staffAction,
  stateOf,
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
import type {
  Club,
  Negotiation,
  NegotiationData,
  PlayerProfile,
} from "../shared/types.ts";

const idSchema = z.coerce.number().int().positive();
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

export function updateSettings(store: Store, input: unknown) {
  const values = z
    .record(z.string(), z.union([z.string(), z.boolean(), z.number()]))
    .parse(input);
  const settings = settingsOf(store);
  for (const [key, value] of Object.entries(values)) {
    const definition = SETTING_DEFINITIONS.find(
      (setting) => setting.id === key,
    );
    if (!definition) throw new GameError(`Unknown setting: ${key}`);
    if (definition.disabled && value !== definition.default)
      throw new GameError(
        "Cloud services are disabled. Saves remain on this machine.",
      );
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
  settings.cloudSync = false;
  store.setMeta("settings", settings);
  if (values.directorBackground) {
    const state = stateOf(store);
    state.director.background = String(values.directorBackground);
    store.setMeta("state", state);
  }
  return settings;
}

export function dispatchAction(store: Store, input: unknown): unknown {
  const body = z.object({ type: z.string() }).passthrough().parse(input);
  const state = stateOf(store);
  if (state.gameOver && body.type !== "career")
    throw new GameError(
      "Your tenure has ended. Accept another role in Career settings.",
    );
  switch (body.type) {
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
        const club = clubOf(store, data.clubId);
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
      store.setMeta("state", state);
      store.setMeta("settings", {
        ...settingsOf(store),
        directorBackground: data.background,
      });
      news(
        store,
        "Club",
        "A new chapter begins",
        `${state.director.name} takes charge of the sporting project at ${clubOf(store).name}.`,
        "success",
        "office",
      );
      return { message: "Your sporting project begins." };
    }
    case "shortlist": {
      const data = z
        .object({ playerId: idSchema, active: z.boolean() })
        .parse(body);
      playerOf(store, data.playerId);
      store.run(
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
            ...LOAN_TYPES,
          ]),
          destinationId: idSchema.optional(),
        })
        .parse(body);
      return enquire(store, data.playerId, data.dealType, data.destinationId);
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
        })
        .parse(body);
      return negotiate(store, data.id, data);
    }
    case "negotiation": {
      const data = z
        .object({
          id: idSchema,
          action: z.enum(["declare", "withdraw", "accept", "reject"]),
        })
        .parse(body);
      const negotiation = store.get<Negotiation>(
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
        declareInterest(store, data.id);
        return { message: "Your interest is now public." };
      }
      if (data.action === "accept") {
        if (
          negotiation.stage !== "Offer received" ||
          negotiation.selling_club_id !== state.clubId
        )
          throw new GameError("Only an incoming offer can be accepted here.");
        const details = JSON.parse(negotiation.data) as NegotiationData;
        details.medicalDate = addDays(state.date, 2);
        details.log.push({
          date: state.date,
          type: "Medical",
          message:
            "The selling club accepted. Registration follows the medical.",
        });
        store.run(
          "UPDATE negotiations SET stage = 'Medical', data = ? WHERE id = ?",
          JSON.stringify(details),
          data.id,
        );
      } else
        store.run(
          "UPDATE negotiations SET stage = ? WHERE id = ?",
          data.action === "reject" ? "Rejected" : "Withdrawn",
          data.id,
        );
      return {
        message:
          data.action === "accept"
            ? "Offer accepted, subject to medical and registration."
            : "Negotiations have ended.",
      };
    }
    case "loan-recall": {
      const data = z
        .object({ id: idSchema, injury: z.boolean().default(false) })
        .parse(body);
      recallLoan(store, data.id, data.injury);
      return { message: "The player has returned to the parent club." };
    }
    case "loan-option":
      exerciseOption(store, idSchema.parse(body.id));
      return { message: "The purchase option has been exercised." };
    case "partnership": {
      const data = z
        .object({
          clubId: idSchema,
          partnershipType: z.enum(PARTNERSHIP_TYPES),
        })
        .parse(body);
      createPartnership(store, data.clubId, data.partnershipType);
      return { message: "Partnership agreed." };
    }
    case "role": {
      const data = z
        .object({ playerId: idSchema, role: roleSchema })
        .parse(body);
      squadRole(store, data.playerId, data.role);
      return { message: "Squad role updated." };
    }
    case "availability": {
      const data = z
        .object({ playerId: idSchema, listed: z.boolean(), loan: z.boolean() })
        .parse(body);
      requireOwnPlayer(store, data.playerId);
      store.run(
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
      const player = requireOwnPlayer(store, data.playerId);
      if (player.parent_club_id)
        throw new GameError(
          "The receiving club controls daily training during a loan.",
        );
      store.run(
        "UPDATE players SET training = ?, intensity = ? WHERE id = ?",
        data.focus,
        data.intensity,
        data.playerId,
      );
      if (data.position) {
        const profile = JSON.parse(player.profile) as PlayerProfile;
        profile.development.positionTarget = data.position;
        profile.development.positionWeeks = 0;
        store.run(
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
      store.run(
        "INSERT INTO training_plans(club_id, focus, intensity, youth_focus) VALUES (?, ?, ?, ?) ON CONFLICT(club_id) DO UPDATE SET focus = excluded.focus, intensity = excluded.intensity, youth_focus = excluded.youth_focus",
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
      store.run(
        "INSERT INTO set_pieces(club_id, routine, target, risk) VALUES (?, ?, ?, ?) ON CONFLICT(club_id) DO UPDATE SET routine = excluded.routine, target = excluded.target, risk = excluded.risk",
        state.clubId,
        data.routine,
        data.target,
        data.risk,
      );
      return { message: "Set-piece design shared with the coaching staff." };
    }
    case "promote":
      promoteYouth(store, idSchema.parse(body.playerId));
      return { message: "Player promoted to the senior squad." };
    case "mentor": {
      const data = z
        .object({ playerId: idSchema, mentorId: idSchema })
        .parse(body);
      mentorPlayer(store, data.playerId, data.mentorId);
      return { message: "Mentorship pairing confirmed." };
    }
    case "wellbeing": {
      const player = requireOwnPlayer(store, idSchema.parse(body.playerId));
      const profile = JSON.parse(player.profile) as PlayerProfile;
      if (
        profile.development.lastSupport &&
        daysBetween(profile.development.lastSupport, state.date) < 7
      )
        throw new GameError(
          "The wellbeing team is already supporting this player this week.",
        );
      if (clubOf(store).balance < 5000)
        throw new GameError("Insufficient funds for the support programme.");
      ledger(store, state.clubId, -5000, "Player wellbeing", player.name);
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
      store.run(
        "UPDATE players SET morale = min(99,morale + 5), profile = ? WHERE id = ?",
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
      mediaResponse(
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
      const last = store.get<{ value: string }>(
        "SELECT value FROM meta WHERE key = 'lastBoardMeeting'",
      );
      if (last && daysBetween(JSON.parse(last.value), state.date) < 7)
        throw new GameError("The board will meet with you again next week.");
      const club = clubOf(store);
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
        store.run(
          "UPDATE clubs SET transfer_budget = transfer_budget + ?, board_pressure = min(100,board_pressure + 7), expectations = max(1,expectations - 1) WHERE id = ?",
          allocation,
          club.id,
        );
        response =
          "The board has increased your transfer allocation. Expectations and scrutiny have risen too.";
      } else if (approach === "back-manager") {
        store.run(
          "UPDATE clubs SET manager_trust = min(99,manager_trust + 8), board_confidence = max(0,board_confidence - 2), chemistry = min(99,chemistry + 3) WHERE id = ?",
          club.id,
        );
        response =
          "The manager welcomes your backing. The board expects that trust to be repaid in results.";
      } else {
        store.run(
          "UPDATE clubs SET board_confidence = min(99,board_confidence + 4), board_pressure = max(0,board_pressure - 4) WHERE id = ?",
          club.id,
        );
        store.setMeta("boardPlan", {
          approach,
          date: state.date,
          due: addDays(state.date, 35),
          confidence: club.board_confidence,
          youthMinutes: store.get<{ total: number }>(
            "SELECT coalesce(sum(minutes),0) AS total FROM players WHERE club_id = ? AND age < 21",
            club.id,
          )!.total,
          crisis: club.crisis,
        });
        response =
          approach === "youth"
            ? "The academy pathway has been approved. The board will review youth minutes in five weeks."
            : "Your recovery plan has bought time. The board will review the crisis level in five weeks.";
      }
      store.setMeta("lastBoardMeeting", state.date);
      news(
        store,
        "Board",
        "Board meeting concluded",
        response,
        "important",
        "board",
      );
      experience(store, 5);
      return { message: response };
    }
    case "investment": {
      const kind = z.enum(["academy", "facilities"]).parse(body.kind);
      const club = clubOf(store);
      const cost = Math.round(
        (1_000_000 + club[kind] * 25_000) *
          (1 - state.director.skills.finance * 0.035),
      );
      if (club[kind] >= 99)
        throw new GameError("This facility is already at its maximum level.");
      if (club.balance < cost || club.transfer_budget < cost)
        throw new GameError("The investment exceeds available funds.");
      ledger(
        store,
        club.id,
        -cost,
        "Infrastructure",
        kind === "academy"
          ? "Academy improvement"
          : "Training facility improvement",
      );
      store.run(
        `UPDATE clubs SET ${kind} = min(99,${kind} + 3), transfer_budget = transfer_budget - ? WHERE id = ?`,
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
      const club = clubOf(store);
      const wages = weeklyWages(store, club.id);
      if (
        club.transfer_budget - amount < 0 ||
        club.wage_budget + amount / 52 < wages
      )
        throw new GameError(
          "The revised budgets must cover current wages and keep the transfer allocation non-negative.",
        );
      store.run(
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
      const settings = settingsOf(store);
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
      store.setMeta("state", state);
      return { message: "Director skill developed." };
    }
    case "read-news": {
      const id = body.id === undefined ? undefined : idSchema.parse(body.id);
      if (id) store.run("UPDATE news SET read = 1 WHERE id = ?", id);
      else store.run("UPDATE news SET read = 1");
      return { message: "Inbox updated." };
    }
    default:
      throw new GameError("Unknown game action.");
  }
}

export function createApp(store: Store, saveFolder?: string) {
  const app = express();
  const saves = new Saves(store, saveFolder);
  let busy = false;
  app.disable("x-powered-by");
  app.use((request, response, next) => {
    response.setHeader("X-Content-Type-Options", "nosniff");
    response.setHeader("Referrer-Policy", "same-origin");
    response.setHeader("X-Frame-Options", "DENY");
    if (!["GET", "HEAD"].includes(request.method) && request.headers.origin) {
      try {
        const origin = new URL(request.headers.origin);
        if (!["127.0.0.1", "localhost", "[::1]"].includes(origin.hostname))
          return response.status(403).json({
            error: "This local game does not accept cross-origin commands.",
          });
      } catch {
        return response.status(403).json({ error: "Invalid request origin." });
      }
    }
    if (request.path.startsWith("/api"))
      response.setHeader("Cache-Control", "no-store");
    next();
  });
  app.use(express.json({ limit: "128kb" }));
  const mutation =
    (
      handler: (
        request: Request,
        response: Response,
      ) => unknown | Promise<unknown>,
    ) =>
    async (request: Request, response: Response, next: NextFunction) => {
      if (busy)
        return response.status(409).json({
          error:
            "The game is saving or advancing. Please wait for that operation to finish.",
        });
      busy = true;
      try {
        await handler(request, response);
      } catch (error) {
        next(error);
      } finally {
        busy = false;
      }
    };
  app.get("/api/health", (_request, response) =>
    response.json({
      status: "ok",
      database: "SQLite",
      localOnly: true,
      testCareer: /(?:^|\/)(browser-test|e2e)\.sqlite$/.test(store.path),
      date: stateOf(store).date,
    }),
  );
  app.get("/api/bootstrap", (_request, response) =>
    response.json(query.bootstrap(store)),
  );
  app.get("/api/dashboard", (_request, response) =>
    response.json(query.dashboard(store)),
  );
  app.get("/api/players", (request, response) =>
    response.json(query.players(store, request.query)),
  );
  app.get("/api/players/:id", (request, response) =>
    response.json(query.playerDetail(store, idSchema.parse(request.params.id))),
  );
  app.get("/api/squad", (_request, response) =>
    response.json(query.squad(store)),
  );
  app.get("/api/scouting", (_request, response) =>
    response.json(query.scouting(store)),
  );
  app.get("/api/transfers", (_request, response) =>
    response.json(query.transfers(store)),
  );
  app.get("/api/loans", (_request, response) =>
    response.json(query.loans(store)),
  );
  app.get("/api/staff", (_request, response) =>
    response.json(query.staff(store)),
  );
  app.get("/api/training", (_request, response) =>
    response.json(query.training(store)),
  );
  app.get("/api/academy", (_request, response) =>
    response.json(query.academy(store)),
  );
  app.get("/api/finances", (_request, response) =>
    response.json(query.finances(store)),
  );
  app.get("/api/news", (request, response) => {
    const category = z
      .string()
      .max(30)
      .optional()
      .parse(request.query.category);
    response.json(
      store.all(
        `SELECT * FROM news ${category ? "WHERE category = ?" : ""} ORDER BY id DESC LIMIT 150`,
        ...(category ? [category] : []),
      ),
    );
  });
  app.get("/api/clubs", (request, response) => {
    const filter = z
      .object({
        q: z.string().max(100).default(""),
        country: idSchema.optional(),
        limit: z.coerce.number().int().min(1).max(500).default(60),
      })
      .parse(request.query);
    response.json(
      store.all<Club>(
        `SELECT clubs.*, countries.name AS country_name, countries.code AS country_code FROM clubs JOIN countries ON countries.id = clubs.country_id WHERE clubs.type = 'club' AND clubs.name LIKE ? ${filter.country ? "AND country_id = ?" : ""} ORDER BY clubs.reputation DESC LIMIT ?`,
        `%${filter.q}%`,
        ...(filter.country ? [filter.country] : []),
        filter.limit,
      ),
    );
  });
  app.get("/api/leagues", (request, response) => {
    const filter = z
      .object({
        q: z.string().max(100).default(""),
        country: idSchema.optional(),
        confederation: z.string().max(20).optional(),
        kind: z
          .enum(["league", "cup", "continental", "international", "youth"])
          .optional(),
        age: z.string().max(10).optional(),
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
    response.json(
      store.all(
        `SELECT leagues.*, countries.name AS country_name FROM leagues LEFT JOIN countries ON countries.id = leagues.country_id WHERE ${where.join(" AND ")} ORDER BY leagues.reputation DESC, leagues.name LIMIT ?`,
        ...params,
        filter.limit,
      ),
    );
  });
  app.get("/api/leagues/:id", (request, response) =>
    response.json(query.competition(store, idSchema.parse(request.params.id))),
  );
  app.get("/api/matches", (request, response) =>
    response.json(
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
  app.get("/api/matches/:id", (request, response) =>
    response.json(query.matchDetail(store, idSchema.parse(request.params.id))),
  );
  app.post(
    "/api/action",
    mutation((request, response) => {
      const result = store.transaction(() =>
        dispatchAction(store, request.body),
      );
      response.json(result ?? { message: "Done." });
    }),
  );
  app.patch(
    "/api/settings",
    mutation((request, response) =>
      response.json(
        store.transaction(() => updateSettings(store, request.body)),
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
      const result = {
        from: stateOf(store).date,
        date: stateOf(store).date,
        days: 0,
        matches: 0,
        seconds: 0,
      };
      for (let step = 0; step < days; step++) {
        const day = advance(store, 1);
        result.days += day.days;
        result.matches += day.matches;
        result.date = day.date;
        const settings = settingsOf(store);
        const elapsed = daysBetween(
          stateOf(store).lastAutosave,
          stateOf(store).date,
        );
        if (
          settings.autosave === "daily" ||
          (settings.autosave === "weekly" && elapsed >= 7) ||
          (settings.autosave === "monthly" && elapsed >= 28)
        )
          await saves.create("Career", true);
        if (stateOf(store).gameOver) break;
      }
      result.seconds = Math.round((performance.now() - started) / 10) / 100;
      response.json(result);
    }),
  );
  app.get("/api/saves", (_request, response) => response.json(saves.list()));
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
    mutation((request, response) => {
      saves.restore(
        z.object({ file: z.string().max(200) }).parse(request.body).file,
      );
      response.json({ message: "Career restored." });
    }),
  );
  app.get(
    "/api/saves/export",
    mutation(async (_request, response) => {
      const result = await saves.export();
      response.setHeader(
        "Content-Disposition",
        `attachment; filename="${result.name}"`,
      );
      response.type("application/octet-stream").send(result.bytes);
    }),
  );
  app.post(
    "/api/saves/import",
    express.raw({ type: "application/octet-stream", limit: "700mb" }),
    mutation((request, response) => {
      if (!Buffer.isBuffer(request.body))
        throw new GameError("Upload a SQLite or gzip save file.");
      saves.import(request.body);
      response.json({ message: "Local save imported." });
    }),
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
      if (error instanceof z.ZodError)
        return response.status(400).json({
          error: error.issues
            .map(
              (issue) =>
                `${issue.path.join(".") || "Request"}: ${issue.message}`,
            )
            .join("; "),
        });
      if (error instanceof GameError)
        return response.status(error.status).json({ error: error.message });
      console.error(error);
      return response.status(500).json({
        error:
          error instanceof Error
            ? error.message
            : "An unexpected game error occurred.",
      });
    },
  );
  return app;
}
