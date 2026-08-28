import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

import {
  generateUniqueClockId,
  generateUniquePlanItemId,
  generateUuidV4,
} from "../../../src/workspace/logbook-clock.ts";
import { MUTATION_ACTIONS } from "../../../src/workspace/mutations.ts";

type EvidenceOwnership = "workspace-owner" | "linked-contribution";

interface InvariantEvidence {
  readonly number: number;
  readonly ownership: EvidenceOwnership;
  readonly evidence: string;
}

const WRITE_INVARIANT_EVIDENCE: readonly InvariantEvidence[] = Object.freeze([
  { number: 1, ownership: "linked-contribution", evidence: "closed MutationPlan actions and action-operation admission" },
  { number: 2, ownership: "linked-contribution", evidence: "no lifecycle or projection operation exists in the writer protocol" },
  { number: 3, ownership: "linked-contribution", evidence: "runtime #26 owns the single FIFO; commit executes one admitted plan" },
  { number: 4, ownership: "linked-contribution", evidence: "runtime #26 owns dedupe; stable intentId is mandatory in plans and receipts" },
  { number: 5, ownership: "workspace-owner", evidence: "queue build plus synchronous atomic callback build in commit tests" },
  { number: 6, ownership: "workspace-owner", evidence: "transaction-window source change and stale byte tests" },
  { number: 7, ownership: "workspace-owner", evidence: "unique rename relocation test" },
  { number: 8, ownership: "workspace-owner", evidence: "anonymous nonrelocation and ID-less legacy locator tests" },
  { number: 9, ownership: "workspace-owner", evidence: "duplicate collision and selected terminal repair test" },
  { number: 10, ownership: "workspace-owner", evidence: "same-file transaction counters and switch atomicity" },
  { number: 11, ownership: "workspace-owner", evidence: "Editor and Vault.process byte-equivalence contract" },
  { number: 12, ownership: "workspace-owner", evidence: "strict complete-source allowlist reconstruction" },
  { number: 13, ownership: "workspace-owner", evidence: "authoritative reread and global post-scan receipts" },
  { number: 14, ownership: "workspace-owner", evidence: "conflict receipts and exact zero-byte assertions" },
  { number: 15, ownership: "workspace-owner", evidence: "confirmation-read fault blocks later commits without retry" },
  { number: 16, ownership: "workspace-owner", evidence: "canonical LOGBOOK/CLOCK round-trip helpers and tests" },
  { number: 17, ownership: "workspace-owner", evidence: "Web Crypto UUIDv4 generation and vault collision lookup" },
  { number: 18, ownership: "workspace-owner", evidence: "same-target Clock In returns no-host already-applied" },
  { number: 19, ownership: "workspace-owner", evidence: "same-file and cross-file switch fault tests" },
  { number: 20, ownership: "workspace-owner", evidence: "MutationPlan shared transition instant validation" },
  { number: 21, ownership: "workspace-owner", evidence: "exact CLOCK close and backwards-end rejection" },
  { number: 22, ownership: "workspace-owner", evidence: "owned Complete and other-active-task preservation tests" },
  { number: 23, ownership: "workspace-owner", evidence: "progress below/equal/above 100 and reopen tests" },
  { number: 24, ownership: "workspace-owner", evidence: "same-target 2.5 second delete and attached-content tests" },
  { number: 25, ownership: "linked-contribution", evidence: "#26 owns Enable/Disable; writer exposes Clock Out plus confirmed empty receipt" },
  { number: 26, ownership: "linked-contribution", evidence: "#26 owns POMO ordering; authoritative CLOCK receipt is contributed" },
  { number: 27, ownership: "linked-contribution", evidence: "#26 owns plugin-data failure; Markdown receipts are non-rollback authority" },
  { number: 28, ownership: "linked-contribution", evidence: "#26 owns reload; writer persists no recovery journal" },
  { number: 29, ownership: "workspace-owner", evidence: "multiple and potential-running pre-host rejection tests" },
  { number: 30, ownership: "workspace-owner", evidence: "closed malformed versus potential-running parser/index contract" },
  { number: 31, ownership: "workspace-owner", evidence: "previewed repair operations and legacy fold/gap rejection" },
  { number: 32, ownership: "linked-contribution", evidence: "#26 owns stale-session lifecycle; no automatic writer action exists" },
  { number: 33, ownership: "linked-contribution", evidence: "#20 owns calendar clipping; canonical endpoints preserve instants" },
  { number: 34, ownership: "workspace-owner", evidence: "offset-bearing canonical and unresolved legacy DST tests" },
  { number: 35, ownership: "workspace-owner", evidence: "wall/monotonic discontinuity pre-host rejection test" },
  { number: 36, ownership: "linked-contribution", evidence: "#21 owns lifecycle/cache/refresh and #30 contributes hardening evidence; closed writer actions exclude them" },
  { number: 37, ownership: "workspace-owner", evidence: "index input-limit zero-transform test" },
  { number: 38, ownership: "workspace-owner", evidence: "Editor single-step and background/cross-file Undo receipt assertions" },
  { number: 39, ownership: "workspace-owner", evidence: "closed stable result codes and redacted safe-context test" },
  { number: 40, ownership: "linked-contribution", evidence: "#21 owns lifecycle and #26 owns mutation admission; #30 contributes hardening evidence and disposed commit blocks host entry" },
]);

const FIXTURE_BINDINGS: Readonly<Record<number, readonly string[]>> = Object.freeze({
  1: ["mutations.test.ts::single-target actions reject smuggled extra operations while empty global Clock Out is representable"],
  2: ["invariants.test.ts::closed writer actions contain no startup, tick, refresh, navigation, enable, POMO, or unload write"],
  3: ["protocol.test.ts::action-operation mismatch and non-shared switch instants are not admissible plans"],
  4: [
    "mutations.test.ts::Mutation Plans deep-clone and freeze nested operation facts",
    "protocol.test.ts::unsafe intent IDs are rejected before host entry with a safe authoritative receipt",
  ],
  5: ["protocol.test.ts::unrelated bytes may change inside the optimistic window and remain preserved"],
  6: ["commit.test.ts::transaction-window source change conflicts without overwriting the external bytes"],
  7: ["commit.test.ts::unique identity relocates after rename but anonymous targets never relocate"],
  8: ["commit.test.ts::unique identity relocates after rename but anonymous targets never relocate"],
  9: [
    "actions.test.ts::duplicate identities block ordinary writes while selected repair changes one terminal ID only",
    "actions.test.ts::selected duplicate CLOCK identity repair changes only one exact terminal ID",
  ],
  10: ["commit.test.ts::same-file switch is one transaction at one instant"],
  11: ["commit.test.ts::TC-OBS-SAFE-001-003 active Editor and Vault.process commits are byte-equivalent and authoritative"],
  12: ["mutations.test.ts::TC-OBS-SAFE-001-001 strict byte edits preserve every byte outside the allowlist"],
  13: ["protocol.test.ts::a vault change after the final post-scan invalidates success instead of publishing stale global facts"],
  14: ["actions.test.ts::backwards Clock Out is zero-byte while closed malformed history remains preserved and nonblocking"],
  15: ["commit.test.ts::manual fault injection classifies before-apply, apply-then-throw, and unreadable confirmation"],
  16: ["actions.test.ts::legacy folds and gaps are never guessed; explicit offsets normalize and close exact records"],
  17: ["invariants.test.ts::invariant 17 generates UUIDv4 IDs, retries vault collisions, and fails closed on exhaustion"],
  18: ["actions.test.ts::same-target Clock In and already-closed Clock Out are confirmed no-byte end states"],
  19: ["commit.test.ts::TC-OBS-SAFE-001-004 cross-file integration confirms close before open and never reopens after stage-B failure"],
  20: ["mutations.test.ts::switch plans require one shared transition instant and at most two ordered stages"],
  21: ["actions.test.ts::backwards Clock Out is zero-byte while closed malformed history remains preserved and nonblocking"],
  22: ["actions.test.ts::Complete atomically closes only the owned CLOCK, checks the box, removes Progress, and adds no anchor"],
  23: ["actions.test.ts::progress below, exactly, and above 100 plus reopen preserve the frozen v1 branches"],
  24: ["actions.test.ts::delete removes only the exact CLOCK physical line and rejects attached content with zero plugin bytes"],
  25: ["actions.test.ts::global idle Clock Out and confirmed absent Delete are authoritative no-host outcomes"],
  26: ["adapter-matrix.test.ts::adversarial Markdown actions are byte- and receipt-equivalent in memory and disposable vault adapters"],
  27: ["protocol.test.ts::receipt constructors reject false zero-change and false Undo claims"],
  28: ["invariants.test.ts::closed writer actions contain no startup, tick, refresh, navigation, enable, POMO, or unload write"],
  29: ["protocol.test.ts::multiple and potential running CLOCKs block before any host transform"],
  30: ["actions.test.ts::backwards Clock Out is zero-byte while closed malformed history remains preserved and nonblocking"],
  31: [
    "actions.test.ts::duplicate identities block ordinary writes while selected repair changes one terminal ID only",
    "actions.test.ts::selected DST fold normalizes end-to-end while a nonexistent local time remains non-writable",
  ],
  32: ["invariants.test.ts::closed writer actions contain no startup, tick, refresh, navigation, enable, POMO, or unload write"],
  33: ["actions.test.ts::selected DST fold normalizes end-to-end while a nonexistent local time remains non-writable"],
  34: ["actions.test.ts::legacy folds and gaps are never guessed; explicit offsets normalize and close exact records"],
  35: ["actions.test.ts::explicit discontinuity recovery validates measured rebase arithmetic and last-trusted stop"],
  36: ["invariants.test.ts::closed writer actions contain no startup, tick, refresh, navigation, enable, POMO, or unload write"],
  37: ["protocol.test.ts::over-limit and settings-version drift fail closed without sampling or writes"],
  38: ["commit.test.ts::production Obsidian adapter enters exactly one Editor transaction or Vault.process callback"],
  39: ["protocol.test.ts::all stable result codes expose only bounded redacted context"],
  40: ["protocol.test.ts::dispose blocks later commits and read-only recovery choice enters no host primitive"],
});

test("all 40 write invariants have explicit owner-safe evidence", () => {
  assert.deepEqual(WRITE_INVARIANT_EVIDENCE.map(({ number }) => number),
    Array.from({ length: 40 }, (_, index) => index + 1));
  assert.deepEqual(Object.keys(FIXTURE_BINDINGS).map(Number), Array.from({ length: 40 }, (_, index) => index + 1));
  for (const { number, evidence } of WRITE_INVARIANT_EVIDENCE) {
    assert.ok(evidence.length > 0, `invariant ${number} evidence`);
    assert.ok(FIXTURE_BINDINGS[number]?.length, `invariant ${number} fixture binding`);
    for (const fixture of FIXTURE_BINDINGS[number]!) {
      const separator = fixture.indexOf("::");
      assert.ok(separator > 0, fixture);
      const file = fixture.slice(0, separator);
      const testTitle = fixture.slice(separator + 2);
      assert.ok(file.endsWith(".test.ts"), fixture);
      const source = readFileSync(join(process.cwd(), "tests/workspace/write", file), "utf8");
      assert.ok(source.includes(`test(${JSON.stringify(testTitle)}`), fixture);
    }
  }
  assert.deepEqual(
    WRITE_INVARIANT_EVIDENCE.filter(({ ownership }) => ownership === "linked-contribution").map(({ number }) => number),
    [1, 2, 3, 4, 25, 26, 27, 28, 32, 33, 36, 40],
  );
});

test("closed writer actions contain no startup, tick, refresh, navigation, enable, POMO, or unload write", () => {
  const forbidden = ["startup", "tick", "refresh", "navigate", "enable", "pomo", "unload"];
  for (const word of forbidden) {
    assert.equal(MUTATION_ACTIONS.some((action) => action.includes(word)), false, word);
  }
});

test("invariant 17 generates UUIDv4 IDs, retries vault collisions, and fails closed on exhaustion", () => {
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
