export interface LruCache<Value> {
  get(key: string): Value | undefined;
  /** Reads without refreshing recency (safe during render). */
  peek(key: string): Value | undefined;
  has(key: string): boolean;
  set(key: string, value: Value): void;
  clear(): void;
  readonly size: number;
}

export function createLruCache<Value>(capacity: number): LruCache<Value> {
  if (!Number.isInteger(capacity) || capacity < 1)
    throw new RangeError("LRU capacity must be a positive integer.");
  const entries = new Map<string, Value>();
  return {
    get(key) {
      if (!entries.has(key)) return undefined;
      const value = entries.get(key) as Value;
      entries.delete(key);
      entries.set(key, value);
      return value;
    },
    peek: (key) => entries.get(key),
    has: (key) => entries.has(key),
    set(key, value) {
      entries.delete(key);
      entries.set(key, value);
      while (entries.size > capacity)
        entries.delete(entries.keys().next().value as string);
    },
    clear: () => entries.clear(),
    get size() {
      return entries.size;
    },
  };
}

export interface Debouncer {
  /** Runs `task` after the delay, replacing any pending task. */
  schedule(task: () => void): void;
  /** Drops any pending task and runs `task` now. */
  now(task: () => void): void;
  cancel(): void;
  readonly pending: boolean;
}

export function createDebouncer(delay: number): Debouncer {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const cancel = () => {
    if (timer !== undefined) clearTimeout(timer);
    timer = undefined;
  };
  return {
    schedule(task) {
      cancel();
      timer = setTimeout(() => {
        timer = undefined;
        task();
      }, delay);
    },
    now(task) {
      cancel();
      task();
    },
    cancel,
    get pending() {
      return timer !== undefined;
    },
  };
}

/** "10,000+" when the server stopped counting at its cap. */
export function totalLabel(
  total: number,
  capped: boolean | undefined,
  format: (value: number) => string = (value) => value.toLocaleString("en-GB"),
) {
  return capped ? `${format(total)}+` : format(total);
}
