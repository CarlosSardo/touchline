import { resolve } from "node:path";
import { Store } from "./db.ts";
import { generateWorld } from "./world.ts";
import { createCalendar } from "./calendar.ts";
import { initialInbox, stateOf } from "./systems.ts";
import { createApp } from "./app.ts";

const file = resolve(process.env.GAME_DB ?? "data/career.sqlite");
const store = new Store(file);
console.log("Touchline: opening local SQLite world...");
generateWorld(store);
createCalendar(store);
initialInbox(store);
const port = Number(process.env.API_PORT ?? 3001);
const app = createApp(store, process.env.SAVE_DIR);
const server = app.listen(port, "127.0.0.1", () => {
  console.log(`Touchline local engine: http://127.0.0.1:${port}`);
  console.log(`Career date: ${stateOf(store).date}. Database: ${file}`);
});
const shutdown = () => {
  server.close(() => {
    store.close();
    process.exit(0);
  });
};
process.once("SIGINT", shutdown);
process.once("SIGTERM", shutdown);
server.on("error", (error) => {
  console.error(error.message);
  store.close();
  process.exit(1);
});
