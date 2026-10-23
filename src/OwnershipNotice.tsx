import { Landmark } from "lucide-react";
import { useGame, useResource } from "./game-context.tsx";
import { Badge, Button, Meter } from "./ui.tsx";
import { dateLabel } from "../shared/rules.ts";
import type { OwnershipNotice as Notice } from "../shared/api.ts";

const STAGE_LABEL: Record<Notice["stage"], string> = {
  rumour: "Takeover talk",
  talks: "Takeover talks",
  review: "Owners' review",
  election: "Presidential election",
};

/** Office notice while the director's club is being sold, reviewed by new owners, or electing a president. */
export default function OwnershipNotice() {
  const { navigate } = useGame();
  const { data } = useResource<Notice | null>("ownership/notice");
  if (!data) return null;
  return (
    <section className="panel section-space" aria-label="Ownership notice">
      <div className="data-list-row">
        <span>
          <Badge tone={data.stage === "review" ? "warning" : "important"}>
            <Landmark size={12} /> {STAGE_LABEL[data.stage]}
          </Badge>
          <strong> {data.title}</strong>
          <p>{data.detail}</p>
          {data.target !== null && data.confidence !== null && (
            <span className="inline-controls">
              <Meter value={data.confidence} max={100} tone={data.confidence >= data.target ? "green" : "amber"} />
              <small>
                Board confidence {data.confidence} / target {data.target}
              </small>
            </span>
          )}
        </span>
        <span>
          {data.due && <time>{dateLabel(data.due)}</time>}
          <Button variant="secondary" onClick={() => navigate("board")}>
            Board
          </Button>
        </span>
      </div>
    </section>
  );
}
