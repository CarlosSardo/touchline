import type { ReactNode } from "react";
import { TriangleAlert } from "lucide-react";
import { dateLabel } from "../shared/rules.ts";
import { MANUAL_SAVE_LIMIT, type ListedSave } from "./save-rotation.ts";

function savedAt(modified: string) {
  return new Date(modified).toLocaleString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/** Names the manual saves that a new manual save of this career permanently deletes. */
export function SaveReplacementWarning({
  id,
  saves,
  children,
}: {
  id?: string;
  saves: readonly ListedSave[];
  children: ReactNode;
}) {
  return (
    <div className="save-replacement" id={id}>
      <p>
        <TriangleAlert size={16} aria-hidden="true" />
        <span>
          Each career keeps up to {MANUAL_SAVE_LIMIT} manual saves. {children}
        </span>
      </p>
      <ul>
        {saves.map((slot) => (
          <li key={slot.file}>
            <strong>{slot.name}</strong>
            <small>
              {slot.career ? `${dateLabel(slot.career.date)} / ` : ""}saved{" "}
              {savedAt(slot.modified)}
            </small>
          </li>
        ))}
      </ul>
    </div>
  );
}
