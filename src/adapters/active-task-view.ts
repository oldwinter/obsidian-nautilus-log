import {
  ItemView,
  Notice,
  setIcon,
  type App,
  type IconName,
  type WorkspaceLeaf,
} from "obsidian";
import type { ExecutionApplicationSnapshot } from "../runtime/execution/application";
import {
  renderActiveTaskSurface,
  updateActiveTaskElapsed,
} from "../ui/execution/active-task-view";
import type { ExecutionIconName, ExecutionMessages } from "../ui/execution/shared-controls";
import type { SourceTaskReference } from "./source-navigation";
import type { TaskLinkCopyResult } from "./task-link";

export const ACTIVE_TASK_VIEW_TYPE = "spiral-day-active-task";

export interface ActiveTaskViewDependencies {
  readonly subscribe: (listener: (snapshot: ExecutionApplicationSnapshot) => void) => () => void;
  readonly snapshot: () => ExecutionApplicationSnapshot;
  readonly now: () => number;
  readonly messages: ExecutionMessages;
  readonly subscribeLocale?: (listener: () => void) => () => void;
  readonly openSource: (target: SourceTaskReference) => void | Promise<void>;
  readonly copyLink: (target: SourceTaskReference, label: string) => TaskLinkCopyResult | Promise<TaskLinkCopyResult>;
  readonly clockOut: () => void | Promise<void>;
  readonly onError?: (error: unknown) => void;
}

const ICONS = Object.freeze({
  check: "check",
  "chevron-down": "chevron-down",
  "chevron-right": "chevron-right",
  clock: "clock",
  copy: "copy",
  "external-link": "external-link",
  focus: "focus",
  refresh: "refresh-cw",
  square: "square",
  timer: "timer",
  trash: "trash-2",
  x: "x",
}) satisfies Readonly<Record<ExecutionIconName, IconName>>;

export class SpiralDayActiveTaskView extends ItemView {
  readonly #dependencies: ActiveTaskViewDependencies;
  #unsubscribe: (() => void) | undefined;
  #unsubscribeLocale: (() => void) | undefined;
  #timer: number | undefined;
  #snapshot: ExecutionApplicationSnapshot;
  #clockOutPending = false;

  constructor(leaf: WorkspaceLeaf, dependencies: ActiveTaskViewDependencies) {
    super(leaf);
    this.#dependencies = dependencies;
    this.#snapshot = dependencies.snapshot();
  }

  override getViewType(): string {
    return ACTIVE_TASK_VIEW_TYPE;
  }

  override getDisplayText(): string {
    return this.#dependencies.messages.t("execution", "active.title");
  }

  override getIcon(): IconName {
    return "timer";
  }

  protected override async onOpen(): Promise<void> {
    this.contentEl.classList.add("spiral-day-active-task-view");
    this.#unsubscribe = this.#dependencies.subscribe((snapshot) => {
      this.#snapshot = snapshot;
      this.#render();
    });
    this.#unsubscribeLocale = this.#dependencies.subscribeLocale?.(() => this.#render());
    this.#timer = this.contentEl.ownerDocument.defaultView?.setInterval(() => this.#tick(), 1_000);
    this.#render();
  }

  protected override async onClose(): Promise<void> {
    this.#unsubscribe?.();
    this.#unsubscribe = undefined;
    this.#unsubscribeLocale?.();
    this.#unsubscribeLocale = undefined;
    if (this.#timer !== undefined) {
      this.contentEl.ownerDocument.defaultView?.clearInterval(this.#timer);
      this.#timer = undefined;
    }
    this.contentEl.replaceChildren();
    this.contentEl.classList.remove("spiral-day-active-task-view");
  }

  #render(): void {
    const focused = this.#snapshot.focused;
    renderActiveTaskSurface(this.contentEl, {
      snapshot: this.#snapshot,
      nowEpochMs: this.#dependencies.now(),
      messages: this.#dependencies.messages,
      renderIcon: (element, icon) => setIcon(element, ICONS[icon] ?? "circle-help"),
      onOpenSource: () => {
        if (!focused) return;
        void Promise.resolve(this.#dependencies.openSource({
          path: focused.path,
          ownerId: focused.ownerId,
          sourceOrder: focused.sourceOrder,
        })).catch((error: unknown) => this.#dependencies.onError?.(error));
      },
      onCopyLink: () => {
        if (!focused) return;
        void Promise.resolve(this.#dependencies.copyLink({
          path: focused.path,
          ownerId: focused.ownerId,
          sourceOrder: focused.sourceOrder,
        }, focused.label)).then((result) => {
          const key = result.kind === "copied" ? "notice.taskLinkCopied" : "error.copyTaskLink";
          new Notice(this.#dependencies.messages.t("execution", key), result.kind === "copied" ? 3_000 : 5_000);
        }).catch((error: unknown) => this.#dependencies.onError?.(error));
      },
      onClockOut: () => this.#clockOut(),
    });
  }

  #clockOut(): void {
    if (this.#clockOutPending || this.#snapshot.writeBlocked || !this.#snapshot.focused) return;
    this.#clockOutPending = true;
    const button = this.contentEl.querySelector<HTMLButtonElement>(".spiral-day-active-task__clock-out");
    if (button) {
      button.disabled = true;
      button.setAttribute("aria-busy", "true");
    }
    void Promise.resolve().then(() => this.#dependencies.clockOut()).catch((error: unknown) => {
      this.#dependencies.onError?.(error);
    }).finally(() => {
      this.#clockOutPending = false;
      const current = this.contentEl.querySelector<HTMLButtonElement>(".spiral-day-active-task__clock-out");
      if (!current) return;
      current.disabled = this.#snapshot.writeBlocked;
      current.removeAttribute("aria-busy");
      current.focus();
    });
  }

  #tick(): void {
    updateActiveTaskElapsed(this.contentEl, this.#snapshot, this.#dependencies.now());
  }
}

export function createActiveTaskViewFactory(
  dependencies: ActiveTaskViewDependencies,
): (leaf: WorkspaceLeaf) => SpiralDayActiveTaskView {
  return (leaf) => new SpiralDayActiveTaskView(leaf, dependencies);
}

export async function openActiveTaskView(app: App): Promise<{ readonly leaf: WorkspaceLeaf; readonly reused: boolean }> {
  const before = app.workspace.getLeavesOfType(ACTIVE_TASK_VIEW_TYPE);
  const leaf = await app.workspace.ensureSideLeaf(ACTIVE_TASK_VIEW_TYPE, "right", {
    active: true,
    reveal: true,
    split: false,
  });
  for (const duplicate of app.workspace.getLeavesOfType(ACTIVE_TASK_VIEW_TYPE)) {
    if (duplicate !== leaf) duplicate.detach();
  }
  await app.workspace.revealLeaf(leaf);
  app.workspace.setActiveLeaf(leaf, { focus: true });
  return Object.freeze({ leaf, reused: before.includes(leaf) });
}
