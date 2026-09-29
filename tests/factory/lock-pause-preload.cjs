// Test preload: blocks inside the writeFileSync call for the factory lock's
// owner.json — i.e. the process is held exactly in the initialization window
// between `mkdir run.lock/` and the payload write — until the test drops a
// release file. This gives the harness a deterministic mid-init owner
// (dir exists, owner.json absent), reproducing the coordinator's scheduling
// case without relying on signal timing.
const fs = require("node:fs");

const pauseFlag = process.env.FACTORY_TEST_PAUSE_FLAG;
if (pauseFlag) {
  const original = fs.writeFileSync;
  fs.writeFileSync = function patchedWriteFileSync(file, ...args) {
    if (String(file).endsWith("owner.json") && !fs.existsSync(`${pauseFlag}.release`)) {
      try {
        original.call(this, pauseFlag, String(process.pid));
      } catch {
        // best effort: the flag only informs the test harness
      }
      const release = `${pauseFlag}.release`;
      const deadline = Date.now() + 60000;
      const spin = new Int32Array(new SharedArrayBuffer(4));
      while (!fs.existsSync(release) && Date.now() < deadline) {
        Atomics.wait(spin, 0, 0, 10);
      }
    }
    return original.call(this, file, ...args);
  };
}
