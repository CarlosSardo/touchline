import { parseArgs } from "node:util";
import {
  accountUuid,
  assertAccountRegistry,
  validateAccountSchema,
  validateAccountWorldSchema,
  type AccountRecord,
} from "../server/accounts.ts";
import { Store } from "../server/db.ts";
import { Saves } from "../server/saves.ts";
import { quoteIdentifier, tableName } from "../server/sql-schema.ts";
import type { GameState } from "../shared/types.ts";
import { isMain } from "./data-export.ts";

export interface CareerDeleteOptions {
  objectId?: string;
  email?: string;
  accountSchema: string;
  apply: boolean;
  list: boolean;
}

type SavesLike = Pick<Saves, "currentState" | "list" | "deleteActiveCareer">;

export interface CareerDeleteDependencies {
  open: () => Promise<Store>;
  saves: (world: Store) => SavesLike;
  log: (line: string) => void;
}

const USAGE = `Usage: tsx scripts/career-delete.ts (--oid OBJECT_ID | --email ADDRESS | --list) [--account-schema accounts] [--apply --yes]
Resolves exactly one account in the account registry by Entra object ID or by its exact stored email/UPN claim,
prints a dry-run summary of its active career by default, and deletes that career's world and snapshots only
with --apply --yes, through Saves.deleteActiveCareer under the account's world lock. The account and its (now empty)
world schema stay registered. The legacy dbo world is refused.
--list prints a masked registry listing and opens no world. Identifiers are always masked in the output.
Uses SQL_* connection settings; large worlds need SQL_REQUEST_TIMEOUT_MS=900000.`;

export function careerDeleteOptions(args: string[]): CareerDeleteOptions | undefined {
  const { values } = parseArgs({
    args,
    options: {
      help: { type: "boolean" },
      oid: { type: "string" },
      email: { type: "string" },
      "account-schema": { type: "string" },
      "dry-run": { type: "boolean" },
      apply: { type: "boolean" },
      yes: { type: "boolean" },
      list: { type: "boolean" },
    },
  });
  if (values.help) return undefined;
  if (values.list) {
    if (values.oid !== undefined || values.email !== undefined || values.apply || values.yes || values["dry-run"])
      throw new Error("--list takes no account identifier and never deletes.");
    return { accountSchema: validateAccountSchema(values["account-schema"] ?? "accounts"), apply: false, list: true };
  }
  if ((values.oid === undefined) === (values.email === undefined))
    throw new Error("Choose exactly one account identifier: --oid or --email.");
  if (values.apply && !values.yes)
    throw new Error("Deleting a career requires --apply --yes.");
  if (values.apply && values["dry-run"])
    throw new Error("Choose --apply or --dry-run, not both.");
  const email = values.email?.trim();
  if (email !== undefined && (!/^[^\s@]+@[^\s@]+$/.test(email) || email.length > 320))
    throw new Error("--email must be one complete stored email or UPN claim.");
  return {
    objectId: values.oid === undefined ? undefined : accountUuid(values.oid.trim(), "--oid"),
    email,
    accountSchema: validateAccountSchema(values["account-schema"] ?? "accounts"),
    apply: Boolean(values.apply),
    list: false,
  };
}

export function maskText(value: string, keep = 1): string {
  return value.length > keep * 2 ? `${value.slice(0, keep)}***${value.slice(-keep)}` : `${value.slice(0, 1)}***`;
}

export function maskEmail(email: string | null): string | null {
  if (!email) return null;
  const at = email.lastIndexOf("@");
  const visible = maskText(at > 0 ? email.slice(0, at) : email);
  return at > 0 ? `${visible}${email.slice(at)}` : visible;
}

export function maskIdentifier(value: string): string {
  return maskText(value.toLowerCase(), 4);
}

// Per-user world schemas embed the account UUID.
export function maskSchema(schema: string): string {
  const match = /^(touchline_user_)(.+)$/i.exec(schema);
  return match ? `${match[1]}${maskIdentifier(match[2])}` : schema;
}

export function registryCounts(records: AccountRecord[]) {
  return { accounts: records.length, withStoredEmail: records.filter((record) => record.email).length };
}

export function maskedRegistry(records: AccountRecord[]) {
  return {
    ...registryCounts(records),
    registered: records.map((record) => ({
      accountId: maskIdentifier(record.id),
      objectId: maskIdentifier(record.object_id),
      schema: maskSchema(record.game_schema),
      email: maskEmail(record.email),
    })),
  };
}

export function selectAccount(records: AccountRecord[], options: CareerDeleteOptions) {
  const matchedBy = options.objectId ? "oid" : "email";
  const matches = options.objectId
    ? records.filter((record) => record.object_id.toLowerCase() === options.objectId)
    : records.filter((record) => record.email?.trim().toLowerCase() === options.email!.toLowerCase());
  if (!matches.length)
    throw new Error(`No registered account has that ${matchedBy === "oid" ? "object ID" : "exact stored email claim"}.`);
  if (matches.length > 1)
    throw new Error(`That ${matchedBy} matches ${matches.length} accounts; choose one with --oid.`);
  const [account] = matches;
  if (account.game_schema.trim().toLowerCase() === "dbo")
    throw new Error("The legacy dbo world is refused by this tool; it is not deleted or modified.");
  validateAccountWorldSchema(account.game_schema, options.accountSchema);
  return { account, matchedBy };
}

export async function careerSummary(world: Store) {
  return world.readTransaction(async () => {
    const row = await world.get<{ value: string }>("SELECT value FROM meta WHERE key = 'state'");
    const state = row ? (JSON.parse(row.value) as GameState) : null;
    const worldMeta = await world.get<{ value: string }>("SELECT value FROM meta WHERE key = 'world'");
    const shape = worldMeta ? (JSON.parse(worldMeta.value) as { expanded?: boolean; version?: number }) : null;
    const club = state
      ? await world.get<{ name: string }>("SELECT name FROM clubs WHERE id = ?", state.clubId)
      : undefined;
    const players = await world.get<{ total: number }>("SELECT count(*) AS total FROM players");
    const snapshots = await world.all<{ career_id: string | null; slots: number; complete: number; bytes: number | null }>(
      `SELECT career_id, count(*) AS slots, count(*) FILTER (WHERE complete) AS complete,
        sum(byte_length) AS bytes FROM ${tableName(world.schemaName, "save_slots")} GROUP BY career_id`,
    );
    // Tables plus their indexes and TOAST data.
    const size = await world.get<{ total_mb: number | null; table_mb: number | null }>(
      `SELECT sum(pg_total_relation_size(relation.oid)) / 1048576.0 AS total_mb,
        sum(pg_table_size(relation.oid)) / 1048576.0 AS table_mb
      FROM pg_catalog.pg_class AS relation
      WHERE relation.relnamespace = to_regnamespace(?) AND relation.relkind IN ('r', 'p')`,
      quoteIdentifier(world.schemaName),
    );
    return {
      active: state
        ? {
            careerId: state.careerId ?? null,
            careerName: state.careerName ?? null,
            started: state.started !== false,
            club: club?.name ?? null,
            clubId: state.clubId,
            director: state.director.name,
            date: state.date,
            season: state.season,
            seed: state.seed,
          }
        : null,
      world: { expanded: shape?.expanded ?? null, version: shape?.version ?? null, players: Number(players?.total ?? 0) },
      snapshots: snapshots.map((snapshot) => ({
        careerId: snapshot.career_id,
        slots: Number(snapshot.slots),
        complete: Number(snapshot.complete),
        bytes: Number(snapshot.bytes ?? 0),
        deletedWithActiveCareer: Boolean(state?.careerId) && snapshot.career_id === state?.careerId,
      })),
      approximateSizeMB: size
        ? { total: Math.round(Number(size.total_mb ?? 0)), tables: Math.round(Number(size.table_mb ?? 0)) }
        : "unavailable",
    };
  });
}

export async function main(
  args = process.argv.slice(2),
  dependencies: CareerDeleteDependencies = {
    open: () => Store.open(),
    saves: (world) => new Saves(world),
    log: (line) => console.log(line),
  },
) {
  const options = careerDeleteOptions(args);
  if (!options) {
    dependencies.log(USAGE);
    return;
  }
  const root = await dependencies.open();
  try {
    const registry = root.forSchema(options.accountSchema);
    await assertAccountRegistry(registry);
    const records = await registry.all<AccountRecord>(
      `SELECT id, tenant_id, object_id, display_name, email, game_schema
       FROM ${tableName(options.accountSchema, "users")} ORDER BY created_at, id`,
    );
    if (options.list) {
      dependencies.log(JSON.stringify({ registry: maskedRegistry(records) }, null, 2));
      return;
    }
    let selected: ReturnType<typeof selectAccount>;
    try {
      selected = selectAccount(records, options);
    } catch (error) {
      dependencies.log(JSON.stringify({ registry: registryCounts(records), hint: "Re-run with --list for a masked listing." }, null, 2));
      throw error;
    }
    const { account, matchedBy } = selected;
    const world = root.forSchema(account.game_schema);
    const summary = {
      database: root.database,
      schema: maskSchema(world.schemaName),
      requestTimeoutMs: Number(process.env.SQL_REQUEST_TIMEOUT_MS ?? 120000),
      account: {
        id: maskIdentifier(account.id),
        tenantId: maskIdentifier(account.tenant_id),
        objectId: maskIdentifier(account.object_id),
        displayName: maskText(account.display_name),
        email: maskEmail(account.email),
        matchedBy,
        identifiers: { objectId: true, storedEmail: Boolean(account.email) },
      },
      ...(await careerSummary(world)),
    };
    if (!options.apply) {
      dependencies.log(JSON.stringify({
        dryRun: true,
        ...summary,
        next: summary.active
          ? "Re-run with --apply --yes to delete this active career, its world and its snapshots. This cannot be undone."
          : "Nothing to delete: this account has no active career.",
      }, null, 2));
      return;
    }
    if (!summary.active) throw new Error("This account has no active career to delete.");
    dependencies.log(JSON.stringify({ applying: true, ...summary }, null, 2));
    const saves = dependencies.saves(world);
    const started = performance.now();
    const elapsed = () => Math.round((performance.now() - started) / 100) / 10;
    const heartbeat = setInterval(() => dependencies.log(`Deleting the career; ${elapsed()}s elapsed.`), 30_000);
    heartbeat.unref();
    let result: Awaited<ReturnType<SavesLike["deleteActiveCareer"]>>;
    try {
      result = await saves.deleteActiveCareer({ careerId: summary.active.careerId, seed: summary.active.seed });
    } finally {
      clearInterval(heartbeat);
    }
    dependencies.log(JSON.stringify({
      applied: true,
      schema: summary.schema,
      seconds: elapsed(),
      result,
      after: { hasWorld: Boolean(await saves.currentState()), remainingSnapshots: (await saves.list()).length },
    }, null, 2));
  } finally {
    await root.close();
  }
}

if (isMain(import.meta.url))
  void main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : "Career deletion failed.");
    process.exitCode = 1;
  });
