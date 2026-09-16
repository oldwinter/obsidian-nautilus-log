import {
  MarkdownView,
  Notice,
  Plugin,
  TFile,
  type Editor,
  type MarkdownFileInfo,
  type TAbstractFile,
  type WorkspaceItem,
  type WorkspaceLeaf,
} from "obsidian";
import {
  ACTIVE_TASK_VIEW_TYPE,
  createActiveTaskViewFactory,
  openActiveTaskView,
} from "./adapters/active-task-view";
import { ExecutionCommandRegistry } from "./adapters/commands";
import { createLoadedMarkdownEditorResolver } from "./adapters/editor-buffer";
import { readHostDailyNoteConfiguration } from "./adapters/host-daily-note";
import { readHostLanguage } from "./adapters/host-language";
import { registerExecutionEditorMenu } from "./adapters/editor-menu";
import { ExecutionEntryAdapter } from "./adapters/execution-entry";
import {
  insertPrimaryPlan,
  insertPrimaryPlanNoticeKey,
} from "./adapters/insert-primary-plan";
import { locatePrimaryPath, primaryNavigationMessageKey } from "./adapters/locate-primary";
import { executionOutcomeNotice, showExecutionNotice } from "./adapters/notices";
import { copyPlannerSummary } from "./adapters/plan-summary";
import {
  createPlannerViewFactory,
  openPlannerView,
  PLANNER_VIEW_TYPE,
} from "./adapters/planner-view";
import { createReviewEntryPort, type ReviewEntryPort } from "./adapters/review-entry";
import { SpiralDaySettingTab } from "./adapters/settings";
import {
  ObsidianSourceNavigator,
  type SourceLocationResult,
  type SourceTaskReference,
} from "./adapters/source-navigation";
import { copyTaskMarkdownLink } from "./adapters/task-link";
import { calendarDayBounds, type LogicalDate } from "./core/day";
import type { EpochInterval } from "./core/history";
import type { ReviewClock } from "./core/review";
import { enExecution } from "./i18n/locales/en/execution";
import { zhCNExecution } from "./i18n/locales/zh-CN/execution";
import { createMessages, defineLocaleNamespace } from "./i18n/resolver";
import type { ExecutionMessages } from "./ui/execution/shared-controls";
import type { ExecutionRecentTask } from "./ui/execution/timing-view";
import type { PlannerProgressIntent } from "./ui/planner/controls";
import {
  ExecutionApplication,
  type ExecutionApplicationIntent,
  type ExecutionApplicationSnapshot,
} from "./runtime/execution/application";
import type { ExecutionCommandOutcome } from "./runtime/execution/commands";
import { projectRecentTasks } from "./runtime/execution/execution-state";
import { PluginDataStore, type PluginSettings } from "./runtime/plugin-data";
import {
  NautilusProjectionRuntime,
  type RuntimePlanProjection,
} from "./runtime/projection-runtime";
import { ReviewCoordinator } from "./runtime/review/coordinator";
import type { RuntimeSnapshot } from "./runtime/snapshots";
import {
  createZonedLocalTimeResolver,
  RealSystemClock,
  type ZonedLocalTimeResolver,
  zonedTimeParts,
} from "./runtime/system-clock";
import { ObsidianAtomicTextAccess, type AtomicTextAccess } from "./workspace/commit";
import { resolveDailyNotePath } from "./workspace/daily-notes";
import { HistoryIndex, type HistoryIndexSnapshot } from "./workspace/history-index";
import { WorkspaceIndex } from "./workspace/identity-index";
import type {
  SourceChange,
  SourceChangeListener,
  TextAccess,
  Unsubscribe,
} from "./workspace/text-access";

const executionNamespace = defineLocaleNamespace("execution", enExecution, zhCNExecution);

function isMarkdown(file: TAbstractFile): file is TFile {
  return file instanceof TFile && file.extension.toLowerCase() === "md";
}

class ObsidianVaultTextAccess implements TextAccess {
  readonly #plugin: Plugin;
  readonly #listeners = new Set<SourceChangeListener>();
  #disposed = false;

  constructor(plugin: Plugin) {
    this.#plugin = plugin;
    const emitFile = (kind: SourceChange["kind"], file: TAbstractFile): void => {
      if (isMarkdown(file)) this.#emit({ kind, path: file.path });
    };
    plugin.registerEvent(plugin.app.vault.on("create", (file) => emitFile("create", file)));
    plugin.registerEvent(plugin.app.vault.on("modify", (file) => emitFile("modify", file)));
    plugin.registerEvent(plugin.app.vault.on("delete", (file) => emitFile("delete", file)));
    plugin.registerEvent(plugin.app.vault.on("rename", (file, oldPath) => {
      if (isMarkdown(file) || oldPath.toLowerCase().endsWith(".md")) {
        this.#emit({ kind: "rename", path: file.path, oldPath });
      }
    }));
    plugin.registerEvent(plugin.app.workspace.on("editor-change", (_editor, info) => {
      if (info.file) this.#emit({ kind: "editor", path: info.file.path });
    }));
    plugin.registerEvent(plugin.app.metadataCache.on("changed", (file) => {
      this.#emit({ kind: "cache", path: file.path });
    }));
  }

  async listMarkdownPaths(signal?: AbortSignal): Promise<readonly string[]> {
    if (signal?.aborted) throw new DOMException("The operation was aborted", "AbortError");
    return Object.freeze(this.#plugin.app.vault.getMarkdownFiles()
      .map((file) => file.path)
      .sort((left, right) => left.localeCompare(right)));
  }

  async readText(path: string, signal?: AbortSignal): Promise<string | undefined> {
    if (signal?.aborted) throw new DOMException("The operation was aborted", "AbortError");
    const file = this.#plugin.app.vault.getAbstractFileByPath(path);
    if (!(file instanceof TFile) || file.extension.toLowerCase() !== "md") return undefined;
    const sourceText = await this.#plugin.app.vault.cachedRead(file);
    if (signal?.aborted) throw new DOMException("The operation was aborted", "AbortError");
    return sourceText;
  }

  onChange(listener: SourceChangeListener): Unsubscribe {
    if (this.#disposed) return () => undefined;
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  dispose(): void {
    this.#disposed = true;
    this.#listeners.clear();
  }

  #emit(change: SourceChange): void {
    if (this.#disposed) return;
    const immutable = Object.freeze({ ...change });
    for (const listener of [...this.#listeners]) listener(immutable);
  }
}

function logicalDateAt(clock: RealSystemClock): LogicalDate {
  const parts = zonedTimeParts(clock.now(), clock.timeZone());
  return Object.freeze({ year: parts.year, month: parts.month, day: parts.day });
}

function sameDate(left: LogicalDate, right: LogicalDate): boolean {
  return left.year === right.year && left.month === right.month && left.day === right.day;
}

function resolveLocalMinuteEpoch(
  date: LogicalDate,
  minute: number,
  timeZone: string,
): number | undefined {
  if (!Number.isInteger(minute) || minute < 0 || minute > 24 * 60) return undefined;
  const normalized = new Date(Date.UTC(date.year, date.month - 1, date.day, 0, minute));
  const target = Object.freeze({
    year: normalized.getUTCFullYear(),
    month: normalized.getUTCMonth() + 1,
    day: normalized.getUTCDate(),
    hour: normalized.getUTCHours(),
    minute: normalized.getUTCMinutes(),
  });
  const targetWall = Date.UTC(target.year, target.month - 1, target.day, target.hour, target.minute);
  let candidate = targetWall;
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const parts = zonedTimeParts(candidate, timeZone);
    const observedWall = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute);
    const delta = targetWall - observedWall;
    if (delta === 0) return candidate;
    candidate += delta;
  }
  return undefined;
}

function hostContextFor(leaf: WorkspaceLeaf, rightSplit: WorkspaceItem): "main" | "sidebar" {
  let current: WorkspaceItem | undefined = leaf;
  while (current) {
    if (current === rightSplit) return "sidebar";
    current = current.parent;
  }
  return "main";
}

export default class SpiralDayPlugin extends Plugin {
  #textAccess: ObsidianVaultTextAccess | undefined;
  #atomicAccess: AtomicTextAccess | undefined;
  #pluginData: PluginDataStore | undefined;
  #clock: RealSystemClock | undefined;
  #localTimeResolver: ZonedLocalTimeResolver | undefined;
  #workspaceIndex: WorkspaceIndex | undefined;
  #projectionRuntime: NautilusProjectionRuntime | undefined;
  #historyIndex: HistoryIndex | undefined;
  #historyUnsubscribe: Unsubscribe | undefined;
  #reviewCoordinator: ReviewCoordinator | undefined;
  #reviewPort: ReviewEntryPort | undefined;
  #reviewDate: LogicalDate | undefined;
  #messages: ExecutionMessages | undefined;
  #sourceNavigator: ObsidianSourceNavigator | undefined;
  #execution: ExecutionApplication | undefined;
  #suspendedExecution: ExecutionApplication | undefined;
  #executionEntry: ExecutionEntryAdapter | undefined;
  #commands: ExecutionCommandRegistry | undefined;
  #plannerRibbon: HTMLElement | undefined;
  #executionUnsubscribe: Unsubscribe | undefined;
  #editorForPath: ((path: string) => { getValue(): string; setValue?(value: string): void } | undefined) | undefined;
  #planConnection: ReturnType<NautilusProjectionRuntime["connect"]> | undefined;
  #planSnapshot: RuntimeSnapshot<RuntimePlanProjection> | undefined;
  readonly #planListeners = new Set<(snapshot: RuntimeSnapshot<RuntimePlanProjection>) => void>();
  readonly #recentListeners = new Set<(recent: readonly ExecutionRecentTask[]) => void>();
  #historyRefreshQueued = false;
  #intentSequence = 0;
  #stopping = false;

  override async onload(): Promise<void> {
    this.#textAccess = new ObsidianVaultTextAccess(this);
    const editorResolver = createLoadedMarkdownEditorResolver(this.app.workspace);
    this.#editorForPath = editorResolver.editorForPath;
    this.registerEvent(this.app.workspace.on("file-open", editorResolver.onFileOpen));
    this.#atomicAccess = new ObsidianAtomicTextAccess({
      text: this.#textAccess,
      vault: this.app.vault,
      fileForPath: (path) => {
        const file = this.app.vault.getAbstractFileByPath(path);
        return file instanceof TFile ? file : undefined;
      },
      editorForPath: editorResolver.editorForPath,
    });
    const hostDailyNote = await readHostDailyNoteConfiguration(this.app);
    this.#pluginData = new PluginDataStore({
      load: () => this.loadData(),
      save: (data) => this.saveData(data),
    }, {
      hostLanguage: readHostLanguage(),
      ...(hostDailyNote ? { hostDailyNote } : {}),
    });
    this.#clock = new RealSystemClock();
    this.#configureLocalTimeResolver(this.#clock.timeZone());
    this.#workspaceIndex = new WorkspaceIndex(this.#atomicAccess, {
      clockParsing: { resolveLocalTime: this.#requireLocalTimeResolver().resolve },
    });
    this.#projectionRuntime = new NautilusProjectionRuntime({
      access: this.#atomicAccess,
      pluginData: this.#pluginData,
      clock: this.#clock,
    });
    await this.#projectionRuntime.start();
    this.#messages = createMessages({
      locale: this.#pluginData.data.settings.language,
      namespaces: { execution: executionNamespace },
    });
    this.#historyIndex = new HistoryIndex(this.#atomicAccess);
    this.#historyUnsubscribe = this.#historyIndex.subscribe((snapshot) => this.#onHistorySnapshot(snapshot));
    this.#reviewCoordinator = new ReviewCoordinator(this.#historyIndex);
    this.#sourceNavigator = new ObsidianSourceNavigator({
      app: this.app,
      locateTask: (target) => this.#locateTask(target),
      unavailableMessage: (code) => this.#navigationMessage(code),
    });
    this.#connectTodayPlan();
    this.#reviewPort = createReviewEntryPort({
      dispatch: (intent) => this.#dispatchExecution(intent, false),
      executionSnapshot: () => this.#requireExecution().snapshot,
      subscribeExecution: (listener) => this.#requireExecution().subscribe(listener),
      reviewSnapshot: () => this.#requireReview().snapshot,
      subscribeReview: (listener) => this.#requireReview().subscribe(listener),
      navigateTask: async (target, location) => {
        await this.#requireNavigator().openTask(target, location);
      },
      today: () => logicalDateAt(this.#requireClock()),
      selectDate: async (date) => {
        this.#reviewDate = date ? Object.freeze({ ...date }) : undefined;
        await this.#refreshReview();
      },
      refresh: () => this.#refreshReview(),
      tick: () => {
        const coordinator = this.#requireReview();
        const clock = this.#requireClock();
        const execution = this.#requireExecution().snapshot;
        const sample = clock.sample();
        const local = zonedTimeParts(sample.wallEpochMs, sample.timeZone);
        const today = Object.freeze({ year: local.year, month: local.month, day: local.day });
        if (!execution.writeBlocked && !this.#reviewDate && coordinator.snapshot.state === "ready"
          && !sameDate(coordinator.snapshot.displayedDate, today)) {
          this.#requestReviewRefresh();
          return;
        }
        const outcome = coordinator.advance({
          nowEpochMilliseconds: sample.wallEpochMs,
          timeZone: sample.timeZone,
          writeBlocked: execution.writeBlocked,
        });
        if (outcome === "refresh-required") {
          this.#configureLocalTimeResolver(sample.timeZone);
          void this.#requireExecution().refresh().catch((error: unknown) => {
            console.error("Spiral Day Review clock refresh", error);
          });
        }
      },
      intentId: () => this.#intentId("review"),
      messages: this.#messages,
      addDisposer: (dispose) => this.register(dispose),
      insertPrimaryPlan: () => this.#insertPrimaryPlan(),
    });

    this.registerView(PLANNER_VIEW_TYPE, createPlannerViewFactory({
      runtime: this.#projectionRuntime,
      defaultLogicalDate: () => logicalDateAt(this.#requireClock()),
      copySummary: (summary) => copyPlannerSummary({ summary }),
      insertPrimaryPlan: () => this.#insertPrimaryPlan(),
      dispatchPlannerProgress: (intent) => this.#dispatchPlannerProgress(intent),
      locale: () => this.#requireMessages().locale,
      subscribeLocale: (listener) => this.#requireMessages().subscribe(listener),
      resolveContext: (logicalDate, leaf) => ({
        logicalDate,
        bounds: {
          startMinutes: this.#requirePluginData().data.settings.chartStartHour * 60,
          endMinutes: this.#requirePluginData().data.settings.chartEndHour * 60,
        },
        hostContext: hostContextFor(leaf, this.app.workspace.rightSplit),
      }),
    }));
    this.registerView(ACTIVE_TASK_VIEW_TYPE, createActiveTaskViewFactory({
      subscribe: (listener) => this.#requireExecution().subscribe(listener),
      snapshot: () => this.#requireExecution().snapshot,
      now: () => this.#requireClock().now(),
      messages: this.#messages,
      subscribeLocale: (listener) => this.#requireMessages().subscribe(listener),
      openSource: async (target) => {
        await this.#requireNavigator().openTask(target);
      },
      copyLink: (target, label) => copyTaskMarkdownLink({
        app: this.app,
        target,
        label,
      }),
      clockOut: async () => {
        await this.#dispatchExecution({
          type: "clock-out",
          intentId: this.#intentId("active-task-clock-out"),
        }, true);
      },
      onError: (error) => this.#reportError(error),
    }));
    this.#plannerRibbon = this.addRibbonIcon(
      "shell",
      this.#requireMessages().t("planner", "ribbon.openPlanner"),
      () => {
        void openPlannerView(this.app, logicalDateAt(this.#requireClock()))
          .then(() => {
            if (this.#planSnapshot?.state === "missing") {
              new Notice(this.#requireMessages().t("execution", "notice.firstRun"), 8_000);
            }
          })
          .catch((error) => this.#reportError(error));
      },
    );
    this.addSettingTab(new SpiralDaySettingTab({
      app: this.app,
      plugin: this,
      messages: this.#messages,
      settings: () => this.#requirePluginData().data.settings,
      update: (patch) => this.#updateSettings(patch),
      setExecutionEnabled: (enabled) => enabled
        ? this.#activateExecution(false)
        : this.#deactivateExecution(),
      onLocaleChanged: () => this.#onLocaleChanged(),
      onExecutionChanged: () => undefined,
      insertPrimaryPlan: () => this.#insertPrimaryPlan(),
      onError: (error) => this.#reportError(error),
    }));
    registerExecutionEditorMenu({
      plugin: this,
      enabled: () => this.#executionEntry?.active === true,
      titleFor: (kind) => this.#requireMessages().t(
        "execution",
        kind === "clock-in" ? "menu.clockIn" : "menu.clockOut",
      ),
      resolveAction: (editor, info) => {
        const file = info.file;
        if (!file || !this.#execution) return undefined;
        const kind = this.#execution.inspectEditorAction(
          file.path,
          editor.getValue(),
          editor.posToOffset(editor.getCursor()),
        );
        return kind ? Object.freeze({ kind }) : undefined;
      },
      dispatch: (expected, editor, info) => this.#dispatchEditorAction(expected.kind, editor, info),
      onError: (error) => this.#reportError(error),
    });

    if (this.#pluginData.data.settings.executionEnabled) {
      await this.#activateExecution(true);
    } else {
      this.app.workspace.detachLeavesOfType(ACTIVE_TASK_VIEW_TYPE);
    }
  }

  override onunload(): void {
    if (this.#stopping) return;
    this.#stopping = true;
    this.#executionEntry?.stop();
    this.#commands?.stop();
    void this.#shutdown().catch((error: unknown) => {
      console.error("Spiral Day unload", error);
    });
  }

  async #activateExecution(alreadyEnabled: boolean): Promise<boolean> {
    if (this.#executionEntry?.active) return true;
    const application = this.#execution ?? this.#suspendedExecution ?? new ExecutionApplication({
      access: this.#requireAtomicAccess(),
      pluginData: this.#requirePluginData(),
      clock: this.#requireClock(),
      workspaceIndex: this.#requireWorkspaceIndex(),
      logbook: {
        resolveLocalTime: (parts) => this.#requireLocalTimeResolver().resolve(parts),
      },
    });
    this.#suspendedExecution = undefined;
    this.#execution = application;
    try {
      if (application.snapshot.status === "starting") await application.start();
      else await application.resume();
      if (!alreadyEnabled) {
        const outcome = await application.dispatch({
          type: "enable-execution",
          intentId: this.#intentId("enable-execution"),
        });
        if (outcome.outcome !== "applied" && outcome.outcome !== "already-applied") {
          showExecutionNotice(executionOutcomeNotice(outcome, this.#requireMessages()));
          throw new Error(outcome.code ?? "Execution activation was rejected");
        }
      }
      this.#executionUnsubscribe = application.subscribe(() => {
        this.#requestReviewRefresh();
      });
      const port = {
        now: () => this.#requireClock().now(),
        refresh: () => application.refresh(),
        subscribeExecution: (listener: (snapshot: ExecutionApplicationSnapshot) => void) => application.subscribe(listener),
        subscribePlan: (listener: (snapshot: RuntimeSnapshot<RuntimePlanProjection>) => void) => this.#subscribePlan(listener),
        dispatch: (intent: ExecutionApplicationIntent) => this.#dispatchExecution(intent, false),
        outcomeFeedback: (outcome: ExecutionCommandOutcome) => {
          const notice = executionOutcomeNotice(outcome, this.#requireMessages());
          return Object.freeze({ message: notice.message, level: notice.level });
        },
        navigatePrimary: async () => {
          await this.#requireNavigator().openPrimary(this.#primaryPath());
        },
        openActiveTask: async () => {
          await openActiveTaskView(this.app);
        },
        navigateTask: async (target: SourceTaskReference, location: "main" | "sidebar") => {
          await this.#requireNavigator().openTask(target, location);
        },
        subscribeRecent: (listener: (recent: readonly ExecutionRecentTask[]) => void) => this.#subscribeRecent(listener),
        createReviewSurface: (root: HTMLElement) => this.#requireReviewPort().createSurface(root),
        insertPrimaryPlan: () => this.#insertPrimaryPlan(),
      } as const;
      this.#executionEntry = new ExecutionEntryAdapter({
        plugin: this,
        port,
        messages: this.#requireMessages(),
        onOutcome: (outcome) => showExecutionNotice(
          executionOutcomeNotice(outcome, this.#requireMessages()),
        ),
        onError: (error) => this.#reportError(error),
      });
      this.#commands = new ExecutionCommandRegistry({
        plugin: this,
        titles: () => this.#commandTitles(),
        focusCurrent: () => this.#focusCurrent(),
        clockOut: async () => {
          await this.#dispatchExecution({
            type: "clock-out",
            intentId: this.#intentId("clock-out-command"),
          }, true);
        },
        locatePrimary: async () => {
          await this.#requireNavigator().openPrimary(this.#primaryPath());
        },
        onError: (error) => this.#reportError(error),
      });
      this.#executionEntry.start();
      this.#commands.start();
      return true;
    } catch (error) {
      this.#executionEntry?.stop();
      this.#executionEntry = undefined;
      this.#commands?.stop();
      this.#commands = undefined;
      this.app.workspace.detachLeavesOfType(ACTIVE_TASK_VIEW_TYPE);
      this.#executionUnsubscribe?.();
      this.#executionUnsubscribe = undefined;
      let rolledBack = !this.#requirePluginData().data.settings.executionEnabled;
      try {
        if (!rolledBack) {
          const outcome = await application.dispatch({
            type: "disable-execution",
            intentId: this.#intentId("activation-rollback"),
          });
          rolledBack = (outcome.outcome === "applied" || outcome.outcome === "already-applied")
            && !this.#requirePluginData().data.settings.executionEnabled;
        }
      } catch (rollbackError) {
        console.error("Spiral Day activation rollback", rollbackError);
      }
      if (rolledBack) {
        application.suspend();
        this.#suspendedExecution = application;
        this.#execution = undefined;
      } else {
        this.#execution = application;
      }
      this.#reportError(error);
      return false;
    }
  }

  async #deactivateExecution(): Promise<boolean> {
    const application = this.#execution;
    if (!application) return true;
    const outcome = await application.dispatch({
      type: "disable-execution",
      intentId: this.#intentId("disable-execution"),
    });
    if (outcome.outcome !== "applied" && outcome.outcome !== "already-applied") {
      showExecutionNotice(executionOutcomeNotice(outcome, this.#requireMessages()));
      return false;
    }
    this.#executionEntry?.stop();
    this.#executionEntry = undefined;
    this.#commands?.stop();
    this.#commands = undefined;
    this.app.workspace.detachLeavesOfType(ACTIVE_TASK_VIEW_TYPE);
    this.#executionUnsubscribe?.();
    this.#executionUnsubscribe = undefined;
    application.suspend();
    this.#suspendedExecution = application;
    if (this.#execution === application) this.#execution = undefined;
    return !this.#requirePluginData().data.settings.executionEnabled;
  }

  async #dispatchExecution(
    intent: ExecutionApplicationIntent,
    toast: boolean,
  ): Promise<ExecutionCommandOutcome> {
    const outcome = await this.#requireExecution().dispatch(intent);
    if (toast) showExecutionNotice(executionOutcomeNotice(outcome, this.#requireMessages()));
    if ((outcome.outcome === "applied" || outcome.outcome === "already-applied")
      && intent.type === "clock-in"
      && this.#requirePluginData().data.settings.keepTimingFirst
      && this.#requireExecution().snapshot.focused) {
      try {
        await openActiveTaskView(this.app);
      } catch {
        new Notice(this.#requireMessages().t("execution", "error.sidebarAfterStart"), 5_000);
      }
    }
    this.#requestReviewRefresh();
    return outcome;
  }

  async #focusCurrent(): Promise<void> {
    const view = this.app.workspace.getActiveViewOfType(MarkdownView);
    if (!view?.file) {
      new Notice(this.#requireMessages().t("execution", "error.focusTodo"), 5_000);
      return;
    }
    const action = await this.#requireExecution().resolveEditorAction(
      view.file.path,
      view.editor.getValue(),
      view.editor.posToOffset(view.editor.getCursor()),
    );
    if (!action) {
      new Notice(this.#requireMessages().t("execution", "error.taskOwner"), 5_000);
      return;
    }
    await this.#dispatchExecution({
      type: "clock-in",
      intentId: this.#intentId("focus-current"),
      target: action.target,
    }, true);
  }

  async #dispatchEditorAction(
    expected: "clock-in" | "clock-out",
    editor: Editor,
    info: MarkdownFileInfo,
  ): Promise<void> {
    const file = info.file;
    if (!file) return;
    const action = await this.#requireExecution().resolveEditorAction(
      file.path,
      editor.getValue(),
      editor.posToOffset(editor.getCursor()),
    );
    if (!action || action.kind !== expected) {
      new Notice(this.#requireMessages().t("execution", "error.taskOwner"), 5_000);
      return;
    }
    await this.#dispatchExecution(action.kind === "clock-out"
      ? { type: "clock-out", intentId: this.#intentId("editor-clock-out") }
      : { type: "clock-in", intentId: this.#intentId("editor-clock-in"), target: action.target }, true);
  }

  async #dispatchPlannerProgress(intent: PlannerProgressIntent): Promise<void> {
    const snapshot = this.#planSnapshot;
    if (!this.#execution || snapshot?.state !== "confirmed") {
      new Notice(this.#requireMessages().t("execution", "error.executionInactive"), 5_000);
      return;
    }
    const item = snapshot.projection.items.find((candidate) =>
      candidate.source.path === intent.target.path
      && candidate.sourceOrder === intent.target.sourceOrder
      && candidate.source.blockId === intent.target.blockId);
    if (!item) {
      new Notice(this.#requireMessages().t("execution", "error.taskOwner"), 5_000);
      return;
    }
    await this.#dispatchExecution({
      type: "advance-or-reopen-progress",
      intentId: intent.intentId,
      target: {
        path: item.source.path,
        ownerId: item.source.blockId,
        sourceOrder: item.sourceOrder,
        sourceFingerprint: snapshot.projection.sourceFingerprint,
      },
    }, true);
  }

  async #updateSettings(patch: Partial<PluginSettings>): Promise<void> {
    await this.#requireProjectionRuntime().updateSettings(patch);
    if (patch.language) this.#requireMessages().setLocale(patch.language);
    await this.#execution?.refresh();
    this.#requestReviewRefresh();
  }

  #onLocaleChanged(): void {
    this.#executionEntry?.setLocale();
    this.#syncHostChrome();
    void this.#execution?.refresh();
  }

  #commandTitles(): {
    readonly focusCurrent: string;
    readonly clockOut: string;
    readonly locatePrimary: string;
  } {
    const messages = this.#requireMessages();
    return {
      focusCurrent: messages.t("execution", "command.focusCurrent"),
      clockOut: messages.t("execution", "command.clockOut"),
      locatePrimary: messages.t("execution", "command.locatePrimary"),
    };
  }

  #syncHostChrome(): void {
    const title = this.#requireMessages().t("planner", "ribbon.openPlanner");
    this.#plannerRibbon?.setAttribute("aria-label", title);
    this.#plannerRibbon?.setAttribute("title", title);
    this.#commands?.refresh();
  }

  #connectTodayPlan(): void {
    this.#planConnection = this.#requireProjectionRuntime().connect(
      { logicalDate: logicalDateAt(this.#requireClock()) },
      (snapshot) => {
        this.#planSnapshot = snapshot;
        const today = logicalDateAt(this.#requireClock());
        if (!sameDate(snapshot.revision.logicalDate, today)) {
          queueMicrotask(() => {
            if (this.#stopping) return;
            const current = this.#planSnapshot;
            const currentToday = logicalDateAt(this.#requireClock());
            if (current && !sameDate(current.revision.logicalDate, currentToday)) {
              this.#planConnection?.setContext({ logicalDate: currentToday });
            }
          });
          return;
        }
        for (const listener of [...this.#planListeners]) listener(snapshot);
        this.#requestReviewRefresh();
      },
      true,
    );
  }

  #subscribePlan(listener: (snapshot: RuntimeSnapshot<RuntimePlanProjection>) => void): Unsubscribe {
    this.#planListeners.add(listener);
    const snapshot = this.#planSnapshot;
    if (snapshot && sameDate(snapshot.revision.logicalDate, logicalDateAt(this.#requireClock()))) {
      listener(snapshot);
    }
    return () => this.#planListeners.delete(listener);
  }

  #subscribeRecent(listener: (recent: readonly ExecutionRecentTask[]) => void): Unsubscribe {
    this.#recentListeners.add(listener);
    listener(this.#recentExecutionTasks());
    return () => this.#recentListeners.delete(listener);
  }

  #onHistorySnapshot(snapshot: HistoryIndexSnapshot): void {
    if (snapshot.state === "current") {
      const recent = this.#recentExecutionTasks();
      for (const listener of [...this.#recentListeners]) listener(recent);
      return;
    }
    if (snapshot.state !== "dirty" || this.#historyRefreshQueued) return;
    this.#historyRefreshQueued = true;
    queueMicrotask(() => {
      this.#historyRefreshQueued = false;
      if (!this.#stopping && this.#historyIndex?.snapshot.state === "dirty") {
        this.#requestReviewRefresh();
      }
    });
  }

  #requestReviewRefresh(): void {
    void this.#refreshReview().catch((error: unknown) => {
      console.error("Spiral Day Review refresh", error);
    });
  }

  #recentExecutionTasks(): readonly ExecutionRecentTask[] {
    const history = this.#historyIndex?.snapshot;
    const pluginData = this.#pluginData;
    const clock = this.#clock;
    if (history?.state !== "current" || !pluginData || !clock) return Object.freeze([]);
    const collidingOwners = new Set(history.diagnostics
      .filter((diagnostic) => diagnostic.code === "duplicate-owner-id" && diagnostic.ownerId)
      .map((diagnostic) => diagnostic.ownerId!));
    const tasksByOwner = new Map(history.tasks
      .filter((task) => task.kind === "flexible-task"
        && task.status === "open"
        && task.ownerId
        && !collidingOwners.has(task.ownerId))
      .map((task) => [task.ownerId!, task]));
    const facts = [...tasksByOwner.values()].flatMap((task) => task.clocks.flatMap((entry) =>
      entry.state === "closed"
        ? [{ ownerId: task.ownerId!, endEpochMs: entry.endEpochMilliseconds, ownerState: "todo" as const }]
        : []));
    const projected = projectRecentTasks(
      facts,
      clock.now(),
      pluginData.data.settings.recentRetentionMinutes,
      this.#execution?.snapshot.focused?.ownerId,
    );
    return Object.freeze(projected.flatMap((entry) => {
      const task = tasksByOwner.get(entry.ownerId);
      const latest = task?.clocks.find((clockEntry) =>
        clockEntry.state === "closed" && clockEntry.endEpochMilliseconds === entry.latestEndEpochMs);
      if (!task || !latest || latest.state !== "closed") return [];
      return [Object.freeze({
        key: task.key,
        ownerId: entry.ownerId,
        path: task.path,
        sourceOrder: task.sourceOrder,
        label: task.label,
        actualMinutes: Math.max(0, Math.floor(
          (latest.endEpochMilliseconds - latest.startEpochMilliseconds) / 60_000,
        )),
      })];
    }));
  }

  async #refreshReview(): Promise<void> {
    const coordinator = this.#reviewCoordinator;
    const snapshot = this.#planSnapshot;
    const clock = this.#clock;
    const pluginData = this.#pluginData;
    if (!coordinator || !clock || !pluginData) return;
    const sample = clock.sample();
    const timeZone = sample.timeZone;
    const local = zonedTimeParts(sample.wallEpochMs, timeZone);
    const logicalDate = this.#reviewDate ?? Object.freeze({
      year: local.year,
      month: local.month,
      day: local.day,
    });
    const changedTimeZone = this.#configureLocalTimeResolver(timeZone);
    if (changedTimeZone && this.#execution) await this.#execution.refresh();
    const localTimeResolver = this.#requireLocalTimeResolver();
    const day = calendarDayBounds(logicalDate, timeZone, (date, zone) => {
      const resolved = resolveLocalMinuteEpoch(date, 0, zone);
      if (resolved === undefined) throw new RangeError("Local midnight is unavailable");
      return resolved;
    });
    const toInterval = (start: number, end: number): EpochInterval | undefined => {
      const startEpochMilliseconds = resolveLocalMinuteEpoch(logicalDate, start, timeZone);
      const endEpochMilliseconds = resolveLocalMinuteEpoch(logicalDate, end, timeZone);
      return startEpochMilliseconds !== undefined
        && endEpochMilliseconds !== undefined
        && endEpochMilliseconds > startEpochMilliseconds
        ? Object.freeze({ startEpochMilliseconds, endEpochMilliseconds })
        : undefined;
    };
    const schedule = snapshot?.state === "confirmed"
      && sameDate(snapshot.projection.displayedDate, logicalDate)
      ? snapshot.projection.schedule : undefined;
    const scheduledIntervals = Object.freeze([
      ...(schedule?.fixedEvents ?? []),
      ...(schedule?.plannedSlots ?? []),
    ].flatMap((entry) => {
      const interval = toInterval(entry.startMinutes, entry.endMinutes);
      return interval ? [interval] : [];
    }));
    const focused = this.#execution?.snapshot.focused;
    const confirmedExecutionClocks: readonly ReviewClock[] = focused
      ? [Object.freeze({
          state: "running" as const,
          ownerId: focused.ownerId,
          startEpochMilliseconds: focused.clock.startEpochMs,
          ...(focused.clock.clockId ? { clockId: focused.clock.clockId } : {}),
        })]
      : [];
    const hourBoundariesEpochMilliseconds = Object.freeze(Array.from({ length: 23 }, (_, index) =>
      resolveLocalMinuteEpoch(logicalDate, (index + 1) * 60, timeZone))
      .filter((value): value is number => value !== undefined));
    await coordinator.refresh({
      logicalDate,
      configuration: {
        folder: pluginData.data.settings.dailyNoteFolder,
        format: pluginData.data.settings.dailyNoteFormat,
      },
      grammarSettings: {
        defaultDurationMinutes: pluginData.data.settings.defaultDurationMinutes,
        urgentTrigger: pluginData.data.settings.urgentTrigger,
      },
      clockParsing: { resolveLocalTime: localTimeResolver.resolve },
      clockParsingKey: `iana:${localTimeResolver.timeZone}`,
      day,
      nowEpochMilliseconds: sample.wallEpochMs,
      resolveMinuteEpoch: resolveLocalMinuteEpoch,
      confirmedExecutionClocks,
      scheduledIntervals,
      hourBoundariesEpochMilliseconds,
    });
  }

  async #locateTask(target: SourceTaskReference): Promise<SourceLocationResult> {
    if (!target.ownerId) return Object.freeze({ kind: "unavailable", code: "no-block-id" });
    const index = this.#requireWorkspaceIndex();
    if (index.dirty) await index.rebuild();
    const identity = index.safetyIdentity(target.ownerId);
    if (identity.kind === "unique") {
      return Object.freeze({ kind: "available", path: identity.location.path, line: identity.location.line });
    }
    return Object.freeze({
      kind: "unavailable",
      code: identity.kind === "collision"
        ? "identity-collision"
        : identity.kind === "missing"
          ? "source-task-missing"
          : identity.reason,
    });
  }

  async #insertPrimaryPlan(): Promise<void> {
    const pluginData = this.#pluginData;
    const clock = this.#clock;
    const messages = this.#messages;
    if (!pluginData || !clock || !messages) return;
    try {
      await pluginData.persistSeededIfNeeded();
    } catch (error) {
      this.#reportError(error);
    }
    try {
      const outcome = await insertPrimaryPlan({
        app: this.app,
        locale: () => messages.locale,
        today: () => logicalDateAt(clock),
        configuration: () => ({
          folder: pluginData.data.settings.dailyNoteFolder,
          format: pluginData.data.settings.dailyNoteFormat,
        }),
        editorForPath: (path) => this.#editorForPath?.(path),
      });
      new Notice(messages.t("planner", insertPrimaryPlanNoticeKey(outcome)), 6_000);
    } catch (error) {
      new Notice(messages.t("planner", "status.missingInsertFailed"), 6_000);
      this.#reportError(error);
    }
  }

  #primaryPath(): string | null {
    return locatePrimaryPath(
      this.#planSnapshot?.state === "confirmed" ? this.#planSnapshot.projection.sourcePath : undefined,
      this.#resolvedTodayPath(),
    );
  }

  #resolvedTodayPath(): string | null {
    const clock = this.#clock;
    const pluginData = this.#pluginData;
    if (!clock || !pluginData) return null;
    const resolved = resolveDailyNotePath(logicalDateAt(clock), {
      folder: pluginData.data.settings.dailyNoteFolder,
      format: pluginData.data.settings.dailyNoteFormat,
    });
    return resolved.ok ? resolved.path : null;
  }

  #navigationMessage(code: string): string {
    return this.#requireMessages().t("execution", primaryNavigationMessageKey(code));
  }

  #intentId(prefix: string): string {
    this.#intentSequence += 1;
    return `${prefix}-${this.#requireClock().now()}-${this.#intentSequence}`;
  }

  #reportError(error: unknown): void {
    console.error("Spiral Day", error);
    new Notice(this.#messages?.t("execution", "error.generic") ?? "Spiral Day could not complete that action.", 5_000);
  }

  async #shutdown(): Promise<void> {
    const application = this.#execution ?? this.#suspendedExecution;
    this.#execution = undefined;
    this.#suspendedExecution = undefined;
    this.#executionUnsubscribe?.();
    this.#executionUnsubscribe = undefined;
    const failures: unknown[] = [];
    try {
      await application?.stop();
    } catch (error) {
      failures.push(error);
    }
    this.#planConnection?.disconnect();
    this.#planConnection = undefined;
    this.#planListeners.clear();
    this.#recentListeners.clear();
    this.#historyUnsubscribe?.();
    this.#historyUnsubscribe = undefined;
    this.#reviewCoordinator?.dispose();
    this.#reviewCoordinator = undefined;
    this.#historyIndex = undefined;
    this.#workspaceIndex?.dispose();
    this.#workspaceIndex = undefined;
    try {
      await this.#projectionRuntime?.stop();
    } catch (error) {
      failures.push(error);
    }
    this.#projectionRuntime = undefined;
    this.#sourceNavigator?.dispose();
    this.#sourceNavigator = undefined;
    this.#textAccess?.dispose();
    this.#textAccess = undefined;
    if (failures.length > 0) throw new AggregateError(failures, "Spiral Day shutdown failed");
  }

  #requireAtomicAccess(): AtomicTextAccess {
    if (!this.#atomicAccess) throw new Error("Atomic source access is unavailable");
    return this.#atomicAccess;
  }

  #requirePluginData(): PluginDataStore {
    if (!this.#pluginData) throw new Error("Plugin data is unavailable");
    return this.#pluginData;
  }

  #requireClock(): RealSystemClock {
    if (!this.#clock) throw new Error("System clock is unavailable");
    return this.#clock;
  }

  #configureLocalTimeResolver(timeZone: string): boolean {
    const next = createZonedLocalTimeResolver(timeZone);
    if (this.#localTimeResolver?.timeZone === next.timeZone) return false;
    this.#localTimeResolver = next;
    this.#workspaceIndex?.setClockParsing({ resolveLocalTime: next.resolve });
    return true;
  }

  #requireLocalTimeResolver(): ZonedLocalTimeResolver {
    if (!this.#localTimeResolver) throw new Error("Local time resolver is unavailable");
    return this.#localTimeResolver;
  }

  #requireWorkspaceIndex(): WorkspaceIndex {
    if (!this.#workspaceIndex) throw new Error("Workspace index is unavailable");
    return this.#workspaceIndex;
  }

  #requireProjectionRuntime(): NautilusProjectionRuntime {
    if (!this.#projectionRuntime) throw new Error("Projection runtime is unavailable");
    return this.#projectionRuntime;
  }

  #requireReview(): ReviewCoordinator {
    if (!this.#reviewCoordinator) throw new Error("Review runtime is unavailable");
    return this.#reviewCoordinator;
  }

  #requireReviewPort(): ReviewEntryPort {
    if (!this.#reviewPort) throw new Error("Review entry is unavailable");
    return this.#reviewPort;
  }

  #requireMessages(): ExecutionMessages {
    if (!this.#messages) throw new Error("Messages are unavailable");
    return this.#messages;
  }

  #requireNavigator(): ObsidianSourceNavigator {
    if (!this.#sourceNavigator) throw new Error("Source navigation is unavailable");
    return this.#sourceNavigator;
  }

  #requireExecution(): ExecutionApplication {
    if (!this.#execution) throw new Error("Execution is not enabled");
    return this.#execution;
  }
}
