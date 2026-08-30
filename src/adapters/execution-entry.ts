import { setIcon, type IconName, type Plugin } from "obsidian";
import { mountExecutionPanel, type ExecutionPanelPort, type ExecutionPanelSurface } from "../ui/execution/panel";
import type {
  ExecutionApplicationSnapshot,
} from "../runtime/execution/application";
import type { ExecutionCommandOutcome } from "../runtime/execution/commands";
import type {
  ExecutionIconName,
  ExecutionMessages,
} from "../ui/execution/shared-controls";

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

export interface ExecutionEntryDependencies {
  readonly plugin: Plugin;
  readonly port: ExecutionPanelPort;
  readonly messages: ExecutionMessages;
  readonly onOutcome?: (outcome: ExecutionCommandOutcome) => void;
  readonly onError?: (error: unknown) => void;
}

export class ExecutionEntryAdapter {
  readonly #dependencies: ExecutionEntryDependencies;
  #trigger: HTMLElement | undefined;
  #pomoStop: HTMLElement | undefined;
  #surface: ExecutionPanelSurface | undefined;
  #unsubscribe: (() => void) | undefined;
  #pomoStopPending = false;

  constructor(dependencies: ExecutionEntryDependencies) {
    this.#dependencies = dependencies;
  }

  get active(): boolean {
    return this.#surface !== undefined;
  }

  start(): void {
    if (this.#surface) return;
    const trigger = this.#dependencies.plugin.addRibbonIcon(
      "timer",
      this.#dependencies.messages.t("execution", "surface.name"),
      () => {},
    );
    trigger.classList.add("spiral-day-execution-trigger");
    trigger.setAttribute("aria-haspopup", "dialog");
    this.#trigger = trigger;
    const stopPomo = this.#dependencies.plugin.addRibbonIcon(
      "x",
      this.#dependencies.messages.t("execution", "action.stopPomo"),
      () => this.#stopStandalonePomo(),
    );
    stopPomo.classList.add("spiral-day-execution-pomo-stop");
    stopPomo.hidden = true;
    this.#pomoStop = stopPomo;
    this.#surface = mountExecutionPanel(this.#dependencies.port, {
      trigger,
      messages: this.#dependencies.messages,
      renderIcon: (element, icon) => setIcon(element, ICONS[icon]),
      ...(this.#dependencies.onError ? { onError: this.#dependencies.onError } : {}),
    });
    this.#unsubscribe = this.#dependencies.port.subscribeExecution((snapshot) => this.#syncPomoStop(snapshot));
  }

  stop(): void {
    this.#surface?.destroy();
    this.#surface = undefined;
    this.#unsubscribe?.();
    this.#unsubscribe = undefined;
    this.#pomoStop?.remove();
    this.#pomoStop = undefined;
    this.#pomoStopPending = false;
    this.#trigger?.remove();
    this.#trigger = undefined;
  }

  open(): void {
    this.#surface?.open();
  }

  setLocale(): void {
    this.#surface?.setLocale();
    this.#trigger?.setAttribute("aria-label", this.#dependencies.messages.t("execution", "surface.name"));
    const stopLabel = this.#dependencies.messages.t("execution", "action.stopPomo");
    this.#pomoStop?.setAttribute("aria-label", stopLabel);
    if (this.#pomoStop) this.#pomoStop.title = stopLabel;
  }

  #syncPomoStop(snapshot: ExecutionApplicationSnapshot): void {
    if (!this.#pomoStop) return;
    this.#pomoStop.hidden = snapshot.focused !== undefined || snapshot.standalonePomoStartEpochMs === null;
  }

  #stopStandalonePomo(): void {
    if (this.#pomoStopPending || !this.#pomoStop || this.#pomoStop.hidden) return;
    this.#pomoStopPending = true;
    this.#pomoStop.setAttribute("aria-busy", "true");
    void this.#dependencies.port.dispatch({
      type: "stop-standalone-pomo",
      intentId: `ribbon-pomo-stop-${this.#dependencies.port.now()}`,
    }).then((outcome) => {
      this.#dependencies.onOutcome?.(outcome);
    }, this.#dependencies.onError).finally(() => {
      this.#pomoStopPending = false;
      this.#pomoStop?.removeAttribute("aria-busy");
    });
  }
}
