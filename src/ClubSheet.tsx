import { useState } from "react";
import { CalendarDays, Landmark, Trophy, Users } from "lucide-react";
import { useCurrency, useGame, useResource } from "./game-context.tsx";
import {
  Badge,
  ClubLink,
  Crest,
  DetailList,
  Empty,
  ErrorState,
  FixtureRow,
  Loading,
  Modal,
  PlayerTable,
  Rating,
  SectionHeading,
  Tabs,
  TextLink,
} from "./ui.tsx";
import { compactNumber, dateLabel } from "../shared/rules.ts";
import type { ClubDetail } from "../shared/api.ts";
import ClubTransfers from "./ClubTransfers.tsx";
import { NationalTeamPanel } from "./NationalTeam.tsx";
import { SheetOriginContext } from "./sheet-trail.ts";
import { seasonText } from "./format.ts";

export default function ClubSheet() {
  const { clubProfileId, setClub, openLeague, bootstrap } = useGame();
  const { money } = useCurrency();
  const { data, error } = useResource<ClubDetail>(
    clubProfileId ? `clubs/${clubProfileId}` : null,
  );
  const [tab, setTab] = useState("overview");
  const [age, setAge] = useState("all");
  if (!clubProfileId) return null;
  return (
    <Modal title="Team profile" wide onClose={() => setClub(null)}>
      <SheetOriginContext value={data ? { clubId: data.club.id, clubName: data.club.name } : null}>
      {error ? (
        <div className="sheet-body">
          <ErrorState message={error} />
        </div>
      ) : !data ? (
        <Loading label="Opening team dossier" />
      ) : (
        <>
          <header className="club-profile-header">
            <Crest name={data.club.name} color={data.club.color} size={82} />
            <div>
              <div className="inline-controls">
                <Badge tone="blue">{data.country.confederation}</Badge>
                <Badge tone="green">
                  {data.club.type === "national"
                    ? data.club.age_group === "Senior"
                      ? "National team"
                      : `${data.club.age_group} national team`
                    : data.club.type === "bteam"
                      ? "Reserve team"
                      : (data.club.league_name ?? "Club")}
                </Badge>
                {data.club.id === bootstrap?.club.id && (
                  <Badge tone="amber">Your club</Badge>
                )}
              </div>
              <h2>{data.club.name}</h2>
              <p>
                {data.club.city} / {data.country.name}
              </p>
            </div>
            <div className="club-profile-reputation">
              <Rating value={data.club.reputation} />
              <small>Reputation</small>
            </div>
          </header>
          <div className="profile-stats">
            <div>
              <small>
                {data.club.type === "national" ? "National pool" : "Players"}
              </small>
              <strong>{data.summary.squadSize}</strong>
            </div>
            <div>
              <small>Average age</small>
              <strong>{data.summary.averageAge.toFixed(1)}</strong>
            </div>
            <div>
              <small>Academy</small>
              <strong>
                {data.club.type === "national" ? "-" : data.club.academy}
              </strong>
            </div>
            <div>
              <small>Squad value</small>
              <strong>{money(data.summary.squadValue)}</strong>
            </div>
          </div>
          <Tabs
            items={[
              { id: "overview", label: "Overview" },
              ...(data.club.type === "national"
                ? [{ id: "selection", label: "Selection" }]
                : []),
              { id: "squad", label: "Squads", count: data.players.length },
              { id: "fixtures", label: "Fixtures & results" },
              ...(data.club.type !== "national"
                ? [{ id: "transfers", label: "Transfers" }]
                : []),
              { id: "staff", label: "Staff" },
              ...(data.club.type !== "national"
                ? [
                    {
                      id: "affiliates",
                      label: "Affiliates",
                      count: data.affiliates.length,
                    },
                  ]
                : []),
              { id: "history", label: "Club history" },
            ]}
            value={tab}
            onChange={setTab}
          />
          {tab === "overview" && (
            <div className="profile-body">
              <div className="profile-columns">
                <section>
                  <h3 className="subsection-title">Club identity</h3>
                  <DetailList
                    items={[
                      ["Manager", data.club.manager],
                      ["Stadium", data.club.stadium],
                      ["Capacity", compactNumber(data.club.capacity)],
                      ["Formation", data.club.formation],
                      ["Style", data.club.tactical_style],
                      ["Philosophy", data.club.philosophy],
                      ["Culture", data.club.culture],
                      ["Facilities", `${data.club.facilities}/99`],
                      [
                        "Squad chemistry",
                        `${Math.round(data.club.chemistry)}%`,
                      ],
                    ]}
                  />
                  {data.valuation && (
                    <section className="section-space">
                      <h3 className="subsection-title">Club finances</h3>
                      <DetailList
                        items={[
                          ["Enterprise estimate", money(data.valuation.enterpriseValue)],
                          ["Operating revenue / year (estimate)", money(data.valuation.annualOperatingRevenue)],
                          ["Cash balance", money(data.club.balance)],
                          ["Squad market value", money(data.summary.squadValue)],
                        ]}
                      />
                    </section>
                  )}
                  {data.parent && (
                    <div className="section-space">
                      <small className="muted">Parent club</small>
                      <p>
                        <ClubLink
                          id={data.parent.id}
                          name={data.parent.name}
                          color={data.parent.color}
                          crest
                        />
                      </p>
                    </div>
                  )}
                  {data.reserves.map((team) => (
                    <div className="section-space" key={team.id}>
                      <small className="muted">Reserve team</small>
                      <p>
                        <ClubLink
                          id={team.id}
                          name={team.name}
                          color={team.color}
                          crest
                        />
                      </p>
                    </div>
                  ))}
                </section>
                <section>
                  <h3 className="subsection-title">Competitions</h3>
                  {data.competitions.map((competition) => (
                    <div className="club-competition-link" key={competition.id}>
                      <Trophy size={17} />
                      <span>
                        <TextLink onClick={() => openLeague(competition.id)}>
                          {competition.name}
                        </TextLink>
                        <small>
                          {competition.age_group} / {competition.format}
                        </small>
                      </span>
                    </div>
                  ))}
                  {!data.competitions.length && (
                    <Empty
                      icon={Trophy}
                      title="No competition entry this season"
                    />
                  )}
                  <h3 className="subsection-title section-space">
                    Club outlook
                  </h3>
                  <DetailList
                    items={[
                      ["Fan mood", `${Math.round(data.club.fan_mood)}%`],
                      [
                        "Board confidence",
                        `${Math.round(data.club.board_confidence)}%`,
                      ],
                      [
                        "Manager trust",
                        `${Math.round(data.club.manager_trust)}%`,
                      ],
                    ]}
                  />
                </section>
              </div>
            </div>
          )}
          {tab === "selection" && data.club.type === "national" && (
            <div className="profile-body">
              <NationalTeamPanel teamId={data.club.id} />
            </div>
          )}
          {tab === "affiliates" && (
            <div className="profile-body">
              <SectionHeading title="Affiliate network" />
              {!data.affiliates.length && (
                <Empty icon={Users} title="No affiliate clubs" detail="This club has no partnership or feeder agreements." />
              )}
              {data.affiliates.map((affiliate) => (
                <div className="club-affiliate-row" key={affiliate.id}>
                  <ClubLink
                    id={affiliate.partner_id}
                    name={affiliate.name}
                    color={affiliate.color}
                    crest
                  />
                  <small>
                    {affiliate.country_name} / {affiliate.league_name ?? "Club"}
                  </small>
                  <Badge tone="blue">{affiliate.type}</Badge>
                  <span>Relationship {Math.round(affiliate.strength)}/100</span>
                </div>
              ))}
            </div>
          )}
          {tab === "squad" && (
            <>
              <div className="filter-bar">
                <select
                  aria-label="Team squad age group"
                  value={age}
                  onChange={(event) => setAge(event.target.value)}
                >
                  <option value="all">All squads</option>
                  <option>Senior</option>
                  <option>U19</option>
                  <option>U17</option>
                </select>
                <Badge>
                  {data.club.type === "national"
                    ? "Eligible national pool"
                    : "Contracted players"}
                </Badge>
              </div>
              <PlayerTable
                players={data.players.filter(
                  (player) => age === "all" || player.age_group === age,
                )}
              />
            </>
          )}
          {tab === "fixtures" && (
            <div className="profile-body">
              <div className="equal-columns">
                <section>
                  <h3 className="subsection-title">Upcoming</h3>
                  {data.fixtures.map((fixture) => (
                    <FixtureRow key={fixture.id} fixture={fixture} />
                  ))}
                  {!data.fixtures.length && (
                    <Empty icon={CalendarDays} title="No upcoming fixtures" />
                  )}
                </section>
                <section>
                  <h3 className="subsection-title">Recent results</h3>
                  {data.results.map((fixture) => (
                    <FixtureRow key={fixture.id} fixture={fixture} />
                  ))}
                  {!data.results.length && (
                    <Empty icon={Trophy} title="No simulated results yet" />
                  )}
                </section>
              </div>
            </div>
          )}
          {tab === "transfers" && data.club.type !== "national" && (
            <div className="profile-body">
              <ClubTransfers key={data.club.id} clubId={data.club.id} />
            </div>
          )}
          {tab === "staff" && (
            <>
              <SectionHeading
                title="Coaching & support"
                subtitle={data.club.manager}
              />
              {data.staff.length ? (
                <div className="table-scroll" data-no-swipe role="region" aria-label="Staff" tabIndex={0}>
                  <table className="data-table">
                    <thead>
                      <tr>
                        <th>Name</th>
                        <th>Role</th>
                        <th>Ability</th>
                        <th>Personality</th>
                        <th>Communication</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.staff.map((member) => (
                        <tr key={member.id}>
                          <td>{member.name}</td>
                          <td>{member.role}</td>
                          <td>
                            <Rating value={member.ability} />
                          </td>
                          <td>{member.personality}</td>
                          <td>{member.communication}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <Empty
                  icon={Users}
                  title={
                    data.club.type === "national"
                      ? "Managed by the national association"
                      : "No staff recorded"
                  }
                />
              )}
            </>
          )}
          {tab === "history" && (
            <div className="profile-body">
              {data.history.length ? (
                data.history.map((entry, index) => {
                  const event = JSON.parse(entry.data);
                  return (
                    <div
                      className="data-list-row"
                      key={`${entry.date}-${index}`}
                    >
                      <span>
                        <strong>
                          {entry.entity_type === "champion"
                            ? event.competition
                            : "Manager appointment"}
                        </strong>
                        <p>
                          {entry.entity_type === "champion"
                            ? `Champions / ${seasonText(entry.season)}`
                            : `${event.appointed} succeeded ${event.departed}`}
                        </p>
                      </span>
                      <time>{dateLabel(entry.date)}</time>
                    </div>
                  );
                })
              ) : (
                <Empty
                  icon={Landmark}
                  title="The club's story begins here"
                  detail="Simulated honours and managerial changes will be recorded by season."
                />
              )}
            </div>
          )}
        </>
      )}
      </SheetOriginContext>
    </Modal>
  );
}
