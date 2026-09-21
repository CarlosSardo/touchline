import type { Server } from "node:http";
import { Store } from "../server/db.ts";
import { createApp } from "../server/app.ts";
import { createCalendar } from "../server/calendar.ts";
import { initialInbox } from "../server/systems.ts";
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
  await store.exec(`CREATE SCHEMA [${schemaName}]`);
  ownsSchema = true;
  if (stopping) return;
  await store.schema();
  if (stopping) return;
  await generateWorld(store);
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
  const quote = (name: string) => `[${name.replaceAll("]", "]]")}]`;
  const constraints = await store.all<{ table_name: string; name: string }>(
    "SELECT tables.name AS table_name,foreign_keys.name FROM sys.foreign_keys AS foreign_keys JOIN sys.tables AS tables ON tables.object_id = foreign_keys.parent_object_id WHERE tables.schema_id = SCHEMA_ID(?)",
    schemaName,
  );
  for (const constraint of constraints)
    await store.exec(
      `ALTER TABLE ${quote(schemaName)}.${quote(constraint.table_name)} DROP CONSTRAINT ${quote(constraint.name)}`,
    );
  const tables = await store.all<{ name: string }>(
    "SELECT name FROM sys.tables WHERE schema_id = SCHEMA_ID(?)",
    schemaName,
  );
  for (const table of tables)
    await store.exec(`DROP TABLE ${quote(schemaName)}.${quote(table.name)}`);
  await store.exec(`DROP SCHEMA ${quote(schemaName)}`);
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
