import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import request from "supertest";
import { randomUUID } from "node:crypto";
import { Store } from "./db.ts";
import { processCompetitionNotifications } from "./notifications.ts";
import { generateWorld } from "./world.ts";
import { createCalendar } from "./calendar.ts";
import { createApp, readApiConfiguration } from "./app.ts";
import { initialInbox, stateOf } from "./systems.ts";
import { Saves } from "./saves.ts";
import { DEFAULT_ASSISTANT_DUTIES, groupCareerSaves } from "../shared/rules.ts";
import type { SaveSlot } from "../shared/api.ts";
import { createUnexpectedEvent } from "./events.ts";

describe("hosted invitation access (no database)", () => {
  const owner = "11111111-1111-1111-1111-111111111111";
  const guest = "22222222-2222-2222-2222-222222222222";
  const secondGuest = "33333333-3333-3333-3333-333333333333";
  const tenant = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
  const configuration = {
    CONTAINER_APP_NAME: "touchline",
    API_HOST: "0.0.0.0",
    REQUIRE_AUTH: "true",
    OWNER_OBJECT_ID: owner,
    ALLOWED_USER_OBJECT_IDS: `${guest}, ${secondGuest}`,
    AZURE_TENANT_ID: tenant,
    APP_ORIGIN: "https://touchline.example.com",
  };
  const principal = (objectId: string, tenantId = tenant, additional: { typ: string; val: string }[] = []) =>
    Buffer.from(JSON.stringify({ auth_typ: "aad", claims: [
      { typ: "oid", val: objectId }, { typ: "tid", val: tenantId }, ...additional,
    ] })).toString("base64");
  const app = (allowed = configuration.ALLOWED_USER_OBJECT_IDS) => {
    for (const [name, value] of Object.entries({ ...configuration, ALLOWED_USER_OBJECT_IDS: allowed }))
      vi.stubEnv(name, value);
    return createApp(Object.create(Store.prototype) as Store);
  };
  afterEach(() => vi.unstubAllEnvs());

  it.each([owner, guest, secondGuest])("admits the configured account %s", async (objectId) => {
    const response = await request(app()).get("/api/access-probe")
      .set("x-ms-client-principal", principal(objectId, tenant.toUpperCase()));
    expect(response.status).toBe(404);
    expect(response.body.error).toBe("API route not found.");
  });

  it("rejects anonymous, unlisted and wrong-tenant accounts", async () => {
    const application = app();
    expect((await request(application).get("/api/access-probe")).status).toBe(401);
    for (const identity of [principal("44444444-4444-4444-4444-444444444444"), principal(guest, owner)])
      expect((await request(application).get("/api/access-probe")
        .set("x-ms-client-principal", identity)).status).toBe(403);
  });

  it("rejects conflicting identity claims even when both accounts are allowed", async () => {
    const identity = principal(owner, tenant, [{
      typ: "http://schemas.microsoft.com/identity/claims/objectidentifier", val: guest,
    }]);
    expect((await request(app()).get("/api/access-probe")
      .set("x-ms-client-principal", identity)).status).toBe(403);
  });

  it("keeps owner-only access when no guest IDs are configured", async () => {
    const application = app("");
    expect((await request(application).get("/api/access-probe")
      .set("x-ms-client-principal", principal(guest))).status).toBe(403);
    expect((await request(application).get("/api/access-probe")
      .set("x-ms-client-principal", principal(owner))).status).toBe(404);
  });

  it("refuses email addresses and malformed object IDs in the allowlist", () => {
    expect(() => readApiConfiguration({ ...configuration, ALLOWED_USER_OBJECT_IDS: "guest@example.com" }))
      .toThrow("Entra object UUIDs");
    expect(() => readApiConfiguration({ ...configuration, ALLOWED_USER_OBJECT_IDS: "not-an-id" }))
      .toThrow("Entra object UUIDs");
  });
});

async function expectSchemaIntegrity(store: Store) {
  const tables = await store.all<{ id: number; name: string }>(
    "SELECT object_id AS id,name FROM sys.tables WHERE schema_id = SCHEMA_ID(?) ORDER BY name",
    store.schemaName,
  );
  expect(tables.length).toBeGreaterThan(0);
  expect(
    await store.all(
      "SELECT name FROM sys.foreign_keys WHERE schema_id = SCHEMA_ID(?) AND (is_disabled = 1 OR is_not_trusted = 1)",
      store.schemaName,
    ),
  ).toEqual([]);
  for (const table of tables) {
    expect(Number.isSafeInteger(table.id)).toBe(true);
    expect(
      await store.all(
        `DBCC CHECKCONSTRAINTS (${table.id}) WITH ALL_CONSTRAINTS, ALL_ERRORMSGS`,
      ),
      table.name,
    ).toEqual([]);
  }
}

describe("game HTTP API and SQL saves", () => {
  let store: Store;
  let app: Awaited<ReturnType<typeof createApp>>;
  beforeAll(async () => {
    store = await Store.createTest("http-api");
    await generateWorld(store, { countryLimit: 3, seniors: 1800, youth: 900 });
    await createCalendar(store);
    await initialInbox(store);
    app = await createApp(store);
  });
  afterAll(async () => {
    await store?.close();
  });

  it("reports the isolated SQL test schema without exposing a database file", async () => {
    const response = await request(app).get("/api/health/details");
    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      databaseName: store.database,
      schema: store.schemaName,
      testCareer: true,
    });
    expect(response.body.schema).toMatch(/^touchline_test_/);
    expect(response.body.schema).not.toBe("dbo");
    expect(response.body).not.toHaveProperty("path");
  });

  it("groups snapshots by career identity without merging unrelated or legacy saves", () => {
    const slot = (
      name: string,
      id: string | undefined,
      automatic: boolean,
      day: number,
    ): SaveSlot => ({
      file: `${randomUUID()}.touchline.gz`,
      name,
      automatic,
      compressed: true,
      size: 100,
      modified: `2026-07-${String(day).padStart(2, "0")}T12:00:00.000Z`,
      ...(id
        ? {
            career: {
              id,
              name: "My career",
              director: "Alex",
              club: "Northbridge",
              date: "2026-07-01",
              season: 2026,
            },
          }
        : {}),
    });
    const slots = [
      slot("manual", "one", false, 1),
      slot("auto-old", "one", true, 2),
      slot("auto-new", "one", true, 3),
      slot("other", "two", true, 4),
      slot("legacy-one", undefined, true, 1),
      slot("legacy-two", undefined, true, 2),
    ];
    const original = JSON.stringify(slots);
    const groups = groupCareerSaves(slots);
    expect(groups).toHaveLength(4);
    expect(groups[0].latest.file).toBe(slots[3].file);
    const career = groups.find((group) => group.key === "career:one")!;
    expect(career.autosaves.map((save) => save.file)).toEqual([
      slots[2].file,
      slots[1].file,
    ]);
    expect(career.manual).toHaveLength(1);
    expect(career.count).toBe(3);
    expect(career.size).toBe(300);
    expect(groupCareerSaves(slots, "manual")[0].count).toBe(3);
    expect(groupCareerSaves(slots, "nonexistent")).toHaveLength(0);
    expect(JSON.stringify(slots)).toBe(original);
  });

  it("serves real persistent player pages and supports combined indexed and attribute filters", async () => {
    const response = await request(app).get(
      "/api/players?position=ST&ageMax=23&potentialMin=60&pageSize=10",
    );
    expect(response.status).toBe(200);
    expect(response.body.players.length).toBeLessThanOrEqual(10);
    expect(
      response.body.players.every(
        (player: { position: string; age: number; potential: number }) =>
          player.position === "ST" &&
          player.age <= 23 &&
          player.potential >= 60,
      ),
    ).toBe(true);
    const attributes = await request(app).get(
      "/api/players?attribute=passing&attributeMin=70&personality=professionalism&personalityMin=50",
    );
    expect(attributes.status).toBe(200);
    expect(attributes.body.total).toBeGreaterThan(0);
  });

  it("filters explicit youth contract status without treating legacy contracts as free", async () => {
    const amateur = await request(app)
      .get("/api/players")
      .query({ contractStatus: "amateur", pageSize: 100 });
    expect(amateur.status).toBe(200);
    expect(amateur.body.total).toBeGreaterThan(0);
    for (const player of amateur.body.players)
      expect(
        JSON.parse(
          (await store.get<{ profile: string }>(
            "SELECT profile FROM players WHERE id = ?",
            player.id,
          ))!.profile,
        ).contract.status,
      ).toBe("amateur");
    expect(
      (
        await request(app)
          .get("/api/players")
          .query({ contractStatus: "unprotected" })
      ).status,
    ).toBe(400);
  });

  it("returns every major screen without placeholder data or SQL errors", async () => {
    for (const path of [
      "bootstrap",
      "dashboard",
      "squad",
      "scouting",
      "transfers",
      "loans",
      "staff",
      "assistant",
      "affiliates",
      "events",
      "training",
      "academy",
      "finances",
      "media",
      "leagues/1",
      "matches",
      "players/1",
      "players/1/interest",
      "world/clubs",
      "clubs/1",
    ]) {
      const response = await request(app).get(`/api/${path}`);
      expect(response.status, path).toBe(200);
    }
  });

  it("finds a player by secondary nationality and exposes all recorded nationalities", async () => {
    const player = (await store.get<{
      id: number;
      profile: string;
      country_id: number;
    }>(
      "SELECT TOP (1) id,profile,country_id FROM players WHERE country_id != 1",
    ))!;
    const profile = JSON.parse(player.profile);
    try {
      profile.identity.nationalities = [
        {
          countryId: player.country_id,
          code: "ES",
          country: "Spain",
          basis: "birth",
        },
        { countryId: 1, code: "EN", country: "England", basis: "parent" },
      ];
      await store.run(
        "UPDATE players SET profile = ? WHERE id = ?",
        JSON.stringify(profile),
        player.id,
      );
      const response = await request(app)
        .get("/api/players")
        .query({
          country: 1,
          q: (await store.get<{ name: string }>(
            "SELECT name FROM players WHERE id = ?",
            player.id,
          ))!.name,
          pageSize: 100,
        });
      expect(response.status).toBe(200);
      expect(
        response.body.players.some(
          (entry: { id: number; nationalities: string[] }) =>
            entry.id === player.id && entry.nationalities.includes("England"),
        ),
      ).toBe(true);
      const dossier = await request(app).get(`/api/players/${player.id}`);
      expect(dossier.body.registration.status).toBe("Domestic work rights");
    } finally {
      await store.run(
        "UPDATE players SET profile = ? WHERE id = ?",
        player.profile,
        player.id,
      );
    }
  });

  it("persists favorite competitions, emits result alerts once, and mutes topics without deleting their archive", async () => {
    const originalState = await stateOf(store);
    const settings = await store.meta("settings");
    const fixture = (await store.get<{
      id: number;
      date: string;
      league_id: number;
      status: string;
      home_goals: number | null;
      away_goals: number | null;
    }>(
      "SELECT TOP (1) id,date,league_id,status,home_goals,away_goals FROM fixtures WHERE league_id = 1 ORDER BY date",
    ))!;
    try {
      expect(
        (
          await request(app)
            .put("/api/competitions/1/favorite")
            .send({ active: true, events: { fixtures: false, results: true } })
        ).status,
      ).toBe(200);
      expect(
        (await request(app).get("/api/competitions/favorites")).body[0]
          .leagueId,
      ).toBe(1);
      await store.run(
        "UPDATE fixtures SET status = 'played',home_goals = 2,away_goals = 1 WHERE id = ?",
        fixture.id,
      );
      await store.setMeta("state", { ...originalState, date: fixture.date });
      await processCompetitionNotifications(store);
      await processCompetitionNotifications(store);
      const feed = await request(app)
        .get("/api/news")
        .query({ category: "Competitions" });
      expect(feed.body).toHaveLength(1);
      expect(JSON.parse(feed.body[0].data).notificationType).toBe("results");
      expect(feed.body[0].body).toContain("2-1");
      expect(
        (
          await request(app)
            .patch("/api/settings")
            .send({ notifyCompetitions: false })
        ).status,
      ).toBe(200);
      expect(
        (
          await request(app)
            .get("/api/news")
            .query({ category: "Competitions" })
        ).body,
      ).toHaveLength(0);
      expect(
        (
          await request(app)
            .get("/api/news")
            .query({ category: "Competitions", archive: "1" })
        ).body,
      ).toHaveLength(1);
      await request(app)
        .put("/api/competitions/1/favorite")
        .send({ active: false });
      expect(
        (await request(app).get("/api/competitions/favorites")).body,
      ).toHaveLength(0);
    } finally {
      await store.setMeta("state", originalState);
      await store.setMeta("settings", settings);
      await store.run(
        "UPDATE fixtures SET status = ?,home_goals = ?,away_goals = ? WHERE id = ?",
        fixture.status,
        fixture.home_goals,
        fixture.away_goals,
        fixture.id,
      );
      await store.run("DELETE FROM competition_favorites WHERE league_id = 1");
      await store.run("DELETE FROM news WHERE category = 'Competitions'");
    }
  });

  it("browses every team through pagination and returns linked club profiles", async () => {
    const total = (await store.get<{ count: number }>(
      "SELECT count(*) AS count FROM clubs",
    ))!.count;
    const ids = new Set<number>();
    let page = 1;
    while (true) {
      const response = await request(app)
        .get("/api/world/clubs")
        .query({ page, pageSize: 100 });
      expect(response.status).toBe(200);
      expect(response.body.total).toBe(total);
      for (const club of response.body.clubs) ids.add(club.id);
      if (page >= response.body.pages) break;
      page++;
    }
    expect(ids.size).toBe(total);
    const countries = await request(app)
      .get("/api/world/clubs")
      .query({ type: "national", country: 1 });
    expect(countries.body.total).toBe(4);
    const profile = await request(app).get("/api/clubs/1");
    expect(profile.body.players.length).toBeGreaterThan(0);
    expect(profile.body.competitions.length).toBeGreaterThan(0);
    expect(
      profile.body.players.every(
        (player: { club_id: number }) => player.club_id === 1,
      ),
    ).toBe(true);
  });

  it("orders career clubs by country, division and name with consistent pagination and league labels", async () => {
    const original = await stateOf(store);
    const expected = await store.all<{ id: number }>(
      "SELECT TOP (20) clubs.id FROM clubs JOIN countries ON countries.id = clubs.country_id JOIN leagues ON leagues.id = clubs.league_id WHERE clubs.type = 'club' ORDER BY countries.name COLLATE Latin1_General_100_CI_AS,leagues.tier,clubs.name COLLATE Latin1_General_100_CI_AS,clubs.id",
    );
    const ids: number[] = [];
    for (const page of [1, 2]) {
      const response = await request(app)
        .get("/api/world/clubs")
        .query({ type: "club", sort: "division", pageSize: 10, page });
      expect(response.status).toBe(200);
      for (const club of response.body.clubs) {
        ids.push(club.id);
        expect(club.league_name).toBeTruthy();
        expect(club.tier).toBeGreaterThanOrEqual(1);
      }
    }
    expect(ids).toEqual(expected.map((club) => club.id));
    const division = await request(app).get("/api/world/clubs").query({
      type: "club",
      sort: "division",
      country: 1,
      tier: 2,
      pageSize: 100,
    });
    expect(division.status).toBe(200);
    expect(division.body.clubs.length).toBeGreaterThan(0);
    expect(
      division.body.clubs.every(
        (club: { country_id: number; tier: number }) =>
          club.country_id === 1 && club.tier === 2,
      ),
    ).toBe(true);
    expect(await stateOf(store)).toEqual(original);
  });

  it("validates minor application evidence and does not accept a parental exception from request data", async () => {
    const original = await stateOf(store);
    const clubs = await store.all<{ id: number }>(
      "SELECT MIN(clubs.id) AS id FROM clubs JOIN countries ON countries.id = clubs.country_id WHERE clubs.type = 'club' AND countries.code IN ('ES','DE') GROUP BY clubs.country_id ORDER BY MIN(clubs.id)",
    );
    const player = (await store.get<{
      id: number;
      profile: string;
      age: number;
      birth_date: string;
    }>(
      "SELECT TOP (1) id,profile,age,birth_date FROM players WHERE club_id = ? AND age_group != 'Senior'",
      clubs[0].id,
    ))!;
    try {
      await store.setMeta("state", { ...original, clubId: clubs[1].id });
      await store.run(
        "UPDATE players SET age = 17,birth_date = '2009-01-01' WHERE id = ?",
        player.id,
      );
      const safeguards = {
        football: true,
        education: true,
        care: true,
        mentor: true,
        parentalConsent: true,
      };
      expect(
        (
          await request(app)
            .post("/api/action")
            .send({
              type: "minor-application",
              playerId: player.id,
              safeguards: { ...safeguards, parentalConsent: false },
            })
        ).status,
      ).toBe(400);
      expect(
        (
          await request(app).post("/api/action").send({
            type: "minor-application",
            playerId: player.id,
            safeguards,
          })
        ).status,
      ).toBe(200);
      expect(
        (await request(app).get(`/api/players/${player.id}`)).body.youthTransfer
          .application.status,
      ).toBe("pending");
      expect(
        (
          await request(app).post("/api/action").send({
            type: "minor-application",
            playerId: player.id,
            safeguards,
          })
        ).status,
      ).toBe(400);
      await store.run(
        "DELETE FROM minor_applications WHERE player_id = ?",
        player.id,
      );
      await store.run(
        "UPDATE players SET age = 15,birth_date = '2011-01-01' WHERE id = ?",
        player.id,
      );
      expect(
        (
          await request(app)
            .post("/api/action")
            .send({
              type: "minor-application",
              playerId: player.id,
              safeguards,
              familyMove: {
                verified: true,
                reason: "employment",
                countryId: 3,
              },
            })
        ).status,
      ).toBe(400);
      expect(
        await store.all(
          "SELECT id FROM minor_applications WHERE player_id = ?",
          player.id,
        ),
      ).toHaveLength(0);
    } finally {
      await store.setMeta("state", original);
      await store.run(
        "UPDATE players SET age = ?,birth_date = ?,profile = ? WHERE id = ?",
        player.age,
        player.birth_date,
        player.profile,
        player.id,
      );
    }
  });

  it("previews player interest without making offers or altering the career", async () => {
    const state = await stateOf(store);
    const before = await store.all(
      "SELECT id,club_id,wage,morale FROM players ORDER BY id",
    );
    const negotiations = await store.all("SELECT * FROM negotiations");
    const result = await request(app)
      .get("/api/players/1/interest")
      .query({
        wage: 5000,
        role: "Squad player",
        years: 3,
        promises: JSON.stringify(["Youth pathway"]),
      });
    expect(result.status).toBe(200);
    expect(result.body.factors.length).toBeGreaterThan(5);
    expect(
      (
        await request(app)
          .get("/api/players/1/interest")
          .query({ promises: "not-json" })
      ).status,
    ).toBe(400);
    expect(
      (
        await request(app)
          .get("/api/players/1/interest")
          .query({ promises: JSON.stringify(["Invalid promise"]) })
      ).status,
    ).toBe(400);
    expect(
      (
        await request(app)
          .get("/api/players/1/interest")
          .query({ negotiationId: 999999 })
      ).status,
    ).toBe(400);
    expect(await store.all("SELECT * FROM negotiations")).toEqual(negotiations);
    expect(
      await store.all("SELECT id,club_id,wage,morale FROM players ORDER BY id"),
    ).toEqual(before);
    expect(await stateOf(store)).toEqual(state);
  });

  it("validates assistant delegation, event preferences and board affiliate actions", async () => {
    const assistant = await request(app).get("/api/assistant");
    expect(assistant.body.assistant.role).toBe("Sporting director assistant");
    expect(
      (
        await request(app)
          .post("/api/action")
          .send({
            type: "assistant-duties",
            duties: { ...DEFAULT_ASSISTANT_DUTIES, loans: true },
            weeklyBudget: 0,
          })
      ).status,
    ).toBe(200);
    expect((await request(app).get("/api/assistant")).body.duties.loans).toBe(
      true,
    );
    expect(
      (
        await request(app)
          .post("/api/action")
          .send({
            type: "assistant-duties",
            duties: { ...DEFAULT_ASSISTANT_DUTIES, sellPlayers: true },
            weeklyBudget: 0,
          })
      ).status,
    ).toBe(400);
    expect(
      (
        await request(app)
          .patch("/api/settings")
          .send({ unexpectedEvents: "high" })
      ).status,
    ).toBe(200);
    expect((await request(app).get("/api/events")).body.frequency).toBe("high");
    expect(
      (
        await request(app)
          .patch("/api/settings")
          .send({ unexpectedEvents: "always" })
      ).status,
    ).toBe(400);
    const event = await createUnexpectedEvent(store, "sponsor");
    expect(
      (
        await request(app)
          .post("/api/action")
          .send({ type: "event-response", id: event, choiceId: "invented" })
      ).status,
    ).toBe(400);
    expect(
      (
        await request(app)
          .post("/api/action")
          .send({ type: "event-response", id: event, choiceId: "decline" })
      ).status,
    ).toBe(200);
    expect(
      (
        await request(app)
          .post("/api/action")
          .send({ type: "event-response", id: event, choiceId: "decline" })
      ).status,
    ).toBe(400);
    const state = await stateOf(store);
    const before = (await store.get<{ balance: number }>(
      "SELECT balance FROM clubs WHERE id = ?",
      state.clubId,
    ))!.balance;
    expect(
      (
        await request(app)
          .post("/api/action")
          .send({ type: "affiliate-request", purpose: "Development club" })
      ).status,
    ).toBe(200);
    expect(
      (
        await request(app)
          .post("/api/action")
          .send({ type: "affiliate-request", purpose: "Scouting club" })
      ).status,
    ).toBe(400);
    expect(
      (await request(app).get("/api/affiliates")).body.requests[0].status,
    ).toBe("pending");
    expect(
      (await store.get<{ balance: number }>(
        "SELECT balance FROM clubs WHERE id = ?",
        state.clubId,
      ))!.balance,
    ).toBe(before);
    expect(
      (
        await request(app)
          .patch("/api/settings")
          .send({ unexpectedEvents: "medium" })
      ).status,
    ).toBe(200);
  });

  it("rejects malformed actions, injection attempts and remote origins while ignoring retired sync settings", async () => {
    expect(
      (
        await request(app).get(
          "/api/players?sort=ability;DROP%20TABLE%20players",
        )
      ).status,
    ).toBe(400);
    expect(
      (
        await request(app)
          .post("/api/action")
          .send({ type: "role", playerId: 1, role: "invalid" })
      ).status,
    ).toBe(400);
    const previousSync = (await store.meta<Record<string, unknown>>("settings")).cloudSync;
    expect(
      (await request(app).patch("/api/settings").send({ cloudSync: true }))
        .status,
    ).toBe(200);
    expect((await store.meta<Record<string, unknown>>("settings")).cloudSync).toBe(previousSync);
    expect(
      (
        await request(app)
          .post("/api/action")
          .set("Origin", "https://example.com")
          .send({ type: "read-news" })
      ).status,
    ).toBe(403);
    expect(
      (await request(app).post("/api/advance").send({ days: 100 })).status,
    ).toBe(400);
  });

  it("searches player names and treats SQL wildcard characters literally", async () => {
    const player = (await store.get<{ name: string }>(
      "SELECT name FROM players WHERE id = 1",
    ))!;
    const response = await request(app)
      .get("/api/players")
      .query({ q: player.name });
    expect(response.status).toBe(200);
    expect(
      response.body.players.some(
        (entry: { name: string }) => entry.name === player.name,
      ),
    ).toBe(true);
    const literalWildcard = await request(app)
      .get("/api/players")
      .query({ q: "%" });
    expect(literalWildcard.status).toBe(200);
    expect(literalWildcard.body.total).toBe(0);
  });

  it("persists local settings across reads", async () => {
    expect(
      (
        await request(app)
          .patch("/api/settings")
          .send({ theme: "dark", injuryFrequency: 20 })
      ).status,
    ).toBe(200);
    const response = await request(app).get("/api/bootstrap");
    expect(response.body.settings.theme).toBe("dark");
    expect(response.body.settings.injuryFrequency).toBe(20);
    expect(response.body.settings.cloudSync).toBe(false);
  });

  it("changes currency without rewriting balances, wages or stored transfer amounts", async () => {
    const before = await store.all(
      "SELECT id,balance,transfer_budget,wage_budget FROM clubs ORDER BY id",
    );
    const wages = await store.all(
      "SELECT id,wage,value FROM players ORDER BY id",
    );
    expect(
      (await request(app).patch("/api/settings").send({ currency: "EUR" }))
        .status,
    ).toBe(200);
    expect(
      (await request(app).get("/api/bootstrap")).body.settings.currency,
    ).toBe("EUR");
    expect(
      await store.all(
        "SELECT id,balance,transfer_budget,wage_budget FROM clubs ORDER BY id",
      ),
    ).toEqual(before);
    expect(
      await store.all("SELECT id,wage,value FROM players ORDER BY id"),
    ).toEqual(wages);
    expect(
      (await request(app).patch("/api/settings").send({ currency: "INVALID" }))
        .status,
    ).toBe(400);
    expect(
      (await request(app).patch("/api/settings").send({ currency: "GBP" }))
        .status,
    ).toBe(200);
  });

  it("backs up a mid-season world expansion and preserves contracts, finances and fixtures until new divisions activate", async () => {
    const saves = new Saves(store);
    const checkpoint = await saves.create("Expansion regression checkpoint");
    try {
      await store.setMeta("state", {
        ...(await stateOf(store)),
        date: "2026-11-15",
      });
      await store.run(
        "UPDATE fixtures SET status = 'played',home_goals = 2,away_goals = 1 WHERE id = (SELECT min(id) FROM fixtures)",
      );
      const state = await stateOf(store);
      const fixtures = await store.all("SELECT * FROM fixtures ORDER BY id");
      const players = await store.all(
        "SELECT id,club_id,birth_date,ability,potential,wage,contract_end FROM players ORDER BY id",
      );
      const clubs = await store.all(
        "SELECT id,balance,transfer_budget,wage_budget FROM clubs ORDER BY id",
      );
      const lastPlayer = (await store.get<{ id: number }>(
        "SELECT max(id) AS id FROM players",
      ))!.id;
      const lastClub = (await store.get<{ id: number }>(
        "SELECT max(id) AS id FROM clubs",
      ))!.id;
      const response = await request(app).post("/api/world/expand");
      expect(response.status).toBe(200);
      expect(response.body.changed).toBe(true);
      expect(response.body.activeFromSeason).toBe(2027);
      expect(
        (await saves.list()).some(
          (slot) => slot.file === response.body.archived,
        ),
      ).toBe(true);
      expect(await stateOf(store)).toEqual(state);
      expect(await store.all("SELECT * FROM fixtures ORDER BY id")).toEqual(
        fixtures,
      );
      expect(
        await store.all(
          "SELECT id,club_id,birth_date,ability,potential,wage,contract_end FROM players WHERE id <= ? ORDER BY id",
          lastPlayer,
        ),
      ).toEqual(players);
      expect(
        await store.all(
          "SELECT id,balance,transfer_budget,wage_budget FROM clubs WHERE id <= ? ORDER BY id",
          lastClub,
        ),
      ).toEqual(clubs);
      expect((await request(app).get("/api/world/audit")).status).toBe(200);
      expect((await request(app).post("/api/world/expand")).body.changed).toBe(
        false,
      );
      await expectSchemaIntegrity(store);
      await saves.restore(response.body.archived);
      expect(await stateOf(store)).toEqual(state);
      expect(await store.all("SELECT * FROM fixtures ORDER BY id")).toEqual(
        fixtures,
      );
      expect(
        await store.all(
          "SELECT id,club_id,birth_date,ability,potential,wage,contract_end FROM players ORDER BY id",
        ),
      ).toEqual(players);
    } finally {
      await saves.restore(checkpoint.file);
    }
  });

  it("restores empty clause schedules and older settings while preserving its career", async () => {
    const saves = new Saves(store);
    const original = await stateOf(store);
    const count = (await store.get<{ count: number }>(
      "SELECT count(*) AS count FROM players",
    ))!.count;
    await store.run("DELETE FROM transfer_payments");
    await store.run("DELETE FROM buy_back_clauses");
    const oldSettings =
      await store.meta<Record<string, string | number | boolean>>("settings");
    delete oldSettings.currency;
    await store.setMeta("settings", oldSettings);
    const legacy = await saves.create("Before contract clauses");
    const savedState = await stateOf(store);
    await saves.restore(legacy.file);
    expect(await stateOf(store)).toEqual(savedState);
    expect((await stateOf(store)).date).toBe(original.date);
    expect(
      (await store.get<{ count: number }>(
        "SELECT count(*) AS count FROM players",
      ))!.count,
    ).toBe(count);
    expect(await store.all("SELECT * FROM transfer_payments")).toEqual([]);
    expect(await store.all("SELECT * FROM buy_back_clauses")).toEqual([]);
    expect((await request(app).get("/api/transfers")).status).toBe(200);
    await expectSchemaIntegrity(store);
  });

  it("adds assistants and starter affiliates to an older save without changing its career or squad", async () => {
    const saves = new Saves(store);
    await store.run("DELETE FROM club_support");
    await store.run(
      "DELETE FROM staff WHERE role = 'Sporting director assistant'",
    );
    await store.run(
      "DELETE FROM partnerships WHERE JSON_VALUE(data,'$.origin') = 'initial'",
    );
    const originalPlayers = await store.all(
      "SELECT id,club_id,wage,contract_end FROM players ORDER BY id",
    );
    const originalClubs = await store.all(
      "SELECT id,balance,transfer_budget FROM clubs ORDER BY id",
    );
    const originalFixtures = await store.all(
      "SELECT id,date,status FROM fixtures ORDER BY id",
    );
    const saved = await saves.create("Before club support");
    const state = await stateOf(store);
    await saves.restore(saved.file);
    expect(await stateOf(store)).toEqual(state);
    expect(
      await store.all(
        "SELECT id,club_id,wage,contract_end FROM players ORDER BY id",
      ),
    ).toEqual(originalPlayers);
    expect(
      await store.all(
        "SELECT id,balance,transfer_budget FROM clubs ORDER BY id",
      ),
    ).toEqual(originalClubs);
    expect(
      await store.all("SELECT id,date,status FROM fixtures ORDER BY id"),
    ).toEqual(originalFixtures);
    expect(
      await store.all(
        "SELECT clubs.id FROM clubs LEFT JOIN staff ON staff.club_id = clubs.id AND staff.role = 'Sporting director assistant' WHERE clubs.type != 'national' GROUP BY clubs.id HAVING count(staff.id) != 1",
      ),
    ).toHaveLength(0);
    const loans = await request(app).get("/api/loans");
    expect(loans.body.partnerships.length).toBeGreaterThanOrEqual(1);
    expect(
      loans.body.partnerships.every(
        (link: { partner_id: number }) => link.partner_id !== state.clubId,
      ),
    ).toBe(true);
  });

  it("creates and restores a catalog checkpoint without losing the career", async () => {
    const saves = new Saves(store);
    const slot = await saves.create("Regression save");
    expect(slot.file).toMatch(
      /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}\.touchline\.gz$/i,
    );
    expect(await saves.list()).toContainEqual(
      expect.objectContaining({
        file: slot.file,
        name: "Regression save",
        compressed: true,
      }),
    );
    await store.setMeta("state", {
      ...(await stateOf(store)),
      date: "2026-07-20",
    });
    await saves.restore(slot.file);
    expect((await stateOf(store)).date).toBe("2026-07-01");
    expect(
      (await store.get<{ count: number }>(
        "SELECT count(*) AS count FROM players",
      ))!.count,
    ).toBe(2700);
    await expect(saves.restore("../../escape.touchline.gz")).rejects.toThrow(
      "not found",
    );
    await expect(saves.import(Buffer.from("not a database"))).rejects.toThrow(
      /checkpoint|save/i,
    );
  });

  it.each([true, false])(
    "streams portable checkpoints with saveCompression=%s without changing the career",
    async (compressed) => {
      const original = await stateOf(store);
      const settings =
        await store.meta<Record<string, string | number | boolean>>("settings");
      try {
        await store.setMeta("settings", {
          ...settings,
          saveCompression: compressed,
        });
        const exported = await request(app).get("/api/saves/export");
        expect(exported.status).toBe(200);
        expect(Buffer.isBuffer(exported.body)).toBe(true);
        expect(exported.headers["content-disposition"]).toContain(
          ".touchline.gz",
        );
        expect([...exported.body.subarray(0, 2)]).toEqual([0x1f, 0x8b]);
        await store.setMeta("state", { ...original, date: "2026-07-20" });
        const imported = await request(app)
          .post("/api/saves/import")
          .set("Content-Type", "application/octet-stream")
          .send(exported.body);
        expect(imported.status).toBe(200);
        expect(await stateOf(store)).toEqual(original);
        expect(
          (
            await request(app)
              .post("/api/saves/import")
              .set("Content-Type", "application/octet-stream")
              .send(Buffer.from("not a database"))
          ).status,
        ).toBe(400);
        expect(await stateOf(store)).toEqual(original);
        await expectSchemaIntegrity(store);
      } finally {
        await store.setMeta("state", original);
        await store.setMeta("settings", settings);
      }
    },
  );

  it("rolls back a partially restored world and its constraints when a SQL batch fails", async () => {
    const saves = new Saves(store);
    const checkpoint = await saves.create("Restore failure checkpoint");
    await store.setMeta("state", {
      ...(await stateOf(store)),
      date: "2026-07-21",
    });
    const state = await stateOf(store);
    const players = await store.all("SELECT * FROM players ORDER BY id");
    const clubs = await store.all("SELECT * FROM clubs ORDER BY id");
    const fixtures = await store.all("SELECT * FROM fixtures ORDER BY id");
    const catalog = await saves.list();
    const bulkInsert = store.bulkInsert.bind(store);
    const restoredTables: string[] = [];
    const failure = vi
      .spyOn(store, "bulkInsert")
      .mockImplementation(async (...args) => {
        if (args[0] === "players")
          throw new Error("Injected restore batch failure");
        const result = await bulkInsert(...args);
        restoredTables.push(args[0]);
        return result;
      });
    try {
      await expect(saves.restore(checkpoint.file)).rejects.toThrow(
        "Injected restore batch failure",
      );
      expect(restoredTables.length).toBeGreaterThan(0);
      failure.mockRestore();
      expect(await stateOf(store)).toEqual(state);
      expect(await store.all("SELECT * FROM players ORDER BY id")).toEqual(
        players,
      );
      expect(await store.all("SELECT * FROM clubs ORDER BY id")).toEqual(clubs);
      expect(await store.all("SELECT * FROM fixtures ORDER BY id")).toEqual(
        fixtures,
      );
      expect(await saves.list()).toEqual(catalog);
      await expectSchemaIntegrity(store);
    } finally {
      failure.mockRestore();
      await saves.restore(checkpoint.file);
    }
  });

  it("honors daily autosaves during a multi-day calendar advance", async () => {
    await request(app).patch("/api/settings").send({ autosave: "daily" });
    const response = await request(app).post("/api/advance").send({ days: 3 });
    expect(response.status).toBe(200);
    const saves = new Saves(store);
    const autosaves = (await saves.list()).filter((slot) => slot.automatic);
    expect(autosaves).toHaveLength(3);
    expect(autosaves.some((slot) => slot.career?.date === "2026-07-02")).toBe(
      true,
    );
    expect(autosaves.some((slot) => slot.career?.date === "2026-07-04")).toBe(
      true,
    );
  });

  it("deletes only the selected inactive career and protects the active career and database", async () => {
    const saves = new Saves(store);
    const original = await stateOf(store);
    await store.setMeta("state", {
      ...original,
      careerId: "inactive-delete-test",
      careerName: "Old career",
    });
    const first = await saves.create("Old career");
    const second = await saves.create("Old checkpoint");
    await store.setMeta("state", {
      ...original,
      careerId: "active-delete-test",
      careerName: "Keep this career",
    });
    const active = await saves.create("Protected career");
    const activeState = await stateOf(store);
    const chunkQuery =
      "SELECT chunks.ordinal,chunks.data FROM save_chunks AS chunks JOIN save_slots AS slots ON slots.id = chunks.save_id WHERE slots.name = ? ORDER BY chunks.ordinal";
    const activeBytes = await store.all<{ ordinal: number; data: Buffer }>(
      chunkQuery,
      active.name,
    );
    expect(activeBytes.length).toBeGreaterThan(0);
    const inactiveIds = await store.all<{ id: string }>(
      "SELECT id FROM save_slots WHERE name IN (?,?)",
      first.name,
      second.name,
    );
    expect(inactiveIds).toHaveLength(2);
    const beforeSlots = await saves.list();
    expect(
      (await request(app).delete("/api/careers").send({ file: active.file }))
        .status,
    ).toBe(400);
    expect(
      (
        await request(app)
          .delete("/api/careers")
          .send({ file: "../career.touchline.gz" })
      ).status,
    ).toBe(400);
    await expect(saves.deleteCareer(active.file)).rejects.toThrow(
      "active career",
    );
    const response = await request(app)
      .delete("/api/careers")
      .send({ file: first.file });
    expect(response.status).toBe(200);
    expect(response.body.deleted).toBe(2);
    for (const slot of inactiveIds)
      expect(
        await store.all(
          "SELECT save_id FROM save_chunks WHERE save_id = ?",
          slot.id,
        ),
      ).toEqual([]);
    expect(await saves.list()).toEqual(
      beforeSlots.filter(
        (slot) => slot.file !== first.file && slot.file !== second.file,
      ),
    );
    expect(await store.all(chunkQuery, active.name)).toEqual(activeBytes);
    expect(await stateOf(store)).toEqual(activeState);
    expect((await request(app).get("/api/bootstrap")).body.state).toEqual(
      activeState,
    );
    expect(
      (await request(app).delete("/api/careers").send({ file: first.file }))
        .status,
    ).toBe(400);
  });

  it("deletes a legacy snapshot without removing other unknown saves or the current career", async () => {
    const saves = new Saves(store);
    const first = await saves.create("Legacy one");
    const second = await saves.create("Legacy two");
    await store.run(
      "UPDATE save_slots SET career_id = NULL,career_metadata = NULL WHERE name IN (?,?)",
      first.name,
      second.name,
    );
    const original = await stateOf(store);
    const before = await saves.list();
    const response = await request(app)
      .delete("/api/careers")
      .send({ file: first.file });
    expect(response.status).toBe(200);
    expect(response.body.deleted).toBe(1);
    expect(await saves.list()).toEqual(
      before.filter((slot) => slot.file !== first.file),
    );
    expect((await saves.list()).some((slot) => slot.file === second.file)).toBe(
      true,
    );
    expect(await stateOf(store)).toEqual(original);
    expect((await request(app).get("/api/bootstrap")).body.state).toEqual(
      original,
    );
  });

  it("starts a fresh named career and can load the previous career without losing it", async () => {
    const original = await stateOf(store);
    const response = await request(app).post("/api/careers").send({
      name: "Jamie Director",
      careerName: "A new beginning",
      background: "Academy director",
      clubId: 2,
      seed: "career-regression",
    });
    expect(response.status).toBe(200);
    expect((await stateOf(store)).date).toBe("2026-07-01");
    expect((await stateOf(store)).clubId).toBe(2);
    expect((await stateOf(store)).director.name).toBe("Jamie Director");
    expect((await stateOf(store)).director.skills.development).toBe(2);
    expect((await stateOf(store)).careerName).toBe("A new beginning");
    const slots = await request(app).get("/api/saves");
    expect(
      slots.body.find(
        (slot: { file: string }) => slot.file === response.body.saved,
      ).career.director,
    ).toBe("Jamie Director");
    expect(
      (
        await request(app)
          .post("/api/careers/load")
          .send({ file: response.body.archived })
      ).status,
    ).toBe(200);
    expect((await stateOf(store)).date).toBe(original.date);
    expect((await stateOf(store)).clubId).toBe(original.clubId);
    expect((await stateOf(store)).director.name).toBe(original.director.name);
    expect(
      (await request(app).get("/api/saves")).body.some(
        (slot: { file: string }) => slot.file === response.body.saved,
      ),
    ).toBe(true);
  });
});
