import {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import type { Bootstrap } from "../shared/api.ts";
import type { Settings } from "../shared/types.ts";

export type Page =
  | "office"
  | "inbox"
  | "squad"
  | "scouting"
  | "database"
  | "transfers"
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
  bootstrap: Bootstrap | null;
  error: string | null;
  revision: number;
  page: Page;
  busy: boolean;
  toast: { message: string; tone: string } | null;
  playerId: number | null;
  leagueId: number | null;
  fixtureId: number | null;
  search: string;
  confirmation: { title: string; message: string; action: () => void } | null;
  navigate: (page: Page) => void;
  setPlayer: (id: number | null) => void;
  openLeague: (id: number) => void;
  openMatch: (id: number) => void;
  setSearch: (value: string) => void;
  notify: (message: string, tone?: string) => void;
  dismissToast: () => void;
  act: (
    body: Record<string, unknown>,
    message?: string,
  ) => Promise<ActionResult | undefined>;
  refresh: () => Promise<void>;
  advance: (days: number) => Promise<void>;
  changeSettings: (settings: Settings) => Promise<void>;
  confirm: (title: string, message: string, action: () => void) => void;
  closeConfirm: () => void;
}

const GameContext = createContext<GameContextValue | null>(null);

export async function api<Data>(
  path: string,
  init?: RequestInit,
): Promise<Data> {
  const response = await fetch(`/api/${path}`, {
    ...init,
    headers: {
      ...(init?.body && !(init.body instanceof Blob)
        ? { "Content-Type": "application/json" }
        : {}),
      ...init?.headers,
    },
  });
  if (!response.ok) {
    const body = await response
      .json()
      .catch(() => ({ error: `Request failed (${response.status})` }));
    throw new Error(body.error ?? "The game could not complete that action.");
  }
  return response.json() as Promise<Data>;
}

export function useGame() {
  const context = useContext(GameContext);
  if (!context) throw new Error("Game context is unavailable.");
  return context;
}

export function useResource<Data>(path: string | null) {
  const { revision } = useGame();
  const [resource, setResource] = useState<{
    key: string;
    path: string;
    data: Data | null;
    error: string | null;
  } | null>(null);
  const key = `${revision}:${path}`;
  const sequence = useRef(0);
  useEffect(() => {
    const current = ++sequence.current;
    if (!path) return;
    const controller = new AbortController();
    api<Data>(path, { signal: controller.signal })
      .then((result) => {
        if (current === sequence.current) {
          setResource({ key, path, data: result, error: null });
        }
      })
      .catch((failure: Error) => {
        if (failure.name !== "AbortError" && current === sequence.current) {
          setResource({ key, path, data: null, error: failure.message });
        }
      });
    return () => controller.abort();
  }, [path, revision, key]);
  return {
    data: resource?.path === path ? resource.data : null,
    loading: !!path && resource?.key !== key,
    error: resource?.key === key ? resource.error : null,
  };
}

const pages: Page[] = [
  "office",
  "inbox",
  "squad",
  "scouting",
  "database",
  "transfers",
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
  const [bootstrap, setBootstrap] = useState<Bootstrap | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [revision, setRevision] = useState(0);
  const [page, setPage] = useState<Page>(() =>
    pages.includes(location.hash.slice(1) as Page)
      ? (location.hash.slice(1) as Page)
      : "office",
  );
  const [playerId, setPlayer] = useState<number | null>(null);
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

  async function refresh() {
    try {
      setBootstrap(await api<Bootstrap>("bootstrap"));
      setError(null);
      setRevision((value) => value + 1);
    } catch (failure) {
      setError(
        failure instanceof Error
          ? failure.message
          : "Unable to reach the local engine.",
      );
    }
  }
  useEffect(() => {
    const controller = new AbortController();
    let retryTimer: number | undefined;
    let attempts = 0;
    const connect = () => {
      api<Bootstrap>("bootstrap", { signal: controller.signal })
        .then((result) => {
          if (controller.signal.aborted) return;
          setBootstrap(result);
          setError(null);
        })
        .catch((failure: Error) => {
          if (controller.signal.aborted || failure.name === "AbortError")
            return;
          attempts++;
          if (attempts < 20)
            retryTimer = window.setTimeout(
              connect,
              Math.min(3000, attempts * 600),
            );
          else setError(failure.message);
        });
    };
    connect();
    return () => {
      controller.abort();
      if (retryTimer !== undefined) clearTimeout(retryTimer);
    };
  }, []);
  useEffect(() => {
    const handler = () => {
      const requested = location.hash.slice(1) as Page;
      if (pages.includes(requested)) setPage(requested);
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
    if (!bootstrap) return;
    const settings = bootstrap.settings;
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
    root.dataset.colorblind = String(settings.colorblind);
    root.dataset.simplified = String(settings.simplifiedUI);
    return () => preference.removeEventListener("change", applyTheme);
  }, [bootstrap]);

  function navigate(next: Page) {
    setPage(next);
    location.hash = next;
    window.scrollTo({ top: 0 });
    document.querySelector(".main-scroll")?.scrollTo({ top: 0 });
    if (bootstrap?.settings.haptics && navigator.vibrate) navigator.vibrate(8);
  }
  function notify(message: string, tone = "success") {
    setToast({ message, tone });
  }
  async function act(body: Record<string, unknown>, message?: string) {
    try {
      const result = await api<ActionResult>("action", {
        method: "POST",
        body: JSON.stringify(body),
      });
      await refresh();
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
    if (advanceLock.current) return;
    advanceLock.current = true;
    setBusy(true);
    try {
      const result = await api<{ date: string; days: number; matches: number }>(
        "advance",
        { method: "POST", body: JSON.stringify({ days }) },
      );
      await refresh();
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
      setBusy(false);
      advanceLock.current = false;
    }
  }
  async function changeSettings(values: Settings) {
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
        current
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
        bootstrap,
        error,
        revision,
        page,
        busy,
        toast,
        playerId,
        leagueId,
        fixtureId,
        search,
        confirmation,
        navigate,
        setPlayer,
        openLeague: (id) => {
          setLeagueId(id);
          navigate("competitions");
        },
        openMatch: (id) => {
          setFixtureId(id);
          navigate("analytics");
        },
        setSearch,
        notify,
        dismissToast: () => setToast(null),
        act,
        refresh,
        advance: advanceDays,
        changeSettings,
        confirm: (title, message, action) =>
          setConfirmation({ title, message, action }),
        closeConfirm: () => setConfirmation(null),
      }}
    >
      {children}
    </GameContext>
  );
}
