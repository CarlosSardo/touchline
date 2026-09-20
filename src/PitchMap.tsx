import { useEffect, useRef, useState } from "react";
import type { MatchAction } from "../shared/types.ts";

function mapActions(
  actions: MatchAction[],
  mode: string,
  teamId: number,
  playerId: number,
  minute: number,
  progressive: boolean,
) {
  return actions.filter((action) => {
    if (
      (teamId && action.teamId !== teamId) ||
      (playerId && action.playerId !== playerId) ||
      action.minute > minute
    )
      return false;
    if (mode === "Pass map")
      return action.type === "pass" && (!progressive || action.progressive);
    if (mode === "Carry map") return action.type === "carry";
    if (mode === "Dribble map") return action.type === "dribble";
    if (mode === "Shot map") return action.type === "shot";
    if (mode === "Defensive map")
      return ["tackle", "interception", "recovery", "save"].includes(
        action.type,
      );
    if (mode === "Pressing zones") return action.type === "press";
    return true;
  });
}

export default function PitchMap({
  actions,
  mode,
  teamId,
  playerId,
  minute,
  progressive = false,
}: {
  actions: MatchAction[];
  mode: string;
  teamId: number;
  playerId: number;
  minute: number;
  progressive?: boolean;
}) {
  const ref = useRef<HTMLCanvasElement>(null);
  const plotted = useRef<MatchAction[]>([]);
  const [hovered, setHovered] = useState<MatchAction | null>(null);
  useEffect(() => {
    const canvas = ref.current!;
    const draw = () => {
      const bounds = canvas.getBoundingClientRect();
      const ratio = window.devicePixelRatio || 1;
      const width = bounds.width || 700;
      const height = (width * 68) / 105;
      canvas.width = Math.round(width * ratio);
      canvas.height = Math.round(height * ratio);
      const context = canvas.getContext("2d")!;
      context.scale(ratio, ratio);
      context.fillStyle = "#193b2f";
      context.fillRect(0, 0, width, height);
      const padding = width * 0.045;
      const pitchWidth = width - padding * 2;
      const pitchHeight = height - padding * 2;
      const position = (x: number, y: number) => [
        padding + (x / 100) * pitchWidth,
        padding + (y / 100) * pitchHeight,
      ];
      for (let stripe = 0; stripe < 10; stripe++) {
        context.fillStyle = stripe % 2 ? "#ffffff04" : "#00000005";
        context.fillRect(
          padding + (stripe * pitchWidth) / 10,
          padding,
          pitchWidth / 10,
          pitchHeight,
        );
      }
      context.strokeStyle = "#b7d2b46b";
      context.lineWidth = Math.max(0.6, width / 900);
      context.strokeRect(padding, padding, pitchWidth, pitchHeight);
      context.beginPath();
      context.moveTo(width / 2, padding);
      context.lineTo(width / 2, height - padding);
      context.stroke();
      context.beginPath();
      context.arc(width / 2, height / 2, pitchWidth * 0.087, 0, Math.PI * 2);
      context.stroke();
      context.beginPath();
      context.arc(width / 2, height / 2, 1.5, 0, Math.PI * 2);
      context.fillStyle = "#c5dfba99";
      context.fill();
      for (const right of [false, true]) {
        const sideX = right ? width - padding : padding;
        const direction = right ? -1 : 1;
        context.strokeRect(
          sideX,
          height / 2 - pitchHeight * 0.297,
          direction * pitchWidth * 0.157,
          pitchHeight * 0.594,
        );
        context.strokeRect(
          sideX,
          height / 2 - pitchHeight * 0.135,
          direction * pitchWidth * 0.052,
          pitchHeight * 0.27,
        );
        context.strokeRect(
          sideX,
          height / 2 - pitchHeight * 0.055,
          -direction * pitchWidth * 0.019,
          pitchHeight * 0.11,
        );
        context.beginPath();
        context.arc(
          sideX + direction * pitchWidth * 0.105,
          height / 2,
          1.3,
          0,
          Math.PI * 2,
        );
        context.fill();
      }
      const filtered = mapActions(
        actions,
        mode,
        teamId,
        playerId,
        minute,
        progressive,
      );
      plotted.current = filtered;
      if (["Heatmap", "Pressing zones", "Fatigue map"].includes(mode)) {
        const columns = 12;
        const rows = 8;
        const bins = Array.from({ length: columns * rows }, () => ({
          count: 0,
          fatigue: 0,
        }));
        for (const action of filtered) {
          const column = Math.max(
            0,
            Math.min(columns - 1, Math.floor((action.x / 100) * columns)),
          );
          const row = Math.max(
            0,
            Math.min(rows - 1, Math.floor((action.y / 100) * rows)),
          );
          bins[row * columns + column].count++;
          bins[row * columns + column].fatigue += 100 - action.fatigue;
        }
        const maximum = Math.max(1, ...bins.map((bin) => bin.count));
        bins.forEach((bin, index) => {
          if (!bin.count) return;
          const intensity =
            mode === "Fatigue map"
              ? bin.fatigue / bin.count / 70
              : bin.count / maximum;
          const column = index % columns;
          const row = Math.floor(index / columns);
          const hue =
            mode === "Fatigue map"
              ? 42 - intensity * 35
              : 155 - intensity * 105;
          context.fillStyle = `hsla(${hue},85%,60%,${Math.min(0.75, 0.12 + intensity * 0.65)})`;
          context.fillRect(
            padding + (column * pitchWidth) / columns + 1,
            padding + (row * pitchHeight) / rows + 1,
            pitchWidth / columns - 2,
            pitchHeight / rows - 2,
          );
          if (width > 430) {
            context.font = `500 ${Math.max(9, width / 65)}px "DM Sans Variable",sans-serif`;
            context.textAlign = "center";
            context.fillStyle = "#ebf5eacf";
            context.fillText(
              mode === "Fatigue map"
                ? `${Math.round(100 - bin.fatigue / bin.count)}`
                : String(bin.count),
              padding + ((column + 0.5) * pitchWidth) / columns,
              padding + ((row + 0.55) * pitchHeight) / rows,
            );
          }
        });
      } else {
        for (const action of filtered) {
          const [startX, startY] = position(action.x, action.y);
          const [endX, endY] = position(action.endX, action.endY);
          const success = ["complete", "won", "goal", "saved"].includes(
            action.outcome,
          );
          const shot = action.type === "shot";
          const color =
            action.outcome === "goal"
              ? "#f2dc91"
              : success
                ? "#7af2bd"
                : "#f58f84";
          context.strokeStyle = color;
          context.fillStyle = color;
          context.globalAlpha = shot ? 0.95 : success ? 0.48 : 0.55;
          context.lineWidth = shot ? 1.5 : width > 600 ? 1 : 0.8;
          if (["pass", "carry", "dribble", "shot"].includes(action.type)) {
            context.beginPath();
            context.moveTo(startX, startY);
            context.lineTo(endX, endY);
            context.stroke();
            const angle = Math.atan2(endY - startY, endX - startX);
            const arrow = width > 500 ? 4 : 3;
            context.beginPath();
            context.moveTo(endX, endY);
            context.lineTo(
              endX - arrow * Math.cos(angle - 0.4),
              endY - arrow * Math.sin(angle - 0.4),
            );
            context.lineTo(
              endX - arrow * Math.cos(angle + 0.4),
              endY - arrow * Math.sin(angle + 0.4),
            );
            context.closePath();
            context.fill();
          }
          context.beginPath();
          context.arc(
            startX,
            startY,
            shot ? 3 + (action.xg ?? 0.1) * 13 : 1.8,
            0,
            Math.PI * 2,
          );
          if (shot && action.outcome !== "goal") {
            context.globalAlpha = 0.28;
            context.fill();
            context.globalAlpha = 1;
            context.stroke();
          } else context.fill();
        }
      }
      context.globalAlpha = 1;
    };
    const observer = new ResizeObserver(draw);
    observer.observe(canvas);
    draw();
    return () => observer.disconnect();
  }, [actions, mode, teamId, playerId, minute, progressive]);
  return (
    <div className="pitch-container">
      <canvas
        ref={ref}
        className="pitch-canvas"
        role="img"
        aria-label={`${mode}: football match action locations`}
        onPointerMove={(event) => {
          const bounds = event.currentTarget.getBoundingClientRect();
          const padding = bounds.width * 0.045;
          const x =
            ((event.clientX - bounds.left - padding) /
              (bounds.width - padding * 2)) *
            100;
          const y =
            ((event.clientY - bounds.top - padding) /
              (bounds.height - padding * 2)) *
            100;
          const closest = plotted.current.reduce<{
            action: MatchAction | null;
            distance: number;
          }>(
            (best, action) => {
              const distance = Math.hypot(action.x - x, action.y - y);
              return distance < best.distance ? { action, distance } : best;
            },
            { action: null, distance: 5 },
          );
          setHovered(closest.action);
        }}
        onPointerLeave={() => setHovered(null)}
      />
      {hovered && (
        <div className="pitch-action-tooltip">
          {hovered.minute}:{String(hovered.second).padStart(2, "0")} /{" "}
          {hovered.type} / {hovered.outcome} / difficulty {hovered.difficulty}
          {hovered.xg !== undefined ? ` / xG ${hovered.xg.toFixed(2)}` : ""}
        </div>
      )}
      <div className="pitch-legend">
        <span>
          <i />
          Completed / won
        </span>
        <span>
          <i className="fail" />
          Incomplete / lost
        </span>
        <span>
          <i className="alt" />
          Goal
        </span>
        <span className="pitch-event-count">
          {mapActions(
            actions,
            mode,
            teamId,
            playerId,
            minute,
            progressive,
          ).length.toLocaleString()}{" "}
          actions
        </span>
      </div>
    </div>
  );
}
