import assert from "node:assert/strict";
import test from "node:test";

import {
  MutationQueue,
  MutationQueueCapacityError,
  MutationQueueStoppedError,
} from "../../../src/runtime/execution/mutation-queue";

test("one vault queue preserves FIFO order across asynchronous intents", async () => {
  const queue = new MutationQueue();
  const order: string[] = [];
  let releaseFirst!: () => void;
  const firstGate = new Promise<void>((resolve) => { releaseFirst = resolve; });
  const first = queue.enqueue("first", async () => {
    order.push("first:start");
    await firstGate;
    order.push("first:end");
  });
  const second = queue.enqueue("second", () => { order.push("second"); });
  await Promise.resolve();
  assert.deepEqual(order, ["first:start"]);
  releaseFirst();
  await Promise.all([first, second]);
  assert.deepEqual(order, ["first:start", "first:end", "second"]);
});

test("a failed intent is attempted once and does not retry", async () => {
  const queue = new MutationQueue();
  let attempts = 0;
  await assert.rejects(queue.enqueue("failure", () => {
    attempts += 1;
    throw new Error("failed");
  }), /failed/);
  assert.equal(attempts, 1);
});

test("a failed intent does not poison later FIFO work", async () => {
  const queue = new MutationQueue();
  const failed = queue.enqueue("failure", () => { throw new Error("failed"); });
  const next = queue.enqueue("next", () => 42);
  await assert.rejects(failed, /failed/);
  assert.equal(await next, 42);
});

test("stop rejects new intents and drains accepted work", async () => {
  const queue = new MutationQueue();
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  const accepted = queue.enqueue("accepted", () => gate);
  const stopped = queue.stop();
  await assert.rejects(queue.enqueue("late", () => undefined), MutationQueueStoppedError);
  release();
  await Promise.all([accepted, stopped]);
  assert.equal(queue.state, "stopped");
});

test("pendingCount includes active and queued work until settlement", async () => {
  const queue = new MutationQueue();
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  const first = queue.enqueue("first", () => gate);
  const second = queue.enqueue("second", () => undefined);
  assert.equal(queue.pendingCount, 2);
  release();
  await Promise.all([first, second]);
  await Promise.resolve();
  assert.equal(queue.pendingCount, 0);
});

test("the same intentId shares one attempt and one settled result", async () => {
  const queue = new MutationQueue();
  let attempts = 0;
  const first = queue.enqueue("same-activation", async () => {
    attempts += 1;
    return "confirmed";
  });
  const duplicate = queue.enqueue("same-activation", async () => {
    attempts += 1;
    return "duplicate";
  });
  assert.strictEqual(duplicate, first);
  assert.deepEqual(await Promise.all([first, duplicate]), ["confirmed", "confirmed"]);
  assert.equal(await queue.enqueue("same-activation", () => "late-duplicate"), "confirmed");
  assert.equal(attempts, 1);
});

test("intent tracking stays bounded while retaining the newest settled results", async () => {
  const queue = new MutationQueue(2);
  assert.equal(await queue.enqueue("first", () => "first"), "first");
  const second = queue.enqueue("second", () => "second");
  assert.equal(await second, "second");
  assert.equal(await queue.enqueue("third", () => "third"), "third");
  assert.strictEqual(queue.enqueue("third", () => "duplicate"), queue.enqueue("third", () => "duplicate"));
  assert.equal(await queue.enqueue("second", () => "second-again"), "second");
});

test("a settled intent releases capacity before its caller resumes", async () => {
  const queue = new MutationQueue(1);
  assert.equal(await queue.enqueue("first", () => "first"), "first");
  assert.equal(await queue.enqueue("second", () => "second"), "second");
});

test("the bounded queue rejects excess pending intents before attempting them", async () => {
  const queue = new MutationQueue(2);
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  const first = queue.enqueue("first", () => gate);
  const second = queue.enqueue("second", () => undefined);
  await assert.rejects(queue.enqueue("over-limit", () => undefined), MutationQueueCapacityError);
  release();
  await Promise.all([first, second]);
});
