export type CacheDisposalReason = "evicted" | "replaced" | "deleted" | "cleared";

export interface DisposableLruCacheOptions<TKey, TValue> {
  readonly maxEntries: number;
  readonly maxWeight?: number;
  readonly weightOf?: (value: TValue, key: TKey) => number;
  readonly dispose?: (
    value: TValue,
    key: TKey,
    reason: CacheDisposalReason,
  ) => void;
}

interface CacheEntry<TValue> {
  readonly value: TValue;
  readonly weight: number;
}

interface RemovedEntry<TKey, TValue> extends CacheEntry<TValue> {
  readonly key: TKey;
  readonly reason: CacheDisposalReason;
}

function assertPositiveSafeInteger(value: number, name: string): void {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new RangeError(`${name} must be a positive safe integer`);
  }
}

function assertWeight(value: number): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new RangeError("Cache entry weight must be a nonnegative safe integer");
  }
}

/** A memory-only cache whose Map insertion order is its least-to-most recent order. */
export class DisposableLruCache<TKey, TValue> {
  readonly #entries = new Map<TKey, CacheEntry<TValue>>();
  readonly #maxEntries: number;
  readonly #maxWeight: number;
  readonly #weightOf: (value: TValue, key: TKey) => number;
  readonly #dispose: ((
    value: TValue,
    key: TKey,
    reason: CacheDisposalReason,
  ) => void) | undefined;
  #totalWeight = 0;

  constructor(options: DisposableLruCacheOptions<TKey, TValue>) {
    assertPositiveSafeInteger(options.maxEntries, "maxEntries");
    if (options.maxWeight !== undefined) {
      assertPositiveSafeInteger(options.maxWeight, "maxWeight");
    }
    this.#maxEntries = options.maxEntries;
    this.#maxWeight = options.maxWeight ?? Number.MAX_SAFE_INTEGER;
    this.#weightOf = options.weightOf ?? (() => 1);
    this.#dispose = options.dispose;
  }

  get size(): number {
    return this.#entries.size;
  }

  get totalWeight(): number {
    return this.#totalWeight;
  }

  has(key: TKey): boolean {
    return this.#entries.has(key);
  }

  peek(key: TKey): TValue | undefined {
    return this.#entries.get(key)?.value;
  }

  get(key: TKey): TValue | undefined {
    const entry = this.#entries.get(key);
    if (!entry) return undefined;
    this.#entries.delete(key);
    this.#entries.set(key, entry);
    return entry.value;
  }

  /** Returns false without taking ownership when the value alone exceeds the weight bound. */
  set(key: TKey, value: TValue): boolean {
    const weight = this.#weightOf(value, key);
    assertWeight(weight);
    if (weight > this.#maxWeight) return false;

    const removed: RemovedEntry<TKey, TValue>[] = [];
    const previous = this.#entries.get(key);
    if (previous) {
      this.#entries.delete(key);
      this.#totalWeight -= previous.weight;
      if (previous.value !== value) {
        removed.push({ key, ...previous, reason: "replaced" });
      }
    }

    this.#entries.set(key, { value, weight });
    this.#totalWeight += weight;
    while (
      this.#entries.size > this.#maxEntries
      || this.#totalWeight > this.#maxWeight
    ) {
      const oldest = this.#entries.entries().next().value as
        | readonly [TKey, CacheEntry<TValue>]
        | undefined;
      if (!oldest) break;
      const [oldestKey, oldestEntry] = oldest;
      this.#entries.delete(oldestKey);
      this.#totalWeight -= oldestEntry.weight;
      removed.push({ key: oldestKey, ...oldestEntry, reason: "evicted" });
    }
    this.#disposeRemoved(removed);
    return true;
  }

  delete(key: TKey): boolean {
    const entry = this.#entries.get(key);
    if (!entry) return false;
    this.#entries.delete(key);
    this.#totalWeight -= entry.weight;
    this.#disposeRemoved([{ key, ...entry, reason: "deleted" }]);
    return true;
  }

  deleteWhere(predicate: (value: TValue, key: TKey) => boolean): number {
    const removed: RemovedEntry<TKey, TValue>[] = [];
    for (const [key, entry] of this.#entries) {
      if (!predicate(entry.value, key)) continue;
      this.#entries.delete(key);
      this.#totalWeight -= entry.weight;
      removed.push({ key, ...entry, reason: "deleted" });
    }
    this.#disposeRemoved(removed);
    return removed.length;
  }

  clear(): void {
    const removed = [...this.#entries].map(([key, entry]) => ({
      key,
      ...entry,
      reason: "cleared" as const,
    }));
    this.#entries.clear();
    this.#totalWeight = 0;
    this.#disposeRemoved(removed);
  }

  keys(): readonly TKey[] {
    return Object.freeze([...this.#entries.keys()]);
  }

  #disposeRemoved(entries: readonly RemovedEntry<TKey, TValue>[]): void {
    if (!this.#dispose) return;
    let firstError: unknown;
    for (const entry of entries) {
      try {
        this.#dispose(entry.value, entry.key, entry.reason);
      } catch (error) {
        firstError ??= error;
      }
    }
    if (firstError !== undefined) throw firstError;
  }
}

export const CLOCK_FALLBACK_TTL_MILLISECONDS = 15_000;
export const DEFAULT_CLOCK_FALLBACK_MAX_ENTRIES = 128;

interface ClockFallbackEntry<TValue> {
  readonly value: TValue;
  readonly observedAtEpochMilliseconds: number;
}

function assertEpochMilliseconds(value: number, name: string): void {
  if (!Number.isFinite(value)) throw new RangeError(`${name} must be finite`);
}

/**
 * Read-only CLOCK facts used only while the Execution runtime is absent. Reads
 * do not extend freshness; a backwards wall-clock movement also expires data.
 */
export class ClockFallbackCache<TKey, TValue> {
  readonly #entries: DisposableLruCache<TKey, ClockFallbackEntry<TValue>>;

  constructor(maxEntries = DEFAULT_CLOCK_FALLBACK_MAX_ENTRIES) {
    this.#entries = new DisposableLruCache({ maxEntries });
  }

  get size(): number {
    return this.#entries.size;
  }

  set(key: TKey, value: TValue, observedAtEpochMilliseconds: number): void {
    assertEpochMilliseconds(observedAtEpochMilliseconds, "observedAtEpochMilliseconds");
    this.#entries.set(key, Object.freeze({ value, observedAtEpochMilliseconds }));
  }

  get(key: TKey, nowEpochMilliseconds: number): TValue | undefined {
    assertEpochMilliseconds(nowEpochMilliseconds, "nowEpochMilliseconds");
    const entry = this.#entries.get(key);
    if (!entry) return undefined;
    const age = nowEpochMilliseconds - entry.observedAtEpochMilliseconds;
    if (age < 0 || age >= CLOCK_FALLBACK_TTL_MILLISECONDS) {
      this.#entries.delete(key);
      return undefined;
    }
    return entry.value;
  }

  invalidate(key: TKey): boolean {
    return this.#entries.delete(key);
  }

  clear(): void {
    this.#entries.clear();
  }
}
