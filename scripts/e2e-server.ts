import type { Server } from "node:http";
import { Store } from "../server/db.ts";
import { createApp } from "../server/app.ts";
import { createCalendar } from "../server/calendar.ts";
import { initialInbox } from "../server/systems.ts";
import { quoteIdentifier } from "../server/sql-schema.ts";
import { generateWorld } from "../server/world.ts";

const schema = process.env.SQL_SCHEMA;
if (
  process.env.SQL_TEST_MODE !== "true" ||
  !schema ||
  !/^touchline_e2e_[a-f0-9]{32}$/.test(schema)
)
  throw new Error(
    "E2E setup requires SQL_TEST_MODE=true and a fresh touchline_e2e_<uuid> schema.",
  );
const schemaName: string = schema;
// EN hosts the user club (club 1); the association audit spec needs DE (documented) and LU (unverified) rules.
const E2E_NATIONS = ["EN", "DE", "LU"];
const port = Number(process.env.API_PORT ?? 3002);
if (!Number.isInteger(port) || port < 1 || port > 65535)
  throw new Error("API_PORT must be a valid port.");

let store: Store | undefined;
let server: Server | undefined;
let ownsSchema = false;
let stopping = false;
let shutdown: Promise<void> | undefined;
let startup: Promise<void>;

async function initialize() {
  store = await Store.open();
  if (!store.testMode || store.schemaName !== schemaName)
    throw new Error("Refusing to initialize an unverified E2E SQL schema.");
  if (stopping) return;
  await store.exec(`CREATE SCHEMA ${quoteIdentifier(schemaName)}`);
  ownsSchema = true;
  if (stopping) return;
  await store.schema();
  if (stopping) return;
  const started = performance.now();
  await generateWorld(store, { nations: E2E_NATIONS });
  console.log(
    `E2E world ${E2E_NATIONS.join(",")} generated in ${Math.round((performance.now() - started) / 1000)}s.`,
  );
  if (stopping) return;
  await createCalendar(store);
  if (stopping) return;
  await initialInbox(store);
  if (stopping) return;
  const app = await createApp(store);
  if (stopping) return;
  await new Promise<void>((resolve, reject) => {
    server = app.listen(port, "127.0.0.1", (error) => {
      if (error) reject(error);
      else resolve();
    });
    server.once("error", reject);
  });
  console.log(
    `E2E API ready on http://127.0.0.1:${port}; schema ${schemaName}`,
  );
}

async function dropOwnedSchema() {
  if (!store || !ownsSchema) return;
  if (!store.testMode || store.schemaName !== schemaName)
    throw new Error("Refusing cleanup outside the owned E2E schema.");
  await store.exec(`DROP SCHEMA ${quoteIdentifier(schemaName)} CASCADE`);
  ownsSchema = false;
}

function stop() {
  stopping = true;
  shutdown ??= (async () => {
    try {
      await startup.catch(() => undefined);
      if (server?.listening) {
        const activeServer = server;
        await new Promise<void>((resolve, reject) => {
          activeServer.close((error) => (error ? reject(error) : resolve()));
          activeServer.closeIdleConnections();
        });
      }
      await dropOwnedSchema();
    } catch (error) {
      console.error(`E2E cleanup failed for schema ${schemaName}:`, error);
      process.exitCode = 1;
    } finally {
      try {
        await store?.close();
      } catch (error) {
        console.error("E2E SQL connection cleanup failed:", error);
        process.exitCode = 1;
      }
    }
  })();
  return shutdown;
}

process.once("SIGINT", () => {
  void stop();
});
process.once("SIGTERM", () => {
  void stop();
});
startup = initialize();
void startup.catch((error) => {
  console.error("E2E SQL setup failed:", error);
  process.exitCode = 1;
  void stop();
});
