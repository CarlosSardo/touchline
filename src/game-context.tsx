import {
  Fragment,
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import type {
  AccountSession,
  Bootstrap,
  DeleteActiveCareerRequest,
  DeleteActiveCareerResult,
  WorldActivity,
  WorldBusyResponse,
} from "../shared/api.ts";
import {
  ApiError,
  accessIssueFromFailure,
  isAccessIssue,
  isOutcomeUnknown,
  isWorldBusy,
  type AccessIssue,
} from "./api-error.ts";
import { localizeServerText } from "./money-text.ts";
import { createLruCache } from "./resource-cache.ts";
import { plural } from "./format.ts";
import type { Settings } from "../shared/types.ts";
import {
  accountingAmount,
  currencyCode,
  DEFAULT_SETTINGS,
  displayAmount,
  money as formatMoney,
} from "../shared/rules.ts";

export type Page =
  | "start"
  | "office"
  | "inbox"
  | "squad"
  | "scouting"
  | "database"
  | "world"
  | "transfers"
  | "offer"
  | "contract"
  | "loans"
  | "academy"
  | "training"
  | "staff"
  | "competitions"
  | "analytics"
  | "finances"
  | "board"
  | "media"
  | "settings";
export interface ActionResult {
  message?: string;
  id?: number;
  stage?: string;
  [key: string]: unknown;
}
interface GameContextValue {
  session: AccountSession | null;
  loading: boolean;
  accountGeneration: number;
  bootstrap: Bootstrap | null;
  error: string | null;
  accessIssue: AccessIssue | null;
  worldActivity: WorldActivity | null;
  checkActivity: () => void;
  waitForIdle: () => Promise<Bootstrap | null | undefined>;
  deleteActiveCareer: (request: DeleteActiveCareerRequest) => Promise<void>;
  revision: number;
  page: Page;
  busy: boolean;
  toast: { message: string; tone: string } | null;
  playerId: number | null;
  clubProfileId: number | null;
  matchPlayerId: number | null;
  leagueId: number | null;
  fixtureId: number | null;
  offerPlayerId: number | null;
  search: string;
  confirmation: { title: string; message: string; action: () => void } | null;
  navigate: (page: Page) => void;
  setPlayer: (id: number | null) => void;
  setClub: (id: number | null) => void;
  openLeague: (id: number) => void;
  openMatch: (id: number, playerId?: number) => void;
  openOffer: (playerId: number) => void;
  openContract: (playerId: number) => void;
  setSearch: (value: string) => void;
  notify: (message: string, tone?: string) => void;
  dismissToast: () => void;
  act: (
    body: Record<string, unknown>,
    message?: string,
  ) => Promise<ActionResult | undefined>;
  refresh: () => Promise<Bootstrap | null | undefined>;
  advance: (days: number) => Promise<void>;
  changeSettings: (settings: Settings) => Promise<void>;
  confirm: (title: string, message: string, action: () => void) => void;
  closeConfirm: () => void;
}

const GameContext = createContext<GameContextValue | null>(null);
const sessionFailureEvent = "touchline:session-failure";
const worldBusyEvent = "touchline:world-busy";
let requestGeneration = 0;
let mutationsInFlight = 0;

function isSessionFailure(failure: unknown): failure is ApiError {
  return (
    failure instanceof ApiError &&
    (failure.status === 401 || failure.status === 403 || isAccessIssue(failure))
  );
}

export async function api<Data>(
  path: string,
  init?: RequestInit,
): Promise<Data> {
  const generation = requestGeneration;
  const checkGeneration = () => {
    if (generation !== requestGeneration)
      throw new DOMException("The signed-in account changed.", "AbortError");
  };
  const mutating = (init?.method ?? "GET").toUpperCase() !== "GET";
  if (mutating) mutationsInFlight++;
  try {
    return await request<Data>(path, init, checkGeneration);
  } finally {
    if (mutating) mutationsInFlight--;
  }
}

async function request<Data>(
  path: string,
  init: RequestInit | undefined,
  checkGeneration: () => void,
): Promise<Data> {
  const response = await fetch(`/api/${path}`, {
    cache: "no-store",
    credentials: "same-origin",
    ...init,
    headers: {
      ...(init?.body && !(init.body instanceof Blob)
        ? { "Content-Type": "application/json" }
        : {}),
      ...init?.headers,
    },
  });
  checkGeneration();
  if (!response.ok || response.redirected) {
    const body = await response
      .json()
      .catch(() => ({ error: `Request failed (${response.status})` }));
    checkGeneration();
    const busy =
      !response.redirected &&
      response.status === 409 &&
      body?.code === "world_busy"
        ? (body as WorldBusyResponse)
        : null;
    const retryAfter = Number(response.headers.get("Retry-After"));
    const signedOut = response.redirected || response.status === 401;
    const failure = new ApiError(
      signedOut
        ? "Your session has expired. Sign in again to continue."
        : body?.error ?? "The game could not complete that action.",
      signedOut ? 401 : response.status,
      {
        code: signedOut
          ? "authentication_required"
          : typeof body?.code === "string" ? body.code : undefined,
        retryAfter: retryAfter > 0 ? retryAfter : undefined,
        activity: busy
          ? { operation: busy.operation, startedAt: busy.startedAt }
          : undefined,
      },
    );
    if (isSessionFailure(failure))
      window.dispatchEvent(
        new CustomEvent(sessionFailureEvent, { detail: failure }),
      );
    if (busy)
      window.dispatchEvent(new CustomEvent(worldBusyEvent, { detail: failure }));
    throw failure;
  }
  const result = await response.json();
  checkGeneration();
  return result as Data;
}

export function useGame() {
  const context = useContext(GameContext);
  if (!context) throw new Error("Game context is unavailable.");
  return context;
}

export function useCurrency() {
  const { bootstrap } = useGame();
  const currency = currencyCode(bootstrap?.settings.currency);
  return {
    currency,
    money: (value: number, precise = false) =>
      formatMoney(value, precise, currency),
    displayAmount: (value: number) => displayAmount(value, currency),
    accountingAmount: (value: number) => accountingAmount(value, currency),
    text: (value: string) => localizeServerText(value, currency),
  };
}

interface CachedResource {
  data: unknown;
  elapsed: number;
}
// Keys carry accountGeneration + revision, so any game-state change misses naturally.
const resourceCache = createLruCache<CachedResource>(24);
const prefetches = new Map<string, Promise<CachedResource>>();
const PREFETCH_BUDGET_MS = 800;

async function timedGet(path: string, signal?: AbortSignal) {
  const started = performance.now();
  const data = await api<unknown>(path, { signal });
  return { data, elapsed: performance.now() - started };
}

export function useResource<Data>(
  path: string | null,
  options: {
    keepPreviousData?: boolean;
    /** Serve repeat requests for the same path from a small in-memory LRU. */
    cache?: boolean;
    /** Path to warm into the cache when idle, only if this response was fast. */
    prefetch?: string | null;
  } = {},
) {
  const { revision, accountGeneration, session, loading, bootstrap, worldActivity } =
    useGame();
  const { keepPreviousData = false, cache = false, prefetch = null } = options;
  const paused = worldActivity !== null;
  const requestPath =
    session && !loading && (bootstrap || path === "saves") ? path : null;
  const [resource, setResource] = useState<{
    key: string;
    path: string;
    accountGeneration: number;
    data: Data | null;
    error: string | null;
    elapsed: number;
  } | null>(null);
  const scope = `${accountGeneration}:${revision}:`;
  const key = `${scope}${requestPath}`;
  const cached = cache && requestPath ? resourceCache.peek(key) : undefined;
  if (cached && requestPath && resource?.key !== key)
    setResource({
      key,
      path: requestPath,
      accountGeneration,
      data: cached.data as Data,
      error: null,
      elapsed: cached.elapsed,
    });
  const sequence = useRef(0);
  useEffect(() => {
    const current = ++sequence.current;
    if (!requestPath || paused) return;
    if (cache && resourceCache.get(key)) return;
    const controller = new AbortController();
    const warming = cache ? prefetches.get(key) : undefined;
    (warming
      ? warming.catch(() => timedGet(requestPath, controller.signal))
      : timedGet(requestPath, controller.signal)
    )
      .then((result) => {
        if (cache) resourceCache.set(key, result);
        if (current === sequence.current) {
          setResource({
            key,
            path: requestPath,
            accountGeneration,
            data: result.data as Data,
            error: null,
            elapsed: result.elapsed,
          });
        }
      })
      .catch((failure: Error) => {
        if (
          failure.name !== "AbortError" &&
          !isWorldBusy(failure) &&
          current === sequence.current
        ) {
          setResource({
            key,
            path: requestPath,
            accountGeneration,
            data: null,
            error: failure.message,
            elapsed: 0,
          });
        }
      });
    return () => controller.abort();
  }, [requestPath, accountGeneration, key, paused, cache]);
  const settled = !!requestPath && !paused &&
    (cached !== undefined || (resource?.key === key && resource.error === null));
  const cheap =
    (cached?.elapsed ?? (resource?.key === key ? resource.elapsed : Infinity)) <=
    PREFETCH_BUDGET_MS;
  const prefetchKey = prefetch ? `${scope}${prefetch}` : null;
  useEffect(() => {
    if (!cache || !settled || !cheap || !prefetch || !prefetchKey) return;
    if (resourceCache.has(prefetchKey) || prefetches.has(prefetchKey)) return;
    const warm = () => {
      const promise = timedGet(prefetch);
      prefetches.set(prefetchKey, promise);
      promise
        .then((result) => {
          if (prefetches.get(prefetchKey) === promise)
            resourceCache.set(prefetchKey, result);
        })
        .catch(() => undefined)
        .finally(() => {
          if (prefetches.get(prefetchKey) === promise) prefetches.delete(prefetchKey);
        });
    };
    if (typeof window.requestIdleCallback === "function") {
      const handle = window.requestIdleCallback(warm, { timeout: 2000 });
      return () => window.cancelIdleCallback(handle);
    }
    const handle = window.setTimeout(warm, 300);
    return () => clearTimeout(handle);
  }, [cache, settled, cheap, prefetch, prefetchKey]);
  return {
    data:
      requestPath &&
      resource?.accountGeneration === accountGeneration &&
      (resource.path === requestPath || keepPreviousData)
        ? (resource?.data ?? null)
        : null,
    loading: !!requestPath && resource?.key !== key,
    error: resource?.key === key ? resource.error : null,
  };
}

const pages: Page[] = [
  "start",
  "office",
  "inbox",
  "squad",
  "scouting",
  "database",
  "world",
  "transfers",
  "offer",
  "contract",
  "loans",
  "academy",
  "training",
  "staff",
  "competitions",
  "analytics",
  "finances",
  "board",
  "media",
  "settings",
];

export function GameProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<AccountSession | null>(null);
  const [loading, setLoading] = useState(true);
  const [accountGeneration, setAccountGeneration] = useState(requestGeneration);
  const [bootstrap, setBootstrap] = useState<Bootstrap | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [accessIssue, setAccessIssue] = useState<AccessIssue | null>(null);
  const [revision, setRevision] = useState(0);
  const [page, setPage] = useState<Page>(() =>
    pages.includes(location.hash.slice(1).split("/")[0] as Page)
      ? (location.hash.slice(1).split("/")[0] as Page)
      : "start",
  );
  const [offerPlayerId, setOfferPlayerId] = useState<number | null>(() => {
    const match = /^#(?:offer|contract)\/(\d+)$/.exec(location.hash);
    return match ? Number(match[1]) : null;
  });
  const [playerId, setPlayer] = useState<number | null>(null);
  const [clubProfileId, setClub] = useState<number | null>(null);
  const [matchPlayerId, setMatchPlayer] = useState<number | null>(null);
  const [leagueId, setLeagueId] = useState<number | null>(null);
  const [fixtureId, setFixtureId] = useState<number | null>(null);
  const [search, setSearch] = useState("");
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState<{ message: string; tone: string } | null>(
    null,
  );
  const [confirmation, setConfirmation] =
    useState<GameContextValue["confirmation"]>(null);
  const advanceLock = useRef(false);
  const settingsRevisions = useRef<Record<string, number>>({});
  const generation = useRef(accountGeneration);
  const accountIdentity = useRef<string | null>(null);
  const accountHasWorld = useRef(false);
  const sessionRequest = useRef(0);
  const sessionPending = useRef(false);
  const [worldActivity, setWorldActivity] = useState<WorldActivity | null>(
    null,
  );
  const bootstrapRef = useRef<Bootstrap | null>(null);
  const lifetime = useRef<AbortController | null>(null);
  const busyPoll = useRef<{
    timer?: number;
    attempt: number;
    running: boolean;
    waiters: {
      resolve: (result: Bootstrap | null | undefined) => void;
      reject: (failure: unknown) => void;
    }[];
  }>({ attempt: 0, running: false, waiters: [] });

  function stopBusyPoll() {
    const poll = busyPoll.current;
    if (poll.timer !== undefined) clearTimeout(poll.timer);
    poll.timer = undefined;
    poll.attempt = 0;
    setWorldActivity(null);
  }
  function settleWaiters(
    outcome: { result: Bootstrap | null | undefined } | { failure: unknown },
  ) {
    const waiters = busyPoll.current.waiters.splice(0);
    for (const waiter of waiters)
      if ("failure" in outcome) waiter.reject(outcome.failure);
      else waiter.resolve(outcome.result);
  }
  function scheduleBusyPoll(delay?: number) {
    const poll = busyPoll.current;
    if (poll.timer !== undefined || poll.running) return;
    // Keeps polling while the tab is hidden: after an ingress cut this may be the only traffic keeping the replica up.
    const wait =
      delay ??
      (poll.attempt < 3
        ? [2000, 4000, 8000][poll.attempt]
        : 10000 + Math.random() * 1000);
    poll.attempt++;
    poll.timer = window.setTimeout(() => {
      poll.timer = undefined;
      void pollActivity();
    }, wait);
  }
  function enterBusy(activity: WorldActivity, retryAfter?: number) {
    setWorldActivity(activity);
    scheduleBusyPoll(
      busyPoll.current.attempt === 0 && retryAfter
        ? retryAfter * 1000
        : undefined,
    );
  }
  async function pollActivity() {
    const poll = busyPoll.current;
    if (poll.running) return;
    poll.running = true;
    const signal = lifetime.current?.signal;
    try {
      const next = await api<AccountSession>("me", { signal });
      if (signal?.aborted) return;
      if (next.activity && next.user.id === accountIdentity.current) {
        setWorldActivity(next.activity);
        poll.running = false;
        scheduleBusyPoll();
        return;
      }
      poll.attempt = 0;
      setWorldActivity(null);
      poll.running = false;
      const result = await loadSession(signal);
      if (busyPoll.current.timer === undefined && !busyPoll.current.running)
        settleWaiters({ result });
    } catch (failure) {
      if (signal?.aborted || (failure as Error).name === "AbortError") return;
      poll.running = false;
      if (isOutcomeUnknown(failure)) {
        scheduleBusyPoll();
        return;
      }
      settleWaiters({ failure });
      if (isSessionFailure(failure)) return;
      resetAccount();
      setLoading(false);
      setError(
        failure instanceof Error ? failure.message : "Unable to load your account.",
      );
    } finally {
      poll.running = false;
    }
  }
  function waitForIdle() {
    return new Promise<Bootstrap | null | undefined>((resolve, reject) => {
      busyPoll.current.waiters.push({ resolve, reject });
      scheduleBusyPoll(2000);
    });
  }
  function checkActivity() {
    const poll = busyPoll.current;
    if (poll.running) return;
    if (poll.timer !== undefined) clearTimeout(poll.timer);
    poll.timer = undefined;
    void pollActivity();
  }

  function resetAccount() {
    generation.current = ++requestGeneration;
    resourceCache.clear();
    prefetches.clear();
    stopBusyPoll();
    accountIdentity.current = null;
    accountHasWorld.current = false;
    advanceLock.current = false;
    settingsRevisions.current = {};
    setAccountGeneration(generation.current);
    setSession(null);
    setBootstrap(null);
    bootstrapRef.current = null;
    setAccessIssue(null);
    setRevision(0);
    setBusy(false);
    setToast(null);
    setConfirmation(null);
    setPlayer(null);
    setClub(null);
    setMatchPlayer(null);
    setLeagueId(null);
    setFixtureId(null);
    setOfferPlayerId(null);
    setSearch("");
    setPage("start");
    location.hash = "start";
  }

  async function loadSession(
    signal?: AbortSignal,
    { keepAccountOnFailure = false } = {},
  ) {
    const request = ++sessionRequest.current;
    sessionPending.current = true;
    if (!accountIdentity.current) {
      setLoading(true);
      setError(null);
    }
    try {
      // Sent together, both requests carry the same cookie, so the bootstrap belongs to this identity.
      const loadBootstrap = () => {
        const pending = api<Bootstrap | null>("bootstrap", { signal });
        pending.catch(() => undefined);
        return pending;
      };
      let bootstrapRequest = loadBootstrap();
      const nextSession = await api<AccountSession>("me", { signal });
      if (signal?.aborted || request !== sessionRequest.current) return;
      if (
        accountIdentity.current &&
        accountIdentity.current !== nextSession.user.id
      ) {
        settleWaiters({
          failure: new DOMException("The signed-in account changed.", "AbortError"),
        });
        resetAccount();
        setLoading(true);
        bootstrapRequest = loadBootstrap();
      }
      accountIdentity.current = nextSession.user.id;
      const busy = (activity: WorldActivity, retryAfter?: number) => {
        setSession(nextSession);
        setError(null);
        setAccessIssue(null);
        setLoading(false);
        enterBusy(activity, retryAfter);
        return bootstrapRef.current;
      };
      if (nextSession.activity) return busy(nextSession.activity);
      let result: Bootstrap | null;
      try {
        result = await bootstrapRequest;
      } catch (failure) {
        if (isWorldBusy(failure) && failure.activity && !signal?.aborted)
          return busy(failure.activity, failure.retryAfter);
        throw failure;
      }
      if (signal?.aborted || request !== sessionRequest.current) return;
      if (!result && accountHasWorld.current) resetAccount();
      accountIdentity.current = nextSession.user.id;
      accountHasWorld.current = result !== null;
      setSession(nextSession);
      setBootstrap(result);
      bootstrapRef.current = result;
      setError(null);
      setAccessIssue(null);
      setLoading(false);
      setRevision((value) => value + 1);
      if (!result) {
        setPage("start");
        setOfferPlayerId(null);
        location.hash = "start";
      }
      return result;
    } catch (failure) {
      if (signal?.aborted || request !== sessionRequest.current) return;
      // 401/403 still sign out through the session failure event.
      if (keepAccountOnFailure && accountIdentity.current) throw failure;
      const access = accessIssueFromFailure(failure);
      resetAccount();
      setLoading(false);
      if (access) {
        setAccessIssue(access);
        setError(null);
      } else {
        setError(
          failure instanceof Error
            ? failure.message
            : "Unable to load your account.",
        );
      }
      throw failure;
    } finally {
      if (request === sessionRequest.current) sessionPending.current = false;
    }
  }

  async function refresh() {
    if (accountGeneration !== generation.current) return;
    try {
      return await loadSession();
    } catch {
      return undefined;
    }
  }
  async function refreshAfterAction() {
    if (accountGeneration !== generation.current) return false;
    try {
      await loadSession(undefined, { keepAccountOnFailure: true });
      return true;
    } catch {
      return false;
    }
  }
  useEffect(() => {
    const controller = new AbortController();
    const poll = busyPoll.current;
    lifetime.current = controller;
    let retryTimer: number | undefined;
    let attempts = 0;
    const connect = () => {
      if (sessionPending.current) return;
      void loadSession(controller.signal).catch((failure: Error) => {
        if (
          controller.signal.aborted ||
          failure.name === "AbortError" ||
          isSessionFailure(failure)
        )
          return;
        attempts++;
        if (attempts < 20)
          retryTimer = window.setTimeout(connect, Math.min(3000, attempts * 600));
      });
    };
    const recheck = () => {
      const poll = busyPoll.current;
      if (
        document.visibilityState === "hidden" ||
        sessionPending.current ||
        mutationsInFlight > 0 ||
        poll.timer !== undefined ||
        poll.running
      )
        return;
      if (retryTimer !== undefined) clearTimeout(retryTimer);
      void loadSession(controller.signal).catch(() => undefined);
    };
    const worldBusy = (event: Event) => {
      const failure = (event as CustomEvent<ApiError>).detail;
      if (failure.activity && accountIdentity.current)
        enterBusy(failure.activity, failure.retryAfter);
    };
    const authenticationFailed = (event: Event) => {
      const failure = (event as CustomEvent<ApiError>).detail;
      const access = accessIssueFromFailure(failure);
      sessionRequest.current++;
      sessionPending.current = false;
      if (retryTimer !== undefined) clearTimeout(retryTimer);
      settleWaiters({ failure });
      resetAccount();
      setLoading(false);
      if (access) {
        setAccessIssue(access);
        setError(null);
      } else {
        setError(failure.message);
      }
    };
    window.addEventListener(sessionFailureEvent, authenticationFailed);
    window.addEventListener(worldBusyEvent, worldBusy);
    window.addEventListener("focus", recheck);
    document.addEventListener("visibilitychange", recheck);
    connect();
    return () => {
      sessionRequest.current++;
      sessionPending.current = false;
      controller.abort();
      if (retryTimer !== undefined) clearTimeout(retryTimer);
      if (poll.timer !== undefined) clearTimeout(poll.timer);
      poll.timer = undefined;
      poll.attempt = 0;
      poll.running = false;
      poll.waiters.length = 0;
      window.removeEventListener(sessionFailureEvent, authenticationFailed);
      window.removeEventListener(worldBusyEvent, worldBusy);
      window.removeEventListener("focus", recheck);
      document.removeEventListener("visibilitychange", recheck);
    };
  }, []);
  useEffect(() => {
    const handler = () => {
      const requested = location.hash.slice(1).split("/")[0] as Page;
      if (pages.includes(requested)) setPage(requested);
      const offer = /^#(?:offer|contract)\/(\d+)$/.exec(location.hash);
      setOfferPlayerId(offer ? Number(offer[1]) : null);
    };
    window.addEventListener("hashchange", handler);
    return () => window.removeEventListener("hashchange", handler);
  }, []);
  useEffect(() => {
    if (!toast) return;
    const timeout = window.setTimeout(
      () => setToast(null),
      toast.tone === "success" ? 5000 : 8000,
    );
    return () => clearTimeout(timeout);
  }, [toast]);
  useEffect(() => {
    const settings = { ...DEFAULT_SETTINGS, ...bootstrap?.settings };
    const root = document.documentElement;
    const preference = window.matchMedia("(prefers-color-scheme: dark)");
    const applyTheme = () => {
      root.dataset.theme =
        settings.theme === "system"
          ? preference.matches
            ? "dark"
            : "light"
          : String(settings.theme);
    };
    applyTheme();
    preference.addEventListener("change", applyTheme);
    root.style.removeProperty("--accent");
    root.style.setProperty("--accent-base", String(settings.accent));
    root.style.setProperty("--blur", `${settings.blur}px`);
    root.style.setProperty(
      "--text-scale",
      String(Number(settings.textSize) / 100),
    );
    root.style.setProperty(
      "--font-weight",
      settings.fontWeight === "bold"
        ? "600"
        : settings.fontWeight === "medium"
          ? "500"
          : "400",
    );
    root.style.setProperty(
      "--motion",
      settings.animationSpeed === "off"
        ? "0ms"
        : settings.animationSpeed === "fast"
          ? "100ms"
          : settings.animationSpeed === "slow"
            ? "400ms"
            : "220ms",
    );
    root.dataset.contrast = settings.highContrast ? "high" : "normal";
    root.dataset.uiTheme =
      settings.uiTheme === "classic" ? "classic" : "minimal";
    root.dataset.colorblind = String(settings.colorblind);
    root.dataset.simplified = String(settings.simplifiedUI);
    return () => preference.removeEventListener("change", applyTheme);
  }, [bootstrap]);

  function currentAccount() {
    return session !== null && accountGeneration === generation.current;
  }

  function navigate(next: Page) {
    if (!currentAccount()) return;
    if (!accountHasWorld.current) next = "start";
    if (next === "start") {
      setPlayer(null);
      setClub(null);
      setMatchPlayer(null);
      setLeagueId(null);
      setFixtureId(null);
      setSearch("");
    }
    setPage(next);
    location.hash = next;
    window.scrollTo({ top: 0 });
    document.querySelector(".main-scroll")?.scrollTo({ top: 0 });
    if (bootstrap?.settings.haptics && navigator.vibrate) navigator.vibrate(8);
  }
  function notify(message: string, tone = "success") {
    if (!currentAccount()) return;
    setToast({ message, tone });
  }
  async function act(body: Record<string, unknown>, message?: string) {
    if (!currentAccount() || !bootstrap) return;
    try {
      const result = await api<ActionResult>("action", {
        method: "POST",
        body: JSON.stringify(body),
      });
      // The action already ran: a failed refresh must not read as a failed action or the user repeats it.
      const refreshed = await refreshAfterAction();
      if (!currentAccount()) return;
      const text =
        message ??
        localizeServerText(
          result.message ?? "Updated.",
          currencyCode(bootstrap.settings.currency),
        );
      // Only a counterpart's decision returns stage Rejected; the director's own reject returns no stage.
      if (result.stage === "Rejected") notify(text, "error");
      else if (!refreshed)
        notify(
          `${text} Couldn't refresh the latest data; it will update on your next action or a reload.`,
          "warning",
        );
      else notify(text, "success");
      return result;
    } catch (failure) {
      notify(
        failure instanceof Error ? failure.message : "Action failed.",
        "error",
      );
    }
  }
  async function advanceDays(days: number) {
    if (!currentAccount() || !bootstrap || advanceLock.current) return;
    advanceLock.current = true;
    setBusy(true);
    try {
      const result = await api<{ date: string; days: number; matches: number }>(
        "advance",
        { method: "POST", body: JSON.stringify({ days }) },
      );
      if (!(await refresh()) || !currentAccount()) return;
      notify(
        `${plural(result.days, "day")} advanced. ${plural(result.matches, "match", "matches")} simulated.`,
      );
    } catch (failure) {
      notify(
        failure instanceof Error ? failure.message : "Simulation failed.",
        "error",
      );
      await refresh();
    } finally {
      if (currentAccount()) {
        setBusy(false);
        advanceLock.current = false;
      }
    }
  }
  async function changeSettings(values: Settings) {
    if (!currentAccount() || !bootstrap) return;
    const previous = bootstrap?.settings ?? {};
    const revisions = Object.fromEntries(
      Object.keys(values).map((key) => {
        const revision = (settingsRevisions.current[key] ?? 0) + 1;
        settingsRevisions.current[key] = revision;
        return [key, revision];
      }),
    );
    const applyValues = (settings: Settings) => {
      setBootstrap((current) =>
        current && currentAccount()
          ? {
              ...current,
              settings: {
                ...current.settings,
                ...Object.fromEntries(
                  Object.keys(values)
                    .filter(
                      (key) =>
                        settingsRevisions.current[key] === revisions[key],
                    )
                    .map((key) => [key, settings[key]]),
                ),
              },
            }
          : current,
      );
    };
    applyValues(values);
    try {
      const settings = await api<Settings>("settings", {
        method: "PATCH",
        body: JSON.stringify(values),
      });
      applyValues(settings);
    } catch (failure) {
      applyValues(previous);
      notify(
        failure instanceof Error
          ? failure.message
          : "Settings could not be saved.",
        "error",
      );
    }
  }
  async function deleteActiveCareer(request: DeleteActiveCareerRequest) {
    if (!currentAccount()) return;
    let message =
      "Career deleted. Start a new career or load another saved career.";
    try {
      message = (
        await api<DeleteActiveCareerResult>("careers/active", {
          method: "DELETE",
          body: JSON.stringify(request),
        })
      ).message;
      await loadSession();
    } catch (failure) {
      if (!isOutcomeUnknown(failure) || isWorldBusy(failure)) throw failure;
      const after = await waitForIdle();
      if (
        after &&
        (after.state.careerId ?? null) === request.careerId &&
        after.state.seed === request.seed
      )
        throw new Error("Your career was not deleted. Try again.", {
          cause: failure,
        });
    }
    setToast({ message, tone: "success" });
  }
  return (
    <GameContext
      value={{
        session,
        loading,
        accountGeneration,
        bootstrap,
        error,
        accessIssue,
        worldActivity,
        checkActivity,
        waitForIdle,
        deleteActiveCareer,
        revision,
        page,
        busy,
        toast,
        playerId,
        clubProfileId,
        matchPlayerId,
        leagueId,
        fixtureId,
        search,
        confirmation,
        navigate,
        setPlayer: (id) => {
          if (!currentAccount() || !bootstrap) return;
          setClub(null);
          setPlayer(id);
        },
        setClub: (id) => {
          if (!currentAccount() || !bootstrap) return;
          setPlayer(null);
          setClub(id);
        },
        openLeague: (id) => {
          if (!currentAccount() || !bootstrap) return;
          setPlayer(null);
          setClub(null);
          setLeagueId(id);
          navigate("competitions");
        },
        openMatch: (id, playerId) => {
          if (!currentAccount() || !bootstrap) return;
          setPlayer(null);
          setClub(null);
          setMatchPlayer(playerId ?? null);
          setFixtureId(id);
          navigate("analytics");
        },
        offerPlayerId,
        openOffer: (id) => {
          if (!currentAccount() || !bootstrap) return;
          setPlayer(null);
          setClub(null);
          setOfferPlayerId(id);
          setPage("offer");
          location.hash = `offer/${id}`;
          window.scrollTo({ top: 0 });
        },
        openContract: (id) => {
          if (!currentAccount() || !bootstrap) return;
          setPlayer(null);
          setClub(null);
          setOfferPlayerId(id);
          setPage("contract");
          location.hash = `contract/${id}`;
          window.scrollTo({ top: 0 });
        },
        setSearch: (value) => {
          if (currentAccount()) setSearch(value);
        },
        notify,
        dismissToast: () => setToast(null),
        act,
        refresh,
        advance: advanceDays,
        changeSettings,
        confirm: (title, message, action) => {
          if (currentAccount()) setConfirmation({ title, message, action });
        },
        closeConfirm: () => setConfirmation(null),
      }}
    >
      <Fragment key={accountGeneration}>{children}</Fragment>
    </GameContext>
  );
}
