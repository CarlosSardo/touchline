import { Building2, Landmark, Vote } from "lucide-react";
import { useCurrency, useResource } from "./game-context.tsx";
import { Badge, ClubLink, DetailList, Empty, ErrorState, Loading, SectionHeading } from "./ui.tsx";
import { dateLabel } from "../shared/rules.ts";
import { OWNER_TONE } from "./ownership.ts";
import type { ClubOwnershipView, OwnershipClubLink, OwnershipEventView } from "../shared/api.ts";

const percent = (stake: number) => `${Math.round(stake * 100)}%`;

export function OwnershipClubRow({ club }: { club: OwnershipClubLink }) {
  return (
    <div className="club-affiliate-row">
      <ClubLink id={club.id} name={club.name} color={club.color} crest />
      <small>
        {club.countryName} / {club.leagueName ?? "Club"}
      </small>
      <span>{percent(club.stake)}</span>
      {club.blindTrust && <Badge tone="amber">Blind trust</Badge>}
    </div>
  );
}

export function OwnershipEvents({ events, showClub = false }: { events: OwnershipEventView[]; showClub?: boolean }) {
  return events.map((event) => (
    <div className="data-list-row" key={event.id}>
      <span>
        <strong>
          {event.title}
          {showClub && (
            <>
              {" / "}
              <ClubLink id={event.clubId} name={event.clubName} />
            </>
          )}
        </strong>
        <p>{event.detail}</p>
      </span>
      <time>{dateLabel(event.date)}</time>
    </div>
  ));
}

/** Ownership tab of a club profile: owner, group and sister clubs, president and elections, ownership history. */
export default function ClubOwnership({ clubId }: { clubId: number }) {
  const { money } = useCurrency();
  const { data, error } = useResource<ClubOwnershipView>(`clubs/${clubId}/ownership`);
  if (error) return <ErrorState message={error} />;
  if (!data) return <Loading label="Opening the ownership register" />;
  if (!data.ready || !data.owner)
    return <Empty icon={Landmark} title="Ownership records are being compiled" detail="They will be available after the next simulated day." />;
  const owner = data.owner;
  return (
    <div className="profile-columns">
      <section>
        <h3 className="subsection-title">
          Owner <Badge tone={OWNER_TONE[owner.type]}>{owner.typeLabel}</Badge>
        </h3>
        <DetailList
          items={[
            ["Owner", owner.name],
            ...(data.memberOwned
              ? ([["Control", `Members ${percent(data.stake)}${data.rule ? ` (${data.rule} rule)` : ""}`]] as [string, string][])
              : ([["Stake", percent(data.stake)]] as [string, string][])),
            ...(owner.countryName ? ([["Based in", owner.countryName]] as [string, string][]) : []),
            ...(data.since ? ([["Since", dateLabel(data.since)]] as [string, string][]) : []),
            ...(owner.wealth ? ([["Owner wealth", money(owner.wealth)]] as [string, string][]) : []),
            ["Ambition", `${owner.ambition}/100`],
            ["Patience", `${owner.patience}/100`],
            ...(data.debt ? ([["Acquisition debt on the club", money(data.debt)]] as [string, string][]) : []),
            ...(data.blindTrust ? ([["UEFA", "Stake held in a blind trust"]] as [string, string][]) : []),
          ]}
        />
        {data.exemption && <p className="muted section-space">{data.exemption}</p>}
        {data.investors.length > 0 && (
          <div className="section-space">
            <h3 className="subsection-title">Minority investors</h3>
            <DetailList items={data.investors.map((investor) => [investor.name, percent(investor.stake)] as [string, string])} />
          </div>
        )}
        {data.memberOwned && (
          <div className="section-space">
            <h3 className="subsection-title">Presidency</h3>
            <DetailList
              items={[
                ["President", data.president ?? "Vacant"],
                ...(data.presidentSince ? ([["In office since", dateLabel(data.presidentSince)]] as [string, string][]) : []),
                ...(data.termYears ? ([["Term", `${data.termYears} years`]] as [string, string][]) : []),
                ...(data.nextElection ? ([["Next election", dateLabel(data.nextElection)]] as [string, string][]) : []),
              ]}
            />
            {data.election && (
              <div className="section-space">
                <small className="muted">
                  <Vote size={13} /> Candidates for {dateLabel(data.election.date)}
                </small>
                {data.election.candidates.map((candidate) => (
                  <p key={candidate.name}>
                    <strong>{candidate.name}</strong>
                    {candidate.incumbent ? " (president)" : ""} / {candidate.promise}
                  </p>
                ))}
              </div>
            )}
          </div>
        )}
        {data.pending && (
          <div className="section-space">
            <Badge tone="amber">{data.pending.stage === "talks" ? "Takeover talks" : "Sale explored"}</Badge>
            <p className="muted">
              {data.pending.stage === "talks"
                ? `${data.pending.buyerName} (${data.pending.buyerType.replace("_", " ")}) expects to complete around ${dateLabel(data.pending.expected)}.`
                : `Interest from a ${data.pending.buyerType.replace("_", " ")} buyer is reported.`}
            </p>
          </div>
        )}
      </section>
      <section>
        {data.group && (
          <>
            <SectionHeading title={data.group.name} subtitle={`Multi-club group / ${data.group.clubs.length} clubs`} />
            {data.group.clubs.map((club) => (
              <OwnershipClubRow key={club.id} club={club} />
            ))}
          </>
        )}
        <h3 className={`subsection-title${data.group ? " section-space" : ""}`}>Ownership history</h3>
        {data.events.length ? (
          <OwnershipEvents events={data.events} />
        ) : (
          <Empty icon={Building2} title="No ownership changes recorded" detail="Takeovers, investments and elections will appear here." />
        )}
      </section>
    </div>
  );
}
