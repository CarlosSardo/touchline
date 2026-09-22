import { expect, test as base, type Page, type Route } from "@playwright/test";
import type { AccountSession, Bootstrap, WorldClubPage } from "../shared/api.ts";
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
  requests: string[];
  prepare?: (route: Route) => Promise<void>;
  bootstrapGate?: Promise<void>;
}

const test = base.extend<{ accountApi: AccountApi }>({
  accountApi: async ({ page }, runAccountApi) => {
    const unexpected: string[] = [];
    const accountApi: AccountApi = {
      session: { user: { ...accountUser }, hasWorld: false },
      bootstrap: null,
      requests: [],
    };
    await page.route("**/api/**", async (route) => {
      const request = route.request();
      const key = `${request.method()} ${new URL(request.url()).pathname}`;
      accountApi.requests.push(key);
      switch (key) {
        case "GET /api/me":
          return route.fulfill({ json: accountApi.session });
        case "GET /api/bootstrap": {
          const bootstrap = accountApi.bootstrap;
          await accountApi.bootstrapGate;
          return route.fulfill({ json: bootstrap });
        }
        case "GET /api/saves":
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
      }
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
    await preparation.promise;
    accountApi.bootstrap = preparedBootstrap();
    accountApi.session.hasWorld = true;
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
      accountApi.session = { user: { ...accountUser }, hasWorld: true };
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
      accountApi.session = { user: { ...nextUser }, hasWorld: false };
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