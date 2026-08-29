import type { SystemClock, TimerHandle } from "./system-clock";

export type RefreshKind = "editor" | "vault" | "immediate";
export type RefreshCallback = () => void | PromiseLike<void>;

const EDITOR_DELAY_MILLISECONDS = 150;
const EDITOR_MAX_WAIT_MILLISECONDS = 500;
const VAULT_DELAY_MILLISECONDS = 250;

function isPromiseLike(value: void | PromiseLike<void>): value is PromiseLike<void> {
  return value !== undefined && typeof value.then === "function";
}

export class RefreshCoordinator {
  private timer: TimerHandle | null = null;
  private requestPending = false;
  private requestDeadline = 0;
  private editorBurstStartedAt: number | null = null;
  private refreshRunning = false;

  constructor(
    private readonly clock: SystemClock,
    private readonly onRefresh: RefreshCallback,
  ) {}

  schedule(kind: RefreshKind): void {
    const now = this.clock.now();
    if (kind === "immediate") {
      this.clearTimer();
      this.editorBurstStartedAt = null;
      this.requestPending = true;
      this.requestDeadline = now;
      if (!this.refreshRunning) this.runPendingRefresh();
      return;
    }

    if (kind === "editor" && this.editorBurstStartedAt === null) {
      this.editorBurstStartedAt = now;
    }
    const editorBurstDeadline = this.editorBurstStartedAt === null
      ? Number.POSITIVE_INFINITY
      : this.editorBurstStartedAt + EDITOR_MAX_WAIT_MILLISECONDS;
    const trailingDelay = this.editorBurstStartedAt === null
      ? VAULT_DELAY_MILLISECONDS
      : EDITOR_DELAY_MILLISECONDS;

    this.requestPending = true;
    this.requestDeadline = Math.min(now + trailingDelay, editorBurstDeadline);
    if (this.refreshRunning && this.requestDeadline <= now) {
      this.clearTimer();
    } else {
      this.armTimer();
    }
  }

  cancel(): void {
    this.clearTimer();
    this.requestPending = false;
    this.requestDeadline = 0;
    this.editorBurstStartedAt = null;
  }

  private clearTimer(): void {
    if (this.timer === null) return;
    this.clock.clearTimeout(this.timer);
    this.timer = null;
  }

  private armTimer(): void {
    this.clearTimer();
    if (!this.requestPending) return;
    const delay = Math.max(0, this.requestDeadline - this.clock.now());
    this.timer = this.clock.setTimeout(() => {
      this.timer = null;
      this.runPendingRefresh();
    }, delay);
  }

  private runPendingRefresh(): void {
    if (!this.requestPending || this.refreshRunning) return;
    this.clearTimer();
    this.requestPending = false;
    this.editorBurstStartedAt = null;
    this.refreshRunning = true;

    try {
      const result = this.onRefresh();
      if (isPromiseLike(result)) {
        void Promise.resolve(result).then(
          () => this.finishRefresh(),
          () => this.finishRefresh(),
        );
      } else {
        this.finishRefresh();
      }
    } catch (error: unknown) {
      this.finishRefresh();
      throw error;
    }
  }

  private finishRefresh(): void {
    this.refreshRunning = false;
    if (this.requestPending) this.armTimer();
  }
}
