import type { Store } from "./db.ts";
import { currentReview, ownerTypeLabel, type Campaign, type Deal, type OwnershipData } from "./ownership.ts";
import { CONTROL_STAKE, OWNER_TYPES } from "./ownership-plan.ts";
import { stateOf } from "./systems.ts";
import { CONTINENTAL } from "../shared/world-catalog/index.ts";
import { money } from "../shared/rules.ts";
import type {
  ClubOwnershipView,
  OwnerSummary,
  OwnershipClubLink,
  OwnershipEventView,
  OwnershipNotice,
  OwnershipOverview,
} from "../shared/api.ts";

const parse = <Value>(text: string | null, fallback: Value): Value => {
  try {
    return text ? (JSON.parse(text) as Value) : fallback;
  } catch {
    return fallback;
  }
};
const percent = (stake: number) => `${Math.round(Number(stake) * 100)}%`;
const competitionName = (id: string) => CONTINENTAL.competitions.find((item) => item.id === id)?.name ?? id;

interface EventRow {
  id: number;
  date: string;
  club_id: number;
  club_name: string;
  kind: string;
  from_name: string | null;
  to_name: string | null;
  data: string;
}

interface EventData {
  stake?: number;
  price?: number;
  seller?: string;
  injection?: number;
  debt?: number;
  buyer?: string;
  buyerType?: string;
  amount?: number;
  dividend?: number;
  winner?: string;
  incumbent?: boolean;
  results?: { name: string; share: number }[];
  date?: string;
  owner?: string;
  competition?: string;
  stage?: string;
  due?: string;
  target?: number;
  confidence?: number;
}

/** A readable line for an ownership event. */
export function describeEvent(row: EventRow): OwnershipEventView {
  const data = parse<EventData>(row.data, {});
  const [title, detail] = ((): [string, string] => {
    switch (row.kind) {
      case "takeover":
      case "group_acquisition":
        return [
          row.kind === "group_acquisition" ? `Joined ${row.to_name}` : "Takeover",
          `${row.to_name} bought ${percent(data.stake ?? 1)} from ${data.seller ?? row.from_name} for about ${money(data.price ?? 0)}.${data.injection ? ` ${money(data.injection)} of new equity.` : ""}${data.debt ? ` ${money(data.debt)} of acquisition debt placed on the club.` : ""}`,
        ];
      case "minority_investment":
        return ["Minority investment", `${row.to_name} bought ${percent(data.stake ?? 0)} for about ${money(data.price ?? 0)}; the members keep voting control.`];
      case "supporters_trust":
        return ["Supporters' trust takeover", `${row.to_name} took control from ${data.seller ?? row.from_name}.`];
      case "takeover_rumour":
        return ["Sale explored", `Interest from a ${ownerTypeLabel(data.buyerType ?? "")}.`];
      case "takeover_bid":
        return ["Bid agreed in principle", `${data.buyer} (${ownerTypeLabel(data.buyerType ?? "")}) for ${percent(data.stake ?? 1)} at about ${money(data.price ?? 0)}.`];
      case "takeover_collapsed":
        return ["Takeover collapsed", `Talks with ${data.buyer} ended without a deal.`];
      case "equity_injection":
        return ["Owner investment", `${money(data.amount ?? 0)} of new equity from ${row.to_name}.`];
      case "asset_stripping":
        return ["Dividend extracted", `${row.to_name} took a ${money(data.dividend ?? 0)} special dividend.`];
      case "election":
        return [
          "Presidential election",
          `${data.winner} ${data.incumbent ? "re-elected" : "elected"} (${(data.results ?? []).map((entry) => `${entry.name} ${entry.share}%`).join(", ")}).`,
        ];
      case "election_called":
        return ["Early election called", `A motion of censure forced an election on ${data.date}.`];
      case "blind_trust":
        return ["Blind trust", `${row.to_name ?? data.owner ?? "The owner"} placed the club in a blind trust before UEFA's multi-club deadline.`];
      case "uefa_exclusion":
        return ["UEFA multi-club rule", `Excluded from the ${competitionName(data.competition ?? "")} (common control with a better-placed club).`];
      case "uefa_blind_trust":
        return ["UEFA multi-club rule", `Cleared for the ${competitionName(data.competition ?? "")} thanks to the blind trust.`];
      case "director_review":
        return [
          "Director review",
          data.stage === "started"
            ? `The new leadership will review the sporting director on ${data.due} (target confidence ${data.target}).`
            : data.stage === "confirmed"
              ? `The sporting director was confirmed (confidence ${data.confidence}).`
              : `The sporting director was replaced (confidence ${data.confidence}, target ${data.target}).`,
        ];
      default:
        return [row.kind, ""];
    }
  })();
  return { id: row.id, date: row.date, clubId: row.club_id, clubName: row.club_name, kind: row.kind, title, detail };
}

const EVENT_SELECT = `SELECT events.id, events.date, events.club_id, clubs.name AS club_name, events.kind,
    from_owner.name AS from_name, to_owner.name AS to_name, events.data
  FROM ownership_events AS events JOIN clubs ON clubs.id = events.club_id
  LEFT JOIN owners AS from_owner ON from_owner.id = events.from_owner_id
  LEFT JOIN owners AS to_owner ON to_owner.id = events.to_owner_id`;

interface OwnerRow {
  id: number;
  name: string;
  type: OwnerSummary["type"];
  country_name: string | null;
  wealth: number;
  ambition: number;
  patience: number;
}
const summary = (row: OwnerRow): OwnerSummary => ({
  id: row.id,
  name: row.name,
  type: row.type,
  typeLabel: ownerTypeLabel(row.type),
  countryName: row.country_name,
  wealth: row.wealth,
  ambition: row.ambition,
  patience: row.patience,
});

async function groupClubs(store: Store, ownerIds: number[]) {
  const rows = await store.all<{
    owner_id: number;
    id: number;
    name: string;
    color: string;
    country_name: string;
    league_name: string | null;
    tier: number | null;
    stake: number;
    blind_trust: boolean;
  }>(
    `SELECT ownership.owner_id, clubs.id, clubs.name, clubs.color, countries.name AS country_name, leagues.name AS league_name,
       leagues.tier, ownership.stake, ownership.blind_trust
     FROM club_ownership AS ownership JOIN clubs ON clubs.id = ownership.club_id JOIN countries ON countries.id = clubs.country_id
     LEFT JOIN leagues ON leagues.id = clubs.league_id
     WHERE ownership.owner_id = ANY(?::integer[]) AND NOT ownership.member_owned AND ownership.stake >= ?
     ORDER BY clubs.reputation DESC, clubs.id`,
    ownerIds,
    CONTROL_STAKE,
  );
  const result = new Map<number, OwnershipClubLink[]>();
  for (const row of rows)
    result.set(row.owner_id, [
      ...(result.get(row.owner_id) ?? []),
      { id: row.id, name: row.name, color: row.color, countryName: row.country_name, leagueName: row.league_name, tier: row.tier, stake: row.stake, blindTrust: row.blind_trust },
    ]);
  return result;
}

/** Ownership section of a club profile (reserve teams show their parent's owner). */
export async function clubOwnership(store: Store, clubId: number): Promise<ClubOwnershipView> {
  const club = await store.get<{ root_id: number }>("SELECT coalesce(parent_id, id) AS root_id FROM clubs WHERE id = ?", clubId);
  const row = club
    ? await store.get<OwnerRow & { owner_id: number; stake: number; since: string; member_owned: boolean; president: string | null; next_election: string | null; blind_trust: boolean; ownership_data: string }>(
        `SELECT owners.id, owners.name, owners.type, countries.name AS country_name, owners.wealth, owners.ambition, owners.patience,
           ownership.owner_id, ownership.stake, ownership.since, ownership.member_owned, ownership.president, ownership.next_election,
           ownership.blind_trust, ownership.data AS ownership_data
         FROM club_ownership AS ownership JOIN owners ON owners.id = ownership.owner_id
         LEFT JOIN countries ON countries.id = owners.country_id WHERE ownership.club_id = ?`,
        club.root_id,
      )
    : undefined;
  const empty: ClubOwnershipView = {
    clubId,
    ready: false,
    owner: null,
    stake: 0,
    since: null,
    memberOwned: false,
    president: null,
    presidentSince: null,
    nextElection: null,
    termYears: null,
    rule: null,
    exemption: null,
    blindTrust: false,
    debt: 0,
    investors: [],
    group: null,
    pending: null,
    election: null,
    events: [],
  };
  if (!club || !row) return empty;
  const data = parse<OwnershipData>(row.ownership_data, {});
  const controls = !row.member_owned && row.stake >= CONTROL_STAKE;
  const clubs = controls ? ((await groupClubs(store, [row.owner_id])).get(row.owner_id) ?? []) : [];
  const deal: Deal | undefined = data.deal;
  const election: Campaign | undefined = data.election;
  const events = await store.all<EventRow>(
    `${EVENT_SELECT} WHERE events.club_id = ? AND events.kind <> 'director_review' ORDER BY events.date DESC, events.id DESC LIMIT 40`,
    club.root_id,
  );
  return {
    ...empty,
    ready: true,
    owner: summary(row),
    stake: row.stake,
    since: row.since,
    memberOwned: row.member_owned,
    president: row.president,
    presidentSince: data.presidentSince ?? null,
    nextElection: row.next_election,
    termYears: data.termYears ?? null,
    rule: data.rule ?? null,
    exemption: data.exemption ?? null,
    blindTrust: row.blind_trust,
    debt: data.debt ?? 0,
    investors: data.investors ?? [],
    group: clubs.length > 1 ? { ownerId: row.owner_id, name: row.name, clubs } : null,
    pending: deal
      ? { stage: deal.stage, buyerName: deal.stage === "talks" ? deal.buyerName : null, buyerType: deal.buyerType, expected: deal.stage === "talks" ? deal.completes : deal.talks }
      : null,
    election: election ? { date: election.date, candidates: election.candidates } : null,
    events: events.map(describeEvent),
  };
}

/** World view: owner types, every multi-club group with its clubs, and the latest ownership events. */
export async function ownershipOverview(store: Store): Promise<OwnershipOverview> {
  const types = await store.all<{ type: OwnerSummary["type"]; clubs: number }>(
    "SELECT owners.type, count(*) AS clubs FROM club_ownership AS ownership JOIN owners ON owners.id = ownership.owner_id GROUP BY owners.type",
  );
  if (!types.length) return { ready: false, types: [], groups: [], events: [] };
  const owners = await store.all<OwnerRow>(
    `SELECT owners.id, owners.name, owners.type, countries.name AS country_name, owners.wealth, owners.ambition, owners.patience
     FROM owners LEFT JOIN countries ON countries.id = owners.country_id
     WHERE owners.id IN (SELECT owner_id FROM club_ownership WHERE NOT member_owned AND stake >= ? GROUP BY owner_id HAVING count(*) > 1)
     ORDER BY owners.wealth DESC, owners.id`,
    CONTROL_STAKE,
  );
  const clubs = await groupClubs(store, owners.map((owner) => owner.id));
  const events = await store.all<EventRow>(
    `${EVENT_SELECT} WHERE events.kind IN ('takeover', 'group_acquisition', 'minority_investment', 'supporters_trust', 'election', 'blind_trust', 'uefa_exclusion', 'uefa_blind_trust')
     ORDER BY events.date DESC, events.id DESC LIMIT 40`,
  );
  return {
    ready: true,
    types: OWNER_TYPES.map((type) => ({ type, label: ownerTypeLabel(type), clubs: types.find((row) => row.type === type)?.clubs ?? 0 })),
    groups: owners.map((owner) => ({ owner: summary(owner), clubs: clubs.get(owner.id) ?? [] })),
    events: events.map(describeEvent),
  };
}

/** Office notice for the director's club: takeover stage, the owners' review, or an election campaign. */
export async function ownershipNotice(store: Store): Promise<OwnershipNotice | null> {
  const state = await stateOf(store);
  const club = await store.get<{ name: string; board_confidence: number; data: string | null; member_owned: boolean | null }>(
    `SELECT clubs.name, clubs.board_confidence, ownership.data, ownership.member_owned
     FROM clubs LEFT JOIN club_ownership AS ownership ON ownership.club_id = clubs.id WHERE clubs.id = ?`,
    state.clubId,
  );
  if (!club) return null;
  const confidence = Math.round(club.board_confidence);
  const review = await currentReview(store);
  if (review && review.clubId === state.clubId)
    return {
      clubId: state.clubId,
      stage: "review",
      title: `${review.ownerName} are reviewing your work`,
      detail: `Board confidence of at least ${review.target} by ${review.due} keeps you in post.`,
      due: review.due,
      target: review.target,
      confidence,
    };
  const data = parse<OwnershipData>(club.data, {});
  if (data.deal)
    return {
      clubId: state.clubId,
      stage: data.deal.stage,
      title: data.deal.stage === "talks" ? `Takeover talks: ${data.deal.buyerName}` : `Takeover talk at ${club.name}`,
      detail:
        data.deal.stage === "talks"
          ? `A ${ownerTypeLabel(data.deal.buyerType)} has agreed terms in principle for ${percent(data.deal.stake)} of the club. Completion is expected around ${data.deal.completes}.`
          : `The owners are considering offers; a formal bid could follow around ${data.deal.talks}. Your budget and objectives stand until a deal completes.`,
      due: data.deal.stage === "talks" ? data.deal.completes : data.deal.talks,
      target: null,
      confidence,
    };
  if (data.election)
    return {
      clubId: state.clubId,
      stage: "election",
      title: `Presidential election on ${data.election.date}`,
      detail: data.election.candidates.map((candidate) => `${candidate.name}${candidate.incumbent ? " (president)" : ""}: ${candidate.promise}`).join(" · "),
      due: data.election.date,
      target: null,
      confidence,
    };
  return null;
}
