import type { ExecutionApplicationIntent, ExecutionApplicationSnapshot } from "../runtime/execution/application";
import type { ExecutionCommandOutcome } from "../runtime/execution/commands";
import type { ReviewCoordinatorSnapshot } from "../runtime/review/coordinator";
import type { ExecutionMessages } from "../ui/execution/shared-controls";
import type { ExecutionReviewSurface } from "../ui/execution/panel";
import type { SourceTaskReference } from "./source-navigation";

export interface ReviewEntryDependencies {
  readonly dispatch: (intent: ExecutionApplicationIntent) => Promise<ExecutionCommandOutcome>;
  readonly executionSnapshot: () => ExecutionApplicationSnapshot;
  readonly subscribeExecution: (listener: (snapshot: ExecutionApplicationSnapshot) => void) => () => void;
  readonly reviewSnapshot: () => ReviewCoordinatorSnapshot;
  readonly subscribeReview: (listener: (snapshot: ReviewCoordinatorSnapshot) => void) => () => void;
  readonly navigateTask: (target: SourceTaskReference, location: "main" | "sidebar") => void | Promise<void>;
  readonly messages: ExecutionMessages;
  readonly addDisposer: (dispose: () => void) => void;
}

/** Stable composition port handed to #29 without coupling #27 to Review UI internals. */
export interface ReviewEntryPort extends ReviewEntryDependencies {
  readonly createSurface: (root: HTMLElement) => ExecutionReviewSurface;
}

export function createReviewEntryPort(dependencies: ReviewEntryDependencies): ReviewEntryPort {
  return Object.freeze({
    ...dependencies,
    createSurface(root: HTMLElement): ExecutionReviewSurface {
      let destroyed = false;
      return Object.freeze({
        render(target: HTMLElement, visible: boolean): void {
          if (destroyed || target !== root || !visible) return;
          root.replaceChildren();
          const message = root.ownerDocument.createElement("p");
          message.className = "spiral-day-execution__empty";
          message.textContent = dependencies.messages.t("execution", "review.pending");
          root.append(message);
        },
        destroy(): void {
          if (destroyed) return;
          destroyed = true;
          root.replaceChildren();
        },
      });
    },
  });
}
