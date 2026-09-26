import { useState } from "react";
import {
  nextSort,
  sortRows,
  type SortColumn,
  type SortDirection,
  type SortState,
} from "./sort.ts";

export interface SortableOptions<Row, Key extends string> {
  initial?: SortState<Key> | null;
  /** Controlled sort, e.g. a paginated table sorted by the server. */
  sort?: SortState<Key> | null;
  onSortChange?: (sort: SortState<Key>) => void;
  tieBreakers?: readonly Pick<SortColumn<Row>, "value" | "defaultDirection">[];
  /** Rows already arrive in the requested order (server-side sorting). */
  presorted?: boolean;
}

export function useSortableRows<Row, Key extends string>(
  rows: readonly Row[],
  columns: readonly SortColumn<Row, Key>[],
  options: SortableOptions<Row, Key> = {},
) {
  const [local, setLocal] = useState<SortState<Key> | null>(
    options.initial ?? null,
  );
  const controlled = options.sort !== undefined;
  const sort = controlled ? (options.sort ?? null) : local;
  const column = sort
    ? columns.find((entry) => entry.key === sort.key)
    : undefined;
  const sorted =
    options.presorted || !sort || !column
      ? [...rows]
      : sortRows(rows, column, sort.direction, options.tieBreakers);
  const defaultDirection = (key: Key): SortDirection =>
    columns.find((entry) => entry.key === key)?.defaultDirection ?? "asc";
  function setSort(next: SortState<Key>) {
    if (!controlled) setLocal(next);
    options.onSortChange?.(next);
  }
  function toggle(key: Key) {
    setSort(nextSort(sort, key, defaultDirection(key)));
  }
  return {
    rows: sorted,
    sort,
    setSort,
    toggle,
    defaultDirection,
    /** Props for a SortHeader of this table. */
    header: (key: Key) => ({ column: key, sort, onSort: toggle }),
  };
}
