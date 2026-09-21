import { Clock3, Folder, FolderOpen, Trash2 } from "lucide-react";
import { Badge, Button, IconButton } from "./ui.tsx";
import { dateLabel, groupCareerSaves } from "../shared/rules.ts";
import type { SaveSlot } from "../shared/api.ts";

export default function SavedCareers({
  slots,
  search = "",
  activeCareerId,
  pending = false,
  onLoad,
  onDelete,
}: {
  slots: SaveSlot[];
  search?: string;
  activeCareerId?: string;
  pending?: boolean;
  onLoad: (slot: SaveSlot) => void;
  onDelete?: (slot: SaveSlot) => void;
}) {
  const groups = groupCareerSaves(slots, search);
  function snapshot(slot: SaveSlot) {
    return (
      <div
        className="career-snapshot"
        key={slot.file}
        data-save-file={slot.file}
      >
        <div>
          <strong>{slot.name}</strong>
          <small>
            {slot.career
              ? dateLabel(slot.career.date)
              : new Date(slot.modified).toLocaleString("en-GB")}{" "}
            / {(slot.size / 1_000_000).toFixed(1)} MB
          </small>
        </div>
        <Button
          icon={FolderOpen}
          variant="ghost"
          disabled={pending}
          aria-label={`Load snapshot ${slot.name} ${slot.career?.date ?? slot.modified}`}
          onClick={() => onLoad(slot)}
        >
          Load
        </Button>
      </div>
    );
  }
  return (
    <div className="career-folder-list">
      {groups.map((group) => {
        const slot = group.latest;
        const active = !!slot.career?.id && slot.career.id === activeCareerId;
        return (
          <article
            className="career-save-item career-folder"
            key={group.key}
            data-career-id={slot.career?.id}
          >
            <header className="career-folder-heading">
              <Folder size={24} className="muted" />
              <div>
                <h3>{slot.career?.name ?? slot.name}</h3>
                <p>
                  {slot.career
                    ? `${slot.career.director} / ${slot.career.club}`
                    : "Saved snapshot"}
                </p>
                <small>
                  {slot.career
                    ? dateLabel(slot.career.date)
                    : new Date(slot.modified).toLocaleDateString("en-GB")}{" "}
                  / {group.count} {group.count === 1 ? "snapshot" : "snapshots"}
                </small>
              </div>
              {active && <Badge tone="green">Active</Badge>}
              <Button
                icon={FolderOpen}
                variant="secondary"
                disabled={pending}
                onClick={() => onLoad(slot)}
              >
                Load career
              </Button>
              {onDelete && (
                <IconButton
                  icon={Trash2}
                  className="career-delete-button"
                  label={
                    active
                      ? "Active career cannot be deleted"
                      : slot.career?.id
                        ? `Delete career ${slot.career.name}`
                        : `Delete save ${slot.name}`
                  }
                  disabled={active || pending}
                  onClick={() => onDelete(slot)}
                />
              )}
            </header>
            <details className="career-snapshot-folder">
              <summary>
                Saved snapshots <span>{group.count}</span>
              </summary>
              {group.manual.length > 0 && (
                <section aria-label="Manual saves">
                  <h4>Manual saves</h4>
                  {group.manual.map(snapshot)}
                </section>
              )}
              {group.autosaves.length > 0 && (
                <details className="career-autosave-folder">
                  <summary>
                    <Clock3 size={15} />
                    Autosaves <span>{group.autosaves.length}</span>
                  </summary>
                  <div>{group.autosaves.map(snapshot)}</div>
                </details>
              )}
            </details>
          </article>
        );
      })}
    </div>
  );
}
