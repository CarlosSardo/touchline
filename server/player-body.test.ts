import { afterAll, beforeAll, describe, expect, it } from "vitest";
import seedrandom from "seedrandom";
import { Store } from "./db.ts";
import { generateWorld } from "./world.ts";
import { developPlayers } from "./simulation.ts";
import { stateOf } from "./systems.ts";

const sqlIntegration = process.env.SQL_INTEGRATION_TESTS === "true";

/** Players whose indexed body columns (migration 11) differ from profile.identity. */
const outOfSync = async (store: Store) =>
  (await store.get<{ count: number }>(
    `SELECT count(*) AS count FROM players WHERE height IS NULL
       OR height IS DISTINCT FROM round((profile::jsonb #>> '{identity,height}')::double precision)
       OR weight IS DISTINCT FROM round((profile::jsonb #>> '{identity,weight}')::double precision)`,
  ))!.count;

describe.skipIf(!sqlIntegration)("player height and weight columns", () => {
  let store: Store;
  beforeAll(async () => {
    store = await Store.createTest("player_body");
    await generateWorld(store, { nations: ["SCO"], squads: "minimum", seed: "player-body" });
  });
  afterAll(async () => {
    await store?.close();
  });

  it("are written at generation and follow growth through development weeks", async () => {
    expect(await outOfSync(store)).toBe(0);
    const before = await store.all<{ id: number; weight: number }>("SELECT id, weight FROM players ORDER BY id");
    // Week 4 rewrites every profile and grows every body; weeks 1-3 only the director's club.
    for (const week of [1, 2, 3, 4])
      await store.transaction(async () => {
        await store.setMeta("state", { ...(await stateOf(store)), week });
        await developPlayers(store, seedrandom(`player-body:${week}`));
      });
    expect(await outOfSync(store)).toBe(0);
    const after = new Map(
      (await store.all<{ id: number; weight: number }>("SELECT id, weight FROM players")).map((row) => [row.id, row.weight]),
    );
    expect(before.filter((row) => after.get(row.id) !== row.weight).length).toBeGreaterThan(0);
  });
});
