import seedrandom from "seedrandom";
import { z } from "zod";
import { Store } from "./db.ts";
import { addDays, dateLabel, money } from "../shared/rules.ts";
import type {
  Club,
  Fixture,
  GameState,
  MatchResult,
  MatchSnapshot,
  NewsItem,
  Player,
} from "../shared/types.ts";
import type {
  Journalist,
  MediaComment,
  MediaData,
  MediaReport,
} from "../shared/api.ts";

export const JOURNALISTS: Journalist[] = [
  {
    id: "luca-bellandi",
    name: "Luca Bellandi",
    handle: "@LucaOnTransfers",
    outlet: "Transfer Wire",
    beat: "Transfers",
    reliability: 89,
    style: "Fast, well-connected, clear about the remaining steps",
    biography:
      "A fictional transfer correspondent with contacts among agents and recruitment teams. Separates agreed terms from registered deals.",
  },
  {
    id: "ellis-whitmore",
    name: "Ellis Whitmore",
    handle: "@EllisReports",
    outlet: "The Football Ledger",
    beat: "Club affairs",
    reliability: 95,
    style: "Measured, documents first, cautious with rumours",
    biography:
      "A fictional investigative reporter covering club strategy, fees and boardroom decisions. Prefers a verified story to an early one.",
  },
  {
    id: "amara-diallo",
    name: "Amara Diallo",
    handle: "@AmaraTactics",
    outlet: "Final Third",
    beat: "Analysis",
    reliability: 91,
    style: "Tactical fit and evidence over reputation",
    biography:
      "A fictional analyst examining roles, match performance and whether a signing solves a genuine squad need.",
  },
  {
    id: "sofia-marin",
    name: "Sofia Marin",
    handle: "@SofiaPathways",
    outlet: "Next XI",
    beat: "Academy",
    reliability: 86,
    style: "Patient with prospects, demanding about pathways",
    biography:
      "A fictional youth-football correspondent following development loans, academy opportunities and young players' minutes.",
  },
  {
    id: "jonas-mercier",
    name: "Jonas Mercier",
    handle: "@JonasMatchday",
    outlet: "The Local Stand",
    beat: "Supporters",
    reliability: 82,
    style: "Direct, local and alert to dressing-room mood",
    biography:
      "A fictional club reporter connecting matchday reaction with the concerns of regular supporters.",
  },
];

interface ReportInput extends Omit<
  MediaReport,
  "journalistId" | "comments" | "confidence"
> {
  title: string;
  club: Club;
  beats: string[];
  discussion: string[];
}

async function publish(store: Store, input: ReportInput) {
  const existing = await store.get<{ id: number }>(
    "SELECT TOP (1) id FROM news WHERE JSON_VALUE(data,'$.mediaKey') = ?",
    input.mediaKey,
  );
  if (existing) return existing.id;
  const state = await store.meta<GameState>("state");
  const random = seedrandom(`${state.seed}:media:${input.mediaKey}`);
  const sources = JOURNALISTS.filter((journalist) =>
    input.beats.includes(journalist.beat),
  );
  const journalist =
    sources[Math.floor(random() * sources.length)] ?? JOURNALISTS[0];
  const initials = input.club.name
    .split(" ")
    .map((word) => word[0])
    .join("")
    .toLowerCase();
  const comments: MediaComment[] = input.discussion.map((text, index) => ({
    id: `${input.mediaKey}:comment:${index}`,
    author: [
      `${input.club.city} Matchgoer`,
      "Maya / Recruitment Notes",
      `${input.club.name} Supporters`,
      "The Academy Notebook",
    ][index % 4],
    handle: [
      `@${initials}matchday`,
      "@MayaRecruitment",
      `@${initials}collective`,
      "@AcademyNotebook",
    ][index % 4],
    role: index === 1 ? "Analyst" : "Supporter",
    text,
    sentiment: index === 0 ? "positive" : index === 2 ? "critical" : "balanced",
    likes: Math.round((input.club.reputation + 5) * (1 + random() * 15)),
  }));
  const report: MediaReport = {
    mediaKey: input.mediaKey,
    topic: input.topic,
    status: input.status,
    journalistId: journalist.id,
    clubIds: [...new Set(input.clubIds)],
    playerId: input.playerId,
    playerName: input.playerName,
    fixtureId: input.fixtureId,
    negotiationId: input.negotiationId,
    fee: input.fee,
    paragraphs: input.paragraphs,
    comments,
    confidence: input.status === "Confirmed" ? 100 : journalist.reliability,
  };
  return Number(
    (
      await store.run(
        "INSERT INTO news(date,category,title,body,severity,action,data) VALUES (?,'Media',?,?,'info','media',?)",
        state.date,
        input.title,
        input.paragraphs[0],
        JSON.stringify(report),
      )
    ).lastInsertRowid,
  );
}

export async function publishTransferStory(
  store: Store,
  input: {
    key: string;
    phase: "interest" | "bid" | "agreement" | "signing";
    playerId: number;
    buyerId: number;
    sellerId: number | null;
    fee: number;
    loan?: boolean;
    negotiationId?: number;
    arrivalDate?: string;
  },
) {
  const player = (await store.get<Player>(
    "SELECT * FROM players WHERE id = ?",
    input.playerId,
  ))!;
  const buyer = (await store.get<Club>(
    "SELECT * FROM clubs WHERE id = ?",
    input.buyerId,
  ))!;
  const seller = input.sellerId
    ? await store.get<Club>("SELECT * FROM clubs WHERE id = ?", input.sellerId)
    : null;
  const state = await store.meta<GameState>("state");
  const club = seller?.id === state.clubId ? seller : buyer;
  const joining = input.loan ? "loan" : "transfer";
  const headlines = {
    interest: `${buyer.name} make their interest in ${player.name} public`,
    bid: `${buyer.name} submit ${joining} offer for ${player.name}`,
    agreement: input.arrivalDate
      ? `${buyer.name} agree future move for ${player.name}`
      : `${player.name} and ${buyer.name}: agreement reached, clearance still to come`,
    signing: `${buyer.name} confirm ${player.name}${input.loan ? " on loan" : " signing"}`,
  };
  const first =
    input.phase === "signing"
      ? `${player.name}'s ${joining} to ${buyer.name} is registered${seller ? ` from ${seller.name}` : " as a free agent"}. ${input.fee > 0 ? `The agreed ${input.loan ? "loan " : ""}fee is ${money(input.fee)}.` : "No transfer fee is due."}`
      : input.phase === "agreement"
        ? input.arrivalDate
          ? `${buyer.name} and ${player.name} have reached a conditional future agreement for arrival no earlier than ${dateLabel(input.arrivalDate)}. The player stays with the current club while registered there; the move still requires adulthood, a medical and registration clearance.`
          : `${buyer.name} and ${player.name} have reached a conditional agreement. Medical and registration clearance remain outstanding; this is not yet a completed signing.`
        : input.phase === "bid"
          ? `${buyer.name} have made a ${money(input.fee)} ${joining} proposal for ${player.name}. ${seller?.name ?? "The player's representatives"} must still agree to the move, and personal terms are not settled.`
          : `${buyer.name} have declared an interest in ${player.name}. There is no signed agreement, and public interest alone does not secure the player's services.`;
  const expensive = !input.loan && input.fee > player.value * 1.15;
  const currentMinutes =
    player.minutes > 0
      ? `${player.minutes} simulated minutes, ${player.goals} goals and ${player.assists} assists this season`
      : "no minutes recorded in the current simulated season";
  return await publish(store, {
    mediaKey: input.key,
    title: headlines[input.phase],
    topic: "transfer",
    status: input.phase === "signing" ? "Confirmed" : "Reported",
    club,
    clubIds: [buyer.id, ...(seller ? [seller.id] : [])],
    playerId: player.id,
    playerName: player.name,
    negotiationId: input.negotiationId,
    fee: input.fee,
    beats: input.loan
      ? ["Transfers", "Academy"]
      : ["Transfers", "Club affairs"],
    paragraphs: [
      first,
      `${player.name}, ${player.age}, is a ${player.position} with ${currentMinutes}. ${input.loan ? "The key question is whether the receiving manager can deliver the agreed playing-time pathway." : player.age <= 23 ? "There is development potential here, but expectations need to leave room for a young player to settle." : "This is a decision about the first team now, not just a future resale."}`,
      `${buyer.manager}'s ${buyer.formation} and ${buyer.tactical_style.toLowerCase()} approach will shape the fit. ${expensive ? "The proposed fee is above the current game valuation, so the sporting department will have to justify that premium." : "The fee is only part of the judgment: wages, squad competition and a credible role matter too."}`,
    ],
    discussion: [
      `${player.name} gives this story an actual football angle. A ${player.position} who fits the manager's plan is more useful than another name for the announcement.`,
      input.loan
        ? `For ${player.name}, the important number is minutes. A loan without a clear route into the side is not development.`
        : `${player.name} is ${player.age}. ${player.minutes ? `Look at the ${player.minutes} minutes already recorded before judging the output.` : "There are no current-season minutes to judge yet. The recruitment case has to go beyond a highlights reel."}`,
      input.phase === "signing"
        ? `${expensive ? "That price is a serious commitment." : "Fine, the paperwork is done."} Now ${buyer.name} need to give ${player.name} a role. An announcement does not fix squad balance.`
        : `People are acting as if ${player.name} has already signed. ${input.phase === "agreement" ? "The medical and registration are still outstanding." : "An offer or a reported interest is not a completed deal."}`,
      seller?.id === state.clubId
        ? `${seller.name} also need a plan for the position being vacated. The money is only useful if the next decision is good.`
        : `${buyer.name}'s younger players will be watching this. Competition is healthy, but the pathway cannot disappear every window.`,
    ],
  });
}

export async function publishPlayerCoverage(store: Store, fixtureId?: number) {
  const state = await store.meta<GameState>("state");
  const club = (await store.get<Club>(
    "SELECT * FROM clubs WHERE id = ?",
    state.clubId,
  ))!;
  let player: Player | undefined;
  let performance: Record<string, number> | undefined;
  let fixture: Fixture | undefined;
  if (fixtureId) {
    fixture = await store.get<Fixture>(
      "SELECT * FROM fixtures WHERE id = ? AND status = 'played' AND (home_id = ? OR away_id = ?)",
      fixtureId,
      club.id,
      club.id,
    );
    if (!fixture) return;
    const saved = JSON.parse(fixture.data) as MatchResult & {
      snapshot: MatchSnapshot;
    };
    const team =
      saved.snapshot.home.id === club.id
        ? saved.snapshot.home
        : saved.snapshot.away;
    const featured = [...team.lineup, ...(team.bench ?? [])]
      .filter((candidate) => saved.players[candidate.id]?.minutes > 0)
      .sort(
        (left, right) =>
          saved.players[right.id].rating - saved.players[left.id].rating,
      )[0];
    if (!featured) return;
    player = await store.get<Player>(
      "SELECT * FROM players WHERE id = ?",
      featured.id,
    );
    performance = saved.players[featured.id];
  } else {
    const roster = await store.all<Player>(
      "SELECT TOP (24) * FROM players WHERE club_id = ? AND parent_club_id IS NULL AND role != 'Retired' ORDER BY ability DESC,id",
      club.id,
    );
    player =
      roster[
        Math.floor(Date.parse(state.date) / 86400000 / 3) %
          Math.max(1, roster.length)
      ];
  }
  if (!player) return;
  const opponentId = fixture
    ? fixture.home_id === club.id
      ? fixture.away_id
      : fixture.home_id
    : undefined;
  const opponent = opponentId
    ? await store.get<Club>("SELECT * FROM clubs WHERE id = ?", opponentId)
    : undefined;
  const discussion = performance
    ? [
        `${player.name}: ${performance.minutes} minutes, ${performance.rating.toFixed(1)} rating. That is a performance worth talking about, whatever the wider mood around ${club.name}.`,
        `${performance.completedPasses ?? 0} completed passes, ${performance.keyPasses ?? 0} key passes and ${performance.tackles ?? 0} tackles. ${player.name}'s contribution was not just the scoreline.`,
        `One match should not settle every argument about ${player.name}. We need that level again, especially when the team is under pressure.`,
      ]
    : [
        `${player.name} deserves a clear plan. ${player.age <= 23 ? "At this age the next run of games matters more than the hype." : "Experience should be used properly, not treated as a guarantee of selection."}`,
        `${player.name} has ${player.minutes} minutes, ${player.goals} goals and ${player.assists} assists in the current simulated season. Judge the role and the sample together.`,
        `${club.name} cannot keep talking about long-term planning while leaving ${player.name}'s ${player.position} role unclear. Recruitment and selection have to connect.`,
      ];
  return await publish(store, {
    mediaKey: fixture
      ? `match:${fixture.id}:${club.id}`
      : `player:${club.id}:${state.date}`,
    title: performance
      ? `${player.name} in focus after ${club.name}'s ${fixture!.home_goals}-${fixture!.away_goals} match`
      : `${player.name}: the role behind the recruitment debate`,
    topic: performance ? "match" : "player",
    status: "Analysis",
    club,
    clubIds: [club.id],
    playerId: player.id,
    playerName: player.name,
    fixtureId,
    beats: performance
      ? ["Analysis", "Supporters"]
      : player.age <= 23
        ? ["Academy", "Analysis"]
        : ["Club affairs", "Analysis"],
    paragraphs: performance
      ? [
          `${player.name} played ${performance.minutes} minutes against ${opponent?.name ?? "the opposition"}, recording a ${performance.rating.toFixed(1)} match rating, ${performance.goals} goals and ${performance.assists} assists.`,
          `The underlying return was ${(performance.xG ?? 0).toFixed(2)} xG and ${(performance.xA ?? 0).toFixed(2)} xA, with ${performance.keyPasses ?? 0} key passes. The numbers give ${club.manager} a specific performance to assess, rather than a general verdict on the squad.`,
        ]
      : [
          `${player.name}, ${player.age}, occupies a ${player.position} place at ${club.name}. The current squad status is ${player.role.toLowerCase()}, with a contract running to ${dateLabel(player.contract_end)}.`,
          player.minutes
            ? `Across the simulated season so far, ${player.name} has played ${player.minutes} minutes and contributed ${player.goals} goals and ${player.assists} assists. That workload matters when assessing form and the need for recruitment.`
            : `There are no current-season minutes on the record yet. Any argument about ${player.name}'s form would be premature; the immediate issue is the role and the opportunity.`,
          `${club.manager} works with a ${club.formation}. ${player.injury_until ? `The current injury runs to ${dateLabel(player.injury_until)}, which affects short-term planning.` : "The sporting department must balance competition for places with enough continuity to develop a coherent side."}`,
        ],
    discussion,
  });
}

export async function publishClubRoundup(store: Store) {
  const state = await store.meta<GameState>("state");
  const club = (await store.get<Club>(
    "SELECT * FROM clubs WHERE id = ?",
    state.clubId,
  ))!;
  const table = await store.all<{
    club_id: number;
    played: number;
    points: number;
    gf: number;
    ga: number;
  }>(
    "SELECT club_id,played,points,gf,ga FROM standings WHERE league_id = ? ORDER BY points DESC,(gf-ga) DESC,gf DESC,club_id",
    club.league_id,
  );
  const position = table.findIndex((entry) => entry.club_id === club.id);
  const record = table[position];
  const injuries = (await store.get<{ total: number }>(
    "SELECT count(*) AS total FROM players WHERE club_id = ? AND injury_until > ?",
    club.id,
    state.date,
  ))!.total;
  const recruitment = (await store.get<{ incoming: number; outgoing: number }>(
    "SELECT coalesce(sum(CASE WHEN TRY_CONVERT(int, JSON_VALUE(data,'$.to')) = ? THEN 1 ELSE 0 END),0) AS incoming,coalesce(sum(CASE WHEN TRY_CONVERT(int, JSON_VALUE(data,'$.from')) = ? THEN 1 ELSE 0 END),0) AS outgoing FROM history WHERE entity_type IN ('transfer','loan') AND date BETWEEN ? AND ?",
    club.id,
    club.id,
    addDays(state.date, -7),
    state.date,
  ))!;
  return await publish(store, {
    mediaKey: `club:${club.id}:${state.season}:${state.week}`,
    topic: "club",
    status: "Analysis",
    club,
    clubIds: [club.id],
    beats: ["Club affairs", "Supporters"],
    title:
      club.momentum > 10
        ? `${club.name}: momentum raises the expectations`
        : club.momentum < -10
          ? `${club.name}'s recruitment plan faces a harder examination`
          : `${club.name}: the week behind the sporting project`,
    paragraphs: [
      record?.played
        ? `${club.name} sit ${position + 1} of ${table.length}, with ${record.points} points from ${record.played} league matches. The board's stated target is a top-${club.expectations} finish.`
        : `${club.name}'s league campaign has not yet produced a table worth judging. The immediate examination is recruitment, fitness and the squad ${club.manager} will have available.`,
      `${recruitment.incoming} arrivals and ${recruitment.outgoing} departures have been registered in the last seven days. ${injuries} players are currently injured. That is the practical context for the next selection and the next market decision.`,
      `The club's ${club.formation} and ${club.tactical_style.toLowerCase()} approach need complementary roles, not simply more players. ${club.crisis > 60 ? "Patience is wearing thin, and the board will need evidence of improvement rather than another statement of intent." : "Supporters can accept a longer project, but they still expect a visible connection between the plan and the decisions."}`,
    ],
    discussion: [
      `${club.name} have to be judged over more than one week. ${record?.played ? `${record.points} points is the current reality; the next match is the chance to build on it.` : "The league has not started. Let the squad get on the pitch before writing the season off."}`,
      `${recruitment.incoming} arrivals against ${recruitment.outgoing} departures this week. The positions and roles matter more than winning a transfer-count argument.`,
      injuries
        ? `${injuries} injuries cannot become an excuse for every problem. Who is the cover, and why is the squad still depending on the same few players?`
        : "Fitness is not the issue right now. The manager and sporting department need to make the roles work together.",
    ],
  });
}

export async function publishPressReaction(
  store: Store,
  approach: string,
  title: string,
  quote: string,
) {
  const state = await store.meta<GameState>("state");
  const club = (await store.get<Club>(
    "SELECT * FROM clubs WHERE id = ?",
    state.clubId,
  ))!;
  return await publish(store, {
    mediaKey: `press:${club.id}:${state.date}`,
    title,
    topic: "press",
    status: "Confirmed",
    club,
    clubIds: [club.id],
    beats: ["Club affairs", "Supporters"],
    paragraphs: [
      `${state.director.name} addressed the media on behalf of ${club.name}: "${quote}"`,
      `${approach === "ambitious" ? "The statement raises expectations for the sporting project." : approach === "challenge" ? "The public challenge adds pressure on the dressing room as well as the recruitment team." : approach === "protect" ? "The backing will be welcomed internally, though it will not end scrutiny of results." : "The measured tone buys context, not a permanent exemption from scrutiny."} Supporters remain divided over how quickly progress should be visible.`,
    ],
    discussion: [
      "At least there is a clear position. Now the next few decisions need to back up the words.",
      `The message from ${state.director.name} has to match the squad plan. Recruitment, minutes and expectations are part of the same decision.`,
      "Another press conference is not a solution on its own. We will judge the football and the signings.",
    ],
  });
}

export async function dailyMedia(store: Store) {
  const state = await store.meta<GameState>("state");
  const fixtures = await store.all<{ id: number }>(
    "SELECT fixtures.id FROM fixtures LEFT JOIN leagues ON leagues.id = fixtures.league_id WHERE fixtures.status = 'played' AND fixtures.date = ? AND coalesce(leagues.age_group,'Senior') = 'Senior' AND (home_id = ? OR away_id = ?) ORDER BY fixtures.id",
    state.date,
    state.clubId,
    state.clubId,
  );
  for (const fixture of fixtures)
    await publishPlayerCoverage(store, fixture.id);
  if (
    !fixtures.length &&
    Math.floor(Date.parse(state.date) / 86400000) % 3 === 0
  )
    await publishPlayerCoverage(store);
}

export async function mediaFeed(
  store: Store,
  query: unknown,
): Promise<MediaData> {
  const filter = z
    .object({
      scope: z.enum(["club", "world", "all"]).default("club"),
      topic: z
        .enum(["transfer", "player", "match", "club", "press"])
        .optional(),
      journalist: z
        .enum(
          JOURNALISTS.map((journalist) => journalist.id) as [
            string,
            ...string[],
          ],
        )
        .optional(),
      q: z.string().max(100).default(""),
      page: z.coerce.number().int().min(1).default(1),
    })
    .parse(query);
  const state = await store.meta<GameState>("state");
  const conditions = ["category IN ('Media','Fans','World','Transfers')"];
  const params: (string | number)[] = [];
  const relevant =
    "EXISTS (SELECT 1 FROM OPENJSON(news.data,'$.clubIds') AS relevant_clubs WHERE TRY_CONVERT(int, relevant_clubs.[value]) = ?)";
  if (filter.scope === "club") {
    conditions.push(
      `(${relevant} OR (JSON_VALUE(data,'$.mediaKey') IS NULL AND category IN ('Media','Fans','Transfers')))`,
    );
    params.push(state.clubId);
  }
  if (filter.scope === "world") {
    conditions.push(
      `JSON_VALUE(data,'$.mediaKey') IS NOT NULL AND NOT ${relevant}`,
    );
    params.push(state.clubId);
  }
  if (filter.topic) {
    conditions.push("JSON_VALUE(data,'$.topic') = ?");
    params.push(filter.topic);
  }
  if (filter.journalist) {
    conditions.push("JSON_VALUE(data,'$.journalistId') = ?");
    params.push(filter.journalist);
  }
  if (filter.q) {
    conditions.push("(title LIKE ? ESCAPE '!' OR body LIKE ? ESCAPE '!')");
    const search = `%${filter.q.replace(/[!%_[]/g, "!$&")}%`;
    params.push(search, search);
  }
  const where = conditions.join(" AND ");
  const total = (await store.get<{ total: number }>(
    `SELECT count(*) AS total FROM news WHERE ${where}`,
    ...params,
  ))!.total;
  const pages = Math.max(1, Math.ceil(total / 20));
  const page = Math.min(filter.page, pages);
  const rows = await store.all<NewsItem>(
    `SELECT * FROM news WHERE ${where} ORDER BY date DESC,id DESC OFFSET ? ROWS FETCH NEXT 20 ROWS ONLY`,
    ...params,
    (page - 1) * 20,
  );
  const parsedStories = rows.map((story) => {
    const data = JSON.parse(story.data);
    return { ...story, report: data.mediaKey ? (data as MediaReport) : null };
  });
  const clubIds = [
    ...new Set(parsedStories.flatMap((story) => story.report?.clubIds ?? [])),
  ];
  const clubs = clubIds.length
    ? await store.all<{ id: number; name: string }>(
        `SELECT id,name FROM clubs WHERE id IN (${clubIds.map(() => "?").join(",")})`,
        ...clubIds,
      )
    : [];
  const clubsById = new Map(clubs.map((club) => [club.id, club]));
  const stories = parsedStories.map((story) => ({
    ...story,
    clubs: (story.report?.clubIds ?? [])
      .map((id) => clubsById.get(id))
      .filter((club): club is { id: number; name: string } => !!club),
  }));
  const latest = await store.get<NewsItem>(
    `SELECT TOP (1) * FROM news WHERE JSON_VALUE(data,'$.mediaKey') IS NOT NULL AND ${relevant} ORDER BY id DESC`,
    state.clubId,
  );
  const report = latest ? (JSON.parse(latest.data) as MediaReport) : null;
  return {
    journalists: JOURNALISTS,
    stories,
    total,
    page,
    pages,
    pressQuestion: {
      text: report?.playerName
        ? `What does ${report.playerName}'s situation say about your sporting plan?`
        : "What should supporters expect from the club's recruitment and development plan?",
      journalistId: report?.journalistId ?? JOURNALISTS[1].id,
      playerId: report?.playerId,
    },
  };
}
