import { expect, test as base, type Page, type Route } from "@playwright/test";
import type {
  AccountSession,
  Bootstrap,
  SaveSlot,
  WorldActivity,
  WorldBusyResponse,
  WorldClubPage,
  WorldOperation,
} from "../shared/api.ts";
import { DEFAULT_SETTINGS } from "../shared/rules.ts";

const accountUser: AccountSession["user"] = {
  id: "ui-account-one",
  displayName: "Morgan Account",
  email: "morgan@example.test",
};

function preparedBootstrap(): Bootstrap {
  return {
    state: {
      careerId: "ui-account-career",
      careerName: "Morgan private career",
      date: "2026-07-01",
      season: 2026,
      seed: "account-ui-fixture",
      clubId: 1,
      started: false,
      director: {
        name: "Morgan Director",
        background: "Former scout",
        reputation: 40,
        experience: 0,
        skillPoints: 0,
        skills: {},
      },
      week: 1,
      worldTrend: "Balanced",
      lastAutosave: "2026-07-01",
      gameOver: false,
    },
    club: {
      id: 1,
      name: "Account Fixture FC",
      short_name: "AFFC",
      city: "Northbridge",
      country_id: 1,
      league_id: 1,
      type: "club",
      parent_id: null,
      age_group: "Senior",
      color: "#176b52",
      reputation: 40,
      academy: 40,
      facilities: 40,
      balance: 100000,
      transfer_budget: 20000,
      wage_budget: 10000,
      philosophy: "Youth development",
      culture: "Balanced",
      formation: "4-3-3",
      tactical_style: "Balanced",
      chemistry: 50,
      manager: "Fixture Manager",
      manager_trust: 50,
      board_confidence: 50,
      board_pressure: 20,
      fan_mood: 50,
      fan_loyalty: 50,
      fan_patience: 50,
      expectations: 50,
      momentum: 0,
      crisis: 0,
      hype: 0,
      income: 0,
      spending: 0,
      season_spend: 0,
      ffp: 0,
      stadium: "Fixture Ground",
      capacity: 1000,
      data: "{}",
      country_name: "England",
      country_code: "GB",
      league_name: "Fixture Division",
    },
    settings: { ...DEFAULT_SETTINGS, theme: "light", animationSpeed: "off" },
    world: {
      version: 3,
      countries: 1,
      leagues: 1,
      clubs: 1,
      players: 0,
      seniors: 0,
      youth: 0,
      staff: 0,
    },
    countries: [{
      id: 1,
      code: "GB",
      name: "England",
      continent: "Europe",
      confederation: "UEFA",
      reputation: 80,
      language: "English",
      region: "Northern Europe",
    }],
  };
}

interface AccountApi {
  session: AccountSession;
  bootstrap: Bootstrap | null;
  saves: SaveSlot[];
  requests: string[];
  /** Mirrors the server router slot: while set, every gated read answers 409 world_busy. */
  activity: WorldActivity | null;
  meStatus?: number;
  toleratedReads?: boolean;
  prepare?: (route: Route) => Promise<void>;
  start?: (route: Route) => Promise<void>;
  deleteActive?: (route: Route) => Promise<void>;
  bootstrapGate?: Promise<void>;
}

function busyBody(activity: WorldActivity): WorldBusyResponse {
  return {
    error: "The game is saving or advancing. Please wait for that operation to finish.",
    code: "world_busy",
    ...activity,
  };
}

const test = base.extend<{ accountApi: AccountApi }>({
  accountApi: async ({ page }, runAccountApi) => {
    const unexpected: string[] = [];
    const accountApi: AccountApi = {
      session: { user: { ...accountUser }, hasWorld: false, activity: null },
      bootstrap: null,
      saves: [],
      requests: [],
      activity: null,
    };
    await page.route("**/api/**", async (route) => {
      const request = route.request();
      const key = `${request.method()} ${new URL(request.url()).pathname}`;
      accountApi.requests.push(key);
      if (key === "GET /api/me") {
        if (accountApi.meStatus)
          return route.fulfill({
            status: accountApi.meStatus,
            json: {
              error: accountApi.meStatus === 401
                ? "Your session has expired. Sign in again to continue."
                : "Account lookup failed.",
            },
          });
        const { user, hasWorld } = accountApi.session;
        return route.fulfill({
          json: accountApi.activity
            ? { user, hasWorld: null, activity: accountApi.activity }
            : { user, hasWorld, activity: null },
        });
      }
      if (accountApi.activity)
        return route.fulfill({
          status: 409,
          headers: { "Retry-After": "2" },
          json: busyBody(accountApi.activity),
        });
      switch (key) {
        case "GET /api/bootstrap": {
          const bootstrap = accountApi.bootstrap;
          await accountApi.bootstrapGate;
          return route.fulfill({ json: bootstrap });
        }
        case "GET /api/saves":
          return route.fulfill({ json: accountApi.saves });
        case "GET /api/leagues":
          return route.fulfill({ json: [] });
        case "GET /api/world/clubs": {
          if (!accountApi.bootstrap) break;
          const clubs: WorldClubPage = {
            clubs: [{
              ...accountApi.bootstrap.club,
              tier: 1,
              confederation: "UEFA",
              squad_size: 0,
            }],
            total: 1,
            page: 1,
            pageSize: 30,
            pages: 1,
          };
          return route.fulfill({ json: clubs });
        }
        case "POST /api/careers/prepare":
          if (accountApi.prepare) return accountApi.prepare(route);
          break;
        case "POST /api/careers":
          if (accountApi.start) return accountApi.start(route);
          break;
        case "DELETE /api/careers/active":
          if (accountApi.deleteActive) return accountApi.deleteActive(route);
          break;
        case "DELETE /api/careers": {
          const { file } = request.postDataJSON() as { file: string };
          const selected = accountApi.saves.find((slot) => slot.file === file);
          if (!selected) break;
          const removed = accountApi.saves.filter((slot) =>
            selected.career ? slot.career?.id === selected.career.id : slot.file === file);
          accountApi.saves = accountApi.saves.filter((slot) => !removed.includes(slot));
          return route.fulfill({
            json: { deleted: removed.length, message: "Career and its saved snapshots deleted." },
          });
        }
      }
      if (accountApi.toleratedReads && request.method() === "GET")
        return route.fulfill({ status: 501, json: { error: "Not part of this fixture." } });
      unexpected.push(key);
      await route.fulfill({
        status: 501,
        json: { error: `Unhandled account UI fixture request: ${key}` },
      });
    });
    await runAccountApi(accountApi);
    expect(unexpected, "All account UI API requests must be intercepted").toEqual([]);
  },
});

test.use({ serviceWorkers: "block" });

function holdResponse() {
  let release!: () => void;
  const promise = new Promise<void>((resolve) => { release = resolve; });
  return { promise, release };
}

/** Holds the account's router slot like server mutation(): reads 409 until the returned promise settles. */
async function holdSlot(
  accountApi: AccountApi,
  operation: WorldOperation,
  gate: Promise<void>,
  apply: () => void,
) {
  accountApi.activity = { operation, startedAt: new Date().toISOString() };
  try {
    await gate;
    apply();
  } finally {
    accountApi.activity = null;
  }
}

async function fulfillQuietly(route: Route, response: Parameters<Route["fulfill"]>[0]) {
  // The page may have reloaded and cancelled this request while the server kept working.
  await route.fulfill(response).catch(() => undefined);
}

function prepareWorld(accountApi: AccountApi) {
  accountApi.bootstrap = preparedBootstrap();
  accountApi.session.hasWorld = true;
}

function count(accountApi: AccountApi, key: string) {
  return accountApi.requests.filter((request) => request === key).length;
}

function mutations(accountApi: AccountApi) {
  return accountApi.requests.filter((request) => !request.startsWith("GET "));
}

async function noOverflow(page: Page) {
  const dimensions = await page.evaluate(() => ({
    width: innerWidth,
    body: document.documentElement.scrollWidth,
  }));
  expect(dimensions.body).toBeLessThanOrEqual(dimensions.width + 1);
  await expect(page.locator(".error-state")).toHaveCount(0);
}

test("empty account profile does not prepare a world automatically", async ({
  page, accountApi,
}) => {
  await page.goto("/#start");
  await expect(page.getByRole("heading", { name: "No career started", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: /^Load career/ })).toContainText("0 saved careers");
  await expect(page.getByRole("button", { name: "Continue career", exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Open settings", exact: true })).toBeDisabled();
  await page.getByRole("button", { name: `Account profile for ${accountUser.displayName}`, exact: true }).click();
  const profile = page.getByRole("dialog", { name: "Account profile", exact: true });
  const identity = profile.getByRole("region", { name: "Signed-in account", exact: true });
  await expect(identity).toContainText(accountUser.displayName);
  await expect(identity).toContainText(accountUser.email!);
  await expect(profile.getByLabel("Director name", { exact: true })).toHaveCount(0);
  await expect(profile.getByRole("button", { name: "Update profile", exact: true })).toHaveCount(0);
  await profile.locator(".sheet-footer").getByRole("button", { name: "Close", exact: true }).click();
  await expect(profile).toHaveCount(0);
  await page.getByRole("button", { name: /^Load career/ }).click();
  await expect(page.getByRole("heading", { name: "No saved careers", exact: true })).toBeVisible();
  expect(accountApi.requests).toEqual(expect.arrayContaining([
    "GET /api/me", "GET /api/bootstrap", "GET /api/saves",
  ]));
  expect(mutations(accountApi)).toEqual([]);
});

test("New career prepares once only after a click and opens the club picker", async ({
  page, accountApi,
}) => {
  const preparation = holdResponse();
  accountApi.prepare = async (route) => {
    expect(route.request().postDataJSON()).toEqual({});
    await holdSlot(accountApi, "prepare_world", preparation.promise, () => prepareWorld(accountApi));
    await route.fulfill({ json: { created: true } });
  };
  await page.goto("/#start");
  await expect(page.getByRole("button", { name: /^New career/ })).toBeEnabled();
  expect(mutations(accountApi)).toEqual([]);
  try {
    await page.getByRole("button", { name: /^New career/ }).click();
    await expect(page.getByRole("button", { name: /^Preparing your world/ })).toBeDisabled();
    await expect(page.getByRole("button", { name: /^Load career/ })).toBeDisabled();
    await expect(page.getByRole("heading", { name: "Choose your club", exact: true })).toHaveCount(0);
    expect(mutations(accountApi)).toEqual(["POST /api/careers/prepare"]);
  } finally {
    preparation.release();
  }
  await expect(page.getByRole("heading", { name: "Choose your club", exact: true })).toBeVisible();
  await expect(page.getByLabel("Director name", { exact: true })).toHaveValue(accountUser.displayName);
  await expect(page.locator(".career-club-list > button")).toHaveCount(1);
  await expect(page.locator(".career-club-list > button")).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByRole("button", { name: "Start career", exact: true })).toBeEnabled();
  await page.getByRole("button", { name: "Careers", exact: true }).click();
  await page.getByRole("button", { name: /^New career/ }).click();
  await expect(page.getByRole("heading", { name: "Choose your club", exact: true })).toBeVisible();
  expect(mutations(accountApi)).toEqual(["POST /api/careers/prepare"]);
});

test("failed preparation can be retried without creating a career", async ({
  page, accountApi,
}) => {
  let attempts = 0;
  accountApi.prepare = async (route) => {
    attempts++;
    if (attempts === 1) {
      await route.fulfill({ status: 503, json: { error: "World preparation temporarily unavailable." } });
      return;
    }
    accountApi.bootstrap = preparedBootstrap();
    accountApi.session.hasWorld = true;
    await route.fulfill({ json: { created: false } });
  };
  await page.goto("/#start");
  await page.getByRole("button", { name: /^New career/ }).click();
  await expect(page.locator(".error-state")).toContainText("World preparation temporarily unavailable.");
  await expect(page.getByRole("button", { name: /^Retry preparation/ })).toBeEnabled();
  await expect(page.getByRole("heading", { name: "Choose your club", exact: true })).toHaveCount(0);
  expect(attempts).toBe(1);
  await page.getByRole("button", { name: /^Retry preparation/ }).click();
  await expect(page.getByRole("heading", { name: "Choose your club", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Start career", exact: true })).toBeEnabled();
  await expect(page.locator(".error-state")).toHaveCount(0);
  expect(attempts).toBe(2);
  expect(mutations(accountApi)).toEqual(["POST /api/careers/prepare", "POST /api/careers/prepare"]);
});

test("long account names fit the mobile start screen and profile without horizontal overflow", async ({
  page, accountApi,
}) => {
  accountApi.session.user = {
    ...accountUser,
    displayName: `Alexandria ${"LongFamilyName".repeat(10)}`,
    email: "alexandria.long.account.name.for.regression.coverage@example.test",
  };
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/#start");
  for (const width of [390, 320]) {
    await page.setViewportSize({ width, height: 844 });
    const account = page.getByRole("button", { name: `Account profile for ${accountApi.session.user.displayName}`, exact: true });
    await expect(account).toBeVisible();
    await noOverflow(page);
    await account.click();
    const profile = page.getByRole("dialog", { name: "Account profile", exact: true });
    await expect(profile).toContainText(accountApi.session.user.displayName);
    await expect(profile).toContainText(accountApi.session.user.email!);
    await noOverflow(page);
    const dimensions = await profile.evaluate((element) => ({
      width: element.clientWidth,
      content: element.scrollWidth,
    }));
    expect(dimensions.content).toBeLessThanOrEqual(dimensions.width + 1);
    await profile.locator(".sheet-footer").getByRole("button", { name: "Close", exact: true }).click();
    await expect(profile).toHaveCount(0);
  }
  expect(mutations(accountApi)).toEqual([]);
});

test("account changes on focus refresh and reload clear the previous identity and career", async ({
  page, accountApi,
}) => {
  const nextUser: AccountSession["user"] = {
    id: "ui-account-two",
    displayName: "Casey Account",
    email: "casey@example.test",
  };
  for (const action of ["focus refresh", "reload"] as const) {
    await test.step(action, async () => {
      accountApi.session = { user: { ...accountUser }, hasWorld: true, activity: null };
      accountApi.bootstrap = preparedBootstrap();
      accountApi.bootstrap.state.started = true;
      if (action === "focus refresh") await page.goto("/#start");
      else await page.reload();
      await expect(page.getByRole("heading", { name: "Morgan private career", exact: true })).toBeVisible();
      await expect(page.getByRole("button", { name: "Continue career", exact: true })).toBeVisible();
      await page.getByRole("button", { name: `Account profile for ${accountUser.displayName}`, exact: true }).click();
      const previousProfile = page.getByRole("dialog", { name: "Director profile", exact: true });
      await expect(previousProfile.getByLabel("Director name", { exact: true })).toHaveValue("Morgan Director");

      const pendingBootstrap = holdResponse();
      accountApi.session = { user: { ...nextUser }, hasWorld: false, activity: null };
      accountApi.bootstrap = null;
      accountApi.bootstrapGate = pendingBootstrap.promise;
      const nextBootstrap = page.waitForResponse((response) =>
        new URL(response.url()).pathname === "/api/bootstrap" && response.request().method() === "GET",
      );
      try {
        if (action === "focus refresh")
          await page.evaluate(() => window.dispatchEvent(new Event("focus")));
        else await page.reload();
        await expect(page.locator(".startup")).toBeVisible();
        await expect(previousProfile).toHaveCount(0);
        await expect(page.getByRole("button", { name: `Account profile for ${accountUser.displayName}`, exact: true })).toHaveCount(0);
        await expect(page.getByText("Morgan private career", { exact: true })).toHaveCount(0);
      } finally {
        pendingBootstrap.release();
        accountApi.bootstrapGate = undefined;
      }
      expect(await (await nextBootstrap).json()).toBeNull();
      await expect(page.getByRole("heading", { name: "No career started", exact: true })).toBeVisible();
      await expect(page.getByRole("button", { name: "Continue career", exact: true })).toHaveCount(0);
      await expect(page.getByText("Account Fixture FC", { exact: true })).toHaveCount(0);
      await page.getByRole("button", { name: `Account profile for ${nextUser.displayName}`, exact: true }).click();
      const profile = page.getByRole("dialog", { name: "Account profile", exact: true });
      await expect(profile).toContainText(nextUser.displayName);
      await expect(profile).toContainText(nextUser.email!);
      await expect(profile).not.toContainText(accountUser.displayName);
      await expect(profile).not.toContainText(accountUser.email!);
      await expect(profile.getByLabel("Director name", { exact: true })).toHaveCount(0);
    });
  }
  expect(mutations(accountApi)).toEqual([]);
});
function startedBootstrap() {
  const bootstrap = preparedBootstrap();
  bootstrap.state.started = true;
  return bootstrap;
}

function careerSlot(file: string, career: { id: string; name: string }, modified: string): SaveSlot {
  return {
    name: `${career.name} snapshot`,
    file,
    size: 2_000_000,
    modified,
    compressed: true,
    automatic: false,
    career: {
      ...career,
      director: "Morgan Director",
      club: "Account Fixture FC",
      date: "2026-07-01",
      season: 2026,
    },
  };
}

const busyStatus = (page: Page) =>
  page.getByRole("status").filter({ hasText: "Your private world is still being built." });

async function expectNoFatalScreen(page: Page) {
  await expect(page.getByRole("button", { name: "Reconnect to account", exact: true })).toHaveCount(0);
  await expect(page.locator(".error-state")).toHaveCount(0);
}

for (const width of [1440, 390, 320]) {
  test.describe(`busy-safe careers at ${width}px`, () => {
    test.use({ viewport: { width, height: 900 } });

    test("focus and visibility changes during preparation keep the session and send one POST", async ({
      page, accountApi,
    }) => {
      const preparation = holdResponse();
      accountApi.prepare = async (route) => {
        await holdSlot(accountApi, "prepare_world", preparation.promise, () => prepareWorld(accountApi));
        await route.fulfill({ json: { created: true } });
      };
      await page.goto("/#start");
      await page.getByRole("button", { name: /^New career/ }).click();
      await expect(page.getByRole("status").filter({ hasText: "Building your private world." })).toBeVisible();
      try {
        const readsBefore = accountApi.requests.length;
        await page.evaluate(() => {
          window.dispatchEvent(new Event("focus"));
          document.dispatchEvent(new Event("visibilitychange"));
        });
        await page.waitForTimeout(500);
        expect(accountApi.requests.slice(readsBefore)).toEqual([]);
        await expectNoFatalScreen(page);
        await noOverflow(page);
      } finally {
        preparation.release();
      }
      await expect(page.getByRole("heading", { name: "Choose your club", exact: true })).toBeVisible();
      await expectNoFatalScreen(page);
      expect(mutations(accountApi)).toEqual(["POST /api/careers/prepare"]);
    });

    test("reloading during preparation shows a busy status and recovers without another POST", async ({
      page, accountApi,
    }) => {
      const preparation = holdResponse();
      accountApi.prepare = async (route) => {
        await holdSlot(accountApi, "prepare_world", preparation.promise, () => prepareWorld(accountApi));
        await fulfillQuietly(route, { json: { created: true } });
      };
      await page.goto("/#start");
      await page.getByRole("button", { name: /^New career/ }).click();
      await expect.poll(() => accountApi.activity?.operation).toBe("prepare_world");
      await page.reload();
      await expect(busyStatus(page)).toBeVisible();
      await expect(busyStatus(page)).toContainText("Elapsed");
      await expect(page.getByRole("button", { name: "Check now", exact: true })).toBeVisible();
      await expectNoFatalScreen(page);
      await noOverflow(page);
      await page.screenshot({ path: `test-results/account-busy-startup-${width}.png` });
      const polls = count(accountApi, "GET /api/me");
      await page.getByRole("button", { name: "Check now", exact: true }).click();
      await expect.poll(() => count(accountApi, "GET /api/me")).toBeGreaterThan(polls);
      await expect(busyStatus(page)).toBeVisible();
      preparation.release();
      await expect(busyStatus(page)).toHaveCount(0, { timeout: 20_000 });
      await expect(page.getByText("Your private world is ready. Choose a club to begin.")).toBeVisible();
      await page.getByRole("button", { name: /^New career/ }).click();
      await expect(page.getByRole("heading", { name: "Choose your club", exact: true })).toBeVisible();
      await expectNoFatalScreen(page);
      expect(mutations(accountApi)).toEqual(["POST /api/careers/prepare"]);
    });

    test("a gateway timeout on preparation waits for the world instead of resending", async ({
      page, accountApi,
    }) => {
      const preparation = holdResponse();
      let finished = true;
      accountApi.prepare = async (route) => {
        const build = holdSlot(accountApi, "prepare_world", preparation.promise, () => {
          if (finished) prepareWorld(accountApi);
        });
        await route.fulfill({ status: 504, body: "stream timeout" });
        await build;
      };
      await page.goto("/#start");
      await page.getByRole("button", { name: /^New career/ }).click();
      await expect(busyStatus(page)).toBeVisible({ timeout: 20_000 });
      await expectNoFatalScreen(page);
      preparation.release();
      await expect(page.getByRole("heading", { name: "Choose your club", exact: true })).toBeVisible({ timeout: 20_000 });
      expect(mutations(accountApi)).toEqual(["POST /api/careers/prepare"]);

      await test.step("an unfinished world offers a manual retry only", async () => {
        accountApi.bootstrap = null;
        accountApi.session.hasWorld = false;
        finished = false;
        const failedBuild = holdResponse();
        accountApi.prepare = async (route) => {
          const build = holdSlot(accountApi, "prepare_world", failedBuild.promise, () => undefined);
          await route.fulfill({ status: 504, body: "stream timeout" });
          await build;
        };
        await page.reload();
        await page.getByRole("button", { name: /^New career/ }).click();
        await expect(busyStatus(page)).toBeVisible({ timeout: 20_000 });
        failedBuild.release();
        await expect(page.locator(".error-state")).toContainText("Your private world was not finished. Try again.", { timeout: 20_000 });
        await expect(page.getByRole("button", { name: /^Retry preparation/ })).toBeEnabled();
        await page.waitForTimeout(3000);
        expect(mutations(accountApi)).toEqual(["POST /api/careers/prepare", "POST /api/careers/prepare"]);
      });
    });

    test("a gateway timeout on Start career keeps the button locked and opens the office once started", async ({
      page, accountApi,
    }) => {
      prepareWorld(accountApi);
      const start = holdResponse();
      accountApi.start = async (route) => {
        const run = holdSlot(accountApi, "start_career", start.promise, () => {
          const bootstrap = startedBootstrap();
          bootstrap.state.careerId = "ui-account-started";
          accountApi.bootstrap = bootstrap;
          accountApi.toleratedReads = true;
        });
        await route.fulfill({ status: 504, body: "stream timeout" });
        await run;
      };
      await page.goto("/#start");
      await page.getByRole("button", { name: /^New career/ }).click();
      await page.getByRole("button", { name: "Start career", exact: true }).click();
      await expect(page.getByRole("status").filter({ hasText: "Starting your career." })).toBeVisible();
      await expect(page.getByRole("button", { name: /Creating world|Start career/ })).toBeDisabled();
      await expectNoFatalScreen(page);
      await noOverflow(page);
      start.release();
      await expect(page).toHaveURL(/#office$/, { timeout: 20_000 });
      expect(mutations(accountApi)).toEqual(["POST /api/careers"]);
    });

    test("real account failures still show Reconnect or session expiry", async ({
      page, accountApi,
    }) => {
      accountApi.meStatus = 500;
      await page.goto("/#start");
      await expect(page.getByRole("button", { name: "Reconnect to account", exact: true })).toBeVisible();
      await expect(page.locator(".error-state")).toContainText("Account lookup failed.");
      accountApi.meStatus = undefined;
      await expect(page.getByRole("heading", { name: "No career started", exact: true })).toBeVisible({ timeout: 20_000 });

      await test.step("401 while waiting on a busy world stops polling and expires the session", async () => {
        accountApi.activity = { operation: "prepare_world", startedAt: new Date().toISOString() };
        await page.reload();
        await expect(busyStatus(page)).toBeVisible();
        accountApi.meStatus = 401;
        await page.getByRole("button", { name: "Check now", exact: true }).click();
        await expect(page.locator(".error-state")).toContainText("Your session has expired.");
        const polls = count(accountApi, "GET /api/me");
        await page.waitForTimeout(3000);
        expect(count(accountApi, "GET /api/me")).toBe(polls);
        accountApi.activity = null;
      });
      expect(mutations(accountApi)).toEqual([]);
    });

    test("the active career can be deleted after a typed confirmation", async ({
      page, accountApi,
    }) => {
      accountApi.bootstrap = startedBootstrap();
      accountApi.session.hasWorld = true;
      const active = { id: "ui-account-career", name: "Morgan private career" };
      const other = { id: "ui-other-career", name: "Other career" };
      accountApi.saves = [
        careerSlot("active-1.touchline", active, "2026-09-20T10:00:00.000Z"),
        careerSlot("active-2.touchline", active, "2026-09-21T10:00:00.000Z"),
        careerSlot("other-1.touchline", other, "2026-09-19T10:00:00.000Z"),
      ];
      let attempts = 0;
      accountApi.deleteActive = async (route) => {
        attempts++;
        expect(route.request().postDataJSON()).toEqual({
          careerId: "ui-account-career",
          seed: attempts === 1 ? "account-ui-fixture" : "account-ui-reloaded",
        });
        if (attempts === 1) {
          accountApi.bootstrap!.state.seed = "account-ui-reloaded";
          return route.fulfill({
            status: 409,
            json: { error: "The active career changed. Reload it before deleting.", code: "career_mismatch" },
          });
        }
        await holdSlot(accountApi, "delete_career", Promise.resolve(), () => {
          accountApi.bootstrap = null;
          accountApi.session.hasWorld = false;
          accountApi.saves = accountApi.saves.filter((slot) => slot.career?.id !== active.id);
        });
        await route.fulfill({
          json: {
            deleted: true,
            careerId: active.id,
            snapshots: 2,
            message: "Career deleted. Start a new career or load another saved career.",
          },
        });
      };
      await page.goto("/#start");
      await expect(page.getByRole("button", { name: "Continue career", exact: true })).toBeVisible();
      await page.screenshot({ path: `test-results/account-start-home-${width}.png`, fullPage: true });
      await page.getByRole("button", { name: "Delete career", exact: true }).click();
      const dialog = page.getByRole("dialog", { name: "Delete your current career?", exact: true });
      await expect(dialog).toContainText("2 saved snapshots of this career.");
      await expect(dialog).toContainText("Other saved careers stay available");
      const confirmField = dialog.getByLabel(`Type "${active.name}" to confirm`);
      const confirmButton = dialog.getByRole("button", { name: "Delete permanently", exact: true });
      await expect(confirmButton).toBeDisabled();
      await confirmField.fill("Morgan");
      await expect(confirmButton).toBeDisabled();
      await noOverflow(page);
      await confirmField.fill(active.name);
      await page.screenshot({ path: `test-results/account-delete-active-${width}.png` });
      await confirmButton.click();
      await expect(dialog.locator(".error-state")).toContainText("Your career changed since this page loaded.");
      await expect(confirmField).toHaveValue("");
      await expect(confirmButton).toBeDisabled();
      await confirmField.fill(active.name);
      await confirmButton.click();
      await expect(dialog).toHaveCount(0);
      await expect(page.getByRole("heading", { name: "No career started", exact: true })).toBeVisible();
      await expect(page.getByRole("status").filter({ hasText: "Career deleted." })).toBeVisible();
      await expect(page.getByRole("button", { name: "Continue career", exact: true })).toHaveCount(0);
      await expect(page.getByRole("button", { name: /^Load career/ })).toContainText("1 saved careers");
      await expectNoFatalScreen(page);
      await noOverflow(page);
      expect(mutations(accountApi)).toEqual(["DELETE /api/careers/active", "DELETE /api/careers/active"]);
    });

    test("a protected career refuses deletion inline without resetting the session", async ({
      page, accountApi,
    }) => {
      accountApi.bootstrap = startedBootstrap();
      accountApi.session.hasWorld = true;
      accountApi.deleteActive = (route) => route.fulfill({
        status: 409,
        json: { error: "This career is protected and can't be deleted here.", code: "career_protected" },
      });
      await page.goto("/#start");
      await page.getByRole("button", { name: "Delete career", exact: true }).click();
      const dialog = page.getByRole("dialog", { name: "Delete your current career?", exact: true });
      const confirmField = dialog.getByLabel('Type "Morgan private career" to confirm');
      await confirmField.fill("Morgan private career");
      await noOverflow(page);
      await dialog.getByRole("button", { name: "Delete permanently", exact: true }).click();
      await expect(dialog.locator(".error-state")).toContainText("This career is protected and can't be deleted here.");
      await expect(page.locator(".error-state")).toHaveCount(1);
      await expect(confirmField).toHaveValue("Morgan private career");
      await expect(busyStatus(page)).toHaveCount(0);
      await expect(page.getByRole("button", { name: "Reconnect to account", exact: true })).toHaveCount(0);
      expect(mutations(accountApi)).toEqual(["DELETE /api/careers/active"]);
    });

    test("a blank career name still requires typing the club name before deleting", async ({
      page, accountApi,
    }) => {
      accountApi.bootstrap = startedBootstrap();
      accountApi.bootstrap.state.careerName = "";
      accountApi.session.hasWorld = true;
      accountApi.deleteActive = (route) => route.fulfill({
        status: 409,
        json: { error: "This career is protected and can't be deleted here.", code: "career_protected" },
      });
      await page.goto("/#start");
      await page.getByRole("button", { name: "Delete career", exact: true }).click();
      const dialog = page.getByRole("dialog", { name: "Delete your current career?", exact: true });
      const confirmField = dialog.getByLabel('Type "Account Fixture FC" to confirm');
      const confirmButton = dialog.getByRole("button", { name: "Delete permanently", exact: true });
      await expect(dialog.getByRole("heading", { name: "Account Fixture FC", exact: true })).toBeVisible();
      await expect(confirmField).toHaveValue("");
      await expect(confirmButton).toBeDisabled();
      await confirmField.press("Enter");
      await confirmField.fill("Account Fixture");
      await expect(confirmButton).toBeDisabled();
      await confirmField.fill("account fixture fc");
      await expect(confirmButton).toBeDisabled();
      expect(mutations(accountApi)).toEqual([]);
      await confirmField.fill("Account Fixture FC");
      await expect(confirmButton).toBeEnabled();
      await noOverflow(page);
      await confirmButton.click();
      await expect(dialog.locator(".error-state")).toContainText("This career is protected and can't be deleted here.");
      expect(mutations(accountApi)).toEqual(["DELETE /api/careers/active"]);
    });

    test("an inactive saved career can still be deleted from Load career", async ({
      page, accountApi,
    }) => {
      accountApi.bootstrap = startedBootstrap();
      accountApi.session.hasWorld = true;
      const active = { id: "ui-account-career", name: "Morgan private career" };
      const other = { id: "ui-other-career", name: "Other career" };
      accountApi.saves = [
        careerSlot("active-1.touchline", active, "2026-09-20T10:00:00.000Z"),
        careerSlot("other-1.touchline", other, "2026-09-19T10:00:00.000Z"),
        careerSlot("other-2.touchline", other, "2026-09-18T10:00:00.000Z"),
      ];
      await page.goto("/#start");
      await page.getByRole("button", { name: /^Load career/ }).click();
      await expect(page.getByRole("button", { name: "Active career cannot be deleted" })).toBeDisabled();
      await page.getByRole("button", { name: "Delete career Other career", exact: true }).click();
      const dialog = page.getByRole("dialog", { name: "Delete this career?", exact: true });
      await expect(dialog).toContainText("2 saved snapshots");
      await noOverflow(page);
      await dialog.getByRole("button", { name: "Delete career", exact: true }).click();
      await expect(dialog).toHaveCount(0);
      await expect(page.locator('.career-save-item[data-career-id="ui-other-career"]')).toHaveCount(0);
      await expect(page.locator('.career-save-item[data-career-id="ui-account-career"]')).toHaveCount(1);
      await expect(page.getByRole("button", { name: "Continue career", exact: true })).toHaveCount(0);
      expect(mutations(accountApi)).toEqual(["DELETE /api/careers"]);
    });
  });
}
