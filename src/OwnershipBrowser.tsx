import { Building2 } from "lucide-react";
import { useCurrency, useResource } from "./game-context.tsx";
import { Badge, Empty, ErrorState, Loading, Panel, SectionHeading } from "./ui.tsx";
import { OwnershipClubRow, OwnershipEvents } from "./ClubOwnership.tsx";
import { OWNER_TONE } from "./ownership.ts";
import type { OwnershipOverview } from "../shared/api.ts";

/** World view: who owns the clubs, the multi-club groups and the latest takeovers and elections. */
export default function OwnershipBrowser() {
  const { money } = useCurrency();
  const { data, error } = useResource<OwnershipOverview>("ownership");
  return (
    <Panel className="section-space">
      <SectionHeading title="Owners & multi-club groups" subtitle="Who controls the world's clubs" />
      {error ? (
        <ErrorState message={error} />
      ) : !data ? (
        <Loading label="Opening the ownership register" />
      ) : !data.ready ? (
        <Empty icon={Building2} title="Ownership records are being compiled" detail="They will be available after the next simulated day." />
      ) : (
        <>
          <div className="inline-controls">
            {data.types.map((entry) => (
              <Badge key={entry.type} tone={OWNER_TONE[entry.type]}>
                {entry.label}: {entry.clubs}
              </Badge>
            ))}
          </div>
          <h3 className="subsection-title section-space">Groups</h3>
          {data.groups.map((group) => (
            <details key={group.owner.id} className="ownership-group">
              <summary>
                <strong>{group.owner.name}</strong> <Badge tone={OWNER_TONE[group.owner.type]}>{group.owner.typeLabel}</Badge>{" "}
                <span className="muted">
                  {group.clubs.length} clubs{group.owner.countryName ? ` / ${group.owner.countryName}` : ""} / wealth {money(group.owner.wealth)}
                </span>
              </summary>
              {group.clubs.map((club) => (
                <OwnershipClubRow key={club.id} club={club} />
              ))}
            </details>
          ))}
          {!data.groups.length && <Empty icon={Building2} title="No multi-club groups" />}
          <h3 className="subsection-title section-space">Latest takeovers and elections</h3>
          {data.events.length ? (
            <OwnershipEvents events={data.events} showClub />
          ) : (
            <Empty icon={Building2} title="No ownership changes yet" detail="Takeovers, investments, elections and UEFA rulings will appear here." />
          )}
        </>
      )}
    </Panel>
  );
}
