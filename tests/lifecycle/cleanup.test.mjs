import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { setTimeout as delay } from "node:timers/promises";
import test from "node:test";
import { finalizeOwnedHost } from "./cleanup.mjs";

for (const code of ["EACCES", "ENOSPC"]) {
  test(`${code} evidence failure still reaps the owned child and clears its deadline`, { timeout: 5000 }, async () => {
    const child = spawn(process.execPath, ["-e", "process.on('SIGTERM', () => {}); process.stdout.write('ready'); setInterval(() => {}, 1000);"],
      { stdio: ["ignore", "pipe", "pipe"] });
    let childExit;
    const exitPromise = once(child, "exit").then(([exitCode, signal]) => { childExit = { exitCode, signal }; });
    let deadlineFired = false;
    let browserCloseAttempted = false;
    const injected = Object.assign(new Error(`${code}: cannot write evidence/privacy.json`), { code });
    let deadline;
    try {
      await once(child.stdout, "data");
      deadline = setTimeout(() => { deadlineFired = true; }, 150);
      const errors = await finalizeOwnedHost({
        beforeClose: async () => { throw injected; },
        browser: { close() {
          browserCloseAttempted = true;
          if (code === "EACCES") throw new Error("Injected browser close failure");
          return new Promise(() => {});
        } },
        child, childExited: () => Boolean(childExit), exitPromise, deadline,
        browserTimeout: 10, terminateTimeout: 10, killTimeout: 1000,
      });
      assert.equal(errors[0].error, injected, "preserve the evidence failure object and code");
      assert.equal(errors[1].phase, "browser-close");
      assert.equal(browserCloseAttempted, true);
      assert.deepEqual(childExit, { exitCode: null, signal: "SIGKILL" });
      assert.throws(() => process.kill(child.pid, 0), { code: "ESRCH" });
      await delay(175);
      assert.equal(deadlineFired, false, "the original deadline cannot fire after cleanup");
    } finally {
      clearTimeout(deadline);
      if (!childExit) { child.kill("SIGKILL"); await exitPromise; }
    }
  });
}
