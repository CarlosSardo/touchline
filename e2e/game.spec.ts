import {
  expect,
  test,
  type APIRequestContext,
  type APIResponse,
  type Locator,
  type Page,
} from "@playwright/test";
import type { AcademyData, Bootstrap, PlayerPage, SquadData } from "../shared/api.ts";
import {
  POSITIONS,
  compactNumber,
  currencyCode,
  adultTransferArrival,
  displayAmount,
  DEFAULT_ASSISTANT_DUTIES,
  money,
} from "../shared/rules.ts";
import { sortPlayers } from "../src/sort.ts";
import { savesReplacedByManualSave, type ListedSave } from "../src/save-rotation.ts";

test.describe.configure({ mode: "serial" });

test.beforeAll(async ({ request }) => {
  const response = await request.get("/api/health/details");
  expect(response.status()).toBe(200);
  const health = await response.json();
  expect(
    health.testCareer,
    "Refusing to run destructive browser scenarios against a normal career database",
  ).toBe(true);
  expect(health.schema).toMatch(/^touchline_e2e_[a-f0-9]{32}$/);
  expect(health.schema).toBe(process.env.TOUCHLINE_E2E_SCHEMA);
  expect(health.databaseName).toBe(process.env.SQL_DATABASE ?? "touchline");
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

async function retryBusyResponse(operation: () => Promise<APIResponse>) {
  const deadline = Date.now() + 30_000;
  let response = await operation();
  while (response.status() === 409 && Date.now() < deadline) {
    await new Promise((resolve) =>
      setTimeout(resolve, Math.min(250, deadline - Date.now())),
    );
    if (Date.now() >= deadline) break;
    response = await operation();
  }
  expect(response.status(), await response.text()).toBe(200);
  return response;
}

// The UI saves optimistically, so a read right after a click can land inside that save and get 409 world_busy.
async function bootstrapOf(request: APIRequestContext) {
  return (await retryBusyResponse(() => request.get("/api/bootstrap"))).json();
}

test("association rules expose the catalog coverage of every seeded association", async ({
  page,
  request,
}) => {
  const audit = await (await request.get("/api/world/audit")).json();
  await page.goto("/#world");
  await page.locator(".association-audit > summary").click();
  const rules = page.locator(".association-audit-table tbody tr");
  await expect(rules).toHaveCount(audit.countries.length);
  // World v4: every catalog association is documented; only the reserve model differs.
  await expect(rules.filter({ hasText: "Documented" })).toHaveCount(
    audit.countries.length,
  );
  for (const [code, mode] of [
    ["DE", "Senior pyramid"],
    ["LU", "No reserve teams"],
  ]) {
    const association = audit.countries.find(
      (entry: { code: string }) => entry.code === code,
    );
    await page
      .getByRole("combobox", { name: "World country", exact: true })
      .selectOption(String(association.id));
    await expect(rules).toHaveCount(1);
    await expect(rules).toContainText(mode);
    await expect(rules).toContainText(association.reservePolicy.summary);
    const source = rules.getByRole("link", {
      name: "Reference source",
      exact: true,
    });
    if (association.reservePolicy.source)
      await expect(source).toHaveAttribute(
        "href",
        association.reservePolicy.source,
      );
    else await expect(source).toHaveCount(0);
  }
  await rules.getByText("Regulatory limits", { exact: true }).click();
  await expect(rules).toContainText("not a complete federation rulebook");
  await page.setViewportSize({ width: 320, height: 844 });
  await noOverflow(page);
  await page.screenshot({
    path: "test-results/association-audit-mobile.png",
    fullPage: true,
  });
});

test("competition favorites and notification preferences persist with an accessible muted archive", async ({
  page,
  request,
}) => {
  const before = await (await request.get("/api/bootstrap")).json();
  const favorites = await (
    await request.get("/api/competitions/favorites")
  ).json();
  const previousFavorite = favorites.find(
    (entry: { leagueId: number }) => entry.leagueId === before.club.league_id,
  );
  try {
    expect(
      (
        await request.put(
          `/api/competitions/${before.club.league_id}/favorite`,
          { data: { active: false } },
        )
      ).ok(),
    ).toBe(true);
    await page.goto("/#competitions");
    await page
      .getByRole("button", {
        name: "Add competition to favorites",
        exact: true,
      })
      .click();
    await expect(
      page.getByRole("button", {
        name: "Remove competition from favorites",
        exact: true,
      }),
    ).toHaveAttribute("aria-pressed", "true");
    await page.getByText("Competition alerts", { exact: true }).click();
    await page
      .getByRole("checkbox", { name: "Fixtures alerts", exact: true })
      .uncheck();
    await expect(
      page.getByRole("checkbox", { name: "Tables alerts", exact: true }),
    ).toBeEnabled();
    await page
      .getByRole("checkbox", { name: "Tables alerts", exact: true })
      .check();
    await expect(
      page.getByRole("checkbox", { name: "Tables alerts", exact: true }),
    ).toBeEnabled();
    await expect
      .poll(async () => {
        const response = await request.get("/api/competitions/favorites");
        if (response.status() === 409) return null;
        expect(response.ok()).toBe(true);
        const saved = await response.json();
        return saved.find(
          (entry: { leagueId: number }) =>
            entry.leagueId === before.club.league_id,
        )?.events;
      })
      .toMatchObject({ fixtures: false, results: true, tables: true });
    await page.reload();
    await page.getByText("Competition alerts", { exact: true }).click();
    await expect(
      page.getByRole("checkbox", { name: "Fixtures alerts", exact: true }),
    ).not.toBeChecked();
    await expect(
      page.getByRole("checkbox", { name: "Tables alerts", exact: true }),
    ).toBeChecked();
    await page
      .getByRole("checkbox", { name: "Favorites only", exact: true })
      .check();
    await expect(page.locator(".competition-index-entry")).toHaveCount(
      favorites.length + (previousFavorite ? 0 : 1),
    );
    await page.screenshot({
      path: "test-results/competition-favorites-desktop.png",
      fullPage: true,
    });
    for (const width of [390, 320]) {
      await page.setViewportSize({ width, height: 844 });
      await noOverflow(page);
      const clubCell = await page
        .locator(".competition-browser .standings-table tbody tr")
        .first()
        .locator("td")
        .nth(1)
        .boundingBox();
      expect(clubCell?.width).toBeGreaterThanOrEqual(200);
      expect(clubCell?.height).toBeLessThan(110);
    }
    await page.screenshot({
      path: "test-results/competition-favorites-mobile.png",
      fullPage: true,
    });

    expect(
      (
        await request.patch("/api/settings", {
          data: { notifyClub: true, notificationImportance: "all" },
        })
      ).ok(),
    ).toBe(true);
    const archive = await (await request.get("/api/news?archive=1")).json();
    const clubCategory = archive.find((item: { category: string }) =>
      ["Board", "Staff", "Club", "Director", "Events"].includes(item.category),
    )?.category;
    expect(clubCategory).toBeTruthy();
    const clubNews = await (
      await request.get(`/api/news?category=${clubCategory}&archive=1`)
    ).json();
    expect(clubNews.length).toBeGreaterThan(0);
    await page.goto("/#settings");
    await page.reload();
    await page
      .getByRole("button", { name: "Notifications", exact: true })
      .click();
    await page
      .getByRole("switch", { name: "Board, staff and club", exact: true })
      .click();
    await expect
      .poll(async () => {
        const response = await request.get("/api/bootstrap");
        if (response.status() === 409) return undefined;
        expect(response.ok()).toBe(true);
        return (await response.json()).settings.notifyClub;
      })
      .toBe(false);
    await page.goto("/#inbox");
    await page
      .getByRole("combobox", { name: "Inbox category", exact: true })
      .selectOption(clubCategory);
    await expect(
      page.getByRole("heading", {
        name: "Nothing in this folder",
        exact: true,
      }),
    ).toBeVisible();
    await page
      .getByRole("checkbox", { name: "Include muted archive", exact: true })
      .check();
    await expect(page.locator(".inbox-list > button")).toHaveCount(
      clubNews.length,
    );
    await page
      .getByRole("combobox", { name: "Inbox read status", exact: true })
      .selectOption("unread");
    await expect(page.locator(".inbox-list > button")).toHaveCount(
      clubNews.filter((item: { read: number }) => !item.read).length,
    );
    await noOverflow(page);
    await page.screenshot({
      path: "test-results/inbox-filters-mobile.png",
      fullPage: true,
    });
    await page.setViewportSize({ width: 1440, height: 1000 });
    await noOverflow(page);
    await page.screenshot({
      path: "test-results/inbox-filters-desktop.png",
      fullPage: true,
    });
  } finally {
    expect(
      (
        await request.patch("/api/settings", {
          data: {
            notifyClub: before.settings.notifyClub ?? true,
            notificationImportance:
              before.settings.notificationImportance ?? "all",
          },
        })
      ).ok(),
    ).toBe(true);
    expect(
      (
        await request.put(
          `/api/competitions/${before.club.league_id}/favorite`,
          {
            data: previousFavorite
              ? { active: true, events: previousFavorite.events }
              : { active: false },
          },
        )
      ).ok(),
    ).toBe(true);
  }
});

test("eligible players can move between age squads and the first team without changing their contract", async ({
  page,
  request,
}) => {
  const checkpointTimeout = 900_000;
  test.setTimeout(checkpointTimeout * 2 + 180_000);
  page.setDefaultTimeout(15000);
  const checkpoint = await (
    await request.post("/api/saves", {
      data: { name: "Squad assignment checkpoint" },
      timeout: checkpointTimeout,
    })
  ).json();
  let primaryError: unknown;
  try {
    const before = await (await request.get("/api/bootstrap")).json();
    const squad = await (await request.get("/api/squad?ageGroup=U17")).json();
    const player = squad.players.find(
      (candidate: { id: number; name: string; birth_date: string }) =>
        candidate.birth_date >= `${before.state.season - 16}-01-01` &&
        squad.players.filter(
          (other: { name: string }) => other.name === candidate.name,
        ).length === 1,
    );
    expect(player).toBeTruthy();
    await page.goto("/#squad");
    await page
      .getByRole("combobox", { name: "Squad age group", exact: true })
      .selectOption("U17");
    const playerButton = page
      .getByRole("button")
      .filter({ has: page.getByText(player.name, { exact: true }) });
    await expect(playerButton).toBeVisible();
    await playerButton.click();
    const dossier = page.getByRole("dialog");
    await expect(
      dossier.getByRole("heading", { name: "Squad assignment", exact: true }),
    ).toBeVisible();
    for (const ageGroup of ["U19", "Senior", "U17"]) {
      await dossier
        .getByRole("combobox", { name: "Playing squad", exact: true })
        .selectOption(`${before.club.id}:${ageGroup}`);
      const [movement] = await Promise.all([
        page.waitForResponse((response) => {
          if (
            new URL(response.url()).pathname !== "/api/action" ||
            response.request().method() !== "POST"
          ) return false;
          const action = response.request().postDataJSON();
          return action.type === "squad-move" &&
            action.playerId === player.id &&
            action.clubId === before.club.id &&
            action.ageGroup === ageGroup;
        }),
        dossier.getByRole("button", { name: "Move player", exact: true }).click(),
      ]);
      expect(movement.status(), await movement.text()).toBe(200);
      let current = player;
      await expect
        .poll(async () => {
          const response = await request.get(`/api/players/${player.id}`);
          if (response.status() === 409) return undefined;
          expect(response.status(), await response.text()).toBe(200);
          current = (await response.json()).player;
          return current.age_group;
        })
        .toBe(ageGroup);
      await expect(
        dossier.getByRole("button", { name: "Move player", exact: true }),
      ).toBeDisabled();
      expect(current.club_id).toBe(player.club_id);
      expect(current.wage).toBe(player.wage);
      expect(current.contract_end).toBe(player.contract_end);
    }
    const after = await (
      await retryBusyResponse(() => request.get("/api/bootstrap"))
    ).json();
    expect(after.club.balance).toBe(before.club.balance);
    expect(after.state.date).toBe(before.state.date);
    await page.screenshot({
      path: "test-results/squad-assignment-desktop.png",
    });
    await page.setViewportSize({ width: 390, height: 844 });
    await noOverflow(page);
    await page.screenshot({ path: "test-results/squad-assignment-mobile.png" });
    await dossier
      .getByRole("button", { name: "Close dialog", exact: true })
      .click();
    await page.reload();
    await page
      .getByRole("combobox", { name: "Squad age group", exact: true })
      .selectOption("U17");
    await expect(playerButton).toBeVisible();
  } catch (error) {
    primaryError = error;
  } finally {
    try {
      await retryBusyResponse(() =>
        request.post("/api/saves/restore", {
          data: { file: checkpoint.file },
          timeout: checkpointTimeout,
        }),
      );
    } catch (cleanupError) {
      if (primaryError !== undefined) {
        primaryError = new AggregateError(
          [primaryError, cleanupError],
          "Squad assignment failed and checkpoint restoration also failed",
        );
      } else {
        primaryError = cleanupError;
      }
    }
  }
  if (primaryError !== undefined) throw primaryError;
});

test("future transfer agreements keep young players at their clubs and reserve money until adulthood", async ({
  page,
  request,
}) => {
  const checkpoint = await (
    await request.post("/api/saves", {
      data: { name: "Future arrivals checkpoint" },
      timeout: 180000,
    })
  ).json();
  try {
    const before = await (await request.get("/api/bootstrap")).json();
    const country = before.countries.find(
      (entry: { code: string }) => entry.code === "DE",
    );
    const players = await (
      await request.get(
        `/api/players?ageMin=14&ageMax=15&country=${country.id}&sort=value&direction=asc&pageSize=100`,
      )
    ).json();
    let chosenPlayer: PlayerPage["players"][number] | undefined;
    for (const candidate of players.players) {
      if (
        !candidate.club_id ||
        candidate.club_id === before.club.id ||
        candidate.parent_club_id
      )
        continue;
      const details = await (
        await request.get(`/api/players/${candidate.id}`)
      ).json();
      if (
        details.youthTransfer.international &&
        !details.youthTransfer.eligibleToApply
      ) {
        chosenPlayer = candidate;
        break;
      }
    }
    expect(chosenPlayer).toBeTruthy();
    const target = chosenPlayer!;
    await page.goto(`/#offer/${target.id}`);
    const begin = page.getByRole("button", {
      name: "Continue to negotiation",
      exact: true,
    });
    await expect(begin).toBeDisabled();
    await page
      .getByRole("combobox", { name: "Offer type", exact: true })
      .selectOption("future");
    await expect(begin).toBeDisabled();
    await page
      .getByRole("checkbox", {
        name: "Guardian consent for the conditional future agreement",
        exact: true,
      })
      .check();
    await begin.click();
    await expect(
      page.getByRole("button", { name: "Submit club offer", exact: true }),
    ).toBeVisible();
    const desk = await (await request.get("/api/transfers")).json();
    const deal = desk.negotiations.find(
      (entry: { player_id: number; stage: string }) =>
        entry.player_id === target.id && entry.stage === "Club talks",
    );
    expect(deal.type).toBe("Future transfer");
    await page
      .getByLabel("Proposed transfer fee")
      .fill(
        String(
          displayAmount(
            deal.asking_price,
            currencyCode(before.settings.currency),
          ),
        ),
      );
    await page
      .getByRole("button", { name: "Submit club offer", exact: true })
      .click();
    await expect(page).toHaveURL(new RegExp(`#contract/${target.id}$`));
    await page
      .getByLabel("Proposed weekly wage")
      .fill(
        String(
          displayAmount(deal.wage * 2, currencyCode(before.settings.currency)),
        ),
      );
    await page
      .getByRole("button", { name: "Submit personal terms", exact: true })
      .click();
    await page
      .getByRole("button", { name: "Sign conditional agreement", exact: true })
      .click();
    await expect(page.locator(".negotiation-sheet-top .badge")).toHaveText(
      "Scheduled",
    );
    const scheduled = (
      await (await request.get("/api/transfers")).json()
    ).negotiations.find((entry: { id: number }) => entry.id === deal.id);
    const details = JSON.parse(scheduled.data);
    expect(details.futureArrivalDate).toBe(
      adultTransferArrival(target.birth_date),
    );
    const after = await (await request.get("/api/bootstrap")).json();
    expect(after.club.balance).toBe(before.club.balance);
    expect(after.club.transfer_budget).toBeCloseTo(
      before.club.transfer_budget - details.reservedBudget,
      2,
    );
    const player = (
      await (await request.get(`/api/players/${target.id}`)).json()
    ).player;
    expect(player.club_id).toBe(target.club_id);
    expect(player.wage).toBe(target.wage);
    await page.reload();
    await expect(page.locator(".negotiation-sheet-top .badge")).toHaveText(
      "Scheduled",
    );
    await page.screenshot({
      path: "test-results/future-transfer-desktop.png",
      fullPage: true,
    });
    await page.setViewportSize({ width: 390, height: 844 });
    await noOverflow(page);
    await page.screenshot({
      path: "test-results/future-transfer-mobile.png",
      fullPage: true,
    });
    await page
      .getByRole("button", { name: "Cancel future agreement", exact: true })
      .click();
    await page
      .getByRole("dialog")
      .getByRole("button", { name: "Confirm", exact: true })
      .click();
    await expect(
      page.getByRole("heading", { name: "Make your move", exact: true }),
    ).toBeVisible();
    expect((await bootstrapOf(request)).club.transfer_budget).toBeCloseTo(
      before.club.transfer_budget,
      2,
    );
  } finally {
    expect(
      (
        await request.post("/api/saves/restore", {
          data: { file: checkpoint.file },
          timeout: 180000,
        })
      ).status(),
    ).toBe(200);
  }
});

test("the other club evaluates the chosen affiliation type before the agreement is approved", async ({
  page,
  request,
}) => {
  const checkpoint = await (
    await request.post("/api/saves", {
      data: { name: "Mutual affiliate checkpoint" },
      timeout: 180000,
    })
  ).json();
  try {
    const before = await (await request.get("/api/bootstrap")).json();
    const network = await (await request.get("/api/affiliates")).json();
    const clubs = await (
      await request.get(
        `/api/world/clubs?type=club&country=${before.club.country_id}&tier=2&pageSize=100`,
      )
    ).json();
    const partner = clubs.clubs.find(
      (club: { id: number }) =>
        !network.affiliates.some(
          (entry: { partner_id: number }) => entry.partner_id === club.id,
        ),
    );
    expect(partner).toBeTruthy();
    await page.goto("/#board");
    await page
      .getByRole("button", { name: "Request affiliate", exact: true })
      .click();
    const dialog = page.getByRole("dialog", {
      name: "Request an affiliate club",
    });
    await dialog
      .getByRole("combobox", { name: "Affiliation type", exact: true })
      .selectOption("Foreign adaptation club");
    await dialog
      .getByRole("checkbox", { name: "Propose a specific club", exact: true })
      .check();
    await dialog
      .getByRole("textbox", { name: "Find affiliate club", exact: true })
      .fill(partner.name);
    await dialog
      .getByRole("combobox", { name: "Preferred affiliate", exact: true })
      .selectOption(String(partner.id));
    const interest = dialog.getByRole("region", {
      name: "Other club's interest",
    });
    await expect(interest).toContainText("Would decline this affiliation");
    await dialog
      .getByRole("combobox", { name: "Affiliation type", exact: true })
      .selectOption("Development club");
    await expect(interest).toContainText("Open to this affiliation");
    await page.screenshot({
      path: "test-results/affiliate-consent-desktop.png",
    });
    await page.setViewportSize({ width: 390, height: 844 });
    await noOverflow(page);
    await page.screenshot({
      path: "test-results/affiliate-consent-mobile.png",
    });
    await dialog
      .getByRole("button", { name: "Submit board request", exact: true })
      .click();
    await expect(dialog).not.toBeVisible();
    expect((await bootstrapOf(request)).club.balance).toBe(before.club.balance);
    expect(
      (
        await request.post("/api/advance", {
          data: { days: 3 },
          timeout: 180000,
        })
      ).status(),
    ).toBe(200);
    const after = await (await request.get("/api/affiliates")).json();
    expect(after.requests[0].status).toBe("approved");
    const agreement = after.affiliates.find(
      (entry: { partner_id: number }) => entry.partner_id === partner.id,
    );
    expect(agreement.type).toBe("Development club");
    expect(JSON.parse(agreement.data).mutualConsent.clubId).toBe(partner.id);
  } finally {
    expect(
      (
        await request.post("/api/saves/restore", {
          data: { file: checkpoint.file },
          timeout: 180000,
        })
      ).status(),
    ).toBe(200);
  }
});

test("appearance settings persist the minimal and classic UI themes", async ({
  page,
  request,
}) => {
  const before = await (await request.get("/api/bootstrap")).json();
  try {
    await page.goto("/#settings");
    const layout = page.getByRole("radiogroup", {
      name: "UI theme",
      exact: true,
    });
    await layout.getByRole("radio", { name: "Classic", exact: true }).check();
    await expect(page.locator("html")).toHaveAttribute(
      "data-ui-theme",
      "classic",
    );
    await expect
      .poll(
        async () =>
          (await bootstrapOf(request)).settings.uiTheme,
      )
      .toBe("classic");
    await page.reload();
    await expect(
      layout.getByRole("radio", { name: "Classic", exact: true }),
    ).toBeChecked();
    await layout.getByRole("radio", { name: "Minimal", exact: true }).check();
    await expect(page.locator("html")).toHaveAttribute(
      "data-ui-theme",
      "minimal",
    );
    await expect
      .poll(
        async () =>
          (await bootstrapOf(request)).settings.uiTheme,
      )
      .toBe("minimal");
    await noOverflow(page);
    await page.screenshot({
      path: "test-results/minimal-appearance-desktop.png",
      fullPage: true,
    });
    await page.setViewportSize({ width: 390, height: 844 });
    await noOverflow(page);
    await page.screenshot({
      path: "test-results/minimal-appearance-mobile.png",
      fullPage: true,
    });
  } finally {
    await request.patch("/api/settings", {
      data: { uiTheme: before.settings.uiTheme ?? "minimal" },
    });
  }
});

test("assistant duties persist and delegated work stays within the allowance", async ({
  page,
  request,
}) => {
  const checkpoint = await (
    await request.post("/api/saves", {
      data: { name: "Assistant workflow checkpoint" },
      timeout: 180000,
    })
  ).json();
  try {
    const before = await (await request.get("/api/assistant")).json();
    expect(before.assistant.role).toBe("Sporting director assistant");
    const count = (await (await request.get("/api/staff")).json()).staff.filter(
      (staff: { role: string }) => staff.role === "Sporting director assistant",
    ).length;
    expect(count).toBe(1);
    await page.goto("/#staff");
    await page
      .getByRole("tab", { name: "Director assistant", exact: true })
      .click();
    await expect(page.locator(".assistant-heading")).toContainText(
      before.assistant.name,
    );
    await page
      .getByRole("switch", {
        name: "Delegate recruitment shortlist",
        exact: true,
      })
      .click();
    await page
      .getByRole("switch", {
        name: "Delegate individual development",
        exact: true,
      })
      .click();
    await page
      .getByRole("switch", {
        name: "Delegate scouting assignments",
        exact: true,
      })
      .click();
    await page
      .getByRole("spinbutton", {
        name: "Assistant weekly scouting allowance",
        exact: true,
      })
      .fill("0");
    await page
      .getByRole("button", { name: "Save responsibilities", exact: true })
      .click();
    await expect(
      page.getByRole("button", { name: "Save responsibilities", exact: true }),
    ).toBeDisabled();
    await page.reload();
    await page
      .getByRole("tab", { name: "Director assistant", exact: true })
      .click();
    await expect(
      page.getByRole("switch", {
        name: "Delegate recruitment shortlist",
        exact: true,
      }),
    ).toHaveAttribute("aria-checked", "true");
    await expect(
      page.getByRole("spinbutton", {
        name: "Assistant weekly scouting allowance",
        exact: true,
      }),
    ).toHaveValue("0");
    await page
      .getByRole("button", { name: "Request assistant review", exact: true })
      .click();
    await expect(page.locator(".assistant-report").first()).toContainText(
      "0 spent",
    );
    const after = await (await request.get("/api/assistant")).json();
    expect(after.spentLastWeek).toBe(0);
    expect(
      after.reports[0].actions.some(
        (action: { duty: string }) => action.duty === "training",
      ),
    ).toBe(true);
    expect(
      after.reports[0].actions.some(
        (action: { duty: string }) => action.duty === "shortlist",
      ),
    ).toBe(true);
    await expect(
      page.getByRole("button", {
        name: "Request assistant review",
        exact: true,
      }),
    ).toBeDisabled();
    await noOverflow(page);
    await page.screenshot({
      path: "test-results/assistant-desktop.png",
      fullPage: true,
    });
    await page.setViewportSize({ width: 390, height: 844 });
    await noOverflow(page);
    await page.screenshot({
      path: "test-results/assistant-mobile.png",
      fullPage: true,
    });
    expect(
      (
        await request.post("/api/action", {
          data: {
            type: "assistant-duties",
            duties: DEFAULT_ASSISTANT_DUTIES,
            weeklyBudget: 5000,
          },
        })
      ).status(),
    ).toBe(200);
  } finally {
    expect(
      (
        await request.post("/api/saves/restore", {
          data: { file: checkpoint.file },
          timeout: 180000,
        })
      ).status(),
    ).toBe(200);
  }
});

test("every club has affiliates and the board reviews a new network request", async ({
  page,
  request,
}) => {
  const checkpoint = await (
    await request.post("/api/saves", {
      data: { name: "Affiliate workflow checkpoint" },
      timeout: 180000,
    })
  ).json();
  try {
    const before = await (await request.get("/api/affiliates")).json();
    expect(before.affiliates.length).toBeGreaterThanOrEqual(1);
    await page.goto("/#board");
    await expect(page.locator(".affiliate-table tbody tr")).toHaveCount(
      before.affiliates.length,
    );
    await page
      .getByRole("button", { name: "Request affiliate", exact: true })
      .click();
    const dialog = page.getByRole("dialog", {
      name: "Request an affiliate club",
      exact: true,
    });
    await dialog
      .getByRole("combobox", { name: "Affiliation type", exact: true })
      .selectOption("Scouting club");
    await dialog
      .getByRole("button", { name: "Submit board request", exact: true })
      .click();
    await expect(dialog).not.toBeVisible();
    await expect(page.locator(".affiliate-request").first()).toContainText(
      "Under review",
    );
    await expect(
      page.getByRole("button", { name: "Request affiliate", exact: true }),
    ).toBeDisabled();
    expect(
      (
        await request.post("/api/advance", {
          data: { days: 3 },
          timeout: 180000,
        })
      ).status(),
    ).toBe(200);
    await page.reload();
    const after = await (await request.get("/api/affiliates")).json();
    expect(after.requests[0].status).toBe("approved");
    expect(after.affiliates).toHaveLength(before.affiliates.length + 1);
    await expect(page.locator(".affiliate-request").first()).toContainText(
      after.requests[0].partner_name,
    );
    await page.screenshot({
      path: "test-results/board-affiliates-desktop.png",
      fullPage: true,
    });
    await page.setViewportSize({ width: 390, height: 844 });
    await noOverflow(page);
    const nameBounds = await page
      .locator(".affiliate-table tbody .team-link")
      .first()
      .boundingBox();
    expect(nameBounds!.width).toBeGreaterThanOrEqual(170);
    expect(nameBounds!.height).toBeLessThan(90);
    await page.screenshot({
      path: "test-results/board-affiliates-mobile.png",
      fullPage: true,
    });
    await page.locator(".affiliate-table tbody .team-link").first().click();
    const profile = page.getByRole("dialog", { name: "Team profile" });
    await profile.getByRole("tab", { name: /Affiliates/ }).click();
    await expect(profile.locator(".club-affiliate-row").first()).toBeVisible();
  } finally {
    expect(
      (
        await request.post("/api/saves/restore", {
          data: { file: checkpoint.file },
          timeout: 180000,
        })
      ).status(),
    ).toBe(200);
  }
});

test("unexpected event frequency persists and an event can be resolved from the office", async ({
  page,
  request,
}) => {
  test.setTimeout(420000);
  const checkpoint = await (
    await request.post("/api/saves", {
      data: { name: "Events workflow checkpoint" },
      timeout: 180000,
    })
  ).json();
  try {
    await page.goto("/#settings");
    await page
      .getByRole("navigation", { name: "Settings categories" })
      .getByRole("button", { name: "Simulation", exact: true })
      .click();
    const frequency = page.getByRole("combobox", {
      name: "Unexpected events",
      exact: true,
    });
    for (const value of ["low", "medium", "high"]) {
      await frequency.selectOption(value);
      await expect
        .poll(
          async () =>
            (await (await request.get("/api/events")).json()).frequency,
        )
        .toBe(value);
    }
    await page.reload();
    await page
      .getByRole("navigation", { name: "Settings categories" })
      .getByRole("button", { name: "Simulation", exact: true })
      .click();
    await expect(frequency).toHaveValue("high");
    let events = await (await request.get("/api/events")).json();
    for (let days = 0; !events.pending.length && days < 24; days++) {
      expect(
        (
          await request.post("/api/advance", {
            data: { days: 1 },
            timeout: 180000,
          })
        ).status(),
      ).toBe(200);
      events = await (await request.get("/api/events")).json();
    }
    expect(events.pending.length).toBe(1);
    const event = events.pending[0];
    await page.goto("/#office");
    await page.reload();
    const incident = page
      .locator(".event-case")
      .filter({ hasText: event.title });
    await expect(incident).toBeVisible();
    await expect(incident).toContainText(event.body);
    await page.screenshot({
      path: "test-results/unexpected-event-desktop.png",
      fullPage: true,
    });
    await page.setViewportSize({ width: 390, height: 844 });
    await noOverflow(page);
    await page.screenshot({
      path: "test-results/unexpected-event-mobile.png",
      fullPage: true,
    });
    const option = event.details.options.find(
      (choice: { id: string }) => choice.id === event.details.defaultChoice,
    );
    await incident
      .getByRole("button", { name: option.label, exact: true })
      .click();
    await expect(incident).not.toBeVisible();
    const result = await (await request.get("/api/events")).json();
    expect(
      result.history.find((entry: { id: number }) => entry.id === event.id)
        .status,
    ).toBe("resolved");
    await page.goto("/#board");
    const outcome = page
      .locator(".event-outcome")
      .filter({ hasText: event.title });
    await outcome.locator("summary").click();
    await expect(outcome).toContainText(option.outcome);
    await noOverflow(page);
  } finally {
    expect(
      (
        await request.post("/api/saves/restore", {
          data: { file: checkpoint.file },
          timeout: 180000,
        })
      ).status(),
    ).toBe(200);
  }
});

test("career folders keep all autosaves together in the menu and settings", async ({
  page,
  request,
}) => {
  const checkpoint = await (
    await request.post("/api/saves", {
      data: { name: "Grouped saves checkpoint" },
      timeout: 180000,
    })
  ).json();
  try {
    await request.patch("/api/settings", { data: { autosave: "daily" } });
    expect(
      (
        await request.post("/api/advance", {
          data: { days: 3 },
          timeout: 180000,
        })
      ).status(),
    ).toBe(200);
    const current = await (await request.get("/api/bootstrap")).json();
    const slots = await (await request.get("/api/saves")).json();
    const autosaves = slots.filter(
      (slot: { automatic: boolean; career?: { id: string } }) =>
        slot.automatic && slot.career?.id === current.state.careerId,
    );
    expect(autosaves).toHaveLength(3);
    await page.goto("/#start");
    await page.getByRole("button", { name: /Load career/ }).click();
    const folder = page.locator(
      `.career-folder[data-career-id="${current.state.careerId}"]`,
    );
    await expect(folder).toHaveCount(1);
    await folder.locator(".career-snapshot-folder > summary").click();
    const automatic = folder.locator(".career-autosave-folder");
    await expect(automatic).toHaveCount(1);
    await expect(automatic).not.toHaveAttribute("open", "");
    await automatic.locator("summary").click();
    await expect(automatic.locator(".career-snapshot")).toHaveCount(3);
    for (const slot of autosaves)
      await expect(
        automatic.locator(`[data-save-file="${slot.file}"]`),
      ).toBeVisible();
    await automatic.getByRole("button").first().click();
    await expect(
      page.getByRole("dialog", { name: "Load this career?" }),
    ).toBeVisible();
    await page
      .getByRole("dialog")
      .getByRole("button", { name: "Cancel", exact: true })
      .click();
    await noOverflow(page);
    await page.screenshot({
      path: "test-results/career-folders-desktop.png",
      fullPage: true,
    });
    await page.goto("/#settings");
    await page
      .getByRole("navigation", { name: "Settings categories" })
      .getByRole("button", { name: "Saves", exact: true })
      .click();
    await expect(folder).toHaveCount(1);
    await folder.locator(".career-snapshot-folder > summary").click();
    await folder.locator(".career-autosave-folder > summary").click();
    await expect(
      folder.locator(".career-autosave-folder .career-snapshot"),
    ).toHaveCount(3);
    await page.setViewportSize({ width: 390, height: 844 });
    await noOverflow(page);
    const titleBounds = await folder
      .locator(".career-snapshot strong")
      .first()
      .boundingBox();
    expect(titleBounds!.width).toBeGreaterThan(150);
    expect(titleBounds!.height).toBeLessThan(55);
    await page.screenshot({
      path: "test-results/career-folders-mobile.png",
      fullPage: true,
    });
    await page.setViewportSize({ width: 320, height: 740 });
    await noOverflow(page);
    const narrowTitle = await folder
      .locator(".career-snapshot strong")
      .first()
      .boundingBox();
    expect(narrowTitle!.width).toBeGreaterThan(100);
    expect(narrowTitle!.height).toBeLessThan(70);
    expect(
      (await (await request.get("/api/saves")).json()).map(
        (slot: { file: string }) => slot.file,
      ),
    ).toEqual(slots.map((slot: { file: string }) => slot.file));
    expect((await (await request.get("/api/bootstrap")).json()).state).toEqual(
      current.state,
    );
  } finally {
    expect(
      (
        await request.post("/api/saves/restore", {
          data: { file: checkpoint.file },
          timeout: 180000,
        })
      ).status(),
    ).toBe(200);
  }
});

test("a manual save at the career limit names the save it replaces and waits for confirmation", async ({
  page,
  request,
}) => {
  let current = await bootstrapOf(request);
  if (!current.state.careerId) {
    expect(
      (
        await request.post("/api/saves", {
          data: { name: "Rotation career" },
          timeout: 180000,
        })
      ).status(),
    ).toBe(200);
    current = await bootstrapOf(request);
  }
  const career = {
    id: current.state.careerId as string,
    name: current.state.careerName ?? current.club.name,
    director: current.state.director.name,
    club: current.club.name,
    date: "2026-07-01",
    season: 2026,
  };
  const fake = (
    index: number,
    name: string,
    extra: Partial<ListedSave> = {},
  ): ListedSave => ({
    name,
    file: `00000000-0000-4000-8000-${String(index).padStart(12, "0")}.touchline.gz`,
    size: 1_000_000,
    modified: new Date(Date.UTC(2020, 0, 1 + index, 12)).toISOString(),
    compressed: true,
    automatic: false,
    imported: false,
    career,
    ...extra,
  });
  const files = (slots: ListedSave[]) => slots.map((slot) => slot.file);
  const real: ListedSave[] = await (
    await retryBusyResponse(() => request.get("/api/saves"))
  ).json();
  // The list is mocked so the check neither depends on nor writes real saves.
  const others = real.filter(
    (slot) => slot.automatic || slot.imported || slot.career?.id !== career.id,
  );
  const imported = fake(20, "Imported rotation check", {
    imported: true,
    modified: "2019-12-01T12:00:00.000Z",
  });
  const oldest = fake(0, "Oldest rotation check");
  const newer = Array.from({ length: 9 }, (_, index) =>
    fake(index + 1, `Rotation check ${index + 1}`),
  );
  let listed = [...others, imported, ...newer];
  const posted: unknown[] = [];
  await page.route("**/api/saves", async (route) => {
    const method = route.request().method();
    if (method === "GET") return route.fulfill({ json: listed });
    if (method === "POST") {
      posted.push(route.request().postDataJSON());
      return route.fulfill({ json: { file: fake(30, "Posted").file, name: "Posted" } });
    }
    return route.fallback();
  });
  await page.goto("/#settings");
  await page
    .getByRole("navigation", { name: "Settings categories" })
    .getByRole("button", { name: "Saves", exact: true })
    .click();
  const saveName = page.getByLabel("Save name", { exact: true });
  const saveButton = page.getByRole("button", { name: "Save career", exact: true });
  const replace = page.getByRole("dialog", { name: "Replace your oldest save?" });
  await saveName.fill("Under the limit");
  await saveButton.click();
  await expect.poll(() => posted.length).toBe(1);
  expect(posted[0]).toEqual({ name: "Under the limit" });
  await expect(replace).toHaveCount(0);

  listed = [...others, imported, oldest, ...newer];
  expect(savesReplacedByManualSave(listed, career.id)).toEqual([oldest]);
  await saveName.fill("Rotation confirmation");
  await saveButton.click();
  await expect(replace).toBeVisible();
  await expect(replace).toContainText("“Rotation confirmation”");
  await expect(replace).toContainText("Oldest rotation check");
  await expect(replace).toContainText("saved 1 Jan 2020");
  await expect(replace).not.toContainText("Rotation check 1");
  await expect(replace).not.toContainText("Imported rotation check");
  await expect(replace).toHaveAccessibleDescription(
    /permanently deletes the oldest one:.*Oldest rotation check/,
  );
  await expect
    .poll(() =>
      page.evaluate(() => !!document.activeElement?.closest("dialog[open]")),
    )
    .toBe(true);
  await page.keyboard.press("Escape");
  await expect(replace).toHaveCount(0);
  await expect(saveButton).toBeFocused();
  await expect(saveName).toHaveValue("Rotation confirmation");
  for (const width of [390, 320]) {
    await page.setViewportSize({ width, height: 760 });
    await saveButton.click();
    await expect(replace).toBeVisible();
    await noOverflow(page);
    expect(
      await replace.evaluate(
        (dialog) =>
          dialog.scrollWidth <= dialog.clientWidth + 1 &&
          dialog.getBoundingClientRect().right <= innerWidth + 1,
      ),
    ).toBe(true);
    await page.screenshot({ path: `test-results/save-replacement-${width}.png` });
    await replace.getByRole("button", { name: "Cancel", exact: true }).click();
    await expect(replace).toHaveCount(0);
  }
  expect(posted).toHaveLength(1);

  await saveButton.click();
  await replace.getByRole("button", { name: "Replace and save", exact: true }).click();
  await expect.poll(() => posted.length).toBe(2);
  expect(posted[1]).toEqual({ name: "Rotation confirmation" });
  await expect(replace).toHaveCount(0);
  await page.unroute("**/api/saves");
  expect(
    files(await (await retryBusyResponse(() => request.get("/api/saves"))).json()),
  ).toEqual(files(real));
});

test("seeded local world and desktop dashboard", async ({ page, request }) => {
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
  // scripts/e2e-server.ts seeds EN, DE and LU, not the full 211-nation world.
  expect(
    bootstrap.countries.map((country: { code: string }) => country.code).sort(),
  ).toEqual(["DE", "EN", "LU"]);
  expect(bootstrap.world.countries).toBe(3);
  expect(bootstrap.world.version).toBe(4);
  expect(bootstrap.world.leagues).toBeGreaterThan(bootstrap.world.countries);
  expect(bootstrap.world.clubs).toBeGreaterThanOrEqual(150);
  expect(bootstrap.world.players).toBeGreaterThanOrEqual(
    bootstrap.world.clubs * 20,
  );
  expect(bootstrap.settings.cloudSync).toBe(false);
  await page.goto("/#office");
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
    ["world", "World browser"],
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
  // Order-independent: a fresh e2e world has no started career.
  await expect(
    page
      .getByRole("button", { name: "Continue career", exact: true })
      .or(page.getByText("Your private world is ready.", { exact: false })),
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

test("database filter groups reset dependent fields, clear chips and restart pagination", async ({
  page,
}) => {
  async function resultsAfter(
    action: () => Promise<unknown>,
    parameters: Record<string, string | null>,
  ) {
    const pending = page.waitForResponse((response) => {
      const url = new URL(response.url());
      return url.pathname === "/api/players" && Object.entries(parameters).every(
        ([key, value]) => url.searchParams.get(key) === value,
      );
    });
    await action();
    const response = await pending;
    expect(response.ok()).toBe(true);
    const result: PlayerPage = await response.json();
    const rows = page.locator(".database-workspace .player-table tbody tr");
    await expect(rows).toHaveCount(result.players.length);
    await expect(rows.locator(".player-name strong")).toHaveText(
      result.players.map((player) => player.name),
    );
    await expect(rows.locator(".position-tag")).toHaveText(
      result.players.map((player) => player.position),
    );
    await expect(rows.locator("td:nth-child(3)")).toHaveText(
      result.players.map((player) => String(player.age)),
    );
    await expect(rows.locator(".club-cell")).toHaveText(
      result.players.map(
        (player) =>
          player.club_name ??
          ((player as { home_based?: number }).home_based ? "Home-based" : "Free agent"),
      ),
    );
    await expect(page.locator(".filter-summary")).toContainText("in your selection");
    await expect(page.locator(".pagination-actions > span")).toHaveText(
      `${result.page} / ${result.pages}`,
    );
    return result;
  }

  const initial = await resultsAfter(() => page.goto("/#database"), { page: "1" });
  expect(initial.pages).toBeGreaterThan(1);
  for (const name of [
    "Identity & location",
    "Position & ability",
    "Contract & availability",
  ]) {
    await expect(page.getByRole("group", { name, exact: true })).toBeVisible();
  }
  const advanced = page.getByRole("button", { name: /^Advanced filters/ });
  const attributes = page.getByRole("group", { name: "Attributes & physical profile", exact: true });
  const personalityGroup = page.getByRole("group", { name: "Personality & traits", exact: true });
  await expect(advanced).toHaveAttribute("aria-expanded", "false");
  await expect(attributes).not.toBeVisible();
  const next = page.getByRole("button", { name: "Next player page", exact: true });
  await resultsAfter(() => next.click(), { page: "2" });
  const position = initial.players[0].position;
  const filtered = await resultsAfter(
    () => page.getByRole("combobox", { name: "Position filter", exact: true }).selectOption(position),
    { position, page: "1" },
  );
  expect(filtered.pages).toBeGreaterThan(1);
  expect(filtered.players.every((player) => player.position === position)).toBe(true);
  await expect(page.getByRole("button", { name: "Previous player page", exact: true })).toBeDisabled();

  await advanced.click();
  await expect(advanced).toHaveAttribute("aria-expanded", "true");
  await expect(attributes).toBeVisible();
  await expect(personalityGroup).toBeVisible();
  await expect(page.getByRole("group", { name: "Match performance", exact: true })).toBeVisible();
  const attribute = attributes.getByRole("combobox", { name: "Attribute", exact: true });
  const attributeMin = attributes.getByRole("spinbutton", { name: "Attribute minimum", exact: true });
  const personality = personalityGroup.getByRole("combobox", { name: "Personality", exact: true });
  const personalityMin = personalityGroup.getByRole("spinbutton", { name: "Personality minimum", exact: true });
  await expect(attributeMin).toBeDisabled();
  await expect(personalityMin).toBeDisabled();
  const attributeKey = await attribute.locator("option").nth(1).getAttribute("value");
  const personalityKey = await personality.locator("option").nth(1).getAttribute("value");
  expect(attributeKey).toBeTruthy();
  expect(personalityKey).toBeTruthy();
  await resultsAfter(() => attribute.selectOption(attributeKey!), { attribute: attributeKey, attributeMin: null });
  await expect(attributeMin).toBeEnabled();
  await resultsAfter(() => attributeMin.fill("60"), { attribute: attributeKey, attributeMin: "60" });
  await resultsAfter(() => personality.selectOption(personalityKey!), { personality: personalityKey, personalityMin: null });
  await expect(personalityMin).toBeEnabled();
  await resultsAfter(() => personalityMin.fill("60"), { personality: personalityKey, personalityMin: "60" });
  const chips = page.getByRole("group", { name: "Active player filters", exact: true });
  await expect(chips.getByRole("button", { name: "Remove Attribute minimum", exact: true })).toBeVisible();
  await expect(chips.getByRole("button", { name: "Remove Personality minimum", exact: true })).toBeVisible();
  await noOverflow(page);
  await page.screenshot({ path: "test-results/database-filter-groups-desktop.png", fullPage: true });
  for (const width of [390, 320]) {
    await page.setViewportSize({ width, height: 844 });
    await expect(advanced).toBeVisible();
    await expect(attribute).toBeVisible();
    await expect(personality).toBeVisible();
    await noOverflow(page);
    await page.screenshot({ path: `test-results/database-filter-groups-mobile-${width}.png`, fullPage: true });
  }

  await advanced.click();
  await expect(advanced).toHaveAttribute("aria-expanded", "false");
  await expect(attributes).not.toBeVisible();
  await resultsAfter(
    () => chips.getByRole("button", { name: "Remove Attribute", exact: true }).click(),
    { attribute: null, attributeMin: null, personality: personalityKey, personalityMin: "60", page: "1" },
  );
  await expect(chips.getByRole("button", { name: "Remove Attribute minimum", exact: true })).toHaveCount(0);
  await advanced.click();
  await expect(attribute).toHaveValue("");
  await expect(attributeMin).toHaveValue("");
  await expect(attributeMin).toBeDisabled();
  await expect(personalityMin).toHaveValue("60");
  await resultsAfter(
    () => personality.selectOption(""),
    { personality: null, personalityMin: null, position, page: "1" },
  );
  await expect(personalityMin).toHaveValue("");
  await expect(personalityMin).toBeDisabled();
  await expect(chips.getByRole("button", { name: "Remove Personality minimum", exact: true })).toHaveCount(0);
  await resultsAfter(() => next.click(), { position, page: "2" });
  const cleared = await resultsAfter(
    () => chips.getByRole("button", { name: "Remove Position", exact: true }).click(),
    { position: null, attributeMin: null, personalityMin: null, page: "1" },
  );
  expect(cleared.total).toBe(initial.total);
  await expect(chips).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Previous player page", exact: true })).toBeDisabled();
});

test("academy cohort controls filter and sort the stored roster on desktop and mobile", async ({
  page,
  request,
}) => {
  const bootstrap: Bootstrap = await (await request.get("/api/bootstrap")).json();
  const academy: AcademyData = await (await request.get("/api/academy")).json();
  expect(academy.players.length).toBeGreaterThan(1);
  await page.goto("/#academy");
  const prospects = page.getByRole("region", { name: "Academy prospects", exact: true });
  const rows = prospects.locator("tbody tr");
  async function expectProspects(players: AcademyData["players"], total: number) {
    await expect(prospects).toHaveAttribute("aria-busy", "false");
    await expect(rows).toHaveCount(players.length);
    await expect(rows.locator(".player-name strong")).toHaveText(players.map((player) => player.name));
    await expect(rows.locator(".position-tag")).toHaveText(players.map((player) => player.position));
    await expect(rows.locator("td:nth-child(3)")).toHaveText(players.map((player) => `${player.age_group} / ${player.age}`));
    await expect(page.locator(".roster-result-count")).toHaveText(`${players.length} of ${total} players`);
    if (!players.length) {
      await expect(prospects.getByRole("heading", { name: "No players in this cohort", exact: true })).toBeVisible();
    }
  }

  const cohorts = page.getByRole("group", { name: "Academy age group", exact: true });
  for (const group of ["U19", "U17", "all"]) {
    const radio = cohorts.getByRole("radio", {
      name: group === "all" ? "All academy age groups" : `${group} academy`,
      exact: true,
    });
    await radio.check();
    await expect(radio).toBeChecked();
    // The UI's comparator: column default direction, then the name/id tie rule.
    const players = sortPlayers(
      academy.players.filter((player) => group === "all" || player.age_group === group),
      "potential",
    );
    await expectProspects(players, players.length);
  }
  const sort = page.getByRole("combobox", { name: "Sort academy players", exact: true });
  await sort.selectOption("name");
  const byName = sortPlayers(academy.players, "name");
  await expectProspects(byName, academy.players.length);
  const target = byName[0];
  const position = page.getByRole("combobox", { name: "Academy position", exact: true });
  const coverage = page.getByRole("group", { name: "Academy position coverage", exact: true });
  const matchingPosition = byName.filter((player) => player.position === target.position);
  await position.selectOption(target.position);
  await expectProspects(matchingPosition, academy.players.length);
  const positionButton = coverage.getByRole("button", {
    name: `${target.position}: ${matchingPosition.length} academy players`,
    exact: true,
  });
  await expect(positionButton).toHaveAttribute("aria-pressed", "true");
  await positionButton.click();
  await expect(positionButton).toHaveAttribute("aria-pressed", "false");
  await expect(position).toHaveValue("");
  await expectProspects(byName, academy.players.length);

  const review = page.getByRole("combobox", { name: "Academy review", exact: true });
  for (const focus of ["age-out", "care", "mentor"]) {
    await review.selectOption(focus);
    const expected = byName.filter((player) => {
      if (focus === "age-out") {
        const cutoff = bootstrap.state.season + 1 - (player.age_group === "U17" ? 16 : 18);
        return ["U17", "U19"].includes(player.age_group) && player.birth_date < `${cutoff}-01-01`;
      }
      if (focus === "care") {
        return (!!player.injury_until && player.injury_until > bootstrap.state.date) ||
          player.fitness < 60 || (player.details?.mentalHealth.burnout ?? 0) >= 60;
      }
      return player.details?.development.mentorId === null;
    });
    await expectProspects(expected, academy.players.length);
  }
  await review.selectOption("");
  await position.selectOption(target.position);
  const search = page.getByRole("textbox", { name: "Search academy players", exact: true });
  await search.fill(target.name);
  await expectProspects(
    matchingPosition.filter((player) => `${player.name} ${player.nationality}`.toLowerCase().includes(target.name.toLowerCase())),
    academy.players.length,
  );
  await page.getByRole("button", { name: "Clear academy filters", exact: true }).click();
  await expect(search).toHaveValue("");
  await expect(position).toHaveValue("");
  await expect(review).toHaveValue("");
  await expect(sort).toHaveValue("name");
  await expectProspects(byName, academy.players.length);
  for (const order of ["ability", "age"] as const) {
    await sort.selectOption(order);
    await expectProspects(sortPlayers(academy.players, order), academy.players.length);
  }
  await noOverflow(page);
  await page.screenshot({ path: "test-results/academy-cohort-controls-desktop.png", fullPage: true });
  for (const width of [390, 320]) {
    await page.setViewportSize({ width, height: 844 });
    await expect(position).toBeVisible();
    await expect(review).toBeVisible();
    await expect(sort).toBeVisible();
    await expect(coverage.getByRole("button")).toHaveCount(
      (await position.locator("option").count()) - 1,
    );
    for (const button of await coverage.getByRole("button").all()) {
      await expect(button).toBeVisible();
    }
    await noOverflow(page);
    await page.screenshot({ path: `test-results/academy-cohort-controls-mobile-${width}.png`, fullPage: true });
  }
});

test("squad cohort controls filter readiness and sort within position groups", async ({
  page,
  request,
}) => {
  const bootstrap: Bootstrap = await (await request.get("/api/bootstrap")).json();
  const senior: SquadData = await (await request.get("/api/squad?ageGroup=Senior")).json();
  expect(senior.players.length).toBeGreaterThan(1);
  await page.goto("/#squad");
  const roster = page.getByRole("region", { name: "Squad players", exact: true });
  const rows = roster.locator("tbody tr:not(.roster-group-row)");
  const positionGroups = [["GK"], ["CB", "LB", "RB"], ["DM", "CM", "AM"], ["LW", "RW", "ST"]];
  const isInjured = (player: SquadData["players"][number]) =>
    !!player.injury_until && player.injury_until > bootstrap.state.date;
  async function expectSquad(players: SquadData["players"], total: number) {
    const grouped = positionGroups.flatMap((positions) =>
      players.filter((player) => positions.includes(player.position)),
    );
    await expect(roster).toHaveAttribute("aria-busy", "false");
    await expect(rows).toHaveCount(players.length);
    await expect(rows.locator(".player-name strong")).toHaveText(grouped.map((player) => player.name));
    await expect(rows.locator(".player-name small")).toHaveText(grouped.map((player) => `${player.nationality} / ${player.age}`));
    await expect(rows.locator(".position-tag")).toHaveText(grouped.map((player) => player.position));
    await expect(rows.locator(".roster-status > .badge:first-child")).toHaveText(
      grouped.map((player) => isInjured(player) ? "Injured" : player.fitness < 60 ? "Low fitness" : "Fit"),
    );
    await expect(page.locator(".roster-result-count")).toHaveText(`${players.length} of ${total} players`);
    if (!players.length) {
      await expect(roster.getByRole("heading", { name: "No players in this selection", exact: true })).toBeVisible();
    }
  }

  const byAbility = sortPlayers(senior.players, "ability");
  await expectSquad(byAbility, senior.players.length);
  await expect(page.getByRole("combobox", { name: "Club squad", exact: true })).toHaveValue(String(senior.selectedClubId));
  const ageGroup = page.getByRole("combobox", { name: "Squad age group", exact: true });
  for (const group of ["U19", "U17"]) {
    const squad: SquadData = await (await request.get(`/api/squad?ageGroup=${group}`)).json();
    await ageGroup.selectOption(group);
    await expect(ageGroup).toHaveValue(group);
    await expectSquad(sortPlayers(squad.players, "ability"), squad.players.length);
  }
  await ageGroup.selectOption("Senior");
  await expectSquad(byAbility, senior.players.length);
  const sort = page.getByRole("combobox", { name: "Sort squad players", exact: true });
  await sort.selectOption("name");
  const byName = sortPlayers(senior.players, "name");
  await expectSquad(byName, senior.players.length);
  const target = byName[0];
  const position = page.getByRole("combobox", { name: "Squad position", exact: true });
  const coverage = page.getByRole("group", { name: "Squad position coverage", exact: true });
  const matchingPosition = byName.filter((player) => player.position === target.position);
  await position.selectOption(target.position);
  await expectSquad(matchingPosition, senior.players.length);
  const positionButton = coverage.getByRole("button", {
    name: `${target.position}: ${matchingPosition.length} players`,
    exact: true,
  });
  await expect(positionButton).toHaveAttribute("aria-pressed", "true");
  await positionButton.click();
  await expect(positionButton).toHaveAttribute("aria-pressed", "false");
  await expect(position).toHaveValue("");
  await expectSquad(byName, senior.players.length);

  const readiness = page.getByRole("combobox", { name: "Squad readiness", exact: true });
  for (const status of ["fit", "low", "injured"]) {
    await readiness.selectOption(status);
    const expected = byName.filter((player) =>
      status === "injured" ? isInjured(player)
        : !isInjured(player) && (status === "low" ? player.fitness < 60 : player.fitness >= 60),
    );
    await expectSquad(expected, senior.players.length);
  }
  await readiness.selectOption("");
  await position.selectOption(target.position);
  const search = page.getByRole("textbox", { name: "Search squad players", exact: true });
  await search.fill(target.name);
  await expectSquad(
    matchingPosition.filter((player) => `${player.name} ${player.nationality} ${player.role}`.toLowerCase().includes(target.name.toLowerCase())),
    senior.players.length,
  );
  await page.getByRole("button", { name: "Clear squad filters", exact: true }).click();
  await expect(search).toHaveValue("");
  await expect(position).toHaveValue("");
  await expect(readiness).toHaveValue("");
  await expect(sort).toHaveValue("name");
  await expectSquad(byName, senior.players.length);
  for (const order of ["potential", "fitness", "age"] as const) {
    await sort.selectOption(order);
    await expectSquad(sortPlayers(senior.players, order), senior.players.length);
  }
  await noOverflow(page);
  await page.screenshot({ path: "test-results/squad-cohort-controls-desktop.png", fullPage: true });
  for (const width of [390, 320]) {
    await page.setViewportSize({ width, height: 844 });
    await expect(ageGroup).toBeVisible();
    await expect(position).toBeVisible();
    await expect(readiness).toBeVisible();
    await expect(sort).toBeVisible();
    await expect(coverage.getByRole("button")).toHaveCount(
      (await position.locator("option").count()) - 1,
    );
    for (const button of await coverage.getByRole("button").all()) {
      await expect(button).toBeVisible();
    }
    await noOverflow(page);
    await page.screenshot({ path: `test-results/squad-cohort-controls-mobile-${width}.png`, fullPage: true });
  }
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
        (await bootstrapOf(request)).settings.theme,
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
        (await bootstrapOf(request)).settings.theme,
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

test("custom accent HEX codes validate, apply and persist", async ({
  page,
  request,
}) => {
  await request.patch("/api/settings", {
    data: { theme: "light", accent: "#087f6d" },
  });
  await page.goto("/#settings");
  const code = page.getByRole("textbox", {
    name: "Accent color HEX code",
    exact: true,
  });
  const apply = page.getByRole("button", {
    name: "Apply accent color",
    exact: true,
  });
  await expect(code).toHaveValue("#087f6d");
  await code.fill("2452A1");
  await apply.click();
  await expect(code).toHaveValue("#2452a1");
  await expect
    .poll(
      async () =>
        (await bootstrapOf(request)).settings.accent,
    )
    .toBe("#2452a1");
  await page.reload();
  await expect(code).toHaveValue("#2452a1");
  await code.fill("#zzzzzz");
  await code.press("Enter");
  await expect(code).toHaveAttribute("aria-invalid", "true");
  await expect(apply).toBeDisabled();
  expect((await bootstrapOf(request)).settings.accent).toBe("#2452a1");
  await code.press("Escape");
  await expect(code).toHaveValue("#2452a1");
  await code.fill("#246");
  await code.press("Enter");
  await expect(code).toHaveValue("#224466");
  await expect
    .poll(
      async () =>
        (await bootstrapOf(request)).settings.accent,
    )
    .toBe("#224466");
  await expect(
    page.getByLabel("Custom accent color", { exact: true }),
  ).toHaveValue("#224466");
  await page
    .getByRole("button", { name: "Accent #367cb5", exact: true })
    .click();
  await expect(code).toHaveValue("#367cb5");
  await page
    .getByRole("radiogroup", { name: "Appearance" })
    .getByRole("radio", { name: "Dark", exact: true })
    .check();
  await page.setViewportSize({ width: 390, height: 844 });
  await noOverflow(page);
  await page.screenshot({
    path: "test-results/custom-accent-mobile.png",
    fullPage: true,
  });
  await page.setViewportSize({ width: 320, height: 740 });
  await noOverflow(page);
  await page
    .getByRole("button", { name: "Reset accent color", exact: true })
    .click();
  await expect
    .poll(
      async () =>
        (await bootstrapOf(request)).settings.accent,
    )
    .toBe("#087f6d");
  await request.patch("/api/settings", { data: { theme: "light" } });
});

test("currency settings convert budget slider previews and compact amounts without changing finances", async ({
  page,
  request,
}) => {
  await page.goto("/#settings");
  await page
    .getByRole("navigation", { name: "Settings categories" })
    .getByRole("button", { name: "Interface", exact: true })
    .click();
  const before = await (await request.get("/api/bootstrap")).json();
  const currency = page.getByRole("combobox", {
    name: "Currency",
    exact: true,
  });
  await currency.selectOption("EUR");
  await expect
    .poll(
      async () =>
        (await bootstrapOf(request)).settings.currency,
    )
    .toBe("EUR");
  await page.reload();
  await page
    .getByRole("navigation", { name: "Settings categories" })
    .getByRole("button", { name: "Interface", exact: true })
    .click();
  await expect(currency).toHaveValue("EUR");
  await page.goto("/#transfers");
  await expect(page.locator(".stat-value").first()).toHaveText(
    money(before.club.transfer_budget, false, "EUR"),
  );
  await page.goto("/#finances");
  await page
    .getByRole("button", { name: "Adjust budgets", exact: true })
    .click();
  const dialog = page.getByRole("dialog");
  const allocation = dialog.getByRole("slider", {
    name: "Transfer and wage budget allocation",
    exact: true,
  });
  await expect(
    dialog.getByRole("button", { name: "Confirm allocation", exact: true }),
  ).toBeDisabled();
  await allocation.press("End");
  const amount = Math.min(100_000_000, Math.floor(before.club.transfer_budget));
  await expect(allocation).toHaveAttribute(
    "aria-valuetext",
    `${money(before.club.transfer_budget - amount, true, "EUR")} transfer budget; ${money(before.club.wage_budget + amount / 52, true, "EUR")} weekly wage budget`,
  );
  await expect(
    dialog
      .locator(".detail-list > div")
      .filter({ hasText: "Revised weekly wage budget" })
      .locator("dd"),
  ).toHaveText(/^€[\d,.]+M$/);
  await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
  expect((await bootstrapOf(request)).club).toEqual(before.club);
  await page.goto("/#settings");
  await page
    .getByRole("navigation", { name: "Settings categories" })
    .getByRole("button", { name: "Interface", exact: true })
    .click();
  await currency.selectOption("USD");
  await expect
    .poll(
      async () =>
        (await bootstrapOf(request)).settings.currency,
    )
    .toBe("USD");
  await page.setViewportSize({ width: 390, height: 844 });
  await noOverflow(page);
  await page.screenshot({
    path: "test-results/currency-settings-mobile.png",
    fullPage: true,
  });
  await currency.selectOption("GBP");
  await expect
    .poll(
      async () =>
        (await bootstrapOf(request)).settings.currency,
    )
    .toBe("GBP");
});

test("budget allocation slider protects committed wages and saves changes in either direction", async ({
  page,
  request,
}) => {
  const checkpoint = await (
    await request.post("/api/saves", {
      data: { name: "Budget slider checkpoint" },
      timeout: 180000,
    })
  ).json();
  try {
    const before = await (await request.get("/api/bootstrap")).json();
    const finances = await (await request.get("/api/finances")).json();
    const currency = currencyCode(before.settings.currency);
    const minimum = Math.max(
      -100_000_000,
      Math.ceil((finances.wages - before.club.wage_budget) * 52),
    );
    expect(minimum).toBeLessThan(0);
    await page.goto("/#finances");
    await page
      .getByRole("button", { name: "Adjust budgets", exact: true })
      .click();
    const dialog = page.getByRole("dialog", {
      name: "Rebalance your budgets",
      exact: true,
    });
    const slider = dialog.getByRole("slider", {
      name: "Transfer and wage budget allocation",
      exact: true,
    });
    const confirm = dialog.getByRole("button", {
      name: "Confirm allocation",
      exact: true,
    });
    await expect(dialog.getByRole("spinbutton")).toHaveCount(0);
    await expect(confirm).toBeDisabled();
    await slider.press("Home");
    await expect(slider).toHaveValue("0");
    await expect(slider).toHaveAttribute(
      "aria-valuetext",
      `${money(before.club.transfer_budget - minimum, true, currency)} transfer budget; ${money(before.club.wage_budget + minimum / 52, true, currency)} weekly wage budget`,
    );
    expect((await bootstrapOf(request)).club).toEqual(before.club);
    await page.screenshot({ path: "test-results/budget-slider-desktop.png" });
    await page.setViewportSize({ width: 390, height: 844 });
    await noOverflow(page);
    const dimensions = await dialog.evaluate((element) => ({
      width: element.clientWidth,
      scroll: element.scrollWidth,
    }));
    expect(dimensions.scroll).toBeLessThanOrEqual(dimensions.width + 1);
    await page.screenshot({ path: "test-results/budget-slider-mobile.png" });
    await confirm.click();
    await expect(dialog).not.toBeVisible();
    const transfers = await bootstrapOf(request);
    expect(transfers.club.transfer_budget).toBeCloseTo(
      before.club.transfer_budget - minimum,
      2,
    );
    expect(transfers.club.wage_budget).toBeCloseTo(
      before.club.wage_budget + minimum / 52,
      6,
    );
    expect(transfers.club.wage_budget).toBeGreaterThanOrEqual(finances.wages);
    expect(transfers.club.balance).toBe(before.club.balance);
    await page
      .getByRole("button", { name: "Adjust budgets", exact: true })
      .click();
    await slider.press("End");
    await expect(slider).toHaveValue("100");
    const maximum = Math.min(
      100_000_000,
      Math.floor(transfers.club.transfer_budget),
    );
    await expect(slider).toHaveAttribute(
      "aria-valuetext",
      `${money(transfers.club.transfer_budget - maximum, true, currency)} transfer budget; ${money(transfers.club.wage_budget + maximum / 52, true, currency)} weekly wage budget`,
    );
    await confirm.click();
    await expect(dialog).not.toBeVisible();
    await page.reload();
    await expect(
      page.getByRole("heading", { name: "Club finances", exact: true }),
    ).toBeVisible();
    const wages = await bootstrapOf(request);
    expect(wages.club.transfer_budget).toBeCloseTo(
      transfers.club.transfer_budget - maximum,
      2,
    );
    expect(wages.club.transfer_budget).toBeGreaterThanOrEqual(0);
    expect(wages.club.wage_budget).toBeCloseTo(
      transfers.club.wage_budget + maximum / 52,
      6,
    );
    expect(
      wages.club.transfer_budget + wages.club.wage_budget * 52,
    ).toBeCloseTo(
      before.club.transfer_budget + before.club.wage_budget * 52,
      2,
    );
    expect(wages.club.balance).toBe(before.club.balance);
    expect(wages.state.date).toBe(before.state.date);
  } finally {
    expect(
      (
        await request.post("/api/saves/restore", {
          data: { file: checkpoint.file },
          timeout: 180000,
        })
      ).status(),
    ).toBe(200);
  }
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
        (await bootstrapOf(request)).settings.theme,
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
        (await bootstrapOf(request)).settings.theme,
    )
    .toBe("light");
});

test("mobile navigation, settings, accessibility and dossier fit", async ({
  page,
  request,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/#office");
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
  await retryBusyResponse(() =>
    request.patch("/api/settings", {
      data: { theme: "light", highContrast: false },
    }),
  );
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

test("offer page separates transfer and loan types before opening resumable talks", async ({
  page,
  request,
}) => {
  const bootstrap = await (await request.get("/api/bootstrap")).json();
  const search = await (
    await request.get(
      "/api/players?country=1&ageMin=20&ageMax=25&pageSize=100&valueMax=12000000",
    )
  ).json();
  const target = search.players.find(
    (player: {
      club_id: number;
      parent_club_id: number | null;
      contract_end: string;
    }) =>
      player.club_id !== bootstrap.club.id &&
      player.club_id &&
      !player.parent_club_id &&
      player.contract_end >= "2028-06-30",
  );
  expect(target).toBeTruthy();
  const before = await (await request.get("/api/transfers")).json();
  await page.goto("/#database");
  await page.getByLabel("Search players", { exact: true }).fill(target.name);
  await page
    .locator(".player-table tbody tr")
    .filter({ hasText: target.name })
    .filter({ hasText: target.club_name })
    .first()
    .locator(".player-name")
    .click();
  await page
    .getByRole("dialog", { name: "Player dossier" })
    .getByRole("button", { name: "Make an offer", exact: true })
    .click();
  await expect(page).toHaveURL(new RegExp(`#offer/${target.id}$`));
  await expect(
    page.getByRole("heading", { name: "Make an offer", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("radio", { name: "Transfer offer", exact: true }),
  ).toBeChecked();
  await page
    .getByRole("combobox", { name: "Offer type", exact: true })
    .selectOption("instalments");
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  expect(
    (await (await request.get("/api/transfers")).json()).negotiations.length,
  ).toBe(before.negotiations.length);
  await page.goto(`/#offer/${target.id}`);
  await page.getByRole("radio", { name: "Loan offer", exact: true }).check();
  await page
    .getByRole("combobox", { name: "Offer type", exact: true })
    .selectOption("Loan with option");
  await page.screenshot({
    path: "test-results/offer-type-desktop.png",
    fullPage: true,
  });
  await page
    .getByRole("button", { name: "Continue to negotiation", exact: true })
    .click();
  await expect(
    page.getByRole("region", { name: "Offer negotiation" }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Submit club offer", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("spinbutton", { name: /^Agreed purchase fee/ }),
  ).toBeVisible();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await page.reload();
  await expect(
    page.getByRole("region", { name: "Offer negotiation" }),
  ).toBeVisible();
  const desk = await (await request.get("/api/transfers")).json();
  const deal = desk.negotiations.find(
    (entry: { player_id: number; stage: string }) =>
      entry.player_id === target.id && entry.stage === "Club talks",
  );
  expect(deal.type).toBe("Loan with option");
  await page.setViewportSize({ width: 390, height: 844 });
  await noOverflow(page);
  await page.screenshot({
    path: "test-results/offer-negotiation-mobile.png",
    fullPage: true,
  });
  expect(
    (
      await request.post("/api/action", {
        data: { type: "negotiation", id: deal.id, action: "withdraw" },
      })
    ).status(),
  ).toBe(200);
  await page.reload();
  await page
    .getByRole("combobox", { name: "Offer type", exact: true })
    .selectOption("instalments");
  await page
    .getByRole("button", { name: "Continue to negotiation", exact: true })
    .click();
  await expect(
    page.getByRole("combobox", { name: "Deferred instalments", exact: true }),
  ).toHaveValue("3");
  const updated = await (await request.get("/api/transfers")).json();
  const transfer = updated.negotiations.find(
    (entry: { player_id: number; stage: string }) =>
      entry.player_id === target.id && entry.stage === "Club talks",
  );
  expect(transfer.type).toBe("Permanent transfer");
  expect(
    (
      await request.post("/api/action", {
        data: { type: "negotiation", id: transfer.id, action: "withdraw" },
      })
    ).status(),
  ).toBe(200);
});

test("a real transfer registers instalments, buy-back and sell-on clauses through every stage", async ({
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
  const dialog = page.locator(".offer-negotiation");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await dialog.getByRole("button", { name: "Request formal talks" }).click();
  await dialog
    .getByLabel("Proposed transfer fee")
    .fill(String(Math.round(negotiation.asking_price)));
  await expect(dialog.getByLabel("Proposed weekly wage")).toHaveCount(0);
  await dialog
    .getByRole("combobox", { name: "Deferred instalments", exact: true })
    .selectOption("3");
  await dialog
    .getByRole("checkbox", { name: "Selling club buy-back right", exact: true })
    .check();
  const nextSale = dialog.getByRole("slider", {
    name: "Percentage of next sale",
    exact: true,
  });
  await nextSale.press("Home");
  for (let increment = 0; increment < 10; increment++)
    await nextSale.press("ArrowRight");
  await expect(dialog.locator(".transfer-payment-summary")).toContainText(
    "3 instalments",
  );
  await page.screenshot({ path: "test-results/transfer-clauses-desktop.png" });
  await dialog.getByRole("button", { name: "Submit club offer" }).click();
  await expect(page).toHaveURL(new RegExp(`#contract/${target.id}$`));
  await expect(
    page.getByRole("heading", { name: "Player contract", exact: true }),
  ).toBeVisible();
  await expect(
    dialog.getByRole("combobox", { name: "Deferred instalments", exact: true }),
  ).toHaveCount(0);
  await expect(dialog.getByLabel("Proposed transfer fee")).toHaveCount(0);
  await page.reload();
  await expect(
    page.getByRole("region", { name: "Player contract negotiation" }),
  ).toBeVisible();
  const interest = dialog.locator(".interest-assessment");
  await interest.locator("summary").click();
  await expect(interest).toContainText("Role and playing time");
  await expect(interest).toContainText("Language and family");
  const previousInterest = await interest.locator("summary").innerText();
  await dialog.getByLabel("Proposed weekly wage").fill("1");
  await expect(interest.locator("summary")).not.toHaveText(previousInterest);
  await expect(
    dialog.getByRole("button", { name: "Submit personal terms" }),
  ).toBeVisible();
  await dialog
    .getByLabel("Proposed weekly wage")
    .fill(String(Math.round(target.wage * 2)));
  await expect(
    dialog.getByRole("button", { name: "Submit personal terms" }),
  ).toBeVisible();
  await dialog.getByRole("button", { name: "Submit personal terms" }).click();
  await expect(
    dialog.getByRole("button", { name: "Sign conditional agreement" }),
  ).toBeVisible();
  await dialog
    .getByRole("button", { name: "Sign conditional agreement" })
    .click();
  await expect(dialog.locator(".negotiation-sheet-top .badge")).toHaveText(
    "Medical",
  );
  const result = await request.post("/api/advance", {
    data: { days: 3 },
    timeout: 180000,
  });
  expect(result.status()).toBe(200);
  const player = await (await request.get(`/api/players/${target.id}`)).json();
  expect(player.player.club_id).toBe(bootstrap.club.id);
  const after = await (await request.get("/api/bootstrap")).json();
  expect(after.club.transfer_budget).toBeLessThan(
    bootstrap.club.transfer_budget,
  );
  const desk = await (await request.get("/api/transfers")).json();
  const payments = desk.payments.filter(
    (payment: { negotiation_id: number }) =>
      payment.negotiation_id === negotiation.id,
  );
  expect(payments).toHaveLength(3);
  expect(
    payments.reduce(
      (total: number, payment: { amount: number }) => total + payment.amount,
      0,
    ),
  ).toBeCloseTo(Math.round(negotiation.asking_price) / 2, 2);
  expect(player.buyBackClauses[0].beneficiary_id).toBe(target.club_id);
  expect(player.sellOnClauses[0].percentage).toBe(10);
  await page.goto("/#transfers");
  await page.reload();
  await page.getByRole("tab", { name: /Clauses & payments/ }).click();
  await expect(
    page
      .locator(".data-table")
      .first()
      .locator("tbody tr")
      .filter({ hasText: target.name }),
  ).toHaveCount(3);
  await page.setViewportSize({ width: 390, height: 844 });
  await noOverflow(page);
  await page.screenshot({
    path: "test-results/transfer-payments-mobile.png",
    fullPage: true,
  });
  await page.goto("/#finances");
  await page
    .getByRole("tab", { name: "Transfer payments", exact: true })
    .click();
  await expect(page.locator(".detail-list")).toContainText(
    money(Math.round(negotiation.asking_price) / 2),
  );
});

test("journalists cover real signings with persistent analysis and supporter discussions", async ({
  page,
  request,
}) => {
  const feed = await (
    await request.get("/api/media?scope=club&topic=transfer")
  ).json();
  const signing = feed.stories.find(
    (story: { report?: { status: string; playerId?: number } }) =>
      story.report?.status === "Confirmed" && story.report.playerId,
  );
  expect(signing).toBeTruthy();
  const reporter = feed.journalists.find(
    (journalist: { id: string }) =>
      journalist.id === signing.report.journalistId,
  );
  await page.goto("/#media");
  await page
    .getByLabel("Media topic", { exact: true })
    .selectOption("transfer");
  const search = page.getByRole("textbox", {
    name: "Search media stories",
    exact: true,
  });
  await search.pressSequentially(signing.report.playerName, { delay: 20 });
  await expect(search).toHaveValue(signing.report.playerName);
  const article = page.getByRole("article", {
    name: signing.title,
    exact: true,
  });
  await expect(article).toBeVisible();
  await expect(article).toContainText("Confirmed");
  await article.locator("summary").filter({ hasText: "Read analysis" }).click();
  await expect(article).toContainText(signing.report.paragraphs[1]);
  await article.locator("summary").filter({ hasText: "Discussion" }).click();
  await expect(article.locator(".media-comment")).toHaveCount(
    signing.report.comments.length,
  );
  await expect(article.locator(".media-comment").first()).toContainText(
    signing.report.comments[0].text,
  );
  await noOverflow(page);
  await page.screenshot({
    path: "test-results/media-discussion-desktop.png",
    fullPage: true,
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await noOverflow(page);
  await page.screenshot({
    path: "test-results/media-discussion-mobile.png",
    fullPage: true,
  });
  await article
    .getByRole("button", { name: reporter.name, exact: true })
    .click();
  const profile = page.getByRole("dialog", {
    name: reporter.name,
    exact: true,
  });
  await expect(profile).toContainText("Fictional journalist");
  await expect(profile).toContainText(reporter.outlet);
  await profile
    .getByRole("button", { name: "Read coverage", exact: true })
    .click();
  await expect(
    page.getByLabel("Media journalist", { exact: true }),
  ).toHaveValue(reporter.id);
  await page.getByRole("tab", { name: /Journalists/ }).click();
  await expect(page.locator(".journalist-profile")).toHaveCount(
    feed.journalists.length,
  );
  await noOverflow(page);
  await page.screenshot({
    path: "test-results/journalists-mobile.png",
    fullPage: true,
  });
  await page.getByRole("tab", { name: "Supporter feed", exact: true }).click();
  await expect(
    page.locator(".supporter-discussions .media-comment").first(),
  ).toBeVisible();
  const persisted = await (
    await request.get("/api/media?scope=club&topic=transfer")
  ).json();
  expect(
    persisted.stories.find((story: { id: number }) => story.id === signing.id)
      .report.comments,
  ).toEqual(signing.report.comments);
  await page.getByRole("tab", { name: "Press room", exact: true }).click();
  await expect(page.locator(".press-question")).toContainText("sporting plan");
  await page.getByRole("button", { name: /Trust the process/ }).click();
  await expect(
    page.getByRole("tab", { name: "News feed", exact: true }),
  ).toHaveAttribute("aria-selected", "true");
  await expect(page.locator(".media-article").first()).toContainText(
    "A measured message from the director",
  );
  await page.setViewportSize({ width: 320, height: 740 });
  await noOverflow(page);
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
  const dialog = page.locator(".offer-negotiation");
  await dialog.getByRole("button", { name: "Request formal talks" }).click();
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
  await expect(page).toHaveURL(new RegExp(`#contract/${target.id}$`));
  await expect(
    dialog.getByRole("slider", { name: /Borrowing club salary share/ }),
  ).toHaveCount(0);
  await dialog.getByRole("button", { name: "Submit personal terms" }).click();
  await dialog
    .getByRole("button", { name: "Sign conditional agreement" })
    .click();
  await expect(dialog.locator(".negotiation-sheet-top .badge")).toHaveText(
    "Medical",
  );
  expect(
    (
      await request.post("/api/advance", { data: { days: 3 }, timeout: 180000 })
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
    // v4 leagues start on 8 August; on 11 July every EN, DE and LU senior league plays a pre-season round (126 friendlies).
    expect(result.matches).toBeGreaterThan(100);
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
  expect(
    await page.locator(".data-table tbody tr").count(),
  ).toBeGreaterThanOrEqual(22);
  await page.getByRole("tab", { name: "Pitch analysis" }).click();
  await page.setViewportSize({ width: 390, height: 844 });
  await noOverflow(page);
  await page.screenshot({
    path: "test-results/match-mobile.png",
    fullPage: true,
  });
  expect((await request.get("/api/health")).status()).toBe(200);
});

test("world browsing opens any team and linked player profiles", async ({
  page,
  request,
}) => {
  await page.goto("/#world");
  await expect(
    page.getByRole("heading", { name: "World browser" }),
  ).toBeVisible();
  const response = await (
    await request.get("/api/world/clubs?pageSize=30")
  ).json();
  await expect(page.locator(".filter-total")).toContainText(
    compactNumber(response.total),
  );
  const first = await page.locator(".world-table tbody tr").first().innerText();
  await page.getByRole("button", { name: "Next world page" }).click();
  await expect(page.locator(".world-table tbody tr").first()).not.toHaveText(
    first,
  );
  await page.getByLabel("World team type").selectOption("bteam");
  await expect(page.locator(".world-table tbody tr").first()).toContainText(
    "B team",
  );
  await page.getByRole("button", { name: "Reset world filters" }).click();
  // Senior clubs come first in reputation order, so a name search opens the club before its B team.
  const club = (response.clubs as { name: string; type: string }[]).find(
    (entry) => entry.type === "club",
  )!;
  await page.getByLabel("Search world teams").fill(club.name);
  const result = page.locator(".world-table tbody .team-link").first();
  await expect(result).toContainText(club.name);
  await result.click();
  const team = page.getByRole("dialog", { name: "Team profile" });
  await expect(
    team.getByRole("heading", { name: club.name, exact: true }),
  ).toBeVisible();
  await team.getByRole("tab", { name: /Squads/ }).click();
  await team.locator(".player-name").first().click();
  await expect(
    page.getByRole("dialog", { name: "Player dossier" }),
  ).toBeVisible();
  await page.getByRole("dialog").locator(".profile-meta .team-link").click();
  await expect(team).toBeVisible();
  await page.screenshot({ path: "test-results/team-desktop.png" });
  await page.setViewportSize({ width: 390, height: 844 });
  const dimensions = await team.evaluate((element) => ({
    width: element.clientWidth,
    scroll: element.scrollWidth,
  }));
  expect(dimensions.scroll).toBeLessThanOrEqual(dimensions.width + 1);
  await page.screenshot({ path: "test-results/team-mobile.png" });
});

test("every player's seasonal history opens their complete individual match report", async ({
  page,
  request,
}) => {
  // Only the user's club family plays on the full engine and keeps a replayable match snapshot.
  const clubId = (await (await request.get("/api/bootstrap")).json()).club.id;
  const fixtures = await (
    await request.get(`/api/matches?club=${clubId}&status=played&age=Senior`)
  ).json();
  expect(fixtures.length).toBeGreaterThan(0);
  const match = await (
    await request.get(`/api/matches/${fixtures[0].id}`)
  ).json();
  const side =
    match.snapshot.away.id === clubId ? match.snapshot.away : match.snapshot.home;
  const player =
    side.bench.find(
      (candidate: { id: number }) =>
        match.result.players[candidate.id]?.minutes > 0,
    ) ?? side.lineup[0];
  const career = await (
    await request.get(`/api/players/${player.id}/career`)
  ).json();
  expect(career.total).toBeGreaterThan(0);
  const appearance = career.appearances.find(
    (entry: { fixture_id: number }) => entry.fixture_id === fixtures[0].id,
  );
  expect(appearance.minutes).toBe(match.result.players[player.id].minutes);
  expect(appearance.rating).toBe(match.result.players[player.id].rating);
  await page.goto("/#database");
  await page.getByLabel("Search players", { exact: true }).fill(player.name);
  await page
    .locator(".player-name")
    .filter({ hasText: player.name })
    .first()
    .click();
  const dossier = page.getByRole("dialog", { name: "Player dossier" });
  await dossier.getByRole("tab", { name: "Career & matches" }).click();
  await expect(dossier.getByLabel("Player career season")).toHaveValue(
    String(fixtures[0].season),
  );
  await dossier
    .locator(".career-matches-table tbody tr")
    .filter({ hasText: appearance.home_name })
    .first()
    .getByRole("button", { name: "Match report", exact: true })
    .click();
  await expect(
    page.getByRole("tab", { name: "Player report", exact: true }),
  ).toHaveAttribute("aria-selected", "true");
  await expect(page.getByLabel("Player match report")).toHaveValue(
    String(player.id),
  );
  await expect(page.locator(".individual-report-heading")).toContainText(
    `${appearance.minutes}' played`,
  );
  await expect(page.locator(".individual-match-rating")).toContainText(
    appearance.rating.toFixed(1),
  );
  await expect(page.locator(".individual-stat-grid")).toContainText(
    "Progressive passes",
  );
  await expect(page.locator("canvas.pitch-canvas")).toBeVisible();
  await page.screenshot({
    path: "test-results/player-match-desktop.png",
    fullPage: true,
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await noOverflow(page);
  await page.screenshot({
    path: "test-results/player-match-mobile.png",
    fullPage: true,
  });
});

test("career club picker groups divisions and preserves the selected appointment without changing the save", async ({
  page,
  request,
}) => {
  const before = await (await request.get("/api/bootstrap")).json();
  await page.goto("/#start");
  await page.getByRole("button", { name: /New career/ }).click();
  await page
    .getByLabel("Career club country")
    .selectOption(String(before.club.country_id));
  await page.getByLabel("Career club division").selectOption("2");
  const division = await (
    await request.get(
      `/api/world/clubs?type=club&sort=division&country=${before.club.country_id}&tier=2`,
    )
  ).json();
  expect(division.clubs.length).toBeGreaterThan(0);
  const selected = division.clubs[0];
  const rows = page.locator(".career-club-list > button");
  await expect(rows).toHaveCount(division.clubs.length);
  await expect(rows.first()).toContainText(selected.name);
  await expect(rows.first()).toContainText(`${selected.league_name} / Tier 2`);
  await expect(page.locator(".career-division-heading")).toContainText(
    selected.league_name,
  );
  await rows.first().click();
  await expect(page.locator(".selected-club-note")).toContainText(
    selected.name,
  );
  await page.getByLabel("Find career club").fill("No matching club 99999");
  await page.getByLabel("Find career club").press("Enter");
  await expect(
    page.getByText("No clubs match these filters.", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Start career", exact: true }),
  ).toBeEnabled();
  await page.getByLabel("Find career club").fill("");
  await page.getByLabel("Career club country").selectOption("");
  await page.getByLabel("Career club division").selectOption("");
  await page.getByRole("button", { name: "Next career club page" }).click();
  const secondPage = await (
    await request.get("/api/world/clubs?type=club&sort=division&page=2")
  ).json();
  await expect(rows.first()).toContainText(secondPage.clubs[0].name);
  await expect(page.locator(".career-club-pagination")).toContainText(
    `2 / ${secondPage.pages}`,
  );
  await expect(page.locator(".selected-club-note")).toContainText(
    selected.name,
  );
  await expect(page.locator(".selected-club-note")).toContainText(
    selected.league_name,
  );
  await page
    .getByLabel("Career club country")
    .selectOption(String(before.club.country_id));
  await page.getByLabel("Career club division").selectOption("2");
  await expect(rows.first()).toHaveAttribute("aria-pressed", "true");
  await noOverflow(page);
  await page.screenshot({
    path: "test-results/career-picker-desktop.png",
    fullPage: true,
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await noOverflow(page);
  await page.screenshot({
    path: "test-results/career-picker-mobile.png",
    fullPage: true,
  });
  expect((await bootstrapOf(request)).state).toEqual(before.state);
});

test("start menu creates, loads and safely deletes a separate career", async ({
  page,
  request,
}) => {
  test.setTimeout(720000);
  const before = await (await request.get("/api/bootstrap")).json();
  // England has no B teams in world v4, so a club name matches exactly one picker entry.
  const choice = (
    await (
      await request.get(
        `/api/world/clubs?type=club&country=${before.club.country_id}&pageSize=30`,
      )
    ).json()
  ).clubs.find((club: { id: number }) => club.id !== before.club.id);
  const saved = await (
    await request.post("/api/saves", {
      data: { name: "Career menu regression" },
      timeout: 180000,
    })
  ).json();
  await page.goto("/");
  await expect(
    page.getByRole("button", { name: "Continue career", exact: true }),
  ).toBeVisible();
  await page.screenshot({
    path: "test-results/career-start-desktop.png",
    fullPage: true,
  });
  await page.getByRole("button", { name: /New career/ }).click();
  await page.getByLabel("Career name", { exact: true }).fill("Second career");
  await page
    .getByLabel("Director name", { exact: true })
    .fill("Jamie Director");
  await page
    .getByRole("combobox", { name: "Background", exact: true })
    .selectOption("Academy director");
  await page.getByLabel("Find career club").fill(choice.name);
  await page
    .locator(".club-chooser-list button")
    .filter({ has: page.getByText(choice.name, { exact: true }) })
    .click();
  // Archiving the current career rotates its manual saves once it keeps 10.
  const replaced = savesReplacedByManualSave(
    await (await retryBusyResponse(() => request.get("/api/saves"))).json(),
    (await bootstrapOf(request)).state.careerId,
  );
  await page.getByRole("button", { name: "Start career", exact: true }).click();
  if (replaced.length) {
    const replace = page.getByRole("dialog", { name: "Replace your oldest save?" });
    await expect(replace).toContainText(replaced[0].name);
    await replace
      .getByRole("button", { name: "Replace and start", exact: true })
      .click();
  }
  await expect(
    page.getByRole("heading", { name: "Good morning, Jamie." }),
  ).toBeVisible({ timeout: 480000 });
  const created = await (await request.get("/api/bootstrap")).json();
  expect(created.state.date).toBe("2026-07-01");
  expect(created.state.careerName).toBe("Second career");
  expect(created.club.id).toBe(choice.id);
  const localClubs = await (
    await request.get(
      `/api/world/clubs?type=club&country=${created.club.country_id}&pageSize=100`,
    )
  ).json();
  const localIds = new Set(
    localClubs.clubs.map((club: { id: number }) => club.id),
  );
  const prospects = await (
    await request.get(
      `/api/players?contractStatus=amateur&ageMin=16&ageMax=17&country=${created.club.country_id}&pageSize=100`,
    )
  ).json();
  let youth;
  for (const prospect of prospects.players) {
    if (prospect.club_id === created.club.id || !localIds.has(prospect.club_id))
      continue;
    const detail = await (
      await request.get(`/api/players/${prospect.id}`)
    ).json();
    if (detail.youthTransfer.canApproachWithoutFee) {
      youth = detail;
      break;
    }
  }
  expect(youth).toBeTruthy();
  await page.goto(`/#offer/${youth.player.id}`);
  await page
    .getByRole("combobox", { name: "Offer type", exact: true })
    .selectOption("youth");
  await page
    .getByRole("button", { name: "Continue to negotiation", exact: true })
    .click();
  await expect(page).toHaveURL(new RegExp(`#contract/${youth.player.id}$`));
  await expect(
    page.getByRole("heading", { name: "Player contract", exact: true }),
  ).toBeVisible();
  await expect(page.getByLabel("Proposed transfer fee")).toHaveCount(0);
  await expect(page.locator(".offer-negotiation")).toContainText(
    "No club transfer fee",
  );
  await expect(page.getByLabel("Proposed weekly wage")).toBeVisible();
  expect(
    (await (await request.get(`/api/players/${youth.player.id}`)).json()).player
      .club_id,
  ).toBe(youth.player.club_id);
  const progression = await request.post("/api/advance", {
    data: { days: 3 },
    timeout: 180000,
  });
  expect(progression.status()).toBe(200);
  expect(await progression.json()).toMatchObject({
    days: 3,
    date: "2026-07-04",
  });
  await page
    .getByRole("button", { name: "Career start menu", exact: true })
    .click();
  await page.getByRole("button", { name: /Load career/ }).click();
  await page.getByLabel("Search saved careers").fill("Career menu regression");
  await page
    .locator(".career-save-item")
    .first()
    .getByRole("button", { name: "Load career", exact: true })
    .click();
  const loadedCareer = page.waitForResponse(
    (response) =>
      response.url().endsWith("/api/careers/load") &&
      response.request().method() === "POST",
    { timeout: 180000 },
  );
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Load career", exact: true })
    .click();
  const loadResponse = await loadedCareer;
  expect(loadResponse.ok(), await loadResponse.text()).toBe(true);
  await expect(
    page.getByRole("heading", {
      name: `Good morning, ${before.state.director.name.split(" ")[0]}.`,
    }),
  ).toBeVisible();
  const restored = await (await request.get("/api/bootstrap")).json();
  expect(restored.state.date).toBe(before.state.date);
  expect(restored.club.id).toBe(before.club.id);
  const slots = await (await request.get("/api/saves")).json();
  expect(slots.some((slot: { file: string }) => slot.file === saved.file)).toBe(
    true,
  );
  expect(
    slots.some(
      (slot: { career?: { name: string } }) =>
        slot.career?.name === "Second career",
    ),
  ).toBe(true);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/#start");
  await expect(
    page.getByRole("button", { name: "Continue career", exact: true }),
  ).toBeVisible();
  await noOverflow(page);
  await page.screenshot({
    path: "test-results/career-start-mobile.png",
    fullPage: true,
  });
  await page.getByRole("button", { name: /Load career/ }).click();
  await expect(
    page
      .getByRole("button", { name: "Active career cannot be deleted" })
      .first(),
  ).toBeDisabled();
  const secondCareer = page.locator(
    `.career-save-item[data-career-id="${created.state.careerId}"]`,
  );
  const secondSlots = slots.filter(
    (slot: { career?: { id: string } }) =>
      slot.career?.id === created.state.careerId,
  );
  await expect(secondCareer).toHaveCount(1);
  await secondCareer
    .first()
    .getByRole("button", { name: "Delete career Second career", exact: true })
    .click();
  const deletion = page.getByRole("dialog", {
    name: "Delete this career?",
    exact: true,
  });
  await expect(deletion).toContainText(`${secondSlots.length} saved snapshots`);
  await deletion.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(secondCareer).toHaveCount(1);
  await secondCareer
    .first()
    .getByRole("button", { name: "Delete career Second career", exact: true })
    .click();
  await page.screenshot({ path: "test-results/career-delete-mobile.png" });
  await deletion
    .getByRole("button", { name: "Delete career", exact: true })
    .click();
  await expect(deletion).not.toBeVisible();
  await expect(secondCareer).toHaveCount(0);
  const afterDelete = await (await request.get("/api/saves")).json();
  expect(afterDelete.map((slot: { file: string }) => slot.file)).toEqual(
    slots
      .filter(
        (slot: { career?: { id: string } }) =>
          slot.career?.id !== created.state.careerId,
      )
      .map((slot: { file: string }) => slot.file),
  );
  expect(
    afterDelete.some((slot: { file: string }) => slot.file === saved.file),
  ).toBe(true);
  expect((await bootstrapOf(request)).state).toEqual(restored.state);
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.getByLabel("Search saved careers").fill("Career menu regression");
  await noOverflow(page);
  await page.screenshot({
    path: "test-results/career-saves-desktop.png",
    fullPage: true,
  });
});

type Direction = "asc" | "desc";
const ariaSortOf = (direction: Direction) =>
  direction === "asc" ? "ascending" : "descending";

/** Cell texts of one column, split into the table's row groups. */
async function columnGroups(table: Locator, label: string) {
  return await table.evaluate((element, text) => {
    const headers = [...element.querySelectorAll("thead th")];
    const index = headers.findIndex(
      (header) => header.querySelector(".sort-button > span")?.textContent === text,
    );
    const groups: string[][] = [[]];
    for (const row of element.querySelectorAll("tbody tr")) {
      if (row.classList.contains("roster-group-row")) groups.push([]);
      else groups[groups.length - 1].push(row.children[index]?.textContent?.trim() ?? "");
    }
    return groups.filter((group) => group.length);
  }, label);
}

function expectOrdered(values: number[], direction: Direction) {
  for (let index = 1; index < values.length; index++)
    if (direction === "asc") expect(values[index]).toBeGreaterThanOrEqual(values[index - 1]);
    else expect(values[index]).toBeLessThanOrEqual(values[index - 1]);
}

/** Clicks a column header (or presses Enter on it) and checks aria-sort plus the order in every group. */
async function sortByHeader(
  table: Locator,
  label: string,
  direction: Direction,
  toNumber: (text: string) => number,
  keyboard = false,
) {
  const header = table.getByRole("columnheader", { name: label, exact: true });
  const button = header.getByRole("button");
  if (keyboard) {
    await button.focus();
    await button.press("Enter");
  } else await button.click();
  await expect(header).toHaveAttribute("aria-sort", ariaSortOf(direction));
  const groups = await columnGroups(table, label);
  expect(groups.flat().length).toBeGreaterThan(1);
  for (const group of groups) expectOrdered(group.map(toNumber), direction);
}

const positionIndex = (text: string) => (POSITIONS as readonly string[]).indexOf(text);

test("paginated database sorts on the server from its column headers", async ({ page }) => {
  const table = page.locator(".database-workspace .player-table");
  const header = table.getByRole("columnheader", { name: "Age", exact: true });
  async function search(action: () => Promise<unknown>, parameters: Record<string, string>) {
    const pending = page.waitForResponse((response) => {
      const url = new URL(response.url());
      return (
        url.pathname === "/api/players" &&
        Object.entries(parameters).every(([key, value]) => url.searchParams.get(key) === value)
      );
    });
    await action();
    const response = await pending;
    expect(response.ok()).toBe(true);
    const result: PlayerPage = await response.json();
    await expect(table.locator("tbody tr .player-name strong")).toHaveText(
      result.players.map((player) => player.name),
    );
    return result;
  }
  await search(() => page.goto("/#database"), { page: "1" });
  await expect(header).not.toHaveAttribute("aria-sort", /./);
  for (const direction of ["asc", "desc"] as const) {
    const first = await search(() => header.getByRole("button").click(), {
      sort: "age",
      direction,
    });
    await expect(header).toHaveAttribute("aria-sort", ariaSortOf(direction));
    expect(first.pages).toBeGreaterThan(1);
    expectOrdered(first.players.map((player) => player.age), direction);
    const second = await search(
      () => page.getByRole("button", { name: "Next player page", exact: true }).click(),
      { sort: "age", direction, page: "2" },
    );
    expectOrdered(
      [...first.players, ...second.players].map((player) => player.age),
      direction,
    );
    await search(
      () => page.getByRole("button", { name: "Previous player page", exact: true }).click(),
      { sort: "age", direction, page: "1" },
    );
  }
  const position = table.getByRole("columnheader", { name: "Pos", exact: true });
  const byPosition = await search(() => position.getByRole("button").click(), {
    sort: "position",
    direction: "asc",
  });
  await expect(position).toHaveAttribute("aria-sort", "ascending");
  await expect(header).not.toHaveAttribute("aria-sort", /./);
  expectOrdered(byPosition.players.map((player) => positionIndex(player.position)), "asc");
});

test("squad table headers sort within position groups by mouse and keyboard", async ({ page }) => {
  await page.goto("/#squad");
  const roster = page.getByRole("region", { name: "Squad players", exact: true });
  await expect(roster).toHaveAttribute("aria-busy", "false");
  const table = roster.locator("table");
  await sortByHeader(table, "Pos", "asc", positionIndex);
  await sortByHeader(table, "Pos", "desc", positionIndex, true);
  await sortByHeader(table, "Apps", "desc", Number);
  await sortByHeader(table, "Apps", "asc", Number, true);
});

test("shortlist groups, filters and sorts targets without overflow at every width", async ({
  page,
  request,
}) => {
  const bootstrap: Bootstrap = await (await request.get("/api/bootstrap")).json();
  const candidates: PlayerPage = await (
    await request.get("/api/players?sort=ability&direction=desc&pageSize=60")
  ).json();
  const targets = candidates.players
    .filter((player) => player.club_id && player.club_id !== bootstrap.club.id && !player.shortlisted)
    .slice(0, 6);
  expect(targets.length).toBe(6);
  const shortlist = async (active: boolean) => {
    for (const player of targets)
      await retryBusyResponse(() =>
        request.post("/api/action", { data: { type: "shortlist", playerId: player.id, active } }),
      );
  };
  await shortlist(true);
  try {
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.goto("/#scouting");
    await page.getByRole("tab", { name: /^Shortlist/ }).click();
    const region = page.getByRole("region", { name: "Shortlisted players", exact: true });
    const table = region.locator("table");
    const rows = table.locator("tbody tr:not(.roster-group-row)");
    await expect(region).toBeVisible();
    const total = await rows.count();
    expect(total).toBeGreaterThanOrEqual(targets.length);
    await expect(table.locator(".roster-group-row").first()).toBeVisible();
    await page.locator(".segmented-control label", { hasText: "Single list" }).click();
    await expect(table.locator(".roster-group-row")).toHaveCount(0);
    await sortByHeader(table, "Age", "asc", Number);
    await sortByHeader(table, "Age", "desc", Number, true);
    await sortByHeader(table, "Pos", "asc", positionIndex);
    await page.locator(".segmented-control label", { hasText: "Position line" }).click();
    await expect(table.getByRole("columnheader", { name: "Pos", exact: true })).toHaveAttribute(
      "aria-sort",
      "ascending",
    );
    await page.getByRole("textbox", { name: "Search shortlist", exact: true }).fill(targets[0].name);
    await expect(rows.locator(".player-name strong").first()).toHaveText(targets[0].name);
    await expect(page.getByRole("status").filter({ hasText: /of \d+ players/ })).toContainText(
      `of ${total} players`,
    );
    await page.getByRole("button", { name: "Clear shortlist filters", exact: true }).click();
    await expect(rows).toHaveCount(total);
    const status = page.getByRole("group", { name: "Shortlist status", exact: true });
    await expect(status.getByRole("button", { name: /^All statuses/ })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    for (const width of [1440, 390, 320]) {
      await page.setViewportSize({ width, height: 844 });
      await expect(region).toBeVisible();
      await expect(status).toBeVisible();
      await noOverflow(page);
      await page.screenshot({ path: `test-results/shortlist-${width}.png`, fullPage: true });
    }
  } finally {
    await page.setViewportSize({ width: 1440, height: 1000 });
    await shortlist(false);
  }
});
