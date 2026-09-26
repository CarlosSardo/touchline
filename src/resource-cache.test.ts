import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createDebouncer, createLruCache, totalLabel } from "./resource-cache.ts";

describe("createLruCache", () => {
  it("evicts the least recently used entry beyond capacity", () => {
    const cache = createLruCache<number>(2);
    cache.set("a", 1);
    cache.set("b", 2);
    expect(cache.get("a")).toBe(1);
    cache.set("c", 3);
    expect(cache.has("b")).toBe(false);
    expect(cache.get("a")).toBe(1);
    expect(cache.get("c")).toBe(3);
    expect(cache.size).toBe(2);
  });

  it("peek does not refresh recency and set replaces in place", () => {
    const cache = createLruCache<string>(2);
    cache.set("a", "old");
    cache.set("b", "b");
    expect(cache.peek("a")).toBe("old");
    cache.set("c", "c");
    expect(cache.peek("a")).toBeUndefined();
    cache.set("b", "new");
    cache.set("d", "d");
    expect(cache.peek("b")).toBe("new");
    expect(cache.peek("c")).toBeUndefined();
  });

  it("clears everything and rejects invalid capacities", () => {
    const cache = createLruCache<number>(3);
    cache.set("a", 1);
    cache.clear();
    expect(cache.size).toBe(0);
    expect(cache.get("a")).toBeUndefined();
    expect(() => createLruCache(0)).toThrow(RangeError);
    expect(() => createLruCache(1.5)).toThrow(RangeError);
  });
});

describe("createDebouncer", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("runs only the last scheduled task after the delay", () => {
    const debouncer = createDebouncer(300);
    const task = vi.fn();
    debouncer.schedule(() => task(1));
    vi.advanceTimersByTime(200);
    debouncer.schedule(() => task(2));
    vi.advanceTimersByTime(299);
    expect(task).not.toHaveBeenCalled();
    expect(debouncer.pending).toBe(true);
    vi.advanceTimersByTime(1);
    expect(task).toHaveBeenCalledExactlyOnceWith(2);
    expect(debouncer.pending).toBe(false);
  });

  it("now() drops the pending task and runs immediately", () => {
    const debouncer = createDebouncer(300);
    const task = vi.fn();
    debouncer.schedule(() => task("typed"));
    debouncer.now(() => task("selected"));
    expect(task).toHaveBeenCalledExactlyOnceWith("selected");
    vi.advanceTimersByTime(1000);
    expect(task).toHaveBeenCalledTimes(1);
  });

  it("cancel() drops the pending task", () => {
    const debouncer = createDebouncer(300);
    const task = vi.fn();
    debouncer.schedule(task);
    debouncer.cancel();
    vi.advanceTimersByTime(1000);
    expect(task).not.toHaveBeenCalled();
  });
});

describe("totalLabel", () => {
  it("adds a plus sign only for capped totals", () => {
    expect(totalLabel(10000, true)).toBe("10,000+");
    expect(totalLabel(9876, false)).toBe("9,876");
    expect(totalLabel(9876, undefined)).toBe("9,876");
    expect(totalLabel(10000, true, (value) => `${value / 1000}K`)).toBe("10K+");
  });
});
