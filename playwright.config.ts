import { defineConfig } from "@playwright/test";

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
        command: "npm run dev",
        env: {
          GAME_DB: "data/e2e.sqlite",
          SAVE_DIR: "data/e2e-saves",
          API_PORT: "3002",
          UI_PORT: "5180",
        },
        url: "http://127.0.0.1:5180/api/health",
        timeout: 180000,
        reuseExistingServer: false,
      },
  use: {
    baseURL: process.env.TEST_URL ?? "http://127.0.0.1:5180",
    headless: true,
    reducedMotion: "reduce",
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
    viewport: { width: 1440, height: 1000 },
  },
});
