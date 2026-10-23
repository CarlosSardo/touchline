import { z } from "zod";
import type { Store } from "./db.ts";
import type { WorldNewsData, WorldNewsItem } from "../shared/api.ts";

/** News category of world feed items: kept out of the director's inbox and the media pages' club coverage. */
export const WORLD_NEWS_CATEGORY = "Worldwide";
const PAGE_SIZE = 25;

export interface WorldNewsInput {
  kind: string;
  title: string;
  body: string;
  clubIds: number[];
  date: string;
  data?: object;
}

/** One world feed item (a news row with data.scope = 'world'); every workstream publishes AI activity through it. */
export async function worldNews(store: Store, input: WorldNewsInput): Promise<void> {
  await worldNewsBatch(store, [input]);
}

/** Set-based variant: one INSERT for a day's items. The clubs' associations are stored for the country filter. */
export async function worldNewsBatch(store: Store, items: readonly WorldNewsInput[]): Promise<void> {
  if (!items.length) return;
  await store.run(
    `INSERT INTO news(date,category,title,body,severity,read,action,data)
     SELECT item.date,?,item.title,item.body,'info',1,'world',
       (item.data::jsonb || jsonb_build_object('scope','world','kind',item.kind,'clubIds',item.club_ids::jsonb,
         'countryIds',(SELECT coalesce(jsonb_agg(DISTINCT clubs.country_id),'[]'::jsonb) FROM clubs
           WHERE clubs.id IN (SELECT value::integer FROM jsonb_array_elements_text(item.club_ids::jsonb)))))::text
     FROM unnest(?::text[],?::text[],?::text[],?::text[],?::text[],?::text[]) WITH ORDINALITY AS item(date,kind,title,body,club_ids,data,ordinal)
     ORDER BY item.ordinal`,
    WORLD_NEWS_CATEGORY,
    items.map((item) => item.date),
    items.map((item) => item.kind),
    items.map((item) => item.title),
    items.map((item) => item.body),
    items.map((item) => JSON.stringify([...new Set(item.clubIds)])),
    items.map((item) => JSON.stringify(item.data ?? {})),
  );
}

const feedFilter = z.object({
  kind: z.string().max(40).optional(),
  country: z.coerce.number().int().positive().optional(),
  club: z.coerce.number().int().positive().optional(),
  q: z.string().max(100).default(""),
  page: z.coerce.number().int().min(1).max(100000).default(1),
});

/** The world feed page: newest first, filtered by kind, association or club, with the filter facets. */
export async function worldNewsFeed(store: Store, query: unknown): Promise<WorldNewsData> {
  const filter = feedFilter.parse(query);
  const conditions = ["category = ?"];
  const params: (string | number)[] = [WORLD_NEWS_CATEGORY];
  if (filter.kind) {
    conditions.push("data::jsonb ->> 'kind' = ?");
    params.push(filter.kind);
  }
  if (filter.country) {
    conditions.push("(data::jsonb -> 'countryIds') @> jsonb_build_array(?::integer)");
    params.push(filter.country);
  }
  if (filter.club) {
    conditions.push("(data::jsonb -> 'clubIds') @> jsonb_build_array(?::integer)");
    params.push(filter.club);
  }
  if (filter.q) {
    const search = `%${filter.q.replace(/[!%_]/g, "!$&")}%`;
    conditions.push("(title ILIKE ? ESCAPE '!' OR body ILIKE ? ESCAPE '!')");
    params.push(search, search);
  }
  const where = conditions.join(" AND ");
  const total = (await store.get<{ total: number }>(`SELECT count(*) AS total FROM news WHERE ${where}`, ...params))!.total;
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const page = Math.min(filter.page, pages);
  const rows = await store.all<{ id: number; date: string; title: string; body: string; data: string }>(
    `SELECT id,date,title,body,data FROM news WHERE ${where} ORDER BY date DESC,id DESC LIMIT ? OFFSET ?`,
    ...params,
    PAGE_SIZE,
    (page - 1) * PAGE_SIZE,
  );
  const parsed = rows.map((row) => ({ ...row, data: JSON.parse(row.data) as Record<string, unknown> }));
  const clubIds = [...new Set(parsed.flatMap((row) => (row.data.clubIds as number[] | undefined) ?? []))];
  const clubs = new Map(
    (clubIds.length
      ? await store.all<{ id: number; name: string; color: string }>("SELECT id,name,color FROM clubs WHERE id = ANY(?::integer[])", clubIds)
      : []
    ).map((club) => [club.id, club]),
  );
  const items: WorldNewsItem[] = parsed.map((row) => ({
    id: row.id,
    date: row.date,
    title: row.title,
    body: row.body,
    kind: String(row.data.kind ?? "world"),
    clubs: ((row.data.clubIds as number[] | undefined) ?? []).flatMap((id) => (clubs.has(id) ? [clubs.get(id)!] : [])),
    playerId: typeof row.data.playerId === "number" ? row.data.playerId : undefined,
    playerName: typeof row.data.playerName === "string" ? row.data.playerName : undefined,
  }));
  const kinds = await store.all<{ kind: string; count: number }>(
    "SELECT data::jsonb ->> 'kind' AS kind,count(*) AS count FROM news WHERE category = ? GROUP BY 1 ORDER BY 1",
    WORLD_NEWS_CATEGORY,
  );
  const countries = await store.all<{ id: number; name: string }>(
    `SELECT countries.id,countries.name FROM countries WHERE countries.id IN (
       SELECT DISTINCT value::integer FROM news CROSS JOIN LATERAL jsonb_array_elements_text(news.data::jsonb -> 'countryIds')
       WHERE news.category = ?) ORDER BY countries.name`,
    WORLD_NEWS_CATEGORY,
  );
  const club = filter.club
    ? ((await store.get<{ id: number; name: string }>("SELECT id,name FROM clubs WHERE id = ?", filter.club)) ?? null)
    : null;
  return { items, total, page, pages, kinds: kinds.filter((entry) => entry.kind), countries, club };
}
