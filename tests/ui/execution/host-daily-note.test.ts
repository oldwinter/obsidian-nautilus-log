import assert from "node:assert/strict";
import test from "node:test";

import { readHostDailyNoteConfiguration } from "../../../src/adapters/host-daily-note";

test("host Daily Note config reads folder and format from daily-notes.json", async () => {
  const files = new Map<string, string>([
    [".obsidian/daily-notes.json", JSON.stringify({ folder: "Daily", format: "YYYY-MM-DD", template: "ignore" })],
  ]);
  const app = {
    vault: {
      configDir: ".obsidian",
      adapter: {
        async exists(path: string) {
          return files.has(path);
        },
        async read(path: string) {
          const value = files.get(path);
          if (value === undefined) throw new Error(`missing ${path}`);
          return value;
        },
      },
    },
  };
  assert.deepEqual(await readHostDailyNoteConfiguration(app), {
    folder: "Daily",
    format: "YYYY-MM-DD",
  });
  files.delete(".obsidian/daily-notes.json");
  assert.equal(await readHostDailyNoteConfiguration(app), undefined);
});
