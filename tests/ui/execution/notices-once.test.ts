import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("failed Insert and rejected enable do not add a second generic notice", async () => {
  const main = await readFile("src/main.ts", "utf8");
  assert.match(main, /class ExecutionActivationRejected extends Error/);
  assert.match(main, /throw new ExecutionActivationRejected/);
  assert.match(main, /if \(error instanceof ExecutionActivationRejected\) console\.error/);
  assert.match(main, /status\.missingInsertFailed/);
  const insertCatch = main.slice(main.indexOf("status.missingInsertFailed"));
  assert.equal(insertCatch.slice(0, 280).includes("#reportError"), false);
});
