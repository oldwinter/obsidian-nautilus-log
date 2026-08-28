export interface VaultRuntime {
  start(): Promise<void>;
  stop(): void | Promise<void>;
}

export interface VaultRuntimeLease<TRuntime extends VaultRuntime> {
  readonly runtime: TRuntime;
  release(): Promise<void>;
}

interface RuntimeEntry<TRuntime extends VaultRuntime> {
  readonly runtime: TRuntime;
  start: Promise<void>;
  stop?: Promise<void>;
  owners: number;
}

const vaultRuntimes = new WeakMap<object, RuntimeEntry<VaultRuntime>>();

function stopRuntimeEntry<TRuntime extends VaultRuntime>(
  vault: object,
  entry: RuntimeEntry<TRuntime>,
): Promise<void> {
  if (entry.stop) return entry.stop;
  entry.stop = Promise.resolve()
    .then(() => entry.runtime.stop())
    .then(() => {
      if (vaultRuntimes.get(vault) === entry) vaultRuntimes.delete(vault);
    });
  return entry.stop;
}

/**
 * Shares one started runtime for every vault identity. A lease never owns view
 * connections, and releasing one lease cannot stop a runtime still in use.
 */
export async function acquireVaultRuntime<TRuntime extends VaultRuntime>(
  vault: object,
  create: () => TRuntime,
): Promise<VaultRuntimeLease<TRuntime>> {
  let entry = vaultRuntimes.get(vault) as RuntimeEntry<TRuntime> | undefined;
  if (entry?.stop) {
    await entry.stop;
    return acquireVaultRuntime(vault, create);
  }
  if (!entry) {
    const runtime = create();
    const created: RuntimeEntry<TRuntime> = {
      runtime,
      owners: 0,
      start: Promise.resolve(),
    };
    created.start = Promise.resolve()
      .then(() => runtime.start())
      .catch(async (startError: unknown) => {
        try {
          await stopRuntimeEntry(vault, created);
        } catch (stopError: unknown) {
          throw new AggregateError(
            [startError, stopError],
            "Runtime start and teardown both failed",
          );
        }
        throw startError;
      });
    entry = created;
    vaultRuntimes.set(vault, created as RuntimeEntry<VaultRuntime>);
  }

  entry.owners += 1;
  try {
    await entry.start;
  } catch (error) {
    entry.owners -= 1;
    throw error;
  }

  let released = false;
  return Object.freeze({
    runtime: entry.runtime,
    async release(): Promise<void> {
      if (released) return;
      released = true;
      entry.owners -= 1;
      if (entry.owners !== 0 || vaultRuntimes.get(vault) !== entry) return;
      await stopRuntimeEntry(vault, entry);
    },
  });
}
