import express from "express";
import { openOnFirstUse, Store } from "./db.ts";
import { Accounts } from "./accounts.ts";
import { stateOf } from "./systems.ts";
import { createApp, readApiConfiguration, type ApiConfiguration, type AppDatabase } from "./app.ts";
import { describeSqlError } from "./sql-config.ts";

/** A startup check failed after SQL connected; waiting for the database to resume would not fix it. */
class StartupCheckError extends Error {}

/** Opens SQL and runs the startup checks; called on the first request that needs the database. */
async function openDatabase(configuration: ApiConfiguration): Promise<AppDatabase> {
  let phase = "SQL connection";
  let store: Store | undefined;
  try {
    store = await Store.open();
    if (configuration.requireAuth) {
      phase = "account registry validation";
      const accounts = new Accounts(store, "accounts", {
        limits: {
          maxPlayers: configuration.maxPlayers,
          sizeLimitGb: configuration.inviteDbSizeLimitGb,
          ownerObjectId: configuration.ownerObjectId,
          ownerEmail: configuration.ownerEmail,
        },
      });
      await accounts.assertReady();
      return { store, accounts };
    }
    phase = "career state loading";
    const state = await stateOf(store);
    if (!state?.date) throw new Error("Uninitialized career");
    return { store };
  } catch (error) {
    console.error(
      `Touchline: SQL is unavailable (${phase}). ${describeSqlError(error).join(" | ")} Touchline never initializes or reseeds a career here.`,
    );
    await store?.close().catch(() => undefined);
    throw store ? new StartupCheckError(phase, { cause: error }) : error;
  }
}

async function start() {
  let configuration: ReturnType<typeof readApiConfiguration>;
  try {
    configuration = readApiConfiguration();
    if (configuration.hosted && configuration.emailTransport === "disabled")
      console.warn("Touchline: hosted email delivery is disabled; invite email flags will remain unset until SMTP is configured.");
    if (configuration.auth)
      console.log(
        `Touchline: OpenID Connect sign-in via ${configuration.auth.issuer} (redirect URI ${configuration.auth.redirectUri}); trusting proxies: ${String(configuration.trustProxy)}.`,
      );
  } catch (error) {
    console.error(
      `Touchline: ${error instanceof Error ? error.message : "Invalid API configuration."}`,
    );
    process.exitCode = 1;
    return;
  }
  const { host, port } = configuration;
  let database: ReturnType<typeof openOnFirstUse<AppDatabase>> | undefined;
  try {
    let app: ReturnType<typeof express>;
    if (process.env.TOUCHLINE_MAINTENANCE === "true") {
      app = express();
      app.disable("x-powered-by");
      app.get("/api/health", (_request, response) => {
        response.set("Cache-Control", "no-store").json({ status: "ok", mode: "maintenance" });
      });
      app.use((_request, response) => {
        response.set({ "Cache-Control": "no-store", "Retry-After": "300" }).status(503).json({
          error: "Touchline is temporarily unavailable while its deployment is being prepared.",
        });
      });
      console.log("Touchline maintenance mode: SQL is not opened; game access is disabled.");
    } else {
      // PostgreSQL may still be starting next to the app after a reboot; requests that need SQL wait and retry.
      database = openOnFirstUse(() => openDatabase(configuration), {
        retryable: (error) => !(error instanceof StartupCheckError),
      });
      app = createApp(database.get);
    }
    const server = app.listen(port, host, () => {
      console.log(`Touchline API listening on ${host}:${port}; SQL opens on the first request that needs it.`);
    });
    const closeDatabase = () => database?.close((opened) => opened.store.close()) ?? Promise.resolve();
    let closing = false;
    const shutdown = () => {
      if (closing) return;
      closing = true;
      server.close(() => {
        void closeDatabase().then(
          () => {
            process.exitCode = 0;
          },
          () => {
            process.exitCode = 1;
          },
        );
      });
    };
    process.once("SIGINT", shutdown);
    process.once("SIGTERM", shutdown);
    server.once("error", () => {
      if (closing) return;
      closing = true;
      console.error(
        "Touchline: unable to start the API listener. Check API_HOST and PORT/API_PORT.",
      );
      void closeDatabase().then(
        () => {
          process.exitCode = 1;
        },
        () => {
          process.exitCode = 1;
        },
      );
    });
  } catch (error) {
    console.error(
      `Touchline: startup failed during HTTP application initialization. ${describeSqlError(error).join(" | ")}`,
    );
    process.exitCode = 1;
  }
}

void start().catch(() => {
  console.error("Touchline: API shutdown failed.");
  process.exitCode = 1;
});
