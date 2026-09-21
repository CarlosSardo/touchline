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
] as const;
type EventKind = (typeof EVENT_KINDS)[number];
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
      "SELECT TOP (31) * FROM unexpected_events WHERE club_id = ? ORDER BY date DESC,id DESC",
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

export async function createUnexpectedEvent(store: Store, kind: EventKind) {
  const state = await stateOf(store);
  const club = await clubOf(store);
  const existing = await store.get<{ id: number }>(
    "SELECT TOP (1) id FROM unexpected_events WHERE club_id = ? AND (status = 'pending' OR date = ?) ORDER BY id DESC",
    club.id,
    state.date,
  );
  if (existing) return existing.id;
  const random = seedrandom(
    `${state.seed}:event-detail:${club.id}:${state.date}`,
  );
  const players = await store.all<Player>(
    "SELECT TOP (18) * FROM players WHERE club_id = ? AND role != 'Retired' AND age_group = 'Senior' ORDER BY ability DESC,id",
    club.id,
  );
  const player = players[Math.floor(random() * players.length)];
  const cost = Math.round(clamp(club.reputation ** 2 * 6, 2000, 60000));
  let title: string;
  let body: string;
  let options: EventOption[];
  if (kind === "training-ground") {
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
    ...(kind === "agent-interview" && player
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
        "SELECT value FROM meta WHERE [key] = ?",
        key,
      )
    )?.value === JSON.stringify(state.date)
  )
    return null;
  await store.setMeta(key, state.date);
  if (
    await store.get(
      "SELECT id FROM unexpected_events WHERE club_id = ? AND status = 'pending'",
      state.clubId,
    )
  )
    return null;
  const level = (await unexpectedEvents(store)).frequency;
  const configuration = FREQUENCIES[level];
  const last = await store.get<{ date: string; kind: EventKind }>(
    "SELECT TOP (1) date,kind FROM unexpected_events WHERE club_id = ? ORDER BY date DESC,id DESC",
    state.clubId,
  );
  if (last && daysBetween(last.date, state.date) < configuration.cooldown)
    return null;
  const random = seedrandom(
    `${state.seed}:unexpected:${state.clubId}:${state.date}`,
  );
  if (random() >= configuration.chance) return null;
  const choices = EVENT_KINDS.filter((kind) => kind !== last?.kind);
  return await createUnexpectedEvent(
    store,
    choices[Math.floor(random() * choices.length)],
  );
}
