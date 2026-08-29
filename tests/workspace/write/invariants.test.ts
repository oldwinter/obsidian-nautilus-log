import assert from "node:assert/strict";
import test from "node:test";

import {
  generateUniqueClockId,
  generateUniquePlanItemId,
  generateUuidV4,
} from "../../../src/workspace/logbook-clock.ts";
import { MUTATION_ACTIONS } from "../../../src/workspace/mutations.ts";

type WorkspaceEvidenceModule =
  | "actions.test.ts"
  | "adapter-matrix.test.ts"
  | "commit.test.ts"
  | "invariants.test.ts"
  | "mutations.test.ts"
  | "protocol.test.ts";

interface WorkspaceInvariant {
  readonly number: number;
  readonly contract: string;
  readonly evidenceModules: readonly WorkspaceEvidenceModule[];
}

interface DeferredInvariant {
  readonly number: number;
  readonly ownerTickets: readonly number[];
  readonly issue25Contribution: string;
}

const ISSUE_25_EXECUTABLE_INVARIANTS: readonly WorkspaceInvariant[] = Object.freeze([
  { number: 5, contract: "fresh decision and in-primitive revalidation", evidenceModules: ["commit.test.ts", "protocol.test.ts"] },
  { number: 6, contract: "cached source metadata is never write authority", evidenceModules: ["commit.test.ts"] },
  { number: 7, contract: "unique identity relocation requires exact semantic agreement", evidenceModules: ["commit.test.ts"] },
  { number: 8, contract: "anonymous and ID-less legacy targets never relocate", evidenceModules: ["commit.test.ts", "actions.test.ts"] },
  { number: 9, contract: "identity collisions block writes and selected repair is exact", evidenceModules: ["actions.test.ts"] },
  { number: 10, contract: "same-file mutations expose one atomic host transform", evidenceModules: ["commit.test.ts"] },
  { number: 11, contract: "Editor and Vault.process produce equivalent source and receipts", evidenceModules: ["commit.test.ts", "adapter-matrix.test.ts"] },
  { number: 12, contract: "complete-source diffs enforce the Mutation Plan allowlist", evidenceModules: ["mutations.test.ts"] },
  { number: 13, contract: "success requires authoritative reread and post-scan confirmation", evidenceModules: ["protocol.test.ts"] },
  { number: 14, contract: "workspace conflicts and rejections change zero bytes", evidenceModules: ["actions.test.ts", "mutations.test.ts"] },
  { number: 15, contract: "uncertain host results reconcile without retry and block later commits", evidenceModules: ["commit.test.ts"] },
  { number: 16, contract: "canonical LOGBOOK and CLOCK output round-trips", evidenceModules: ["actions.test.ts"] },
  { number: 17, contract: "generated Plan Item and CLOCK IDs use Web Crypto and reject collisions", evidenceModules: ["invariants.test.ts", "protocol.test.ts"] },
  { number: 19, contract: "same-file switch is atomic and cross-file switch is close-before-open", evidenceModules: ["commit.test.ts"] },
  { number: 20, contract: "switch stages share one absolute transition instant", evidenceModules: ["mutations.test.ts", "commit.test.ts"] },
  { number: 21, contract: "Clock Out changes the exact CLOCK and rejects a backwards end", evidenceModules: ["actions.test.ts"] },
  { number: 22, contract: "Complete changes only target-owned state", evidenceModules: ["actions.test.ts"] },
  { number: 23, contract: "progress and reopen branches are exact same-file mutations", evidenceModules: ["actions.test.ts"] },
  { number: 24, contract: "delete confirmation and attached-content rejection preserve surrounding bytes", evidenceModules: ["actions.test.ts", "mutations.test.ts"] },
  { number: 31, contract: "Timing Repair applies only revalidated previewed changes", evidenceModules: ["actions.test.ts", "commit.test.ts", "protocol.test.ts"] },
  { number: 34, contract: "canonical instants are offset-bearing and legacy folds and gaps are not guessed", evidenceModules: ["actions.test.ts"] },
  { number: 38, contract: "same-file Editor commits are one transaction and receipts make no false Undo claim", evidenceModules: ["commit.test.ts", "protocol.test.ts"] },
]);

const DEFERRED_CROSS_TICKET_INVARIANTS: readonly DeferredInvariant[] = Object.freeze([
  { number: 1, ownerTickets: [26], issue25Contribution: "validates the intent carried by a Mutation Plan, but does not admit UI actions" },
  { number: 2, ownerTickets: [21, 26], issue25Contribution: "defines no lifecycle mutation action; runtime and projection tests remain required" },
  { number: 3, ownerTickets: [26], issue25Contribution: "commits one plan at a time after runtime admission; it does not own the vault FIFO" },
  { number: 4, ownerTickets: [26], issue25Contribution: "requires intentId on plans and receipts; runtime owns gesture deduplication" },
  { number: 18, ownerTickets: [26], issue25Contribution: "proves no duplicate Markdown; task-POMO idempotency is not a workspace claim" },
  { number: 25, ownerTickets: [26], issue25Contribution: "provides exact Clock Out and empty-running-set receipts; runtime owns Enable and Disable persistence" },
  { number: 26, ownerTickets: [26], issue25Contribution: "provides authoritative CLOCK state only; POMO ordering and reload are deferred" },
  { number: 27, ownerTickets: [26], issue25Contribution: "receipts prohibit Markdown rollback claims; plugin-data save behavior is deferred" },
  { number: 28, ownerTickets: [21, 26], issue25Contribution: "persists no recovery journal; reload projection and lifecycle behavior are deferred" },
  { number: 29, ownerTickets: [26], issue25Contribution: "builds the complete bounded CLOCK safety index and rejects multiple, invalid-owner, and potential-running facts before host entry; runtime state ownership remains deferred" },
  { number: 30, ownerTickets: [19, 20], issue25Contribution: "preserves malformed source and does not block a supplied safe mutation; parsing and Actual exclusion remain deferred" },
  { number: 32, ownerTickets: [26], issue25Contribution: "has no automatic stale-session mutation; runtime lifecycle behavior remains deferred" },
  { number: 33, ownerTickets: [19], issue25Contribution: "retains absolute endpoints; calendar-day clipping and projection fixtures belong to scheduler ticket #19" },
  { number: 35, ownerTickets: [21, 26], issue25Contribution: "rejects a supplied discontinuity and validates explicit recovery plans; detection and control disabling remain deferred" },
  { number: 36, ownerTickets: [21, 26], issue25Contribution: "defines no tick, refresh, cache-rebuild, or reconciliation mutation action; lifecycle proof remains deferred" },
  { number: 37, ownerTickets: [20, 26], issue25Contribution: "fails closed on index limits and dirty context and owns CLOCK safety indexing; remaining read-index and runtime action availability stay deferred" },
  { number: 39, ownerTickets: [27], issue25Contribution: "returns bounded redacted receipt context; notices and logs remain surface-owned" },
  { number: 40, ownerTickets: [21, 26], issue25Contribution: "dispose blocks new workspace host entry; unload admission and surface publication remain deferred" },
]);

test("issue #25 invariant ownership partitions executable workspace contracts from deferred tickets", () => {
  const workspaceNumbers = ISSUE_25_EXECUTABLE_INVARIANTS.map(({ number }) => number);
  const deferredNumbers = DEFERRED_CROSS_TICKET_INVARIANTS.map(({ number }) => number);
  assert.equal(new Set(workspaceNumbers).size, workspaceNumbers.length);
  assert.equal(new Set(deferredNumbers).size, deferredNumbers.length);
  assert.deepEqual(
    [...workspaceNumbers, ...deferredNumbers].sort((left, right) => left - right),
    Array.from({ length: 40 }, (_, index) => index + 1),
  );
  for (const invariant of ISSUE_25_EXECUTABLE_INVARIANTS) {
    assert.ok(invariant.contract.length > 0, `invariant ${invariant.number} workspace contract`);
    assert.ok(invariant.evidenceModules.length > 0, `invariant ${invariant.number} workspace evidence modules`);
  }
  for (const invariant of DEFERRED_CROSS_TICKET_INVARIANTS) {
    assert.ok(invariant.ownerTickets.length > 0, `invariant ${invariant.number} deferred owner`);
    assert.equal(invariant.ownerTickets.includes(25), false, `invariant ${invariant.number} is not fully owned by #25`);
    assert.ok(invariant.issue25Contribution.length > 0, `invariant ${invariant.number} contribution boundary`);
  }
  assert.deepEqual(
    DEFERRED_CROSS_TICKET_INVARIANTS.find(({ number }) => number === 33)?.ownerTickets,
    [19],
  );
});

test("issue #25 mutation vocabulary excludes cross-ticket runtime actions", () => {
  const forbidden = ["startup", "tick", "refresh", "navigate", "enable", "pomo", "unload"];
  for (const word of forbidden) {
    assert.equal(MUTATION_ACTIONS.some((action) => action.includes(word)), false, word);
  }
});

test("invariant 17 calls Web Crypto with 16 bytes and normalizes UUID bits", () => {
  const cryptoDescriptor = Object.getOwnPropertyDescriptor(globalThis, "crypto");
  const observed: Uint8Array[] = [];
  const fakeCrypto = {
    getRandomValues<T extends ArrayBufferView | null>(values: T): T {
      assert.ok(values instanceof Uint8Array);
      assert.equal(values.byteLength, 16);
      values.fill(0xff);
      observed.push(values);
      return values as T;
    },
  };
  Object.defineProperty(globalThis, "crypto", { configurable: true, value: fakeCrypto });
  try {
    assert.match(generateUuidV4(), /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    assert.match(generateUniquePlanItemId(() => false), /^nl-[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    assert.match(generateUniqueClockId(() => false), /^nl-clock-[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    assert.equal(observed.length, 3);
    for (const values of observed) {
      assert.equal(values.byteLength, 16);
      assert.equal(values[6]! & 0xf0, 0x40);
      assert.equal(values[8]! & 0xc0, 0x80);
    }
  } finally {
    if (cryptoDescriptor) Object.defineProperty(globalThis, "crypto", cryptoDescriptor);
    else Reflect.deleteProperty(globalThis, "crypto");
  }
});

test("invariant 17 fails closed when public Web Crypto is unavailable", () => {
  const cryptoDescriptor = Object.getOwnPropertyDescriptor(globalThis, "crypto");
  Object.defineProperty(globalThis, "crypto", { configurable: true, value: undefined });
  try {
    assert.throws(() => generateUuidV4(), /public Web Crypto API/);
    assert.throws(() => generateUniquePlanItemId(() => false), /public Web Crypto API/);
    assert.throws(() => generateUniqueClockId(() => false), /public Web Crypto API/);
  } finally {
    if (cryptoDescriptor) Object.defineProperty(globalThis, "crypto", cryptoDescriptor);
    else Reflect.deleteProperty(globalThis, "crypto");
  }
});

test("invariant 17 retries vault collisions and fails closed on exhaustion", () => {
  const bytes = (fill: number) => (target: Uint8Array<ArrayBuffer>): Uint8Array<ArrayBuffer> => {
    target.fill(fill);
    return target;
  };
  const uuid = generateUuidV4(bytes(0xab));
  assert.match(uuid, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);

  let attempt = 0;
  const retryingRandom = (target: Uint8Array<ArrayBuffer>): Uint8Array<ArrayBuffer> => {
    target.fill(attempt++);
    return target;
  };
  const collided: string[] = [];
  const planId = generateUniquePlanItemId((id) => {
    collided.push(id);
    return collided.length === 1;
  }, { randomValues: retryingRandom, maximumAttempts: 2 });
  assert.equal(collided.length, 2);
  assert.equal(planId, collided[1]);
  assert.match(planId, /^nl-[0-9a-f-]{36}$/);

  assert.throws(() => generateUniqueClockId(() => true, {
    randomValues: bytes(0xcd),
    maximumAttempts: 2,
  }), /collision-free CLOCK ID/);
});
