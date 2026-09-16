import assert from "node:assert/strict";
import test from "node:test";

import { readHostLanguage } from "../../../src/adapters/host-language";

test("host language prefers the official reader, then Obsidian storage, then English", () => {
  assert.equal(readHostLanguage(() => "zh-CN"), "zh-CN");
  assert.equal(readHostLanguage(() => {
    throw new Error("missing getLanguage");
  }), "en");
  const original = globalThis.localStorage;
  const store = new Map<string, string>([["language", "zh"]]);
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: {
      getItem(key: string) {
        return store.get(key) ?? null;
      },
    },
  });
  try {
    assert.equal(readHostLanguage(), "zh");
  } finally {
    if (original === undefined) delete (globalThis as { localStorage?: Storage }).localStorage;
    else {
      Object.defineProperty(globalThis, "localStorage", {
        configurable: true,
        value: original,
      });
    }
  }
});
