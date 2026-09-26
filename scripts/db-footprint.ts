import { parseArgs } from "node:util";
import { Store } from "../server/db.ts";
import { databaseFootprint, databaseSpace, FOOTPRINT_BUDGET, type SchemaFootprint } from "../server/retention.ts";
import { validateSqlSchema } from "../server/sql-config.ts";
import { isMain } from "./data-export.ts";

const USAGE = `Usage: tsx scripts/db-footprint.ts [--schema NAME]... [--all] [--top N]
Read-only. Prints reserved and used MB per table for the chosen schemas (default: the configured schema),
or for every schema that owns tables with --all, plus the database data/log file sizes.
A world above the ${FOOTPRINT_BUDGET.initialMB} MB budget (decision 11) is flagged; saves are reported separately.
On Azure, run it through scripts/azure-sql.sh.`;

export interface FootprintOptions {
  schemas: string[];
  all: boolean;
  top: number;
}

export function footprintOptions(args: string[]): FootprintOptions | undefined {
  const { values } = parseArgs({
    args,
    options: {
      help: { type: "boolean" },
      schema: { type: "string", multiple: true },
      all: { type: "boolean" },
      top: { type: "string" },
    },
  });
  if (values.help) return undefined;
  if (values.all && values.schema?.length) throw new Error("Choose --all or --schema, not both.");
  const top = Number(values.top ?? 8);
  if (!Number.isSafeInteger(top) || top < 0 || top > 100) throw new Error("--top must be a whole number from 0 to 100.");
  return { schemas: (values.schema ?? []).map((schema) => validateSqlSchema(schema)), all: Boolean(values.all), top };
}

export function overBudget(footprint: SchemaFootprint) {
  return footprint.worldMB > FOOTPRINT_BUDGET.initialMB;
}

export async function main(args = process.argv.slice(2), open: () => Promise<Store> = () => Store.open()) {
  const options = footprintOptions(args);
  if (!options) {
    console.log(USAGE);
    return;
  }
  const store = await open();
  try {
    const schemas = options.all
      ? (await store.all<{ name: string }>(
          "SELECT DISTINCT SCHEMA_NAME([schema_id]) AS [name] FROM sys.tables ORDER BY [name]",
        )).map((row) => row.name)
      : options.schemas.length ? options.schemas : [store.schemaName];
    const footprints = await databaseFootprint(store, schemas);
    const space = await databaseSpace(store);
    const flagged = footprints.filter(overBudget);
    for (const footprint of footprints)
      console.log(
        `${footprint.schema}: ${footprint.reservedMB} MB reserved (world ${footprint.worldMB} MB, saves ${footprint.savesMB} MB, ${footprint.rows} rows)` +
          (overBudget(footprint) ? ` OVER the ${FOOTPRINT_BUDGET.initialMB} MB world budget` : ""),
      );
    console.log(JSON.stringify({
      database: store.database,
      budget: FOOTPRINT_BUDGET,
      space,
      totalReservedMB: Math.round(footprints.reduce((total, row) => total + row.reservedMB, 0) * 10) / 10,
      schemas: footprints.map((footprint) => ({ ...footprint, tables: footprint.tables.slice(0, options.top) })),
    }, null, 2));
    for (const footprint of flagged)
      if (process.env.GITHUB_ACTIONS === "true")
        console.log(`::warning title=DB footprint::${footprint.schema} world uses ${footprint.worldMB} MB (budget ${FOOTPRINT_BUDGET.initialMB} MB).`);
  } finally {
    await store.close();
  }
}

if (isMain(import.meta.url))
  void main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : "Footprint report failed.");
    process.exitCode = 1;
  });
