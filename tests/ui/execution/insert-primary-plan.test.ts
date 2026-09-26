import assert from "node:assert/strict";
import test from "node:test";
import { EditorState } from "@codemirror/state";
import { TFile } from "obsidian";

import {
  insertPrimaryPlan,
  insertPrimaryPlanNoticeKey,
  type InsertPrimaryPlanDependencies,
} from "../../../src/adapters/insert-primary-plan";
import { primaryPlanSeed } from "../../../src/workspace/insert-primary-plan";

type Route = "create" | "editor" | "vault";
type Fault = "no-op" | "divergent" | "write-then-throw" | "read-failure" | "change-on-open";

const PATH = "2026-08-29.md";
const SOURCE = "\uFEFF---\r\naliases: [Journal]\r\n---\r\n# Journal\r\nKeep [[link|alias]] #tag  \r\n";
const EDITOR_SOURCE = SOURCE.replace(/\r\n?/g, "\n");

function insertionHost(route: Route, source = SOURCE, fault?: Fault) {
  const file = Object.assign(Object.create(TFile.prototype), { path: PATH, extension: "md" }) as TFile;
  const state = {
    vaultText: route === "create" ? undefined : route === "editor" ? "# Saved journal\n" : source,
    editorText: EditorState.create({ doc: source }).doc.toString(),
    editorLoaded: route === "editor",
    attempts: { create: 0, editor: 0, vault: 0 },
    vaultReads: 0,
    editorReads: 0,
  };
  function apply(text: string, target: "vaultText" | "editorText") {
    if (fault !== "no-op") {
      state[target] = fault === "divergent" ? `${text}Concurrent addition\n` : text;
    }
    if (fault === "write-then-throw") throw new Error("write applied before rejection");
  }
  const editor = {
    getValue() {
      state.editorReads += 1;
      if (fault === "read-failure" && state.attempts.editor > 0) throw new Error("editor read failed");
      return state.editorText;
    },
    setValue(text: string) {
      state.attempts.editor += 1;
      apply(EditorState.create({ doc: text }).doc.toString(), "editorText");
    },
  };
  const leaf = {
    async openFile() {
      if (fault === "change-on-open") {
        state[route === "editor" ? "editorText" : "vaultText"] = "# Concurrent replacement\n";
      }
      if (!state.editorLoaded) {
        state.editorText = EditorState.create({ doc: state.vaultText ?? "" }).doc.toString();
        state.editorLoaded = true;
      }
    },
  };
  const app = {
    vault: {
      getAbstractFileByPath: () => state.vaultText === undefined ? null : file,
      async create(path: string, text: string) {
        assert.equal(path, PATH);
        state.attempts.create += 1;
        apply(text, "vaultText");
        return file;
      },
      async process(target: TFile, transform: (text: string) => string) {
        assert.equal(target, file);
        state.attempts.vault += 1;
        const text = transform(state.vaultText!);
        apply(text, "vaultText");
        return text;
      },
      async read(target: TFile) {
        assert.equal(target, file);
        state.vaultReads += 1;
        if (fault === "read-failure" || state.vaultText === undefined) throw new Error("vault read failed");
        return state.vaultText;
      },
    },
    workspace: {
      getLeaf: () => leaf,
      async revealLeaf() {},
      setActiveLeaf() {},
    },
  };
  const dependencies: InsertPrimaryPlanDependencies = {
    app: app as never,
    locale: () => "en",
    today: () => ({ year: 2026, month: 8, day: 29 }),
    configuration: () => ({ folder: "", format: "YYYY-MM-DD" }),
    editorForPath: (path) => {
      assert.equal(path, PATH);
      return state.editorLoaded ? editor : undefined;
    },
  };
  return { app, dependencies, editor, file, leaf, state };
}

function assertSingleAttempt(host: ReturnType<typeof insertionHost>, route: Route) {
  assert.deepEqual(host.state.attempts, {
    create: route === "create" ? 1 : 0,
    editor: route === "editor" ? 1 : 0,
    vault: route === "vault" ? 1 : 0,
  });
}

for (const route of ["create", "editor", "vault"] as const) {
  test(`plan insertion confirms ${route} source before returning success`, async () => {
    const host = insertionHost(route);
    const outcome = await insertPrimaryPlan(host.dependencies);
    assert.deepEqual(outcome, { kind: route === "create" ? "created" : "appended", path: PATH });
    assert.equal(insertPrimaryPlanNoticeKey(outcome), "status.missingInserted");
    assert.equal(
      route === "editor" ? host.state.editorText : host.state.vaultText,
      route === "create" ? primaryPlanSeed() : `${route === "editor" ? EDITOR_SOURCE : SOURCE}\n${primaryPlanSeed()}`,
    );
    assertSingleAttempt(host, route);
    if (route === "editor") {
      assert.equal(host.state.editorReads, 2);
      assert.equal(host.state.vaultReads, 0);
      assert.equal(host.state.vaultText, "# Saved journal\n");
    } else {
      assert.equal(host.state.vaultReads, 1);
    }
  });

  for (const fault of ["no-op", "divergent", "write-then-throw", "read-failure", "change-on-open"] as const) {
    test(`plan insertion reports failure without retry for ${route} ${fault}`, async () => {
      const host = insertionHost(route, SOURCE, fault);
      const notice = await insertPrimaryPlan(host.dependencies).then(
        insertPrimaryPlanNoticeKey,
        () => "status.missingInsertFailed",
      );
      assert.equal(notice, "status.missingInsertFailed");
      assertSingleAttempt(host, route);
      const actual = route === "editor" ? host.state.editorText : host.state.vaultText;
      const source = route === "editor" ? EDITOR_SOURCE : SOURCE;
      const expected = route === "create" ? primaryPlanSeed() : `${source}\n${primaryPlanSeed()}`;
      if (fault === "no-op") assert.equal(actual, route === "create" ? undefined : source);
      if (fault === "divergent") assert.equal(actual, `${expected}Concurrent addition\n`);
      if (fault === "change-on-open") assert.equal(actual, "# Concurrent replacement\n");
      if (fault === "write-then-throw" || fault === "read-failure") assert.equal(actual, expected);
    });
  }
}

for (const route of ["editor", "vault"] as const) {
  for (const [name, source, outcome] of [
    ["existing region", `${SOURCE}\n${primaryPlanSeed()}`, { kind: "already-present", path: PATH }],
    ["unclosed region", `${SOURCE}\n<!-- nautilus-log:plan/v1 -->\n- [ ] Unclosed`, { kind: "blocked", reason: "malformed-region" }],
    ["nested region", `${SOURCE}\n<!-- nautilus-log:plan/v1 -->\n${primaryPlanSeed()}<!-- /nautilus-log:plan -->\n`, { kind: "blocked", reason: "malformed-region" }],
  ] as const) {
    test(`plan insertion preserves ${route} ${name} source`, async () => {
      const host = insertionHost(route, source);
      assert.deepEqual(await insertPrimaryPlan(host.dependencies), outcome);
      assert.equal(route === "editor" ? host.state.editorText : host.state.vaultText,
        route === "editor" ? source.replace(/\r\n?/g, "\n") : source);
      assert.equal(host.state.attempts.editor, 0);
      assert.equal(host.state.attempts.create, 0);
      assert.equal(host.state.attempts.vault, route === "vault" ? 1 : 0);
    });
  }

  test(`plan insertion confirms an empty ${route} source`, async () => {
    const host = insertionHost(route, "");
    assert.deepEqual(await insertPrimaryPlan(host.dependencies), { kind: "created", path: PATH });
    assert.equal(route === "editor" ? host.state.editorText : host.state.vaultText, primaryPlanSeed());
    assertSingleAttempt(host, route);
  });
}

test("plan insertion fails if Vault.process never runs its transform", async () => {
  const host = insertionHost("vault");
  host.app.vault.process = async () => {
    host.state.attempts.vault += 1;
    return `${SOURCE}\n${primaryPlanSeed()}`;
  };
  await assert.rejects(insertPrimaryPlan(host.dependencies), /transform did not run/);
  assert.equal(host.state.vaultText, SOURCE);
  assertSingleAttempt(host, "vault");
});

test("plan insertion fails if Vault.process returns divergent text", async () => {
  const host = insertionHost("vault");
  const process = host.app.vault.process;
  host.app.vault.process = async (...args) => {
    await process(...args);
    return SOURCE;
  };
  await assert.rejects(insertPrimaryPlan(host.dependencies), /unexpected text/);
  assert.equal(host.state.vaultText, `${SOURCE}\n${primaryPlanSeed()}`);
  assertSingleAttempt(host, "vault");
});

for (const [name, eol] of [["LF", "\n"], ["CRLF", "\r\n"], ["CR", "\r"]] as const) {
  test(`plan insertion confirms ${name} vault bytes after loading an LF editor`, async () => {
    const source = `# Journal${eol}Keep [[link|alias]] #tag  ${eol}`;
    const host = insertionHost("vault", source);
    assert.deepEqual(await insertPrimaryPlan(host.dependencies), { kind: "appended", path: PATH });
    const expected = `${source}${eol === "\r" ? "\n\n" : "\n"}${primaryPlanSeed()}`;
    assert.equal(host.state.vaultText, expected);
    assert.equal(host.state.editorText, expected.replace(/\r\n?/g, "\n"));
    assert.equal(host.state.vaultReads, 1);
    assert.equal(host.state.editorReads, 0);
    assertSingleAttempt(host, "vault");
  });
}

for (const route of ["create", "vault"] as const) {
  test(`plan insertion detects divergent vault bytes despite a matching editor after ${route}`, async () => {
    const host = insertionHost(route, SOURCE, "divergent");
    const expected = route === "create" ? primaryPlanSeed() : `${SOURCE}\n${primaryPlanSeed()}`;
    host.leaf.openFile = async () => {
      host.state.editorLoaded = true;
      host.state.editorText = expected.replace(/\r\n?/g, "\n");
    };
    await assert.rejects(insertPrimaryPlan(host.dependencies), /could not be confirmed/);
    assert.equal(host.state.vaultText, `${expected}Concurrent addition\n`);
    assert.equal(host.state.vaultReads, 1);
    assert.equal(host.state.editorReads, 0);
    assertSingleAttempt(host, route);
  });
}

test("plan insertion confirms vault bytes when an editor cannot write", async () => {
  const host = insertionHost("vault");
  const outcome = await insertPrimaryPlan({
    ...host.dependencies,
    editorForPath: () => ({ getValue: host.editor.getValue }),
  });
  assert.deepEqual(outcome, { kind: "appended", path: PATH });
  assert.equal(host.state.vaultText, `${SOURCE}\n${primaryPlanSeed()}`);
  assert.equal(host.state.vaultReads, 1);
  assert.equal(host.state.editorReads, 0);
  assertSingleAttempt(host, "vault");
});

test("plan insertion confirms the editor that performed the write", async () => {
  const host = insertionHost("editor");
  let opened = false;
  host.leaf.openFile = async () => { opened = true; };
  const outcome = await insertPrimaryPlan({
    ...host.dependencies,
    editorForPath: () => opened ? { getValue: () => "# Other editor\n" } : host.editor,
  });
  assert.deepEqual(outcome, { kind: "appended", path: PATH });
  assert.equal(host.state.editorText, `${EDITOR_SOURCE}\n${primaryPlanSeed()}`);
  assert.equal(host.state.vaultText, "# Saved journal\n");
  assert.equal(host.state.vaultReads, 0);
  assertSingleAttempt(host, "editor");
});

test("plan insertion confirms a Vault.process write", async () => {
  const host = insertionHost("vault", "# Journal\n", "no-op");
  await assert.rejects(insertPrimaryPlan(host.dependencies), /could not be confirmed/);
  assertSingleAttempt(host, "vault");
  assert.equal(host.state.vaultText, "# Journal\n");
});
