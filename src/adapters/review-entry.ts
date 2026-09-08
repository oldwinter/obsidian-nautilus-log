import type { LogicalDate } from "../core/day";
import { createMessages, defineLocaleNamespace } from "../i18n/resolver";
import { enReview } from "../i18n/locales/en/review";
import { zhCNReview } from "../i18n/locales/zh-CN/review";
import type { ExecutionApplicationIntent, ExecutionApplicationSnapshot } from "../runtime/execution/application";
import type { ExecutionCommandOutcome } from "../runtime/execution/commands";
import type { ReviewCoordinatorSnapshot } from "../runtime/review/coordinator";
import type { ExecutionMessages } from "../ui/execution/shared-controls";
import type { ExecutionReviewSurface } from "../ui/execution/panel";
import { ReviewView } from "../ui/execution/review-view";
import type { ReviewRowAction } from "../ui/execution/review-row";
import type { SourceTaskReference } from "./source-navigation";

export interface ReviewEntryDependencies {
  readonly dispatch: (intent: ExecutionApplicationIntent) => Promise<ExecutionCommandOutcome>;
  readonly executionSnapshot: () => ExecutionApplicationSnapshot;
  readonly subscribeExecution: (listener: (snapshot: ExecutionApplicationSnapshot) => void) => () => void;
  readonly reviewSnapshot: () => ReviewCoordinatorSnapshot;
  readonly subscribeReview: (listener: (snapshot: ReviewCoordinatorSnapshot) => void) => () => void;
  readonly navigateTask: (target: SourceTaskReference, location: "main" | "sidebar") => void | Promise<void>;
  readonly today: () => LogicalDate;
  readonly selectDate: (date: LogicalDate | null) => Promise<void>;
  readonly refresh: () => Promise<void>;
  readonly tick: () => void;
  readonly intentId: () => string;
  readonly messages: ExecutionMessages;
  readonly addDisposer: (dispose: () => void) => void;
}

export interface ReviewEntryPort extends ReviewEntryDependencies {
  readonly createSurface: (root: HTMLElement) => ExecutionReviewSurface;
}

const reviewNamespace = defineLocaleNamespace("review", enReview, zhCNReview);

export function createReviewEntryPort(dependencies: ReviewEntryDependencies): ReviewEntryPort {
  return Object.freeze({
    ...dependencies,
    createSurface(root: HTMLElement): ExecutionReviewSurface {
      let destroyed = false;
      let visible = false;
      let pending = false;
      let error = false;
      let timer: number | undefined;
      const messages = createMessages({
        locale: dependencies.messages.locale,
        namespaces: { review: reviewNamespace },
      });
      const render = (): void => {
        if (destroyed || !visible) return;
        view.render({
          review: dependencies.reviewSnapshot(),
          execution: dependencies.executionSnapshot(),
          messages,
          pending,
          error,
        });
      };
      const refresh = async (operation: () => Promise<void>): Promise<void> => {
        error = false;
        try {
          await operation();
        } catch {
          error = true;
        }
        render();
      };
      const activate = async (key: string, action: ReviewRowAction): Promise<void> => {
        if (destroyed || !visible || pending) return;
        const review = dependencies.reviewSnapshot();
        const execution = dependencies.executionSnapshot();
        if (review.state !== "ready" || execution.status !== "ready" || execution.writeBlocked) return;
        const row = review.projection.rows.find((candidate) => candidate.task.key === key);
        const target = row?.task.target;
        if (!row || !target) return;
        if (action === "open-source" && !target.ownerId) return;
        if (action !== "open-source") {
          const today = dependencies.today();
          const date = review.displayedDate;
          if (row.task.status === "done" || date.year !== today.year || date.month !== today.month || date.day !== today.day) return;
        }
        if (action === "clock-in" && target.ownerId && target.ownerId === execution.focused?.ownerId) return;
        pending = true;
        error = false;
        render();
        try {
          if (action === "open-source") {
            await dependencies.navigateTask(target, "main");
          } else {
            const outcome = await dependencies.dispatch({ type: action, target, intentId: dependencies.intentId() });
            error = outcome.outcome !== "applied" && outcome.outcome !== "already-applied";
            await dependencies.refresh();
          }
        } catch {
          error = true;
        } finally {
          pending = false;
          render();
        }
      };
      const view = new ReviewView(root, {
        today: dependencies.today,
        selectDate: (date) => { void refresh(() => dependencies.selectDate(date)); },
        refresh: () => { void refresh(dependencies.refresh); },
        activate: (key, action) => { void activate(key, action); },
      });
      const unsubscribers = [
        dependencies.subscribeReview(render),
        dependencies.subscribeExecution(render),
        dependencies.messages.subscribe((locale) => {
          messages.setLocale(locale);
          render();
        }),
      ];
      const surface: ExecutionReviewSurface = Object.freeze({
        render(target: HTMLElement, nextVisible: boolean): void {
          if (destroyed || target !== root) return;
          const opening = nextVisible && !visible;
          visible = nextVisible;
          if (!visible && timer !== undefined) {
            root.ownerDocument.defaultView?.clearInterval(timer);
            timer = undefined;
          }
          if (opening) {
            void refresh(dependencies.refresh);
            timer = root.ownerDocument.defaultView?.setInterval(() => {
              if (!destroyed && visible) dependencies.tick();
            }, 1_000);
          }
          render();
        },
        destroy(): void {
          if (destroyed) return;
          destroyed = true;
          if (timer !== undefined) root.ownerDocument.defaultView?.clearInterval(timer);
          for (const unsubscribe of unsubscribers) unsubscribe();
          view.destroy();
        },
      });
      dependencies.addDisposer(surface.destroy);
      return surface;
    },
  });
}
