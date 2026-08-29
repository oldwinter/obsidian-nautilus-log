export type PlannerDisclosureKey = "overflow" | "overview" | "schedule" | "warnings";

export type PlannerDisclosureState = Readonly<Record<PlannerDisclosureKey, boolean>>;

export interface PlannerDisclosuresController {
  readonly state: PlannerDisclosureState;
  setOpen(key: PlannerDisclosureKey, open: boolean): boolean;
  toggle(key: PlannerDisclosureKey): boolean;
  closeAll(): boolean;
  subscribe(listener: (state: PlannerDisclosureState) => void): () => void;
}

const FOLDED_STATE: PlannerDisclosureState = Object.freeze({
  overflow: false,
  overview: false,
  schedule: false,
  warnings: false,
});

export function initialPlannerDisclosureState(): PlannerDisclosureState {
  return FOLDED_STATE;
}

export function createPlannerDisclosures(
  initial: PlannerDisclosureState = initialPlannerDisclosureState(),
): PlannerDisclosuresController {
  let state = Object.freeze({ ...initial });
  const listeners = new Set<(state: PlannerDisclosureState) => void>();
  const publish = (): void => {
    for (const listener of listeners) listener(state);
  };
  return Object.freeze({
    get state() {
      return state;
    },
    setOpen(key: PlannerDisclosureKey, open: boolean) {
      if (state[key] === open) return false;
      state = Object.freeze({ ...state, [key]: open });
      publish();
      return true;
    },
    toggle(key: PlannerDisclosureKey) {
      state = Object.freeze({ ...state, [key]: !state[key] });
      publish();
      return true;
    },
    closeAll() {
      if (Object.values(state).every((open) => !open)) return false;
      state = FOLDED_STATE;
      publish();
      return true;
    },
    subscribe(listener: (next: PlannerDisclosureState) => void) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  });
}

export function bindPlannerDisclosure(
  details: HTMLDetailsElement,
  key: PlannerDisclosureKey,
  controller: PlannerDisclosuresController,
): () => void {
  details.open = controller.state[key];
  const summary = details.querySelector("summary");
  const syncAria = (): void => summary?.setAttribute("aria-expanded", String(details.open));
  syncAria();
  const toggle = (): void => {
    controller.setOpen(key, details.open);
    syncAria();
  };
  details.addEventListener("toggle", toggle);
  const unsubscribe = controller.subscribe((state) => {
    if (details.open !== state[key]) details.open = state[key];
    syncAria();
  });
  return () => {
    details.removeEventListener("toggle", toggle);
    unsubscribe();
  };
}
