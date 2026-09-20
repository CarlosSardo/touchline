import { expect, test, type Page } from "@playwright/test";

test.describe.configure({ mode: "serial" });

test.beforeAll(async ({ request }) => {
  test.setTimeout(180000);
  const health = await (await request.get("/api/health")).json();
  expect(
    health.testCareer,
    "Refusing to run destructive browser scenarios against a normal career database",
  ).toBe(true);
  const slots = await (await request.get("/api/saves")).json();
  const baseline = slots.find((slot: { file: string }) =>
    slot.file.startsWith("E2E_baseline_"),
  );
  const result = baseline
    ? await request.post("/api/saves/restore", {
        data: { file: baseline.file },
        timeout: 180000,
      })
    : await request.post("/api/saves", {
        data: { name: "E2E baseline" },
        timeout: 180000,
      });
  expect(result.status()).toBe(200);
});

async function noOverflow(page: Page) {
  const dimensions = await page.evaluate(() => ({
    width: innerWidth,
    body: document.documentElement.scrollWidth,
    errors: [...document.querySelectorAll(".error-state")].map(
      (element) => element.textContent,
    ),
  }));
  expect(dimensions.body).toBeLessThanOrEqual(dimensions.width + 1);
  expect(dimensions.errors).toEqual([]);
}

test("full local world and desktop dashboard", async ({ page, request }) => {
  const failures: string[] = [];
  const external: string[] = [];
  page.on("pageerror", (error) => failures.push(error.message));
  page.on("request", (request) => {
    if (
      request.url().startsWith("http") &&
      !["localhost", "127.0.0.1"].includes(new URL(request.url()).hostname)
    )
      external.push(request.url());
  });
  const bootstrap = await (await request.get("/api/bootstrap")).json();
  expect(bootstrap.world.countries).toBeGreaterThanOrEqual(200);
  expect(bootstrap.world.leagues).toBeGreaterThanOrEqual(1200);
  expect(bootstrap.world.clubs).toBeGreaterThanOrEqual(3500);
  expect(bootstrap.world.players).toBeGreaterThanOrEqual(160000);
  expect(bootstrap.settings.cloudSync).toBe(false);
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: "Good morning, Alex." }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "On your desk" }),
  ).toBeVisible();
  await noOverflow(page);
  await page.screenshot({
    path: "test-results/office-desktop.png",
    fullPage: true,
  });
  expect(failures).toEqual([]);
  expect(external).toEqual([]);
});

test("every workspace opens without runtime errors", async ({ page }) => {
  const failures: string[] = [];
  page.on("pageerror", (error) => failures.push(error.message));
  const views: [string, string][] = [
    ["squad", "The squad"],
    ["scouting", "Scouting centre"],
    ["transfers", "Make your move"],
    ["loans", "Development, away from home"],
    ["academy", "Academy & pathways"],
    ["training", "Development centre"],
    ["staff", "Your backroom team"],
    ["competitions", "Competitions"],
    ["analytics", "Match centre"],
    ["finances", "Club finances"],
    ["board", "The boardroom"],
    ["media", "Media & supporters"],
    ["inbox", "Inbox"],
    ["settings", "Settings"],
  ];
  for (const [route, title] of views) {
    await page.goto(`/#${route}`);
    await expect(
      page.getByRole("heading", { name: title, exact: true }),
    ).toBeVisible();
    await noOverflow(page);
  }
  expect(failures).toEqual([]);
});

test("startup waits for a local engine that is still generating the world", async ({
  page,
}) => {
  let attempts = 0;
  await page.route("**/api/bootstrap", async (route) => {
    attempts++;
    if (attempts <= 2)
      await route.fulfill({
        status: 503,
        contentType: "application/json",
        body: JSON.stringify({ error: "World generation in progress" }),
      });
    else await route.continue();
  });
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: "Good morning, Alex." }),
  ).toBeVisible();
  expect(attempts).toBeGreaterThan(2);
  await expect(page.locator(".error-state")).toHaveCount(0);
});

test("player filters and complete faceless dossier work", async ({ page }) => {
  await page.goto("/#database");
  await expect(
    page.getByRole("heading", { name: "Player database", exact: true }),
  ).toBeVisible();
  await page.getByLabel("Search players", { exact: true }).fill("Bennett");
  await expect(page.locator(".player-table tbody tr").first()).toContainText(
    "Bennett",
  );
  await page.getByLabel("Search players", { exact: true }).fill("");
  await page.getByLabel("Position filter").selectOption("ST");
  await page.getByLabel("Age filter").selectOption("20");
  await expect(page.locator(".player-table tbody tr").first()).toBeVisible();
  await expect(
    page.locator(".player-table tbody tr").first().locator("td").nth(1),
  ).toHaveText("ST");
  await page.locator(".player-table .player-name").first().click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  await expect(
    dialog.getByRole("img", { name: "Faceless player silhouette" }),
  ).toBeVisible();
  for (const name of [
    "Attributes",
    "Development",
    "Scout report",
    "Contract & value",
    "Overview",
  ]) {
    await dialog.getByRole("tab", { name, exact: true }).click();
    await expect(dialog.locator(".profile-body")).toBeVisible();
  }
  await page.screenshot({ path: "test-results/player-desktop.png" });
  await dialog.getByRole("button", { name: "Close dialog" }).click();
  await expect(dialog).not.toBeVisible();
  await noOverflow(page);
});

test("appearance settings persist light and dark themes on desktop and mobile", async ({
  page,
  request,
}) => {
  await request.patch("/api/settings", {
    data: { theme: "light", highContrast: false },
  });
  await page.goto("/");
  await page
    .getByRole("button", { name: "Open settings", exact: true })
    .click();
  const appearance = page.getByRole("radiogroup", { name: "Appearance" });
  await expect(
    appearance.getByRole("radio", { name: "Light", exact: true }),
  ).toBeChecked();
  await appearance.getByRole("radio", { name: "Dark", exact: true }).check();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await expect(page.locator("body")).toHaveCSS(
    "background-color",
    "rgb(23, 27, 29)",
  );
  await expect
    .poll(
      async () =>
        (await (await request.get("/api/bootstrap")).json()).settings.theme,
    )
    .toBe("dark");
  await page.reload();
  await expect(
    appearance.getByRole("radio", { name: "Dark", exact: true }),
  ).toBeChecked();
  const contrast = await page.evaluate(() => {
    const context = document.createElement("canvas").getContext("2d")!;
    const luminance = (color: string) => {
      context.fillStyle = color;
      context.fillRect(0, 0, 1, 1);
      const [red, green, blue] = [...context.getImageData(0, 0, 1, 1).data]
        .slice(0, 3)
        .map((value) => {
          const normalized = value / 255;
          return normalized <= 0.04045
            ? normalized / 12.92
            : ((normalized + 0.055) / 1.055) ** 2.4;
        });
      return red * 0.2126 + green * 0.7152 + blue * 0.0722;
    };
    return [
      document.body,
      document.querySelector(".theme-choice input:checked + span")!,
      document.querySelector(".continue-control")!,
    ].map((element) => {
      const style = getComputedStyle(element);
      const text = luminance(style.color);
      const background = luminance(style.backgroundColor);
      return (
        (Math.max(text, background) + 0.05) /
        (Math.min(text, background) + 0.05)
      );
    });
  });
  expect(contrast.every((ratio) => ratio >= 4.5)).toBe(true);
  await page.goto("/#office");
  await expect(
    page.getByRole("heading", { name: "Good morning, Alex." }),
  ).toBeVisible();
  await noOverflow(page);
  await page.screenshot({
    path: "test-results/theme-dark-desktop.png",
    fullPage: true,
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page
    .getByRole("button", { name: "Open settings", exact: true })
    .click();
  await expect(
    appearance.getByRole("radio", { name: "Dark", exact: true }),
  ).toBeChecked();
  await noOverflow(page);
  await page.screenshot({
    path: "test-results/theme-dark-mobile.png",
    fullPage: true,
  });
  await page.setViewportSize({ width: 320, height: 740 });
  await noOverflow(page);
  await appearance.getByRole("radio", { name: "Light", exact: true }).check();
  await expect
    .poll(
      async () =>
        (await (await request.get("/api/bootstrap")).json()).settings.theme,
    )
    .toBe("light");
  await page.reload();
  await expect(
    appearance.getByRole("radio", { name: "Light", exact: true }),
  ).toBeChecked();
  await expect(page.locator("body")).toHaveCSS(
    "background-color",
    "rgb(245, 247, 248)",
  );
});

test("appearance follows system preferences and rolls back a failed save", async ({
  page,
  request,
}) => {
  await page.goto("/#settings");
  const appearance = page.getByRole("radiogroup", { name: "Appearance" });
  await page.emulateMedia({ colorScheme: "dark" });
  await appearance.getByRole("radio", { name: "System", exact: true }).check();
  await expect
    .poll(
      async () =>
        (await (await request.get("/api/bootstrap")).json()).settings.theme,
    )
    .toBe("system");
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await page.emulateMedia({ colorScheme: "light" });
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  await page.route("**/api/settings", (route) =>
    route.fulfill({
      status: 503,
      contentType: "application/json",
      body: JSON.stringify({ error: "Settings could not be saved." }),
    }),
  );
  await appearance.getByRole("radio", { name: "Dark", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText(
    "Settings could not be saved.",
  );
  await expect(
    appearance.getByRole("radio", { name: "System", exact: true }),
  ).toBeChecked();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  await page.unroute("**/api/settings");
  await appearance.getByRole("radio", { name: "Light", exact: true }).check();
  await expect
    .poll(
      async () =>
        (await (await request.get("/api/bootstrap")).json()).settings.theme,
    )
    .toBe("light");
});

test("mobile navigation, settings, accessibility and dossier fit", async ({
  page,
  request,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await expect(
    page.getByRole("navigation", { name: "Mobile navigation" }),
  ).toBeVisible();
  await noOverflow(page);
  await page.screenshot({
    path: "test-results/office-mobile.png",
    fullPage: true,
  });
  await page
    .getByRole("navigation", { name: "Mobile navigation" })
    .getByRole("button", { name: "More" })
    .click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Settings", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Settings", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("radiogroup", { name: "Appearance" })
    .getByRole("radio", { name: "Dark", exact: true })
    .check();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await page
    .getByRole("navigation", { name: "Settings categories" })
    .getByRole("button", { name: "Accessibility" })
    .click();
  await page.getByLabel("High contrast", { exact: true }).click();
  await expect(page.locator("html")).toHaveAttribute("data-contrast", "high");
  await page.screenshot({
    path: "test-results/settings-mobile-dark.png",
    fullPage: true,
  });
  await noOverflow(page);
  await request.patch("/api/settings", {
    data: { theme: "light", highContrast: false },
  });
  await page.goto("/#database");
  await page.locator(".player-table .player-name").first().click();
  await expect(page.getByRole("dialog")).toBeVisible();
  const widths = await page.getByRole("dialog").evaluate((dialog) => ({
    width: dialog.clientWidth,
    content: dialog.scrollWidth,
  }));
  expect(widths.content).toBeLessThanOrEqual(widths.width + 1);
  await page.screenshot({ path: "test-results/player-mobile.png" });
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Close dialog" })
    .click();
});

test("scouting assignment is actionable", async ({ page, request }) => {
  const scouting = await (await request.get("/api/scouting")).json();
  if (
    scouting.assignments.some(
      (assignment: { status: string }) => assignment.status === "active",
    )
  )
    return;
  await page.goto("/#scouting");
  await page.getByRole("button", { name: "New assignment" }).click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Send scout" })
    .click();
  await expect(page.getByRole("dialog")).not.toBeVisible();
  await page.getByRole("tab", { name: /Assignments/ }).click();
  await expect(page.locator(".data-table tbody")).toContainText("Active");
});

test("a real transfer completes through enquiry, club, agent and medical stages", async ({
  page,
  request,
}) => {
  const bootstrap = await (await request.get("/api/bootstrap")).json();
  const search = await (
    await request.get(
      "/api/players?ageMin=20&ageMax=25&abilityMin=62&abilityMax=68&country=1&valueMax=12000000&pageSize=100",
    )
  ).json();
  const target = search.players.find(
    (player: { club_id: number; parent_club_id: number | null }) =>
      player.club_id !== bootstrap.club.id && !player.parent_club_id,
  );
  expect(target).toBeTruthy();
  const enquiry = await request.post("/api/action", {
    data: {
      type: "enquiry",
      playerId: target.id,
      dealType: "Permanent transfer",
    },
  });
  expect(enquiry.status()).toBe(200);
  const negotiation = await enquiry.json();
  await page.goto("/#transfers");
  const card = page.locator(".entity-card").filter({
    has: page.getByRole("heading", { name: target.name, exact: true }),
  });
  await card.getByRole("button", { name: "Open negotiations" }).click();
  const dialog = page.getByRole("dialog");
  await dialog
    .getByLabel("Proposed transfer fee")
    .fill(String(Math.round(negotiation.asking_price)));
  await dialog
    .getByLabel("Proposed weekly wage")
    .fill(String(Math.round(target.wage * 2)));
  await dialog.getByRole("button", { name: "Submit club offer" }).click();
  await expect(
    dialog.getByRole("button", { name: "Submit personal terms" }),
  ).toBeVisible();
  await dialog.getByRole("button", { name: "Submit personal terms" }).click();
  await expect(dialog).not.toBeVisible();
  const result = await request.post("/api/advance", {
    data: { days: 2 },
    timeout: 180000,
  });
  expect(result.status()).toBe(200);
  const player = await (await request.get(`/api/players/${target.id}`)).json();
  expect(player.player.club_id).toBe(bootstrap.club.id);
  const after = await (await request.get("/api/bootstrap")).json();
  expect(after.club.transfer_budget).toBeLessThan(
    bootstrap.club.transfer_budget,
  );
});

test("an outgoing loan honors its terms and can be recalled", async ({
  page,
  request,
}) => {
  const bootstrap = await (await request.get("/api/bootstrap")).json();
  const roster = await (
    await request.get(
      `/api/players?club=${bootstrap.club.id}&ageMin=19&ageMax=25&ageGroup=Senior&pageSize=100&sort=value&direction=asc`,
    )
  ).json();
  const target = roster.players.find(
    (player: { contract_end: string; parent_club_id: number | null }) =>
      !player.parent_club_id && player.contract_end >= "2028-06-30",
  );
  expect(target).toBeTruthy();
  const enquiry = await request.post("/api/action", {
    data: {
      type: "enquiry",
      playerId: target.id,
      dealType: "Development loan",
      destinationId: 2,
    },
  });
  expect(enquiry.status()).toBe(200);
  const negotiation = await enquiry.json();
  await page.goto("/#transfers");
  const card = page.locator(".entity-card").filter({
    has: page.getByRole("heading", { name: target.name, exact: true }),
  });
  await card.getByRole("button", { name: "Open negotiations" }).click();
  const dialog = page.getByRole("dialog");
  await dialog
    .getByLabel("Proposed transfer fee")
    .fill(String(Math.round(negotiation.asking_price)));
  await dialog
    .getByRole("slider", { name: /Borrowing club salary share/ })
    .focus();
  await dialog
    .getByRole("slider", { name: /Borrowing club salary share/ })
    .press("ArrowLeft");
  await dialog.getByRole("button", { name: "Submit club offer" }).click();
  await dialog.getByRole("button", { name: "Submit personal terms" }).click();
  await expect(dialog).not.toBeVisible();
  expect(
    (
      await request.post("/api/advance", { data: { days: 2 }, timeout: 180000 })
    ).status(),
  ).toBe(200);
  const desk = await (await request.get("/api/loans")).json();
  const loan = desk.loans.find(
    (item: { player_id: number }) => item.player_id === target.id,
  );
  expect(loan.status).toBe("active");
  expect(JSON.parse(loan.terms).salarySplit).toBe(69);
  await page.goto("/#loans");
  await page
    .locator("tbody tr")
    .filter({ hasText: target.name })
    .getByRole("button", { name: "Review" })
    .click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Recall player", exact: true })
    .click();
  await page
    .getByRole("dialog")
    .last()
    .getByRole("button", { name: "Confirm", exact: true })
    .click();
  await expect(page.getByRole("dialog")).not.toBeVisible();
  const returned = await (
    await request.get(`/api/players/${target.id}`)
  ).json();
  expect(returned.player.club_id).toBe(bootstrap.club.id);
  expect(returned.player.parent_club_id).toBeNull();
});

test("advancing the full world produces coherent match analysis and all eight nonblank maps", async ({
  page,
  request,
}) => {
  await request.patch("/api/settings", { data: { autosave: "off" } });
  const state = await (await request.get("/api/bootstrap")).json();
  const start = new Date(state.state.date).getTime();
  const target = new Date("2026-07-12").getTime();
  const days = Math.max(0, Math.ceil((target - start) / 86400000));
  if (days) {
    await page.goto("/");
    const response = await request.post("/api/advance", {
      data: { days: Math.min(28, days) },
      timeout: 180000,
    });
    expect(response.status()).toBe(200);
    const result = await response.json();
    expect(result.matches).toBeGreaterThan(1000);
  }
  await page.goto("/#analytics");
  await expect(page.getByLabel("Pitch map type")).toBeVisible({
    timeout: 30000,
  });
  const signatures: number[] = [];
  for (const mode of [
    "Pass map",
    "Carry map",
    "Dribble map",
    "Shot map",
    "Defensive map",
    "Heatmap",
    "Pressing zones",
    "Fatigue map",
  ]) {
    await page.getByLabel("Pitch map type").selectOption(mode);
    const signature = await page
      .locator("canvas.pitch-canvas")
      .evaluate((canvas: HTMLCanvasElement) => {
        const context = canvas.getContext("2d")!;
        const pixels = context.getImageData(
          0,
          0,
          canvas.width,
          canvas.height,
        ).data;
        let sum = 0;
        let distinct = 0;
        for (let index = 0; index < pixels.length; index += 40) {
          sum += pixels[index] + pixels[index + 1] * 3 + pixels[index + 2] * 7;
          if (pixels[index] > 80) distinct++;
        }
        return { sum, distinct, width: canvas.width, height: canvas.height };
      });
    expect(signature.width).toBeGreaterThan(200);
    expect(signature.height).toBeGreaterThan(100);
    expect(signature.distinct).toBeGreaterThan(100);
    signatures.push(signature.sum);
  }
  expect(new Set(signatures).size).toBe(8);
  await page.getByLabel("Pitch map type").selectOption("Shot map");
  await page.screenshot({
    path: "test-results/match-desktop.png",
    fullPage: true,
  });
  await page.getByRole("tab", { name: "Match statistics" }).click();
  await expect(page.locator(".match-stats-grid")).toContainText("xG prevented");
  await page.getByRole("tab", { name: "Player performance" }).click();
  await expect(page.locator(".data-table tbody tr")).toHaveCount(22);
  await page.getByRole("tab", { name: "Pitch analysis" }).click();
  await page.setViewportSize({ width: 390, height: 844 });
  await noOverflow(page);
  await page.screenshot({
    path: "test-results/match-mobile.png",
    fullPage: true,
  });
  expect((await request.get("/api/health")).status()).toBe(200);
});
