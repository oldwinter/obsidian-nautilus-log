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
  readonly surface?: AdapterSurface;
}

interface AdapterSurface {
  readonly destroyCalls: string[];
  readonly localeCalls: string[];
  readonly measureCalls: string[];
  destroyFailuresRemaining: number;
  ephemeral?: string;
  measureFailuresRemaining: number;
  destroy(): void;
  measure(): void;
  setContext(context?: unknown): void;
  setLocale(locale: string): void;
}

interface AdapterSeam {
  readonly iconCalls: string[];
  readonly mounts: CapturedMount[];
  mountFailure?: Error;
  readonly surface: AdapterSurface;
  readonly createSurface?: (mount: CapturedMount) => AdapterSurface;
}

test("TC-UP-CTL-01-007 setState commits date and identity only after context and remount succeed", async () => {
  const contextCalls: unknown[] = [];
  let contextFailure: Error | undefined;
  const createSurface = (): AdapterSurface => {
    const surface: AdapterSurface = {
      destroyCalls: [],
      destroyFailuresRemaining: 0,
      localeCalls: [],
      measureCalls: [],
      measureFailuresRemaining: 0,
      destroy() {
        this.destroyCalls.push("destroy");
        if (this.destroyFailuresRemaining > 0) {
          this.destroyFailuresRemaining -= 1;
          throw new Error("surface destroy failed");
        }
      },
      measure() {
        this.measureCalls.push("measure");
        if (this.measureFailuresRemaining > 0) {
          this.measureFailuresRemaining -= 1;
          throw new Error("surface measure failed");
        }
      },
      setContext(context?: unknown) {
        contextCalls.push(context);
        if (contextFailure) throw contextFailure;
      },
      setLocale() {},
    };
    return surface;
  };
  const seam: AdapterSeam = {
    iconCalls: [],
    mounts: [],
    surface: createSurface(),
    createSurface,
  };
  (globalThis as typeof globalThis & { __issue24PlannerAdapterSeam: AdapterSeam })
    .__issue24PlannerAdapterSeam = seam;

  const dateA = Object.freeze({ year: 2026, month: 8, day: 28 });
  const dateB = Object.freeze({ year: 2026, month: 8, day: 29 });
  const dateC = Object.freeze({ year: 2026, month: 8, day: 30 });
  let resolution: "invalid" | "ready" | "throw" = "ready";
  const dependencies: PlannerItemViewDependencies = {
    runtime: { state: "ready", connect: () => { throw new Error("surface is seam-stubbed"); } } as never,
    defaultLogicalDate: () => dateA,
    resolveContext(logicalDate) {
      if (resolution === "throw") throw new Error("resolver failed");
      return {
        logicalDate,
        bounds: resolution === "invalid"
          ? { startMinutes: 900, endMinutes: 300 }
          : { startMinutes: 300, endMinutes: 1_440 },
        hostContext: "main",
      };
    },
  };
  const view = createPlannerViewFactory(dependencies)({ getViewState: () => ({ state: {} }) } as never);
  await view.setState({ logicalDate: dateA, plannerInstanceId: "atomic-a" }, {} as never);
  await (view as unknown as { onOpen(): Promise<void> }).onOpen();
  const mountedA = seam.mounts[0]!;
  const surfaceA = mountedA.surface!;
  surfaceA.ephemeral = "preserved-on-failed-remount";
  mountedA.options.collapseStore.save("atomic-a", true);

  resolution = "throw";
  await assert.rejects(
    view.setState({ logicalDate: dateB, plannerInstanceId: "atomic-b" }, {} as never),
    /resolver failed/,
  );
  assert.deepEqual(view.getState(), { logicalDate: dateA, plannerInstanceId: "atomic-a" });
  assert.equal(view.getDisplayText(), "Spiral Day - 2026-08-28");
  assert.equal(seam.mounts.length, 1);
  assert.deepEqual(contextCalls, []);
  assert.deepEqual(surfaceA.destroyCalls, []);
  assert.equal(mountedA.options.collapseStore.load("atomic-a"), true);

  resolution = "invalid";
  await assert.rejects(
    view.setState({ logicalDate: dateB, plannerInstanceId: "atomic-b" }, {} as never),
    /valid same-day chart bounds/,
  );
  assert.deepEqual(view.getState(), { logicalDate: dateA, plannerInstanceId: "atomic-a" });
  assert.equal(seam.mounts.length, 1);
  assert.deepEqual(contextCalls, []);
  assert.deepEqual(surfaceA.destroyCalls, []);

  resolution = "ready";
  seam.mountFailure = new Error("candidate mount failed");
  await assert.rejects(
    view.setState({ logicalDate: dateB, plannerInstanceId: "atomic-b" }, {} as never),
    /candidate mount failed/,
  );
  assert.deepEqual(view.getState(), { logicalDate: dateA, plannerInstanceId: "atomic-a" });
  assert.equal(seam.mounts.length, 2);
  assert.equal(surfaceA.ephemeral, "preserved-on-failed-remount");
  assert.deepEqual(surfaceA.destroyCalls, []);
  assert.equal((mountedA.root as { parentElement: unknown }).parentElement, view.contentEl);
  assert.equal((seam.mounts[1]!.root as { parentElement: unknown }).parentElement, null);

  surfaceA.destroyFailuresRemaining = 1;
  let surfaceB: AdapterSurface | undefined;
  const createCandidateSurface = seam.createSurface!;
  seam.createSurface = (mount) => {
    const surface = createCandidateSurface(mount);
    if (mount.options.instanceId === "atomic-b") {
      surface.measureFailuresRemaining = 1;
      surfaceB = surface;
    }
    return surface;
  };
  await view.setState({ logicalDate: dateB, plannerInstanceId: "atomic-b" }, {} as never);
  assert.deepEqual(view.getState(), { logicalDate: dateB, plannerInstanceId: "atomic-b" });
  assert.equal(view.getDisplayText(), "Spiral Day - 2026-08-29");
  assert.equal(seam.mounts.length, 3);
  assert.equal(seam.mounts[2]!.options.instanceId, "atomic-b");
  assert.deepEqual(surfaceA.destroyCalls, ["destroy", "destroy"]);
  const mountedSurfaceB = seam.mounts[2]!.surface!;
  assert.equal(surfaceB, mountedSurfaceB);
  assert.deepEqual(mountedSurfaceB.measureCalls, ["measure"]);
  surfaceB = mountedSurfaceB;
  assert.deepEqual(surfaceB.destroyCalls, []);
  assert.equal((seam.mounts[2]!.root as { parentElement: unknown }).parentElement, view.contentEl);
  assert.equal((mountedA.root as { parentElement: unknown }).parentElement, null);
  assert.deepEqual(contextCalls, []);
  view.onResize();
  assert.deepEqual(mountedSurfaceB.measureCalls, ["measure", "measure"]);
  assert.equal(contextCalls.length, 1);
  seam.mounts[2]!.options.collapseStore.save("atomic-b", true);
  assert.equal(seam.mounts[2]!.options.collapseStore.load("atomic-b"), true);

  await view.setState({ logicalDate: dateC, plannerInstanceId: "atomic-b" }, {} as never);
  assert.deepEqual(view.getState(), { logicalDate: dateC, plannerInstanceId: "atomic-b" });
  assert.equal(view.getDisplayText(), "Spiral Day - 2026-08-30");
  assert.equal(seam.mounts.length, 3);
  assert.equal(contextCalls.length, 2);
  assert.deepEqual(surfaceB.destroyCalls, []);

  contextFailure = new Error("surface context failed");
  await assert.rejects(
    view.setState({ logicalDate: dateA, plannerInstanceId: "atomic-b" }, {} as never),
    /surface context failed/,
  );
  contextFailure = undefined;
  assert.deepEqual(view.getState(), { logicalDate: dateC, plannerInstanceId: "atomic-b" });
  assert.equal(view.getDisplayText(), "Spiral Day - 2026-08-30");
  assert.equal(seam.mounts.length, 3);
  assert.equal(contextCalls.length, 3);
  assert.deepEqual(surfaceB.destroyCalls, []);

  seam.mountFailure = new Error("mount failed");
  await assert.rejects(
    view.setState({ logicalDate: dateA, plannerInstanceId: "atomic-c" }, {} as never),
    /mount failed/,
  );
  assert.deepEqual(view.getState(), { logicalDate: dateC, plannerInstanceId: "atomic-b" });
  assert.equal(view.getDisplayText(), "Spiral Day - 2026-08-30");
  assert.equal(seam.mounts.length, 4);
  assert.equal(seam.mounts[3]!.options.instanceId, "atomic-c");
  assert.equal(seam.mounts[3]!.options.collapseStore.load("atomic-b"), true);
  assert.deepEqual(surfaceB.destroyCalls, []);
  assert.equal((seam.mounts[2]!.root as { parentElement: unknown }).parentElement, view.contentEl);
  assert.equal((seam.mounts[3]!.root as { parentElement: unknown }).parentElement, null);

  await (view as unknown as { onClose(): Promise<void> }).onClose();
  delete (globalThis as typeof globalThis & { __issue24PlannerAdapterSeam?: AdapterSeam })
    .__issue24PlannerAdapterSeam;
});

test("TC-UP-CTL-01-006 adapter factory binds and unbinds the complete planner lifecycle seam", async () => {
  const seam: AdapterSeam = {
    iconCalls: [],
    mounts: [],
    surface: {
      destroyCalls: [],
      destroyFailuresRemaining: 0,
      localeCalls: [],
      measureCalls: [],
      measureFailuresRemaining: 0,
      destroy() {
        this.destroyCalls.push("destroy");
        if (this.destroyFailuresRemaining > 0) {
          this.destroyFailuresRemaining -= 1;
          throw new Error("surface destroy failed");
        }
      },
      measure() { this.measureCalls.push("measure"); },
      setContext() {},
      setLocale(locale) { this.localeCalls.push(locale); },
    },
  };
  (globalThis as typeof globalThis & { __issue24PlannerAdapterSeam: AdapterSeam })
    .__issue24PlannerAdapterSeam = seam;

  let localeListener: ((locale: string) => void) | undefined;
  let unsubscribeCalls = 0;
  let unsubscribeFailure = false;
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
        if (unsubscribeFailure) {
          unsubscribeFailure = false;
          throw new Error("locale unsubscribe failed");
        }
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
  assert.equal((mount.root as { parentElement: unknown }).parentElement, view.contentEl);
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
  unsubscribeFailure = true;
  seam.surface.destroyFailuresRemaining = 1;
  await (view as unknown as { onClose(): Promise<void> }).onClose();
  assert.deepEqual(seam.surface.destroyCalls, ["destroy", "destroy", "destroy", "destroy"]);
  assert.equal(unsubscribeCalls, 3);

  delete (globalThis as typeof globalThis & { __issue24PlannerAdapterSeam?: AdapterSeam })
    .__issue24PlannerAdapterSeam;
});

test("TC-UP-CTL-01-008 adapter owns failed terminal cleanup until reopen or close drains it", async () => {
  const surface: AdapterSurface = {
    destroyCalls: [],
    destroyFailuresRemaining: 0,
    localeCalls: [],
    measureCalls: [],
    measureFailuresRemaining: 0,
    destroy() {
      this.destroyCalls.push("destroy");
      if (this.destroyFailuresRemaining > 0) {
        this.destroyFailuresRemaining -= 1;
        throw new Error("surface destroy failed before cleanup");
      }
    },
    measure() { this.measureCalls.push("measure"); },
    setContext() {},
    setLocale(locale) { this.localeCalls.push(locale); },
  };
  const seam: AdapterSeam = { iconCalls: [], mounts: [], surface };
  (globalThis as typeof globalThis & { __issue24PlannerAdapterSeam: AdapterSeam })
    .__issue24PlannerAdapterSeam = seam;
  const localeListeners = new Set<(locale: string) => void>();
  let unsubscribeCalls = 0;
  let unsubscribeFailuresRemaining = 0;
  const view = createPlannerViewFactory({
    runtime: { state: "ready", connect: () => { throw new Error("surface is seam-stubbed"); } } as never,
    defaultLogicalDate: () => ({ year: 2026, month: 8, day: 28 }),
    resolveContext: (logicalDate) => ({
      logicalDate,
      bounds: { startMinutes: 300, endMinutes: 1_440 },
      hostContext: "main",
    }),
    subscribeLocale(listener) {
      localeListeners.add(listener);
      return () => {
        unsubscribeCalls += 1;
        if (unsubscribeFailuresRemaining > 0) {
          unsubscribeFailuresRemaining -= 1;
          throw new Error("locale unsubscribe failed before unregistering");
        }
        localeListeners.delete(listener);
      };
    },
  })({ getViewState: () => ({ state: {} }) } as never);

  await (view as unknown as { onOpen(): Promise<void> }).onOpen();
  assert.equal(localeListeners.size, 1);
  unsubscribeFailuresRemaining = 4;
  surface.destroyFailuresRemaining = 2;
  await assert.rejects(
    (view as unknown as { onClose(): Promise<void> }).onClose(),
    /planner adapter cleanup remains incomplete/i,
  );
  assert.equal(localeListeners.size, 1);
  assert.equal(unsubscribeCalls, 4);
  assert.deepEqual(surface.destroyCalls, ["destroy", "destroy", "destroy"]);

  await (view as unknown as { onOpen(): Promise<void> }).onOpen();
  assert.equal(localeListeners.size, 1);
  assert.equal(unsubscribeCalls, 5);
  assert.equal(seam.mounts.length, 2);

  unsubscribeFailuresRemaining = 2;
  surface.destroyFailuresRemaining = 2;
  await (view as unknown as { onClose(): Promise<void> }).onClose();
  assert.equal(localeListeners.size, 0);
  assert.equal(unsubscribeCalls, 8);
  assert.deepEqual(surface.destroyCalls, [
    "destroy", "destroy", "destroy",
    "destroy", "destroy", "destroy",
  ]);

  delete (globalThis as typeof globalThis & { __issue24PlannerAdapterSeam?: AdapterSeam })
    .__issue24PlannerAdapterSeam;
});
