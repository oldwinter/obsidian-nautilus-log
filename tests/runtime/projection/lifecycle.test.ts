import assert from "node:assert/strict";
import test from "node:test";

import {
  acquireVaultRuntime,
  type VaultRuntime,
} from "../../../src/runtime/lifecycle.ts";

class CountingRuntime implements VaultRuntime {
  starts = 0;
  stops = 0;

  async start(): Promise<void> {
    this.starts += 1;
  }

  stop(): void {
    this.stops += 1;
  }
}

class DeferredStopRuntime extends CountingRuntime {
  stopStarted = false;
  readonly #stopped = Promise.withResolvers<void>();

  override stop(): Promise<void> {
    this.stops += 1;
    this.stopStarted = true;
    return this.#stopped.promise;
  }

  finishStop(): void {
    this.#stopped.resolve();
  }
}

test("TC-OBS-LIFE-001-001 shares one runtime owner per vault", async () => {
  const vault = {};
  const runtime = new CountingRuntime();
  let creates = 0;
  const create = () => {
    creates += 1;
    return runtime;
  };

  const [first, second] = await Promise.all([
    acquireVaultRuntime(vault, create),
    acquireVaultRuntime(vault, create),
  ]);

  assert.equal(creates, 1);
  assert.equal(runtime.starts, 1);
  assert.equal(first.runtime, second.runtime);
  await first.release();
  assert.equal(runtime.stops, 0);
  await second.release();
  assert.equal(runtime.stops, 1);
});

test("TC-OBS-LIFE-001-002 release is idempotent", async () => {
  const runtime = new CountingRuntime();
  const lease = await acquireVaultRuntime({}, () => runtime);
  await Promise.all([lease.release(), lease.release(), lease.release()]);
  assert.equal(runtime.stops, 1);
});

test("TC-OBS-LIFE-001-003 reacquisition waits for asynchronous teardown", async () => {
  const vault = {};
  const firstRuntime = new DeferredStopRuntime();
  let creates = 0;
  const first = await acquireVaultRuntime(vault, () => {
    creates += 1;
    return firstRuntime;
  });

  const releasing = first.release();
  await Promise.resolve();
  assert.equal(firstRuntime.stopStarted, true);
  const replacementRuntime = new CountingRuntime();
  const replacementLease = acquireVaultRuntime(vault, () => {
    creates += 1;
    return replacementRuntime;
  });
  await Promise.resolve();
  assert.equal(creates, 1);
  assert.equal(replacementRuntime.starts, 0);

  firstRuntime.finishStop();
  await releasing;
  const replacement = await replacementLease;
  assert.equal(creates, 2);
  assert.equal(replacementRuntime.starts, 1);
  await replacement.release();
});

test("TC-OBS-LIFE-001-004 failed start finishes teardown before permitting a fresh load", async () => {
  const vault = {};
  const teardown = Promise.withResolvers<void>();
  const stopStarted = Promise.withResolvers<void>();
  let creates = 0;
  const failing: VaultRuntime = {
    async start() {
      throw new Error("start failed");
    },
    async stop() {
      stopStarted.resolve();
      await teardown.promise;
    },
  };
  const replacement = new CountingRuntime();
  const create = (): VaultRuntime => {
    creates += 1;
    return creates === 1 ? failing : replacement;
  };
  const failedAcquisition = acquireVaultRuntime(vault, create);
  const failure = assert.rejects(failedAcquisition, /start failed/);
  await stopStarted.promise;

  const replacementAcquisition = acquireVaultRuntime(vault, create);
  await Promise.resolve();
  assert.equal(creates, 1);
  teardown.resolve();
  await failure;

  const lease = await replacementAcquisition;
  assert.equal(creates, 2);
  assert.equal(replacement.starts, 1);
  await lease.release();
  assert.equal(replacement.stops, 1);
});

test("TC-OBS-LIFE-001-005 ten enable-disable cycles retain no runtime owner", async () => {
  const vault = {};
  const runtimes: CountingRuntime[] = [];
  for (let cycle = 0; cycle < 10; cycle += 1) {
    const lease = await acquireVaultRuntime(vault, () => {
      const runtime = new CountingRuntime();
      runtimes.push(runtime);
      return runtime;
    });
    await lease.release();
  }

  assert.equal(runtimes.length, 10);
  assert.ok(runtimes.every((runtime) => runtime.starts === 1 && runtime.stops === 1));
});
