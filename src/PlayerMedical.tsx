import { HeartHandshake, HeartPulse } from "lucide-react";
import { useGame, useResource } from "./game-context.tsx";
import { Badge, Button, ClubLink, DetailList, ErrorState, Loading, Meter } from "./ui.tsx";
import { dateLabel, label } from "../shared/rules.ts";
import type { PlayerDetail, PlayerMedical as PlayerMedicalData } from "../shared/api.ts";
import { SEVERITY_LABELS, SEVERITY_TONES } from "./player-history.ts";
import "./PlayerHistory.css";

const daysText = (days: number | null) => (days === null ? "—" : days === 1 ? "1 day" : `${days} days`);

/** The Medical tab: current injury, fitness and wellbeing, and the recorded injury history. */
export default function PlayerMedical({ data, own }: { data: PlayerDetail; own: boolean }) {
  const { act } = useGame();
  const { data: medical, error } = useResource<PlayerMedicalData>(`players/${data.player.id}/medical`);
  return (
    <div className="profile-columns">
      <div>
        <section className="profile-section">
          <h3>Current status</h3>
          {error ? (
            <ErrorState message={error} />
          ) : !medical ? (
            <Loading label="Opening medical record" />
          ) : medical.injuredUntil ? (
            <div className="medical-current" role="status">
              <HeartPulse size={18} aria-hidden="true" />
              <div>
                <strong>{medical.current?.kind ?? "Injured"}</strong>
                <div className="inline-controls">
                  {medical.current && (
                    <Badge tone={SEVERITY_TONES[medical.current.severity]}>{SEVERITY_LABELS[medical.current.severity]}</Badge>
                  )}
                  <span>
                    Expected back {dateLabel(medical.injuredUntil)} ({daysText(medical.daysLeft)})
                  </span>
                </div>
                {medical.current && !medical.current.backfilled && (
                  <small className="muted">
                    Since {dateLabel(medical.current.start)}
                    {medical.current.context ? ` · ${medical.current.context === "match" ? "in a match" : "in training"}` : ""}
                  </small>
                )}
              </div>
            </div>
          ) : (
            <p className="dossier-copy">Fit and available.</p>
          )}
          {medical && (
            <DetailList
              items={[
                ["Injuries recorded", String(medical.summary.injuries)],
                ["Days out (career)", String(medical.summary.daysMissed)],
                ["Injuries this season", String(medical.summary.seasonInjuries)],
                ["Days out this season", String(medical.summary.seasonDaysMissed)],
                ["Training", data.player.training],
              ]}
            />
          )}
        </section>
        <section className="profile-section">
          <h3>Wellbeing</h3>
          {Object.entries(data.profile.mentalHealth).map(([key, value]) => (
            <div className="attribute-row" key={key}>
              <span className="attribute-label">{label(key)}</span>
              <Meter
                value={value}
                tone={["anxiety", "burnout"].includes(key) ? (value > 60 ? "red" : "amber") : "green"}
              />
              <strong>{Math.round(value)}</strong>
            </div>
          ))}
          <div className="attribute-row">
            <span className="attribute-label">Fitness</span>
            <Meter value={data.player.fitness} />
            <strong>{Math.round(data.player.fitness)}</strong>
          </div>
          <div className="attribute-row">
            <span className="attribute-label">Morale</span>
            <Meter value={data.player.morale} />
            <strong>{Math.round(data.player.morale)}</strong>
          </div>
          {own && (
            <Button
              variant="secondary"
              icon={HeartHandshake}
              onClick={() => void act({ type: "wellbeing", playerId: data.player.id })}
            >
              Arrange wellbeing support
            </Button>
          )}
        </section>
      </div>
      <section className="profile-section">
        <h3>Injury history</h3>
        {medical?.injuries.length ? (
          <div className="table-scroll" data-no-swipe role="region" aria-label="Injury history" tabIndex={0}>
            <table className="data-table player-history-table">
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Injury</th>
                  <th>Out</th>
                  <th>Club</th>
                </tr>
              </thead>
              <tbody>
                {medical.injuries.map((injury) => (
                  <tr key={injury.id}>
                    <td>
                      {injury.backfilled ? <span title="Recorded when injury tracking began">≤ </span> : null}
                      {dateLabel(injury.start)}
                    </td>
                    <td>
                      {injury.kind}
                      <small className="appearance-status">
                        <Badge tone={SEVERITY_TONES[injury.severity]}>{SEVERITY_LABELS[injury.severity]}</Badge>
                        {injury.context ? ` ${injury.context === "match" ? "Match" : "Training"}` : ""}
                      </small>
                    </td>
                    <td className="player-history-number">
                      {daysText(injury.days)}
                      {injury.end && (
                        <small className="appearance-status">
                          {injury.ongoing ? "Back " : "Returned "}
                          {dateLabel(injury.end)}
                        </small>
                      )}
                    </td>
                    <td>
                      {injury.club ? (
                        <ClubLink id={injury.club.id} name={injury.club.name} color={injury.club.color ?? undefined} />
                      ) : (
                        <span className="muted">No club</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          medical && <p className="muted player-history-empty">No injuries recorded.</p>
        )}
      </section>
    </div>
  );
}
