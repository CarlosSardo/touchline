import { Fragment, useDeferredValue, useState } from "react";
import {
  ArrowLeft,
  ArrowRight,
  ChevronLeft,
  ChevronRight,
  FolderOpen,
  Goal,
  HardDrive,
  LoaderCircle,
  Play,
  Plus,
  Search,
  Settings2,
  ShieldCheck,
  Trash2,
  UserRound,
} from "lucide-react";
import { api, useGame, useResource } from "../game-context.tsx";
import {
  Badge,
  Button,
  Crest,
  Empty,
  ErrorState,
  Field,
  IconButton,
  Loading,
  Modal,
} from "../ui.tsx";
import {
  compactNumber,
  dateLabel,
  SETTING_DEFINITIONS,
  groupCareerSaves,
} from "../../shared/rules.ts";
import SavedCareers from "../SavedCareers.tsx";
import { CareerSheet } from "./Settings.tsx";
import type { League } from "../../shared/types.ts";
import type { SaveSlot, WorldClub, WorldClubPage } from "../../shared/api.ts";

export default function Start() {
  const { session, bootstrap, navigate, refresh } = useGame();
  const {
    data: saves,
    loading: savesLoading,
    error: savesError,
  } = useResource<SaveSlot[]>("saves");
  const [view, setView] = useState<"home" | "new" | "load">("home");
  const [name, setName] = useState(
    session?.user.displayName.slice(0, 50) ?? "",
  );
  const [careerName, setCareerName] = useState("My sporting project");
  const [background, setBackground] = useState("Former scout");
  const [clubId, setClubId] = useState<number | null>(bootstrap?.club.id ?? null);
  const [chosenClub, setChosenClub] = useState<WorldClub | null>(null);
  const [country, setCountry] = useState(
    String(bootstrap?.club.country_id ?? ""),
  );
  const [tier, setTier] = useState("");
  const [pagination, setPagination] = useState({ key: "", page: 1 });
  const [search, setSearch] = useState("");
  const [saveSearch, setSaveSearch] = useState("");
  const [pending, setPending] = useState(false);
  const [preparation, setPreparation] = useState<"idle" | "pending" | "failed">(
    "idle",
  );
  const [profile, setProfile] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [load, setLoad] = useState<SaveSlot | null>(null);
  const [remove, setRemove] = useState<SaveSlot | null>(null);
  const [deleting, setDeleting] = useState(false);
  const preparing = preparation === "pending";
  const deferredSearch = useDeferredValue(search);
  const filterKey = JSON.stringify([deferredSearch, country, tier]);
  const page = pagination.key === filterKey ? pagination.page : 1;
  const params = new URLSearchParams({
    type: "club",
    sort: "division",
    q: deferredSearch,
    page: String(page),
    pageSize: "30",
  });
  if (country) params.set("country", country);
  if (tier) params.set("tier", tier);
  const {
    data: clubPage,
    loading: clubsLoading,
    error: clubsError,
  } = useResource<WorldClubPage>(
    view === "new" && bootstrap ? `world/clubs?${params}` : null,
  );
  const { data: divisions } = useResource<League[]>(
    view === "new" && bootstrap && country
      ? `leagues?kind=league&age=Senior&country=${country}`
      : null,
  );
  if (!session) return null;
  const state = bootstrap?.state;
  const club = bootstrap?.club;
  const world = bootstrap?.world;
  const selectedClub = chosenClub ?? club;
  const clubGroups = new Map<string, WorldClub[]>();
  for (const entry of clubPage?.clubs ?? []) {
    const key = `${entry.country_id}:${entry.league_id}`;
    const group = clubGroups.get(key) ?? [];
    group.push(entry);
    clubGroups.set(key, group);
  }
  const deleteCount = remove?.career?.id
    ? (saves?.filter((slot) => slot.career?.id === remove.career?.id).length ??
      0)
    : 1;
  async function newCareer() {
    if (pending || preparing) return;
    setError(null);
    if (bootstrap) {
      setView("new");
      return;
    }
    setPreparation("pending");
    try {
      await api("careers/prepare", {
        method: "POST",
        body: JSON.stringify({}),
      });
      const prepared = await refresh();
      if (!prepared)
        throw new Error("Your private world is not ready. Try preparing it again.");
      setClubId(prepared.club.id);
      setCountry(String(prepared.club.country_id ?? ""));
      setView("new");
      setPreparation("idle");
    } catch (failure) {
      setPreparation("failed");
      setError(
        failure instanceof Error
          ? failure.message
          : "Your private world could not be prepared.",
      );
    }
  }
  async function createCareer() {
    if (!bootstrap || clubId === null || pending) return;
    setPending(true);
    setError(null);
    try {
      await api("careers", {
        method: "POST",
        body: JSON.stringify({
          name: name.trim().slice(0, 50),
          careerName,
          background,
          clubId,
        }),
      });
      if (await refresh()) navigate("office");
    } catch (failure) {
      setError(
        failure instanceof Error
          ? failure.message
          : "Career could not be started.",
      );
    } finally {
      setPending(false);
    }
  }
  async function loadCareer(slot: SaveSlot) {
    setPending(true);
    setError(null);
    setLoad(null);
    try {
      await api("careers/load", {
        method: "POST",
        body: JSON.stringify({ file: slot.file }),
      });
      if (await refresh()) navigate("office");
    } catch (failure) {
      setError(
        failure instanceof Error
          ? failure.message
          : "Career could not be loaded.",
      );
    } finally {
      setPending(false);
    }
  }
  async function deleteCareer(slot: SaveSlot) {
    setDeleting(true);
    setError(null);
    try {
      await api("careers", {
        method: "DELETE",
        body: JSON.stringify({ file: slot.file }),
      });
      await refresh();
      setRemove(null);
    } catch (failure) {
      setError(
        failure instanceof Error
          ? failure.message
          : "Career could not be deleted.",
      );
    } finally {
      setDeleting(false);
    }
  }
  const saveGroups = groupCareerSaves(saves ?? [], saveSearch);
  return (
    <main className="career-start">
      <svg
        className="career-pitch-art"
        viewBox="0 0 1200 800"
        preserveAspectRatio="xMidYMid slice"
        aria-hidden="true"
      >
        <g fill="none" stroke="currentColor" strokeWidth="1">
          <rect x="60" y="70" width="1080" height="660" />
          <path d="M600 70V730M60 210H235V590H60M1140 210H965V590H1140M60 310H126V490H60M1140 310H1074V490H1140" />
          <circle cx="600" cy="400" r="97" />
          <circle cx="600" cy="400" r="3" />
        </g>
      </svg>
      <header className="career-start-header">
        <span className="brand">
          <span className="brand-mark">
            <Goal size={22} />
          </span>
          touchline.
        </span>
        <span className="inline-controls career-account-menu">
          <Badge tone="green">Sporting Director / 2026</Badge>
          <Button
            variant="ghost"
            icon={UserRound}
            className="career-account-button"
            aria-label={`Account profile for ${session.user.displayName}`}
            title={session.user.displayName}
            onClick={() => setProfile(true)}
          >
            <span>{session.user.displayName}</span>
          </Button>
          <IconButton
            icon={Settings2}
            label="Open settings"
            disabled={!bootstrap || pending || preparing}
            onClick={() => navigate("settings")}
          />
        </span>
      </header>
      <section className="career-start-content">
        <div className="career-title">
          <div>
            {view !== "home" && (
              <Button
                variant="ghost"
                icon={ArrowLeft}
                onClick={() => setView("home")}
                disabled={pending || preparing}
              >
                Careers
              </Button>
            )}
            <div className="eyebrow">YOUR FOOTBALL STORY</div>
            <h1>
              {view === "new"
                ? "A new beginning."
                : view === "load"
                  ? "Your careers."
                  : "The next chapter is yours."}
            </h1>
          </div>
          <span className="career-start-season">
            2026<span>/ 27</span>
          </span>
        </div>
        {error && !remove && <ErrorState message={error} />}
        {savesError && view !== "new" && (
          <div>
            <ErrorState message={savesError} />
            <Button variant="secondary" onClick={() => void refresh()}>
              Retry saved careers
            </Button>
          </div>
        )}
        {view === "home" && (
          <div className="career-home-grid">
            {state?.started && club ? (
              <section className="active-career">
                <div className="eyebrow">ACTIVE CAREER</div>
                <div className="active-career-club">
                  <Crest name={club.name} color={club.color} size={76} />
                  <div>
                    <h2>{state.careerName ?? club.name}</h2>
                    <p>
                      {state.director.name} / {club.name}
                    </p>
                    <span>
                      {dateLabel(state.date)} / {state.season}-
                      {String(state.season + 1).slice(-2)}
                    </span>
                  </div>
                </div>
                <div className="active-career-details">
                  <span>
                    <small>Club reputation</small>
                    <strong>{Math.round(club.reputation)}</strong>
                  </span>
                  <span>
                    <small>Director reputation</small>
                    <strong>{Math.round(state.director.reputation)}</strong>
                  </span>
                  <span>
                    <small>Career status</small>
                    <strong>
                      {state.gameOver ? "Between roles" : "In progress"}
                    </strong>
                  </span>
                </div>
                <Button icon={Play} onClick={() => navigate("office")}>
                  Continue career
                </Button>
              </section>
            ) : (
              <section className="active-career">
                <div className="eyebrow">PRIVATE CAREER</div>
                <Empty
                  icon={Plus}
                  title="No career started"
                  detail={
                    bootstrap ? "Your private world is ready." : "Summer 2026"
                  }
                />
              </section>
            )}
            <div className="career-menu-actions">
              <button
                onClick={() => void newCareer()}
                disabled={pending || preparing}
              >
                {preparing ? (
                  <LoaderCircle size={23} className="spin" />
                ) : (
                  <Plus size={23} />
                )}
                <span>
                  <strong>
                    {preparing
                      ? "Preparing your world..."
                      : preparation === "failed"
                        ? "Retry preparation"
                        : "New career"}
                  </strong>
                  <small>Summer 2026</small>
                </span>
                <ArrowRight size={18} />
              </button>
              <button
                onClick={() => setView("load")}
                disabled={pending || preparing}
              >
                <FolderOpen size={23} />
                <span>
                  <strong>Load career</strong>
                  <small>
                    {savesLoading
                      ? "Loading saved careers..."
                      : savesError
                        ? "Saved careers unavailable"
                        : `${groupCareerSaves(saves ?? []).length} saved careers`}
                  </small>
                </span>
                <ArrowRight size={18} />
              </button>
              <div className="career-storage">
                <ShieldCheck size={18} />
                <span>Career snapshots / Portable saves</span>
              </div>
            </div>
          </div>
        )}
        {view === "new" && bootstrap && selectedClub && (
          <form
            className="new-career-form"
            onSubmit={(event) => {
              event.preventDefault();
              void createCareer();
            }}
          >
            <section>
              <h2>Director & appointment</h2>
              <div className="form-grid">
                <Field label="Career name" className="span-2">
                  <input
                    required
                    minLength={2}
                    maxLength={60}
                    value={careerName}
                    onChange={(event) => setCareerName(event.target.value)}
                  />
                </Field>
                <Field label="Director name">
                  <input
                    required
                    minLength={2}
                    maxLength={50}
                    value={name}
                    onChange={(event) => setName(event.target.value)}
                  />
                </Field>
                <Field label="Background">
                  <select
                    value={background}
                    onChange={(event) => setBackground(event.target.value)}
                  >
                    {SETTING_DEFINITIONS.find(
                      (setting) => setting.id === "directorBackground",
                    )!.options!.map((option) => (
                      <option key={option}>{option}</option>
                    ))}
                  </select>
                </Field>
              </div>
              {state?.started && (
                <p className="career-save-notice">
                  <HardDrive size={15} />
                  Your current career will be kept as a separate save.
                </p>
              )}
              <Button
                type="submit"
                icon={pending ? LoaderCircle : Play}
                disabled={
                  pending || clubId === null || !name.trim() || !careerName.trim()
                }
              >
                {pending ? "Creating world..." : "Start career"}
              </Button>
            </section>
            <section>
              <h2>Choose your club</h2>
              <div className="career-club-filters">
                <div className="search-field">
                  <Search size={16} />
                  <input
                    aria-label="Find career club"
                    placeholder="Club, city or country..."
                    maxLength={100}
                    value={search}
                    onChange={(event) => setSearch(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") event.preventDefault();
                    }}
                  />
                </div>
                <Field label="Country">
                  <select
                    aria-label="Career club country"
                    value={country}
                    onChange={(event) => setCountry(event.target.value)}
                  >
                    <option value="">All countries</option>
                    {bootstrap.countries.map((entry) => (
                      <option key={entry.id} value={entry.id}>
                        {entry.name}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label="Division">
                  <select
                    aria-label="Career club division"
                    value={tier}
                    onChange={(event) => setTier(event.target.value)}
                  >
                    <option value="">All senior divisions</option>
                    {[1, 2, 3].map((level) => (
                      <option key={level} value={level}>
                        {divisions?.find((league) => league.tier === level)
                          ?.name ?? `Division ${level}`}{" "}
                        / Tier {level}
                      </option>
                    ))}
                  </select>
                </Field>
              </div>
              <div
                key={`${filterKey}:${page}`}
                className="club-chooser-list career-club-list"
                aria-busy={clubsLoading}
              >
                {clubsError ? (
                  <ErrorState message={clubsError} />
                ) : clubsLoading ? (
                  <div className="career-picker-message" role="status">
                    <LoaderCircle size={20} className="spin" />
                    Loading clubs...
                  </div>
                ) : !clubPage?.total ? (
                  <div className="career-picker-message">
                    No clubs match these filters.
                  </div>
                ) : (
                  [...clubGroups].map(([key, entries]) => (
                    <Fragment key={key}>
                      <div className="career-division-heading">
                        <strong>
                          {entries[0].league_name ?? entries[0].country_name}
                        </strong>
                        <Badge>Tier {entries[0].tier ?? "-"}</Badge>
                      </div>
                      {entries.map((entry) => (
                        <button
                          type="button"
                          className={clubId === entry.id ? "selected" : ""}
                          aria-pressed={clubId === entry.id}
                          key={entry.id}
                          onClick={() => {
                            setClubId(entry.id);
                            setChosenClub(entry);
                          }}
                        >
                          <Crest
                            name={entry.name}
                            color={entry.color}
                            size={28}
                          />
                          <span>
                            <strong>{entry.name}</strong>
                            <small>
                              {entry.league_name} / Tier {entry.tier}
                            </small>
                            <small>
                              {entry.country_name} / Reputation{" "}
                              {Math.round(entry.reputation)}
                            </small>
                          </span>
                          {clubId === entry.id && (
                            <Badge tone="green">Selected</Badge>
                          )}
                        </button>
                      ))}
                    </Fragment>
                  ))
                )}
              </div>
              <div className="career-club-pagination">
                <span>
                  {clubPage ? `${compactNumber(clubPage.total)} clubs` : ""}
                </span>
                <div className="inline-controls">
                  <IconButton
                    icon={ChevronLeft}
                    label="Previous career club page"
                    disabled={clubsLoading || !clubPage || clubPage.page <= 1}
                    onClick={() =>
                      setPagination({
                        key: filterKey,
                        page: (clubPage?.page ?? page) - 1,
                      })
                    }
                  />
                  <span>
                    {clubPage ? `${clubPage.page} / ${clubPage.pages}` : "-"}
                  </span>
                  <IconButton
                    icon={ChevronRight}
                    label="Next career club page"
                    disabled={
                      clubsLoading ||
                      !clubPage ||
                      clubPage.page >= clubPage.pages
                    }
                    onClick={() =>
                      setPagination({
                        key: filterKey,
                        page: (clubPage?.page ?? page) + 1,
                      })
                    }
                  />
                </div>
              </div>
              <p className="selected-club-note">
                Appointment: <strong>{selectedClub.name}</strong>
                <span>
                  {selectedClub.league_name} / {selectedClub.country_name}
                </span>
              </p>
            </section>
          </form>
        )}
        {view === "load" && (
          <section className="saved-careers">
            <div className="search-field">
              <Search size={17} />
              <input
                aria-label="Search saved careers"
                placeholder="Career, club or director..."
                value={saveSearch}
                onChange={(event) => setSaveSearch(event.target.value)}
              />
            </div>
            {savesLoading ? (
              <Loading label="Loading saved careers" />
            ) : savesError ? null : saveGroups.length ? (
              <SavedCareers
                slots={saves ?? []}
                search={saveSearch}
                activeCareerId={state?.started ? state.careerId : undefined}
                pending={pending || deleting}
                onLoad={setLoad}
                onDelete={(slot) => {
                  setError(null);
                  setRemove(slot);
                }}
              />
            ) : (
              <Empty
                icon={FolderOpen}
                title="No saved careers"
                detail="Named saves and autosaves will appear here."
              >
                <Button
                  icon={preparing ? LoaderCircle : Plus}
                  disabled={pending || preparing}
                  onClick={() => void newCareer()}
                >
                  {preparing
                    ? "Preparing your world..."
                    : preparation === "failed"
                      ? "Retry preparation"
                      : "New career"}
                </Button>
              </Empty>
            )}
          </section>
        )}
      </section>
      {world && (
        <footer className="career-start-footer">
          <span>{world.countries} associations</span>
          <span>{compactNumber(world.clubs)} clubs</span>
          <span>{compactNumber(world.players)} players</span>
        </footer>
      )}
      {profile && <CareerSheet close={() => setProfile(false)} />}
      {load && (
        <Modal title="Load this career?" onClose={() => setLoad(null)}>
          <div className="sheet-body">
            <h3>{load.career?.name ?? load.name}</h3>
            <p className="sheet-description">
              {state?.started
                ? "Your current career will be saved before switching."
                : "Open this saved career."}
            </p>
          </div>
          <footer className="sheet-footer">
            <Button variant="secondary" onClick={() => setLoad(null)}>
              Cancel
            </Button>
            <Button icon={FolderOpen} onClick={() => void loadCareer(load)}>
              Load career
            </Button>
          </footer>
        </Modal>
      )}
      {remove && (
        <Modal
          title={
            remove.career?.id ? "Delete this career?" : "Delete this save?"
          }
          onClose={() => {
            if (!deleting) setRemove(null);
          }}
        >
          <div className="sheet-body">
            <h3>{remove.career?.name ?? remove.name}</h3>
            {remove.career && (
              <p className="sheet-description">
                {remove.career.director} / {remove.career.club}
              </p>
            )}
            <p className="sheet-description">
              This will permanently delete {deleteCount} saved{" "}
              {deleteCount === 1 ? "snapshot" : "snapshots"}
              {remove.career?.id ? " belonging to this career" : ""}. This
              cannot be undone. Your active career will not be changed.
            </p>
            {error && <ErrorState message={error} />}
          </div>
          <footer className="sheet-footer">
            <Button
              variant="secondary"
              disabled={deleting}
              onClick={() => setRemove(null)}
            >
              Cancel
            </Button>
            <Button
              variant="danger"
              icon={deleting ? LoaderCircle : Trash2}
              disabled={deleting}
              onClick={() => void deleteCareer(remove)}
            >
              {deleting
                ? "Deleting..."
                : remove.career?.id
                  ? "Delete career"
                  : "Delete save"}
            </Button>
          </footer>
        </Modal>
      )}
      {(pending || preparing) && (
        <div className="simulation-overlay" role="status" aria-live="polite">
          <LoaderCircle className="spin" size={32} />
          <h2>
            {preparing
              ? "Preparing your private world."
              : view === "new"
                ? "A new football world."
                : "Opening your career."}
          </h2>
          <p>Preparing your career.</p>
          <div className="simulation-track">
            <span />
          </div>
        </div>
      )}
    </main>
  );
}
