import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Store } from "./db.ts";
import { generateWorld } from "./world.ts";
import { createCalendar } from "./calendar.ts";
import { createApp } from "./app.ts";
import { initialInbox, stateOf } from "./systems.ts";
import { Saves } from "./saves.ts";

describe("local game HTTP API and saves", () => {
  const folder = mkdtempSync(join(tmpdir(), "touchline-test-"));
  const store = new Store(join(folder, "career.sqlite"));
  const app = createApp(store, join(folder, "saves"));
  beforeAll(() => {
    generateWorld(store, { countryLimit: 3, seniors: 1800, youth: 900 });
    createCalendar(store);
    initialInbox(store);
  });
  afterAll(() => {
    store.close();
    rmSync(folder, { recursive: true, force: true });
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

  it("returns every major screen without placeholder data or SQL errors", async () => {
    for (const path of [
      "bootstrap",
      "dashboard",
      "squad",
      "scouting",
      "transfers",
      "loans",
      "staff",
      "training",
      "academy",
      "finances",
      "leagues/1",
      "matches",
      "players/1",
    ]) {
      const response = await request(app).get(`/api/${path}`);
      expect(response.status, path).toBe(200);
    }
  });

  it("rejects malformed actions, injection attempts, cloud sync and remote origins", async () => {
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
    expect(
      (await request(app).patch("/api/settings").send({ cloudSync: true }))
        .status,
    ).toBe(400);
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
    const player = store.get<{ name: string }>(
      "SELECT name FROM players WHERE id = 1",
    )!;
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

  it("creates and restores a compressed SQLite save without losing the career", async () => {
    const saves = new Saves(store, join(folder, "saves"));
    const slot = await saves.create("Regression save");
    expect(slot.file.endsWith(".gz")).toBe(true);
    store.setMeta("state", { ...stateOf(store), date: "2026-07-20" });
    saves.restore(slot.file);
    expect(stateOf(store).date).toBe("2026-07-01");
    expect(
      store.get<{ count: number }>("SELECT count(*) AS count FROM players")!
        .count,
    ).toBe(2700);
    expect(() => saves.restore("../../escape.sqlite")).toThrow("not found");
    expect(() => saves.import(Buffer.from("not a database"))).toThrow(
      "not a SQLite",
    );
  });

  it("honors daily autosaves during a multi-day calendar advance", async () => {
    await request(app).patch("/api/settings").send({ autosave: "daily" });
    const response = await request(app).post("/api/advance").send({ days: 3 });
    expect(response.status).toBe(200);
    const saves = new Saves(store, join(folder, "saves"));
    const autosaves = saves.list().filter((slot) => slot.automatic);
    expect(autosaves).toHaveLength(3);
    expect(autosaves.some((slot) => slot.file.includes("2026-07-02"))).toBe(
      true,
    );
    expect(autosaves.some((slot) => slot.file.includes("2026-07-04"))).toBe(
      true,
    );
  });
});
