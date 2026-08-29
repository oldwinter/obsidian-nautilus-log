import assert from "node:assert/strict";
import test from "node:test";

import {
  createPlannerViewFactory,
  type PlannerItemViewDependencies,
} from "../../../src/adapters/planner-view.ts";
import type { PlannerProgressIntent } from "../../../src/ui/planner/controls.ts";

interface CapturedMount {
  readonly options: {
    readonly collapseStore: {
      load(instanceId: string): boolean | undefined;
      save(instanceId: string, collapsed: boolean): void;
    };
    readonly instanceId: string;
    readonly locale: string;
    readonly onProgressIntent?: (intent: PlannerProgressIntent) => void | Promise<void>;
    readonly renderIcon: (element: HTMLElement, icon: "play") => void;
  };
  readonly root: unknown;
  readonly runtime: unknown;
}

interface AdapterSeam {
  readonly iconCalls: string[];
  readonly mounts: CapturedMount[];
  readonly surface: {
    readonly destroyCalls: string[];
    readonly localeCalls: string[];
    destroy(): void;
    measure(): void;
    setContext(): void;
    setLocale(locale: string): void;
  };
}

test("TC-UP-CTL-01-006 adapter factory binds and unbinds the complete planner lifecycle seam", async () => {
  const seam: AdapterSeam = {
    iconCalls: [],
    mounts: [],
    surface: {
      destroyCalls: [],
      localeCalls: [],
      destroy() { this.destroyCalls.push("destroy"); },
      measure() {},
      setContext() {},
      setLocale(locale) { this.localeCalls.push(locale); },
    },
  };
  (globalThis as typeof globalThis & { __issue24PlannerAdapterSeam: AdapterSeam })
    .__issue24PlannerAdapterSeam = seam;

  let localeListener: ((locale: string) => void) | undefined;
  let unsubscribeCalls = 0;
  let resolveContextCalls = 0;
  let resolveContextFailure = false;
  const progressCalls: PlannerProgressIntent[] = [];
  const runtime = { state: "ready", connect: () => { throw new Error("surface is seam-stubbed"); } };
  const dependencies: PlannerItemViewDependencies = {
    runtime: runtime as PlannerItemViewDependencies["runtime"],
    defaultLogicalDate: () => ({ year: 2026, month: 8, day: 28 }),
    dispatchPlannerProgress: (intent) => { progressCalls.push(intent); },
    locale: () => "zh-CN",
    subscribeLocale(listener) {
      localeListener = listener;
      return () => {
        unsubscribeCalls += 1;
        localeListener = undefined;
      };
    },
    resolveContext: (logicalDate) => {
      resolveContextCalls += 1;
      if (resolveContextFailure) throw new Error("active resolver failure");
      return {
        logicalDate,
        bounds: { startMinutes: 300, endMinutes: 1_440 },
        hostContext: "main",
      };
    },
  };
  const leaf = { getViewState: () => ({ state: {} }) };
  const view = createPlannerViewFactory(dependencies)(leaf as never);
  await view.setState({
    logicalDate: { year: 2026, month: 8, day: 28 },
    plannerInstanceId: "adapter-a",
  }, {} as never);

  await (view as unknown as { onOpen(): Promise<void> }).onOpen();
  assert.equal(seam.mounts.length, 1);
  const mount = seam.mounts[0]!;
  assert.equal(mount.runtime, runtime);
  assert.equal(mount.root, view.contentEl);
  assert.equal(mount.options.locale, "zh-CN");
  assert.equal(mount.options.instanceId, "adapter-a");
  assert.equal((view.contentEl.classList as unknown as { contains(value: string): boolean })
    .contains("spiral-day-planner-view"), true);

  const iconElement = {} as HTMLElement & { icon?: string };
  mount.options.renderIcon(iconElement, "play");
  assert.deepEqual(seam.iconCalls, ["play"]);
  assert.equal(iconElement.icon, "play");

  await view.setState({
    logicalDate: { year: 2026, month: 8, day: 28 },
    plannerInstanceId: "adapter-b",
  }, {} as never);
  assert.equal(seam.mounts.length, 2);
  assert.deepEqual(seam.surface.destroyCalls, ["destroy"]);
  const remounted = seam.mounts[1]!;
  assert.equal(remounted.options.instanceId, "adapter-b");
  assert.equal(view.getState().plannerInstanceId, "adapter-b");
  remounted.options.collapseStore.save("adapter-b", true);
  assert.equal(remounted.options.collapseStore.load("adapter-b"), true);

  const storage = (view.contentEl.ownerDocument.defaultView?.localStorage as Storage & {
    failReads: boolean;
    failWrites: boolean;
  });
  storage.failReads = true;
  assert.equal(remounted.options.collapseStore.load("adapter-b"), undefined);
  storage.failReads = false;
  storage.failWrites = true;
  assert.throws(() => remounted.options.collapseStore.save("adapter-b", false), /storage write failed/);
  storage.failWrites = false;

  const intent: PlannerProgressIntent = {
    intentId: "adapter-progress",
    type: "advance-or-reopen-progress",
    target: {
      blockId: "nl-task",
      itemId: "task",
      path: "Journal/2026-08-28.md",
      sourceOrder: 1,
    },
  };
  await remounted.options.onProgressIntent?.(intent);
  assert.deepEqual(progressCalls, [intent]);

  localeListener?.("en");
  assert.deepEqual(seam.surface.localeCalls, ["en"]);

  await (view as unknown as { onClose(): Promise<void> }).onClose();
  assert.deepEqual(seam.surface.destroyCalls, ["destroy", "destroy"]);
  assert.equal(unsubscribeCalls, 1);
  assert.equal(localeListener, undefined);
  assert.equal((view.contentEl.classList as unknown as { contains(value: string): boolean })
    .contains("spiral-day-planner-view"), false);
  const resolveCallsAfterClose = resolveContextCalls;
  view.onResize();
  assert.equal(resolveContextCalls, resolveCallsAfterClose);

  await (view as unknown as { onOpen(): Promise<void> }).onOpen();
  assert.equal(seam.mounts.length, 3);
  assert.equal(seam.mounts[2]!.options.instanceId, "adapter-b");
  assert.equal(seam.mounts[2]!.options.collapseStore.load("adapter-b"), true);
  resolveContextFailure = true;
  assert.throws(() => view.onResize(), /active resolver failure/);
  resolveContextFailure = false;
  await (view as unknown as { onClose(): Promise<void> }).onClose();
  assert.deepEqual(seam.surface.destroyCalls, ["destroy", "destroy", "destroy"]);
  assert.equal(unsubscribeCalls, 2);

  delete (globalThis as typeof globalThis & { __issue24PlannerAdapterSeam?: AdapterSeam })
    .__issue24PlannerAdapterSeam;
});
