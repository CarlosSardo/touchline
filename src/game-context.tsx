import {
  Fragment,
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import type { AccountSession, Bootstrap } from "../shared/api.ts";
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
let requestGeneration = 0;

class ApiError extends Error {
  readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
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
    const failure = new ApiError(
      response.redirected
        ? "Your session has expired. Sign in again to continue."
        : body?.error ?? "The game could not complete that action.",
      response.redirected ? 401 : response.status,
    );
    if (failure.status === 401 || failure.status === 403)
      window.dispatchEvent(
        new CustomEvent(sessionFailureEvent, { detail: failure }),
      );
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
  };
}

export function useResource<Data>(
  path: string | null,
  options: { keepPreviousData?: boolean } = {},
) {
  const { revision, accountGeneration, session, loading, bootstrap } = useGame();
  const requestPath =
    session && !loading && (bootstrap || path === "saves") ? path : null;
  const [resource, setResource] = useState<{
    key: string;
    path: string;
    accountGeneration: number;
    data: Data | null;
    error: string | null;
  } | null>(null);
  const key = `${accountGeneration}:${revision}:${requestPath}`;
  const sequence = useRef(0);
  useEffect(() => {
    const current = ++sequence.current;
    if (!requestPath) return;
    const controller = new AbortController();
    api<Data>(requestPath, { signal: controller.signal })
      .then((result) => {
        if (current === sequence.current) {
          setResource({
            key,
            path: requestPath,
            accountGeneration,
            data: result,
            error: null,
          });
        }
      })
      .catch((failure: Error) => {
        if (failure.name !== "AbortError" && current === sequence.current) {
          setResource({
            key,
            path: requestPath,
            accountGeneration,
            data: null,
            error: failure.message,
          });
        }
      });
    return () => controller.abort();
  }, [requestPath, accountGeneration, key]);
  return {
    data:
      requestPath &&
      resource?.accountGeneration === accountGeneration &&
      (resource.path === requestPath || options.keepPreviousData)
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

  function resetAccount() {
    generation.current = ++requestGeneration;
    accountIdentity.current = null;
    accountHasWorld.current = false;
    advanceLock.current = false;
    settingsRevisions.current = {};
    setAccountGeneration(generation.current);
    setSession(null);
    setBootstrap(null);
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

  async function loadSession(signal?: AbortSignal) {
    const request = ++sessionRequest.current;
    sessionPending.current = true;
    if (!accountIdentity.current) {
      setLoading(true);
      setError(null);
    }
    try {
      const nextSession = await api<AccountSession>("me", { signal });
      if (signal?.aborted || request !== sessionRequest.current) return;
      if (
        accountIdentity.current &&
        accountIdentity.current !== nextSession.user.id
      ) {
        resetAccount();
        setLoading(true);
      }
      accountIdentity.current = nextSession.user.id;
      const result = await api<Bootstrap | null>("bootstrap", { signal });
      if (signal?.aborted || request !== sessionRequest.current) return;
      const verifiedSession = await api<AccountSession>("me", { signal });
      if (signal?.aborted || request !== sessionRequest.current) return;
      if (verifiedSession.user.id !== nextSession.user.id)
        throw new Error("Your signed-in account changed. Reconnect to continue.");
      if (!result && accountHasWorld.current) resetAccount();
      accountIdentity.current = verifiedSession.user.id;
      accountHasWorld.current = result !== null;
      setSession(verifiedSession);
      setBootstrap(result);
      setError(null);
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
      resetAccount();
      setLoading(false);
      setError(
        failure instanceof Error
          ? failure.message
          : "Unable to load your account.",
      );
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
  useEffect(() => {
    const controller = new AbortController();
    let retryTimer: number | undefined;
    let attempts = 0;
    const connect = () => {
      if (sessionPending.current) return;
      void loadSession(controller.signal).catch((failure: Error) => {
        if (
          controller.signal.aborted ||
          failure.name === "AbortError" ||
          (failure instanceof ApiError &&
            (failure.status === 401 || failure.status === 403))
        )
          return;
        attempts++;
        if (attempts < 20)
          retryTimer = window.setTimeout(connect, Math.min(3000, attempts * 600));
      });
    };
    const recheck = () => {
      if (document.visibilityState === "hidden" || sessionPending.current) return;
      if (retryTimer !== undefined) clearTimeout(retryTimer);
      void loadSession(controller.signal).catch(() => undefined);
    };
    const authenticationFailed = (event: Event) => {
      sessionRequest.current++;
      sessionPending.current = false;
      if (retryTimer !== undefined) clearTimeout(retryTimer);
      resetAccount();
      setLoading(false);
      setError((event as CustomEvent<ApiError>).detail.message);
    };
    window.addEventListener(sessionFailureEvent, authenticationFailed);
    window.addEventListener("focus", recheck);
    document.addEventListener("visibilitychange", recheck);
    connect();
    return () => {
      sessionRequest.current++;
      sessionPending.current = false;
      controller.abort();
      if (retryTimer !== undefined) clearTimeout(retryTimer);
      window.removeEventListener(sessionFailureEvent, authenticationFailed);
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
      toast.tone === "error" ? 8000 : 5000,
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
      if (!(await refresh()) || !currentAccount()) return;
      notify(message ?? result.message ?? "Updated.");
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
        `${result.days} days advanced. ${result.matches.toLocaleString()} matches simulated.`,
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
  return (
    <GameContext
      value={{
        session,
        loading,
        accountGeneration,
        bootstrap,
        error,
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
