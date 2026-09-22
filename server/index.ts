import express from "express";
import { Store } from "./db.ts";
import { Accounts } from "./accounts.ts";
import { stateOf } from "./systems.ts";
import { createApp, readApiConfiguration } from "./app.ts";
import { describeSqlError } from "./sql-config.ts";

async function start() {
  let configuration: ReturnType<typeof readApiConfiguration>;
  try {
    configuration = readApiConfiguration();
  } catch (error) {
    console.error(
      `Touchline: ${error instanceof Error ? error.message : "Invalid API configuration."}`,
    );
    process.exitCode = 1;
    return;
  }
  const { host, port } = configuration;
  let store: Store | undefined;
  let phase = "SQL connection";
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
      store = await Store.open();
      let accounts: Accounts | undefined;
      if (configuration.requireAuth) {
        phase = "account registry validation";
        accounts = new Accounts(store);
        await accounts.assertReady();
      } else {
        phase = "career state loading";
        const state = await stateOf(store);
        if (!state?.date) throw new Error("Uninitialized career");
      }
      phase = "HTTP application initialization";
      app = createApp(store, accounts);
    }
    const server = app.listen(port, host, () => {
      console.log(`Touchline API listening on ${host}:${port}.`);
    });
    let closing = false;
    const shutdown = () => {
      if (closing) return;
      closing = true;
      server.close(() => {
        void (store?.close() ?? Promise.resolve()).then(
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
      void (store?.close() ?? Promise.resolve()).then(
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
      `Touchline: startup failed during ${phase}. ${describeSqlError(error).join(" | ")} Startup never initializes or reseeds a career.`,
    );
    await store?.close().catch(() => undefined);
    process.exitCode = 1;
  }
}

void start().catch(() => {
  console.error("Touchline: API shutdown failed.");
  process.exitCode = 1;
});
