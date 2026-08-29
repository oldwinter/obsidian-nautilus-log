export type MutationQueueState = "accepting" | "stopping" | "stopped";

export class MutationQueueStoppedError extends Error {
  constructor() {
    super("Mutation queue is not accepting intents");
    this.name = "MutationQueueStoppedError";
  }
}

export class MutationQueueCapacityError extends Error {
  constructor() {
    super("Mutation queue intent tracking limit reached");
    this.name = "MutationQueueCapacityError";
  }
}

function validIntentId(intentId: string): boolean {
  return intentId.length > 0 && intentId.length <= 256 && !/[\0\r\n]/.test(intentId);
}

export class MutationQueue {
  #tail: Promise<void> = Promise.resolve();
  #state: MutationQueueState = "accepting";
  #pendingCount = 0;
  #stopPromise: Promise<void> | undefined;
  readonly #intents = new Map<string, Promise<unknown>>();
  readonly #settledIntentIds: string[] = [];
  readonly #maximumTrackedIntents: number;

  constructor(maximumTrackedIntents = 4_096) {
    if (!Number.isSafeInteger(maximumTrackedIntents) || maximumTrackedIntents <= 0) {
      throw new RangeError("maximumTrackedIntents must be a positive safe integer");
    }
    this.#maximumTrackedIntents = maximumTrackedIntents;
  }

  get state(): MutationQueueState {
    return this.#state;
  }

  get pendingCount(): number {
    return this.#pendingCount;
  }

  enqueue<T>(intentId: string, attempt: () => Promise<T> | T): Promise<T> {
    if (!validIntentId(intentId)) throw new TypeError("intentId must be a bounded safe string");
    if (this.#state !== "accepting") return Promise.reject(new MutationQueueStoppedError());
    const duplicate = this.#intents.get(intentId);
    if (duplicate) return duplicate as Promise<T>;

    while (this.#intents.size >= this.#maximumTrackedIntents) {
      const oldestSettled = this.#settledIntentIds.shift();
      if (!oldestSettled) return Promise.reject(new MutationQueueCapacityError());
      this.#intents.delete(oldestSettled);
    }

    this.#pendingCount += 1;
    const attemptResult = this.#tail.then(() => attempt());
    const operation = attemptResult.finally(() => {
      this.#pendingCount -= 1;
      this.#settledIntentIds.push(intentId);
    });
    this.#intents.set(intentId, operation);
    this.#tail = operation.then(
      () => undefined,
      () => undefined,
    );
    return operation;
  }

  stop(): Promise<void> {
    if (this.#stopPromise) return this.#stopPromise;
    this.#state = "stopping";
    this.#stopPromise = this.#tail.then(() => {
      this.#state = "stopped";
    });
    return this.#stopPromise;
  }
}
