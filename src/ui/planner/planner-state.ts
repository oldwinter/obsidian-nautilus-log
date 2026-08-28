import { projectPlaybackMinute } from "../../core/day";
import type { PlannerHostContext, PlannerLayoutMode } from "./responsive-layout";

export type PlannerPlaybackState = "stopped" | "running" | "finished";

export interface PlannerPresentationState {
  readonly collapsed: boolean;
  readonly showCompleted: boolean;
  readonly overviewOpen: boolean;
  readonly scheduleOpen: boolean;
  readonly playback: PlannerPlaybackState;
  readonly playbackStartedAt: number | null;
}

export type PlannerPresentationAction =
  | { readonly type: "toggle-collapse" }
  | { readonly type: "toggle-completed" }
  | { readonly type: "toggle-overview" }
  | { readonly type: "toggle-schedule" }
  | { readonly type: "start-playback"; readonly now: number }
  | { readonly type: "finish-playback" };

export function initialPlannerPresentationState(
  hostContext: PlannerHostContext,
): PlannerPresentationState {
  return Object.freeze({
    collapsed: false,
    showCompleted: true,
    overviewOpen: false,
    scheduleOpen: hostContext !== "sidebar",
    playback: "stopped",
    playbackStartedAt: null,
  });
}

export function reducePlannerPresentationState(
  state: PlannerPresentationState,
  action: PlannerPresentationAction,
): PlannerPresentationState {
  if (action.type === "toggle-collapse") {
    return Object.freeze({ ...state, collapsed: !state.collapsed });
  }
  if (action.type === "toggle-completed") {
    return Object.freeze({ ...state, showCompleted: !state.showCompleted });
  }
  if (action.type === "toggle-overview") {
    return Object.freeze({ ...state, overviewOpen: !state.overviewOpen });
  }
  if (action.type === "toggle-schedule") {
    return Object.freeze({ ...state, scheduleOpen: !state.scheduleOpen });
  }
  if (action.type === "start-playback") {
    if (state.playback === "running" || !Number.isFinite(action.now)) return state;
    return Object.freeze({ ...state, playback: "running", playbackStartedAt: action.now });
  }
  return Object.freeze({ ...state, playback: "finished", playbackStartedAt: null });
}

export function normalizeStateForLayout(
  state: PlannerPresentationState,
  previousMode: PlannerLayoutMode | undefined,
  nextMode: PlannerLayoutMode,
  hostContext: PlannerHostContext,
): PlannerPresentationState {
  if (previousMode === undefined || previousMode === nextMode) return state;
  return Object.freeze({
    ...state,
    overviewOpen: false,
    scheduleOpen: nextMode === "compact" && hostContext !== "sidebar",
  });
}

export function plannerPlaybackMinute(
  state: PlannerPresentationState,
  now: number,
  startMinutes: number,
  endMinutes: number,
): number | null {
  if (state.playback !== "running" || state.playbackStartedAt === null) return null;
  return projectPlaybackMinute({
    startMinutes,
    endMinutes,
    elapsedMilliseconds: Math.max(0, now - state.playbackStartedAt),
  });
}
