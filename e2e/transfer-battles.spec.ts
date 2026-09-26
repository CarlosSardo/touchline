import { expect, test, type Page, type Route } from "@playwright/test";
import type { AccountSession, Bootstrap, PlayerDetail, TransferDesk } from "../shared/api.ts";
import type {
  Negotiation,
  NegotiationData,
  PlayerInterest,
  RivalInterest,
  TransferBattleView,
} from "../shared/types.ts";
import { DEFAULT_SETTINGS, dateLabel, money } from "../shared/rules.ts";

// Runs against a bare Vite server (TEST_URL) with every API call fulfilled here: no SQL engine.
test.use({ serviceWorkers: "block" });

const PLAYER_ID = 5;
const RIVAL_CLUB_ID = 7;

function bootstrap(): Bootstrap {
  return {
    state: {
      careerId: "battle-ui-career",
      careerName: "Battle fixture career",
      date: "2026-08-15",
      season: 2026,
      seed: "battle-ui-fixture",
      clubId: 1,
      started: true,
      director: {
        name: "Morgan Director",
        background: "Former scout",
        reputation: 40,
        experience: 0,
        skillPoints: 0,
        skills: {},
      },
      week: 7,
      worldTrend: "Balanced",
      lastAutosave: "2026-08-15",
      gameOver: false,
    },
    club: {
      id: 1,
      name: "Fixture Town",
      short_name: "FXT",
      city: "Northbridge",
      country_id: 1,
      league_id: 1,
      type: "club",
      parent_id: null,
      age_group: "Senior",
      color: "#176b52",
      reputation: 60,
      academy: 40,
      facilities: 40,
      balance: 50_000_000,
      transfer_budget: 30_000_000,
      wage_budget: 900_000,
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
      capacity: 20000,
      data: "{}",
      country_name: "England",
      country_code: "GB",
      league_name: "Fixture Division",
    },
    settings: { ...DEFAULT_SETTINGS, theme: "light", animationSpeed: "off" },
    world: { version: 3, countries: 1, leagues: 1, clubs: 3, players: 1, seniors: 1, youth: 0, staff: 0 },
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

const interest: PlayerInterest = {
  score: 72,
  moveScore: 64,
  refuses: false,
  thresholds: { negotiate: 50, agree: 85 },
  stance: "Open to the move",
  expectedRole: "Regular starter",
  expectedWage: 40_000,
  wageToAgree: 52_000,
  factors: [],
  concerns: [],
};

function playerDetail(clubId = 2, clubName = "Selling United"): PlayerDetail {
  return {
    player: {
      id: PLAYER_ID,
      name: "Jordan Fixture",
      position: "CM",
      age: 23,
      birth_date: "2003-02-01",
      club_id: clubId,
      club_name: clubName,
      parent_club_id: null,
      role: "Regular starter",
      value: 10_000_000,
      wage: 30_000,
      contract_end: "2029-06-30",
      ability: 70,
      potential: 76,
    },
    profile: { homeBased: false },
    interest,
    youthTransfer: { minor: false, eligibleToApply: true, canApproachWithoutFee: false },
  } as unknown as PlayerDetail;
}

const rivalAthletic = (overrides: Partial<RivalInterest> = {}): RivalInterest => ({
  key: `11:${RIVAL_CLUB_ID}`,
  clubId: RIVAL_CLUB_ID,
  clubName: "Rival Athletic",
  countryName: "England",
  reputation: 66,
  certainty: "confirmed",
  status: "bid",
  feeRange: { low: 9_000_000, high: 11_000_000 },
  preference: "undecided",
  since: "2026-08-10",
  negotiationId: 11,
  outcome: null,
  ...overrides,
});
const rumoured: RivalInterest = {
  key: "11:9",
  clubId: null,
  clubName: "A club in Spain",
  countryName: "Spain",
  reputation: null,
  certainty: "rumoured",
  status: "monitoring",
  feeRange: null,
  preference: "unknown",
  since: "2026-08-12",
  negotiationId: 11,
  outcome: null,
};

function negotiation(
  stage: string,
  battle: TransferBattleView | null,
  rivals: RivalInterest[],
  log: NegotiationData["log"],
): Negotiation {
  const data = {
    workflowVersion: 2,
    log,
    agent: { name: "Sam Agent", personality: "Calm", difficulty: 40, commission: 5 },
    terms: {},
    years: 4,
    role: "Squad player",
    promises: [],
  };
  return {
    id: 11,
    player_id: PLAYER_ID,
    buying_club_id: 1,
    selling_club_id: 2,
    type: "Permanent transfer",
    stage,
    tension: 20,
    asking_price: 11_000_000,
    offer: 10_000_000,
    wage: 40_000,
    interest: 72,
    created: "2026-08-08",
    deadline: "2026-08-22",
    public: 0,
    data: JSON.stringify(data),
    player_name: "Jordan Fixture",
    position: "CM",
    age: 23,
    ability: 70,
    potential: 76,
    buyer_name: "Fixture Town",
    seller_name: "Selling United",
    rivals,
    battle,
  };
}

function desk(negotiations: Negotiation[]): TransferDesk {
  return { payments: [], buyBackClauses: [], sellOnClauses: [], negotiations, targets: [], market: [] };
}

interface BattleApi {
  player: PlayerDetail;
  desk: TransferDesk;
  deskGate?: Promise<void>;
  failBootstrap: number;
  actions: unknown[];
}

async function mockApi(page: Page, api: BattleApi) {
  const session: AccountSession = {
    user: { id: "battle-ui-account", displayName: "Morgan", email: "morgan@example.test" },
    hasWorld: true,
    activity: null,
  };
  const world = bootstrap();
  await page.route("**/api/**", async (route: Route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    const key = `${request.method()} ${path}`;
    if (key === "GET /api/me") return route.fulfill({ json: session });
    if (key === "GET /api/bootstrap") {
      if (api.failBootstrap > 0) {
        api.failBootstrap--;
        return route.fulfill({ status: 500, json: { error: "Temporary failure." } });
      }
      return route.fulfill({ json: world });
    }
    if (key === "GET /api/transfers") {
      await api.deskGate;
      return route.fulfill({ json: api.desk }).catch(() => undefined);
    }
    if (key === `GET /api/players/${PLAYER_ID}`) return route.fulfill({ json: api.player });
    if (key === `GET /api/players/${PLAYER_ID}/interest`) return route.fulfill({ json: interest });
    if (key === "POST /api/action") {
      api.actions.push(request.postDataJSON());
      return route.fulfill({ json: { message: "Your interest is now public." } });
    }
    // The shell's side panels (news, etc.) are outside this fixture.
    if (request.method() === "GET")
      return route.fulfill({ status: 404, json: { error: "Not part of this fixture." } });
    return route.fulfill({ status: 501, json: { error: `Unhandled fixture request: ${key}` } });
  });
}

async function noOverflow(page: Page) {
  // Polls: the layout settles a frame or two after a viewport change.
  await expect
    .poll(() =>
      page.evaluate(() => ({
        fits: document.documentElement.scrollWidth <= innerWidth + 1,
        wide: [...document.querySelectorAll("#main-content *")]
          .filter((element) => element.getBoundingClientRect().right > innerWidth + 1)
          .slice(0, 5)
          .map((element) => `${element.tagName}.${element.className}`),
      })),
    )
    // `wide` only names the culprits in a failure message; scroll containers may legitimately hold wide children.
    .toMatchObject({ fits: true });
}

test("best and final offers explain the deadline, the leading bid and how to lodge your final offer", async ({ page }) => {
  let release!: () => void;
  const api: BattleApi = {
    player: playerDetail(),
    desk: desk([
      negotiation(
        "Club talks",
        {
          status: "final-offers",
          finalOffersDeadline: "2026-08-20",
          yourFinalOffer: null,
          decisionDeadline: null,
          leadingBid: { low: 9_500_000, high: 10_500_000 },
          message: "Selling United want best and final offers by 2026-08-20.",
        },
        [rivalAthletic(), rumoured],
        [{ date: "2026-08-14", type: "Rival", message: "Selling United will decide on 2026-08-20." }],
      ),
    ]),
    deskGate: new Promise<void>((resolve) => { release = resolve; }),
    failBootstrap: 0,
    actions: [],
  };
  await mockApi(page, api);
  const detail = page.waitForResponse(
    (response) => new URL(response.url()).pathname === `/api/players/${PLAYER_ID}`,
  );
  await page.goto(`/#offer/${PLAYER_ID}`);
  await detail;
  // Until the desk answers, an open deal must not look like a fresh offer.
  await expect(page.locator(".loading-state").first()).toBeVisible();
  await expect(page.getByRole("button", { name: "Continue to negotiation", exact: true })).toHaveCount(0);
  await expect(page.getByRole("radio", { name: "Transfer offer", exact: true })).toHaveCount(0);
  release();
  await expect(page.getByRole("heading", { name: "Club offer", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Continue to negotiation", exact: true })).toHaveCount(0);

  const panel = page.getByRole("region", { name: "Rival interest", exact: true });
  await expect(panel).toContainText("Best and final offers");
  await expect(panel).toContainText(`due ${dateLabel("2026-08-20")}`);
  await expect(panel).toContainText(`${money(9_500_000)} – ${money(10_500_000)}`);
  await expect(panel).toContainText("Your final offer");
  await expect(panel).toContainText("Not lodged yet");
  await expect(panel).toContainText("Submit club offer");
  const rows = panel.locator(".rival-row");
  await expect(rows).toHaveCount(2);
  await expect(rows.nth(0)).toContainText("Rival Athletic");
  await expect(rows.nth(0)).toContainText("Confirmed");
  await expect(rows.nth(0)).toContainText("Bid made");
  // Browser and Node ICU differ on compact trailing zeros ("£9M" vs "£9.0M").
  await expect(rows.nth(0)).toContainText(/£9(\.0)?M – £11(\.0)?M/);
  await expect(rows.nth(0)).toContainText("Undecided");
  await expect(rows.nth(1)).toContainText("A club in Spain");
  await expect(rows.nth(1)).toContainText("Rumour");
  await expect(rows.nth(1)).toContainText("No bid yet");
  await expect(rows.nth(1).getByRole("button")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Submit club offer", exact: true })).toBeVisible();
  await expect(page.locator(".negotiation-latest")).toContainText(dateLabel("2026-08-20"));
  await expect(page.locator("#main-content")).not.toContainText("2026-08-20");
  for (const width of [390, 320]) {
    await page.setViewportSize({ width, height: 844 });
    await expect(panel).toBeVisible();
    await noOverflow(page);
  }
  await page.setViewportSize({ width: 1440, height: 1000 });

  // The action succeeds but the follow-up refresh fails: report success, warn softly and stay on the deal.
  api.failBootstrap = 1;
  await page.getByRole("button", { name: "Declare interest", exact: true }).click();
  const toast = page.locator(".dynamic-island");
  await expect(toast).toContainText("Your interest is now public.");
  await expect(toast).toContainText("Couldn't refresh");
  await expect(toast).toHaveAttribute("role", "status");
  await expect(page.getByRole("heading", { name: "Club offer", exact: true })).toBeVisible();
  expect(api.actions).toEqual([{ type: "negotiation", id: 11, action: "declare" }]);
});

test("the player decision names the deadline and the terms that keep him", async ({ page }) => {
  const api: BattleApi = {
    player: playerDetail(),
    desk: desk([
      negotiation(
        "Agent talks",
        {
          status: "decision",
          finalOffersDeadline: null,
          yourFinalOffer: null,
          decisionDeadline: "2026-08-17",
          leadingBid: null,
          message: "The player will choose between the clubs with agreed fees on 2026-08-17.",
        },
        [rivalAthletic({ status: "fee-agreed", preference: "rival" })],
        [{ date: "2026-08-14", type: "Club", message: "Club terms agreed at £10M." }],
      ),
    ]),
    failBootstrap: 0,
    actions: [],
  };
  await mockApi(page, api);
  await page.goto(`/#contract/${PLAYER_ID}`);
  const panel = page.getByRole("region", { name: "Rival interest", exact: true });
  await expect(panel).toContainText("Player decision");
  await expect(panel).toContainText(`The player chooses on ${dateLabel("2026-08-17")}`);
  await expect(panel).toContainText("Agree personal terms he accepts");
  await expect(panel.locator(".rival-row")).toContainText("Fee agreed");
  await expect(panel.locator(".rival-row")).toContainText("Leaning towards them");
  await expect(panel).not.toContainText("2026-08-17");
});

test("a hijacked deal explains which rival signed the player and why the talks closed", async ({ page }) => {
  const api: BattleApi = {
    player: playerDetail(RIVAL_CLUB_ID, "Rival Athletic"),
    desk: desk([
      negotiation(
        "Hijacked",
        { status: "open", finalOffersDeadline: null, yourFinalOffer: null, decisionDeadline: null, leadingBid: null, message: "No active rival interest." },
        [rivalAthletic({ status: "won", preference: "rival", outcome: "The player chose Rival Athletic's package." }), rumoured],
        [{ date: "2026-08-16", type: "Rival", message: "Rival Athletic completed the signing." }],
      ),
    ]),
    failBootstrap: 0,
    actions: [],
  };
  await mockApi(page, api);
  await page.goto(`/#offer/${PLAYER_ID}`);
  await expect(page.getByRole("heading", { name: "Make an offer", exact: true })).toBeVisible();
  const panel = page.getByRole("region", { name: "Rival interest", exact: true });
  await expect(panel).toContainText("Hijacked");
  await expect(panel).toContainText("Rival Athletic signed the player.");
  await expect(panel).toContainText("The player chose Rival Athletic's package.");
  await expect(panel).toContainText("Only a signed conditional agreement protects a deal");
  await expect(panel.locator(".rival-row").first()).toContainText("Signed the player");
  await page.setViewportSize({ width: 320, height: 740 });
  await noOverflow(page);
});
