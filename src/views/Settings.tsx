import { useDeferredValue, useRef, useState } from "react";
import {
  Award,
  Check,
  Download,
  GraduationCap,
  Handshake,
  HardDrive,
  LockKeyhole,
  Monitor,
  Moon,
  Network,
  Plus,
  RotateCcw,
  Save,
  ScanLine,
  Search,
  SlidersHorizontal,
  Sun,
  Upload,
  UserRound,
  Wallet,
} from "lucide-react";
import { api, useCurrency, useGame, useResource } from "../game-context.tsx";
import {
  Badge,
  Button,
  DetailList,
  Empty,
  ErrorState,
  Field,
  IconButton,
  Loading,
  Modal,
  PageHeading,
  Panel,
  SectionHeading,
  Toggle,
} from "../ui.tsx";
import {
  dateLabel,
  CURRENCIES,
  label,
  SETTING_DEFINITIONS,
} from "../../shared/rules.ts";
import { PORTABLE_SAVE_EXTENSION, type SaveSlot } from "../../shared/api.ts";
import type { Club, SettingValue } from "../../shared/types.ts";
import SavedCareers from "../SavedCareers.tsx";

export function CareerSheet({ close }: { close: () => void }) {
  const { bootstrap, act } = useGame();
  const [name, setName] = useState(bootstrap?.state.director.name ?? "");
  const [background, setBackground] = useState(
    bootstrap?.state.director.background ?? "Former scout",
  );
  const [clubId, setClubId] = useState(bootstrap?.club.id ?? 1);
  const [search, setSearch] = useState("");
  const deferred = useDeferredValue(search);
  const { data: clubs } = useResource<Club[]>(
    `clubs?q=${encodeURIComponent(deferred)}&limit=100`,
  );
  const canChoose = !bootstrap?.state.started || bootstrap.state.gameOver;
  return (
    <Modal
      title={
        bootstrap?.state.gameOver ? "Your next chapter" : "Director profile"
      }
      onClose={close}
    >
      <div className="sheet-body">
        <div className="form-grid">
          <Field label="Director name" className="span-2">
            <input
              value={name}
              onChange={(event) => setName(event.target.value)}
              maxLength={50}
            />
          </Field>
          <Field label="Professional background" className="span-2">
            <select
              value={background}
              onChange={(event) => setBackground(event.target.value)}
            >
              {SETTING_DEFINITIONS.find(
                (setting) => setting.id === "directorBackground",
              )!.options!.map((value) => (
                <option key={value}>{value}</option>
              ))}
            </select>
          </Field>
          {canChoose && (
            <>
              <div className="search-field span-2">
                <Search size={16} />
                <input
                  aria-label="Search career clubs"
                  placeholder="Search clubs..."
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                />
              </div>
              <Field label="Club appointment" className="span-2">
                <select
                  value={clubId}
                  onChange={(event) => setClubId(Number(event.target.value))}
                >
                  {bootstrap &&
                    !clubs?.some((club) => club.id === bootstrap.club.id) && (
                      <option value={bootstrap.club.id}>
                        {bootstrap.club.name}
                      </option>
                    )}
                  {clubs?.map((club) => (
                    <option key={club.id} value={club.id}>
                      {club.name} / {club.country_name}
                    </option>
                  ))}
                </select>
              </Field>
            </>
          )}
        </div>
        <div className="section-space">
          <Badge tone="green">
            {bootstrap?.state.started
              ? dateLabel(bootstrap.state.date)
              : "SUMMER 2026"}
          </Badge>
        </div>
      </div>
      <footer className="sheet-footer">
        <Button variant="secondary" onClick={close}>
          Cancel
        </Button>
        <Button
          icon={UserRound}
          disabled={name.trim().length < 2}
          onClick={() =>
            void act({ type: "career", name, background, clubId }).then(
              (result) => {
                if (result) close();
              },
            )
          }
        >
          {bootstrap?.state.started && !bootstrap.state.gameOver
            ? "Update profile"
            : "Accept appointment"}
        </Button>
      </footer>
    </Modal>
  );
}

function SaveSettings() {
  const { bootstrap, notify, refresh, confirm, revision } = useGame();
  const { data: slots, error } = useResource<SaveSlot[]>("saves");
  const [name, setName] = useState("My career");
  const [pending, setPending] = useState(false);
  const upload = useRef<HTMLInputElement>(null);
  async function save() {
    setPending(true);
    try {
      await api("saves", { method: "POST", body: JSON.stringify({ name }) });
      await refresh();
      notify("Career snapshot created.");
    } catch (failure) {
      notify(
        failure instanceof Error ? failure.message : "Save failed.",
        "error",
      );
    } finally {
      setPending(false);
    }
  }
  async function restore(file: string) {
    setPending(true);
    try {
      await api("saves/restore", {
        method: "POST",
        body: JSON.stringify({ file }),
      });
      await refresh();
      notify("Career restored.");
    } catch (failure) {
      notify(
        failure instanceof Error ? failure.message : "Restore failed.",
        "error",
      );
    } finally {
      setPending(false);
    }
  }
  async function importFile(file: File) {
    setPending(true);
    try {
      await api("saves/import", {
        method: "POST",
        headers: { "Content-Type": "application/octet-stream" },
        body: file,
      });
      await refresh();
      notify("Portable career imported.");
    } catch (failure) {
      notify(
        failure instanceof Error ? failure.message : "Import failed.",
        "error",
      );
    } finally {
      setPending(false);
      if (upload.current) upload.current.value = "";
    }
  }
  return (
    <>
      <Panel className="section-space">
        <SectionHeading
          title="Career snapshots"
          subtitle={`Current career: ${dateLabel(bootstrap?.state.date ?? "2026-07-01")}`}
        />
        <div className="save-controls">
          <input
            aria-label="Save name"
            value={name}
            maxLength={60}
            onChange={(event) => setName(event.target.value)}
          />
          <Button
            icon={Save}
            onClick={() => void save()}
            disabled={pending || !name.trim()}
          >
            {pending ? "Working..." : "Save career"}
          </Button>
          <a
            href="/api/saves/export"
            className="button button-secondary"
            aria-disabled={pending}
            onClick={(event) => {
              if (pending) event.preventDefault();
            }}
          >
            <Download size={16} />
            Export
          </a>
          <Button
            icon={Upload}
            variant="secondary"
            onClick={() => upload.current?.click()}
            disabled={pending}
          >
            Import
          </Button>
          <input
            ref={upload}
            key={revision}
            className="sr-only"
            type="file"
            aria-label="Import portable game save"
            accept={PORTABLE_SAVE_EXTENSION}
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (!file) return;
              if (!file.name.toLowerCase().endsWith(PORTABLE_SAVE_EXTENSION)) {
                notify("Choose a portable .touchline.gz save file.", "error");
                event.currentTarget.value = "";
                return;
              }
              confirm(
                "Replace the current career?",
                "The selected snapshot will replace the active game. Create a save slot first to preserve your current progress.",
                () => {
                  void importFile(file);
                },
              );
            }}
          />
        </div>
        {error && <ErrorState message={error} />}
        {slots?.length ? (
          <SavedCareers
            slots={slots}
            activeCareerId={bootstrap?.state.careerId}
            pending={pending}
            onLoad={(slot) =>
              confirm(
                "Restore this career?",
                "The selected snapshot will replace your active career. Unsaved progress after this point will be lost.",
                () => {
                  void restore(slot.file);
                },
              )
            }
          />
        ) : (
          <Empty
            icon={HardDrive}
            title="No saved snapshots yet"
            detail="Your active career is stored in the game database."
          />
        )}
      </Panel>
      <div className="information-note section-space">
        <LockKeyhole size={16} />
        <span>Portable career snapshots / .touchline.gz</span>
      </div>
    </>
  );
}

function DirectorSkills() {
  const { bootstrap, act } = useGame();
  const icons = {
    scouting: ScanLine,
    negotiations: Handshake,
    development: GraduationCap,
    finance: Wallet,
    leadership: Network,
  };
  if (!bootstrap) return null;
  return (
    <section className="section-space">
      <div className="unframed-heading">
        <h2>Director skills</h2>
        <Badge tone="green">
          {bootstrap.state.director.skillPoints} points available
        </Badge>
      </div>
      <div className="skill-grid">
        {Object.entries(bootstrap.state.director.skills).map(
          ([skill, level]) => {
            const Icon = icons[skill as keyof typeof icons];
            return (
              <article className="skill-card" key={skill}>
                <Icon size={23} strokeWidth={1.6} />
                <strong>{label(skill)}</strong>
                <div className="skill-levels">
                  {[1, 2, 3, 4, 5].map((value) => (
                    <i key={value} className={level >= value ? "filled" : ""} />
                  ))}
                </div>
                <Button
                  icon={Plus}
                  variant="secondary"
                  disabled={
                    bootstrap.state.director.skillPoints < 1 ||
                    level >= 5 ||
                    bootstrap.settings.skillTreeMode === "disabled"
                  }
                  onClick={() => void act({ type: "skill", skill })}
                >
                  Develop
                </Button>
              </article>
            );
          },
        )}
      </div>
    </section>
  );
}

function AccentColorControl({
  id,
  value,
  defaultValue,
  onChange,
}: {
  id: string;
  value: string;
  defaultValue: string;
  onChange: (color: string) => void;
}) {
  const [draft, setDraft] = useState<{ base: string; text: string } | null>(
    null,
  );
  const text = draft?.base === value ? draft.text : value;
  const digits = text.trim().replace(/^#/, "");
  const normalized = /^(?:[0-9a-f]{3}|[0-9a-f]{6})$/i.test(digits)
    ? `#${(digits.length === 3 ? [...digits].map((digit) => digit + digit).join("") : digits).toLowerCase()}`
    : null;
  function choose(color: string) {
    setDraft(null);
    if (color !== value) onChange(color);
  }
  return (
    <div className="accent-color-control">
      <div className="color-swatches">
        {["#087f6d", "#367cb5", "#ad4d65", "#896522", "#665c9a"].map(
          (color) => (
            <button
              type="button"
              key={color}
              className={`color-swatch ${value.toLowerCase() === color ? "active" : ""}`}
              style={{ background: color }}
              aria-label={`Accent ${color}`}
              aria-pressed={value.toLowerCase() === color}
              title={`Accent ${color}`}
              onClick={() => choose(color)}
            >
              {value.toLowerCase() === color && <Check size={13} />}
            </button>
          ),
        )}
        <input
          aria-label="Custom accent color"
          className="color-custom"
          type="color"
          value={value}
          onChange={(event) => choose(event.target.value)}
        />
      </div>
      <div className="accent-code-controls">
        <span aria-hidden="true">HEX</span>
        <input
          id={id}
          aria-label="Accent color HEX code"
          aria-invalid={!normalized}
          aria-describedby={!normalized ? `${id}-error` : undefined}
          value={text}
          maxLength={9}
          autoComplete="off"
          autoCapitalize="none"
          spellCheck={false}
          placeholder="#087f6d"
          onChange={(event) =>
            setDraft({ base: value, text: event.target.value })
          }
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              if (normalized) choose(normalized);
            } else if (event.key === "Escape") setDraft(null);
          }}
        />
        <IconButton
          icon={Check}
          label="Apply accent color"
          disabled={!normalized || normalized === value.toLowerCase()}
          onClick={() => {
            if (normalized) choose(normalized);
          }}
        />
        <IconButton
          icon={RotateCcw}
          label="Reset accent color"
          disabled={value === defaultValue && !draft}
          onClick={() => choose(defaultValue)}
        />
      </div>
      {!normalized && (
        <span className="accent-code-error" id={`${id}-error`} role="alert">
          Invalid HEX code
        </span>
      )}
    </div>
  );
}

export default function Settings() {
  const { bootstrap, changeSettings } = useGame();
  const { money } = useCurrency();
  const [group, setGroup] = useState("Appearance");
  const [career, setCareer] = useState(false);
  const categories = [
    ...new Set(SETTING_DEFINITIONS.map((setting) => setting.group)),
  ];
  if (!bootstrap) return <Loading />;
  function update(id: string, value: SettingValue) {
    void changeSettings({ [id]: value });
  }
  return (
    <div className="page">
      <PageHeading
        eyebrow="YOUR CAREER, YOUR WORLD"
        title="Settings"
        subtitle="Preferences for this career."
      >
        <Button
          icon={UserRound}
          variant="secondary"
          onClick={() => setCareer(true)}
        >
          Director profile
        </Button>
      </PageHeading>
      <div className="settings-layout">
        <nav className="settings-nav" aria-label="Settings categories">
          {categories.map((category) => (
            <button
              className={group === category ? "active" : ""}
              key={category}
              onClick={() => setGroup(category)}
            >
              {category}
            </button>
          ))}
        </nav>
        <div>
          <Panel>
            <SectionHeading title={group} />
            <div>
              {SETTING_DEFINITIONS.filter(
                (setting) => setting.group === group,
              ).map((setting) => {
                const value = bootstrap.settings[setting.id] ?? setting.default;
                return (
                  <div
                    className={`setting-row${setting.id === "theme" ? " setting-appearance" : ""}${setting.type === "color" ? " setting-color" : ""}`}
                    key={setting.id}
                  >
                    {setting.id === "theme" || setting.id === "uiTheme" ? (
                      <span
                        id={`setting-${setting.id}-label`}
                        className="setting-label"
                      >
                        {setting.label}
                      </span>
                    ) : (
                      <label htmlFor={`setting-${setting.id}`}>
                        {setting.label}
                      </label>
                    )}
                    {setting.id === "uiTheme" ? (
                      <div
                        className="theme-choices ui-layout-choices"
                        role="radiogroup"
                        aria-labelledby="setting-uiTheme-label"
                      >
                        {[
                          {
                            id: "minimal",
                            label: "Minimal",
                            icon: SlidersHorizontal,
                          },
                          { id: "classic", label: "Classic", icon: Monitor },
                        ].map((layout) => (
                          <label className="theme-choice" key={layout.id}>
                            <input
                              type="radio"
                              name="ui-layout"
                              value={layout.id}
                              checked={value === layout.id}
                              onChange={() => update("uiTheme", layout.id)}
                            />
                            <span>
                              <layout.icon size={16} />
                              {layout.label}
                            </span>
                          </label>
                        ))}
                      </div>
                    ) : setting.id === "theme" ? (
                      <div
                        className="theme-choices"
                        role="radiogroup"
                        aria-labelledby="setting-theme-label"
                      >
                        {[
                          { id: "light", name: "Light", icon: Sun },
                          { id: "dark", name: "Dark", icon: Moon },
                          { id: "system", name: "System", icon: Monitor },
                        ].map((theme) => (
                          <label className="theme-choice" key={theme.id}>
                            <input
                              type="radio"
                              name="appearance"
                              value={theme.id}
                              checked={value === theme.id}
                              onChange={() => update("theme", theme.id)}
                            />
                            <span>
                              <theme.icon
                                size={16}
                                strokeWidth={1.7}
                                aria-hidden="true"
                              />
                              {theme.name}
                            </span>
                          </label>
                        ))}
                      </div>
                    ) : setting.type === "toggle" ? (
                      <Toggle
                        checked={Boolean(value)}
                        label={setting.label}
                        disabled={setting.disabled}
                        onChange={(checked) => update(setting.id, checked)}
                      />
                    ) : setting.type === "select" ? (
                      <select
                        id={`setting-${setting.id}`}
                        value={String(value)}
                        onChange={(event) =>
                          update(setting.id, event.target.value)
                        }
                      >
                        {setting.options?.map((option) => (
                          <option key={option} value={option}>
                            {setting.id === "currency"
                              ? `${option} / ${CURRENCIES.find((currency) => currency.code === option)?.name}`
                              : label(option)}
                          </option>
                        ))}
                      </select>
                    ) : setting.type === "range" ? (
                      <div className="range-control">
                        <input
                          id={`setting-${setting.id}`}
                          type="range"
                          min={setting.min}
                          max={setting.max}
                          step={setting.step ?? 1}
                          value={Number(value)}
                          onChange={(event) =>
                            update(setting.id, Number(event.target.value))
                          }
                        />
                        <span>{String(value)}</span>
                      </div>
                    ) : (
                      <AccentColorControl
                        id={`setting-${setting.id}`}
                        value={String(value)}
                        defaultValue={String(setting.default)}
                        onChange={(color) => update(setting.id, color)}
                      />
                    )}
                  </div>
                );
              })}
            </div>
          </Panel>
          {group === "Saves" && <SaveSettings />}
          {group === "Director" && (
            <>
              <Panel className="section-space">
                <SectionHeading title="Career record">
                  <Award size={18} className="muted" />
                </SectionHeading>
                <div className="padded">
                  <DetailList
                    items={[
                      ["Director", bootstrap.state.director.name],
                      ["Club", bootstrap.club.name],
                      [
                        "Reputation",
                        `${Math.round(bootstrap.state.director.reputation)}/100`,
                      ],
                      ["Experience", bootstrap.state.director.experience],
                      [
                        "Transfer budget",
                        money(bootstrap.club.transfer_budget),
                      ],
                      [
                        "Career status",
                        bootstrap.state.gameOver
                          ? "Available for a new role"
                          : "In post",
                      ],
                    ]}
                  />
                </div>
              </Panel>
              <DirectorSkills />
            </>
          )}
          {group === "Experimental" && (
            <div className="information-note section-space">
              <SlidersHorizontal size={16} />
              <span>
                Experimental changes affect future simulation events. Existing
                match results remain unchanged.
              </span>
            </div>
          )}
        </div>
      </div>
      {career && <CareerSheet close={() => setCareer(false)} />}
    </div>
  );
}
