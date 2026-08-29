export const SUPPORTED_LOCALES = ["en", "zh-CN"] as const;

export type SupportedLocale = (typeof SUPPORTED_LOCALES)[number];
export type PlannerLimitKind =
  | "active-note-bytes"
  | "list-depth"
  | "plan-item-bytes"
  | "plan-items"
  | "plan-region-bytes";
export type MessageFunction<Parameters extends object | void = object> = [Parameters] extends [void]
  ? () => string
  : (parameters: Readonly<Extract<Parameters, object>>) => string;
export type MessageValue = string | ((...arguments_: never[]) => string);

export type SharedCatalog = Readonly<{
  "action.close": string;
  "action.refresh": string;
  "state.completed": string;
  "state.conflict": string;
  "state.current": string;
  "state.urgent": string;
  "status.error": string;
  "status.hidden": string;
  "status.loading": string;
  "status.missing": string;
  "status.overLimit": string;
  "status.stale": string;
  "status.unavailable": string;
  "unit.duration": MessageFunction<{ minutes: number }>;
  "unit.itemCount": MessageFunction<{ count: number }>;
}>;

export type PlannerCatalog = Readonly<{
  "announcement.collapsed": string;
  "announcement.completedHidden": string;
  "announcement.completedShown": string;
  "announcement.debugOff": string;
  "announcement.debugOn": string;
  "announcement.expanded": string;
  "announcement.playbackFinished": string;
  "announcement.playbackStarted": string;
  "announcement.progressCompleted": MessageFunction<{ title: string }>;
  "announcement.progressConflict": MessageFunction<{ title: string }>;
  "announcement.progressCleared": MessageFunction<{ title: string }>;
  "announcement.progressPending": MessageFunction<{ title: string }>;
  "announcement.progressRequested": MessageFunction<{ title: string; percent: number }>;
  "announcement.progressReopened": MessageFunction<{ title: string }>;
  "control.collapse": string;
  "control.debugDisable": string;
  "control.debugEnable": string;
  "control.expand": string;
  "control.hideCompleted": string;
  "control.play": string;
  "control.playbackRunning": string;
  "control.showCompleted": string;
  "debug.geometry": MessageFunction<{
    centerX: number;
    centerY: number;
    width: number;
    height: number;
    innerRadius: number;
    outerRadius: number;
    bandWidth: number;
    minute: number;
  }>;
  "disclosure.overflow": MessageFunction<{ count: number; duration: string }>;
  "disclosure.overview": string;
  "disclosure.schedule": MessageFunction<{ count: number }>;
  "disclosure.warnings": MessageFunction<{ count: number }>;
  "item.accessibleName": MessageFunction<{
    kind: string;
    title: string;
    start: string;
    end: string;
    duration: string;
    states: string;
  }>;
  "item.availableName": MessageFunction<{
    start: string;
    end: string;
    duration: string;
    states: string;
  }>;
  "item.availableSlot": string;
  "item.fixedEvent": string;
  "item.task": string;
  "item.urgentTask": string;
  "legend.event": string;
  "legend.task": string;
  "legend.urgent": string;
  "metric.availableTime": string;
  "metric.fixedTime": string;
  "metric.flexibleTime": string;
  "metric.scheduledTime": string;
  "status.errorDetail": string;
  "status.hiddenDetail": string;
  "status.loadingDetail": string;
  "status.missingDetail": string;
  "status.overLimitDetail": MessageFunction<{ actual: number; kind: PlannerLimitKind; limit: number }>;
  "status.overLimitUnknownDetail": MessageFunction<{ actual: number; limit: number }>;
  "status.staleDetail": string;
  "status.unavailableDetail": string;
  "surface.name": string;
  "tooltip.item": MessageFunction<{
    kind: string;
    title: string;
    start: string;
    end: string;
    duration: string;
  }>;
  "warning.emptyPlanItem": string;
  "warning.invalidTimeRange": string;
  "warning.itemFallback": MessageFunction<{ index: number }>;
  "warning.planRegionDuplicate": string;
  "warning.planRegionNested": string;
  "warning.planRegionUnclosed": string;
  "warning.planVersionUnsupported": string;
  "warning.sameTime": string;
  "warning.overnightTruncated": string;
  "warning.plan": string;
}>;

export type CoreMessageNamespaces = Readonly<{
  shared: SharedCatalog;
  planner: PlannerCatalog;
}>;

export interface LocaleNamespace<Catalog extends object> {
  readonly en: Catalog;
  readonly "zh-CN": Catalog;
}

export type NamespaceRegistration = Readonly<Record<string, LocaleNamespace<object>>>;

export type RegisteredNamespaces<Registration extends NamespaceRegistration> = Readonly<{
  [Namespace in keyof Registration]: Registration[Namespace] extends LocaleNamespace<infer Catalog>
    ? Catalog
    : never;
}>;

type SupportedMessageArguments<Arguments extends readonly unknown[]> =
  Exclude<Arguments["length"], 0 | 1> extends never ? Arguments : never;

export type MessageKey<Catalog> = Extract<{
  [Key in keyof Catalog]: Catalog[Key] extends string
    ? Key
    : Catalog[Key] extends (...arguments_: infer Arguments) => string
      ? SupportedMessageArguments<Arguments> extends never ? never : Key
      : never;
}[keyof Catalog], string>;

export type MessageArguments<Value> = Value extends (...args: infer Arguments) => string
  ? SupportedMessageArguments<Arguments>
  : readonly [];

export interface Messages<Namespaces extends object = CoreMessageNamespaces> {
  readonly locale: SupportedLocale;
  setLocale(locale: string): boolean;
  subscribe(listener: (locale: SupportedLocale) => void): () => void;
  t<Namespace extends keyof Namespaces, Key extends MessageKey<Namespaces[Namespace]>>(
    namespace: Namespace,
    key: Key,
    ...arguments_: MessageArguments<Namespaces[Namespace][Key]>
  ): string;
}

export function normalizeLocale(locale: string): SupportedLocale {
  const normalized = locale.trim().replaceAll("_", "-").toLowerCase();
  return normalized === "zh" || normalized.startsWith("zh-cn") || normalized.startsWith("zh-hans")
    ? "zh-CN"
    : "en";
}
