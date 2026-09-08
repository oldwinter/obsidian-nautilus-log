import { createHash } from "node:crypto";
import { readdir, readFile, lstat } from "node:fs/promises";
import { join } from "node:path";
import { DEFAULT_PLUGIN_DATA, DEFAULT_PLUGIN_SETTINGS, validatePluginData } from "../../src/runtime/plugin-data.ts";

function installObservers({ phase }) {
  if (window !== top) return;
  const key = "__spiralDayHostPrivacy";
  const state = globalThis[key] ??= { id: crypto.randomUUID(), covered: new Set(), restores: [], pending: [], deferred: [], keys: new Set() };
  const deliver = (event) => {
    if (typeof globalThis.__spiralDayPrivacyRecord !== "function") state.deferred.push(event);
    else state.pending.push(globalThis.__spiralDayPrivacyRecord(event).catch(() => {}));
  };
  const emit = (event) => deliver({ documentId: state.id, phase, ...event });
  if (typeof globalThis.__spiralDayPrivacyRecord === "function") state.deferred.splice(0).forEach(deliver);
  let positiveControl = false;
  let obsidian;
  try { obsidian = require("obsidian"); } catch {}
  const targets = [
    [obsidian, "request", "obsidian.request"], [obsidian, "requestUrl", "obsidian.requestUrl"],
    [globalThis, "fetch", "fetch"], [XMLHttpRequest.prototype, "open", "XMLHttpRequest.open"],
    [XMLHttpRequest.prototype, "send", "XMLHttpRequest.send"], [globalThis, "WebSocket", "WebSocket"],
    [globalThis, "EventSource", "EventSource"], [navigator, "sendBeacon", "sendBeacon"],
    [Storage.prototype, "setItem", "Storage.setItem"],
  ];
  for (const [owner, property, api] of targets) {
    if (state.covered.has(api)) continue;
    try {
      const original = owner?.[property];
      if (typeof original !== "function") throw new Error("API not available at this observation phase");
      const descriptor = Object.getOwnPropertyDescriptor(owner, property);
      const observe = (receiver, args) => {
        const stack = new Error().stack ?? "";
        const pluginAttributed = /plugin:spiral-day(?:[/:]|\b)|\/plugins\/spiral-day\//.test(stack);
        const storage = api === "Storage.setItem" && pluginAttributed && !positiveControl
          ? { area: receiver === localStorage ? "localStorage" : receiver === sessionStorage ? "sessionStorage" : "other",
            key: String(args[0]), value: String(args[1]) } : undefined;
        if (storage) state.keys.add(storage.key);
        emit({ kind: "call", api, positiveControl, pluginAttributed, ...(pluginAttributed ? { stack } : {}), ...(storage ? { storage } : {}) });
        if (positiveControl) throw new Error("Privacy positive control blocked before original API");
      };
      const wrapped = new Proxy(original, {
        apply(target, receiver, args) { observe(receiver, args); return Reflect.apply(target, receiver, args); },
        construct(target, args, newTarget) { observe(undefined, args); return Reflect.construct(target, args, newTarget); },
      });
      Object.defineProperty(owner, property, { configurable: descriptor?.configurable ?? true,
        enumerable: descriptor?.enumerable ?? true, writable: descriptor && "writable" in descriptor ? descriptor.writable : true,
        value: wrapped });
      if (owner[property] !== wrapped) throw new Error("API replacement did not take effect");
      state.covered.add(api);
      state.restores.push(() => {
        if (owner[property] !== wrapped) return { api, restored: false, reason: "API changed after observer installation" };
        if (descriptor) Object.defineProperty(owner, property, descriptor);
        else delete owner[property];
        return { api, restored: owner[property] === original };
      });
      emit({ kind: "coverage", api, covered: true });
      positiveControl = true;
      try {
        Function("invoke", "return invoke();\n//# sourceURL=plugin:spiral-day/privacy-positive-control")(() => {
          const args = api === "XMLHttpRequest.open" ? ["GET", "https://spiral-day-privacy-probe.invalid/"]
            : ["https://spiral-day-privacy-probe.invalid/", "synthetic probe"];
          if (["WebSocket", "EventSource"].includes(api)) Reflect.construct(owner[property], args);
          else Reflect.apply(owner[property], owner, args);
        });
      } catch (error) {
        emit({ kind: "positive-control", api, blocked: error.message === "Privacy positive control blocked before original API" });
      } finally { positiveControl = false; }
    } catch (error) { emit({ kind: "coverage", api, covered: false, reason: error.message }); }
  }
  state.finish = async () => {
    const storage = {};
    for (const [area, store] of [["localStorage", localStorage], ["sessionStorage", sessionStorage]]) {
      storage[area] = Object.fromEntries(Object.keys(store).filter((name) => name.startsWith("spiral-day:") || state.keys.has(name))
        .map((name) => [name, store.getItem(name)]));
    }
    const restoration = state.restores.reverse().map((restore) => restore());
    await Promise.all(state.pending);
    delete globalThis[key];
    return { storage, restoration };
  };
}

export async function beginHostPrivacy(page) {
  const records = [];
  const pending = [];
  await page.exposeBinding("__spiralDayPrivacyRecord", (_source, event) => records.push(event));
  const onDocument = () => pending.push(page.evaluate(installObservers, { phase: "after-reload-domcontentloaded" })
    .catch((error) => records.push({ kind: "gap", reason: error.message })));
  const onPage = () => records.push({ kind: "gap", reason: "An additional host page is outside the primary-page API observer" });
  page.on("domcontentloaded", onDocument);
  page.context().on("page", onPage);
  await page.addInitScript(installObservers, { phase: "reload-document-start" });
  await page.evaluate(installObservers, { phase: "before-plugin-enable" });
  return { page, records, pending, onDocument, onPage };
}

export async function finishHostPrivacy(handle, { pluginDirectory, sentinels }) {
  const { page, records, pending, onDocument, onPage } = handle;
  page.off("domcontentloaded", onDocument);
  page.context().off("page", onPage);
  await Promise.allSettled(pending);
  const current = await page.evaluate(async () => globalThis.__spiralDayHostPrivacy
    ? await globalThis.__spiralDayHostPrivacy.finish() : { storage: {}, restoration: [], uncovered: "Observer absent in current document" });
  const files = [];
  let inspectedEntries = 0;
  const uncovered = records.filter((event) => event.kind === "gap" || (event.kind === "coverage" && !event.covered));
  if (current.uncovered) uncovered.push({ reason: current.uncovered });
  async function collect(directory, prefix = "") {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      if (++inspectedEntries > 100) throw new Error("Disposable plugin persistence exceeded the 100-entry inspection bound");
      const path = `${prefix}${entry.name}`;
      if (["main.js", "manifest.json", "styles.css"].includes(path)) continue;
      if (entry.isSymbolicLink()) { uncovered.push({ path, reason: "Owned symlink was not followed" }); continue; }
      if (entry.isDirectory()) { await collect(join(directory, entry.name), `${path}/`); continue; }
      if (!entry.isFile()) { uncovered.push({ path, reason: "Owned non-file entry was not read" }); continue; }
      if ((await lstat(join(directory, entry.name))).size > 2_000_000) {
        uncovered.push({ path, reason: "Owned file exceeded the 2 MB inspection bound" }); continue;
      }
      const bytes = await readFile(join(directory, entry.name));
      files.push({ path, bytes: bytes.length, sha256: createHash("sha256").update(bytes).digest("hex"),
        sentinelMatches: sentinels.filter((sentinel) => bytes.includes(Buffer.from(sentinel))) });
    }
  }
  await collect(pluginDirectory);
  if (!files.some((file) => file.path === "data.json")) throw new Error("Plugin data.json was not a covered regular file");
  const data = JSON.parse(await readFile(join(pluginDirectory, "data.json"), "utf8"));
  const validation = validatePluginData(data);
  const ownedStorageWrites = records.filter((event) => event.storage).map((event) => event.storage);
  const covered = records.filter((event) => event.kind === "coverage" && event.covered);
  const calls = records.filter((event) => event.kind === "call" && !event.positiveControl);
  const positiveControls = records.filter((event) => event.positiveControl || event.kind === "positive-control");
  const assertions = [
    { id: "privacy-positive-controls-observe-and-block", passed: covered.length > 0 && covered.every((coverage) =>
      positiveControls.some((event) => event.documentId === coverage.documentId && event.api === coverage.api && event.blocked)
      && positiveControls.some((event) => event.documentId === coverage.documentId && event.api === coverage.api && event.pluginAttributed)), observed: positiveControls },
    { id: "privacy-no-plugin-calls-through-observed-network-apis", passed: !calls.some((event) => event.api !== "Storage.setItem" && event.pluginAttributed), observed: calls.filter((event) => event.pluginAttributed) },
    { id: "privacy-plugin-data-valid-contract", passed: data?.schemaVersion === DEFAULT_PLUGIN_DATA.schemaVersion
      && validation.diagnostics.length === 0, observed: validation.diagnostics },
    { id: "privacy-no-note-sentinels-in-owned-persistence", passed: files.every((file) => file.sentinelMatches.length === 0)
      && sentinels.every((sentinel) => !JSON.stringify([current.storage, ownedStorageWrites]).includes(sentinel)), observed: { files, storage: current.storage, ownedStorageWrites } },
    { id: "privacy-current-document-wrappers-restored", passed: current.restoration.length > 0 && current.restoration.every((item) => item.restored), observed: current.restoration },
  ];
  return { status: assertions.every((result) => result.passed) ? "observed-checks-passed" : "failed", assertions,
    coverage: covered, uncovered, calls, positiveControls, persistence: { data, files, ...current,
      allowedDataFields: Object.keys(DEFAULT_PLUGIN_DATA), allowedSettingsFields: Object.keys(DEFAULT_PLUGIN_SETTINGS) },
    limitations: ["Primary renderer only. Workers, other windows, cached pre-observer references, IPC and Node networking remain outside these wrappers.",
      "Unavailable or nonwrappable public exports are uncovered. After reload, Obsidian calls before the public module becomes available are uncovered.",
      "Only labeled positive controls are blocked. Real calls pass through. CDP and process NetLog remain independent evidence.",
      "Persistence inspection covers this disposable plugin directory and named or attributed Web Storage. It does not certify all host storage or the full fixture contract."],
  };
}
