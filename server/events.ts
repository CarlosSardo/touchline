import seedrandom from "seedrandom";
import { Store } from "./db.ts";
import { addDays, clamp, daysBetween } from "../shared/rules.ts";
import {
  clubOf,
  GameError,
  ledger,
  news,
  settingsOf,
  stateOf,
} from "./systems.ts";
import type { Player } from "../shared/types.ts";
import type {
  EventOption,
  UnexpectedEvent,
  UnexpectedEventsData,
} from "../shared/api.ts";

const FREQUENCIES = {
  low: { chance: 0.025, cooldown: 10 },
  medium: { chance: 0.07, cooldown: 6 },
  high: { chance: 0.15, cooldown: 3 },
};
export const EVENT_KINDS = [
  "training-ground",
  "travel",
  "sponsor",
  "agent-interview",
  "community",
  "illness",
  "frozen-pitch",
  "heatwave",
  "floodlights",
  "media-leak",
  "charity-match",
  "kit-supplier",
] as const;
type EventKind = (typeof EVENT_KINDS)[number];
/** A kind is not drawn again while it is among the club's last `RECENT_KINDS` events. */
const RECENT_KINDS = 4;
/** Codes whose seasons are shifted by six months (southern hemisphere). */
const SOUTHERN = new Set(["AR", "AU", "BO", "BR", "CL", "NZ", "PE", "PY", "UY", "ZA"]);
/** Frozen pitches: European and cold-winter leagues only. */
const COLD_WINTER = new Set(["CA", "CN", "JP", "KR", "US"]);

export interface EventContext {
  /** Calendar month 1-12. */
  month: number;
  countryCode: string;
  confederation: string;
  /** The first team's next fixture within three days. */
  fixture: { home: boolean } | null;
  hasPlayers: boolean;
  /** Kinds of the club's latest events, newest first. */
  recent: readonly string[];
}

/** Weighted kinds that fit the date, the fixture list and the squad (0 = not possible now). */
export function eventWeights(context: EventContext): [EventKind, number][] {
  const month = SOUTHERN.has(context.countryCode) ? ((context.month + 5) % 12) + 1 : context.month;
  const winter = [12, 1, 2].includes(month);
  const summer = [6, 7, 8].includes(month);
  const offSeason = month === 6;
  const dark = [10, 11, 12, 1, 2, 3].includes(month);
  const cold = context.confederation === "UEFA" || COLD_WINTER.has(context.countryCode);
  const weights: Record<EventKind, number> = {
    "training-ground": offSeason ? 0 : 1,
    travel: context.fixture && !context.fixture.home ? 1.5 : 0,
    sponsor: 1,
    "agent-interview": context.hasPlayers && !offSeason ? 1 : 0,
    community: 1,
    illness: winter ? 1.6 : summer ? 0 : 1,
    "frozen-pitch": winter && cold && context.fixture?.home ? 2 : 0,
    heatwave: summer && !offSeason ? 1.2 : 0,
    floodlights: dark && context.fixture?.home ? 1 : 0,
    "media-leak": context.hasPlayers && !offSeason ? 0.8 : 0,
    "charity-match": !context.fixture && (summer || month === 5) ? 1 : 0,
    "kit-supplier": 0.6,
  };
  const recent = new Set(context.recent.slice(0, RECENT_KINDS));
  return EVENT_KINDS.map((kind) => [kind, recent.has(kind) ? 0 : weights[kind]]);
}

export function pickEventKind(context: EventContext, roll: number): EventKind | undefined {
  const options = eventWeights(context).filter(([, weight]) => weight > 0);
  if (!options.length) return undefined;
  let remaining = roll * options.reduce((total, [, weight]) => total + weight, 0);
  for (const [kind, weight] of options) {
    remaining -= weight;
    if (remaining < 0) return kind;
  }
  return options.at(-1)![0];
}
type EventRow = Omit<UnexpectedEvent, "details"> & { data: string };
const readEvent = (row: EventRow): UnexpectedEvent => ({
  ...row,
  details: JSON.parse(row.data),
});

export async function unexpectedEvents(
  store: Store,
): Promise<UnexpectedEventsData> {
  const state = await stateOf(store);
  const frequency = (await settingsOf(store)).unexpectedEvents;
  const all = (
    await store.all<EventRow>(
      "SELECT * FROM unexpected_events WHERE club_id = ? ORDER BY date DESC,id DESC LIMIT 31",
      state.clubId,
    )
  ).map(readEvent);
  return {
    frequency:
      frequency === "low" || frequency === "high" ? frequency : "medium",
    pending: all.filter((event) => event.status === "pending"),
    history: all.filter((event) => event.status !== "pending").slice(0, 20),
  };
}

export async function createUnexpectedEvent(store: Store, requested: EventKind) {
  let kind: EventKind = requested;
  const state = await stateOf(store);
  const club = await clubOf(store);
  const existing = await store.get<{ id: number }>(
    "SELECT id FROM unexpected_events WHERE club_id = ? AND (status = 'pending' OR date = ?) ORDER BY id DESC LIMIT 1",
    club.id,
    state.date,
  );
  if (existing) return existing.id;
  const random = seedrandom(
    `${state.seed}:event-detail:${club.id}:${state.date}`,
  );
  const players = await store.all<Player>(
    "SELECT * FROM players WHERE club_id = ? AND role != 'Retired' AND age_group = 'Senior' ORDER BY ability DESC,id LIMIT 18",
    club.id,
  );
  const player = players[Math.floor(random() * players.length)];
  const cost = Math.round(clamp(club.reputation ** 2 * 6, 2000, 60000));
  // Player stories need a senior player; without one the event is the community invitation (and stored as such).
  if ((kind === "agent-interview" || kind === "media-leak") && !player) kind = "community";
  let title: string;
  let body: string;
  let options: EventOption[];
  if (kind === "frozen-pitch") {
    title = "Frost threatens the next home match";
    body =
      "Overnight temperatures have frozen parts of the pitch. The groundstaff can hire frost covers and undersoil heating support, or rely on the usual preparation and hope the referee passes the surface.";
    options = [
      {
        id: "standard",
        label: "Rely on the usual preparation",
        outcome:
          "The pitch passed a late inspection, but the hard surface left the squad stiff and cautious.",
        effects: { fitness: -2, fanMood: -1 },
      },
      {
        id: "covers",
        label: "Hire frost covers and heating",
        outcome: "The covers protected the surface and the match went ahead without disruption.",
        effects: { cash: -Math.round(cost * 0.5), managerTrust: 1, fanMood: 1 },
      },
    ];
  } else if (kind === "heatwave") {
    title = "Heatwave warning for the training week";
    body =
      "A heatwave is forecast. The medical team wants sessions moved to early mornings with extra hydration and cooling support; keeping the normal timetable is cheaper but harder on the players.";
    options = [
      {
        id: "normal",
        label: "Keep the normal timetable",
        outcome: "The squad trained through the heat. The sessions happened, but several players were drained.",
        effects: { fitness: -3 },
      },
      {
        id: "cooling",
        label: "Early sessions with cooling support",
        outcome: "Early starts and cooling support kept the workload safe. The players appreciated the care.",
        effects: { cash: -Math.round(cost * 0.25), morale: 1 },
      },
    ];
  } else if (kind === "floodlights") {
    title = "Floodlight fault before a home match";
    body =
      "An inspection found a failing floodlight bank. An emergency contractor can repair it before kick-off; otherwise the club asks for an earlier kick-off, which supporters will not welcome.";
    options = [
      {
        id: "early",
        label: "Request an earlier kick-off",
        outcome: "The match moved to an earlier slot. It went ahead, but many supporters struggled to attend.",
        effects: { fanMood: -3 },
      },
      {
        id: "repair",
        label: "Pay for the emergency repair",
        outcome: "The contractor fixed the lights in time and the evening kick-off went ahead as planned.",
        effects: { cash: -Math.round(cost * 0.7), fanMood: 1 },
      },
    ];
  } else if (kind === "media-leak" && player) {
    title = `Dressing-room details about ${player.name} leak to the press`;
    body = `A newspaper has published details of a private disagreement involving ${player.name}. The source is unknown. The club can handle it internally or issue a statement.`;
    options = [
      {
        id: "internal",
        label: "Deal with it internally",
        outcome: `The matter stayed inside the club. ${player.name} appreciated the discretion, though the story ran for a few days.`,
        effects: { playerMorale: 2, fanMood: -1 },
      },
      {
        id: "statement",
        label: "Issue a club statement",
        outcome: `The statement ended the speculation, but ${player.name} felt singled out.`,
        effects: { boardPressure: -1, playerMorale: -3 },
      },
    ];
  } else if (kind === "charity-match") {
    title = "Invitation to a charity match";
    body =
      "A local charity has asked the club to play an exhibition match while there is no fixture. Fielding senior players raises more money and goodwill but costs some recovery time; academy players can go instead.";
    options = [
      {
        id: "academy",
        label: "Send academy players",
        outcome: "The academy side played the charity match. Supporters enjoyed seeing the young players.",
        effects: { fanMood: 1 },
      },
      {
        id: "senior",
        label: "Field senior players",
        outcome: "The senior players drew a big crowd and a good sum for the charity, at a small cost in recovery.",
        effects: { fanMood: 4, fitness: -1, morale: 1 },
      },
    ];
  } else if (kind === "kit-supplier") {
    title = "Kit supplier's delivery is delayed";
    body =
      "The kit supplier cannot deliver the next batch of training and match wear on time. The club can pay a local supplier for a stop-gap order or make do with the existing stock.";
    options = [
      {
        id: "wait",
        label: "Make do with existing stock",
        outcome: "The squad made do for a few weeks. It was an irritation more than a problem.",
        effects: { morale: -1 },
      },
      {
        id: "local",
        label: "Place a stop-gap order",
        outcome: "A local supplier covered the gap until the regular delivery arrived.",
        effects: { cash: -Math.round(cost * 0.3) },
      },
    ];
  } else if (kind === "training-ground") {
    title = "Training ground closed after a water leak";
    body =
      "A burst pipe has left the main training area unusable for two days. The facilities team can use an indoor programme, or hire a nearby pitch while repairs are completed.";
    options = [
      {
        id: "indoor",
        label: "Use the indoor programme",
        outcome:
          "The squad used indoor sessions. The disruption cost a little morale and preparation, but no extra cash.",
        effects: { morale: -1, fitness: -1 },
      },
      {
        id: "alternative",
        label: "Hire an alternative pitch",
        outcome:
          "A nearby pitch kept the normal schedule intact. The manager appreciated the quick response.",
        effects: { cash: -cost, managerTrust: 2 },
      },
    ];
  } else if (kind === "travel") {
    title = "Travel provider cancels the team booking";
    body =
      "The club's transport provider has withdrawn at short notice. A replacement service is available at a premium; the budget option involves a longer journey.";
    options = [
      {
        id: "standard",
        label: "Use the longer route",
        outcome:
          "The squad reached its destination, but the longer trip added fatigue.",
        effects: { fitness: -3, morale: -1 },
      },
      {
        id: "replacement",
        label: "Book direct replacement transport",
        outcome: "Replacement transport avoided the additional travel load.",
        effects: { cash: -Math.round(cost * 0.6), managerTrust: 1 },
      },
    ];
  } else if (kind === "sponsor") {
    title = "Sponsor offers an extra commercial appearance";
    body =
      "A sponsor wants a first-team appearance at a regional campaign launch. There is a one-off payment, but the event would take time out of the squad's recovery schedule.";
    options = [
      {
        id: "decline",
        label: "Protect the recovery schedule",
        outcome:
          "The commercial invitation was declined. The manager welcomed the uninterrupted preparation.",
        effects: { managerTrust: 2 },
      },
      {
        id: "attend",
        label: "Accept the sponsor appearance",
        outcome:
          "The club earned the commercial payment. Travel and the appearance reduced recovery time, while the campaign reached new supporters.",
        effects: {
          cash: Math.round(cost * 1.5),
          fitness: -2,
          fanMood: 2,
          managerTrust: -1,
        },
      },
    ];
  } else if (kind === "agent-interview" && player) {
    title = `${player.name}'s representative questions the sporting plan`;
    body = `An interview with ${player.name}'s representative has raised questions about the player's role and the club's ambitions. The player has asked for clarity, but has not requested a transfer.`;
    options = [
      {
        id: "private",
        label: "Hold a private meeting",
        outcome: `You clarified ${player.name}'s role privately. The conversation improved trust without making a public promise.`,
        effects: { playerMorale: 3, boardPressure: -1 },
      },
      {
        id: "public",
        label: "Publicly defend the project",
        outcome:
          "Your public response reassured some supporters but increased scrutiny and left the player feeling exposed.",
        effects: { fanMood: 2, boardPressure: 3, playerMorale: -2 },
      },
    ];
  } else if (kind === "illness") {
    title = "A minor illness disrupts squad preparation";
    body =
      "Several players have reported feeling unwell. The medical team recommends a lighter schedule. You can rearrange the programme internally or pay for additional recovery support.";
    options = [
      {
        id: "rest",
        label: "Switch to light recovery sessions",
        outcome:
          "The schedule was eased while the affected players recovered. Preparation was interrupted, but player wellbeing was prioritised.",
        effects: { fitness: -2, morale: 1 },
      },
      {
        id: "support",
        label: "Arrange additional recovery support",
        outcome:
          "Additional support limited the disruption and reassured the squad.",
        effects: { cash: -Math.round(cost * 0.4), morale: 2 },
      },
    ];
  } else {
    title = "Supporters invite the club to a community fundraiser";
    body =
      "A local supporters' group has organised a community event and asked the club to take part. A small delegation can attend without cost; a full club programme requires funding.";
    options = [
      {
        id: "delegation",
        label: "Send a small club delegation",
        outcome:
          "A club delegation attended and strengthened the relationship with local supporters.",
        effects: { fanMood: 2 },
      },
      {
        id: "programme",
        label: "Fund the full club programme",
        outcome:
          "The wider programme was well received and gave the squad a positive connection with the community.",
        effects: { cash: -Math.round(cost * 0.3), fanMood: 4, morale: 2 },
      },
    ];
  }
  const details: UnexpectedEvent["details"] = {
    defaultChoice: options[0].id,
    options,
    ...((kind === "agent-interview" || kind === "media-leak") && player
      ? { playerId: player.id, playerName: player.name }
      : {}),
  };
  const id = Number(
    (
      await store.run(
        "INSERT INTO unexpected_events(club_id,date,kind,title,body,deadline,data) VALUES (?,?,?,?,?,?,?)",
        club.id,
        state.date,
        kind,
        title,
        body,
        addDays(state.date, 3),
        JSON.stringify(details),
      )
    ).lastInsertRowid,
  );
  await news(
    store,
    "Events",
    title,
    `${body} Your response is due by ${addDays(state.date, 3)}.`,
    "important",
    "board",
    { unexpectedEventId: id, playerId: details.playerId },
  );
  return id;
}

export async function resolveUnexpectedEvent(
  store: Store,
  id: number,
  choiceId: string,
  automatic = false,
) {
  const state = await stateOf(store);
  const row = await store.get<EventRow>(
    "SELECT * FROM unexpected_events WHERE id = ?",
    id,
  );
  if (!row || row.club_id !== state.clubId)
    throw new GameError("This event does not belong to your club.");
  const event = readEvent(row);
  if (event.status !== "pending")
    throw new GameError("This event has already been resolved.");
  if (!automatic && state.date > event.deadline)
    throw new GameError("The response deadline has passed.");
  const choice = event.details.options.find((option) => option.id === choiceId);
  if (!choice || (automatic && choice.id !== event.details.defaultChoice))
    throw new GameError("Choose one of the event's available responses.");
  const effects = choice.effects;
  if (
    (effects.cash ?? 0) < 0 &&
    (await clubOf(store)).balance < -(effects.cash ?? 0)
  )
    throw new GameError(
      "The club cannot afford this response. Choose the no-cost option.",
    );
  if (effects.cash)
    await ledger(
      store,
      state.clubId,
      effects.cash,
      "Unexpected events",
      event.title,
    );
  await store.run(
    "UPDATE clubs SET fan_mood = LEAST(100,GREATEST(0,fan_mood + ?)),board_pressure = LEAST(100,GREATEST(0,board_pressure + ?)),manager_trust = LEAST(100,GREATEST(0,manager_trust + ?)) WHERE id = ?",
    effects.fanMood ?? 0,
    effects.boardPressure ?? 0,
    effects.managerTrust ?? 0,
    state.clubId,
  );
  if (effects.morale || effects.fitness)
    await store.run(
      "UPDATE players SET morale = LEAST(99,GREATEST(1,morale + ?)),fitness = LEAST(99,GREATEST(1,fitness + ?)) WHERE club_id = ? AND role != 'Retired' AND age_group = 'Senior'",
      effects.morale ?? 0,
      effects.fitness ?? 0,
      state.clubId,
    );
  if (effects.playerMorale && event.details.playerId)
    await store.run(
      "UPDATE players SET morale = LEAST(99,GREATEST(1,morale + ?)) WHERE id = ? AND club_id = ?",
      effects.playerMorale,
      event.details.playerId,
      state.clubId,
    );
  const outcome = `${automatic ? "No response was received; the no-cost default was used. " : ""}${choice.outcome}`;
  await store.run(
    "UPDATE unexpected_events SET status = ?,resolved_date = ?,choice_id = ?,outcome = ? WHERE id = ?",
    automatic ? "expired" : "resolved",
    state.date,
    choiceId,
    outcome,
    id,
  );
  await news(
    store,
    "Events",
    `${event.title}: response recorded`,
    outcome,
    "info",
    "board",
    { unexpectedEventId: id },
  );
  return { message: outcome };
}

export async function processUnexpectedEvents(store: Store) {
  const state = await stateOf(store);
  if (state.gameOver) return null;
  for (const row of await store.all<EventRow>(
    "SELECT * FROM unexpected_events WHERE club_id = ? AND status = 'pending' AND deadline < ? ORDER BY id",
    state.clubId,
    state.date,
  )) {
    const event = readEvent(row);
    await resolveUnexpectedEvent(
      store,
      event.id,
      event.details.defaultChoice,
      true,
    );
  }
  const key = `unexpectedCheck:${state.clubId}`;
  if (
    (
      await store.get<{ value: string }>(
        "SELECT value FROM meta WHERE key = ?",
        key,
      )
    )?.value === JSON.stringify(state.date)
  )
    return null;
  await store.setMeta(key, state.date);
  if (
    await store.get(
      "SELECT id FROM unexpected_events WHERE club_id = ? AND status = 'pending' LIMIT 1",
      state.clubId,
    )
  )
    return null;
  const level = (await unexpectedEvents(store)).frequency;
  const configuration = FREQUENCIES[level];
  const recent = await store.all<{ date: string; kind: string }>(
    `SELECT date,kind FROM unexpected_events WHERE club_id = ? ORDER BY date DESC,id DESC LIMIT ${RECENT_KINDS}`,
    state.clubId,
  );
  const last = recent[0];
  if (last && daysBetween(last.date, state.date) < configuration.cooldown)
    return null;
  const random = seedrandom(
    `${state.seed}:unexpected:${state.clubId}:${state.date}`,
  );
  if (random() >= configuration.chance) return null;
  const club = (await store.get<{ code: string; confederation: string }>(
    "SELECT countries.code,countries.confederation FROM clubs JOIN countries ON countries.id = clubs.country_id WHERE clubs.id = ?",
    state.clubId,
  ))!;
  const fixture = await store.get<{ home_id: number }>(
    "SELECT fixtures.home_id FROM fixtures LEFT JOIN leagues ON leagues.id = fixtures.league_id WHERE (fixtures.home_id = ? OR fixtures.away_id = ?) AND fixtures.status = 'scheduled' AND fixtures.date BETWEEN ? AND ? AND coalesce(leagues.age_group,'Senior') = 'Senior' ORDER BY fixtures.date,fixtures.id LIMIT 1",
    state.clubId,
    state.clubId,
    state.date,
    addDays(state.date, 3),
  );
  const hasPlayers = !!(await store.get(
    "SELECT id FROM players WHERE club_id = ? AND role != 'Retired' AND age_group = 'Senior' ORDER BY id LIMIT 1",
    state.clubId,
  ));
  const kind = pickEventKind(
    {
      month: Number(state.date.slice(5, 7)),
      countryCode: club.code,
      confederation: club.confederation,
      fixture: fixture ? { home: fixture.home_id === state.clubId } : null,
      hasPlayers,
      recent: recent.map((entry) => entry.kind),
    },
    random(),
  );
  return kind ? await createUnexpectedEvent(store, kind) : null;
}
