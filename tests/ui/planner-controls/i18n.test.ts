import assert from "node:assert/strict";
import test from "node:test";

import { enPlanner } from "../../../src/i18n/locales/en/planner.ts";
import { enShared } from "../../../src/i18n/locales/en/shared.ts";
import { zhCNPlanner } from "../../../src/i18n/locales/zh-CN/planner.ts";
import { zhCNShared } from "../../../src/i18n/locales/zh-CN/shared.ts";
import {
  MessageContractError,
  createMessages,
  defineLocaleNamespace,
} from "../../../src/i18n/resolver.ts";
import type { PlannerLimitKind } from "../../../src/i18n/types.ts";

test("TC-OBS-I18N-001-001 en and zh-CN shared/planner key sets are exactly equal", () => {
  assert.deepEqual(Object.keys(enShared).sort(), Object.keys(zhCNShared).sort());
  assert.deepEqual(Object.keys(enPlanner).sort(), Object.keys(zhCNPlanner).sort());
});

test("TC-OBS-I18N-001-001 resolver keeps interpolation typed and falls back to English locale", () => {
  const messages = createMessages({ locale: "fr-FR" });
  assert.equal(messages.locale, "en");
  assert.equal(messages.t("shared", "unit.itemCount", { count: 2 }), "2 items");
  assert.equal(
    messages.t("planner", "announcement.progressRequested", { title: "Draft", percent: 20 }),
    "Draft progress requested at 20%.",
  );
  messages.setLocale("zh_Hans_CN");
  assert.equal(messages.locale, "zh-CN");
  assert.equal(messages.t("shared", "unit.itemCount", { count: 2 }), "2项");
});

test("TC-OBS-I18N-001-001 locale changes notify rerender subscribers without domain input", () => {
  const messages = createMessages();
  const locales: string[] = [];
  const unsubscribe = messages.subscribe((locale) => locales.push(locale));
  assert.equal(messages.setLocale("zh-CN"), true);
  assert.equal(messages.setLocale("zh-CN"), false);
  assert.equal(messages.setLocale("en-US"), true);
  unsubscribe();
  messages.setLocale("zh-CN");
  assert.deepEqual(locales, ["zh-CN", "en"]);
});

test("TC-OBS-I18N-001-001 every over-limit kind is localized without leaking internal keys", () => {
  const kinds: readonly PlannerLimitKind[] = [
    "active-note-bytes",
    "list-depth",
    "plan-item-bytes",
    "plan-items",
    "plan-region-bytes",
  ];
  const messages = createMessages();
  const english = kinds.map((kind) => messages.t("planner", "status.overLimitDetail", {
    actual: 11,
    kind,
    limit: 10,
  }));
  messages.setLocale("zh-CN");
  const chinese = kinds.map((kind) => messages.t("planner", "status.overLimitDetail", {
    actual: 11,
    kind,
    limit: 10,
  }));
  assert.equal(new Set(english).size, kinds.length);
  assert.equal(new Set(chinese).size, kinds.length);
  for (const [index, kind] of kinds.entries()) {
    assert.equal(chinese[index]!.includes(kind), false);
  }
});

test("TC-OBS-I18N-001-001 later equal execution/review namespaces register without changing base catalogs", () => {
  const execution = defineLocaleNamespace(
    "execution",
    Object.freeze({ "action.start": "Start" }),
    Object.freeze({ "action.start": "开始" }),
  );
  const review = defineLocaleNamespace(
    "review",
    Object.freeze({ "state.compared": ({ count }: { readonly count: number }) => `${count} compared` }),
    Object.freeze({ "state.compared": ({ count }: { readonly count: number }) => `已对比${count}项` }),
  );
  const messages = createMessages({ namespaces: { execution, review } });
  assert.equal(messages.t("execution", "action.start"), "Start");
  assert.equal(messages.t("review", "state.compared", { count: 3 }), "3 compared");
  messages.setLocale("zh-CN");
  assert.equal(messages.t("execution", "action.start"), "开始");
  assert.equal(messages.t("review", "state.compared", { count: 3 }), "已对比3项");
  assert.deepEqual(Object.keys(enPlanner).sort(), Object.keys(zhCNPlanner).sort());
});

test("TC-OBS-I18N-001-001 unequal later namespace keys fail closed", () => {
  const english = Object.freeze({ a: "A" });
  const chinese = Object.freeze({ b: "乙" }) as unknown as typeof english;
  assert.throws(
    () => defineLocaleNamespace("execution", english, chinese),
    MessageContractError,
  );
});

test("TC-OBS-I18N-001-001 later registration cannot replace core catalogs", () => {
  const replacement = defineLocaleNamespace(
    "planner-replacement",
    Object.freeze({ key: "replacement" }),
    Object.freeze({ key: "替换" }),
  );
  assert.throws(
    () => createMessages({ namespaces: { planner: replacement } }),
    /core message namespace cannot be replaced/,
  );
  assert.throws(
    () => defineLocaleNamespace(" ", Object.freeze({ key: "A" }), Object.freeze({ key: "甲" })),
    /must not be empty/,
  );
});

test("TC-OBS-I18N-001-001 registered catalogs are immutable snapshots", () => {
  const english: Record<string, string> = { state: "Ready" };
  const chinese: Record<string, string> = { state: "就绪" };
  const later = defineLocaleNamespace("later", english, chinese);
  english.state = "Mutated";
  delete chinese.state;
  const messages = createMessages({ namespaces: { later } });
  assert.equal(messages.t("later", "state"), "Ready");
  messages.setLocale("zh-CN");
  assert.equal(messages.t("later", "state"), "就绪");
});

test("TC-OBS-I18N-001-002 zero-argument message functions match their callable type", () => {
  const execution = defineLocaleNamespace(
    "execution",
    Object.freeze({ "status.ready": () => "Ready" }),
    Object.freeze({ "status.ready": () => "就绪" }),
  );
  const messages = createMessages({ namespaces: { execution } });
  assert.equal(messages.t("execution", "status.ready"), "Ready");
  messages.setLocale("zh-CN");
  assert.equal(messages.t("execution", "status.ready"), "就绪");
});

test("TC-OBS-I18N-001-002 defaulted message parameters still receive supplied interpolation", () => {
  const execution = defineLocaleNamespace(
    "execution",
    Object.freeze({
      "status.named": ({ name }: { readonly name: string } = { name: "fallback" }) => name,
    }),
    Object.freeze({
      "status.named": ({ name }: { readonly name: string } = { name: "后备" }) => name,
    }),
  );
  const messages = createMessages({ namespaces: { execution } });
  assert.equal(messages.t("execution", "status.named", { name: "Ada" }), "Ada");
  assert.equal(messages.t("execution", "status.named"), "fallback");
});

test("TC-OBS-I18N-001-002 callable dispatch follows typed arguments rather than Function.length", () => {
  const execution = defineLocaleNamespace(
    "execution",
    Object.freeze({
      "status.defaulted": ({ name }: { readonly name: string } = { name: "fallback" }) => name,
      "status.optional": (parameters?: { readonly name: string }) => parameters?.name ?? "missing",
      "status.required": ({ name }: { readonly name: string }) => name,
      "status.zero": () => "zero",
    }),
    Object.freeze({
      "status.defaulted": ({ name }: { readonly name: string } = { name: "后备" }) => name,
      "status.optional": (parameters?: { readonly name: string }) => parameters?.name ?? "缺失",
      "status.required": ({ name }: { readonly name: string }) => name,
      "status.zero": () => "零",
    }),
  );
  const messages = createMessages({ namespaces: { execution } });
  assert.equal(messages.t("execution", "status.zero"), "zero");
  assert.equal(messages.t("execution", "status.required", { name: "Ada" }), "Ada");
  assert.equal(messages.t("execution", "status.defaulted"), "fallback");
  assert.equal(messages.t("execution", "status.defaulted", { name: "Grace" }), "Grace");
  assert.equal(messages.t("execution", "status.optional"), "missing");
  assert.equal(messages.t("execution", "status.optional", { name: "Lin" }), "Lin");
});
