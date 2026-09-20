import { useState } from "react";
import {
  ArrowUpRight,
  Bookmark,
  CalendarClock,
  ClipboardCheck,
  Compass,
  Network,
  Plus,
  ScanLine,
  Search,
  Shield,
  Target,
  Users,
} from "lucide-react";
import { useGame, useResource } from "../game-context.tsx";
import {
  Badge,
  Button,
  Empty,
  ErrorState,
  Field,
  IconButton,
  Loading,
  Meter,
  Modal,
  PageHeading,
  Panel,
  PlayerName,
  PlayerTable,
  Rating,
  SectionHeading,
  Stat,
  Tabs,
  TextLink,
} from "../ui.tsx";
import { dateLabel, label, money, POSITIONS } from "../../shared/rules.ts";
import type { ScoutingData, SquadData } from "../../shared/api.ts";
import type { Staff } from "../../shared/types.ts";

const roles = [
  "Captain",
  "Key player",
  "Regular starter",
  "Squad player",
  "Fringe player",
  "Prospect",
];

export function Squad() {
  const { bootstrap, act, setPlayer, navigate } = useGame();
  const { data, error } = useResource<SquadData>("squad");
  const [tab, setTab] = useState("players");
  const [filter, setFilter] = useState("");
  if (error) return <ErrorState message={error} />;
  if (!data || !bootstrap) return <Loading />;
  const groups = [...new Set(data.matrix.map((player) => player.group))];
  const filtered = data.players.filter(
    (player) => !filter || player.position === filter,
  );
  const matrix = data.matrix.slice(0, 18);
  return (
    <div className="page">
      <PageHeading
        eyebrow="FIRST TEAM"
        title="The squad"
        subtitle={`${bootstrap.club.name} / ${bootstrap.club.manager} / ${bootstrap.club.formation}`}
      >
        <Button
          variant="secondary"
          icon={Search}
          onClick={() => navigate("database")}
        >
          Find a player
        </Button>
      </PageHeading>
      <div className="stat-strip">
        <Stat
          label="Senior players"
          value={data.players.length}
          icon={Users}
          detail="Registered first-team group"
        />
        <Stat
          label="Average age"
          value={(
            data.players.reduce((sum, player) => sum + player.age, 0) /
            Math.max(1, data.players.length)
          ).toFixed(1)}
          icon={CalendarClock}
          detail="Years"
        />
        <Stat
          label="Squad value"
          value={money(
            data.players.reduce((sum, player) => sum + player.value, 0),
          )}
          icon={Target}
          detail="Updated every week"
        />
        <Stat
          label="Chemistry"
          value={
            <>
              {Math.round(bootstrap.club.chemistry)}
              <small>/100</small>
            </>
          }
          icon={Network}
          detail={<Meter value={bootstrap.club.chemistry} />}
        />
      </div>
      <Panel>
        <Tabs
          items={[
            { id: "players", label: "Players", count: data.players.length },
            { id: "chemistry", label: "Dressing room" },
            { id: "succession", label: "Succession plan" },
            {
              id: "promises",
              label: "Promises",
              count: data.promises.filter(
                (promise) => promise.status === "active",
              ).length,
            },
          ]}
          value={tab}
          onChange={setTab}
        />
        {tab === "players" && (
          <>
            <div className="filter-bar">
              <div className="inline-controls">
                <span className="muted" style={{ fontSize: ".77rem" }}>
                  Position
                </span>
                <select
                  aria-label="Squad position"
                  value={filter}
                  onChange={(event) => setFilter(event.target.value)}
                >
                  <option value="">All positions</option>
                  {POSITIONS.map((position) => (
                    <option key={position}>{position}</option>
                  ))}
                </select>
              </div>
              <span
                className="muted"
                style={{ marginLeft: "auto", fontSize: ".72rem" }}
              >
                {bootstrap.club.tactical_style}
              </span>
            </div>
            <div className="table-scroll">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Player</th>
                    <th>Pos</th>
                    <th>Ability</th>
                    <th>Potential</th>
                    <th>Squad role</th>
                    <th>Fitness</th>
                    <th>Morale</th>
                    <th>Apps</th>
                    <th>G / A</th>
                    <th>Wage / wk</th>
                    <th>Availability</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((player) => (
                    <tr key={player.id}>
                      <td>
                        <PlayerName player={player} compact />
                      </td>
                      <td>
                        <span className="position-tag">{player.position}</span>
                      </td>
                      <td>
                        <Rating value={player.ability} />
                      </td>
                      <td>
                        <Rating value={player.potential} potential />
                      </td>
                      <td>
                        <select
                          aria-label={`Role for ${player.name}`}
                          className="table-select"
                          value={
                            roles.includes(player.role)
                              ? player.role
                              : "Squad player"
                          }
                          onChange={(event) =>
                            void act({
                              type: "role",
                              playerId: player.id,
                              role: event.target.value,
                            })
                          }
                        >
                          {roles.map((role) => (
                            <option key={role}>{role}</option>
                          ))}
                        </select>
                      </td>
                      <td>
                        <div className="cell-meter">
                          <Meter
                            value={player.fitness}
                            tone={player.fitness < 60 ? "red" : "green"}
                          />
                          <small>{Math.round(player.fitness)}%</small>
                        </div>
                      </td>
                      <td>
                        <div className="cell-meter">
                          <Meter
                            value={player.morale}
                            tone={player.morale < 45 ? "amber" : "green"}
                          />
                          <small>{Math.round(player.morale)}</small>
                        </div>
                      </td>
                      <td>{player.appearances}</td>
                      <td>
                        {player.goals} / {player.assists}
                      </td>
                      <td className="money">{money(player.wage)}</td>
                      <td>
                        <select
                          aria-label={`Availability for ${player.name}`}
                          className="table-select"
                          value={
                            player.listed
                              ? "transfer"
                              : player.available_loan
                                ? "loan"
                                : "keep"
                          }
                          onChange={(event) =>
                            void act({
                              type: "availability",
                              playerId: player.id,
                              listed: event.target.value === "transfer",
                              loan: event.target.value === "loan",
                            })
                          }
                        >
                          <option value="keep">Keep at club</option>
                          <option value="transfer">Transfer listed</option>
                          <option value="loan">Available for loan</option>
                        </select>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
        {tab === "chemistry" && (
          <>
            <SectionHeading
              title="Dressing-room groups"
              subtitle="Shared language, personality and mentorship"
            />
            <div className="group-list">
              {groups.map((group) => (
                <div key={group}>
                  <Badge
                    tone={
                      group === "Local core"
                        ? "green"
                        : group === "Young internationals"
                          ? "blue"
                          : "violet"
                    }
                  >
                    {group}
                  </Badge>
                  <small>
                    {
                      data.matrix.filter((player) => player.group === group)
                        .length
                    }{" "}
                    players
                  </small>
                </div>
              ))}
            </div>
            <div className="table-scroll">
              <div
                className="matrix-grid"
                style={{
                  gridTemplateColumns: `145px repeat(${matrix.length},27px)`,
                  minWidth: 160 + matrix.length * 30,
                }}
              >
                <span />
                {matrix.map((player, index) => (
                  <button
                    className="matrix-cell"
                    key={player.id}
                    title={player.name}
                    onClick={() => setPlayer(player.id)}
                  >
                    {index + 1}
                  </button>
                ))}
                {matrix.map((source, index) => (
                  <div className="matrix-row" key={source.id}>
                    <button
                      className="matrix-label text-link"
                      onClick={() => setPlayer(source.id)}
                    >
                      {index + 1}. {source.name}
                    </button>
                    {matrix.map((target) => {
                      const connection = source.connections.find(
                        (item) => item.id === target.id,
                      );
                      const strength = connection?.strength ?? 100;
                      return (
                        <span
                          key={target.id}
                          className="matrix-cell"
                          title={`${source.name} / ${target.name}: ${connection?.kind ?? "Self"} (${strength})`}
                          style={{
                            background:
                              source.id === target.id
                                ? "var(--line)"
                                : `color-mix(in srgb,${strength >= 60 ? "var(--green)" : strength < 35 ? "var(--red)" : "var(--amber)"} ${Math.max(12, strength / 2)}%,var(--surface))`,
                          }}
                        >
                          {source.id === target.id ? "-" : strength}
                        </span>
                      );
                    })}
                  </div>
                ))}
              </div>
            </div>
            <div className="pressure-zones">
              <span>
                <i className="zone-line" />
                Strong relationship
              </span>
              <span>
                <i className="zone-line middle" />
                Professional
              </span>
              <span>
                <i className="zone-line bottom" />
                Friction
              </span>
            </div>
          </>
        )}
        {tab === "succession" && (
          <>
            <SectionHeading
              title="Build beyond this season"
              subtitle="Current starters, emerging cover and recruitment gaps"
            />
            <div className="table-scroll">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Position</th>
                    <th>Current option</th>
                    <th>Age</th>
                    <th>Next generation</th>
                    <th>Potential</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {data.succession.map((item) => (
                    <tr key={item.position}>
                      <td>
                        <span className="position-tag">{item.position}</span>
                      </td>
                      <td>{item.current ?? "No player"}</td>
                      <td>{item.age ?? "-"}</td>
                      <td>
                        {item.prospect ? (
                          <PlayerName player={item.prospect} compact />
                        ) : (
                          <span className="muted">Recruitment needed</span>
                        )}
                      </td>
                      <td>
                        {item.prospect ? (
                          <Rating value={item.prospect.potential} potential />
                        ) : (
                          "-"
                        )}
                      </td>
                      <td>
                        <Badge
                          tone={
                            item.risk === "Covered"
                              ? "green"
                              : item.risk === "Vacant"
                                ? "red"
                                : "amber"
                          }
                        >
                          {item.risk}
                        </Badge>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
        {tab === "promises" &&
          (data.promises.length ? (
            data.promises.map((promise) => (
              <div className="promise-item" key={promise.id}>
                <div>
                  <strong>{promise.player_name}</strong>
                  <p>
                    {promise.type} / Review {dateLabel(promise.due_date)}
                  </p>
                </div>
                <Badge
                  tone={
                    promise.status === "fulfilled"
                      ? "green"
                      : promise.status === "broken"
                        ? "red"
                        : "amber"
                  }
                >
                  {label(promise.status)}
                </Badge>
              </div>
            ))
          ) : (
            <Empty
              icon={Shield}
              title="No outstanding promises"
              detail="Agreements made during contract negotiations will appear here."
            />
          ))}
      </Panel>
    </div>
  );
}

function AssignmentSheet({
  scouts,
  close,
}: {
  scouts: Staff[];
  close: () => void;
}) {
  const { bootstrap, act } = useGame();
  const [staffId, setStaffId] = useState(String(scouts[0]?.id ?? ""));
  const [countryId, setCountryId] = useState("");
  const [position, setPosition] = useState("");
  const [maxAge, setMaxAge] = useState(23);
  const [budget, setBudget] = useState(20_000_000);
  const [pending, setPending] = useState(false);
  async function submit() {
    setPending(true);
    const result = await act({
      type: "scout",
      staffId: Number(staffId),
      ...(countryId ? { countryId: Number(countryId) } : {}),
      ...(position ? { position } : {}),
      maxAge,
      budget,
    });
    setPending(false);
    if (result) close();
  }
  return (
    <Modal title="New scouting assignment" onClose={close}>
      <div className="sheet-body">
        <div className="form-grid">
          <Field label="Scout">
            <select
              value={staffId}
              onChange={(event) => setStaffId(event.target.value)}
            >
              {scouts.map((scout) => (
                <option key={scout.id} value={scout.id}>
                  {scout.name} / {scout.ability}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Region">
            <select
              value={countryId}
              onChange={(event) => setCountryId(event.target.value)}
            >
              <option value="">Worldwide</option>
              {bootstrap?.countries.map((country) => (
                <option key={country.id} value={country.id}>
                  {country.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Position">
            <select
              value={position}
              onChange={(event) => setPosition(event.target.value)}
            >
              <option value="">Any position</option>
              {POSITIONS.map((value) => (
                <option key={value}>{value}</option>
              ))}
            </select>
          </Field>
          <Field label="Maximum age">
            <input
              type="number"
              min="14"
              max="45"
              value={maxAge}
              onChange={(event) => setMaxAge(Number(event.target.value))}
            />
          </Field>
          <Field label="Maximum player value (GBP)">
            <input
              type="number"
              min="0"
              step="1000000"
              value={budget}
              onChange={(event) => setBudget(Number(event.target.value))}
            />
          </Field>
          <div className="assignment-cost">
            <span>Assignment fee</span>
            <strong>{money(2500, true)}</strong>
            <small>7-day assignment</small>
          </div>
        </div>
      </div>
      <footer className="sheet-footer">
        <Button variant="secondary" onClick={close}>
          Cancel
        </Button>
        <Button
          icon={Compass}
          disabled={pending || !staffId}
          onClick={() => void submit()}
        >
          Send scout
        </Button>
      </footer>
    </Modal>
  );
}

export function Scouting() {
  const { bootstrap, setPlayer, navigate } = useGame();
  const { data, error } = useResource<ScoutingData>("scouting");
  const [tab, setTab] = useState("reports");
  const [assign, setAssign] = useState(false);
  if (error) return <ErrorState message={error} />;
  if (!data || !bootstrap) return <Loading />;
  const active = data.assignments.filter(
    (assignment) => assignment.status === "active",
  );
  return (
    <div className="page">
      <PageHeading
        eyebrow="RECRUITMENT INTELLIGENCE"
        title="Scouting centre"
        subtitle="Find the right player. Understand the person."
      >
        <Button
          icon={Plus}
          onClick={() => setAssign(true)}
          disabled={!data.scouts.length}
        >
          New assignment
        </Button>
      </PageHeading>
      <div className="stat-strip">
        <Stat
          label="Scouting team"
          value={data.scouts.length}
          icon={ScanLine}
          detail="Scouts employed"
        />
        <Stat
          label="Active assignments"
          value={active.length}
          icon={Compass}
          detail="Across your scouting network"
        />
        <Stat
          label="Player reports"
          value={data.reports.length}
          icon={ClipboardCheck}
          detail="Completed assessments"
        />
        <Stat
          label="Shortlisted players"
          value={data.shortlist.length}
          icon={Bookmark}
          detail="Your recruitment priorities"
        />
      </div>
      <Panel>
        <Tabs
          items={[
            {
              id: "reports",
              label: "Scout reports",
              count: data.reports.length,
            },
            {
              id: "shortlist",
              label: "Shortlist",
              count: data.shortlist.length,
            },
            { id: "assignments", label: "Assignments", count: active.length },
            { id: "team", label: "Scouting team" },
          ]}
          value={tab}
          onChange={setTab}
        />
        {tab === "reports" &&
          (data.reports.length ? (
            <div className="table-scroll">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Player</th>
                    <th>Position</th>
                    <th>Age</th>
                    <th>Ability range</th>
                    <th>Potential range</th>
                    <th>Tactical fit</th>
                    <th>Risk</th>
                    <th>Confidence</th>
                    <th>Report</th>
                  </tr>
                </thead>
                <tbody>
                  {data.reports.map((report) => (
                    <tr key={report.id}>
                      <td>
                        <button
                          className="report-player"
                          onClick={() => setPlayer(report.player_id)}
                        >
                          <strong>{report.player_name}</strong>
                          <small>{report.club_name}</small>
                        </button>
                      </td>
                      <td>
                        <span className="position-tag">{report.position}</span>
                      </td>
                      <td>{report.age}</td>
                      <td>
                        <Badge tone="green">
                          {report.ability_low}-{report.ability_high}
                        </Badge>
                      </td>
                      <td>
                        <Badge tone="violet">
                          {report.potential_low}-{report.potential_high}
                        </Badge>
                      </td>
                      <td>
                        <div className="cell-meter">
                          <Meter value={report.fit} />
                          <small>{report.fit}%</small>
                        </div>
                      </td>
                      <td>
                        <Badge
                          tone={
                            report.risk > 65
                              ? "red"
                              : report.risk > 40
                                ? "amber"
                                : "green"
                          }
                        >
                          {report.risk > 65
                            ? "High"
                            : report.risk > 40
                              ? "Moderate"
                              : "Low"}
                        </Badge>
                      </td>
                      <td>{report.accuracy}%</td>
                      <td>
                        <IconButton
                          icon={ArrowUpRight}
                          label={`View report for ${report.player_name}`}
                          onClick={() => setPlayer(report.player_id)}
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <Empty
              icon={ScanLine}
              title="A blank scouting notebook"
              detail="Set the brief and send your first assignment."
            />
          ))}
        {tab === "shortlist" && (
          <>
            <SectionHeading title="Priority targets">
              <TextLink onClick={() => navigate("database")}>
                Search the database
              </TextLink>
            </SectionHeading>
            <PlayerTable players={data.shortlist} />
          </>
        )}
        {tab === "assignments" &&
          (data.assignments.length ? (
            <div className="table-scroll">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Scout</th>
                    <th>Brief</th>
                    <th>Position</th>
                    <th>Age limit</th>
                    <th>Budget</th>
                    <th>Due</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {data.assignments.map((assignment) => (
                    <tr key={assignment.id}>
                      <td>
                        <strong>{assignment.scout_name}</strong>
                      </td>
                      <td>
                        {assignment.player_name ??
                          assignment.country_name ??
                          "Worldwide search"}
                      </td>
                      <td>{assignment.position ?? "All"}</td>
                      <td>{assignment.max_age}</td>
                      <td>{money(assignment.budget)}</td>
                      <td>{dateLabel(assignment.due_date)}</td>
                      <td>
                        <Badge
                          tone={
                            assignment.status === "complete"
                              ? "green"
                              : assignment.status === "active"
                                ? "blue"
                                : "neutral"
                          }
                        >
                          {label(assignment.status)}
                        </Badge>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <Empty
              icon={Compass}
              title="Scouts ready for a brief"
              detail="Set a region, position, age profile and budget."
            >
              <Button icon={Plus} onClick={() => setAssign(true)}>
                Create assignment
              </Button>
            </Empty>
          ))}
        {tab === "team" && (
          <div className="padded">
            <div className="cards-list">
              {data.scouts.map((scout) => {
                const details = JSON.parse(scout.data);
                return (
                  <article className="entity-card" key={scout.id}>
                    <div className="entity-card-top">
                      <Badge tone="green">{scout.personality}</Badge>
                      <Rating value={scout.ability} />
                    </div>
                    <h3>{scout.name}</h3>
                    <p>{scout.role}</p>
                    <dl className="detail-list">
                      <div>
                        <dt>Accuracy</dt>
                        <dd>{details.accuracy}%</dd>
                      </div>
                      <div>
                        <dt>Report detail</dt>
                        <dd>{details.detail}/100</dd>
                      </div>
                      <div>
                        <dt>Risk tolerance</dt>
                        <dd>{details.riskTolerance}/100</dd>
                      </div>
                      <div>
                        <dt>Preference / bias</dt>
                        <dd>{details.bias}</dd>
                      </div>
                      <div>
                        <dt>Communication</dt>
                        <dd>{scout.communication}</dd>
                      </div>
                    </dl>
                    <Badge
                      tone={
                        active.some(
                          (assignment) => assignment.staff_id === scout.id,
                        )
                          ? "blue"
                          : "green"
                      }
                    >
                      {active.some(
                        (assignment) => assignment.staff_id === scout.id,
                      )
                        ? "On assignment"
                        : "Available"}
                    </Badge>
                  </article>
                );
              })}
            </div>
            {!data.scouts.length && (
              <Empty icon={Users} title="No scouts employed">
                <Button onClick={() => navigate("staff")}>
                  Recruit a scout
                </Button>
              </Empty>
            )}
          </div>
        )}
      </Panel>
      {assign && (
        <AssignmentSheet scouts={data.scouts} close={() => setAssign(false)} />
      )}
    </div>
  );
}
