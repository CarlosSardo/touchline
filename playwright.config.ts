import { randomUUID } from "node:crypto";
import { defineConfig } from "@playwright/test";

const schema =
  (process.env.TOUCHLINE_E2E_SCHEMA ??= `touchline_e2e_${randomUUID().replaceAll("-", "")}`);
if (!/^touchline_e2e_[a-f0-9]{32}$/.test(schema))
  throw new Error("TOUCHLINE_E2E_SCHEMA must contain a fresh E2E schema UUID.");
const apiPort = process.env.E2E_API_PORT ?? "3002";
const uiPort = process.env.E2E_UI_PORT ?? "5180";
const baseURL = process.env.TEST_URL ?? `http://127.0.0.1:${uiPort}`;

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  workers: 1,
  timeout: 180_000,
  expect: { timeout: 15_000 },
  reporter: "list",
  webServer: process.env.TEST_URL
    ? undefined
    : {
        command:
          'npx concurrently -k --kill-timeout 120000 -n engine,ui -c green,cyan "tsx scripts/e2e-server.ts" "vite --host 127.0.0.1 --strictPort"',
        env: {
          SQL_SCHEMA: schema,
          SQL_TEST_MODE: "true",
          SQL_ALLOW_REMOTE_TESTS: process.env.SQL_ALLOW_REMOTE_TESTS ?? "",
          SQL_TEST_DATABASE: process.env.SQL_TEST_DATABASE ?? "",
          API_HOST: "127.0.0.1",
          API_PORT: apiPort,
          UI_PORT: uiPort,
        },
        url: `${baseURL}/api/health`,
        timeout: 900000,
        gracefulShutdown: { signal: "SIGTERM", timeout: 120000 },
        reuseExistingServer: false,
      },
  use: {
    baseURL,
    headless: true,
    reducedMotion: "reduce",
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
    viewport: { width: 1440, height: 1000 },
  },
});
