import { createHash } from "node:crypto";
import { Readable, Transform, type Writable } from "node:stream";
import { finished, pipeline } from "node:stream/promises";
import { createGunzip, createGzip } from "node:zlib";

export const SAVE_FORMAT_VERSION = 1;
export const SAVE_SCHEMA_VERSION = 1;
export const SQL_CHUNK_BYTES = 1024 * 1024;
export const SAVE_LIMITS = Object.freeze({
  compressedBytes: 16 * 1024 ** 3,
  expandedBytes: 64 * 1024 ** 3,
  lineBytes: 32 * 1024 ** 2,
  tables: 128,
  columns: 256,
  rows: 200_000_000,
});

export type SaveLimits = typeof SAVE_LIMITS;
export type ColumnType =
  | "int"
  | "bigint"
  | "smallint"
  | "tinyint"
  | "bit"
  | "float"
  | "real"
  | "nvarchar"
  | "varchar"
  | "nchar"
  | "char"
  | "varbinary"
  | "binary"
  | "date"
  | "datetime"
  | "datetime2"
  | "uniqueidentifier"
  | "decimal"
  | "numeric";

export interface CheckpointColumn {
  name: string;
  type: ColumnType;
  nullable: boolean;
  maxLength?: number;
  precision?: number;
  scale?: number;
}

export interface CheckpointTable {
  name: string;
  columns: CheckpointColumn[];
  rowCount: number;
}

export interface SourceFile {
  name: string;
  bytes: number;
  sha256: string;
}

export interface CheckpointManifest {
  kind: "manifest";
  format: "touchline";
  formatVersion: number;
  schemaVersion: number;
  createdAt: string;
  tables: CheckpointTable[];
  provenance?: {
    source: string;
    sourceSha256: string;
    sidecar?: string;
    files?: SourceFile[];
  };
}

export interface CheckpointSchema {
  version: number;
  tables: { name: string; columns: CheckpointColumn[] }[];
}

export class SaveFormatError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SaveFormatError";
  }
}

export function identifier(value: unknown): string {
  if (typeof value !== "string" || !/^[a-z][a-z0-9_]{0,127}$/.test(value))
    throw new SaveFormatError("Invalid checkpoint identifier.");
  return value;
}

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new SaveFormatError("Expected a checkpoint object.");
  return value as Record<string, unknown>;
}

function keys(value: Record<string, unknown>, allowed: string[]) {
  if (Object.keys(value).some((key) => !allowed.includes(key)))
    throw new SaveFormatError("Unknown checkpoint field.");
}

function count(value: unknown, maximum: number): number {
  if (
    !Number.isSafeInteger(value) ||
    Number(value) < 0 ||
    Number(value) > maximum
  )
    throw new SaveFormatError("Checkpoint count exceeds its limits.");
  return Number(value);
}

function digest(value: unknown): string {
  if (typeof value !== "string" || !/^[a-f0-9]{64}$/.test(value))
    throw new SaveFormatError("Invalid checkpoint digest.");
  return value;
}

const columnTypes = new Set<ColumnType>([
  "int",
  "bigint",
  "smallint",
  "tinyint",
  "bit",
  "float",
  "real",
  "nvarchar",
  "varchar",
  "nchar",
  "char",
  "varbinary",
  "binary",
  "date",
  "datetime",
  "datetime2",
  "uniqueidentifier",
  "decimal",
  "numeric",
]);

function column(value: unknown): CheckpointColumn {
  const item = record(value);
  keys(item, ["name", "type", "nullable", "maxLength", "precision", "scale"]);
  identifier(item.name);
  if (
    !columnTypes.has(item.type as ColumnType) ||
    typeof item.nullable !== "boolean"
  )
    throw new SaveFormatError("Unsupported checkpoint column type.");
  if (item.maxLength !== undefined && item.maxLength !== -1)
    count(item.maxLength, 8000);
  if (item.precision !== undefined) count(item.precision, 53);
  if (item.scale !== undefined) count(item.scale, 38);
  return item as unknown as CheckpointColumn;
}

export function sameColumns(
  left: CheckpointColumn[],
  right: CheckpointColumn[],
) {
  return (
    left.length === right.length &&
    left.every((item, index) => {
      const other = right[index];
      return (
        item.name === other.name &&
        item.type === other.type &&
        item.nullable === other.nullable &&
        item.maxLength === other.maxLength &&
        item.precision === other.precision &&
        item.scale === other.scale
      );
    })
  );
}

export function validateManifest(
  value: unknown,
  expected?: CheckpointSchema,
  limits: SaveLimits = SAVE_LIMITS,
): CheckpointManifest {
  const manifest = record(value);
  keys(manifest, [
    "kind",
    "format",
    "formatVersion",
    "schemaVersion",
    "createdAt",
    "tables",
    "provenance",
  ]);
  if (
    manifest.kind !== "manifest" ||
    manifest.format !== "touchline" ||
    manifest.formatVersion !== SAVE_FORMAT_VERSION ||
    manifest.schemaVersion !== (expected?.version ?? SAVE_SCHEMA_VERSION)
  )
    throw new SaveFormatError(
      "Unsupported checkpoint format or schema version.",
    );
  if (
    typeof manifest.createdAt !== "string" ||
    !Number.isFinite(Date.parse(manifest.createdAt))
  )
    throw new SaveFormatError("Invalid checkpoint creation date.");
  if (
    !Array.isArray(manifest.tables) ||
    !manifest.tables.length ||
    manifest.tables.length > limits.tables
  )
    throw new SaveFormatError("Invalid checkpoint table inventory.");
  const names = new Set<string>();
  let total = 0;
  for (const value of manifest.tables) {
    const table = record(value);
    keys(table, ["name", "columns", "rowCount"]);
    const name = identifier(table.name);
    if (names.has(name))
      throw new SaveFormatError("Duplicate checkpoint table.");
    names.add(name);
    if (
      !Array.isArray(table.columns) ||
      !table.columns.length ||
      table.columns.length > limits.columns
    )
      throw new SaveFormatError("Invalid checkpoint columns.");
    const columns = table.columns.map(column);
    if (new Set(columns.map((item) => item.name)).size !== columns.length)
      throw new SaveFormatError("Duplicate checkpoint column.");
    total += count(table.rowCount, limits.rows);
    count(total, limits.rows);
    if (expected) {
      const target = expected.tables.find((item) => item.name === name);
      if (!target || !sameColumns(columns, target.columns))
        throw new SaveFormatError(
          `Unknown or incompatible checkpoint table: ${name}.`,
        );
    }
  }
  if (
    expected &&
    (names.size !== expected.tables.length ||
      expected.tables.some((item) => !names.has(item.name)))
  )
    throw new SaveFormatError("Checkpoint table inventory is incomplete.");
  if (manifest.provenance !== undefined) {
    const provenance = record(manifest.provenance);
    keys(provenance, ["source", "sourceSha256", "sidecar", "files"]);
    if (typeof provenance.source !== "string" || !provenance.source)
      throw new SaveFormatError("Invalid checkpoint provenance.");
    digest(provenance.sourceSha256);
    if (provenance.sidecar !== undefined) {
      if (typeof provenance.sidecar !== "string")
        throw new SaveFormatError("Invalid legacy sidecar.");
      JSON.parse(provenance.sidecar);
    }
    if (provenance.files !== undefined) {
      if (!Array.isArray(provenance.files))
        throw new SaveFormatError("Invalid source inventory.");
      for (const value of provenance.files) {
        const file = record(value);
        keys(file, ["name", "bytes", "sha256"]);
        if (typeof file.name !== "string")
          throw new SaveFormatError("Invalid source filename.");
        count(file.bytes, Number.MAX_SAFE_INTEGER);
        digest(file.sha256);
      }
    }
  }
  return manifest as unknown as CheckpointManifest;
}

export function boundedStream(maximum: number, label: string) {
  let bytes = 0;
  return new Transform({
    transform(chunk: Buffer, _encoding, callback) {
      bytes += chunk.length;
      if (bytes > maximum)
        callback(new SaveFormatError(`${label} exceeds its byte limit.`));
      else callback(null, chunk);
    },
  });
}

export type CheckpointValue =
  null | string | number | boolean | { $bigint: string } | { $bytes: string };
export type RestoredValue = null | string | number | boolean | bigint | Buffer;

export interface CheckpointSummary {
  manifest: CheckpointManifest;
  byteLength: number;
  sha256: string;
  contentSha256: string;
  tables: { name: string; rowCount: number; sha256: string }[];
}

/**
 * Content identity of a checkpoint's world: format, schema, and every table's columns, row count and row digest.
 * Unlike sha256/contentSha256 it ignores the manifest's createdAt/provenance, so two checkpoints of the same world match.
 */
export function worldDigest(summary: Pick<CheckpointSummary, "manifest" | "tables">): string {
  const { manifest } = summary;
  if (summary.tables.length !== manifest.tables.length)
    throw new SaveFormatError("Checkpoint summary does not match its manifest.");
  const tables = manifest.tables.map((table, index) => {
    const rows = summary.tables[index];
    if (rows.name !== table.name || rows.rowCount !== table.rowCount || !/^[a-f0-9]{64}$/.test(rows.sha256))
      throw new SaveFormatError("Checkpoint summary does not match its manifest.");
    return [
      table.name,
      table.columns.map((item) => [
        item.name,
        item.type,
        item.nullable,
        item.maxLength ?? null,
        item.precision ?? null,
        item.scale ?? null,
      ]),
      rows.rowCount,
      rows.sha256,
    ];
  });
  return createHash("sha256")
    .update(JSON.stringify(["touchline-world", manifest.formatVersion, manifest.schemaVersion, tables]))
    .digest("hex");
}

function limitsOf(overrides: Partial<SaveLimits> = {}): SaveLimits {
  const limits = { ...SAVE_LIMITS, ...overrides };
  for (const key of Object.keys(SAVE_LIMITS) as (keyof SaveLimits)[])
    if (
      !Number.isSafeInteger(limits[key]) ||
      limits[key] < 1 ||
      limits[key] > SAVE_LIMITS[key]
    )
      throw new SaveFormatError(`Invalid save limit: ${key}.`);
  return limits;
}

const integerRanges = {
  int: [-2147483648, 2147483647],
  smallint: [-32768, 32767],
  tinyint: [0, 255],
} as const;

export function decodeCell(
  value: unknown,
  column: CheckpointColumn,
): RestoredValue {
  const invalid = () =>
    new SaveFormatError(
      `Invalid or oversized value for ${column.name} (${column.type}).`,
    );
  if (value === null) {
    if (!column.nullable) throw invalid();
    return null;
  }
  if (
    column.type === "int" ||
    column.type === "smallint" ||
    column.type === "tinyint"
  ) {
    const [minimum, maximum] = integerRanges[column.type];
    if (
      typeof value !== "number" ||
      !Number.isSafeInteger(value) ||
      value < minimum ||
      value > maximum
    )
      throw invalid();
    return value;
  }
  if (column.type === "bigint") {
    const tagged = record(value);
    keys(tagged, ["$bigint"]);
    if (
      typeof tagged.$bigint !== "string" ||
      !/^-?(0|[1-9]\d*)$/.test(tagged.$bigint) ||
      tagged.$bigint.length > 20
    )
      throw invalid();
    const parsed = BigInt(tagged.$bigint);
    if (parsed < -(2n ** 63n) || parsed >= 2n ** 63n) throw invalid();
    return parsed;
  }
  if (column.type === "bit") {
    if (typeof value !== "boolean" && value !== 0 && value !== 1)
      throw invalid();
    return value as boolean | number;
  }
  if (column.type === "float" || column.type === "real") {
    if (
      typeof value !== "number" ||
      !Number.isFinite(value) ||
      (column.type === "real" && Math.abs(value) > 3.4028234663852886e38)
    )
      throw invalid();
    return value;
  }
  if (column.type === "binary" || column.type === "varbinary") {
    const tagged = record(value);
    keys(tagged, ["$bytes"]);
    if (typeof tagged.$bytes !== "string") throw invalid();
    const buffer = Buffer.from(tagged.$bytes, "base64");
    if (
      buffer.toString("base64") !== tagged.$bytes ||
      (column.maxLength !== undefined &&
        column.maxLength !== -1 &&
        buffer.length > column.maxLength)
    )
      throw invalid();
    return buffer;
  }
  if (typeof value !== "string") throw invalid();
  if (column.type === "decimal" || column.type === "numeric") {
    if (!/^-?\d+(\.\d+)?$/.test(value)) throw invalid();
    const [whole, fraction = ""] = value.replace(/^-/, "").split(".");
    const precision = column.precision ?? 18;
    const scale = column.scale ?? 0;
    if (
      fraction.length > scale ||
      whole.replace(/^0+/, "").length > precision - scale
    )
      throw invalid();
  } else if (column.type === "uniqueidentifier") {
    if (!/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(value))
      throw invalid();
  } else if (["date", "datetime", "datetime2"].includes(column.type)) {
    if (
      !/^\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}:\d{2}(?:\.\d{1,7})?Z?)?$/.test(
        value,
      ) ||
      !Number.isFinite(Date.parse(value)) ||
      new Date(value).toISOString().slice(0, 10) !== value.slice(0, 10)
    )
      throw invalid();
    if (column.type === "date" && value.length !== 10) throw invalid();
  } else {
    if (
      column.maxLength !== undefined &&
      column.maxLength !== -1 &&
      value.length > column.maxLength
    )
      throw invalid();
    if (
      (column.type === "varchar" || column.type === "char") &&
      [...value].some((character) => character.charCodeAt(0) > 127)
    )
      throw new SaveFormatError(
        `Non-ASCII value cannot be losslessly restored to ${column.type}.`,
      );
  }
  return value;
}

export function encodeCell(
  value: unknown,
  column: CheckpointColumn,
): CheckpointValue {
  let encoded: unknown = value;
  if (
    typeof value === "bigint" &&
    column.type !== "bigint" &&
    (value > BigInt(Number.MAX_SAFE_INTEGER) ||
      value < BigInt(Number.MIN_SAFE_INTEGER))
  )
    throw new SaveFormatError(
      `Integer cannot be represented exactly in ${column.name}.`,
    );
  if (typeof value === "bigint")
    encoded =
      column.type === "bigint" ? { $bigint: value.toString() } : Number(value);
  else if (
    column.type === "bigint" &&
    typeof value === "number" &&
    Number.isSafeInteger(value)
  )
    encoded = { $bigint: String(value) };
  else if (Buffer.isBuffer(value) || value instanceof Uint8Array)
    encoded = { $bytes: Buffer.from(value).toString("base64") };
  else if (value instanceof Date)
    encoded =
      column.type === "date"
        ? value.toISOString().slice(0, 10)
        : value.toISOString();
  else if (
    (column.type === "decimal" || column.type === "numeric") &&
    typeof value === "number" &&
    Number.isFinite(value)
  )
    encoded = String(value);
  decodeCell(encoded, column);
  return encoded as CheckpointValue;
}

function rowValues(values: unknown, table: CheckpointTable): RestoredValue[] {
  if (!Array.isArray(values) || values.length !== table.columns.length)
    throw new SaveFormatError(`Wrong row width in ${table.name}.`);
  return values.map((value, index) => decodeCell(value, table.columns[index]));
}

function jsonLine(value: unknown, limits: SaveLimits): Buffer {
  const data = Buffer.from(`${JSON.stringify(value)}\n`, "utf8");
  if (data.length > limits.lineBytes)
    throw new SaveFormatError("Checkpoint line exceeds its byte limit.");
  return data;
}

export function measuredStream(maximum: number, label: string) {
  let bytes = 0;
  const hash = createHash("sha256");
  const stream = new Transform({
    highWaterMark: SQL_CHUNK_BYTES,
    transform(chunk: Buffer, _encoding, callback) {
      bytes += chunk.length;
      if (bytes > maximum)
        callback(new SaveFormatError(`${label} exceeds its byte limit.`));
      else {
        hash.update(chunk);
        callback(null, chunk);
      }
    },
  });
  return {
    stream,
    result: () => ({ byteLength: bytes, sha256: hash.digest("hex") }),
  };
}

export async function withCheckpointDestination<Result>(
  destination: Writable,
  write: () => Promise<Result>,
): Promise<Result> {
  const completion = finished(destination, { cleanup: true });
  void completion.catch(() => {});
  try {
    const result = await write();
    await completion;
    return result;
  } catch (error) {
    destination.destroy();
    await completion.catch(() => {});
    throw error;
  }
}

export async function writeCheckpoint(
  destination: Writable,
  input: CheckpointManifest,
  rows: (
    table: CheckpointTable,
  ) => AsyncIterable<readonly unknown[]> | Iterable<readonly unknown[]>,
  overrides?: Partial<SaveLimits>,
): Promise<CheckpointSummary> {
  return withCheckpointDestination(destination, async () => {
    const limits = limitsOf(overrides);
    const manifest = validateManifest(input, undefined, limits);
    const content = createHash("sha256");
    const tables: CheckpointSummary["tables"] = [];
    let total = 0;
    let contentSha256 = "";
    async function* records() {
      const first = jsonLine(manifest, limits);
      content.update(first);
      yield first;
      for (const table of manifest.tables) {
        const start = jsonLine({ kind: "table", name: table.name }, limits);
        content.update(start);
        yield start;
        const hash = createHash("sha256");
        let rowCount = 0;
        for await (const values of rows(table)) {
          if (values.length !== table.columns.length)
            throw new SaveFormatError(`Wrong row width in ${table.name}.`);
          const encoded = values.map((value, index) =>
            encodeCell(value, table.columns[index]),
          );
          const line = jsonLine({ kind: "row", values: encoded }, limits);
          if (++rowCount > table.rowCount)
            throw new SaveFormatError(`Row count changed in ${table.name}.`);
          hash.update(line);
          content.update(line);
          yield line;
        }
        if (rowCount !== table.rowCount)
          throw new SaveFormatError(`Incomplete table: ${table.name}.`);
        total += rowCount;
        const summary = {
          name: table.name,
          rowCount,
          sha256: hash.digest("hex"),
        };
        tables.push(summary);
        const end = jsonLine({ kind: "table-end", ...summary }, limits);
        content.update(end);
        yield end;
      }
      contentSha256 = content.digest("hex");
      yield jsonLine(
        {
          kind: "end",
          tableCount: tables.length,
          rowCount: total,
          sha256: contentSha256,
        },
        limits,
      );
    }
    const compressed = measuredStream(
      limits.compressedBytes,
      "Compressed checkpoint",
    );
    async function* batches() {
      let buffer = Buffer.allocUnsafe(SQL_CHUNK_BYTES);
      let size = 0;
      for await (const record of records()) {
        let offset = 0;
        while (offset < record.length) {
          const count = Math.min(SQL_CHUNK_BYTES - size, record.length - offset);
          record.copy(buffer, size, offset, offset + count);
          size += count;
          offset += count;
          if (size === SQL_CHUNK_BYTES) {
            yield buffer;
            buffer = Buffer.allocUnsafe(SQL_CHUNK_BYTES);
            size = 0;
          }
        }
      }
      if (size) yield buffer.subarray(0, size);
    }
    await pipeline(
      Readable.from(batches(), {
        objectMode: false,
        highWaterMark: SQL_CHUNK_BYTES,
      }),
      boundedStream(limits.expandedBytes, "Expanded checkpoint"),
      createGzip({ level: 1, chunkSize: SQL_CHUNK_BYTES }),
      compressed.stream,
      destination,
    );
    return { manifest, ...compressed.result(), contentSha256, tables };
  });
}

async function* lines(source: AsyncIterable<Buffer>, limits: SaveLimits) {
  let fragments: Buffer[] = [];
  let size = 0;
  for await (const chunk of source) {
    let start = 0;
    while (start < chunk.length) {
      const newline = chunk.indexOf(10, start);
      const end = newline < 0 ? chunk.length : newline + 1;
      const fragment = chunk.subarray(start, end);
      size += fragment.length;
      if (size > limits.lineBytes)
        throw new SaveFormatError("Checkpoint line exceeds its byte limit.");
      fragments.push(fragment);
      if (newline >= 0) {
        yield Buffer.concat(fragments, size);
        fragments = [];
        size = 0;
      }
      start = end;
    }
  }
  if (size) throw new SaveFormatError("Truncated checkpoint line.");
}

export interface CheckpointReader {
  expected?: CheckpointSchema;
  limits?: Partial<SaveLimits>;
  onManifest?: (manifest: CheckpointManifest) => void | Promise<void>;
  onTable?: (table: CheckpointTable) => void | Promise<void>;
  onRow?: (
    table: CheckpointTable,
    values: RestoredValue[],
  ) => void | Promise<void>;
  onTableEnd?: (table: CheckpointTable) => void | Promise<void>;
}

export async function readCheckpoint(
  source: Readable,
  reader: CheckpointReader = {},
): Promise<CheckpointSummary> {
  const limits = limitsOf(reader.limits);
  const compressed = measuredStream(
    limits.compressedBytes,
    "Compressed checkpoint",
  );
  const content = createHash("sha256");
  const tables: CheckpointSummary["tables"] = [];
  const decoder = new TextDecoder("utf-8", { fatal: true });
  let manifest: CheckpointManifest | undefined;
  let current: CheckpointTable | undefined;
  let tableHash = createHash("sha256");
  let rowCount = 0;
  let total = 0;
  let finished = false;
  let contentSha256 = "";
  let validationError: unknown;
  try {
    await pipeline(
      source,
      compressed.stream,
      createGunzip({ chunkSize: SQL_CHUNK_BYTES }),
      boundedStream(limits.expandedBytes, "Expanded checkpoint"),
      async (decoded) => {
        try {
          for await (const line of lines(decoded, limits)) {
            if (finished)
              throw new SaveFormatError("Data follows the checkpoint footer.");
            let item: Record<string, unknown>;
            try {
              item = record(JSON.parse(decoder.decode(line)));
            } catch {
              throw new SaveFormatError("Invalid checkpoint JSON or UTF-8.");
            }
            if (!manifest) {
              manifest = validateManifest(item, reader.expected, limits);
              content.update(line);
              await reader.onManifest?.(manifest);
              continue;
            }
            if (item.kind === "end") {
              keys(item, ["kind", "tableCount", "rowCount", "sha256"]);
              if (
                current ||
                tables.length !== manifest.tables.length ||
                item.tableCount !== tables.length ||
                item.rowCount !== total
              )
                throw new SaveFormatError(
                  "Checkpoint table inventory is incomplete.",
                );
              contentSha256 = content.digest("hex");
              if (digest(item.sha256) !== contentSha256)
                throw new SaveFormatError("Checkpoint digest mismatch.");
              finished = true;
              continue;
            }
            content.update(line);
            if (item.kind === "table") {
              keys(item, ["kind", "name"]);
              if (current || manifest.tables[tables.length]?.name !== item.name)
                throw new SaveFormatError(
                  "Unexpected or duplicate checkpoint table.",
                );
              current = manifest.tables[tables.length];
              rowCount = 0;
              tableHash = createHash("sha256");
              await reader.onTable?.(current);
            } else if (item.kind === "row") {
              keys(item, ["kind", "values"]);
              if (!current || ++rowCount > current.rowCount)
                throw new SaveFormatError("Unexpected checkpoint row.");
              const values = rowValues(item.values, current);
              tableHash.update(line);
              await reader.onRow?.(current, values);
            } else if (item.kind === "table-end") {
              keys(item, ["kind", "name", "rowCount", "sha256"]);
              if (
                !current ||
                item.name !== current.name ||
                item.rowCount !== rowCount ||
                rowCount !== current.rowCount
              )
                throw new SaveFormatError("Incomplete checkpoint table.");
              const sha256 = tableHash.digest("hex");
              if (digest(item.sha256) !== sha256)
                throw new SaveFormatError("Checkpoint table digest mismatch.");
              tables.push({ name: current.name, rowCount, sha256 });
              total += rowCount;
              await reader.onTableEnd?.(current);
              current = undefined;
            } else throw new SaveFormatError("Unknown checkpoint record.");
          }
        } catch (error) {
          validationError = error;
          throw error;
        }
      },
    );
  } catch (error) {
    throw validationError ?? error;
  }
  if (!manifest || !finished)
    throw new SaveFormatError("Truncated checkpoint: missing footer.");
  return { manifest, ...compressed.result(), contentSha256, tables };
}

export async function validateCheckpoint(
  source: Readable,
  expected?: CheckpointSchema,
  limits?: Partial<SaveLimits>,
): Promise<CheckpointSummary> {
  return readCheckpoint(source, { expected, limits });
}
